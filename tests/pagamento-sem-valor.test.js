/**
 * Testes do `INV-024` — envelope de pagamento SEM VALOR usado como carreador
 * de texto.
 *
 * O QUE ESTE TESTE FECHA: o `!rajar2` usava `splitPaymentMessage` e passava
 * como **NORMAL** no detector, porque `classifyMessage` só conhecia
 * `requestPaymentMessage` / `sendPaymentMessage` / `paymentInviteMessage`. Os
 * outros tipos de pagamento do proto eram invisíveis para a classificação.
 *
 * O critério é OBJETIVO e não depende de saber montar nada:
 *   - o tipo carrega TEXTO (nota ou `description`);
 *   - e NÃO declara valor positivo.
 *
 * Pagamento legítimo declara valor → não entra. É isso que impede o falso
 * positivo, e é o que o teste mede.
 *
 * Uso: node tests/pagamento-sem-valor.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateWAMessageFromContent } from '@itsliaaa/baileys';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-pagval-db-'));
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

const { classifyMessage } = await import(new URL('../dados/src/utils/messageInspector.js', import.meta.url).href);
const { analyzeInvisibleMessage, INDICADORES } = await import(new URL('../dados/src/utils/invisibleAnalyzer.js', import.meta.url).href);
const ghost = await import(new URL('../dados/src/utils/ghostDetection.js', import.meta.url).href);

const GRUPO = '120363900000000001@g.us';
const USER = '5599999999999@s.whatsapp.net';
const ALVO = '5511888888888@s.whatsapp.net';
const MENC = ['5511888888888@s.whatsapp.net', '5511777777777@s.whatsapp.net'];

function montar(content) {
  return generateWAMessageFromContent(GRUPO, content, { userJid: USER });
}

function infoDe(message, extra = {}) {
  return {
    key: { remoteJid: GRUPO, fromMe: false, id: 'M1', participant: ALVO },
    message,
    messageTimestamp: Math.floor(Date.now() / 1000),
    content: message,
    ...extra,
  };
}

/** Envelope sem valor com texto: as variantes que precisam ser pegas. */
const SEM_VALOR = {
  'splitPaymentMessage + description': {
    splitPaymentMessage: {
      splitId: 'x', description: 'teste teste teste',
      totalAmount: { value: '0', offset: 1000, currencyCode: 'BRL' },
      contextInfo: { mentionedJid: MENC },
    },
  },
  'splitPaymentMessage SEM totalAmount': {
    splitPaymentMessage: { splitId: 'x', description: 'teste teste teste', contextInfo: { mentionedJid: MENC } },
  },
  'paymentReminderMessage + description': {
    paymentReminderMessage: { reminderId: 'x', description: 'teste teste teste' },
  },
};

/** Pagamento LEGÍTIMO: declara valor positivo. NÃO pode pontuar. */
const LEGITIMOS = {
  'requestPaymentMessage amount1000 1500': {
    requestPaymentMessage: {
      currencyCodeIso4217: 'BRL', amount1000: '1500', expiryTimestamp: '0',
      amount: { value: '1500', offset: 1000, currencyCode: 'BRL' },
      noteMessage: { extendedTextMessage: { text: 'Pagar o aluguel' } },
    },
  },
  'splitPaymentMessage com valor 5000': {
    splitPaymentMessage: {
      splitId: 'x', description: 'dividir a conta',
      totalAmount: { value: '5000', offset: 1000, currencyCode: 'BRL' },
    },
  },
  'paymentReminderMessage com valor': {
    paymentReminderMessage: {
      reminderId: 'x', description: 'lembrete',
      amount: { value: '2500', offset: 1000, currencyCode: 'BRL' },
    },
  },
};

/**
 * O raja CLASSICO — ele E uma mensagem detectavel (INV-023), nao um legitimo.
 * A nota precisa de 3+ caracteres invisiveis E >=50% do texto para o detector
 * considerar "sem conteudo visivel" (limiar de `paddingInvisivel`).
 */
const RAJA_CLASSICO = {
  sendPaymentMessage: {
    noteMessage: { extendedTextMessage: { text: '. \u200b\u200b\u200b' } },
    transactionData: 'x',
  },
};

// ============================================================================
// 1) O INDICADOR EXISTE E ESTA CATALOGADO
// ============================================================================

await test('INV-024 existe no catalogo, com peso e severidade', () => {
  const inv = INDICADORES.INV_024;
  ok(Boolean(inv), 'INV_024 esta no catalogo');
  ok(inv?.id === 'INV-024', `id = ${inv?.id}`);
  ok(inv?.categoria === 'payment', `categoria = ${inv?.categoria}`);
  ok(Number(inv?.peso) > 0, `peso = ${inv?.peso} (precisa somar)`);
  ok(typeof inv?.descricao === 'string' && inv.descricao.length > 40, 'tem descricao explicando o criterio');
});

// ============================================================================
// 2) A CLASSIFICACAO CENTRAL PASSOU A VER TODOS OS TIPOS
// ============================================================================

await test('classifyMessage: tipos de pagamento antes invisiveis agora contam', () => {
  for (const [nome, content] of Object.entries(SEM_VALOR)) {
    const m = montar(content);
    const c = classifyMessage(infoDe(m.message));
    ok(c.isPayment === true, `${nome}: isPayment = ${c.isPayment}`);
    ok(c.pagamentoSemValorComTexto === true, `${nome}: marcado como envelope sem valor com texto`);
    ok(c.temValor === false, `${nome}: temValor = ${c.temValor}`);
  }
});

await test('classifyMessage: pagamento LEGITIMO nao e marcado', () => {
  for (const [nome, content] of Object.entries(LEGITIMOS)) {
    const m = montar(content);
    const c = classifyMessage(infoDe(m.message));
    ok(c.isPayment === true, `${nome}: continua sendo pagamento (${c.isPayment})`);
    ok(c.pagamentoSemValorComTexto === false, `${nome}: NAO marcado como envelope sem valor`);
    ok(c.temValor === true, `${nome}: temValor = ${c.temValor}`);
  }
});

// ============================================================================
// 3) O ANALISADOR (o que o !get mostra)
// ============================================================================

await test('invisibleAnalyzer: o rajar2 agora da SUSPEITA com INV-024', () => {
  for (const [nome, content] of Object.entries(SEM_VALOR)) {
    const m = montar(content);
    const a = analyzeInvisibleMessage(infoDe(m.message));
    const ids = (a.indicators || []).map((i) => i.id);
    ok(ids.includes('INV-024'), `${nome}: dispara INV-024 (tem: ${ids.join(',') || 'nenhum'})`);
    ok(a.classification === 'SUSPEITA', `${nome}: classificacao = ${a.classification}`);
    ok(a.detected === true, `${nome}: detected = true`);
  }
});

await test('invisibleAnalyzer: pagamento legitimo continua NORMAL (sem falso positivo)', () => {
  for (const [nome, content] of Object.entries(LEGITIMOS)) {
    const m = montar(content);
    const a = analyzeInvisibleMessage(infoDe(m.message));
    const ids = (a.indicators || []).map((i) => i.id);
    ok(!ids.includes('INV-024'), `${nome}: NAO dispara INV-024 (tem: ${ids.join(',') || 'nenhum'})`);
    ok(a.detected === false, `${nome}: detected = false`);
  }
});

// ============================================================================
// 4) O PONTUADOR (ghostDetection)
// ============================================================================

await test('ghostDetection: envelope sem valor pontua; legitimo nao', () => {
  for (const [nome, content] of Object.entries(SEM_VALOR)) {
    const m = montar(content);
    const c = classifyMessage(infoDe(m.message));
    const d = ghost.avaliar({
      ...infoDe(m.message),
      isPayment: c.isPayment,
      temValor: c.temValor,
      pagamentoSemValorComTexto: c.pagamentoSemValorComTexto,
      noteText: c.noteText,
    });
    ok(d.score >= 3, `${nome}: score = ${d.score} (>= 3)`);
    ok(d.decisao !== 'ignorar', `${nome}: decisao = ${d.decisao}`);
    ok(d.contribuicoes.pagamentoSemValorComTexto === 3, `${nome}: contribuiu com o peso`);
  }

  for (const [nome, content] of Object.entries(LEGITIMOS)) {
    const m = montar(content);
    const c = classifyMessage(infoDe(m.message));
    const d = ghost.avaliar({
      ...infoDe(m.message),
      isPayment: c.isPayment,
      temValor: c.temValor,
      pagamentoSemValorComTexto: c.pagamentoSemValorComTexto,
      noteText: c.noteText,
    });
    ok(
      d.contribuicoes.pagamentoSemValorComTexto === undefined,
      `${nome}: NAO contribuiu (score ${d.score}, ${d.decisao})`
    );
  }
});

// ============================================================================
// 5) O RAJA CLÁSSICO NÃO FOI AFETADO (regressão)
// ============================================================================

await test('o raja classico continua detectado como antes', () => {
  const m = montar(RAJA_CLASSICO);
  const a = analyzeInvisibleMessage(infoDe(m.message));
  const ids = (a.indicators || []).map((i) => i.id);
  ok(ids.includes('INV-023'), `mantem INV-023 (tem: ${ids.join(',')})`);
  ok(a.detected === true, 'continua detectado');

  // E o INV-024 NAO entra nele: o criterio e para os tipos fora de request/send.
  ok(!ids.includes('INV-024'), 'INV-024 nao se aplica ao sendPaymentMessage');
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
