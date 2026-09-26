/**
 * `!musicap` — toca um áudio NA CALL do grupo.
 *
 * Roda o handler REAL com socket falso. A pilha de mídia (WASM/relay/ffmpeg)
 * tem testes próprios no pacote `lizzy-call`; aqui se mede o que é do BOT:
 *
 *   - guardas (grupo, admin, exige `!callp` antes);
 *   - a mensagem certa quando a mídia ainda não está pronta;
 *   - o download do áudio respondido e o caminho do link direto;
 *   - `!musicap parar`.
 *
 * O módulo de mídia é substituído por um duble, para o teste não depender de
 * WASM nem de rede — o contrato entre bot e pacote é o que se verifica.
 *
 * Uso: node tests/musicap.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-musicap-'));
process.env.DATABASE_PATH = TMP_DB;
const GRUPOS_DIR = path.join(TMP_DB, 'grupos');
fs.mkdirSync(GRUPOS_DIR, { recursive: true });

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
function includes(hay, needle, label) {
  ok(typeof hay === 'string' && hay.includes(needle),
    `${label ?? needle} \u2014 esperado conter "${needle}"`);
}

// ============================================================================

const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;
if (typeof handleMessage !== 'function') throw new Error('index.js não exporta o handler');

const callState = await import(new URL('../dados/src/funcs/utils/callOffer.js', import.meta.url).href);
const callMedia = await import(new URL('../dados/src/funcs/utils/callMedia.js', import.meta.url).href);

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';

let groupCounter = 0;
let personCounter = 0;

function makeGroup(extra = {}) {
  groupCounter += 1;
  const jid = `1203638400000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(path.join(GRUPOS_DIR, `${jid}.json`),
    JSON.stringify({ groupName: `Grupo Musicap ${groupCounter}`, ...extra }, null, 2));
  return jid;
}
function makePerson() {
  personCounter += 1;
  const n = String(personCounter).padStart(4, '0');
  return { lid: `5571${n}000000@lid`, jid: `5513${n}999999@s.whatsapp.net`, name: `5571${n}000000` };
}

/**
 * Duble da pilha de mídia: registra as chamadas e permite forçar o estágio.
 * Assim o teste mede o CONTRATO do bot sem depender de WASM/rede.
 */
function instalarDubleMidia({ estagio = 'pronta', tocarResult = { ok: true } } = {}) {
  const chamadas = [];
  callMedia.__setDuble({
    estagio: () => estagio,
    tocar: async (grupo, arquivo) => {
      chamadas.push({ tipo: 'tocar', grupo, arquivo });
      return { ...tocarResult, arquivo };
    },
    parar: (grupo) => { chamadas.push({ tipo: 'parar', grupo }); return { ok: true }; }
  });
  return chamadas;
}

function makeNazu({ sent, groupJid, participants }) {
  const map = {};
  for (const p of participants) { map[p.jid] = p.lid; map[p.lid] = p.jid; }
  return {
    sent,
    sendMessage: async (jid, content) => { sent.push({ jid, content }); return { key: { id: 'SENT' } }; },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
    onWhatsApp: async (jid) => (map[jid] ? [{ jid, exists: true, lid: map[jid] }] : [{ jid, exists: false }]),
    signalRepository: { lidMapping: { getPNForLID: async (lid) => map[lid] || null } },
    groupMetadata: async () => ({
      id: groupJid, subject: 'Grupo Musicap',
      participants: participants.map((p) => ({ id: p.lid, admin: p.isAdmin ? 'admin' : null, phoneNumber: p.jid }))
    }),
    offerGroupCall: async () => ({ id: 'CALL-1', groupJid, stanzaId: 'S', participants: 3 }),
    terminateCall: async () => ({ id: 'CALL-1' }),
    groupParticipantsUpdate: async () => ({}),
    groupRequestParticipantsList: async () => [],
    groupRequestParticipantsUpdate: async () => ({}),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {}, sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => null, react: async () => ({})
  };
}

/** Executa uma mensagem; `citado` simula a mensagem respondida. */
async function run({ groupJid, sender, text, participants, citado = null, sent = [] }) {
  const nazu = makeNazu({ sent, groupJid, participants });
  const contextInfo = citado
    ? { remoteJid: groupJid, mentionedJid: [], quotedMessage: citado.message, participant: citado.participant }
    : { remoteJid: groupJid, mentionedJid: [] };
  const info = {
    key: { remoteJid: groupJid, fromMe: false, id: `M-${Math.random().toString(36).slice(2, 10)}`, participant: sender.lid },
    message: { extendedTextMessage: { text, contextInfo } },
    messageTimestamp: Math.floor(Date.now() / 1000),
    pushName: sender.name
  };
  await handleMessage(nazu, info, null, new Map(), null);
  return { text: sent.map((s) => s.content?.text ?? '').filter(Boolean).join('\n'), sent };
}

function setup(n = 3) {
  const groupJid = makeGroup();
  const admin = makePerson();
  const outros = [];
  for (let i = 0; i < n; i++) outros.push(makePerson());
  const participants = [
    { lid: admin.lid, jid: admin.jid, isAdmin: true },
    ...outros.map((p) => ({ lid: p.lid, jid: p.jid, isAdmin: false })),
    { lid: BOT_LID, jid: BOT_JID, name: 'Lizzy', isAdmin: true }
  ];
  return { groupJid, admin, participants };
}

// ============================================================================
// 1) GUARDAS
// ============================================================================

await test('!musicap só em grupo', async () => {
  const { admin, participants } = setup(2);
  const out = await run({ groupJid: admin.jid, sender: admin, text: '!musicap', participants });
  includes(out.text, 'só pode ser usado em grupo', 'recusa no PV');
});

await test('!musicap só para admins', async () => {
  const { groupJid, participants } = setup(2);
  const membro = makePerson();
  participants.push({ lid: membro.lid, jid: membro.jid, isAdmin: false });
  const out = await run({ groupJid, sender: membro, text: '!musicap', participants });
  includes(out.text, 'adm', 'exige adm');
});

await test('!musicap sem chamada ativa manda usar o !callp', async () => {
  const { groupJid, admin, participants } = setup(2);
  const out = await run({ groupJid, sender: admin, text: '!musicap', participants });
  includes(out.text, 'Não há chamada ativa', 'avisa');
  includes(out.text, '!callp', 'diz o que fazer');
});

// ============================================================================
// 2) MÍDIA INDISPONÍVEL / NÃO PRONTA
// ============================================================================

await test('com a mídia indisponível, avisa sem derrubar a chamada', async () => {
  const { groupJid, admin, participants } = setup(2);
  callState.registrarCall(groupJid, { callId: 'CALL-X', callCreator: BOT_LID });
  instalarDubleMidia({ estagio: 'indisponivel' });
  const out = await run({ groupJid, sender: admin, text: '!musicap', participants });
  includes(out.text, 'não está disponível', 'avisa');
  includes(out.text, 'continua aberta', 'tranquiliza sobre a chamada');
  callState.limparCall(groupJid);
});

await test('com a chamada ainda não pronta, explica o estágio', async () => {
  const { groupJid, admin, participants } = setup(2);
  callState.registrarCall(groupJid, { callId: 'CALL-Y', callCreator: BOT_LID });
  instalarDubleMidia({ estagio: 'aguardando_roster' });
  const out = await run({ groupJid, sender: admin, text: '!musicap', participants });
  includes(out.text, 'ainda não está pronta', 'avisa');
  includes(out.text, 'aguardando_roster', 'mostra o estágio');
  callState.limparCall(groupJid);
});

// ============================================================================
// 3) TOCAR
// ============================================================================

await test('!musicap com link direto toca o áudio', async () => {
  const { groupJid, admin, participants } = setup(2);
  callState.registrarCall(groupJid, { callId: 'CALL-Z', callCreator: BOT_LID });
  const chamadas = instalarDubleMidia({ estagio: 'pronta' });
  const out = await run({
    groupJid, sender: admin, participants,
    text: '!musicap https://exemplo.test/musica.mp3'
  });
  const tocou = chamadas.find((c) => c.tipo === 'tocar');
  ok(Boolean(tocou), 'chamou a mídia para tocar');
  ok(tocou.arquivo === 'https://exemplo.test/musica.mp3', `passou o link (${tocou?.arquivo})`);
  includes(out.text, 'Tocando na chamada', 'confirma');
  callState.limparCall(groupJid);
});

await test('!musicap respondendo um áudio baixa e toca', async () => {
  const { groupJid, admin, participants } = setup(2);
  callState.registrarCall(groupJid, { callId: 'CALL-W', callCreator: BOT_LID });
  const chamadas = instalarDubleMidia({ estagio: 'pronta' });
  const out = await run({
    groupJid, sender: admin, participants,
    text: '!musicap',
    citado: {
      participant: admin.lid,
      message: { audioMessage: { mimetype: 'audio/ogg; codecs=opus', ptt: true, url: 'https://mmg.test/x', mediaKey: new Uint8Array(32), directPath: '/x' } }
    }
  });
  // Sem rede, o download falha — o que importa é que ele TENTA e avisa.
  const tentou = chamadas.some((c) => c.tipo === 'tocar') || /baixar/i.test(out.text);
  ok(tentou, 'tentou baixar o áudio respondido');
  callState.limparCall(groupJid);
});

await test('respondendo algo sem mídia, avisa o que fazer', async () => {
  const { groupJid, admin, participants } = setup(2);
  callState.registrarCall(groupJid, { callId: 'CALL-V', callCreator: BOT_LID });
  instalarDubleMidia({ estagio: 'pronta' });
  const out = await run({
    groupJid, sender: admin, participants,
    text: '!musicap',
    citado: { participant: admin.lid, message: { conversation: 'oi' } }
  });
  includes(out.text, 'não tem mídia', 'explica');
  callState.limparCall(groupJid);
});

await test('!musicap parar interrompe sem derrubar a chamada', async () => {
  const { groupJid, admin, participants } = setup(2);
  callState.registrarCall(groupJid, { callId: 'CALL-U', callCreator: BOT_LID });
  const chamadas = instalarDubleMidia({ estagio: 'pronta' });
  const out = await run({ groupJid, sender: admin, text: '!musicap parar', participants });
  ok(chamadas.some((c) => c.tipo === 'parar'), 'chamou parar');
  includes(out.text, 'Áudio parado', 'confirma');
  includes(out.text, 'continua', 'diz que a chamada segue');
  callState.limparCall(groupJid);
});

await test('falha ao tocar: avisa e não mente', async () => {
  const { groupJid, admin, participants } = setup(2);
  callState.registrarCall(groupJid, { callId: 'CALL-T', callCreator: BOT_LID });
  instalarDubleMidia({ estagio: 'pronta', tocarResult: { ok: false, motivo: 'ja_tocando' } });
  const out = await run({
    groupJid, sender: admin, participants,
    text: '!musicap https://exemplo.test/x.mp3'
  });
  includes(out.text, 'Não consegui tocar', 'avisa a falha');
  includes(out.text, 'Já tem um áudio tocando', 'explica o motivo');
  callState.limparCall(groupJid);
});

// ============================================================================

callMedia.__setDuble(null);

const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log('\n' + '='.repeat(40));
console.log(`RESULTADO: ${RESULTS.length} testes | ${totalOk} asserções ok | ${totalFail} falhas`);
console.log('='.repeat(40));
if (totalFail > 0) process.exit(1);
