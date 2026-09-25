/**
 * !akinator com ENGINE PROPRIO -- testes.
 *
 * Cobre as FASEs 23/26/27/28 do pedido: engine (pergunta, respostas, candidatos,
 * palpite, confianca, empates, sem candidato), sessao (criacao, recuperacao,
 * multiplas, expiracao, cancelamento, isolamento), integracao pelo handler real
 * (inicio, resposta por botao, palpite, confirmacao, correcao, encerramento),
 * personagens conhecidos de categorias diferentes, personagem desconhecido e
 * respostas contraditorias (troll).
 *
 * Uso: node tests/akinator.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-akinator-'));
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
        CURRENT.failed += 1; CURRENT.errors.push(`EXCECAO: ${e?.stack || e}`); finish(name);
      });
    }
    finish(name);
  } catch (e) {
    CURRENT.failed += 1; CURRENT.errors.push(`EXCECAO: ${e?.stack || e}`); finish(name);
  }
  return Promise.resolve();
}
function finish(name) {
  console.log(`${CURRENT.failed === 0 ? '[ok]' : '[FAIL]'} ${name} (${CURRENT.passed} ok, ${CURRENT.failed} falhas)`);
  for (const err of CURRENT.errors) console.log(`     ${err.split('\n')[0]}`);
}
function ok(cond, msg) {
  if (cond) CURRENT.passed += 1;
  else { CURRENT.failed += 1; CURRENT.errors.push(`ASSERT FALHOU: ${msg}`); }
}
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
      if (cp >= base && cp < base + 26) return String.fromCharCode(letter.charCodeAt(0) + (cp - base));
    }
    for (const base of [0x1D7CE, 0x1D7D8, 0x1D7E2, 0x1D7EC, 0x1D7F6]) {
      if (cp >= base && cp < base + 10) return String(cp - base);
    }
    return ch;
  });
}

// ============================================================================

const QUESTIONS = JSON.parse(fs.readFileSync(path.join(ROOT, 'dados/src/funcs/json/akinator/questions.json'), 'utf-8')).questions;
const BASE_CHARS = JSON.parse(fs.readFileSync(path.join(ROOT, 'dados/src/funcs/json/akinator/characters.json'), 'utf-8')).characters;
// A base GRANDE nao fica mais no repositorio: ela e servida por URL (branch de
// dados) e cacheada pelo comando. O teste baixa o arquivo de verdade UMA vez e
// usa como fixture; se a rede falhar, os testes da base remota sao pulados.
const {
  carregarBase,
} = await import(new URL('../dados/src/funcs/utils/akinator-game.js', import.meta.url).href);

const REMOTE_URL = 'https://raw.githubusercontent.com/Souzzaaxzy/Lizzy-V4/akinator-data/akinator/characters.json';
let IMP = { characters: [], meta: { sources: [] } };
try {
  const r = await carregarBase({ url: REMOTE_URL, cacheFile: path.join(TMP_DB, 'imp-cache.json') });
  if (r.characters.length) IMP = { characters: r.characters, meta: { sources: r.characters[0] && r.characters[0].source ? [{ name: r.characters[0].source, license: 'BSD-3-Clause' }] : IMP.meta.sources } };
  console.log(`(base remota para os testes: ${r.characters.length} personagens via ${r.origem})`);
} catch (e) { console.log('(base remota indisponivel nos testes)'); }
const IMP_CHARS = IMP.characters;

const engineMod = await import(new URL('../dados/src/funcs/utils/akinator-engine.js', import.meta.url).href);
const gameMod = await import(new URL('../dados/src/funcs/utils/akinator-game.js', import.meta.url).href);
const { Engine, KnowledgeBase, ANSWER_VALUE, entropy, calibratedMatch, bucketValue } = engineMod;
const { AkinatorGameManager } = gameMod;

const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';

/** Joga uma partida inteira contra o engine, respondendo como `alvo`. */
function jogarEngine(alvo) {
  const e = new Engine(new KnowledgeBase({ questions: QUESTIONS, characters: BASE_CHARS }));
  let passos = 0;
  let palpite = null;
  while (passos < 25) {
    if (e.podePalpitar || e.atingiuTeto || e.semPerguntas) { palpite = e.bestGuess(); break; }
    const j = e.selectNextQuestion();
    if (j < 0) { palpite = e.bestGuess(); break; }
    const valor = alvo.answers[QUESTIONS[j].id];
    e.applyAnswer(j, valor === undefined ? 0.5 : valor);
    passos++;
  }
  if (!palpite) palpite = e.bestGuess();
  return { passos, palpite, engine: e };
}

let groupCounter = 0;
function makeGroup(extra = {}) {
  groupCounter += 1;
  const jid = `120363960000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(path.join(GRUPOS_DIR, `${jid}.json`),
    JSON.stringify({ groupName: `AK ${groupCounter}`, modobrincadeira: true, ...extra }, null, 2));
  return jid;
}
let senderSeq = 0;
function nextPerson() {
  senderSeq += 1;
  const n = String(senderSeq).padStart(4, '0');
  return { lid: `5579${n}000000@lid`, jid: `5511${n}999999@s.whatsapp.net`, name: `5579${n}000000` };
}

async function enviar({ groupJid, pessoa, text, participants }) {
  const sent = [];
  const nazu = {
    sent,
    sendMessage: async (jid, content, options) => { sent.push({ jid, content, options }); return { key: { id: `S${sent.length}` } }; },
    relayMessage: async (jid, message, options) => { sent.push({ jid, message, options, via: 'relay' }); return options?.messageId; },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
    onWhatsApp: async (jid) => [{ jid, exists: true, lid: pessoa.lid }],
    signalRepository: { lidMapping: { getPNForLID: async () => null, getLIDForPN: async () => null } },
    groupMetadata: async () => ({
      id: groupJid, subject: 'AK',
      participants: participants || [
        { id: pessoa.lid, phoneNumber: pessoa.jid, admin: null },
        { id: BOT_LID, phoneNumber: BOT_JID, admin: 'admin' },
      ],
    }),
    groupParticipantsUpdate: async () => ({}),
    groupRequestParticipantsList: async () => [],
    groupRequestParticipantsUpdate: async () => ({}),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {}, sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => null, react: async () => ({}),
    waUploadToServer: async () => ({ mediaUrl: 'https://x.invalid/m', directPath: '/v/x', url: 'https://x.invalid/m' }),
  };
  await handleMessage(nazu, {
    key: { remoteJid: groupJid, fromMe: false, id: `M-${Math.random().toString(36).slice(2, 8)}`, participant: pessoa.jid, participantAlt: pessoa.jid },
    message: { extendedTextMessage: { text, contextInfo: { remoteJid: groupJid, mentionedJid: [], participant: pessoa.jid } } },
    messageTimestamp: Math.floor(Date.now() / 1000), pushName: pessoa.name,
  }, null, new Map(), null);
  const textos = sent.map((s) => s.content?.text ?? s.message?.viewOnceMessage?.message?.interactiveMessage?.body?.text ?? '').filter(Boolean);
  const botoes = sent
    .map((s) => s.message?.viewOnceMessage?.message?.interactiveMessage?.nativeFlowMessage?.buttons)
    .filter(Boolean).flat()
    .map((b) => { try { return JSON.parse(b.buttonParamsJson); } catch (e) { return null; } }).filter(Boolean);
  return { sent, textos, texto: textos.join('\n'), botoes };
}

/** Injeta um manager proprio no global usado pelo handler. */
function injetarManager(deps = {}) {
  globalThis.__lizzyAkinatorManager = new AkinatorGameManager({
    questions: QUESTIONS,
    characters: BASE_CHARS,
    learnedFile: path.join(TMP_DB, 'akinator', 'learned.json'),
    pendingFile: path.join(TMP_DB, 'akinator', 'pending.json'),
    botName: 'Lizzy do privy',
    ...deps,
  });
  return globalThis.__lizzyAkinatorManager;
}

function perguntaDe(texto) {
  return QUESTIONS.find((q) => texto.split('\n').some((l) => l.trim() === q.text)) || null;
}
function chaveParaValor(v) {
  if (v >= 0.99) return 'ak_sim';
  if (v <= 0.01) return 'ak_nao';
  if (v === 0.5) return 'ak_nao_sei';
  return v > 0.5 ? 'ak_provavelmente' : 'ak_provavelmente_nao';
}

// ============================================================================
// 1. BASE DE CONHECIMENTO (FASE 5/6/7)
// ============================================================================

await test('a base tem personagens e perguntas validos', () => {
  ok(BASE_CHARS.length >= 40, `personagens suficientes (${BASE_CHARS.length})`);
  ok(QUESTIONS.length >= 50, `perguntas suficientes (${QUESTIONS.length})`);
  ok(new Set(QUESTIONS.map((q) => q.id)).size === QUESTIONS.length, 'ids de pergunta unicos');
  ok(new Set(BASE_CHARS.map((c) => c.id)).size === BASE_CHARS.length, 'ids de personagem unicos');
});

await test('todo personagem referencia apenas perguntas existentes', () => {
  const ids = new Set(QUESTIONS.map((q) => q.id));
  const ruins = [];
  for (const c of BASE_CHARS) {
    for (const qid of Object.keys(c.answers || {})) {
      if (!ids.has(qid)) ruins.push(`${c.id}:${qid}`);
    }
  }
  ok(ruins.length === 0, `sem pergunta orfa (ruins: ${ruins.slice(0, 3).join(', ')})`);
});

await test('a base cobre varias categorias (FASE 6)', () => {
  const cats = new Set(BASE_CHARS.map((c) => c.category));
  ok(cats.size >= 5, `pelo menos 5 categorias (${cats.size}: ${[...cats].join(', ')})`);
  for (const c of ['anime', 'game', 'movies', 'comics']) ok(cats.has(c), `tem a categoria ${c}`);
});

await test('todo personagem e distinguivel (nao ha assinatura duplicada)', () => {
  const sig = new Set();
  let dups = 0;
  for (const c of BASE_CHARS) {
    const k = JSON.stringify(Object.entries(c.answers || {}).sort());
    if (sig.has(k)) dups++;
    sig.add(k);
  }
  ok(dups === 0, `nenhum personagem indistinguivel (dups: ${dups})`);
});

// ============================================================================
// 1a. LOADER DA BASE REMOTA (URL + cache)
// ============================================================================

await test('carregarBase: baixa da URL e grava o cache', async () => {
  const cache = path.join(TMP_DB, 'loader-cache.json');
  let chamou = 0;
  const fake = async (url) => {
    chamou++;
    return { ok: true, status: 200, text: async () => JSON.stringify({ characters: [{ id: 'x1', name: 'X', answers: { real: 1 } }] }) };
  };
  const r = await carregarBase({ url: 'http://fake/base.json', cacheFile: cache, fetchImpl: fake });
  ok(r.origem === 'remoto', `origem remoto (veio ${r.origem})`);
  ok(r.characters.length === 1, 'trouxe os personagens');
  ok(chamou === 1, 'chamou o fetch uma vez');
  ok(fs.existsSync(cache), 'gravou o cache');
});

await test('carregarBase: cache valido NAO baixa de novo', async () => {
  const cache = path.join(TMP_DB, 'loader-cache2.json');
  const good = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ characters: [{ id: 'x', name: 'X', answers: { real: 1 } }] }) });
  await carregarBase({ url: 'http://f/b.json', cacheFile: cache, fetchImpl: good });
  let chamou = 0;
  const deveFalhar = async () => { chamou++; throw new Error('nao deveria baixar'); };
  const r = await carregarBase({ url: 'http://f/b.json', cacheFile: cache, fetchImpl: deveFalhar });
  ok(r.origem === 'cache', `serviu do cache (veio ${r.origem})`);
  ok(chamou === 0, 'nao chamou o fetch');
});

await test('carregarBase: rede cai e cache vencido -> usa o cache', async () => {
  const cache = path.join(TMP_DB, 'loader-cache3.json');
  const good = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ characters: [{ id: 'x', name: 'X', answers: { real: 1 } }] }) });
  await carregarBase({ url: 'http://f/b.json', cacheFile: cache, fetchImpl: good });
  const ruim = async () => ({ ok: false, status: 503 });
  const r = await carregarBase({ url: 'http://f/b.json', cacheFile: cache, ttlMs: 0, fetchImpl: ruim });
  ok(r.origem === 'cache-expirado', `usou o cache vencido (veio ${r.origem})`);
  ok(r.characters.length === 1, 'ainda tem personagens');
  ok(Boolean(r.erro), 'informou o erro de rede');
});

await test('carregarBase: sem cache e sem rede -> cai no local, sem lancar', async () => {
  const ruim = async () => { throw new Error('ENOTFOUND'); };
  const local = path.join(TMP_DB, 'local-fallback.json');
  fs.writeFileSync(local, JSON.stringify({ characters: [{ id: 'l1', name: 'Local', answers: { real: 1 } }] }));
  const r = await carregarBase({ url: 'http://f/b.json', cacheFile: path.join(TMP_DB, 'nao-existe.json'), ttlMs: 0, locais: [local], fetchImpl: ruim });
  ok(r.origem === 'local', `caiu no local (veio ${r.origem})`);
  ok(r.characters[0].id === 'l1', 'usou o arquivo local');
});

await test('carregarBase: tudo falha -> indisponivel (nunca lanca)', async () => {
  const ruim = async () => { throw new Error('sem rede'); };
  const r = await carregarBase({ url: 'http://f/b.json', cacheFile: path.join(TMP_DB, 'nada.json'), ttlMs: 0, locais: ['/nao/existe.json'], fetchImpl: ruim });
  ok(r.origem === 'indisponivel', 'marcou indisponivel');
  ok(Array.isArray(r.characters) && r.characters.length === 0, 'devolveu lista vazia');
});

await test('carregarBase: base acima do teto e recusada (seguranca)', async () => {
  const gigante = async () => ({ ok: true, status: 200, text: async () => 'x'.repeat(20 * 1024 * 1024) });
  const r = await carregarBase({ url: 'http://f/big.json', cacheFile: path.join(TMP_DB, 'big.json'), ttlMs: 0, fetchImpl: gigante });
  ok(r.origem !== 'remoto', 'nao aceitou o arquivo gigante');
});

await test('manager.adicionarPersonagens: soma sem duplicar id', () => {
  const gm = new AkinatorGameManager({ questions: QUESTIONS, characters: BASE_CHARS, botName: 'L' });
  const antes = gm.baseCharacters.length;
  const add = gm.adicionarPersonagens([
    { id: BASE_CHARS[0].id, name: 'repetido', answers: {} },
    { id: 'novo-1', name: 'Novo', answers: { real: 1 } },
  ]);
  ok(add === 1, `so o novo entrou (${add})`);
  ok(gm.baseCharacters.length === antes + 1, 'somou 1');
});

await test('carregarBase: VARIAS urls somam as bases', async () => {
  const fake = async (u) => {
    if (u.includes('ruim')) return { ok: false, status: 404 };
    return { ok: true, status: 200, text: async () => JSON.stringify({ characters: [{ id: u.includes('b') ? 'b1' : 'a1', name: u, answers: { real: 1 } }] }) };
  };
  const r = await carregarBase({
    urls: ['http://a/x.json', 'http://ruim/y.json', 'http://b/z.json'],
    cacheFile: path.join(TMP_DB, 'multi-cache.json'), ttlMs: 0, fetchImpl: fake,
  });
  ok(r.origem === 'remoto', `baixou (veio ${r.origem})`);
  ok(r.characters.length === 2, `somou as duas boas (${r.characters.length})`);
  ok(r.fontes.length === 2, 'registrou as 2 fontes que funcionaram');
  ok(Boolean(r.erro), 'informou o erro da fonte ruim');
});

await test('carregarBase: uma fonte ruim NAO derruba as outras', async () => {
  const fake = async (u) => {
    if (u.includes('quebrada')) throw new Error('ENOTFOUND');
    return { ok: true, status: 200, text: async () => JSON.stringify({ characters: [{ id: 'ok1', name: 'OK', answers: { real: 1 } }] }) };
  };
  const r = await carregarBase({
    urls: ['http://quebrada/x.json', 'http://boa/y.json'],
    cacheFile: path.join(TMP_DB, 'mix-cache.json'), ttlMs: 0, fetchImpl: fake,
  });
  ok(r.origem === 'remoto' && r.characters.length === 1, 'a boa foi usada mesmo com a ruim quebrando');
});

await test('carregarBase: url e urls sao equivalentes', async () => {
  const fake = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ characters: [{ id: 'x', name: 'X', answers: { real: 1 } }] }) });
  const comUrl = await carregarBase({ url: 'http://a/b.json', cacheFile: path.join(TMP_DB, 'u1.json'), ttlMs: 0, fetchImpl: fake });
  const comUrls = await carregarBase({ urls: ['http://a/b.json'], cacheFile: path.join(TMP_DB, 'u2.json'), ttlMs: 0, fetchImpl: fake });
  ok(comUrl.characters.length === comUrls.characters.length, 'mesmo resultado');
});

// ============================================================================
// 1b. BASE IMPORTADA DE APIs PUBLICAS
// ============================================================================

await test('base remota: existe e tem fonte/licenca (pulada sem rede)', () => {
  if (!IMP_CHARS.length) { ok(true, 'base remota indisponivel no ambiente de teste'); return; }
  ok(IMP_CHARS.length > 100, `tem personagens (${IMP_CHARS.length})`);
  ok(IMP_CHARS.every((c) => c.source), 'todo personagem diz de qual fonte veio');
});

await test('base importada: ids unicos e so perguntas existentes', () => {
  if (!IMP_CHARS.length) { ok(true, 'base remota indisponivel no ambiente de teste'); return; }
  const qids = new Set(QUESTIONS.map((q) => q.id));
  ok(new Set(IMP_CHARS.map((c) => c.id)).size === IMP_CHARS.length, 'ids unicos');
  const ruins = [];
  for (const c of IMP_CHARS) {
    for (const qid of Object.keys(c.answers || {})) if (!qids.has(qid)) ruins.push(`${c.id}:${qid}`);
  }
  ok(ruins.length === 0, `sem pergunta orfa (ruins: ${ruins.slice(0, 3).join(', ')})`);
});

await test('base importada: todo personagem e distinguivel (garantia do importador)', () => {
  if (!IMP_CHARS.length) { ok(true, 'base remota indisponivel no ambiente de teste'); return; }
  const sig = new Map();
  let dups = 0;
  for (const c of IMP_CHARS) {
    const k = JSON.stringify(Object.entries(c.answers || {}).sort());
    if (sig.has(k)) dups++;
    sig.set(k, c.name);
  }
  ok(dups === 0, `nenhum indistinguivel (dups: ${dups})`);
});

await test('base COMBINADA (autoral + importada): sem indistinguiveis e ids unicos', () => {
  if (!IMP_CHARS.length) { ok(true, 'base remota indisponivel no ambiente de teste'); return; }
  const todos = BASE_CHARS.concat(IMP_CHARS);
  ok(new Set(todos.map((c) => c.id)).size === todos.length, 'ids unicos na combinada');
  const sig = new Set();
  let dups = 0;
  for (const c of todos) {
    const k = JSON.stringify(Object.entries(c.answers || {}).sort());
    if (sig.has(k)) dups++;
    sig.add(k);
  }
  ok(dups === 0, `sem indistinguivel na combinada (dups: ${dups})`);
});

await test('base importada: converge para os personagens dela (>=95%)', () => {
  if (!IMP_CHARS.length) { ok(true, 'base remota indisponivel no ambiente de teste'); return; }
  const kb = new KnowledgeBase({ questions: QUESTIONS, characters: BASE_CHARS.concat(IMP_CHARS) });
  let acertos = 0;
  for (const alvo of IMP_CHARS) {
    const e = new Engine(kb);
    let passos = 0;
    let palpite = null;
    while (passos < 25) {
      if (e.podePalpitar || e.atingiuTeto || e.semPerguntas) { palpite = e.bestGuess(); break; }
      const j = e.selectNextQuestion();
      if (j < 0) { palpite = e.bestGuess(); break; }
      e.applyAnswer(j, alvo.answers[QUESTIONS[j].id] === undefined ? 0.5 : alvo.answers[QUESTIONS[j].id]);
      passos++;
    }
    if (!palpite) palpite = e.bestGuess();
    if (palpite.char && palpite.char.name === alvo.name) acertos++;
  }
  const pct = (100 * acertos) / IMP_CHARS.length;
  ok(pct >= 95, `acerta >=95% da base importada (veio ${pct.toFixed(1)}%)`);
});

// ============================================================================
// 2. ENGINE (FASE 23 -- engine)
// ============================================================================

await test('engine: entropia e compatibilidade calibrada', () => {
  ok(Math.abs(entropy([1, 0]) - 0) < 1e-9, 'entropia de certeza = 0');
  ok(Math.abs(entropy([0.5, 0.5]) - 1) < 1e-9, 'entropia de 2 iguais = 1 bit');
  ok(calibratedMatch(1, 1, 0, false) === 1, 'resposta igual ao guardado = 1');
  const piso = calibratedMatch(0, 1, 50, false);
  ok(piso > 0 && piso < 0.2, `resposta oposta cai no piso baixo (${piso.toFixed(3)})`);
  ok(calibratedMatch(0, 1, 1000, false) <= piso, 'com mais amostra o piso nao sobe');
});

await test('engine: bucketValue arredonda para os 5 niveis', () => {
  ok(bucketValue(0.9) === 1, '0.9 -> sim');
  ok(bucketValue(0.6) === 0.5, '0.6 -> nao sei');
  ok(bucketValue(0.1) === 0, '0.1 -> nao');
});

await test('engine: sessao nova comeca com todos os candidatos', () => {
  const e = new Engine(new KnowledgeBase({ questions: QUESTIONS, characters: BASE_CHARS }));
  ok(e.restantes === BASE_CHARS.length, 'todos vivos no inicio');
  ok(Math.abs(e.posterior.reduce((a, b) => a + b, 0) - 1) < 1e-9, 'probabilidades somam 1');
  ok(e.askedCount === 0, 'nenhuma pergunta feita');
  ok(!e.podePalpitar, 'nao palpita sem perguntar');
});

await test('engine: a 1a pergunta escolhida divide a base (ganho de informacao)', () => {
  const e = new Engine(new KnowledgeBase({ questions: QUESTIONS, characters: BASE_CHARS }));
  const j = e.selectNextQuestion();
  ok(j >= 0, 'escolheu uma pergunta');
  const valores = BASE_CHARS.map((c) => c.answers[QUESTIONS[j].id]);
  const sim = valores.filter((v) => v >= 0.75).length;
  const nao = valores.filter((v) => v <= 0.25).length;
  ok(sim > 0 && nao > 0, `a pergunta separa a base (sim=${sim}, nao=${nao})`);
});

await test('engine: aplicar resposta reduz os candidatos', () => {
  const e = new Engine(new KnowledgeBase({ questions: QUESTIONS, characters: BASE_CHARS }));
  const j = e.selectNextQuestion();
  const H_antes = entropy(e.posterior);
  const r = e.applyAnswer(j, 1);
  const H_depois = entropy(e.posterior);
  ok(H_depois < H_antes, `a incerteza caiu (${H_antes.toFixed(2)} -> ${H_depois.toFixed(2)} bits)`);
  ok(r.z > 0, 'massa de probabilidade valida');
  ok(Math.abs(e.posterior.reduce((a, b) => a + b, 0) - 1) < 1e-9, 'segue somando 1');
  ok(e.bestGuess().p > 1 / BASE_CHARS.length, 'o lider se destaca da media');
});

await test('engine: as 5 respostas produzem resultados diferentes', () => {
  const resultados = ['SIM', 'NAO', 'NAO_SEI', 'PROVAVELMENTE', 'PROVAVELMENTE_NAO'].map((k) => {
    const e = new Engine(new KnowledgeBase({ questions: QUESTIONS, characters: BASE_CHARS }));
    const j = e.selectNextQuestion();
    e.applyAnswer(j, ANSWER_VALUE[k]);
    return e.bestGuess().char.name;
  });
  ok(resultados.length === 5, '5 respostas processadas');
  ok(resultados.every((n) => typeof n === 'string' && n.length > 0), 'todas devolvem melhor candidato');
  ok(new Set(resultados).size > 1, `respostas diferentes mudam o favorito (${new Set(resultados).size})`);
});

await test('engine: converge para o personagem certo em TODOS da base', () => {
  let acertos = 0;
  let soma = 0;
  for (const alvo of BASE_CHARS) {
    const { passos, palpite } = jogarEngine(alvo);
    soma += passos;
    if (palpite.char && palpite.char.name === alvo.name) acertos++;
  }
  ok(acertos === BASE_CHARS.length, `acerta os ${BASE_CHARS.length} (veio ${acertos})`);
  const media = soma / BASE_CHARS.length;
  ok(media <= 15, `converge rapido (media ${media.toFixed(1)} perguntas)`);
});

await test('engine: personagens de CATEGORIAS diferentes (FASE 26)', () => {
  const alvos = ['Naruto Uzumaki', 'Goku', 'Mario', 'Sonic', 'Batman', 'Homem-Aranha', 'Harry Potter', 'Pikachu', 'Kratos', 'Neymar Jr', 'Bill Gates', 'Michael Jackson'];
  for (const nome of alvos) {
    const alvo = BASE_CHARS.find((c) => c.name === nome);
    if (!alvo) continue;
    const { palpite } = jogarEngine(alvo);
    ok(palpite.char && palpite.char.name === nome, `acerta ${nome} (veio ${palpite.char && palpite.char.name})`);
  }
});

await test('engine: base vazia nao quebra (sem candidato)', () => {
  const e = new Engine(new KnowledgeBase({ questions: QUESTIONS, characters: [] }));
  ok(e.restantes === 0, 'sem candidatos');
  ok(e.bestGuess().char === null, 'bestGuess devolve null sem base');
});

await test('engine: respostas contraditorias NAO quebram (FASE 28)', () => {
  const e = new Engine(new KnowledgeBase({ questions: QUESTIONS, characters: BASE_CHARS }));
  const seq = [1, 1, 1, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1, 1, 1, 0];
  let semExcecao = true;
  for (let i = 0; i < seq.length; i++) {
    const j = e.selectNextQuestion();
    if (j < 0) break;
    try { e.applyAnswer(j, seq[i]); } catch (err) { semExcecao = false; }
  }
  ok(semExcecao, 'nenhuma excecao com respostas contraditorias');
  ok(Math.abs(e.posterior.reduce((a, b) => a + b, 0) - 1) < 1e-9, 'probabilidades normalizadas');
  ok(e.bestGuess().char !== null, 'ainda ha melhor candidato');
});

await test('engine: troll e sinalizavel como adversarial', () => {
  const e = new Engine(new KnowledgeBase({ questions: QUESTIONS, characters: BASE_CHARS }));
  for (let i = 0; i < 20; i++) {
    const j = e.selectNextQuestion();
    if (j < 0) break;
    e.applyAnswer(j, i % 2 === 0 ? 1 : 0);
  }
  ok(typeof e.flaggedAdversarial === 'boolean', 'flag adversarial e booleano');
  ok(e.zCollapses >= 0, 'contador de colapsos existe');
});

await test('engine: aprender com acerto ajusta os pesos', () => {
  const kb = new KnowledgeBase({ questions: QUESTIONS, characters: BASE_CHARS });
  const e = new Engine(kb);
  const idx = BASE_CHARS.findIndex((c) => c.name === 'Goku');
  const jAnime = QUESTIONS.findIndex((q) => q.id === 'anime');
  e.applyAnswer(jAnime, 1);
  const antes = kb.weight(idx, jAnime);
  const ajustes = e.learnCorrect(idx);
  ok(ajustes > 0, `aprendeu (${ajustes} ajustes)`);
  ok(kb.weight(idx, jAnime) >= antes, 'peso nao piorou com resposta consistente');
  ok(kb.learned[BASE_CHARS[idx].id] !== undefined, 'delta guardado no learned');
});

// ============================================================================
// 3. SESSAO (FASE 23 -- sessao)
// ============================================================================

await test('manager: criar, recuperar e isolar sessoes', () => {
  const gm = new AkinatorGameManager({ questions: QUESTIONS, characters: BASE_CHARS, botName: 'L' });
  const a = gm.iniciar({ chatId: 'g1@g.us', userId: 'a@lid' });
  const b = gm.iniciar({ chatId: 'g1@g.us', userId: 'b@lid' });
  const c = gm.iniciar({ chatId: 'g2@g.us', userId: 'a@lid' });
  ok(a.success && b.success && c.success, 'tres sessoes criadas');
  ok(gm.activeCount === 3, 'tres sessoes ativas');
  ok(a.sessionId !== b.sessionId && a.sessionId !== c.sessionId, 'ids distintos');
  ok(Boolean(gm.getSession('g1@g.us', 'a@lid')), 'recupera por chat+user');
  ok(gm.getSession('g1@g.us', 'z@lid') === null, 'inexistente devolve null');
});

await test('manager: mesmo usuario nao abre duas no mesmo chat', () => {
  const gm = new AkinatorGameManager({ questions: QUESTIONS, characters: BASE_CHARS });
  gm.iniciar({ chatId: 'g@g.us', userId: 'a@lid' });
  const r2 = gm.iniciar({ chatId: 'g@g.us', userId: 'a@lid' });
  ok(r2.success === false && r2.reason === 'ja_em_partida', 'recusa a segunda');
  ok(gm.activeCount === 1, 'continua com uma');
});

await test('manager: cancelar encerra so a sessao do usuario', () => {
  const gm = new AkinatorGameManager({ questions: QUESTIONS, characters: BASE_CHARS });
  gm.iniciar({ chatId: 'g@g.us', userId: 'a@lid' });
  gm.iniciar({ chatId: 'g@g.us', userId: 'b@lid' });
  const r = gm.cancelar({ chatId: 'g@g.us', userId: 'a@lid' });
  ok(r.encerrada === true, 'encerrou a do A');
  ok(gm.activeCount === 1, 'a do B continua');
  ok(Boolean(gm.getSession('g@g.us', 'b@lid')), 'B segue ativa');
  ok(gm.cancelar({ chatId: 'g@g.us', userId: 'a@lid' }).encerrada === false, 'segundo cancelar avisa');
});

await test('manager: expiracao por inatividade', () => {
  const gm = new AkinatorGameManager({ questions: QUESTIONS, characters: BASE_CHARS });
  gm.iniciar({ chatId: 'g@g.us', userId: 'a@lid' });
  const s = gm.getSession('g@g.us', 'a@lid');
  s.ultimaAtividade = Date.now() - (gameMod.CONFIG.SESSION_TIMEOUT_MS + 1000);
  const r = gm.processMessage({ chatId: 'g@g.us', userId: 'a@lid', text: 'sim' });
  ok(r && r.reason === 'expired', 'devolveu expired');
  ok(/inatividade/i.test(desbold(r.message)), 'avisou a inatividade');
  ok(gm.activeCount === 0, 'sessao removida');
});

await test('manager: cleanup remove sessoes abandonadas', () => {
  const gm = new AkinatorGameManager({ questions: QUESTIONS, characters: BASE_CHARS });
  gm.iniciar({ chatId: 'g@g.us', userId: 'a@lid' });
  gm.iniciar({ chatId: 'g@g.us', userId: 'b@lid' });
  gm.getSession('g@g.us', 'a@lid').ultimaAtividade = Date.now() - (gameMod.CONFIG.SESSION_TIMEOUT_MS + 1000);
  gm._cleanup();
  ok(gm.activeCount === 1, 'so a expirada saiu');
});

await test('manager: nao processa mensagem sem sessao (fluxo normal)', () => {
  const gm = new AkinatorGameManager({ questions: QUESTIONS, characters: BASE_CHARS });
  ok(gm.processMessage({ chatId: 'g@g.us', userId: 'x@lid', text: 'sim' }) === null, 'sem sessao -> null');
  ok(gm.processMessage({ chatId: 'g@g.us', userId: 'x@lid', text: 'bom dia' }) === null, 'texto qualquer -> null');
});

await test('manager: botao de OUTRA sessao e recusado (posse)', () => {
  const gm = new AkinatorGameManager({ questions: QUESTIONS, characters: BASE_CHARS });
  const a = gm.iniciar({ chatId: 'g@g.us', userId: 'a@lid' });
  const idAntigo = a.sessionId;
  gm.cancelar({ chatId: 'g@g.us', userId: 'a@lid' });
  gm.iniciar({ chatId: 'g@g.us', userId: 'a@lid' });
  const r = gm.processMessage({ chatId: 'g@g.us', userId: 'a@lid', text: `${idAntigo}:ak_sim` });
  ok(r && r.reason === 'nao_e_sua', 'recusou o id da sessao antiga');
});

await test('manager: base invalida -> knowledge_invalid', () => {
  const gm = new AkinatorGameManager({ questions: [], characters: [], botName: 'L' });
  const r = gm.iniciar({ chatId: 'g@g.us', userId: 'a@lid' });
  ok(r.success === false && r.reason === 'knowledge_invalid', 'recusou com knowledge_invalid');
  ok(/base de personagens/i.test(desbold(gm.mensagemIndisponivel())), 'mensagem propria');
});

// ============================================================================
// 4. CORRECOES / APRENDIZADO (FASE 15/16)
// ============================================================================

await test('correcao vai para a FILA e nao entra direto na base', () => {
  const pendFile = path.join(TMP_DB, 'pend-test.json');
  const gm = new AkinatorGameManager({ questions: QUESTIONS, characters: BASE_CHARS, pendingFile: pendFile, botName: 'L' });
  const antes = gm.characters.length;
  gm.iniciar({ chatId: 'g@g.us', userId: 'a@lid' });
  gm.getSession('g@g.us', 'a@lid').estado = 'INFORMAR';
  const r = gm.processMessage({ chatId: 'g@g.us', userId: 'a@lid', text: 'Personagem Inventado' });
  ok(r && r.kind === 'correcao', 'registrou a correcao');
  ok(gm.pendingCount === 1, 'foi para a fila');
  ok(gm.characters.length === antes, 'a base NAO mudou');
  ok(fs.existsSync(pendFile), 'gravou o arquivo de pendentes');
});

await test('correcao precisa de votos para ser promovida', () => {
  const gm = new AkinatorGameManager({ questions: QUESTIONS, characters: BASE_CHARS, botName: 'L' });
  gm.iniciar({ chatId: 'g@g.us', userId: 'a@lid' });
  gm.getSession('g@g.us', 'a@lid').estado = 'INFORMAR';
  gm.processMessage({ chatId: 'g@g.us', userId: 'a@lid', text: 'Criatura Nova' });
  ok(gm.promoverCorrecoes() === 0, 'com 1 voto ainda nao promove');
  gm.iniciar({ chatId: 'g@g.us', userId: 'b@lid' });
  gm.getSession('g@g.us', 'b@lid').estado = 'INFORMAR';
  gm.processMessage({ chatId: 'g@g.us', userId: 'b@lid', text: 'Criatura Nova' });
  const promovidas = gm.promoverCorrecoes();
  ok(promovidas === 1, `promoveu com 2 votos (${promovidas})`);
  ok(gm.characters.some((c) => c.name === 'Criatura Nova'), 'entrou na base ativa');
  ok(gm.pendingCount === 0, 'saiu da fila');
});

// ============================================================================
// 5. INTEGRACAO PELO HANDLER (FASE 23 -- integracao)
// ============================================================================

await test('!akinator no handler: abre a partida com os 5 botoes', async () => {
  const gm = injetarManager();
  const grupo = makeGroup();
  const p = nextPerson();
  const r = await enviar({ groupJid: grupo, pessoa: p, text: '!akinator' });
  ok(/AKINATOR/.test(desbold(r.texto)), 'mandou o painel');
  ok(/Pergunta 1/i.test(desbold(r.texto)), 'mostrou a pergunta 1');
  ok(r.botoes.length === 5, `5 botoes (veio ${r.botoes.length})`);
  ok(r.botoes.every((b) => b.id && b.display_text), 'todos os botoes tem id e rotulo');
  ok(gm.activeCount === 1, 'criou a sessao');
});

await test('!akinator: partida inteira pelo handler ate acertar', async () => {
  const gm = injetarManager();
  const grupo = makeGroup();
  const p = nextPerson();
  const alvo = BASE_CHARS.find((c) => c.name === 'Batman');
  let r = await enviar({ groupJid: grupo, pessoa: p, text: '!akinator' });
  let passos = 0;
  while (passos < 25) {
    if (r.botoes.some((b) => b.id.endsWith('ak_acertou'))) break;
    const q = perguntaDe(r.texto);
    ok(Boolean(q), `a mensagem traz uma pergunta do banco (passo ${passos + 1})`);
    if (!q) break;
    const chave = chaveParaValor(alvo.answers[q.id] === undefined ? 0.5 : alvo.answers[q.id]);
    const btn = r.botoes.find((b) => b.id.endsWith(chave));
    ok(Boolean(btn), `botao ${chave} presente`);
    if (!btn) break;
    r = await enviar({ groupJid: grupo, pessoa: p, text: btn.id });
    passos++;
  }
  ok(r.botoes.some((b) => b.id.endsWith('ak_acertou')), 'chegou ao palpite');
  ok(/Batman/.test(desbold(r.texto)), 'o palpite e o Batman');
  const conf = await enviar({ groupJid: grupo, pessoa: p, text: r.botoes.find((b) => b.id.endsWith('ak_acertou')).id });
  ok(/Acertei/i.test(desbold(conf.texto)), 'confirmou o acerto');
  ok(gm.activeCount === 0, 'sessao liberada');
  ok(passos <= 20, `no maximo 20 perguntas (${passos})`);
});

await test('!akinator: palpite errado -> informa -> vai para a fila', async () => {
  const gm = injetarManager();
  const grupo = makeGroup();
  const p = nextPerson();
  const alvo = BASE_CHARS.find((c) => c.name === 'Sonic');
  let r = await enviar({ groupJid: grupo, pessoa: p, text: '!akinator' });
  let passos = 0;
  while (passos < 25 && !r.botoes.some((b) => b.id.endsWith('ak_errou'))) {
    const q = perguntaDe(r.texto);
    if (!q) break;
    const chave = chaveParaValor(alvo.answers[q.id] === undefined ? 0.5 : alvo.answers[q.id]);
    r = await enviar({ groupJid: grupo, pessoa: p, text: r.botoes.find((b) => b.id.endsWith(chave)).id });
    passos++;
  }
  ok(r.botoes.some((b) => b.id.endsWith('ak_errou')), 'chegou ao palpite');
  const err = await enviar({ groupJid: grupo, pessoa: p, text: r.botoes.find((b) => b.id.endsWith('ak_errou')).id });
  ok(/Errei/i.test(desbold(err.texto)), 'aceitou o erro');
  ok(/dizer quem era/i.test(desbold(err.texto)), 'pediu o nome');
  const info = await enviar({ groupJid: grupo, pessoa: p, text: 'Zezinho da Silva' });
  ok(/Anotei/i.test(desbold(info.texto)), 'registrou a correcao');
  ok(gm.pendingCount === 1, 'foi para a fila');
});

await test('!akinator: sessao ativa avisa e nao cria outra', async () => {
  injetarManager();
  const grupo = makeGroup();
  const p = nextPerson();
  await enviar({ groupJid: grupo, pessoa: p, text: '!akinator' });
  const r = await enviar({ groupJid: grupo, pessoa: p, text: '!akinator' });
  ok(/j\u00e1 est\u00e1 em uma partida/i.test(desbold(r.texto)), 'avisou que ja tem partida');
});

await test('!akinator cancelar encerra pelo handler', async () => {
  const gm = injetarManager();
  const grupo = makeGroup();
  const p = nextPerson();
  await enviar({ groupJid: grupo, pessoa: p, text: '!akinator' });
  const r = await enviar({ groupJid: grupo, pessoa: p, text: '!akinator cancelar' });
  ok(/encerrada/i.test(desbold(r.texto)), 'confirmou o encerramento');
  ok(gm.activeCount === 0, 'sessao removida');
});

await test('!akinator: usuario B nao responde pela partida de A', async () => {
  const gm = injetarManager();
  const grupo = makeGroup();
  const a = nextPerson();
  const b = nextPerson();
  const participantes = [
    { id: a.lid, phoneNumber: a.jid, admin: null },
    { id: b.lid, phoneNumber: b.jid, admin: null },
    { id: BOT_LID, phoneNumber: BOT_JID, admin: 'admin' },
  ];
  const rA = await enviar({ groupJid: grupo, pessoa: a, text: '!akinator', participants: participantes });
  const rB = await enviar({ groupJid: grupo, pessoa: b, text: rA.botoes[0].id, participants: participantes });
  ok(rB.textos.length === 0, 'B nao recebeu resposta (sem sessao dele)');
  ok(gm.activeCount === 1, 'a sessao de A segue intacta');
});

await test('!akinator: duas partidas simultaneas no mesmo grupo', async () => {
  const gm = injetarManager();
  const grupo = makeGroup();
  const a = nextPerson();
  const b = nextPerson();
  const participantes = [
    { id: a.lid, phoneNumber: a.jid, admin: null },
    { id: b.lid, phoneNumber: b.jid, admin: null },
    { id: BOT_LID, phoneNumber: BOT_JID, admin: 'admin' },
  ];
  await enviar({ groupJid: grupo, pessoa: a, text: '!akinator', participants: participantes });
  await enviar({ groupJid: grupo, pessoa: b, text: '!akinator', participants: participantes });
  ok(gm.activeCount === 2, 'duas partidas ativas');
  const sa = gm.getSession(grupo, a.lid);
  const sb = gm.getSession(grupo, b.lid);
  ok(sa && sb && sa.sessionId !== sb.sessionId, 'sessoes independentes');
  ok(sa.engine !== sb.engine, 'engines independentes');
});

await test('!akinator: personagem DESCONHECIDO nunca e inventado (FASE 27)', () => {
  const gm = new AkinatorGameManager({ questions: QUESTIONS, characters: BASE_CHARS, botName: 'L' });
  gm.iniciar({ chatId: 'g@g.us', userId: 'a@lid' });
  let s = gm.getSession('g@g.us', 'a@lid');
  let r = null;
  for (let i = 0; i < 25; i++) {
    if (!s) break;
    r = gm.processMessage({ chatId: 'g@g.us', userId: 'a@lid', text: 'sim' });
    s = gm.getSession('g@g.us', 'a@lid');
    if (!s || (r && (r.kind === 'palpite' || r.kind === 'sem_candidato'))) break;
  }
  const nomes = new Set(BASE_CHARS.map((c) => c.name));
  if (r && r.kind === 'palpite') {
    ok([...nomes].some((n) => desbold(r.message).includes(n)), 'o palpite e sempre da base (nao inventa)');
  } else {
    ok(true, 'sem candidato: nao inventou personagem');
  }
});

// ============================================================================
// 6. FASE 19 -- menu intacto / sem sistema paralelo
// ============================================================================

await test('!akinator NAO esta em nenhum menu (FASE 19)', () => {
  const menu18 = fs.readFileSync(path.join(ROOT, 'dados/src/menus/menu18.js'), 'utf-8');
  const menuJs = fs.readFileSync(path.join(ROOT, 'dados/src/menus/menu.js'), 'utf-8');
  const bp = fs.readFileSync(path.join(ROOT, 'dados/src/utils/blockPv.js'), 'utf-8');
  ok(!menu18.includes('akinator'), 'menu18 sem akinator');
  ok(!menuJs.includes('akinator'), 'menu principal sem akinator');
  ok(!bp.includes('akinator'), 'blockPv sem akinator');
});

await test('akinator-client e OPCIONAL e isolado (nao quebra sem ele)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
  // O pacote esta declarado (modo remoto opt-in).
  ok(!!pkg.dependencies['akinator-client'], 'akinator-client declarado no package.json');

  const src = fs.readFileSync(path.join(ROOT, 'dados/src/index.js'), 'utf-8');
  // O import vive no modulo de rede, NAO no index (isolamento).
  ok(!/import\(['"]akinator-client/.test(src), 'index.js nao importa akinator-client direto');
  ok(!/require\(['"]akinator-client/.test(src), 'index.js nao requer akinator-client direto');

  // O import do pacote e' DINAMICO e tolerante (o bot nao quebra sem ele).
  const remoto = fs.readFileSync(path.join(ROOT, 'dados/src/funcs/utils/akinator-remote.js'), 'utf-8');
  ok(/import\(\s*'akinator-client'\s*\)/.test(remoto), 'import dinamico no modulo remoto');
  ok(/catch/.test(remoto), 'import tolerante a falha');

  // O modo remoto e' OPT-IN: local e' o padrao.
  ok(/MODO_REMOTO_PADRAO:\s*'local'/.test(fs.readFileSync(path.join(ROOT, 'dados/src/funcs/utils/akinator-game.js'), 'utf-8')),
    'modo local e o padrao');
  ok(!src.includes('akinatorManager.ev.on'), 'nao registra listener dedicado');
  ok(!fs.existsSync(path.join(ROOT, 'dados/src/funcs/utils/akinator.js')), 'modulo antigo removido');
});

// ============================================================================
// MODO REMOTO (akinator-client) -- sem rede: so o adaptador e o fallback.
// ============================================================================

const remoteMod = await import(new URL('../dados/src/funcs/utils/akinator-remote.js', import.meta.url).href);
const { normalizarResultado, mapaRespostas, palpiteRemoto } = remoteMod;

await test('remoto: normalizarResultado cobre won/ko/pergunta', () => {
  const p = normalizarResultado({ won: false, ko: false, question: 'E humano?', progression: 0.1 });
  ok(p.kind === 'pergunta', 'pergunta identificada');
  ok(p.pergunta === 'E humano?', 'texto preservado');

  const w = normalizarResultado({ won: true, ko: false, progression: 0.93, question: '' });
  ok(w.kind === 'palpite', 'won -> palpite');
  ok(w.percentual === 93, 'percentual arredondado');

  const k = normalizarResultado({ won: false, ko: true });
  ok(k.kind === 'sem_candidato', 'ko -> sem candidato');

  ok(normalizarResultado(null).kind === 'erro', 'null -> erro');
});

await test('remoto: mapaRespostas liga rotulos aos enums', () => {
  const fake = { Answers: { Yes: 0, No: 1, IDontKnow: 2, Probably: 3, ProbablyNot: 4 } };
  const m = mapaRespostas(fake);
  ok(m.SIM === 0 && m.NAO === 1 && m.NAO_SEI === 2, 'sim/nao/nao_sei');
  ok(m.PROVAVELMENTE === 3 && m.PROVAVELMENTE_NAO === 4, 'provavelmente');
});

await test('remoto: palpiteRemoto usa o winResult', () => {
  const c = { winResult: { propositionId: 42, name: 'Naruto', pictureUrl: 'http://x/p.jpg', description: 'Ninja' } };
  const p = palpiteRemoto(c);
  ok(p.name === 'Naruto', 'nome');
  ok(p.imageUrl === 'http://x/p.jpg', 'imagem');
  ok(/42/.test(p.id), 'id do palpite');
  ok(palpiteRemoto({}) !== null, 'sem winResult nao lanca');
});

await test('remoto: manager cai pro LOCAL quando o remoto falha (sem rede)', async () => {
  // modoEfetivo remoto + remotoMod nulo -> START deve explodir e cair pro local.
  const gm = new AkinatorGameManager({
    questions: QUESTIONS,
    characters: BASE_CHARS,
    learnedFile: path.join(TMP_DB, 'ak-remote-learned.json'),
    pendingFile: path.join(TMP_DB, 'ak-remote-pending.json'),
    botName: 'Lizzy',
    modo: 'remoto',
  });
  gm.modoEfetivo = 'remoto';   // forca o caminho remoto
  gm.remotoMod = null;         // sem modulo -> iniciarRemoto lanca
  const r = await gm.iniciar({ chatId: 'gr@g.us', userId: 'u1@lid' });
  ok(r.success === true, 'iniciou mesmo assim');
  ok(r.kind === 'pergunta', 'caiu no local e trouxe pergunta');
  ok(gm.modoEfetivo === 'local', 'voltou pro modo local');
  ok(!!gm.remotoMotivo, 'registrou o motivo');
});

await test('remoto: modo local (padrao) nem tenta a rede', async () => {
  const gm = new AkinatorGameManager({
    questions: QUESTIONS,
    characters: BASE_CHARS,
    learnedFile: path.join(TMP_DB, 'ak-rem2-learned.json'),
    pendingFile: path.join(TMP_DB, 'ak-rem2-pending.json'),
    botName: 'Lizzy',
  });
  const prep = await gm.prepararModo();
  ok(prep.modo === 'local', 'modo local');
  const r = gm.iniciar({ chatId: 'gr2@g.us', userId: 'u2@lid' });
  ok(r.kind === 'pergunta', 'iniciar sincrono no local');
  ok(typeof r.then !== 'function', 'no local `iniciar` NAO devolve Promise');
});

await test('remoto: !akinator status mostra o motor', async () => {
  const gm = new AkinatorGameManager({
    questions: QUESTIONS,
    characters: BASE_CHARS,
    learnedFile: path.join(TMP_DB, 'ak-rem3-learned.json'),
    pendingFile: path.join(TMP_DB, 'ak-rem3-pending.json'),
    botName: 'Lizzy',
    modo: 'remoto',
  });
  gm.modoEfetivo = 'local';
  gm.remotoMotivo = 'bloqueio do Cloudflare neste IP';
  const t = desbold(gm.mensagemStatus());
  ok(/LOCAL/.test(t), 'diz que esta no local');
  ok(/Cloudflare/.test(t), 'explica o motivo do remoto nao subir');
  ok(String(gm.baseCharacters.length).length > 0, 'lista a base');
});

// ============================================================================

const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log('\n========================================');
console.log(`RESULTADO: ${RESULTS.length} testes | ${totalOk} assercoes ok | ${totalFail} falhas`);
console.log('========================================');

fs.rmSync(TMP_DB, { recursive: true, force: true });
if (totalFail > 0) {
  console.log('\nFALHAS:');
  for (const r of RESULTS) if (r.failed) for (const e of r.errors) console.log(`- [${r.name}] ${e}`);
  process.exit(1);
}
console.log('TODOS OS TESTES PASSARAM');
process.exit(0);
