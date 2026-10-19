/**
 * VERSÃO DO WHATSAPP — a causa do `405 Connection Failure` no pareamento.
 *
 * Sintoma do dono: *"não funcionou, o bot não está nem respondendo quando mando
 * a opção de parear com código, e quando mando para parear com QR code ele fica
 * mandando [Conexão fechada. Código: 405] infinitamente"*.
 *
 * Causa MEDIDA (conexões reais contra o WhatsApp):
 *
 *   versão ANTIGA [2,3000,1041589577,261700,0] -> fechou 405
 *   versão NOVA   [2,3000,1050889999,261700,0] -> QR recebido
 *
 * O bot usava `fetchLatestBaileysVersion()`, que lê o **código-fonte do GitHub** e
 * fica desatualizado. O `fetchLatestWaWebVersion()` lê o **`sw.js` do próprio
 * WhatsApp Web** e é a fonte correta.
 *
 * Uso: node tests/wa-version.test.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const {
  resolverVersaoWhatsApp, montarVersaoDeVoz,
  ORIGEM_WEB, ORIGEM_PIN, ORIGEM_CACHE
} = await import(new URL('../dados/src/utils/waVersion.js', import.meta.url).href);

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

const PIN = [2, 3000, 1039498983, 261700, 0];
const WEB = [2, 3000, 1050889999];

// ============================================================================
// 1) A MONTAGEM DA VERSÃO (o ponto delicado)
// ============================================================================

await test('monta 5 partes: build do WhatsApp Web + cauda de VOZ do pin', () => {
  const v = montarVersaoDeVoz(WEB, PIN);
  ok(Array.isArray(v) && v.length === 5, `tem 5 partes (veio ${JSON.stringify(v)})`);
  ok(v[2] === WEB[2], 'o BUILD é o do WhatsApp Web (a parte que o servidor confere)');
  ok(v[3] === PIN[3] && v[4] === PIN[4], 'a cauda de voz vem do pin (senão a call fica muda)');
  ok(v[2] !== PIN[2], 'NÃO usa o build antigo do pin (era ele que dava 405)');
});

await test('sem versão do Web, devolve null (cai no pin)', () => {
  ok(montarVersaoDeVoz(null, PIN) === null, 'null -> null');
  ok(montarVersaoDeVoz([2, 3000], PIN) === null, 'menos de 3 partes -> null');
  ok(montarVersaoDeVoz(WEB, [2, 3000, 1]) === null, 'pin sem 5 partes -> null');
});

await test('não muta o pin original', () => {
  const antes = JSON.stringify(PIN);
  montarVersaoDeVoz(WEB, PIN);
  ok(JSON.stringify(PIN) === antes, 'o pin continua intacto');
});

// ============================================================================
// 2) A RESOLUÇÃO (fonte correta + fallback + cache)
// ============================================================================

await test('usa a versão do WhatsApp Web quando disponível', async () => {
  const r = await resolverVersaoWhatsApp({
    buscarWeb: async () => ({ version: WEB, isLatest: true }),
    pin: PIN
  });
  ok(r.origem === ORIGEM_WEB, `origem = whatsapp-web (veio ${r.origem})`);
  ok(r.version[2] === WEB[2], 'usou o build do Web');
  ok(r.version.length === 5, 'saiu com 5 partes (voz preservada)');
});

await test('cai no PIN quando a busca falha (não derruba o boot)', async () => {
  const r = await resolverVersaoWhatsApp({
    buscarWeb: async () => { throw new Error('sem rede'); },
    pin: PIN
  });
  ok(r.origem === ORIGEM_PIN, `origem = pin (veio ${r.origem})`);
  ok(JSON.stringify(r.version) === JSON.stringify(PIN), 'usou o pin inteiro');
});

await test('cai no PIN quando o Web devolve lixo', async () => {
  const r = await resolverVersaoWhatsApp({
    buscarWeb: async () => ({ version: [2, 3000] }),
    pin: PIN
  });
  ok(r.origem === ORIGEM_PIN, 'sem 3 partes -> pin');
  ok(r.version[2] === PIN[2], 'build do pin');
});

await test('avisa no log quando cai no pin (para não ser silencioso)', async () => {
  const avisos = [];
  await resolverVersaoWhatsApp({
    buscarWeb: async () => { throw new Error('timeout'); },
    pin: PIN,
    log: (m) => avisos.push(m)
  });
  ok(avisos.length > 0 && avisos[0].includes('[VERSION]'), 'registrou o motivo');
  ok(avisos.join(' ').includes('timeout'), 'inclui a causa');
});

await test('cacheia: a 2ª chamada não bate na rede de novo', async () => {
  let chamadas = 0;
  const cache = {};
  const deps = {
    buscarWeb: async () => { chamadas += 1; return { version: WEB }; },
    pin: PIN,
    cache
  };
  const a = await resolverVersaoWhatsApp(deps);
  const b = await resolverVersaoWhatsApp(deps);
  ok(chamadas === 1, `bateu na rede 1x (veio ${chamadas})`);
  ok(a.origem === ORIGEM_WEB && b.origem === ORIGEM_CACHE, 'a 2ª veio do cache');
  ok(b.version[2] === WEB[2], 'o valor cacheado é o do Web');
});

await test('sem `buscarWeb` também cai no pin (degradação segura)', async () => {
  const r = await resolverVersaoWhatsApp({ pin: PIN });
  ok(r.origem === ORIGEM_PIN, 'sem fetcher -> pin');
});

// ============================================================================
// 3) INTEGRAÇÃO — o bot usa a fonte CORRETA (não a que fica desatualizada)
// ============================================================================

await test('connect.js usa fetchLatestWaWebVersion e o resolver (não o Baileys-version)', () => {
  const src = fs.readFileSync(path.join(HERE, '..', 'dados/src/connect.js'), 'utf-8');
  // O comentário do próprio arquivo CITA o fetcher antigo para explicar por que
  // ele foi trocado — então a checagem é sobre o CÓDIGO, sem comentários.
  const codigo = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  ok(codigo.includes('fetchLatestWaWebVersion'), 'importa o fetcher do WhatsApp Web');
  ok(codigo.includes('resolverVersaoWhatsApp'), 'usa o resolver (com fallback e cache)');
  ok(!codigo.includes('fetchLatestBaileysVersion'), 'NÃO usa mais o fetcher do GitHub (era o 405)');
  ok(codigo.includes('VOICE_CAPABLE_VERSION'), 'mantém o pin da cauda de voz');
});

await test('subBotManager usa a mesma fonte (senão o sub-bot também dá 405)', () => {
  const src = fs.readFileSync(path.join(HERE, '..', 'dados/src/utils/subBotManager.js'), 'utf-8');
  ok(src.includes('fetchLatestWaWebVersion'), 'importa o fetcher correto');
  ok(src.includes('resolverVersaoWhatsApp'), 'usa o resolver');
  ok(!src.includes('const version = VOICE_CAPABLE_VERSION;'),
    'NÃO usa mais a versão fixa (ficava desatualizada)');
});

await test('o log de boot diz de ONDE veio a versão', () => {
  const src = fs.readFileSync(path.join(HERE, '..', 'dados/src/connect.js'), 'utf-8');
  ok(src.includes('_origemDaVersao'), 'guarda a origem');
  ok(src.includes('Usando versão do WhatsApp: ${version.join(\'.\')} (${_origemDaVersao'),
    'mostra a origem no log (em vez de a gente supor)');
});

// ============================================================================

const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log('\n' + '='.repeat(40));
console.log(`RESULTADO: ${RESULTS.length} testes | ${totalOk} asserções ok | ${totalFail} falhas`);
console.log('='.repeat(40));
process.exit(totalFail > 0 ? 1 : 0);
