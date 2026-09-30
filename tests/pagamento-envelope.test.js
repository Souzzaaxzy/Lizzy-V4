/**
 * Testes da cobertura COMPLETA de tipos de pagamento — `INV-028` e `INV-029`.
 *
 * O QUE FALTAVA
 * -------------
 * O anti cobria os 8 tipos de pagamento que vivem DENTRO do `message`, mas
 * deixava duas categorias de fora, por estarem em OUTRO NIVEL:
 *
 *   `paymentInfo` / `quotedPaymentInfo`  -> no ENVELOPE (`WebMessageInfo`)
 *   `paymentLinkMetadata` / `paymentExtendedMetadata` -> em `ExtendedTextMessage`
 *
 * Medido antes da correcao: as quatro passavam como **NORMAL**.
 *
 * Agora:
 *   INV-028 (peso 6)  envelope de pagamento VAZIO (sem valor e sem status)
 *   INV-029 (peso 2)  metadados de pagamento numa mensagem comum
 *
 * E a trava contra falso positivo: `paymentInfo` COM valor (amount1000,
 * currency, status) nao dispara — pagamento legitimo passa.
 *
 * Uso: node tests/pagamento-envelope.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateWAMessageFromContent } from '@itsliaaa/baileys';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-payenv-db-'));
process.env.DATABASE_PATH = TMP_DB;

const RESULTS = [];
let CURRENT = null;

function test(name, fn) {
  CURRENT = { name, passed: 0, failed: 0, errors: [] };
  RESULTS.push(CURRENT);
  const done = (error) => {
    if (error) {
      CURRENT.failed += 1;
      CURRENT.errors.push(`EXCEÇÃO: ${error?.stack || error}`);
    }
    console.log(`${CURRENT.failed === 0 ? '✅' : '❌'} ${name} (${CURRENT.passed} ok, ${CURRENT.failed} falhas)`);
    for (const err of CURRENT.errors) console.log(`     ${err.split('\n')[0]}`);
  };
  try {
    const r = fn();
    if (r && typeof r.then === 'function') return r.then(() => done()).catch(done);
    done();
  } catch (e) {
    done(e);
  }
  return Promise.resolve();
}

function ok(cond, msg) {
  if (cond) CURRENT.passed += 1;
  else {
    CURRENT.failed += 1;
    CURRENT.errors.push(`ASSERT FALHOU: ${msg}`);
  }
}

const {
  analyzeInvisibleMessage,
  analisarPagamentoNoEnvelope,
  analisarMetadadosDePagamento,
  INDICADORES,
  TIPOS_PAGAMENTO,
  CAMPOS_PAGAMENTO_ENVELOPE,
  CAMPOS_PAGAMENTO_METADADOS,
} = await import(new URL('../dados/src/utils/invisibleAnalyzer.js', import.meta.url).href);
const ghost = await import(new URL('../dados/src/utils/ghostDetection.js', import.meta.url).href);

const GRUPO = '120363900000000003@g.us';
const USER = '5599999999999@s.whatsapp.net';
const ALVO = '5511888888888@s.whatsapp.net';

function montar(content) {
  return generateWAMessageFromContent(GRUPO, content, { userJid: USER });
}

/** A API real: os campos de envelope vao DENTRO do `info`. */
function analisar(content, camposDeEnvelope = {}) {
  const m = montar(content);
  const info = {
    key: { remoteJid: GRUPO, fromMe: false, id: 'M1', participant: ALVO },
    message: m.message,
    messageTimestamp: Math.floor(Date.now() / 1000),
    ...camposDeEnvelope,
  };
  return analyzeInvisibleMessage({ info, content: m.message });
}

const ids = (a) => (a.indicators || []).map((i) => i.id);

// ============================================================================
// 1) COBERTURA — os 3 niveis estao declarados
// ============================================================================

await test('a cobertura declara os 3 niveis (conteudo, envelope, metadados)', () => {
  ok(TIPOS_PAGAMENTO.length === 8, `8 tipos de conteudo (${TIPOS_PAGAMENTO.length})`);
  ok(CAMPOS_PAGAMENTO_ENVELOPE.length === 2, `2 campos de envelope (${CAMPOS_PAGAMENTO_ENVELOPE.length})`);
  ok(CAMPOS_PAGAMENTO_METADADOS.length === 2, `2 campos de metadados (${CAMPOS_PAGAMENTO_METADADOS.length})`);

  // Os 8 tipos do proto que vivem no `Message`.
  for (const t of ['requestPaymentMessage', 'sendPaymentMessage', 'paymentInviteMessage',
    'declinePaymentRequestMessage', 'cancelPaymentRequestMessage', 'paymentReminderMessage',
    'splitPaymentMessage', 'invoiceMessage']) {
    ok(TIPOS_PAGAMENTO.includes(t), `${t} coberto`);
  }

  // E os de outros niveis NAO estao misturados no conteudo (senao o
  // `analisarPagamento` os procuraria no lugar errado).
  ok(!TIPOS_PAGAMENTO.includes('paymentInfo'), 'paymentInfo NAO e tipo de conteudo');
  ok(!TIPOS_PAGAMENTO.includes('paymentLinkMetadata'), 'paymentLinkMetadata NAO e tipo de conteudo');
});

// ============================================================================
// 2) INV-028 — ENVELOPE
// ============================================================================

await test('INV-028: paymentInfo VAZIO no envelope e detectado', () => {
  const a = analisar({ conversation: 'oi' }, { paymentInfo: {} });
  ok(ids(a).includes('INV-028'), `dispara INV-028 (tem: ${ids(a).join(',') || 'nenhum'})`);
  ok(a.detected === true, 'detected = true');
  ok(INDICADORES.INV_028.peso === 6, `peso 6 (${INDICADORES.INV_028.peso})`);
});

await test('INV-028: quotedPaymentInfo vazio tambem', () => {
  const a = analisar({ conversation: 'oi' }, { quotedPaymentInfo: {} });
  ok(ids(a).includes('INV-028'), `dispara INV-028 (tem: ${ids(a).join(',')})`);
});

await test('INV-028: paymentInfo COM valor NAO dispara (pagamento legitimo)', () => {
  const casos = {
    'amount1000 + currency + status': { amount1000: 1500, currency: 'BRL', status: 2 },
    'so currency': { currency: 'BRL' },
    'primaryAmount com valor': { primaryAmount: { value: '5000', offset: 1000, currencyCode: 'BRL' } },
    'so status': { status: 2 },
  };
  for (const [nome, info] of Object.entries(casos)) {
    const a = analisar({ conversation: 'oi' }, { paymentInfo: info });
    ok(!ids(a).includes('INV-028'), `${nome}: NAO dispara (tem: ${ids(a).join(',') || 'nenhum'})`);
  }
});

await test('analisarPagamentoNoEnvelope: distingue vazio de com valor', () => {
  const vazio = analisarPagamentoNoEnvelope({ paymentInfo: {} });
  ok(vazio.disponivel === true, 'disponivel');
  ok(vazio.vazios.length === 1, 'um vazio');
  ok(vazio.comValor.length === 0, 'nenhum com valor');

  const comValor = analisarPagamentoNoEnvelope({ paymentInfo: { amount1000: 1500 } });
  ok(comValor.vazios.length === 0, 'nenhum vazio');
  ok(comValor.comValor.length === 1, 'um com valor');

  const nenhum = analisarPagamentoNoEnvelope({});
  ok(nenhum.disponivel === false, 'sem paymentInfo -> indisponivel');
});

// ============================================================================
// 3) INV-029 — METADADOS
// ============================================================================

await test('INV-029: metadados de pagamento em extendedTextMessage', () => {
  for (const campo of ['paymentLinkMetadata', 'paymentExtendedMetadata']) {
    const a = analisar({ extendedTextMessage: { text: 'oi', [campo]: {} } });
    ok(ids(a).includes('INV-029'), `${campo}: dispara INV-029 (tem: ${ids(a).join(',') || 'nenhum'})`);
  }
});

await test('analisarMetadadosDePagamento: so com o campo presente', () => {
  ok(analisarMetadadosDePagamento({ extendedTextMessage: { text: 'oi' } }).disponivel === false, 'texto normal: indisponivel');
  ok(analisarMetadadosDePagamento({ conversation: 'oi' }).disponivel === false, 'sem extendedText: indisponivel');
  ok(analisarMetadadosDePagamento({ extendedTextMessage: { paymentLinkMetadata: {} } }).presentes.length === 1, 'presente');
});

// ============================================================================
// 4) FALSO POSITIVO — o risco real
// ============================================================================

await test('NENHUM dispara em mensagem normal (com ou sem envelope)', () => {
  const normais = [
    ['texto', { conversation: 'oi, tudo bem?' }, {}],
    ['texto com envelope limpo', { conversation: 'oi' }, { pushName: 'Fulano' }],
    ['imagem', { imageMessage: { caption: 'foto', mimetype: 'image/jpeg' } }, {}],
    ['enquete', { pollCreationMessageV3: { name: 'Qual?', options: [{ optionName: 'a' }, { optionName: 'b' }] } }, {}],
    ['localizacao', { locationMessage: { name: 'Padaria', address: 'Rua X' } }, {}],
  ];
  for (const [nome, content, envelope] of normais) {
    const a = analisar(content, envelope);
    const novos = ids(a).filter((i) => ['INV-028', 'INV-029'].includes(i));
    ok(novos.length === 0, `${nome}: nenhum novo (tem: ${novos.join(',') || 'nenhum'})`);
    ok(a.detected === false, `${nome}: detected = false`);
  }
});

// ============================================================================
// 5) PONTUADOR
// ============================================================================

await test('ghostDetection: envelope vazio pontua alto; normal nao', () => {
  const vazio = ghost.avaliar({ envelopePagamentoVazio: true });
  ok(vazio.score === 6, `envelope vazio: score ${vazio.score}`);
  ok(vazio.decisao === 'punir', `envelope vazio: ${vazio.decisao}`);

  const meta = ghost.avaliar({ metadadosPagamento: true });
  ok(meta.score === 2, `metadados: score ${meta.score}`);

  ok(ghost.avaliar({}).score === 0, 'normal: score 0');
});

// ============================================================================
// 6) REGRESSÃO
// ============================================================================

await test('regressao: os tipos de conteudo continuam cobertos', () => {
  const a = analisar({
    sendPaymentMessage: {
      noteMessage: { extendedTextMessage: { text: '. \u200b\u200b\u200b' } },
      transactionData: 'x',
    },
  });
  ok(ids(a).includes('INV-023'), `raja segue detectado (${ids(a).join(',')})`);

  const legit = analisar({
    requestPaymentMessage: {
      currencyCodeIso4217: 'BRL', amount1000: '1500', expiryTimestamp: '0',
      amount: { value: '1500', offset: 1000, currencyCode: 'BRL' },
      noteMessage: { extendedTextMessage: { text: 'Pagar' } },
    },
  });
  ok(legit.detected === false, 'pagamento legitimo segue limpo');
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
