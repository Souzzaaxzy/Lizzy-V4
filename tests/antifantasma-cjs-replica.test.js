/**
 * RÉPLICA DO BOT DESTINATÁRIO CommonJS.
 *
 * Complementa o teste ESM: o arquivo entregue tem de funcionar nos DOIS tipos de
 * bot. Aqui o bot é CommonJS (`require` existe) e usa a CASE do tutorial.
 *
 * Uso: node tests/antifantasma-cjs-replica.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { EventEmitter } from 'node:events';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');
const require = createRequire(import.meta.url);

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-cjs-bot-'));
fs.mkdirSync(path.join(TMP, 'src'), { recursive: true });
process.env.DATABASE_PATH = TMP;
fs.mkdirSync(path.join(TMP, 'antifantasma'), { recursive: true });

const api = await import(new URL('../dados/src/antifantasma/api.js', import.meta.url).href);
const keys = await import(new URL('../dados/src/antifantasma/keys.js', import.meta.url).href);
const NUMERO = '5511999999999';
const registro = keys.criarKey({ owner: NUMERO });
const server = api.iniciarApi(0);
await new Promise((r) => setTimeout(r, 250));
const endpoint = `http://127.0.0.1:${server.address().port}/api/antifantasma/exec`;

// O bot é CommonJS.
fs.writeFileSync(path.join(TMP, 'package.json'), JSON.stringify({ type: 'commonjs' }, null, 2));

const cliente = fs.readFileSync(
  path.join(PROJECT, 'dados', 'src', 'antifantasma-cliente', 'antifantasma.cjs'), 'utf-8')
  .replace(/const API_URL = '[^']*';/, `const API_URL = '${endpoint}';`)
  .replace(/const KEY = '[^']*';/, `const KEY = '${registro.key}';`)
  .replace(/const BOT_ID = '[^']*';/, `const BOT_ID = '${NUMERO}';`);
fs.writeFileSync(path.join(TMP, 'src', 'antifantasma.cjs'), cliente);

function extrairCase(src) {
  const marca = 'const CASE_COMPLETA = `';
  const i = src.indexOf(marca) + marca.length - 1;
  let j = i + 1, esc = false;
  while (j < src.length) {
    const ch = src[j];
    if (esc) { esc = false; j += 1; continue; }
    if (ch === '\\') { esc = true; j += 1; continue; }
    if (ch === '`') break;
    j += 1;
  }
  return new Function(`return ${src.slice(i, j + 1)}`)();
}
const CASE = extrairCase(fs.readFileSync(path.join(PROJECT, 'dados', 'src', 'index.js'), 'utf-8'));

const botIndex = `
const { EventEmitter } = require('node:events');

const nazu = new EventEmitter();
nazu.user = { id: '5511999999999:5@s.whatsapp.net' };
nazu.groupMetadata = async () => ({
  participants: [
    { id: '5511999999999@s.whatsapp.net', admin: 'admin' },
    { id: '5511888888888@s.whatsapp.net', admin: null },
  ],
});
const acoes = [];
nazu.groupSettingUpdate = async (g, t) => { acoes.push('setting:' + t); };
nazu.groupParticipantsUpdate = async (g, a, c) => { acoes.push('participants:' + c); };
nazu.sendMessage = async () => { acoes.push('aviso'); };

const isGroup = true, isGroupAdmin = true, isBotAdmin = true;
const from = '120363000000000000@g.us';
const info = { key: { remoteJid: from } };
const respostas = [];
const reply = async (t) => { respostas.push(t); };

async function rodarComando() {
  switch ('antifantasma') {
${CASE}
  }
}

module.exports = { nazu, from, acoes, respostas, rodarComando };
`;
fs.writeFileSync(path.join(TMP, 'src', 'index.js'), botIndex);

let ok = 0, fail = 0;
const erros = [];
function check(cond, msg) {
  if (cond) { ok += 1; console.log(`✅ ${msg}`); }
  else { fail += 1; erros.push(msg); console.log(`❌ ${msg}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function esperar(cond, ms = 1500) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) { if (cond()) return true; await sleep(25); }
  return cond();
}

console.log('── bot do usuário: CommonJS ("require" existe) ──\n');

const mod = require(path.join(TMP, 'src', 'index.js'));
const { acoes, respostas, nazu, rodarComando } = mod;

await rodarComando();
await sleep(200);

check(!respostas.some((t) => /Ocorreu um erro/i.test(t)), 'o comando não cai no catch');
check(respostas.some((t) => /ativado/i.test(t)), 'o comando ativou a proteção');

const ataque = {
  key: { remoteJid: mod.from, fromMe: false, participant: '5511888888888@s.whatsapp.net' },
  message: undefined,
  messageStubType: 2,
  selectiveDistribution: {
    kind: 'selective-distribution',
    messageId: 'SEL-1',
    encType: 'skmsg',
    decryptFail: 'hide',
    addressedDeviceCount: 1,
  },
};
const evento = { messages: [ataque], type: 'notify', nazu };
nazu.emit('messages.upsert', evento);
await esperar(() => acoes.length >= 3, 2000);

check(acoes.includes('setting:announcement'), 'grupo FECHADO');
check(acoes.includes('participants:remove'), 'atacante BANIDO');
check(acoes.includes('setting:not_announcement'), 'grupo REABERTO');

await new Promise((r) => server.close(r));
console.log('\n════════════════════════════════════════');
console.log(`RESULTADO: ${ok} ok | ${fail} falhas`);
console.log('════════════════════════════════════════');
fs.rmSync(TMP, { recursive: true, force: true });
if (fail) { console.log('\nFALHAS:'); for (const e of erros) console.log(`- ${e}`); process.exit(1); }
console.log('✅ bot CommonJS funciona de ponta a ponta');