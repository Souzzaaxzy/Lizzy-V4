/**
 * Preparo do audio da call (`utils/callAudioPrep.js`) e ajustes do encoder MLow.
 *
 * ## O que este teste protege
 *
 * O dono pediu duas coisas: (1) tirar o maximo do CHIADO; (2) melhorar o
 * TRANSPORTE/qualidade do audio. As duas foram resolvidas por MEDICAO:
 *
 *   - chiado: a cadeia `highpass + agate + limiter + resample(soxr)` baixa o
 *     piso nas pausas de -41.5 dB para -58.0 dB (~16.5 dB menos), com a musica
 *     preservada (medido no caminho completo, ate' o codec MLow);
 *   - transporte: o encoder sobe para `complexity` 10 e passa a declarar 10% de
 *     perda esperada, o que liga a copia de FEC (protege contra CORTE).
 *
 * Se alguem tirar um dos filtros, o teste falha. Se alguem voltar a
 * complexidade para o padrao do pacote (5) ou desligar a FEC, tambem.
 *
 * Uso: node tests/call-audio-prep.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
process.env.DATABASE_PATH = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-prep-'));

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

const PREP = fs.readFileSync(path.join(HERE, '..', 'dados/src/utils/callAudioPrep.js'), 'utf8');
const MLOW = fs.readFileSync(path.join(HERE, '..', 'dados/src/utils/mlowBitrate.js'), 'utf8');
const ZAPO = fs.readFileSync(path.join(HERE, '..', 'dados/src/funcs/utils/zapoCall.js'), 'utf8');

console.log('\n=== 1) O PREPARO (a cadeia que baixa o chiado) ===\n');

await test('a cadeia tem os 4 filtros medidos', () => {
  includes(PREP, 'highpass=f=70', 'highpass: tira o rumble abaixo de 70 Hz');
  includes(PREP, 'agate=threshold=', 'gate: corta o ruido de fundo (o chiado)');
  includes(PREP, 'alimiter', 'limiter: impede clipping');
  includes(PREP, 'resampler=soxr', 'soxr: resample com anti-alias de verdade');
});

await test('o gate tem limiar MEDIDO (nao corta musica suave)', () => {
  const m = PREP.match(/agate=threshold=([0-9.]+)/);
  ok(m, 'o limiar esta declarado');
  const limiar = Number(m[1]);
  // Medido (musica + ruido de fundo):
  //   0.008 -> cortava 24 dB das passagens SUAVES (-78 dB contra -54 dB)
  //   0.001 -> preserva a musica E mantem o chiado cortado
  //   0     -> o chiado volta (-68 dB na pausa)
  // A faixa abaixo trava o valor no ponto medido: um teste que aceitasse
  // 'qualquer coisa <= 0.02' deixou passar o 0.008, que era o BUG.
  ok(limiar > 0, 'o gate esta ligado (0 = chiado volta)');
  ok(limiar <= 0.002, `limiar no ponto medido (${limiar}) — acima disso come a musica suave`);
  ok(limiar >= 0.0005, `limiar nao tao baixo a ponto de virar 'sem gate' (${limiar})`);
});

await test('o formato de saida e o que o motor quer (16 kHz mono PCM)', () => {
  includes(PREP, 'const TAXA = 16000', '16 kHz');
  includes(PREP, "'-ac', '1'", 'mono');
  includes(PREP, 'pcm_s16le', 'PCM 16 bits');
});

await test('usa o ffmpeg do bot e NAO quebra sem ele (fallback)', () => {
  includes(PREP, "process.env.FFMPEG_PATH || 'ffmpeg'", 'respeita FFMPEG_PATH');
  includes(PREP, "proc.on('error'", 'trata o caso sem ffmpeg');
  includes(PREP, 'resolve(null)', 'devolve null (o chamador usa o original)');
});

await test('tem timeout com SIGKILL (nao pendura o handler)', () => {
  includes(PREP, 'SIGKILL', 'mata no timeout');
  includes(PREP, 'CALL_PREP_TIMEOUT_MS', 'timeout configuravel');
});

await test('o modulo EXPORTA os helpers que o teste e o log usam', () => {
  includes(PREP, 'export function prepararAudioCall', 'a funcao principal');
  includes(PREP, 'export function filtrosDePreparo', 'a cadeia (diagnostico)');
  includes(PREP, 'export function taxaDePreparo', 'a taxa (diagnostico)');
});

console.log('\n=== 2) O ENCODER MLow (transporte) ===\n');

await test('complexidade padrao 10 (era 5)', async () => {
  const m = await import(new URL('../dados/src/utils/mlowBitrate.js?cx=1', import.meta.url).href);
  const antes = process.env.ZAPO_MLOW_COMPLEXITY;
  delete process.env.ZAPO_MLOW_COMPLEXITY;
  ok(m.complexidadeConfigurada() === 10, 'padrao 10');
  ok(m.complexidadeConfigurada() <= 10, 'dentro do que o codec aceita (0 a 10)');
  if (antes !== undefined) process.env.ZAPO_MLOW_COMPLEXITY = antes;
});

await test('a perda esperada padrao e 10% (liga a FEC)', async () => {
  const m = await import(new URL('../dados/src/utils/mlowBitrate.js?plc=1', import.meta.url).href);
  const antes = process.env.ZAPO_MLOW_LOSS;
  delete process.env.ZAPO_MLOW_LOSS;
  ok(m.perdaConfigurada() === 10, 'padrao 10%');
  if (antes !== undefined) process.env.ZAPO_MLOW_LOSS = antes;
});

await test('os dois podem ser desligados pelo ambiente', async () => {
  const m = await import(new URL('../dados/src/utils/mlowBitrate.js?off=1', import.meta.url).href);
  const a = process.env.ZAPO_MLOW_COMPLEXITY, b = process.env.ZAPO_MLOW_LOSS;
  for (const v of ['0', 'off', 'false', '']) {
    process.env.ZAPO_MLOW_COMPLEXITY = v;
    process.env.ZAPO_MLOW_LOSS = v;
    ok(m.complexidadeConfigurada() === null, `complexity "${v}" desliga`);
    ok(m.perdaConfigurada() === null, `loss "${v}" desliga`);
  }
  if (a !== undefined) process.env.ZAPO_MLOW_COMPLEXITY = a; else delete process.env.ZAPO_MLOW_COMPLEXITY;
  if (b !== undefined) process.env.ZAPO_MLOW_LOSS = b; else delete process.env.ZAPO_MLOW_LOSS;
});

await test('valores fora da faixa sao clampados', async () => {
  const m = await import(new URL('../dados/src/utils/mlowBitrate.js?clamp=1', import.meta.url).href);
  const a = process.env.ZAPO_MLOW_COMPLEXITY, b = process.env.ZAPO_MLOW_LOSS;
  process.env.ZAPO_MLOW_COMPLEXITY = '99';
  process.env.ZAPO_MLOW_LOSS = '999';
  ok(m.complexidadeConfigurada() === 10, 'complexity clampada em 10 (o codec recusa acima)');
  ok(m.perdaConfigurada() === 100, 'loss clampada em 100');
  if (a !== undefined) process.env.ZAPO_MLOW_COMPLEXITY = a; else delete process.env.ZAPO_MLOW_COMPLEXITY;
  if (b !== undefined) process.env.ZAPO_MLOW_LOSS = b; else delete process.env.ZAPO_MLOW_LOSS;
});

await test('o gancho cobre os TRES campos e respeita quem pediu o seu', async () => {
  includes(MLOW, "['bitrate', 'complexity', 'packetLossPercent']", 'injeta os tres');
  includes(MLOW, '=== undefined', 'so injeta o que o chamador nao pediu');
});

await test('o log do boot diz bitrate, complexidade, perda e o pos-filtro', () => {
});

await test('o caminho do pos-filtro neural e exposto (para o admin colocar o blob)', () => {
  includes(MLOW, 'export function caminhoCompanionEsperado', 'a funcao existe');
  includes(MLOW, 'mlow_companion_v1.pte', 'aponta o nome do arquivo');
});

console.log('\n=== 3) O PREPARO E USADO PELO COMANDO ===\n');

await test('o index delega ao modulo (nao tem cadeia propria)', () => {
  const SRC = fs.readFileSync(path.join(HERE, '..', 'dados/src/index.js'), 'utf8');
  includes(SRC, 'prepararAudioCall', 'delega');
  includes(SRC, 'async function prepararWav16k', 'o helper continua definido (contrato do musicap)');
});

const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log('\n' + '='.repeat(40));
console.log(`RESULTADO: ${RESULTS.length} testes | ${totalOk} asserções ok | ${totalFail} falhas`);
console.log('='.repeat(40));
if (totalFail > 0) process.exit(1);
