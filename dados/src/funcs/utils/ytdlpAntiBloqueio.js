/**
 * Anti-bloqueio do YouTube para o `yt-dlp` — a MESMA receita do `!play`.
 *
 * ## Por que existe (em vez de cada modulo ter a sua)
 *
 * O `!play` (youtube.js) e o `!midiap` (midiapLink.js) falam com o YouTube pelo
 * mesmo binario (`yt-dlp`) e sofrem o MESMO bloqueio: *"Sign in to confirm
 * you're not a bot"*. Antes cada um montava os proprios argumentos -- e o
 * `!midiap` nao mandava **nada** disso, entao caia no bloqueio que o `!play` ja'
 * sabia contornar. Aqui a receita vive num lugar so'.
 *
 * ## O que o YouTube moderno exige (medido, nao suposto)
 *
 * 1. **Runtime JS** (`--js-runtimes`): sem ele o yt-dlp avisa
 *    *"No supported JavaScript runtime could be found... some formats may be
 *    missing"* e nao resolve o desafio `n` da assinatura -- resultado: formatos
 *    vazios ou `Sign in to confirm you're not a bot`. Usamos o **proprio Node
 *    do bot** (zero dependencia nova).
 * 2. **Solver de desafios (EJS)** (`--remote-components ejs:github`): o yt-dlp
 *    baixa os scripts oficiais do projeto e resolve o desafio em JS. Cacheia
 *    em `~/.cache/yt-dlp/challenge-solver`.
 * 3. **Cookies** (`--cookies`, formato Netscape): um `cookies.txt` do proprio
 *    usuario (exportado do navegador) resolve o bloqueio de forma definitiva.
 *    Opcional: sem o arquivo, o fluxo segue (e o fallback sem cookies existe).
 * 4. **`player_client`**: o cliente anunciado muda o que o YouTube devolve.
 *    `web_safari` entrega HLS sem exigir PO token; `mweb` e' o recomendado pelo
 *    yt-dlp quando os defaults falham; `web` usa o EJS; `android_vr` nao exige
 *    PO; `android` fica por ultimo.
 *
 * ## Uso
 *
 * ```js
 * import { argumentosAntiBloqueio, clientesDoYoutube, semCookies } from './ytdlpAntiBloqueio.js';
 * const args = [...base, ...argumentosAntiBloqueio(), '-f', fmt, url];
 * for (const client of clientesDoYoutube()) { ... }
 * ```
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

/** Runtime JS do extractor (obrigatorio no YouTube moderno). Padrao: o Node do bot. */
const YTDLP_JS_RUNTIME = process.env.YTDLP_JS_RUNTIME || `node:${process.execPath}`;

/** Solver de desafios JS (EJS). O yt-dlp baixa do repositorio oficial e cacheia. */
const YTDLP_REMOTE_COMPONENTS = process.env.YTDLP_REMOTE_COMPONENTS || 'ejs:github';

/** Cookies do YouTube (Netscape). Opcional, nunca logado. */
const YOUTUBE_COOKIES_FILE = process.env.YOUTUBE_COOKIES_FILE || '';
const YTDLP_COOKIES_FILE = process.env.YTDLP_COOKIES_FILE || '';

/** PO Token opcional (so' quando o admin usa um provider real). */
const YTDLP_PO_TOKEN = process.env.YTDLP_PO_TOKEN || '';

/** Proxy opcional (ex.: `http://127.0.0.1:8080`). */
const YTDLP_PROXY = process.env.YTDLP_PROXY || '';

/** Pausa entre requisicoes (ajuda em IP de datacenter). */
const YTDLP_SLEEP_REQUESTS = parseInt(process.env.YTDLP_SLEEP_REQUESTS, 10);

/**
 * A ordem dos `player_client`, baseada no PO Token Guide oficial (yt-dlp 2026.08).
 *
 * `web_safari` primeiro: entrega HLS (m3u8) sem exigir GVS/PO token -- e' o
 * menos bloqueado em IP de datacenter. `mweb` e' o recomendado pelo proprio
 * yt-dlp quando os defaults falham. `android` fica por ultimo (exige GVS/PO).
 * `tv`/`tv_embedded`/`ios` NAO entram: exigem cookies de conta ou PO GVS e
 * falham com "page needs to be reloaded".
 *
 * @returns {string[]}
 */
export function clientesDoYoutube() {
  //  PRIMEIRO: medido, e' o unico cliente que entrega o par
  // video-only + audio-only por HTTPS (os nomeados dao 1 muxado de 360p ou
  // HLS -- e o HLS do yt-dlp grava cada fragmento em disco).
  return ['default', 'web_safari', 'mweb', 'web', 'android_vr', 'android'];
}

/** Os clientes da 2a passada (fallback sem cookies). */
export function clientesSemCookies() {
  return ['web_safari', 'mweb', 'web'];
}

/**
 * O arquivo de cookies do YouTube, se existir.
 *
 * Prioridade: `YOUTUBE_COOKIES_FILE` (novo) -> `YTDLP_COOKIES_FILE` (legado) ->
 * `data/youtube/cookies.txt` (padrao implicito). O caminho pode ser relativo ao
 * CWD (raiz do bot) ou absoluto.
 *
 * **Nunca** le nem imprime o conteudo: so' a existencia e' usada.
 *
 * @returns {string|null}
 */
export function resolveCookiesFile() {
  const candidatos = [];
  if (YOUTUBE_COOKIES_FILE) candidatos.push(YOUTUBE_COOKIES_FILE);
  if (YTDLP_COOKIES_FILE) candidatos.push(YTDLP_COOKIES_FILE);
  candidatos.push(path.join('data', 'youtube', 'cookies.txt'));
  try {
    for (const c of candidatos) {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
    }
  } catch { /* segue sem cookies */ }
  return null;
}

/** Ha' cookies configurados? (para decidir o fallback) */
export function temCookies() {
  return Boolean(resolveCookiesFile());
}

/**
 * SO' o runtime JS + solver de desafios (sem cookies, sem rede/proxy).
 *
 * Usado por quem monta os cookies em outro ponto da lista de argumentos.
 *
 * @returns {string[]}
 */
export function argumentosDoRuntime() {
  return ['--js-runtimes', YTDLP_JS_RUNTIME, '--remote-components', YTDLP_REMOTE_COMPONENTS];
}

/**
 * Os argumentos anti-bloqueio do `yt-dlp` (a receita do `!play`).
 *
 * @param {{ cookies?: boolean }} [opts] `cookies: false` remove o par
 *   `--cookies <arquivo>` (a 2a passada do fallback).
 * @returns {string[]}
 */
export function argumentosAntiBloqueio({ cookies = true } = {}) {
  const args = [
    // Runtime JS + solver de desafios (ver o cabecalho).
    '--js-runtimes', YTDLP_JS_RUNTIME,
    '--remote-components', YTDLP_REMOTE_COMPONENTS,
  ];
  if (YTDLP_SLEEP_REQUESTS) args.push('--sleep-requests', String(YTDLP_SLEEP_REQUESTS));
  if (process.env.YTDLP_DISABLE_IPV4 !== '1') args.push('--force-ipv4');
  if (YTDLP_PROXY) args.push('--proxy', YTDLP_PROXY);
  const arquivo = cookies ? resolveCookiesFile() : null;
  if (arquivo) args.push('--cookies', arquivo);
  return args;
}

/** Tira o par `--cookies <arquivo>` de uma lista (a 2a passada). */
export function semCookies(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--cookies') { i++; continue; }
    out.push(args[i]);
  }
  return out;
}

/**
 * O sufixo de `--extractor-args` para um `player_client` (+ PO token, se houver).
 *
 * @param {string} client
 * @returns {string}
 */
export function extractorArgsDoClient(client) {
  const po = YTDLP_PO_TOKEN ? `,po_token=${YTDLP_PO_TOKEN}` : '';
  return `youtube:player_client=${client}${po}`;
}

/**
 * Bloqueio/rate-limit (transitorio: pode ceder com espera).
 *
 * @param {string} texto stderr/mensagem
 * @returns {boolean}
 */
export function ehBloqueio(texto) {
  return /not a bot|Sign in to confirm you.re not a bot|HTTP Error 429|Too Many Requests|HTTP Error 403|quota|rate-?limit/i.test(String(texto || ''));
}

/**
 * Falha de autenticacao/cookies (expirados, invalidos, corrompidos).
 *
 * @param {string} texto
 * @returns {boolean}
 */
export function ehFalhaDeAuth(texto) {
  return /Invalid cookies|Failed to parse cookies|cookies are not valid|cookie.*expired|cookie.*invalid|Netscape.*cookies|could not load cookies|Unable to parse|cookie-audit|invalid or expired cookies/i.test(String(texto || ''));
}

/**
 * Ha' um runtime JS utilizavel? (diagnostico; nao bloqueia nada)
 *
 * @returns {{ runtime: string, ok: boolean, motivo: string }}
 */
export function estadoDoRuntime() {
  const rt = YTDLP_JS_RUNTIME;
  if (!rt) return { runtime: '', ok: false, motivo: 'nenhum runtime configurado' };
  const [nome, caminho] = rt.split(':');
  if (nome === 'node') {
    const alvo = caminho || process.execPath;
    try {
      if (fs.existsSync(alvo)) return { runtime: rt, ok: true, motivo: '' };
    } catch { /* cai no motivo abaixo */ }
    return { runtime: rt, ok: false, motivo: `node nao encontrado em ${alvo}` };
  }
  // Outros runtimes (deno/bun): nao validamos o caminho aqui.
  return { runtime: rt, ok: true, motivo: '' };
}

/**
 * A pasta de cache do yt-dlp (onde ficam o solver e as assinaturas).
 *
 * @returns {string}
 */
export function cacheDoYtdlp() {
  return process.env.YTDLP_CACHE_DIR || path.join(os.homedir(), '.cache', 'yt-dlp');
}
