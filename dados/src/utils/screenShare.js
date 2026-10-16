/**
 * Transmissao de tela na call: H.264 do ffmpeg -> access units -> motor.
 *
 * ## Por que existe
 *
 * O `!midiap` compartilha a tela na call com um video. O pacote de midia
 * (`@zapo-js/voip`) NAO codifica H.264 no Node -- o sender dele usa o
 * `VideoEncoder` do WebCodecs, que so existe em navegador. Ele apenas
 * **empacota** H.264 ja pronto (`packetizeH264Frame`) e o entrega ao motor por
 * `feedLiveVideo(callId, accessUnit, timestampUs)`.
 *
 * Entao a codificacao vem do **ffmpeg** (que o bot ja exige) e o trabalho daqui
 * e' o que falta no meio: partir o fluxo Annex-B em ACCESS UNITS e alimentar o
 * motor no ritmo da reproducao.
 *
 * ## O que e' um access unit (e por que precisa separar)
 *
 * O ffmpeg escreve um fluxo Annex-B continuo, onde cada NAL comeca com um
 * start code (`00 00 01` ou `00 00 00 01`). O motor, porem, quer **um access
 * unit por chamada** -- e um access unit e' um FRAME: os NALs de configuracao
 * (SPS/PPS) e/ou SEI que o precedem, mais os NALs de slice do frame.
 *
 * A regra de corte e' a mesma que o x264 produz: um novo access unit comeca
 * quando aparece um slice depois de um slice, ou SPS/PPS/AUD/SEI depois de um
 * slice (o x264 repete SPS/PPS antes de cada keyframe). Sem esse corte, o motor
 * receberia varios frames num pacote so.
 *
 * ## O ritmo (pacing)
 *
 * O ffmpeg roda com `-re` (le na taxa nativa), entao os bytes chegam no tempo
 * da reproducao e o timestamp e' o relogio real. Sem `-re`, o ffmpeg
 * despejaria o arquivo inteiro de uma vez e o buffer do motor estouraria.
 */

/** Tipos de NAL (o byte depois do start code, mascarado com 0x1f). */
const SLICE_MIN = 1;
const SLICE_MAX = 5;
const NAL_SEI = 6;
const NAL_SPS = 7;
const NAL_PPS = 8;
const NAL_AUD = 9;

/** O tipo do NAL a partir do byte que segue o start code. */
export function tipoNal(byte) {
  return byte & 0x1f;
}

/** `true` quando o NAL e' um slice (o que carrega a imagem do frame). */
export function ehSlice(byte) {
  const t = tipoNal(byte);
  return t >= SLICE_MIN && t <= SLICE_MAX;
}

/**
 * Acha os start codes do fluxo Annex-B.
 *
 * @param {Buffer|Uint8Array} buf
 * @returns {{at: number, len: number}[]} posicao e tamanho (3 ou 4) de cada um
 */
export function acharStartCodes(buf) {
  const pos = [];
  const n = buf.length;
  for (let i = 0; i + 3 <= n; i++) {
    if (buf[i] !== 0 || buf[i + 1] !== 0) continue;
    if (buf[i + 2] === 1) {
      pos.push({ at: i, len: 3 });
      i += 2;
      continue;
    }
    if (i + 4 <= n && buf[i + 2] === 0 && buf[i + 3] === 1) {
      pos.push({ at: i, len: 4 });
      i += 3;
    }
  }
  return pos;
}

/**
 * Splitter INCREMENTAL de access units.
 *
 * O ultimo NAL fica retido ate' o proximo chegar (so' assim da' para saber onde
 * ele termina) -- e' o custo normal de um splitter de fluxo. No `flush` ele sai.
 *
 * @returns {{push: (chunk: Buffer|Uint8Array) => Buffer[], flush: () => Buffer[]}}
 */
export function criarSplitter() {
  /** Bytes ainda nao consumidos (pode ter um start code partido no fim). */
  let sobra = Buffer.alloc(0);
  /** NALs do access unit em formacao. */
  let atual = [];
  /** Ja' vimos um slice no access unit atual? */
  let temSlice = false;

  const fechar = () => {
    if (!atual.length) return null;
    const au = Buffer.concat(atual);
    atual = [];
    temSlice = false;
    return au;
  };

  /** Absorve um NAL; devolve o access unit que ele fechou (ou null). */
  const absorver = (nal, header) => {
    const tipo = tipoNal(header);
    const delimita = temSlice
      && (ehSlice(header) || tipo === NAL_SPS || tipo === NAL_PPS
        || tipo === NAL_AUD || tipo === NAL_SEI);
    const fechado = delimita ? fechar() : null;
    atual.push(nal);
    if (ehSlice(header)) temSlice = true;
    return fechado;
  };

  return {
    push(chunk) {
      sobra = sobra.length ? Buffer.concat([sobra, chunk]) : Buffer.from(chunk);
      const prontos = [];
      // Preciso de DOIS start codes para saber onde o primeiro NAL termina.
      for (;;) {
        const scs = acharStartCodes(sobra);
        if (scs.length < 2) break;
        const sc = scs[0];
        const proximo = scs[1];
        const nal = Buffer.from(sobra.subarray(sc.at, proximo.at));
        const fechado = absorver(nal, sobra[sc.at + sc.len]);
        if (fechado) prontos.push(fechado);
        sobra = sobra.subarray(proximo.at);
      }
      return prontos;
    },

    flush() {
      const prontos = [];
      const scs = acharStartCodes(sobra);
      for (let k = 0; k < scs.length; k++) {
        const sc = scs[k];
        const fim = k + 1 < scs.length ? scs[k + 1].at : sobra.length;
        const nal = Buffer.from(sobra.subarray(sc.at, fim));
        const fechado = absorver(nal, sobra[sc.at + sc.len]);
        if (fechado) prontos.push(fechado);
      }
      const ultimo = fechar();
      if (ultimo) prontos.push(ultimo);
      sobra = Buffer.alloc(0);
      return prontos;
    }
  };
}

/**
 * Separa um buffer Annex-B COMPLETO em access units (conveniencia/teste).
 *
 * @param {Buffer|Uint8Array} buf
 * @returns {Buffer[]} um buffer por frame (start codes preservados)
 */
export function dividirAccessUnits(buf) {
  const s = criarSplitter();
  return s.push(buf).concat(s.flush());
}
