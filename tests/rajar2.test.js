/**
 * Testes do !rajar2 — comando EXPERIMENTAL de retransmissão pairwise.
 *
 * O que este teste garante: que o comando chama a API EXPERIMENTAL da fork
 * (`relayGroupMessagePairwiseExperimental`) com o participante alvo, e NÃO cai
 * de volta no `sendMessage` normal nem no `recipientMode` do !rajar. Também
 * confirma as guardas (grupo, dono, alvo obrigatório) e que o !rajar original
 * segue intacto.
 *
 * Uso: node tests/rajar2.test.js
 */

import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-rajar2-db-'));
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
  const jid = `1203633000000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(
    path.join(GRUPOS_DIR, `${jid}.json`),
    JSON.stringify({ modobrincadeira: true, groupName: 'Grupo Rajar2' }, null, 2)
  );
  return jid;
}

const ADM_A = '111000000000001@lid';
const ADM_A_PN = '5511911111111@s.whatsapp.net';
const MEM_1 = '222000000000001@lid';
const MEM_1_PN = '5511922222221@s.whatsapp.net';

const GROUP_PARTICIPANTS = [
  { id: BOT_LID, lid: BOT_LID, phoneNumber: BOT_JID, admin: 'admin' },
  { id: ADM_A, lid: ADM_A, phoneNumber: ADM_A_PN, admin: 'superadmin' },
  { id: MEM_1, lid: MEM_1, phoneNumber: MEM_1_PN, admin: null },
];

/**
 * `nazu` que registra a chamada experimental E os `sendMessage`, para o teste
 * provar que o comando escolheu a API certa. `hasExperimentalApi: false`
 * simula uma fork antiga que não expõe a função.
 */
function makeNazu({ sent, groupJid, senderLid, admin, hasExperimentalApi = true }) {
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
      subject: 'Grupo Rajar2',
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
  if (hasExperimentalApi) {
    nazu.relayGroupMessagePairwiseExperimental = async (groupJid2, message, options) => {
      nazu._experimentalCalls.push({ groupJid: groupJid2, message, options });
      return {
        groupJid: groupJid2,
        messageId: options?.messageId,
        participant: options?.participant,
        participantDevice: 0,
      };
    };
  }
  return nazu;
}

let senderCounter = 0;
async function rodar({
  groupJid,
  text = '!rajar2',
  participant = null,
  quoted = null,
  owner = false,
  hasExperimentalApi = true,
}) {
  senderCounter += 1;
  // O dono do bot fala pelo próprio JID; um membro comum usa MEM_1.
  const senderLid = owner ? null : MEM_1;
  const sent = [];
  const nazu = makeNazu({ sent, groupJid, senderLid, admin: null, hasExperimentalApi });
  const contextInfo = { remoteJid: groupJid };
  if (participant) contextInfo.mentionedJid = [participant];
  if (quoted) {
    contextInfo.quotedMessage = quoted;
    contextInfo.participant = participant;
  }
  const key = {
    remoteJid: groupJid,
    fromMe: owner,
    id: `M-${Math.random().toString(36).slice(2, 9)}`,
    // O handler resolve `sender` a partir de `participant`; sem ele o comando
    // nem chega ao switch. O dono usa fromMe (como as mensagens do aparelho
    // dele chegam), então o participant é só o remetente da mensagem.
    participant: senderLid || MEM_1,
  };

  await handleMessage(
    nazu,
    {
      key,
      message: { extendedTextMessage: { text, contextInfo } },
      messageTimestamp: 1757900000,
      pushName: 'Tester',
    },
    null,
    new Map(),
    null
  );

  const textos = sent.map((s) => s.content?.text ?? '').filter(Boolean).join('\n');
  return { sent, textos, nazu, experimentalCalls: nazu._experimentalCalls };
}

// ============================================================================
// 1. O caminho experimental
// ============================================================================

await test('!rajar2 com menção chama a API experimental com o alvo', async () => {
  const groupJid = makeGroup();
  // Como membro comum; o comando exige dono, mas queremos medir a guarda.
  const r = await rodar({ groupJid, text: `!rajar2 @${MEM_1} teste experimental`, participant: MEM_1, owner: true });
  ok(r.experimentalCalls.length === 1, `exatamente uma chamada experimental (recebeu ${r.experimentalCalls.length})`);
  const call = r.experimentalCalls[0];
  ok(call.groupJid === groupJid, 'passou o groupJid correto');
  ok(call.options?.participant === MEM_1, `passou o participante alvo (${call.options?.participant})`);
  ok(typeof call.options?.messageId === 'string' && call.options.messageId.length > 0, 'passou um messageId');
  ok(!!call.message, 'passou o conteúdo da mensagem');
  assert.equal(r.sent.filter((s) => s.options?.recipientMode).length, 0, 'NÃO usou recipientMode');
});

await test('!rajar2 NÃO envia a mensagem pelo sendMessage normal', async () => {
  const groupJid = makeGroup();
  const r = await rodar({ groupJid, text: '!rajar2 @222000000000001 olá', participant: MEM_1, owner: true });
  // O único sendMessage esperado é a resposta de confirmação (texto curto),
  // nunca a mensagem experimental em si.
  const enviosComTextoExperimental = r.sent.filter((s) => s.content?.text === 'olá');
  assert.equal(enviosComTextoExperimental.length, 0, 'o texto experimental só sai pela API experimental');
  ok(r.experimentalCalls.length === 1, 'a mensagem saiu pela API experimental');
});

await test('!rajar2 também aceita citação (quoted) como alvo', async () => {
  const groupJid = makeGroup();
  const r = await rodar({
    groupJid,
    text: '!rajar2 via citação',
    participant: MEM_1,
    quoted: { extendedTextMessage: { text: 'mensagem citada' } },
    owner: true,
  });
  ok(r.experimentalCalls.length === 1, 'aceitou o alvo pela citação');
  ok(r.experimentalCalls[0].options?.participant === MEM_1, 'alvo é o autor da citação');
});

// ============================================================================
// 2. Guardas
// ============================================================================

await test('!rajar2 fora de grupo é recusado', async () => {
  const r = await rodar({ groupJid: '5511999999999@s.whatsapp.net', text: '!rajar2 @222000000000001 x', participant: MEM_1, owner: true });
  ok(r.experimentalCalls.length === 0, 'não chamou a API fora de grupo');
  ok(r.textos.includes('só funciona em grupos'), 'avisou que exige grupo');
});

await test('!rajar2 sem alvo é recusado (não adivinha destinatário)', async () => {
  const groupJid = makeGroup();
  const r = await rodar({ groupJid, text: '!rajar2 sem alvo', owner: true });
  ok(r.experimentalCalls.length === 0, 'não chamou a API sem alvo');
  ok(r.textos.includes('Marque'), 'pediu para marcar/responder alguém');
});

await test('!rajar2 exige o dono do bot', async () => {
  const groupJid = makeGroup();
  const r = await rodar({ groupJid, text: `!rajar2 @${MEM_1} x`, participant: MEM_1, owner: false });
  ok(r.experimentalCalls.length === 0, 'membro comum não dispara o experimento');
  ok(r.textos.includes('Apenas o dono'), 'avisou que é restrito ao dono');
});

await test('!rajar2 falha de forma clara se a fork não expõe a API', async () => {
  const groupJid = makeGroup();
  const r = await rodar({
    groupJid,
    text: `!rajar2 @${MEM_1} x`,
    participant: MEM_1,
    owner: true,
    hasExperimentalApi: false,
  });
  ok(r.textos.includes('não expõe a API experimental'), 'informou a incompatibilidade');
});

// ============================================================================
// 3. O !rajar original segue intacto
// ============================================================================

await test('!rajar continua usando recipientMode members-only (não migrou)', async () => {
  const groupJid = makeGroup();
  const sent = [];
  const nazu = makeNazu({ sent, groupJid, senderLid: MEM_1, admin: null });
  await handleMessage(
    nazu,
    {
      key: { remoteJid: groupJid, fromMe: false, id: 'R-1', participant: MEM_1 },
      message: { extendedTextMessage: { text: '!rajar ainda usa o modo antigo', contextInfo: { remoteJid: groupJid } } },
      messageTimestamp: 1757900000,
      pushName: 'Tester',
    },
    null,
    new Map(),
    null
  );
  const envio = sent.find((s) => s.options?.recipientMode);
  ok(!!envio, '!rajar ainda envia com recipientMode');
  assert.equal(envio?.options?.recipientMode, 'members-only', 'modo preservado');
  assert.equal(nazu._experimentalCalls.length, 0, '!rajar NÃO usa a API experimental');
});

// ============================================================================

const totalPassed = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFailed = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log(`\n${totalFailed === 0 ? '✅' : '❌'} TOTAL: ${totalPassed} ok, ${totalFailed} falhas em ${RESULTS.length} testes`);
process.exit(totalFailed === 0 ? 0 : 1);
