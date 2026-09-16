/**
 * Testes de addblacklist / delblacklist por NÚMERO.
 *
 * A menção já funcionava; o que não funcionava era informar o número:
 *
 *     !addblacklist 5511999999999
 *
 * Em grupo, `participant.id` é o LID (ex.: 111000000000001@lid) e o número
 * real vive em `phoneNumber`. A busca era
 * `p.id === "<numero>@s.whatsapp.net"`, que nunca casa -- então `targetUsers`
 * ficava vazio e o comando respondia a mensagem de uso em vez de salvar.
 *
 * Uso: node tests/blacklist-number.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Banco temporario ANTES de importar o bot (paths.js le DATABASE_PATH no load).
const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-bl-db-'));
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
      return result.then(() => finish(name)).catch((error) => {
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

function includes(haystack, needle, label) {
  ok(typeof haystack === 'string' && haystack.includes(needle), `${label ?? needle} — esperado conter "${needle}"`);
}

function notIncludes(haystack, needle, label) {
  ok(typeof haystack === 'string' && !haystack.includes(needle), `${label ?? needle} — não deveria conter "${needle}"`);
}

// ============================================================================
// HANDLER REAL + HELPERS
// ============================================================================

const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;
if (typeof handleMessage !== 'function') throw new Error('index.js não exporta o handler');

const { findParticipantByNumber } = await import(
  new URL('../dados/src/utils/helpers.js', import.meta.url).href
);

// ============================================================================
// FIXTURES
// ============================================================================

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';

// Numero alvo em formato BR (com o 9) e o que o WhatsApp usa como LID.
const ALVO_NUMERO = '5511999999999';
const ALVO_LID = '222000000000001@lid';
const ALVO_JID = `${ALVO_NUMERO}@s.whatsapp.net`;

let groupCounter = 0;
let senderCounter = 0;

function makeGroup(extra = {}) {
  groupCounter += 1;
  const jid = `1203636000000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(
    path.join(GRUPOS_DIR, `${jid}.json`),
    JSON.stringify({ blacklist: {}, ...extra }, null, 2)
  );
  return jid;
}

/** Admin novo a cada execucao: o handler aplica throttle por sender. */
function makeAdmin() {
  senderCounter += 1;
  const n = String(senderCounter).padStart(4, '0');
  return { lid: `999${n}00000000@lid`, jid: `5599${n}000000@s.whatsapp.net` };
}

/**
 * Socket falso. `participants` reproduz a estrutura REAL de grupo: o `id` é o
 * LID e o número fica em `phoneNumber` -- exatamente o que quebrava a busca.
 */
function makeNazu({ sent, groupJid, participants }) {
  const map = {};
  for (const p of participants) {
    if (p.jid && p.lid) map[p.jid] = p.lid;
    if (p.lid && p.jid) map[p.lid] = p.jid;
  }
  return {
    sent,
    sendMessage: async (jid, content, options) => {
      sent.push({ jid, content, options });
      return { key: { id: 'SENT' } };
    },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
    onWhatsApp: async (jid) => {
      const lid = map[jid];
      return lid ? [{ jid, exists: true, lid }] : [{ jid, exists: false }];
    },
    signalRepository: { lidMapping: { getPNForLID: async (lid) => map[lid] || null } },
    groupMetadata: async () => ({
      id: groupJid,
      subject: 'Grupo Blacklist',
      participants: participants.map((p) => ({
        id: p.lid,
        lid: p.lid,
        phoneNumber: p.jid,
        admin: p.isAdmin ? 'admin' : null,
      })),
    }),
    groupParticipantsUpdate: async () => ({}),
    groupRequestParticipantsList: async () => [],
    groupRequestParticipantsUpdate: async () => ({}),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {},
    sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => 'https://example.com/pic.jpg',
    react: async () => ({}),
  };
}

/** Executa um comando no handler real, como admin. */
async function run({ groupJid, text, sender, sent = [], participants }) {
  const nazu = makeNazu({ sent, groupJid, participants });
  const info = {
    key: { remoteJid: groupJid, fromMe: false, id: `M-${Math.random().toString(36).slice(2, 10)}`, participant: sender.lid },
    message: { extendedTextMessage: { text, contextInfo: { remoteJid: groupJid } } },
    messageTimestamp: 1757900000,
    pushName: 'Admin',
  };
  await handleMessage(nazu, info, null, new Map(), null);
  return sent.map((s) => s.content?.text ?? '').filter(Boolean).join('\n');
}

function readGroup(groupJid) {
  try {
    return JSON.parse(fs.readFileSync(path.join(GRUPOS_DIR, `${groupJid}.json`), 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Grupo + participantes: o admin (recriado a cada comando) e o alvo, que existe
 * no grupo com id=LID e phoneNumber=número. Ninguém mais.
 */
function setup() {
  const groupJid = makeGroup();
  const admin = makeAdmin();
  return {
    groupJid,
    admin,
    participants: [
      { lid: admin.lid, jid: admin.jid, isAdmin: true },
      { lid: ALVO_LID, jid: ALVO_JID, isAdmin: false },
      { lid: BOT_LID, jid: BOT_JID, isAdmin: false },
    ],
  };
}

// ============================================================================
// 1) HELPER DE BUSCA (unitario)
// ============================================================================

await test('findParticipantByNumber: acha por phoneNumber quando o id é LID', async () => {
  // Estrutura real: id/lid são LID, o número está em phoneNumber.
  const participants = [
    { id: ALVO_LID, lid: ALVO_LID, phoneNumber: ALVO_JID },
    { id: '333@lid', lid: '333@lid', phoneNumber: '5511888888888@s.whatsapp.net' },
  ];
  const achado = findParticipantByNumber(participants, ALVO_NUMERO);
  ok(achado && achado.id === ALVO_LID, `achou pelo phoneNumber (${achado && achado.id})`);

  // Aceita formatacao e também o JID completo.
  ok(findParticipantByNumber(participants, '+55 11 99999-9999')?.id === ALVO_LID, 'aceita número formatado');
  ok(findParticipantByNumber(participants, ALVO_JID)?.id === ALVO_LID, 'aceita JID completo');
  ok(findParticipantByNumber(participants, ALVO_LID)?.id === ALVO_LID, 'aceita o próprio LID');
  ok(findParticipantByNumber(participants, '5511000000000') === null, 'número fora do grupo -> null');
  ok(findParticipantByNumber(participants, '') === null, 'número vazio -> null');
  ok(findParticipantByNumber(null, ALVO_NUMERO) === null, 'lista ausente -> null');
  ok(findParticipantByNumber(participants, '5511999999999:5')?.id === ALVO_LID, 'aceita sufixo :device');
});

// ============================================================================
// 2) addblacklist POR NÚMERO — O BUG
// ============================================================================

await test('!addblacklist <numero>: salva na blacklist (regressao)', async () => {
  const { groupJid, admin, participants } = setup();
  const sent = [];
  const texto = await run({ groupJid, text: `!addblacklist ${ALVO_NUMERO}`, sender: admin, sent, participants });

  // Antes: caía na mensagem de uso e não salvava nada.
  notIncludes(texto, 'Uso:', 'não cai mais na mensagem de uso');
  includes(texto, 'adicionado', 'confirma a adição');

  const data = readGroup(groupJid);
  const chaves = Object.keys(data.blacklist || {});
  ok(chaves.length === 1, `salvou exatamente 1 entrada (obtido ${chaves.length})`);
  ok(chaves[0] === ALVO_LID, `salvou pelo LID do participante (obtido ${chaves[0]})`);
  ok(data.blacklist[ALVO_LID]?.reason !== undefined, 'gravou o motivo');
  ok(typeof data.blacklist[ALVO_LID]?.timestamp === 'number', 'gravou o timestamp');
});

await test('!addblacklist <numero> com motivo: separa número e motivo', async () => {
  const { groupJid, admin, participants } = setup();
  const sent = [];
  await run({
    groupJid,
    text: `!addblacklist ${ALVO_NUMERO} flood`,
    sender: admin,
    sent,
    participants,
  });
  const data = readGroup(groupJid);
  const entrada = data.blacklist[ALVO_LID];
  ok(entrada, 'salvou a entrada');
  includes(String(entrada?.reason || ''), 'flood', 'motivo registrado');
});

await test('!addblacklist <numero> de quem NÃO está no grupo: salva o número', async () => {
  const { groupJid, admin, participants } = setup();
  const sent = [];
  const fora = '5511777777777';
  const texto = await run({ groupJid, text: `!addblacklist ${fora}`, sender: admin, sent, participants });

  notIncludes(texto, 'Uso:', 'não cai na mensagem de uso');
  const data = readGroup(groupJid);
  const chaves = Object.keys(data.blacklist || {});
  ok(chaves.includes(`${fora}@s.whatsapp.net`), `salvou o JID do número (obtido ${chaves.join(', ')})`);
});

await test('!addblacklist por MENÇÃO continua funcionando (regressao)', async () => {
  const { groupJid, admin, participants } = setup();
  const sent = [];
  const nazu = makeNazu({ sent, groupJid, participants });
  const info = {
    key: { remoteJid: groupJid, fromMe: false, id: 'M-MEN', participant: admin.lid },
    message: {
      extendedTextMessage: {
        text: '!addblacklist',
        contextInfo: { remoteJid: groupJid, mentionedJid: [ALVO_LID], participant: ALVO_LID },
      },
    },
    messageTimestamp: 1757900000,
    pushName: 'Admin',
  };
  await handleMessage(nazu, info, null, new Map(), null);

  const data = readGroup(groupJid);
  const chaves = Object.keys(data.blacklist || {});
  ok(chaves.length === 1, `menção salvou 1 entrada (obtido ${chaves.length})`);
  ok(chaves[0] === ALVO_LID, `menção salvou o LID (obtido ${chaves[0]})`);
});

// ============================================================================
// 3) delblacklist POR NÚMERO
// ============================================================================

await test('!delblacklist <numero>: remove quem foi salvo pelo LID (regressao)', async () => {
  // O evento precisa estar salvo pelo LID do participante (é o que o
  // addblacklist grava), e o comando roda num grupo NOVO: o metadata do grupo é
  // cacheado por 10s, então reusar o mesmo grupo devolveria o admin anterior.
  const { groupJid, admin, participants } = setup();
  await run({ groupJid, text: `!addblacklist ${ALVO_NUMERO}`, sender: admin, sent: [], participants });
  ok(Object.keys(readGroup(groupJid).blacklist).length === 1, 'adicionou antes de remover');
  ok(Object.keys(readGroup(groupJid).blacklist)[0] === ALVO_LID, 'salvou pelo LID');

  // Grupo novo só para exercitar o del (mesmo estado de blacklist copiado).
  const grupoDel = makeGroup({ blacklist: readGroup(groupJid).blacklist });
  const admin2 = makeAdmin();
  const participants2 = [
    { lid: admin2.lid, jid: admin2.jid, isAdmin: true },
    { lid: ALVO_LID, jid: ALVO_JID, isAdmin: false },
    { lid: BOT_LID, jid: BOT_JID, isAdmin: false },
  ];
  const sent2 = [];
  const texto = await run({ groupJid: grupoDel, text: `!delblacklist ${ALVO_NUMERO}`, sender: admin2, sent: sent2, participants: participants2 });

  includes(texto, 'removido', 'confirma a remoção');
  notIncludes(texto, 'não estava', 'não conta a mesma pessoa como não encontrada');
  ok(Object.keys(readGroup(grupoDel).blacklist).length === 0, 'blacklist ficou vazia');
});

await test('!delblacklist <numero>: remove entrada salva como JID do número', async () => {
  // Caso em que a pessoa não estava no grupo quando foi adicionada.
  const grupo = makeGroup({ blacklist: { [`${ALVO_NUMERO}@s.whatsapp.net`]: { reason: 'x', timestamp: Date.now() } } });
  const admin = makeAdmin();
  const participants = [
    { lid: admin.lid, jid: admin.jid, isAdmin: true },
    { lid: BOT_LID, jid: BOT_JID, isAdmin: false },
  ];
  const sent = [];
  const texto = await run({ groupJid: grupo, text: `!delblacklist ${ALVO_NUMERO}`, sender: admin, sent, participants });

  includes(texto, 'removido', 'removeu a entrada por JID');
  ok(Object.keys(readGroup(grupo).blacklist).length === 0, 'blacklist vazia');
});

await test('!delblacklist por MENÇÃO continua funcionando (regressao)', async () => {
  const grupo = makeGroup({ blacklist: { [ALVO_LID]: { reason: 'x', timestamp: Date.now() } } });
  const admin = makeAdmin();
  const participants = [
    { lid: admin.lid, jid: admin.jid, isAdmin: true },
    { lid: ALVO_LID, jid: ALVO_JID, isAdmin: false },
    { lid: BOT_LID, jid: BOT_JID, isAdmin: false },
  ];
  const sent = [];
  const nazu = makeNazu({ sent, groupJid: grupo, participants });
  const info = {
    key: { remoteJid: grupo, fromMe: false, id: 'M-DEL', participant: admin.lid },
    message: {
      extendedTextMessage: {
        text: '!delblacklist',
        contextInfo: { remoteJid: grupo, mentionedJid: [ALVO_LID], participant: ALVO_LID },
      },
    },
    messageTimestamp: 1757900000,
    pushName: 'Admin',
  };
  await handleMessage(nazu, info, null, new Map(), null);

  ok(Object.keys(readGroup(grupo).blacklist).length === 0, 'menção removeu a entrada');
});


await test('!delblacklist <numero>: limpa LID e JID da mesma pessoa de uma vez', async () => {
  // Se a pessoa foi salva duas vezes (LID quando estava no grupo + JID pelo
  // número), o del por número precisa limpar as duas e contar 1 remoção.
  const grupo = makeGroup({
    blacklist: {
      [ALVO_LID]: { reason: 'a', timestamp: Date.now() },
      [`${ALVO_NUMERO}@s.whatsapp.net`]: { reason: 'b', timestamp: Date.now() },
    },
  });
  const admin = makeAdmin();
  const participants = [
    { lid: admin.lid, jid: admin.jid, isAdmin: true },
    { lid: ALVO_LID, jid: ALVO_JID, isAdmin: false },
    { lid: BOT_LID, jid: BOT_JID, isAdmin: false },
  ];
  const sent = [];
  const texto = await run({ groupJid: grupo, text: `!delblacklist ${ALVO_NUMERO}`, sender: admin, sent, participants });

  includes(texto, 'removido', 'confirmou a remoção');
  notIncludes(texto, 'não estava', 'não sobrou candidato não encontrado');
  ok(Object.keys(readGroup(grupo).blacklist).length === 0, 'limpou as duas entradas');
});

// ============================================================================
// 4) !listblacklist e guardas
// ============================================================================

await test('!listblacklist: lista o que foi adicionado por número', async () => {
  const { groupJid, admin, participants } = setup();
  await run({ groupJid, text: `!addblacklist ${ALVO_NUMERO} motivo teste`, sender: admin, sent: [], participants });

  const grupoList = makeGroup({ blacklist: readGroup(groupJid).blacklist });
  const admin2 = makeAdmin();
  const participants2 = [
    { lid: admin2.lid, jid: admin2.jid, isAdmin: true },
    { lid: ALVO_LID, jid: ALVO_JID, isAdmin: false },
    { lid: BOT_LID, jid: BOT_JID, isAdmin: false },
  ];
  const sent = [];
  const texto = await run({ groupJid: grupoList, text: '!listblacklist', sender: admin2, sent, participants: participants2 });

  includes(texto, 'motivo teste', 'mostra o motivo');
  notIncludes(texto, 'está vazia', 'lista não está vazia');
  notIncludes(texto, 'undefined', 'sem undefined');
});

await test('!addblacklist sem número nem menção: mantém a mensagem de uso', async () => {
  const { groupJid, admin, participants } = setup();
  const sent = [];
  const texto = await run({ groupJid, text: '!addblacklist', sender: admin, sent, participants });
  includes(texto, 'Uso:', 'explica o uso quando não informa nada');
  ok(Object.keys(readGroup(groupJid).blacklist || {}).length === 0, 'não salvou nada');
});

await test('!addblacklist: número curto/inválido não é tratado como telefone', async () => {
  const { groupJid, admin, participants } = setup();
  const sent = [];
  const texto = await run({ groupJid, text: '!addblacklist 123', sender: admin, sent, participants });
  includes(texto, 'Uso:', 'número curto cai na mensagem de uso');
  ok(Object.keys(readGroup(groupJid).blacklist || {}).length === 0, 'não salvou nada');
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