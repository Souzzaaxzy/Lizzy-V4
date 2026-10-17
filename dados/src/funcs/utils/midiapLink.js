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
import {
  argumentosAntiBloqueio, clientesDoYoutube, clientesSemCookies,
  extractorArgsDoClient, ehBloqueio, ehFalhaDeAuth, resolveCookiesFile,
  semCookies,
} from './ytdlpAntiBloqueio.js';

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
  return [
    '--no-progress', '--no-warnings', '--no-playlist',
    // A MESMA receita anti-bloqueio do `!play`: runtime JS + solver EJS +
    // cookies. Sem isto o YouTube responde "Sign in to confirm you're not a
    // bot" e nenhum formato e' liberado (era o erro relatado no !midiap).
    ...argumentosAntiBloqueio(),
    '-o', '-',
  ];
}

/**
 * O seletor do VIDEO.
 *
 * ## O `protocol^=https` e' OBRIGATORIO (senao o yt-dlp grava em disco)
 *
 * MEDIDO: com `player_client=web_safari` o YouTube oferece 720p+ **so' por
 * HLS** (`m3u8_native`). O downloader de HLS do yt-dlp **grava cada fragmento
 * em arquivo** no CWD (`--Frag16.part`) antes de remontar -- ou seja, o video
 * INTEIRO passava pelo disco. Medido: 13,4 MB escritos pelo yt-dlp.
 *
 * Exigindo `protocol^=https` o yt-dlp usa o downloader nativo (HTTP), que
 * escreve **direto no stdout**, sem arquivo. O cliente DEFAULT oferece 22
 * formatos video-only em HTTPS (ate' 3840p) + audio-only -- e' o unico que da'
 * o par video/audio separado em HTTPS; os clientes nomeados entregam 1 muxado
 * de 360p ou HLS.
 *
 * Prefere MP4/H.264 (o que o encoder do bot espera), depois qualquer video
 * HTTPS dentro do teto. NAO pede merge -- o audio vem de outro processo.
 *
 * @returns {string}
 */
export function formatoDoVideo() {
  return `bv*[height<=${ALTURA_MAX}][protocol^=https][ext=mp4][vcodec^=avc1]`
    + `/bv*[height<=${ALTURA_MAX}][protocol^=https][ext=mp4]`
    + `/bv*[height<=${ALTURA_MAX}][protocol^=https]`
    + `/bv*[height<=${ALTURA_MAX}]`;
}

/**
 * O seletor do AUDIO (so' a faixa, sem video).
 *
 * Tambem exige HTTPS (mesma razao do video: HLS grava em disco).
 *
 * @returns {string}
 */
export function formatoDoAudio() {
  return 'ba[protocol^=https][ext=m4a]/ba[protocol^=https]/ba';
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
 * O `--print` faz o yt-dlp imprimir o dado pedido; o `--simulate` evita
 * baixar qualquer byte.
 *
 * ## Por que usa a MESMA receita e o MESMO seletor do download
 *
 * Medido: um `--print` "pelado" (sem runtime JS/EJS) **falha em IP
 * bloqueado** -- era o caso do servidor do dono. Sem o dado, o chamador caia
 * no fps de reserva, e o `-r` do encoder **descartava 40% dos frames** (um
 * video de 25 fps tocando a 15). O sintoma e' exatamente o "pulo de frames".
 *
 * Por isso aqui vao: a receita anti-bloqueio (runtime JS + EJS + cookies) e o
 * **mesmo `formatoDoVideo()`** que o download usa -- se o seletor divergisse,
 * o fps poderia ser de OUTRO formato (ex.: o HLS de 60 fps) e o encoder
 * duplicaria/descartaria de novo.
 *
 * @param {string} url
 * @returns {Promise<number>} o fps, ou o padrao se nao der para saber
 */
export async function fpsDoLink(url) {
  const yt = await acharYtDlp();
  if (!yt) return FPS_PADRAO;
  try {
    const saida = await new Promise((resolve, reject) => {
      // NAO usa o `baseDoLink()` aqui: ele traz o `-o -` (destino stdout), e
      // com ele o yt-dlp manda o `--print` para o **stderr**, deixando o
      // stdout VAZIO. Medido:
      //     STDOUT = ""      <- era daqui que o codigo lia
      //     STDERR = "25"    <- o fps estava aqui
      // Resultado: o fps caia sempre no de reserva, o encoder forcava `-r`
      // com o valor errado e o video PULAVA quadros.
      // Aqui so' queremos o valor impresso: nada de `-o`, e lemos os DOIS
      // fluxos por seguranca (o yt-dlp muda o destino conforme a versao).
      const p = spawn(yt.cmd, [
        ...yt.base,
        '--no-progress', '--no-warnings', '--no-playlist',
        ...argumentosAntiBloqueio(),
        '--simulate',
        '-f', formatoDoVideo(),
        '--print', '%(fps)s',
        url
      ], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      p.stdout.on('data', (c) => { out += c; });
      p.stderr.on('data', (c) => { err += c; });
      p.on('error', reject);
      p.on('close', () => resolve(out.trim() ? out : err));
    });
    // O `--print` imprime so' o valor; procuramos o primeiro inteiro util
    // (o stderr pode trazer avisos antes da linha do fps).
    for (const linha of String(saida).split('\n')) {
      const n = Number.parseInt(linha.trim(), 10);
      if (Number.isFinite(n) && n > 0) return Math.min(n, 60);
    }
    return FPS_PADRAO;
  } catch {
    return FPS_PADRAO;
  }
}

/**
 * Roda uma resolucao curta do yt-dlp para descobrir se o cliente e' aceito.
 *
 * Usa `--simulate` (nao baixa nada) so' para validar a extracao. Serve para
 * escolher o `player_client` ANTES de subir os dois processos de download --
 * assim um bloqueio e' detectado sem gastar banda.
 *
 * @param {{cmd: string, base: string[]}} yt
 * @param {string} url
 * @param {string[]} extraArgs
 * @param {number} timeoutMs
 * @returns {Promise<{ok: boolean, stderr: string}>}
 */
function validarExtracao(yt, url, extraArgs, timeoutMs = 45000) {
  return new Promise((resolve) => {
    const p = spawn(yt.cmd, [...yt.base, '--no-warnings', '--no-playlist', '--simulate', ...extraArgs, url], {
      stdio: ['ignore', 'ignore', 'pipe']
    });
    let err = '';
    p.stderr?.on('data', (c) => { err = (err + c.toString()).slice(-1200); });
    const t = setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* ok */ } }, timeoutMs);
    p.on('error', () => { clearTimeout(t); resolve({ ok: false, stderr: String(err) }); });
    p.on('close', (code) => { clearTimeout(t); resolve({ ok: code === 0, stderr: err }); });
  });
}

/**
 * Sobe os DOIS yt-dlp (video e audio) entregando cada stream no stdout.
 *
 * Sao dois processos porque o merge do yt-dlp quebra (SIGSEGV); quem muxa e'
 * o ffmpeg do bot, lendo os dois pipes. Nada vai para o disco.
 *
 * ## Anti-bloqueio (a receita do `!play`)
 *
 * O YouTube responde *"Sign in to confirm you're not a bot"* em IP de
 * datacenter. O `!play` ja' contornava isso com runtime JS + EJS + cookies +
 * `player_client`; aqui usamos a MESMA receita (modulo `ytdlpAntiBloqueio`),
 * com a mesma escada de clientes e a mesma 2a passada sem cookies.
 *
 * @param {string} url
 * @param {(msg: string) => void} [log]
 * @returns {Promise<{proc: object|null, procAudio: object|null, motivo?: string, detalhe?: string, client?: string}>}
 */
export async function abrirLink(url, log = () => {}) {
  const yt = await acharYtDlp();
  if (!yt) {
    return { proc: null, procAudio: null, motivo: 'ytdlp_ausente', detalhe: 'yt-dlp nao encontrado no servidor' };
  }
  const subir = (args) => {
    const p = spawn(yt.cmd, [...yt.base, ...args], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    p.on('error', () => { /* o `close` do ffmpeg trata */ });
    // Guarda o stderr: e' dele que sai o motivo real quando o yt-dlp falha.
    p._stderr = '';
    p.stderr?.on('data', (c) => { p._stderr = (p._stderr + c.toString()).slice(-1200); });
    return p;
  };

  const temCk = Boolean(resolveCookiesFile());
  log(`cookies: ${temCk ? 'sim' : 'nao'}`);
  const passadas = temCk ? [{ cookies: true }, { cookies: false }] : [{ cookies: true }];
  // O DEFAULT vem PRIMEIRO: medido, e' o unico que entrega video-only E
  // audio-only por HTTPS (os nomeados dao 1 muxado de 360p ou HLS -- e o HLS
  // grava `.part` no disco). Os nomeados ficam como fallback.
  const clientes = clientesDoYoutube();
  let ultimoErro = '';

  for (let i = 0; i < passadas.length; i++) {
    const p = passadas[i];
    const lista = i === 0 ? clientes : clientesSemCookies();
    if (i === 1) log('cookies recusados — tentando sem eles');
    for (const client of lista) {
      // `baseDoLink` ja' traz os cookies; na 2a passada o par e' removido.
      // O cliente `default` NAO leva `--extractor-args` (e' o comportamento
      // padrao do yt-dlp; forcá-lo por nome muda o que o YouTube devolve).
      const extra = client === 'default' ? [] : ['--extractor-args', extractorArgsDoClient(client)];
      const argsBase = [...baseDoLink(), ...extra];
      const argsSemCk = p.cookies ? argsBase : semCookies(argsBase);
      const teste = await validarExtracao(yt, url, argsSemCk);
      if (teste.ok) {
        log(`player_client=${client}${p.cookies ? '' : ' (sem cookies)'}`);
        try {
          const comFmt = (a, formato) => [...a, '-f', formato, url];
          const proc = subir(comFmt(argsSemCk, formatoDoVideo()));
          const procAudio = subir(comFmt(argsSemCk, formatoDoAudio()));
          return { proc, procAudio, client };
        } catch (e) {
          return { proc: null, procAudio: null, motivo: 'falha_ao_abrir_link', detalhe: e?.message || String(e) };
        }
      }
      ultimoErro = teste.stderr || ultimoErro;
      log(`player_client=${client} recusado${ehBloqueio(teste.stderr) ? ' (bloqueio)' : ''}`);
      if (ehFalhaDeAuth(teste.stderr) && p.cookies && i === 0) break; // pula p/ 2a passada
    }
    // So' tenta sem cookies se houve sinal de bloqueio/autenticacao.
    if (!(ehBloqueio(ultimoErro) || ehFalhaDeAuth(ultimoErro))) break;
  }

  return {
    proc: null, procAudio: null,
    motivo: 'extracao_recusada',
    detalhe: ultimoErro.trim().split('\n').filter(Boolean).slice(-1)[0] || 'nenhum cliente do YouTube aceitou a extracao',
  };
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
  if (/Sign in to confirm|not a bot/i.test(e)) {
    return 'O YouTube pediu verificação (bloqueio de IP). Configure os cookies do YouTube ou tente mais tarde.';
  }
  if (/cookies|Invalid cookies|Failed to parse cookies/i.test(e)) {
    return 'Os cookies do YouTube não foram aceitos. Verifique o arquivo de cookies.';
  }
  if (/No supported JavaScript runtime|js-runtime|EJS|remote-components/i.test(e)) {
    return 'Falta o runtime JS/solver do yt-dlp no servidor (atualize o yt-dlp).';
  }
  if (/Private video|unavailable|removed|does not exist/i.test(e)) {
    return 'O vídeo não está disponível (privado, removido ou restrito).';
  }
  if (/Unable to download|HTTP Error|timed out|Connection/i.test(e)) {
    return 'Falha de rede ao abrir o vídeo. Tente de novo.';
  }
  return '';
}
