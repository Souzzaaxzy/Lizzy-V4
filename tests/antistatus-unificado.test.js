/**
 * Testes do `!antistatus` UNIFICADO (com `!antistts` como alias).
 *
 * O sistema do antistts (status do grupo/canal) foi juntado ao `antistatus`, com
 * um toggle só, e ganhou proteção contra a mensagem invisível (pairwise) no
 * status. Roda o handler real com socket falso.
 *
 * Uso: node tests/antistatus-unificado.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-status-db-'));
process.env.DATABASE_PATH = TMP_DB;
fs.mkdirSync(path.join(TMP_DB, 'grupos'), { recursive: true });
fs.mkdirSync(path.join(TMP_DB, 'dono'), { recursive: true });

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

const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;

const BOT_LID = '111111111111111@lid';
const BOT_JID = '5599999999999@s.whatsapp.net';
let gc = 0, ac = 0;
function nextAuthor() { ac++; return { lid: `99${String(ac).padStart(6, '0')}888@lid`, jid: `5599${String(ac).padStart(6, '0')}777@s.whatsapp.net` }; }
function makeGroup(groupData = {}) { gc++; const jid = `1203639900000000${String(gc).padStart(3, '0')}@g.us`; fs.writeFileSync(path.join(TMP_DB, 'grupos', `${jid}.json`), JSON.stringify({ groupName: 'G', ...groupData })); return jid; }
function makeNazu({ sent, removals, groupJid, author, authorIsAdmin = false }) {
  return {
    sendMessage: async (jid, content, options) => { sent.push({ jid, content, options }); return { key: { id: `S-${sent.length}` } }; },
    relayMessage: async () => ({ key: {} }),
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
    onWhatsApp: async (jid) => [{ jid, exists: true }],
    signalRepository: { lidMapping: { getPNForLID: async () => author.jid } },
    groupMetadata: async () => ({ id: groupJid, subject: 'G', participants: [{ id: author.lid, admin: authorIsAdmin ? 'admin' : null, phoneNumber: author.jid }, { id: BOT_LID, admin: 'admin', phoneNumber: BOT_JID }] }),
    groupParticipantsUpdate: async (jid, ids, action) => { removals.push({ jid, ids, action }); return [{ status: '200' }]; },
    groupSettingUpdate: async () => ({}),
    groupRequestParticipantsList: async () => [], groupRequestParticipantsUpdate: async () => ({}),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {}, sendPresenceUpdate: async () => {}, profilePictureUrl: async () => 'x', react: async () => ({}),
  };
}
async function enviar(message, opts = {}) {
  const sent = []; const removals = [];
  const author = opts.author || nextAuthor();
  const groupJid = opts.groupJid || makeGroup();
  const nazu = makeNazu({ sent, removals, groupJid, author, authorIsAdmin: opts.authorIsAdmin });
  const info = { key: { remoteJid: groupJid, fromMe: false, id: `T-${gc}-${Math.random().toString(36).slice(2, 7)}`, participant: author.lid, participantAlt: author.jid }, ...(message === undefined ? {} : { message }), ...(opts.extra || {}), messageTimestamp: 1, pushName: 'A' };
  await handleMessage(nazu, info, null, new Map(), null);
  await new Promise((r) => setTimeout(r, 60));
  return { sent, removals, groupJid, author };
}
const texto = (b) => b.sent.map((s) => s.content?.text ?? '').filter(Boolean).join('\n');
const cm = (t) => ({ extendedTextMessage: { text: t, contextInfo: { remoteJid: 'x' } } });
const gd = (groupJid) => JSON.parse(fs.readFileSync(path.join(TMP_DB, 'grupos', `${groupJid}.json`), 'utf-8'));

// ---------------------------------------------------------------------------
await test('!antistatus on/off grava os DOIS flags (antistatus + antiStts)', async () => {
  const author = nextAuthor(); const g = makeGroup();
  const base = { author, groupJid: g, authorIsAdmin: true };
  const on = await enviar(cm('!antistatus on'), base);
  ok(/ativado/i.test(texto(on)), 'responde ativado');
  ok(gd(g).antistatus === true && gd(g).antiStts === true, 'on liga os dois');
  const off = await enviar(cm('!antistatus off'), base);
  ok(/desativado/i.test(texto(off)), 'responde desativado');
  ok(gd(g).antistatus === false && gd(g).antiStts === false, 'off desliga os dois');
});
await test('!antistts (alias) usa o MESMO comando/toggle', async () => {
  const author = nextAuthor(); const g = makeGroup();
  const base = { author, groupJid: g, authorIsAdmin: true };
  const on = await enviar(cm('!antistts on'), base);
  ok(/ativado/i.test(texto(on)), 'alias responde ativado');
  ok(gd(g).antistatus === true && gd(g).antiStts === true, 'alias liga os dois');
});
await test('!antistatus sem argumento alterna', async () => {
  const author = nextAuthor(); const g = makeGroup();
  const base = { author, groupJid: g, authorIsAdmin: true };
  const r = await enviar(cm('!antistatus'), base);
  ok(/ativado/i.test(texto(r)), 'alternou para ativado');
  ok(gd(g).antiStts === true, 'ligou');
});
await test('LIGADO: status do grupo (groupStatusMessageV2) -> remove', async () => {
  const g = makeGroup({ antistatus: true });
  const r = await enviar({ groupStatusMessageV2: { message: { conversation: 'oi' } } }, { groupJid: g });
  ok(r.removals.some((x) => x.action === 'remove'), 'removeu quem postou status');
});
await test('LIGADO: mensagem inseperável (pairwise) no status -> remove', async () => {
  const g = makeGroup({ antistatus: true });
  const r = await enviar({ groupStatusMessageV2: { message: { conversation: 'impressionante' } } }, { groupJid: g, extra: { groupEncInfo: { pairwiseOnly: true } } });
  ok(r.removals.some((x) => x.action === 'remove'), 'removeu o pairwise no status');
});
await test('DESLIGADO: status -> NADA', async () => {
  const g = makeGroup({ antistatus: false, antiStts: false });
  const r = await enviar({ groupStatusMessageV2: { message: { conversation: 'oi' } } }, { groupJid: g });
  ok(r.removals.length === 0, 'desligado não remove');
});
await test('LIGADO: apaga o status automaticamente (revogação no formato de group status)', async () => {
  const g = makeGroup({ antistatus: true });
  const r = await enviar({ groupStatusMessageV2: { message: { conversation: 'oi' } } }, { groupJid: g });
  // A técnica usa `{ groupStatus: true, delete: {...} }` (a que apaga status de grupo)
  const apagouStatus = r.sent.some((x) => x.content && x.content.groupStatus === true && x.content.delete);
  ok(apagouStatus, 'enviou a revogação no formato de group status');
  ok(r.removals.some((x) => x.action === 'remove'), 'e removeu o autor');
});
await test('LIGADO: pairwise no status também é apagado', async () => {
  const g = makeGroup({ antistatus: true });
  const r = await enviar({ groupStatusMessageV2: { message: { conversation: 'x' } } }, { groupJid: g, extra: { groupEncInfo: { pairwiseOnly: true } } });
  const apagouStatus = r.sent.some((x) => x.content && x.content.groupStatus === true && x.content.delete);
  ok(apagouStatus, 'revogou no formato de group status');
});

await test('admin isento', async () => {
  const g = makeGroup({ antistatus: true });
  const r = await enviar({ groupStatusMessageV2: { message: { conversation: 'oi' } } }, { groupJid: g, authorIsAdmin: true });
  ok(r.removals.length === 0, 'admin não é removido');
});
await test('!antistts antigo não tem mais uso próprio (é alias)', async () => {
  // O comando antigo mostrava "Como usar" com antistts on/off. Agora é o mesmo.
  const author = nextAuthor(); const g = makeGroup();
  const r = await enviar(cm('!antistts'), { author, groupJid: g, authorIsAdmin: true });
  ok(!/Como usar:/.test(texto(r)), 'não mostra mais o painel antigo');
  ok(/ativado|desativado/i.test(texto(r)), 'usa o fluxo unificado');
});

const totalPass = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log(`\n${RESULTS.length} testes — ${totalPass} asserções ok, ${totalFail} falhas`);
try { fs.rmSync(TMP_DB, { recursive: true, force: true }); } catch {}
process.exit(totalFail === 0 ? 0 : 1);
