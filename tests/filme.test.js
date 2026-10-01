/**
 * Testes do jogo `!filme` (aliases `!filmes`, `!emojifilme`).
 *
 * O bot mostra uma sequência de emojis e o grupo adivinha o filme.
 * Mesmo molde do `!quiz`/`!quemsoueu`: estado em `global.filmeEmojiGames`,
 * chute errado mantém o jogo aberto, `dica` dá pistas e `pular`/`desistir`
 * revela.
 *
 * Roda o handler real (NazuninhaBotExec) com socket Baileys falso e
 * `DATABASE_PATH` temporário: NÃO toca o `dados/database` real.
 *
 * Uso: node tests/filme.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-filme-db-'));
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
  const jid = `1203638200000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(
    path.join(TMP_DB, 'grupos', `${jid}.json`),
    JSON.stringify({ modobrincadeira: true, groupName: 'Grupo Filme' }, null, 2)
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
      subject: 'Grupo Filme',
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

/** Executa `!filme <texto>` no handler real e devolve o texto da resposta. */
async function rodar(groupJid, texto = '!filme') {
  const sent = [];
  authorCounter += 1;
  const authorLid = `55${String(authorCounter).padStart(6, '0')}000@lid`;
  const authorJid = `5555${String(authorCounter).padStart(6, '0')}111@s.whatsapp.net`;
  const nazu = makeNazu({ sent, groupJid, authorLid, authorJid });
  await handleMessage(nazu, {
    key: { remoteJid: groupJid, fromMe: false, id: `FILME-${authorCounter}`, participant: authorLid },
    message: { extendedTextMessage: { text: texto, contextInfo: { remoteJid: groupJid } } },
    messageTimestamp: 1757900000,
    pushName: 'Autor',
  }, null, new Map(), null);
  const text = sent.map((s) => s.content?.text ?? s.content?.caption ?? '').filter(Boolean).join('\n');
  return { sent, text };
}

const jogoAtivo = (groupJid) => global.filmeEmojiGames?.[groupJid] || null;

// ============================================================================
// 1) DADOS
// ============================================================================

await test('filmes.json: itens com e/r/d/dicas, emojis e sem duplicados', () => {
  const data = JSON.parse(fs.readFileSync(path.join(PROJECT, 'dados/src/funcs/json/filmes.json'), 'utf-8'));
  const lista = data.filmes;
  ok(Array.isArray(lista) && lista.length >= 50, `tem filmes (${lista?.length})`);
  const displays = new Set();
  for (const x of lista) {
    ok(typeof x.e === 'string' && x.e.trim().length > 0, 'emojis presentes');
    ok(Array.isArray(x.r) && x.r.length > 0, 'respostas presentes');
    ok(typeof x.d === 'string' && x.d.length > 0, 'display presente');
    ok(Array.isArray(x.dicas) && x.dicas.length > 0, 'dicas presentes');
    displays.add(x.d);
  }
  ok(displays.size === lista.length, 'nenhum filme duplicado');
});

// ============================================================================
// 2) FLUXO DO JOGO
// ============================================================================

await test('!filme: começa um jogo mostrando os emojis e as instruções', async () => {
  const g = makeGroup();
  const { text } = await rodar(g);
  includes(text, 'ADIVINHE O FILME', 'título do jogo');
  includes(text, 'filme [resposta]', 'ensina a chutar');
  includes(text, 'filme dica', 'ensina o dica');
  includes(text, 'filme pular', 'ensina o pular');
  notIncludes(text, 'undefined', 'sem undefined');
  const game = jogoAtivo(g);
  ok(game !== null, 'jogo ficou ativo');
  includes(text, game.emojis, 'a resposta traz os emojis do filme');
  ok(game.dicasUsadas === 0, 'nenhuma dica usada ainda');
});

await test('!filme: chute errado mantém o jogo aberto', async () => {
  const g = makeGroup();
  await rodar(g);
  const antes = jogoAtivo(g).display;
  const { text } = await rodar(g, '!filme filme que nao existe zzz');
  includes(text, 'Errou', 'avisa que errou');
  ok(jogoAtivo(g) !== null, 'jogo continua ativo');
  ok(jogoAtivo(g).display === antes, 'o mesmo filme continua');
});

await test('!filme dica: entrega as dicas em ordem e não encerra o jogo', async () => {
  const g = makeGroup();
  await rodar(g);
  const game = jogoAtivo(g);
  const { text: d1 } = await rodar(g, '!filme dica');
  includes(d1, 'DICA 1/', 'primeira dica');
  includes(d1, game.dicas[0], 'texto da primeira dica');
  ok(jogoAtivo(g) !== null, 'jogo continua ativo');
  const { text: d2 } = await rodar(g, '!filme dica');
  includes(d2, 'DICA 2/', 'segunda dica');
  includes(d2, game.dicas[1], 'texto da segunda dica');
});

await test('!filme: acerto encerra o jogo e revela o filme', async () => {
  const g = makeGroup();
  await rodar(g);
  const game = jogoAtivo(g);
  const { text } = await rodar(g, `!filme ${game.respostas[0]}`);
  includes(text, 'ACERTOU', 'confirma o acerto');
  includes(text, game.display, 'revela o filme');
  notIncludes(text, 'undefined', 'sem undefined');
  ok(jogoAtivo(g) === null, 'jogo encerrado');
});

await test('!filme: acerto pelo nome de exibição também vale', async () => {
  const g = makeGroup();
  await rodar(g);
  const game = jogoAtivo(g);
  const { text } = await rodar(g, `!filme ${game.display}`);
  includes(text, 'ACERTOU', 'aceita o display como resposta');
  ok(jogoAtivo(g) === null, 'jogo encerrado');
});

await test('!filme pular: revela o filme e encerra', async () => {
  const g = makeGroup();
  await rodar(g);
  const game = jogoAtivo(g);
  const { text } = await rodar(g, '!filme pular');
  includes(text, game.display, 'revela o filme');
  ok(jogoAtivo(g) === null, 'jogo encerrado');
});

await test('!filme: depois de acertar, um novo comando começa outro jogo', async () => {
  const g = makeGroup();
  await rodar(g);
  const game = jogoAtivo(g);
  await rodar(g, `!filme ${game.respostas[0]}`);
  const { text } = await rodar(g);
  includes(text, 'ADIVINHE O FILME', 'começa outro jogo');
  ok(jogoAtivo(g) !== null, 'novo jogo ativo');
});

await test('!filmes e !emojifilme: aliases respondem igual', async () => {
  const g1 = makeGroup();
  const r1 = await rodar(g1, '!filmes');
  includes(r1.text, 'ADIVINHE O FILME', 'alias !filmes funciona');
  const g2 = makeGroup();
  const r2 = await rodar(g2, '!emojifilme');
  includes(r2.text, 'ADIVINHE O FILME', 'alias !emojifilme funciona');
});

await test('!filme: o filme é sorteado (varia entre partidas)', async () => {
  const g = makeGroup();
  const vistos = new Set();
  for (let i = 0; i < 20; i++) {
    const { text } = await rodar(g);
    vistos.add(text);
    const game = jogoAtivo(g);
    await rodar(g, `!filme ${game.respostas[0]}`);
  }
  ok(vistos.size >= 2, `emojis variam (${vistos.size} distintos em 20)`);
});

// ============================================================================
// 3) MENU / BLOCKPV
// ============================================================================

await test('menubn: o !filme está em JOGOS & DIVERSÃO (uma única vez)', async () => {
  const menus = await import(new URL('../dados/src/menus/menubn.js', import.meta.url).href);
  const texto = String(await menus.default('!', 'Lizzy', 'Tester', false));
  includes(texto, '!filme', 'presente no menu');
  ok((texto.match(/!filme\b/g) || []).length === 1, 'aparece uma única vez');
  const idx = texto.indexOf('!quemsoueu');
  ok(idx !== -1 && texto.indexOf('!filme') > idx, 'vem logo depois do !quemsoueu');
});

await test('blockPv: o filme está registrado no menubn', async () => {
  const blockPv = await import(new URL('../dados/src/utils/blockPv.js', import.meta.url).href);
  const lista = blockPv.menuCommandsMap?.menubn?.commands || [];
  ok(lista.includes('filme'), 'filme registrado no menubn');
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
