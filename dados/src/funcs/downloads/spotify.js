/**
 * Spotify (busca + download de áudio) — caminhos públicos, sem API paga.
 *
 * POR QUE ESTE ARQUIVO FOI REESCRITO (set/2026)
 * ---------------------------------------------
 * A versão anterior tinha três dependências que NÃO funcionam mais:
 *   1. busca via Brave Search   -> responde 429 (bloqueio de automação);
 *   2. busca via vreden.my.id   -> endpoint removido (404 "Router não encontrado");
 *   3. download via spotisaver.net -> responde 403
 *      {"error":"request_verification_failed"} (Cloudflare Turnstile + assinatura
 *      HMAC no payload). Ou seja: o `!play2` não buscava E não baixava.
 *
 * O que sobrou de público e estável:
 *   - BUSCA:  API pública do Deezer (sem chave) — a mais relevante em PT-BR;
 *             iTunes Search (sem chave) como reserva.
 *   - METADADOS do link: Spotify oEmbed (título + capa, sem auth) e as tags
 *             OpenGraph da página do track com UA de crawler (traz artista,
 *             álbum e ano).
 *   - ÁUDIO:  yt-dlp no próprio servidor (o MESMO motor que o `!play` usa e que
 *             o bot já exige/instala — `YTDLP_PATH` / `python3 -m yt_dlp`).
 *
 * O Spotify NÃO entrega o áudio por API pública — nenhum caminho oficial faz
 * isso. Por isso o áudio vem do YouTube (mesma música) via yt-dlp. Se o
 * servidor não tiver yt-dlp/FFmpeg, a busca e a prévia continuam funcionando e
 * o erro do áudio é claro — o comando não quebra.
 *
 * Se o administrador definir SPOTIFY_CLIENT_ID/SPOTIFY_CLIENT_SECRET, a busca
 * oficial do Spotify passa a ser tentada PRIMEIRO (metadados melhores), com
 * queda para o Deezer.
 */

import axios from 'axios';
import dotenv from 'dotenv';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

dotenv.config();

const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';
const SPOTIFY_OEMBED = 'https://open.spotify.com/oembed';
const DEEZER_API = 'https://api.deezer.com';
const ITUNES_API = 'https://itunes.apple.com';

/** UA de "crawler de link": o Spotify serve as og tags (artista/álbum/ano) só para ele. */
const CRAWLER_UA = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';

const HTTP_TIMEOUT = 15000;

// ── cache (busca, metadados e download) ──────────────────────────────
const cache = new Map();
const CACHE_TTL = 30 * 60 * 1000;
function getCached(key) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() - item.ts > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return item.val;
}
function setCache(key, val) {
  if (cache.size >= 500) cache.delete(cache.keys().next().value);
  cache.set(key, { val, ts: Date.now() });
}

// ── utilidades ───────────────────────────────────────────────────────
function extractTrackId(url) {
  const m = String(url || '').match(/track\/([a-zA-Z0-9]{16,})/);
  return m ? m[1] : null;
}

function isValidSpotifyUrl(url) {
  return typeof url === 'string' && /open\.spotify\.com\/track\//.test(url);
}

/** Converte a duração do Deezer (segundos) para ms, mantendo o contrato. */
function secondsToMs(sec) {
  const n = Number(sec);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) : null;
}

function normalizeText(t) {
  return String(t || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

// ── BUSCA: Spotify oficial (se houver credenciais) ───────────────────
let spotifyTokenCache = null;
async function getSpotifyToken() {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (spotifyTokenCache && spotifyTokenCache.expiresAt > Date.now() + 60000) {
    return spotifyTokenCache.token;
  }
  if (!id || !secret) throw new Error('SPOTIFY_CREDENTIALS_MISSING');
  const basic = Buffer.from(`${id}:${secret}`).toString('base64');
  const res = await axios.post('https://accounts.spotify.com/api/token',
    new URLSearchParams({ grant_type: 'client_credentials' }),
    {
      timeout: HTTP_TIMEOUT,
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' }
    }
  );
  const token = res.data?.access_token;
  if (!token) throw new Error('SPOTIFY_TOKEN_FAIL');
  spotifyTokenCache = { token, expiresAt: Date.now() + (res.data.expires_in || 3600) * 1000 };
  return token;
}

function mapSpotifyTrack(track) {
  const artists = Array.isArray(track.artists) ? track.artists.map(a => a.name) : [];
  const link = track.external_urls?.spotify || `https://open.spotify.com/track/${track.id}`;
  return {
    name: track.name,
    artist: artists.join(', '),
    artists,
    song_link: link,
    link,
    id: track.id,
    duration_ms: track.duration_ms,
    album: track.album?.name,
    image: track.album?.images?.[1]?.url || track.album?.images?.[0]?.url || null,
    source: 'spotify-api'
  };
}

async function searchViaSpotifyAPI(query) {
  const token = await getSpotifyToken();
  const res = await axios.get(`${SPOTIFY_API_BASE}/search`, {
    params: { q: query, type: 'track', limit: 5 },
    timeout: HTTP_TIMEOUT,
    headers: { Authorization: `Bearer ${token}` }
  });
  const tracks = res.data?.tracks?.items;
  if (!Array.isArray(tracks) || !tracks.length) return { ok: false, msg: 'Nenhuma música encontrada no Spotify' };
  const results = tracks.filter(t => t && t.id && t.external_urls?.spotify).map(mapSpotifyTrack);
  if (!results.length) return { ok: false, msg: 'Nenhuma música encontrada no Spotify' };
  return { ok: true, results };
}

// ── BUSCA: Deezer (público, sem chave) ───────────────────────────────
async function searchViaDeezer(query) {
  const res = await axios.get(`${DEEZER_API}/search`, {
    params: { q: query, limit: 8 },
    timeout: HTTP_TIMEOUT
  });
  const list = Array.isArray(res.data?.data) ? res.data.data : [];
  if (!list.length) return { ok: false, msg: 'Nenhuma música encontrada' };
  const results = list.map(d => ({
    name: d.title_short || d.title,
    artist: d.artist?.name || '',
    artists: d.artist?.name ? [d.artist.name] : [],
    song_link: d.link,
    link: d.link,
    id: String(d.id),
    duration_ms: secondsToMs(d.duration),
    album: d.album?.title,
    image: d.album?.cover_medium || d.album?.cover_big || null,
    source: 'deezer'
  }));
  return { ok: true, results };
}

// ── BUSCA: iTunes (público, sem chave) — reserva ─────────────────────
async function searchViaItunes(query) {
  const res = await axios.get(`${ITUNES_API}/search`, {
    params: { term: query, entity: 'song', limit: 8 },
    timeout: HTTP_TIMEOUT
  });
  const list = Array.isArray(res.data?.results) ? res.data.results : [];
  if (!list.length) return { ok: false, msg: 'Nenhuma música encontrada' };
  const results = list.map(t => ({
    name: t.trackName,
    artist: t.artistName,
    artists: t.artistName ? [t.artistName] : [],
    song_link: t.trackViewUrl,
    link: t.trackViewUrl,
    id: String(t.trackId),
    duration_ms: Number.isFinite(t.trackTimeMillis) ? t.trackTimeMillis : null,
    album: t.collectionName,
    image: (t.artworkUrl100 || '').replace('100x100bb', '600x600bb') || null,
    source: 'itunes'
  }));
  return { ok: true, results };
}

/**
 * Ordena os resultados pela relevância em relação à consulta (título + artista).
 * O primeiro colocado é o que o `!play2` vai baixar, então isto importa.
 */
function rankResults(results, query) {
  const termos = normalizeText(query).split(/\s+/).filter(Boolean);
  return results
    .map(r => {
      const alvo = normalizeText(`${r.name} ${r.artist}`);
      let score = 0;
      for (const t of termos) {
        if (normalizeText(r.name).includes(t)) score += 3;
        if (alvo.includes(t)) score += 1;
      }
      if (normalizeText(r.name) === normalizeText(query)) score += 4;
      if (/ao vivo|remix|cover|karaoke|instrumental|sped up|slowed/i.test(r.name)) score -= 3;
      if (r.image) score += 1;
      return { r, score };
    })
    .sort((a, b) => b.score - a.score)
    .map(x => x.r);
}

async function search(query) {
  if (!query || typeof query !== 'string' || !query.trim()) {
    return { ok: false, msg: 'Digite o nome da música ou do artista.' };
  }
  const q = query.trim();
  const cached = getCached(`search:${normalizeText(q)}`);
  if (cached) return cached;

  // 1) Spotify oficial (só se houver credenciais) — melhor metadado
  try {
    const official = await searchViaSpotifyAPI(q);
    if (official.ok && official.results.length) {
      const result = { ok: true, query: q, total: official.results.length, results: official.results, source: 'spotify-api' };
      setCache(`search:${normalizeText(q)}`, result);
      return result;
    }
  } catch (e) {
    if (e.message !== 'SPOTIFY_CREDENTIALS_MISSING' && e.message !== 'SPOTIFY_TOKEN_FAIL') {
      console.error('[Spotify] busca oficial falhou:', e.message);
    }
  }

  // 2) Deezer (público, sem chave) — o caminho principal
  try {
    const deezer = await searchViaDeezer(q);
    if (deezer.ok && deezer.results.length) {
      const results = rankResults(deezer.results, q);
      const result = { ok: true, query: q, total: results.length, results, source: 'deezer' };
      setCache(`search:${normalizeText(q)}`, result);
      return result;
    }
  } catch (e) {
    console.error('[Spotify] busca Deezer falhou:', e.message);
  }

  // 3) iTunes (público, sem chave)
  try {
    const itunes = await searchViaItunes(q);
    if (itunes.ok && itunes.results.length) {
      const results = rankResults(itunes.results, q);
      const result = { ok: true, query: q, total: results.length, results, source: 'itunes' };
      setCache(`search:${normalizeText(q)}`, result);
      return result;
    }
  } catch (e) {
    console.error('[Spotify] busca iTunes falhou:', e.message);
  }

  return { ok: false, query: q, msg: 'Nenhuma música encontrada com esse nome.' };
}

// ── METADADOS de um link do Spotify (oEmbed + OpenGraph) ─────────────
function parseOg(html, prop) {
  const re = new RegExp(`property=["']og:${prop}["']\\s+content=["']([^"']*)["']`, 'i');
  const m = String(html || '').match(re);
  return m ? m[1] : null;
}

async function fetchTrackPageMetadata(trackId) {
  const res = await axios.get(`https://open.spotify.com/track/${trackId}`, {
    timeout: HTTP_TIMEOUT,
    headers: { 'User-Agent': CRAWLER_UA },
    maxRedirects: 5
  });
  const html = typeof res.data === 'string' ? res.data : '';
  const title = parseOg(html, 'title');
  const description = parseOg(html, 'description') || '';
  const image = parseOg(html, 'image');
  // "Rick Astley · Whenever You Need Somebody · Song · 1987"
  const partes = description.split('·').map(s => s.trim());
  return {
    name: title || null,
    artist: partes[0] || null,
    album: partes[1] || null,
    year: (description.match(/·\s*(\d{4})\s*$/) || [])[1] || null,
    image: image || null
  };
}

async function fetchOembedMetadata(trackId) {
  const res = await axios.get(SPOTIFY_OEMBED, {
    params: { url: `https://open.spotify.com/track/${trackId}` },
    timeout: HTTP_TIMEOUT
  });
  return {
    name: res.data?.title || null,
    image: res.data?.thumbnail_url || null
  };
}

async function resolveTrackMetadata(url) {
  const trackId = extractTrackId(url);
  if (!trackId) return null;
  const cached = getCached(`meta:${trackId}`);
  if (cached) return cached;

  let meta = { name: null, artist: null, album: null, year: null, image: null };
  try {
    meta = { ...meta, ...(await fetchTrackPageMetadata(trackId)) };
  } catch (e) {
    console.error('[Spotify] og tags falharam:', e.message);
  }
  if (!meta.name || !meta.image) {
    try {
      const oe = await fetchOembedMetadata(trackId);
      meta.name = meta.name || oe.name;
      meta.image = meta.image || oe.image;
    } catch (e) {
      console.error('[Spotify] oEmbed falhou:', e.message);
    }
  }
  if (meta.name) setCache(`meta:${trackId}`, meta);
  return meta;
}

// ── ÁUDIO (autossuficiente: yt-dlp no servidor) ──────────────────────
// O Spotify não expõe áudio por API pública — nenhum caminho oficial faz isso.
// O áudio vem do YouTube (mesma música) pelo yt-dlp, que é o motor que o bot
// já exige e usa no `!play`. Este bloco resolve e chama o yt-dlp por conta
// própria, sem depender de nenhum outro módulo do bot.
const AUDIO_MAX_BYTES = 256 * 1024 * 1024;
const AUDIO_TIMEOUT_MS = 180000;
const PROBE_TIMEOUT_MS = 15000;
const AUDIO_CLIENTS = ['web_safari', 'mweb', 'web', 'android_vr'];

let ytdlpResolved;
let ffmpegResolved;

function runProcess(cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const detached = process.platform !== 'win32';
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], detached });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { if (stdout.length < 4_000_000) stdout += d; });
    child.stderr.on('data', d => { if (stderr.length < 64_000) stderr += d; });
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
    child.on('error', err => { clearTimeout(timer); reject(err); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) return resolve({ stdout, stderr });
      const err = new Error('yt-dlp falhou (código ' + code + ')');
      err.stderr = stderr;
      reject(err);
    });
  });
}

/** Resolve o yt-dlp (sucesso cacheado; falha re-testada a cada chamada). */
async function resolveYtDlp() {
  if (ytdlpResolved) return ytdlpResolved;
  const home = os.homedir();
  const candidates = [];
  if (process.env.YTDLP_PATH) candidates.push({ cmd: process.env.YTDLP_PATH, base: [] });
  candidates.push({ cmd: 'yt-dlp', base: [] });
  candidates.push({ cmd: path.join(home, '.local', 'bin', 'yt-dlp'), base: [] });
  candidates.push({ cmd: '/home/container/.local/bin/yt-dlp', base: [] });
  candidates.push({ cmd: '/root/.local/bin/yt-dlp', base: [] });
  candidates.push({ cmd: '/usr/local/bin/yt-dlp', base: [] });
  candidates.push({ cmd: 'python3', base: ['-m', 'yt_dlp'] });
  candidates.push({ cmd: 'python', base: ['-m', 'yt_dlp'] });
  for (const c of candidates) {
    try {
      await runProcess(c.cmd, [...c.base, '--version'], PROBE_TIMEOUT_MS);
      ytdlpResolved = c;
      return c;
    } catch { /* tenta o próximo */ }
  }
  ytdlpResolved = null;
  return null;
}

async function resolveFfmpeg() {
  if (ffmpegResolved) return ffmpegResolved;
  const home = os.homedir();
  const candidates = [process.env.FFMPEG_PATH || 'ffmpeg'];
  candidates.push(path.join(home, '.local', 'bin', 'ffmpeg'), '/home/container/.local/bin/ffmpeg', '/root/.local/bin/ffmpeg', '/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg');
  for (const cmd of candidates) {
    try {
      await runProcess(cmd, ['-version'], PROBE_TIMEOUT_MS);
      ffmpegResolved = cmd;
      return cmd;
    } catch { /* tenta o próximo */ }
  }
  ffmpegResolved = null;
  return null;
}

function mapYtDlpError(stderr) {
  const s = String(stderr || '');
  if (/Sign in to confirm|not a bot|captcha/i.test(s)) return 'O YouTube pediu verificação (bloqueio temporário). Tente novamente em alguns minutos.';
  if (/age/i.test(s)) return 'Este conteúdo tem restrição de idade.';
  if (/unavailable|not available|removed/i.test(s)) return 'Vídeo indisponível no YouTube.';
  if (/ffmpeg/i.test(s)) return 'O FFmpeg não está instalado no servidor.';
  return 'Não foi possível baixar o áudio.';
}

/**
 * Baixa o áudio de uma busca ("Artista - Título") via yt-dlp, sem passar pelo
 * `youtube.js` (o comando é sobre o Spotify; este módulo é autossuficiente).
 */
async function baixarAudioYtDlp(termo) {
  const ytdlp = await resolveYtDlp();
  if (!ytdlp) {
    return { ok: false, msg: 'O áudio precisa do yt-dlp no servidor (instale com: python3 -m pip install -U yt-dlp).' };
  }
  const ffmpeg = await resolveFfmpeg();
  if (!ffmpeg) {
    return { ok: false, msg: 'O áudio precisa do FFmpeg instalado no servidor.' };
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spotify-'));
  const args = [
    ...ytdlp.base,
    '--no-playlist',
    '--no-warnings',
    '--no-progress',
    '--socket-timeout', '30',
    '--retries', '1',
    '--max-filesize', String(AUDIO_MAX_BYTES),
    '--js-runtimes', `node:${process.execPath}`,
    '--ffmpeg-location', ffmpeg,
    '-f', 'bestaudio/best',
    '-x', '--audio-format', 'mp3', '--audio-quality', '128K',
    '-o', path.join(dir, 'audio.%(ext)s'),
    '--print-json',
    `ytsearch1:${termo}`
  ];

  try {
    let stdout = null;
    let lastErr = null;
    for (const client of AUDIO_CLIENTS) {
      const clientArgs = [...args, '--extractor-args', `youtube:player_client=${client}`];
      try {
        const result = await runProcess(ytdlp.cmd, clientArgs, AUDIO_TIMEOUT_MS);
        stdout = result.stdout;
        break;
      } catch (err) {
        lastErr = err;
        await new Promise(r => setTimeout(r, 800));
      }
    }
    if (!stdout) throw lastErr || new Error('yt-dlp não retornou dados');

    const meta = (() => {
      try {
        const linha = String(stdout).trim().split('\n').filter(Boolean).pop();
        return JSON.parse(linha);
      } catch { return {}; }
    })();
    const arquivo = fs.readdirSync(dir).find(f => f.endsWith('.mp3'));
    if (!arquivo) return { ok: false, msg: 'O yt-dlp não gerou o arquivo de áudio.' };
    const full = path.join(dir, arquivo);
    const stat = fs.statSync(full);
    if (!stat.size) return { ok: false, msg: 'Áudio vazio.' };
    if (stat.size > AUDIO_MAX_BYTES) return { ok: false, msg: 'Áudio maior que o limite permitido.' };

    return { ok: true, buffer: fs.readFileSync(full), youtubeTitle: meta?.title || null };
  } catch (err) {
    return { ok: false, msg: mapYtDlpError(err?.stderr) + (err?.stderr ? '' : ' (' + err.message + ')') };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Obtém o áudio de uma faixa. O Spotify não expõe áudio por API pública, então
 * o áudio vem do YouTube (mesma música) pelo yt-dlp.
 */
async function fetchAudio({ query, title, artist, allowYouTube = true }) {
  if (!allowYouTube) return { ok: false, msg: 'Download de áudio desativado.' };
  const termo = (query || `${artist || ''} ${title || ''}`).trim();
  if (!termo) return { ok: false, msg: 'Sem termo para buscar o áudio.' };
  return baixarAudioYtDlp(termo);
}

// ── DOWNLOAD (contrato preservado) ───────────────────────────────────
/** Metadados de um link do Deezer (usado quando a busca devolve link do Deezer). */
async function resolveDeezerMetadata(url) {
  const m = String(url || '').match(/deezer\.com\/(?:[a-z]{2}\/)?track\/(\d+)/i);
  if (!m) return null;
  const id = m[1];
  const cached = getCached(`deezerMeta:${id}`);
  if (cached) return cached;
  const res = await axios.get(`${DEEZER_API}/track/${id}`, { timeout: HTTP_TIMEOUT });
  const d = res.data || {};
  const meta = {
    name: d.title_short || d.title || null,
    artist: d.artist?.name || null,
    album: d.album?.title || null,
    year: (d.release_date || '').slice(0, 4) || null,
    image: d.album?.cover_big || d.album?.cover_medium || null,
    duration: secondsToMs(d.duration)
  };
  if (meta.name) setCache(`deezerMeta:${id}`, meta);
  return meta;
}

/**
 * @param {string} url  link do Spotify (track) OU link do Deezer (o `!play2`
 *   busca e recebe um link do Deezer; o `!spotifydl` e o autodownload recebem
 *   link do Spotify). Os dois caminhos produzem o mesmo retorno.
 * @returns {Promise<Object>} { ok, buffer, title, artists, artist, albumImage,
 *   image, year, duration, filename, source, youtubeTitle } | { ok:false, msg }
 */
async function download(url) {
  try {
    const isSpotify = isValidSpotifyUrl(url);
    const isDeezer = /deezer\.com\/(?:[a-z]{2}\/)?track\/\d+/i.test(String(url || ''));
    if (!isSpotify && !isDeezer) {
      return { ok: false, msg: 'Link inválido. Use um link de música do Spotify (open.spotify.com/track/...) ou do Deezer.' };
    }
    const cached = getCached(`download:${url}`);
    if (cached) return cached;

    let meta = {};
    if (isSpotify) {
      if (!extractTrackId(url)) {
        return { ok: false, msg: 'Não foi possível extrair o ID da música. Verifique o link.' };
      }
      meta = (await resolveTrackMetadata(url)) || {};
    } else {
      meta = (await resolveDeezerMetadata(url)) || {};
    }

    const title = meta.name || 'Música';
    const artists = meta.artist ? [meta.artist] : [];

    const audio = await fetchAudio({
      query: [meta.artist, title].filter(Boolean).join(' - ') || title,
      title,
      artist: meta.artist
    });
    if (!audio.ok) return { ok: false, msg: audio.msg };

    const result = {
      ok: true,
      buffer: audio.buffer,
      title,
      artists,
      artist: meta.artist || '',
      album: meta.album || null,
      albumImage: meta.image || null,
      image: meta.image || null,
      year: meta.year || null,
      duration: meta.duration || null,
      filename: `${(meta.artist ? meta.artist + ' - ' : '')}${title}.mp3`,
      source: isSpotify ? 'spotify+ytdlp' : 'deezer+ytdlp',
      youtubeTitle: audio.youtubeTitle || null
    };

    setCache(`download:${url}`, result);
    return result;
  } catch (error) {
    console.error('[Spotify] erro no download:', error.message);
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      return { ok: false, msg: 'Timeout ao processar a música. Tente novamente.' };
    }
    return { ok: false, msg: error.message || 'Erro ao processar a música.' };
  }
}

/**
 * Busca + download em uma chamada (contrato antigo preservado).
 */
async function searchDownload(query) {
  const searchResult = await search(query);
  if (!searchResult.ok || !searchResult.results?.length) {
    return { ok: false, msg: searchResult.msg || 'Nenhuma música encontrada com esse nome.' };
  }
  const track = searchResult.results[0];
  const dl = await download(track.song_link);
  if (!dl.ok) return dl;
  return { ...dl, query, track: { name: track.name, artists: track.artists, link: track.link } };
}

/**
 * Baixa o áudio de um item já vindo da BUSCA (que pode ser Deezer/iTunes, e não
 * um link do Spotify). Mantém o mesmo contrato do `download(url)`.
 * @param {Object} track item de `search().results[]`
 */
async function downloadTrack(track) {
  if (!track || !track.name) return { ok: false, msg: 'Música inválida.' };
  const cacheKey = `downloadTrack:${normalizeText(`${track.artist} ${track.name}`)}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const audio = await fetchAudio({
    query: [track.artist, track.name].filter(Boolean).join(' - '),
    title: track.name,
    artist: track.artist
  });
  if (!audio.ok) return { ok: false, msg: audio.msg };

  const result = {
    ok: true,
    buffer: audio.buffer,
    title: track.name,
    artists: Array.isArray(track.artists) && track.artists.length ? track.artists : (track.artist ? [track.artist] : []),
    artist: track.artist || '',
    album: track.album || null,
    albumImage: track.image || null,
    image: track.image || null,
    year: null,
    duration: track.duration_ms || null,
    filename: `${(track.artist ? track.artist + ' - ' : '')}${track.name}.mp3`,
    source: 'search+ytdlp',
    youtubeTitle: audio.youtubeTitle || null
  };
  setCache(cacheKey, result);
  return result;
}

export default {
  download,
  downloadTrack,
  search,
  searchDownload,
  resolveTrackMetadata
};

// Exportados para teste (puros, sem I/O).
export { extractTrackId, isValidSpotifyUrl, normalizeText, rankResults, secondsToMs };
