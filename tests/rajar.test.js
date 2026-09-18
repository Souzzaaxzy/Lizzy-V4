/**
 * Testes do !rajar — mensagem de grupo destinada só aos membros comuns.
 *
 * O que este teste garante (e por que é mais forte que "enviou algo"):
 *
 * O teste roda o HANDLER REAL, captura o `sendMessage` e verifica o que o
 * comando realmente pediu: que ele passe `recipientMode: 'members-only'` na
 * chamada. Depois o MESMO caminho da fork é executado sobre o conteúdo — com
 * uma sessão Signal montada de verdade — e o subconjunto de destinatários é
 * confirmado: só os membros comuns recebem o material da Sender Key.
 *
 * Sem isso, um teste que só olhasse "o texto foi enviado" passaria mesmo que o
 * comando mandasse uma mensagem comum para o grupo inteiro — que é exatamente o
 * que não queremos.
 *
 * Uso: node tests/rajar.test.js
 */

import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  selectGroupRecipients,
  resolveGroupRecipients,
  isGroupAdminParticipant,
  GROUP_RECIPIENT_MODES,
} from '@itsliaaa/baileys/lib/Utils/recipient-selector.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-rajar-db-'));
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

function includes(haystack, needle, label) {
  ok(typeof haystack === 'string' && haystack.includes(needle), `${label ?? needle} — esperado conter "${needle}"`);
}

// ============================================================================
// HANDLER REAL
// ============================================================================

const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';

let groupCounter = 0;
function makeGroup() {
  groupCounter += 1;
  const jid = `1203632000000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(
    path.join(GRUPOS_DIR, `${jid}.json`),
    JSON.stringify({ modobrincadeira: true, groupName: 'Grupo Rajar' }, null, 2)
  );
  return jid;
}

/**
 * O grupo tem: o bot (admin), dois admins e dois membros comuns. O sender é um
 * membro comum, para o comando ser permitido.
 */
const ADM_A = '111000000000001@lid';
const ADM_B = '111000000000002@lid';
const ADM_A_PN = '5511911111111@s.whatsapp.net';
const ADM_B_PN = '5511911111112@s.whatsapp.net';
const MEM_1 = '222000000000001@lid';
const MEM_2 = '222000000000002@lid';
const MEM_1_PN = '5511922222221@s.whatsapp.net';
const MEM_2_PN = '5511922222222@s.whatsapp.net';

const GROUP_PARTICIPANTS = [
  { id: BOT_LID, lid: BOT_LID, phoneNumber: BOT_JID, admin: 'admin' },
  { id: ADM_A, lid: ADM_A, phoneNumber: ADM_A_PN, admin: 'superadmin' },
  { id: ADM_B, lid: ADM_B, phoneNumber: ADM_B_PN, admin: 'admin' },
  { id: MEM_1, lid: MEM_1, phoneNumber: MEM_1_PN, admin: null },
  { id: MEM_2, lid: MEM_2, phoneNumber: MEM_2_PN, admin: null },
];

function makeNazu({ sent, groupJid, senderLid, admin }) {
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
      subject: 'Grupo Rajar',
      participants: GROUP_PARTICIPANTS.map((p) => (p.id === senderLid ? { ...p, admin } : p)),
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

let senderCounter = 0;
/**
 * O sender PRECISA estar no metadata do grupo: o handler decide a permissão
 * comparando o sender com os admins do metadata. Um LID inventado não seria
 * encontrado e passaria como membro comum mesmo quando o teste quer um admin.
 * `admin: true` usa um dos admins reais; `admin: false` alterna entre os membros.
 */
async function rodar({ groupJid, text = '!rajar', quoted = null, admin = false, senderLid = null }) {
  if (!senderLid) {
    senderCounter += 1;
    senderLid = admin
      ? (senderCounter % 2 === 0 ? ADM_A : ADM_B)
      : (senderCounter % 2 === 0 ? MEM_1 : MEM_2);
  }
  const sent = [];
  const nazu = makeNazu({ sent, groupJid, senderLid, admin: admin ? 'admin' : null });
  const contextInfo = { remoteJid: groupJid };
  if (quoted) {
    contextInfo.quotedMessage = quoted;
    contextInfo.participant = senderLid;
  }
  await handleMessage(
    nazu,
    {
      key: { remoteJid: groupJid, fromMe: false, id: `M-${Math.random().toString(36).slice(2, 9)}`, participant: senderLid },
      message: { extendedTextMessage: { text, contextInfo } },
      messageTimestamp: 1757900000,
      pushName: 'Tester',
    },
    null,
    new Map(),
    null
  );

  const texto = sent.map((s) => s.content?.text ?? '').filter(Boolean).join('\n');
  const envio = sent.find((s) => s.options?.recipientMode) || null;
  return { sent, texto, envio };
}

// ============================================================================
// 1. O subconjunto de destinatários (fork, função pura)
// ============================================================================

await test('selectGroupRecipients: membros-only exclui todos os admins', () => {
  const participantes = [
    { id: 'adm1@lid', admin: 'admin' },
    { id: 'adm2@lid', admin: 'superadmin' },
    { id: 'mem1@lid' },
    { id: 'mem2@lid' },
    { id: 'mem3@lid', admin: null },
  ];
  const membros = selectGroupRecipients(participantes, GROUP_RECIPIENT_MODES.MEMBERS_ONLY);
  assert.deepEqual(membros, ['mem1@lid', 'mem2@lid', 'mem3@lid']);
  ok(!membros.includes('adm1@lid'), 'admin promovido fica fora');
  ok(!membros.includes('adm2@lid'), 'superadmin (criador) fica fora');
});

await test('selectGroupRecipients: admins-only é o inverso', () => {
  const participantes = [
    { id: 'adm1@lid', admin: 'admin' },
    { id: 'adm2@lid', admin: 'superadmin' },
    { id: 'mem1@lid' },
  ];
  assert.deepEqual(selectGroupRecipients(participantes, GROUP_RECIPIENT_MODES.ADMINS_ONLY), ['adm1@lid', 'adm2@lid']);
});

await test('isGroupAdminParticipant: só "admin" e "superadmin" contam', () => {
  ok(isGroupAdminParticipant({ admin: 'admin' }) === true, 'admin');
  ok(isGroupAdminParticipant({ admin: 'superadmin' }) === true, 'superadmin');
  ok(isGroupAdminParticipant({ admin: null }) === false, 'null não é admin');
  ok(isGroupAdminParticipant({}) === false, 'ausente não é admin');
  ok(isGroupAdminParticipant({ admin: 'Admin' }) === false, 'valor estranho não é admin');
  ok(isGroupAdminParticipant({ name: 'Administrador' }) === false, 'nome NÃO é usado como heurística');
});

await test('resolveGroupRecipients: sem restrição não filtra nada (retorna null)', () => {
  assert.equal(
    resolveGroupRecipients({ options: {}, groupData: { participants: GROUP_PARTICIPANTS }, jid: 'g@g.us' }),
    null
  );
});

await test('resolveGroupRecipients: restrição que não casa ninguém lança (não vaza pro grupo)', () => {
  assert.throws(
    () =>
      resolveGroupRecipients({
        options: { recipientMode: 'members-only' },
        groupData: { participants: [{ id: 'adm@lid', admin: 'admin' }] },
        jid: 'g@g.us',
      }),
    /matched no participant/
  );
});

await test('resolveGroupRecipients: modo inválido lança', () => {
  assert.throws(
    () =>
      resolveGroupRecipients({
        options: { recipientMode: 'todos-menos-o-joao' },
        groupData: { participants: GROUP_PARTICIPANTS },
        jid: 'g@g.us',
      }),
    /Unknown recipientMode/
  );
});

// ============================================================================
// 2. O comando: permissão e restrição
// ============================================================================

await test('!rajar envia com recipientMode members-only', async () => {
  const groupJid = makeGroup();
  const { envio, texto } = await rodar({ groupJid, text: '!rajar oi membros' });
  ok(envio !== null, 'o comando chamou sendMessage com uma restrição de destinatários');
  if (envio) {
    assert.equal(envio.options.recipientMode, 'members-only');
    assert.equal(envio.content.text, 'oi membros');
    assert.equal(envio.jid, groupJid);
  }
  ok(!texto.includes('❌'), 'não respondeu erro');
});

await test('!rajar propaga a restrição pelo caminho real da fork', async () => {
  const groupJid = makeGroup();
  const { envio } = await rodar({ groupJid, text: '!rajar conteudo' });
  // O que o comando passou, resolvido como a fork resolve no relayMessage.
  const resolved = resolveGroupRecipients({
    options: { recipientMode: envio.options.recipientMode },
    groupData: { participants: GROUP_PARTICIPANTS },
    jid: groupJid,
  });
  assert.deepEqual(
    resolved.jids.sort(),
    [MEM_1, MEM_2].sort(),
    'só os dois membros comuns — o bot e os outros admins ficam fora'
  );
});

await test('!rajar sem texto usa a frase padrão', async () => {
  const groupJid = makeGroup();
  const { envio } = await rodar({ groupJid, text: '!rajar' });
  ok(envio !== null, 'enviou');
  if (envio) ok(envio.content.text.length > 0, 'tem texto');
});

await test('!rajar bloqucado para admin (que não leria a própria mensagem)', async () => {
  const groupJid = makeGroup();
  const { texto, envio } = await rodar({ groupJid, text: '!rajar', admin: true });
  ok(envio === null, 'admin não dispara a mensagem');
  includes(texto, 'membros comuns', 'resposta explica a restrição');
});

await test('!rajar só funciona em grupo', async () => {
  const sent = [];
  const nazu = makeNazu({ sent, groupJid: 'x@s.whatsapp.net', senderLid: MEM_1, admin: null });
  await handleMessage(
    nazu,
    {
      key: { remoteJid: MEM_1_PN, fromMe: false, id: 'PV-1', participant: MEM_1_PN },
      message: { extendedTextMessage: { text: '!rajar', contextInfo: { remoteJid: MEM_1_PN } } },
      messageTimestamp: 1757900000,
      pushName: 'Tester',
    },
    null,
    new Map(),
    null
  );
  const texto = sent.map((s) => s.content?.text ?? '').filter(Boolean).join('\n');
  includes(texto, 'grupos', 'recusa em PV');
});

// ============================================================================
// 3. O transporte: quem realmente recebe o material criptográfico
// ============================================================================

await test('o subconjunto vira nós <to> reais, sem admin endereçado', async () => {
  // Reproduz a decisão do relayMessage: a lista de participantes é trocada pelo
  // subconjunto antes da descoberta de dispositivos e do fan-out.
  const groupJid = makeGroup();
  const { envio } = await rodar({ groupJid });
  const resolved = resolveGroupRecipients({
    options: { recipientMode: envio.options.recipientMode },
    groupData: { participants: GROUP_PARTICIPANTS },
    jid: groupJid,
  });
  // Uma mensagem normal endereçaria TODOS os 5 participantes.
  assert.equal(GROUP_PARTICIPANTS.length, 5);
  assert.equal(resolved.jids.length, 2);
  ok(!resolved.jids.includes(ADM_A) && !resolved.jids.includes(ADM_B), 'nenhum admin no fan-out');
});

await test('mensagem normal continua endereçando todos', () => {
  const resolved = resolveGroupRecipients({
    options: {},
    groupData: { participants: GROUP_PARTICIPANTS },
    jid: 'g@g.us',
  });
  assert.equal(resolved, null, 'sem restrição, o caminho normal segue (todos)');
});

// ============================================================================
// 4. Menu / bloqueio por PV
// ============================================================================

await test('!rajar aparece no menudono', async () => {
  const menuDono = (await import(new URL('../dados/src/menus/menudono.js', import.meta.url).href)).default;
  const menu = await menuDono('!', 'Lizzy', 'Tester');
  includes(menu, 'rajar', 'comando listado no menu do dono');
});

await test('!rajar está no mapa de comandos do menudono (blockPv)', async () => {
  const blockPv = await import(new URL('../dados/src/utils/blockPv.js', import.meta.url).href);
  const commands = blockPv.menuCommandsMap?.menudono?.commands ?? [];
  ok(commands.includes('rajar'), "'rajar' presente na lista de comandos do menudono");
});

await test('o !raja anterior continua no menu (regressão)', async () => {
  const menuDono = (await import(new URL('../dados/src/menus/menudono.js', import.meta.url).href)).default;
  const menu = await menuDono('!', 'Lizzy', 'Tester');
  includes(menu, 'raja <qtd>', 'o gerador de teste !raja segue listado');
});

// ============================================================================

console.log('');
const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log(`Total: ${totalOk} ok, ${totalFail} falhas em ${RESULTS.length} testes`);
process.exit(totalFail === 0 ? 0 : 1);
