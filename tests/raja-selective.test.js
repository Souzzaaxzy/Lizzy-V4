/**
 * Testes do !raja com envio seletivo — membros comuns leem, admins não.
 *
 * O que este teste garante: que o !raja usa SOMENTE a API de rotação, com a
 * lista de autorizados = membros comuns (nunca um admin), mantendo o conteúdo
 * do raja intacto. Também cobre os N envios em sequência, que é onde a rotação
 * por mensagem poderia se atropelar.
 *
 * Uso: node tests/raja-selective.test.js
 */

import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-raja-sel-db-'));
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
      return result
        .then(() => finish(name))
        .catch((error) => {
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

const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';

let groupCounter = 0;
function makeGroup() {
  groupCounter += 1;
  const jid = `1203636000000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(
    path.join(GRUPOS_DIR, `${jid}.json`),
    JSON.stringify({ modobrincadeira: true, groupName: 'Grupo Raja Seletivo' }, null, 2)
  );
  return jid;
}

const ADM_A = '111000000000001@lid';
const ADM_A_PN = '5511911111111@s.whatsapp.net';
const ADM_B = '111000000000002@lid';
const ADM_B_PN = '5511911111112@s.whatsapp.net';
const MEM_1 = '222000000000001@lid';
const MEM_1_PN = '5511922222221@s.whatsapp.net';
const MEM_2 = '222000000000002@lid';
const MEM_2_PN = '5511922222222@s.whatsapp.net';

const GROUP_PARTICIPANTS = [
  { id: BOT_LID, lid: BOT_LID, phoneNumber: BOT_JID, admin: 'admin' },
  { id: ADM_A, lid: ADM_A, phoneNumber: ADM_A_PN, admin: 'superadmin' },
  { id: ADM_B, lid: ADM_B, phoneNumber: ADM_B_PN, admin: 'admin' },
  { id: MEM_1, lid: MEM_1, phoneNumber: MEM_1_PN, admin: null },
  { id: MEM_2, lid: MEM_2, phoneNumber: MEM_2_PN, admin: null },
];

function makeNazu({ sent, groupJid, senderLid, hasRotationApi = true }) {
  const nazu = {
    sendMessage: async (jid, content, options) => {
      sent.push({ jid, content, options });
      return { key: { id: `SENT-${sent.length}` } };
    },
    relayMessage: async (jid, message, options) => {
      sent.push({ jid, message, options, via: 'relayMessage' });
      return options?.messageId;
    },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
    onWhatsApp: async (jid) => [{ jid, exists: true, lid: jid.replace('@s.whatsapp.net', '@lid') }],
    signalRepository: { lidMapping: { getPNForLID: async () => null, getLIDForPN: async () => null } },
    groupMetadata: async () => ({
      id: groupJid,
      subject: 'Grupo Raja Seletivo',
      // Os papéis REAIS do metadata, sem rebaixar quem envia: o comando agora é
      // disparado como o PRÓPRIO bot (fromMe), e rebaixar o bot o faria entrar
      // na lista de "membros comuns" — medindo o conjunto errado de autorizados.
      participants: GROUP_PARTICIPANTS,
    }),
    groupParticipantsUpdate: async () => ({}),
    groupRequestParticipantsList: async () => [],
    groupRequestParticipantsUpdate: async () => ({}),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {},
    sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => 'x',
    react: async () => ({}),
    _rotationCalls: [],
  };
  if (hasRotationApi) {
    nazu.relayGroupMessageWithSenderKeyRotation = async (g, m, o) => {
      nazu._rotationCalls.push({ g, m, o });
      return { groupJid: g, messageId: o?.messageId, allowedParticipants: o?.allowedParticipants };
    };
  }
  return nazu;
}

/**
 * Envia o comando como o PRÓPRIO bot (fromMe).
 *
 * Dois motivos: (1) o throttle de comandos (`checkThrottle`) é PULADO quando
 * `info.key.fromMe` é true, então vários comandos seguidos no teste não caem no
 * anti-flood; (2) os comandos desta suíte são do dono, e `fromMe` é uma das
 * formas que o handler aceita como dono.
 */
/** Espera a escrita em disco.
 *
 * `persistGroupData()` é fire-and-forget (`writeJsonFileAsync`): o arquivo do
 * grupo NÃO está pronto quando `handleMessage` retorna. Ler direto dava
 * `undefined` e o teste mediria uma corrida em vez do comportamento.
 */
const esperarDisco = () => new Promise((r) => setTimeout(r, 400));

// O estado do raja agora é GLOBAL, então um teste que espera "nada salvo"
// precisa zerar o slot antes — senão herda o que o teste anterior gravou.
const limparRajaGlobal = () => {
  fs.mkdirSync(path.join(TMP_DB, 'dono'), { recursive: true });
  fs.writeFileSync(
    path.join(TMP_DB, 'dono', 'rajaMsg.json'),
    JSON.stringify({ quantidade: 0, texto: '' }, null, 2)
  );
};

let cenario = 0;

async function rodar({ groupJid, text = '!rajar', hasRotationApi = true }) {
  cenario += 1;
  const sent = [];
  const nazu = makeNazu({ sent, groupJid, senderLid: BOT_LID, hasRotationApi });
  await handleMessage(
    nazu,
    {
      key: { remoteJid: groupJid, fromMe: true, id: `M-${cenario}`, participant: BOT_LID },
      message: { extendedTextMessage: { text, contextInfo: { remoteJid: groupJid } } },
      messageTimestamp: 1757900000,
      pushName: 'Tester',
    },
    null,
    new Map(),
    null
  );
  // `persistGroupData()` é fire-and-forget: sem esperar, o comando SEGUINTE lê o
  // cache antigo e o teste mediria uma corrida (foi o que aconteceu: o
  // `!setmsgraja` salvava mas o `!raja` ainda via "nada salvo").
  await esperarDisco();
  const textos = sent.map((s) => s.content?.text ?? '').filter(Boolean).join('\n');
  return { sent, textos, nazu, rotationCalls: nazu._rotationCalls };
}

// ============================================================================

await test('!setmsgraja salva quantidade e texto GLOBALMENTE', async () => {
  const groupJid = makeGroup();
  const r = await rodar({ groupJid, text: '!setmsgraja 7 bom dia pessoal' });
  ok(r.textos.includes('MENSAGEM DO RAJA SALVA'), 'confirmou o salvamento');

  // O estado vai para o slot GLOBAL do bot (é o que o !raja lê), não para o
  // arquivo do grupo.
  await esperarDisco();
  const salvo = JSON.parse(fs.readFileSync(path.join(TMP_DB, 'dono', 'rajaMsg.json'), 'utf-8'));
  assert.equal(salvo.quantidade, 7, 'quantidade salva');
  assert.equal(salvo.texto, 'bom dia pessoal', 'texto salvo');
});

await test('!raja mostra o que está salvo (não dispara nada)', async () => {
  const groupJid = makeGroup();
  await rodar({ groupJid, text: '!setmsgraja 3 texto salvo' });
  const r = await rodar({ groupJid, text: '!raja' });
  ok(r.textos.includes('MENSAGEM DO RAJA'), 'mostrou o painel');
  ok(r.textos.includes('3'), 'mostrou a quantidade');
  ok(r.textos.includes('texto salvo'), 'mostrou o texto');
  assert.equal(r.rotationCalls.length, 0, 'NÃO disparou nada');
});

await test('!raja sem nada salvo avisa e ensina o comando', async () => {
  limparRajaGlobal();
  const groupJid = makeGroup();
  const r = await rodar({ groupJid, text: '!raja' });
  ok(r.textos.includes('Nenhuma mensagem salva'), 'avisou que não há nada salvo');
  ok(r.textos.includes('setmsgraja'), 'apontou o !setmsgraja');
});

await test('!rajar usa a quantidade e o texto salvos', async () => {
  const groupJid = makeGroup();
  await rodar({ groupJid, text: '!setmsgraja 3 repete' });
  const r = await rodar({ groupJid, text: '!rajar' });
  assert.equal(r.rotationCalls.length, 3, 'enviou exatamente a quantidade salva');
  const msg = r.rotationCalls[0]?.m;
  assert.equal(
    msg?.requestPaymentMessage?.noteMessage?.extendedTextMessage?.text,
    'repete',
    'usou o texto salvo, na NOTA'
  );
});

await test('!rajar sem nada salvo não envia e aponta o !setmsgraja', async () => {
  limparRajaGlobal();
  const groupJid = makeGroup();
  const r = await rodar({ groupJid, text: '!rajar' });
  assert.equal(r.rotationCalls.length, 0, 'não enviou');
  ok(r.textos.includes('Nada salvo'), 'avisou que não há nada salvo');
});

await test('o estado é GLOBAL: salvar no A vale no B', async () => {
  const grupoA = makeGroup();
  const grupoB = makeGroup();
  await rodar({ groupJid: grupoA, text: '!setmsgraja 2 do A' });
  const rB = await rodar({ groupJid: grupoB, text: '!rajar' });
  assert.equal(rB.rotationCalls.length, 2, 'o grupo B herdou o que foi salvo no A');
  const msg = rB.rotationCalls[0]?.m;
  assert.equal(
    msg?.requestPaymentMessage?.noteMessage?.extendedTextMessage?.text,
    'do A',
    'o grupo B usou o texto salvo no A'
  );
});

await test('!setmsgraja aplica o teto de 500', async () => {
  const groupJid = makeGroup();
  const r = await rodar({ groupJid, text: '!setmsgraja 999 teto' });
  await esperarDisco();
  const salvo = JSON.parse(fs.readFileSync(path.join(TMP_DB, 'dono', 'rajaMsg.json'), 'utf-8'));
  assert.equal(salvo.quantidade, 500, 'guardou no máximo 500');
  ok(r.textos.includes('limitado'), 'informou que limitou');
});

await test('!setmsgraja recusa sem quantidade ou sem texto', async () => {
  const groupJid = makeGroup();
  const semTexto = await rodar({ groupJid, text: '!setmsgraja 5' });
  ok(semTexto.textos.includes('Uso:'), 'pediu o formato correto');
  const semQtd = await rodar({ groupJid, text: '!setmsgraja texto solto' });
  ok(semQtd.textos.includes('Uso:'), 'pediu o formato correto');
});

await test('!rajar autoriza TODOS os membros comuns e NENHUM admin', async () => {
  const groupJid = makeGroup();
  await rodar({ groupJid, text: '!setmsgraja 1 oi' });
  const r = await rodar({ groupJid, text: '!rajar' });
  ok(r.rotationCalls.length === 1, `usou a rotação (${r.rotationCalls.length} chamadas)`);
  const autorizados = r.rotationCalls[0]?.o?.allowedParticipants ?? [];
  assert.deepEqual(
    autorizados.slice().sort(),
    [MEM_1, MEM_2].sort(),
    'autorizados = os dois membros comuns'
  );
  ok(!autorizados.includes(ADM_A), 'ADM_A (superadmin) NÃO está autorizado');
  ok(!autorizados.includes(ADM_B), 'ADM_B (admin) NÃO está autorizado');
});

await test('!rajar NÃO usa relayMessage nem sendMessage para o conteúdo', async () => {
  const groupJid = makeGroup();
  await rodar({ groupJid, text: '!setmsgraja 1 conteudo' });
  const r = await rodar({ groupJid, text: '!rajar' });
  const viaRelay = r.sent.filter((s) => s.via === 'relayMessage');
  ok(viaRelay.length === 0, `não caiu no relayMessage (${viaRelay.length}) — ele mostraria a todos`);
  const enviosComTexto = r.sent.filter((s) => s.content?.text === 'conteudo');
  ok(enviosComTexto.length === 0, 'o conteúdo não saiu por sendMessage');
  ok(r.rotationCalls.length === 1, 'o conteúdo saiu só pela rotação');
});

await test('!rajar mantém o conteúdo do raja intacto (requestPaymentMessage)', async () => {
  const groupJid = makeGroup();
  await rodar({ groupJid, text: '!setmsgraja 1 nota' });
  const r = await rodar({ groupJid, text: '!rajar' });
  const msg = r.rotationCalls[0]?.m;
  ok(!!msg, 'passou a mensagem do raja');
  ok(!!msg?.requestPaymentMessage, 'o conteúdo continua sendo requestPaymentMessage');
  assert.equal(
    msg?.requestPaymentMessage?.noteMessage?.extendedTextMessage?.text,
    'nota',
    'o texto continua na NOTA, sem @ no corpo'
  );
  ok(
    Array.isArray(msg?.requestPaymentMessage?.noteMessage?.extendedTextMessage?.contextInfo?.mentionedJid),
    'mentionedJid continua na nota'
  );
});

await test('!rajar envia N vezes, cada uma com messageId próprio', async () => {
  const groupJid = makeGroup();
  await rodar({ groupJid, text: '!setmsgraja 3 repete' });
  const r = await rodar({ groupJid, text: '!rajar' });
  assert.equal(r.rotationCalls.length, 3, 'enviou 3 mensagens');
  const ids = r.rotationCalls.map((c) => c.o?.messageId);
  assert.equal(new Set(ids).size, 3, 'cada envio tem um messageId distinto');
  ok(ids.every((id) => typeof id === 'string' && id.length > 0), 'todos os ids são strings válidas');
  ok(
    r.rotationCalls.every((c) => Array.isArray(c.o.allowedParticipants) && c.o.allowedParticipants.length === 2),
    'cada envio autoriza os mesmos dois membros'
  );
});

await test('!rajar entrega SÓ as mensagens — sem resumo de conclusão no grupo', async () => {
  const groupJid = makeGroup();
  await rodar({ groupJid, text: '!setmsgraja 2 texto' });
  const r = await rodar({ groupJid, text: '!rajar' });
  // Nada de resposta no chat: nem "RAJA CONCLUÍDO", nem contagem, nem falhas.
  assert.equal(r.sent.length, 0, `nenhuma mensagem de texto foi enviada (${r.sent.length})`);
  assert.equal(r.textos, '', 'nenhum texto de resposta (nem resumo)');
  ok(!r.textos.includes('CONCLUÍDO'), 'não mandou o resumo de conclusão');
  // E o que saiu foi só a rajada, pela rotação.
  assert.equal(r.rotationCalls.length, 2, 'as 2 mensagens invisíveis saíram');
});

await test('!rajar falha fechado se a fork não expõe a rotação (não vaza)', async () => {
  const groupJid = makeGroup();
  await rodar({ groupJid, text: '!setmsgraja 1 x' });
  const r = await rodar({ groupJid, text: '!rajar', hasRotationApi: false });
  assert.equal(r.rotationCalls.length, 0, 'não chamou a rotação (inexistente)');
  const viaRelay = r.sent.filter((s) => s.via === 'relayMessage');
  assert.equal(viaRelay.length, 0, 'NÃO caiu para o relayMessage — nada foi enviado ao grupo');
  ok(r.textos.includes('Nada foi enviado'), 'avisou que nada foi enviado');
});

// ============================================================================

const totalPassed = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFailed = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log(`\nTOTAL: ${totalPassed} ok, ${totalFailed} falhas em ${RESULTS.length} testes`);
process.exit(totalFailed === 0 ? 0 : 1);