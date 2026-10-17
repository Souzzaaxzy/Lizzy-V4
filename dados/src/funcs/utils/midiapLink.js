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
 * ## O que o yt-dlp entrega
 *
 * `-o -` manda o video MUXADO no stdout, que vira o `pipe:0` do ffmpeg -- o
 * arquivo nunca existe. O `--print` junto do `-g` informa o **fps** numa
 * chamada so', sem baixar nada.
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

/**
 * Os argumentos do yt-dlp para mandar o video muxado no stdout.
 *
 * `-f` prefere um formato que JA' tenha video e audio juntos; o YouTube nao
 * tem, entao cai no merge (`bv*+ba`) -- que o yt-dlp faz com o ffmpeg,
 * STREAMANDO para o stdout (o `FFmpegFD`), sem arquivo temporario.
 *
 * NAO usar `--remux-video`: ele e' um POST-PROCESSADOR, e esses trabalham
 * em ARQUIVO (gravam `<nome>.temp.mp4` e renomeiam). Como o alvo e' um pipe,
 * o remux nao se aplica -- e era ele que podia gravar em disco num servidor
 * apertado. O container ja' vem mp4 pelo proprio `-f`.
 *
 * ## O `--ffmpeg-location` e' OBRIGATORIO (era o bug do exit 183)
 *
 * Medido: sem ele o yt-dlp NAO acha o ffmpeg, entao nao consegue muxar os
 * formatos separados do YouTube. Nesse caso ele avisa *"the formats will be
 * streamed one after the other"* e manda video e audio **um atras do outro**
 * no stdout -- dado invalido para o ffmpeg, que morre com
 * `Invalid data found when processing input` (exit **183**).
 *
 * Passar o caminho do ffmpeg faz o yt-dlp usar o `FFmpegFD`, que muxa
 * STREAMANDO direto para o stdout -- um arquivo valido, e sem disco.
 *
 * @param {string} url
 * @returns {string[]}
 */
export function argumentosDoLink(url) {
  const args = ['--no-progress', '--no-warnings', '--no-playlist'];
  // O yt-dlp precisa do ffmpeg para MUXAR (ver a doc acima). Passamos SEMPRE,
  // com o mesmo fallback do resto do bot (FFMPEG_PATH ou 'ffmpeg' no PATH):
  // sem a flag o yt-dlp manda os formatos em sequencia e o ffmpeg morre com 183.
  args.push('--ffmpeg-location', process.env.FFMPEG_PATH || 'ffmpeg');
  args.push(
    // Prefere muxado; senao o melhor video + melhor audio (o yt-dlp muxa).
    '-f', `b[height<=${ALTURA_MAX}]/bv*[height<=${ALTURA_MAX}]+ba/b`,
    // Um arquivo so' no stdout: o ffmpeg le como pipe:0.
    '-o', '-',
    url
  );
  return args;
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
 * Sobe o yt-dlp entregando o video no stdout (o `pipe:0` do ffmpeg).
 *
 * @param {string} url
 * @returns {{proc: object|null, motivo?: string, detalhe?: string}}
 */
export async function abrirLink(url) {
  const yt = await acharYtDlp();
  if (!yt) {
    return { proc: null, motivo: 'ytdlp_ausente', detalhe: 'yt-dlp nao encontrado no servidor' };
  }
  try {
    const proc = spawn(yt.cmd, [...yt.base, ...argumentosDoLink(url)], {
      stdio: ['ignore', 'pipe', 'ignore']
    });
    proc.on('error', () => { /* o `close` do ffmpeg trata */ });
    return { proc };
  } catch (e) {
    return { proc: null, motivo: 'falha_ao_abrir_link', detalhe: e?.message || String(e) };
  }
}
