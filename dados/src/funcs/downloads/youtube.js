/**
 * YouTube - Implementação própria (sem VexAPI)
 *
 * Conteúdo público, sem login, sem bypass de autenticação/CAPTCHA/anti-bot.
 *
 * - search(query): usa a dependência já existente do projeto, `yt-search`
 *   (scraping da página pública de resultados do YouTube).
 *
 * - mp3(url, bitrate=128) / mp4(url, quality=360): download LOCAL via
 *   executável `yt-dlp` no próprio servidor (sem API externa, sem endpoint
 *   de terceiros, sem youtubei/v1/player). O yt-dlp gerencia formatos,
 *   URLs temporárias, headers e seleção de áudio/vídeo; o FFmpeg do
 *   sistema faz a conversão para MP3 e a fusão/remux para MP4.
 *
 * Instalação do yt-dlp no servidor (não requer root):
 *   python3 -m pip install -U yt-dlp
 *   # ou baixar o binário oficial de https://github.com/yt-dlp/yt-dlp/releases
 * Caminho customizado: defina YTDLP_PATH (ex.: /home/container/.local/bin/yt-dlp).
 * Fallbacks automáticos: yt-dlp no PATH → `python3 -m yt_dlp` → `python -m yt_dlp`.
 * FFmpeg: FFMPEG_PATH (já usado pelo bot) ou `ffmpeg` no PATH.
 *
 * Formato de retorno preservado (idêntico ao módulo original):
 *   search → { ok, data: { videoId, url, title, description, thumbnail,
 *              seconds, timestamp, views, ago, author } } | { ok:false, msg }
 *   mp3/mp4 → { ok, buffer, title, thumbnail, filename } | { ok:false, msg }
 */

import yts from 'yt-search';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const MAX_BYTES = 256 * 1024 * 1024;
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const YTDLP_TIMEOUT = parseInt(process.env.YTDLP_TIMEOUT_MS, 10) || 180000; // 180s padrão
const PROBE_TIMEOUT = 15000;

// ---------- processo filho com timeout real (spawn, args separados) ----------

function runProcess(cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    // detached (Linux): o filho vira líder de grupo de processos, permitindo
    // matar o yt-dlp E seus filhos (ffmpeg etc.) no timeout.
    const detached = process.platform !== 'win32';
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], detached });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => {
      if (stdout.length < 4_000_000) stdout += d;
    });
    child.stderr.on('data', d => {
      if (stderr.length < 64_000) stderr += d;
    });
    const timer = setTimeout(() => {
      try {
        if (detached && child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        try { child.kill('SIGKILL'); } catch { /* já morto */ }
      }
      const err = new Error('Download expirou (timeout)');
      err.stderr = stderr;
      reject(err);
    }, timeoutMs);
    child.on('error', err => {
      clearTimeout(timer);
      reject(err); // ENOENT etc. — tratado por quem chamou
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) return resolve({ stdout, stderr });
      const err = new Error(mapYtDlpError(stderr));
      err.stderr = stderr;
      reject(err);
    });
  });
}

// ---------- disponibilidade das ferramentas ----------
// Sucesso é cacheado; falha NÃO é cacheada (se o usuário instalar a ferramenta
// com o bot rodando, a próxima tentativa já funciona).

let ytdlpResolved; // undefined = não testado | null = indisponível | { cmd, base }
async function checkYtDlp() {
  if (ytdlpResolved) return ytdlpResolved;
  const candidates = [];
  if (process.env.YTDLP_PATH) candidates.push({ cmd: process.env.YTDLP_PATH, base: [] });
  candidates.push({ cmd: 'yt-dlp', base: [] });
  // Caminhos absolutos comuns de instalação userspace (pip --user / pipx), comuns em
  // ambientes Pterodactyl/hostiles onde o PATH do processo Node não inclui ~/.local/bin.
  const home = os.homedir();
  candidates.push({ cmd: `${home}/.local/bin/yt-dlp`, base: [] });
  candidates.push({ cmd: '/home/container/.local/bin/yt-dlp', base: [] });
  candidates.push({ cmd: '/root/.local/bin/yt-dlp', base: [] });
  candidates.push({ cmd: '/usr/local/bin/yt-dlp', base: [] });
  candidates.push({ cmd: 'python3', base: ['-m', 'yt_dlp'] });
  candidates.push({ cmd: 'python', base: ['-m', 'yt_dlp'] });
  candidates.push({ cmd: '/usr/bin/python3', base: ['-m', 'yt_dlp'] });
  for (const c of candidates) {
    try {
      await runProcess(c.cmd, [...c.base, '--version'], PROBE_TIMEOUT);
      ytdlpResolved = c;
      return c;
    } catch {
      /* ignora; tenta o próximo candidato */
    }
  }
  ytdlpResolved = null;
  return null;
}

let ffmpegPath; // undefined = não testado | string indicando CAMINHO válido
async function checkFfmpeg() {
  if (ffmpegPath) return ffmpegPath;
  const candidates = [FFMPEG];
  if (!process.env.FFMPEG_PATH) {
    const home = os.homedir();
    candidates.push(`${home}/.local/bin/ffmpeg`, '/home/container/.local/bin/ffmpeg', '/root/.local/bin/ffmpeg', '/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg');
  }
  for (const cmd of candidates) {
    try {
      await runProcess(cmd, ['-version'], PROBE_TIMEOUT);
      ffmpegPath = cmd;
      return cmd;
    } catch {
      /* ignora */
    }
  }
  return null; // não cacheia falha (instalação futura deve ser detectada)
}

// yt-dlp precisa saber onde está o FFmpeg quando ele não é o `ffmpeg` do PATH
async function ffmpegLocationArgs() {
  const f = await checkFfmpeg();
  return f && f !== 'ffmpeg' ? ['--ffmpeg-location', f] : [];
}

// ---------- erros do yt-dlp → mensagens controladas ----------

function mapYtDlpError(stderr) {
  const s = String(stderr || '');
  if (/Video unavailable|This video is not available/i.test(s)) return 'Vídeo indisponível.';
  if (/Private video/i.test(s)) return 'Vídeo privado.';
  if (/Sign in to confirm your age|age-restricted|inappropriate for some users/i.test(s))
    return 'Vídeo com restrição de idade.';
  if (/not a bot|HTTP Error 429|Too Many Requests|HTTP Error 403/i.test(s))
    return 'YouTube bloqueou temporariamente esta solicitação. Tente novamente em alguns minutos.';
  if (/File is larger than max-filesize/i.test(s)) return 'Arquivo muito grande para baixar.';
  if (/Requested format is not available/i.test(s)) return 'Formato indisponível para este vídeo.';
  if (/Unsupported URL|is not a valid URL/i.test(s)) return 'URL do YouTube inválida.';
  const lastError = s
    .split('\n')
    .map(l => l.trim())
    .filter(l => /^ERROR:/i.test(l))
    .pop();
  if (lastError) return lastError.replace(/^ERROR:\s*/i, '').slice(0, 180);
  return 'Falha no yt-dlp.';
}

// ---------- extração de ID/URL ----------

// Aceita watch?v=, youtu.be/, /shorts/, /live/, /v/, /embed/, music.youtube.com.
function extractVideoId(url) {
  const m = String(url || '').match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/|v\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/
  );
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]{11}$/.test(String(url || '').trim())) return String(url).trim();
  return null;
}

// ---------- helpers ----------

function sanitizeBitrate(v) {
  const n = parseInt(v, 10);
  if (Number.isFinite(n) && n >= 32 && n <= 320) return n;
  return 128;
}

function sanitizeQuality(v) {
  const n = parseInt(v, 10);
  if (Number.isFinite(n) && n >= 144 && n <= 2160) return n;
  return 360;
}

function safeFilename(base, ext) {
  const name = String(base || '')
    .normalize('NFKC')
    .replace(/[\\/]+/g, ' ')
    .replace(/\.{2,}/g, ' ')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/[^\p{L}\p{N}\s_.-]/gu, '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .slice(0, 80)
    .trim();
  return `${name || 'audio'}.${ext}`;
}

// --print-json imprime o info dict (uma linha JSON) no stdout
function parsePrintJson(stdout) {
  for (const line of String(stdout || '').split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    try {
      return JSON.parse(t);
    } catch {
      /* ignora linhas parciais */
    }
  }
  return null;
}

// Lê o arquivo final do diretório temporário com proteção de tamanho.
function readOutputFile(dir, ext) {
  const file = fs
    .readdirSync(dir)
    .filter(f => f.endsWith(`.${ext}`))
    .map(f => path.join(dir, f))
    .sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0];
  if (!file) throw new Error('Arquivo de saída não foi gerado.');
  const size = fs.statSync(file).size;
  if (size > MAX_BYTES) throw new Error('Arquivo muito grande para baixar.');
  if (size === 0) throw new Error('Arquivo baixado está vazio.');
  return fs.readFileSync(file);
}

// Download local via yt-dlp: ele mesmo baixa e chama o FFmpeg.
async function ytdlpDownload(videoId, extraArgs, outTemplate) {
  const ytdlp = await checkYtDlp();
  if (!ytdlp) throw new Error('yt-dlp não está instalado no servidor. (python3 -m pip install -U yt-dlp)');
  if (!(await checkFfmpeg())) throw new Error('FFmpeg não encontrado no sistema.');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-'));
  try {
    const args = [
      ...ytdlp.base,
      '--no-playlist',
      '--no-warnings',
      '--no-progress',
      '--socket-timeout',
      '30',
      '--max-filesize',
      String(MAX_BYTES),
      ...extraArgs,
      ...(await ffmpegLocationArgs()),
      '-o',
      path.join(dir, outTemplate),
      '--print-json',
      `https://www.youtube.com/watch?v=${videoId}`
    ];
    const { stdout } = await runProcess(ytdlp.cmd, args, YTDLP_TIMEOUT).catch(err => {
      if (err.stderr) console.error('[youtube] yt-dlp stderr:', err.stderr.slice(-500));
      else console.error('[youtube] yt-dlp falhou:', err.message);
      throw err;
    });
    return { dir, meta: parsePrintJson(stdout) };
  } catch (err) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw err;
  }
}

// ---------- search (yt-search, dependência já existente) ----------

async function search(query) {
  try {
    const r = await yts(String(query || ''));
    const video = r?.videos?.[0];
    if (!video) {
      return { ok: false, msg: 'Nenhum vídeo encontrado' };
    }

    return {
      ok: true,
      data: {
        videoId: video.videoId,
        url: video.url,
        title: video.title,
        description: video.description || '',
        thumbnail: video.thumbnail || video.image || '',
        seconds: video.seconds,
        timestamp: video.timestamp,
        views: video.views,
        ago: video.ago,
        author: video.author?.name
      }
    };
  } catch (err) {
    return { ok: false, msg: err.message };
  }
}

// ---------- mp3 ----------

async function mp3(url, bitrate = 128) {
  let dir = null;
  try {
    const videoId = extractVideoId(url);
    if (!videoId) return { ok: false, msg: 'URL do YouTube inválida' };
    const br = sanitizeBitrate(bitrate);

    const dl = await ytdlpDownload(
      videoId,
      ['-f', 'bestaudio/best', '-x', '--audio-format', 'mp3', '--audio-quality', `${br}K`],
      'audio.%(ext)s'
    );
    dir = dl.dir;

    const buffer = readOutputFile(dir, 'mp3');
    const title = dl.meta?.title || 'YouTube';
    const thumbnail =
      dl.meta?.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

    return {
      ok: true,
      buffer,
      title,
      thumbnail,
      filename: safeFilename(title, 'mp3')
    };
  } catch (err) {
    return { ok: false, msg: 'Erro ao baixar música: ' + err.message };
  } finally {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------- mp4 ----------

async function mp4(url, quality = 360) {
  let dir = null;
  try {
    const videoId = extractVideoId(url);
    if (!videoId) return { ok: false, msg: 'URL do YouTube inválida' };
    const q = sanitizeQuality(quality);

    const dl = await ytdlpDownload(
      videoId,
      [
        '-f',
        `bv*[height<=${q}]+ba/b[height<=${q}]/b`,
        '--merge-output-format',
        'mp4',
        '--remux-video',
        'mp4'
      ],
      'video.%(ext)s'
    );
    dir = dl.dir;

    const buffer = readOutputFile(dir, 'mp4');
    const title = dl.meta?.title || 'YouTube';
    const thumbnail =
      dl.meta?.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

    return {
      ok: true,
      buffer,
      title,
      thumbnail,
      filename: safeFilename(title, 'mp4')
    };
  } catch (err) {
    return { ok: false, msg: 'Erro ao baixar vídeo: ' + err.message };
  } finally {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
}

export { search, mp3, mp4 };
export const ytmp3 = mp3;
export const ytmp4 = mp4;
