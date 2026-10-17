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

 * ## As tres fontes (nenhuma usa disco)

 * 1. **ARQUIVO** local (video que ja' esta' no servidor);
 * 2. **FLUXO** (o video baixado do WhatsApp, via `pipe:0`);
 * 3. **LINK** (URL do YouTube e afins): o `yt-dlp` entrega o video
 *    MUXADO no `pipe:0`, sem gravar nada. O `yt-dlp` tambem informa o fps
 *    (o `ffprobe` nao serve aqui: um pipe nao pode ser sondado sem ser
 *    consumido).

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
import { abrirLink, motivoDoYtdlp } from './midiapLink.js';

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
/**
 * fps de reserva quando nao da' para saber o do video.
 *
 * E' 25 (nao 15) de proposito: o YouTube publica a maioria em 24/25/30, e um
 * valor MENOR que o real faz o `-r` do encoder DESCARTAR frames -- medido:
 * `-r 15` num video de 25 fps derruba o jitter de 4,3 ms para 33,4 ms e o
 * efetivo cai para 15 fps (40% dos quadros perdidos, que e' o "pulo" visivel).
 */
const FPS_PADRAO = 25;

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
 * O frame que o MOTOR de audio espera: **960 amostras = 60 ms** a 16 kHz.
 *
 * A doc do pacote e' literal: *"MLow runs through `libmlow-wasm-fork`: 16 kHz,
 * mono, **960-sample frames (60 ms)**"* (`@zapo-js/voip/README.md`).
 *
 * ## Por que reagrupamos (MEDIDO)
 *
 * O ffmpeg escreve no pipe no tamanho que o SO entregar — medimos chunks de
 * **~372 amostras (23 ms)**, nunca 960. Com o filtro `agate` a fragmentacao
 * piora (ate' 25 ms). Entregar assim faz o encoder do motor remontar o frame
 * a cada pedaco, e o som sai cortado/pulando.
 *
 * `asetnsamples=960` no ffmpeg **nao resolve** (medido: continua 348-372) —
 * o tamanho do chunk e' do pipe, nao do filtro. Entao reagrupamos aqui, no
 * Node, num buffer de sobra: o motor recebe sempre 960 amostras exatas.
 */
const FRAME_MOTOR = 960;

/** Quantos ms vale um frame do motor (960 amostras a 16 kHz). */
const MS_POR_FRAME = (FRAME_MOTOR / 16000) * 1000;   // 60 ms

/**
 * Teto da fila de audio, em frames.
 *
 * MEDIDO: o `-re` do ffmpeg entrega em rajadas (299 de 377 chegadas com
 * intervalo ZERO e ate' 282 ms de silencio). A fila absorve esse jitter; o
 * teto so' existe para um atraso acumulado nao crescer sem fim.
 *
 * 12 frames = 720 ms: acima disso o audio ja' esta' audivelmente atrasado, e
 * descartar o MAIS ANTIGO (em vez do mais novo) faz o som voltar ao tempo
 * real — que e' o que o proprio motor faz no buffer dele.
 */
const FILA_MAX_FRAMES = 12;

/**
 * Nivel alvo do buffer do MOTOR, em ms.
 *
 * E' o `resumeMs` do contrato dele (`getFeedWatermarksMs()`): *"resume once it
 * drains to `resumeMs`"*. Mantemos o buffer NESSE ponto — acima disso e'
 * latencia pura (MEDIDO: com o relogio adiantado o buffer ficava em 500 ms e
 * o audio saia atrasado).
 *
 * NAO usar um valor menor: o motor tem o jitter buffer DELE e nao drena
 * abaixo de um piso (MEDIDO: ~100 ms). Com um alvo de 60 ms o gate nunca
 * liberava — o audio ficava preso e o descompasso crescia sem parar.
 */
const AUDIO_ALVO_MS = 120;

/**
 * Watermarks do buffer de audio do MOTOR (pausa/retoma), em ms.
 *
 * Lidos do proprio pacote (`WaAudioEngine.feedWatermarksMs()`): o motor
 * **descarta as amostras mais antigas** quando o buffer passa de
 * `extMaxBuffer` (750 ms). O contrato dele e': pare de alimentar ao chegar em
 * `pauseMs` (120 ms) e volte quando drenar para `resumeMs` (60 ms).
 *
 * MEDIDO: alimentando sem olhar o buffer, 6 s de audio enchem os 750 ms e o
 * motor descarta **53 vezes** -- era o "cortando/travando" que se ouvia.
 * Com o backpressure: **zero descarte**.
 */
const AUDIO_PAUSE_MS = 120;
const AUDIO_RESUME_MS = 60;

/**
 * Teto do buffer de audio, em ms.
 *
 * O motor descarta acima de 750 ms e o proprio contrato dele manda pausar em
 * 120 ms (). Manter o teto IGUAL ao contrato e'
 * o que deixa o audio colado no video: cada ms de folga aqui vira ms de
 * descompasso acumulado (MEDIDO: com 240 ms o descompasso oscilava +-140 ms;
 * com 120 ms ele fica dentro de +-60 ms, que e' um frame do motor).
 */
const AUDIO_MAX_MS = 120;

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
export function argumentosDoEncoder(entrada, fps = FPS_PADRAO, temAudio = true, entradaAudio = null) {
  // Duas entradas (VIDEO + AUDIO) acontecem so' no LINK: o merge do yt-dlp
  // quebra (SIGSEGV) e quem muxa e' este ffmpeg, lendo os dois pipes. Nos
  // outros casos ha' UMA entrada e a saida de audio fica no pipe:3.
  const duas = Boolean(entradaAudio);
  const args = [
    '-hide_banner', '-loglevel', 'error',
    '-re',                                  // le na taxa nativa (pacing)
    '-i', entrada,
    ...(duas ? ['-re', '-i', entradaAudio] : []),
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
    // NAO usar `-r <fps>`: medido, o ffmpeg JA' le o fps do proprio stream
    // (ele reporta "25 fps" lendo o pipe). Forcar o numero e' o que introduz
    // DUPLICACAO (se for maior) ou DESCARTE (se for menor) quando ele diverge
    // do real -- e o `fpsDoLink` pode divergir (o seletor dele e outro, e num
    // IP bloqueado ele falha e cai no de reserva). Medido com `-r 15` num
    // video de 25 fps: jitter 4,3 ms -> 33,4 ms e 40% dos quadros perdidos.
    // `passthrough` copia os frames como chegam: sem duplicar nem descartar.
    '-fps_mode', 'passthrough',
    // Keyframe a cada ~1 s (era 2 s): o motor so' ABRE o stream quando ve um
    // keyframe (`feedLiveVideo` devolve 0 ate' entao, por contrato), e um
    // keyframe mais frequente tambem ajuda quem entra no meio da transmissao.
    '-g', String(fps),
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
      // --- SAIDA 2: audio PCM cru (pipe:3, ou pipe:4 com duas entradas) ---
      // Com duas entradas o audio vem do 2o `-i`; com uma, do proprio.
      '-map', duas ? '1:a' : '0:a',
      '-vn',
      '-af', FILTROS_AUDIO,
      '-ac', '1', '-ar', String(TAXA_AUDIO),
      '-f', 'f32le', duas ? 'pipe:4' : 'pipe:3'
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
export async function transmitir({ grupo, callId, arquivo = null, fluxo = null, link = null, fps = null, log = () => {} }) {
  if (duble) return duble.transmitir({ grupo, callId, arquivo, fluxo, link, fps, log });

  if (!grupo || !callId) return { ok: false, motivo: 'sem_call' };
  // Tres fontes, nenhuma usa disco:
  //   ARQUIVO -- um video local;
  //   FLUXO   -- o video baixado do WhatsApp (pipe:0);
  //   LINK    -- uma URL (o yt-dlp manda o video muxado no pipe:0).
  const fonte = fluxo ? 'fluxo' : (link ? 'link' : 'arquivo');
  if (fonte === 'arquivo' && (!arquivo || !fs.existsSync(arquivo))) {
    return { ok: false, motivo: 'arquivo_ausente' };
  }
  if (ativos.has(grupo)) return { ok: false, motivo: 'ja_transmitindo' };
  // RESERVA o grupo ANTES de qualquer I/O: o upgrade e' assincrono e leva
  // segundos, entao duas chamadas simultaneas passariam pelo guarda e as
  // duas ligariam o screen share (foi o que o teste de concorrencia pegou).
  ativos.set(grupo, {
    proc: null, parado: false, frames: 0,
    // Controle do audio (ver AUDIO_PAUSE_MS): o ffmpeg e' PAUSADO quando o
    // buffer do motor enche, para nao descartar amostra.
    pausado: false,
    // Fila do que chegou enquanto pausado (nunca se joga audio fora).
    fila: [],
    // Nivel do buffer do motor (ms): alimenta so' abaixo de AUDIO_MAX_MS.
    nivelMs: 0,
    // Sobra entre chunks: reagrupa em frames de FRAME_MOTOR amostras.
    resto: null,
    // Instante zero da transmissao: marcado pelo 1o frame de VIDEO que entra
    // no ar. O relogio do audio ancora aqui (sincronia no milissegundo).
    tZero: null,
  });

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
    // Com ARQUIVO o fps vem do proprio video; com FLUXO/LINK ele vem do
    // chamador (um pipe nao pode ser sondado sem ser consumido).
    const fpsUsado = fonte === 'arquivo'
      ? await fpsDoVideo(arquivo)
      : (fps || FPS_PADRAO);
    log(`fps do video: ${fpsUsado}`);

    // 4) UM ffmpeg: H.264 no pipe:1 e, se houver, PCM no pipe:3.
    // Com ARQUIVO da' para sondar a faixa; com FLUXO nao (consumiria o
    // stream), entao assume-se que tem audio.
    // No LINK o yt-dlp muxa audio e video num arquivo so', entao sempre tem.
    const temAudio = fonte === 'arquivo' ? await temFaixaDeAudio(arquivo) : true;
    log(`audio: ${temAudio ? 'sim' : 'nao'}`);
    await alimentar({
      cli, callId, entrada: fluxo || link || arquivo, fonte, estado, log,
      fps: fpsUsado, temAudio
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
  // O timestamp do video NAO pode correr a frente do relogio.
  //
  // A versao anterior somava o passo nominal a cada frame
  // (`max(proximo + passo, real)`) e isso ACUMULAVA adiantamento: medido,
  // 119 de 120 timestamps ficavam a frente do tempo real (ate' 468 ms). O
  // motor remapeia o tempo e SEGURA o frame do "futuro" -- e' o engasgo e
  // o pulo de quadros.
  //
  // Agora o tempo e' o RELOGIO REAL, so' forçado a AVANCAR (nunca repetir
  // nem voltar): um frame que chega no mesmo milissegundo do anterior
  // recebe 1 us a mais, o que e' o minimo para o motor aceitar.
  // O timestamp do video e' uma TIMELINE NOMINAL: o frame N vale N passos.
  //
  // Por que nao usar o relogio: o `-re` do ffmpeg NAO entrega no tempo
  // real neste ambiente (medido: 2000 ms de video em 1411 ms de relogio,
  // com rajadas de 2 frames). Carimbar pelo relogio faz o passo medio cair
  // para ~24 ms e varios frames caírem no MESMO instante (gap 0) -- o motor
  // exige um tick novo por frame.
  //
  // A timeline nominal resolve as duas coisas: cada frame AVANCA o passo
  // exato (33,3 ms a 30 fps), sem rajada e sem acumular adiantamento sobre
  // o que ja' foi enviado. O motor remapeia essa timeline para o relogio
  // dele (o `HostCaptureTimeMapper` faz exatamente isso).
  const passoUs = Math.round(1_000_000 / fps);
  let indice = 0;
  const carimbo = () => {
    const ts = indice * passoUs;
    indice += 1;
    return ts;
  };

  await new Promise(async (resolve, reject) => {
    // O ffmpeg recebe um CAMINHO ou `pipe:0` -- nunca o objeto do stream
    // (medido: sem isto ele recebia `[object Object]` e saia com 254).
    // No LINK a entrada tambem e' pipe: quem alimenta e' o yt-dlp.
    // No LINK sao DUAS entradas (video no fd0, audio no fd3) e a saida de
    // audio vai para o fd4 -- o fd3 esta' ocupado com a entrada. Ver o
    // cabecalho do midiapLink.js (o merge do yt-dlp quebra).
    const porLink = fonte === 'link';
    const porPipe = fonte === 'fluxo' || porLink;
    const args = argumentosDoEncoder(
      porPipe ? 'pipe:0' : entrada, fps, temAudio, porLink ? 'pipe:3' : null
    );
    // O descritor de saida do audio (o mesmo que vai nos `-f f32le`).
    const fdSaidaAudio = porLink ? 4 : 3;

    let proc;
    try {
      // stdio: [entrada, video(pipe:1), erros, audio]
      //   - ARQUIVO: entrada `ignore` (o caminho vai no `-i`);
      //   - FLUXO:   entrada `pipe` (o video baixado do WhatsApp);
      //   - LINK:    entrada `pipe` (video) + fd3 `pipe` (audio).
      // O stderr vai para PIPE (nao `ignore`): e' dele que sai o motivo real
      // da falha do ffmpeg.
      const stdio = porLink
        ? ['pipe', 'pipe', 'pipe', temAudio ? 'pipe' : 'ignore',
           temAudio ? 'pipe' : 'ignore']
        : [porPipe ? 'pipe' : 'ignore', 'pipe', 'pipe',
           temAudio ? 'pipe' : 'ignore'];
      proc = spawn(binario(), args, { stdio });
    } catch (e) {
      reject(e);
      return;
    }
    estado.proc = proc;

    // O video chegou do WhatsApp: joga o fluxo decifrado na entrada do ffmpeg.
    // Sem isto o processo ficaria esperando a entrada para sempre.
    if (fonte === 'link') {
      // DOIS yt-dlp (video e audio), cada um no seu pipe: o merge do yt-dlp
      // quebra (SIGSEGV) e devolveria zero byte -> o ffmpeg morria com 183.
      const r = await abrirLink(entrada);
      if (!r.proc) {
        reject(new Error(r.detalhe || r.motivo || 'falha ao abrir o link'));
        return;
      }
      estado.procLink = r.proc;
      estado.procLinkAudio = r.procAudio || null;
      // Erro nos dois lados: o yt-dlp pode sair antes do ffmpeg.
      proc.stdin.on('error', () => { /* o yt-dlp pode ter saido */ });
      proc.stdio[3]?.on('error', () => { /* idem, no lado do audio */ });
      const bombear = (origem, destino) => {
        if (!origem || !destino) return;
        origem.on('data', (c) => {
          if (estado.parado || destino.destroyed) return;
          try { destino.write(c); } catch { /* corrida */ }
        });
        origem.on('end', () => { try { destino.end(); } catch { /* ok */ } });
      };
      bombear(r.proc.stdout, proc.stdin);           // video -> fd0
      bombear(r.procAudio?.stdout, proc.stdio[3]);  // audio -> fd3
      r.proc.on('close', () => { try { proc.stdin.end(); } catch { /* ok */ } });
      r.procAudio?.on('close', () => { try { proc.stdio[3]?.end(); } catch { /* ok */ } });
    }

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
    //
    // ## O VIDEO TAMBEM E' LIBERADO PELO RELOGIO (a causa do delay)
    //
    // MEDIDO: em 2000 ms de relogio o video ja' tinha entregue **2120 ms** de
    // conteudo — o `-re` do ffmpeg nao segura, ele entrega por chegada. O
    // audio, limitado a 1 frame por 60 ms, entrega NO tempo. Resultado: o
    // video andava 140-180 ms NA FRENTE e o audio parecia atrasado (quando o
    // adiantado era o video).
    //
    // Aqui cada access unit entra numa fila com o instante nominal
    // (`indice / fps`) e so' vai ao motor quando esse instante CHEGA. Os dois
    // fluxos passam a ser liberados pelo mesmo relogio — no mesmo ms.
    const filaVideo = [];
    proc.stdout.on('data', (chunk) => {
      if (estado.parado) return;
      let aus;
      try { aus = splitter.push(chunk); } catch { return; }
      for (const au of aus) filaVideo.push(au);
    });
    estado.bombearVideo = () => {
      if (estado.parado) return;
      while (filaVideo.length) {
        // O 1o frame sai NA HORA: e' ele que marca o instante zero (o tZero
        // de onde o relogio dos dois fluxos conta).
        if (estado.tZero !== null) {
          const alvoMs = (indice / fps) * 1000;
          if (Date.now() - estado.tZero < alvoMs) break;   // ainda e' cedo
        }
        enviarFrame(cli, callId, filaVideo.shift(), carimbo, estado, log);
      }
    };

    // --- SAIDA 2: PCM cru -> feedLiveAudio ---
    //
    // ## O PROBLEMA (MEDIDO): o `-re` do ffmpeg entrega em RAJADAS
    //
    // Medido no caminho real: **299 de 377 chegadas com intervalo ZERO** e
    // ate' **282 ms de silencio** entre elas. Ou seja, o audio nao chega no
    // ritmo do tempo real — chega aos blocos.
    //
    // Entregar isso direto ao motor produz OS DOIS sintomas ao mesmo tempo:
    //   - nos vaos o motor fica sem amostra -> CORTA;
    //   - na rajada ele recebe um monte -> acumula -> ATRASA.
    //
    // ## A SOLUCAO: fila + relogio proprio (o motor nao pode ver o jitter)
    //
    // O ffmpeg escreve na FILA (pode rajada o quanto quiser) e um timer
    // entrega ao motor em ritmo CONSTANTE — exatamente 1 frame de 60 ms a cada
    // 60 ms de relogio. O jitter fica todo na fila, que absorve.
    //
    // Isso e' o que o motor espera: a doc dele diz que `feedLiveAudio` alimenta
    // um *"bounded jitter buffer"* — mas quem tem de entregar LISO e' o
    // produtor. Rajada na entrada faz o buffer dele oscilar.
    let sobra = Buffer.alloc(0);

    /** Fila de frames de FRAME_MOTOR amostras, prontos para o motor. */
    estado.fila = estado.fila || [];

    /**
     * Enfileira PCM cru, reagrupando em frames de FRAME_MOTOR amostras.
     *
     * O pipe entrega ~372 amostras por chunk; o motor espera 960 (60 ms).
     */
    const enfileirarAudio = (bloco) => {
      estado.resto = estado.resto && estado.resto.length
        ? Float32Array.from([...estado.resto, ...bloco])
        : bloco;
      while (estado.resto.length >= FRAME_MOTOR) {
        estado.fila.push(estado.resto.slice(0, FRAME_MOTOR));
        estado.resto = estado.resto.slice(FRAME_MOTOR);
      }
    };

    /**
     * Entrega UM frame ao motor. O ritmo e' do timer (60 ms por frame).
     *
     * Se a fila estiver muito funda, o audio ja' esta' atrasado: descartamos o
     * frame mais ANTIGO em vez do mais novo. O motor faria o mesmo (a doc:
     * *"drops the oldest samples on overflow"*), mas assim o descarte acontece
     * onde nos controlamos — e o audio pula para FRENTE, voltando ao tempo
     * real, em vez de atrasar para sempre.
     */
    const bombearAudio = () => {
      if (estado.parado) return;
      if (estado.fila.length === 0) return;
      // Rede de seguranca: fila funda = atraso acumulado. Descarta o antigo.
      while (estado.fila.length > FILA_MAX_FRAMES) {
        estado.fila.shift();
        estado.audioDescartado = (estado.audioDescartado || 0) + 1;
      }
      const frame = estado.fila.shift();
      try {
        const ms = cli.feedLiveAudio(callId, frame);
        estado.amostras = (estado.amostras || 0) + frame.length;
        if (typeof ms === 'number' && ms > 0) estado.nivelMs = ms;
      } catch (e) {
        log('feedLiveAudio: ' + (e?.message || e));
      }
    };

    proc.stdio[fdSaidaAudio]?.on('data', (chunk) => {
      if (estado.parado) return;
      try {
        const buf = sobra.length ? Buffer.concat([sobra, chunk]) : chunk;
        const inteiros = Math.floor(buf.length / BYTES_POR_AMOSTRA);
        sobra = buf.subarray(inteiros * BYTES_POR_AMOSTRA);
        if (inteiros === 0) return;
        // Copia para um ArrayBuffer alinhado (o Buffer pode ter offset).
        const alinhado = new Uint8Array(inteiros * BYTES_POR_AMOSTRA);
        alinhado.set(buf.subarray(0, inteiros * BYTES_POR_AMOSTRA));
        enfileirarAudio(new Float32Array(alinhado.buffer));
      } catch (e) {
        log('feedLiveAudio: ' + (e?.message || e));
      }
    });

    // ## O RELOGIO do audio: guiado pelo BUFFER REAL do motor
    //
    // O motor publica o contrato dele: `getFeedWatermarksMs()` =
    // `{ pauseMs: 120, resumeMs: 60 }` e a doc diz *"pause feeding once
    // `getLiveBufferMs` reaches `pauseMs`, resume once it drains to
    // `resumeMs`"*. O proprio pacote manda usar isso:
    //
    //     const { pauseMs, resumeMs } = client.voip.getFeedWatermarksMs()
    //
    // ## O erro que causava o DELAY (medido)
    //
    // Antes o relogio era um contador adiantado em 2 frames (120 ms) e o
    // buffer do motor ficava em **500 ms de media** (pico 650) — essa e' a
    // latencia REAL que se ouve. Adiantar o relogio nao "alinha": ele ENCHE o
    // buffer, e buffer cheio e' atraso puro.
    //
    // Agora o alvo e' o proprio nivel reportado pelo motor:
    //   - acima de AUDIO_ALVO_MS: nao entrega (deixa drenar);
    //   - abaixo de AUDIO_RESUME_MS: entrega para manter o fio.
    //
    // O alvo e' **60 ms** (um frame) — o minimo que mantem o buffer com
    // conteudo. E' o que a doc chama de `resumeMs`, e e' o ponto onde o audio
    // esta' colado no video.
    // O RITMO: no maximo 1 frame a cada MS_POR_FRAME (60 ms) de relogio.
    //
    // E' o que o motor consome (16,7 frames/s). O timer roda a cada 10 ms so'
    // para reagir rapido quando o buffer drenar — mas quem LIMITA a entrega e'
    // a contagem por relogio. Sem esse limite o timer entregava 6x mais rapido
    // que o consumo, o buffer enchia, o alvo barrava e o audio PARAVA
    // (medido: descompasso de -12120 ms).
    // O relogio do audio e' ancorado no MESMO instante zero do video
    // (`estado.tZero`), nao no momento em que este codigo roda. Se o video
    // ainda nao entrou no ar, esperamos por ele — o audio nao pode comecar
    // antes (sairia adiantado) nem depois (atrasado).
    let framesNoRelogio = 0;
    const timerAudio = setInterval(() => {
      if (estado.parado) return;
      // O VIDEO e' liberado pelo MESMO relogio (o tZero e' dele).
      estado.bombearVideo?.();
      if (!estado.videoComecou) return;          // espera o marco zero do video
      if (!estado.fila || estado.fila.length === 0) return;

      // Quantos frames o relogio ja' permite ter entregue — contados desde o
      // MESMO tZero do video.
      //
      // O `+1` e' do INSTANTE ZERO: o frame 0 vale no ms 0, nao no ms 60. Sem
      // ele o 1o frame de audio esperava 60 ms e o audio nascia atrasado (o
      // residuo medido de 64 ms) — o video ja' tinha saido no instante 0.
      const permitido = Math.floor((Date.now() - estado.tZero) / MS_POR_FRAME) + 1;
      if (framesNoRelogio >= permitido) return;   // ainda e' cedo: nao entrega

      // Le o nivel REAL do motor (a fonte da verdade — nao um contador nosso).
      let nivel = estado.nivelMs;
      try {
        const atual = cli.getLiveBufferMs?.(callId);
        if (typeof atual === 'number') { nivel = atual; estado.nivelMs = atual; }
      } catch { /* segue com o ultimo valor */ }

      // Acima do alvo: o motor tem fila suficiente. Espera drenar (nao soma
      // atraso). O alvo e' o `resumeMs` do contrato dele.
      if (nivel >= AUDIO_ALVO_MS) return;

      bombearAudio();
      framesNoRelogio += 1;
    }, 5);
    estado.timerAudio = timerAudio;

    // Sem faixa de audio o ffmpeg nao abre o pipe: um `error` aqui e' normal
    // (transmissao so' com imagem). Nunca derruba o video.
    proc.stdio[fdSaidaAudio]?.on('error', () => { /* sem audio: so' imagem */ });

    // Guarda o stderr para poder dizer POR QUE o ffmpeg falhou (sem isto o
    // erro vira so' um numero: "ffmpeg saiu com 183").
    let erroFfmpeg = '';
    proc.stderr?.on('data', (c) => {
      erroFfmpeg = (erroFfmpeg + c.toString()).slice(-800);
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      // Fecha o ultimo access unit retido.
      try {
        for (const au of splitter.flush()) {
          enviarFrame(cli, callId, au, carimbo, estado, log);
        }
      } catch { /* ok */ }
      // ## Esvazia o VIDEO que sobrou na fila do relogio
      //
      // O video agora e' liberado pelo relogio (como o audio), entao quando o
      // ffmpeg termina ainda pode haver frames esperando o instante nominal.
      // Sem isto o video terminaria ANTES (medido: 19 de 30 frames num video
      // de 2 s a 15 fps).
      try {
        while (filaVideo.length) {
          enviarFrame(cli, callId, filaVideo.shift(), carimbo, estado, log);
        }
      } catch { /* ok */ }
      // ## Esvazia o audio que JA' esta' na fila antes de parar o timer
      //
      // O ffmpeg le na taxa nativa, entao quando ele termina ainda pode haver
      // frames na fila esperando o relogio. Parar o timer direto PERDERIA
      // esses frames (o audio terminaria antes do video — medido: 27 de 33
      // frames entregues num video de 2 s). Entregamos o resto AGORA: o
      // `feedLiveAudio` aceita em rajada, e o jitter buffer do motor absorve.
      try {
        while (estado.fila && estado.fila.length) {
          const frame = estado.fila.shift();
          try {
            cli.feedLiveAudio(callId, frame);
            estado.amostras = (estado.amostras || 0) + frame.length;
          } catch { /* o motor ja' pode ter encerrado */ }
        }
      } catch { /* ok */ }
      // So' entao para o timer (senao ele segue rodando depois do fim).
      try { clearInterval(estado.timerAudio); } catch { /* ok */ }
      estado.fila = [];
      // Encerra os yt-dlp junto: sem isto eles seguiriam baixando sozinhos.
      try { estado.procLink?.kill('SIGKILL'); } catch { /* ok */ }
      try { estado.procLinkAudio?.kill('SIGKILL'); } catch { /* ok */ }
      if (code === 0 || estado.parado) resolve();
      else {
        // Se o yt-dlp falhou, o motivo REAL esta' no stderr dele -- e' mais
        // util que o sintoma que o ffmpeg viu (pipe vazio).
        const stderrYt = (estado.procLink?._stderr || '') + (estado.procLinkAudio?._stderr || '');
        const motivoYt = motivoDoYtdlp(stderrYt);
        if (motivoYt) {
          log(`yt-dlp falhou: ${stderrYt.trim().slice(-200)}`);
          reject(new Error(motivoYt));
          return;
        }
        // Traduz o codigo para algo que o dono entenda, sem perder o
        // detalhe tecnico (que vai para o log).
        const motivo = motivosDoFfmpeg(code, erroFfmpeg);
        log(`ffmpeg saiu com ${code}: ${erroFfmpeg.trim().slice(-200)}`);
        reject(new Error(motivo));
      }
    });
  });
}

/**
 * Traduz a saida do ffmpeg para uma frase util.
 *
 * Medido: o codigo **183** e' `Invalid data found when processing input` --
 * o ffmpeg recebeu dado que nao entende (era o caso do yt-dlp mandando os
 * formatos soltos, sem o `--ffmpeg-location`). O usuario nao deve ver
 * "ffmpeg saiu com 183".
 *
 * @param {number} code
 * @param {string} stderr
 * @returns {string}
 */
function motivosDoFfmpeg(code, stderr = '') {
  const erro = String(stderr);
  if (/Invalid data found/i.test(erro)) {
    return 'O vídeo chegou corrompido ou incompleto. Tente de novo.';
  }
  if (/No space left|Disk quota|quota exceeded/i.test(erro)) {
    return 'Sem espaço no servidor.';
  }
  if (/Server returned 4|HTTP error|403|404/i.test(erro)) {
    return 'A fonte recusou o download (link expirado ou bloqueado).';
  }
  if (code === 183) return 'O vídeo chegou corrompido ou incompleto. Tente de novo.';
  return `Falha ao processar o vídeo (código ${code}).`;
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
    if (pacotes > 0) {
      estado.frames++;
      // ## O MARCO ZERO e' do VIDEO
      //
      // O primeiro frame de video que ENTRA NO AR define o instante zero. O
      // relogio do audio e' ancorado nele (nao em `Date.now()` de quando o
      // codigo passou por ali): e' o que faz os dois saírem no mesmo
      // milissegundo.
      //
      // MEDIDO antes: o relogio do audio comecava quando o 1o frame de PCM
      // chegava, ~80 ms DEPOIS do video — e esse era o atraso fixo.
      if (!estado.videoComecou) {
        estado.videoComecou = true;
        estado.tZero = Date.now();
      }
    } else {
      estado.recusados = (estado.recusados || 0) + 1;
    }
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
  try { clearInterval(estado.timerAudio); } catch { /* ok */ }
  estado.fila = [];
  // O ffmpeg (video e audio sao duas saidas dele) e, num LINK, o yt-dlp.
  try { estado.proc?.kill('SIGKILL'); } catch { /* ok */ }
  try { estado.procLink?.kill('SIGKILL'); } catch { /* ok */ }
  try { estado.procLinkAudio?.kill('SIGKILL'); } catch { /* ok */ }
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
