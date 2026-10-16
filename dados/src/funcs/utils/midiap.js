/**
 * `!midiap` — transmissao de TELA na call, com um video.
 *
 * ## O que faz
 *
 * Responde um video com o comando e o bot passa a exibi-lo como
 * **transmissao de tela** na call do grupo. Roda UMA vez e para.
 *
 * ## O caminho (cada peca medida nos pacotes)
 *
 * 1. `requestVideoUpgrade(callId)` — numa call de GRUPO quem responde e' o
 *    **servidor**, nao uma pessoa: `accepted` significa que a call virou video
 *    com a nossa camera ligada. Nao ha "recusa humana".
 * 2. `setScreenShare(callId, true)` — troca a camera pela tela no stream de
 *    video da call (a doc: *"the screen replaces the camera"*). Nao e' um
 *    segundo stream.
 * 3. `feedLiveVideo(callId, accessUnit, timestampUs)` — alimenta cada frame.
 *
 * ## De onde vem o H.264
 *
 * O pacote NAO codifica video no Node (o sender dele e' WebCodecs, so
 * navegador). A codificacao vem do **ffmpeg**, com o perfil que o pacote exige
 * (`avc1.42E01F` = Constrained Baseline 3.1) e Annex-B. O `screenShare.js`
 * parte esse fluxo em access units.
 *
 * ## O pacing
 *
 * O ffmpeg roda com `-re`: le na taxa nativa, entao os bytes chegam no tempo da
 * reproducao. Mesmo assim o buffer do motor e' checado (`getLiveBufferMs`)
 * antes de cada frame — se encheu, o frame e' descartado (melhor perder um
 * quadro que estourar o buffer).
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { criarSplitter } from '../../utils/screenShare.js';
import { DATABASE_DIR } from '../../utils/paths.js';

/** Perfil/level que o pacote anuncia (H264_CONSTRAINED_BASELINE_CODEC). */
const PERFIL = 'baseline';
const NIVEL = '3.1';

/** Largura maxima (o pacote corta em 1280x720 para caber no level). */
const MAX_LARGURA = 1280;
const MAX_ALTURA = 720;

/** Alvo de quadros por segundo (o mesmo padrao do sender do pacote). */
const FPS = Number.parseInt(process.env.MIDIAP_FPS || '15', 10);

/** Quanto esperar o `requestVideoUpgrade` (o guard timer do pacote e' 5 s). */
const TIMEOUT_UPGRADE_MS = 8000;

/** Streams ativos por grupo (o `!midiap parar` derruba). */
const ativos = new Map();

/** Duble para os testes do bot (nao carrega ffmpeg nem motor). */
let duble = null;
export function __setDuble(novo) { duble = novo; }

/**
 * Seam de TESTE para o cliente `voip`.
 *
 * O teste nao pode trocar `callMedia.obterVoip` (o ESM proibe reatribuir
 * export). Esta porta deixa injetar o cliente direto, do mesmo jeito que o
 * `setGeminiHttpForTest` do modulo de IA faz.
 */
let voipDeTeste = null;
export function __setVoip(novo) { voipDeTeste = novo; }

/** ffmpeg do sistema. */
function binario() {
  return process.env.FFMPEG_PATH || 'ffmpeg';
}

/** O backend de midia (o mesmo que o `!callp` usa). */
async function backend() {
  const m = await import('./callMedia.js');
  return m;
}

/**
 * Roda a transmissao: upgrade -> screen share -> alimenta os frames.
 *
 * @param {object} p
 * @param {string} p.grupo
 * @param {string} p.callId
 * @param {string} p.arquivo caminho do video
 * @param {(msg: string) => void} [p.log]
 * @returns {Promise<{ok: boolean, motivo?: string, detalhe?: string, frames?: number}>}
 */
export async function transmitir({ grupo, callId, arquivo, log = () => {} }) {
  if (duble) return duble.transmitir({ grupo, callId, arquivo, log });

  if (!grupo || !callId) return { ok: false, motivo: 'sem_call' };
  if (!arquivo || !fs.existsSync(arquivo)) return { ok: false, motivo: 'arquivo_ausente' };
  if (ativos.has(grupo)) return { ok: false, motivo: 'ja_transmitindo' };
  // RESERVA o grupo ANTES de qualquer I/O: o upgrade e' assincrono e leva
  // segundos, entao duas chamadas simultaneas passariam pelo guarda e as
  // duas ligariam o screen share (foi o que o teste de concorrencia pegou).
  ativos.set(grupo, { proc: null, parado: false, frames: 0 });

  const cli = voipDeTeste || await (async () => {
    const midia = await backend();
    return midia.obterVoip?.();
  })();
  if (!cli) {
    ativos.delete(grupo);
    return { ok: false, motivo: 'pacote_de_midia_ausente' };
  }

  const estado = ativos.get(grupo);
  try {
    // 1) a call precisa estar em VIDEO antes do screen share.
    let r;
    try {
      r = await comTimeout(cli.requestVideoUpgrade(callId), TIMEOUT_UPGRADE_MS);
      log(`upgrade: ${r}`);
    } catch (e) {
      return { ok: false, motivo: 'upgrade_falhou', detalhe: e?.message || String(e) };
    }
    if (r !== 'accepted') {
      return { ok: false, motivo: 'upgrade_' + (r || 'sem_resposta') };
    }

    // 2) troca a camera pela tela.
    try {
      await cli.setScreenShare(callId, true);
    } catch (e) {
      return { ok: false, motivo: 'screenshare_falhou', detalhe: e?.message || String(e) };
    }

    // 3) ffmpeg -> access units -> feedLiveVideo
    await alimentar({ cli, callId, arquivo, estado, log });
    return { ok: true, frames: estado.frames };
  } catch (e) {
    return { ok: false, motivo: 'falha_na_transmissao', detalhe: e?.message || String(e) };
  } finally {
    ativos.delete(grupo);
    try { await cli.setScreenShare(callId, false); } catch { /* best-effort */ }
    try { await cli.setVideoEnabled(callId, false); } catch { /* best-effort */ }
  }
}

/**
 * Bombeia o video do ffmpeg para o motor.
 *
 * O `-re` faz o ffmpeg entregar no tempo da reproducao; o timestamp vem do
 * relogio real, que e' o que o motor espera (microssegundos).
 */
async function alimentar({ cli, callId, arquivo, estado, log }) {
  const inicio = Date.now();
  const splitter = criarSplitter();

  await new Promise((resolve, reject) => {
    const args = [
      '-hide_banner', '-loglevel', 'error',
      '-re',                                  // le na taxa nativa (pacing)
      '-i', arquivo,
      '-an',                                  // sem audio (a call ja' toca musica)
      '-c:v', 'libx264',
      '-profile:v', PERFIL, '-level', NIVEL,  // avc1.42E01F
      '-pix_fmt', 'yuv420p',
      '-x264-params', 'annexb=1',             // Annex-B (start codes)
      '-preset', 'veryfast', '-tune', 'zerolatency',
      '-g', String(FPS * 2),                  // keyframe a cada 2 s
      '-vf', `scale='min(${MAX_LARGURA},iw)':'min(${MAX_ALTURA},ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2`,
      '-f', 'h264', 'pipe:1'
    ];

    let proc;
    try {
      proc = spawn(binario(), args, { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (e) {
      reject(e);
      return;
    }
    estado.proc = proc;

    proc.stdout.on('data', (chunk) => {
      if (estado.parado) return;
      let aus;
      try { aus = splitter.push(chunk); } catch { return; }
      for (const au of aus) enviarFrame(cli, callId, au, inicio, estado, log);
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      // Fecha o ultimo access unit retido.
      try {
        for (const au of splitter.flush()) {
          enviarFrame(cli, callId, au, inicio, estado, log);
        }
      } catch { /* ok */ }
      if (code === 0 || estado.parado) resolve();
      else reject(new Error('ffmpeg saiu com ' + code));
    });
  });
}

/** Envia um access unit, respeitando o backpressure do motor. */
function enviarFrame(cli, callId, au, inicio, estado, log) {
  try {
    // Backpressure: se o buffer do motor encheu, descarta o quadro. Melhor
    // perder um quadro que estourar (o motor reinicia o stream no keyframe).
    const bufferizado = cli.getLiveBufferMs?.(callId);
    const { pauseMs } = cli.getFeedWatermarksMs?.() || {};
    if (typeof bufferizado === 'number' && typeof pauseMs === 'number'
        && bufferizado >= pauseMs) {
      return;
    }
    const ts = Math.round((Date.now() - inicio) * 1000); // microssegundos
    const pacotes = cli.feedLiveVideo(callId, au, ts);
    if (pacotes > 0) estado.frames++;
  } catch (e) {
    log('feedLiveVideo: ' + (e?.message || e));
  }
}

/** Para a transmissao de um grupo (o `!midiap parar`). */
export function parar(grupo) {
  if (duble) return duble.parar(grupo);
  const estado = ativos.get(grupo);
  if (!estado) return { ok: false, motivo: 'nao_esta_transmitindo' };
  estado.parado = true;
  try { estado.proc?.kill('SIGKILL'); } catch { /* ok */ }
  ativos.delete(grupo);
  return { ok: true };
}

/** Esta transmitindo neste grupo? */
export function transmitindo(grupo) {
  return ativos.has(grupo);
}

/** Corrida com teto de tempo (o upgrade tem guard timer do proprio pacote). */
function comTimeout(promessa, ms) {
  return Promise.race([
    promessa,
    new Promise((resolve) => setTimeout(() => resolve(null), ms))
  ]);
}

/**
 * Caminho do cache para o video baixado.
 *
 * Fica no MESMO cache do audio (`call-cache/`), que o `!atualizar` ja'
 * pula no backup. O video e' descartavel: sai no fim da transmissao.
 *
 * @param {string} grupo
 * @param {string} [ext]
 * @returns {string}
 */
export function caminhoDoVideo(grupo, ext = '.mp4') {
  const raiz = process.env.CALL_CACHE_DIR || path.join(DATABASE_DIR, 'call-cache');
  const dir = path.join(raiz, 'midiap');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}${ext}`);
}
