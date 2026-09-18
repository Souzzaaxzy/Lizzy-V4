/**
 * Testes do !rajar4 — EXPERIMENTO: rotação seletiva de Sender Key.
 *
 * O que este teste garante: que o comando chama SOMENTE a API experimental de
 * rotação (`relayGroupMessageWithSenderKeyRotation`) com o alvo autorizado, e
 * NÃO cai no sendMessage normal, no recipientMode do !rajar3 nem no pairwise
 * retry do !rajar2. Também confirma as guardas (grupo, dono, alvo obrigatório)
 * e que os comandos anteriores seguem intactos.
 *
 * Uso: node tests/rajar4.test.js
 */

import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-rajar4-db-'));
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
  const jid = `1203635000000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(
    path.join(GRUPOS_DIR, `${jid}.json`),
    JSON.stringify({ modobrincadeira: true, groupName: 'Grupo Rajar4' }, null, 2)
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

function makeNazu({ sent, groupJid, senderLid, admin, hasRotationApi = true }) {
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
      subject: 'Grupo Rajar4',
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
    _rotationCalls: [],
    _pairwiseCalls: [],
  };
  // Present so a wrong-API call would be visible.
  nazu.relayGroupMessagePairwiseExperimental = async (g, m, o) => {
    nazu._pairwiseCalls.push({ g, o });
    return { groupJid: g, messageId: o?.messageId, participant: o?.participant, participantDevice: 0 };
  };
  if (hasRotationApi) {
    nazu.relayGroupMessageWithSenderKeyRotation = async (g, m, o) => {
      nazu._rotationCalls.push({ g, m, o });
      return { groupJid: g, messageId: o?.messageId, allowedParticipants: o?.allowedParticipants };
    };
  }
  return nazu;
}

async function rodar({
  groupJid,
  text = '!rajar4',
  participant = null,
  quoted = null,
  owner = true,
  senderLid = MEM_1,
  hasRotationApi = true,
}) {
  const sent = [];
  const nazu = makeNazu({ sent, groupJid, senderLid, admin: null, hasRotationApi });
  const contextInfo = { remoteJid: groupJid };
  if (participant) contextInfo.mentionedJid = [participant];
  if (quoted) {
    contextInfo.quotedMessage = quoted;
    contextInfo.participant = participant;
  }
  await handleMessage(
    nazu,
    {
      key: { remoteJid: groupJid, fromMe: owner, id: `M-${Math.random().toString(36).slice(2, 9)}`, participant: senderLid },
      message: { extendedTextMessage: { text, contextInfo } },
      messageTimestamp: 1757900000,
      pushName: 'Tester',
    },
    null,
    new Map(),
    null
  );
  const textos = sent.map((s) => s.content?.text ?? '').filter(Boolean).join('\n');
  return { sent, textos, nazu, rotationCalls: nazu._rotationCalls, pairwiseCalls: nazu._pairwiseCalls };
}

// ============================================================================

await test('!rajar4 chama a API de rotação com o alvo autorizado', async () => {
  const groupJid = makeGroup();
  const r = await rodar({ groupJid, text: `!rajar4 @${MEM_1} teste-rotacao`, participant: MEM_1 });
  ok(r.rotationCalls.length === 1, `exatamente uma chamada de rotação (${r.rotationCalls.length})`);
  const call = r.rotationCalls[0];
  ok(call.g === groupJid, 'passou o grupo correto');
  assert.deepEqual(call.o?.allowedParticipants, [MEM_1], 'autorizou somente o alvo');
  ok(typeof call.o?.messageId === 'string' && call.o.messageId.length > 0, 'passou um messageId');
  ok(!!call.m, 'passou o conteúdo da mensagem');
});

await test('!rajar4 NÃO usa pairwise retry nem o sendMessage normal para a mensagem', async () => {
  const groupJid = makeGroup();
  const r = await rodar({ groupJid, text: `!rajar4 @${MEM_1} so-rotacao`, participant: MEM_1 });
  ok(r.pairwiseCalls.length === 0, 'não chamou a API pairwise');
  ok(r.rotationCalls.length === 1, 'chamou a API de rotação');
  const enviosComTexto = r.sent.filter((s) => s.content?.text === 'so-rotacao');
  ok(enviosComTexto.length === 0, 'o texto experimental só saiu pela API de rotação');
  const comRecipientMode = r.sent.filter((s) => s.options?.recipientMode);
  ok(comRecipientMode.length === 0, 'não usou recipientMode (isso é o !rajar3)');
});

await test('!rajar4 autoriza apenas o alvo, nunca um admin', async () => {
  const groupJid = makeGroup();
  const r = await rodar({ groupJid, text: `!rajar4 @${MEM_1} x`, participant: MEM_1 });
  const autorizados = r.rotationCalls[0]?.o?.allowedParticipants ?? [];
  assert.deepEqual(autorizados, [MEM_1], 'lista de autorizados contém só o alvo');
  ok(!autorizados.includes(ADM_A), 'nenhum admin foi autorizado');
  ok(!autorizados.includes(MEM_2), 'nenhum outro membro foi autorizado');
});

await test('!rajar4 aceita citação como alvo', async () => {
  const groupJid = makeGroup();
  const r = await rodar({
    groupJid,
    text: '!rajar4 via citacao',
    participant: MEM_1,
    quoted: { extendedTextMessage: { text: 'citada' } },
  });
  ok(r.rotationCalls.length === 1, 'aceitou o alvo pela citação');
  assert.deepEqual(r.rotationCalls[0].o.allowedParticipants, [MEM_1], 'autorizou o autor da citação');
});

await test('!rajar4 usa texto padrão sem texto', async () => {
  const groupJid = makeGroup();
  const r = await rodar({ groupJid, text: `!rajar4 @${MEM_1}`, participant: MEM_1 });
  ok(r.rotationCalls.length === 1, 'enviou mesmo sem texto');
});

await test('!rajar4 fora de grupo é recusado', async () => {
  const r = await rodar({ groupJid: '5511999999999@s.whatsapp.net', text: `!rajar4 @${MEM_1} x`, participant: MEM_1 });
  ok(r.rotationCalls.length === 0, 'não rotacionou fora de grupo');
  ok(r.textos.includes('só funciona em grupos'), 'avisou que exige grupo');
});

await test('!rajar4 sem alvo é recusado (não adivinha autorizado)', async () => {
  const groupJid = makeGroup();
  const r = await rodar({ groupJid, text: '!rajar4 sem alvo' });
  ok(r.rotationCalls.length === 0, 'não rotacionou sem alvo');
  ok(r.textos.includes('Marque'), 'pediu para marcar/responder alguém');
});

await test('!rajar4 exige o dono do bot', async () => {
  const groupJid = makeGroup();
  const r = await rodar({ groupJid, text: `!rajar4 @${MEM_1} x`, participant: MEM_1, owner: false });
  ok(r.rotationCalls.length === 0, 'membro comum não dispara a rotação');
  ok(r.textos.includes('Apenas o dono'), 'avisou que é restrito ao dono');
});

await test('!rajar4 avisa se a fork não expõe a API de rotação', async () => {
  const groupJid = makeGroup();
  const r = await rodar({
    groupJid,
    text: `!rajar4 @${MEM_1} x`,
    participant: MEM_1,
    hasRotationApi: false,
  });
  ok(r.textos.includes('não expõe a API de rotação'), 'informou a incompatibilidade');
});

await test('!rajar4 informa o que foi distribuído e o estado honesto da validação', async () => {
  const groupJid = makeGroup();
  const r = await rodar({ groupJid, text: `!rajar4 @${MEM_1} relatorio`, participant: MEM_1 });
  ok(r.textos.includes('Sender Key NOVA'), 'informou a chave nova');
  ok(r.textos.includes('sem retry pairwise'), 'informou que não é retry');
  // Estado honesto: a rotação é por mensagem e o retry está suprimido, mas o
  // comportamento do cliente real ainda não foi validado.
  ok(r.textos.includes('rotacionada por mensagem'), 'informou a rotação por mensagem');
  ok(r.textos.includes('suprimido'), 'informou a supressão do retry');
  ok(r.textos.includes('NÃO validado'), 'deixou claro o que ainda não foi validado');
});

// Regressão: os comandos anteriores continuam intactos.

await test('!rajar continua com recipientMode members-only (inalterado)', async () => {
  const groupJid = makeGroup();
  const r = await rodar({ groupJid, text: '!rajar inalterado', owner: false, participant: null });
  const envio = r.sent.find((s) => s.options?.recipientMode === 'members-only');
  ok(!!envio, '!rajar ainda usa recipientMode members-only');
  assert.equal(r.rotationCalls.length, 0, '!rajar NÃO usa a rotação');
});

await test('!rajar3 continua com recipientMode members-only (inalterado)', async () => {
  const groupJid = makeGroup();
  const r = await rodar({ groupJid, text: '!rajar3 inalterado' });
  const envio = r.sent.find((s) => s.options?.recipientMode === 'members-only');
  ok(!!envio, '!rajar3 ainda usa recipientMode members-only');
  assert.equal(r.rotationCalls.length, 0, '!rajar3 NÃO usa a rotação');
});

await test('!rajar2 continua chamando a API pairwise (inalterado)', async () => {
  const groupJid = makeGroup();
  const r = await rodar({ groupJid, text: `!rajar2 @${MEM_1} ainda funciona`, participant: MEM_1 });
  ok(r.pairwiseCalls.length === 1, `!rajar2 ainda usa a API pairwise (${r.pairwiseCalls.length})`);
  assert.equal(r.rotationCalls.length, 0, '!rajar2 NÃO usa a rotação');
});

// ============================================================================

const totalPassed = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFailed = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log(`\n${totalFailed === 0 ? '✅' : ''} TOTAL: ${totalPassed} ok, ${totalFailed} falhas em ${RESULTS.length} testes`);
process.exit(totalFailed === 0 ? 0 : 1);