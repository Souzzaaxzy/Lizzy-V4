/**
 * `!callp` — sobe uma chamada de VOZ no grupo.
 *
 * Roda o handler REAL com socket falso. A montagem da stanza de call e o envio
 * vivem na FORK (`sock.offerGroupCall` / `sock.terminateCall`) e sao testados
 * la (`tests/call-signaling.test.js`). Aqui se mede o que e' do BOT:
 *
 *   - guardas (grupo, admin, minimo de membros);
 *   - QUEM e' convidado (todos menos o bot, deduplicado);
 *   - o registro da call ativa e o `encerrar`;
 *   - as mensagens (cabecalho de canal) e o tratamento de falha.
 *
 * Uso: node tests/callp.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-callp-'));
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

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';

let groupCounter = 0;
let personCounter = 0;

function makeGroup(extra = {}) {
  groupCounter += 1;
  const jid = `1203638300000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(path.join(GRUPOS_DIR, `${jid}.json`),
    JSON.stringify({ groupName: `Grupo Callp ${groupCounter}`, ...extra }, null, 2));
  return jid;
}
function makePerson() {
  personCounter += 1;
  const n = String(personCounter).padStart(4, '0');
  return { lid: `5571${n}000000@lid`, jid: `5513${n}999999@s.whatsapp.net`, name: `5571${n}000000` };
}

/**
 * Socket falso. `offerGroupCall`/`terminateCall` simulam a API da fork:
 * registram a chamada e devolvem o formato real (`{ id, participants }`).
 */
function makeNazu({ sent, groupJid, participants, calls, failOffer }) {
  const map = {};
  for (const p of participants) { map[p.jid] = p.lid; map[p.lid] = p.jid; }
  return {
    sent,
    calls,
    sendMessage: async (jid, content) => { sent.push({ jid, content }); return { key: { id: 'SENT' } }; },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
    onWhatsApp: async (jid) => (map[jid] ? [{ jid, exists: true, lid: map[jid] }] : [{ jid, exists: false }]),
    signalRepository: { lidMapping: { getPNForLID: async (lid) => map[lid] || null } },
    groupMetadata: async () => ({
      id: groupJid, subject: 'Grupo Callp',
      participants: participants.map((p) => ({ id: p.lid, admin: p.isAdmin ? 'admin' : null, phoneNumber: p.jid }))
    }),
    // API de call da fork.
    offerGroupCall: async (gjid, jids) => {
      if (failOffer) throw new Error('server refused');
      calls.push({ kind: 'offer', groupJid: gjid, jids });
      return { id: 'CALL-' + calls.length, groupJid: gjid, stanzaId: 'S', participants: jids.length + 1 };
    },
    terminateCall: async (callId, options) => {
      calls.push({ kind: 'terminate', callId, options });
      return { id: callId };
    },
    groupParticipantsUpdate: async () => ({}),
    groupRequestParticipantsList: async () => [],
    groupRequestParticipantsUpdate: async () => ({}),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {}, sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => null, react: async () => ({})
  };
}

async function run({ groupJid, sender, text, participants, sent = [], calls = [], failOffer = false }) {
  const nazu = makeNazu({ sent, groupJid, participants, calls, failOffer });
  const info = {
    key: { remoteJid: groupJid, fromMe: false, id: `M-${Math.random().toString(36).slice(2, 10)}`, participant: sender.lid },
    message: { extendedTextMessage: { text, contextInfo: { remoteJid: groupJid, mentionedJid: [] } } },
    messageTimestamp: Math.floor(Date.now() / 1000),
    pushName: sender.name
  };
  await handleMessage(nazu, info, null, new Map(), null);
  return {
    text: sent.map((s) => s.content?.text ?? '').filter(Boolean).join('\n'),
    newsletter: sent.some((s) => s.content?.contextInfo?.forwardedNewsletterMessageInfo?.newsletterJid),
    calls,
    sent
  };
}

function setup(n = 3) {
  const groupJid = makeGroup();
  const admin = makePerson();
  const membro = makePerson();
  const outros = [];
  for (let i = 0; i < n; i++) outros.push(makePerson());
  const participants = [
    { lid: admin.lid, jid: admin.jid, isAdmin: true },
    { lid: membro.lid, jid: membro.jid, isAdmin: false },
    ...outros.map((p) => ({ lid: p.lid, jid: p.jid, isAdmin: false })),
    { lid: BOT_LID, jid: BOT_JID, name: 'Lizzy', isAdmin: true }
  ];
  return { groupJid, admin, membro, participants };
}

// ============================================================================
// 1) ESTADO
// ============================================================================

await test('o registro de calls ativas comeca vazio e e isolado por grupo', () => {
  ok(callState.obterCall('a@g.us') === null, 'grupo desconhecido nao tem call');
  callState.registrarCall('a@g.us', { callId: 'X' });
  ok(callState.obterCall('a@g.us').callId === 'X', 'registrou');
  ok(callState.obterCall('b@g.us') === null, 'outro grupo nao ve a call');
  callState.limparCall('a@g.us');
  ok(callState.obterCall('a@g.us') === null, 'limpou');
});

// ============================================================================
// 2) GUARDAS
// ============================================================================

await test('!callp so em grupo', async () => {
  const { admin, participants } = setup(2);
  const out = await run({ groupJid: admin.jid, sender: admin, text: '!callp', participants });
  ok(out.calls.length === 0, 'nao tentou subir chamada no PV');
});

await test('!callp so para admins', async () => {
  const { groupJid, membro, participants } = setup(2);
  const out = await run({ groupJid, sender: membro, text: '!callp', participants });
  includes(out.text, 'adm', 'avisa que precisa ser adm');
  ok(out.calls.length === 0, 'membro comum nao sobe chamada');
});

// ============================================================================
// 3) SUBIR A CHAMADA
// ============================================================================

await test('!callp convida todos os membros menos o bot', async () => {
  const { groupJid, admin, participants } = setup(3);
  const out = await run({ groupJid, sender: admin, text: '!callp', participants });
  ok(out.calls.length === 1, 'chamou offerGroupCall uma vez');
  const { jids, groupJid: gjid } = out.calls[0];
  ok(gjid === groupJid, 'passou o grupo certo');
  // admin + membro + 3 outros = 5 pessoas; o bot nao entra na lista de convidados.
  ok(jids.length === 5, `convidou os 5 membros humanos (veio ${jids.length})`);
  ok(!jids.some((j) => String(j).startsWith(BOT_LID.split('@')[0])), 'nao convidou a si mesmo');
  ok(new Set(jids.map((j) => String(j).split('@')[0])).size === jids.length, 'sem convidado repetido');
});

await test('!callp avisa no grupo com o cabecalho de canal', async () => {
  const { groupJid, admin, participants } = setup(3);
  const out = await run({ groupJid, sender: admin, text: '!callp', participants });
  includes(out.text, 'Chamada de voz iniciada', 'avisa que subiu');
  ok(out.newsletter, 'tem o cabecalho de newsletter (Ver canal)');
});

await test('guarda a call ativa em memoria (para o encerrar)', async () => {
  const { groupJid, admin, participants } = setup(3);
  const out = await run({ groupJid, sender: admin, text: '!callp', participants });
  const ativa = callState.obterCall(groupJid);
  ok(ativa && ativa.callId, 'registrou a call ativa');
  ok(ativa.callId.startsWith('CALL-'), `guardou o id devolvido pela lib (veio ${ativa.callId})`);
  ok(!('callpCall' in JSON.parse(fs.readFileSync(path.join(GRUPOS_DIR, `${groupJid}.json`), 'utf-8'))),
    'nao persistiu no JSON do grupo');
});

await test('nao sobe duas ao mesmo tempo', async () => {
  const { groupJid, admin, participants } = setup(3);
  await run({ groupJid, sender: admin, text: '!callp', participants });
  const out2 = await run({ groupJid, sender: admin, text: '!callp', participants });
  includes(out2.text, 'Já existe', 'avisa que ja tem uma');
  ok(out2.calls.length === 0, 'nao chamou offerGroupCall de novo');
});

await test('!callp encerrar derruba e limpa o estado', async () => {
  const { groupJid, admin, participants } = setup(3);
  await run({ groupJid, sender: admin, text: '!callp', participants });
  const out = await run({ groupJid, sender: admin, text: '!callp encerrar', participants });
  ok(out.calls.length === 1 && out.calls[0].kind === 'terminate', 'chamou terminateCall');
  includes(out.text, 'encerrada', 'avisa que encerrou');
  ok(callState.obterCall(groupJid) === null, 'limpou a call ativa');
});

await test('!callp encerrar sem call ativa nao inventa', async () => {
  const { groupJid, admin, participants } = setup(2);
  const out = await run({ groupJid, sender: admin, text: '!callp encerrar', participants });
  includes(out.text, 'Não há chamada', 'avisa que nao ha chamada');
  ok(out.calls.length === 0, 'nao chamou terminateCall');
});

await test('falha do servidor: avisa e NAO registra estado', async () => {
  const { groupJid, admin, participants } = setup(3);
  const out = await run({ groupJid, sender: admin, text: '!callp', participants, failOffer: true });
  includes(out.text, 'Não consegui subir', 'avisa a falha');
  ok(callState.obterCall(groupJid) === null, 'nao deixou call pendurada');
});

await test('grupo pequeno (so o bot + quem pediu): recusa (grupo exige 2+)', async () => {
  const groupJid = makeGroup();
  const admin = makePerson();
  const participants = [
    { lid: admin.lid, jid: admin.jid, isAdmin: true },
    { lid: BOT_LID, jid: BOT_JID, name: 'Lizzy', isAdmin: true }
  ];
  const out = await run({ groupJid, sender: admin, text: '!callp', participants });
  ok(out.calls.length === 0, 'nao chamou offerGroupCall');
  includes(out.text, 'pelo menos 2 outros membros', 'explica a regra');
});

await test('Baileys sem suporte a call: avisa em vez de quebrar', async () => {
  const { groupJid, participants } = setup(3);
  // Remetente novo E admin: `sendMessage` e' limitado a 3/5s por remetente, e o
  // comando exige adm — criar um admin proprio isola as duas coisas.
  const quem = makePerson();
  participants.unshift({ lid: quem.lid, jid: quem.jid, isAdmin: true });
  const sent = [];
  const nazu = makeNazu({ sent, groupJid, participants, calls: [] });
  delete nazu.offerGroupCall; // versao antiga da lib
  const info = {
    key: { remoteJid: groupJid, fromMe: false, id: 'M-nosupport', participant: quem.lid },
    message: { extendedTextMessage: { text: '!callp', contextInfo: { remoteJid: groupJid, mentionedJid: [] } } },
    messageTimestamp: Math.floor(Date.now() / 1000), pushName: quem.name
  };
  await handleMessage(nazu, info, null, new Map(), null);
  const texto = sent.map((s) => s.content?.text ?? '').join('\n');
  includes(texto, 'não tem o suporte', 'explica que a lib nao tem a API');
});

// ============================================================================

const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log('\n' + '='.repeat(40));
console.log(`RESULTADO: ${RESULTS.length} testes | ${totalOk} asserções ok | ${totalFail} falhas`);
console.log('='.repeat(40));
if (totalFail > 0) process.exit(1);
