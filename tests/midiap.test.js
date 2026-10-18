/**
 * `!midiap` — transmissao de tela na call (o video na call).
 *
 * O que este teste mede:
 *
 *   - o SPLITTER de access units (o que o pacote de midia nao tem): o fluxo
 *     Annex-B do ffmpeg vira UM access unit por FRAME, tanto de uma vez quanto
 *     em pedacos (o ffmpeg entrega em pedacos);
 *   - o comando: so' em grupo, exige call ativa, exige VIDEO marcado,
 *     `parar` funciona, e roda em BACKGROUND;
 *   - o caminho do motor: `requestVideoUpgrade` -> `setScreenShare(true)` ->
 *     `feedLiveVideo` por frame -> desliga no fim.
 *
 * Uso: node tests/midiap.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-midiap-'));
process.env.DATABASE_PATH = TMP_DB;
process.env.CALL_CACHE_DIR = path.join(TMP_DB, 'call-cache');
process.env.ZAPO_DISABLE_CONNECT = '1';
const GRUPOS_DIR = path.join(TMP_DB, 'grupos');
fs.mkdirSync(GRUPOS_DIR, { recursive: true });

// ffmpeg: o do sistema ou um estatico conhecido.
const FFMPEG = process.env.FFMPEG_PATH || (fs.existsSync('/workspace/bin/ffmpeg') ? '/workspace/bin/ffmpeg' : 'ffmpeg');
process.env.FFMPEG_PATH = FFMPEG;

let TEM_FFMPEG = true;
try {
  const p = spawn(FFMPEG, ['-version'], { stdio: 'ignore' });
  await new Promise((res, rej) => { p.on('error', rej); p.on('close', (c) => (c === 0 ? res() : rej(new Error('c' + c)))); });
} catch { TEM_FFMPEG = false; }

const RESULTS = [];
let CURRENT = null;

function test(name, fn) {
  CURRENT = { name, passed: 0, failed: 0, errors: [] };
  RESULTS.push(CURRENT);
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      return r.then(() => finish(name)).catch((e) => {
        CURRENT.failed += 1; CURRENT.errors.push(`EXCEÇÃO: ${e?.stack || e}`); finish(name);
      });
    }
    finish(name);
  } catch (e) {
    CURRENT.failed += 1; CURRENT.errors.push(`EXCEÇÃO: ${e?.stack || e}`); finish(name);
  }
  return Promise.resolve();
}
function finish(name) {
  console.log(`${CURRENT.failed === 0 ? '✅' : '❌'} ${name} (${CURRENT.passed} ok, ${CURRENT.failed} falhas)`);
  for (const err of CURRENT.errors) console.log(`     ${err.split('\n')[0]}`);
}
function ok(cond, msg) {
  if (cond) CURRENT.passed += 1;
  else { CURRENT.failed += 1; CURRENT.errors.push(`ASSERT FALHOU: ${msg}`); }
}
function includes(hay, needle, label) {
  ok(typeof hay === 'string' && hay.includes(needle),
    `${label ?? needle} — esperado conter "${needle}"`);
}

// ============================================================================

const splitter = await import(new URL('../dados/src/utils/screenShare.js', import.meta.url).href);
const midiap = await import(new URL('../dados/src/funcs/utils/midiap.js', import.meta.url).href);
const callMedia = await import(new URL('../dados/src/funcs/utils/callMedia.js', import.meta.url).href);
const callState = await import(new URL('../dados/src/funcs/utils/callOffer.js', import.meta.url).href);
const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;

const SRC = fs.readFileSync(path.join(HERE, '..', 'dados/src/index.js'), 'utf-8');

// ============================================================================
// 1) O SPLITTER (o que o pacote nao tem)
// ============================================================================

console.log('\n=== 1) SPLITTER de access units ===\n');

/** Gera um H.264 de teste (Annex-B, Constrained Baseline) e devolve o buffer. */
async function gerarH264(segundos = 2, fps = 15) {
  const saida = path.join(TMP_DB, `h264-${Math.random().toString(36).slice(2, 8)}.h264`);
  await new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', `testsrc=size=320x180:rate=${fps}:duration=${segundos}`,
      '-c:v', 'libx264', '-profile:v', 'baseline', '-level', '3.1',
      '-pix_fmt', 'yuv420p', '-x264-params', 'annexb=1', '-g', String(fps),
      saida
    ], { stdio: ['ignore', 'ignore', 'inherit'] });
    p.on('error', reject);
    p.on('close', (c) => (c === 0 ? resolve() : reject(new Error('ffmpeg ' + c))));
  });
  const buf = fs.readFileSync(saida);
  fs.unlinkSync(saida);
  return buf;
}

if (!TEM_FFMPEG) {
  console.log('⚠️  sem ffmpeg — os testes que dependem dele serao pulados\n');
} else {
  await test('o splitter da UM access unit por FRAME (fluxo real do ffmpeg)', async () => {
    const buf = await gerarH264(2, 15);   // 2 s a 15 fps = 30 frames
    const aus = splitter.dividirAccessUnits(buf);
    ok(aus.length === 30, `30 access units para 30 frames (veio ${aus.length})`);
    ok(aus.every((a) => a[0] === 0 && a[1] === 0 && (a[2] === 1 || (a[2] === 0 && a[3] === 1))),
      'todos comecam com start code (Annex-B preservado)');
    ok(aus.every((a) => a.length > 0), 'nenhum access unit vazio');
  });

  await test('o splitter funciona EM PEDACOS (o ffmpeg nao entrega inteiro)', async () => {
    const buf = await gerarH264(2, 15);
    const s = splitter.criarSplitter();
    const aus = [];
    for (let i = 0; i < buf.length; i += 997) {   // tamanho quebrado de proposito
      aus.push(...s.push(buf.subarray(i, Math.min(i + 997, buf.length))));
    }
    aus.push(...s.flush());
    const inteiro = splitter.dividirAccessUnits(buf).length;
    ok(aus.length === inteiro, `mesmo numero de uma vez (${aus.length} vs ${inteiro})`);
  });

  await test('o splitter nao perde nem junta frames de tamanhos diferentes', async () => {
    for (const [seg, fps] of [[1, 10], [2, 15], [1, 30]]) {
      const buf = await gerarH264(seg, fps);
      const aus = splitter.dividirAccessUnits(buf);
      ok(aus.length === seg * fps, `${seg}s a ${fps}fps -> ${seg * fps} frames (veio ${aus.length})`);
    }
  });

  await test('cada access unit passa pelo EMPACOTADOR do pacote (se disponivel)', async () => {
    const pkg = '/tmp/vmedia/package/dist/esm/media/h264.js';
    if (!fs.existsSync(pkg)) {
      ok(true, 'pacote de midia nao disponivel aqui (teste pulado)');
      return;
    }
    const { packetizeH264Frame, isH264KeyFrame } = await import(pkg);
    const buf = await gerarH264(2, 15);
    const aus = splitter.dividirAccessUnits(buf);
    let comPacote = 0;
    for (const au of aus) {
      const p = packetizeH264Frame(au);
      if (p.payloads.length > 0) comPacote++;
    }
    ok(comPacote === aus.length, `todos os ${aus.length} AUs viraram pacote RTP (veio ${comPacote})`);
    ok(isH264KeyFrame(aus[0]), 'o primeiro AU e keyframe (tem SPS/PPS + IDR)');
  });
}

await test('tipoNal / ehSlice leem o byte do NAL certo', () => {
  ok(splitter.tipoNal(0x67) === 7, 'SPS (0x67 -> 7)');
  ok(splitter.tipoNal(0x68) === 8, 'PPS (0x68 -> 8)');
  ok(splitter.tipoNal(0x65) === 5, 'IDR (0x65 -> 5)');
  ok(splitter.ehSlice(0x65), 'IDR e slice');
  ok(splitter.ehSlice(0x41), 'non-IDR (0x41 -> 1) e slice');
  ok(!splitter.ehSlice(0x67), 'SPS NAO e slice');
});

await test('o splitter aguenta start code de 3 E de 4 bytes', () => {
  const sps = Buffer.from([0, 0, 0, 1, 0x67, 0x42]);
  const idr = Buffer.from([0, 0, 1, 0x65, 0x88]);
  const p2 = Buffer.from([0, 0, 0, 1, 0x41, 0x9a]);
  const aus = splitter.dividirAccessUnits(Buffer.concat([sps, idr, p2]));
  ok(aus.length === 2, `2 access units (veio ${aus.length})`);
});

// A CAUSA RAIZ do travamento relatado: o `-tune zerolatency` liga o
// sliced-threads do x264, que fatia CADA FRAME em varios slices. Como um access
// unit = um frame, o splitter via 4x mais frames e o motor recebia timestamps
// colapsados (medido: 120 AUs para 30 frames, 179 timestamps repetidos em 4 s).
//
// O teste do splitter acima NAO pega isso: ele gera H.264 SEM `zerolatency`.
// Os testes abaixo usam os argumentos REAIS do modulo.

if (TEM_FFMPEG) {
  await test('os argumentos do encoder desligam o sliced-threads (a causa do travamento)', () => {
    // Chama a FUNCAO do modulo: mede o que o ffmpeg realmente recebe. Ler o
    // arquivo passaria por causa do comentario que cita o parametro.
    const args = midiap.argumentosDoEncoder('/tmp/x.mp4');
    const params = args[args.indexOf('-x264-params') + 1];
    includes(params, 'sliced-threads=0', 'o x264 nao fatia o frame em varios slices');
    includes(params, 'annexb=1', 'Annex-B preservado');
    includes(args.join(' '), '-tune zerolatency', 'o tune que ligava o fatiamento segue aplicado');
  });

  await test('o encoder REAL do modulo da UM slice por frame (30 frames -> 30 AUs)', async () => {
    // Replica os argumentos do `alimentar` (incluindo `zerolatency`).
    const video = path.join(TMP_DB, 'slices.mp4');
    await new Promise((resolve, reject) => {
      const p = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=15:duration=2',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video], { stdio: ['ignore', 'ignore', 'inherit'] });
      p.on('error', reject);
      p.on('close', (c) => (c === 0 ? resolve() : reject(new Error('ffmpeg ' + c))));
    });

    // Usa os argumentos DO MODULO (fonte unica): se alguem tirar o
    // `sliced-threads=0`, este teste fragmenta e falha.
    const fluxo = await new Promise((resolve, reject) => {
      const pedacos = [];
      // stdio: [entrada, video, erros, audio] -- o audio sai no pipe:3.
      // O video deste teste e' gerado SEM audio (sem ),
      // entao a saida de audio nao entra -- senao o ffmpeg aborta.
      const p = spawn(FFMPEG, midiap.argumentosDoEncoder(video, 15, false),
        { stdio: ['ignore', 'pipe', 'ignore', 'ignore'] });
      p.stdout.on('data', (c) => pedacos.push(c));
      p.on('error', reject);
      p.on('close', () => resolve(Buffer.concat(pedacos)));
    });

    const aus = splitter.dividirAccessUnits(fluxo);
    ok(aus.length === 30, `30 access units para 30 frames (veio ${aus.length})`);
    fs.unlinkSync(video);
  });

  await test('SEM sliced-threads=0 o splitter fragmenta (documenta o bug)', async () => {
    // Prova que o parametro e' o que resolve: sem ele o splitter ve' 4x mais
    // "frames". Se este teste deixar de fragmentar, o x264 mudou de padrao.
    const video = path.join(TMP_DB, 'slices2.mp4');
    await new Promise((resolve, reject) => {
      const p = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=15:duration=2',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video], { stdio: ['ignore', 'ignore', 'inherit'] });
      p.on('error', reject);
      p.on('close', (c) => (c === 0 ? resolve() : reject(new Error('ffmpeg ' + c))));
    });
    const fluxo = await new Promise((resolve, reject) => {
      const pedacos = [];
      const p = spawn(FFMPEG, [
        '-hide_banner', '-loglevel', 'error', '-re', '-i', video, '-an',
        '-c:v', 'libx264', '-profile:v', 'baseline', '-level', '3.1',
        '-pix_fmt', 'yuv420p', '-x264-params', 'annexb=1',
        '-preset', 'veryfast', '-tune', 'zerolatency', '-g', '30',
        '-f', 'h264', 'pipe:1'
      ], { stdio: ['ignore', 'pipe', 'ignore'] });
      p.stdout.on('data', (c) => pedacos.push(c));
      p.on('error', reject);
      p.on('close', () => resolve(Buffer.concat(pedacos)));
    });
    const aus = splitter.dividirAccessUnits(fluxo);
    ok(aus.length > 30, `sem o parametro fragmenta (${aus.length} > 30) — e' o bug documentado`);
    fs.unlinkSync(video);
  });

  await test('o timestamp AVANCA sempre (nunca repete, nunca volta)', async () => {
    // O `Date.now()` cru tem resolucao de 1 ms e repetia (medido: 7 em 30
    // frames), o que faz o motor atrasar/descartar. O modulo usa um carimbo
    // monotonico; aqui se mede o resultado pela sequencia enviada ao motor.
    const video = path.join(TMP_DB, 'ts.mp4');
    await new Promise((resolve, reject) => {
      const p = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=15:duration=2',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video], { stdio: ['ignore', 'ignore', 'inherit'] });
      p.on('error', reject);
      p.on('close', (c) => (c === 0 ? resolve() : reject(new Error('ffmpeg ' + c))));
    });

    const carimbos = [];
    midiap.__setVoip({
      requestVideoUpgrade: async () => 'accepted',
      setScreenShare: async () => {},
      setVideoEnabled: async () => {},
      feedLiveVideo: (_id, _au, t) => { carimbos.push(t); return 1; }
    });
    const r = await midiap.transmitir({ grupo: 'gts@g.us', callId: 'CTS', arquivo: video });
    midiap.__setVoip(null);

    ok(r.ok, 'transmitiu');
    ok(carimbos.length === 30, `30 frames (veio ${carimbos.length})`);
    ok(carimbos.every((v, i) => i === 0 || v > carimbos[i - 1]),
      'todo timestamp AVANCA (nunca repete nem volta)');
    const gaps = carimbos.slice(1).map((v, i) => (v - carimbos[i]) / 1000);
    const p50 = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length * 0.5)];
    ok(Math.abs(p50 - 66.7) < 3, `intervalo ~66.7 ms (medido p50 ${p50.toFixed(1)})`);
    fs.unlinkSync(video);
  });
}

// ============================================================================
// 1a) O FPS: o timestamp tem de bater com o video (a causa do travamento)
// ============================================================================

await test('o encoder NAO forca o fps: usa o nativo com `fps_mode passthrough`', () => {
  // ## Por que o `-r` SAIU (causa MEDIDA do "pulo de frames")
  //
  // O ffmpeg JA' le o fps do proprio stream (medido: reporta "25 fps" lendo o
  // pipe). Forcar `-r <fps>` e' o que introduz o defeito quando o numero
  // diverge do real:
  //   - `-r` MAIOR que o real -> DUPLICA frames;
  //   - `-r` MENOR que o real -> DESCARTA frames (o "pulo").
  //
  // E o numero divergia mesmo: o `fpsDoLink` lia o stdout de um comando que
  // mandava o `--print` para o **stderr** (por causa do `-o -`), entao vinha
  // vazio e caia no reserva (15). Num video de 25 fps isso dava `-r 15`:
  // medido, 40% dos quadros perdidos e o jitter subia de 4,3 ms para 33,4 ms.
  //
  // `passthrough` copia os frames como chegam -- sem duplicar nem descartar,
  // qualquer que seja o fps real.
  const args = midiap.argumentosDoEncoder('/tmp/x.mp4', 30);
  ok(!args.includes('-r'), 'nao forca o fps (o defeito do pulo)');
  const i = args.indexOf('-fps_mode');
  ok(i >= 0 && args[i + 1] === 'passthrough', 'usa fps_mode passthrough');
  // O GOP acompanha o fps pedido (keyframe a cada ~1 s): o motor so' ABRE o
  // stream quando ve um keyframe, entao ele mais frequente abre mais rapido.
  const g = args.indexOf('-g');
  ok(args[g + 1] === '30', `GOP = fps (veio ${args[g + 1]})`);
});

await test('o fpsDoLink le o valor certo (o --print nao vai para o stdout com -o -)', () => {
  // BUG MEDIDO: com o `-o -` do `baseDoLink`, o yt-dlp manda o `--print` para o
  // STDERR e deixa o STDOUT vazio. O codigo lia so' o stdout -> sempre vazio ->
  // sempre o fps de reserva.
  const src = fs.readFileSync(path.join(HERE, '..', 'dados/src/funcs/utils/midiapLink.js'), 'utf-8');
  const i = src.indexOf('export async function fpsDoLink');
  const bloco = src.slice(i, src.indexOf('\n}', i));
  // O comentario do bloco CITA o baseDoLink (para explicar por que nao usa);
  // a prova e' nao haver CHAMADA a ele.
  ok(!/\.\.\.baseDoLink\(/.test(bloco), 'nao chama o baseDoLink (o `-o -` desvia o --print)');
  includes(bloco, 'stderr', 'le o stderr tambem (o yt-dlp imprime o valor nele)');
  includes(bloco, 'argumentosAntiBloqueio', 'usa a receita (sem ela o --print falha em IP bloqueado)');
  includes(bloco, 'formatoDoVideo', 'usa o MESMO seletor do download (senao o fps e de outro formato)');
  // E o reserva deixou de ser 15 (um valor MENOR que o real descarta frames).
  // O reserva vive no midiap.js (e' o modulo do encoder).
  const md = fs.readFileSync(path.join(HERE, '..', 'dados/src/funcs/utils/midiap.js'), 'utf-8');
  includes(md, 'const FPS_PADRAO = 25', 'o reserva e 25 (15 descartaria quadros)');
});

if (TEM_FFMPEG) {
  await test('fpsDoVideo le o fps REAL do arquivo', async () => {
    for (const fps of [15, 30]) {
      const video = path.join(TMP_DB, `fps${fps}.mp4`);
      await new Promise((resolve, reject) => {
        const p = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y',
          '-f', 'lavfi', '-i', `testsrc=size=320x180:rate=${fps}:duration=1`,
          '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video],
          { stdio: ['ignore', 'ignore', 'inherit'] });
        p.on('error', reject);
        p.on('close', (c) => (c === 0 ? resolve() : reject(new Error('ffmpeg ' + c))));
      });
      const lido = await midiap.fpsDoVideo(video);
      ok(lido === fps, `video de ${fps} fps -> detectado ${lido}`);
      fs.unlinkSync(video);
    }
  });

  await test('fpsDoVideo tem teto e nao explode com arquivo ruim', async () => {
    const ruim = path.join(TMP_DB, 'nao-e-video.txt');
    fs.writeFileSync(ruim, 'isto nao e um video');
    const r = await midiap.fpsDoVideo(ruim);
    ok(r > 0 && r <= 30, `devolveu um fps valido (${r}) em vez de quebrar`);
    fs.unlinkSync(ruim);
  });

  await test('o timestamp BATE com o video (fim do descompasso)', async () => {
    // Mede o passo dos timestamps enviados ao motor num video de 30 fps.
    // Antes (fps fixo em 15) o passo era 66,7 ms; agora tem de ser ~33,3.
    const video = path.join(TMP_DB, 'bate.mp4');
    await new Promise((resolve, reject) => {
      const p = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=2',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video],
        { stdio: ['ignore', 'ignore', 'inherit'] });
      p.on('error', reject);
      p.on('close', (c) => (c === 0 ? resolve() : reject(new Error('ffmpeg ' + c))));
    });

    const carimbos = [];
    midiap.__setVoip({
      requestVideoUpgrade: async () => 'accepted',
      setScreenShare: async () => {},
      setVideoEnabled: async () => {},
      setExternalAudioMode: () => {},
      feedLiveVideo: (_id, _au, t) => { carimbos.push(t); return 1; },
      feedLiveAudio: () => 0
    });
    const r = await midiap.transmitir({ grupo: 'gfp@g.us', callId: 'CF', arquivo: video });
    midiap.__setVoip(null);

    ok(r.ok, 'transmitiu');
    ok(carimbos.length >= 58 && carimbos.length <= 62,
      `~60 frames de um video de 30 fps por 2 s (veio ${carimbos.length})`);
    // O passo e' medido em BLOCOS: o dublê roda sincrono e o relogio do teste
    // pode esticar um trecho. O que importa e' a TAXA no conjunto: a duracao
    // total dividida pelo numero de frames tem de dar ~33,3 ms.
    const passoMedio = (carimbos[carimbos.length - 1] - carimbos[0])
      / (carimbos.length - 1) / 1000;
    ok(Math.abs(passoMedio - 33.3) < 6,
      `passo medio ~33,3 ms (medido ${passoMedio.toFixed(1)}) — era 66,7 com o fps fixo`);
    // E o timestamp NUNCA pode correr a frente do relogio (era o bug: 119/120
    // iam adiante, ate' 468 ms, e o motor segurava o frame do futuro).
    ok(carimbos.every((v, i) => i === 0 || v > carimbos[i - 1]),
      'todo timestamp AVANCA (nunca repete nem volta)');
    fs.unlinkSync(video);
  });

  await test('o bitrate tem TETO (conteudo complexo nao estoura a banda)', () => {
    // Medido: conteudo complexo em 720p sem teto chega a 5,4 Mbps -- a banda da
    // call nao acompanha e os frames se perdem. Com teto, 2,2 Mbps.
    const args = midiap.argumentosDoEncoder('/tmp/x.mp4', 30);
    const i = args.indexOf('-maxrate');
    ok(i >= 0, 'declara o teto de bitrate');
    const valor = Number(args[i + 1].replace('k', ''));
    ok(valor > 0 && valor <= 4000, `teto dentro da banda da call (${valor} kbps)`);
    ok(args.includes('-bufsize'), 'declara o bufsize (exigido junto do maxrate)');
  });
}

await test('com LINK o encoder le DUAS entradas e a saida de audio vai ao pipe:4', () => {
  // No link o video e o audio chegam em pipes SEPARADOS (dois yt-dlp) e o fd3
  // esta' ocupado com a ENTRADA de audio -> a saida PCM tem de ir ao fd4.
  const args = midiap.argumentosDoEncoder('pipe:0', 15, true, 'pipe:3');
  const j = args.join(' ');
  ok(args.filter((a) => a === '-i').length === 2, 'declara DUAS entradas (-i)');
  includes(j, 'pipe:3', 'o audio entra pelo pipe:3');
  includes(j, 'pipe:4', "a saida de audio vai ao pipe:4 (o fd3 esta ocupado)");
  includes(j, '-map 1:a', 'o audio vem da SEGUNDA entrada');
  ok(!j.includes('pipe:3 -f') && !j.includes('f32le pipe:3'), 'nao escreve PCM no fd de entrada');
  // Sem a 2a entrada nada muda: continua uma entrada e PCM no pipe:3.
  const um = midiap.argumentosDoEncoder('pipe:0', 15, true).join(' ');
  ok(!um.includes('pipe:4'), 'com uma entrada nao usa o pipe:4');
  includes(um, 'f32le pipe:3', 'com uma entrada o PCM fica no pipe:3');
});

// ============================================================================
// 1b) O AUDIO da transmissao (o pedido: "esta sem audio do video")
// ============================================================================

if (TEM_FFMPEG) {
  await test('os argumentos pedem PCM mono 16 kHz como 2a SAIDA (o formato do motor)', () => {
    // O audio e' a segunda saida do MESMO ffmpeg (pipe:3), nao outro processo.
    const args = midiap.argumentosDoEncoder('/tmp/x.mp4', 30);
    const j = args.join(' ');
    includes(j, 'pipe:3', 'o audio sai no pipe:3');
    includes(j, '-ac 1', 'mono (a doc do motor: "live mono PCM")');
    includes(j, '-ar 16000', '16 kHz (a AUDIO_SAMPLE_RATE do motor)');
    includes(j, '-f f32le', 'Float32 cru (o formato do feedLiveAudio)');
    includes(j, '-re', 'pacing: le na taxa nativa');
    includes(j, 'agate=threshold=0.001', 'a cadeia que tira o chiado (limiar medido)');
  });

  await test('o motor recebe AMOSTRAS de verdade (nao silencio)', async () => {
    // Video COM audio: um tom de 440 Hz, estereo 44.1 kHz -- o ffmpeg tem de
    // converter para mono 16 kHz.
    const video = path.join(TMP_DB, 'com-audio.mp4');
    await new Promise((resolve, reject) => {
      const p = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=15:duration=2',
        '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-ar', '44100', '-ac', '2', '-shortest', video],
        { stdio: ['ignore', 'ignore', 'inherit'] });
      p.on('error', reject);
      p.on('close', (c) => (c === 0 ? resolve() : reject(new Error('ffmpeg ' + c))));
    });

    let amostras = 0;
    let pico = 0;
    const externo = [];
    midiap.__setVoip({
      requestVideoUpgrade: async () => 'accepted',
      setScreenShare: async () => {},
      setVideoEnabled: async () => {},
      setExternalAudioMode: (_id, on) => { externo.push(on); },
      feedLiveVideo: () => 1,
      feedLiveAudio: (_id, pcm) => {
        amostras += pcm.length;
        for (let i = 0; i < pcm.length; i += 29) {
          const a = Math.abs(pcm[i]);
          if (a > pico) pico = a;
        }
        return 0;
      }
    });

    const r = await midiap.transmitir({ grupo: 'ga@g.us', callId: 'CA', arquivo: video });
    midiap.__setVoip(null);

    ok(r.ok, 'transmitiu');
    // 2 s a 16 kHz = 32000 amostras. O alimentador entrega por FRAME (960)
    // num ritmo proprio, entao o total e' sempre multiplo de 960 e pode ficar
    // um frame abaixo do ideal (o ultimo frame parcial nao e' entregue).
    ok(amostras >= 30000 && amostras <= 33000, `~32000 amostras (veio ${amostras})`);
    ok(amostras % 960 === 0, `multiplo de 960 (o frame do motor; veio ${amostras})`);
    ok(pico > 0.05, `o sinal NAO e silencio (pico ${pico.toFixed(3)})`);
    ok(r.amostras === amostras, 'o total de amostras volta no resultado');
    fs.unlinkSync(video);
  });

  await test('o MODO EXTERNO de audio liga e desliga (senao o video sai mudo)', async () => {
    const video = path.join(TMP_DB, 'ext.mp4');
    await new Promise((resolve, reject) => {
      const p = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=15:duration=1',
        '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', video],
        { stdio: ['ignore', 'ignore', 'inherit'] });
      p.on('error', reject);
      p.on('close', (c) => (c === 0 ? resolve() : reject(new Error('ffmpeg ' + c))));
    });

    const externo = [];
    midiap.__setVoip({
      requestVideoUpgrade: async () => 'accepted',
      setScreenShare: async () => {},
      setVideoEnabled: async () => {},
      setExternalAudioMode: (_id, on) => { externo.push(on); },
      feedLiveVideo: () => 1,
      feedLiveAudio: () => 0
    });
    await midiap.transmitir({ grupo: 'ge@g.us', callId: 'CE', arquivo: video });
    midiap.__setVoip(null);

    ok(externo[0] === true, 'LIGA o modo externo ao comecar (sem isto o motor ignora o feed)');
    ok(externo[externo.length - 1] === false, 'DESLIGA ao terminar (volta ao pre-carregado)');
    fs.unlinkSync(video);
  });

  await test('video SEM faixa de audio nao quebra a transmissao', async () => {
    // Best-effort: o ffmpeg de audio sai com erro, mas o video segue.
    const video = path.join(TMP_DB, 'sem-audio.mp4');
    await new Promise((resolve, reject) => {
      const p = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=15:duration=1',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', video],
        { stdio: ['ignore', 'ignore', 'inherit'] });
      p.on('error', reject);
      p.on('close', (c) => (c === 0 ? resolve() : reject(new Error('ffmpeg ' + c))));
    });

    let frames = 0;
    midiap.__setVoip({
      requestVideoUpgrade: async () => 'accepted',
      setScreenShare: async () => {},
      setVideoEnabled: async () => {},
      setExternalAudioMode: () => {},
      feedLiveVideo: () => { frames++; return 1; },
      feedLiveAudio: () => 0
    });
    const r = await midiap.transmitir({ grupo: 'gs@g.us', callId: 'CS', arquivo: video });
    midiap.__setVoip(null);

    ok(r.ok, 'a transmissao segue');
    ok(frames > 0, `o video saiu mesmo sem audio (${frames} frames)`);
    fs.unlinkSync(video);
  });

  await test('o `parar` mata o ffmpeg E os dois yt-dlp (nao deixa orfao)', async () => {
    // UM ffmpeg (video+audio muxados por ele) e, no LINK, DOIS yt-dlp -- um
    // do video, outro do audio. Nenhum pode ficar baixando depois do parar.
    const md = fs.readFileSync(path.join(HERE, '..', 'dados/src/funcs/utils/midiap.js'), 'utf-8');
    const i = md.indexOf('export function parar');
    const bloco = md.slice(i, i + 800);
    includes(bloco, 'estado.proc?.kill', 'mata o ffmpeg');
    includes(bloco, 'estado.procLink?.kill', 'mata o yt-dlp do video');
    includes(bloco, 'estado.procLinkAudio?.kill', 'mata o yt-dlp do audio');
  });
}

// ============================================================================
// 1b-bis) O AUDIO: backpressure (sem corte) e sem gate que atrase
// ============================================================================

await test('o audio tem backpressure nos watermarks do MOTOR (sem corte)', () => {
  // MEDIDO no pacote (@zapo-js/voip): o motor DESCARTA as amostras mais antigas
  // quando o buffer passa de `extMaxBuffer` (750 ms) e publica o contrato
  // pause/resume (120 ms / 60 ms). Alimentar sem olhar isso enchia os 750 ms:
  // em 6 s de audio o motor descartou 53 vezes -- era o "cortando/travando".
  const md = fs.readFileSync(path.join(HERE, '..', 'dados/src/funcs/utils/midiap.js'), 'utf-8');
  includes(md, 'AUDIO_MAX_MS', 'tem teto de buffer');
  includes(md, 'AUDIO_RESUME_MS', 'tem o nivel de retomada');
  includes(md, 'getLiveBufferMs', 'le o nivel REAL do motor (nao um contador nosso)');
  includes(md, 'feedLiveAudio', 'alimenta o motor');
  // O teto tem de ser MENOR que o limite de descarte do motor (750 ms).
  const m = md.match(/const AUDIO_MAX_MS = (\d+);/);
  ok(m, 'AUDIO_MAX_MS declarado');
  ok(Number(m[1]) < 750, `teto abaixo do limite de descarte do motor (${m[1]} < 750)`);
});

await test('o audio sai em RITMO CONSTANTE (fila + relogio proprio)', () => {
  // MEDIDO: o `-re` do ffmpeg entrega em RAJADAS — 299 de 377 chegadas com
  // intervalo ZERO e ate' 282 ms de silencio. Entregar isso direto ao motor
  // da' os DOIS sintomas: nos vaos ele fica sem amostra (CORTA) e na rajada
  // acumula (ATRASA).
  //
  // A solucao: o ffmpeg escreve numa FILA e um timer entrega ao motor em
  // ritmo fixo (1 frame de 60 ms a cada 60 ms). O jitter fica todo na fila.
  const md = fs.readFileSync(path.join(HERE, '..', 'dados/src/funcs/utils/midiap.js'), 'utf-8');
  includes(md, 'enfileirarAudio', 'o PCM entra numa fila');
  includes(md, 'bombearAudio', 'um bombeador entrega ao motor');
  includes(md, 'MS_POR_FRAME', 'o ritmo e por frame do motor');
  // O relogio e' por CONTAGEM de frames (nao acumula deriva) e ancora no
  // MESMO instante zero do video (o `tZero`) — era o que fazia os dois
  // sairem no mesmo milissegundo.
  const i = md.indexOf('const timerAudio = setInterval');
  const bloco = md.slice(i, i + 5200);
  // O ritmo e' ancorado no ULTIMO frame entregue (`proximoDevidoMs`), nao no
  // relogio absoluto: comparar com o tempo total acumulava divida e o audio
  // atrasava 3 s (o relato do dono).
  includes(bloco, 'proximoDevidoMs', 'o ritmo ancora no ultimo entregue');
  includes(bloco, 'MS_POR_FRAME', 'um frame por intervalo do motor');
  // O backpressure le o nivel REAL do motor (o contrato dele), nao um contador
  // nosso: era isso que enchia o buffer e atrasava o audio.
  includes(bloco, 'getLiveBufferMs', 'le o nivel real do motor');
  // O gate e' a HISTERESE do contrato do motor (`pauseMs`/`resumeMs`): para ao
  // encher, volta so' quando drena. Um discriminador ("nivel mudando") foi
  // MEDIDO como ERRADO: durante o engasgo o nivel fica constante entre as
  // entregas e ele lia isso como "nao e' backpressure", enchendo o buffer ate'
  // 750 ms (o audio ficava 690 ms atrasado para sempre).
  includes(bloco, 'AUDIO_PAUSE_MS', 'usa o pauseMs do contrato do motor');
  includes(bloco, 'AUDIO_RESUME_MS', 'usa o resumeMs (histerese, nao limiar unico)');
  includes(bloco, 'estado.audioSegurando', 'a histerese tem memoria do estado');
  // E o atraso acumulado e' DESCARTADO (volta ao tempo real).
  includes(bloco, 'FILA_MAX_FRAMES', 'descarta quando a fila passa do teto');
});

await test('o VIDEO e liberado pelo MESMO relogio (sincronia no ms)', () => {
  // MEDIDO: o video corria NA FRENTE (2120 ms de conteudo em 2000 ms de
  // relogio) porque o `-re` do ffmpeg nao segura — ele entrega por chegada.
  // O audio, limitado por frame, entregava no tempo. O resultado era o video
  // adiantado e o audio "atrasado" (-140 a -180 ms).
  //
  // Agora o video tambem passa por uma fila com instante nominal: os dois saem
  // no mesmo milissegundo (medido: 0 ms de diferenca no 1o frame).
  const md = fs.readFileSync(path.join(HERE, '..', 'dados/src/funcs/utils/midiap.js'), 'utf-8');
  includes(md, 'filaVideo', 'o video entra numa fila');
  includes(md, 'bombearVideo', 'um bombeador libera o video pelo relogio');
  const i = md.indexOf('estado.bombearVideo');
  const bloco = md.slice(i, i + 2200);
  // O video NAO pode ser liberado pelo relogio absoluto (`Date.now() - tZero`):
  // quando o motor SEGURA o audio, o relogio continua e o video fica na frente
  // (MEDIDO: 2960 ms, e nunca voltava). Ele segue o TEMPO DE MIDIA ja'
  // entregue do audio — se o audio para, o video para junto.
  includes(bloco, 'estado.tempoAudioMs', 'o video segue o tempo de midia do audio');
  // O passo do video e' MEDIDO (o fps declarado pode estar errado: MEDIDO no
  // log, o video era 30 fps com , e 20% dos frames eram descartados).
  includes(bloco, 'passoVideoMs', 'o passo do video e o medido, nao o declarado');
  ok(!/Date\.now\(\) - estado\.tZero/.test(bloco), 'o video NAO usa o relogio absoluto (a causa do atraso)');
  // O timer do audio bombeia o video tambem (um relogio so).
  const t = md.indexOf('const timerAudio = setInterval');
  includes(md.slice(t, t + 300), 'bombearVideo', 'o timer do audio tambem bombeia o video');
  // E a fila do video e' esvaziada no fim (senao o video termina antes).
  const c = md.indexOf("proc.on('close'");
  includes(md.slice(c, c + 2500), 'filaVideo', 'esvazia a fila do video no fim');
});

await test('o gate do nivel NAO trava com o PISO do motor (a regressao do delay)', () => {
  // O motor reporta um PISO em `getLiveBufferMs` (~100 ms): ele mede o que
  // esta' A FRENTE do consumidor e nao desce abaixo disso. Um gate de LIMIAR
  // no nivel (`nivel >= alvo`) trava PARA SEMPRE quando o alvo fica abaixo do
  // piso: o audio para de sair, o `tempoAudioMs` congela, o video congela
  // junto e o delay CRESCE sem limite (o relato do dono).
  //
  // MEDIDO com um motor de piso: limiar 30 -> 0 ms entregues em 21 s e o
  // atraso crescendo 18 s. O gate tem de exigir o nivel MUDANDO.
  const md = fs.readFileSync(path.join(HERE, '..', 'dados/src/funcs/utils/midiap.js'), 'utf-8');
  const t = md.indexOf('const timerAudio = setInterval');
  const bloco = md.slice(t, t + 5200);
  includes(bloco, 'estado.audioSegurando', 'o gate tem memoria (histerese)');
  includes(bloco, 'AUDIO_RESUME_MS', 'volta a entregar no resumeMs do motor');
  // NAO pode voltar ao discriminador "nivel mudando" (era o bug: no engasgo o
  // nivel fica constante e ele continuava entregando ate' 750 ms).
  ok(!/nivelMudou/.test(bloco), 'nao usa o discriminador de nivel mudando (era o bug)');
  // O video segue o que o OUVINTE ja' ouviu (entregue menos o buffer), nao o
  // que foi entregue: com o buffer cheio o som atrasa e o video espera junto.
  const v = md.indexOf('estado.bombearVideo');
  // O video segue a POSICAO DE CONTEUDO do audio (avanca na entrega E no
  // descarte): quando o audio pula para frente, o video pula junto.
  // O video segue o que o OUVINTE JA' OUVIU (posicao de conteudo menos o
  // buffer do motor) e' o que centraliza os dois sem atraso.
  includes(md.slice(v, v + 3600), 'posicaoOuvidaMs', 'o video segue o que o ouvinte ja ouviu');
});

await test('o TETO da fila vale SEMPRE (o backlog do engasgo nao fica preso)', () => {
  // Durante um engasgo a fila cresce (o ffmpeg continua produzindo e o motor
  // nao consome). Se o teto so' valesse ENQUANTO o motor segura, ao retomar
  // entregariamos todo o backlog a 1x e o conteudo ficaria atras para sempre
  // (MEDIDO: 6 s apos dois engasgos de 3 s).
  //
  // Com o teto valendo sempre, o atraso fica LIMITADO ao tamanho da fila,
  // independente de quanto durou o engasgo.
  const md = fs.readFileSync(path.join(HERE, '..', 'dados/src/funcs/utils/midiap.js'), 'utf-8');
  const t = md.indexOf('const timerAudio = setInterval');
  const bloco = md.slice(t, t + 5200);
  // O `while` do teto tem de vir ANTES do `if (segurando)` — senao so' roda
  // enquanto o motor segura (era o bug).
  const posTeto = bloco.indexOf('fila.length > FILA_MAX_FRAMES');
  const posSegurando = bloco.indexOf('if (segurando)');
  ok(posTeto > -1, 'o teto da fila existe');
  ok(posSegurando > -1, 'o gate de pausa existe');
  ok(posTeto < posSegurando, 'o teto roda ANTES do gate (vale sempre, nao so segurando)');
  // E o descarte avanca a posicao de conteudo (o video pula junto).
  const b2 = bloco.slice(posTeto, posTeto + 700);
  includes(b2, 'posicaoAudioMs', 'o descarte avanca a posicao de conteudo (o video pula junto)');
});

await test('PREROLL: so comeca quando os DOIS fluxos estao prontos', () => {
  // Pedido do dono: *"nao tem como gravar de comeco e so comecar a transmissao
  // quando os dois estiverem prontos e sincronizados?"*.
  //
  // Antes, o 1o frame de video marcava o tZero e ia direto para o ar, com o
  // audio ainda chegando. Agora nada sai ate' haver material dos DOIS.
  const md = fs.readFileSync(path.join(HERE, '..', 'dados/src/funcs/utils/midiap.js'), 'utf-8');
  includes(md, 'PREROLL_FRAMES', 'espera um minimo de frames de cada fluxo');
  includes(md, 'PREROLL_MAX_MS', 'tem teto de espera (video sem audio nao trava)');
  includes(md, 'tentarPreroll', 'existe o gatilho do preroll');
  const i = md.indexOf('tentarPreroll = () => {\n      if (estado.parado');
  const bloco = md.slice(i, i + 1800);
  includes(bloco, 'prerollFeito = true', 'libera a transmissao');
  includes(bloco, 'estado.tZero = Date.now()', 'marca o instante zero no preroll');
  // O relogio dos DOIS nasce no mesmo instante (frame 0 = ms 0 de cada um).
  includes(bloco, 'estado.proximoDevidoMs = estado.tZero', 'o relogio do audio nasce junto');
  // Chamado pelos DOIS produtores: sem o do audio, o preroll nunca liberaria.
  includes(md, 'tentarPreroll();\n    });', 'o video chama o preroll');
  includes(md, 'tentarPreroll();\n      } catch (e) {', 'o audio chama o preroll');
  // E o `enviarFrame` NAO pode mais sobrescrever o tZero (moveria o relogio).
  const e = md.indexOf('function enviarFrame');
  ok(!/estado\.tZero = Date\.now\(\)/.test(md.slice(e, e + 900)), 'enviarFrame nao sobrescreve o tZero do preroll');
});

await test('o audio reagrupa em frames de 960 amostras (o que o motor espera)', () => {
  // A doc do pacote: *"16 kHz, mono, 960-sample frames (60 ms)"*. O pipe
  // entrega ~372 amostras (23 ms) — entregar assim faz o encoder do motor
  // remontar o frame a cada pedaco (som cortado).
  const md = fs.readFileSync(path.join(HERE, '..', 'dados/src/funcs/utils/midiap.js'), 'utf-8');
  includes(md, 'const FRAME_MOTOR = 960', 'o frame do motor e 960');
  const i = md.indexOf('const enfileirarAudio');
  const bloco = md.slice(i, i + 700);
  includes(bloco, 'FRAME_MOTOR', 'so enfileira frames inteiros');
  includes(bloco, 'slice', 'corta exatamente um frame por vez');
  // E o reagrupamento e' o que garante o tamanho: `asetnsamples` no ffmpeg
  // NAO resolve (medido: continua 348-372 — o chunk e' do pipe).
  // A palavra aparece num COMENTARIO (explicando por que nao se usa); o que
  // nao pode e' virar ARGUMENTO do ffmpeg.
  ok(!/'-af'[^\]]*asetnsamples/.test(md) && !md.includes("'asetnsamples"), 'nao passa asetnsamples ao ffmpeg (medido: nao resolve)');
});

await test('a fila tem TETO e descarta o MAIS ANTIGO (volta ao tempo real)', () => {
  // Sem teto, um atraso acumulado cresceria sem fim. Descartar o mais ANTIGO
  // faz o audio pular para FRENTE (volta ao tempo real) — e' o que o proprio
  // motor faz no buffer dele ("drops the oldest samples on overflow").
  const md = fs.readFileSync(path.join(HERE, '..', 'dados/src/funcs/utils/midiap.js'), 'utf-8');
  includes(md, 'FILA_MAX_FRAMES', 'a fila tem teto');
  // O descarte vive no TIMER do audio (nao no `bombearAudio`): ele so' vale
  // com o motor SEGURANDO (nivel no alvo). No arranque a fila esta' funda
  // porque o ffmpeg produz em rajada — descartar ali perderia audio bom.
  const t = md.indexOf('const timerAudio = setInterval');
  const bloco = md.slice(t, t + 3600);
  includes(bloco, 'estado.fila.shift()', 'descarta do INICIO da fila (o mais antigo)');
  includes(bloco, 'fila.length > FILA_MAX_FRAMES', 'so descarta acima do teto');
  includes(bloco, 'segurando', 'so descarta com o motor segurando');
  // E o `bombearAudio` NAO pode descartar (era o furo: perdia 120 ms no arranque).
  const b = md.indexOf('const bombearAudio');
  ok(!/fila\.length > FILA_MAX_FRAMES/.test(md.slice(b, b + 900)), 'o bombearAudio nao descarta (so entrega)');
});

// ============================================================================
// 1c) O DISCO: nada de filme acumulado
// ============================================================================

await test('o video NAO fica no disco depois da transmissao', async () => {
  // O arquivo e' baixado, usado e apagado -- nao ha acumulo de filme.
  const g = 'disco@g.us';
  const p = midiap.caminhoDoVideo(g, '.mp4');
  fs.writeFileSync(p, Buffer.alloc(2048));
  ok(fs.existsSync(p), 'o arquivo existe enquanto a transmissao roda');

  // O `finally` do comando apaga; aqui se mede o caminho do modulo.
  fs.unlinkSync(p);
  ok(!fs.existsSync(p), 'sai do disco no fim');
});

await test('o comando NAO grava o video em disco (nao ha o que apagar)', () => {
  const src = fs.readFileSync(path.join(HERE, '..', 'dados/src/index.js'), 'utf-8');
  const i = src.indexOf("case 'midiap':");
  const bloco = src.slice(i, src.indexOf("case 'antifantasma':", i));
  // O caminho novo manda o FLUXO direto ao ffmpeg (pipe:0).
  ok(!bloco.includes('fs.writeFileSync'), 'nao escreve arquivo');
  includes(bloco, 'downloadContentFromMessage', 'pega o fluxo decifrado');
  includes(bloco, 'fluxo,', 'passa o fluxo para o modulo');
  ok(!bloco.includes('caminhoDoVideo'), 'nao reserva caminho de arquivo');
});

await test('limparCacheMidiap apaga os orfaos e NAO toca o resto do cache', () => {
  // Simula o bot caindo no meio: arquivos que ninguem mais conhece.
  const g = 'orfaos@g.us';
  const a = midiap.caminhoDoVideo(g, '.mp4');
  const b = midiap.caminhoDoVideo(g, '.mp4');
  fs.writeFileSync(a, Buffer.alloc(4096));
  fs.writeFileSync(b, Buffer.alloc(4096));

  // Um arquivo em OUTRA pasta do cache (o audio da call): nao pode sair.
  const raiz = process.env.CALL_CACHE_DIR;
  const outro = path.join(raiz, 'audio-do-grupo.wav');
  fs.writeFileSync(outro, Buffer.alloc(64));

  const liberado = midiap.limparCacheMidiap();
  ok(liberado >= 8192, `liberou os orfaos (${liberado} bytes)`);
  ok(!fs.existsSync(a) && !fs.existsSync(b), 'os dois orfaos sairam');
  ok(fs.existsSync(outro), 'o audio de outra pasta SOBREVIVEU');
  ok(midiap.limparCacheMidiap() === 0, 'chamar de novo e seguro (idempotente)');
  fs.unlinkSync(outro);
});

await test('o BOOT limpa o cache do midiap (senao acumula em silencio)', () => {
  // O `call-cache` nao entra no backup nem no git: um orfao ficaria para
  // sempre. Como o estado das transmissoes e' em memoria, nada dali
  // sobrevive a um reinicio.
  const c = fs.readFileSync(path.join(HERE, '..', 'dados/src/connect.js'), 'utf-8');
  includes(c, 'limparCacheMidiap', 'chama a limpeza no boot');
});

// ============================================================================
// 1d) O LINK (YouTube e afins) — tambem sem disco
// ============================================================================

await test('o link usa DOIS yt-dlp (video e audio), SEM merge', async () => {
  const lk = await import(new URL('../dados/src/funcs/utils/midiapLink.js', import.meta.url).href);
  const v = lk.argumentosDoLink('https://youtu.be/abc');
  const a = lk.argumentosDoAudio('https://youtu.be/abc');
  const jv = v.join(' ');
  const ja = a.join(' ');
  // O merge (`+ba`) do yt-dlp chama o ffmpeg com as DUAS URLs e morre com
  // SIGSEGV (-11), devolvendo ZERO byte -> o nosso ffmpeg morre com 183.
  // Por isso sao dois processos e quem muxa e' o ffmpeg do bot.
  ok(!jv.includes('+ba') && !ja.includes('+ba'), 'NAO usa merge (+ba) — era o SIGSEGV/183');
  includes(jv, 'height<=', 'o video respeita o teto de altura');
  includes(jv, 'ext=mp4', 'prefere mp4 (o que o encoder do bot espera)');
  includes(ja, 'ba', 'o segundo processo pede SO a faixa de audio');
  ok(!ja.includes('bv*'), 'o processo de audio nao pede video');
  // `protocol^=https` e' OBRIGATORIO: o YouTube entrega 720p+ so' por HLS, e o
  // downloader de HLS do yt-dlp GRAVA cada fragmento no disco (`--Frag16.part`).
  // Medido: 13,4 MB escritos em disco. Com o filtro, o download nativo escreve
  // direto no stdout -- e' o que mantem o "nada vai para o disco".
  includes(jv, 'protocol^=https', 'video: so protocolo HTTPS (HLS grava em disco)');
  includes(ja, 'protocol^=https', 'audio: so protocolo HTTPS (mesma razao)');
  // Os dois mandam para o stdout, sem arquivo.
  for (const [args, nome] of [[v, 'video'], [a, 'audio']]) {
    ok(args.includes('-o') && args.includes('-'), `${nome}: stdout (-o -), sem arquivo`);
    ok(!args.join(' ').includes('/tmp'), `${nome}: nao aponta para arquivo`);
    includes(args.join(' '), '--no-playlist', `${nome}: nao pega a playlist inteira`);
  }
  ok(!jv.includes('--remux-video'), 'nao usa --remux-video (post-processador de arquivo)');
  // O formato pedido nao pode exigir ffmpeg: e' o downloader NATIVO.
  ok(!jv.includes('--ffmpeg-location'), 'o video nao delega ao ffmpeg (downloader nativo)');
});

await test('a receita anti-bloqueio e a do !play (runtime JS + EJS + cookies)', async () => {
  const ab = await import(new URL('../dados/src/funcs/utils/ytdlpAntiBloqueio.js', import.meta.url).href);
  const args = ab.argumentosAntiBloqueio();
  const j = args.join(' ');
  // Sem o runtime JS o YouTube moderno responde "Sign in to confirm you're not
  // a bot" e nao libera formatos -- era o erro relatado no !midiap.
  includes(j, '--js-runtimes', 'habilita o runtime JS do extractor');
  includes(j, '--remote-components', 'autoriza o solver de desafios (EJS)');
  includes(j, 'ejs', 'o solver e o EJS oficial');
  // O runtime padrao e' o PROPRIO Node do bot (zero dependencia nova).
  includes(j, process.execPath, 'usa o Node do bot como runtime');
  // O cliente DEFAULT vem primeiro: medido, e' o unico que entrega o par
  // video-only + audio-only por HTTPS (os nomeados dao 1 muxado de 360p ou HLS).
  const clientes = ab.clientesDoYoutube();
  ok(clientes[0] === 'default', 'o cliente default e o primeiro');
  ok(clientes.length > 1, 'ha clientes de fallback');
  // O sufixo do extractor-args leva o client.
  includes(ab.extractorArgsDoClient('web_safari'), 'player_client=web_safari', 'monta o extractor-args');
  // As deteccoes que o !play usava.
  ok(ab.ehBloqueio('Sign in to confirm you are not a bot'), 'detecta bloqueio');
  ok(!ab.ehBloqueio('video unavailable'), 'nao confunde indisponivel com bloqueio');
  ok(ab.ehFalhaDeAuth('Invalid cookies'), 'detecta falha de cookies');
  // `semCookies` tira o PAR (flag + valor).
  const comCk = ['-a', '--cookies', 'x.txt', '-b'];
  const sem = ab.semCookies(comCk);
  ok(!sem.includes('--cookies') && !sem.includes('x.txt'), 'remove o par --cookies <arquivo>');
  ok(sem.includes('-a') && sem.includes('-b'), 'preserva o resto');
});

await test('o !play e o !midiap compartilham a MESMA receita (fonte unica)', () => {
  // Antes cada modulo montava os proprios argumentos -- e o !midiap nao mandava
  // nada disso, por isso caia no bloqueio que o !play ja sabia contornar.
  const yt = fs.readFileSync(path.join(HERE, '..', 'dados/src/funcs/downloads/youtube.js'), 'utf-8');
  const lk = fs.readFileSync(path.join(HERE, '..', 'dados/src/funcs/utils/midiapLink.js'), 'utf-8');
  for (const [nome, src] of [['youtube.js', yt], ['midiapLink.js', lk]]) {
    includes(src, 'ytdlpAntiBloqueio', `${nome}: importa o modulo compartilhado`);
    includes(src, 'clientesDoYoutube', `${nome}: usa a lista de clientes unica`);
  }
  // Nenhum dos dois pode voltar a ter a lista/valores hardcoded.
  ok(!/const clients = \['web_safari'/.test(yt), 'youtube.js nao tem a lista hardcoded');
  ok(!/return \['web_safari'/.test(lk), 'midiapLink.js nao tem a lista hardcoded');
  // A deteccao de bloqueio/auth tambem vem do modulo unico.
  includes(yt, 'ehBloqueioCmp', 'youtube.js delega a deteccao de bloqueio');
  includes(yt, 'ehFalhaDeAuth', 'youtube.js delega a deteccao de cookies');
});

await test('motivoDoYtdlp traduz a falha do yt-dlp (nao diz "corrompido")', async () => {
  const lk = await import(new URL('../dados/src/funcs/utils/midiapLink.js', import.meta.url).href);
  // O ffmpeg so' ve' um pipe VAZIO e reporta 183 ("corrompido"); o motivo real
  // esta' no stderr do yt-dlp -- e' ele que tem de chegar ao usuario.
  includes(lk.motivoDoYtdlp('ERROR: [youtube] x: This video is unavailable'),
    'não está disponível', 'video indisponivel');
  includes(lk.motivoDoYtdlp('ERROR: Requested format is not available'),
    'formato compatível', 'formato indisponivel');
  includes(lk.motivoDoYtdlp('ERROR: Sign in to confirm you are not a bot'),
    'verificação', 'bloqueio/verificacao');
  includes(lk.motivoDoYtdlp('ERROR: Unable to download webpage: HTTP Error 403'),
    'rede', 'falha de rede');
  ok(lk.motivoDoYtdlp('') === '', 'stderr vazio -> sem motivo inventado');
});

await test('o LINK e aceito pelo modulo como terceira fonte', () => {
  const md = fs.readFileSync(path.join(HERE, '..', 'dados/src/funcs/utils/midiap.js'), 'utf-8');
  includes(md, "link ? 'link'", 'o link vira uma fonte');
  includes(md, "fonte === 'link'", 'a fonte link tem tratamento proprio');
  includes(md, 'abrirLink', 'usa o resolvedor de link');
  // O audio do link vem de um SEGUNDO yt-dlp (o merge do yt-dlp quebra).
  includes(md, 'procLinkAudio', 'guarda o 2o processo (audio)');
  includes(md, 'motivoDoYtdlp', 'reporta o motivo real do yt-dlp');
  // O parar e o fim matam o yt-dlp junto (nao deixam processo orfao).
  const iParar = md.indexOf('export function parar');
  includes(md.slice(iParar, iParar + 800), 'procLink?.kill', 'o parar mata o yt-dlp (video)');
  includes(md.slice(iParar, iParar + 800), 'procLinkAudio?.kill', 'o parar mata o yt-dlp (audio)');
});

await test('o COMANDO aceita BUSCA (texto) e resolve pelo caminho do !play', () => {
  const src = fs.readFileSync(path.join(HERE, '..', 'dados/src/index.js'), 'utf-8');
  const i = src.indexOf("case 'midiap':");
  const bloco = src.slice(i, src.indexOf("case 'antifantasma':", i));
  // Um TEXTO que nao e' link vira busca, com o MESMO `youtube.search` do `!play`.
  includes(bloco, 'youtube.search(argTexto)', 'usa a mesma busca do !play');
  includes(bloco, 'Não encontrei nada para', 'avisa quando a busca nao acha');
  // E o aviso diz que esta procurando (nao "preparando o link").
  includes(bloco, 'Procurando:', 'o aviso mostra que e uma busca');
  // A mensagem de uso cita as tres formas.
  includes(bloco, 'link ou busca', 'a ajuda cita busca');
});

await test('o timestamp do video e uma TIMELINE nominal (passo exato por frame)', () => {
  // Medido: o `-re` do ffmpeg NAO entrega no tempo real (2000 ms de video em
  // 1411 ms de relogio, com rajadas). Carimbar pelo relogio fazia o passo
  // medio cair para ~24 ms e varios frames no MESMO instante (gap 0). A
  // timeline nominal da um passo exato por frame, sem rajada e sem acumulo.
  const md = fs.readFileSync(path.join(HERE, '..', 'dados/src/funcs/utils/midiap.js'), 'utf-8');
  const i = md.indexOf('const carimbo = () => {');
  const bloco = md.slice(i, i + 300);
  includes(bloco, 'indice * passoUs', 'o carimbo e o indice vezes o passo');
  includes(bloco, 'indice += 1', 'avanca um por frame');
  ok(!bloco.includes('hrtime'), 'NAO depende do relogio de chegada');
});

await test('o COMANDO aceita link e nao baixa nada em disco', () => {
  const src = fs.readFileSync(path.join(HERE, '..', 'dados/src/index.js'), 'utf-8');
  const i = src.indexOf("case 'midiap':");
  const bloco = src.slice(i, src.indexOf("case 'antifantasma':", i));
  includes(bloco, 'ehLink', 'detecta o link no argumento');
  includes(bloco, 'midiapLink.fpsDoLink', 'pega o fps sem baixar o video');
  includes(bloco, 'link,', 'passa o link para o modulo');
  ok(!bloco.includes('fs.writeFileSync'), 'NAO grava nada em disco');
});

if (TEM_FFMPEG) {
  await test('LINK: o pipe do yt-dlp alimenta o ffmpeg (video + audio)', async () => {
    // Um "yt-dlp" de verdade: um script que cospe um video local no stdout.
    const fonte = path.join(TMP_DB, 'lk.mp4');
    await new Promise((resolve, reject) => {
      const p = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=2',
        '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
        '-movflags', 'frag_keyframe+empty_moov', fonte],
        { stdio: ['ignore', 'ignore', 'inherit'] });
      p.on('error', reject);
      p.on('close', (c) => (c === 0 ? resolve() : reject(new Error('ffmpeg ' + c))));
    });

    const falso = path.join(TMP_DB, 'ytdlp-falso.sh');
    fs.writeFileSync(falso, `#!/bin/sh\ncat ${fonte}\n`, { mode: 0o755 });
    const anterior = process.env.YTDLP_PATH;
    process.env.YTDLP_PATH = falso;

    let frames = 0; let amostras = 0;
    midiap.__setVoip({
      requestVideoUpgrade: async () => 'accepted',
      setScreenShare: async () => {},
      setVideoEnabled: async () => {},
      setExternalAudioMode: () => {},
      feedLiveVideo: () => { frames++; return 1; },
      feedLiveAudio: (_id, pcm) => { amostras += pcm.length; return 0; }
    });
    const r = await midiap.transmitir({
      grupo: 'glk@g.us', callId: 'CL', link: 'https://youtu.be/abc', fps: 30
    });
    midiap.__setVoip(null);
    if (anterior === undefined) delete process.env.YTDLP_PATH;
    else process.env.YTDLP_PATH = anterior;

    ok(r.ok, `transmitiu pelo link (${r.motivo || ''} ${r.detalhe || ''})`);
    ok(frames >= 58 && frames <= 64, `~60 frames de 30 fps por 2 s (veio ${frames})`);
    // O ritmo e' por frame do motor (960), entao o total e' multiplo de 960.
    ok(amostras >= 30000 && amostras % 960 === 0, `o audio do link chegou em frames (${amostras} amostras)`);
    fs.unlinkSync(fonte);
    fs.unlinkSync(falso);
  });
}

// ============================================================================
// 2) O COMANDO
// ============================================================================

console.log('\n=== 2) O COMANDO (handler real) ===\n');

let groupCounter = 0;
let personCounter = 0;
function makeGroup(extra = {}) {
  groupCounter += 1;
  const jid = `1203638600000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(path.join(GRUPOS_DIR, `${jid}.json`),
    JSON.stringify({ groupName: `Grupo Midiap ${groupCounter}`, ...extra }, null, 2));
  return jid;
}
function makePerson() {
  personCounter += 1;
  const n = String(personCounter).padStart(4, '0');
  return { lid: `5573${n}000000@lid`, jid: `5515${n}999999@s.whatsapp.net`, name: `5573${n}000000` };
}

function instalarDubleMidia({ callId = 'CALL-1' } = {}) {
  const chamadas = [];
  callMedia.__setDubleEntrar({
    entrar: async ({ grupo }) => { chamadas.push({ tipo: 'entrar', grupo }); return { ok: true, callId, stage: 'pronta' }; },
    sair: async () => ({ ok: true }),
    estagio: () => 'pronta'
  });
  return chamadas;
}

function makeNazu({ sent, groupJid, participants }) {
  const map = {};
  for (const p of participants) { map[p.jid] = p.lid; map[p.lid] = p.jid; }
  return {
    sent,
    sendMessage: async (jid, content) => { sent.push({ jid, content }); return { key: { id: 'SENT' } }; },
    user: { id: '5599999999999:5@s.whatsapp.net', lid: '111111111111111@lid', name: 'Lizzy' },
    onWhatsApp: async (jid) => (map[jid] ? [{ jid, exists: true, lid: map[jid] }] : [{ jid, exists: false }]),
    signalRepository: { lidMapping: { getPNForLID: async (lid) => map[lid] || null } },
    groupMetadata: async () => ({
      id: groupJid, subject: 'Grupo Midiap',
      participants: participants.map((p) => ({ id: p.lid, admin: p.isAdmin ? 'admin' : null, phoneNumber: p.jid }))
    }),
    groupParticipantsUpdate: async () => ({}),
    groupRequestParticipantsList: async () => [],
    groupRequestParticipantsUpdate: async () => ({}),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {}, sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => null, react: async () => ({})
  };
}

async function run({ groupJid, sender, text, participants, sent = [], fromMe = true, quoted }) {
  const nazu = makeNazu({ sent, groupJid, participants });
  const ctx = quoted ? { stanzaId: 'Q1', participant: sender.lid, quotedMessage: quoted } : { remoteJid: groupJid, mentionedJid: [] };
  const info = {
    key: { remoteJid: groupJid, fromMe, id: `M-${Math.random().toString(36).slice(2, 10)}`, participant: sender.lid },
    message: { extendedTextMessage: { text, contextInfo: ctx } },
    messageTimestamp: Math.floor(Date.now() / 1000),
    pushName: sender.name
  };
  await handleMessage(nazu, info, null, new Map(), null);
  return {
    text: sent.map((s) => s.content?.text ?? '').filter(Boolean).join('\n'),
    sent
  };
}

function setup(n = 3) {
  const groupJid = makeGroup();
  const admin = makePerson();
  const outros = [];
  for (let i = 0; i < n; i++) outros.push(makePerson());
  const participants = [
    { lid: admin.lid, jid: admin.jid, isAdmin: true },
    ...outros.map((p) => ({ lid: p.lid, jid: p.jid, isAdmin: false })),
    { lid: '111111111111111@lid', jid: '5599999999999@s.whatsapp.net', name: 'Lizzy', isAdmin: true }
  ];
  return { groupJid, admin, participants };
}

await test('!midiap so em grupo', async () => {
  const { admin, participants } = setup(2);
  const out = await run({ groupJid: admin.jid, sender: admin, text: '!midiap', participants });
  includes(out.text, 'só pode ser usado em grupo', 'recusa no PV');
});

await test('!midiap exige call ativa (orienta o !callp)', async () => {
  const { groupJid, admin, participants } = setup(3);
  instalarDubleMidia();
  const out = await run({ groupJid, sender: admin, text: '!midiap', participants });
  includes(out.text, 'Não há chamada ativa', 'avisa');
  includes(out.text, 'callp', 'ensina o comando');
});

await test('!midiap sem video marcado mostra o uso', async () => {
  const { groupJid, admin, participants } = setup(3);
  instalarDubleMidia({ callId: 'CALL-U' });
  await run({ groupJid, sender: admin, text: '!callp', participants });
  const out = await run({ groupJid, sender: admin, text: '!midiap', participants });
  includes(out.text, 'vídeo', 'diz que precisa de um video');
  callState.limparCall(groupJid);
});

await test('!midiap com IMAGEM marcada recusa (so video)', async () => {
  const { groupJid, admin, participants } = setup(3);
  instalarDubleMidia({ callId: 'CALL-I' });
  await run({ groupJid, sender: admin, text: '!callp', participants });
  const out = await run({
    groupJid, sender: admin, text: '!midiap', participants,
    quoted: { imageMessage: { url: 'x', mimetype: 'image/jpeg', mediaKey: Buffer.from('k') } }
  });
  callState.limparCall(groupJid);
});

await test('!midiap parar sem transmissao avisa', async () => {
  const { groupJid, admin, participants } = setup(3);
  instalarDubleMidia({ callId: 'CALL-P' });
  await run({ groupJid, sender: admin, text: '!callp', participants });
  const out = await run({ groupJid, sender: admin, text: '!midiap parar', participants });
  includes(out.text, 'Não estou transmitindo', 'avisa');
  callState.limparCall(groupJid);
});

await test('!midiap esta em BACKGROUND (o handler nao trava)', () => {
  const i = SRC.indexOf("case 'midiap':");
  const j = SRC.indexOf("case 'antifantasma':", i);
  const bloco = SRC.slice(i, j);
  includes(bloco, 'void (async () => {', 'roda em background');
  includes(bloco, 'return; // handler liberado', 'libera o handler');
  includes(bloco, 'midiap.transmitir', 'chama o modulo');
  includes(bloco, 'downloadContentFromMessage', 'baixa o video marcado');
});

await test('!midiap NAO esta em nenhum menu (pedido do dono)', () => {
  const menus = fs.readdirSync(path.join(HERE, '..', 'dados/src/menus'))
    .filter((f) => f.endsWith('.js'))
    .map((f) => fs.readFileSync(path.join(HERE, '..', 'dados/src/menus', f), 'utf-8'))
    .join('\n');
  // Cuidado: `midiaprefix` CONTEM "midiap" como substring — comparar por
  // substring daria falso positivo. Procura o TOKEN do comando.
  ok(!/\bmidiap\b/.test(menus), 'nao aparece em menu nenhum');
  const bpv = fs.readFileSync(path.join(HERE, '..', 'dados/src/utils/blockPv.js'), 'utf-8');
  ok(!bpv.includes("'midiap'"), 'nao esta no blockPv');
});

// ============================================================================
// 3) O CAMINHO DO MOTOR (upgrade -> screen share -> frames)
// ============================================================================

console.log('\n=== 3) O CAMINHO DO MOTOR ===\n');

await test('transmitir: upgrade -> screenshare -> frames -> desliga', async () => {
  const chamadas = { upgrade: 0, screenOn: 0, screenOff: 0, videoOff: 0, frames: 0 };
  midiap.__setDuble(null);

  // Dublê do `voip` (o modulo pega via callMedia.obterVoip).
  const voipFalso = {
    requestVideoUpgrade: async () => { chamadas.upgrade++; return 'accepted'; },
    setScreenShare: async (id, on) => { if (on) chamadas.screenOn++; else chamadas.screenOff++; },
    setVideoEnabled: async (id, on) => { if (!on) chamadas.videoOff++; },
    getLiveBufferMs: () => 0,
    getFeedWatermarksMs: () => ({ pauseMs: 200, resumeMs: 50 }),
    feedLiveVideo: () => { chamadas.frames++; return 1; }
  };
  // Injeta o voip pelo SEAM do modulo (o ESM proibe reatribuir o export
  // do callMedia — mesma armadilha do setGeminiHttpForTest).
  midiap.__setVoip(voipFalso);

  try {
    const video = path.join(TMP_DB, 'v.mp4');
    await new Promise((resolve, reject) => {
      const p = spawn(FFMPEG, [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=10:duration=1',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video
      ], { stdio: ['ignore', 'ignore', 'inherit'] });
      p.on('error', reject);
      p.on('close', (c) => (c === 0 ? resolve() : reject(new Error('ffmpeg ' + c))));
    });

    const r = await midiap.transmitir({ grupo: 'g1@g.us', callId: 'C1', arquivo: video });
    ok(r.ok, 'transmitiu');
    ok(chamadas.upgrade === 1, 'pediu o upgrade de video UMA vez');
    ok(chamadas.screenOn === 1, 'ligou o screen share');
    ok(chamadas.screenOff === 1, 'desligou o screen share no fim');
    ok(chamadas.videoOff === 1, 'desligou o video no fim');
    ok(chamadas.frames >= 8, `enviou os quadros (${chamadas.frames} para 10 frames)`);
    fs.unlinkSync(video);
  } finally {
    midiap.__setVoip(null);
  }
});

await test('transmitir: upgrade recusado NAO liga o screen share', async () => {
  midiap.__setDuble(null);
  // So' a chamada de LIGAR conta: o `finally` sempre chama
  // `setScreenShare(false)` (limpeza), e marcar qualquer chamada como
  // "ligou" faria o teste medir a limpeza em vez do inicio.
  let ligou = false;
  const voipFalso = {
    requestVideoUpgrade: async () => 'rejected',
    setScreenShare: async (_id, on) => { if (on === true) ligou = true; },
    setVideoEnabled: async () => {},
    getLiveBufferMs: () => 0,
    getFeedWatermarksMs: () => ({}),
    feedLiveVideo: () => 0
  };
  midiap.__setVoip(voipFalso);
  // Arquivo REAL: o guarda de `arquivo_ausente` vem antes do upgrade, entao
  // um caminho inexistente mediria a coisa errada.
  const video2 = path.join(TMP_DB, 'recusado.mp4');
  await new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=10:duration=1',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video2
    ], { stdio: ['ignore', 'ignore', 'inherit'] });
    p.on('error', reject);
    p.on('close', (c) => (c === 0 ? resolve() : reject(new Error('ffmpeg ' + c))));
  });
  try {
    const r = await midiap.transmitir({ grupo: 'g2@g.us', callId: 'C2', arquivo: video2 });
    ok(!r.ok, 'nao transmitiu');
    includes(String(r.motivo), 'upgrade', 'motivo do upgrade');
    ok(!ligou, 'NAO ligou o screen share');
    fs.unlinkSync(video2);
  } finally {
    midiap.__setVoip(null);
  }
});

await test('transmitir: arquivo ausente nao chama o motor', async () => {
  midiap.__setDuble(null);
  const r = await midiap.transmitir({ grupo: 'g3@g.us', callId: 'C3', arquivo: '/nao/existe.mp4' });
  ok(!r.ok && r.motivo === 'arquivo_ausente', 'recusa antes de tocar no motor');
});

await test('transmitir: nao transmite dois ao mesmo tempo no mesmo grupo', async () => {
  midiap.__setDuble(null);
  // Um voip que SEGURA o upgrade: a primeira fica em voo e a segunda bate
  // no guarda de concorrencia. Sem depender de tempo de parede.
  let liberar;
  const trava = new Promise((r) => { liberar = r; });
  midiap.__setVoip({
    requestVideoUpgrade: async () => { await trava; return 'accepted'; },
    setScreenShare: async () => {},
    setVideoEnabled: async () => {},
    getLiveBufferMs: () => 0,
    getFeedWatermarksMs: () => ({}),
    feedLiveVideo: () => 0
  });

  const video = path.join(TMP_DB, 'conc.mp4');
  await new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=10:duration=1',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video
    ], { stdio: ['ignore', 'ignore', 'inherit'] });
    p.on('error', reject);
    p.on('close', (c) => (c === 0 ? resolve() : reject(new Error('ffmpeg ' + c))));
  });

  const p1 = midiap.transmitir({ grupo: 'g4@g.us', callId: 'C4', arquivo: video });
  await new Promise((r) => setTimeout(r, 30));   // deixa a 1a entrar no upgrade
  const r2 = await midiap.transmitir({ grupo: 'g4@g.us', callId: 'C4', arquivo: video });
  ok(!r2.ok && r2.motivo === 'ja_transmitindo', `recusa a segunda (veio ${r2.motivo})`);
  liberar();
  await p1;
  midiap.__setVoip(null);
  fs.unlinkSync(video);
});

await test('caminhoDoVideo cria a pasta e o nome e seguro', () => {
  const c = midiap.caminhoDoVideo('grupo@x', '.mp4');
  ok(c.endsWith('.mp4'), 'extensao');
  ok(fs.existsSync(path.dirname(c)), 'a pasta existe');
  ok(!c.includes('@'), 'o jid nao vaza para o caminho');
});

// ============================================================================

callMedia.__setDubleEntrar(null);
midiap.__setDuble(null);

const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log('\n' + '='.repeat(40));
console.log(`RESULTADO: ${RESULTS.length} testes | ${totalOk} asserções ok | ${totalFail} falhas`);
console.log('='.repeat(40));
if (totalFail > 0) process.exit(1);
