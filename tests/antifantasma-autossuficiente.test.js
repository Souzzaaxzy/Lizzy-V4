/**
 * PROVA DE AUTOSSUFICIÊNCIA — o usuário recebe UM arquivo só.
 *
 * Copia APENAS `antiinvisivel.cjs` (configurado) para uma pasta limpa, SEM
 * nenhum arquivo do projeto (nada de core.js/api.js/keys.js/utils/), monta um
 * bot mínimo com a CASE e roda o fluxo inteiro. Se isso passar, está provado
 * que o destinatário não precisa dos "arquivos diversos" que executam o
 * sistema — aqueles ficam no servidor da Lizzy.
 *
 * Uso: node tests/antifantasma-autossuficiente.test.js
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

// ── 1) ANÁLISE ESTÁTICA: o arquivo depende só de módulos nativos ───────────
console.log('── 1. O arquivo entregue depende de algo do projeto? ──');
const fonte = fs.readFileSync(
  path.join(PROJECT, 'dados', 'src', 'antifantasma-cliente', 'antiinvisivel.cjs'), 'utf-8');

// A análise é sobre o CÓDIGO, não sobre os comentários: o cabeçalho cita
// `require('./antiinvisivel')` e o nome do plugin como documentação.
const codigo = fonte
  .replace(/\/\*[\s\S]*?\*\//g, '')   // blocos /* ... */
  .replace(/^[ \t]*\/\/.*$/gm, '');   // linhas //

const proibidos = ['core.js', 'api.js', 'keys.js', 'health.js', 'utils/', 'publicUrl'];
for (const p of proibidos) {
  check(!codigo.includes(p), `não referencia "${p}"`);
}

// Todos os require() do CÓDIGO têm de ser de módulos nativos do Node.
const requires = [...codigo.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
const naoNativos = requires.filter((r) => !r.startsWith('node:'));
check(naoNativos.length === 0, `todo require é de módulo nativo do Node (${requires.join(', ') || 'nenhum'})`);
console.log('');

// ── 2) RUNTIME: pasta LIMPA, só o arquivo entregue ────────────────────────
console.log('── 2. O arquivo roda numa pasta onde NADA do projeto existe ──');

// Servidor (a Lizzy) para responder à API.
const TMP_SERVER = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-srv-'));
process.env.DATABASE_PATH = TMP_SERVER;
fs.mkdirSync(path.join(TMP_SERVER, 'antifantasma'), { recursive: true });
const api = await import(new URL('../dados/src/antifantasma/api.js', import.meta.url).href);
const keys = await import(new URL('../dados/src/antifantasma/keys.js', import.meta.url).href);
const NUMERO = '5511999999999';
const registro = keys.criarKey({ owner: NUMERO });
const server = api.iniciarApi(0);
await sleep(250);
const endpoint = `http://127.0.0.1:${server.address().port}/api/antifantasma/exec`;

// A pasta do USUÁRIO: absolutamente nada além do arquivo que ele recebeu.
const BOT = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-user-bot-'));
const SRC = path.join(BOT, 'src');
fs.mkdirSync(SRC, { recursive: true });
fs.writeFileSync(path.join(BOT, 'package.json'), JSON.stringify({ type: 'commonjs' }));

const arquivoRecebido = fonte
  .replace(/const API_URL = '[^']*';/, `const API_URL = '${endpoint}';`)
  .replace(/const KEY = '[^']*';/, `const KEY = '${registro.key}';`)
  .replace(/const BOT_ID = '[^']*';/, `const BOT_ID = '${NUMERO}';`);
fs.writeFileSync(path.join(SRC, 'antiinvisivel.cjs'), arquivoRecebido);

const arquivosNaPasta = fs.readdirSync(SRC);
check(arquivosNaPasta.length === 1 && arquivosNaPasta[0] === 'antiinvisivel.cjs',
  `a pasta do usuário tem SÓ o arquivo entregue (${arquivosNaPasta.join(', ')})`);

// Prova de que não há nada do projeto por perto: buscar uma dependência
// interna deve falhar.
let achouInterno = false;
try { require(path.join(SRC, 'core.js')); achouInterno = true; } catch { /* esperado */ }
check(!achouInterno, 'não há core.js na pasta do bot (ele fica no servidor)');

// ── 3) A CASE do tutorial, colada, roda com esse único arquivo ────────────
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

const GRUPO = '120363000000000000@g.us';
const ATACANTE = '5511888888888@s.whatsapp.net';
const acoes = [];
const respostas = [];

const nazu = new EventEmitter();
nazu.user = { id: `${NUMERO}:5@s.whatsapp.net` };
nazu.groupMetadata = async () => ({
  participants: [
    { id: `${NUMERO}@s.whatsapp.net`, admin: 'admin' },
    { id: ATACANTE, admin: null },
  ],
});
nazu.groupSettingUpdate = async (g, t) => { acoes.push(`setting:${t}`); };
nazu.groupParticipantsUpdate = async (g, a, c) => { acoes.push(`participants:${c}`); };
nazu.sendMessage = async () => { acoes.push('aviso'); };

const montarCase = new Function(
  'isGroup', 'isGroupAdmin', 'isBotAdmin', 'reply', 'nazu', 'from', 'info', 'require', 'console',
  `return (async () => { switch ('antifantasma') { ${CASE}\n } })();`);

const requireDoBot = (p) => {
  if (/antiinvisivel/.test(p)) return require(path.join(SRC, 'antiinvisivel.cjs'));
  return require(p);
};

console.log('\n── 3. Ativar e receber um ataque (sem nada do projeto na pasta) ──');
await montarCase(true, true, true, async (t) => respostas.push(t), nazu, GRUPO, { key: {} }, requireDoBot, console);
check(respostas.some((t) => /ativado/i.test(t)), 'a CASE ativou');

const ataque = {
  key: { remoteJid: GRUPO, fromMe: false, participant: ATACANTE },
  message: undefined,
  messageStubType: 2,
  selectiveDistribution: true,
};
const evento = { messages: [ataque], type: 'notify', nazu };
nazu.emit('messages.upsert', evento);
await esperar(() => acoes.length >= 3);

check(acoes.includes('setting:announcement'), 'grupo FECHADO');
check(acoes.includes('participants:remove'), 'atacante BANIDO');
check(acoes.includes('setting:not_announcement'), 'grupo REABERTO');

// ── 4) A decisão continua vindo do servidor ───────────────────────────────
console.log('\n── 4. A regra continua privada ──');
check(!fonte.includes('selectiveDistribution &&') && !fonte.includes('decidir(') && !fonte.includes('core'),
  'o arquivo do usuário NÃO contém a lógica de decisão');

await new Promise((r) => server.close(r));
fs.rmSync(BOT, { recursive: true, force: true });
fs.rmSync(TMP_SERVER, { recursive: true, force: true });

console.log('\n════════════════════════════════════════');
console.log(`RESULTADO: ${ok} ok | ${fail} falhas`);
console.log('════════════════════════════════════════');
if (fail) { console.log('\nFALHAS:'); for (const e of erros) console.log(`- ${e}`); process.exit(1); }
console.log('✅ UM ARQUIVO SÓ, SEM NADA DO PROJETO, FUNCIONA DE PONTA A PONTA');