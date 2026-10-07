/**
 * Payment RESPONDIDA (quoted) — integrado ao `!antifantasma` (antiinvi).
 *
 * Quando alguém responde a um card de pagamento com assinatura suspeita
 * (transactionData >= 512 + várias menções OU link), o AUTOR ORIGINAL do card é
 * removido. Cobre o módulo puro (`quotedPayment.js`) E o handler real com socket
 * falso, provando que:
 *   - só age com o `!antifantasma` ligado;
 *   - remove o AUTOR do card (não quem respondeu);
 *   - não remove admin;
 *   - não age em pagamento comum (sem a assinatura);
 *   - deduplica respostas ao mesmo card.
 *
 * Uso: node tests/quoted-payment.test.js
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  detectarPaymentRespondida, alvoDaRemocao, assinaturaSuspeita,
  tamanhoTransactionData, temLink, tipoPaymentCitado, autorEhAdmin,
} from '../dados/src/utils/quotedPayment.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-qpay-db-'));
process.env.DATABASE_PATH = TMP_DB;
fs.mkdirSync(path.join(TMP_DB, 'grupos'), { recursive: true });

const RESULTS = [];
let CURRENT = null;
function test(name, fn) {
  CURRENT = { name, passed: 0, failed: 0, errors: [] };
  RESULTS.push(CURRENT);
  try {
    const r = fn();
    if (r && typeof r.then === 'function') return r.then(finish).catch((e) => { CURRENT.failed++; CURRENT.errors.push(`EXCEÇÃO: ${e?.stack || e}`); finish(); });
    finish();
  } catch (e) { CURRENT.failed++; CURRENT.errors.push(`EXCEÇÃO: ${e?.stack || e}`); finish(); }
  return Promise.resolve();
}
function finish() {
  console.log(`${CURRENT.failed === 0 ? '✅' : '❌'} ${CURRENT.name} (${CURRENT.passed} ok, ${CURRENT.failed} falhas)`);
  for (const e of CURRENT.errors) console.log(`   ↳ ${e}`);
}
function ok(c, m) { if (c) CURRENT.passed++; else { CURRENT.failed++; CURRENT.errors.push(`ASSERT: ${m}`); } }

// ─────────────────────────── fixtures ───────────────────────────

const GRUPO = '120363999999999001@g.us';
const AUTOR_LID = '111000000000900@lid';
const AUTOR_JID = '5511000000009@s.whatsapp.net';
const RESPONDE_LID = '111000000000901@lid';
const BOT_LID = '111111111111111@lid';
const BOT_JID = '5599999999999@s.whatsapp.net';

const TX_GRANDE = 'x'.repeat(600);
const TX_PEQUENO = 'x'.repeat(40);

function nota(text, mentionCount = 0) {
  const mentionedJid = Array.from({ length: mentionCount }, (_, i) => `5511900000${String(i).padStart(3, '0')}@s.whatsapp.net`);
  return { extendedTextMessage: { text, contextInfo: { mentionedJid } } };
}

function paymentCitado({ tipo = 'sendPaymentMessage', tx = TX_GRANDE, text = 'oi', mentionCount = 0 } = {}) {
  const card = { noteMessage: nota(text, mentionCount), transactionData: tx };
  return { [tipo]: card };
}

function infoResposta(citado, { authorLid = AUTOR_LID, stanzaId = 'PAY-1' } = {}) {
  return {
    key: { remoteJid: GRUPO, fromMe: false, id: 'RESP-1', participant: RESPONDE_LID },
    message: {
      extendedTextMessage: {
        text: 'olha isso',
        contextInfo: { participant: authorLid, stanzaId, quotedMessage: citado },
      },
    },
    messageTimestamp: 1757900000,
    pushName: 'Quem respondeu',
  };
}

// ─────────────────────────── módulo puro ───────────────────────────

await test('módulo: assinaturaSuspeita exige tx>=512 E (menções OU link)', () => {
  ok(assinaturaSuspeita({ transactionLength: 600, mentions: 3, text: '' }), 'tx grande + menções = suspeito');
  ok(assinaturaSuspeita({ transactionLength: 600, mentions: 0, text: 'veja https://x.com' }), 'tx grande + link = suspeito');
  ok(!assinaturaSuspeita({ transactionLength: 100, mentions: 9, text: '' }), 'tx pequeno NÃO é suspeito');
  ok(!assinaturaSuspeita({ transactionLength: 600, mentions: 0, text: 'texto normal' }), 'tx grande sem menções nem link NÃO é suspeito');
});

await test('módulo: helpers de tamanho/link/tipo/admin', () => {
  ok(tamanhoTransactionData('abcdef') === 6, 'string');
  ok(tamanhoTransactionData(Buffer.alloc(10)) === 10, 'Buffer');
  ok(tamanhoTransactionData(new Uint8Array(3)) === 3, 'Uint8Array');
  ok(tamanhoTransactionData(null) === 0, 'null = 0');
  ok(temLink('www.site.com') && temLink('t.me/x') && !temLink('nada'), 'detecta link');
  ok(tipoPaymentCitado({ sendPaymentMessage: {} }) === 'sendPaymentMessage', 'send');
  ok(tipoPaymentCitado({ requestPaymentMessage: {} }) === 'requestPaymentMessage', 'request');
  ok(tipoPaymentCitado({ imageMessage: {} }) === null, 'não-payment = null');
  ok(autorEhAdmin({ admin: 'admin' }) && autorEhAdmin({ admin: 'superadmin' }) && !autorEhAdmin({ admin: null }), 'admin');
});

await test('módulo: detectarPaymentRespondida — assinatura suspeita', () => {
  const det = detectarPaymentRespondida(infoResposta(paymentCitado({ mentionCount: 3 })));
  ok(det.ataque === true, 'deveria marcar ataque');
  ok(det.author === AUTOR_LID, 'autor = quem mandou o card');
  ok(det.paymentType === 'sendPaymentMessage', 'tipo do card');
  ok(det.transactionLength === 600 && det.mentions === 3, 'medidas reais');
});

await test('módulo: NÃO marca pagamento comum / resposta normal', () => {
  ok(detectarPaymentRespondida(infoResposta(paymentCitado({ tx: TX_PEQUENO, mentionCount: 3 }))).ataque === false, 'tx pequeno');
  ok(detectarPaymentRespondida(infoResposta(paymentCitado({ tx: TX_GRANDE, mentionCount: 0, text: 'oi' }))).ataque === false, 'sem menções/link');
  ok(detectarPaymentRespondida({ key: { remoteJid: GRUPO, fromMe: false }, message: { conversation: 'oi' } }).ataque === false, 'resposta normal');
  ok(detectarPaymentRespondida(infoResposta(paymentCitado(), {}).key && {
    key: { remoteJid: GRUPO, fromMe: false },
    message: { extendedTextMessage: { contextInfo: { participant: AUTOR_LID, stanzaId: 'x', quotedMessage: { imageMessage: {} } } } },
  }).ataque === false, 'citou imagem (não payment)');
});

await test('módulo: alvoDaRemocao acha o autor e recusa admin', () => {
  const parts = [
    { id: AUTOR_LID, phoneNumber: AUTOR_JID, admin: null },
    { id: BOT_LID, phoneNumber: BOT_JID, admin: 'admin' },
  ];
  const alvo = alvoDaRemocao(parts, AUTOR_LID);
  ok(alvo && alvo.jid === AUTOR_JID, 'acha pelo LID e devolve o telefone');
  ok(alvoDaRemocao(parts, BOT_LID) === null, 'bot admin não é alvo');
  ok(alvoDaRemocao(parts, '5511999999999@s.whatsapp.net') === null, 'autor fora do grupo = null');
});

// ─────────────────────────── handler real ───────────────────────────

const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;

function makeGroup(extra = {}) {
  const g = `1203638000000${String(++makeGroup.n).padStart(4, '0')}@g.us`;
  fs.writeFileSync(path.join(TMP_DB, 'grupos', `${g}.json`),
    JSON.stringify({ groupName: 'GP QPay', antiinvi: true, ...extra }, null, 2));
  return g;
}
makeGroup.n = 0;

const removed = [];
function makeNazu(groupJid) {
  return {
    sendMessage: async () => ({ key: { id: 'SENT' } }),
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
    groupMetadata: async () => ({
      id: groupJid,
      participants: [
        { id: AUTOR_LID, phoneNumber: AUTOR_JID, admin: null },
        { id: RESPONDE_LID, phoneNumber: '5511000000010@s.whatsapp.net', admin: 'admin' },
        { id: BOT_LID, phoneNumber: BOT_JID, admin: 'admin' },
      ],
    }),
    groupParticipantsUpdate: async (jid, users, action) => { removed.push({ jid, users, action }); return {}; },
    groupRequestParticipantsList: async () => [],
    groupRequestParticipantsUpdate: async () => ({}),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {},
    sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => 'https://example.com/p.jpg',
    react: async () => ({}),
  };
}

async function run(citado, { groupExtra = {}, authorLid = AUTOR_LID, stanzaId } = {}) {
  removed.length = 0;
  const groupJid = makeGroup(groupExtra);
  const info = infoResposta(citado, { authorLid, stanzaId });
  info.key.remoteJid = groupJid;
  await handleMessage(makeNazu(groupJid), info, null, new Map(), null);
  return removed.slice();
}

await test('handler: remove o AUTOR do card quando o antifantasma está ligado', async () => {
  const rem = await run(paymentCitado({ mentionCount: 3 }));
  ok(rem.length === 1, `esperado 1 remoção (obtido ${rem.length})`);
  ok(rem[0]?.users?.includes(AUTOR_JID), 'removeu o AUTOR (telefone), não quem respondeu');
  ok(rem[0]?.action === 'remove', 'ação remove');
});

await test('handler: NÃO remove com o antifantasma DESLIGADO', async () => {
  const rem = await run(paymentCitado({ mentionCount: 3 }), { groupExtra: { antiinvi: false } });
  ok(rem.length === 0, 'sem o toggle não age');
});

await test('handler: NÃO remove em pagamento comum (tx pequeno)', async () => {
  const rem = await run(paymentCitado({ tx: TX_PEQUENO, mentionCount: 3 }));
  ok(rem.length === 0, 'payment comum não é ataque');
});

await test('handler: NÃO remove quando o autor citado é ADMIN', async () => {
  const rem = await run(paymentCitado({ mentionCount: 3 }), { authorLid: BOT_LID });
  ok(rem.length === 0, 'não remove admin');
});

await test('handler: deduplica — duas respostas ao MESMO card = 1 remoção', async () => {
  const groupJid = makeGroup();
  const info1 = infoResposta(paymentCitado({ mentionCount: 3 }), { stanzaId: 'SAME-ID' });
  info1.key.remoteJid = groupJid;
  const info2 = infoResposta(paymentCitado({ mentionCount: 3 }), { stanzaId: 'SAME-ID' });
  info2.key.remoteJid = groupJid;
  removed.length = 0;
  const nazu = makeNazu(groupJid);
  await handleMessage(nazu, info1, null, new Map(), null);
  await handleMessage(nazu, info2, null, new Map(), null);
  ok(removed.length === 1, `esperado 1 remoção para o mesmo card (obtido ${removed.length})`);
});

// ─────────────────────────── resumo ───────────────────────────

console.log('\n' + '─'.repeat(60));
let passed = 0, failed = 0;
for (const r of RESULTS) { passed += r.passed; failed += r.failed; }
console.log(`Total: ${RESULTS.length} testes / ${passed} asserções ok, ${failed} falhas`);
process.exit(failed === 0 ? 0 : 1);
