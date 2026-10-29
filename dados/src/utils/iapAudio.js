/**
 * Primitivas de audio do `!iap` (agente de voz na call).
 *
 * ## Por que existe
 *
 * O motor de call (`@zapo-js/voip`) troca audio em **`Float32Array` mono a
 * 16 kHz** -- tanto o que ele entrega (`voip_call_inbound_audio`) quanto o que
 * ele aceita (`feedLiveAudio`). O resto do mundo (Gemini, edge-tts, Piper)
 * fala WAV/MP3/OGG. Este modulo e' a fronteira entre os dois mundos:
 *
 *   - `pcmParaWav` / `wavParaPcm` -- conversao pura, sem I/O;
 *   - `resamplePcm` -- muda a taxa com o `ffmpeg` do sistema (soxr);
 *   - `DetectorDeFala` -- VAD por energia (RMS), sem dependencia externa.
 *
 * ## O VAD e' simples DE PROPOSITO
 *
 * Um VAD neural (Silero/webrtc) traria um modelo a mais para distribuir e
 * erraria igual em grupo barulhento. O que funciona aqui e' **energia RMS com
 * histerese**: entra em "falando" acima do limiar e so' fecha a frase depois de
 * um silencio continuo. O limiar e' configuravel porque o ruido de fundo varia
 * por grupo.
 */

import { spawn } from 'child_process';

/** Taxa do motor de call (a mesma do `callAudioPrep.js`). */
export const TAXA_MOTOR = 16000;

/** ffmpeg do sistema (mesmo caminho do resto do bot). */
function binarioFfmpeg() {
  return process.env.FFMPEG_PATH || 'ffmpeg';
}

/**
 * Converte PCM float (-1..1) em um WAV 16-bit mono.
 *
 * @param {Float32Array} pcm
 * @param {number} [taxa] taxa de amostragem do PCM
 * @returns {Buffer} arquivo WAV completo (com cabecalho)
 */
export function pcmParaWav(pcm, taxa = TAXA_MOTOR) {
  const amostras = pcm instanceof Float32Array ? pcm : Float32Array.from(pcm || []);
  const dados = Buffer.alloc(amostras.length * 2);
  for (let i = 0; i < amostras.length; i++) {
    // Clamp antes de converter: acima de 1.0 o int16 daria wrap-around (estalo).
    const v = Math.max(-1, Math.min(1, amostras[i] || 0));
    dados.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  const cabecalho = Buffer.alloc(44);
  cabecalho.write('RIFF', 0);
  cabecalho.writeUInt32LE(36 + dados.length, 4);
  cabecalho.write('WAVE', 8);
  cabecalho.write('fmt ', 12);
  cabecalho.writeUInt32LE(16, 16);        // tamanho do bloco fmt
  cabecalho.writeUInt16LE(1, 20);         // PCM
  cabecalho.writeUInt16LE(1, 22);         // mono
  cabecalho.writeUInt32LE(taxa, 24);
  cabecalho.writeUInt32LE(taxa * 2, 28);  // bytes por segundo
  cabecalho.writeUInt16LE(2, 32);         // alinhamento do bloco
  cabecalho.writeUInt16LE(16, 34);        // bits por amostra
  cabecalho.write('data', 36);
  cabecalho.writeUInt32LE(dados.length, 40);
  return Buffer.concat([cabecalho, dados]);
}

/**
 * Le um WAV 16-bit mono e devolve o PCM como `Float32Array`.
 *
 * Aceita qualquer taxa (o chamador resampleia depois). Rejeita o que nao for
 * WAV PCM 16-bit -- devolver lixo seria pior que falhar.
 *
 * @param {Buffer} buffer
 * @returns {{ pcm: Float32Array, taxa: number }}
 */
export function wavParaPcm(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 44) {
    throw new Error('wav invalido');
  }
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('nao e um WAV');
  }
  // Varre os chunks ate' achar `fmt ` e `data` (nem todo WAV poe `fmt ` em 12).
  let pos = 12;
  let taxa = TAXA_MOTOR;
  let canais = 1;
  let bits = 16;
  let inicioDados = -1;
  let tamanhoDados = 0;
  while (pos + 8 <= buffer.length) {
    const id = buffer.toString('ascii', pos, pos + 4);
    const tamanho = buffer.readUInt32LE(pos + 4);
    const corpo = pos + 8;
    if (id === 'fmt ') {
      canais = buffer.readUInt16LE(corpo + 2);
      taxa = buffer.readUInt32LE(corpo + 4);
      bits = buffer.readUInt16LE(corpo + 14);
    } else if (id === 'data') {
      inicioDados = corpo;
      tamanhoDados = Math.min(tamanho, buffer.length - corpo);
      break;
    }
    pos = corpo + tamanho + (tamanho % 2); // chunks sao alinhados a 2 bytes
  }
  if (inicioDados < 0) throw new Error('WAV sem bloco de dados');
  if (bits !== 16) throw new Error(`WAV de ${bits} bits nao suportado`);
  const bytesPorAmostra = 2;
  const totalAmostras = Math.floor(tamanhoDados / (bytesPorAmostra * canais));
  const pcm = new Float32Array(totalAmostras);
  for (let i = 0; i < totalAmostras; i++) {
    pcm[i] = buffer.readInt16LE(inicioDados + i * bytesPorAmostra * canais) / 32768;
  }
  return { pcm, taxa };
}

/**
 * Reamostra PCM float para outra taxa, com o `ffmpeg` do sistema (soxr).
 *
 * Best-effort: sem ffmpeg devolve `null` e o chamador decide o que fazer.
 * O PCM entra e sai por pipe -- nada toca o disco.
 *
 * @param {Float32Array} pcm
 * @param {number} taxaEntrada
 * @param {number} taxaSaida
 * @returns {Promise<Float32Array|null>}
 */
export function resamplePcm(pcm, taxaEntrada, taxaSaida) {
  if (!(pcm instanceof Float32Array) || pcm.length === 0) return Promise.resolve(null);
  if (taxaEntrada === taxaSaida) return Promise.resolve(pcm);

  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(binarioFfmpeg(), [
        '-hide_banner', '-loglevel', 'error',
        '-f', 'f32le', '-ar', String(taxaEntrada), '-ac', '1', '-i', 'pipe:0',
        '-f', 'f32le', '-ar', String(taxaSaida), '-ac', '1', 'pipe:1'
      ], { stdio: ['pipe', 'pipe', 'ignore'] });
    } catch {
      resolve(null);
      return;
    }

    const pedacos = [];
    let terminou = false;
    const encerrar = (valor) => {
      if (terminou) return;
      terminou = true;
      clearTimeout(timer);
      resolve(valor);
    };
    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch { /* ok */ }
      encerrar(null);
    }, 30000);

    proc.on('error', () => encerrar(null));
    proc.stdout.on('data', (d) => pedacos.push(d));
    proc.stdout.on('end', () => {
      const bruto = Buffer.concat(pedacos);
      // f32le: 4 bytes por amostra. Se o resto nao for multiplo de 4, corta o
      // ultimo pedaco parcial em vez de desalinhar tudo.
      const n = Math.floor(bruto.length / 4);
      const saida = new Float32Array(n);
      for (let i = 0; i < n; i++) saida[i] = bruto.readFloatLE(i * 4);
      encerrar(saida.length ? saida : null);
    });

    try {
      proc.stdin.on('error', () => { /* EPIPE quando o ffmpeg morre */ });
      proc.stdin.end(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
    } catch {
      encerrar(null);
    }
  });
}

/** RMS de um bloco PCM (0..1). Serve de energia para o VAD. */
export function rms(pcm) {
  if (!pcm || !pcm.length) return 0;
  let soma = 0;
  for (let i = 0; i < pcm.length; i++) {
    const v = pcm[i];
    soma += v * v;
  }
  return Math.sqrt(soma / pcm.length);
}

/**
 * Detector de fala (VAD) por energia, com histerese.
 *
 * Recebe frames de PCM e devolve o que fazer com cada um:
 *
 *   - `'inicio'` -- este frame ABRIU uma frase (guardar);
 *   - `'meio'`   -- frase em andamento (guardar);
 *   - `'fim'`    -- este frame FECHOU a frase (guardar e mandar o conjunto);
 *   - `'nada'`   -- silencio (descartar).
 *
 * O `silencioMs` e' o que evita cortar a frase na respiracao; o
 * `falaMinimaMs` descarta estalos curtos (tosse, porta batendo).
 */
export class DetectorDeFala {
  constructor({ limiarRms = 0.012, silencioMs = 700, falaMinimaMs = 250, falaMaximaMs = 20000 } = {}) {
    this.limiarRms = limiarRms;
    this.silencioMs = silencioMs;
    this.falaMinimaMs = falaMinimaMs;
    this.falaMaximaMs = falaMaximaMs;
    this.reset();
  }

  /** Volta ao estado inicial (sem fala em andamento). */
  reset() {
    this.falando = false;
    this.msFala = 0;
    this.msSilencio = 0;
  }

  /**
   * Classifica um frame.
   *
   * @param {Float32Array} pcm
   * @param {number} [msPorFrame] duracao do frame; calculada do tamanho se omitida
   * @returns {'inicio'|'meio'|'fim'|'nada'}
   */
  processar(pcm, msPorFrame) {
    const ms = msPorFrame ?? (pcm && pcm.length ? (pcm.length / TAXA_MOTOR) * 1000 : 60);
    const energia = rms(pcm);

    if (energia >= this.limiarRms) {
      const eraSilencio = !this.falando;
      this.falando = true;
      this.msFala += ms;
      this.msSilencio = 0;
      // Fala continua demais: fecha a frase para o agente nao ficar surdo numa
      // fala sem pausa (o teto tambem existe no motor).
      if (this.msFala >= this.falaMaximaMs) {
        this.reset();
        return 'fim';
      }
      return eraSilencio ? 'inicio' : 'meio';
    }

    if (!this.falando) return 'nada';

    // Silencio DENTRO de uma frase: ainda pode ser respiracao.
    this.msSilencio += ms;
    if (this.msSilencio >= this.silencioMs) {
      const curta = this.msFala < this.falaMinimaMs;
      this.reset();
      return curta ? 'nada' : 'fim';
    }
    return 'meio';
  }
}
