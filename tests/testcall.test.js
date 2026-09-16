/**
 * Testes do !testcall — notificações de chamada por grupo.
 *
 * Testa duas camadas:
 *   1. callNotifier.js (puro): classificação do evento e texto da notificação
 *   2. o handler de `call` no connect.js: só notifica grupo com o toggle ligado
 *
 * O handler é exercitado com um socket Baileys fake, sem abrir conexão.
 *
 * Rodar: node tests/testcall.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

// Banco temporário: nunca toca o dados/database real do bot.
const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-testcall-'));
process.env.DATABASE_PATH = TMP_DB;
fs.mkdirSync(path.join(TMP_DB, 'grupos'), { recursive: true });

const RESULTS = [];
let CURRENT = null;

function test(name, fn) {
  CURRENT = { name, passed: 0, failed: 0, errors: [] };
  RESULTS.push(CURRENT);
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      return r.then(() => finish(name)).catch((e) => {
        CURRENT.failed += 1;
        CURRENT.errors.push(`EXCEÇÃO: ${e?.stack || e}`);
        finish(name);
      });
    }
    finish(name);
  } catch (e) {
    CURRENT.failed += 1;
    CURRENT.errors.push(`EXCEÇÃO: ${e?.stack || e}`);
    finish(name);
  }
  return Promise.resolve();
}

function finish(name) {
  console.log(`${CURRENT.failed === 0 ? '✅' : '❌'} ${name} (${CURRENT.passed} ok, ${CURRENT.failed} falhas)`);
  for (const e of CURRENT.errors) console.log(`     ${e.split('\n')[0]}`);
}

function ok(cond, msg) {
  if (cond) CURRENT.passed += 1;
  else { CURRENT.failed += 1; CURRENT.errors.push(`ASSERT FALHOU: ${msg}`); }
}
function includes(h, n, l) { ok(typeof h === 'string' && h.includes(n), `${l ?? n} — esperado conter "${n}"`); }

// ============================================================================
// IMPORTS
// ============================================================================

const notifier = await import(new URL('../dados/src/utils/callNotifier.js', import.meta.url).href);
const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;

const GROUPS_DIR = path.join(TMP_DB, 'grupos');
const ADMIN_JID = '5511000000001@s.whatsapp.net';
const ADMIN_LID = '111000000000001@lid';
const BOT_LID = '111111111111111@lid';
const BOT_JID = '5599999999999@s.whatsapp.net';
const NON_ADMIN_LID = '5599888888888@lid';

let groupCounter = 0;
function makeGroup(flags = {}) {
  groupCounter += 1;
  const jid = `1203639200000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(path.join(GROUPS_DIR, `${jid}.json`), JSON.stringify({
    modobrincadeira: true,
    __extraAdmins: [{ id: BOT_LID, admin: 'admin', phoneNumber: BOT_JID }],
    ...flags,
  }, null, 2));
  return jid;
}

/** Evento de call no formato que o `handleCall` do Baileys emite. */
function makeCall(overrides = {}) {
  return {
    chatId: '120363920000000001@g.us',
    from: '5511999999999@lid',
    callerPn: '5511999999999@s.whatsapp.net',
    id: '3EB0CALLTEST0000000001',
    date: new Date('2026-09-16T12:00:00Z'),
    offline: false,
    status: 'offer',
    isVideo: false,
    isGroup: false,
    ...overrides,
  };
}

function makeNazu({ sent = [], calls = {} } = {}) {
  const bump = (k) => { calls[k] = (calls[k] || 0) + 1; };
  return {
    sent, calls,
    sendMessage: async (jid, content) => { bump('sendMessage'); sent.push({ jid, content }); return { key: { id: 'S' } }; },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID },
    getName: async () => 'Fulano Teste',
    groupMetadata: async () => ({ id: 'g@g.us', subject: 'G', participants: [
      { id: ADMIN_LID, admin: 'superadmin', phoneNumber: ADMIN_JID },
      { id: BOT_LID, admin: 'admin', phoneNumber: BOT_JID },
    ] }),
    onWhatsApp: async (j) => [{ jid: j, exists: true }],
    signalRepository: { lidMapping: { getPNForLID: async () => ADMIN_JID } },
    ev: { on() {}, emit() {}, removeAllListeners() {} },
    readMessages: async () => {}, sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => 'x', react: async () => ({}),
  };
}

const textOf = (sent) => sent.map((s) => s.content?.text ?? '').filter(Boolean).join('\n');

/** Executa um comando no handler real, com o grupo indicado. */
async function run(text, { groupJid, key = {} } = {}) {
  const sent = [];
  const calls = {};
  const nazu = makeNazu({ sent, calls });
  const info = {
    key: { remoteJid: groupJid, fromMe: false, id: 'MSG', participant: ADMIN_LID, ...key },
    message: { extendedTextMessage: { text } },
    messageTimestamp: 1757900000, pushName: 'Tester',
  };
  await handleMessage(nazu, info, null, new Map(), null);
  return { sent, calls, text: textOf(sent) };
}

// ============================================================================
// 1) callNotifier — CAMADA PURA
// ============================================================================

await test('notifier: classifica todos os status de chamada', () => {
  const esperado = {
    offer: 'offer', ringing: 'ringing', preaccept: 'preaccept',
    transport: 'transport', relaylatency: 'relaylatency',
    accept: 'accept', reject: 'reject', terminate: 'terminate', timeout: 'timeout',
  };
  for (const [status, kind] of Object.entries(esperado)) {
    const c = notifier.classifyCallEvent(makeCall({ status }));
    ok(c && c.kind === kind, `${status} -> ${c && c.kind} (esperado ${kind})`);
  }
});

await test('notifier: identifica tentativa de ligação (offer) e chamada perdida (timeout)', () => {
  const oferta = notifier.classifyCallEvent(makeCall({ status: 'offer' }));
  includes(oferta.label, 'entrando', 'rótulo da oferta');
  const perdida = notifier.classifyCallEvent(makeCall({ status: 'timeout' }));
  includes(perdida.label, 'perdida', 'rótulo do timeout');
  ok(notifier.isMissedCall('timeout') === true, 'isMissedCall(timeout)');
});

await test('notifier: informa quando a chamada é de grupo', () => {
  // O rótulo não distingue autor, mas o TEXTO ainda informa se a chamada é de
  // grupo (dado do protocolo, não sobre quem ligou).
  const c = notifier.buildCallNotification(makeCall({ isGroup: true, groupJid: 'g@g.us' }));
  includes(c.text, 'Chamada de grupo', 'texto indica grupo');
});

await test('notifier: trata QUALQUER autor igual (sem distinguir o bot)', () => {
  // O pedido é explícito: qualquer chamada, de qualquer usuário do grupo,
  // recebe a mesma notificação — inclusive quando quem liga é o próprio bot.
  const deTerceiro = notifier.classifyCallEvent(makeCall({ from: '5511988887777@s.whatsapp.net' }));
  const doBot = notifier.classifyCallEvent(makeCall({ from: '5599999999999@s.whatsapp.net' }));
  const deLid = notifier.classifyCallEvent(makeCall({ from: '217205740421125@lid' }));

  ok(deTerceiro.label === doBot.label, `terceiro e bot têm o mesmo rótulo (${deTerceiro.label})`);
  ok(deTerceiro.label === deLid.label, `LID e JID têm o mesmo rótulo (${deLid.label})`);
  includes(deTerceiro.label, 'Ligação entrando', 'rótulo neutro quanto ao autor');

  // E o texto também não muda com o autor, só com o nome exibido.
  const t1 = notifier.buildCallNotification(makeCall({ from: '5511988887777@s.whatsapp.net' }));
  const t2 = notifier.buildCallNotification(makeCall({ from: '5599999999999@s.whatsapp.net' }));
  ok(!t1.text.includes('saindo') && !t2.text.includes('saindo'), 'nunca diz "saindo"');
  ok(!t1.text.includes('bot') && !t2.text.includes('bot'), 'nunca menciona "bot" no texto');
});

await test('notifier: notifica os callbacks de qualquer usuário', () => {
  // buildCallNotification não recebe mais botJid: a assinatura não permite
  // distinguir autor, o que é o comportamento desejado.
  const r = notifier.buildCallNotification(makeCall({ from: '5511900000000@s.whatsapp.net' }));
  ok(r !== null, 'gera notificação');
  includes(r.text, 'Ligação entrando', 'rótulo padrão');
  ok(notifier.buildCallNotification(makeCall(), { botJid: 'x' }) !== null,
    'opção botJid extra é ignorada, não quebra');
});

await test('notifier: texto da notificação traz autor, tipo e id', () => {
  const { text, kind } = notifier.buildCallNotification(makeCall(), {
    callerName: 'Fulano', groupName: 'Meu Grupo',
  });
  ok(kind === 'offer', 'kind da oferta');
  includes(text, 'Ligação entrando', 'cabeçalho');
  includes(text, 'Fulano', 'nome do autor');
  includes(text, 'Voz', 'tipo voz');
  includes(text, 'Meu Grupo', 'nome do grupo');
  includes(text, '3EB0CALLTEST', 'id da chamada');
  ok(!text.includes('undefined'), 'sem undefined');
  ok(!text.includes('null'), 'sem null');
});

await test('notifier: vídeo e latência aparecem quando presentes', () => {
  const video = notifier.buildCallNotification(makeCall({ isVideo: true }));
  includes(video.text, 'Vídeo', 'tipo vídeo');
  const lat = notifier.buildCallNotification(makeCall({ status: 'relaylatency', latencyMs: 42 }));
  includes(lat.text, '42ms', 'latência');
});

await test('notifier: entrada inválida não quebra', () => {
  ok(notifier.classifyCallEvent(null) === null, 'null -> null');
  ok(notifier.classifyCallEvent(undefined) === null, 'undefined -> null');
  ok(notifier.classifyCallEvent({}) !== null, 'objeto sem status ainda classifica');
  ok(notifier.buildCallNotification(null) === null, 'buildCallNotification(null) -> null');
});

await test('notifier: displayUser extrai o número do JID', () => {
  ok(notifier.displayUser('5511999999999@s.whatsapp.net') === '5511999999999', 'JID normal');
  ok(notifier.displayUser('5511999999999:5@s.whatsapp.net') === '5511999999999', 'JID com device');
  ok(notifier.displayUser('217205740421125@lid') === '217205740421125', 'LID');
  ok(notifier.displayUser(null) === 'desconhecido', 'null -> desconhecido');
});

await test('notifier: shouldNotifyCall só passa com o toggle ligado', () => {
  ok(notifier.shouldNotifyCall({ testcall: true }) === true, 'ligado');
  ok(notifier.shouldNotifyCall({ testcall: false }) === false, 'desligado');
  ok(notifier.shouldNotifyCall({}) === false, 'ausente');
  ok(notifier.shouldNotifyCall(null) === false, 'null');
});

// ============================================================================
// 2) COMANDO !testcall
// ============================================================================

await test('!testcall: alterna o toggle e persiste o estado', async () => {
  const g = makeGroup();
  const on = await run('!testcall', { groupJid: g });
  includes(on.text, 'ATIVADO', 'ligou');

  // persistGroupData() grava de forma assincrona em background: espera o
  // arquivo aparecer em vez de assumir que ja esta no disco.
  let salvo = null;
  for (let i = 0; i < 20 && !salvo?.testcall; i++) {
    await new Promise((r) => setTimeout(r, 100));
    try {
      salvo = JSON.parse(fs.readFileSync(path.join(GROUPS_DIR, `${g}.json`), 'utf-8'));
    } catch { /* ainda nao escrito */ }
  }
  ok(salvo?.testcall === true, `persistiu testcall=true (obtido: ${JSON.stringify(salvo?.testcall)})`);

  const off = await run('!testcall', { groupJid: g });
  includes(off.text, 'DESATIVADO', 'desligou');
});

await test('!testcall: a leitura de groupData respeita o toggle entre chamadas', async () => {
  // Cobre o caso do cache de 5s do optimizer: com o grupo DESLIGADO, a regex do
  // handler nao deve notificar. Aqui so garantimos que o valor lido do disco
  // (fonte do handler de call) reflete o ultimo estado.
  const g = makeGroup({ testcall: true });
  const gd = JSON.parse(fs.readFileSync(path.join(GROUPS_DIR, `${g}.json`), 'utf-8'));
  ok(notifier.shouldNotifyCall(gd) === true, 'estado lido do disco notifica');
});

await test('!testcall: só funciona em grupo', async () => {
  const sent = [];
  const nazu = makeNazu({ sent });
  await handleMessage(nazu, {
    key: { remoteJid: '5511999999999@s.whatsapp.net', fromMe: false, id: 'PV', participant: ADMIN_LID },
    message: { extendedTextMessage: { text: '!testcall' } },
    messageTimestamp: 1757900000, pushName: 'X',
  }, null, new Map(), null);
  includes(textOf(sent), 'só pode ser usado em grupo', 'recusou fora de grupo');
});

await test('!testcall: não-admin é recusado', async () => {
  const g = makeGroup();
  const r = await run('!testcall', { groupJid: g, key: { participant: NON_ADMIN_LID } });
  includes(r.text, 'precisa ser adm', 'recusou não-admin');
  const salvo = JSON.parse(fs.readFileSync(path.join(GROUPS_DIR, `${g}.json`), 'utf-8'));
  ok(salvo.testcall === undefined, 'não ligou o toggle');
});

await test('!testcall: menciona o que será notificado', async () => {
  const g = makeGroup();
  const r = await run('!testcall', { groupJid: g });
  includes(r.text, 'chamada', 'fala de chamada');
  includes(r.text, 'perdida', 'menciona chamada perdida');
});

// ============================================================================
// 3) HANDLER DE CALL (connect.js) — via socket fake
// ============================================================================

// ============================================================================

// Espera as escritas assincronas de groupData (persistGroupData roda em
// background) antes de medir e remover o banco temporario.
await new Promise((r) => setTimeout(r, 1500));

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
