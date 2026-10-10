/**
 * Testes da DETECÇÃO DO RAJA integrada ao `!antifantasma`.
 *
 * Condição (transporte): GRUPO + incoming + enc SOMENTE msg/pkmsg + SEM skmsg +
 * SEM count. 2 mensagens da MESMA pessoa já tomam ban (fechar grupo -> banir ->
 * reabrir) + apaga TODAS as mensagens de payment da rajada.
 *
 * Roda o handler real (NazuninhaBotExec) com socket falso.
 *
 * Uso: node tests/antifantasma-raja.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-raja-db-'));
process.env.DATABASE_PATH = TMP_DB;
fs.mkdirSync(path.join(TMP_DB, 'grupos'), { recursive: true });
fs.mkdirSync(path.join(TMP_DB, 'dono'), { recursive: true });

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

const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;
if (typeof handleMessage !== 'function') throw new Error('index.js não exporta o handler');

const BOT_LID = '111111111111111@lid';
const BOT_JID = '5599999999999@s.whatsapp.net';
let gc = 0, ac = 0;
function nextAuthor() { ac++; return { lid: `99${String(ac).padStart(6, '0')}888@lid`, jid: `5599${String(ac).padStart(6, '0')}777@s.whatsapp.net` }; }
function makeGroup(antiinvi = true) {
  gc++;
  const jid = `1203639800000000${String(gc).padStart(3, '0')}@g.us`;
  fs.writeFileSync(path.join(TMP_DB, 'grupos', `${jid}.json`), JSON.stringify({ groupName: 'G', antiinvi }));
  return jid;
}
function makeNazu({ sent, removals, settings, groupJid, author, authorIsAdmin = false }) {
  return {
    sendMessage: async (jid, content, options) => { sent.push({ jid, content, options, via: 'send' }); return { key: { id: `S-${sent.length}` } }; },
    relayMessage: async (jid, message, options) => { sent.push({ jid, message, options, via: 'relay' }); return { key: { id: options?.messageId } }; },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
    onWhatsApp: async (jid) => [{ jid, exists: true }],
    signalRepository: { lidMapping: { getPNForLID: async () => author.jid } },
    groupMetadata: async () => ({ id: groupJid, subject: 'G', participants: [{ id: author.lid, admin: authorIsAdmin ? 'admin' : null, phoneNumber: author.jid }, { id: BOT_LID, admin: 'admin', phoneNumber: BOT_JID }] }),
    groupParticipantsUpdate: async (jid, ids, action) => { removals.push({ jid, ids, action }); return [{ status: '200' }]; },
    groupSettingUpdate: async (jid, setting) => { settings.push({ jid, setting }); return {}; },
    groupRequestParticipantsList: async () => [],
    groupRequestParticipantsUpdate: async () => ({}),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {}, sendPresenceUpdate: async () => {}, profilePictureUrl: async () => 'x', react: async () => ({}),
  };
}
/** Envia uma mensagem de transporte (groupEncInfo.pairwiseOnly) para o autor. */
async function enviarRaja(groupJid, author, { pairwiseOnly = true, extra = {} } = {}) {
  const sent = []; const removals = []; const settings = [];
  const nazu = makeNazu({ sent, removals, settings, groupJid, author });
  const info = {
    key: { remoteJid: groupJid, fromMe: false, id: `R-${gc}-${Math.random().toString(36).slice(2, 8)}`, participant: author.lid, participantAlt: author.jid },
    message: { conversation: 'impressionante' },
    groupEncInfo: { hasPairwise: true, hasSkmsg: !pairwiseOnly, hasCount: false, pairwiseOnly },
    ...extra,
    messageTimestamp: 1757900000, pushName: 'Autor',
  };
  await handleMessage(nazu, info, null, new Map(), null);
  return { sent, removals, settings, info };
}
const revokes = (sent) => sent
  .filter((x) => x.via === 'relay' && x.message?.protocolMessage && (x.message.protocolMessage.type === 0 || x.message.protocolMessage.type === 'REVOKE'))
  .map((x) => x.message.protocolMessage.key?.id)
  .filter((id) => id && !String(id).startsWith('S-'));

// ---------------------------------------------------------------------------
await test('1 mensagem do raja -> NADA (precisa de 2)', async () => {
  const g = makeGroup(true); const a = nextAuthor();
  const r = await enviarRaja(g, a);
  ok(r.removals.length === 0, '1 não bane');
  ok(revokes(r.sent).length === 0, '1 não apaga');
});
await test('2 mensagens do MESMO autor -> fecha/bani/reabre + apaga as payments', async () => {
  const g = makeGroup(true); const a = nextAuthor();
  await enviarRaja(g, a); // 1a
  const r = await enviarRaja(g, a); // 2a -> dispara
  await new Promise((res) => setTimeout(res, 300)); // enforcement em segundo plano
  // aviso — novo layout (caixa + emoji + menção ao banido)
  const aviso = r.sent.find((s) => typeof s.content?.text === 'string' && s.content.text.includes('꧁'));
  ok(aviso, 'enviou o aviso de ban (layout)');
  ok(aviso && aviso.content.text.includes(`@${a.lid.split('@')[0]}`), 'o aviso menciona o banido');
  ok(aviso && !/tentou atacar com mensagem fantasma/.test(aviso.content.text), 'não usa mais a frase antiga');
  // apagou as 2 mensagens (técnica do payment via relayMessage)
  ok(revokes(r.sent).length >= 2, `apagou >= 2 (veio ${revokes(r.sent).length})`);
  // ciclo do anti-fantasma: fecha o grupo -> reabre
  const setts = r.settings.map((s) => s.setting);
  ok(setts.includes('announcement'), 'fechou o grupo');
  ok(setts.includes('not_announcement'), 'reabriu o grupo');
});
await test('enc COM skmsg (não é raja) -> NADA mesmo com 2', async () => {
  const g = makeGroup(true); const a = nextAuthor();
  await enviarRaja(g, a, { pairwiseOnly: false });
  const r = await enviarRaja(g, a, { pairwiseOnly: false });
  ok(r.removals.length === 0, 'não bane');
  ok(revokes(r.sent).length === 0, 'não apaga');
});
await test('autor ADMIN -> NADA (isento)', async () => {
  const g = makeGroup(true); const a = nextAuthor();
  // authorIsAdmin via socket; envia 2
  for (let i = 0; i < 2; i++) {
    const sent = []; const removals = []; const settings = [];
    const nazu = makeNazu({ sent, removals, settings, groupJid: g, author: a, authorIsAdmin: true });
    const info = { key: { remoteJid: g, fromMe: false, id: `R-a-${i}`, participant: a.lid, participantAlt: a.jid }, message: { conversation: 'x' }, groupEncInfo: { pairwiseOnly: true }, messageTimestamp: 1, pushName: 'A' };
    await handleMessage(nazu, info, null, new Map(), null);
    if (i === 1) ok(removals.length === 0, 'admin não é banido');
  }
});
await test('!antifantasma DESLIGADO (antiinvi false) -> NADA', async () => {
  const g = makeGroup(false); const a = nextAuthor();
  await enviarRaja(g, a);
  const r = await enviarRaja(g, a);
  ok(r.removals.length === 0, 'desligado não bane');
});
await test('autor diferente -> NÃO acumula (2 autores, 1 cada)', async () => {
  const g = makeGroup(true);
  await enviarRaja(g, nextAuthor());
  const r = await enviarRaja(g, nextAuthor());
  ok(r.removals.length === 0, 'autores diferentes não somam');
});
await test('!testmsg NÃO existe mais', async () => {
  const g = makeGroup(true); const a = nextAuthor();
  const sent = []; const removals = []; const settings = [];
  const nazu = makeNazu({ sent, removals, settings, groupJid: g, author: a, authorIsAdmin: true });
  const info = { key: { remoteJid: g, fromMe: false, id: 'C1', participant: a.lid, participantAlt: a.jid }, message: { extendedTextMessage: { text: '!testmsg on', contextInfo: { remoteJid: g } } }, messageTimestamp: 1, pushName: 'A' };
  await handleMessage(nazu, info, null, new Map(), null);
  const out = sent.map((s) => s.content?.text ?? '').filter(Boolean).join('\n');
  ok(!/testmsg|ATIVADO|DESATIVADO/i.test(out), `!testmsg não responde (veio: ${out.slice(0, 80)})`);
});

const totalPass = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log(`\n${RESULTS.length} testes — ${totalPass} asserções ok, ${totalFail} falhas`);
try { fs.rmSync(TMP_DB, { recursive: true, force: true }); } catch {}
process.exit(totalFail === 0 ? 0 : 1);
