/**
 * Bitrate do encoder MLow (15 -> 24 kbps).
 *
 * ## O que este teste protege
 *
 * O encoder abre com `DEFAULT_BITRATE = 15000` porque nem o plugin nem o media
 * plane repassam `bitrate` ao `MLowCodec.create`. O gancho em
 * `dados/src/utils/mlowBitrate.js` intercepta o `create` para injetar o valor,
 * SEM editar `node_modules` (que a proxima atualizacao sobrescreveria).
 *
 * O gancho depende de tres coisas que este teste trava:
 *   1. o `MLowCodec.create` ser alcancavel pelo caminho interno (o subpath
 *      `@zapo-js/voip-media/media/mlow-codec` NAO existe no `exports`);
 *   2. o require CJS devolver o MESMO objeto que o media plane carrega
 *      (cache por caminho) -- senao a troca nao tem efeito;
 *   3. o bitrate chegar ao `create` (nao so "instalar sem erro").
 *
 * Uso: node tests/mlow-bitrate.test.js
 */

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
process.env.DATABASE_PATH = fs.mkdtempSync(path.join('/tmp', 'lizzy-bt-'));

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

const SRC = fs.readFileSync(path.join(HERE, '..', 'dados/src/utils/mlowBitrate.js'), 'utf8');
const ZAPO = fs.readFileSync(path.join(HERE, '..', 'dados/src/funcs/utils/zapoCall.js'), 'utf8');
const req = createRequire(import.meta.url);

/** Acha o arquivo interno do codec (mesma lógica do módulo). */
const acharCodec = () => {
  const e = req.resolve('@zapo-js/voip-media');
  let dir = path.dirname(e);
  while (dir !== path.dirname(dir)) {
    const a = path.join(dir, 'dist', 'media', 'mlow-codec.js');
    if (fs.existsSync(a)) return a;
    dir = path.dirname(dir);
  }
  return null;
};

console.log('\n=== 1) A CONFIGURAÇÃO (faixa e limites) ===\n');

await test('padrão é 24 kbps', async () => {
  const m = await import(new URL('../dados/src/utils/mlowBitrate.js?p=1', import.meta.url).href);
  const antes = process.env.ZAPO_MLOW_BITRATE;
  delete process.env.ZAPO_MLOW_BITRATE;
  ok(m.bitrateConfigurado() === 24000, 'padrão 24000');
  if (antes !== undefined) process.env.ZAPO_MLOW_BITRATE = antes;
});

await test('ZAPO_MLOW_BITRATE=0 desliga (volta ao padrão do pacote)', async () => {
  const m = await import(new URL('../dados/src/utils/mlowBitrate.js?p=2', import.meta.url).href);
  const antes = process.env.ZAPO_MLOW_BITRATE;
  for (const v of ['0', 'off', 'false', '']) {
    process.env.ZAPO_MLOW_BITRATE = v;
    ok(m.bitrateConfigurado() === null, `"${v}" desliga`);
  }
  if (antes !== undefined) process.env.ZAPO_MLOW_BITRATE = antes; else delete process.env.ZAPO_MLOW_BITRATE;
});

await test('o TETO do REMB é respeitado (não adianta pedir 64 kbps)', async () => {
  const m = await import(new URL('../dados/src/utils/mlowBitrate.js?p=3', import.meta.url).href);
  const antes = process.env.ZAPO_MLOW_BITRATE;
  process.env.ZAPO_MLOW_BITRATE = '999999';
  ok(m.bitrateConfigurado() === 30000, 'clampa em 30000 (a doc: teto ~24 kbps managed)');
  process.env.ZAPO_MLOW_BITRATE = 'abc';
  ok(m.bitrateConfigurado() === 24000, 'valor inválido volta ao padrão');
  if (antes !== undefined) process.env.ZAPO_MLOW_BITRATE = antes; else delete process.env.ZAPO_MLOW_BITRATE;
});

console.log('\n=== 2) O GANCHO (o mecanismo) ===\n');

await test('o MLowCodec.create é alcançável pelo caminho interno', () => {
  // O subpath `@zapo-js/voip-media/media/mlow-codec` NÃO existe no `exports`;
  // e `MLowCodec` não sai pelo index público (verificado: undefined).
  const alvo = acharCodec();
  ok(alvo !== null, 'achou dist/media/mlow-codec.js');
  const mod = req(alvo);
  ok(typeof mod?.MLowCodec?.create === 'function', 'MLowCodec.create existe');
});

await test('o require devolve o MESMO objeto (senão a troca não teria efeito)', () => {
  // O media plane faz `require("../media/mlow-codec.js")` — CJS cacheia por
  // caminho resolvido, então alcançar por caminho absoluto dá o mesmo objeto.
  const a = req(acharCodec());
  const b = req(acharCodec());
  ok(a === b, 'mesmo objeto nas duas resoluções');
});

await test('o gancho INSTALA', async () => {
  const m = await import(new URL('../dados/src/utils/mlowBitrate.js?p=4', import.meta.url).href);
  const ok1 = await m.instalarBitrate(24000);
  ok(ok1 === true, 'instalou');
  ok(m.bitrateEmUso() === 24000, 'bitrate em uso é 24000');
});

await test('o bitrate CHEGA ao create (não é só "instalar sem erro")', async () => {
  const m = await import(new URL('../dados/src/utils/mlowBitrate.js?p=5', import.meta.url).href);
  const mod = req(acharCodec());
  const original = mod.MLowCodec.create.bind(mod.MLowCodec);

  let recebido = null;
  mod.MLowCodec.create = async (opts) => { recebido = opts; throw new Error('parou aqui de propósito'); };

  await m.instalarBitrate(24000);
  try { await mod.MLowCodec.create({ companionModel: undefined, red: null }); } catch { /* esperado */ }
  ok(recebido?.bitrate === 24000, 'o create recebeu bitrate: 24000');

  mod.MLowCodec.create = original;
});

await test('NÃO sobrescreve quem pediu o próprio bitrate', async () => {
  const m = await import(new URL('../dados/src/utils/mlowBitrate.js?p=6', import.meta.url).href);
  const mod = req(acharCodec());
  const original = mod.MLowCodec.create.bind(mod.MLowCodec);

  let recebido = null;
  mod.MLowCodec.create = async (opts) => { recebido = opts; throw new Error('parou'); };

  await m.instalarBitrate(24000);
  try { await mod.MLowCodec.create({ bitrate: 9000 }); } catch { /* esperado */ }
  ok(recebido?.bitrate === 9000, 'respeitou o 9000 de quem pediu');

  mod.MLowCodec.create = original;
});

console.log('\n=== 3) INTEGRAÇÃO NO BOT ===\n');

await test('o zapoCall instala o gancho no boot', () => {
  includes(ZAPO, 'instalarBitrate', 'importa o gancho');
  includes(ZAPO, 'await instalarBitrate()', 'instala no boot');
  // Instalado ANTES de criar o client: o plane carrega o codec na 1ª call.
  const posInstala = ZAPO.indexOf('await instalarBitrate()');
  const posClient = ZAPO.indexOf('client = new WaClient(');
  ok(posInstala !== -1 && posClient !== -1 && posInstala < posClient,
    'instala antes de criar o client');
});

await test('o log diz o bitrate (não deixa na suposição)', () => {
  includes(ZAPO, 'bitrate ${kbps', 'loga o bitrate ativo');
  includes(ZAPO, 'padrao (15 kbps)', 'e admite quando está no padrão');
});

await test('não edita node_modules (a atualização sobrescreveria)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'package.json'), 'utf8'));
  const patches = pkg?.resolutions || pkg?.overrides || null;
  // O gancho é em runtime; não deve haver patch de arquivo do pacote.
  includes(SRC, 'createRequire', 'usa require em runtime');
  includes(SRC, 'Classe.create = async', 'troca a função em memória');
  ok(patches === null || !JSON.stringify(patches).includes('voip-media'),
    'sem patch de arquivo em package.json');
});

const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log('\n' + '='.repeat(40));
console.log(`RESULTADO: ${RESULTS.length} testes | ${totalOk} asserções ok | ${totalFail} falhas`);
console.log('='.repeat(40));
if (totalFail > 0) process.exit(1);
