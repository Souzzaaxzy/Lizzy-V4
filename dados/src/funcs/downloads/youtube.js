/**
 * YouTube - Implementação própria (sem VexAPI)
 *
 * Conteúdo público, sem login, sem bypass de autenticação/CAPTCHA/anti-bot.
 *
 * - search(query): usa a dependência já existente do projeto, `yt-search`
 *   (scraping da página pública de resultados do YouTube).
 *
 * - mp3(url, bitrate=128) / mp4(url, quality=360): consulta o endpoint
 *   youtubei/v1/player com a chave Innertube pública que o próprio YouTube
 *   expõe nas suas páginas, usando o client ANDROID — o YouTube devolve URLs
 *   de stream diretas (sem cifra "n"). Se o YouTube responder LOGIN_REQUIRED
 *   (anti-bot do IP) ou UNPLAYABLE, retorna erro controlado (não faz login,
 *   não contorna proteção).
 *
 * - MP4: prefere formato muxado (áudio+vídeo) com altura <= qualidade pedida;
 *   se não houver muxado, funde melhor vídeo + melhor áudio com FFmpeg
 *   (-c copy) — FFmpeg é requisito de sistema já exigido pelo bot
 *   (config.js, usado em stickers/feito).
 *
 * - MP3: baixa o melhor stream de áudio e converte para MP3 com FFmpeg
 *   no bitrate pedido (padrão 128k, aceito 32–320).
 *
 * Formato de retorno preservado (idêntico ao módulo original):
 *   search → { ok, data: { videoId, url, title, description, thumbnail,
 *              seconds, timestamp, views, ago, author } } | { ok:false, msg }
 *   mp3/mp4 → { ok, buffer, title, thumbnail, filename } | { ok:false, msg }
 *
 * Sem cache (o módulo original também não tinha). Sem novas dependências
 * (usa yt-search e FFmpeg de sistema, ambos já exigidos pelo projeto).
 */

import yts from 'yt-search';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const INNERTUBE_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const MAX_BYTES = 256 * 1024 * 1024;
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

// ---------- HTTP ----------

async function fetchWithTimeout(url, opts = {}, ms = 25000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal, redirect: 'follow' });
  } finally {
    clearTimeout(timer);
  }
}

// ---------- extração de ID/URL ----------

// Aceita watch?v=, youtu.be/, /shorts/, /live/, /v/, music.youtube.com.
function extractVideoId(url) {
  const m = String(url || '').match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/|v\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/
  );
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]{11}$/.test(String(url || '').trim())) return String(url).trim();
  return null;
}

// ---------- player response (Innertube público, client ANDROID) ----------

async function getPlayer(videoId) {
  const res = await fetchWithTimeout(
    `https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_KEY}&prettyPrint=false`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': UA,
        Origin: 'https://www.youtube.com'
      },
      body: JSON.stringify({
        videoId,
        context: {
          client: {
            clientName: 'ANDROID',
            clientVersion: '20.19.35',
            androidSdkVersion: 35,
            hl: 'pt-BR',
            gl: 'BR'
          }
        },
        contentCheckOk: true,
        racyCheckOk: true
      })
    }
  );
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error('Resposta inválida do YouTube');
  }
  return data;
}

// Extrai metadados + status útil para erro controlado.
async function resolveVideo(url) {
  const videoId = extractVideoId(url);
  if (!videoId) {
    throw new Error('URL do YouTube inválida');
  }

  const data = await getPlayer(videoId);
  const status = data?.playabilityStatus || {};

  if (status.status !== 'OK') {
    if (status.status === 'LOGIN_REQUIRED') {
      throw new Error(
        'YouTube exigiu verificação anti-bot para este IP. Tente novamente mais tarde.'
      );
    }
    throw new Error(status.reason || 'Vídeo indisponível');
  }

  const details = data.videoDetails || {};
  const streaming = data.streamingData || {};
  const thumbs = details.thumbnail?.thumbnails || [];

  return {
    videoId,
    title: details.title || 'YouTube',
    author: details.author || '',
    thumbnail: thumbs[thumbs.length - 1]?.url || '',
    muxed: (streaming.formats || []).filter(f => f.url),
    adaptive: (streaming.adaptiveFormats || []).filter(f => f.url)
  };
}

// ---------- download direto (com teto de tamanho) ----------

async function downloadToBuffer(url, timeoutMs = 180000) {
  const res = await fetchWithTimeout(
    url,
    { headers: { 'User-Agent': UA } },
    Math.min(timeoutMs, 25000) // intervalo de inatividade (stream pode demorar no total)
  );
  if (!res.ok && res.status !== 206) {
    throw new Error(`Falha no download (HTTP ${res.status})`);
  }

  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  const deadline = Date.now() + timeoutMs;

  while (true) {
    if (Date.now() > deadline) {
      reader.cancel().catch(() => {});
      throw new Error('Download expirou (timeout)');
    }
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      reader.cancel().catch(() => {});
      throw new Error('Arquivo muito grande para baixar');
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks);
}

// ---------- FFmpeg (sistema, requisito já existente do bot) ----------

function runFFmpeg(args, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
      stdio: ['ignore', 'ignore', 'pipe']
    });
    let stderr = '';
    child.stderr.on('data', d => (stderr += d));
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('FFmpeg expirou (timeout)'));
    }, timeoutMs);
    child.on('error', err => {
      clearTimeout(timer);
      reject(
        err.code === 'ENOENT'
          ? new Error('FFmpeg não encontrado no sistema (instale ffmpeg)')
          : err
      );
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error('FFmpeg falhou: ' + stderr.slice(-200)));
    });
  });
}

// Baixa stream, transforma com FFmpeg (expressão map/filters simples) e limpa.
async function convertStream(url, argsToOutput, outputExt, timeoutMs = 180000) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-'));
  const input = path.join(dir, 'input');
  const output = path.join(dir, `output.${outputExt}`);
  try {
    const buf = await downloadToBuffer(url, timeoutMs);
    fs.writeFileSync(input, buf);

    await runFFmpeg(['-i', input, ...argsToOutput, output], timeoutMs);

    return fs.readFileSync(output);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

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
  return `${(base || 'audio').replace(/[^\w\s]/gi, '')}.${ext}`;
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
  try {
    const br = sanitizeBitrate(bitrate);
    const video = await resolveVideo(url);

    const audios = video.adaptive.filter(f => (f.mimeType || '').startsWith('audio/'));
    if (!audios.length) {
      return { ok: false, msg: 'Áudio não disponível para este vídeo' };
    }
    audios.sort((a, b) => {
      const ap = (a.mimeType || '').includes('audio/mp4') ? 1 : 0;
      const bp = (b.mimeType || '').includes('audio/mp4') ? 1 : 0;
      return bp - ap || (b.bitrate || 0) - (a.bitrate || 0);
    });

    const buffer = await convertStream(
      audios[0].url,
      ['-vn', '-b:a', `${br}k`, '-f', 'mp3'],
      'mp3'
    );

    return {
      ok: true,
      buffer,
      title: video.title,
      thumbnail: video.thumbnail,
      filename: safeFilename(video.title, 'mp3')
    };
  } catch (err) {
    return { ok: false, msg: 'Erro ao baixar música: ' + err.message };
  }
}

// ---------- mp4 ----------

async function mp4(url, quality = 360) {
  try {
    const target = sanitizeQuality(quality);
    const video = await resolveVideo(url);

    // 1) prefere muxado (áudio+vídeo) com altura <= qualidade pedida
    const candidates = video.muxed.filter(
      f => (f.mimeType || '').startsWith('video/') && (f.mimeType || '').includes('mp4')
    );
    let pick = candidates
      .filter(f => (f.height || 0) <= target)
      .sort((a, b) => (b.height || 0) - (a.height || 0))[0];
    if (!pick && candidates.length) {
      pick = candidates.sort((a, b) => (a.height || 0) - (b.height || 0))[0];
    }

    if (pick) {
      const buffer = await downloadToBuffer(pick.url);
      return {
        ok: true,
        buffer,
        title: video.title,
        thumbnail: video.thumbnail,
        filename: safeFilename(video.title, 'mp4')
      };
    }

    // 2) fallback: funde melhor vídeo (<= qualidade) + melhor áudio via FFmpeg
    const videos = video.adaptive.filter(f => (f.mimeType || '').startsWith('video/mp4'));
    const audios = video.adaptive.filter(f => (f.mimeType || '').startsWith('audio/'));
    if (!videos.length || !audios.length) {
      return { ok: false, msg: 'Formato de vídeo indisponível para este vídeo' };
    }
    const v =
      videos.filter(f => (f.height || 0) <= target).sort((a, b) => (b.height || 0) - (a.height || 0))[0] ||
      videos.sort((a, b) => (a.height || 0) - (b.height || 0))[0];
    const a = audios.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
    if (!v || !a) {
      return { ok: false, msg: 'Formato de vídeo indisponível para este vídeo' };
    }

    const vb = await downloadToBuffer(v.url);
    const ab = await downloadToBuffer(a.url);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-'));
    const vin = path.join(dir, 'v');
    const ain = path.join(dir, 'a');
    const out = path.join(dir, 'output.mp4');
    try {
      fs.writeFileSync(vin, vb);
      fs.writeFileSync(ain, ab);
      await runFFmpeg(['-i', vin, '-i', ain, '-c', 'copy', out]);
      const buffer = fs.readFileSync(out);
      return {
        ok: true,
        buffer,
        title: video.title,
        thumbnail: video.thumbnail,
        filename: safeFilename(video.title, 'mp4')
      };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch (err) {
    return { ok: false, msg: 'Erro ao baixar vídeo: ' + err.message };
  }
}

export { search, mp3, mp4 };
export const ytmp3 = mp3;
export const ytmp4 = mp4;
