/**
 * TESTE DE INSTALAÇÃO LIMPA — o critério definitivo (seção 14/20).
 *
 * Simula um bot destinatário que NÃO tem integração Anti-Fantasma. Ele recebe
 * APENAS duas coisas:
 *
 *   1. o arquivo `antifantasma.cjs` na pasta `src/`;
 *   2. a CASE COMPLETA, extraída LITERALMENTE do `index.js` da Lizzy (a mesma
 *      que o `!addghostcmd` entrega no tutorial).
 *
 * O teste NÃO adiciona `antiFantasma.executar(...)` em nenhum lugar, NÃO cria
 * outra case e NÃO registra nenhum listener manual. Se a proteção contínua
 * funcionar assim, o sistema está corrigido.
 *
 * Uso: node tests/antifantasma-instalacao-limpa.test.js
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

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-clean-install-'));
process.env.DATABASE_PATH = TMP;
fs.mkdirSync(path.join(TMP, 'antifantasma'), { recursive: true });

const api = await import(new URL('../dados/src/antifantasma/api.js', import.meta.url).href);
const keys = await import(new URL('../dados/src/antifantasma/keys.js', import.meta.url).href);

let ok = 0;
let fail = 0;
const erros = [];
function check(cond, msg) {
  if (cond) { ok += 1; console.log(`✅ ${msg}`); }
  else { fail += 1; erros.push(msg); console.log(`❌ ${msg}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function esperar(cond, ms = 1500) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    if (cond()) return true;
    await sleep(25);
  }
  return cond();
}

const NUMERO = '5511999999999';
const BOT_JID = `${NUMERO}@s.whatsapp.net`;
const ATACANTE = '5511888888888@s.whatsapp.net';
const GRUPO = '120363000000000000@g.us';
const GRUPO_B = '120363111111111111@g.us';

console.log('── 0. Lizzy gera a KEY e entrega o arquivo ──');
const registro = keys.criarKey({ owner: NUMERO });
check(Boolean(registro.key), `key #${registro.id} gerada`);

const server = api.iniciarApi(0);
await sleep(250);
const endpoint = `http://127.0.0.1:${server.address().port}/api/antifantasma/exec`;

const CAMINHO_CLIENTE = path.join(PROJECT, 'dados', 'src', 'antifantasma-cliente', 'antifantasma.cjs');
check(fs.existsSync(CAMINHO_CLIENTE), 'o entregável se chama antifantasma.cjs');
const fonte = fs.readFileSync(CAMINHO_CLIENTE, 'utf-8');
const entregue = fonte
  .replace(/const API_URL = '[^']*';/, `const API_URL = '${endpoint}';`)
  .replace(/const KEY = '[^']*';/, `const KEY = '${registro.key}';`)
  .replace(/const BOT_ID = '[^']*';/, `const BOT_ID = '${NUMERO}';`);

// O usuário coloca o arquivo em src/. O repo é ESM, então materializamos como
// .cjs (o adaptador é CommonJS, como o `require()` dele espera).
const DESTINO = path.join(TMP, 'antifantasma.cjs');
fs.writeFileSync(DESTINO, entregue);

// ── A CASE COMPLETA, extraída LITERALMENTE do index.js ─────────────────────
function extrairCaseCompleta(src) {
  const marca = 'const CASE_COMPLETA = `';
  const i = src.indexOf(marca) + marca.length - 1; // posição do backtick de abertura
  let j = i + 1;
  let esc = false;
  while (j < src.length) {
    const ch = src[j];
    if (esc) { esc = false; j += 1; continue; }
    if (ch === '\\') { esc = true; j += 1; continue; }
    if (ch === '`') break;
    j += 1;
  }
  const literal = src.slice(i, j + 1);
  // eslint-disable-next-line no-new-func
  return new Function(`return ${literal}`)();
}

const INDEX_SRC = fs.readFileSync(path.join(PROJECT, 'dados', 'src', 'index.js'), 'utf-8');
const CASE = extrairCaseCompleta(INDEX_SRC);

console.log('\n── 0.1 A CASE entregue é a correta ──');
check(CASE.includes("case 'antifantasma'"), 'a CASE traz o case antifantasma');
check(/require\(['"]\.\/antifantasma\.cjs['"]\)/.test(CASE), "a CASE usa require('./antifantasma.cjs')");
check(CASE.indexOf("require('./antifantasma.cjs')") > CASE.indexOf("case 'antifantasma'"),
  'o require está DENTRO da case (regra absoluta da seção 4)');
check(/\.iniciar\s*\(/.test(CASE), 'a CASE liga a proteção contínua via iniciar()');
check(!/antiFantasma\.executar/.test(CASE), 'a CASE não exige chamada manual no handler');

// ── A "bot do usuário" (só a CASE + o arquivo) ─────────────────────────────
function criarSocket() {
  // O socket do Baileys expõe o EventEmitter em `.ev` (é onde o bot já registra
  // os próprios listeners: `nazu.ev.on('messages.upsert', ...)`).
  const ev = new EventEmitter();
  const sock = new EventEmitter();
  sock.ev = ev;
  sock.user = { id: `${NUMERO}:5@s.whatsapp.net` };
  sock.groupMetadata = async () => ({
    participants: [
      { id: BOT_JID, admin: 'admin' },
      { id: ATACANTE, admin: null },
    ],
  });
  return sock;
}

function montarCase(caseCode, ctx) {
  const fn = new Function(
    'isGroup', 'isGroupAdmin', 'isBotAdmin', 'reply', 'nazu', 'from', 'info', 'require', 'console',
    `return (async () => { switch ('antifantasma') { ${caseCode}\n } })();`,
  );
  const requireShim = (p) => {
    if (p === './antifantasma.cjs' || p === './antifantasma' || p === './antifantasma') return require(DESTINO);
    return require(p);
  };
  return fn(
    ctx.isGroup, ctx.isGroupAdmin, ctx.isBotAdmin,
    ctx.reply, ctx.nazu, ctx.from, ctx.info, requireShim, console,
  );
}

const ATAQUE = {
  key: { remoteJid: GRUPO, fromMe: false, participant: ATACANTE },
  message: undefined,
  messageStubType: 2,
  selectiveDistribution: true,
};
const NORMAL = {
  key: { remoteJid: GRUPO, fromMe: false, participant: ATACANTE },
  message: { conversation: 'bom dia' },
};

console.log('\n── 1. O usuário reinicia o bot e roda !antifantasma (ATIVAR) ──');
delete require.cache[require.resolve(DESTINO)]; // reinício: módulo fresco
const sock = criarSocket();
const acoes = [];
sock.groupSettingUpdate = async (g, t) => { acoes.push(`setting:${t}`); };
sock.groupParticipantsUpdate = async (g, a, c) => { acoes.push(`participants:${c}:${a[0]}`); };
sock.sendMessage = async () => { acoes.push('aviso'); };

const respostas = [];
await montarCase(CASE, {
  isGroup: true, isGroupAdmin: true, isBotAdmin: true,
  reply: async (t) => { respostas.push(t); },
  nazu: sock, from: GRUPO, info: { key: { remoteJid: GRUPO } },
});
check(respostas.some((t) => /ativado/i.test(t)), 'a CASE respondeu "ativado"');

console.log('\n── 2. Chega um ATAQUE (sem NENHUMA chamada manual) ──');
sock.ev.emit("messages.upsert", { messages: [ATAQUE], type: 'notify' });
await esperar(() => acoes.length >= 3);
check(acoes.includes('setting:announcement'), 'grupo FECHADO (proteção contínua ativa)');
check(acoes.includes(`participants:remove:${ATACANTE}`), 'atacante BANIDO');
check(acoes.includes('setting:not_announcement'), 'grupo REABERTO');
check(acoes.includes('aviso'), 'aviso publicado');

console.log('\n── 3. Mensagem NORMAL: nada acontece ──');
const antesNormal = acoes.length;
sock.ev.emit("messages.upsert", { messages: [NORMAL], type: 'notify' });
await sleep(400);
check(acoes.length === antesNormal, 'mensagem normal não gera ação');

console.log('\n── 4. !antifantasma de novo (DESATIVAR) ──');
respostas.length = 0;
await montarCase(CASE, {
  isGroup: true, isGroupAdmin: true, isBotAdmin: true,
  reply: async (t) => { respostas.push(t); },
  nazu: sock, from: GRUPO, info: { key: { remoteJid: GRUPO } },
});
check(respostas.some((t) => /desativado/i.test(t)), 'a CASE respondeu "desativado"');
const antesOff = acoes.length;
sock.ev.emit("messages.upsert", { messages: [ATAQUE], type: 'notify' });
await sleep(500);
check(acoes.length === antesOff, 'desativado: proteção parou (nenhuma ação)');

console.log('\n── 5. Permissões da CASE (comando normal) ──');
for (const [nome, ctx] of [
  ['fora de grupo', { isGroup: false, isGroupAdmin: true, isBotAdmin: true }],
  ['usuário não-admin', { isGroup: true, isGroupAdmin: false, isBotAdmin: true }],
  ['bot não-admin', { isGroup: true, isGroupAdmin: true, isBotAdmin: false }],
]) {
  const r = [];
  await montarCase(CASE, {
    ...ctx,
    reply: async (t) => { r.push(t); },
    nazu: sock, from: '5511888888888@s.whatsapp.net', info: { key: {} },
  });
  check(r.length === 1 && !/ativado|desativado/i.test(r[0]), `bloqueado: ${nome}`);
}

console.log('\n── 6. Estado por grupo (Grupo A ≠ Grupo B) ──');
delete require.cache[require.resolve(DESTINO)];
const sockB = criarSocket();
const acoesB = [];
sockB.groupSettingUpdate = async (g, t) => { acoesB.push(`setting:${t}`); };
sockB.groupParticipantsUpdate = async (g, a, c) => { acoesB.push(`participants:${c}`); };
sockB.sendMessage = async () => { acoesB.push('aviso'); };

// Ativa SÓ o grupo A.
await montarCase(CASE, {
  isGroup: true, isGroupAdmin: true, isBotAdmin: true,
  reply: async () => {}, nazu: sockB, from: GRUPO, info: { key: {} },
});
const ataqueB = { ...ATAQUE, key: { ...ATAQUE.key, remoteJid: GRUPO_B } };
sockB.ev.emit("messages.upsert", { messages: [ataqueB], type: 'notify' });
await sleep(500);
check(acoesB.length === 0, 'Grupo B continua DESPROTEGIDO (estado não é global)');

sockB.ev.emit("messages.upsert", { messages: [ATAQUE], type: 'notify' });
await esperar(() => acoesB.length >= 3);
check(acoesB.includes('setting:announcement'), 'Grupo A protegido');

await new Promise((r) => server.close(r));

console.log('\n════════════════════════════════════════');
console.log(`RESULTADO: ${ok} ok | ${fail} falhas`);
console.log('════════════════════════════════════════');

fs.rmSync(TMP, { recursive: true, force: true });
if (fail) { console.log('\nFALHAS:'); for (const e of erros) console.log(`- ${e}`); process.exit(1); }
console.log('✅ INSTALAÇÃO LIMPA FUNCIONA DE PONTA A PONTA');