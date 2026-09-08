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
 * Opções opcionais de ambiente (anti-bloqueio de datacenter):
 *   YTDLP_SLEEP_REQUESTS   segundos de pausa entre requisições (ex.: 1)
 *   YTDLP_FORCE_IPV4       força IPv4 por padrão; `YTDLP_DISABLE_IPV4=1` desativa.

 *   YTDLP_PROXY             proxy de download (ex.: http://127.0.0.1:8080)
 *   YOUTUBE_COOKIES_FILE   arquivo Netscape de cookies do próprio usuário (padrão: data/youtube/cookies.txt);
 *   YTDLP_COOKIES_FILE      (legado — compatível)
 *   YTDLP_IMPERSONATE        impersonar client (ex.: chrome) — requer curl_cffi no yt-dlp

 *   YTDLP_JS_RUNTIME        runtime JS do extractor (padrão: o próprio Node do bot via
 *                            process.execPath — zero dependência nova). Use override só se preciso
 *                            (ex.: 'deno' ou um caminho absoluto).
 *   YTDLP_REMOTE_COMPONENTS componentes remotos permitidos pro extractor (padrão
 *                            'ejs:github' — pacote de solvers de desafios JS do yt-dlp,
 *                            recomendado oficialmente; ver https://github.com/yt-dlp/yt-dlp/wiki/EJS.
 *                            O YouTube moderno exige um runtime JS + solver de
 *                            desafios para resolver assinaturas/n-challenge dos
 *                            player clients web/mweb; sem isso o extractor devolve
 *                            formatos vazios/equivalentes a "Sign in to confirm you're
 *                            not a bot" em IPs flagados.

 *   YTDLP_PO_TOKEN          valor opcional de PO Token do próprio provedor do
 *                            administrador (gerado por um provider compatível — NÃO
 *                            coloque tokens fixos aqui). Formato compatível com
 *                            `youtube:po_token=` do yt-dlp (ex.: 'web.gvs+TOKEN'..
 *                            Se vazio/ausente, o fluxo segue sem PO Token.

 *   YTDLP_TIMEOUT_MS        timeout por tentativa (padrão 180s)
 *   YTDLP_DEADLINE_MS       deadline total do download (padrão 240s)
 *   YTDLP_CLIENTS           fila de clients do extractor (override opcional, CSV;
 *                            padrão: 'web_safari,mweb,web' — fila enxuta de baixa
 *                            latência. Se precisar de android_vr/android (ex.: vídeos
 *                            "made for kids"), defina aqui (ex.: 'android_vr,android').
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
const YTDLP_DEADLINE = parseInt(process.env.YTDLP_DEADLINE_MS, 10) || 240000;  // teto real do fluxo de download inteiro (240s) — evita N clients x socket-timeount sem fim
const YTDLP_SLEEP_REQUESTS = parseInt(process.env.YTDLP_SLEEP_REQUESTS, 10); // pausa entre requisições (ex.: 1)s
const YTDLP_PROXY = process.env.YTDLP_PROXY || '';            // proxy opcional (ex.: http://127.0.0.1:8080)
// Arquivo de cookies do YouTube (formato Netscape). Opcional. Prioridade:
// 1. YOUTUBE_COOKIES_FILE (novo, recomendado);
// 2. YTDLP_COOKIES_FILE (legado — mantido para compatibilidade);
// 3. Padrão implícito: ./data/youtube/cookies.txt (se existir)
const YOUTUBE_COOKIES_FILE = process.env.YOUTUBE_COOKIES_FILE || '';
const YTDLP_COOKIES_FILE = process.env.YTDLP_COOKIES_FILE || '';
const YTDLP_IMPERSONATE = process.env.YTDLP_IMPERSONATE || ''; // ex.: chrome (requer curl_cffi no yt-dlp>
const YTDLP_FORCE_IPV4 = process.env.YTDLP_DISABLE_IPV4 !== '1';
// Runtime JS do extractor (obrigatório no YouTube moderno). Padrão: o próprio Node do bot.

const YTDLP_JS_RUNTIME = process.env.YTDLP_JS_RUNTIME || `node:${process.execPath}`;
// Solver de desafios JS (EJS, recomendado oficialmente pelo projeto yt-dlp). O yt-dlp
// baixa os scripts do repositório oficial do projeto quando necessário (cache local).
const YTDLP_REMOTE_COMPONENTS = process.env.YTDLP_REMOTE_COMPONENTS || 'ejs:github';
// PO Token opcional, apenas se o administrador usar um provider compatível (nunca fixo).
const YTDLP_PO_TOKEN = process.env.YTDLP_PO_TOKEN || '';
const PROBE_TIMEOUT = 15000;

// ---------- cache de resultados mp3 (TTL curto pra músicas repetidas responderem rápido) ----------
// Chave: videoId+bitrate. Mantém o Buffer em memória por até MP3_CACHE_TTL_MS (10min.

const MP3_CACHE_TTL_MS = parseInt(process.env.YTDLP_CACHE_TTL_MS, 10) || 10 * 60 * 1000;
const mp3Cache = new Map(); // videoId@br -> { buffer, title, thumbnail, filename, expiresAt }
function mp3CacheGet(key) {
  const hit = mp3Cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit;

  return null;
}
function mp3CacheSet(key, val) {
  mp3Cache.set(key, { ...val, expiresAt: Date.now() + MP3_CACHE_TTL_MS });
  if (mp3Cache.size > 1000) {
    const now = Date.now();
    for (const [k, v] of mp3Cache) {
      if (v.expiresAt < now) mp3Cache.delete(k);
    }
  }
}


// ---------- cache de busca (query→primeiro resultado, TTL curto p/ repetir pesquisas rápido) ----------
// Chave: query normalizada. Armazena { data, expiresAt } por até SEARCH_CACHE_TTL_MS (10min.

const SEARCH_CACHE_TTL_MS = parseInt(process.env.YTDLP_SEARCH_CACHE_TTL_MS, 10) || 10 * 60 * 1000;
const searchCache = new Map(); // query_lower -> { data, expiresAt }
function searchCacheGet(key) {
  const hit = searchCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.data;

  return null;
}
function searchCacheSet(key, data) {
  searchCache.set(key, { data, expiresAt: Date.now() + SEARCH_CACHE_TTL_MS });
  if (searchCache.size > 1000) {
    const now = Date.now();
    for (const [k, v] of searchCache) {
      if (v.expiresAt < now) searchCache.delete(k);
    }
  }
}
// ---------- cookies do YouTube (opcional, formato Netscape) ----------
// Nunca ler/imprimir o conteúdo do arquivo: apenas a existência é usada.

// Prioridade de resolução do arquivo de cookies:
//   1. YOUTUBE_COOKIES_FILE      (novo, recomendado pelo projeto);
//   2. YTDLP_COOKIES_FILE          (legado — mantido para compatibilidade);
//   3. data/youtube/cookies.txt      (padrão implícito, se existir).
//
// O caminho é relativo ao CWD do processo (raiz do bot) ou absoluto.

let resolvedCookiesPath = null;
function resolveCookiesFile() {
  const candidates = [];
  if (resolvedCookiesPath) return resolvedCookiesPath;
  if (YOUTUBE_COOKIES_FILE) candidates.push(YOUTUBE_COOKIES_FILE);
  if (YTDLP_COOKIES_FILE) candidates.push(YTDLP_COOKIES_FILE);
  candidates.push(path.join('data', 'youtube', 'cookies.txt'));
  try {
    for (const c of candidates) {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) {
        resolvedCookiesPath = c;
        return resolvedCookiesPath;
      }
    }
  } catch {
    /* se algo der errado, segue sem cookies */
  }
  return null; // não cacheia falha? se o arquivo surgir depois, será detectado
}

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
      const probe = await runProcess(c.cmd, [...c.base, '--version'], PROBE_TIMEOUT);
      ytdlpResolved = { ...c, version: String(probe.stdout || '').trim().split('\n')[0] };
      console.log(`[youtube] yt-dlp detectado: ${ytdlpResolved.version || c.cmd}`);
      return ytdlpResolved;
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

// Argumentos do runtime JS + solver de desafios (EJS) do extractor do YouTube.
function jsRuntimeArgs() {
  // --js-runtimes habilita o runtime JS (node do bot por padrão).
  const runtimes = [YTDLP_JS_RUNTIME || `node:${process.execPath}`];
  // --remote-components ejs:github autoriza o yt-dlp a baixar os solvers oficiais
  return ['--js-runtimes', runtimes.join(','), '--remote-components', YTDLP_REMOTE_COMPONENTS || 'ejs:github'];
}

// ---------- IP público do servidor (diagnóstico de bloqueio) ----------
// O YouTube bloqueia IPs de datacenter/VPS com 403/not-a-bot. Mostrar
// qual IP o servidor está usando ajuda o admin a entender se o bloqueio é ambiental.
let resolvedPublicIp = null; // undefined = não testado | null = indisponível | string = ok
let publicIpPromise = null;
function getPublicIp() {
  if (publicIpPromise) return publicIpPromise;
  const run = async () => {
    if (typeof resolvedPublicIp === 'string') return resolvedPublicIp;

    try {
      const res = await fetch('https://api.ipify.org', {
        signal: AbortSignal.timeout(8000),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Lizzy-Bot)' }
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const ip = (await res.text()).trim();
      if (/^[\d.:a-fA-F]+$/.test(ip)) {
        resolvedPublicIp = ip; // so cacheia sucesso; falhas nao ficam presas
        return resolvedPublicIp;
      }
    } catch {
      /* falha nao e cacheada: a proxima chamada re-tenta */
    }
    return null;

  };
  publicIpPromise = run().finally(() => { publicIpPromise = null; });
  return publicIpPromise

}

// ---------- erros do yt-dlp → mensagens controladas ----------

function mapYtDlpError(stderr) {
  const s = String(stderr || '');
  if (/Video unavailable|This video is (not available|unavailable)|is unavailable/i.test(s)) return 'Vídeo indisponível.';
  if (/Private video/i.test(s)) return 'Vídeo privado.';
  if (/Sign in to confirm your age|age-restricted|inappropriate for some users/i.test(s))
    return 'Vídeo com restrição de idade.';
  if (/not a bot|Sign in to confirm you.re not a bot|HTTP Error 429|Too Many Requests|HTTP Error 403/i.test(s))
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

// Flag transitório de anti-bot/rate-limit (pode ceder com espera maior)
function isBlockedError(err) {
  const s = String(err?.message || '') + '\n' + String(err?.stderr || '');
  return /not a bot|Sign in to confirm you.re not a bot|HTTP Error 429|Too Many Requests|HTTP Error 403|quota|rate-?limit/i.test(s);
}
// Falha de autenticação/cookies (ex.: cookies expirados, inválidos, corrompidos)
function isAuthFailure(err) {
  const s = String(err?.message || '') + '\\n' + String(err?.stderr || '');
  return /Invalid cookies|Failed to parse cookies|cookies are not valid|cookie.*expired|cookie.*invalid|Netscape.*cookies|could not load cookies|Unable to parse|cookie-audit|invalid or expired cookies/i.test(s);
}


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
    // Cookies do YouTube (opcional: formato Netscape; nunca logar o conteúdo).
    const cookiesFile = resolveCookiesFile();
    console.log(`[YT-DLP] Cookies disponíveis: ${cookiesFile ? 'sim' : 'não'}`);
    const args = [
      ...ytdlp.base,
      '--no-playlist',
      '--no-warnings',
      '--no-progress',
      '--socket-timeout',
      '30',
      '--retries',
      '1',
      '--max-filesize',
      String(MAX_BYTES),
      // Estratégias anti-bloqueio do yt-dlp para IPs de datacenter
      '--extractor-retries',
      '1',
      '--retry-sleep',
      '2',
      // Sem --user-agent global: cada player_client precisa do UA correto
      // (ex.: web espera UA de navegador; android espera UA mobile). O yt-dlp
      // seleciona o UA certo por client quando não é forçado — forçar um único
      // UA global causava clientes web/mweb serem tratados como bot.
      ...jsRuntimeArgs(),
      ...(YTDLP_SLEEP_REQUESTS ? ['--sleep-requests', String(YTDLP_SLEEP_REQUESTS)] : []),
      ...(YTDLP_FORCE_IPV4 ? ['--force-ipv4'] : []),
      ...(YTDLP_PROXY ? ['--proxy', YTDLP_PROXY] : []),
      ...(cookiesFile ? ['--cookies', cookiesFile] : []),
      ...(YTDLP_IMPERSONATE ? ['--impersonate', YTDLP_IMPERSONATE] : []),
      ...extraArgs,
      ...(await ffmpegLocationArgs()),
      '-o',
      path.join(dir, outTemplate),
      '--print-json',
      `https://www.youtube.com/watch?v=${videoId}`
    ];
    // Log de diagnóstico do ambiente (sem expor cookies/tokens/segredos) — assíncrono.
    // getPublicIp() pode levar até 8s na primeira chamada; logar não bloqueia o download.

    const logPublicIpLater = async (ffmpegPathCached, cookiesFileCached, ytdlpVersion, poTokenCached, runtimeCached) => {
      const publicIp = await getPublicIp().catch(() => null);
      console.log(
        `[PLAY] Configuração: yt-dlp ${ytdlpVersion || '(detectado)'} | ` +
        `ffmpeg ${ffmpegPathCached || 'ausente'} | ` +
        `js-runtime ${runtimeCached || 'node (padrão)'} | ` +
        `cookies ${cookiesFileCached ? 'sim' : 'não'} | ` +
        `po-token ${poTokenCached ? 'configurado' : 'não'} | ` +
        `ip ${publicIp || 'indisponível'}`
      );
    };
    // Fire-and-forget: o download não espera o log (economiza até 8s na 1ª chamada).
    void logPublicIpLater(ffmpegPath, cookiesFile, ytdlp.version, YTDLP_PO_TOKEN, process.env.YTDLP_JS_RUNTIME);
    // Tenta múltiplos player_clients até um funcionar (backoff maior em bloqueio transitório).
    // Ordem baseada no PO Token Guide oficial (yt-dlp 2026.08): sem PO token,
    // web_safari fornece HLS (m3u8) sem exigir GVS; mweb é o client recomendado
    // pelo próprio yt-dlp quando os defaults falham; web usa EJS (n-challenge; android_vr
    // não exige PO (mas não baixa "made for kids"); android exige GVS/player PO agora e
    // fica como último fallback (com PO opcional). CLIENTES 'tv'/'tv_embedded'/'ios' foram
    // removidos: exigem cookies de conta ou PO GVS e falham com "page needs to be reloaded".
    // Clientes: fila enxuta e preferida para baixa latência. web_safari
    // (HLS, sem GVS) resolve quase tudo; mweb e web como fallback.
    // android_vr/android exigem mais turnos (GVS/PO) e são lentos em IPs
    // flagrados — ficam só se o admin pedir via YTDLP_CLIENTS (override).
    const defaultClients = ['web_safari', 'mweb', 'web'];
    const clients = process.env.YTDLP_CLIENTS
      ? process.env.YTDLP_CLIENTS.split(',').map(s => s.trim()).filter(Boolean)
      : defaultClients;
    let stdout = null;
    let lastErr = null;
    let sawBlocked = false;
    let sawAuthFail = false;
    const deadlineStart = Date.now();
    // Fallback controlado de cookies: se a 1ª passada (com cookies) falhar por bloqueio
    // ou autenticação, uma ÚNICA 2ª passada é feita sem cookies (nunca loop).
    const maxPasses = cookiesFile ? 2 : 1;
    for (let pass = 0; pass < maxPasses; pass++) {
      // 2ª passada: remove o par `--cookies <arquivo>` dos argumentos (fallback).
      const passArgs = pass === 1 ? args.filter((a, i) => a !== '--cookies' && !(args[i - 1] === '--cookies')) : args;
      if (pass === 1) {
        console.log('[YT-DLP] Cookies configurados, mas a autenticação não foi aceita — tentativa controlada sem cookies.');
      }
      const clientList = pass === 1 ? ['web_safari', 'mweb', 'web'] : clients;
      for (const client of clientList) {
        const remaining = YTDLP_DEADLINE - (Date.now() - deadlineStart);
        if (remaining <= 1000) {
          if (!lastErr) lastErr = new Error('Download expirou (deadline total atingida)');
          break;
        }
        const attemptTimeout = Math.min(YTDLP_TIMEOUT, remaining);
        // PO Token opcional (somente se o administrador configurou um provider compatível);
        // quando ausente, nenhum po_token é enviado—o fluxo padrão não precisa dele.




        const poSuffix = YTDLP_PO_TOKEN ? `,po_token=${YTDLP_PO_TOKEN}` : '';
        const argsWithClient = [...passArgs, '--extractor-args', `youtube:player_client=${client}${poSuffix}`];
        try {
          const result = await runProcess(ytdlp.cmd, argsWithClient, attemptTimeout);
          stdout = result.stdout;
          console.log(`[youtube] yt-dlp sucesso com client=${client}`);
          break;
        } catch (err) {
          lastErr = err;
          // Bloqueio/rate-limit costuma ser transitório: espera mais longa antes do próximo client
          const blocked = isBlockedError(err);
          if (blocked) {
            sawBlocked = true;
            console.error(`[YT-DLP] YouTube retornou CAPTCHA/rate limit(client=${client}).`);
          }
          if (isAuthFailure(err)) {
            sawAuthFail = true;
            console.error(`[YT-DLP] Falha na autenticação via cookies(client=${client}).`);
          }
          if (!blocked && !isAuthFailure(err)) {
            console.error(`[youtube] yt-dlp client=${client} falhou: ${err?.message || 'erro desconhecido'}`);
          }
          const delayMs = !cookiesFile ? (blocked ? 1500 : 400) : (blocked ? 1500 : 400);
          if (clientList.indexOf(client) < clientList.length - 1) {
            await new Promise(res => setTimeout(res, delayMs));
          }
        }
      }
      if (stdout) break;
      // Só tenta a 2ª passada se houve sinal de bloqueio/autenticação (não em erros triviais).
      if (cookiesFile && pass === 0 && !(sawBlocked || sawAuthFail)) break;
    }
    if (!stdout) {
      if (lastErr?.stderr) console.error('[PLAY] yt-dlp stderr final:', lastErr.stderr.slice(-500));
      if (sawAuthFail) console.error('[YT-DLP] Falha na autenticação via cookies.');
      console.error(`[PLAY] yt-dlp error: ${lastErr?.message || 'Todos os player_clients falharam'}`);
      throw lastErr || new Error('Todos os player_clients falharam');
    }
    return { dir, meta: parsePrintJson(stdout) };
  } catch (err) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw err;
  }
}

// ---------- search (yt-search, dependência já existente) ----------

async function search(query) {
  try {
    const q = String(query || '').trim();
    const ql = q.toLowerCase();
    const cached = searchCacheGet(ql);
    if (cached) return { ok: true, data: cached.data };

    const r = await yts(q);
    const video = r?.videos?.[0];
    if (!video) {
      return { ok: false, msg: 'Nenhum vídeo encontrado' };
    }

    const data = {
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
    };
    searchCacheSet(ql, data);
    return { ok: true, data };
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
    const cacheKey = `${videoId}@${br}`;
    const cached = mp3CacheGet(cacheKey);
    if (cached) {
      console.log(`[PLAY] Cache hit: ${cached.title} (id=${videoId}, ${br}k)`);
      const hit = { ok: true, ...cached, buffer: cached.buffer };
      return hit;
    }
    console.log(`[PLAY] Iniciando yt-dlp: ${url} (id=${videoId})`);

    const dl = await ytdlpDownload(
      videoId,
      [
        '-f',
        // Fonte menor e mais rápida de converter: prefere m4a (AAC) ≤128k;
        // fallback: m4a, depois opus/webm ≤128k, depois qualquer melhor.
        // (antes: bestaudio — áudio de alta qualidade, download +5MB e
        //  transcodificação mais lenta para MP3, custando ~3-5s extras)
        'bestaudio[ext=m4a][abr<=128]/bestaudio[ext=m4a]/bestaudio[abr<=128]/bestaudio',
        '-x',
        '--audio-format',
        'mp3',
        '--audio-quality',
        `${br}K`
      ],
      'audio.%(ext)s'
    );
    dir = dl.dir;
    console.log(`[PLAY] Download concluído: ${dl.meta?.title || ''} (${dir})`);

    const buffer = readOutputFile(dir, 'mp3');
    console.log(`[PLAY] Conversão concluída: MP3 ${(buffer.length / 1024 / 1024).toFixed(2)} MB`);
    const title = dl.meta?.title || 'YouTube';
    const thumbnail =
      dl.meta?.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

    const result = { title, thumbnail, filename: safeFilename(title, 'mp3') };
    mp3CacheSet(cacheKey, { ...result, buffer });
    return { ok: true, ...result, buffer };
  } catch (err) {
    const ip = isBlockedError(err) ? await getPublicIp().catch(() => null) : null;
    const base = 'Erro ao baixar música: ' + err.message;
    if (!ip) return { ok: false, msg: base };

    return {
      ok: false,
      msg: base +
        `\n\n🌐 IP do servidor: ${ip}\n\n` +
        'Se este IP for de datacenter/VPS, o YouTube pode bloqueá-lo temporariamente ' +
        '(comum em 403/not-a-bot). Opções para resolver:\n' +
        `• cookies de navegador (YOUTUBE_COOKIES_FILE)\n` +
        '• PO Token provider (YTDLP_PO_TOKEN)\n' +
        '— veja o .env.example.'
    };
  } finally {
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
      console.log(`[PLAY] Arquivo removido: ${dir}`);
    }
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
    const ip =isBlockedError(err) ? await getPublicIp().catch(() => null) : null;
    const base = 'Erro ao baixar vídeo: ' + err.message;
    if (!ip) return { ok: false, msg: base };

    return {
      ok: false,
      msg: base +
        `\n\n🌐 IP do servidor: ${ip}\n\n` +
        'Se este IP for de datacenter/VPS, o YouTube pode bloqueá-lo temporariamente ' +
        '(comum em 403/not-a-bot). Opções para resolver:\n' +
        `• cookies de navegador (YOUTUBE_COOKIES_FILE)\n` +
        '• PO Token provider (YTDLP_PO_TOKEN)\n' +
        '— veja o .env.example.'
    };
  } finally {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
}

export { search, mp3, mp4 };
export const ytmp3 = mp3;
export const ytmp4 = mp4;