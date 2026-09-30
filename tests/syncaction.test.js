/**
 * `!syncaction` — MEDIDOR das acoes de app-state que a fork nao expunha.
 *
 * Nao e um teste de feature: o comando nao promete que a acao funciona, ele
 * MEDE o que o servidor respondeu. Entao o teste roda o handler REAL com um
 * `chatModify` instrumentado e confere:
 *
 *   - guardas (grupo, admin);
 *   - ajuda quando falta argumento / acao desconhecida / estado invalido;
 *   - o MOD montado (`{ [campo]: bool }`) chega certo no socket;
 *   - sucesso -> reporta "aceita"; erro -> reporta "rejeitou" com a mensagem.
 *
 * O que o teste NAO faz: afirmar que o WhatsApp honra a acao. Isso so da para
 * medir no aparelho — e e justamente o que o comando existe para descobrir.
 *
 * Uso: node tests/syncaction.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-syncaction-'));
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
    `${label ?? needle} — esperado conter "${needle}"`);
}

// ============================================================================

const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;
if (typeof handleMessage !== 'function') throw new Error('index.js não exporta o handler');

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';

let groupCounter = 0;
let senderCounter = 0;

function makeGroup() {
  groupCounter += 1;
  const jid = `1203638600000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(path.join(GRUPOS_DIR, `${jid}.json`),
    JSON.stringify({ groupName: `Grupo Sync ${groupCounter}` }, null, 2));
  return jid;
}

function makeNazu({ sent, groupJid, chatModify, senderLid, isAdmin }) {
  return {
    sent,
    sendMessage: async (jid, content) => { sent.push({ jid, content }); return { key: { id: 'SENT' } }; },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
    onWhatsApp: async (jid) => [{ jid, exists: true }],
    signalRepository: { lidMapping: { getPNForLID: async () => null } },
    chatModify,
    groupMetadata: async () => ({
      id: groupJid, subject: 'Grupo Sync',
      participants: [
        { id: BOT_LID, admin: 'admin', phoneNumber: BOT_JID },
        { id: senderLid, admin: isAdmin ? 'admin' : null, phoneNumber: '5571000000000@s.whatsapp.net' }
      ]
    }),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {}, sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => null, react: async () => ({})
  };
}

async function run({ groupJid, text, chatModify, isAdmin = true, sent = [] }) {
  // Remetente único por chamada: o bot tem um throttle por usuário (3 comandos
  // por 5s) e reusar o mesmo id faria os testes caírem no antiflood.
  senderCounter += 1;
  const senderLid = `5571${String(senderCounter).padStart(4, '0')}000000@lid`;
  const nazu = makeNazu({ sent, groupJid, chatModify, senderLid, isAdmin });
  const info = {
    key: { remoteJid: groupJid, fromMe: false, id: `M-${Math.random().toString(36).slice(2, 10)}`, participant: senderLid },
    message: { extendedTextMessage: { text, contextInfo: { remoteJid: groupJid, mentionedJid: [] } } },
    messageTimestamp: Math.floor(Date.now() / 1000),
    pushName: 'Tester'
  };
  await handleMessage(nazu, info, null, new Map(), null);
  return { sent, text: sent.map((s) => s.content?.text ?? '').filter(Boolean).join('\n') };
}

// ============================================================================
// 1) GUARDAS E AJUDA
// ============================================================================

await test('!syncaction sem argumento: mostra a ajuda com as ações', async () => {
  const groupJid = makeGroup();
  const out = await run({ groupJid, text: '!syncaction', chatModify: async () => ({}) });
  includes(out.text, 'syncaction', 'tem título');
  includes(out.text, 'travarmsg', 'lista travarmsg');
  includes(out.text, 'historico', 'lista historico');
  includes(out.text, 'pastabiz', 'lista pastabiz');
});

await test('!syncaction com ação desconhecida: cai na ajuda', async () => {
  const groupJid = makeGroup();
  const out = await run({ groupJid, text: '!syncaction naoexiste on', chatModify: async () => ({}) });
  includes(out.text, 'syncaction', 'mostra a ajuda');
});

await test('!syncaction sem on/off: pede o estado', async () => {
  const groupJid = makeGroup();
  const out = await run({ groupJid, text: '!syncaction historico', chatModify: async () => ({}) });
  includes(out.text, 'on', 'pede on');
  includes(out.text, 'off', 'pede off');
});

await test('!syncaction no privado: recusa', async () => {
  const pessoa = `5571999999999@s.whatsapp.net`;
  const out = await run({ groupJid: pessoa, text: '!syncaction historico on', chatModify: async () => ({}) });
  includes(out.text, 'só funciona em grupos', 'recusa no PV');
});

await test('!syncaction por não-admin: recusa', async () => {
  const groupJid = makeGroup();
  const out = await run({ groupJid, text: '!syncaction historico on', chatModify: async () => ({}), isAdmin: false });
  includes(out.text, 'admin', 'exige admin');
});

// ============================================================================
// 2) O MOD CHEGA CERTO NO SOCKET
// ============================================================================

await test('historico on envia { groupHistoryToggle: true }', async () => {
  const groupJid = makeGroup();
  const chamadas = [];
  const chatModify = async (mod, jid) => { chamadas.push({ mod, jid }); return {}; };
  await run({ groupJid, text: '!syncaction historico on', chatModify });

  ok(chamadas.length === 1, 'chamou chatModify uma vez');
  ok(chamadas[0]?.mod?.groupHistoryToggle === true, 'mod.groupHistoryToggle = true');
  ok(chamadas[0]?.jid === groupJid, 'no grupo certo');
});

await test('historico off envia { groupHistoryToggle: false }', async () => {
  const groupJid = makeGroup();
  const chamadas = [];
  const chatModify = async (mod, jid) => { chamadas.push({ mod, jid }); return {}; };
  await run({ groupJid, text: '!syncaction historico off', chatModify });
  ok(chamadas[0]?.mod?.groupHistoryToggle === false, 'mod.groupHistoryToggle = false');
});

await test('cada apelido mapeia para o campo certo da fork', async () => {
  const esperado = {
    travarmsg: 'bubbleLockMessage',
    sublista: 'labelSublist',
    allowlist: 'sharedDeviceAllowlist',
    ocultarcontato: 'contactManagerMetadata',
    pastabiz: 'businessFolderActivation',
    historico: 'groupHistoryToggle'
  };
  for (const [apelido, campo] of Object.entries(esperado)) {
    const groupJid = makeGroup();
    const chamadas = [];
    const chatModify = async (mod) => { chamadas.push(mod); return {}; };
    await run({ groupJid, text: `!syncaction ${apelido} on`, chatModify });
    ok(chamadas[0] && campo in chamadas[0], `${apelido} -> ${campo}`);
  }
});

// ============================================================================
// 3) RELATO DO RESULTADO
// ============================================================================

await test('servidor OK: reporta "aceita"', async () => {
  const groupJid = makeGroup();
  const out = await run({ groupJid, text: '!syncaction historico on', chatModify: async () => ({ ok: true }) });
  includes(out.text, 'aceita', 'reporta aceitação');
});

await test('servidor recusa: reporta "rejeitou" com a mensagem', async () => {
  const groupJid = makeGroup();
  const erro = new Error('invalid index for app state');
  erro.output = { statusCode: 400 };
  const out = await run({ groupJid, text: '!syncaction historico on', chatModify: async () => { throw erro; } });
  includes(out.text, 'rejeitou', 'reporta rejeição');
  includes(out.text, 'invalid index', 'mostra a mensagem do servidor');
  includes(out.text, '400', 'mostra o status');
});

await test('socket sem chatModify: avisa em vez de estourar', async () => {
  const groupJid = makeGroup();
  const out = await run({ groupJid, text: '!syncaction historico on', chatModify: undefined });
  includes(out.text, 'chatModify', 'explica o que faltou');
});

// ============================================================================

const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log('\n' + '='.repeat(40));
console.log(`RESULTADO: ${RESULTS.length} testes | ${totalOk} asserções ok | ${totalFail} falhas`);
console.log('='.repeat(40));
process.exit(totalFail > 0 ? 1 : 0);
