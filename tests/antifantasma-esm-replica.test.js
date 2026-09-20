/**
 * RÉPLICA FIEL DO BOT DESTINATÁRIO (ESM, como a própria Lizzy).
 *
 * Monta um bot que é ESM (`"type": "module"`), tem os MESMOS nomes reais que a
 * Lizzy usa (nazu, from, info, isGroup, isGroupAdmin, isBotAdmin, reply) e
 * recebe APENAS: o arquivo antifantasma.cjs + a CASE do tutorial.
 *
 * Uso: node tests/antifantasma-esm-replica.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-esm-bot-'));
fs.mkdirSync(path.join(TMP, 'src'), { recursive: true });
process.env.DATABASE_PATH = TMP;
fs.mkdirSync(path.join(TMP, 'antifantasma'), { recursive: true });

// ── A Lizzy (servidor) cria a KEY e sobe a API real ────────────────────────
const api = await import(new URL('../dados/src/antifantasma/api.js', import.meta.url).href);
const keys = await import(new URL('../dados/src/antifantasma/keys.js', import.meta.url).href);
const NUMERO = '5511999999999';
const registro = keys.criarKey({ owner: NUMERO });
const server = api.iniciarApi(0);
await new Promise((r) => setTimeout(r, 250));
const endpoint = `http://127.0.0.1:${server.address().port}/api/antifantasma/exec`;

// ── O bot do usuário é ESM (é o que a Lizzy é) ─────────────────────────────
fs.writeFileSync(path.join(TMP, 'package.json'), JSON.stringify({ type: 'module' }, null, 2));

// ── O arquivo entregue, como o !addghostcmd monta (já configurado) ─────────
const cliente = fs.readFileSync(
  path.join(PROJECT, 'dados', 'src', 'antifantasma-cliente', 'antifantasma.cjs'), 'utf-8')
  .replace(/const API_URL = '[^']*';/, `const API_URL = '${endpoint}';`)
  .replace(/const KEY = '[^']*';/, `const KEY = '${registro.key}';`)
  .replace(/const BOT_ID = '[^']*';/, `const BOT_ID = '${NUMERO}';`);

// ── A CASE, extraída literalmente do index.js ─────────────────────────────
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
const INDEX_SRC = fs.readFileSync(path.join(PROJECT, 'dados', 'src', 'index.js'), 'utf-8');
const CASE = extrairCase(INDEX_SRC);

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

// ── 0) A CAUSA RAIZ de "não funciona": a CASE tem de carregar o arquivo de um
//       jeito que funcione em ESM. `require` puro estoura num bot ESM.
console.log('── 0. A CASE carrega o arquivo de forma compatível? ──');
check(/typeof\s+require\s*===\s*['"]function['"]/.test(CASE),
  'a CASE testa se `require` existe antes de usar');
check(/import\(['"]\.\/antifantasma\.cjs['"]\)/.test(CASE),
  'a CASE tem o caminho ESM (import dinâmico do .cjs)');
check(/require\(['"]\.\/antifantasma\.cjs['"]\)/.test(CASE),
  'a CASE mantém o caminho CommonJS');
check(!/require\(['"]\.\/antifantasma\.js['"]\)/.test(CASE),
  'a CASE NÃO usa o .js (quebraria em bot ESM)');
check(/typeof\s+nazu\s*!==\s*['"]undefined['"]/.test(CASE),
  'a CASE só chama iniciar(nazu) se nazu existir');
console.log('');

// O usuário coloca o arquivo em src/, com o nome que o tutorial manda.
const NOME = process.argv[2] || 'antifantasma.cjs';
fs.writeFileSync(path.join(TMP, 'src', NOME), cliente);

// ── O index.js do bot: ESM, com os nomes reais, com a CASE colada ─────────
const botIndex = `
import { EventEmitter } from 'node:events';

// ---- variáveis reais que a CASE espera no escopo (iguais às da Lizzy) ----
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

// ---- A CASE COLADA PELO USUÁRIO (idêntica à do tutorial) ----
async function rodarComando() {
  switch ('antifantasma') {
${CASE}
  }
}

// ---- resultado ----
export { nazu, from, acoes, respostas, rodarComando };
`;
fs.writeFileSync(path.join(TMP, 'src', 'index.js'), botIndex);


console.log('── bot do usuário: ESM ("type":"module"), como a Lizzy ──');
console.log(`── arquivo entregue como: src/${NOME} ──\n`);

const mod = await import(path.join(TMP, 'src', 'index.js'));
const { acoes, respostas, nazu, rodarComando } = mod;

// 1) Rodar o comando (é o que o usuário faz)
await rodarComando();
await sleep(200);

console.log('respostas do comando:', JSON.stringify(respostas));
check(!respostas.some((t) => /Ocorreu um erro/i.test(t)),
  'o comando NÃO cai no catch ("Ocorreu um erro")');
check(respostas.some((t) => /ativado/i.test(t)), 'o comando ativou a proteção');

// 2) A proteção contínua foi ligada?
const ataque = {
  key: { remoteJid: mod.from, fromMe: false, participant: '5511888888888@s.whatsapp.net' },
  message: undefined,
  messageStubType: 2,
  selectiveDistribution: true,
};

// O Baileys entrega o evento COM O SOCKET anexado; é assim que o módulo
// descobre o socket sozinho quando a CASE não pôde chamar `iniciar` (ESM).
// Emitimos das duas formas que um bot real pode usar: `nazu.ev` e `nazu`.
const evento = { messages: [ataque], type: 'notify', nazu, sock: nazu };
if (typeof nazu.ev?.emit === 'function') nazu.ev.emit('messages.upsert', evento);
if (typeof nazu.emit === 'function') nazu.emit('messages.upsert', evento);

await esperar(() => acoes.length >= 3, 2000);

check(acoes.includes('setting:announcement'), 'grupo FECHADO (proteção rodou)');
check(acoes.includes('participants:remove'), 'atacante BANIDO');
check(acoes.includes('setting:not_announcement'), 'grupo REABERTO');

console.log('\n════════════════════════════════════════');
console.log(`RESULTADO: ${ok} ok | ${fail} falhas`);
console.log('════════════════════════════════════════');
if (fail) { console.log('\nFALHAS:'); for (const e of erros) console.log(`- ${e}`); }

await new Promise((r) => server.close(r));
fs.rmSync(TMP, { recursive: true, force: true });