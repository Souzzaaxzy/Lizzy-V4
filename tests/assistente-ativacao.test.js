/**
 * Testes da ATIVACAO da assistente por NOME / MENCAO.
 *
 * O dono relatou: *"ela so me responde quando eu respondo uma mensagem dela"*.
 * As outras duas vias (nome e @menção) nao funcionavam. Duas causas MEDIDAS:
 *
 *   1. `checkBotNameMention` montava o regex com o `nomebot` CRU do config, que
 *      e' `𝐋𝐢𝐳𝐳𝐲 𝐝𝐨 𝐩𝐫𝐢𝐯𝐲` em MATHEMATICAL BOLD — procurar os glifos nunca casa
 *      com "Lizzy", e o nome INTEIRO nao casa com quem chama so' "Lizzy";
 *   2. a guarda do handler exigia `textoLimpo.length > 2`, entao quem manda so'
 *      "Lizzy" (texto limpo fica vazio) era descartado.
 *
 * Uso: node tests/assistente-ativacao.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-ativ-'));
process.env.DATABASE_PATH = TMP_DB;
process.env.CONFIG_PATH = path.join(TMP_DB, 'config.json');
fs.mkdirSync(path.join(TMP_DB, 'grupos'), { recursive: true });
fs.mkdirSync(path.join(TMP_DB, 'dono'), { recursive: true });
// O nome REAL do dono: em MATHEMATICAL BOLD, como no config dele.
const NOME_BOLD = '\u{1D5D9}\u{1D5E2}\u{1D5DB}\u{1D5DB}\u{1D606} \u{1D5D9}\u{1D5FC} \u{1D5FD}\u{1D5FF}\u{1D5F2}\u{1D603}\u{1D606}';
fs.writeFileSync(process.env.CONFIG_PATH, JSON.stringify({
  prefixo: '!', nomebot: NOME_BOLD, nomedono: 'Kannon',
  numerodono: '5511915323638', debug: false
}, null, 2));

const ia = await import(new URL('../dados/src/funcs/private/ia.js', import.meta.url).href);
const groq = await import(new URL('../dados/src/utils/groqClient.js', import.meta.url).href);
const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;

const RESULTS = [];
let CURRENT = null;
function test(name, fn) {
  CURRENT = { name, passed: 0, failed: 0, errors: [] };
  RESULTS.push(CURRENT);
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      return r.then(() => finish(name)).catch((e) => { CURRENT.failed += 1; CURRENT.errors.push(`EXCECAO: ${e?.stack || e}`); finish(name); });
    }
    finish(name);
  } catch (e) { CURRENT.failed += 1; CURRENT.errors.push(`EXCECAO: ${e?.stack || e}`); finish(name); }
  return Promise.resolve();
}
function finish(name) {
  console.log(`${CURRENT.failed === 0 ? 'OK ' : 'ERR'} ${name} (${CURRENT.passed} ok, ${CURRENT.failed} falhas)`);
  for (const err of CURRENT.errors) console.log(`     ${err.split('\n')[0]}`);
}
function ok(c, m) { if (c) CURRENT.passed += 1; else { CURRENT.failed += 1; CURRENT.errors.push(`ASSERT FALHOU: ${m}`); } }
function contem(h, n, l) { ok(typeof h === 'string' && h.includes(n), `${l ?? n} — esperado conter "${n}"`); }
function naoContem(h, n, l) { ok(typeof h === 'string' && !h.includes(n), `${l ?? n} — NAO deveria conter "${n}"`); }

const INDEX = fs.readFileSync(new URL('../dados/src/index.js', import.meta.url), 'utf-8');

// ---------------------------------------------------------------------------
// 1) O DETECTOR DE NOME (a causa raiz)
// ---------------------------------------------------------------------------
console.log('\n=== 1) DETECTOR DE NOME ===\n');

await test('1. reconhece "Lizzy" apesar do MATHEMATICAL BOLD no config', () => {
  // O config tem os glifos; quem digita escreve ASCII.
  ok(ia.checkBotNameMention('Lizzy').mentioned, 'o nome puro e reconhecido');
  ok(ia.checkBotNameMention('LIZZY').mentioned, 'caixa alta tambem');
  ok(ia.checkBotNameMention('oi Lizzy').mentioned, 'no meio da frase tambem');
});

await test('2. o nome sai do texto (o que sobra e a mensagem)', () => {
  ok(ia.checkBotNameMention('oi Lizzy').cleanedText === 'oi', 'sobrou "oi"');
  ok(ia.checkBotNameMention('Lizzy, me conta uma coisa').cleanedText === 'me conta uma coisa',
    'tirou o nome e a virgula');
  ok(ia.checkBotNameMention('Lizzy').cleanedText === '', 'so o nome -> texto vazio');
});

await test('3. "Lizzy" no meio de outra palavra NAO conta', () => {
  ok(!ia.checkBotNameMention('Lizzyanne').mentioned, 'Lizzyanne nao e o nome');
  ok(!ia.checkBotNameMention('lizzys').mentioned, 'lizzys nao e o nome');
  ok(!ia.checkBotNameMention('oi pessoal').mentioned, 'frase sem o nome');
});

await test('4. @ antes do nome tambem conta', () => {
  const r = ia.checkBotNameMention('oi @Lizzy');
  ok(r.mentioned, '@Lizzy e reconhecido');
  ok(!r.cleanedText.includes('@'), 'o @ sai junto');
});

// ---------------------------------------------------------------------------
// 2) A GUARDA DO HANDLER (a segunda causa)
// ---------------------------------------------------------------------------
console.log('\n=== 2) A GUARDA DO HANDLER ===\n');

await test('5. so o nome NAO e mais descartado pela guarda', () => {
  // O bug: `textoLimpo.length > 2` sozinho. "Lizzy" -> texto limpo vazio -> 0.
  const i = INDEX.indexOf('if (textoLimpo.length > 2');
  const bloco = INDEX.slice(i, i + 300);
  contem(bloco, 'hasMentionByName', 'o nome entra na condicao');
  contem(bloco, 'hasMentionByAt', 'a mencao com @ tambem');
});

await test('6. a via por RESPOSTA continua funcionando', () => {
  // Era a unica que funcionava; nao pode quebrar.
  const i = INDEX.indexOf('const shouldActivateAssistant =');
  const bloco = INDEX.slice(i, i + 200);
  contem(bloco, 'menc_os2 && menc_os2 == botNumber', 'resposta (citacao) ativa a assistente');
});

// ---------------------------------------------------------------------------
// 3) O FLUXO REAL (handler de verdade, com o Groq dublado)
// ---------------------------------------------------------------------------
console.log('\n=== 3) O FLUXO REAL ===\n');

const OWNER_LID = '5511915323638:1@s.whatsapp.net';
const GRUPO = '120363425268923269@g.us';
const BOT_LID = '127642753843383:1@s.whatsapp.net';

function grupoFile(extra = {}) {
  fs.writeFileSync(path.join(TMP_DB, 'grupos', `${GRUPO}.json`), JSON.stringify({
    assistente: true, groupName: 'geralbot', prefixo: '!', ...extra
  }, null, 2));
}

function fakeSock(sent) {
  return {
    user: { id: BOT_LID, lid: BOT_LID },
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    sendMessage: async (jid, content) => { sent.push({ jid, content }); return { key: { id: 'X' } }; },
    sendPresenceUpdate: async () => {},
    groupMetadata: async () => ({ participants: [{ id: OWNER_LID, admin: 'superadmin' }, { id: BOT_LID, admin: 'admin' }] }),
    profilePictureUrl: async () => null,
    react: async () => ({}),
    waitForMessage: async () => undefined,
    chatModify: async () => ({}),
  };
}

async function run(text, { groupFileExtra = {} } = {}) {
  grupoFile(groupFileExtra);
  const sent = [];
  const sock = fakeSock(sent);
  const info = {
    key: { remoteJid: GRUPO, fromMe: false, id: `M-${Math.random().toString(36).slice(2, 8)}`, participant: OWNER_LID },
    message: { extendedTextMessage: { text, contextInfo: { remoteJid: GRUPO } } },
    messageTimestamp: Math.floor(Date.now() / 1000), pushName: 'Kannon',
  };
  await handleMessage(sock, info, null, new Map(), null);
  await new Promise((r) => setTimeout(r, 250));
  return sent.map((s) => s.content?.text ?? s.content?.caption ?? '').join('\n');
}

await test('7. "oi Lizzy" -> ela responde (a via que NAO funcionava)', async () => {
  groq.setGroqHttpForTest(async () => ({
    data: { choices: [{ message: { content: '{"resp":[{"resp":"Oi! Tudo bem? 😊"}]}' } }] }
  }));
  process.env.GROQ_API_KEY = 'gsk-teste';
  const t = await run('oi Lizzy');
  contem(t, 'Oi! Tudo bem?', 'respondeu ao nome');
  groq.setGroqHttpForTest(null);
});

await test('8. so "Lizzy" -> ela responde (a guarda bloqueava)', async () => {
  groq.setGroqHttpForTest(async () => ({
    data: { choices: [{ message: { content: '{"resp":[{"resp":"Oi! Me chamou? 👀"}]}' } }] }
  }));
  process.env.GROQ_API_KEY = 'gsk-teste';
  const t = await run('Lizzy');
  contem(t, 'Me chamou', 'respondeu so ao nome');
  groq.setGroqHttpForTest(null);
});

await test('9. mensagem SEM o nome dela nao aciona a assistente', async () => {
  let chamou = false;
  groq.setGroqHttpForTest(async () => { chamou = true; return { data: { choices: [{ message: { content: '{"resp":[{"resp":"x"}]}' } }] } }; });
  process.env.GROQ_API_KEY = 'gsk-teste';
  const t = await run('bom dia pessoal, tudo certo por aqui?');
  ok(!chamou, 'nao chamou a IA sem o nome');
  naoContem(t, 'x', 'nao respondeu');
  groq.setGroqHttpForTest(null);
});

// ---------------------------------------------------------------------------
console.log('\n' + '='.repeat(60));
const tot = RESULTS.reduce((a, r) => a + r.passed, 0);
const fal = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log(`RESULTADO: ${RESULTS.length} testes | ${tot} asserções ok | ${fal} falhas`);
console.log('='.repeat(60));
process.exit(fal ? 1 : 0);
