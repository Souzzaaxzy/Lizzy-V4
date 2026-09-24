/**
 * !vab — "Isso ou Aquilo" com as 200 perguntas novas.
 *
 * O `!vab` monta uma ENQUETE de duas opções. Com as perguntas novas, o TÍTULO da
 * enquete passou a ser a própria pergunta do item (`pergunta`), que antes não
 * existia: cada item tinha só as duas opções soltas, sem contexto.
 *
 * Este teste roda o handler REAL e confere os dois lados:
 *   - o arquivo (`vab.json`): 200 itens, cada um com pergunta + 2 opções;
 *   - o comando: a enquete sai com a PERGUNTA no título e as duas opções.
 *
 * Uso: node tests/vab.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-vab-'));
process.env.DATABASE_PATH = TMP_DB;
const GRUPOS_DIR = path.join(TMP_DB, 'grupos');
fs.mkdirSync(GRUPOS_DIR, { recursive: true });

const RESULTS = [];
let CURRENT = null;

function test(name, fn) {
  CURRENT = { name, passed: 0, failed: 0, errors: [] };
  RESULTS.push(CURRENT);
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      return r.then(() => finish(name)).catch((e) => {
        CURRENT.failed += 1; CURRENT.errors.push(`EXCEÇÃO: ${e?.stack || e}`); finish(name);
      });
    }
    finish(name);
  } catch (e) {
    CURRENT.failed += 1; CURRENT.errors.push(`EXCEÇÃO: ${e?.stack || e}`); finish(name);
  }
  return Promise.resolve();
}
function finish(name) {
  console.log(`${CURRENT.failed === 0 ? '✅' : '❌'} ${name} (${CURRENT.passed} ok, ${CURRENT.failed} falhas)`);
  for (const err of CURRENT.errors) console.log(`     ${err.split('\n')[0]}`);
}
function ok(cond, msg) {
  if (cond) CURRENT.passed += 1;
  else { CURRENT.failed += 1; CURRENT.errors.push(`ASSERT FALHOU: ${msg}`); }
}

// ============================================================================

const VAB = JSON.parse(fs.readFileSync(path.join(ROOT, 'dados/src/funcs/json/vab.json'), 'utf-8'));
const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';

let groupCounter = 0;
function makeGroup(extra = {}) {
  groupCounter += 1;
  const jid = `120363910000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(path.join(GRUPOS_DIR, `${jid}.json`),
    JSON.stringify({ groupName: `GV ${groupCounter}`, modobrincadeira: true, ...extra }, null, 2));
  return jid;
}

let senderSeq = 0;
function nextSender() {
  senderSeq += 1;
  const n = String(senderSeq).padStart(4, '0');
  return { lid: `5574${n}000000@lid`, jid: `5516${n}999999@s.whatsapp.net`, name: `5574${n}000000` };
}

async function rodar({ text = '!vab', groupData = {} } = {}) {
  const s = nextSender();
  const groupJid = makeGroup(groupData);
  const sent = [];
  const nazu = {
    sent,
    sendMessage: async (jid, content, options) => { sent.push({ jid, content, options }); return { key: { id: 'S' } }; },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
    onWhatsApp: async (jid) => [{ jid, exists: true, lid: s.lid }],
    signalRepository: { lidMapping: { getPNForLID: async () => s.jid } },
    groupMetadata: async () => ({
      id: groupJid, subject: 'GV',
      participants: [
        { id: s.lid, phoneNumber: s.jid, admin: null },
        { id: BOT_LID, phoneNumber: BOT_JID, admin: 'admin' }
      ]
    }),
    groupParticipantsUpdate: async () => ({}),
    groupRequestParticipantsList: async () => [],
    groupRequestParticipantsUpdate: async () => ({}),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {}, sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => null, react: async () => ({}),
    waUploadToServer: async () => ({ mediaUrl: 'https://x.invalid/m', directPath: '/v/x', url: 'https://x.invalid/m' })
  };
  await handleMessage(nazu, {
    key: { remoteJid: groupJid, fromMe: false, id: `M-${Math.random().toString(36).slice(2, 8)}`, participant: s.jid, participantAlt: s.jid },
    message: { extendedTextMessage: { text, contextInfo: { remoteJid: groupJid, mentionedJid: [], participant: s.jid } } },
    messageTimestamp: Math.floor(Date.now() / 1000), pushName: s.name
  }, null, new Map(), null);
  return {
    sent,
    enquete: sent.find((x) => x.content?.poll)?.content.poll,
    texto: sent.map((x) => x.content?.text ?? '').filter(Boolean).join('\n')
  };
}


/**
 * O título da enquete agora vem no LAYOUT do bot: caixa em cima, a PERGUNTA no
 * meio e o rodapé com o nome do bot embaixo. A pergunta é a linha do meio.
 */
function perguntaDaEnquete(name) {
  return String(name).split('\n')[1] ?? '';
}
function topoDaEnquete(name) {
  return String(name).split('\n')[0] ?? '';
}

// ============================================================================
// 1. O ARQUIVO
// ============================================================================

await test('vab.json tem as 200 perguntas novas', () => {
  ok(Array.isArray(VAB), 'é uma lista');
  ok(VAB.length === 200, `200 itens (veio ${VAB.length})`);
  ok(VAB[0].pergunta === 'O que você prefere fazer em um dia completamente livre?', 'primeira pergunta é a esperada');
  ok(VAB[199].pergunta === 'O que você escolheria para uma relação ideal?', 'última pergunta é a esperada');
});

await test('cada item tem pergunta e DUAS opções com texto', () => {
  const ruins = VAB.filter((i) =>
    typeof i.pergunta !== 'string' || !i.pergunta.trim()
    || typeof i.option1 !== 'string' || !i.option1.trim()
    || typeof i.option2 !== 'string' || !i.option2.trim());
  ok(ruins.length === 0, `todos completos (ruins: ${ruins.length})`);
  // Nenhuma opção repetida no MESMO item (seria uma escolha falsa).
  const iguais = VAB.filter((i) => i.option1 === i.option2);
  ok(iguais.length === 0, 'opções diferentes entre si');
});

await test('nenhum ITEM repetido (pergunta + opções)', () => {
  // Várias perguntas são genéricas de propósito ("O que você prefere?", "Qual
  // dessas situações você escolheria?") e se repetem em itens diferentes, então
  // a identidade do item é o conjunto pergunta + opções.
  const itens = VAB.map((i) => `${i.pergunta}|${i.option1}|${i.option2}`);
  ok(new Set(itens).size === itens.length,
    `itens únicos (total ${itens.length}, únicos ${new Set(itens).size})`);
});

await test('o bloco de relacionamento (as 50 finais) está no fim', () => {
  ok(VAB[149].pergunta.includes('levar para o resto da vida'), 'item 150 é o fim do bloco amigável');
  ok(VAB[150].pergunta.includes('Em um relacionamento'), 'item 151 abre o bloco de relacionamento');
});

await test('as perguntas antigas curtas saíram', () => {
  const antigas = ['usar meias furadas', 'ser capaz de se comunicar com o sol'];
  const achadas = antigas.filter((a) => VAB.some((i) => i.option1 === a || i.option2 === a));
  ok(achadas.length === 0, `estilo antigo ausente (achadas: ${achadas.join(', ')})`);
});

// ============================================================================
// 2. O COMANDO
// ============================================================================

await test('!vab publica enquete com a PERGUNTA no título e as duas opções', async () => {
  const { enquete } = await rodar();
  ok(Boolean(enquete), 'mandou enquete');
  ok(enquete.values.length === 2, 'duas opções');
  ok(enquete.selectableCount === 1, 'uma escolha só');
  // O título tem o emoji + a pergunta do item.
  ok(topoDaEnquete(enquete.name).includes('🤔'), 'topo da caixa com o emoji de dúvida');
  ok(topoDaEnquete(enquete.name).startsWith('╭━━━꧁༺'), 'título no layout do bot (caixa ꧁༺)');
  const pergunta = perguntaDaEnquete(enquete.name);
  ok(VAB.some((i) => i.pergunta === pergunta), `título é uma pergunta da lista ("${pergunta}")`);
});

await test('as opções do título correspondem ao MESMO item', async () => {
  const { enquete } = await rodar();
  const pergunta = perguntaDaEnquete(enquete.name);
  // A pergunta pode existir em mais de um item, então a identidade é o
  // conjunto completo: pergunta + as duas opções.
  const item = VAB.find((i) =>
    i.pergunta === pergunta
    && i.option1 === enquete.values[0]
    && i.option2 === enquete.values[1]);
  ok(Boolean(item), 'o trio (pergunta + opções) é um item real da lista');
});

await test('10 execuções: título e opções sempre coerentes com o item', async () => {
  for (let i = 0; i < 10; i++) {
    const { enquete } = await rodar();
    const pergunta = perguntaDaEnquete(enquete.name);
    const item = VAB.find((x) =>
      x.pergunta === pergunta
      && x.option1 === enquete.values[0]
      && x.option2 === enquete.values[1]);
    ok(Boolean(item), `execução ${i + 1}: trio veio da lista`);
  }
});

await test('só roda em grupo e com modo brincadeira', async () => {
  const semModo = await rodar({ groupData: { modobrincadeira: false } });
  ok(!semModo.enquete, 'não manda enquete sem modo brincadeira');
  ok(semModo.texto.includes('modo brincadeira'), 'avisa sobre o modo brincadeira');
});

// ============================================================================

const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log('\n════════════════════════════════════════');
console.log(`RESULTADO: ${RESULTS.length} testes | ${totalOk} asserções ok | ${totalFail} falhas`);
console.log('════════════════════════════════════════');

fs.rmSync(TMP_DB, { recursive: true, force: true });
if (totalFail > 0) {
  console.log('\nFALHAS:');
  for (const r of RESULTS) if (r.failed) for (const e of r.errors) console.log(`- [${r.name}] ${e}`);
  process.exit(1);
}
console.log('✅ TODOS OS TESTES PASSARAM');
process.exit(0);
