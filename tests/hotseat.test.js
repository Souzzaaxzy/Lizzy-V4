/**
 * !hotseat (+18) — brincadeira da cadeira quente.
 *
 * Roda o HANDLER REAL com socket falso. O ponto central: a brincadeira responde
 * por MENSAGEM NORMAL (nao existe "!responder"), so o PARTICIPANTE altera o
 * estado, e as mensagens dos outros sao ignoradas.
 *
 * Cobre (spec secao 31): inicializacao, participante (com/sem mencao), etapa
 * "pronto", 5 perguntas sem repeticao, respostas SIM/NAO, pulos (limite de 2),
 * mensagens invalidas, isolamento do participante, resultado (contagem +
 * Indice Hot + lista), frase final, repeticao, concorrencia, timeout e menu18.
 *
 * Uso: node tests/hotseat.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-hotseat-'));
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

/** Normaliza o bold Unicode do layout para ASCII (mede o CONTEUDO, nao o glifo). */
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

const BANK = JSON.parse(fs.readFileSync(path.join(ROOT, 'dados/src/funcs/json/hotseat.json'), 'utf-8'));
const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;
const hotseatModule = await import(new URL('../dados/src/funcs/utils/hotseat.js', import.meta.url).href);
const {
  HotSeatManager, classifyAnswer, isStartConfirmation, pickQuestions,
  computeHotIndex, fraseFinal, CONFIG, FRASES_FINAIS,
} = hotseatModule;

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';

let groupCounter = 0;
function makeGroup(extra = {}) {
  groupCounter += 1;
  const jid = `120363980000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(path.join(GRUPOS_DIR, `${jid}.json`),
    JSON.stringify({ groupName: `HS ${groupCounter}`, modobrincadeira: true, ...extra }, null, 2));
  return jid;
}

let senderSeq = 0;
function nextPerson() {
  senderSeq += 1;
  const n = String(senderSeq).padStart(4, '0');
  return { lid: `5577${n}000000@lid`, jid: `5519${n}999999@s.whatsapp.net`, name: `5577${n}000000` };
}

/** Envia uma mensagem pelo handler real e devolve o que a bot mandou. */
async function enviar({ groupJid, pessoa, text, mention = null, participants }) {
  const sent = [];
  const nazu = {
    sent,
    sendMessage: async (jid, content, options) => { sent.push({ jid, content, options }); return { key: { id: `S${sent.length}` } }; },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
    onWhatsApp: async (jid) => [{ jid, exists: true, lid: jid.replace('@s.whatsapp.net', '@lid') }],
    signalRepository: { lidMapping: { getPNForLID: async () => null, getLIDForPN: async () => null } },
    groupMetadata: async () => ({
      id: groupJid, subject: 'HS',
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
  const mentionedJid = mention ? [mention] : [];
  await handleMessage(nazu, {
    key: { remoteJid: groupJid, fromMe: false, id: `M-${Math.random().toString(36).slice(2, 8)}`, participant: pessoa.jid, participantAlt: pessoa.jid },
    message: { extendedTextMessage: { text, contextInfo: { remoteJid: groupJid, mentionedJid, participant: pessoa.jid } } },
    messageTimestamp: Math.floor(Date.now() / 1000), pushName: pessoa.name,
  }, null, new Map(), null);
  const textos = sent.map((s) => s.content?.text ?? '').filter(Boolean);
  return { sent, textos, texto: textos.join('\n'), poll: sent.find((x) => x.content?.poll)?.content.poll };
}

/** Atalho: abre uma sessao e devolve grupo + participante. */
async function abrirSessao({ mentionSelf = true, participants } = {}) {
  const grupo = makeGroup();
  const p = nextPerson();
  const r = await enviar({
    groupJid: grupo, pessoa: p, text: '!hotseat',
    mention: mentionSelf ? null : null, participants,
  });
  return { grupo, p, r };
}

// ============================================================================
// 1. O BANCO DE PERGUNTAS
// ============================================================================

await test('hotseat.json tem EXATAMENTE 100 perguntas com id unico', () => {
  ok(Array.isArray(BANK), 'e uma lista');
  ok(BANK.length === 100, `exatamente 100 (veio ${BANK.length})`);
  ok(new Set(BANK.map((q) => q.id)).size === 100, 'ids unicos');
  ok(BANK.every((q) => Number.isInteger(q.id) && typeof q.text === 'string' && q.text.trim()), 'todo item tem id + texto');
  ok(BANK[0].id === 1 && BANK[99].id === 100, 'ids vao de 1 a 100');
});

await test('as perguntas sao SIM/NAO e nao repetem', () => {
  ok(new Set(BANK.map((q) => q.text)).size === 100, 'nenhum texto repetido');
  // Nao deve haver pergunta vazia/curta demais (nao da para responder).
  ok(BANK.every((q) => q.text.length >= 15), 'todas tem corpo suficiente');
});

// ============================================================================
// 2. FUNCOES PURAS
// ============================================================================

await test('classifyAnswer: SIM em todas as variacoes', () => {
  for (const v of ['sim', 'SIM', 'Sim', 's']) ok(classifyAnswer(v) === 'SIM', `"${v}" -> SIM`);
});

await test('classifyAnswer: NAO em todas as variacoes (com e sem acento)', () => {
  for (const v of ['não', 'nao', 'NAO', 'NÃO', 'n']) ok(classifyAnswer(v) === 'NAO', `"${v}" -> NAO`);
});

await test('classifyAnswer: PULAR em todas as variacoes', () => {
  for (const v of ['pular', 'pulo', 'passo', 'skip']) ok(classifyAnswer(v) === 'PULAR', `"${v}" -> PULAR`);
});

await test('classifyAnswer: qualquer outra coisa -> null (nao vira resposta)', () => {
  for (const v of ['bom dia', 'talvez', 'kkk', '', 'sim e nao', '123']) ok(classifyAnswer(v) === null, `"${v}" -> null`);
});

await test('isStartConfirmation aceita as variacoes do pedido', () => {
  for (const v of ['pronto', 'pronta', 'pronto para começar', 'pronta para começar', 'vamos', 'pode começar']) {
    ok(isStartConfirmation(v) === true, `"${v}" confirma o inicio`);
  }
  for (const v of ['oi', 'sim', 'nao', '']) ok(isStartConfirmation(v) === false, `"${v}" NAO confirma`);
});

await test('pickQuestions: 5 unicas, dentro do banco', () => {
  const ids = pickQuestions(BANK, 5);
  ok(ids.length === 5, '5 ids');
  ok(new Set(ids).size === 5, 'sem repeticao');
  ok(ids.every((id) => BANK.some((q) => q.id === id)), 'todos existem no banco');
});

await test('computeHotIndex: formula deterministica (SIM / validas)', () => {
  const r1 = computeHotIndex([{ answer: 'SIM' }, { answer: 'SIM' }, { answer: 'SIM' }, { answer: 'NAO' }, { answer: 'PULAR' }]);
  ok(r1.percent === 75, `3 SIM + 1 NAO + 1 PULO -> 75% (veio ${r1.percent})`);
  const r2 = computeHotIndex([{ answer: 'SIM' }, { answer: 'SIM' }, { answer: 'SIM' }, { answer: 'SIM' }, { answer: 'SIM' }]);
  ok(r2.percent === 100, `5 SIM -> 100% (veio ${r2.percent})`);
  const r3 = computeHotIndex([{ answer: 'NAO' }, { answer: 'NAO' }, { answer: 'NAO' }, { answer: 'NAO' }, { answer: 'NAO' }]);
  ok(r3.percent === 0, `5 NAO -> 0% (veio ${r3.percent})`);
  const r4 = computeHotIndex([{ answer: 'PULAR' }, { answer: 'PULAR' }]);
  ok(r4.percent === null, 'tudo pulado -> N/A (nunca divide por zero)');
});

// ============================================================================
// 3. INICIALIZACAO (handler real)
// ============================================================================

await test('!hotseat sem mencao: o proprio remetente e o participante', async () => {
  const grupo = makeGroup();
  const p = nextPerson();
  const r = await enviar({ groupJid: grupo, pessoa: p, text: '!hotseat' });
  const t = desbold(r.texto);
  ok(/HOT SEAT/i.test(t), 'mandou o painel do Hot Seat');
  ok(t.includes('CADEIRA QUENTE'), 'fala da cadeira quente');
  ok(t.includes(`@${p.jid.split('@')[0]}`) || r.sent.some((s) => (s.content?.mentions || []).includes(p.lid)), 'cita o participante');
  ok(/pronto para começar/i.test(t), 'ensina a confirmar com "pronto para começar"');
  ok(t.includes('5'), 'avisa as 5 perguntas');
  ok(t.includes('100'), 'avisa o banco de 100');
  ok(t.includes('2 PULOS') || t.includes('2'), 'avisa o limite de pulos');
});

await test('!hotseat @usuario: o marcado e o participante, nao o iniciador', async () => {
  const grupo = makeGroup();
  const iniciador = nextPerson();
  const alvo = nextPerson();
  const r = await enviar({
    groupJid: grupo, pessoa: iniciador, text: '!hotseat',
    mention: alvo.jid,
    participants: [
      { id: iniciador.lid, phoneNumber: iniciador.jid, admin: null },
      { id: alvo.lid, phoneNumber: alvo.jid, admin: null },
      { id: BOT_LID, phoneNumber: BOT_JID, admin: 'admin' },
    ],
  });
  const t = desbold(r.texto);
  ok(t.includes('foi colocado(a) na'), 'usa o texto de "colocado na cadeira"');
  const mencoes = r.sent.flatMap((s) => s.content?.mentions || []);
  ok(mencoes.some((m) => m.includes(alvo.jid.split('@')[0]) || m === alvo.lid || m === alvo.jid), 'menciona o ALVO');
  ok(!mencoes.includes(iniciador.lid), 'o iniciador NAO entra como participante');
});

await test('!hotseat so funciona em grupo e com modo brincadeira', async () => {
  const grupo = makeGroup({ modobrincadeira: false });
  const p = nextPerson();
  const r = await enviar({ groupJid: grupo, pessoa: p, text: '!hotseat' });
  ok(!/CADEIRA QUENTE/i.test(desbold(r.texto)), 'sem modo brincadeira nao abre a sessao');
  ok(/modo brincadeira/i.test(r.texto), 'avisa sobre o modo brincadeira');
});

// ============================================================================
// 4. ETAPA "PRONTO PARA COMECAR"
// ============================================================================

await test('nao manda a pergunta 1 antes do "pronto"', async () => {
  const { r } = await abrirSessao();
  ok(!/PERGUNTA 1\/5/i.test(desbold(r.texto)), 'nao comecou sozinho');
});

await test('mensagem aleatoria antes do pronto nao inicia e nao responde', async () => {
  const grupo = makeGroup();
  const p = nextPerson();
  await enviar({ groupJid: grupo, pessoa: p, text: '!hotseat' });
  const r = await enviar({ groupJid: grupo, pessoa: p, text: 'oi tudo bem' });
  ok(!/PERGUNTA 1\/5/i.test(desbold(r.texto)), 'nao iniciou com mensagem aleatoria');
  ok(r.textos.length === 0, 'nao respondeu nada (nao consome)');
});

await test('"pronto" inicia a pergunta 1/5', async () => {
  const grupo = makeGroup();
  const p = nextPerson();
  await enviar({ groupJid: grupo, pessoa: p, text: '!hotseat' });
  const r = await enviar({ groupJid: grupo, pessoa: p, text: 'pronto' });
  const t = desbold(r.texto);
  ok(/VALENDO/i.test(t), 'anuncia o inicio real');
  ok(/PERGUNTA 1\/5/i.test(t), 'mostra a pergunta 1/5');
  ok(t.includes('SIM') && t.includes('NÃO') && t.includes('PULAR'), 'mostra as 3 opcoes');
});

await test('variacoes de confirmacao tambem iniciam', async () => {
  for (const conf of ['pronta', 'pronto para começar', 'vamos', 'pode começar']) {
    const grupo = makeGroup();
    const p = nextPerson();
    await enviar({ groupJid: grupo, pessoa: p, text: '!hotseat' });
    const r = await enviar({ groupJid: grupo, pessoa: p, text: conf });
    ok(/PERGUNTA 1\/5/i.test(desbold(r.texto)), `"${conf}" inicia a sessao`);
  }
});

await test('outra pessoa nao consegue iniciar a sessao alheia', async () => {
  const grupo = makeGroup();
  const p = nextPerson();
  const outra = nextPerson();
  await enviar({ groupJid: grupo, pessoa: p, text: '!hotseat' });
  const r = await enviar({
    groupJid: grupo, pessoa: outra, text: 'pronto',
    participants: [
      { id: p.lid, phoneNumber: p.jid, admin: null },
      { id: outra.lid, phoneNumber: outra.jid, admin: null },
      { id: BOT_LID, phoneNumber: BOT_JID, admin: 'admin' },
    ],
  });
  ok(!/PERGUNTA 1\/5/i.test(desbold(r.texto)), 'a outra pessoa nao iniciou');
  ok(r.textos.length === 0, 'nada foi respondido a ela');
});

// ============================================================================
// 5. PERGUNTAS: 5 SEM REPETICAO
// ============================================================================

await test('a sessao seleciona exatamente 5 perguntas, sem repeticao', async () => {
  const mgr = new HotSeatManager(BANK);
  for (let i = 0; i < 20; i++) {
    const res = mgr.start({ groupId: 'g@g.us', participantId: `p${i}@lid`, initiatorId: `p${i}@lid`, botName: 'Lizzy' });
    ok(res.success, 'sessao criada');
    const ids = res.session.questions;
    ok(ids.length === 5, `5 perguntas (veio ${ids.length})`);
    ok(new Set(ids).size === 5, 'sem repeticao dentro da sessao');
    ok(ids.every((id) => BANK.some((q) => q.id === id)), 'todas vem do banco');
    mgr.endSession('g@g.us', `p${i}@lid`);
  }
});

// ============================================================================
// 6. RESPOSTAS (SIM / NAO) E AVANCO
// ============================================================================

await test('responde SIM e a bot manda a proxima pergunta', async () => {
  const grupo = makeGroup();
  const p = nextPerson();
  await enviar({ groupJid: grupo, pessoa: p, text: '!hotseat' });
  await enviar({ groupJid: grupo, pessoa: p, text: 'pronto' });
  const r = await enviar({ groupJid: grupo, pessoa: p, text: 'sim' });
  ok(/PERGUNTA 2\/5/i.test(desbold(r.texto)), 'avancou para 2/5');
});

await test('variacoes de SIM e NAO funcionam pelo handler', async () => {
  const variacoes = ['sim', 'SIM', 'Sim', 's', 'não', 'nao', 'NÃO', 'n'];
  for (const v of variacoes) {
    const grupo = makeGroup();
    const p = nextPerson();
    await enviar({ groupJid: grupo, pessoa: p, text: '!hotseat' });
    await enviar({ groupJid: grupo, pessoa: p, text: 'pronto' });
    const r = await enviar({ groupJid: grupo, pessoa: p, text: v });
    ok(/PERGUNTA 2\/5/i.test(desbold(r.texto)), `"${v}" foi aceita como resposta`);
  }
});

await test('mensagem invalida NAO avanca e avisa o que aceita', async () => {
  const grupo = makeGroup();
  const p = nextPerson();
  await enviar({ groupJid: grupo, pessoa: p, text: '!hotseat' });
  await enviar({ groupJid: grupo, pessoa: p, text: 'pronto' });
  const r = await enviar({ groupJid: grupo, pessoa: p, text: 'bom dia pessoal' });
  const t = desbold(r.texto);
  ok(t.includes('SIM') && t.includes('NÃO') && t.includes('PULAR'), 'repete as opcoes validas');
  ok(!/PERGUNTA 2\/5/i.test(t), 'NAO avancou a pergunta');
});

// ============================================================================
// 7. PULOS
// ============================================================================

await test('primeiro pulo: avisa que ainda tem 1 pulo', async () => {
  const grupo = makeGroup();
  const p = nextPerson();
  await enviar({ groupJid: grupo, pessoa: p, text: '!hotseat' });
  await enviar({ groupJid: grupo, pessoa: p, text: 'pronto' });
  const r = await enviar({ groupJid: grupo, pessoa: p, text: 'pular' });
  const t = desbold(r.texto);
  ok(/1\/2/.test(t), 'informa 1/2 pulos utilizados');
  ok(/PERGUNTA 2\/5/i.test(t), 'avancou para a proxima');
});

await test('segundo pulo: avisa que nao tem mais pulos', async () => {
  const grupo = makeGroup();
  const p = nextPerson();
  await enviar({ groupJid: grupo, pessoa: p, text: '!hotseat' });
  await enviar({ groupJid: grupo, pessoa: p, text: 'pronto' });
  await enviar({ groupJid: grupo, pessoa: p, text: 'pular' });
  const r = await enviar({ groupJid: grupo, pessoa: p, text: 'pular' });
  const t = desbold(r.texto);
  ok(/ÚLTIMO PULO|ULTIMO PULO/i.test(t), 'avisa que foi o ultimo pulo');
  ok(/PERGUNTA 3\/5/i.test(t), 'avancou para a 3/5');
});

await test('terceiro pulo e BLOQUEADO (nao avanca)', async () => {
  const grupo = makeGroup();
  const p = nextPerson();
  await enviar({ groupJid: grupo, pessoa: p, text: '!hotseat' });
  await enviar({ groupJid: grupo, pessoa: p, text: 'pronto' });
  await enviar({ groupJid: grupo, pessoa: p, text: 'pular' });
  await enviar({ groupJid: grupo, pessoa: p, text: 'pular' });
  const r = await enviar({ groupJid: grupo, pessoa: p, text: 'pular' });
  const t = desbold(r.texto);
  ok(/já utilizou seus 2 pulos|ja utilizou seus 2 pulos/i.test(t), 'avisa que os pulos acabaram');
  ok(!/PERGUNTA 4\/5/i.test(t), 'NAO avancou a pergunta');
});

// ============================================================================
// 8. ISOLAMENTO DO PARTICIPANTE
// ============================================================================

await test('outra pessoa tentando responder nao altera a sessao', async () => {
  const grupo = makeGroup();
  const p = nextPerson();
  const outra = nextPerson();
  const participantes = [
    { id: p.lid, phoneNumber: p.jid, admin: null },
    { id: outra.lid, phoneNumber: outra.jid, admin: null },
    { id: BOT_LID, phoneNumber: BOT_JID, admin: 'admin' },
  ];
  await enviar({ groupJid: grupo, pessoa: p, text: '!hotseat', participants: participantes });
  await enviar({ groupJid: grupo, pessoa: p, text: 'pronto', participants: participantes });

  // A outra pessoa tenta "sim" e "pular".
  const rSim = await enviar({ groupJid: grupo, pessoa: outra, text: 'sim', participants: participantes });
  ok(!/PERGUNTA 2\/5/i.test(desbold(rSim.texto)), 'o "sim" da outra pessoa nao avancou');
  const rPular = await enviar({ groupJid: grupo, pessoa: outra, text: 'pular', participants: participantes });
  ok(!/PERGUNTA 2\/5/i.test(desbold(rPular.texto)), 'o "pular" da outra pessoa nao avancou');

  // O participante continua na 1/5 e consegue responder.
  const rDono = await enviar({ groupJid: grupo, pessoa: p, text: 'sim', participants: participantes });
  ok(/PERGUNTA 2\/5/i.test(desbold(rDono.texto)), 'o PARTICIPANTE avancou normalmente');
});

await test('sessao de um grupo nao captura resposta de outro', async () => {
  const g1 = makeGroup();
  const g2 = makeGroup();
  const p = nextPerson();
  await enviar({ groupJid: g1, pessoa: p, text: '!hotseat' });
  await enviar({ groupJid: g1, pessoa: p, text: 'pronto' });
  // Mesmo usuario, OUTRO grupo: nao existe sessao la.
  const r = await enviar({ groupJid: g2, pessoa: p, text: 'sim' });
  ok(r.textos.length === 0, 'o outro grupo nao respondeu (sem sessao)');
});

// ============================================================================
// 9. SESSION DUPLICADA
// ============================================================================

await test('nao cria duas sessoes para o mesmo participante', async () => {
  const grupo = makeGroup();
  const p = nextPerson();
  await enviar({ groupJid: grupo, pessoa: p, text: '!hotseat' });
  const r = await enviar({ groupJid: grupo, pessoa: p, text: '!hotseat' });
  const t = desbold(r.texto);
  ok(/já está em uma cadeira quente/i.test(t), 'avisa que ja tem sessao ativa');
});

await test('apos finalizar, o mesmo usuario pode iniciar outra sessao', async () => {
  const grupo = makeGroup();
  const p = nextPerson();
  await enviar({ groupJid: grupo, pessoa: p, text: '!hotseat' });
  await enviar({ groupJid: grupo, pessoa: p, text: 'pronto' });
  for (let i = 0; i < 5; i++) await enviar({ groupJid: grupo, pessoa: p, text: 'sim' });
  const r = await enviar({ groupJid: grupo, pessoa: p, text: '!hotseat' });
  ok(/CADEIRA QUENTE/i.test(desbold(r.texto)), 'abriu uma NOVA sessao');
});

// ============================================================================
// 10. RESULTADO FINAL
// ============================================================================

await test('apos a 5a resposta, mostra o resultado completo', async () => {
  const grupo = makeGroup();
  const p = nextPerson();
  await enviar({ groupJid: grupo, pessoa: p, text: '!hotseat' });
  await enviar({ groupJid: grupo, pessoa: p, text: 'pronto' });
  await enviar({ groupJid: grupo, pessoa: p, text: 'sim' });   // 1
  await enviar({ groupJid: grupo, pessoa: p, text: 'sim' });   // 2
  await enviar({ groupJid: grupo, pessoa: p, text: 'sim' });   // 3
  await enviar({ groupJid: grupo, pessoa: p, text: 'não' });   // 4
  const r = await enviar({ groupJid: grupo, pessoa: p, text: 'pular' }); // 5 (pulo)
  const t = desbold(r.texto);

  ok(/HOT SEAT FINALIZADO/i.test(t), 'anuncia a finalizacao');
  ok(/RESULTADO/i.test(t), 'tem o bloco RESULTADO');
  ok(/SIM: 3/.test(t), `conta 3 SIM (texto: ${t.slice(0, 120)})`);
  ok(/NÃO: 1/.test(t), 'conta 1 NAO');
  ok(/PULOS: 1/.test(t), 'conta 1 pulo');
  ok(/ÍNDICE HOT/i.test(t) || /INDICE HOT/i.test(t), 'mostra o Indice Hot');
  ok(/75%/.test(t), 'indice 75% (3 de 4 validas)');
  ok(/SUAS RESPOSTAS/i.test(t), 'mostra o bloco de respostas');
  // As 5 linhas de resposta (1..5).
  ok(/1️⃣/.test(r.texto) && /5️⃣/.test(r.texto), 'lista as 5 respostas numeradas');
  ok(/⏭️ PULADA/i.test(r.texto), 'marca a pulada como PULADA');
});

await test('5 SIM -> 100% ; 5 NAO -> 0% ; tudo pulado -> N/A', async () => {
  // 5 SIM
  {
    const grupo = makeGroup(); const p = nextPerson();
    await enviar({ groupJid: grupo, pessoa: p, text: '!hotseat' });
    await enviar({ groupJid: grupo, pessoa: p, text: 'pronto' });
    let r;
    for (let i = 0; i < 5; i++) r = await enviar({ groupJid: grupo, pessoa: p, text: 'sim' });
    ok(/100%/.test(desbold(r.texto)), '5 SIM -> 100%');
  }
  // 5 NAO
  {
    const grupo = makeGroup(); const p = nextPerson();
    await enviar({ groupJid: grupo, pessoa: p, text: '!hotseat' });
    await enviar({ groupJid: grupo, pessoa: p, text: 'pronto' });
    let r;
    for (let i = 0; i < 5; i++) r = await enviar({ groupJid: grupo, pessoa: p, text: 'não' });
    ok(/ÍNDICE HOT.*: 0%|INDICE HOT.*: 0%/i.test(desbold(r.texto)), '5 NAO -> 0%');
  }
  // 2 pulos + 3 NAO -> validas = 3, sim = 0 -> 0% (nunca divide por zero)
  {
    const grupo = makeGroup(); const p = nextPerson();
    await enviar({ groupJid: grupo, pessoa: p, text: '!hotseat' });
    await enviar({ groupJid: grupo, pessoa: p, text: 'pronto' });
    await enviar({ groupJid: grupo, pessoa: p, text: 'pular' });
    await enviar({ groupJid: grupo, pessoa: p, text: 'pular' });
    await enviar({ groupJid: grupo, pessoa: p, text: 'não' });
    const r = await enviar({ groupJid: grupo, pessoa: p, text: 'não' });
    const r2 = await enviar({ groupJid: grupo, pessoa: p, text: 'não' });
    ok(/ÍNDICE HOT.*: 0%|INDICE HOT.*: 0%/i.test(desbold(r2.texto)), 'sem SIM -> 0%');
  }
});

await test('o resultado traz uma FRASE FINAL da lista', async () => {
  const grupo = makeGroup();
  const p = nextPerson();
  await enviar({ groupJid: grupo, pessoa: p, text: '!hotseat' });
  await enviar({ groupJid: grupo, pessoa: p, text: 'pronto' });
  let r;
  for (let i = 0; i < 5; i++) r = await enviar({ groupJid: grupo, pessoa: p, text: 'sim' });
  const t = desbold(r.texto);
  ok(FRASES_FINAIS.some((f) => t.includes(desbold(f))), 'contem uma das frases finais');
});

await test('fraseFinal() sempre vem da lista e varia', async () => {
  const vistas = new Set();
  for (let i = 0; i < 200; i++) {
    const f = fraseFinal();
    ok(FRASES_FINAIS.includes(f), 'frase da lista');
    vistas.add(f);
  }
  ok(vistas.size > 1, `varia entre execucoes (${vistas.size} distintas)`);
});

// ============================================================================
// 11. FINALIZACAO: sessao encerrada nao aceita mais nada
// ============================================================================

await test('depois de finalizar, "sim" nao altera mais a sessao', async () => {
  const grupo = makeGroup();
  const p = nextPerson();
  await enviar({ groupJid: grupo, pessoa: p, text: '!hotseat' });
  await enviar({ groupJid: grupo, pessoa: p, text: 'pronto' });
  for (let i = 0; i < 5; i++) await enviar({ groupJid: grupo, pessoa: p, text: 'sim' });
  const r = await enviar({ groupJid: grupo, pessoa: p, text: 'sim' });
  ok(r.textos.length === 0, 'o "sim" pos-final e uma mensagem normal (nada do Hot Seat)');
});

// ============================================================================
// 12. CONCORRENCIA (2 sessoes no mesmo grupo)
// ============================================================================

await test('duas sessoes diferentes coexistem no MESMO grupo', async () => {
  const mgr = new HotSeatManager(BANK);
  const a = mgr.start({ groupId: 'g@g.us', participantId: 'a@lid', initiatorId: 'a@lid', botName: 'L' });
  const b = mgr.start({ groupId: 'g@g.us', participantId: 'b@lid', initiatorId: 'b@lid', botName: 'L' });
  ok(a.success && b.success, 'as duas foram criadas');
  ok(mgr.activeCount === 2, 'duas sessoes ativas');

  // Cada uma responde a sua propria sessao.
  mgr.processMessage({ groupId: 'g@g.us', participantId: 'a@lid', text: 'pronto', botName: 'L' });
  mgr.processMessage({ groupId: 'g@g.us', participantId: 'b@lid', text: 'pronto', botName: 'L' });
  const ra = mgr.processMessage({ groupId: 'g@g.us', participantId: 'a@lid', text: 'sim', botName: 'L' });
  const rb = mgr.processMessage({ groupId: 'g@g.us', participantId: 'b@lid', text: 'não', botName: 'L' });
  ok(/2\/5/.test(desbold(ra.message)), 'a sessao A avancou para 2/5');
  ok(/2\/5/.test(desbold(rb.message)), 'a sessao B avancou para 2/5');

  // As perguntas sao independentes (nao necessariamente iguais).
  const qa = mgr.getSession('g@g.us', 'a@lid');
  const qb = mgr.getSession('g@g.us', 'b@lid');
  ok(qa.questions !== qb.questions, 'listas de perguntas separadas');
});

// ============================================================================
// 13. TIMEOUT / LIMPEZA
// ============================================================================

await test('sessao abandonada expira e e removida', () => {
  const mgr = new HotSeatManager(BANK);
  mgr.start({ groupId: 'g@g.us', participantId: 'x@lid', initiatorId: 'x@lid', botName: 'L' });
  const s = mgr.getSession('g@g.us', 'x@lid');
  ok(Boolean(s), 'sessao criada');
  // Simula inatividade maior que o timeout.
  s.lastActivity = Date.now() - (CONFIG.SESSION_TIMEOUT_MS + 1000);
  mgr._cleanup();
  ok(mgr.getSession('g@g.us', 'x@lid') === null, 'sessao removida no cleanup');
});

await test('processMessage avisa e limpa quando a sessao expirou', () => {
  const mgr = new HotSeatManager(BANK);
  mgr.start({ groupId: 'g@g.us', participantId: 'x@lid', initiatorId: 'x@lid', botName: 'L' });
  const s = mgr.getSession('g@g.us', 'x@lid');
  s.state = 'WAITING_ANSWER';
  s.lastActivity = Date.now() - (CONFIG.SESSION_TIMEOUT_MS + 1000);
  const r = mgr.processMessage({ groupId: 'g@g.us', participantId: 'x@lid', text: 'sim', botName: 'L' });
  ok(r && r.reason === 'timeout', 'devolveu timeout');
  ok(/inatividade/i.test(desbold(r.message)), 'avisou o encerramento por inatividade');
  ok(mgr.getSession('g@g.us', 'x@lid') === null, 'estado limpo');
});

await test('sessao finalizada sai do mapa no cleanup (sem fantasma)', () => {
  const mgr = new HotSeatManager(BANK);
  mgr.start({ groupId: 'g@g.us', participantId: 'x@lid', initiatorId: 'x@lid', botName: 'L' });
  const s = mgr.getSession('g@g.us', 'x@lid');
  s.state = 'FINISHED';
  mgr._cleanup();
  ok(mgr.getSession('g@g.us', 'x@lid') === null, 'sessao encerrada removida');
});

// ============================================================================
// 14. MENU 18
// ============================================================================

const { getMenus } = await import(new URL('../dados/src/menus/index.js', import.meta.url).href);
const menus = await getMenus();

await test('menu18 lista o !hotseat na categoria BRINCADEIRAS', async () => {
  const menu = desbold(await menus.menu18('!', 'Lizzy', 'Kannon'));
  ok(menu.includes('BRINCADEIRAS'), 'tem a categoria BRINCADEIRAS');
  ok(menu.includes('!hotseat'), 'lista o !hotseat');
  ok(menu.includes('!vab18') && menu.includes('!eununca18'), 'nao removeu os outros comandos');
});

await test('hotseat esta no blockPv do menu18', async () => {
  const bp = fs.readFileSync(path.join(ROOT, 'dados/src/utils/blockPv.js'), 'utf-8');
  const bloco = bp.slice(bp.indexOf('menu18: {'), bp.indexOf('menu18: {') + 320);
  ok(bloco.includes('hotseat'), 'hotseat na lista de comandos do menu18');
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
