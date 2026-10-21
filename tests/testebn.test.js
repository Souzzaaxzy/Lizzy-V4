/**
 * Testes do !testebn — COMANDO DE TESTE / BRINCADEIRA (PRANK).
 *
 * Contrato desta versao (FORMA 1b — restricao de fan-out do Sender Key):
 *   - a stanza e enderecada AO GRUPO (@g.us) — NADA em privado;
 *   - a visibilidade e restrita por `recipientMode: 'members-only'` no
 *     relayMessage (NAO pela rotacao do !rajar): a fork resolve o subconjunto
 *     antes da descoberta de devices, entao so os membros comuns recebem o
 *     material da Sender Key;
 *   - SEM VALOR no payload (o campo amount1000 nao existe).
 *
 * Uso: node tests/testebn.test.js
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-testebn-db-'));
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
      return result.then(() => finish()).catch((e) => { CURRENT.failed++; CURRENT.errors.push(`EXCEÇÃO: ${e?.stack || e}`); finish(); });
    }
    finish();
  } catch (e) { CURRENT.failed++; CURRENT.errors.push(`EXCEÇÃO: ${e?.stack || e}`); finish(); }
  return Promise.resolve();
}
function finish() {
  console.log(`${CURRENT.failed === 0 ? '✅' : '❌'} ${CURRENT.name} (${CURRENT.passed} ok, ${CURRENT.failed} falhas)`);
  for (const err of CURRENT.errors) console.log(`     ${err.split('\n')[0]}`);
}
function ok(c, m) { if (c) CURRENT.passed++; else { CURRENT.failed++; CURRENT.errors.push(`ASSERT FALHOU: ${m}`); } }

const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;
const { testebn } = await import(new URL('../dados/src/funcs/utils/testebn.js', import.meta.url).href);
// A MESMA funcao que o caminho de envio da fork usa — prova o mecanismo real.
const { selectGroupRecipients, GROUP_RECIPIENT_MODES } = await import('@itsliaaa/baileys');

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';
const ADM_A = '111000000000001@lid';
const ADM_B = '111000000000002@lid';
const MEM_1 = '222000000000001@lid';
const MEM_2 = '222000000000002@lid';

let groupCounter = 0;
function makeGroup() {
  groupCounter += 1;
  const jid = `1203639000000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(path.join(GRUPOS_DIR, `${jid}.json`), JSON.stringify({ groupName: 'Grupo Testebn' }, null, 2));
  return jid;
}

const PARTICIPANTS = [
  { id: BOT_LID, lid: BOT_LID, phoneNumber: BOT_JID, admin: 'admin' },
  { id: ADM_A, lid: ADM_A, admin: 'superadmin' },
  { id: ADM_B, lid: ADM_B, admin: 'admin' },
  { id: MEM_1, lid: MEM_1, admin: null },
  { id: MEM_2, lid: MEM_2, admin: null },
];

function makeNazu({ sent, groupJid, comMetadata = true }) {
  const nazu = {
    sendMessage: async (jid, content, options) => { sent.push({ jid, content, options, via: 'sendMessage' }); return { key: { id: `S${sent.length}` } }; },
    relayMessage: async (jid, message, options) => { sent.push({ jid, message, options, via: 'relayMessage' }); return options?.messageId; },
    user: { id: BOT_JID, lid: BOT_LID, name: 'Lizzy' },
    groupMetadata: async () => {
      if (!comMetadata) throw new Error('metadata indisponivel');
      return { id: groupJid, subject: 'Grupo Testebn', participants: PARTICIPANTS };
    },
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {},
    sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => 'x',
    react: async () => ({}),
    // Se o comando usasse a rotacao (Forma 1a), cairia aqui.
    _rotacaoChamada: 0,
  };
  nazu.relayGroupMessageWithSenderKeyRotation = async () => { nazu._rotacaoChamada += 1; throw new Error('NAO DEVE USAR ROTACAO'); };
  return nazu;
}

let cenario = 0;
async function rodar({ groupJid, text = '!testebn', fromMe = true, comMetadata = true }) {
  cenario += 1;
  const sent = [];
  const nazu = makeNazu({ sent, groupJid, comMetadata });
  await handleMessage(nazu, {
    key: { remoteJid: groupJid, fromMe, id: `M-${cenario}`, participant: fromMe ? BOT_LID : MEM_1 },
    message: { extendedTextMessage: { text, contextInfo: { remoteJid: groupJid } } },
    messageTimestamp: 1757900000,
    pushName: 'Tester',
  }, null);
  return { sent, nazu };
}

console.log('\n=== !testebn — COMANDO DE TESTE / BRINCADEIRA (FORMA 1b) ===\n');

await test('endereca AO GRUPO: 10 envios, todos no @g.us', async () => {
  const g = makeGroup();
  const { sent } = await rodar({ groupJid: g });
  const envios = sent.filter(s => s.via === 'relayMessage');
  ok(envios.length === 10, `10 envios, veio ${envios.length}`);
  ok(envios.every(e => e.jid === g), 'todos enderecados ao JID do grupo');
});

await test('NADA vai para o privado (nem membros, nem dono, nem admins)', async () => {
  const g = makeGroup();
  const { sent } = await rodar({ groupJid: g });
  const privados = sent.filter(s => s.jid !== g);
  ok(privados.length === 0, `nenhum envio fora do grupo, veio ${privados.length}`);
  for (const jid of [MEM_1, MEM_2, ADM_A, ADM_B, BOT_LID, BOT_JID]) {
    ok(!sent.some(s => s.jid === jid), `nada para ${jid}`);
  }
});

await test('usa recipientMode members-only (FORMA 1b) e NAO a rotacao', async () => {
  const g = makeGroup();
  const { sent, nazu } = await rodar({ groupJid: g });
  const envios = sent.filter(s => s.via === 'relayMessage');
  for (const e of envios) {
    ok(e.options?.recipientMode === 'members-only', `recipientMode members-only (veio ${e.options?.recipientMode})`);
    ok(e.options?.recipientParticipants === undefined, 'sem recipientParticipants explicito');
    ok(e.options?.experimentalSenderKeyRotation === undefined, 'sem flag de rotacao');
    ok(e.options?.allowedParticipants === undefined, 'sem allowedParticipants da rotacao');
  }
  ok(nazu._rotacaoChamada === 0, `a API de rotacao NAO foi chamada (${nazu._rotacaoChamada})`);
});

await test('o mecanismo REAL exclui admins e inclui os membros comuns', async () => {
  // Roda a funcao que o caminho de envio da fork usa, com o MESMO metadata.
  const recips = selectGroupRecipients(PARTICIPANTS, GROUP_RECIPIENT_MODES.MEMBERS_ONLY);
  ok(recips.length === 2, `2 destinatarios, veio ${recips.length}`);
  ok(recips.includes(MEM_1) && recips.includes(MEM_2), 'os 2 membros comuns entram');
  ok(!recips.includes(ADM_A), 'superadmin fora');
  ok(!recips.includes(ADM_B), 'admin fora');
  ok(!recips.includes(BOT_LID), 'a propria bot (admin) fora');
  // E o comando reporta essa mesma contagem.
  const g = makeGroup();
  const r = await testebn(makeNazu({ sent: [], groupJid: g }), g);
  ok(r.recipients === recips.length, `o comando reporta a mesma contagem (${r.recipients})`);
});

await test('SEM VALOR: o payload nao tem amount1000', async () => {
  const g = makeGroup();
  const { sent } = await rodar({ groupJid: g });
  for (const e of sent.filter(s => s.via === 'relayMessage')) {
    const p = e.message.requestPaymentMessage;
    ok(!!p, 'tem requestPaymentMessage');
    ok(!('amount1000' in p), `amount1000 ausente (veio ${JSON.stringify(p.amount1000)})`);
    ok(p.noteMessage.extendedTextMessage.text === 'teste, teste, bn', 'nota correta');
    ok(p.currencyCodeIso4217 === 'BRL', 'moeda BRL');
  }
});

await test('messageId distinto por envio', async () => {
  const g = makeGroup();
  const { sent } = await rodar({ groupJid: g });
  const ids = sent.filter(s => s.via === 'relayMessage').map(s => s.options?.messageId);
  ok(ids.every(Boolean), 'todo envio tem messageId');
  ok(new Set(ids).size === ids.length, `IDs distintos (${new Set(ids).size}/${ids.length})`);
});

await test('membro comum (nao-dono) nao dispara nada', async () => {
  const g = makeGroup();
  const { sent } = await rodar({ groupJid: g, fromMe: false });
  ok(sent.filter(s => s.via === 'relayMessage').length === 0, 'nenhum envio para nao-dono');
});

await test('falha FECHADO sem metadata (nao vaza pro grupo inteiro)', async () => {
  const g = makeGroup();
  const { sent } = await rodar({ groupJid: g, comMetadata: false });
  ok(sent.length === 0, `nada foi enviado, veio ${sent.length}`);
  const r = await testebn({ user: { id: BOT_JID }, relayMessage: async () => {}, groupMetadata: async () => { throw new Error('x'); } }, g);
  ok(r.aborted === 'sem-metadata', `motivo informado (${r.aborted})`);
  ok(r.sent === 0, 'sent = 0');
});

await test('falha FECHADO sem membros comuns (so admins)', async () => {
  const g = makeGroup();
  const soAdmins = { participants: [PARTICIPANTS[0], PARTICIPANTS[1], PARTICIPANTS[2]] };
  const r = await testebn({ user: { id: BOT_JID }, groupMetadata: async () => soAdmins, relayMessage: async () => {} }, g);
  ok(r.aborted === 'sem-membros', `motivo informado (${r.aborted})`);
  ok(r.sent === 0, 'sent = 0');
});

await test('o modulo respeita rate-limit (aborta e devolve parcial)', async () => {
  let n = 0;
  const sock = {
    user: { id: BOT_JID, lid: BOT_LID },
    groupMetadata: async () => ({ participants: PARTICIPANTS }),
    relayMessage: async () => { n++; if (n >= 3) throw new Error('429 Too Many Requests'); },
  };
  const r = await testebn(sock, 'x@g.us');
  ok(r.aborted === 'rate-limit', `abortou por rate-limit (${r.aborted})`);
  ok(r.sent === 2, `enviou 2 antes do 429 (${r.sent})`);
});

await test('nao esta em menu nenhum nem no blockPv', async () => {
  const src = fs.readFileSync(new URL('../dados/src/index.js', import.meta.url), 'utf8');
  ok(src.includes("case 'testebn'"), 'a case existe no handler');
  const menus = fs.readdirSync(new URL('../dados/src/menus/', import.meta.url)).filter(f => f.endsWith('.js'));
  for (const m of menus) {
    const c = fs.readFileSync(new URL(`../dados/src/menus/${m}`, import.meta.url), 'utf8');
    ok(!c.includes('testebn'), `${m} nao menciona testebn`);
  }
  const blockPv = fs.readFileSync(new URL('../dados/src/utils/blockPv.js', import.meta.url), 'utf8');
  ok(!blockPv.includes('testebn'), 'blockPv nao menciona testebn');
});

console.log('\n=== RESUMO ===');
const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log(`${RESULTS.length} testes / ${totalOk} assercoes ok / ${totalFail} falhas`);
process.exit(totalFail === 0 ? 0 : 1);
