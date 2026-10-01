/**
 * Testes do jogo `!quemsoueu` (alias `!quemsou`).
 *
 * O bot descreve um personagem ("Sou um ninja loiro...") e o grupo adivinha.
 * Mesmo molde do `!quiz`: estado em `global.quemSouEuGames`, chute errado
 * mantém o jogo aberto, `dica` dá pistas e `pular`/`desistir` revela.
 *
 * Roda o handler real (NazuninhaBotExec) com socket Baileys falso e
 * `DATABASE_PATH` temporário: NÃO toca o `dados/database` real.
 *
 * Uso: node tests/quemsoueu.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-qse-db-'));
process.env.DATABASE_PATH = TMP_DB;
fs.mkdirSync(path.join(TMP_DB, 'grupos'), { recursive: true });

const RESULTS = [];
let CURRENT = null;

function test(name, fn) {
  CURRENT = { name, passed: 0, failed: 0, errors: [] };
  RESULTS.push(CURRENT);
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.then(() => finish(name)).catch((error) => {
        CURRENT.failed += 1;
        CURRENT.errors.push(`EXCEÇÃO: ${error?.stack || error}`);
        finish(name);
      });
    }
    finish(name);
  } catch (error) {
    CURRENT.failed += 1;
    CURRENT.errors.push(`EXCEÇÃO: ${error?.stack || error}`);
    finish(name);
  }
  return Promise.resolve();
}

function finish(name) {
  console.log(`${CURRENT.failed === 0 ? '✅' : '❌'} ${name} (${CURRENT.passed} ok, ${CURRENT.failed} falhas)`);
  for (const err of CURRENT.errors) console.log(`     ${err.split('\n')[0]}`);
}

function ok(condition, message) {
  if (condition) CURRENT.passed += 1;
  else {
    CURRENT.failed += 1;
    CURRENT.errors.push(`ASSERT FALHOU: ${message}`);
  }
}

function includes(haystack, needle, label) {
  ok(typeof haystack === 'string' && haystack.includes(needle), `${label ?? needle} — esperado conter "${needle}"`);
}

function notIncludes(haystack, needle, label) {
  ok(typeof haystack === 'string' && !haystack.includes(needle), `${label ?? needle} — não deveria conter "${needle}"`);
}

// ============================================================================
// MÓDULOS
// ============================================================================

const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;
if (typeof handleMessage !== 'function') throw new Error('index.js não exporta o handler');

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';

let groupCounter = 0;
let authorCounter = 0;

function makeGroup() {
  groupCounter += 1;
  const jid = `1203638100000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(
    path.join(TMP_DB, 'grupos', `${jid}.json`),
    JSON.stringify({ modobrincadeira: true, groupName: 'Grupo QSE' }, null, 2)
  );
  return jid;
}

function makeNazu({ sent, groupJid, authorLid, authorJid }) {
  return {
    sendMessage: async (jid, content, options) => {
      sent.push({ jid, content, options });
      return { key: { id: 'SENT' } };
    },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
    onWhatsApp: async (jid) => [{ jid, exists: true, lid: `${jid.split('@')[0]}@lid` }],
    signalRepository: { lidMapping: { getPNForLID: async () => null } },
    groupMetadata: async () => ({
      id: groupJid,
      subject: 'Grupo QSE',
      participants: [
        { id: authorLid, admin: 'admin', phoneNumber: authorJid },
        { id: BOT_LID, admin: 'admin', phoneNumber: BOT_JID },
      ],
    }),
    groupParticipantsUpdate: async () => ({}),
    groupRequestParticipantsList: async () => [],
    groupRequestParticipantsUpdate: async () => ({}),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {},
    sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => null,
    react: async () => ({}),
  };
}

/** Executa `!quemsoueu <texto>` no handler real e devolve o texto da resposta. */
async function rodar(groupJid, texto = '!quemsoueu') {
  const sent = [];
  authorCounter += 1;
  const authorLid = `66${String(authorCounter).padStart(6, '0')}000@lid`;
  const authorJid = `5566${String(authorCounter).padStart(6, '0')}111@s.whatsapp.net`;
  const nazu = makeNazu({ sent, groupJid, authorLid, authorJid });
  await handleMessage(nazu, {
    key: { remoteJid: groupJid, fromMe: false, id: `QSE-${authorCounter}`, participant: authorLid },
    message: { extendedTextMessage: { text: texto, contextInfo: { remoteJid: groupJid } } },
    messageTimestamp: 1757900000,
    pushName: 'Autor',
  }, null, new Map(), null);
  const text = sent.map((s) => s.content?.text ?? s.content?.caption ?? '').filter(Boolean).join('\n');
  return { sent, text };
}

const jogoAtivo = (groupJid) => global.quemSouEuGames?.[groupJid] || null;

// ============================================================================
// 1) DADOS
// ============================================================================

await test('quemsoueu.json: personagens com p/r/d/dicas e sem duplicados', () => {
  const data = JSON.parse(fs.readFileSync(path.join(PROJECT, 'dados/src/funcs/json/quemsoueu.json'), 'utf-8'));
  const lista = data.personagens;
  ok(Array.isArray(lista) && lista.length >= 40, `tem personagens (${lista?.length})`);
  const displays = new Set();
  for (const x of lista) {
    ok(typeof x.p === 'string' && x.p.length > 10, 'descrição presente');
    ok(Array.isArray(x.r) && x.r.length > 0, 'respostas presentes');
    ok(typeof x.d === 'string' && x.d.length > 0, 'display presente');
    ok(Array.isArray(x.dicas) && x.dicas.length > 0, 'dicas presentes');
    displays.add(x.d);
  }
  ok(displays.size === lista.length, 'nenhum personagem duplicado');
});

// ============================================================================
// 2) FLUXO DO JOGO
// ============================================================================

await test('!quemsoueu: começa um jogo com a descrição e instruções', async () => {
  const g = makeGroup();
  const { text } = await rodar(g);
  includes(text, 'QUEM SOU EU?', 'título do jogo');
  includes(text, 'quemsoueu [resposta]', 'ensina a chutar');
  includes(text, 'quemsoueu dica', 'ensina o dica');
  includes(text, 'quemsoueu pular', 'ensina o pular');
  notIncludes(text, 'undefined', 'sem undefined');
  ok(jogoAtivo(g) !== null, 'jogo ficou ativo');
  ok(jogoAtivo(g).dicasUsadas === 0, 'nenhuma dica usada ainda');
});

await test('!quemsoueu: chute errado mantém o jogo aberto', async () => {
  const g = makeGroup();
  await rodar(g);
  const antes = jogoAtivo(g).display;
  const { text } = await rodar(g, '!quemsoueu zzz nao existe');
  includes(text, 'Errou', 'avisa que errou');
  ok(jogoAtivo(g) !== null, 'jogo continua ativo');
  ok(jogoAtivo(g).display === antes, 'o mesmo personagem continua');
});

await test('!quemsoueu dica: entrega as dicas em ordem e não encerra o jogo', async () => {
  const g = makeGroup();
  await rodar(g);
  const game = jogoAtivo(g);
  const { text: d1 } = await rodar(g, '!quemsoueu dica');
  includes(d1, 'DICA 1/', 'primeira dica');
  includes(d1, game.dicas[0], 'texto da primeira dica');
  ok(jogoAtivo(g) !== null, 'jogo continua ativo');
  const { text: d2 } = await rodar(g, '!quemsoueu dica');
  includes(d2, 'DICA 2/', 'segunda dica');
  includes(d2, game.dicas[1], 'texto da segunda dica');
});

await test('!quemsoueu: acerto encerra o jogo e mostra o personagem', async () => {
  const g = makeGroup();
  await rodar(g);
  const game = jogoAtivo(g);
  const { text } = await rodar(g, `!quemsoueu ${game.respostas[0]}`);
  includes(text, 'ACERTOU', 'confirma o acerto');
  includes(text, game.display, 'revela o personagem');
  notIncludes(text, 'undefined', 'sem undefined');
  ok(jogoAtivo(g) === null, 'jogo encerrado');
});

await test('!quemsoueu: acerto com o nome de exibição também vale', async () => {
  const g = makeGroup();
  await rodar(g);
  const game = jogoAtivo(g);
  const { text } = await rodar(g, `!quemsoueu ${game.display}`);
  includes(text, 'ACERTOU', 'aceita o display como resposta');
  ok(jogoAtivo(g) === null, 'jogo encerrado');
});

await test('!quemsoueu pular: revela a resposta e encerra', async () => {
  const g = makeGroup();
  await rodar(g);
  const game = jogoAtivo(g);
  const { text } = await rodar(g, '!quemsoueu pular');
  includes(text, game.display, 'revela o personagem');
  ok(jogoAtivo(g) === null, 'jogo encerrado');
});

await test('!quemsoueu: depois de acertar, um novo comando começa outro jogo', async () => {
  const g = makeGroup();
  await rodar(g);
  const game = jogoAtivo(g);
  await rodar(g, `!quemsoueu ${game.respostas[0]}`);
  const { text } = await rodar(g);
  includes(text, 'QUEM SOU EU?', 'começa outro jogo');
  ok(jogoAtivo(g) !== null, 'novo jogo ativo');
});

await test('!quemsou: alias responde igual', async () => {
  const g = makeGroup();
  const { text } = await rodar(g, '!quemsou');
  includes(text, 'QUEM SOU EU?', 'alias funciona');
});

await test('!quemsoueu: o personagem é sorteado (varia entre partidas)', async () => {
  const g = makeGroup();
  const vistos = new Set();
  for (let i = 0; i < 20; i++) {
    const { text } = await rodar(g);
    vistos.add(text);
    const game = jogoAtivo(g);
    await rodar(g, `!quemsoueu ${game.respostas[0]}`);
  }
  ok(vistos.size >= 2, `descrições variam (${vistos.size} distintas em 20)`);
});

// ============================================================================
// 3) MENU / BLOCKPV
// ============================================================================

await test('menubn: o !quemsoueu está em JOGOS & DIVERSÃO (uma única vez)', async () => {
  const menus = await import(new URL('../dados/src/menus/menubn.js', import.meta.url).href);
  const texto = String(await menus.default('!', 'Lizzy', 'Tester', false));
  includes(texto, '!quemsoueu', 'presente no menu');
  ok((texto.match(/!quemsoueu\b/g) || []).length === 1, 'aparece uma única vez');
  const idx = texto.indexOf('!quiz');
  ok(idx !== -1 && texto.indexOf('!quemsoueu') > idx, 'vem logo depois do !quiz');
});

await test('blockPv: o quemsoueu está registrado no menubn', async () => {
  const blockPv = await import(new URL('../dados/src/utils/blockPv.js', import.meta.url).href);
  const lista = blockPv.menuCommandsMap?.menubn?.commands || [];
  ok(lista.includes('quemsoueu'), 'quemsoueu registrado no menubn');
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
