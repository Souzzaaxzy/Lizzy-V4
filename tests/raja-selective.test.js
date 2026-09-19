/**
 * Testes do !raja com envio seletivo — membros comuns leem, admins não.
 *
 * O que este teste garante: que o !raja usa SOMENTE a API de rotação, com a
 * lista de autorizados = membros comuns (nunca um admin), mantendo o conteúdo
 * do raja intacto. Também cobre os N envios em sequência, que é onde a rotação
 * por mensagem poderia se atropelar.
 *
 * Uso: node tests/raja-selective.test.js
 */

import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-raja-sel-db-'));
process.env.DATABASE_PATH = TMP_DB;
const GRUPOS_DIR = path.join(TMP_DB, 'grupos');
fs.mkdirSync(GRUPOS_DIR, { recursive: true });

const RESULTS = [];
let CURRENT = null;

function test(name, fn) {
  CURRENT = { name, passed: 0, failed: 0, errors: [] };
  RESULTS.push(CURRENT);
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result
        .then(() => finish(name))
        .catch((error) => {
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

const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';

let groupCounter = 0;
function makeGroup() {
  groupCounter += 1;
  const jid = `1203636000000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(
    path.join(GRUPOS_DIR, `${jid}.json`),
    JSON.stringify({ modobrincadeira: true, groupName: 'Grupo Raja Seletivo' }, null, 2)
  );
  return jid;
}

const ADM_A = '111000000000001@lid';
const ADM_A_PN = '5511911111111@s.whatsapp.net';
const ADM_B = '111000000000002@lid';
const ADM_B_PN = '5511911111112@s.whatsapp.net';
const MEM_1 = '222000000000001@lid';
const MEM_1_PN = '5511922222221@s.whatsapp.net';
const MEM_2 = '222000000000002@lid';
const MEM_2_PN = '5511922222222@s.whatsapp.net';

const GROUP_PARTICIPANTS = [
  { id: BOT_LID, lid: BOT_LID, phoneNumber: BOT_JID, admin: 'admin' },
  { id: ADM_A, lid: ADM_A, phoneNumber: ADM_A_PN, admin: 'superadmin' },
  { id: ADM_B, lid: ADM_B, phoneNumber: ADM_B_PN, admin: 'admin' },
  { id: MEM_1, lid: MEM_1, phoneNumber: MEM_1_PN, admin: null },
  { id: MEM_2, lid: MEM_2, phoneNumber: MEM_2_PN, admin: null },
];

function makeNazu({ sent, groupJid, senderLid, hasRotationApi = true }) {
  const nazu = {
    sendMessage: async (jid, content, options) => {
      sent.push({ jid, content, options });
      return { key: { id: `SENT-${sent.length}` } };
    },
    relayMessage: async (jid, message, options) => {
      sent.push({ jid, message, options, via: 'relayMessage' });
      return options?.messageId;
    },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
    onWhatsApp: async (jid) => [{ jid, exists: true, lid: jid.replace('@s.whatsapp.net', '@lid') }],
    signalRepository: { lidMapping: { getPNForLID: async () => null, getLIDForPN: async () => null } },
    groupMetadata: async () => ({
      id: groupJid,
      subject: 'Grupo Raja Seletivo',
      participants: GROUP_PARTICIPANTS.map((p) => (p.id === senderLid ? { ...p, admin: null } : p)),
    }),
    groupParticipantsUpdate: async () => ({}),
    groupRequestParticipantsList: async () => [],
    groupRequestParticipantsUpdate: async () => ({}),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {},
    sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => 'x',
    react: async () => ({}),
    _rotationCalls: [],
  };
  if (hasRotationApi) {
    nazu.relayGroupMessageWithSenderKeyRotation = async (g, m, o) => {
      nazu._rotationCalls.push({ g, m, o });
      return { groupJid: g, messageId: o?.messageId, allowedParticipants: o?.allowedParticipants };
    };
  }
  return nazu;
}

async function rodar({ groupJid, text = '!raja 2 teste', senderLid = MEM_1, hasRotationApi = true }) {
  const sent = [];
  const nazu = makeNazu({ sent, groupJid, senderLid, hasRotationApi });
  await handleMessage(
    nazu,
    {
      key: { remoteJid: groupJid, fromMe: true, id: 'M-1', participant: senderLid },
      message: { extendedTextMessage: { text, contextInfo: { remoteJid: groupJid } } },
      messageTimestamp: 1757900000,
      pushName: 'Tester',
    },
    null,
    new Map(),
    null
  );
  const textos = sent.map((s) => s.content?.text ?? '').filter(Boolean).join('\n');
  return { sent, textos, nazu, rotationCalls: nazu._rotationCalls };
}

// ============================================================================

await test('!raja autoriza TODOS os membros comuns e NENHUM admin', async () => {
  const groupJid = makeGroup();
  const r = await rodar({ groupJid, text: '!raja 1 oi' });
  ok(r.rotationCalls.length === 1, `usou a rotação (${r.rotationCalls.length} chamadas)`);
  const autorizados = r.rotationCalls[0]?.o?.allowedParticipants ?? [];
  assert.deepEqual(
    autorizados.slice().sort(),
    [MEM_1, MEM_2].sort(),
    'autorizados = os dois membros comuns'
  );
  ok(!autorizados.includes(ADM_A), 'ADM_A (superadmin) NÃO está autorizado');
  ok(!autorizados.includes(ADM_B), 'ADM_B (admin) NÃO está autorizado');
});

await test('!raja NÃO usa relayMessage nem sendMessage para o conteúdo do raja', async () => {
  const groupJid = makeGroup();
  const r = await rodar({ groupJid, text: '!raja 1 conteudo' });
  const viaRelay = r.sent.filter((s) => s.via === 'relayMessage');
  ok(viaRelay.length === 0, `não caiu no relayMessage (${viaRelay.length}) — ele mostraria a todos`);
  const enviosComTexto = r.sent.filter((s) => s.content?.text === 'conteudo');
  ok(enviosComTexto.length === 0, 'o conteúdo não saiu por sendMessage');
  ok(r.rotationCalls.length === 1, 'o conteúdo saiu só pela rotação');
});

await test('!raja mantém o conteúdo do raja intacto (requestPaymentMessage)', async () => {
  const groupJid = makeGroup();
  const r = await rodar({ groupJid, text: '!raja 1 nota' });
  const msg = r.rotationCalls[0]?.m;
  ok(!!msg, 'passou a mensagem do raja');
  ok(!!msg?.requestPaymentMessage, 'o conteúdo continua sendo requestPaymentMessage');
  // O texto começa com o que foi pedido e ganha os @ das menções no fim (para o
  // WhatsApp renderizar a menção); o resto do proto continua igual.
  const nota = msg?.requestPaymentMessage?.noteMessage?.extendedTextMessage?.text;
  ok(typeof nota === 'string' && nota.startsWith('nota'), `o texto começa com o pedido (${JSON.stringify(nota?.slice(0, 40))})`);
  ok(nota.includes('@'), 'as menções foram acrescentadas ao texto');
  ok(
    Array.isArray(msg?.requestPaymentMessage?.noteMessage?.extendedTextMessage?.contextInfo?.mentionedJid),
    'mentionedJid continua na nota'
  );
});

await test('!raja envia N vezes, cada uma com messageId próprio', async () => {
  const groupJid = makeGroup();
  const r = await rodar({ groupJid, text: '!raja 3 repete' });
  assert.equal(r.rotationCalls.length, 3, 'enviou 3 mensagens');
  const ids = r.rotationCalls.map((c) => c.o?.messageId);
  assert.equal(new Set(ids).size, 3, 'cada envio tem um messageId distinto');
  ok(ids.every((id) => typeof id === 'string' && id.length > 0), 'todos os ids são strings válidas');
  ok(
    r.rotationCalls.every((c) => Array.isArray(c.o.allowedParticipants) && c.o.allowedParticipants.length === 2),
    'cada envio autoriza os mesmos dois membros'
  );
});

await test('!raja falha fechado se a fork não expõe a rotação (não vaza para o grupo)', async () => {
  const groupJid = makeGroup();
  const r = await rodar({ groupJid, text: '!raja 1 x', hasRotationApi: false });
  assert.equal(r.rotationCalls.length, 0, 'não chamou a rotação (inexistente)');
  const viaRelay = r.sent.filter((s) => s.via === 'relayMessage');
  assert.equal(viaRelay.length, 0, 'NÃO caiu para o relayMessage — nada foi enviado ao grupo');
  ok(r.textos.includes('Nada foi enviado'), 'avisou que nada foi enviado');
});

await test('!raja com grupo só de admins falha fechado', async () => {
  const groupJid = makeGroup();
  // Grupo sem membros comuns: sobrescreve o metadata para só admins.
  const sent = [];
  const nazu = makeNazu({ sent, groupJid, senderLid: ADM_A });
  nazu.groupMetadata = async () => ({
    id: groupJid,
    subject: 'Só admins',
    participants: [
      { id: BOT_LID, lid: BOT_LID, phoneNumber: BOT_JID, admin: 'admin' },
      { id: ADM_A, lid: ADM_A, phoneNumber: ADM_A_PN, admin: 'superadmin' },
    ],
  });
  await handleMessage(
    nazu,
    {
      key: { remoteJid: groupJid, fromMe: true, id: 'M-2', participant: ADM_A },
      message: { extendedTextMessage: { text: '!raja 1 x', contextInfo: { remoteJid: groupJid } } },
      messageTimestamp: 1757900000,
      pushName: 'Tester',
    },
    null,
    new Map(),
    null
  );
  assert.equal(nazu._rotationCalls.length, 0, 'não enviou nada');
  const textos = sent.map((s) => s.content?.text ?? '').join('\n');
  ok(textos.includes('Nada foi enviado'), 'avisou que nada foi enviado');
});

await test('!raja continua exigindo quantidade e texto', async () => {
  const groupJid = makeGroup();
  const r = await rodar({ groupJid, text: '!raja' });
  assert.equal(r.rotationCalls.length, 0, 'sem argumentos não envia');
  ok(r.textos.includes('Informe a quantidade'), 'pediu a quantidade');
});

// ============================================================================

const totalPassed = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFailed = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log(`\nTOTAL: ${totalPassed} ok, ${totalFailed} falhas em ${RESULTS.length} testes`);
process.exit(totalFailed === 0 ? 0 : 1);