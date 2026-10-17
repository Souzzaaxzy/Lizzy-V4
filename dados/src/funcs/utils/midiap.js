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
 * 4. `setExternalAudioMode(callId, true)` + `feedLiveAudio(callId, pcm)` —
 *    o AUDIO do video, em PCM mono de 16 kHz (a taxa do motor).

 * ## UM ffmpeg, DUAS saidas

 * O video sai por `pipe:1` em H.264 e o audio por `pipe:3` em PCM cru --
 * duas saidas do MESMO processo, lendo uma entrada so'. Isso importa porque
 * a entrada pode ser um ARQUIVO (video local) ou o proprio fluxo baixado do
 * WhatsApp (`pipe:0`), sem gravar nada em disco.
 * O modo externo de audio (`setExternalAudioMode`) precisa estar LIGADO, ou
 * o motor ignora o que chega por `feedLiveAudio` (ele voltaria a tocar o
 * arquivo pre-carregado).
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

/**
 * Teto de quadros por segundo.
 *
 * NAO e' o fps usado: o fps vem do PROPRIO VIDEO (ver `fpsDoVideo`). Fixar
 * 15 num video de 30 fazia o passo do timestamp (66,7 ms) nao bater com o
 * intervalo real dos frames (33,3 ms) -- medido: 39,8 ms de descompasso por
 * frame e 3,5 s de erro acumulado em 3 s. O motor remapeia o tempo e
 * descarta/atrasa, que e' o que se sente como travamento.
 *
 * O teto existe porque acima disso a banda da call nao acompanha.
 */
const FPS_MAX = Number.parseInt(process.env.MIDIAP_FPS_MAX || '30', 10);

///** fps de reserva quando o video nao informa (arquivo exotico). */
const FPS_PADRAO = 15;

/** fps de reserva, exportado para quem transmite um fluxo. */
export const FPS_DE_RESERVA = FPS_PADRAO;

/** Taxa do motor de audio (a mesma constante do pacote). */
const TAXA_AUDIO = 16000;

/**
 * A cadeia de tratamento do audio -- a MESMA do `utils/callAudioPrep.js`.
 * O gate com limiar baixo (0.001) foi medido la': um limiar alto comia as
 * passagens musicais suaves.
 */
const FILTROS_AUDIO = 'highpass=f=70,agate=threshold=0.001:ratio=6:attack=8:release=200,alimiter=limit=0.95';

/** Quantos bytes por amostra (`f32le`). */
const BYTES_POR_AMOSTRA = 4;

/**
 * Teto de bitrate do video, em kbps.
 *
 * Medido: conteudo complexo (720p) sem teto chega a **5,4 Mbps** -- muito
 * acima do que a banda de uma call de grupo entrega. O motor responde
 * derrubando o bitrate pelo REMB e os frames se perdem no caminho (o
 * travamento). Com teto, o encoder gasta a banda que existe e nao sobra
 * frame para descartar.
 *
 * 1200 kbps em 720p30 e' folgado para tela/video e cabe na banda medida da
 * call. `MIDIAP_KBPS` ajusta.
 */
const KBPS = Number.parseInt(process.env.MIDIAP_KBPS || '1200', 10);

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

/**
 * Os argumentos do ffmpeg que produzem o H.264 da transmissao.
 *
 * Exportado para o TESTE usar exatamente a mesma lista: antes o teste tinha
 * os argumentos copiados, entao media a copia em vez do modulo (e um deles
 * passava so' porque o comentario citava o parametro).
 *
 * `sliced-threads=0` e' ESSENCIAL: o `zerolatency` liga o sliced-threads do
 * x264, que fatia CADA FRAME em varios slices. Como um access unit = um
 * frame, o splitter passaria a ver 4x mais frames (medido: 120 AUs para 30)
 * e o motor receberia timestamps colapsados -- era a causa do travamento.
 *
 * @param {string} arquivo
 * @returns {string[]}
 */
export function argumentosDoEncoder(entrada, fps = FPS_PADRAO, temAudio = true) {
  const args = [
    '-hide_banner', '-loglevel', 'error',
    '-re',                                  // le na taxa nativa (pacing)
    '-i', entrada,
    '-map', '0:v',
    // --- SAIDA 1: video H.264 no pipe:1 ---
    '-an',
    '-c:v', 'libx264',
    '-profile:v', PERFIL, '-level', NIVEL,  // avc1.42E01F
    '-pix_fmt', 'yuv420p',
    '-x264-params', 'annexb=1:sliced-threads=0',
    '-preset', 'veryfast', '-tune', 'zerolatency',
    // Teto de banda: sem isto o encoder gasta o que o conteudo pedir
    // (medido: 5,4 Mbps em conteudo complexo) e a call derruba frames.
    '-maxrate', `${KBPS}k`, '-bufsize', `${KBPS * 2}k`,
    // O fps do VIDEO (nao um fixo): o timestamp tem de bater com o
    // intervalo real dos frames.
    '-r', String(fps),
    '-g', String(fps * 2),                  // keyframe a cada 2 s
    // O `-vf` e' passado ao ffmpeg SEM shell (`spawn` com argumentos
    // separados), entao:
    //   - nada de aspas dentro do valor (iriam literais);
    //   - a VIRGULA de dentro de `min(a,b)` tem de vir escapada, senao o
    //     ffmpeg a le como separador de filtros e o grafo falha (medido:
    //     "Error initializing a simple filtergraph", exit 234).
    // O `force_original_aspect_ratio` saiu: o `min()` por eixo ja' preserva
    // a proporcao, e o `trunc` garante dimensao par (exigencia do yuv420p).
    '-vf', `scale=min(${MAX_LARGURA}\\,iw):min(${MAX_ALTURA}\\,ih),scale=trunc(iw/2)*2:trunc(ih/2)*2`,
    '-f', 'h264', 'pipe:1'
  ];

  // A saida de audio so' entra quando o video TEM audio. Com `spawn` (sem
  // shell) o `-map 0:a?` NAO e' honrado como opcional: num video sem faixa
  // de audio o ffmpeg aborta o processo inteiro ("Output file does not
  // contain any stream", exit 234) e a transmissao morre. Medido.
  if (temAudio) {
    args.push(
      // --- SAIDA 2: audio PCM cru no pipe:3 ---
      '-map', '0:a',
      '-vn',
      '-af', FILTROS_AUDIO,
      '-ac', '1', '-ar', String(TAXA_AUDIO),
      '-f', 'f32le', 'pipe:3'
    );
  }

  return args;
}

/**
 * O fps REAL do video, limitado ao teto.

 * Usa o `ffprobe` (que vem com o ffmpeg). Le o `avg_frame_rate` (uma fracao
 * tipo `30000/1001`). Sem resposta confiavel devolve o padrao -- melhor um
 * fps aproximado que travar a transmissao.

 * @param {string} arquivo
 * @returns {Promise<number>}
 */
export async function fpsDoVideo(arquivo) {
  try {
    const saida = await new Promise((resolve, reject) => {
      const p = spawn(binarioProbe(), [
        '-v', 'error', '-select_streams', 'v:0',
        '-show_entries', 'stream=avg_frame_rate',
        '-of', 'default=nw=1:nk=1', arquivo
      ], { stdio: ['ignore', 'pipe', 'ignore'] });
      let out = '';
      p.stdout.on('data', (c) => { out += c; });
      p.on('error', reject);
      p.on('close', (c) => (c === 0 ? resolve(out.trim()) : reject(new Error('probe ' + c))));
    });
    const [num, den] = saida.split('/').map(Number);
    const fps = den ? num / den : Number(saida);
    if (!Number.isFinite(fps) || fps <= 0) return FPS_PADRAO;
    // Arredonda (23,976 -> 24) e respeita o teto.
    return Math.min(Math.max(Math.round(fps), 1), FPS_MAX);
  } catch {
    return FPS_PADRAO;
  }
}

/**
 * O `ffprobe` (vem junto do ffmpeg).
 *
 * Quando o ffmpeg foi apontado por caminho (`FFMPEG_PATH`), o ffprobe e'
 * buscado AO LADO dele -- em instalacao estatica os dois ficam na mesma
 * pasta, e o `ffprobe` pode nao estar no PATH (medido no sandbox: sem isto
 * a deteccao caia no fps padrao em silencio).
 *
 * @returns {string}
 */
/**
 * O video TEM faixa de audio?
 *
 * Um `-map 0:a` num video SEM audio aborta o ffmpeg inteiro (medido: exit
 * 234), entao a saida de audio so' e' montada quando existe faixa.
 *
 * @param {string} entrada caminho de arquivo
 * @returns {Promise<boolean>}
 */
export async function temFaixaDeAudio(entrada) {
  try {
    const saida = await new Promise((resolve, reject) => {
      const p = spawn(binarioProbe(), [
        '-v', 'error', '-select_streams', 'a',
        '-show_entries', 'stream=index', '-of', 'csv=p=0', entrada
      ], { stdio: ['ignore', 'pipe', 'ignore'] });
      let out = '';
      p.stdout.on('data', (c) => { out += c; });
      p.on('error', reject);
      p.on('close', () => resolve(out.trim()));
    });
    return saida.length > 0;
  } catch {
    return true;   // na duvida, tenta com audio (o pior caso e' so' imagem)
  }
}

function binarioProbe() {
  if (process.env.FFPROBE_PATH) return process.env.FFPROBE_PATH;
  const ffmpeg = process.env.FFMPEG_PATH;
  if (ffmpeg) {
    const vizinho = path.join(path.dirname(ffmpeg), 'ffprobe');
    if (fs.existsSync(vizinho)) return vizinho;
  }
  return 'ffprobe';
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
 * @param {string} [p.arquivo] caminho de um video LOCAL
 * @param {object} [p.fluxo] stream do video baixado do WhatsApp (sem disco)
 * @param {number} [p.fps] fps do video (obrigatorio quando a fonte e' `fluxo`)
 * @param {(msg: string) => void} [p.log]
 * @returns {Promise<{ok: boolean, motivo?: string, detalhe?: string, frames?: number}>}
 */
export async function transmitir({ grupo, callId, arquivo = null, fluxo = null, fps = null, log = () => {} }) {
  if (duble) return duble.transmitir({ grupo, callId, arquivo, fluxo, fps, log });

  if (!grupo || !callId) return { ok: false, motivo: 'sem_call' };
  // A fonte e' um ARQUIVO ou um FLUXO (o video baixado do WhatsApp).
  // O fluxo nao passa por disco -- e' o caminho para quem tem pouco espaco.
  const fonte = fluxo ? 'fluxo' : 'arquivo';
  if (fonte === 'arquivo' && (!arquivo || !fs.existsSync(arquivo))) {
    return { ok: false, motivo: 'arquivo_ausente' };
  }
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

    // 2.5) liga o modo EXTERNO de audio. Sem isto o motor ignora o que chega
    // por `feedLiveAudio` e continua tocando o arquivo pre-carregado (o
    // `!musicap`), entao o video sairia mudo.
    try {
      cli.setExternalAudioMode(callId, true);
    } catch (e) {
      log('modo externo de audio falhou: ' + (e?.message || e));
    }

    // 3) O fps vem do PROPRIO video: com um fps fixo o passo do timestamp
    // nao bate com o intervalo real dos frames (medido: 39,8 ms de
    // descompasso por frame num video de 30 fps).
    // Com ARQUIVO o fps vem do proprio video; com FLUXO ele vem do chamador
    // (um stream nao pode ser sondado sem consumi-lo).
    const fpsUsado = fonte === 'arquivo'
      ? await fpsDoVideo(arquivo)
      : (fps || FPS_PADRAO);
    log(`fps do video: ${fpsUsado}`);

    // 4) UM ffmpeg: H.264 no pipe:1 e, se houver, PCM no pipe:3.
    // Com ARQUIVO da' para sondar a faixa; com FLUXO nao (consumiria o
    // stream), entao assume-se que tem audio.
    const temAudio = fonte === 'arquivo' ? await temFaixaDeAudio(arquivo) : true;
    log(`audio: ${temAudio ? 'sim' : 'nao'}`);
    await alimentar({
      cli, callId, entrada: fluxo || arquivo, fonte, estado, log, fps: fpsUsado, temAudio
    });
    return { ok: true, frames: estado.frames, amostras: estado.amostras || 0 };
  } catch (e) {
    return { ok: false, motivo: 'falha_na_transmissao', detalhe: e?.message || String(e) };
  } finally {
    ativos.delete(grupo);
    try { await cli.setScreenShare(callId, false); } catch { /* best-effort */ }
    try { await cli.setVideoEnabled(callId, false); } catch { /* best-effort */ }
    // Volta o audio ao modo pre-carregado (senao a call fica esperando o feed).
    try { cli.setExternalAudioMode(callId, false); } catch { /* best-effort */ }
  }
}

/**
 * Bombeia o video do ffmpeg para o motor.
 *
 * O `-re` faz o ffmpeg entregar no tempo da reproducao; o timestamp vem do
 * relogio real, que e' o que o motor espera (microssegundos).
 */
async function alimentar({ cli, callId, entrada, fonte, estado, log, fps, temAudio = true }) {
  const splitter = criarSplitter();
  // O timestamp NAO pode vir do `Date.now()` cru: ele tem resolucao de 1 ms
  // e o ffmpeg entrega varios frames no mesmo milissegundo (medido: 7
  // repetidos em 30 frames). O motor mapeia o tempo e exige um tick novo por
  // frame -- timestamp repetido vira atraso/descarte.
  //
  // Entao o tempo vem de um contador que AVANCA pelo intervalo nominal do
  // fps, ancorado no relogio real (para nao derivar se a maquina engasgar).
  const passoUs = Math.round(1_000_000 / fps);
  let proximoUs = 0;
  const inicioNs = process.hrtime.bigint();
  const carimbo = () => {
    const realUs = Number((process.hrtime.bigint() - inicioNs) / 1000n);
    // O MAIOR entre o relogio real e o passo nominal: o tempo nunca anda
    // para tras e nunca repete.
    proximoUs = Math.max(proximoUs + passoUs, realUs);
    return proximoUs;
  };

  await new Promise((resolve, reject) => {
    // O ffmpeg recebe um CAMINHO ou `pipe:0` -- nunca o objeto do stream
    // (medido: sem isto ele recebia `[object Object]` e saia com 254).
    const args = argumentosDoEncoder(fonte === 'fluxo' ? 'pipe:0' : entrada, fps, temAudio);

    let proc;
    try {
      // stdio: [entrada, video(pipe:1), erros, audio(pipe:3)]
      // A entrada e' `pipe` quando a fonte e' um FLUXO (o video baixado do
      // WhatsApp, sem passar por disco) ou `ignore` quando e' um arquivo.
      proc = spawn(binario(), args, {
        // O 4o descritor (audio) so' existe quando ha saida de audio.
        stdio: [fonte === 'fluxo' ? 'pipe' : 'ignore', 'pipe', 'ignore',
          temAudio ? 'pipe' : 'ignore']
      });
    } catch (e) {
      reject(e);
      return;
    }
    estado.proc = proc;

    // O video chegou do WhatsApp: joga o fluxo decifrado na entrada do ffmpeg.
    // Sem isto o processo ficaria esperando a entrada para sempre.
    if (fonte === 'fluxo') {
      // O stdin do ffmpeg FECHA quando o arquivo acaba. Escrever depois disso
      // da' EPIPE -- e ele vem como EVENTO assincrono, entao o `try/catch` do
      // `write` nao pega: sem listener, derruba o processo (medido).
      proc.stdin.on('error', () => { /* o ffmpeg ja' saiu */ });
      entrada.on('data', (c) => {
        if (estado.parado || proc.stdin.destroyed) return;
        try { proc.stdin.write(c); } catch { /* corrida: o ffmpeg saiu */ }
      });
      entrada.on('end', () => { try { proc.stdin.end(); } catch { /* ok */ } });
      entrada.on('error', () => { try { proc.stdin.end(); } catch { /* ok */ } });
    }

    // --- SAIDA 1: H.264 -> access units -> feedLiveVideo ---
    proc.stdout.on('data', (chunk) => {
      if (estado.parado) return;
      let aus;
      try { aus = splitter.push(chunk); } catch { return; }
      for (const au of aus) enviarFrame(cli, callId, au, carimbo, estado, log);
    });

    // --- SAIDA 2: PCM cru -> feedLiveAudio ---
    // Sobra de bytes entre chunks: um float tem 4 bytes e o pipe pode cortar
    // no meio de um. Guardar a sobra evita amostra corrompida.
    let sobra = Buffer.alloc(0);
    proc.stdio[3]?.on('data', (chunk) => {
      if (estado.parado) return;
      try {
        const buf = sobra.length ? Buffer.concat([sobra, chunk]) : chunk;
        const inteiros = Math.floor(buf.length / BYTES_POR_AMOSTRA);
        sobra = buf.subarray(inteiros * BYTES_POR_AMOSTRA);
        if (inteiros === 0) return;
        // Copia para um ArrayBuffer alinhado (o Buffer pode ter offset).
        const alinhado = new Uint8Array(inteiros * BYTES_POR_AMOSTRA);
        alinhado.set(buf.subarray(0, inteiros * BYTES_POR_AMOSTRA));
        cli.feedLiveAudio(callId, new Float32Array(alinhado.buffer));
        estado.amostras = (estado.amostras || 0) + inteiros;
      } catch (e) {
        log('feedLiveAudio: ' + (e?.message || e));
      }
    });
    // Sem faixa de audio o ffmpeg nao abre o pipe: um `error` aqui e' normal
    // (transmissao so' com imagem). Nunca derruba o video.
    proc.stdio[3]?.on('error', () => { /* sem audio: so' imagem */ });

    proc.on('error', reject);
    proc.on('close', (code) => {
      // Fecha o ultimo access unit retido.
      try {
        for (const au of splitter.flush()) {
          enviarFrame(cli, callId, au, carimbo, estado, log);
        }
      } catch { /* ok */ }
      if (code === 0 || estado.parado) resolve();
      else reject(new Error('ffmpeg saiu com ' + code));
    });
  });
}

/**
 * Envia um access unit (o timestamp vem do carimbo monotonico).
 *
 * NAO usa `getLiveBufferMs` como backpressure: aquele numero e' do buffer de
 * AUDIO (a doc: *"milliseconds of live audio currently buffered"*, `0`
 * quando o modo externo esta' desligado) -- nao diz nada sobre o video.
 * Quem segura o video e' o proprio motor: `feedLiveVideo` devolve `0`
 * enquanto o stream nao abriu (espera o keyframe) ou esta' em hold.
 */
function enviarFrame(cli, callId, au, carimbo, estado, log) {
  try {
    const ts = carimbo();
    const pacotes = cli.feedLiveVideo(callId, au, ts);
    if (pacotes > 0) estado.frames++;
    else estado.recusados = (estado.recusados || 0) + 1;
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
  // E' UM processo so' (video e audio sao duas saidas dele).
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

/** A pasta do cache do `!midiap` (dentro do cache da call). */
function pastaDoMidiap() {
  const raiz = process.env.CALL_CACHE_DIR || path.join(DATABASE_DIR, 'call-cache');
  return path.join(raiz, 'midiap');
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
  const dir = pastaDoMidiap();
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}${ext}`);
}

/**
 * Apaga os videos deixados no cache.

 * ## Por que existe

 * O arquivo do video sai no `finally` do comando -- mas so' enquanto o
 * processo vive. Se o bot CAIR no meio de uma transmissao (queda de energia,
 * `SIGKILL`, reinicio), o arquivo fica no disco PARA SEMPRE: ninguem mais
 * conhece aquele caminho. Como o `call-cache` nao entra no backup nem no
 * git, ele acumularia em silencio -- e um filme sao centenas de MB.

 * Chamada no boot (`connect.js`): nada do midiap sobrevive a um reinicio,
 * porque o estado das transmissões tambem e' em memoria.

 * @returns {number} quantos bytes foram liberados
 */
export function limparCacheMidiap() {
  let liberado = 0;
  try {
    const dir = pastaDoMidiap();
    if (!fs.existsSync(dir)) return 0;
    for (const nome of fs.readdirSync(dir)) {
      const p = path.join(dir, nome);
      try {
        const st = fs.statSync(p);
        if (st.isFile()) liberado += st.size;
        fs.rmSync(p, { recursive: true, force: true });
      } catch { /* segue */ }
    }
  } catch { /* nada a fazer */ }
  return liberado;
}
