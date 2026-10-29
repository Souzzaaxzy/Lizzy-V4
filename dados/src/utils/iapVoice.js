/**
 * `!iap` -- agente de VOZ na call do WhatsApp.
 *
 * ## O que faz
 *
 * Depois de subir a call (`!callp`), o `!iap on` liga um agente que OUVE o que
 * chega pela call e RESPONDE em voz. O fluxo e' o classico de agente de voz:
 *
 *   fala -> VAD -> STT -> LLM -> TTS -> fala de volta
 *
 * ## De onde vem cada pedaco (nada inventado)
 *
 * - **Entrada**: o motor (`@zapo-js/voip`) emite `voip_call_inbound_audio` com
 *   PCM 16 kHz mono -- o audio de quem fala, ja' decodificado.
 * - **Saida**: `setExternalAudioMode(callId, true)` + `feedLiveAudio(callId,
 *   Float32Array)` -- o mesmo par que o `!midiap` usa para o audio do video.
 * - **STT/LLM/TTS**: `iapStt.js`, o `ia.js` (o mesmo dos comandos de IA) e o
 *   `iapTts.js`.
 *
 * ## Barge-in (o detalhe que faz parecer conversa)
 *
 * Se alguem comeca a falar enquanto o agente responde, o agente precisa CALAR.
 * Enquanto ele fala, cada frame que chega passa pelo VAD; se detectar fala, a
 * fala em curso e' abortada e a fila de saida e' drenada. Sem isso a conversa
 * vira dois monologos sobrepostos.
 *
 * ## Por que tudo e' injetado
 *
 * O modulo nao conhece o motor nem o Baileys: recebe `falar`, `ouvir`, `ia`,
 * `stt`, `tts` por parametro. E' o que permite testar o fluxo inteiro (VAD,
 * barge-in, fila) sem abrir call nenhuma.
 */

import { DetectorDeFala, TAXA_MOTOR, resamplePcm } from './iapAudio.js';

/** Frames que o motor entrega por tick (960 amostras = 60 ms a 16 kHz). */
const AMOSTRAS_POR_FRAME = 960;

/** Teto da fila de fala: acima disso, a resposta e' descartada. */
const FILA_MAX = 200;

/** Quantas mensagens de historico o agente lembra. */
const HISTORICO_MAX = 12;

/** Teto de tempo esperando a fala terminar (evita travar o agente). */
const TTS_TIMEOUT_MS = Number.parseInt(process.env.IAP_TTS_TIMEOUT_MS || '45000', 10);

/**
 * Monta o prompt do sistema do agente.
 * @param {object} opts
 * @param {string} opts.botName
 * @param {string} [opts.personalidade]
 */
export function promptDoSistema({ botName = 'Bot', personalidade } = {}) {
  return (personalidade || `Voce e' ${botName}, um assistente de voz numa chamada de grupo do WhatsApp. `)
    + 'Responda em portugues do Brasil, em frases CURTAS e naturais de fala '
    + '(2 a 3 frases no maximo), porque sua resposta sera lida em voz alta. '
    + 'Nao use emojis, markdown, listas nem asteriscos -- apenas o texto falado. '
    + 'Se a pergunta for inaudivel ou vazia, diga apenas que nao entendeu.';
}

/**
 * O agente de voz de UM grupo.
 *
 * Uma instancia por grupo ligado. O ciclo de vida e':
 *   `ligar()` -> recebe frames por `receberAudio()` -> `desligar()`.
 */
export class AgenteDeVoz {
  /**
   * @param {object} opts
   * @param {string} opts.grupo
   * @param {(pcm: Float32Array) => void|Promise<void>} opts.falar envia PCM ao motor
   * @param {(texto: string) => Promise<string>} opts.pensar LLM: texto -> resposta
   * @param {(pcm: Float32Array) => Promise<string|null>} opts.transcrever STT
   * @param {(texto: string) => Promise<Float32Array|null>} opts.sintetizar TTS
   * @param {(msg: string, extra?: object) => void} [opts.log]
   * @param {object} [opts.vad] opcoes do detector de fala
   */
  constructor({
    grupo,
    falar,
    pensar,
    transcrever,
    sintetizar,
    log = () => {},
    vad = {}
  }) {
    this.grupo = grupo;
    this.falar = falar;
    this.pensar = pensar;
    this.transcrever = transcrever;
    this.sintetizar = sintetizar;
    this.log = log;

    this.vad = new DetectorDeFala(vad);
    /** Frames da frase em andamento. */
    this.frase = [];
    /** Historico da conversa (para o LLM ter contexto). */
    this.historico = [];
    /** Ligado? */
    this.ativo = false;
    /** Falando agora? (o VAD usa isso para o barge-in). */
    this.falando = false;
    /** Frase em processamento (evita duas respostas ao mesmo tempo). */
    this.processando = false;
    /** Fila de PCM a entregar ao motor. */
    this.fila = [];
    /** Timer do bombeamento da fila. */
    this.timerFila = null;
    /** Contador de barge-ins (diagnostico). */
    this.bargeIns = 0;
  }

  /** Liga o agente. */
  ligar() {
    this.ativo = true;
    this.vad.reset();
    this.frase = [];
    this.log('agente ligado', { grupo: this.grupo });
  }

  /** Desliga o agente e descarta o estado. */
  desligar() {
    this.ativo = false;
    this.falando = false;
    this.processando = false;
    this.frase = [];
    this.fila = [];
    this.historico = [];
    if (this.timerFila) {
      clearInterval(this.timerFila);
      this.timerFila = null;
    }
    this.log('agente desligado', { grupo: this.grupo });
  }

  /**
   * Recebe um frame de audio da call.
   *
   * Este e' o ponto onde o barge-in acontece: se o agente esta' falando e o
   * frame tem fala, a resposta em curso e' abortada.
   *
   * @param {Float32Array} pcm
   */
  receberAudio(pcm) {
    if (!this.ativo || !pcm || !pcm.length) return;

    const evento = this.vad.processar(pcm);

    if (this.falando && (evento === 'inicio' || evento === 'meio')) {
      // BARGE-IN: alguem falou por cima. Para de falar e comeca a ouvir.
      this.abortarFala();
      this.bargeIns += 1;
      this.log('barge-in: agente calou', { grupo: this.grupo });
    }

    if (evento === 'inicio') {
      this.frase = [pcm.slice()];
      return;
    }
    if (evento === 'meio') {
      if (this.frase.length) this.frase.push(pcm.slice());
      return;
    }
    if (evento === 'fim') {
      if (this.frase.length) this.frase.push(pcm.slice());
      const bloco = this.juntarFrase();
      this.frase = [];
      void this.responder(bloco);
      return;
    }
    // 'nada': silencio. Se havia frase acumulada sem fechar, nada a fazer.
  }

  /** Junta os frames da frase num Float32Array so'. */
  juntarFrase() {
    let total = 0;
    for (const f of this.frase) total += f.length;
    const saida = new Float32Array(total);
    let pos = 0;
    for (const f of this.frase) {
      saida.set(f, pos);
      pos += f.length;
    }
    return saida;
  }

  /**
   * Processa uma frase: STT -> LLM -> TTS -> fala.
   * @param {Float32Array} pcm
   */
  async responder(pcm) {
    if (!this.ativo || this.processando) return;
    if (!pcm || pcm.length < TAXA_MOTOR * 0.3) return; // < 300 ms: nao e' fala
    this.processando = true;
    const t0 = Date.now();
    try {
      const texto = await this.transcrever(pcm);
      if (!this.ativo) return;
      if (!texto) {
        this.log('sem fala reconhecida', { grupo: this.grupo });
        return;
      }
      this.log('ouviu', { grupo: this.grupo, texto });

      const resposta = await this.pensar(texto, this.historico);
      if (!this.ativo) return;
      if (!resposta) return;

      this.historico.push({ role: 'user', content: texto });
      this.historico.push({ role: 'assistant', content: resposta });
      if (this.historico.length > HISTORICO_MAX) {
        this.historico = this.historico.slice(-HISTORICO_MAX);
      }
      this.log('respondeu', { grupo: this.grupo, resposta, ms: Date.now() - t0 });

      const audio = await this.sintetizar(resposta);
      if (!this.ativo) return;
      if (!audio || !audio.length) {
        this.log('tts sem audio', { grupo: this.grupo });
        return;
      }
      await this.emitirFala(audio);
    } catch (e) {
      this.log('erro no agente', { grupo: this.grupo, erro: e?.message || String(e) });
    } finally {
      this.processando = false;
    }
  }

  /**
   * Entrega o audio ao motor com pacing (o motor descarta o mais antigo se o
   * buffer estourar). Entrega frame a frame, no ritmo do motor.
   * @param {Float32Array} pcm
   */
  async emitirFala(pcm) {
    // Reagrupa no tamanho de frame do motor, como o `midiap.js` faz.
    this.fila = [];
    for (let i = 0; i < pcm.length; i += AMOSTRAS_POR_FRAME) {
      const fatia = pcm.subarray(i, Math.min(i + AMOSTRAS_POR_FRAME, pcm.length));
      if (fatia.length) this.fila.push(Float32Array.from(fatia));
    }
    if (this.fila.length > FILA_MAX) this.fila = this.fila.slice(-FILA_MAX);

    this.falando = true;
    await new Promise((resolve) => {
      const entregar = () => {
        if (!this.ativo || !this.falando) {
          clearInterval(this.timerFila);
          this.timerFila = null;
          resolve();
          return;
        }
        const frame = this.fila.shift();
        if (!frame) {
          clearInterval(this.timerFila);
          this.timerFila = null;
          this.falando = false;
          resolve();
          return;
        }
        try {
          this.falar(frame);
        } catch (e) {
          this.log('falha ao falar', { grupo: this.grupo, erro: e?.message || String(e) });
        }
      };
      // 60 ms = um frame do motor. O timer entrega LISO, sem rajada.
      this.timerFila = setInterval(entregar, 60);
      this.timerFila.unref?.();
      entregar();
    });
  }

  /** Aborta a fala em curso (barge-in / desligar). */
  abortarFala() {
    this.falando = false;
    this.fila = [];
    if (this.timerFila) {
      clearInterval(this.timerFila);
      this.timerFila = null;
    }
  }

  /** Estado resumido (diagnostico). */
  estado() {
    return {
      grupo: this.grupo,
      ativo: this.ativo,
      falando: this.falando,
      processando: this.processando,
      bargeIns: this.bargeIns,
      historico: this.historico.length,
      naFila: this.fila.length
    };
  }
}

/**
 * Gerencia os agentes, um por grupo.
 *
 * Separado do agente para o comando nao precisar saber de instancia: ele chama
 * `ligar(grupo, deps)` / `desligar(grupo)` / `receber(grupo, pcm)`.
 */
export class GerenciadorIap {
  constructor() {
    /** @type {Map<string, AgenteDeVoz>} */
    this.agentes = new Map();
  }

  /** Ja' existe agente ligado neste grupo? */
  ativo(grupo) {
    return this.agentes.has(grupo);
  }

  /**
   * Liga o agente no grupo.
   * @returns {AgenteDeVoz}
   */
  ligar(grupo, deps) {
    const existente = this.agentes.get(grupo);
    if (existente) existente.desligar();
    const agente = new AgenteDeVoz({ grupo, ...deps });
    agente.ligar();
    this.agentes.set(grupo, agente);
    return agente;
  }

  /** Desliga o agente do grupo. `true` se havia um. */
  desligar(grupo) {
    const agente = this.agentes.get(grupo);
    if (!agente) return false;
    agente.desligar();
    this.agentes.delete(grupo);
    return true;
  }

  /** Entrega um frame de audio ao agente do grupo (no-op se nao houver). */
  receber(grupo, pcm) {
    const agente = this.agentes.get(grupo);
    if (!agente) return false;
    agente.receberAudio(pcm);
    return true;
  }

  /** Estado de um agente (ou null). */
  estado(grupo) {
    return this.agentes.get(grupo)?.estado() || null;
  }

  /** Desliga todos (usado quando a call cai). */
  desligarTudo() {
    for (const [grupo, agente] of this.agentes.entries()) {
      agente.desligar();
      this.agentes.delete(grupo);
    }
  }
}

/** Instancia unica do gerenciador (o `index.js` e o `zapoCall.js` a usam). */
export const iap = new GerenciadorIap();

/** Reamostra com teto, para quem precisar (ex.: TTS 24 kHz -> 16 kHz). */
export { resamplePcm };
