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

import { DetectorDeFala, TAXA_MOTOR, resamplePcm, rms } from './iapAudio.js';

/** Frames que o motor entrega por tick (960 amostras = 60 ms a 16 kHz). */
const AMOSTRAS_POR_FRAME = 960;

/** Teto da fila de fala: acima disso, a resposta e' descartada. */
const FILA_MAX = 200;

/** Quantas mensagens de historico o agente lembra (12 trocas ~= 6 turnos). */
const HISTORICO_MAX = Number.parseInt(process.env.IAP_HISTORICO_MAX || '20', 10);

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
    sintetizarStream,
    log = () => {},
    vad = {}
  }) {
    this.grupo = grupo;
    this.falar = falar;
    this.pensar = pensar;
    this.transcrever = transcrever;
    this.sintetizar = sintetizar;
    this.sintetizarStream = sintetizarStream;
    this.log = log;

    this.vad = new DetectorDeFala(vad);
    /**
     * Quantos frames de fala SEGUIDOS calar o agente (barge-in).
     *
     * 3 frames = ~180 ms: fala de verdade passa; um estalo isolado (60 ms) nao.
     * Sem isso, uma tosse ou um clique cortava a fala do bot no meio.
     */
    this.bargeFrames = Number(vad?.bargeFrames) > 0 ? Number(vad.bargeFrames) : 3;
    /** Contador de frames de fala durante a propria fala. */
    this.framesBarge = 0;
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
   * @param {string} [quemFalou] JID de quem falou (audio por participante)
   */
  receberAudio(pcm, quemFalou = null) {
    if (!this.ativo || !pcm || !pcm.length) return;

    // QUEM FALOU: o motor manda o JID no audio por participante. Guardamos o
    // ultimo visto da frase em andamento — e' o que permite a guarda de
    // permissao ("membro comum pedindo para banir").
    if (quemFalou) this.quemFalouAtual = quemFalou;

    const evento = this.vad.processar(pcm);

    // BARGE-IN: alguem falou por cima.
    //
    // ## Por que exige FALA SUSTENTADA (e nao um frame)
    //
    // Um unico frame de energia (60 ms) pode ser tosse, um clique, a cadeira —
    // e cortaria a fala do bot no meio por nada. Contamos os frames SEGUIDOS com
    // energia ACIMA do limiar e so' calamos ao passar de `bargeFrames` (~180 ms).
    //
    // Detalhe medido: o VAD devolve `'meio'` tambem nos silencios DENTRO da
    // frase, entao nao da' para contar pelo evento — a contagem usa a energia
    // (`rms`) do proprio frame. Qualquer frame abaixo do limiar zera.
    const energia = rms(pcm);
    if (this.falando && energia >= this.vad.limiarRms) {
      this.framesBarge = (this.framesBarge || 0) + 1;
      if (this.framesBarge >= this.bargeFrames) {
        this.abortarFala();
        this.bargeIns += 1;
        this.framesBarge = 0;
        this.log('barge-in: agente calou', { grupo: this.grupo });
      }
    } else {
      this.framesBarge = 0;
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
      // Quem falou esta' junto com a frase (nao se perde no meio).
      const falante = this.quemFalouAtual || null;
      this.frase = [];
      this.quemFalouAtual = null;
      void this.responder(bloco, falante);
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
   * @param {string} [quemFalou] JID de quem falou (para a guarda de permissao)
   */
  async responder(pcm, quemFalou = null) {
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
      this.log('ouviu', { grupo: this.grupo, texto, quem: quemFalou || undefined });

      const resposta = await this.pensar(texto, this.historico, { quemFalou });
      if (!this.ativo) return;
      if (!resposta) return;

      this.historico.push({ role: 'user', content: texto });
      this.historico.push({ role: 'assistant', content: resposta });
      if (this.historico.length > HISTORICO_MAX) {
        this.historico = this.historico.slice(-HISTORICO_MAX);
      }
      this.log('respondeu', { grupo: this.grupo, resposta, ms: Date.now() - t0 });

      // SEMPRE o caminho de BATCH: espera o audio e entrega frame a frame no
      // ritmo do motor. O TTS em FLUXO foi REMOVIDO (out/2026) porque a entrega
      // por blocos fazia a fala sair ACELERADA e CORTAR o comeco (a fila
      // descarta os frames mais antigos quando estoura). O `sintetizarStream`
      // NAO e' mais usado, mesmo que alguem o injete.
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
    this.framesBarge = 0;
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

  /**
   * Fala em FLUXO: entrega o audio ao motor conforme ele e' sintetizado.
   *
   * ## A diferenca para o `emitirFala`
   *
   * O `emitirFala` recebe o PCM **inteiro** e o entrega em frames de 60 ms. Aqui
   * o TTS chama de volta a cada bloco decodificado, e o bloco entra na MESMA
   * fila — entao a fala comeca no 1o bloco (medido: ~700 ms) em vez de esperar
   * a sintese inteira. O bombeamento continua a 60 ms por frame, para o motor
   * nao receber rajada (ele descarta o mais antigo se o buffer estourar).
   *
   * O BARGE-IN continua valendo: enquanto a fila esvazia, `receberAudio` pode
   * chamar `abortarFala()`, que zera a fila e derruba o bombeamento.
   *
   * @param {string} texto
   */
  async emitirFalaStream(texto) {
    this.fila = [];
    this.falando = true;
    this.framesBarge = 0;

    // Bombeamento continuo: enquanto houver frame na fila, entrega um a cada
    // 60 ms (o ritmo do motor). Ele NAO termina quando a fila esvazia — a
    // sintese pode ainda estar produzindo; termina quando o `sintetizarStream`
    // resolve E a fila drena.
    let sinteseTerminou = false;
    const bombeamento = new Promise((resolve) => {
      const entregar = () => {
        if (!this.ativo || !this.falando) {
          clearInterval(this.timerFila);
          this.timerFila = null;
          resolve();
          return;
        }
        const frame = this.fila.shift();
        if (frame) {
          try { this.falar(frame); } catch (e) {
            this.log('falha ao falar', { grupo: this.grupo, erro: e?.message || String(e) });
          }
          return;
        }
        // Fila vazia: se a sintese acabou, encerra; senao, espera o proximo bloco.
        if (sinteseTerminou) {
          clearInterval(this.timerFila);
          this.timerFila = null;
          this.falando = false;
          resolve();
        }
      };
      this.timerFila = setInterval(entregar, 60);
      this.timerFila.unref?.();
      entregar();
    });

    // Cada bloco de PCM do TTS entra na fila (reagrupado no tamanho do motor).
    const aoBloco = (pcm) => {
      if (!this.ativo || !this.falando) return;
      for (let i = 0; i < pcm.length; i += AMOSTRAS_POR_FRAME) {
        const fatia = pcm.subarray(i, Math.min(i + AMOSTRAS_POR_FRAME, pcm.length));
        if (fatia.length) this.fila.push(Float32Array.from(fatia));
      }
      if (this.fila.length > FILA_MAX) this.fila = this.fila.slice(-FILA_MAX);
    };

    try {
      const r = await this.sintetizarStream(texto, aoBloco);
      if (!r?.ok) this.log('tts sem audio', { grupo: this.grupo, motivo: r?.motivo });
    } catch (e) {
      this.log('falha no tts em fluxo', { grupo: this.grupo, erro: e?.message || String(e) });
    }
    sinteseTerminou = true;
    // Garante que o bombeamento veja o fim (o intervalo pode estar num tick).
    if (!this.fila.length && this.falando) {
      clearInterval(this.timerFila);
      this.timerFila = null;
      this.falando = false;
    }
    await bombeamento;
  }

  /** Aborta a fala em curso (barge-in / desligar). */
  abortarFala() {
    this.falando = false;
    this.framesBarge = 0;
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

  /**
   * Entrega um frame de audio ao agente do grupo (no-op se nao houver).
   *
   * @param {string} grupo
   * @param {Float32Array} pcm
   * @param {string} [quemFalou] JID de quem falou (o motor manda no audio por
   *   participante). E' o que permite a guarda de permissao.
   */
  receber(grupo, pcm, quemFalou = null) {
    const agente = this.agentes.get(grupo);
    if (!agente) return false;
    agente.receberAudio(pcm, quemFalou);
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
