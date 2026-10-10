/**
 * Testes dos vetores 3, 4, 5 e 6 (docs/mensagens-nao-decifraveis.md).
 * Ver o `!testeanti`. Módulo puro + handler real. Sem ban (só "funcionou ☝🏻").
 *
 * Uso: node tests/invisible-vectors.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-vec-db-'));
process.env.DATABASE_PATH = TMP_DB;
fs.mkdirSync(path.join(TMP_DB, 'grupos'), { recursive: true });
fs.mkdirSync(path.join(TMP_DB, 'dono'), { recursive: true });
const TESTE_ANTI_FILE = path.join(TMP_DB, 'dono', 'testeAnti.json');

const RESULTS = [];
let CURRENT = null;
function test(name, fn) {
  CURRENT = { name, passed: 0, failed: 0, errors: [] }; RESULTS.push(CURRENT);
  try { const r = fn(); if (r && typeof r.then === 'function') return r.then(finish).catch((e) => { CURRENT.failed++; CURRENT.errors.push(`EXCEÇÃO: ${e?.stack || e}`); finish(); }); finish(); }
  catch (e) { CURRENT.failed++; CURRENT.errors.push(`EXCEÇÃO: ${e?.stack || e}`); finish(); }
  return Promise.resolve();
}
function finish() { console.log(`${CURRENT.failed === 0 ? '✅' : '❌'} ${CURRENT.name} (${CURRENT.passed} ok, ${CURRENT.failed} falhas)`); for (const e of CURRENT.errors) console.log(`     ${e.split('\n')[0]}`); }
function ok(c, m) { if (c) CURRENT.passed++; else { CURRENT.failed++; CURRENT.errors.push(`ASSERT FALHOU: ${m}`); } }
function eq(a, b, m) { ok(a === b, `${m} — esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`); }

const V = await import(new URL('../dados/src/utils/invisibleVectors.js', import.meta.url).href);

// ============================ MÓDULO ======================================
test('#5 edição SEM secret -> suspeito; com secret / reação -> ok (sem falso positivo)', () => {
  eq(V.analisarAddonSemSecret({ message: { protocolMessage: { editedMessage: { extendedTextMessage: { text: 'x' } } } } }).suspeito, true, 'edicao sem secret');
  eq(V.analisarAddonSemSecret({ message: { protocolMessage: { editedMessage: { extendedTextMessage: { text: 'x' } } } }, messageContextInfo: { messageSecret: new Uint8Array([1, 2]) } }).suspeito, false, 'com secret no envelope');
  // MEDIDO na fork: reactionMessage/encReactionMessage/pollUpdateMessage NAO tem
  // messageSecret POR DESIGN -> NUNCA podem ser marcados (falso positivo).
  eq(V.analisarAddonSemSecret({ message: { reactionMessage: { text: '❤' } } }).suspeito, false, 'reacao nao marca');
  eq(V.analisarAddonSemSecret({ message: { pollUpdateMessage: {} } }).suspeito, false, 'voto nao marca');
  eq(V.analisarAddonSemSecret({ message: { conversation: 'oi' } }).suspeito, false, 'nao-addon');
});
test('#6 status + selective -> suspeito; status normal -> ok', () => {
  eq(V.analisarSenderKeyStatus({ message: { groupStatusMessageV2: { message: { conversation: 'x' } } }, selectiveDistribution: { kind: 's' } }).suspeito, true, 'status selective');
  eq(V.analisarSenderKeyStatus({ message: { groupStatusMessageV2: { message: { conversation: 'x' } } } }).suspeito, false, 'status normal');
  eq(V.analisarSenderKeyStatus({ message: { conversation: 'x' }, selectiveDistribution: { kind: 's' } }).suspeito, false, 'nao-status');
});
test('#4 retry alto -> suspeito; retry normal -> ok', () => {
  eq(V.analisarSaltoChain({ retryCount: 5 }, new Map(), 'a').suspeito, true, 'retry 5');
  eq(V.analisarSaltoChain({ retryCount: 1 }, new Map(), 'a').suspeito, false, 'retry 1');
  const est = new Map();
  eq(V.analisarSaltoChain({ messageChainIndex: 10 }, est, 'a').suspeito, false, 'primeiro contador');
  eq(V.analisarSaltoChain({ messageChainIndex: 11 }, est, 'a').suspeito, false, 'contador em sequencia');
  eq(V.analisarSaltoChain({ messageChainIndex: 200 }, est, 'a').suspeito, true, 'salto grande');
});
test('#3 mesmo ID conteúdo diferente -> suspeito', () => {
  const est = new Map();
  eq(V.analisarForja(est, { key: { id: 'M1' }, message: { conversation: 'oi' } }).suspeito, false, '1a vez');
  eq(V.analisarForja(est, { key: { id: 'M1' }, message: { conversation: 'oi' } }).suspeito, false, 'mesmo conteudo');
  eq(V.analisarForja(est, { key: { id: 'M1' }, message: { conversation: 'forjado' } }).suspeito, true, 'conteudo diferente');
});

// ============================ HANDLER =====================================
const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;
const BOT_LID = '111111111111111@lid';
const BOT_JID = '5599999999999@s.whatsapp.net';
let gc = 0, ac = 0;
function nextAuthor() { ac++; return { lid: `99${String(ac).padStart(6, '0')}888@lid`, jid: `5599${String(ac).padStart(6, '0')}777@s.whatsapp.net` }; }
function makeGroup(antiinvi = false) { gc++; const jid = `1203639100000000${String(gc).padStart(3, '0')}@g.us`; fs.writeFileSync(path.join(TMP_DB, 'grupos', `${jid}.json`), JSON.stringify({ groupName: 'G', antiinvi })); return jid; }
function setEnabled(groupJid, on = true) { const cur = fs.existsSync(TESTE_ANTI_FILE) ? JSON.parse(fs.readFileSync(TESTE_ANTI_FILE, 'utf-8')) : {}; if (on) cur[groupJid] = { enabled: true }; else delete cur[groupJid]; fs.writeFileSync(TESTE_ANTI_FILE, JSON.stringify(cur, null, 2)); }
function nazu(sent) { return {
  sendMessage: async (jid, content) => { sent.push({ content }); return { key: { id: `S-${sent.length}` } }; },
  relayMessage: async () => ({}),
  user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
  onWhatsApp: async (jid) => [{ jid, exists: true }],
  signalRepository: { lidMapping: { getPNForLID: async () => null } },
  groupMetadata: async (g) => ({ id: g, subject: 'G', participants: [{ id: BOT_LID, admin: 'admin', phoneNumber: BOT_JID }] }),
  groupParticipantsUpdate: async () => [], groupSettingUpdate: async () => ({}),
  groupRequestParticipantsList: async () => [], groupRequestParticipantsUpdate: async () => ({}),
  ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
  readMessages: async () => {}, sendPresenceUpdate: async () => {}, profilePictureUrl: async () => 'x', react: async () => ({}),
}; }
async function enviar(message, opts = {}) {
  const sent = []; const a = opts.author || nextAuthor();
  const nazuMock = nazu(sent);
  const info = { key: { remoteJid: opts.groupJid, fromMe: false, id: opts.id || `V-${gc}-${Math.random().toString(36).slice(2, 7)}`, participant: a.lid, participantAlt: a.jid }, ...(message === undefined ? {} : { message }), ...(opts.extra || {}), messageTimestamp: 1, pushName: 'A' };
  await handleMessage(nazuMock, info, null, new Map(), null);
  await new Promise((r) => setTimeout(r, 40));
  return { sent, avisou: sent.some((s) => s.content?.text === 'funcionou ☝🏻') };
}

await test('handler: add-on sem secret 2x -> "funcionou ☝🏻"', async () => {
  const g = makeGroup(); setEnabled(g, true); const a = nextAuthor();
  const ed = { protocolMessage: { editedMessage: { extendedTextMessage: { text: 'x' } } } };
  await enviar(ed, { groupJid: g, author: a });
  const r = await enviar(ed, { groupJid: g, author: a });
  ok(r.avisou, 'avisou');
});
await test('handler: status selective 2x -> "funcionou ☝🏻"', async () => {
  const g = makeGroup(); setEnabled(g, true); const a = nextAuthor();
  const st = { groupStatusMessageV2: { message: { conversation: 'x' } } };
  await enviar(st, { groupJid: g, author: a, extra: { selectiveDistribution: { kind: 's' } } });
  const r = await enviar(st, { groupJid: g, author: a, extra: { selectiveDistribution: { kind: 's' } } });
  ok(r.avisou, 'avisou');
});
await test('handler: retry alto 2x -> "funcionou ☝🏻"', async () => {
  const g = makeGroup(); setEnabled(g, true); const a = nextAuthor();
  await enviar({ conversation: 'oi' }, { groupJid: g, author: a, extra: { retryCount: 5 } });
  const r = await enviar({ conversation: 'oi' }, { groupJid: g, author: a, extra: { retryCount: 5 } });
  ok(r.avisou, 'avisou');
});
await test('handler: mesmo ID conteúdo diferente -> "funcionou ☝🏻"', async () => {
  const g = makeGroup(); setEnabled(g, true); const a = nextAuthor();
  // A forja se repete sob o mesmo ID: cada novo conteudo diverge do anterior.
  let avisou = false;
  for (const txt of ['a', 'b', 'c']) {
    const r = await enviar({ conversation: txt }, { groupJid: g, author: a, id: 'FIX1' });
    if (r.avisou) avisou = true;
  }
  ok(avisou, 'avisou');
});
await test('handler: mensagem normal NÃO avisa', async () => {
  const g = makeGroup(); setEnabled(g, true); const a = nextAuthor();
  await enviar({ conversation: 'bom dia' }, { groupJid: g, author: a });
  const r = await enviar({ conversation: 'tudo bem?' }, { groupJid: g, author: a });
  ok(!r.avisou, 'normal não avisa');
});

const totalPass = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log(`\n${RESULTS.length} testes — ${totalPass} asserções ok, ${totalFail} falhas`);
try { fs.rmSync(TMP_DB, { recursive: true, force: true }); } catch {}
process.exit(totalFail === 0 ? 0 : 1);
