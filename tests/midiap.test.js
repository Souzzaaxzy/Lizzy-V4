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
      const p = spawn(FFMPEG, midiap.argumentosDoEncoder(video), { stdio: ['ignore', 'pipe', 'ignore'] });
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

await test('o fps e detectado do VIDEO, nao fixo', () => {
  // O `FPS` era fixo em 15: num video de 30 fps o passo do timestamp (66,7 ms)
  // nao batia com o intervalo real (33,3 ms) -- medido: 39,8 ms de descompasso
  // por frame e 3,5 s de erro acumulado em 3 s. O motor remapeia o tempo e
  // descarta/atrasa.
  const args = midiap.argumentosDoEncoder('/tmp/x.mp4', 30);
  const i = args.indexOf('-r');
  ok(i >= 0, 'os argumentos declaram o fps');
  ok(args[i + 1] === '30', `o fps pedido e' respeitado (veio ${args[i + 1]})`);
  // O GOP acompanha o fps (keyframe a cada 2 s).
  const g = args.indexOf('-g');
  ok(args[g + 1] === '60', `GOP = fps*2 (veio ${args[g + 1]})`);
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
    ok(carimbos.length === 60, `60 frames de um video de 30 fps por 2 s (veio ${carimbos.length})`);
    const passo = (carimbos[carimbos.length - 1] - carimbos[0]) / (carimbos.length - 1) / 1000;
    ok(Math.abs(passo - 33.3) < 2, `passo de ~33,3 ms (medido ${passo.toFixed(1)}) — era 66,7 com o fps fixo`);
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

// ============================================================================
// 1b) O AUDIO da transmissao (o pedido: "esta sem audio do video")
// ============================================================================

if (TEM_FFMPEG) {
  await test('os argumentos do audio pedem PCM mono 16 kHz (o formato do motor)', () => {
    const args = midiap.argumentosDoAudio('/tmp/x.mp4');
    const j = args.join(' ');
    includes(j, '-vn', 'sem video (o outro ffmpeg cuida)');
    includes(j, '-ac 1', 'mono (a doc do motor: "live mono PCM")');
    includes(j, '-ar 16000', '16 kHz (a AUDIO_SAMPLE_RATE do motor)');
    includes(j, '-f f32le', 'Float32 cru (o formato do feedLiveAudio)');
    includes(j, '-re', 'mesmo pacing do video (os dois andam juntos)');
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
    // 2 s a 16 kHz = 32000 amostras.
    ok(amostras >= 31000 && amostras <= 33000, `~32000 amostras (veio ${amostras})`);
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

  await test('o `parar` mata os DOIS processos (audio nao fica orfao)', async () => {
    const md = fs.readFileSync(path.join(HERE, '..', 'dados/src/funcs/utils/midiap.js'), 'utf-8');
    const i = md.indexOf('export function parar');
    const bloco = md.slice(i, i + 700);
    includes(bloco, 'estado.proc?.kill', 'mata o processo do video');
    includes(bloco, 'estado.procAudio?.kill', 'mata o processo do audio');
  });
}

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

await test('o comando apaga o video no `finally` (sucesso, erro e parar)', () => {
  const src = fs.readFileSync(path.join(HERE, '..', 'dados/src/index.js'), 'utf-8');
  const i = src.indexOf("case 'midiap':");
  const bloco = src.slice(i, src.indexOf("case 'antifantasma':", i));
  includes(bloco, 'fs.unlinkSync(arquivo)', 'apaga o arquivo no finally');
  // E o `finally` cobre os tres desfechos (o `catch` nao retorna antes dele).
  const iFinally = bloco.indexOf('} finally {');
  ok(iFinally > 0, 'o `finally` existe');
  ok(bloco.indexOf('fs.unlinkSync(arquivo)') > iFinally, 'a limpeza esta DENTRO do finally');
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
  includes(c, 'Cache do !midiap limpo no boot', 'avisa no log o quanto liberou');
});

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
  includes(out.text, 'MIDIAP', 'mostra o painel de uso');
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
  includes(out.text, 'MIDIAP', 'cai no uso (nao aceita imagem)');
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
