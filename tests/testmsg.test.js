/**
 * Testes do `!testmsg` (detector de link/preview escondido — TESTE, por grupo).
 *
 * Roda o MÓDULO real e o HANDLER real (NazuninhaBotExec) com socket falso.
 * Confere também que o caminho do `!testmsg` NÃO escreve no console (sem log).
 *
 * Uso: node tests/testmsg.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-testmsg-db-'));
process.env.DATABASE_PATH = TMP_DB;
fs.mkdirSync(path.join(TMP_DB, 'grupos'), { recursive: true });
fs.mkdirSync(path.join(TMP_DB, 'dono'), { recursive: true });
const TEST_MSG_FILE = path.join(TMP_DB, 'dono', 'testMsg.json');

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
const { temLinkEscondido, textoPrincipal, extrairLinksEscondidos } = await import(new URL('../dados/src/utils/testMsg.js', import.meta.url).href);

test('módulo: link em externalAdReply (texto limpo) -> detecta', () => {
  const m = { extendedTextMessage: { text: 'top', contextInfo: { externalAdReply: { sourceUrl: 'https://t.me/xx' } } } };
  eq(temLinkEscondido(m), true, 'detecta');
  ok(extrairLinksEscondidos(m).length >= 1, 'extrai o link');
});
test('módulo: link em matchedText -> detecta', () => {
  eq(temLinkEscondido({ extendedTextMessage: { text: 'legal', matchedText: 'https://bit.ly/abc' } }), true, 'detecta');
});
test('módulo: preview com canonicalUrl + title -> detecta', () => {
  const m = { extendedTextMessage: { text: 'maravilhoso', canonicalUrl: 'https://site.com/x', title: 'Clique em https://site.com/x' } };
  eq(temLinkEscondido(m), true, 'detecta');
});
test('módulo: link NO TEXTO -> NÃO detecta (é mensagem normal de link)', () => {
  eq(temLinkEscondido({ extendedTextMessage: { text: 'olha https://google.com' } }), false, 'não detecta');
  eq(temLinkEscondido({ conversation: 'veja www.x.com' }), false, 'não detecta conversation');
});
test('módulo: conversa normal -> NÃO detecta', () => {
  eq(temLinkEscondido({ conversation: 'bom dia pessoal' }), false, 'conversa');
  eq(temLinkEscondido({ extendedTextMessage: { text: 'interessante' } }), false, 'texto curto sem link');
  eq(temLinkEscondido(null), false, 'null');
  eq(temLinkEscondido(undefined), false, 'undefined');
});
test('módulo: link escondido dentro de viewOnce -> detecta', () => {
  const m = { viewOnceMessageV2: { message: { extendedTextMessage: { text: 'oi', contextInfo: { externalAdReply: { mediaUrl: 'https://x.com/y' } } } } } };
  eq(temLinkEscondido(m), true, 'detecta no viewOnce');
  eq(textoPrincipal(m), 'oi', 'lê o texto de dentro');
});
test('módulo: description com link -> detecta', () => {
  eq(temLinkEscondido({ extendedTextMessage: { text: 'entendi', description: 'acesse https://promo.link/1' } }), true, 'detecta');
});
test('módulo: entrada hostil não lança', () => {
  const circ = { extendedTextMessage: { text: 'x' } };
  circ.self = circ;
  ok((() => { try { temLinkEscondido(circ); return true; } catch { return false; } })(), 'circular');
  ok((() => { try { temLinkEscondido({ extendedTextMessage: { text: 123 } }); return true; } catch { return false; } })(), 'tipo errado');
});

// ============================================================================
// 2. HANDLER (socket falso)
// ============================================================================
const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;
if (typeof handleMessage !== 'function') throw new Error('index.js não exporta o handler');

const BOT_LID = '111111111111111@lid';
const BOT_JID = '5599999999999@s.whatsapp.net';
let gc = 0, ac = 0;
function nextAuthor() { ac++; return { lid: `99${String(ac).padStart(6, '0')}888@lid`, jid: `5599${String(ac).padStart(6, '0')}777@s.whatsapp.net` }; }
function makeGroup() { gc++; const jid = `1203639700000000${String(gc).padStart(3, '0')}@g.us`; fs.writeFileSync(path.join(TMP_DB, 'grupos', `${jid}.json`), JSON.stringify({ groupName: 'G' })); return jid; }
function makeNazu({ sent, groupJid, author, authorIsAdmin = false }) {
  return {
    sendMessage: async (jid, content, options) => { sent.push({ jid, content, options }); return { key: { id: `S-${sent.length}` } }; },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
    onWhatsApp: async (jid) => [{ jid, exists: true }],
    signalRepository: { lidMapping: { getPNForLID: async () => author.jid } },
    groupMetadata: async () => ({ id: groupJid, subject: 'G', participants: [{ id: author.lid, admin: authorIsAdmin ? 'admin' : null, phoneNumber: author.jid }, { id: BOT_LID, admin: 'admin', phoneNumber: BOT_JID }] }),
    groupParticipantsUpdate: async () => [{ status: '200' }],
    groupRequestParticipantsList: async () => [],
    groupRequestParticipantsUpdate: async () => ({}),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {}, sendPresenceUpdate: async () => {}, profilePictureUrl: async () => 'x', react: async () => ({}),
  };
}
async function enviar(message, opts = {}) {
  const sent = [];
  const author = opts.author || nextAuthor();
  const groupJid = opts.groupJid || makeGroup();
  const nazu = makeNazu({ sent, groupJid, author, authorIsAdmin: opts.authorIsAdmin });
  const info = {
    key: { remoteJid: opts.chatId || groupJid, fromMe: false, id: `T-${gc}-${Math.random().toString(36).slice(2, 7)}`, participant: author.lid, participantAlt: author.jid },
    ...(message === undefined ? {} : { message }),
    ...(opts.extra || {}),
    messageTimestamp: 1757900000, pushName: 'Autor',
  };
  await handleMessage(nazu, info, null, new Map(), null);
  await new Promise((r) => setTimeout(r, 60));
  return { sent, groupJid, author };
}
function setEnabled(groupJid, on = true) {
  const cur = fs.existsSync(TEST_MSG_FILE) ? JSON.parse(fs.readFileSync(TEST_MSG_FILE, 'utf-8')) : {};
  if (on) cur[groupJid] = { enabled: true, at: new Date().toISOString() }; else delete cur[groupJid];
  fs.writeFileSync(TEST_MSG_FILE, JSON.stringify(cur, null, 2));
}
const textos = (sent) => sent.map((s) => s.content?.text ?? '').filter(Boolean);
const RAJA = { extendedTextMessage: { text: 'top', contextInfo: { externalAdReply: { sourceUrl: 'https://t.me/canalx' } } } };

await test('!testmsg on / status / off', async () => {
  const author = nextAuthor(); const groupJid = makeGroup(); const base = { author, groupJid, authorIsAdmin: true };
  const on = await enviar({ extendedTextMessage: { text: '!testmsg on' } }, base);
  ok(textos(on.sent).join().includes('ATIVADO'), 'on ATIVADO');
  ok(!!JSON.parse(fs.readFileSync(TEST_MSG_FILE, 'utf-8'))[groupJid], 'gravou');
  const st = await enviar({ extendedTextMessage: { text: '!testmsg' } }, base);
  ok(textos(st.sent).join().includes('ATIVADO'), 'status ATIVADO');
  const off = await enviar({ extendedTextMessage: { text: '!testmsg off' } }, base);
  ok(textos(off.sent).join().includes('DESATIVADO'), 'off DESATIVADO');
  eq(JSON.parse(fs.readFileSync(TEST_MSG_FILE, 'utf-8'))[groupJid], undefined, 'removeu');
});
await test('!testmsg: fora de grupo e não-admin recusam', async () => {
  const fora = await enviar({ extendedTextMessage: { text: '!testmsg on' } }, { chatId: nextAuthor().jid });
  ok(/grupo/i.test(textos(fora.sent).join()), 'fora de grupo');
  const nao = await enviar({ extendedTextMessage: { text: '!testmsg on' } }, { authorIsAdmin: false });
  ok(/administrador/i.test(textos(nao.sent).join()), 'não-admin');
});
await test('LIGADO: raja (link escondido no ad) -> "mensagem detectada"', async () => {
  const groupJid = makeGroup(); setEnabled(groupJid, true);
  const r = await enviar(RAJA, { groupJid });
  ok(textos(r.sent).includes('mensagem detectada'), 'enviou "mensagem detectada"');
});
await test('LIGADO: link no TEXTO -> NÃO manda (é normal)', async () => {
  const groupJid = makeGroup(); setEnabled(groupJid, true);
  const r = await enviar({ extendedTextMessage: { text: 'segue o link https://google.com' } }, { groupJid });
  ok(!textos(r.sent).includes('mensagem detectada'), 'não manda para link no texto');
});
await test('LIGADO: conversa normal -> nada', async () => {
  const groupJid = makeGroup(); setEnabled(groupJid, true);
  const r = await enviar({ conversation: 'bom dia pessoal' }, { groupJid });
  ok(!textos(r.sent).includes('mensagem detectada'), 'não manda');
});
await test('DESLIGADO: raja -> nada', async () => {
  const groupJid = makeGroup(); setEnabled(groupJid, false);
  const r = await enviar(RAJA, { groupJid });
  ok(!textos(r.sent).includes('mensagem detectada'), 'não manda');
});
await test('POR GRUPO: ligado no A não age no B', async () => {
  const a = makeGroup(); setEnabled(a, true);
  const r = await enviar(RAJA, { groupJid: makeGroup() });
  ok(!textos(r.sent).includes('mensagem detectada'), 'não age em outro grupo');
});
await test('SEM LOG: o caminho do !testmsg não escreve no console', async () => {
  const groupJid = makeGroup(); setEnabled(groupJid, true);
  const orig = { log: console.log, error: console.error, warn: console.warn, info: console.info };
  let capturado = '';
  console.log = console.error = console.warn = console.info = (...a) => { capturado += a.join(' ') + '\n'; };
  // Mensagem SEM texto (só link escondido no ad): a caixinha genérica nem
  // imprime, então qualquer saída só poderia vir do !testmsg.
  try {
    await enviar({ extendedTextMessage: { contextInfo: { externalAdReply: { sourceUrl: 'https://t.me/x' } } } }, { groupJid });
  } finally { Object.assign(console, orig); }
  ok(!/testmsg/i.test(capturado), `!testmsg não loga (veio: ${JSON.stringify(capturado.slice(0, 120))})`);
  ok(capturado.trim() === '', `caminho silencioso (veio: ${JSON.stringify(capturado.slice(0, 120))})`);
});

const totalPass = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log(`\n${RESULTS.length} testes — ${totalPass} asserções ok, ${totalFail} falhas`);
try { fs.rmSync(TMP_DB, { recursive: true, force: true }); } catch {}
process.exit(totalFail === 0 ? 0 : 1);
