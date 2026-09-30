/**
 * Testes do apagamento REAL de mensagem de PAGAMENTO pelo `!d`.
 *
 * O que precisa de prova: o trecho antigo dizia "apaga o payment" mas mandava
 * só um REVOKE direto — que o servidor ignora para esse tipo de mensagem. O
 * caminho que funciona passa por editar o alvo primeiro (mensagem temporária +
 * edição com o id do pagamento). O teste mede exatamente isso no handler real:
 *
 *   1. manda a edição com `options.messageId === <id do pagamento>` e
 *      `edit.id === <id temporário>`;
 *   2. revoga o PAGAMENTO (não a mensagem temporária);
 *   3. revoga a mensagem temporária;
 *   4. reconhece o payment encapsulado (view once) e o `sendPaymentMessage`;
 *   5. escolhe a key certa quando o autor é o próprio bot (fromMe: true).
 *
 * Uso: node tests/delete-payment.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-delpay-db-'));
process.env.DATABASE_PATH = TMP_DB;
const GRUPOS_DIR = path.join(TMP_DB, 'grupos');
fs.mkdirSync(GRUPOS_DIR, { recursive: true });

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
    const result = fn();
    if (result && typeof result.then === 'function') return result.then(() => done()).catch(done);
    done();
  } catch (error) {
    done(error);
  }
  return Promise.resolve();
}

function ok(condition, message) {
  if (condition) CURRENT.passed += 1;
  else {
    CURRENT.failed += 1;
    CURRENT.errors.push(`ASSERT FALHOU: ${message}`);
  }
}

function includes(haystack, needle, label) {
  ok(typeof haystack === 'string' && haystack.includes(needle), `${label ?? needle} — esperado conter "${needle}"`);
}

// ============================================================================
// MÓDULO PURO
// ============================================================================

const dp = await import(new URL('../dados/src/utils/deletePayment.js', import.meta.url).href);

// ============================================================================
// HANDLER REAL
// ============================================================================

const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';
const PN_DO_LID = '5511888888888@s.whatsapp.net';

let groupCounter = 0;
function makeGroup() {
  groupCounter += 1;
  const jid = `1203634000000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(path.join(GRUPOS_DIR, `${jid}.json`), JSON.stringify({ groupName: 'Grupo P', modobrincadeira: true }, null, 2));
  return jid;
}

let senderCounter = 0;
function makeNazu({ sent, groupJid, sender, comoAdmin = true, pnDoLid = null }) {
  return {
    sendMessage: async (jid, content, options) => {
      sent.push({ jid, content, options });
      return { key: { id: `SENT-${sent.length}` } };
    },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
    onWhatsApp: async (jid) => [{ jid, exists: true, lid: jid.replace('@s.whatsapp.net', '@lid') }],
    signalRepository: { lidMapping: { getPNForLID: async () => pnDoLid } },
    groupMetadata: async () => ({
      id: groupJid,
      subject: 'Grupo P',
      participants: [
        { id: BOT_LID, lid: BOT_LID, phoneNumber: BOT_JID, admin: 'admin' },
        { id: sender, lid: sender, phoneNumber: '5511999999997@s.whatsapp.net', admin: comoAdmin ? 'admin' : null },
      ],
    }),
    groupParticipantsUpdate: async () => ({}),
    groupRequestParticipantsList: async () => [],
    groupRequestParticipantsUpdate: async () => ({}),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {},
    sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => 'x',
    react: async () => ({}),
  };
}

/**
 * Executa uma mensagem pelo handler.
 * `quoted` vai no contextInfo da mensagem do comando; `autor` é o participant
 * do citado (quem escreveu a mensagem marcada).
 */
async function rodar({ groupJid, text, quoted = null, autor = PN_DO_LID, admin = true, id = null, pnDoLid = null }) {
  senderCounter += 1;
  const sender = `33300000${String(senderCounter).padStart(5, '0')}@lid`;
  const sent = [];
  const nazu = makeNazu({ sent, groupJid, sender, comoAdmin: admin, pnDoLid });
  const contextInfo = { remoteJid: groupJid };
  if (quoted) {
    contextInfo.quotedMessage = quoted;
    contextInfo.participant = autor;
    contextInfo.stanzaId = 'MSG-ALVO';
  }
  await handleMessage(nazu, {
    key: { remoteJid: groupJid, fromMe: false, id: id || `M-${Math.random().toString(36).slice(2, 10)}`, participant: sender },
    message: { extendedTextMessage: { text, contextInfo } },
    messageTimestamp: 1757900000,
    pushName: 'Tester',
  }, null, new Map(), null);

  const texto = sent.map((s) => s.content?.text ?? s.content?.caption ?? '').filter(Boolean).join('\n');
  return { sent, texto, nazu };
}

// ============================================================================
// 1) HELPERS PUROS
// ============================================================================

await test('isPaymentContent: reconhece payment direto e encapsulado', () => {
  ok(dp.isPaymentContent({ requestPaymentMessage: { amount1000: '0' } }), 'requestPaymentMessage');
  ok(dp.isPaymentContent({ sendPaymentMessage: { noteMessage: {} } }), 'sendPaymentMessage');
  ok(
    dp.isPaymentContent({ viewOnceMessageV2: { message: { requestPaymentMessage: {} } } }),
    'requestPaymentMessage dentro de viewOnceMessageV2'
  );
  ok(dp.isPaymentContent({ ephemeralMessage: { message: { sendPaymentMessage: {} } } }), 'sendPaymentMessage dentro de ephemeral');
  ok(!dp.isPaymentContent({ conversation: 'oi' }), 'texto comum NÃO é payment');
  ok(!dp.isPaymentContent({ imageMessage: { url: 'x' } }), 'imagem comum NÃO é payment');
  ok(!dp.isPaymentContent(null), 'null NÃO é payment');
  ok(!dp.isPaymentContent(undefined), 'undefined NÃO é payment');
});

await test('buildPaymentDeleteKeys: da variante mais específica para a mais genérica', () => {
  const comPn = dp.buildPaymentDeleteKeys({
    remoteJid: 'g@g.us', id: 'ABC', participant: '123@lid', participantPn: '5511@s.whatsapp.net',
  });
  ok(comPn.length === 4, `quatro candidatas (${comPn.length})`);
  ok(comPn[0].participant === '123@lid' && comPn[0].participantAlt === '5511@s.whatsapp.net', 'a 1ª traz LID + PN');
  ok(comPn[1].participant === '5511@s.whatsapp.net', 'a 2ª tenta só o PN');
  ok(comPn[2].participant === '123@lid', 'a 3ª tenta só o LID');
  ok(comPn[3].participant === undefined, 'a última não tem participant');
  ok(comPn.every((k) => k.fromMe === false), 'todas de terceiro');
  ok(comPn.every((k) => k.id === 'ABC' && k.remoteJid === 'g@g.us'), 'todas com o alvo certo');

  const semPn = dp.buildPaymentDeleteKeys({ remoteJid: 'g@g.us', id: 'X', participant: '123@lid' });
  ok(semPn.length === 2, `sem PN -> 2 candidatas (${semPn.length})`);
  ok(semPn[0].participant === '123@lid', 'primeira com o participant');

  const doBot = dp.buildPaymentDeleteKeys({ remoteJid: 'g@g.us', id: 'X', participant: '123@lid', fromMe: true });
  ok(doBot.length === 1, 'do bot -> uma candidata');
  ok(doBot[0].fromMe === true, 'do bot -> fromMe true');
  ok(doBot[0].participant === undefined, 'do bot -> sem participant');

  ok(dp.buildPaymentDeleteKeys({}).length === 0, 'sem id -> nada');
  ok(dp.buildPaymentDeleteKeys({ remoteJid: 'g@g.us' }).length === 0, 'sem id -> nada (2)');
});

await test('buildPaymentEditContent: o ALVO da edição é o id temporário', () => {
  const content = dp.buildPaymentEditContent('texto', 'TEMP-1');
  ok(content.edit?.id === 'TEMP-1', 'edit.id é o temporário');
  ok(content.text === 'texto', 'texto preservado');
  ok(!content.delete, 'não é um delete');
});

await test('resolveParticipantPn: só resolve LID, e nunca lança', async () => {
  const pn = await dp.resolveParticipantPn(async () => PN_DO_LID, '123@lid');
  ok(pn === PN_DO_LID, 'LID resolve para o PN');
  ok((await dp.resolveParticipantPn(async () => PN_DO_LID, PN_DO_LID)) === null, 'não-LID não tenta resolver');
  ok((await dp.resolveParticipantPn(async () => { throw new Error('x'); }, '123@lid')) === null, 'resolver que lança -> null');
  ok((await dp.resolveParticipantPn(null, '123@lid')) === null, 'sem resolver -> null');
});

await test('isBotAuthor: compara por base (ignora o device)', () => {
  ok(dp.isBotAuthor(['5599999999999:5@s.whatsapp.net'], [BOT_JID]), 'casa ignorando o device');
  ok(dp.isBotAuthor([BOT_JID], [BOT_LID, BOT_JID]), 'casa pela identidade');
  ok(!dp.isBotAuthor(['5511888888888@s.whatsapp.net'], [BOT_JID]), 'terceiro não é o bot');
  ok(!dp.isBotAuthor([], [BOT_JID]), 'vazio não é o bot');
  ok(!dp.isBotAuthor(['123@lid'], []), 'sem identidades do bot -> false');
});

// ============================================================================
// 2) HANDLER REAL — APAGAR PAYMENT
// ============================================================================

await test('!d em requestPaymentMessage: edita o alvo e revoga (o caminho que funciona)', async () => {
  const groupJid = makeGroup();

  const { sent, texto } = await rodar({
    groupJid,
    text: '!d',
    quoted: { requestPaymentMessage: { currencyCodeIso4217: 'BRL', amount1000: '0' } },
    id: 'CMD-PAY',
  });

  includes(texto, 'pagamento deletada com sucesso', 'confirma o apagamento');

  // PASSO 1: mensagem temporária.
  const temp = sent.find((s) => s.content?.text === '');
  ok(Boolean(temp), 'criou a mensagem temporária');
  const idTemp = temp && sent.indexOf(temp) + 1 ? `SENT-${sent.indexOf(temp) + 1}` : null;

  // PASSO 2: a edição tem o id do PAGAMENTO como id da stanza.
  const editada = sent.find((s) => s.content?.edit);
  ok(Boolean(editada), 'mandou a edição');
  ok(editada?.options?.messageId === 'MSG-ALVO', `a edição sai com o id do pagamento (${editada?.options?.messageId})`);
  ok(editada?.content?.edit?.id === idTemp, `o alvo da edição é o temporário (${editada?.content?.edit?.id})`);
  includes(editada?.content?.text || '', 'pagamento removida', 'texto da edição');

  // PASSO 3: revoga o PAGAMENTO (não o temporário).
  const revogaPagamento = sent.find((s) => s.content?.delete?.id === 'MSG-ALVO');
  ok(Boolean(revogaPagamento), 'revogou o pagamento');
  ok(revogaPagamento?.content?.delete?.fromMe === false, 'de terceiro (fromMe false)');
  ok(revogaPagamento?.content?.delete?.participant === PN_DO_LID, 'com o participant do autor citado');

  // PASSO 4: revoga o temporário (é do bot).
  const revogaTemp = sent.find((s) => s.content?.delete?.id === idTemp);
  ok(Boolean(revogaTemp), 'revogou a mensagem temporária');
  ok(revogaTemp?.content?.delete?.fromMe === true, 'o temporário é do bot (fromMe true)');
});

await test('!d em sendPaymentMessage também usa o caminho especial', async () => {
  const groupJid = makeGroup();

  const { sent, texto } = await rodar({
    groupJid,
    text: '!d',
    quoted: { sendPaymentMessage: { noteMessage: { extendedTextMessage: { text: '.' } } } },
    id: 'CMD-SPAY',
  });

  includes(texto, 'pagamento deletada com sucesso', 'confirma');
  ok(sent.some((s) => s.content?.edit), 'mandou a edição');
  ok(sent.some((s) => s.content?.delete?.id === 'MSG-ALVO'), 'revogou o alvo');
});

await test('!d em payment encapsulado em view once usa o caminho especial', async () => {
  const groupJid = makeGroup();

  const { sent, texto } = await rodar({
    groupJid,
    text: '!d',
    quoted: { viewOnceMessageV2: { message: { requestPaymentMessage: { amount1000: '0' } } } },
    id: 'CMD-VOPAY',
  });

  includes(texto, 'pagamento deletada com sucesso', 'confirma');
  ok(sent.some((s) => s.content?.edit), 'mandou a edição');
  ok(sent.some((s) => s.content?.delete?.id === 'MSG-ALVO'), 'revogou o alvo');
});

await test('participant em LID: a revogação tenta o PN resolvido pelo socket', async () => {
  const groupJid = makeGroup();

  const { sent } = await rodar({
    groupJid,
    text: '!d',
    quoted: { requestPaymentMessage: { amount1000: '0' } },
    autor: '444000000000000@lid',
    pnDoLid: PN_DO_LID,
    id: 'CMD-LID',
  });

  const revoga = sent.find((s) => s.content?.delete?.id === 'MSG-ALVO');
  ok(Boolean(revoga), 'revogou');
  ok(revoga?.content?.delete?.participant === '444000000000000@lid', 'mantém o LID no participant');
  ok(revoga?.content?.delete?.participantAlt === PN_DO_LID, `inclui o PN resolvido (${revoga?.content?.delete?.participantAlt})`);
});

await test('payment do PRÓPRIO bot: revoga com fromMe true', async () => {
  const groupJid = makeGroup();

  const { sent } = await rodar({
    groupJid,
    text: '!d',
    quoted: { requestPaymentMessage: { amount1000: '0' } },
    autor: BOT_LID,
    id: 'CMD-BOTPAY',
  });

  const revoga = sent.find((s) => s.content?.delete?.id === 'MSG-ALVO');
  ok(Boolean(revoga), 'revogou');
  ok(revoga?.content?.delete?.fromMe === true, 'fromMe true (é do bot)');
  ok(revoga?.content?.delete?.participant === undefined, 'sem participant');
});

// ============================================================================
// 3) REGRESSÃO — O QUE JÁ FUNCIONAVA
// ============================================================================

await test('!d em mensagem comum continua usando o caminho normal', async () => {
  const groupJid = makeGroup();

  const { sent, texto } = await rodar({
    groupJid,
    text: '!d',
    quoted: { conversation: 'mensagem de alguem' },
    autor: '5511777777777@s.whatsapp.net',
    id: 'CMD-COMUM',
  });

  const apagaTerceiro = sent.find((s) => s.content?.delete?.id === 'MSG-ALVO');
  ok(Boolean(apagaTerceiro), 'apagou a mensagem marcada');
  ok(apagaTerceiro?.content?.delete?.participant === '5511777777777@s.whatsapp.net', 'com o autor certo');
  ok(!sent.some((s) => s.content?.edit), 'não passou pelo caminho de edição do payment');
  ok(!texto.includes('pagamento'), 'não falou em pagamento');
});

await test('!d sem alvo: não apaga nada', async () => {
  const groupJid = makeGroup();
  const { sent, texto } = await rodar({ groupJid, text: '!d', quoted: null });
  includes(texto, 'Marque a mensagem', 'pede o alvo');
  ok(!sent.some((s) => s.content?.delete), 'não apagou nada');
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
