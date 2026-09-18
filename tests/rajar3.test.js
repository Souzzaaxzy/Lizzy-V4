/**
 * Testes do !rajar3 — EXPERIMENTO: mensagem nova de grupo com
 * `recipientMode: 'members-only'`.
 *
 * O que este teste garante: que o comando usa o fluxo NORMAL do `sendMessage`
 * com `recipientMode: 'members-only'`, e NÃO o retry pairwise. Também confirma
 * as guardas (grupo, dono) e que !rajar e !rajar2 seguem intactos.
 *
 * Uso: node tests/rajar3.test.js
 */

import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-rajar3-db-'));
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
  const jid = `1203634000000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(
    path.join(GRUPOS_DIR, `${jid}.json`),
    JSON.stringify({ modobrincadeira: true, groupName: 'Grupo Rajar3' }, null, 2)
  );
  return jid;
}

const ADM_A = '111000000000001@lid';
const ADM_A_PN = '5511911111111@s.whatsapp.net';
const MEM_1 = '222000000000001@lid';
const MEM_1_PN = '5511922222221@s.whatsapp.net';
const MEM_2 = '222000000000002@lid';
const MEM_2_PN = '5511922222222@s.whatsapp.net';

const GROUP_PARTICIPANTS = [
  { id: BOT_LID, lid: BOT_LID, phoneNumber: BOT_JID, admin: 'admin' },
  { id: ADM_A, lid: ADM_A, phoneNumber: ADM_A_PN, admin: 'superadmin' },
  { id: MEM_1, lid: MEM_1, phoneNumber: MEM_1_PN, admin: null },
  { id: MEM_2, lid: MEM_2, phoneNumber: MEM_2_PN, admin: null },
];

function makeNazu({ sent, groupJid, senderLid, admin }) {
  const nazu = {
    sendMessage: async (jid, content, options) => {
      sent.push({ jid, content, options });
      return { key: { id: `SENT-${sent.length}` } };
    },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
    onWhatsApp: async (jid) => [{ jid, exists: true, lid: jid.replace('@s.whatsapp.net', '@lid') }],
    signalRepository: { lidMapping: { getPNForLID: async () => null, getLIDForPN: async () => null } },
    groupMetadata: async () => ({
      id: groupJid,
      subject: 'Grupo Rajar3',
      participants: GROUP_PARTICIPANTS.map((p) => (p.id === senderLid ? { ...p, admin } : p)),
    }),
    groupParticipantsUpdate: async () => ({}),
    groupRequestParticipantsList: async () => [],
    groupRequestParticipantsUpdate: async () => ({}),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {},
    sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => 'x',
    react: async () => ({}),
    _experimentalCalls: [],
  };
  // Present so a stray call to the pairwise API would be visible.
  nazu.relayGroupMessagePairwiseExperimental = async (g, m, o) => {
    nazu._experimentalCalls.push({ g, o });
    return { groupJid: g, messageId: o?.messageId, participant: o?.participant, participantDevice: 0 };
  };
  return nazu;
}

async function rodar({ groupJid, text = '!rajar3', owner = true, senderLid = null }) {
  const effectiveSender = senderLid || MEM_1;
  const sent = [];
  const nazu = makeNazu({ sent, groupJid, senderLid: effectiveSender, admin: null });
  await handleMessage(
    nazu,
    {
      key: {
        remoteJid: groupJid,
        fromMe: owner,
        id: `M-${Math.random().toString(36).slice(2, 9)}`,
        participant: effectiveSender,
      },
      message: { extendedTextMessage: { text, contextInfo: { remoteJid: groupJid } } },
      messageTimestamp: 1757900000,
      pushName: 'Tester',
    },
    null,
    new Map(),
    null
  );
  const textos = sent.map((s) => s.content?.text ?? '').filter(Boolean).join('\n');
  const envioMembersOnly = sent.find((s) => s.options?.recipientMode === 'members-only') || null;
  return { sent, textos, envioMembersOnly, experimentalCalls: nazu._experimentalCalls };
}

// ============================================================================

await test('!rajar3 envia uma mensagem NOVA de grupo com recipientMode members-only', async () => {
  const groupJid = makeGroup();
  const r = await rodar({ groupJid, text: '!rajar3 teste-members-only' });
  ok(!!r.envioMembersOnly, 'enviou com recipientMode members-only');
  assert.equal(r.envioMembersOnly?.options?.recipientMode, 'members-only', 'modo correto');
  ok(r.envioMembersOnly?.content?.text === 'teste-members-only', 'enviou o texto pedido');
});

await test('!rajar3 NÃO usa pairwise retry nem a API experimental', async () => {
  const groupJid = makeGroup();
  const r = await rodar({ groupJid, text: '!rajar3 x' });
  assert.equal(r.experimentalCalls.length, 0, 'não chamou relayGroupMessagePairwiseExperimental');
  ok(!!r.envioMembersOnly, 'o envio foi pelo sendMessage normal');
  // Nenhum envio pode carregar `participant` (que é a marca do retry resend).
  const comParticipant = r.sent.filter((s) => s.options?.participant);
  assert.equal(comParticipant.length, 0, 'nenhum envio com participant de retry');
});

await test('!rajar3 usa o texto padrão quando não é passado texto', async () => {
  const groupJid = makeGroup();
  const r = await rodar({ groupJid, text: '!rajar3' });
  ok(
    typeof r.envioMembersOnly?.content?.text === 'string' && r.envioMembersOnly.content.text.includes('MEMBERS_ONLY'),
    'frase padrão do experimento'
  );
});

await test('!rajar3 fora de grupo é recusado', async () => {
  const r = await rodar({ groupJid: '5511999999999@s.whatsapp.net', text: '!rajar3 x' });
  ok(!r.envioMembersOnly, 'não enviou fora de grupo');
  ok(r.textos.includes('só funciona em grupos'), 'avisou que exige grupo');
});

await test('!rajar3 exige o dono do bot', async () => {
  const groupJid = makeGroup();
  const r = await rodar({ groupJid, text: '!rajar3 x', owner: false });
  ok(!r.envioMembersOnly, 'membro comum não dispara o experimento');
  ok(r.textos.includes('Apenas o dono'), 'avisou que é restrito ao dono');
});

await test('!rajar3 informa membros e admins e a limitação medida', async () => {
  const groupJid = makeGroup();
  const r = await rodar({ groupJid, text: '!rajar3 relatorio' });
  ok(r.textos.includes('membros comuns'), 'informou a contagem de membros');
  ok(r.textos.includes('admins'), 'informou a contagem de admins');
  ok(r.textos.includes('sem retry pairwise'), 'deixou claro que não é retry pairwise');
  ok(r.textos.includes('decifrar'), 'avisa a limitação da Sender Key reusada');
});

// Regressão: os comandos anteriores continuam intactos.

await test('!rajar continua com recipientMode members-only (inalterado)', async () => {
  const groupJid = makeGroup();
  const r = await rodar({ groupJid, text: '!rajar inalterado', owner: false });
  const envio = r.sent.find((s) => s.options?.recipientMode === 'members-only');
  ok(!!envio, '!rajar ainda envia com recipientMode members-only');
});

await test('!rajar2 continua chamando a API experimental (inalterado)', async () => {
  const groupJid = makeGroup();
  const sent = [];
  const nazu = makeNazu({ sent, groupJid, senderLid: MEM_1, admin: null });
  await handleMessage(
    nazu,
    {
      key: { remoteJid: groupJid, fromMe: true, id: 'X-1', participant: MEM_1 },
      message: {
        extendedTextMessage: {
          text: `!rajar2 @${MEM_1} ainda funciona`,
          contextInfo: { remoteJid: groupJid, mentionedJid: [MEM_1] },
        },
      },
      messageTimestamp: 1757900000,
      pushName: 'Tester',
    },
    null,
    new Map(),
    null
  );
  ok(nazu._experimentalCalls.length === 1, `!rajar2 ainda usa a API experimental (${nazu._experimentalCalls.length})`);
});

// ============================================================================

const totalPassed = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFailed = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log(`\n${totalFailed === 0 ? '✅' : '❌'} TOTAL: ${totalPassed} ok, ${totalFailed} falhas em ${RESULTS.length} testes`);
process.exit(totalFailed === 0 ? 0 : 1);
