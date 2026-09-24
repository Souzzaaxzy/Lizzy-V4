/**
 * !eununca18 — "Eu nunca" +18 (mesmo formato do `!eununca`).
 *
 * O `!eununca18` monta a MESMA enquete do `!eununca` (título "EU NUNCA" + a
 * frase, opções "Eu nunca"/"Eu já", `selectableCount: 1`); o que muda é a lista
 * (`eununca18.json`, 200 frases picantes). Vive no `menu18`, na categoria
 * BRINCADEIRAS.
 *
 * Este teste roda o handler REAL e confere os dois lados:
 *   - o arquivo (`eununca18.json`): 200 frases, no formato da enquete;
 *   - o comando: a enquete sai com a frase no título e as duas opções.
 *
 * Uso: node tests/eununca18.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-eununca18-'));
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

/** Normaliza MATHEMATICAL BOLD/ITALIC para ASCII (o menu usa bold Unicode). */
function desbold(text) {
  if (typeof text !== 'string') return text;
  return text.replace(/[\u{1D400}-\u{1D7FF}]/gu, (ch) => {
    const cp = ch.codePointAt(0);
    const map = [
      [0x1D400, 'A'], [0x1D41A, 'a'], [0x1D434, 'A'], [0x1D44E, 'a'],
      [0x1D468, 'A'], [0x1D482, 'a'], [0x1D5A0, 'A'], [0x1D5BA, 'a'],
      [0x1D5D4, 'A'], [0x1D5EE, 'a'], [0x1D608, 'A'], [0x1D622, 'a'],
      [0x1D63C, 'A'], [0x1D656, 'a'], [0x1D670, 'A'], [0x1D68A, 'a'],
    ];
    for (const [base, letter] of map) {
      if (cp >= base && cp < base + 26) {
        return String.fromCharCode(letter.charCodeAt(0) + (cp - base));
      }
    }
    for (const base of [0x1D7CE, 0x1D7D8, 0x1D7E2, 0x1D7EC, 0x1D7F6]) {
      if (cp >= base && cp < base + 10) return String(cp - base);
    }
    return ch;
  });
}

// ============================================================================

const FRASES = JSON.parse(fs.readFileSync(path.join(ROOT, 'dados/src/funcs/json/eununca18.json'), 'utf-8'));
const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';

let groupCounter = 0;
function makeGroup(extra = {}) {
  groupCounter += 1;
  const jid = `120363960000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(path.join(GRUPOS_DIR, `${jid}.json`),
    JSON.stringify({ groupName: `GE18 ${groupCounter}`, modobrincadeira: true, ...extra }, null, 2));
  return jid;
}

let senderSeq = 0;
function nextSender() {
  senderSeq += 1;
  const n = String(senderSeq).padStart(4, '0');
  return { lid: `5575${n}000000@lid`, jid: `5517${n}999999@s.whatsapp.net`, name: `5575${n}000000` };
}

async function rodar({ text = '!eununca18', groupData = {} } = {}) {
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
      id: groupJid, subject: 'GE18',
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

await test('eununca18.json tem as 200 frases', () => {
  ok(Array.isArray(FRASES), 'é uma lista');
  ok(FRASES.length === 200, `200 frases (veio ${FRASES.length})`);
  ok(new Set(FRASES).size === 200, 'nenhuma repetida');
  ok(FRASES[0] === 'Eu nunca fiquei encarando os seios de alguém tentando disfarçar.', 'primeira frase é a esperada');
  ok(FRASES[199] === 'Eu nunca encontrei alguém que despertou um desejo tão forte que ficou impossível fingir que não sentia nada.', 'última frase é a esperada');
});

await test('toda frase segue o formato da enquete (Eu nunca ...)', () => {
  const fora = FRASES.filter((f) => typeof f !== 'string' || !/^Eu nunca /.test(f));
  ok(fora.length === 0, `todas começam com "Eu nunca" (fora: ${fora.slice(0, 3).join(' | ')})`);
});

await test('os quatro blocos estão na ordem', () => {
  ok(FRASES[0].includes('encarando os seios'), 'bloco 1 (corpo/olhares) abre');
  ok(FRASES[50].includes('noite inteira de intimidade'), 'bloco 2 (fantasias) começa no item 51');
  ok(FRASES[100].includes('ficar completamente nu'), 'bloco 3 (íntimo) começa no item 101');
  ok(FRASES[150].includes('ciúmes'), 'bloco 4 (ciúmes/tensão) começa no item 151');
});

// ============================================================================
// 2. O COMANDO
// ============================================================================

await test('!eununca18 publica enquete com as duas opções', async () => {
  const { enquete } = await rodar();
  ok(Boolean(enquete), 'mandou enquete');
  ok(enquete.values.length === 2, 'duas opções');
  ok(enquete.values[0] === 'Eu nunca' && enquete.values[1] === 'Eu já', 'opções "Eu nunca" / "Eu já"');
  ok(enquete.selectableCount === 1, 'uma escolha só');
});

await test('a pergunta da enquete vem da lista eununca18', async () => {
  const { enquete } = await rodar();
  ok(topoDaEnquete(enquete.name).includes('🔞'), 'topo da caixa com o emoji +18');
  ok(topoDaEnquete(enquete.name).startsWith('╭━━━꧁༺'), 'título no layout do bot (caixa ꧁༺)');
  const pergunta = perguntaDaEnquete(enquete.name);
  ok(FRASES.includes(pergunta), `a pergunta é uma das frases da lista ("${pergunta}")`);
});

await test('10 execuções trazem frases da lista', async () => {
  for (let i = 0; i < 10; i++) {
    const { enquete } = await rodar();
    const pergunta = perguntaDaEnquete(enquete.name);
    ok(FRASES.includes(pergunta), `execução ${i + 1}: frase veio da lista`);
  }
});

await test('só roda em grupo e com modo brincadeira', async () => {
  const semModo = await rodar({ groupData: { modobrincadeira: false } });
  ok(!semModo.enquete, 'não manda enquete sem modo brincadeira');
  ok(semModo.texto.includes('modo brincadeira'), 'avisa sobre o modo brincadeira');
});

await test('!eununca (antigo) continua funcionando — regressão', async () => {
  const { enquete } = await rodar({ text: '!eununca' });
  ok(Boolean(enquete), 'o !eununca ainda publica enquete');
  ok(topoDaEnquete(enquete.name).includes('🙈'), 'o !eununca mantém o emoji amigável');
});

// ============================================================================
// 3. MENU 18 — categoria BRINCADEIRAS
// ============================================================================

const { getMenus } = await import(new URL('../dados/src/menus/index.js', import.meta.url).href);
const menus = await getMenus();

await test('menu18 lista o !eununca18 na categoria BRINCADEIRAS', async () => {
  const menu = desbold(await menus.menu18('!', 'Lizzy', 'Kannon'));
  ok(menu.includes('BRINCADEIRAS'), 'tem a categoria BRINCADEIRAS');
  ok(menu.includes('!eununca18'), 'lista o !eununca18');
  ok(menu.includes('!vab18'), 'continua listando o !vab18');
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
