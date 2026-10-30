/**
 * `!pinterest` — o carrossel que quebrava + a QUANTIDADE pedida.
 *
 * ## O bug (medido, out/2026)
 *
 * `Error: Invalid media type for carousel card`. O dono desconfiou certo das
 * duas hipóteses fáceis: **não** era o carrossel (o TikTok usa e funciona) nem a
 * busca (o `!s <busca>` usa a mesma e funciona).
 *
 * A causa: o `!pinterest` montava os cards com as URLs **cruas** da busca. A
 * busca devolve URLs da web aberta, e muitas bloqueiam **hotlink** — medido:
 * `403 text/html` no `png.pngtree.com` e no `meugamer.com`. O
 * `prepareWAMessageMedia` da fork falhava, o `catch` engolia, o card saía **sem
 * header** — e aí o carrossel INTEIRO era recusado.
 *
 * O TikTok funcionava porque as URLs dele vêm de um **CDN confiável**.
 *
 * ## A quantidade (pedido do dono)
 *
 * *"eu peço UMA foto ou UM item de figurinha, ela deve mandar apenas uma, sem
 * carrossel ou o pack, apenas 1, ou se o usuário pedir mais de uma manda a
 * quantidade que ele quer, mas no máximo 2"*.
 *
 * Uso: node tests/pin-quantidade.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

process.env.LIZZY_VOZ_ESPONTANEA = '0';

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-pinq-'));
process.env.DATABASE_PATH = TMP_DB;
process.env.CONFIG_PATH = path.join(TMP_DB, 'config.json');
fs.mkdirSync(path.join(TMP_DB, 'grupos'), { recursive: true });
fs.mkdirSync(path.join(TMP_DB, 'dono'), { recursive: true });
fs.writeFileSync(process.env.CONFIG_PATH, JSON.stringify({
  prefixo: '!', nomebot: 'Lizzy', nomedono: 'Kannon', numerodono: '5511915323638'
}, null, 2));

const imgs = await import(new URL('../dados/src/utils/imagensAcessiveis.js', import.meta.url).href);
const pack = await import(new URL('../dados/src/funcs/utils/stickerPack.js', import.meta.url).href);
const INDEX = fs.readFileSync(new URL('../dados/src/index.js', import.meta.url), 'utf-8');

const RESULTS = [];
let CURRENT = null;
function test(name, fn) {
  CURRENT = { name, passed: 0, failed: 0, errors: [] };
  RESULTS.push(CURRENT);
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      return r.then(() => finish(name)).catch((e) => { CURRENT.failed += 1; CURRENT.errors.push(`EXCECAO: ${e?.stack || e}`); finish(name); });
    }
    finish(name);
  } catch (e) { CURRENT.failed += 1; CURRENT.errors.push(`EXCECAO: ${e?.stack || e}`); finish(name); }
  return Promise.resolve();
}
function finish(name) {
  console.log(`${CURRENT.failed === 0 ? 'OK ' : 'ERR'} ${name} (${CURRENT.passed} ok, ${CURRENT.failed} falhas)`);
  for (const err of CURRENT.errors) console.log(`     ${err.split('\n')[0]}`);
}
function ok(c, m) { if (c) CURRENT.passed += 1; else { CURRENT.failed += 1; CURRENT.errors.push(`ASSERT FALHOU: ${m}`); } }

/** Um `fetch` de mentira: as URLs de `mapa` respondem conforme o combinado. */
function fetchFake(mapa) {
  return async (url, opts = {}) => {
    const regra = mapa[url] ?? mapa['*'];
    const r = typeof regra === 'function' ? regra(opts) : regra;
    if (!r) throw new Error('rede');
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      headers: { get: (h) => (String(h).toLowerCase() === 'content-type' ? r.tipo : null) },
      body: { cancel: () => {} }
    };
  };
}

// ============================================================================
console.log('\n=== 1) O FILTRO DE IMAGENS ACESSIVEIS ===\n');

await test('1. aceita image/* e recusa a pagina de bloqueio (text/html)', async () => {
  const f = fetchFake({
    'https://ok.com/a.jpg': { status: 200, tipo: 'image/jpeg' },
    'https://ok.com/b.png': { status: 200, tipo: 'image/png' },
    'https://bloq.com/c.jpg': { status: 403, tipo: 'text/html' },
    'https://html.com/d.jpg': { status: 200, tipo: 'text/html' } // 200 mas NAO e imagem
  });
  ok(await imgs.urlEhImagem('https://ok.com/a.jpg', { fetchFn: f }) === true, 'jpg 200 image -> sim');
  ok(await imgs.urlEhImagem('https://ok.com/b.png', { fetchFn: f }) === true, 'png 200 image -> sim');
  ok(await imgs.urlEhImagem('https://bloq.com/c.jpg', { fetchFn: f }) === false, '403 -> nao');
  ok(await imgs.urlEhImagem('https://html.com/d.jpg', { fetchFn: f }) === false, '200 text/html -> nao (o content-type manda)');
});

await test('2. HEAD que falha cai no GET (alguns hosts so respondem GET)', async () => {
  let metodos = [];
  const f = async (url, opts = {}) => {
    metodos.push(opts.method);
    if (opts.method === 'HEAD') return { ok: false, status: 405, headers: { get: () => null }, body: { cancel() {} } };
    return { ok: true, status: 200, headers: { get: () => 'image/webp' }, body: { cancel() {} } };
  };
  ok(await imgs.urlEhImagem('https://so-get.com/a.webp', { fetchFn: f }) === true, 'HEAD falhou, GET passou');
  ok(metodos.join(',') === 'HEAD,GET', `tentou HEAD e depois GET (veio ${metodos.join(',')})`);
});

await test('3. descarta o que NAO e imagem por extensao (sem gastar rede)', async () => {
  let chamou = 0;
  const f = async () => { chamou += 1; return { ok: true, status: 200, headers: { get: () => 'image/jpeg' }, body: { cancel() {} } }; };
  for (const u of ['https://x.com/v.mp4', 'https://x.com/p.pdf', 'https://x.com/z.zip', 'ftp://x.com/a.jpg', 'nao-e-url']) {
    ok(await imgs.urlEhImagem(u, { fetchFn: f }) === false, `recusou ${u}`);
  }
  ok(chamou === 0, 'nao gastou rede com extensao ruim');
});

await test('4. o filtro roda em paralelo e PARA quando junta o limite', async () => {
  const urls = Array.from({ length: 30 }, (_, i) => `https://ok.com/${i}.jpg`);
  const f = fetchFake({ '*': { status: 200, tipo: 'image/jpeg' } });
  const bons = await imgs.filtrarImagensAcessiveis(urls, { limite: 3, fetchFn: f });
  ok(bons.length === 3, `parou em 3 (veio ${bons.length})`);
  ok(bons.every((u) => urls.includes(u)), 'so devolveu url da lista');
  // A ORDEM original e' preservada.
  ok(bons.join(',') === urls.slice(0, 3).join(','), 'mantem a ordem original');
});

await test('5. o filtro descarta as que falham e mantem a ordem das boas', async () => {
  const urls = ['https://a.com/1.jpg', 'https://b.com/2.jpg', 'https://c.com/3.jpg'];
  const f = fetchFake({
    'https://a.com/1.jpg': { status: 200, tipo: 'image/jpeg' },
    'https://b.com/2.jpg': { status: 403, tipo: 'text/html' },
    'https://c.com/3.jpg': { status: 200, tipo: 'image/png' }
  });
  const bons = await imgs.filtrarImagensAcessiveis(urls, { fetchFn: f });
  ok(bons.length === 2 && bons[0].includes('a.com') && bons[1].includes('c.com'), 'sobrou so as boas, na ordem');
});

await test('6. entrada invalida nao quebra', async () => {
  ok((await imgs.filtrarImagensAcessiveis(null)).length === 0, 'null');
  ok((await imgs.filtrarImagensAcessiveis([])).length === 0, 'vazio');
  ok((await imgs.filtrarImagensAcessiveis(['x', null, 12])).length === 0, 'lixo');
});

// ============================================================================
console.log('\n=== 2) A QUANTIDADE PEDIDA ===\n');

await test('7. "uma" = 1; numero = o pedido (teto 2)', () => {
  const casos = [
    ['manda uma figurinha de gato', 1],
    ['me manda uma foto de cachorro', 1],
    ['uma imagem de flor', 1],
    ['me manda 2 figurinhas', 2],
    ['manda duas imagens de flor', 2],
    ['quero 3 fotos', 2],   // acima do teto -> 2
    ['manda 5', 2]
  ];
  for (const [texto, esperado] of casos) {
    ok(pack.quantidadePedida(texto) === esperado, `"${texto}" -> ${esperado} (veio ${pack.quantidadePedida(texto)})`);
  }
  ok(pack.MAX_PEDIDO === 2, 'o teto e 2');
});

await test('8. sem numero e sem singular -> padrao do pack (null)', () => {
  for (const texto of ['manda figurinha de gato', 'me manda umas fotos de gato', 'gatinhos fofos']) {
    ok(pack.quantidadePedida(texto) === null, `"${texto}" -> null (padrao do pack)`);
  }
});

// ============================================================================
console.log('\n=== 3) O HANDLER ===\n');

await test('9. o `!pinterest` FILTRA as acessiveis antes de montar os cards', () => {
  const i = INDEX.indexOf("case 'pinterest':");
  ok(i > 0, 'o bloco existe');
  const bloco = INDEX.slice(i, i + 4200);
  ok(bloco.includes('filtrarImagensAcessiveis('), 'filtra as imagens acessiveis');
  ok(bloco.includes('quantidadePedida('), 'usa a quantidade pedida');
  // A ordem: filtra ANTES de montar os cards.
  const iFiltro = bloco.indexOf('filtrarImagensAcessiveis(');
  const iCards = bloco.indexOf('const cards =');
  ok(iFiltro > 0 && iCards > iFiltro, 'filtra antes de montar os cards');
  // E nao manda cards vazios (o "sem header" e' o que derruba o carrossel).
  ok(bloco.includes('if (!itemsToSend.length)'), 'avisa quando nao sobrou nenhuma');
});

await test('10. o `!s <busca>` tambem filtra (o pack saia menor por url morta)', () => {
  const i = INDEX.indexOf('const pedidasS = quantidadePedida(prompt);');
  ok(i > 0, 'o bloco do `!s` usa a quantidade');
  const bloco = INDEX.slice(i - 600, i + 900);
  ok(bloco.includes('filtrarImagensAcessiveis('), 'filtra as acessiveis');
  ok(bloco.includes('quantidade: pedidasS'), 'passa a quantidade para o montarPack');
});

// ============================================================================
console.log('\n' + '='.repeat(60));
const tot = RESULTS.reduce((a, r) => a + r.passed, 0);
const fal = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log(`RESULTADO: ${RESULTS.length} testes | ${tot} asserções ok | ${fal} falhas`);
console.log('='.repeat(60));
process.exit(fal ? 1 : 0);
