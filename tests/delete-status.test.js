/**
 * Testes do `!d` reescrito + mini sistema de apagar GROUP STATUS.
 *
 * Dois pontos precisam de prova, porque "não apagou" tem várias causas:
 *
 * 1. O `!d` continua apagando o que sempre apagou (mensagem de terceiro e
 *    mensagem de pagamento) — a troca da case não podia quebrar isso.
 *
 * 2. O status publicado pelo `!statusgrupo` agora é apagável. O caminho é
 *    próprio: o `!d` comum monta a key como mensagem de TERCEIRO
 *    (`fromMe: false` + participant), enquanto o status é `fromMe: true` e vai
 *    encapsulado em `groupStatusMessageV2`. O teste confere que a revogação sai
 *    no formato de status (`groupStatus: true` + `delete`) e com a key certa.
 *
 * Uso: node tests/delete-status.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-delst-db-'));
process.env.DATABASE_PATH = TMP_DB;
const GRUPOS_DIR = path.join(TMP_DB, 'grupos');
fs.mkdirSync(GRUPOS_DIR, { recursive: true });

const RESULTS = [];
let CURRENT = null;

function test(name, fn) {
  CURRENT = { name, passed: 0, failed: 0, errors: [] };
  RESULTS.push(CURRENT);
  const done = (error) => {
    if (error) {
      CURRENT.failed += 1;
      CURRENT.errors.push(`EXCEÇÃO: ${error?.stack || error}`);
    }
    console.log(`${CURRENT.failed === 0 ? '✅' : '❌'} ${name} (${CURRENT.passed} ok, ${CURRENT.failed} falhas)`);
    for (const err of CURRENT.errors) console.log(`     ${err.split('\n')[0]}`);
  };
  try {
    const result = fn();
    if (result && typeof result.then === 'function') return result.then(() => done()).catch(done);
    done();
  } catch (error) {
    done(error);
  }
  return Promise.resolve();
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

// ============================================================================
// HANDLER REAL
// ============================================================================

const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;

const gs = await import(new URL('../dados/src/utils/groupStatus.js', import.meta.url).href);

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';

let groupCounter = 0;
function makeGroup() {
  groupCounter += 1;
  const jid = `1203633000000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(path.join(GRUPOS_DIR, `${jid}.json`), JSON.stringify({ groupName: 'Grupo D', modobrincadeira: true }, null, 2));
  return jid;
}

let senderCounter = 0;
function makeNazu({ sent, groupJid, sender, comoAdmin = true }) {
  return {
    sendMessage: async (jid, content, options) => {
      sent.push({ jid, content, options });
      return { key: { id: `SENT-${sent.length}` } };
    },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
    onWhatsApp: async (jid) => [{ jid, exists: true, lid: jid.replace('@s.whatsapp.net', '@lid') }],
    signalRepository: { lidMapping: { getPNForLID: async () => null } },
    groupMetadata: async () => ({
      id: groupJid,
      subject: 'Grupo D',
      participants: [
        { id: BOT_LID, lid: BOT_LID, phoneNumber: BOT_JID, admin: 'admin' },
        { id: sender, lid: sender, phoneNumber: '5511999999997@s.whatsapp.net', admin: comoAdmin ? 'admin' : null },
      ],
    }),
    groupParticipantsUpdate: async () => ({}),
    groupRequestParticipantsList: async () => [],
    groupRequestParticipantsUpdate: async () => ({}),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {},
    sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => 'x',
    react: async () => ({}),
  };
}

/**
 * Executa uma mensagem pelo handler.
 * `quoted` vai no contextInfo da mensagem do comando; `autor` é o participant
 * do citado (quem escreveu a mensagem marcada).
 */
async function rodar({ groupJid, text, quoted = null, autor = '5511888888888@s.whatsapp.net', admin = true, id = null }) {
  senderCounter += 1;
  const sender = `22200000${String(senderCounter).padStart(5, '0')}@lid`;
  const sent = [];
  const nazu = makeNazu({ sent, groupJid, sender, comoAdmin: admin });
  const contextInfo = { remoteJid: groupJid };
  if (quoted) {
    contextInfo.quotedMessage = quoted;
    contextInfo.participant = autor;
    contextInfo.stanzaId = 'MSG-ALVO';
  }
  await handleMessage(nazu, {
    key: { remoteJid: groupJid, fromMe: false, id: id || `M-${Math.random().toString(36).slice(2, 10)}`, participant: sender },
    message: { extendedTextMessage: { text, contextInfo } },
    messageTimestamp: 1757900000,
    pushName: 'Tester',
  }, null, new Map(), null);

  const texto = sent.map((s) => s.content?.text ?? s.content?.caption ?? '').filter(Boolean).join('\n');
  return { sent, texto, nazu };
}

// ============================================================================
// 1) HELPERS PUROS (`groupStatus.js`)
// ============================================================================

await test('isGroupStatusContent: reconhece o status em qualquer encapsulamento', () => {
  const status = { groupStatusMessageV2: { message: { imageMessage: { contextInfo: { isGroupStatus: true } } } } };
  ok(gs.isGroupStatusContent(status), 'groupStatusMessageV2');
  ok(gs.isGroupStatusContent({ groupStatusMessage: { message: { conversation: 'x' } } }), 'groupStatusMessage');
  ok(
    gs.isGroupStatusContent({ extendedTextMessage: { contextInfo: { isGroupStatus: true, quotedMessage: {} } } }),
    'contextInfo.isGroupStatus'
  );
  ok(!gs.isGroupStatusContent({ conversation: 'oi' }), 'mensagem comum NÃO é status');
  ok(!gs.isGroupStatusContent({ imageMessage: { url: 'x' } }), 'imagem comum NÃO é status');
  ok(!gs.isGroupStatusContent(null), 'null NÃO é status');
});

await test('buildGroupStatusRevokePayloads: variante de status primeiro, simples depois', () => {
  const payloads = gs.buildGroupStatusRevokePayloads({ remoteJid: 'g@g.us', id: 'ABC', fromMe: true });
  ok(payloads.length === 2, 'duas tentativas');
  ok(payloads[0].groupStatus === true, 'a primeira é encapsulada como status');
  ok(payloads[0].delete?.id === 'ABC', 'id correto');
  ok(payloads[0].delete?.fromMe === true, 'fromMe: true (status é do próprio bot)');
  ok(payloads[0].delete?.participant === undefined, 'sem participant (é do bot)');
  ok(payloads[1].groupStatus === undefined, 'a segunda é revogação simples');
  ok(payloads[1].delete?.id === 'ABC', 'mesma key');

  const deTerceiro = gs.buildGroupStatusRevokePayloads({ remoteJid: 'g@g.us', id: 'X', fromMe: false, participant: 'u@s.whatsapp.net' });
  ok(deTerceiro[0].delete?.participant === 'u@s.whatsapp.net', 'de terceiro mantém participant');
  ok(deTerceiro[0].delete?.fromMe === false, 'de terceiro mantém fromMe false');

  ok(gs.buildGroupStatusRevokePayloads({}).length === 0, 'sem id -> nada');
  ok(gs.buildGroupStatusRevokePayloads(null).length === 0, 'null -> nada');
});

await test('registro de status publicados: lembra, reconhece, esquece e devolve o último', () => {
  gs.clearPublishedGroupStatuses();
  const chat = 'r@g.us';
  ok(gs.isPublishedGroupStatus(chat, 'X') === false, 'antes de publicar não conhece');
  gs.rememberPublishedGroupStatus(chat, 'X');
  gs.rememberPublishedGroupStatus(chat, 'Y');
  ok(gs.isPublishedGroupStatus(chat, 'X') === true, 'reconhece X');
  ok(gs.isPublishedGroupStatus(chat, 'Y') === true, 'reconhece Y');
  ok(gs.getLastPublishedGroupStatus(chat) === 'Y', 'o último é Y');
  ok(gs.getLastPublishedGroupStatus('outro@g.us') === null, 'outro chat não tem');
  ok(gs.forgetPublishedGroupStatus(chat, 'Y') === true, 'esquece Y');
  ok(gs.isPublishedGroupStatus(chat, 'Y') === false, 'Y esquecido');
  ok(gs.getLastPublishedGroupStatus(chat) === 'X', 'agora o último é X');
  gs.clearPublishedGroupStatuses();
  ok(gs.getLastPublishedGroupStatus(chat) === null, 'clear esvazia');
});

// ============================================================================
// 2) `!d` — APAGAR STATUS DO GRUPO
// ============================================================================

await test('!d sem alvo apaga o ÚLTIMO status publicado no grupo', async () => {
  gs.clearPublishedGroupStatuses();
  const groupJid = makeGroup();
  gs.rememberPublishedGroupStatus(groupJid, 'STATUS-RECENTE');

  const { sent, texto } = await rodar({ groupJid, text: '!d', quoted: null });
  includes(texto, 'Status do grupo apagado', 'confirma o apagamento');

  const revogacao = sent.find((s) => s.content?.groupStatus === true && s.content?.delete);
  ok(Boolean(revogacao), 'mandou revogação no formato de status');
  ok(revogacao?.content?.delete?.id === 'STATUS-RECENTE', `apagou o status certo (${revogacao?.content?.delete?.id})`);
  ok(revogacao?.content?.delete?.fromMe === true, 'fromMe: true');
  ok(revogacao?.jid === groupJid, 'destino é o grupo');
  ok(!gs.isPublishedGroupStatus(groupJid, 'STATUS-RECENTE'), 'saiu do registro');
});

await test('!d citando o status: usa o ID do status citado', async () => {
  gs.clearPublishedGroupStatuses();
  const groupJid = makeGroup();
  gs.rememberPublishedGroupStatus(groupJid, 'STATUS-ANTIGO');
  gs.rememberPublishedGroupStatus(groupJid, 'STATUS-NOVO');

  // O ID citado é um status publicado -> revoga ESSE, não o último.
  const { sent, texto } = await rodar({
    groupJid,
    text: '!d',
    quoted: { groupStatusMessageV2: { message: { imageMessage: { contextInfo: { isGroupStatus: true } } } } },
    id: 'CMD-1',
  });
  includes(texto, 'Status do grupo apagado', 'confirma');

  const revogacao = sent.find((s) => s.content?.groupStatus === true && s.content?.delete);
  ok(Boolean(revogacao), 'mandou revogação de status');
  // O stanzaId chega no contextInfo do teste; o comando usa ele.
  ok(revogacao?.content?.delete?.id === 'MSG-ALVO', `usou o ID citado (${revogacao?.content?.delete?.id})`);
  ok(!gs.isPublishedGroupStatus(groupJid, 'MSG-ALVO') === true, 'não estava no registro, segue não estando');
});

await test('!d citando status: a revogação vai no formato de status (não some como comum)', async () => {
  gs.clearPublishedGroupStatuses();
  const groupJid = makeGroup();

  const { sent } = await rodar({
    groupJid,
    text: '!d',
    quoted: { groupStatusMessageV2: { message: { extendedTextMessage: { contextInfo: { isGroupStatus: true } } } } },
    id: 'CMD-2',
  });

  const comStatus = sent.filter((s) => s.content?.groupStatus === true);
  ok(comStatus.length >= 1, 'pelo menos uma tentativa encapsulada como status');
  // Todas as tentativas têm delete com a key.
  for (const s of comStatus) {
    ok(Boolean(s.content.delete?.id), 'a revogação de status carrega o id');
  }
});

await test('!d: a mensagem do comando também é apagada ao apagar status', async () => {
  gs.clearPublishedGroupStatuses();
  const groupJid = makeGroup();
  gs.rememberPublishedGroupStatus(groupJid, 'STATUS-Z');

  const { sent } = await rodar({ groupJid, text: '!d', quoted: null, id: 'CMD-STATUS' });
  const apagaComando = sent.find((s) => s.content?.delete?.id === 'CMD-STATUS');
  ok(Boolean(apagaComando), 'apagou a própria mensagem do comando');
});

await test('!d de membro comum: barrado antes de qualquer apagamento', async () => {
  gs.clearPublishedGroupStatuses();
  const groupJid = makeGroup();
  gs.rememberPublishedGroupStatus(groupJid, 'STATUS-SEGURO');

  const { sent, texto } = await rodar({ groupJid, text: '!d', quoted: null, admin: false });
  includes(texto, 'Comando restrito', 'explica a restrição');
  const revogacao = sent.find((s) => s.content?.delete);
  ok(!revogacao, 'não apagou nada');
  ok(gs.isPublishedGroupStatus(groupJid, 'STATUS-SEGURO'), 'o status segue no registro');
});

// ============================================================================
// 3) `!d` — REGRESSÃO: O QUE JÁ APAGAVA CONTINUA APAGANDO
// ============================================================================

await test('!d citando mensagem comum de terceiro: apaga como antes', async () => {
  gs.clearPublishedGroupStatuses();
  const groupJid = makeGroup();

  const { sent, texto } = await rodar({
    groupJid,
    text: '!d',
    quoted: { conversation: 'mensagem de alguem' },
    autor: '5511777777777@s.whatsapp.net',
    id: 'CMD-COMUM',
  });

  const apagaTerceiro = sent.find((s) => s.content?.delete?.id === 'MSG-ALVO');
  ok(Boolean(apagaTerceiro), 'mandou apagar a mensagem marcada');
  ok(apagaTerceiro?.content?.delete?.fromMe === false, 'fromMe: false (mensagem de terceiro)');
  ok(
    apagaTerceiro?.content?.delete?.participant === '5511777777777@s.whatsapp.net',
    `apaga o autor certo (${apagaTerceiro?.content?.delete?.participant})`
  );
  // O apagamento da mensagem do comando sai num setTimeout de 500ms.
  await new Promise((r) => setTimeout(r, 700));
  const apagaCmd = sent.find((s) => s.content?.delete?.id === 'CMD-COMUM');
  ok(Boolean(apagaCmd), 'apaga a mensagem do comando');
  ok(!texto.includes('Status do grupo'), 'não confundiu com status');
});

await test('!d em mensagem de pagamento: mantém o fluxo especial (edita e apaga)', async () => {
  gs.clearPublishedGroupStatuses();
  const groupJid = makeGroup();

  const { sent, texto } = await rodar({
    groupJid,
    text: '!d',
    quoted: { requestPaymentMessage: { currencyCodeIso4217: 'BRL', amount1000: '0' } },
    id: 'CMD-PAY',
  });

  includes(texto, 'pagamento deletada', 'confirma o fluxo de pagamento');
  // Passo 1: cria mensagem vazia; Passo 2: edita.
  const criada = sent.find((s) => s.content?.text === '');
  ok(Boolean(criada), 'criou a mensagem vazia para gerar ID');
  const editada = sent.find((s) => s.content?.edit);
  ok(Boolean(editada), 'mandou a edição');
  includes(editada?.content?.text || '', 'pagamento removida', 'texto da edição');
  // Passo 3: apaga o payment original.
  const apagaPay = sent.find((s) => s.content?.delete?.id === 'MSG-ALVO');
  ok(Boolean(apagaPay), 'apagou o payment original');
  ok(apagaPay?.content?.delete?.participant === '5511888888888@s.whatsapp.net', 'com o participant do autor citado');
});

await test('!d sem alvo e SEM status no registro: não apaga nada e avisa', async () => {
  gs.clearPublishedGroupStatuses();
  const groupJid = makeGroup();

  const { sent, texto } = await rodar({ groupJid, text: '!d', quoted: null });
  includes(texto, 'Marque a mensagem', 'pede o alvo');
  const apagou = sent.find((s) => s.content?.delete);
  ok(!apagou, 'não apagou nada');
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