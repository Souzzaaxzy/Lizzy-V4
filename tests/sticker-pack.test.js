/**
 * Testes do `!s <prompt>` → pack de figurinhas (módulo puro `stickerPack.js`).
 *
 * Regras pedidas:
 *   - a busca é SEMPRE prefixada com "icon" (usuário pesquisa X → bot pesquisa
 *     "icon X");
 *   - o pack leva de 10 a 15 figurinhas;
 *   - a primeira figurinha vira a capa do pacote.
 *
 * Offline: o download/conversão é injetado, então não depende de rede.
 *
 * Uso: node tests/sticker-pack.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-pack-'));
process.env.DATABASE_PATH = TMP_DB;
fs.mkdirSync(path.join(TMP_DB, 'grupos'), { recursive: true });

const RESULTS = [];
let CURRENT = null;

function test(name, fn) {
  CURRENT = { name, passed: 0, failed: 0, errors: [] };
  RESULTS.push(CURRENT);
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      return r.then(() => finish(name)).catch((e) => { CURRENT.failed += 1; CURRENT.errors.push(`EXCEÇÃO: ${e?.stack || e}`); finish(name); });
    }
    finish(name);
  } catch (e) {
    CURRENT.failed += 1;
    CURRENT.errors.push(`EXCEÇÃO: ${e?.stack || e}`);
    finish(name);
  }
  return Promise.resolve();
}
function finish(name) {
  console.log(`${CURRENT.failed === 0 ? '✅' : '❌'} ${name} (${CURRENT.passed} ok, ${CURRENT.failed} falhas)`);
  for (const e of CURRENT.errors) console.log(`     ${e.split('\n')[0]}`);
}
function ok(c, m) { if (c) CURRENT.passed += 1; else { CURRENT.failed += 1; CURRENT.errors.push(`ASSERT FALHOU: ${m}`); } }
function eq(a, b, m) { ok(a === b, `${m} — esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`); }

const sp = await import(new URL('../dados/src/funcs/utils/stickerPack.js', import.meta.url).href);

const buf = (n) => Buffer.alloc(n, 1);

// ============================================================================
// 1) Termo de busca com o prefixo "icon"
// ============================================================================

await test('stickerPack: a busca é prefixada com "icon"', () => {
  eq(sp.montarTermoBusca('gatinho'), 'icon gatinho', 'prefixa icon');
  eq(sp.montarTermoBusca('  cachorro   fofo  '), 'icon cachorro fofo', 'normaliza espaços');
  eq(sp.montarTermoBusca('naruto'), 'icon naruto', 'prefixa icon (2)');
  eq(sp.PREFIXO_BUSCA, 'icon', 'constante do prefixo');
  eq(sp.montarTermoBusca(''), '', 'vazio -> vazio');
  eq(sp.montarTermoBusca(null), '', 'null -> vazio');
});

// ============================================================================
// 2) Quantidade de figurinhas (10 a 15)
// ============================================================================

await test('stickerPack: escolhe entre 10 e 15 figurinhas', () => {
  // rng determinístico: 0 -> 10, 1 -> 15.
  eq(sp.escolherQuantidade(30, () => 0), 10, 'rng 0 -> 10');
  eq(sp.escolherQuantidade(30, () => 0.999), 15, 'rng alto -> 15');
  eq(sp.escolherQuantidade(12, () => 0.999), 12, 'limitado ao disponível');
  eq(sp.escolherQuantidade(5, () => 0.5), 5, 'menos de 10 -> usa o que tem');
  ok(sp.MIN_FIGURINHAS === 10 && sp.MAX_FIGURINHAS === 15, 'faixa 10..15');
});

// ============================================================================
// 3) Montagem do pack
// ============================================================================

await test('stickerPack: monta o pack com as figurinhas e a capa', async () => {
  const urls = Array.from({ length: 20 }, (_, i) => `https://exemplo.com/${i}.png`);
  const converter = async (url) => buf(100 + Number(url.match(/\d+/)[0]));
  const pack = await sp.montarPack({ urls, converter, nome: 'Meu Pack', publisher: 'Fulano', rng: () => 0 });
  ok(pack.ok === true, 'montou');
  eq(pack.total, 10, 'rng 0 -> 10 figurinhas');
  ok(Array.isArray(pack.stickers) && pack.stickers.length === 10, '10 stickers');
  ok(Buffer.isBuffer(pack.cover), 'tem capa (Buffer)');
  ok(pack.cover === pack.stickers[0].data, 'a primeira figurinha é a capa');
  eq(pack.nome, 'Meu Pack', 'nome preservado');
});

await test('stickerPack: ignora URLs que falham e mantém o pack', async () => {
  const urls = ['https://a.com/1.png', 'https://b.com/2.png', 'https://c.com/3.png'];
  const converter = async (url) => (url.includes('b.com') ? null : buf(50));
  const pack = await sp.montarPack({ urls, converter });
  ok(pack.ok === true, 'montou mesmo com uma falha');
  eq(pack.total, 2, 'sobraram 2');
});

await test('stickerPack: sem imagens válidas não monta', async () => {
  const pack = await sp.montarPack({ urls: [], converter: async () => buf(10) });
  ok(pack.ok === false && pack.motivo === 'sem_imagens', 'sem URLs -> sem_imagens');

  const falhou = await sp.montarPack({ urls: ['https://x.com/1.png'], converter: async () => null });
  ok(falhou.ok === false && falhou.motivo === 'conversao_falhou', 'tudo falhou -> conversao_falhou');
});

await test('stickerPack: ignora entradas que não são URL http(s)', async () => {
  const urls = ['ftp://x/1.png', 'javascript:alert(1)', 'https://ok.com/1.png'];
  const pack = await sp.montarPack({ urls, converter: async () => buf(10) });
  ok(pack.ok === true && pack.total === 1, 'só a URL http(s) entrou');
});

await test('stickerPack: respeita o teto de 60 do pacote', async () => {
  const urls = Array.from({ length: 80 }, (_, i) => `https://e.com/${i}.png`);
  const pack = await sp.montarPack({ urls, converter: async () => buf(10), quantidade: 100 });
  ok(pack.total === sp.MAX_FIGURINHAS_PACK, 'teto de 60');
});

// ============================================================================
// 4) Conteúdo do sendMessage (formato da fork)
// ============================================================================

await test('stickerPack: conteudoPack tem stickers, cover, name e publisher', async () => {
  const urls = Array.from({ length: 12 }, (_, i) => `https://e.com/${i}.png`);
  const pack = await sp.montarPack({ urls, converter: async () => buf(10), nome: 'P', publisher: 'A' });
  const conteudo = sp.conteudoPack(pack);
  ok(Array.isArray(conteudo.stickers), 'stickers é lista');
  ok(Buffer.isBuffer(conteudo.cover), 'cover é Buffer');
  eq(conteudo.name, 'P', 'name');
  eq(conteudo.publisher, 'A', 'publisher');
  ok(conteudo.stickers.every((s) => Buffer.isBuffer(s.data)), 'cada sticker tem data Buffer');
});

// ============================================================================
// 5) Nome da figurinha (nome cadastrado > nick > pushname)
// ============================================================================

await test('stickerPack: nome CADASTRADO (take.json) vence o nick', async () => {
  const nome = await sp.resolverNomeFigurinha({
    sender: 'a@lid',
    takeData: { 'a@lid': { author: 'Meu Nome', pack: 'X' } },
    resolverNick: async () => 'Nick do Contato',
    fallback: 'push'
  });
  eq(nome, 'Meu Nome', 'usa o nome cadastrado');
});

await test('stickerPack: sem cadastro usa o NICK (nome do contato)', async () => {
  const nome = await sp.resolverNomeFigurinha({
    sender: 'a@lid',
    takeData: {},
    resolverNick: async () => 'Nick do Contato',
    fallback: 'push'
  });
  eq(nome, 'Nick do Contato', 'cai no nick');
});

await test('stickerPack: sem cadastro e sem nick usa o fallback (pushname)', async () => {
  const nome = await sp.resolverNomeFigurinha({
    sender: 'a@lid',
    takeData: {},
    resolverNick: async () => null,
    fallback: 'pushname'
  });
  eq(nome, 'pushname', 'cai no fallback');
});

await test('stickerPack: author vazio no take.json NÃO conta como cadastrado', async () => {
  const nome = await sp.resolverNomeFigurinha({
    sender: 'a@lid',
    takeData: { 'a@lid': { author: '   ' } },
    resolverNick: async () => 'Nick',
    fallback: 'push'
  });
  eq(nome, 'Nick', 'author em branco -> nick');
});

await test('stickerPack: nick que lança não derruba (cai no fallback)', async () => {
  const nome = await sp.resolverNomeFigurinha({
    sender: 'a@lid',
    takeData: {},
    resolverNick: async () => { throw new Error('falhou'); },
    fallback: 'push'
  });
  eq(nome, 'push', 'erro no nick -> fallback');
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
