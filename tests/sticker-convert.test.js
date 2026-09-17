/**
 * Teste focado na CONVERSÃO de figurinha, exercitando o CAMINHO DE SUCESSO.
 *
 * Por que existe separado: o ambiente de teste não tem ffmpeg, e sem ele o
 * `!s` morre antes de converter — então o caminho de sucesso (onde vive o
 * `return outBuffer`) nunca era executado. Um `ReferenceError: outBuffer is not
 * defined` passou por isso: o erro real ficava escondido atrás da falha do
 * ffmpeg, que era capturada pelo catch genérico do comando.
 *
 * Aqui usamos um ffmpeg FALSO (que escreve um WebP válido), via FFMPEG_PATH,
 * para percorrer a conversão inteira de verdade.
 *
 * Uso: node tests/sticker-convert.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');

// O path do ffmpeg precisa estar definido ANTES do módulo ser importado.
process.env.FFMPEG_PATH = path.join(PROJECT, 'tests', 'helpers', 'fake-ffmpeg.js');

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-stk-db-'));
process.env.DATABASE_PATH = TMP_DB;

const RESULTS = [];
let CURRENT = null;

function test(name, fn) {
  CURRENT = { name, passed: 0, failed: 0, errors: [] };
  RESULTS.push(CURRENT);
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.then(() => finish(name)).catch((error) => {
        CURRENT.failed += 1;
        CURRENT.errors.push(`EXCEÇÃO: ${error?.stack || error}`);
        finish(name);
      });
    }
    finish(name);
  } catch (error) {
    CURRENT.failed += 1;
    CURRENT.errors.push(`EXCEÇÃO: ${error?.stack || error}`);
    finish(name);
  }
  return Promise.resolve();
}

function finish(name) {
  console.log(`${CURRENT.failed === 0 ? '✅' : '❌'} ${name} (${CURRENT.passed} ok, ${CURRENT.failed} falhas)`);
  for (const err of CURRENT.errors) console.log(`     ${err.split('\n')[0]}`);
}

function ok(condition, message) {
  if (condition) CURRENT.passed += 1;
  else {
    CURRENT.failed += 1;
    CURRENT.errors.push(`ASSERT FALHOU: ${message}`);
  }
}

const sticker = await import(new URL('../dados/src/funcs/utils/sticker.js', import.meta.url).href);
const convertToWebp = sticker.convertToWebp;

if (typeof convertToWebp !== 'function') throw new Error('sticker.js não exporta convertToWebp');

// JPEG 1x1 real.
const JPEG_1PX = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
  'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64'
);

const TMP_DIR = path.join(PROJECT, 'dados', 'database', 'tmp');
const contarTmp = () => (fs.existsSync(TMP_DIR) ? fs.readdirSync(TMP_DIR).length : 0);

// ============================================================================

await test('conversão: retorna o WebP no caminho de sucesso (pega ReferenceError)', async () => {
  // Este é O teste que faltava: percorre a conversão inteira até o `return`.
  // Com `outBuffer` declarado dentro do `try` (bug real introduzido antes), aqui
  // estoura "ReferenceError: outBuffer is not defined".
  const antes = contarTmp();
  let resultado;
  let erro = null;
  try {
    resultado = await convertToWebp(JPEG_1PX, false, true);
  } catch (e) {
    erro = e;
  }

  ok(!erro, `conversão não lançou: ${erro ? `${erro.constructor.name}: ${erro.message}` : 'ok'}`);
  ok(Buffer.isBuffer(resultado), 'devolveu um Buffer');
  ok(resultado?.slice(0, 4).toString() === 'RIFF', 'o Buffer é um WebP (RIFF)');
  ok(resultado && resultado.length > 0, `WebP com conteúdo (${resultado?.length} bytes)`);

  const depois = contarTmp();
  ok(depois <= antes, `sem temporário órfão (antes ${antes}, depois ${depois})`);
});

await test('conversão: WebP de entrada volta direto (sem tocar ffmpeg)', async () => {
  const webp = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64');
  const antes = contarTmp();
  const out = await convertToWebp(webp, false, false);
  ok(out.equals(webp), 'devolveu o mesmo buffer');
  ok(contarTmp() <= antes, 'não criou temporário');
});

await test('conversão: nenhum erro de CÓDIGO no caminho de sucesso', async () => {
  // Guarda contra regressão da família "is not defined" / "is not a function",
  // que o catch genérico do !s transformaria em "Ocorreu um erro interno".
  const erros = [];
  const origError = console.error;
  console.error = (...a) => { erros.push(a.map(String).join(' ')); };

  let erro = null;
  try {
    await convertToWebp(JPEG_1PX, false, true);
  } catch (e) {
    erro = e;
  } finally {
    console.error = origError;
  }

  const codigo = erro && /ReferenceError|TypeError|is not defined|is not a function/.test(String(erro));
  ok(!codigo, `sem erro de código (${codigo ? erro.message : 'ok'})`);
  ok(erros.every((e) => !/ReferenceError|is not defined/.test(e)), 'nada de "is not defined" no log');
});

await test('conversão: entrada vazia falha de forma controlada', async () => {
  let erro = null;
  try {
    await convertToWebp(Buffer.alloc(0), false, true);
  } catch (e) {
    erro = e;
  }
  ok(erro !== null, 'rejeitou entrada vazia em vez de devolver lixo');
  ok(erro && !/ReferenceError|is not defined/.test(String(erro)), `erro controlado: ${erro?.message}`);
});

// ============================================================================

const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log('\n════════════════════════════════════════');
console.log(`RESULTADO: ${RESULTS.length} testes | ${totalOk} asserções ok | ${totalFail} falhas`);
console.log('════════════════════════════════════════');

fs.rmSync(TMP_DB, { recursive: true, force: true });

if (totalFail > 0) {
  console.log('\nFALHAS:');
  for (const r of RESULTS) if (r.failed) for (const e of r.errors) console.log(`- [${r.name}] ${e}`);
  process.exit(1);
}
console.log('✅ TODOS OS TESTES PASSARAM');
process.exit(0);