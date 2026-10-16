/**
 * Teste do `!spoiler` (experimental, sem menu).
 *
 * Mede o caminho REAL: handler -> `nazu.sendMessage` -> proto. Confere que
 * `{ text, spoiler: true }` vira `spoilerMessage` com `contextInfo.isSpoiler`,
 * e que a mídia marcada tambem entra como spoiler.
 *
 * Uso: node tests/spoiler.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-spoiler-'));
process.env.DATABASE_PATH = TMP_DB;
process.env.CONFIG_PATH = path.join(TMP_DB, 'config.json');
fs.mkdirSync(path.join(TMP_DB, 'grupos'), { recursive: true });
fs.writeFileSync(
  path.join(TMP_DB, 'config.json'),
  JSON.stringify({ nomebot: 'Lizzy', prefixo: '!', numerodono: '5511999999999', nomedono: 'Dono' }, null, 2)
);

const RESULTS = [];
let CURRENT = null;

function test(name, fn) {
  CURRENT = { name, passed: 0, failed: 0, errors: [] };
  RESULTS.push(CURRENT);
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      return r.then(() => finish(name)).catch((e) => { CURRENT.failed++; CURRENT.errors.push(`EXCEÇÃO: ${e?.stack || e}`); finish(name); });
    }
    finish(name);
  } catch (e) {
    CURRENT.failed++; CURRENT.errors.push(`EXCEÇÃO: ${e?.stack || e}`); finish(name);
  }
  return Promise.resolve();
}
function finish(name) {
  console.log(`${CURRENT.failed === 0 ? '✅' : '❌'} ${name} (${CURRENT.passed} ok, ${CURRENT.failed} falhas)`);
  for (const e of CURRENT.errors) console.log(`     ${e.split('\n')[0]}`);
}
function ok(c, m) { if (c) CURRENT.passed++; else { CURRENT.failed++; CURRENT.errors.push(`ASSERT FALHOU: ${m}`); } }
function includes(hay, needle, label) {
  ok(typeof hay === 'string' && hay.includes(needle), `${label ?? needle} — esperado conter "${needle}"`);
}

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';
const OUTRO_LID = '111000000000003@lid';

let groupCounter = 0;
let authorCounter = 0;
const GRUPOS = path.join(TMP_DB, 'grupos');

function nextAuthor() {
  authorCounter++;
  return {
    lid: `97${String(authorCounter).padStart(6, '0')}888@lid`,
    jid: `5597${String(authorCounter).padStart(6, '0')}777@s.whatsapp.net`,
  };
}

function makeGroup() {
  groupCounter++;
  const jid = `1203639800000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(path.join(GRUPOS, `${jid}.json`), JSON.stringify({ groupName: 'G' }, null, 2));
  return jid;
}

function makeNazu({ sent, groupJid, author }) {
  return {
    sendMessage: async (jid, content, options) => { sent.push({ jid, content, options }); return { key: { id: `S-${sent.length}` } }; },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
    onWhatsApp: async (jid) => [{ jid, exists: true, lid: jid === author.jid ? author.lid : jid }],
    signalRepository: { lidMapping: { getPNForLID: async () => author.jid } },
    groupMetadata: async () => ({
      id: groupJid, subject: 'G',
      participants: [
        { id: author.lid, admin: null, phoneNumber: author.jid },
        { id: OUTRO_LID, admin: null, phoneNumber: '5511000000003@s.whatsapp.net' },
        { id: BOT_LID, admin: 'admin', phoneNumber: BOT_JID },
      ],
    }),
    groupParticipantsUpdate: async () => [{ status: '200' }],
    groupRequestParticipantsList: async () => [],
    groupRequestParticipantsUpdate: async () => ({}),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {},
    sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => 'x',
    react: async () => ({}),
  };
}

const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;
if (typeof handleMessage !== 'function') throw new Error('index.js não exporta o handler');

const SRC = fs.readFileSync(new URL('../dados/src/index.js', import.meta.url), 'utf8');
const { proto } = await import('@itsliaaa/baileys');

/** Executa o comando no handler real. */
async function runCmd(text, opts = {}) {
  const sent = [];
  const author = opts.author || nextAuthor();
  const groupJid = opts.groupJid || makeGroup();
  const nazu = makeNazu({ sent, groupJid, author });
  const info = {
    key: { remoteJid: groupJid, fromMe: false, id: `SP-${groupCounter}-${Math.random().toString(36).slice(2, 7)}`, participant: author.lid },
    message: opts.message || { extendedTextMessage: { text, contextInfo: { remoteJid: groupJid } } },
    messageTimestamp: 1757900000, pushName: 'Autor',
  };
  await handleMessage(nazu, info, null, new Map(), null);
  const out = sent.map((s) => s.content?.text ?? '').filter(Boolean).join('\n');
  return { sent, out, groupJid, author };
}

console.log('\n=== 1) O COMANDO ===\n');

await test('!spoiler <texto> envia com spoiler: true', async () => {
  const r = await runCmd('!spoiler cuidado com o final');
  const msg = r.sent.find((s) => s.content?.text);
  ok(msg, 'enviou a mensagem');
  ok(msg.content.spoiler === true, 'com spoiler: true');
  includes(msg.content.text, 'cuidado com o final', 'com o texto');
});

await test('!spoiler sem texto mostra o uso (nao manda vazio)', async () => {
  const r = await runCmd('!spoiler');
  const msg = r.sent.find((s) => s.content?.text);
  ok(msg, 'respondeu');
  ok(msg.content.spoiler !== true, 'a ajuda NAO e spoiler');
  includes(r.out, 'spoiler', 'mostra o uso');
});

await test('o texto do spoiler aceita acento e emoji', async () => {
  const r = await runCmd('!spoiler o vilão é o mordomo 🕵️');
  const msg = r.sent.find((s) => s.content?.text);
  includes(msg.content.text, 'vilão', 'acento preservado');
  includes(msg.content.text, '🕵️', 'emoji preservado');
});

console.log('\n=== 2) O PROTO REAL (o que o WhatsApp recebe) ===\n');

await test('vira spoilerMessage com contextInfo.isSpoiler', async () => {
  const r = await runCmd('!spoiler segredo');
  const msg = r.sent.find((s) => s.content?.text);
  const { generateWAMessageContent } = await import('@itsliaaa/baileys');
  const up = async () => ({ url: 'https://x/f', directPath: '/v/f' });
  const c = await generateWAMessageContent(
    { text: msg.content.text, spoiler: true },
    { upload: up }
  );
  ok(c.spoilerMessage, 'vem como spoilerMessage');
  ok(c.spoilerMessage.message.extendedTextMessage.text === 'segredo', 'com o texto dentro');
  ok(c.spoilerMessage.message.extendedTextMessage.contextInfo.isSpoiler === true, 'com isSpoiler: true');
  ok(!c.extendedTextMessage, 'NAO e texto normal');
});

await test('sobrevive ao encode/decode do proto', async () => {
  const { generateWAMessageContent } = await import('@itsliaaa/baileys');
  const up = async () => ({ url: 'https://x/f', directPath: '/v/f' });
  const c = await generateWAMessageContent({ text: 'x', spoiler: true }, { upload: up });
  const bytes = proto.Message.encode(proto.Message.fromObject(c)).finish();
  const volta = proto.Message.decode(bytes);
  ok(volta.spoilerMessage, 'spoilerMessage sobreviveu');
  ok(volta.spoilerMessage.message.extendedTextMessage.contextInfo.isSpoiler === true, 'isSpoiler sobreviveu');
});

await test('mensagem normal NAO ganha spoiler', async () => {
  const { generateWAMessageContent } = await import('@itsliaaa/baileys');
  const up = async () => ({ url: 'https://x/f', directPath: '/v/f' });
  const c = await generateWAMessageContent({ text: 'oi' }, { upload: up });
  ok(!c.spoilerMessage, 'texto comum nao vira spoiler');
  ok(c.extendedTextMessage, 'continua extendedTextMessage');
});

console.log('\n=== 3) MIDIA MARCADA ===\n');

await test('o bloco trata imagem/video marcado (le o codigo)', () => {
  const i = SRC.indexOf("case 'spoiler':");
  ok(i > -1, 'a case existe');
  const b = SRC.slice(i, i + 2600);
  includes(b, 'isQuotedImage', 'checa imagem marcada');
  includes(b, 'isQuotedVideo', 'checa video marcado');
  includes(b, 'getFileBuffer', 'baixa a midia de verdade');
  includes(b, 'spoiler: true', 'manda como spoiler');
});

await test('!spoiler NAO esta em menu nenhum (experimental)', () => {
  const BP = fs.readFileSync(new URL('../dados/src/utils/blockPv.js', import.meta.url), 'utf8');
  ok(!BP.includes("'spoiler'"), 'nao esta no blockPv');
  const menu = fs.readFileSync(new URL('../dados/src/menus/menufig.js', import.meta.url), 'utf8');
  ok(!menu.includes('spoiler'), 'nao esta no menufig');
});

const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log('\n' + '='.repeat(40));
console.log(`RESULTADO: ${RESULTS.length} testes | ${totalOk} asserções ok | ${totalFail} falhas`);
console.log('='.repeat(40));
if (totalFail > 0) process.exit(1);
process.exit(0);
