/**
 * Testes do `!rajar2` (NOVO) — mensagem invisivel com tipo DIFERENTE.
 *
 * ATENCAO: existe tambem `tests/rajar2.test.js`, que testa o `rajar2` ANTIGO
 * (retransmissao pairwise, removido do bot) — ele ja falhava antes desta
 * mudanca. Este arquivo testa o `rajar2` NOVO, que usa outro TIPO de mensagem.
 *
 * O `!rajar` usa `requestPaymentMessage`/`sendPaymentMessage` — justamente os
 * dois que o detector reconhece. O `!rajar2` usa **`splitPaymentMessage`**, que:
 *   - carrega `contextInfo` (unico tipo de pagamento, alem daqueles dois, que
 *     mantem as mencoes — medido);
 *   - passa **NORMAL** no `analyzeInvisibleMessage`.
 *
 * Uso: node tests/rajar2-invisivel.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { proto } from '@itsliaaa/baileys';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-rajar2i-db-'));
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
    const r = fn();
    if (r && typeof r.then === 'function') return r.then(() => done()).catch(done);
    done();
  } catch (e) {
    done(e);
  }
  return Promise.resolve();
}

function ok(cond, msg) {
  if (cond) CURRENT.passed += 1;
  else {
    CURRENT.failed += 1;
    CURRENT.errors.push(`ASSERT FALHOU: ${msg}`);
  }
}

function includes(hay, needle, label) {
  ok(typeof hay === 'string' && hay.includes(needle), `${label ?? needle} — esperado conter "${needle}"`);
}

const { analyzeInvisibleMessage } = await import(new URL('../dados/src/utils/invisibleAnalyzer.js', import.meta.url).href);
const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';
const ADMIN_LID = '222000000000001@lid';
const MEMBROS = ['333000000000001@lid', '333000000000002@lid', '333000000000003@lid'];

const TEXTO_ESPERADO = 'teste teste teste teste teste teste teste teste testte teste teste teste teste teste teste';

let grupoCounter = 0;
function makeGroup() {
  grupoCounter += 1;
  const jid = `1203638000000000${String(grupoCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(path.join(GRUPOS_DIR, `${jid}.json`), JSON.stringify({ groupName: 'Grupo R2' }, null, 2));
  return jid;
}

function makeNazu({ relayed, groupJid }) {
  return {
    sendMessage: async () => ({ key: { id: 'S1' } }),
    relayMessage: async () => 'R1',
    // O caminho do !rajar/!rajar2: so membros comuns decifram.
    relayGroupMessageWithSenderKeyRotation: async (jid, message, opts) => {
      relayed.push({ jid, message, opts });
      return opts?.messageId;
    },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
    onWhatsApp: async (jid) => [{ jid, exists: true, lid: jid.replace('@s.whatsapp.net', '@lid') }],
    signalRepository: { lidMapping: { getPNForLID: async () => null } },
    groupMetadata: async () => ({
      id: groupJid,
      subject: 'Grupo R2',
      owner: BOT_LID,
      participants: [
        { id: BOT_LID, lid: BOT_LID, phoneNumber: BOT_JID, admin: 'superadmin' },
        { id: ADMIN_LID, lid: ADMIN_LID, phoneNumber: '5511777777777@s.whatsapp.net', admin: 'admin' },
        ...MEMBROS.map((m) => ({ id: m, lid: m, phoneNumber: null, admin: null })),
      ],
    }),
    groupParticipantsUpdate: async () => ({}),
    groupRequestParticipantsList: async () => [],
    groupRequestParticipantsUpdate: async () => ({}),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {},
    sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => { throw new Error('sem foto'); },
    react: async () => ({}),
  };
}

async function rodar({ groupJid, text = '!rajar2', comoDono = true }) {
  const relayed = [];
  const sender = comoDono ? BOT_LID : ADMIN_LID;
  const nazu = makeNazu({ relayed, groupJid });
  const sent = [];
  nazu.sendMessage = async (jid, content) => { sent.push({ jid, content }); return { key: { id: `S${sent.length}` } }; };

  await handleMessage(nazu, {
    key: { remoteJid: groupJid, fromMe: comoDono, id: `M-${Math.random().toString(36).slice(2, 8)}`, participant: sender },
    message: { extendedTextMessage: { text, contextInfo: { remoteJid: groupJid } } },
    messageTimestamp: 1757900000,
    pushName: 'Tester',
  }, null, new Map(), null);

  const texto = sent.map((s) => s.content?.text ?? '').filter(Boolean).join('\n');
  return { relayed, sent, texto };
}

/** O texto sobrevive ao wire? */
function noWire(message) {
  return JSON.stringify(proto.Message.toObject(proto.Message.decode(proto.Message.encode(message).finish())));
}

// ============================================================================
// 1) ENVIO
// ============================================================================

await test('!rajar2 envia 5 mensagens, todas por rotacao (so membros)', async () => {
  const groupJid = makeGroup();
  const { relayed } = await rodar({ groupJid });

  ok(relayed.length === 5, `5 mensagens enviadas (${relayed.length})`);
  ok(
    relayed.every((r) => r.opts?.allowedParticipants?.length > 0),
    'todas usam allowedParticipants (rotacao de Sender Key)'
  );
  ok(
    relayed.every((r) => r.opts.allowedParticipants.length === MEMBROS.length),
    `os autorizados sao os membros comuns (${relayed[0]?.opts?.allowedParticipants?.length})`
  );
  ok(
    relayed.every((r) => !r.opts.allowedParticipants.includes(ADMIN_LID)),
    'o ADMIN nao esta na lista de autorizados'
  );
  ok(relayed.every((r) => r.opts.messageId), 'cada envio tem messageId proprio');
  ok(new Set(relayed.map((r) => r.opts.messageId)).size === 5, 'os 5 IDs sao distintos');
});

await test('o tipo e splitPaymentMessage — DIFERENTE do !rajar', async () => {
  const groupJid = makeGroup();
  const { relayed } = await rodar({ groupJid });

  const tipo = Object.keys(relayed[0].message).find((k) => k.includes('Message'));
  ok(tipo === 'splitPaymentMessage', `tipo = ${tipo}`);
  ok(tipo !== 'requestPaymentMessage', 'NAO e requestPaymentMessage (o do !raja)');
  ok(tipo !== 'sendPaymentMessage', 'NAO e sendPaymentMessage (o do !rajar)');
});

await test('o texto configurado viaja e sobrevive ao encode/decode', async () => {
  const groupJid = makeGroup();
  const { relayed } = await rodar({ groupJid });

  const json = noWire(relayed[0].message);
  ok(json.includes(TEXTO_ESPERADO), 'o texto pre-configurado esta no proto');
  ok(relayed[0].message.splitPaymentMessage.description === TEXTO_ESPERADO, 'esta no campo description');
});

await test('cita TODOS os membros do grupo (mencoes reais)', async () => {
  const groupJid = makeGroup();
  const { relayed } = await rodar({ groupJid });

  const json = noWire(relayed[0].message);
  for (const m of MEMBROS) {
    ok(json.includes(m), `menciona ${m}`);
  }
  const ctx = relayed[0].message.splitPaymentMessage.contextInfo;
  ok(Array.isArray(ctx?.mentionedJid), 'contextInfo.mentionedJid existe');
  ok(ctx.mentionedJid.length >= MEMBROS.length + 2, `cita o grupo todo (${ctx.mentionedJid.length})`);
});

// ============================================================================
// 2) DETECCAO — o ponto do experimento
// ============================================================================

await test('passa NORMAL no detector (o !rajar continua detectado)', async () => {
  const groupJid = makeGroup();
  const { relayed } = await rodar({ groupJid });

  const info = {
    key: { remoteJid: groupJid, fromMe: false, id: 'M1', participant: MEMBROS[0] },
    message: relayed[0].message,
    messageTimestamp: Math.floor(Date.now() / 1000),
    content: relayed[0].message,
  };
  const a = analyzeInvisibleMessage(info);

  ok(a.classification === 'NORMAL', `classificacao = ${a.classification} (esperado NORMAL)`);
  ok(a.detected === false, 'detected = false');

  // Indicadores INFORMATIVOS (peso 0) podem aparecer — o `INV-011`
  // (enderecamento por LID) surge porque as mencoes sao LIDs. O que importa e
  // que NENHUM tenha peso: se tivesse, somaria e mudaria a classificacao.
  const comPeso = (a.indicators || []).filter((i) => Number(i.peso || 0) > 0);
  ok(
    comPeso.length === 0,
    `nenhum indicador com peso (com peso: ${comPeso.map((i) => `${i.id}=${i.peso}`).join(',') || 'nenhum'})`
  );
});

// ============================================================================
// 3) GUARDAS / ESCOPO
// ============================================================================

await test('so o dono pode disparar', async () => {
  const groupJid = makeGroup();
  const { relayed, texto } = await rodar({ groupJid, comoDono: false });
  ok(relayed.length === 0, 'nao-dono nao envia nada');
  includes(texto, 'dono', 'recusa explicando a restricao');
});

await test('nao esta em NENHUM menu (case solta, para teste)', () => {
  const menusDir = new URL('../dados/src/menus/', import.meta.url);
  const arquivos = fs.readdirSync(menusDir).filter((f) => f.endsWith('.js'));
  let achouEmMenu = false;
  for (const f of arquivos) {
    const txt = fs.readFileSync(new URL(f, menusDir), 'utf8');
    if (txt.includes('rajar2')) achouEmMenu = true;
  }
  ok(!achouEmMenu, 'rajar2 nao aparece em nenhum menu');

  const blockPv = fs.readFileSync(new URL('../dados/src/utils/blockPv.js', import.meta.url), 'utf8');
  ok(!blockPv.includes("'rajar2'"), 'rajar2 nao esta no blockPv');
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
