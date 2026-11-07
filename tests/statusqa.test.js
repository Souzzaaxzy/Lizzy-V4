/**
 * Testes do Group Status — perguntas e respostas.
 *
 * Três camadas, da mais pura para a mais integrada:
 *
 * 1. STORAGE (`utils/groupStatusQA.js`) — persistência, dedup, isolamento por
 *    grupo e validação de índice. Sem socket, sem disco real (DATABASE_PATH
 *    temporário).
 * 2. LISTENER (`utils/groupStatusListener.js`) — o corpo que recebe a resposta,
 *    exercitado por um emitter falso. Importar o `connect.js` abriria conexão de
 *    verdade, por isso a lógica vive no módulo.
 * 3. COMANDOS — pelo handler real: `!statusp`, `!statusrp`, `!statusview`,
 *    incluindo permissão, isolamento entre grupos e a validação de índice.
 *
 * O que este teste NÃO prova: que o cliente oficial renderiza o card e que o
 * servidor manda o tipo 4 ao responder. Isso exige duas contas reais.
 *
 * Uso: node tests/statusqa.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-statusqa-db-'));
process.env.DATABASE_PATH = TMP_DB;
const GRUPOS_DIR = path.join(TMP_DB, 'grupos');
fs.mkdirSync(GRUPOS_DIR, { recursive: true });

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

// O layout dos comandos usa MATHEMATICAL BOLD (𝐏𝐄𝐑𝐆𝐔𝐍𝐓𝐀). Comparar com o
// texto cru falharia mesmo com a mensagem certa — desbold antes de comparar.
function desbold(t) {
  return String(t || '').replace(/[\u{1D400}-\u{1D7FF}]/gu, (c) => {
    const cp = c.codePointAt(0);
    if (cp >= 0x1D400 && cp <= 0x1D419) return String.fromCharCode(cp - 0x1D400 + 65);
    if (cp >= 0x1D41A && cp <= 0x1D433) return String.fromCharCode(cp - 0x1D41A + 97);
    if (cp >= 0x1D434 && cp <= 0x1D44D) return String.fromCharCode(cp - 0x1D434 + 65);
    if (cp >= 0x1D44E && cp <= 0x1D467) return String.fromCharCode(cp - 0x1D44E + 97);
    if (cp >= 0x1D468 && cp <= 0x1D481) return String.fromCharCode(cp - 0x1D468 + 65);
    if (cp >= 0x1D482 && cp <= 0x1D49B) return String.fromCharCode(cp - 0x1D482 + 97);
    if (cp >= 0x1D7CE && cp <= 0x1D7D7) return String.fromCharCode(cp - 0x1D7CE + 48);
    return c;
  });
}

function includes(haystack, needle, label) {
  const h = desbold(haystack);
  ok(typeof h === 'string' && h.includes(desbold(needle)), `${label ?? needle} — esperado conter "${needle}"`);
}

function notIncludes(haystack, needle, label) {
  const h = desbold(haystack);
  ok(typeof h === 'string' && !h.includes(desbold(needle)), `${label ?? needle} — não deveria conter "${needle}"`);
}

// ============================================================================
// Módulos sob teste
// ============================================================================

const QA = await import(new URL('../dados/src/utils/groupStatusQA.js', import.meta.url).href);
const LISTENER = await import(new URL('../dados/src/utils/groupStatusListener.js', import.meta.url).href);
const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;

const G1 = '120363400000000001@g.us';
const G2 = '120363400000000002@g.us';
const USER = '5511911111111@s.whatsapp.net';
const USER2 = '5511922222222@s.whatsapp.net';

const limpar = () => QA.limparTudo();

// ============================================================================
// 1) STORAGE
// ============================================================================

await test('1. registrar pergunta e lê-la de volta (persistiu em disco)', async () => {
  limpar();
  const r = QA.registrarPergunta(G1, { id: 'S1', texto: 'Qual música?', autor: USER, criadoEm: Date.now() });
  ok(r && r.id === 'S1', 'pergunta registrada');
  // relê do DISCO (não da memória)
  const ativa = QA.perguntaAtiva(G1);
  ok(ativa?.id === 'S1', 'a pergunta está no arquivo');
  ok(ativa?.texto === 'Qual música?', 'texto preservado');
  ok(Array.isArray(ativa?.respostas) && ativa.respostas.length === 0, 'começa sem respostas');
  // e o arquivo existe de fato
  ok(fs.existsSync(path.join(TMP_DB, 'statusQA.json')), 'o JSON foi gravado');
});

await test('2. registrar resposta e recuperá-la', async () => {
  limpar();
  QA.registrarPergunta(G1, { id: 'S2', texto: 'Pergunta?', autor: USER });
  const r = QA.registrarResposta(G1, { statusId: 'S2', id: 'R1', participante: USER2, texto: 'Rock!', recebidoEm: 1790000000000 });
  ok(r.ok && !r.duplicada, 'resposta aceita');
  const p = QA.buscarPergunta(G1, 'S2');
  ok(p.respostas.length === 1, 'uma resposta');
  ok(p.respostas[0].texto === 'Rock!', 'texto certo');
  ok(p.respostas[0].participante === USER2, 'participante certo');
  ok(p.respostas[0].recebidoEm === 1790000000000, 'timestamp preservado');
});

await test('3. DEDUP: a mesma resposta não entra duas vezes', async () => {
  limpar();
  QA.registrarPergunta(G1, { id: 'S3', texto: 'P?' });
  const a = QA.registrarResposta(G1, { statusId: 'S3', id: 'R1', participante: USER, texto: 'oi' });
  const b = QA.registrarResposta(G1, { statusId: 'S3', id: 'R1', participante: USER, texto: 'oi' });
  ok(a.ok && !a.duplicada, 'a primeira entra');
  ok(b.ok && b.duplicada === true, 'a segunda é marcada duplicada');
  ok(QA.buscarPergunta(G1, 'S3').respostas.length === 1, 'só uma no disco');
});

await test('4. DEDUP por conteúdo quando o id não vem', async () => {
  limpar();
  QA.registrarPergunta(G1, { id: 'S4', texto: 'P?' });
  QA.registrarResposta(G1, { statusId: 'S4', participante: USER, texto: 'mesma coisa' });
  const b = QA.registrarResposta(G1, { statusId: 'S4', participante: USER, texto: 'mesma coisa' });
  ok(b.duplicada === true, 'sem id, deduplica por participante+texto');
  ok(QA.buscarPergunta(G1, 'S4').respostas.length === 1, 'só uma');
});

await test('5. ISOLAMENTO: resposta de um grupo não aparece no outro', async () => {
  limpar();
  QA.registrarPergunta(G1, { id: 'S5', texto: 'no G1' });
  QA.registrarPergunta(G2, { id: 'S5', texto: 'no G2' }); // MESMO id, grupos diferentes
  QA.registrarResposta(G1, { statusId: 'S5', id: 'R-G1', participante: USER, texto: 'sou do G1' });
  ok(QA.buscarPergunta(G1, 'S5').respostas.length === 1, 'G1 tem a sua');
  ok(QA.buscarPergunta(G2, 'S5').respostas.length === 0, 'G2 NÃO vê a do G1');
  // e uma resposta para um status de outro grupo é recusada
  const r = QA.registrarResposta(G2, { statusId: 'NAO_EXISTE', id: 'X', texto: 'oi' });
  ok(!r.ok && r.motivo === 'status_desconhecido', 'status de outro grupo é recusado');
});

await test('6. resposta para status DESCONHECIDO é recusada (não inventa)', async () => {
  limpar();
  const r = QA.registrarResposta(G1, { statusId: 'NAO_EXISTE', id: 'R1', texto: 'oi' });
  ok(!r.ok, 'recusado');
  ok(r.motivo === 'status_desconhecido', `motivo certo (veio ${r.motivo})`);
});

await test('7. respostasPorIndice valida o índice NA pergunta', async () => {
  limpar();
  QA.registrarPergunta(G1, { id: 'S7', texto: 'P?' });
  QA.registrarResposta(G1, { statusId: 'S7', id: 'R1', participante: USER, texto: 'um' });
  QA.registrarResposta(G1, { statusId: 'S7', id: 'R2', participante: USER2, texto: 'dois' });
  const um = QA.respostasPorIndice(G1, 'S7', 1);
  const dois = QA.respostasPorIndice(G1, 'S7', 2);
  ok(um?.resposta?.texto === 'um', 'índice 1 = primeira');
  ok(dois?.resposta?.texto === 'dois', 'índice 2 = segunda');
  ok(QA.respostasPorIndice(G1, 'S7', 3) === null, 'índice fora da lista é null');
  ok(QA.respostasPorIndice(G1, 'S7', 0) === null, 'índice 0 é null');
  ok(QA.respostasPorIndice(G2, 'S7', 1) === null, 'outro grupo não acha');
});

await test('8. resposta da administração é registrada na resposta certa', async () => {
  limpar();
  QA.registrarPergunta(G1, { id: 'S8', texto: 'P?' });
  QA.registrarResposta(G1, { statusId: 'S8', id: 'R1', participante: USER, texto: 'um' });
  QA.registrarResposta(G1, { statusId: 'S8', id: 'R2', participante: USER2, texto: 'dois' });
  const r = QA.registrarRespostaAdmin(G1, 'S8', 2, { texto: 'Boa ideia!' });
  ok(r.ok, 'aceito');
  const p = QA.buscarPergunta(G1, 'S8');
  ok(p.respostas[0].respostasAdmin.length === 0, 'a 1ª não recebeu nada');
  ok(p.respostas[1].respostasAdmin.length === 1, 'a 2ª recebeu');
  ok(p.respostas[1].respostasAdmin[0].texto === 'Boa ideia!', 'texto certo');
  // índice inválido
  ok(!QA.registrarRespostaAdmin(G1, 'S8', 9, { texto: 'x' }).ok, 'índice inválido recusado');
});

await test('9. arquivo corrompido não derruba (devolve vazio)', async () => {
  limpar();
  fs.writeFileSync(path.join(TMP_DB, 'statusQA.json'), '{ isto não é json');
  const p = QA.perguntaAtiva(G1);
  ok(p === null, 'lê como vazio em vez de lançar');
  // e volta a funcionar depois
  QA.registrarPergunta(G1, { id: 'S9', texto: 'volta' });
  ok(QA.perguntaAtiva(G1)?.id === 'S9', 'grava de novo normalmente');
});

await test('10. perguntaAtiva devolve a MAIS RECENTE', async () => {
  limpar();
  QA.registrarPergunta(G1, { id: 'A', texto: 'primeira' });
  QA.registrarPergunta(G1, { id: 'B', texto: 'segunda' });
  ok(QA.perguntaAtiva(G1)?.id === 'B', 'a última publicada');
});

await test('11. montarStatusView lista numerado e menciona os participantes', async () => {
  limpar();
  QA.registrarPergunta(G1, { id: 'S11', texto: 'Qual música?', criadoEm: Date.now() });
  QA.registrarResposta(G1, { statusId: 'S11', id: 'R1', participante: USER, texto: 'Rock!', recebidoEm: Date.now() });
  QA.registrarResposta(G1, { statusId: 'S11', id: 'R2', participante: USER2, texto: 'Sertanejo', recebidoEm: Date.now() });
  const { texto, mentions } = QA.montarStatusView(QA.perguntaAtiva(G1), {
    nomeDe: (jid) => (jid === USER ? 'Fulano' : 'Beltrano'),
    botName: 'Lizzy'
  });
  includes(texto, 'Qual música?', 'a pergunta aparece');
  includes(texto, 'Respostas recebidas: 2', 'a contagem');
  includes(texto, '1. Fulano', 'primeiro numerado com nome');
  includes(texto, '2. Beltrano', 'segundo numerado com nome');
  includes(texto, 'Rock!', 'o conteúdo da 1ª');
  includes(texto, 'Sertanejo', 'o conteúdo da 2ª');
  ok(mentions.length === 2, 'as duas menções reais');
  ok(mentions.includes(USER) && mentions.includes(USER2), 'os JIDs certos');
});

await test('12. montarStatusView sem pergunta avisa (não quebra)', async () => {
  const { texto, mentions } = QA.montarStatusView(null, { nomeDe: (j) => j });
  includes(texto, 'Nenhuma pergunta', 'avisa que não há pergunta');
  ok(mentions.length === 0, 'sem menções');
});

// ============================================================================
// 2) LISTENER
// ============================================================================

await test('13. o listener registra a resposta que chega pelo evento', async () => {
  limpar();
  LISTENER._resetListener();
  QA.registrarPergunta(G1, { id: 'EV1', texto: 'P?' });
  const ev = new EventEmitter();
  const logs = [];
  ok(LISTENER.attachGroupStatusListener({ ev, log: (m) => logs.push(m) }) === true, 'anexou');

  ev.emit('group-status.answer', {
    statusId: 'EV1',
    statusRemoteJid: G1,
    responseId: 'RESP-EV1',
    participant: USER,
    pushName: 'Fulano',
    messageTimestamp: 1790000000
  });
  await new Promise((r) => setTimeout(r, 20));

  const p = QA.buscarPergunta(G1, 'EV1');
  ok(p.respostas.length === 1, 'a resposta foi registrada');
  ok(p.respostas[0].texto === undefined || p.respostas[0].texto === null, 'sem texto (a notificação não traz)');
  ok(p.respostas[0].participante === USER, 'o participante certo');
  ok(logs.some((l) => l.includes('registrada')), 'logou o registro');
});

await test('14. o listener é idempotente (reconexão não duplica)', async () => {
  LISTENER._resetListener();
  const ev = new EventEmitter();
  ok(LISTENER.attachGroupStatusListener({ ev }) === true, 'primeira anexa');
  ok(LISTENER.attachGroupStatusListener({ ev }) === false, 'segunda NÃO anexa');
  ok(ev.listenerCount('group-status.answer') === 1, 'só um listener');
});

await test('15. o listener ignora resposta sem status conhecido (e não lança)', async () => {
  limpar();
  LISTENER._resetListener();
  const ev = new EventEmitter();
  const logs = [];
  LISTENER.attachGroupStatusListener({ ev, log: (m) => logs.push(m) });
  ev.emit('group-status.answer', { statusId: 'DESCONHECIDO', statusRemoteJid: G1, responseId: 'X' });
  await new Promise((r) => setTimeout(r, 20));
  ok(logs.some((l) => l.includes('ignorada')), 'logou que ignorou');
  // evento sem status não quebra
  ev.emit('group-status.answer', {});
  await new Promise((r) => setTimeout(r, 20));
  ok(true, 'não lançou');
});

await test('16. socket sem emitter degrada (não lança)', async () => {
  LISTENER._resetListener();
  ok(LISTENER.attachGroupStatusListener({}) === false, 'sem ev devolve false');
  ok(LISTENER.attachGroupStatusListener({ ev: {} }) === false, 'ev sem .on devolve false');
});

// ============================================================================
// 3) COMANDOS (handler real)
// ============================================================================

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';

let groupCounter = 0;
function makeGroup(flags = {}) {
  groupCounter += 1;
  const jid = `1203635000000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(
    path.join(GRUPOS_DIR, `${jid}.json`),
    JSON.stringify({ modobrincadeira: true, groupName: 'Grupo QA', ...flags }, null, 2)
  );
  return jid;
}

function makeNazu({ sent, groupJid, senderNoMetadata, comoAdmin = false, comMetodos = true }) {
  const nazu = {
    sendMessage: async (jid, content, options) => {
      sent.push({ jid, content, options });
      return { key: { id: `SENT-${sent.length}` } };
    },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
    onWhatsApp: async (jid) => [{ jid, exists: true, lid: jid.replace('@s.whatsapp.net', '@lid') }],
    signalRepository: { lidMapping: { getPNForLID: async () => null } },
    groupMetadata: async () => ({
      id: groupJid,
      subject: 'Grupo QA',
      participants: [
        { id: BOT_LID, lid: BOT_LID, phoneNumber: BOT_JID, admin: 'admin' },
        {
          id: senderNoMetadata,
          lid: senderNoMetadata,
          phoneNumber: '5511999999997@s.whatsapp.net',
          admin: comoAdmin ? 'admin' : null
        }
      ]
    }),
    groupParticipantsUpdate: async () => ({}),
    groupRequestParticipantsList: async () => [],
    groupRequestParticipantsUpdate: async () => ({}),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {},
    sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => 'x',
    react: async () => ({})
  };
  if (comMetodos) {
    // Espelha a API da fork. O `!statusp` guarda o id devolvido; o teste
    // controla esse id para casar com o que o listener gravaria.
    nazu.sendGroupStatusQuestion = async (jid, { text }) => {
      sent.push({ jid, content: { groupStatus: true, text }, options: undefined, viaStatusp: true });
      return { key: { id: `STATUS-${sent.length}`, remoteJid: jid } };
    };
    nazu.replyGroupStatusAnswer = async (params) => {
      sent.push({ jid: params.groupJid, content: { replyAnswer: true, ...params }, options: undefined, viaStatusrp: true });
      return { key: { id: `REPLY-${sent.length}` } };
    };
  }
  return nazu;
}

let senderCounter = 0;
async function rodar({ groupJid, text, admin = true, sender = null, semMetodos = false }) {
  if (!sender) {
    senderCounter += 1;
    sender = admin
      ? `22200000${String(senderCounter).padStart(5, '0')}@lid`
      : `33300000${String(senderCounter).padStart(5, '0')}@lid`;
  }
  // O metadata do grupo e' CACHEADO (TTL ~10s): reusar o mesmo grupo entre
  // comandos devolve o metadata ANTERIOR, e o sender novo nao aparece como
  // admin. Por isso cada chamada recebe um grupo NOVO — o sender viaja junto.
  // Se o teste PASSA um grupo, e' reuso proposital (mesma conversa). Senao,
  // grupo novo — o metadata e' cacheado e um sender novo apareceria com o
  // metadata antigo.
  const grupoDaChamada = groupJid || makeGroup();
  const sent = [];
  const nazu = makeNazu({ sent, groupJid: grupoDaChamada, senderNoMetadata: sender, comoAdmin: admin, comMetodos: !semMetodos });
  await handleMessage(nazu, {
    key: { remoteJid: grupoDaChamada, fromMe: false, id: `M-${Math.random().toString(36).slice(2, 9)}`, participant: sender },
    message: { extendedTextMessage: { text, contextInfo: { remoteJid: grupoDaChamada } } },
    messageTimestamp: 1757900000,
    pushName: 'Tester'
  }, null, new Map(), null);
  const texto = sent.map((s) => s.content?.text ?? s.content?.caption ?? '').filter(Boolean).join('\n');
  return { sent, texto, grupo: grupoDaChamada, sender };
}

await test('17. !statusp publica a pergunta e registra no storage', async () => {
  limpar();
  const { sent, texto, grupo: g } = await rodar({ text: '!statusp Qual música vocês querem?' });
  const pub = sent.find((s) => s.viaStatusp);
  ok(!!pub, 'chamou sendGroupStatusQuestion');
  ok(pub.content.text === 'Qual música vocês querem?', 'mandou o texto certo');
  includes(texto, 'PERGUNTA PUBLICADA', 'confirma a publicação');
  const ativa = QA.perguntaAtiva(g);
  ok(!!ativa, 'registrou no storage');
  ok(ativa.texto === 'Qual música vocês querem?', 'texto guardado');
});

await test('18. !statusp sem texto pede o texto', async () => {
  const { sent, texto } = await rodar({ text: '!statusp' });
  ok(!sent.find((s) => s.viaStatusp), 'não publicou nada');
  includes(texto, 'Use:', 'mostra o uso');
});

await test('19. !statusp exige admin', async () => {
  const { sent, texto } = await rodar({ text: '!statusp Pergunta?', admin: false });
  ok(!sent.find((s) => s.viaStatusp), 'não publicou');
  includes(texto, 'administradores', 'recusa por permissão');
});

await test('20. !statusview mostra as respostas (com nome e menção)', async () => {
  limpar();
  const r1 = await rodar({ text: '!statusp Pergunta do view?' });
  const g = r1.grupo;
  const ativa = QA.perguntaAtiva(g);
  QA.registrarResposta(g, { statusId: ativa.id, id: 'R1', participante: USER, texto: 'Minha sugestão!', recebidoEm: Date.now() });
  // mesmo sender: o metadata do grupo e' cacheado, e um sender novo apareceria
  // com o metadata antigo (sem ser admin).
  const { sent, texto } = await rodar({ groupJid: g, text: '!statusview', sender: r1.sender });
  includes(texto, 'Pergunta do view?', 'mostra a pergunta');
  includes(texto, 'Respostas recebidas: 1', 'a contagem');
  includes(texto, 'Minha sugestão!', 'o conteúdo da resposta');
  includes(texto, '1.', 'a numeração');
  // O `reply` poe as mencoes no CONTENT (`messageContent.mentions`), nao nas
  // options.
  const comMencoes = sent.find((s) => s.content?.mentions?.length);
  ok(!!comMencoes, 'enviou menções reais');
});

await test('21. !statusview sem pergunta avisa', async () => {
  limpar();
  const { texto } = await rodar({ text: '!statusview' });
  includes(texto, 'Nenhuma pergunta', 'avisa que não há pergunta');
});

await test('22. !statusrp responde a resposta do número certo', async () => {
  limpar();
  const r1 = await rodar({ text: '!statusp Pergunta rp?' });
  const g = r1.grupo;
  const ativa = QA.perguntaAtiva(g);
  QA.registrarResposta(g, { statusId: ativa.id, id: 'R1', participante: USER, texto: 'primeira' });
  QA.registrarResposta(g, { statusId: ativa.id, id: 'R2', participante: USER2, texto: 'segunda' });

  const { sent, texto } = await rodar({ groupJid: g, text: '!statusrp 2 Vamos considerar!', sender: r1.sender });
  const rp = sent.find((s) => s.viaStatusrp);
  ok(!!rp, 'chamou replyGroupStatusAnswer');
  ok(rp.content.text === 'Vamos considerar!', 'mandou o texto do admin');
  // a resposta referenciada é a SEGUNDA, não a primeira
  ok(rp.content.quotedResponse?.extendedTextMessage?.text === 'segunda', `referencia a 2ª resposta (veio "${rp.content.quotedResponse?.extendedTextMessage?.text}")`);
  ok(rp.content.quotedQuestion?.extendedTextMessage?.text === 'Pergunta rp?', 'referencia a pergunta');
  includes(texto, 'Resposta enviada', 'confirma');

  // e ficou registrado na resposta CERTA
  const p = QA.buscarPergunta(g, ativa.id);
  ok(p.respostas[0].respostasAdmin.length === 0, 'a 1ª não recebeu');
  ok(p.respostas[1].respostasAdmin.length === 1, 'a 2ª recebeu');
});

await test('23. !statusrp recusa índice inexistente', async () => {
  limpar();
  const r1 = await rodar({ text: '!statusp Só uma resposta?' });
  const g = r1.grupo;
  const ativa = QA.perguntaAtiva(g);
  QA.registrarResposta(g, { statusId: ativa.id, id: 'R1', participante: USER, texto: 'unica' });
  const { sent, texto } = await rodar({ groupJid: g, text: '!statusrp 5 Nada aqui', sender: r1.sender });
  ok(!sent.find((s) => s.viaStatusrp), 'não respondeu');
  includes(texto, 'Não existe a resposta nº 5', 'avisa o índice inválido');
});

await test('24. !statusrp sem número mostra o uso', async () => {
  const { texto } = await rodar({ text: '!statusrp só texto sem numero' });
  includes(texto, 'Use:', 'mostra o uso');
});

await test('25. !statusrp exige admin', async () => {
  limpar();
  const r1 = await rodar({ text: '!statusp P?' });
  const g = r1.grupo;
  const ativa = QA.perguntaAtiva(g);
  QA.registrarResposta(g, { statusId: ativa.id, id: 'R1', participante: USER, texto: 'x' });
  // membro comum: sender DIFERENTE (o metadata do grupo ja' esta' cacheado com
  // o admin anterior; um sender novo nao aparece como admin).
  const { sent, texto } = await rodar({ groupJid: g, text: '!statusrp 1 Nope', admin: false });
  ok(!sent.find((s) => s.viaStatusrp), 'não respondeu');
  includes(texto, 'administradores', 'recusa');
});

await test('26. ISOLAMENTO entre grupos pelo handler', async () => {
  limpar();
  const rA = await rodar({ text: '!statusp Pergunta do A' });
  const gA = rA.grupo;
  const ativaA = QA.perguntaAtiva(gA);
  QA.registrarResposta(gA, { statusId: ativaA.id, id: 'R-A', participante: USER, texto: 'resposta do A' });

  // o B não vê nada do A (grupo diferente)
  const { texto: textoB } = await rodar({ text: '!statusview' });
  includes(textoB, 'Nenhuma pergunta', 'B não vê a pergunta do A');
  notIncludes(textoB, 'resposta do A', 'B não vê a resposta do A');

  // e responder no B não acha o índice do A
  const { texto: rpB } = await rodar({ text: '!statusrp 1 tenta' });
  includes(rpB, 'Nenhuma pergunta', 'B não tem pergunta para responder');
});

await test('27. biblioteca sem os métodos degrada com mensagem (não quebra)', async () => {
  const { sent, texto } = await rodar({ text: '!statusp Pergunta?', semMetodos: true });
  ok(!sent.find((s) => s.viaStatusp), 'não publicou');
  includes(texto, 'não está disponível', 'avisa que a biblioteca não suporta');
});

await test('28. os comandos NÃO funcionam fora de grupo', async () => {
  const pv = '5511933333333@s.whatsapp.net';
  for (const cmd of ['!statusp oi', '!statusview', '!statusrp 1 oi']) {
    const sent = [];
    const nazu = makeNazu({ sent, groupJid: pv, senderNoMetadata: pv, comMetodos: true });
    await handleMessage(nazu, {
      key: { remoteJid: pv, fromMe: false, id: `M-${Math.random()}`, participant: pv },
      message: { extendedTextMessage: { text: cmd, contextInfo: { remoteJid: pv } } },
      messageTimestamp: 1757900000,
      pushName: 'Tester'
    }, null, new Map(), null);
    const texto = sent.map((s) => s.content?.text ?? '').join('\n');
    includes(texto, 'só funciona em grupos', `${cmd} recusa no privado`);
  }
});

// ============================================================================

console.log('════════════════════════════════════════');
const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
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
