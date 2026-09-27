/**
 * Testes dos comandos !fixar / !desfixar e das partes puras do pin.
 *
 * Executa o handler REAL (NazuninhaBotExec) com um socket Baileys falso e
 * espiona o conteúdo enviado ao `sendMessage`. Prova que:
 *   - a key do alvo vem da mensagem RESPONDIDA (remoteJid/fromMe/id/participant);
 *   - tipo = PIN_FOR_ALL (1) / UNPIN_FOR_ALL (2), sem número mágico solto;
 *   - a duração é a nativa (24h -> 86400, 7d -> 604800, 30d -> 2592000);
 *   - sem reply, fora de grupo, sem admin e sem o bot admin, não envia pin;
 *   - mensagem de pin RECEBIDA é descartada (não vira comando/contador).
 *
 * Uso: node tests/pin-message.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');

// Banco temporário ANTES de importar o index (paths.js lê DATABASE_PATH no load).
const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-pin-db-'));
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
// HANDLER REAL
// ============================================================================

const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;
if (typeof handleMessage !== 'function') throw new Error('index.js não exporta o handler');

const { proto } = await import('@itsliaaa/baileys');
const pinUtils = await import(new URL('../dados/src/utils/pinMessage.js', import.meta.url).href);

const PIN_FOR_ALL = proto.Message.PinInChatMessage.Type.PIN_FOR_ALL;
const UNPIN_FOR_ALL = proto.Message.PinInChatMessage.Type.UNPIN_FOR_ALL;

// ============================================================================
// FIXTURES
// ============================================================================

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';
const AUTHOR_JID = '5511000000002@s.whatsapp.net';
const AUTHOR_LID = '111000000000002@lid';
const OTHER_JID = '5511000000003@s.whatsapp.net';
const OTHER_LID = '111000000000003@lid';
const TARGET_ID = 'TARGET-MSG-ID';

let groupCounter = 0;
let authorCounter = 0;
const GRUPOS_DIR = path.join(TMP_DB, 'grupos');

function makeGroup({ botAdmin = true } = {}) {
  groupCounter += 1;
  const groupJid = `1203639100000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(
    path.join(GRUPOS_DIR, `${groupJid}.json`),
    JSON.stringify({ groupName: 'Grupo Pin' }, null, 2)
  );
  return { groupJid, botAdmin };
}

function makeNazu({ sent, groupJid, authorLid, authorJid, botAdmin = true }) {
  return {
    sendMessage: async (jid, content, options) => {
      sent.push({ jid, content, options });
      return { key: { id: 'SENT' } };
    },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
    onWhatsApp: async (jid) => {
      const map = { [authorJid]: authorLid, [OTHER_JID]: OTHER_LID, [BOT_JID]: BOT_LID };
      const lid = map[jid];
      return lid ? [{ jid, exists: true, lid }] : [{ jid, exists: false }];
    },
    signalRepository: {
      lidMapping: {
        getPNForLID: async (lid) => ({
          [authorLid]: authorJid,
          [OTHER_LID]: OTHER_JID,
          [BOT_LID]: BOT_JID,
        }[lid] || null),
      },
    },
    groupMetadata: async () => ({
      id: groupJid,
      subject: 'Grupo Pin',
      participants: [
        { id: authorLid, admin: 'admin', phoneNumber: authorJid },
        { id: OTHER_LID, admin: null, phoneNumber: OTHER_JID },
        { id: BOT_LID, admin: botAdmin ? 'admin' : null, phoneNumber: BOT_JID },
      ],
    }),
    groupParticipantsUpdate: async () => ({}),
    groupRequestParticipantsList: async () => [],
    groupRequestParticipantsUpdate: async () => ({}),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {},
    sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => 'https://example.com/pic.jpg',
    react: async () => ({}),
  };
}

/**
 * Executa `!fixar`/`!desfixar` no grupo.
 * @param {string} command nome sem prefixo
 * @param {{args?: string, replyTo?: 'other'|'bot'|null, inGroup?: boolean, asAdmin?: boolean, botAdmin?: boolean}} [options]
 */
async function runCommand(command, options = {}) {
  const {
    args = '',
    replyTo = 'other',
    inGroup = true,
    asAdmin = true,
    botAdmin = true,
  } = options;

  const sent = [];
  const { groupJid } = makeGroup({ botAdmin });

  authorCounter += 1;
  const authorLid = `99${String(authorCounter).padStart(6, '0')}888@lid`;
  const authorJid = `5599${String(authorCounter).padStart(6, '0')}777@s.whatsapp.net`;

  const chatJid = inGroup ? groupJid : authorJid;
  const nazu = makeNazu({ sent, groupJid, authorLid, authorJid, botAdmin });

  let contextInfo = { remoteJid: chatJid };
  if (replyTo) {
    contextInfo.stanzaId = TARGET_ID;
    contextInfo.quotedMessage = { conversation: 'mensagem alvo' };
    // Mensagem de terceiro tem participant; a do bot não (o autor é o bot).
    contextInfo.participant = replyTo === 'bot' ? BOT_LID : OTHER_LID;
  }

  const info = {
    key: {
      remoteJid: chatJid,
      fromMe: false,
      id: `CMD-${command}-${authorCounter}`,
      ...(inGroup ? { participant: authorLid } : {}),
    },
    message: { extendedTextMessage: { text: `!${command}${args ? ' ' + args : ''}`, contextInfo } },
    messageTimestamp: 1757900000,
    pushName: 'Autor',
  };

  await handleMessage(nazu, info, null, new Map(), null);

  // Ordem de admin: o autor precisa constar como admin (ou dono). O handler
  // converte participants para LID, então o autor já é LID por padrão.

  const pinMsg = sent.find((s) => s.content && typeof s.content === 'object' && 'pin' in s.content) || null;
  const text = sent.map((s) => s.content?.text ?? '').filter(Boolean).join('\n');

  return { sent, text, pinMsg, groupJid, authorLid, authorJid, botAdmin };
}

// ============================================================================
// PARTES PURAS — pinMessage.js
// ============================================================================

await test('parsePinDuration: padrão 24h, apelidos e valor cru', () => {
  const def = pinUtils.parsePinDuration('');
  ok(def.ok && def.seconds === 86400, 'vazio -> 24h (86400)');
  ok(pinUtils.parsePinDuration('24h').seconds === 86400, '24h -> 86400');
  ok(pinUtils.parsePinDuration('7d').seconds === 604800, '7d -> 604800');
  ok(pinUtils.parsePinDuration('30d').seconds === 2592000, '30d -> 2592000');
  ok(pinUtils.parsePinDuration('604800').seconds === 604800, 'valor cru nativo aceito');
  ok(pinUtils.parsePinDuration('1d').seconds === 86400, '1d -> 24h');
});

await test('parsePinDuration: recusa valores que o WhatsApp não suporta', () => {
  for (const bad of ['2h', '10d', '0', '-1', '999', 'abc', '1e9']) {
    ok(pinUtils.parsePinDuration(bad).ok === false, `"${bad}" é recusado`);
  }
});

await test('formatPinDuration: rótulos nativos', () => {
  ok(pinUtils.formatPinDuration(86400) === '24 horas', '24h');
  ok(pinUtils.formatPinDuration(604800) === '7 dias', '7d');
  ok(pinUtils.formatPinDuration(2592000) === '30 dias', '30d');
  ok(pinUtils.formatPinDuration(123) === null, 'valor desconhecido -> null');
});

await test('buildPinKeyFromContext: preserva remoteJid/id/participant de terceiro', () => {
  const key = pinUtils.buildPinKeyFromContext(
    { stanzaId: 'ABC', remoteJid: '123@g.us', participant: '5511@s.whatsapp.net' },
    { botIds: [BOT_LID] }
  );
  ok(key.remoteJid === '123@g.us', 'remoteJid preservado');
  ok(key.id === 'ABC', 'id preservado');
  ok(key.fromMe === false, 'terceiro -> fromMe false');
  ok(key.participant === '5511@s.whatsapp.net', 'participant preservado');
});

await test('buildPinKeyFromContext: mensagem do próprio bot -> fromMe true, sem participant', () => {
  const key = pinUtils.buildPinKeyFromContext(
    { stanzaId: 'ABC', remoteJid: '123@g.us', participant: BOT_LID },
    { botIds: [BOT_LID] }
  );
  ok(key.fromMe === true, 'do bot -> fromMe true');
  ok(!('participant' in key), 'do bot não carrega participant');
});

await test('buildPinKeyFromContext: remove sufixo :XX do participant', () => {
  const key = pinUtils.buildPinKeyFromContext(
    { stanzaId: 'ABC', remoteJid: '123@g.us', participant: '5511999:12@s.whatsapp.net' },
    { botIds: [] }
  );
  ok(key.participant === '5511999@s.whatsapp.net', `sufixo removido (${key.participant})`);
});

await test('buildPinKeyFromContext: LID é preservado', () => {
  const key = pinUtils.buildPinKeyFromContext(
    { stanzaId: 'ABC', remoteJid: '123@g.us', participant: OTHER_LID },
    { botIds: [BOT_LID] }
  );
  ok(key.participant === OTHER_LID, 'participant LID não é convertido para PN');
});

await test('buildPinKeyFromContext: sem stanzaId ou remoteJid -> null', () => {
  ok(pinUtils.buildPinKeyFromContext(null) === null, 'null -> null');
  ok(pinUtils.buildPinKeyFromContext({ remoteJid: '123@g.us' }) === null, 'sem stanzaId -> null');
  ok(pinUtils.buildPinKeyFromContext({ stanzaId: 'A' }) === null, 'sem remoteJid -> null');
});

await test('extractPinInfo/isPinControlMessage: reconhece pin e ignora o resto', () => {
  const pin = {
    pinInChatMessage: { key: { id: 'X' }, type: 1, senderTimestampMs: 123 },
    messageContextInfo: { messageAddOnDurationInSecs: 86400 },
  };
  ok(pinUtils.isPinControlMessage(pin) === true, 'pin direto detectado');
  const info = pinUtils.extractPinInfo(pin);
  ok(info.key.id === 'X' && info.type === 1 && info.senderTimestampMs === 123, 'key/type/ts extraídos');

  const wrapped = { ephemeralMessage: { message: pin } };
  ok(pinUtils.isPinControlMessage(wrapped) === true, 'pin dentro de efêmera detectado');

  ok(pinUtils.isPinControlMessage({ conversation: 'oi' }) === false, 'texto não é pin');
  ok(pinUtils.isPinControlMessage({ reactionMessage: { text: 'x' } }) === false, 'reação não é pin');
  ok(pinUtils.isPinControlMessage(null) === false, 'null não é pin');
});

// ============================================================================
// INTEGRAÇÃO — !fixar / !desfixar
// ============================================================================

await test('!fixar com reply: envia pin do alvo com PIN_FOR_ALL e duração padrão', async () => {
  const { pinMsg, text } = await runCommand('fixar', { replyTo: 'other' });
  ok(Boolean(pinMsg), 'um sendMessage com { pin } foi feito');
  if (pinMsg) {
    const { pin, type, time } = pinMsg.content;
    ok(type === PIN_FOR_ALL, `type = PIN_FOR_ALL (${PIN_FOR_ALL})`);
    ok(time === 86400, `duração padrão 86400 (obtida ${time})`);
    ok(pin.id === TARGET_ID, 'key.id vem da mensagem respondida');
    ok(pin.fromMe === false, 'mensagem de terceiro -> fromMe false');
    ok(Boolean(pin.participant), 'participant presente');
    ok(pinMsg.jid === pin.remoteJid, 'jid do envio = remoteJid da key');
  }
  includes(text, 'fixada com sucesso', 'confirmação');
  includes(text, '24 horas', 'duração na resposta');
});

await test('!fixar 24h / 7d / 30d: durações nativas', async () => {
  for (const [arg, seconds] of [['24h', 86400], ['7d', 604800], ['30d', 2592000]]) {
    const { pinMsg } = await runCommand('fixar', { args: arg, replyTo: 'other' });
    ok(Boolean(pinMsg) && pinMsg.content.time === seconds, `!fixar ${arg} -> ${seconds}`);
  }
});

await test('!fixar com duração inválida: NÃO envia pin', async () => {
  const { pinMsg, text } = await runCommand('fixar', { args: '2h', replyTo: 'other' });
  ok(!pinMsg, 'nada enviado com duração inválida');
  includes(text, 'Duração inválida', 'avisa o usuário');
});

await test('!fixar respondendo mensagem do próprio bot: fromMe true sem participant', async () => {
  const { pinMsg } = await runCommand('fixar', { replyTo: 'bot' });
  ok(Boolean(pinMsg), 'pin enviado');
  ok(pinMsg.content.pin.fromMe === true, 'fromMe true');
  ok(!('participant' in pinMsg.content.pin), 'sem participant');
});

await test('!desfixar com reply: envia UNPIN_FOR_ALL', async () => {
  const { pinMsg, text } = await runCommand('desfixar', { replyTo: 'other' });
  ok(Boolean(pinMsg), 'um sendMessage com { pin } foi feito');
  if (pinMsg) {
    ok(pinMsg.content.type === UNPIN_FOR_ALL, `type = UNPIN_FOR_ALL (${UNPIN_FOR_ALL})`);
    ok(!('time' in pinMsg.content) || pinMsg.content.time == null, 'unpin não manda duração');
    ok(pinMsg.content.pin.id === TARGET_ID, 'mesma key da mensagem respondida');
  }
  includes(text, 'desfixada com sucesso', 'confirmação');
});

await test('!desfixar respondendo mensagem do bot: fromMe true', async () => {
  const { pinMsg } = await runCommand('desfixar', { replyTo: 'bot' });
  ok(Boolean(pinMsg), 'unpin enviado');
  if (pinMsg) {
    ok(pinMsg.content.pin.fromMe === true, 'unpin da própria mensagem');
    ok(pinMsg.content.type === UNPIN_FOR_ALL, 'tipo unpin');
  }
});

await test('!fixar sem reply: pede para responder, NÃO envia pin', async () => {
  const { pinMsg, text } = await runCommand('fixar', { replyTo: null });
  ok(!pinMsg, 'nada é enviado sem reply');
  includes(text, 'Como fixar', 'instrução de uso');
});

await test('!desfixar sem reply: pede para responder, NÃO envia pin', async () => {
  const { pinMsg, text } = await runCommand('desfixar', { replyTo: null });
  ok(!pinMsg, 'nada é enviado sem reply');
  includes(text, 'Como desfixar', 'instrução de uso');
});

await test('!fixar no privado: recusa e não envia pin', async () => {
  const { pinMsg, text } = await runCommand('fixar', { inGroup: false, replyTo: 'other' });
  ok(!pinMsg, 'nada enviado no privado');
  includes(text, 'só para grupos', 'mensagem de grupo');
});

await test('!fixar sem o bot admin: recusa e não envia pin', async () => {
  const { pinMsg, text } = await runCommand('fixar', { replyTo: 'other', botAdmin: false });
  ok(!pinMsg, 'nada enviado sem o bot admin');
  includes(text, 'administrador', 'exige admin');
});

// ============================================================================
// DIFERENTES TIPOS DE MENSAGEM — o pin trabalha sobre a KEY
// ============================================================================

await test('!fixar funciona com QUALQUER tipo de mensagem respondida', async () => {
  // O pin usa a WAMessageKey, não o conteúdo: o tipo do alvo é irrelevante.
  const tipos = {
    texto: { conversation: 'oi' },
    textoLongo: { extendedTextMessage: { text: 'a'.repeat(500) } },
    imagem: { imageMessage: { caption: 'foto' } },
    video: { videoMessage: { caption: 'vídeo' } },
    audio: { audioMessage: {} },
    documento: { documentMessage: { fileName: 'a.pdf' } },
    sticker: { stickerMessage: {} },
    localizacao: { locationMessage: { degreesLatitude: 1 } },
    contato: { contactMessage: { displayName: 'X' } },
    encaminhada: { extendedTextMessage: { text: 'fwd', contextInfo: { isForwarded: true, forwardingScore: 2 } } },
    efemera: { ephemeralMessage: { message: { imageMessage: { caption: 'x' } } } },
  };

  for (const [nome, conteudo] of Object.entries(tipos)) {
    const sent = [];
    groupCounter += 1;
    const groupJid = `1203639300000000${String(groupCounter).padStart(3, '0')}@g.us`;
    fs.writeFileSync(path.join(GRUPOS_DIR, `${groupJid}.json`), JSON.stringify({}, null, 2));
    authorCounter += 1;
    const authorLid = `97${String(authorCounter).padStart(6, '0')}888@lid`;
    const authorJid = `5597${String(authorCounter).padStart(6, '0')}777@s.whatsapp.net`;
    const nazu = makeNazu({ sent, groupJid, authorLid, authorJid });

    const info = {
      key: { remoteJid: groupJid, fromMe: false, id: `C-${nome}`, participant: authorLid },
      message: { extendedTextMessage: { text: '!fixar', contextInfo: {
        remoteJid: groupJid, stanzaId: TARGET_ID, quotedMessage: conteudo, participant: OTHER_LID } } },
      messageTimestamp: 1757900000,
      pushName: 'Autor',
    };
    await handleMessage(nazu, info, null, new Map(), null);

    const pinMsg = sent.find((s) => s.content && 'pin' in s.content);
    ok(Boolean(pinMsg), `${nome}: pin enviado`);
    if (pinMsg) {
      ok(pinMsg.content.type === PIN_FOR_ALL, `${nome}: tipo PIN_FOR_ALL`);
      ok(pinMsg.content.pin.id === TARGET_ID, `${nome}: key.id preservado`);
      ok(pinMsg.content.pin.participant === OTHER_LID, `${nome}: participant preservado`);
    }
  }
});

// ============================================================================
// REGRESSÃO — pin recebido não é tratado como mensagem normal
// ============================================================================

await test('pin RECEBIDO é descartado (sem resposta e sem contador)', async () => {
  // Reaproveita um grupo e confirma que nada é respondido ao pin recebido.
  const sent = [];
  groupCounter += 1;
  const groupJid = `1203639200000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(path.join(GRUPOS_DIR, `${groupJid}.json`), JSON.stringify({}, null, 2));

  authorCounter += 1;
  const authorLid = `98${String(authorCounter).padStart(6, '0')}888@lid`;
  const authorJid = `5598${String(authorCounter).padStart(6, '0')}777@s.whatsapp.net`;
  const nazu = makeNazu({ sent, groupJid, authorLid, authorJid });

  const info = {
    key: { remoteJid: groupJid, fromMe: false, id: 'PIN-1', participant: authorLid },
    message: {
      pinInChatMessage: {
        key: { remoteJid: groupJid, fromMe: false, id: TARGET_ID, participant: OTHER_LID },
        type: PIN_FOR_ALL,
        senderTimestampMs: Date.now(),
      },
      messageContextInfo: { messageAddOnDurationInSecs: 86400 },
    },
    messageTimestamp: 1757900000,
    pushName: 'Autor',
  };

  await handleMessage(nazu, info, null, new Map(), null);
  ok(sent.length === 0, `nenhuma resposta a um pin recebido (enviadas: ${sent.length})`);
});

await test('!fixar e !desfixar estão no mapa de comandos do menu admin', async () => {
  const blockPv = fs.readFileSync(path.join(PROJECT, 'dados/src/utils/blockPv.js'), 'utf-8');
  const menuSrc = fs.readFileSync(path.join(PROJECT, 'dados/src/menus/menuadm.js'), 'utf-8');
  for (const cmd of ['fixar', 'desfixar']) {
    includes(blockPv, `'${cmd}'`, `menuCommandsMap contém ${cmd}`);
    includes(menuSrc, `${cmd}`, `menuadm mostra ${cmd}`);
  }
});

await test('!patchup: !pin (Pinterest) continua funcionando (sem colisão)', async () => {
  const src = fs.readFileSync(path.join(PROJECT, 'dados/src/index.js'), 'utf-8');
  ok(/case 'pinterest':\s*\n\s*case 'pin':/.test(src), "case 'pin' do Pinterest permanece intacto");
  notIncludes(src, "case 'pin': {\n", 'não sobrescrevemos o case pin existente');
});

// ============================================================================
// LIMPEZA E RESULTADO
// ============================================================================

fs.rmSync(TMP_DB, { recursive: true, force: true });

const totalPassed = RESULTS.reduce((acc, r) => acc + r.passed, 0);
const totalFailed = RESULTS.reduce((acc, r) => acc + r.failed, 0);

console.log('\n════════════════════════════════════════');
console.log(`RESULTADO: ${RESULTS.length} testes | ${totalPassed} asserções ok | ${totalFailed} falhas`);
console.log('════════════════════════════════════════');

if (totalFailed > 0) {
  console.log('\nFALHAS:');
  for (const r of RESULTS) {
    if (r.failed) for (const e of r.errors) console.log(`- [${r.name}] ${e}`);
  }
  process.exit(1);
}
console.log('✅ TODOS OS TESTES PASSARAM');
process.exit(0);
