/**
 * !akinator — adivinhacao de pessoa/personagem via `akinator-client`.
 *
 * Roda o HANDLER REAL com socket falso e um CLIENTE FALSO injetado: o modulo
 * recebe a fabrica de cliente e os enums de fora, entao o jogo inteiro roda sem
 * rede. E assim que testamos o fluxo mesmo quando o servico do Akinator esta
 * bloqueado (Cloudflare) no IP da maquina.
 *
 * Cobre o checklist da spec secao 36: inicializacao, as 5 respostas, dois
 * usuarios simultaneos, isolamento, cancelamento, timeout, won, ko, erro de
 * rede, clique duplicado e imagem indisponivel.
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

const akinatorModule = await import(new URL('../dados/src/funcs/utils/akinator.js', import.meta.url).href);
const { AkinatorManager, parseAnswerInput, toAnswerEnum, encurtar, percentual, buildAnswerButtons,
  transportFromEnv, classificarFalha } = akinatorModule;
const realLib = await import('akinator-client');

const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';
const ENUMS = { Answers: realLib.Answers, Themes: realLib.Themes, Languages: realLib.Languages };

/** Cliente falso: roteiro controlado, sem rede. */
function makeFakeClient(overrides = {}) {
  const chamadas = { answer: [], back: 0, submitWin: 0, continue: 0 };
  const client = {
    chamadas,
    winResult: { name: 'Naruto Uzumaki', pictureUrl: 'https://x.invalid/n.png', description: 'Um ninja muito famoso. ' .repeat(30) },
    start: async () => ({ question: 'E uma pessoa real?', progression: 0, step: 0, won: false, ko: false }),
    answer: async (a) => { chamadas.answer.push(a); return { question: `Pergunta apos resposta ${a}`, progression: 20 + chamadas.answer.length * 10, won: false, ko: false }; },
    back: async () => { chamadas.back += 1; return { question: 'Voltou', progression: 10, won: false, ko: false }; },
    submitWin: async () => { chamadas.submitWin += 1; },
    continue: async () => { chamadas.continue += 1; return { question: 'Nova pergunta', progression: 50, won: false, ko: false }; },
    ...overrides,
  };
  return client;
}

/** Cria um manager com a fabrica de cliente dada. */
function makeManager(factory, botName = 'Lizzy') {
  return new AkinatorManager({ createClient: factory || (() => makeFakeClient()), enums: ENUMS, botName });
}

/** Id real de um botao no formato de fio. */
const btnId = (b) => { try { return JSON.parse(b.buttonParamsJson).id; } catch (e) { return null; } };

let groupCounter = 0;
function makeGroup(extra = {}) {
  groupCounter += 1;
  const jid = `120363990000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(path.join(GRUPOS_DIR, `${jid}.json`),
    JSON.stringify({ groupName: `AK ${groupCounter}`, modobrincadeira: true, ...extra }, null, 2));
  return jid;
}

let senderSeq = 0;
function nextPerson() {
  senderSeq += 1;
  const n = String(senderSeq).padStart(4, '0');
  return { lid: `5578${n}000000@lid`, jid: `5510${n}999999@s.whatsapp.net`, name: `5578${n}000000` };
}

/** Envia pelo handler real; devolve textos e os botoes enviados. */
async function enviar({ groupJid, pessoa, text, participants }) {
  const sent = [];
  const nazu = {
    sent,
    sendMessage: async (jid, content, options) => { sent.push({ jid, content, options }); return { key: { id: `S${sent.length}` } }; },
    relayMessage: async (jid, message, options) => { sent.push({ jid, message, options, via: 'relay' }); return options?.messageId; },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
    onWhatsApp: async (jid) => [{ jid, exists: true, lid: pessoa.lid }],  // PN -> LID fiel ao remetente
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
  // Os botoes vao por relayMessage (interactiveMessage -> nativeFlowMessage),
  // com o id dentro do paramsJson. Extraimos o id real (que carrega o sessionId).
  const brutos = sent
    .map((s) => s.message?.viewOnceMessage?.message?.interactiveMessage?.nativeFlowMessage?.buttons)
    .filter(Boolean)
    .flat();
  const botoes = brutos.map((bt) => {
    let params = {};
    try { params = JSON.parse(bt.buttonParamsJson || '{}'); } catch (e) { params = {}; }
    return { name: bt.name, text: params.display_text, id: params.id };
  });
  const botoesTexto = botoes.map((x) => x.text).filter(Boolean);
  return { sent, textos, texto: textos.join('\n'), botoes, botoesTexto, viaRelay: sent.filter((s) => s.via === 'relay').length };
}

// ============================================================================
// 1. FUNCOES PURAS
// ============================================================================

await test('parseAnswerInput: id de botao dos 5 + ACERTOU/ERROU', () => {
  ok(parseAnswerInput('ak1:ak_sim').resposta === 'SIM', 'ak_sim -> SIM');
  ok(parseAnswerInput('ak1:ak_nao').resposta === 'NAO', 'ak_nao -> NAO');
  ok(parseAnswerInput('ak1:ak_nao_sei').resposta === 'NAO_SEI', 'ak_nao_sei -> NAO_SEI');
  ok(parseAnswerInput('ak1:ak_provavelmente').resposta === 'PROVAVELMENTE', 'ak_provavelmente');
  ok(parseAnswerInput('ak1:ak_provavelmente_nao').resposta === 'PROVAVELMENTE_NAO', 'ak_provavelmente_nao');
  ok(parseAnswerInput('ak1:ak_acertou').resposta === 'ACERTOU', 'ak_acertou');
  ok(parseAnswerInput('ak1:ak_errou').resposta === 'ERROU', 'ak_errou');
  ok(parseAnswerInput('ak1:ak_sim').sessionId === 'ak1', 'devolve o sessionId do botao');
});

await test('parseAnswerInput: texto digitado tambem funciona', () => {
  for (const v of ['sim', 'SIM', 's']) ok(parseAnswerInput(v).resposta === 'SIM', `"${v}" -> SIM`);
  for (const v of ['não', 'NAO', 'nao', 'n']) ok(parseAnswerInput(v).resposta === 'NAO', `"${v}" -> NAO`);
  for (const v of ['não sei', 'nao sei']) ok(parseAnswerInput(v).resposta === 'NAO_SEI', `"${v}" -> NAO_SEI`);
  ok(parseAnswerInput('provavelmente').resposta === 'PROVAVELMENTE', 'provavelmente');
  ok(parseAnswerInput('provavelmente não').resposta === 'PROVAVELMENTE_NAO', 'provavelmente nao');
});

await test('parseAnswerInput: lixo devolve null (nao vira resposta)', () => {
  for (const v of ['bom dia', 'qualquer coisa longa demais para ser resposta', '', 'http://x.com', '!menu']) {
    ok(parseAnswerInput(v) === null, `"${v}" -> null`);
  }
});

await test('toAnswerEnum usa os valores REAIS do pacote (sem numero magico)', () => {
  ok(toAnswerEnum(ENUMS.Answers, 'SIM') === ENUMS.Answers.Yes, 'SIM -> Answers.Yes');
  ok(toAnswerEnum(ENUMS.Answers, 'NAO') === ENUMS.Answers.No, 'NAO -> Answers.No');
  ok(toAnswerEnum(ENUMS.Answers, 'NAO_SEI') === ENUMS.Answers.IDontKnow, 'NAO_SEI -> IDontKnow');
  ok(toAnswerEnum(ENUMS.Answers, 'PROVAVELMENTE') === ENUMS.Answers.Probably, 'PROVAVELMENTE -> Probably');
  ok(toAnswerEnum(ENUMS.Answers, 'PROVAVELMENTE_NAO') === ENUMS.Answers.ProbablyNot, 'PROV_NAO -> ProbablyNot');
  ok(toAnswerEnum(ENUMS.Answers, 'x') === null, 'desconhecido -> null');
  // Sanidade: os enums do pacote sao os que a doc diz.
  ok(ENUMS.Answers.Yes === 0 && ENUMS.Answers.No === 1 && ENUMS.Answers.IDontKnow === 2, 'valores 0..4 conferidos');
});

await test('buildAnswerButtons: 5 botoes com id que carrega a partida', () => {
  const b = buildAnswerButtons('akX');
  ok(b.length === 5, '5 botoes');
  ok(b.every((x) => btnId(x) && btnId(x).startsWith('akX:')), 'todos carregam o sessionId');
  const rot = b.map((x) => JSON.parse(x.buttonParamsJson).display_text);
  ok(rot[0] === 'SIM' && rot[1] === 'NÃO', 'rotulos SIM / NAO');
});

await test('encurtar e percentual', () => {
  ok(encurtar('abc') === 'abc', 'texto curto intacto');
  ok(encurtar('x'.repeat(500)).length === 240, 'trunca em 240');
  ok(encurtar('x'.repeat(500)).endsWith('\u2026'), 'termina com reticencias');
  ok(percentual(46.7) === 47, 'arredonda');
  ok(percentual(undefined) === 0, 'undefined -> 0');
  ok(percentual(-5) === 0 && percentual(300) === 100, 'clampa em 0..100');
});

// ============================================================================
// 2. SESSAO (manager puro, sem handler)
// ============================================================================

await test('iniciar cria a partida com a 1a pergunta e os 5 botoes', async () => {
  const mgr = makeManager();
  const r = await mgr.iniciar({ groupId: 'g@g.us', userId: 'u@lid' });
  ok(r.success, 'criou');
  ok(/E uma pessoa real\?/.test(r.message), 'mostra a pergunta do cliente');
  ok(r.buttons.length === 5, 'os 5 botoes');
  ok(mgr.activeCount === 1, '1 sessao ativa');
});

await test('cada jogador tem a SUA propria instancia de cliente', async () => {
  const criados = [];
  const mgr = makeManager(() => { const c = makeFakeClient(); criados.push(c); return c; });
  await mgr.iniciar({ groupId: 'g@g.us', userId: 'a@lid' });
  await mgr.iniciar({ groupId: 'g@g.us', userId: 'b@lid' });
  ok(criados.length === 2, '2 clientes criados (um por jogador)');
  ok(criados[0] !== criados[1], 'instancias diferentes');
});

await test('mesmo usuario nao abre duas partidas (spec 9)', async () => {
  const mgr = makeManager();
  await mgr.iniciar({ groupId: 'g@g.us', userId: 'u@lid' });
  const r2 = await mgr.iniciar({ groupId: 'g@g.us', userId: 'u@lid' });
  ok(r2.success === false && r2.reason === 'ja_em_partida', 'recusa a 2a partida');
  ok(mgr.activeCount === 1, 'continua com 1 sessao');
});

await test('mesmo usuario pode jogar em GRUPOS diferentes (spec 31)', async () => {
  const mgr = makeManager();
  const a = await mgr.iniciar({ groupId: 'A@g.us', userId: 'u@lid' });
  const b = await mgr.iniciar({ groupId: 'B@g.us', userId: 'u@lid' });
  ok(a.success && b.success, 'abriu nos dois grupos');
  ok(mgr.activeCount === 2, '2 sessoes (isoladas por grupo)');
});

await test('respostas usam o enum do pacote', async () => {
  const c = makeFakeClient();
  const mgr = makeManager(() => c);
  const ini = await mgr.iniciar({ groupId: 'g@g.us', userId: 'u@lid' });
  await mgr.processMessage({ groupId: 'g@g.us', userId: 'u@lid', text: btnId(ini.buttons[0]) });
  await mgr.processMessage({ groupId: 'g@g.us', userId: 'u@lid', text: btnId(ini.buttons[2]) });
  ok(c.chamadas.answer[0] === ENUMS.Answers.Yes, '1a resposta foi Yes');
  ok(c.chamadas.answer[1] === ENUMS.Answers.IDontKnow, '2a resposta foi IDontKnow');
});

await test('won -> palpite com nome/imagem/descricao; ACERTOU chama submitWin', async () => {
  const c = makeFakeClient();
  const mgr = makeManager(() => c);
  const ini = await mgr.iniciar({ groupId: 'g@g.us', userId: 'u@lid' });
  c.answer = async () => ({ won: true });
  const r = await mgr.processMessage({ groupId: 'g@g.us', userId: 'u@lid', text: btnId(ini.buttons[0]) });
  ok(r.kind === 'palpite', 'devolveu palpite');
  ok(/Naruto Uzumaki/.test(desbold(r.message)), 'mostra o nome');
  ok(r.imageUrl === 'https://x.invalid/n.png', 'imagem disponivel');
  ok(r.buttons.length === 2 && JSON.parse(r.buttons[0].buttonParamsJson).display_text === 'ACERTOU', 'botoes ACERTOU/ERROU');

  const r2 = await mgr.processMessage({ groupId: 'g@g.us', userId: 'u@lid', text: btnId(r.buttons[0]) });
  ok(r2.kind === 'acertou', 'confirmou');
  ok(c.chamadas.submitWin === 1, 'chamou submitWin');
  ok(mgr.activeCount === 0, 'sessao liberada');
});

await test('ko -> derrota e limpa a sessao', async () => {
  const c = makeFakeClient();
  const mgr = makeManager(() => c);
  const ini = await mgr.iniciar({ groupId: 'g@g.us', userId: 'u@lid' });
  c.answer = async () => ({ ko: true });
  const r = await mgr.processMessage({ groupId: 'g@g.us', userId: 'u@lid', text: btnId(ini.buttons[0]) });
  ok(r.kind === 'derrota', 'devolveu derrota');
  ok(/voc\u00ea venceu o akinator/i.test(desbold(r.message)), 'mensagem de vitoria do usuario');
  ok(mgr.activeCount === 0, 'sessao limpa');
});

await test('ERROU chama continue(); se falhar, encerra com seguranca (spec 15)', async () => {
  // continue() funcionando
  const c1 = makeFakeClient();
  const m1 = makeManager(() => c1);
  const i1 = await m1.iniciar({ groupId: 'g@g.us', userId: 'u@lid' });
  c1.answer = async () => ({ won: true });
  const p1 = await m1.processMessage({ groupId: 'g@g.us', userId: 'u@lid', text: btnId(i1.buttons[0]) });
  const r1 = await m1.processMessage({ groupId: 'g@g.us', userId: 'u@lid', text: btnId(p1.buttons[1]) });
  ok(r1.kind === 'pergunta', 'continue() ok -> volta a perguntar');
  ok(c1.chamadas.continue === 1, 'chamou continue');

  // continue() bloqueado (anti-bot)
  const c2 = makeFakeClient({ continue: async () => { throw new Error('Vital API blocked'); } });
  const m2 = makeManager(() => c2);
  const i2 = await m2.iniciar({ groupId: 'g@g.us', userId: 'u2@lid' });
  c2.answer = async () => ({ won: true });
  const p2 = await m2.processMessage({ groupId: 'g@g.us', userId: 'u2@lid', text: btnId(i2.buttons[0]) });
  const r2 = await m2.processMessage({ groupId: 'g@g.us', userId: 'u2@lid', text: btnId(p2.buttons[1]) });
  ok(r2.kind === 'continue_indisponivel', 'tratou o bloqueio');
  ok(m2.activeCount === 0, 'encerrou sem deixar sessao presa');
});

await test('cancelar encerra so a partida do usuario (spec 10)', async () => {
  const mgr = makeManager();
  await mgr.iniciar({ groupId: 'g@g.us', userId: 'a@lid' });
  await mgr.iniciar({ groupId: 'g@g.us', userId: 'b@lid' });
  const r = mgr.cancelar({ groupId: 'g@g.us', userId: 'a@lid' });
  ok(r.encerrada === true, 'encerrou a do A');
  ok(mgr.activeCount === 1, 'a do B continua');
  ok(Boolean(mgr.getSession('g@g.us', 'b@lid')), 'B segue ativo');
  const r2 = mgr.cancelar({ groupId: 'g@g.us', userId: 'a@lid' });
  ok(r2.encerrada === false, 'segundo cancelar avisa que nao havia partida');
});

await test('timeout: sessao expirada nao aceita resposta (spec 21)', async () => {
  const mgr = makeManager();
  const ini = await mgr.iniciar({ groupId: 'g@g.us', userId: 'u@lid' });
  const s = mgr.getSession('g@g.us', 'u@lid');
  s.lastActivity = Date.now() - (akinatorModule.CONFIG.SESSION_TIMEOUT_MS + 1000);
  const r = await mgr.processMessage({ groupId: 'g@g.us', userId: 'u@lid', text: btnId(ini.buttons[0]) });
  ok(r && r.reason === 'timeout', 'devolveu timeout');
  ok(/expirou/i.test(desbold(r.message)), 'avisou a expiracao');
  ok(mgr.activeCount === 0, 'sessao removida');
});

await test('clique duplo: so o primeiro avanca (spec 34/35)', async () => {
  let liberar;
  const gate = new Promise((res) => { liberar = res; });
  let respostas = 0;
  const c = makeFakeClient({ answer: async () => { respostas += 1; await gate; return { question: 'prox', progression: 30 }; } });
  const mgr = makeManager(() => c);
  const ini = await mgr.iniciar({ groupId: 'g@g.us', userId: 'u@lid' });
  const id = btnId(ini.buttons[0]);

  // Dispara 3 "cliques" quase ao mesmo tempo.
  const p1 = mgr.processMessage({ groupId: 'g@g.us', userId: 'u@lid', text: id });
  const p2 = mgr.processMessage({ groupId: 'g@g.us', userId: 'u@lid', text: id });
  const p3 = mgr.processMessage({ groupId: 'g@g.us', userId: 'u@lid', text: id });
  liberar();
  const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

  ok(respostas === 1, `o cliente recebeu 1 resposta (veio ${respostas})`);
  ok(r1.kind === 'pergunta', '1a processou');
  const bloqueadas = [r2, r3].filter((r) => r && r.reason === 'processing').length;
  ok(bloqueadas >= 1, `as outras foram bloqueadas por 'processing' (${bloqueadas})`);
  ok(mgr.activeCount === 1, 'sessao continua consistente');
});

await test('cleanup remove sessoes encerradas e expiradas (sem fantasma)', async () => {
  const mgr = makeManager();
  await mgr.iniciar({ groupId: 'g@g.us', userId: 'a@lid' });
  await mgr.iniciar({ groupId: 'g@g.us', userId: 'b@lid' });
  const sa = mgr.getSession('g@g.us', 'a@lid');
  sa.state = 'FINISHED';
  const sb = mgr.getSession('g@g.us', 'b@lid');
  sb.lastActivity = Date.now() - (akinatorModule.CONFIG.SESSION_TIMEOUT_MS + 1000);
  mgr._cleanup();
  ok(mgr.activeCount === 0, 'nada de sessao orfa');
  ok(sa.client === null, 'referencia do cliente liberada');
});

// ============================================================================
// 2b. TRANSPORTE (proxy/scraperapi) E DIAGNOSTICO DE BLOQUEIO
// ============================================================================

await test('transportFromEnv: vazio sem variaveis; proxy e scraperapi quando setadas', () => {
  ok(Object.keys(transportFromEnv({})).length === 0, 'sem env -> sem opcoes');
  ok(transportFromEnv({ AKINATOR_PROXY: 'http://u:p@h:8080' }).proxy === 'http://u:p@h:8080', 'proxy lido');
  const s = transportFromEnv({ AKINATOR_SCRAPERAPI_KEY: 'k', AKINATOR_SCRAPERAPI_SESSION: '55' });
  ok(s.scraperApiKey === 'k' && s.scraperApiSession === 55, 'scraperapi + session lidos');
  ok(transportFromEnv({ AKINATOR_PROXY: '   ' }).proxy === undefined, 'proxy em branco ignorado');
});

await test('classificarFalha separa EXTRACAO, BLOQUEIO e REDE', () => {
  // O servico RESPONDEU mas a lib nao leu -> nao e proxy, e formato novo.
  for (const m of [
    'Failed to extract session/signature from HTML response.',
    'Failed to extract something',
  ]) ok(classificarFalha(m) === 'extracao', `"${m}" -> extracao`);
  // Cloudflare barrando a conexao -> proxy/IP resolve.
  for (const m of [
    'Just a moment...', 'HTTP 403 Forbidden', 'Vital API blocked',
    'cloudflare challenge', 'HTTP error starting game: 403',
  ]) ok(classificarFalha(m) === 'bloqueio', `"${m}" -> bloqueio`);
  for (const m of ['connect ECONNREFUSED', 'ETIMEDOUT', 'socket hang up']) {
    ok(classificarFalha(m) === 'rede', `"${m}" -> rede`);
  }
});

await test('mudanca de formato do site NAO manda configurar proxy', async () => {
  const c = makeFakeClient({ start: async () => { throw new Error('Failed to extract session/signature from HTML response.'); } });
  const mgr = makeManager(() => c);
  const r = await mgr.iniciar({ groupId: 'g@g.us', userId: 'u@lid' });
  ok(r.success === false && r.reason === 'indisponivel', 'reason = indisponivel');
  const m = desbold(mgr.mensagemIndisponivel());
  ok(/mudou o formato/i.test(m), 'explica que o formato mudou');
  ok(!m.includes('AKINATOR_PROXY'), 'NAO manda configurar proxy (causa errada)');
  ok(!/stack|Error:/i.test(m), 'sem detalhe tecnico');
});

await test('o transporte chega ao construtor do cliente', async () => {
  let recebido = null;
  const mgr = new AkinatorManager({
    createClient: (o) => { recebido = o; return makeFakeClient(); },
    enums: ENUMS,
    transport: { proxy: 'http://p:8080' },
    botName: 'L',
  });
  await mgr.iniciar({ groupId: 'g@g.us', userId: 'u@lid' });
  ok(recebido && recebido.proxy === 'http://p:8080', 'proxy repassado ao cliente');
  ok(recebido.language === 'pt' && recebido.theme === ENUMS.Themes.Character, 'idioma pt + tema Character mantidos');
});

await test('bloqueio do Cloudflare vira mensagem ESPECIFICA (nao erro generico)', async () => {
  // Bloqueio REAL = Cloudflare barrando a conexao (403 / Just a moment).
  const c = makeFakeClient({ start: async () => { throw new Error('Just a moment...'); } });
  const mgr = makeManager(() => c);
  const r = await mgr.iniciar({ groupId: 'g@g.us', userId: 'u@lid' });
  ok(r.success === false && r.reason === 'bloqueio', 'reason = bloqueio');
  const m = desbold(mgr.mensagemBloqueio());
  ok(/bloqueando o ip/i.test(m), 'explica que o IP esta bloqueado');
  ok(m.includes('AKINATOR_PROXY'), 'aponta a configuracao que resolve');
  ok(!/stack|Error:|session=|signature=/i.test(m), 'sem detalhe tecnico');
});

await test('com proxy JA configurado, a mensagem nao manda configurar de novo', () => {
  const c = makeFakeClient();
  const mgr = new AkinatorManager({ createClient: () => c, enums: ENUMS, transport: { proxy: 'http://p:8080' }, botName: 'L' });
  ok(!desbold(mgr.mensagemBloqueio()).includes('AKINATOR_PROXY'), 'nao sugere o que ja esta configurado');
});

await test('erro de rede comum continua com a mensagem generica', async () => {
  const c = makeFakeClient({ start: async () => { throw new Error('connect ECONNREFUSED'); } });
  const mgr = makeManager(() => c);
  const r = await mgr.iniciar({ groupId: 'g@g.us', userId: 'u@lid' });
  ok(r.reason === 'erro_rede', 'reason = erro_rede (nao bloqueio)');
  ok(/não consegui conectar/i.test(desbold(mgr.mensagemErroRede())), 'mensagem generica de rede');
});

await test('!akinator no handler mostra o aviso de bloqueio quando o IP e recusado', async () => {
  injetarManager(() => makeFakeClient({ start: async () => { throw new Error('Just a moment...'); } }));
  const grupo = makeGroup();
  const p = nextPerson();
  const r = await enviar({ groupJid: grupo, pessoa: p, text: '!akinator' });
  ok(/bloqueando o ip/i.test(desbold(r.texto)), 'avisou o bloqueio (nao o erro generico)');
  ok(desbold(r.texto).includes('AKINATOR_PROXY'), 'mostrou como resolver');
});

await test('!akinator no handler mostra o aviso de FORMATO quando o site mudou', async () => {
  injetarManager(() => makeFakeClient({ start: async () => { throw new Error('Failed to extract session/signature from HTML response.'); } }));
  const grupo = makeGroup();
  const p = nextPerson();
  const r = await enviar({ groupJid: grupo, pessoa: p, text: '!akinator' });
  ok(/mudou o formato/i.test(desbold(r.texto)), 'avisou a mudanca de formato');
  ok(!desbold(r.texto).includes('AKINATOR_PROXY'), 'nao sugeriu proxy');
});

// ============================================================================
// 3. HANDLER REAL
// ============================================================================

/** O handler usa o manager global — injetamos o nosso no globalThis. */
function injetarManager(factory) {
  globalThis.__lizzyAkinatorManager = makeManager(factory);
  return globalThis.__lizzyAkinatorManager;
}

await test('!akinator no handler real: abertura + pergunta com 5 botoes', async () => {
  const mgr = injetarManager();
  const grupo = makeGroup();
  const p = nextPerson();
  const r = await enviar({ groupJid: grupo, pessoa: p, text: '!akinator' });
  ok(/AKINATOR/.test(desbold(r.texto)), 'mandou o painel');
  ok(/pense em uma pessoa ou personagem/i.test(desbold(r.texto)), 'a abertura pede para pensar');
  ok(r.botoes.length === 5, `enviou os 5 botoes (veio ${r.botoes.length})`);
  ok(r.botoes.every((x) => x.name === 'quick_reply' && x.id && x.text), 'os botoes sao quick_reply com id e texto');
  ok(mgr.activeCount === 1, 'criou a sessao');
});

await test('!akinator + botao avanca a pergunta pelo handler', async () => {
  const c = makeFakeClient();
  const mgr = injetarManager(() => c);
  const grupo = makeGroup();
  const p = nextPerson();
  const r0 = await enviar({ groupJid: grupo, pessoa: p, text: '!akinator' });
  const r = await enviar({ groupJid: grupo, pessoa: p, text: r0.botoes[0].id });
  ok(c.chamadas.answer.length === 1, 'enviou a resposta ao cliente');
  ok(c.chamadas.answer[0] === ENUMS.Answers.Yes, 'foi Yes');
  ok(/progresso/i.test(desbold(r.texto)), 'mostra o progresso');
});

await test('isolamento: usuario B nao responde pela partida de A (spec 7/32)', async () => {
  const c = makeFakeClient();
  const mgr = injetarManager(() => c);
  const grupo = makeGroup();
  const a = nextPerson();
  const b = nextPerson();
  const participantes = [
    { id: a.lid, phoneNumber: a.jid, admin: null },
    { id: b.lid, phoneNumber: b.jid, admin: null },
    { id: BOT_LID, phoneNumber: BOT_JID, admin: 'admin' },
  ];
  const rA = await enviar({ groupJid: grupo, pessoa: a, text: '!akinator', participants: participantes });
  const idDeA = rA.botoes[0].id;

  // B clica no botao da partida de A.
  const rB = await enviar({ groupJid: grupo, pessoa: b, text: idDeA, participants: participantes });
  ok(c.chamadas.answer.length === 0, 'o cliente de A NAO recebeu resposta de B');
  ok(rB.textos.length === 0, 'o handler nao processou nada para B (sem sessao dele)');
  ok(mgr.activeCount === 1, 'a sessao de A segue intacta');
});

await test('botao de OUTRA sessao do MESMO usuario e recusado', async () => {
  const mgr = makeManager();
  // Sessao de A no grupo 1 (id antigo) e outra no grupo 2 (id novo).
  await mgr.iniciar({ groupId: 'g1@g.us', userId: 'u@lid' });
  const idAntigo = mgr.getSession('g1@g.us', 'u@lid').sessionId;
  mgr.cancelar({ groupId: 'g1@g.us', userId: 'u@lid' });
  await mgr.iniciar({ groupId: 'g1@g.us', userId: 'u@lid' });
  const r = await mgr.processMessage({ groupId: 'g1@g.us', userId: 'u@lid', text: `${idAntigo}:ak_sim` });
  ok(r && r.reason === 'nao_e_sua', 'recusou o id da partida antiga');
});

await test('!akinator cancelar encerra a partida pelo handler', async () => {
  const mgr = injetarManager();
  const grupo = makeGroup();
  const p = nextPerson();
  await enviar({ groupJid: grupo, pessoa: p, text: '!akinator' });
  ok(mgr.activeCount === 1, 'partida ativa');
  const r = await enviar({ groupJid: grupo, pessoa: p, text: '!akinator cancelar' });
  ok(/encerrada/i.test(desbold(r.texto)), 'avisou o encerramento');
  ok(mgr.activeCount === 0, 'sessao removida');
});

await test('!akinator com partida ativa avisa (nao cria outra) (spec 9)', async () => {
  injetarManager();
  const grupo = makeGroup();
  const p = nextPerson();
  await enviar({ groupJid: grupo, pessoa: p, text: '!akinator' });
  const r = await enviar({ groupJid: grupo, pessoa: p, text: '!akinator' });
  ok(/j\u00e1 est\u00e1 em uma partida/i.test(desbold(r.texto)), 'avisou que ja tem partida');
});

await test('erro de rede no iniciar: avisa e nao derruba (spec 19)', async () => {
  injetarManager(() => makeFakeClient({ start: async () => { throw new Error('ECONNREFUSED'); } }));
  const grupo = makeGroup();
  const p = nextPerson();
  const r = await enviar({ groupJid: grupo, pessoa: p, text: '!akinator' });
  ok(/n\u00e3o consegui conectar/i.test(desbold(r.texto)), 'mensagem amigavel de erro');
  ok(!/stack|Error:|ECONNREFUSED/i.test(r.texto), 'nao vaza detalhe tecnico');
  ok(globalThis.__lizzyAkinatorManager.activeCount === 0, 'nao deixou sessao presa');
});

await test('erro de rede ao responder: avisa e mantem o bot vivo (spec 19)', async () => {
  const c = makeFakeClient({ answer: async () => { throw new Error('timeout'); } });
  const mgr = injetarManager(() => c);
  const grupo = makeGroup();
  const p = nextPerson();
  const r0 = await enviar({ groupJid: grupo, pessoa: p, text: '!akinator' });
  const r = await enviar({ groupJid: grupo, pessoa: p, text: r0.botoes[0].id });
  ok(/n\u00e3o consegui conectar/i.test(desbold(r.texto)), 'avisou o erro de rede');
  ok(!/stack|ECONNREFUSED|Error:/i.test(r.texto), 'sem detalhe tecnico');
});

await test('resultado sem imagem continua funcionando (spec 17)', async () => {
  const c = makeFakeClient();
  const mgr = injetarManager(() => c);
  const grupo = makeGroup();
  const p = nextPerson();
  const r0 = await enviar({ groupJid: grupo, pessoa: p, text: '!akinator' });
  const id = r0.botoes[0].id;
  c.winResult = { name: 'Sem Foto', pictureUrl: '', description: '' };
  c.answer = async () => ({ won: true });
  const r = await enviar({ groupJid: grupo, pessoa: p, text: id });
  ok(/Sem Foto/.test(desbold(r.texto)), 'mostrou o nome');
  ok(r.textos.length >= 1, 'mandou o resultado em texto (sem imagem)');
});

await test('descricao gigante e truncada (spec 18)', async () => {
  const c = makeFakeClient();
  const mgr = injetarManager(() => c);
  const grupo = makeGroup();
  const p = nextPerson();
  const r0 = await enviar({ groupJid: grupo, pessoa: p, text: '!akinator' });
  const id = r0.botoes[0].id;
  c.winResult = { name: 'X', pictureUrl: '', description: 'z'.repeat(5000) };
  c.answer = async () => ({ won: true });
  const r = await enviar({ groupJid: grupo, pessoa: p, text: id });
  ok(r.texto.length < 1200, `mensagem nao ficou gigante (${r.texto.length} chars)`);
});

await test('duas partidas simultaneas no MESMO grupo (spec 8)', async () => {
  const mgr = injetarManager();
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
  ok(mgr.activeCount === 2, 'duas partidas ativas no mesmo grupo');

  // O handler identifica o remetente e converte PN->LID (getLidFromJidCached),
  // entao a chave da sessao e o LID real de cada um.
  const sa = mgr.getSession(grupo, a.lid);
  const sb = mgr.getSession(grupo, b.lid);
  ok(sa.sessionId !== sb.sessionId, 'ids diferentes');
  ok(sa.client !== sb.client, 'clientes independentes');
});

// ============================================================================
// 4. MENU (spec 3: NAO pode estar em menu)
// ============================================================================

await test('!akinator NAO foi adicionado a nenhum menu (spec 3)', () => {
  const menu18 = fs.readFileSync(path.join(ROOT, 'dados/src/menus/menu18.js'), 'utf-8');
  const menuJs = fs.readFileSync(path.join(ROOT, 'dados/src/menus/menu.js'), 'utf-8');
  ok(!menu18.includes('akinator'), 'menu18 sem akinator');
  ok(!menuJs.includes('akinator'), 'menu principal sem akinator');
  const bp = fs.readFileSync(path.join(ROOT, 'dados/src/utils/blockPv.js'), 'utf-8');
  ok(!bp.includes('akinator'), 'blockPv sem akinator');
});

await test('ainda existe um unico manager (nao cria sistema paralelo)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'dados/src/index.js'), 'utf-8');
  const occur = (src.match(/__lizzyAkinatorManager = new /g) || []).length;
  ok(occur === 1, `uma unica criacao do manager (veio ${occur})`);
  ok(!src.includes('akinatorManager.ev.on'), 'nao registra listener por partida');
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
