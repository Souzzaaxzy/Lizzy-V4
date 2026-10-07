/**
 * Menu !arcade (categoria JOGOS do menu principal).
 *
 * Roda o handler REAL com socket falso: o `!arcade` envia o menu temático no
 * layout padrão, com os comandos kof/metalslug/topgear. Verifica também a
 * presença no menu principal (categoria JOGOS), no blockPv e no menus/index.
 *
 * Uso: node tests/arcade-menu.test.js
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-arcade-db-'));
process.env.DATABASE_PATH = TMP_DB;
fs.mkdirSync(path.join(TMP_DB, 'grupos'), { recursive: true });

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
  for (const e of CURRENT.errors) console.log(`   ↳ ${e}`);
}
function ok(c, m) { if (c) CURRENT.passed++; else { CURRENT.failed++; CURRENT.errors.push(`ASSERT: ${m}`); } }
const read = (rel) => fs.readFileSync(path.join(PROJECT, rel), 'utf8');
// MATHEMATICAL BOLD ITALIC (A=U+1D468) e BOLD (A=U+1D400) -> ASCII, para as
// asserções medirem o CONTEÚDO e não o code point.
function desbold(s) {
  return String(s)
    .replace(/[\u{1D400}-\u{1D433}]/gu, (c) => String.fromCharCode(65 + (c.codePointAt(0) - 0x1D400)))
    .replace(/[\u{1D41A}-\u{1D433}]/gu, (c) => String.fromCharCode(97 + (c.codePointAt(0) - 0x1D41A)))
    .replace(/[\u{1D468}-\u{1D49B}]/gu, (c) => String.fromCharCode(65 + (c.codePointAt(0) - 0x1D468)))
    .replace(/[\u{1D482}-\u{1D4B5}]/gu, (c) => String.fromCharCode(97 + (c.codePointAt(0) - 0x1D482)));
}

// ─────────────────────────── handler real ───────────────────────────

const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';
const AUTHOR_LID = '111000000000900@lid';
const AUTHOR_JID = '5511000000009@s.whatsapp.net';

let groupCounter = 0;
function makeGroup() {
  groupCounter += 1;
  const g = `1203637000000${String(groupCounter).padStart(4, '0')}@g.us`;
  fs.writeFileSync(path.join(TMP_DB, 'grupos', `${g}.json`), JSON.stringify({ groupName: 'GP Arcade' }, null, 2));
  return g;
}

function makeNazu(groupJid) {
  const sent = [];
  return {
    sent,
    sendMessage: async (jid, content, options) => { sent.push({ jid, content, options }); return { key: { id: 'SENT' } }; },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
    onWhatsApp: async () => [],
    signalRepository: { lidMapping: { getPNForLID: async () => null } },
    groupMetadata: async () => ({
      id: groupJid, subject: 'GP Arcade',
      participants: [
        { id: AUTHOR_LID, admin: 'admin', phoneNumber: AUTHOR_JID },
        { id: BOT_LID, admin: 'admin', phoneNumber: BOT_JID },
      ],
    }),
    groupParticipantsUpdate: async () => ({}),
    groupRequestParticipantsList: async () => [],
    groupRequestParticipantsUpdate: async () => ({}),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {},
    sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => 'https://example.com/p.jpg',
    react: async () => ({}),
    relayMessage: async () => ({}),
    waUploadToServer: async () => ({}),
  };
}

async function run(command) {
  const groupJid = makeGroup();
  const nazu = makeNazu(groupJid);
  const info = {
    key: { remoteJid: groupJid, fromMe: false, id: `C-${command}`, participant: AUTHOR_LID },
    message: { extendedTextMessage: { text: `!${command}`, contextInfo: { remoteJid: groupJid } } },
    messageTimestamp: 1757900000,
    pushName: 'Autor',
  };
  await handleMessage(nazu, info, null, new Map(), null);
  const text = nazu.sent.map((s) => s.content?.text ?? s.content?.caption ?? '').filter(Boolean).join('\n');
  return { text, sent: nazu.sent };
}

// ─────────────────────────── testes ───────────────────────────

await test('!arcade envia o menu no layout padrão com os 3 jogos', async () => {
  const { text } = await run('arcade');
  const t = desbold(text);
  ok(t.includes('ARCADE'), 'tem o título ARCADE');
  ok(text.includes('╭━━━꧁༺') && text.includes('╰━━━꧁༺ ✦ ༻꧂'), 'layout padrão (caixas)');
  ok(text.includes('!kof'), 'lista !kof');
  ok(text.includes('!metalslug'), 'lista !metalslug');
  ok(text.includes('!topgear'), 'lista !topgear');
});

await test('alias !menuarcade e !emugames também enviam o menu', async () => {
  for (const cmd of ['menuarcade', 'emugames']) {
    const { text } = await run(cmd);
    ok(desbold(text).includes('ARCADE') && text.includes('!kof'), `alias ${cmd} responde o menu`);
  }
});

await test('menu principal lista !arcade na categoria JOGOS', () => {
  const src = read('dados/src/menus/menu.js');
  const jogos = src.slice(src.indexOf("categoria(prefix, 'JOGOS'"), src.indexOf("categoria(prefix, 'JOGOS'") + 300);
  ok(jogos.includes('arcade'), 'arcade dentro da categoria JOGOS');
  ok(src.includes("['🕹️', 'arcade']"), 'com o emoji 🕹️');
});

await test('blockPv tem o menu arcade', () => {
  const src = read('dados/src/utils/blockPv.js');
  ok(/arcade:\s*\{[\s\S]*?commands:\s*\[[^\]]*'arcade'/.test(src), 'mapa arcade registrado');
  ok(src.includes("'kof'") && src.includes("'metalslug'") && src.includes("'topgear'"), 'comandos no mapa');
});

await test('menus/index registra o menuArcade', () => {
  const src = read('dados/src/menus/index.js');
  ok(src.includes("menuArcade: './menuarcade.js'"), 'menuarcade registrado no loader');
});

await test('index.js tem o case arcade e destructuring', () => {
  const src = read('dados/src/index.js');
  ok(src.includes("case 'arcade':"), 'case arcade presente');
  ok(/sendMenuWithMedia\('arcade', menuArcade\)/.test(src), 'dispara o menu arcade');
  ok(/menuGames,\s*\n\s*menuArcade,/.test(src), 'destructuring do menuArcade');
});

// ─────────────────────────── resumo ───────────────────────────

console.log('\n' + '─'.repeat(60));
let passed = 0, failed = 0;
for (const r of RESULTS) { passed += r.passed; failed += r.failed; }
console.log(`Total: ${RESULTS.length} testes / ${passed} asserções ok, ${failed} falhas`);
process.exit(failed === 0 ? 0 : 1);
