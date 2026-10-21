/**
 * Testes do !testebn — COMANDO DE TESTE / BRINCADEIRA (PRANK).
 *
 * Uso: node tests/testebn.test.js
 */
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-testebn-db-'));
process.env.DATABASE_PATH = TMP_DB;
const GRUPOS_DIR = path.join(TMP_DB, 'grupos');
fs.mkdirSync(GRUPOS_DIR, { recursive: true });

const RESULTS = [];
let CURRENT = null;
function test(name, fn) {
  CURRENT = { name, passed: 0, failed: 0, errors: [] };
  RESULTS.push(CURRENT);
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.then(() => finish()).catch((e) => { CURRENT.failed++; CURRENT.errors.push(`EXCEÇÃO: ${e?.stack || e}`); finish(); });
    }
    finish();
  } catch (e) { CURRENT.failed++; CURRENT.errors.push(`EXCEÇÃO: ${e?.stack || e}`); finish(); }
  return Promise.resolve();
}
function finish() {
  console.log(`${CURRENT.failed === 0 ? '✅' : '❌'} ${CURRENT.name} (${CURRENT.passed} ok, ${CURRENT.failed} falhas)`);
  for (const err of CURRENT.errors) console.log(`     ${err.split('\n')[0]}`);
}
function ok(c, m) { if (c) CURRENT.passed++; else { CURRENT.failed++; CURRENT.errors.push(`ASSERT FALHOU: ${m}`); } }

const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;
const { testebn } = await import(new URL('../dados/src/funcs/utils/testebn.js', import.meta.url).href);

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';
const ADM_A = '111000000000001@lid';
const ADM_B = '111000000000002@lid';
const MEM_1 = '222000000000001@lid';
const MEM_2 = '222000000000002@lid';

let groupCounter = 0;
function makeGroup() {
  groupCounter += 1;
  const jid = `1203637000000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(path.join(GRUPOS_DIR, `${jid}.json`), JSON.stringify({ groupName: 'Grupo Testebn' }, null, 2));
  return jid;
}

const PARTICIPANTS = [
  { id: BOT_LID, lid: BOT_LID, phoneNumber: BOT_JID, admin: 'admin' },
  { id: ADM_A, lid: ADM_A, admin: 'superadmin' },
  { id: ADM_B, lid: ADM_B, admin: 'admin' },
  { id: MEM_1, lid: MEM_1, admin: null },
  { id: MEM_2, lid: MEM_2, admin: null },
];

function makeNazu({ sent, groupJid }) {
  return {
    sendMessage: async (jid, content, options) => { sent.push({ jid, content, options, via: 'sendMessage' }); return { key: { id: `S${sent.length}` } }; },
    relayMessage: async (jid, message, options) => { sent.push({ jid, message, options, via: 'relayMessage' }); return options?.messageId; },
    user: { id: BOT_JID, lid: BOT_LID, name: 'Lizzy' },
    groupMetadata: async () => ({ id: groupJid, subject: 'Grupo Testebn', participants: PARTICIPANTS }),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {},
    sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => 'x',
    react: async () => ({}),
  };
}

let cenario = 0;
async function rodar({ groupJid, text = '!testebn', fromMe = true }) {
  cenario += 1;
  const sent = [];
  const nazu = makeNazu({ sent, groupJid });
  await handleMessage(nazu, {
    key: { remoteJid: groupJid, fromMe, id: `M-${cenario}`, participant: fromMe ? BOT_LID : MEM_1 },
    message: { extendedTextMessage: { text, contextInfo: { remoteJid: groupJid } } },
    messageTimestamp: 1757900000,
    pushName: 'Tester',
  }, null);
  return { sent, nazu };
}

console.log('\n=== !testebn — COMANDO DE TESTE / BRINCADEIRA ===\n');

await test('manda 10 payments por membro comum, so pros membros (admins fora)', async () => {
  const g = makeGroup();
  const { sent } = await rodar({ groupJid: g });
  const relay = sent.filter(s => s.via === 'relayMessage');
  // 2 membros comuns x 10 = 20
  ok(relay.length === 20, `20 envios (2 membros x 10), veio ${relay.length}`);
  const destinos = [...new Set(relay.map(r => r.jid))].sort();
  ok(destinos.length === 2, `2 destinatarios distintos, veio ${destinos.length}`);
  ok(destinos.includes(MEM_1) && destinos.includes(MEM_2), 'destinos sao os 2 membros comuns');
  ok(!destinos.includes(ADM_A) && !destinos.includes(ADM_B), 'nenhum admin recebeu');
  ok(!destinos.includes(g), 'NADA foi para o JID do grupo');
  ok(!destinos.includes(BOT_JID) && !destinos.includes(BOT_LID), 'a propria bot nao recebeu');
});

await test('nota e exatamente "teste, teste, bn" e o tipo e requestPaymentMessage', async () => {
  const g = makeGroup();
  const { sent } = await rodar({ groupJid: g });
  const relay = sent.filter(s => s.via === 'relayMessage');
  for (const r of relay) {
    const p = r.message.requestPaymentMessage;
    ok(!!p, 'tem requestPaymentMessage');
    ok(p.noteMessage.extendedTextMessage.text === 'teste, teste, bn', `nota correta (${p.noteMessage?.extendedTextMessage?.text})`);
    ok(p.currencyCodeIso4217 === 'BRL', 'moeda BRL');
    ok(String(p.amount1000) === '1000', `amount1000 1000 (${p.amount1000})`);
  }
});

await test('confirmacao vai SO no 1:1 de quem digitou (nunca no grupo)', async () => {
  const g = makeGroup();
  const { sent } = await rodar({ groupJid: g });
  const confirms = sent.filter(s => s.via === 'sendMessage');
  ok(confirms.length === 1, `1 confirmacao, veio ${confirms.length}`);
  ok(confirms[0].jid === BOT_LID || confirms[0].jid === BOT_JID, 'confirmacao no 1:1 do dono');
  ok(confirms[0].jid !== g, 'confirmacao NAO foi para o grupo');
  ok(/testebn \(teste\): \d+ enviados em \d+ membros/.test(confirms[0].content.text), `texto da confirmacao (${confirms[0].content.text})`);
});

await test('membro comum (nao-dono) nao dispara nada', async () => {
  const g = makeGroup();
  const { sent } = await rodar({ groupJid: g, fromMe: false });
  const relay = sent.filter(s => s.via === 'relayMessage');
  ok(relay.length === 0, `nenhum envio para membro comum, veio ${relay.length}`);
});

await test('o modulo respeita rate-limit (aborta e devolve parcial)', async () => {
  const sent = [];
  const nazu = {
    user: { id: BOT_JID, lid: BOT_LID },
    groupMetadata: async () => ({ participants: PARTICIPANTS }),
    relayMessage: async () => { sent.push(1); if (sent.length >= 3) { const e = new Error('429 Too Many Requests'); throw e; } },
  };
  const r = await testebn(nazu, 'x@g.us');
  ok(r.aborted === 'rate-limit', `abortou por rate-limit (${r.aborted})`);
  ok(r.sent === 2, `enviou 2 antes do 429 (${r.sent})`);
});

await test('nao esta em menu nenhum nem no blockPv', async () => {
  const src = fs.readFileSync(new URL('../dados/src/index.js', import.meta.url), 'utf8');
  ok(src.includes("case 'testebn'"), 'a case existe no handler');
  const menus = fs.readdirSync(new URL('../dados/src/menus/', import.meta.url)).filter(f => f.endsWith('.js'));
  for (const m of menus) {
    const c = fs.readFileSync(new URL(`../dados/src/menus/${m}`, import.meta.url), 'utf8');
    ok(!c.includes('testebn'), `${m} nao menciona testebn`);
  }
  const blockPv = fs.readFileSync(new URL('../dados/src/utils/blockPv.js', import.meta.url), 'utf8');
  ok(!blockPv.includes('testebn'), 'blockPv nao menciona testebn');
});

console.log('\n=== RESUMO ===');
const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log(`${RESULTS.length} testes / ${totalOk} assercoes ok / ${totalFail} falhas`);
process.exit(totalFail === 0 ? 0 : 1);
