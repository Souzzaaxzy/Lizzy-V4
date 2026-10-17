/**
 * Resolve um LINK (YouTube e afins) para a transmissao do `!midiap`.
 *
 * ## Por que existe
 *
 * O `!midiap` aceita tres fontes, nenhuma usando disco: ARQUIVO, FLUXO (o
 * video baixado do WhatsApp) e **LINK**. Este modulo cuida da terceira.
 *
 * ## Por que yt-dlp e nao o ffmpeg lendo a URL
 *
 * Medido: o YouTube **nao oferece formato muxado** (video+audio no mesmo
 * arquivo) -- tudo vem separado, em DASH. O ffmpeg teria de abrir DUAS URLs e
 * muxar, e as URLs do `googlevideo` exigem os cabecalhos que o yt-dlp sabe
 * montar (senao 403). Entao quem fala com o YouTube e' o **yt-dlp**, que ja'
 * e' requisito do bot (`!play`) e sabe muxar sozinho.
 *
 * ## O que o yt-dlp entrega (DOIS streams, nao um muxado)
 *
 * O `-o -` manda o formato pedido no stdout, que vira o `pipe:0` do ffmpeg --
 * o arquivo nunca existe. O `--print` junto do `-g` informa o **fps** numa
 * chamada so', sem baixar nada.
 *
 * ## Por que DOIS yt-dlp (video e audio separados)
 *
 * O jeito "obvio" seria pedir `bv*+ba` e deixar o yt-dlp muxar. **Medido:
 * isso nao funciona** -- o merge do yt-dlp chama o ffmpeg com as duas URLs do
 * `googlevideo` e o processo morre com `SIGSEGV` (exit -11), devolvendo
 * **zero byte** no stdout. O nosso ffmpeg entao recebe um pipe vazio e sai com
 * `183` (*Invalid data found when processing input*) -- era exatamente o erro
 * que o usuario via.
 *
 * O downloader **nativo** do yt-dlp (sem ffmpeg) e' estavel: ele escreve o
 * MP4/M4A no stdout sem problema. Entao rodamos **dois** yt-dlp -- um para o
 * video, outro para o audio -- e quem muxa e' o **nosso** ffmpeg, lendo os
 * dois pipes. Nada toca o disco.
 *
 * ## Sem disco, mas com uma espera
 *
 * O yt-dlp precisa baixar do YouTube enquanto o ffmpeg le. Como o `-re` do
 * ffmpeg controla o ritmo, o yt-dlp tende a baixar mais rapido que o consumo
 * e o buffer da rede segura -- mas nos primeiros segundos o video pode
 * engasgar enquanto o buffer enche.
 */

import { spawn } from 'child_process';
import os from 'os';

/** fps de reserva quando o yt-dlp nao informa. */
const FPS_PADRAO = 15;

/** Teto de altura (o mesmo do encoder; pedir mais so' gasta banda). */
const ALTURA_MAX = Number.parseInt(process.env.MIDIAP_ALTURA || '720', 10);

let ytdlpResolvido = null;

/**
 * Acha o `yt-dlp` (o mesmo caminho que o `youtube.js` usa).
 *
 * @returns {Promise<{cmd: string, base: string[]}|null>}
 */
export async function acharYtDlp() {
  if (ytdlpResolvido) return ytdlpResolvido;
  const home = os.homedir();
  const candidatos = [];
  if (process.env.YTDLP_PATH) candidatos.push({ cmd: process.env.YTDLP_PATH, base: [] });
  candidatos.push({ cmd: 'yt-dlp', base: [] });
  // Caminhos de instalacao userspace (pip --user / pipx), comuns em
  // Pterodactyl, onde o PATH do Node nao inclui ~/.local/bin.
  candidatos.push({ cmd: `${home}/.local/bin/yt-dlp`, base: [] });
  candidatos.push({ cmd: '/home/container/.local/bin/yt-dlp', base: [] });
  candidatos.push({ cmd: '/root/.local/bin/yt-dlp', base: [] });
  candidatos.push({ cmd: '/usr/local/bin/yt-dlp', base: [] });
  candidatos.push({ cmd: 'python3', base: ['-m', 'yt_dlp'] });
  candidatos.push({ cmd: 'python', base: ['-m', 'yt_dlp'] });

  for (const c of candidatos) {
    try {
      const ok = await new Promise((resolve) => {
        const p = spawn(c.cmd, [...c.base, '--version'], { stdio: 'ignore' });
        p.on('error', () => resolve(false));
        p.on('close', (code) => resolve(code === 0));
      });
      if (ok) {
        ytdlpResolvido = c;
        return c;
      }
    } catch { /* tenta o proximo */ }
  }
  return null;
}

/** Os argumentos comuns (mesmos nos dois processos). */
function baseDoLink() {
  return ['--no-progress', '--no-warnings', '--no-playlist', '-o', '-'];
}

/**
 * O seletor do VIDEO.
 *
 * Prefere MP4/H.264 (o que o encoder do bot espera) dentro do teto de altura;
 * se nao houver, aceita qualquer video dentro do teto. NAO pede merge -- o
 * audio vem de outro processo (ver o cabecalho do modulo).
 *
 * @returns {string}
 */
export function formatoDoVideo() {
  return `bv*[height<=${ALTURA_MAX}][ext=mp4][vcodec^=avc1]`
    + `/bv*[height<=${ALTURA_MAX}][ext=mp4]`
    + `/bv*[height<=${ALTURA_MAX}]`
    + `/b[height<=${ALTURA_MAX}]`;
}

/**
 * O seletor do AUDIO (so' a faixa, sem video).
 *
 * @returns {string}
 */
export function formatoDoAudio() {
  return 'ba[ext=m4a]/ba';
}

/**
 * Os argumentos do yt-dlp que mandam o VIDEO no stdout (sem audio).
 *
 * E' o downloader **nativo** do yt-dlp: nao passa pelo ffmpeg, entao nao sofre
 * o `SIGSEGV` do merge (ver o cabecalho do modulo). Nada de `--remux-video`
 * (post-processador trabalha em arquivo, nao em pipe).
 *
 * Mantido como `argumentosDoLink` para nao quebrar quem ja' chama (e o teste).
 *
 * @param {string} url
 * @returns {string[]}
 */
export function argumentosDoLink(url) {
  return [...baseDoLink(), '-f', formatoDoVideo(), url];
}

/**
 * Os argumentos do yt-dlp que mandam o AUDIO no stdout.
 *
 * @param {string} url
 * @returns {string[]}
 */
export function argumentosDoAudio(url) {
  return [...baseDoLink(), '-f', formatoDoAudio(), url];
}

/**
 * O fps do link, sem baixar o video.
 *
 * O `--print` junto do `-g` faz o yt-dlp imprimir o dado pedido E a URL, numa
 * resolucao so'. Aqui so' o fps interessa.
 *
 * @param {string} url
 * @returns {Promise<number>} o fps, ou o padrao se nao der para saber
 */
export async function fpsDoLink(url) {
  const yt = await acharYtDlp();
  if (!yt) return FPS_PADRAO;
  try {
    const saida = await new Promise((resolve, reject) => {
      const p = spawn(yt.cmd, [
        ...yt.base, '--no-progress', '--no-warnings', '--no-playlist',
        '-f', `bv*[height<=${ALTURA_MAX}]/b`,
        '--print', '%(fps)s',
        '-g', url
      ], { stdio: ['ignore', 'pipe', 'ignore'] });
      let out = '';
      p.stdout.on('data', (c) => { out += c; });
      p.on('error', reject);
      p.on('close', () => resolve(out));
    });
    // A 1a linha e' o fps; as seguintes sao as URLs.
    const fps = Number.parseInt(String(saida).split('\n')[0], 10);
    if (!Number.isFinite(fps) || fps <= 0) return FPS_PADRAO;
    return Math.min(fps, 60);
  } catch {
    return FPS_PADRAO;
  }
}

/**
 * Sobe os DOIS yt-dlp (video e audio) entregando cada stream no stdout.
 *
 * Sao dois processos porque o merge do yt-dlp quebra (SIGSEGV); quem muxa e'
 * o ffmpeg do bot, lendo os dois pipes. Nada vai para o disco.
 *
 * @param {string} url
 * @returns {{proc: object|null, procAudio: object|null, motivo?: string, detalhe?: string}}
 */
export async function abrirLink(url) {
  const yt = await acharYtDlp();
  if (!yt) {
    return { proc: null, procAudio: null, motivo: 'ytdlp_ausente', detalhe: 'yt-dlp nao encontrado no servidor' };
  }
  try {
    const subir = (args) => {
      const p = spawn(yt.cmd, [...yt.base, ...args], {
        stdio: ['ignore', 'pipe', 'pipe']
      });
      p.on('error', () => { /* o `close` do ffmpeg trata */ });
      // Guarda o stderr: e' dele que sai o motivo real quando o yt-dlp falha.
      p._stderr = '';
      p.stderr?.on('data', (c) => { p._stderr = (p._stderr + c.toString()).slice(-800); });
      return p;
    };
    const proc = subir(argumentosDoLink(url));
    const procAudio = subir(argumentosDoAudio(url));
    return { proc, procAudio };
  } catch (e) {
    return { proc: null, procAudio: null, motivo: 'falha_ao_abrir_link', detalhe: e?.message || String(e) };
  }
}

/**
 * O motivo legivel de uma falha do yt-dlp.
 *
 * O yt-dlp morre por VARIOS motivos (formato indisponivel, bloqueio, rede) e
 * o stderr diz qual. Sem isto o ffmpeg so' reporta o sintoma (pipe vazio).
 *
 * @param {string} stderr
 * @returns {string}
 */
export function motivoDoYtdlp(stderr = '') {
  const e = String(stderr);
  if (/Requested format is not available/i.test(e)) {
    return 'O vídeo não tem um formato compatível. Tente outro link.';
  }
  if (/Sign in to confirm|not a bot|cookies/i.test(e)) {
    return 'O YouTube pediu verificação. Tente outro vídeo.';
  }
  if (/Private video|unavailable|removed|does not exist/i.test(e)) {
    return 'O vídeo não está disponível (privado, removido ou restrito).';
  }
  if (/Unable to download|HTTP Error|timed out|Connection/i.test(e)) {
    return 'Falha de rede ao abrir o vídeo. Tente de novo.';
  }
  return '';
}
