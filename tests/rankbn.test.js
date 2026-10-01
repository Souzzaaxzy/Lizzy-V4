/**
 * Testes do `!rankbn` (ranking do grupo) e `!rankbng` (global) e do módulo
 * `utils/rankbn.js` que guarda/formata a pontuação dos jogos de brincadeiras.
 *
 * Cobre:
 *   - o módulo puro: registrar, total, ranking (top 5, desempate), layout,
 *     agregação de vários grupos;
 *   - os jogos gravando ponto no JSON do grupo (emojiquiz/filme/quemsoueu/quiz);
 *   - os comandos no handler real, com socket falso e `DATABASE_PATH` temporário.
 *
 * Uso: node tests/rankbn.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-rankbn-db-'));
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

const rankbn = await import(new URL('../dados/src/utils/rankbn.js', import.meta.url).href);
const rankbnMenu = await import(new URL('../dados/src/menus/rankbn.js', import.meta.url).href);
const layout = await import(new URL('../dados/src/menus/layout.js', import.meta.url).href);
const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;
if (typeof handleMessage !== 'function') throw new Error('index.js não exporta o handler');

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';
const GRUPOS_DIR = path.join(TMP_DB, 'grupos');

// ============================================================================
// 1) MÓDULO PURO
// ============================================================================

await test('rankbn: registrarPontos soma por jogo e ignora valores inválidos', () => {
  const store = {};
  ok(rankbn.registrarPontos(store, 'emojiquiz', 'a@lid', 30) === true, 'gravou emojiquiz');
  ok(rankbn.registrarPontos(store, 'emojiquiz', 'a@lid', 20) === true, 'somou de novo');
  ok(store['a@lid'].emojiquiz === 50, `acumulou 50 (veio ${store['a@lid']?.emojiquiz})`);
  ok(rankbn.registrarPontos(store, 'filme', 'a@lid', 10) === true, 'gravou filme');
  ok(rankbn.registrarPontos(store, 'filme', 'a@lid', 0) === false, 'rejeita 0');
  ok(rankbn.registrarPontos(store, 'filme', 'a@lid', -5) === false, 'rejeita negativo');
  ok(rankbn.registrarPontos(store, 'filme', '', 5) === false, 'rejeita jid vazio');
  ok(rankbn.registrarPontos(null, 'filme', 'a@lid', 5) === false, 'rejeita store nulo');
  ok(rankbn.totalDoJogador(store['a@lid']) === 60, 'total 60');
});

await test('rankbn: ranking ordena por total e corta no top 5', () => {
  const store = {
    a: { emojiquiz: 100 },
    b: { emojiquiz: 300 },
    c: { filme: 250 },
    d: { quiz: 50 },
    e: { wordle: 10 },
    f: { forca: 400 },
  };
  const top = rankbn.ranking(store);
  ok(top.length === 5, `top 5 (veio ${top.length})`);
  ok(top[0].jid === 'f', `1º é o f (veio ${top[0].jid})`);
  ok(top[1].jid === 'b', '2º é o b');
  ok(top[2].jid === 'c', '3º é o c');
  ok(!top.some(x => x.jid === 'e'), 'o menor (e) ficou de fora');
});

await test('rankbn: ignora jogadores sem pontos e desempata de forma estável', () => {
  const store = { a: { emojiquiz: 0 }, b: { emojiquiz: 10 }, c: { emojiquiz: 10 } };
  const top = rankbn.ranking(store);
  ok(top.length === 2, `só quem tem ponto (veio ${top.length})`);
  ok(top[0].jid === 'b' && top[1].jid === 'c', 'empate em ordem estável (b antes de c)');
});

await test('rankbn: montarRankBn usa o layout do bot (cabeçalho + caixa)', () => {
  const store = {
    '5511@lid': { emojiquiz: 120, filme: 80 },
    '5522@lid': { emojiquiz: 300 },
  };
  const top = rankbn.ranking(store, 5);
  const { texto, mentions } = rankbnMenu.montarRankBn({
    top, jogos: rankbn.JOGOS_RANKBN.map(j => j.id),
    botName: 'Abyss', userName: 'Kannon', nomeDe: (jid) => `@${jid.split('@')[0]}`
  });
  // Cabeçalho do bot (nome em bold no título do menu).
  includes(texto, layout.TOPO('Abyss'), 'topo com o nome do bot');
  includes(texto, '┃ 𖤐 𝐎𝐥á, @Kannon', 'saudação');
  includes(texto, layout.bold('Rank Brincadeiras'), 'título em bold');
  includes(texto, layout.abrirCategoria('PONTOS', '🏆'), 'caixa de categoria');
  includes(texto, layout.RODAPE_BLOCO, 'fecha a caixa');
  // Conteúdo.
  includes(texto, '🥇 *1º* @5522', '1º com medalha');
  includes(texto, '🥈 *2º* @5511', '2º com medalha');
  includes(texto, '🧩 emojiquiz: 120', 'pontuação individual do emojiquiz');
  includes(texto, '🎬 filme: 80', 'pontuação individual do filme');
  includes(texto, '💠 total: *200*', 'total do jogador');
  includes(texto, '💠 total: *300*', 'total do 1º');
  ok(mentions.includes('5522@lid') && mentions.includes('5511@lid'), 'mentions com os dois jids');
  ok(mentions[0] === '5522@lid', 'mentions na ordem do ranking');
  ok(!texto.includes('╭─❖'), 'não usa a borda antiga');
});

await test('rankbn: montarRankBn sem pontos avisa e sem mentions', () => {
  const { texto, mentions } = rankbnMenu.montarRankBn({ top: [], jogos: ['emojiquiz'], botName: 'Abyss', userName: 'Kannon' });
  includes(texto, layout.bold('Rank Brincadeiras'), 'título');
  includes(texto, layout.abrirCategoria('SEM PONTOS', '💤'), 'caixa de vazio');
  includes(texto, 'Ninguém pontuou', 'aviso');
  ok(mentions.length === 0, 'sem mentions');
});

await test('rankbn: montarRankBn (global) troca o título', () => {
  const top = rankbn.ranking({ 'a@lid': { filme: 10 } }, 5);
  const { texto } = rankbnMenu.montarRankBn({ top, jogos: ['filme'], botName: 'Abyss', userName: 'X', global: true });
  includes(texto, layout.bold('Rank Brincadeiras Global'), 'título global');
});

await test('rankbn: agregarMapas soma o mesmo jogador em grupos diferentes', () => {
  const g1 = { 'a@lid': { emojiquiz: 100, filme: 50 } };
  const g2 = { 'a@lid': { emojiquiz: 40 }, 'b@lid': { filme: 10 } };
  const total = rankbn.agregarMapas([g1, g2, null, 'lixo']);
  ok(total['a@lid'].emojiquiz === 140, `emojiquiz somado entre grupos (veio ${total['a@lid']?.emojiquiz})`);
  ok(total['a@lid'].filme === 50, 'filme preservado');
  ok(total['b@lid'].filme === 10, 'jogador só de um grupo entrou');
});

// ============================================================================
// FIXTURES DO HANDLER
// ============================================================================

let groupCounter = 0;
let authorCounter = 0;

function makeGroup() {
  groupCounter += 1;
  const jid = `1203638400000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(
    path.join(GRUPOS_DIR, `${jid}.json`),
    JSON.stringify({ modobrincadeira: true, groupName: 'Grupo RankBN' }, null, 2)
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
      subject: 'Grupo RankBN',
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

/** Executa um comando no handler real e devolve o texto + mentions. */
async function rodar(groupJid, texto) {
  const sent = [];
  authorCounter += 1;
  const authorLid = `33${String(authorCounter).padStart(6, '0')}000@lid`;
  const authorJid = `5533${String(authorCounter).padStart(6, '0')}111@s.whatsapp.net`;
  const nazu = makeNazu({ sent, groupJid, authorLid, authorJid });
  await handleMessage(nazu, {
    key: { remoteJid: groupJid, fromMe: false, id: `RB-${authorCounter}`, participant: authorLid },
    message: { extendedTextMessage: { text: texto, contextInfo: { remoteJid: groupJid } } },
    messageTimestamp: 1757900000,
    pushName: 'Autor',
  }, null, new Map(), null);
  const out = sent.map((s) => s.content?.text ?? s.content?.caption ?? '').filter(Boolean).join('\n');
  const mentions = sent.flatMap((s) => s.content?.mentions || s.options?.mentions || []);
  return { sent, text: out, mentions, authorLid, authorJid };
}

const jogoAtivo = (g, chave) => global[chave]?.[g] || null;
const lerGrupo = (g) => JSON.parse(fs.readFileSync(path.join(GRUPOS_DIR, `${g}.json`), 'utf-8'));

// ============================================================================
// 2) JOGOS GRAVAM PONTO
// ============================================================================

await test('!emojiquiz: acerto grava a pontuação no rankbn do grupo', async () => {
  const g = makeGroup();
  await rodar(g, '!emojiquiz');
  const game = jogoAtivo(g, 'emojiQuizGames');
  const r = await rodar(g, `!emojiquiz ${game.respostas[0]}`);
  includes(r.text, 'ACERTOU', 'acertou');
  const dados = lerGrupo(g);
  const jid = r.authorLid;
  ok(dados.rankbn && dados.rankbn[jid], 'gravou no rankbn do grupo');
  ok(dados.rankbn[jid].emojiquiz > 0, `pontos de emojiquiz > 0 (veio ${dados.rankbn?.[jid]?.emojiquiz})`);
});

await test('!filme: acerto grava a pontuação no rankbn do grupo', async () => {
  const g = makeGroup();
  await rodar(g, '!filme');
  const game = jogoAtivo(g, 'filmeEmojiGames');
  const r = await rodar(g, `!filme ${game.respostas[0]}`);
  const dados = lerGrupo(g);
  ok(dados.rankbn?.[r.authorLid]?.filme > 0, 'gravou filme');
});

await test('!quemsoueu: acerto grava a pontuação no rankbn do grupo', async () => {
  const g = makeGroup();
  await rodar(g, '!quemsoueu');
  const game = jogoAtivo(g, 'quemSouEuGames');
  const r = await rodar(g, `!quemsoueu ${game.respostas[0]}`);
  const dados = lerGrupo(g);
  ok(dados.rankbn?.[r.authorLid]?.quemsoueu > 0, 'gravou quemsoueu');
});

await test('!quiz: acerto grava a pontuação no rankbn do grupo', async () => {
  const g = makeGroup();
  await rodar(g, '!quiz geral');
  const game = jogoAtivo(g, 'quizGames');
  const r = await rodar(g, `!quiz ${game.respostas[0]}`);
  const dados = lerGrupo(g);
  ok(dados.rankbn?.[r.authorLid]?.quiz > 0, 'gravou quiz');
});

// ============================================================================
// 3) COMANDOS NO HANDLER
// ============================================================================

await test('!rankbn: mostra o top 5 do grupo no layout (com pontuação por jogo)', async () => {
  const g = makeGroup();
  // Semeia pontos direto no JSON do grupo (3 jogadores).
  const j1 = '5511@lid', j2 = '5522@lid', j3 = '5533@lid';
  const dados = lerGrupo(g);
  dados.rankbn = {
    [j1]: { emojiquiz: 120, filme: 80 },
    [j2]: { emojiquiz: 300 },
    [j3]: { quemsoueu: 50, quiz: 20 },
  };
  fs.writeFileSync(path.join(GRUPOS_DIR, `${g}.json`), JSON.stringify(dados, null, 2));

  const r = await rodar(g, '!rankbn');
  includes(r.text, "╭━━━꧁༺ ✦ ", "cabeçalho do bot no grupo");
  includes(r.text, layout.bold('Rank Brincadeiras'), 'título do grupo');
  includes(r.text, '🥇 *1º*', 'tem o 1º com medalha');
  includes(r.text, 'emojiquiz: 120', 'pontuação individual');
  includes(r.text, 'filme: 80', 'pontuação individual do filme');
  includes(r.text, '💠 total: *200*', 'total do jogador');
  // Ordem: j2 (300) antes de j1 (200) antes de j3 (70).
  ok(r.text.indexOf('5522') < r.text.indexOf('5511'), 'j2 acima de j1');
  ok(r.text.indexOf('5511') < r.text.indexOf('5533'), 'j1 acima de j3');
  ok(r.mentions.includes(j1) && r.mentions.includes(j2) && r.mentions.includes(j3), 'mentions dos três');
  notIncludes(r.text, 'Global', 'não é o global');
});

await test('!rankbn: só os 5 melhores aparecem', async () => {
  const g = makeGroup();
  const dados = lerGrupo(g);
  dados.rankbn = {};
  for (let i = 1; i <= 8; i++) {
    dados.rankbn[`550${i}@lid`] = { emojiquiz: i * 10 };
  }
  fs.writeFileSync(path.join(GRUPOS_DIR, `${g}.json`), JSON.stringify(dados, null, 2));

  const r = await rodar(g, '!rankbn');
  ok(r.mentions.length === 5, `exatamente 5 mentions (veio ${r.mentions.length})`);
  includes(r.text, '5508@lid'.replace('@lid', ''), 'o maior (80) aparece');
  includes(r.text, 'emojiquiz: 80', 'pontuação do 1º');
  notIncludes(r.text, '5501', 'o menor (10) ficou de fora');
  notIncludes(r.text, '5502', 'o 2º menor ficou de fora');
});

await test('!rankbn: sem pontuação avisa e não quebra', async () => {
  const g = makeGroup();
  const r = await rodar(g, '!rankbn');
  includes(r.text, "╭━━━꧁༺ ✦ ", "cabeçalho");
  includes(r.text, 'Ninguém pontuou', 'aviso');
  ok(r.mentions.length === 0, 'sem mentions');
});

await test('!rankbng: soma todos os grupos (global)', async () => {
  // Limpa os grupos dos testes anteriores para o global ser determinístico.
  for (const f of fs.readdirSync(GRUPOS_DIR)) {
    if (f.endsWith('.json')) fs.rmSync(path.join(GRUPOS_DIR, f), { force: true });
  }
  const g1 = makeGroup();
  const g2 = makeGroup();
  const d1 = lerGrupo(g1);
  const d2 = lerGrupo(g2);
  d1.rankbn = { '5999@lid': { emojiquiz: 100 } };
  d2.rankbn = { '5999@lid': { emojiquiz: 40, filme: 60 }, '5888@lid': { filme: 30 } };
  fs.writeFileSync(path.join(GRUPOS_DIR, `${g1}.json`), JSON.stringify(d1, null, 2));
  fs.writeFileSync(path.join(GRUPOS_DIR, `${g2}.json`), JSON.stringify(d2, null, 2));

  const r = await rodar(g1, '!rankbng');
  includes(r.text, layout.bold('Rank Brincadeiras Global'), 'título global');
  includes(r.text, 'emojiquiz: 140', 'emojiquiz somado entre grupos');
  includes(r.text, 'filme: 60', 'filme do outro grupo');
  includes(r.text, '💠 total: *200*', 'total do 5999');
  includes(r.text, '💠 total: *30*', 'total do 5888');
  ok(r.text.indexOf('5999') < r.text.indexOf('5888'), '5999 (200) acima de 5888 (30)');
  ok(r.mentions.includes('5999@lid') && r.mentions.includes('5888@lid'), 'mentions dos dois');
});

await test('!rankbng funciona fora de grupo (é global)', async () => {
  const g = makeGroup();
  const sent = [];
  const nazu = makeNazu({ sent, groupJid: g, authorLid: '1@lid', authorJid: '1@s.whatsapp.net' });
  await handleMessage(nazu, {
    key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: false, id: 'PV-RB', participant: '1@lid' },
    message: { extendedTextMessage: { text: '!rankbng', contextInfo: {} } },
    messageTimestamp: 1757900000,
    pushName: 'Autor',
  }, null, new Map(), null);
  const text = sent.map((s) => s.content?.text ?? '').join('\n');
  includes(text, layout.bold('Rank Brincadeiras Global'), 'respondeu no privado');
});

await test('!rankbn: fora de grupo é recusado', async () => {
  const sent = [];
  const nazu = makeNazu({ sent, groupJid: 'x@g.us', authorLid: '1@lid', authorJid: '1@s.whatsapp.net' });
  await handleMessage(nazu, {
    key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: false, id: 'PV-RB2', participant: '1@lid' },
    message: { extendedTextMessage: { text: '!rankbn', contextInfo: {} } },
    messageTimestamp: 1757900000,
    pushName: 'Autor',
  }, null, new Map(), null);
  const text = sent.map((s) => s.content?.text ?? '').join('\n');
  includes(text, 'grupos', 'avisa que é só para grupos');
});

// ============================================================================
// 4) MENU / BLOCKPV
// ============================================================================

await test('menubn: !rankbn e !rankbng estão na PRIMEIRA categoria (JOGOS & DIVERSÃO)', async () => {
  const menus = await import(new URL('../dados/src/menus/menubn.js', import.meta.url).href);
  const texto = String(await menus.default('!', 'Lizzy', 'Tester', false));
  // Recorta só a primeira categoria (antes da segunda).
  const idxIni = texto.indexOf(layout.boldItalic('JOGOS & DIVERSÃO'));
  const idxFim = texto.indexOf(layout.boldItalic('NGL ANÔNIMO'));
  ok(idxIni !== -1 && idxFim !== -1 && idxFim > idxIni, 'achou a primeira categoria');
  const bloco = texto.slice(idxIni, idxFim);
  includes(bloco, '!rankbn', 'rankbn na primeira categoria');
  includes(bloco, '!rankbng', 'rankbng na primeira categoria');
  ok((texto.match(/!rankbn\b/g) || []).length === 1, '!rankbn aparece uma única vez');
  ok((texto.match(/!rankbng\b/g) || []).length === 1, '!rankbng aparece uma única vez');
  // Não ficou na BRINCADEIRAS (categoria mais abaixo).
  const idxBrinc = texto.indexOf(layout.boldItalic('BRINCADEIRAS'));
  ok(idxBrinc === -1 || !texto.slice(idxBrinc).includes('!rankbn'), 'não ficou na BRINCADEIRAS');
});

await test('blockPv: rankbn e rankbng registrados no menubn', async () => {
  const blockPv = await import(new URL('../dados/src/utils/blockPv.js', import.meta.url).href);
  const lista = blockPv.menuCommandsMap?.menubn?.commands || [];
  ok(lista.includes('rankbn'), 'rankbn registrado');
  ok(lista.includes('rankbng'), 'rankbng registrado');
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
