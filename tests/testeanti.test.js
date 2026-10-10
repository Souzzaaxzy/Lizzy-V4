/**
 * Testes do `!testeanti` (analisador defensivo — TESTE, por grupo).
 *
 * Roda o MÓDULO real (detectarAnomalia / porte do BypassKN + sinais de envelope)
 * e o HANDLER real (NazuninhaBotExec) com socket Baileys falso.
 *
 * Uso: node tests/testeanti.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Banco temporário ANTES de importar o index (paths.js lê DATABASE_PATH no load).
const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-testeanti-db-'));
process.env.DATABASE_PATH = TMP_DB;
fs.mkdirSync(path.join(TMP_DB, 'grupos'), { recursive: true });
fs.mkdirSync(path.join(TMP_DB, 'dono'), { recursive: true });

const TESTE_ANTI_FILE = path.join(TMP_DB, 'dono', 'testeAnti.json');

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
  for (const e of CURRENT.errors) console.log(`     ${e.split('\n')[0]}`);
}
function ok(c, m) { if (c) CURRENT.passed++; else { CURRENT.failed++; CURRENT.errors.push(`ASSERT FALHOU: ${m}`); } }
function eq(a, b, m) { ok(a === b, `${m} — esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`); }

// ============================================================================
// 1. MÓDULO (puro)
// ============================================================================
const { detectarAnomalia, analyzeMessage, measureContent } = await import(new URL('../dados/src/utils/testeAnti.js', import.meta.url).href);

test('módulo: travazap (texto gigante) -> ALTA', () => {
  const r = detectarAnomalia({ key: {}, message: { conversation: 'x'.repeat(100001) } });
  eq(r.anomalia, true, 'anomalia');
  eq(r.severidade, 'ALTA', 'severidade ALTA');
  ok(r.motivos.includes('TEXT_LENGTH_SEVERE'), 'motivo TEXT_LENGTH_SEVERE presente');
});
test('módulo: legenda grande -> anomalia (média/alta)', () => {
  const r = detectarAnomalia({ key: {}, message: { imageMessage: { caption: 'y'.repeat(2501) } } });
  eq(r.anomalia, true, 'anomalia');
  ok(['MEDIA', 'ALTA'].includes(r.severidade), 'severidade média ou alta');
});
test('módulo: stub (não decifrada) -> ALTA', () => {
  const r = detectarAnomalia({ key: {}, messageStubType: 2 });
  eq(r.anomalia, true, 'anomalia');
  eq(r.severidade, 'ALTA', 'severidade ALTA');
  ok(r.motivos.includes('STUB_UNDECRYPTABLE'), 'motivo STUB_UNDECRYPTABLE');
});
test('módulo: distribuição seletiva -> anomalia', () => {
  const r = detectarAnomalia({ key: {}, message: { conversation: 'oi' }, selectiveDistribution: { kind: 'selective-distribution' } });
  eq(r.anomalia, true, 'anomalia');
  ok(r.motivos.includes('SELECTIVE_DISTRIBUTION'), 'motivo SELECTIVE_DISTRIBUTION');
});
test('módulo: múltiplos tipos na raiz -> anomalia estrutural', () => {
  const r = detectarAnomalia({ key: {}, message: { conversation: 'oi', imageMessage: { caption: 'x' } } });
  eq(r.anomalia, true, 'anomalia');
  ok(r.motivos.includes('MULTIPLE_ROOT_MESSAGE_TYPES'), 'motivo estrutural');
});
test('módulo: normal NÃO é anomalia (sem falso positivo)', () => {
  eq(detectarAnomalia({ key: {}, message: { conversation: 'bom dia pessoal' } }).anomalia, false, 'texto normal');
  eq(detectarAnomalia({ key: {}, message: {} }).anomalia, false, 'corpo vazio sem stub');
  eq(detectarAnomalia({ key: {}, message: { imageMessage: { caption: 'foto do almoço' } } }).anomalia, false, 'imagem normal');
});
test('módulo: porte mantém a lógica do BypassKN', () => {
  eq(analyzeMessage({ key: {}, message: { conversation: 'x'.repeat(100001) } }).classification, 'HIGH_SEVERITY_REVIEW', 'classificação');
  ok(measureContent({ imageMessage: { caption: 'x'.repeat(2501) } }).findings.some((f) => f.code === 'TEXT_LENGTH_HIGH'), 'measureContent');
});
test('módulo: entrada inválida não lança', () => {
  ok((() => { try { detectarAnomalia(null); return true; } catch { return false; } })(), 'null não lança');
  ok((() => { try { detectarAnomalia(undefined); return true; } catch { return false; } })(), 'undefined não lança');
});

// ============================================================================
// 2. HANDLER (socket falso)
// ============================================================================
const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;
if (typeof handleMessage !== 'function') throw new Error('index.js não exporta o handler');

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';
let groupCounter = 0;
let authorCounter = 0;
const GRUPOS = path.join(TMP_DB, 'grupos');

function nextAuthor() {
  authorCounter++;
  return { lid: `99${String(authorCounter).padStart(6, '0')}888@lid`, jid: `5599${String(authorCounter).padStart(6, '0')}777@s.whatsapp.net` };
}
function makeGroup() {
  groupCounter++;
  const jid = `1203639600000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(path.join(GRUPOS, `${jid}.json`), JSON.stringify({ groupName: 'G' }, null, 2));
  return jid;
}
function makeNazu({ sent, removals, groupJid, author, authorIsAdmin = false, botIsAdmin = true }) {
  return {
    sendMessage: async (jid, content, options) => { sent.push({ jid, content, options }); return { key: { id: `S-${sent.length}` } }; },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
    onWhatsApp: async (jid) => [{ jid, exists: true }],
    signalRepository: { lidMapping: { getPNForLID: async () => author.jid } },
    groupMetadata: async () => ({
      id: groupJid, subject: 'G',
      participants: [
        { id: author.lid, admin: authorIsAdmin ? 'admin' : null, phoneNumber: author.jid },
        { id: BOT_LID, admin: botIsAdmin ? 'admin' : null, phoneNumber: BOT_JID },
      ],
    }),
    groupParticipantsUpdate: async (jid, jids, action) => { removals.push({ jid, jids, action }); return [{ status: '200' }]; },
    groupRequestParticipantsList: async () => [],
    groupRequestParticipantsUpdate: async () => ({}),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {},
    sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => 'x',
    react: async () => ({}),
  };
}

/** Executa o handler para uma mensagem. */
async function enviar(message, opts = {}) {
  const sent = [];
  const removals = [];
  const author = opts.author || nextAuthor();
  const groupJid = opts.groupJid || makeGroup();
  const nazu = makeNazu({ sent, removals, groupJid, author, authorIsAdmin: opts.authorIsAdmin, botIsAdmin: opts.botIsAdmin });
  const info = {
    key: { remoteJid: opts.chatId || groupJid, fromMe: false, id: `T-${groupCounter}-${Math.random().toString(36).slice(2, 7)}`, participant: author.lid, participantAlt: author.jid },
    ...(message === undefined ? {} : { message }),
    ...(opts.extra || {}),
    messageTimestamp: 1757900000, pushName: 'Autor',
  };
  await handleMessage(nazu, info, null, new Map(), null);
  await new Promise((r) => setTimeout(r, 60));
  return { sent, removals, groupJid, author };
}

function setEnabled(groupJid, on = true) {
  const cur = fs.existsSync(TESTE_ANTI_FILE) ? JSON.parse(fs.readFileSync(TESTE_ANTI_FILE, 'utf-8')) : {};
  if (on) cur[groupJid] = { enabled: true, at: new Date().toISOString() };
  else delete cur[groupJid];
  fs.writeFileSync(TESTE_ANTI_FILE, JSON.stringify(cur, null, 2));
}
const texto = (sent) => sent.map((s) => s.content?.text ?? '').filter(Boolean).join('\n');
const AVISO = 'se você esta vendo essa mensagem é por que funcionou';

await test('!testeanti on / status / off', async () => {
  const author = nextAuthor();
  const groupJid = makeGroup();
  const base = { author, groupJid, authorIsAdmin: true };
  const on = await enviar({ extendedTextMessage: { text: '!testeanti on' } }, base);
  ok(/ATIVADO/.test(texto(on.sent)), 'on responde ATIVADO');
  ok(!!JSON.parse(fs.readFileSync(TESTE_ANTI_FILE, 'utf-8'))[groupJid], 'gravou enabled');
  const st = await enviar({ extendedTextMessage: { text: '!testeanti' } }, base);
  ok(/ATIVADO/.test(texto(st.sent)), 'status ATIVADO');
  const off = await enviar({ extendedTextMessage: { text: '!testeanti off' } }, base);
  ok(/DESATIVADO/.test(texto(off.sent)), 'off responde DESATIVADO');
  eq(JSON.parse(fs.readFileSync(TESTE_ANTI_FILE, 'utf-8'))[groupJid], undefined, 'removeu o grupo');
});

await test('!testeanti: uso em argumento inválido', async () => {
  const r = await enviar({ extendedTextMessage: { text: '!testeanti xyz' } }, { authorIsAdmin: true });
  ok(/Uso/i.test(texto(r.sent)) && /testeanti on/.test(texto(r.sent)), 'mostra o uso');
});

await test('!testeanti: fora de grupo recusa', async () => {
  const r = await enviar({ extendedTextMessage: { text: '!testeanti on' } }, { chatId: nextAuthor().jid, authorIsAdmin: false });
  ok(/grupo/i.test(texto(r.sent)), 'recusa fora de grupo');
});

await test('!testeanti: não-admin recusa', async () => {
  const r = await enviar({ extendedTextMessage: { text: '!testeanti on' } }, { authorIsAdmin: false });
  ok(/administrador/i.test(texto(r.sent)), 'recusa não-admin');
});

await test('LIGADO: travazap -> bane o autor + envia o aviso', async () => {
  const groupJid = makeGroup();
  setEnabled(groupJid, true);
  const r = await enviar({ conversation: 'travazap '.repeat(20000) }, { groupJid });
  ok(r.removals.some((x) => x.action === 'remove' && x.jids.includes(r.author.lid)), 'removeu o autor');
  ok(r.sent.some((s) => s.content?.text === AVISO), 'enviou o aviso "funcionou"');
});

await test('DESLIGADO: travazap não bane nem avisa', async () => {
  const groupJid = makeGroup();
  setEnabled(groupJid, false);
  const r = await enviar({ conversation: 'travazap '.repeat(20000) }, { groupJid });
  ok(r.removals.length === 0, 'não bane');
  ok(!r.sent.some((s) => s.content?.text === AVISO), 'não avisa');
});

await test('POR GRUPO: ligado no A não age no grupo B', async () => {
  const groupA = makeGroup();
  setEnabled(groupA, true);
  const r = await enviar({ conversation: 'travazap '.repeat(20000) }, { groupJid: makeGroup() });
  ok(r.removals.length === 0, 'não age em outro grupo');
});

await test('LIGADO: stub (não decifrada) -> bane', async () => {
  const groupJid = makeGroup();
  setEnabled(groupJid, true);
  const r = await enviar(undefined, { groupJid, extra: { messageStubType: 2 } });
  ok(r.removals.some((x) => x.action === 'remove'), 'removeu por stub');
});

await test('LIGADO: mensagem normal não bane', async () => {
  const groupJid = makeGroup();
  setEnabled(groupJid, true);
  const r = await enviar({ conversation: 'bom dia pessoal, tudo bem?' }, { groupJid });
  ok(r.removals.length === 0, 'texto normal não bane');
  ok(!r.sent.some((s) => s.content?.text === AVISO), 'texto normal não avisa');
});

await test('sem arquivo de estado: não age (sem I/O por mensagem)', async () => {
  try { fs.unlinkSync(TESTE_ANTI_FILE); } catch {}
  const r = await enviar({ conversation: 'travazap '.repeat(20000) }, {});
  ok(r.removals.length === 0, 'não age sem estado');
});

// ============================================================================
const totalPass = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log(`\n${RESULTS.length} testes — ${totalPass} asserções ok, ${totalFail} falhas`);
try { fs.rmSync(TMP_DB, { recursive: true, force: true }); } catch {}
process.exit(totalFail === 0 ? 0 : 1);
