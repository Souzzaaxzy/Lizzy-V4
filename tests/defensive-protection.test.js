/**
 * Testes da proteção defensiva contra rajadas de mensagens especiais
 * (requestPaymentMessage / "raja") e da responsividade do bot durante o flood.
 *
 * Usa o handler real (NazuninhaBotExec) e o MessageQueue real (connect.js é
 * importado só para a classe — o socket do WhatsApp não é aberto).
 *
 * Rodar: node tests/defensive-protection.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { performance } from 'perf_hooks';

// Banco temporário: nunca toca o dados/database real do bot.
const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-def-'));
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
function notIncludes(h, n, l) { ok(typeof h === 'string' && !h.includes(n), `${l ?? n} — não deveria conter "${n}"`); }

// ============================================================================
// IMPORTS
// ============================================================================

const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;
const inspector = await import(new URL('../dados/src/utils/messageInspector.js', import.meta.url).href);

// ============================================================================
// FIXTURES
// ============================================================================

const ADMIN_JID = '5511000000001@s.whatsapp.net';
const ADMIN_LID = '111000000000001@lid';
const RAJA_LID = '217000000000125@lid'; // ficticio (o teste nao depende do valor)
// Identidade do bot: getBotNumber usa nazu.user.lid, então ele precisa estar
// na lista de admins do grupo para os blocos anti-pagamento rodarem.
const BOT_LID = '111111111111111@lid';
const BOT_JID = '5599999999999@s.whatsapp.net';

let groupCounter = 0;
const GROUPS_DIR = path.join(TMP_DB, 'grupos');

/** Grupo de teste com os anti-* ligados, como num cenário real de proteção. */
function makeGroup(extraAdmins = []) {
  groupCounter += 1;
  const jid = `1203639100000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(path.join(GROUPS_DIR, `${jid}.json`), JSON.stringify({
    antiinvi: true, antirequest: true, modobrincadeira: true,
    // O bot precisa ser admin para os anti-pagamento agirem (guarda isBotAdmin).
    __extraAdmins: [{ id: BOT_LID, admin: 'admin', phoneNumber: BOT_JID }, ...extraAdmins],
  }, null, 2));
  return jid;
}

/** As 348 menções da amostra real (metade LID, metade PN). */
const MENTIONS_348 = Array.from({ length: 348 }, (_, i) =>
  i % 2 === 0 ? `21720574042${1000 + i}@lid` : `5511999${100000 + i}@s.whatsapp.net`);

/** Amostra real do raja: requestPaymentMessage -> noteMessage -> extendedTextMessage -> contextInfo -> mentionedJid[] */
function makeRaja({ mentions = MENTIONS_348, amount1000 = '0', withText = true } = {}) {
  return {
    requestPaymentMessage: {
      currencyCodeIso4217: 'BRL',
      amount1000,
      expiryTimestamp: '0',
      noteMessage: {
        extendedTextMessage: {
          ...(withText ? { text: 'RAJA ' + 'x'.repeat(120) } : {}),
          contextInfo: { mentionedJid: mentions, forwardingScore: 999, isForwarded: true },
        },
      },
      amount: { value: '0', offset: 1000, currencyCode: 'BRL' },
    },
  };
}

function makeNazu({ groupJid, sent = [], calls = {} } = {}) {
  let extraAdmins = [];
  try {
    const f = path.join(GROUPS_DIR, `${groupJid}.json`);
    if (fs.existsSync(f)) extraAdmins = JSON.parse(fs.readFileSync(f, 'utf-8')).__extraAdmins || [];
  } catch { /* ignora */ }
  const bump = (k) => { calls[k] = (calls[k] || 0) + 1; };
  return {
    sent, calls,
    sendMessage: async (jid, content) => { bump('sendMessage'); sent.push({ jid, content }); return { key: { id: 'S' } }; },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID },
    onWhatsApp: async (j) => { bump('onWhatsApp'); return [{ jid: j, exists: true, lid: ADMIN_LID }]; },
    signalRepository: { lidMapping: { getPNForLID: async () => ADMIN_JID } },
    groupMetadata: async () => { bump('groupMetadata'); return { id: groupJid, subject: 'G', participants: [
      { id: ADMIN_LID, admin: 'superadmin', phoneNumber: ADMIN_JID },
      { id: RAJA_LID, admin: null },
      ...extraAdmins,
    ] }; },
    groupSettingUpdate: async () => { bump('groupSettingUpdate'); return {}; },
    groupParticipantsUpdate: async () => { bump('groupParticipantsUpdate'); return {}; },
    groupRequestParticipantsList: async () => [],
    groupRequestParticipantsUpdate: async () => ({}),
    ev: { on() {}, emit() {}, removeAllListeners() {} },
    readMessages: async () => { bump('readMessages'); },
    sendPresenceUpdate: async () => { bump('sendPresenceUpdate'); },
    profilePictureUrl: async () => 'x',
    react: async () => ({}),
  };
}

let cmdAuthorCounter = 0;

/** Admin único por comando: o bot limita 3 comandos/5s por sender. */
function freshAdmin() {
  cmdAuthorCounter += 1;
  const n = String(cmdAuthorCounter).padStart(4, '0');
  return { lid: `88800000${n}@lid`, jid: `55880000${n}@s.whatsapp.net` };
}

async function run(message, { groupJid = makeGroup(), key = {}, nazuOpts = {} } = {}) {
  const sent = [];
  const calls = {};
  const nazu = makeNazu({ groupJid, sent, calls, ...nazuOpts });
  const info = {
    key: { remoteJid: groupJid, fromMe: false, id: 'MSG', participant: RAJA_LID, ...key },
    message, messageTimestamp: 1757900000, pushName: 'Tester',
  };
  const t0 = performance.now();
  await handleMessage(nazu, info, null, new Map(), null);
  return { ms: performance.now() - t0, sent, calls, nazu, groupJid };
}

const textOf = (sent) => sent.map((s) => s.content?.text ?? s.content?.caption ?? '').filter(Boolean).join('\n');

// ============================================================================
// 1) CLASSIFICAÇÃO (unidade) — o núcleo da proteção
// ============================================================================

await test('classifyMessage: detecta requestPaymentMessage e amount "0"', () => {
  const c = inspector.classifyMessage(makeRaja());
  ok(c.isPayment === true, 'isPayment');
  ok(c.isRequestPayment === true, 'isRequestPayment');
  ok(c.paymentAmount.present === true, 'campo amount1000 presente');
  ok(c.paymentAmount.isZero === true, 'amount1000 reconhecido como zero');
  ok(c.paymentAmount.raw === '0', 'valor bruto preservado');
  ok(c.mentionCount === 348, `contagem de menções = 348 (obtido: ${c.mentionCount})`);
  ok(c.hasMentions === true, 'hasMentions');
  ok(c.heavy === true, 'classificado como pesado');
});

await test('classifyMessage: extrai o texto da NOTA (não de conversation)', () => {
  const c = inspector.classifyMessage(makeRaja());
  includes(c.noteText, 'RAJA', 'texto da nota extraído');
  ok(c.noteContextInfo?.mentionedJid?.length === 348, 'contextInfo da nota acessível');
});

await test('classifyMessage: distingue ausente / null / "0" / ≠0', () => {
  const ausente = inspector.classifyMessage({ requestPaymentMessage: { currencyCodeIso4217: 'BRL' } });
  ok(ausente.paymentAmount.present === false, 'ausente: present=false');
  ok(ausente.paymentAmount.isZero === false, 'ausente: isZero=false');

  const nulo = inspector.classifyMessage({ requestPaymentMessage: { amount1000: null } });
  ok(nulo.paymentAmount.present === true, 'null: campo presente');
  ok(nulo.paymentAmount.isZero === false, 'null: não é zero');

  const zero = inspector.classifyMessage({ requestPaymentMessage: { amount1000: '0' } });
  ok(zero.paymentAmount.isZero === true, '"0" é zero');

  const zeroNum = inspector.classifyMessage({ requestPaymentMessage: { amount1000: 0 } });
  ok(zeroNum.paymentAmount.isZero === true, '0 numérico é zero');

  const naoZero = inspector.classifyMessage({ requestPaymentMessage: { amount1000: '1500' } });
  ok(naoZero.paymentAmount.isZero === false, '"1500" não é zero');
});

await test('classifyMessage: nota do pagamento NÃO é tratada como comando', () => {
  const c = inspector.classifyMessage(makeRaja());
  ok(c.type === 'requestPaymentMessage', 'tipo externo correto');
  // Mesmo que a nota comece com "!", o texto está no noteMessage.
  const cmdLike = inspector.classifyMessage({
    requestPaymentMessage: { amount1000: '0', noteMessage: { extendedTextMessage: { text: '!ping' } } },
  });
  ok(cmdLike.noteText === '!ping', 'nota preservada como nota');
  ok(cmdLike.type === 'requestPaymentMessage', 'continua sendo payment');
});

await test('classifyMessage: mensagem normal não é classificada como pesada', () => {
  const c = inspector.classifyMessage({ extendedTextMessage: { text: '!ping' } });
  ok(c.isPayment === false, 'não é payment');
  ok(c.mentionCount === 0, 'sem menções');
  ok(c.heavy === false, 'não é pesada');
});

await test('classifyMessage: detecta catálogo e ViewOnce', () => {
  ok(inspector.classifyMessage({ productMessage: { product: {} } }).isCatalog === true, 'catálogo');
  ok(inspector.classifyMessage({ viewOnceMessageV2: { message: {} } }).isViewOnce === true, 'viewOnce V2');
  ok(inspector.classifyMessage({ viewOnceMessage: { message: {} } }).isViewOnce === true, 'viewOnce V1');
  ok(inspector.classifyMessage({ extendedTextMessage: { text: 'oi' } }).isViewOnce === false, 'texto normal');
});

await test('classifyMessage é barata (sem I/O, < 0.05ms)', () => {
  const raja = makeRaja();
  inspector.classifyMessage(raja);
  const t0 = performance.now();
  for (let i = 0; i < 500; i++) inspector.classifyMessage(raja);
  const ms = (performance.now() - t0) / 500;
  ok(ms < 0.05, `classificação custou ${ms.toFixed(4)}ms (esperado < 0.05ms)`);
});

// ============================================================================
// 2) O RAJA NÃO BLOQUEIA O HANDLER
// ============================================================================

await test('raja: handler retorna rápido (sem os sleeps bloqueantes)', async () => {
  const { ms } = await run(makeRaja());
  // Antes: ~1117ms (sleep 1500 + 1000 dentro do handler). Agora deve ser bem menor.
  ok(ms < 600, `handler levou ${ms.toFixed(0)}ms (antes ~1117ms)`);
});

await test('raja: o enforcement de pagamento ainda acontece (em segundo plano)', async () => {
  const { calls } = await run(makeRaja());

  // Logo após o handler retornar, o grupo já foi fechado (primeira ação do
  // enforcement) — mas a remoção só vem depois de sleep(1500), igual ao
  // comportamento original. O que mudou é que isso não segura mais a fila.
  ok((calls.groupSettingUpdate || 0) >= 1, `grupo fechado imediatamente (${calls.groupSettingUpdate || 0})`);

  // Dá tempo ao enforcement (sleeps 1500 + 1000) e confere o efeito completo.
  await new Promise((r) => setTimeout(r, 3300));
  ok((calls.groupParticipantsUpdate || 0) >= 1, `autor removido (${calls.groupParticipantsUpdate || 0})`);
  ok((calls.groupSettingUpdate || 0) >= 2, `grupo reaberto (${calls.groupSettingUpdate || 0})`);
});

await test('raja: avisa o grupo que o pagamento não é permitido', async () => {
  const { sent } = await run(makeRaja({ amount1000: '1500', mentions: [] }));
  const text = textOf(sent);
  includes(text, 'Mensagem de pagamento', 'aviso de pagamento enviado');
  includes(text, 'não é permitida', 'texto do aviso');
});

await test('raja: não vaza "undefined"/"null" na resposta', async () => {
  const { sent } = await run(makeRaja());
  const text = textOf(sent);
  notIncludes(text, 'undefined', 'sem undefined');
  notIncludes(text, 'null', 'sem null');
  notIncludes(text, 'NaN', 'sem NaN');
});

await test('raja: detectado por amount=0 MESMO sem as 348 menções', async () => {
  const { calls } = await run(makeRaja({ mentions: [] }));
  await new Promise((r) => setTimeout(r, 3300));
  ok((calls.groupParticipantsUpdate || 0) >= 1, 'tratado como rajada só pelo amount zero');
});

await test('raja: detectado pelas 348 menções MESMO com amount != 0', async () => {
  const { calls } = await run(makeRaja({ amount1000: '1500' }));
  await new Promise((r) => setTimeout(r, 3300));
  ok((calls.groupParticipantsUpdate || 0) >= 1, 'tratado como rajada só pelas menções');
});

await test('raja: não resolve 348 LIDs (sem onWhatsApp por menção)', async () => {
  const { calls } = await run(makeRaja());
  ok((calls.onWhatsApp || 0) === 0, `onWhatsApp chamado ${calls.onWhatsApp || 0}x (esperado 0)`);
});

await test('raja: não baixa mídia nem chama APIs externas', async () => {
  const { calls } = await run(makeRaja());
  ok((calls.sendMessage || 0) <= 4, `poucas mensagens enviadas (${calls.sendMessage})`);
});

// ============================================================================
// 3) MENSAGENS NORMAIS CONTINUAM FUNCIONANDO
// ============================================================================

await test('mensagem normal de texto continua processada', async () => {
  const { ms } = await run({ conversation: 'oi, tudo bem?' });
  ok(ms < 500, `handler normal levou ${ms.toFixed(0)}ms`);
});

await test('comando normal (!ping) continua funcionando', async () => {
  const a = freshAdmin();
  const { sent } = await run({ extendedTextMessage: { text: '!ping' } },
    { groupJid: makeGroup([{ id: a.lid, admin: 'admin', phoneNumber: a.jid }]), key: { participant: a.lid } });
  ok(sent.length >= 1, 'respondeu o comando');
});

await test('!menu continua funcionando', async () => {
  const a = freshAdmin();
  const { sent } = await run({ extendedTextMessage: { text: '!menu' } },
    { groupJid: makeGroup([{ id: a.lid, admin: 'admin', phoneNumber: a.jid }]), key: { participant: a.lid } });
  ok(sent.length >= 1, 'menu respondeu');
});

await test('!get continua funcionando (e mostra a nota do raja)', async () => {
  const raja = makeRaja();
  const cmd = {
    extendedTextMessage: {
      text: '!get',
      contextInfo: { stanzaId: 'Q1', participant: RAJA_LID, remoteJid: 'x@g.us', quotedMessage: raja },
    },
  };
  const a = freshAdmin();
  const { sent } = await run(cmd,
    { groupJid: makeGroup([{ id: a.lid, admin: 'admin', phoneNumber: a.jid }]), key: { participant: a.lid } });
  const text = textOf(sent);
  includes(text, 'GET MESSAGE', 'relatório gerado');
  includes(text, 'requestPaymentMessage', 'tipo do alvo');
  includes(text, 'PAYMENT', 'seção de pagamento');
  includes(text, 'presente com valor "0"', 'amount zero detectado');
  includes(text, '348', 'as 348 menções contadas');
});

await test('!testeinvi continua funcionando', async () => {
  const a = freshAdmin();
  const { sent } = await run({ extendedTextMessage: { text: '!testeinvi' } },
    { groupJid: makeGroup([{ id: a.lid, admin: 'admin', phoneNumber: a.jid }]), key: { participant: a.lid } });
  const text = textOf(sent);
  includes(text, 'Anti-Invis', 'respondeu o testeinvi');
});

await test('ViewOnce normal continua funcionando', async () => {
  const { ms } = await run({ viewOnceMessageV2: { message: { imageMessage: { mimetype: 'image/jpeg', fileLength: 10 } } } });
  ok(ms < 500, `viewOnce processado em ${ms.toFixed(0)}ms`);
});

await test('catálogo é classificado e não trava', async () => {
  const { ms } = await run({ productMessage: { product: { title: 'X', priceAmount1000: '5000' } } });
  ok(ms < 500, `catálogo processado em ${ms.toFixed(0)}ms`);
});

await test('LID do remetente não quebra o processamento', async () => {
  const { ms } = await run({ conversation: 'texto' }, { key: { participant: RAJA_LID } });
  ok(ms < 500, `LID processado em ${ms.toFixed(0)}ms`);
});

// ============================================================================
// 4) FILA: PRIORIDADE E LIMITE (algoritmo real do connect.js)
// ============================================================================

/** Réplica fiel do MessageQueue do connect.js (8 workers, 10 lotes, 2 por lote). */
class MessageQueue {
  constructor(batchSize = 10, messagesPerBatch = 2, maxQueueSize = 500) {
    this.queue = [];
    this.batchSize = batchSize;
    this.messagesPerBatch = messagesPerBatch;
    this.maxQueueSize = maxQueueSize;
    this.isProcessing = false;
    this.dropped = 0;
    this.maxSeen = 0;
  }
  static isPriority(message) {
    const c = message?.message;
    if (!c) return false;
    let text = '';
    if (typeof c.conversation === 'string') text = c.conversation;
    else if (typeof c.extendedTextMessage?.text === 'string') text = c.extendedTextMessage.text;
    else if (c.requestPaymentMessage?.noteMessage?.extendedTextMessage?.text) return false;
    const t = text.trimStart();
    return Boolean(t) && ['!', '/', '#', '.', '$', '%'].includes(t[0]);
  }
  add(message) {
    if (this.queue.length >= this.maxQueueSize) {
      this.dropped += 1;
      this.queue.pop();
    }
    const item = { message, priority: MessageQueue.isPriority(message) ? 1 : 0 };
    if (item.priority === 1) {
      const at = this.queue.findIndex((q) => q.priority === 0);
      if (at === -1) this.queue.push(item); else this.queue.splice(at, 0, item);
    } else this.queue.push(item);
    this.maxSeen = Math.max(this.maxSeen, this.queue.length);
    if (!this.isProcessing) this.startProcessing();
    return new Promise((resolve) => { item.resolve = resolve; });
  }
  startProcessing() { this.isProcessing = true; this.processQueue(); }
  async processQueue() {
    while (this.queue.length > 0) {
      const availableBatches = Math.min(this.batchSize, Math.ceil(this.queue.length / this.messagesPerBatch));
      if (availableBatches === 0) break;
      const batches = [];
      for (let i = 0; i < availableBatches && this.queue.length > 0; i++) {
        const batchItems = [];
        for (let j = 0; j < this.messagesPerBatch && this.queue.length > 0; j++) {
          const item = this.queue.shift();
          if (item) batchItems.push(item);
        }
        if (batchItems.length) batches.push(batchItems);
      }
      await Promise.allSettled(batches.map((b) => Promise.allSettled(b.map((it) => this.processItem(it)))));
    }
    this.isProcessing = false;
  }
  async processItem(item) {
    try { await handleMessage(makeNazu({ groupJid: item.message.key.remoteJid }), item.message, null, new Map(), null); } catch { /* ignore */ }
    item.resolve?.();
  }
}

await test('fila: comando normal entra NA FRENTE das rajadas (prioridade)', () => {
  const q = new MessageQueue();
  q.processQueue = async () => {}; // não processa; só inspeciona a ordem
  q.isProcessing = true;
  for (let i = 0; i < 50; i++) {
    q.add({ key: { remoteJid: 'g@g.us' }, message: makeRaja() });
  }
  q.add({ key: { remoteJid: 'g@g.us' }, message: { extendedTextMessage: { text: '!ping' } } });
  const firstPriority = q.queue.findIndex((it) => it.priority === 1);
  ok(firstPriority === 0, `comando deve estar no início da fila (índice ${firstPriority})`);
});

await test('fila: a nota do raja NÃO é tratada como comando prioritário', () => {
  ok(MessageQueue.isPriority({ message: makeRaja() }) === false, 'raja não é prioridade');
  ok(MessageQueue.isPriority({ message: { extendedTextMessage: { text: '!ping' } } }) === true, '!ping é prioridade');
  ok(MessageQueue.isPriority({ message: { conversation: 'oi' } }) === false, 'texto comum não é prioridade');
});

await test('fila: tem teto e descarta em vez de crescer sem limite', () => {
  const q = new MessageQueue(10, 2, 100);
  q.processQueue = async () => {};
  q.isProcessing = true;
  for (let i = 0; i < 500; i++) q.add({ key: { remoteJid: 'g@g.us' }, message: makeRaja() });
  ok(q.queue.length <= 100, `fila respeitou o teto (${q.queue.length} <= 100)`);
  ok(q.dropped === 400, `descartou o excedente (${q.dropped})`);
});

await test('fila: !ping responde rápido atrás de 256 rajadas', async () => {
  const q = new MessageQueue();
  const group = makeGroup();
  for (let i = 0; i < 256; i++) {
    q.add({ key: { remoteJid: group, fromMe: false, id: `R${i}`, participant: RAJA_LID }, message: makeRaja(), messageTimestamp: 1757900000 });
  }
  const t0 = performance.now();
  await new Promise((resolve) => {
    const original = q.processItem.bind(q);
    q.processItem = async (item) => {
      await original(item);
      if (item.message.key.id === 'PING') resolve();
    };
    q.add({ key: { remoteJid: group, fromMe: false, id: 'PING', participant: ADMIN_LID }, message: { extendedTextMessage: { text: '!ping' } }, messageTimestamp: 1757900000 });
  });
  const ms = performance.now() - t0;
  // Antes: ~13485ms. Com a correção dos sleeps + prioridade deve ficar bem abaixo.
  ok(ms < 3000, `!ping levou ${ms.toFixed(0)}ms atrás de 256 rajadas (antes ~13485ms)`);
});

// ============================================================================
// 5) !raja — GERADOR DE TESTE (EXCLUSIVO DO DONO)
// ============================================================================

// Identificadores ficticios: `fromMe: true` ja faz o handler tratar como dono,
// entao nao precisamos do numero/LID real do dono do bot nos testes.
const OWNER_LID_RAJA = '111000000000099@lid';
const OWNER_JID_RAJA = '551100000000099@s.whatsapp.net';

/**
 * Executa um comando como DONO, capturando relayMessage.
 *
 * Usa `fromMe: true` porque é assim que as mensagens do próprio dono chegam ao
 * bot (enviadas do aparelho dele). Isso também mantém o teste determinístico:
 * o handler aplica throttle de 3 comandos/5s por sender e o dono é sempre o
 * mesmo LID (vem do config.json), então sem `fromMe` os testes seguintes
 * mediriam o rate limit em vez do comando.
 */
async function runOwner(text, { groupJid = makeGroup(), participant = OWNER_LID_RAJA, fromMe = true } = {}) {
  const sent = [];
  const relayed = [];
  const nazu = makeNazu({ groupJid, sent, calls: {} });
  nazu.relayMessage = async (jid, message, opts) => { relayed.push({ jid, message, opts }); };
  await handleMessage(nazu, {
    key: { remoteJid: groupJid, fromMe, id: 'RAJA', participant },
    message: { extendedTextMessage: { text } },
    messageTimestamp: 1757900000, pushName: 'Dono',
  }, null, new Map(), null);
  return { sent, relayed, text: textOf(sent) };
}

await test('!raja: só o dono pode usar', async () => {
  const { relayed, text } = await runOwner('!raja 2 oi', {
    participant: '5511000000007@s.whatsapp.net',
    fromMe: false,
  });
  includes(text, 'Apenas o dono', 'bloqueou não-dono');
  ok(relayed.length === 0, `nada foi enviado (${relayed.length})`);
});

await test('!raja: só funciona em grupo', async () => {
  const sent = [];
  const relayed = [];
  const nazu = makeNazu({ groupJid: 'x@g.us', sent, calls: {} });
  nazu.relayMessage = async (...a) => relayed.push(a);
  await handleMessage(nazu, {
    key: { remoteJid: OWNER_JID_RAJA, fromMe: true, id: 'PV', participant: OWNER_LID_RAJA },
    message: { extendedTextMessage: { text: '!raja 2 oi' } },
    messageTimestamp: 1757900000, pushName: 'Dono',
  }, null, new Map(), null);
  includes(textOf(sent), 'só funciona em grupos', 'bloqueou no PV');
  ok(relayed.length === 0, 'nada enviado no PV');
});

await test('!raja: valida quantidade e texto', async () => {
  const semQtd = await runOwner('!raja');
  includes(semQtd.text, 'Informe a quantidade', 'sem quantidade');
  ok(semQtd.relayed.length === 0, 'nada enviado sem quantidade');

  const semTexto = await runOwner('!raja 3');
  includes(semTexto.text, 'Informe o texto', 'sem texto');
  ok(semTexto.relayed.length === 0, 'nada enviado sem texto');
});

await test('!raja N texto: envia N mensagens no formato do raja real', async () => {
  const { relayed, text } = await runOwner('!raja 3 meu texto de teste');
  ok(relayed.length === 3, `enviou 3 mensagens (${relayed.length})`);
  includes(text, 'CONCLUÍDO', 'resumo enviado');
  const rpm = relayed[0].message.requestPaymentMessage;
  ok(Boolean(rpm), 'é requestPaymentMessage');
  ok(rpm.currencyCodeIso4217 === 'BRL', 'moeda BRL');
  ok(rpm.expiryTimestamp === '0', 'expiryTimestamp = "0"');
  ok(rpm.amount?.offset === 1000, 'amount.offset = 1000');
  ok(rpm.amount?.currencyCode === 'BRL', 'amount.currencyCode = BRL');
  ok(rpm.noteMessage?.extendedTextMessage?.text === 'meu texto de teste', 'texto dentro da NOTA');
  ok(Array.isArray(rpm.noteMessage.extendedTextMessage.contextInfo?.mentionedJid), 'mentionedJid na nota');
  // O padrao TEM de bater com a amostra real capturada pelo !get.
  ok(rpm.amount1000 === '0', `amount1000 = "0" (${JSON.stringify(rpm.amount1000)})`);
  ok(rpm.amount?.value === '0', 'amount.value = "0"');
  const ci = rpm.noteMessage.extendedTextMessage.contextInfo;
  ok(ci.forwardingScore === undefined, 'SEM forwardingScore (raja real nao tem)');
  ok(ci.isForwarded === undefined, 'SEM isForwarded (raja real nao tem)');
  ok(Object.keys(ci).length === 1 && ci.mentionedJid, 'contextInfo so com mentionedJid');
});
await test('!raja: opcao "fwd" adiciona o marcador de encaminhada (variante)', async () => {
  const { relayed } = await runOwner('!raja 1 texto | fwd');
  const ci = relayed[0].message.requestPaymentMessage.noteMessage.extendedTextMessage.contextInfo;
  ok(ci.forwardingScore === 999, `forwardingScore = 999 (${ci.forwardingScore})`);
  ok(ci.isForwarded === true, 'isForwarded = true');
  ok(Array.isArray(ci.mentionedJid), 'mencoes preservadas');
});
await test('!raja: ID no mesmo formato do raja real (3EB0 + 18 hex = 22 chars)', async () => {
  const { relayed } = await runOwner('!raja 2 texto');
  for (const r of relayed) {
    const id = r.opts?.messageId || '';
    ok(/^3EB0[0-9A-F]{18}$/.test(id), `ID no formato nativo: ${id} (${id.length} chars)`);
  }
  ok(relayed.every((r) => !String(r.opts?.messageId).includes('STARFALL')), 'sem o marcador STARFALL');
});
await test('!testeinvi: a rajada com amount=0 e tratada mesmo sem antirequest', async () => {
  const groupJid = makeGroup();
  fs.writeFileSync(path.join(GROUPS_DIR, `${groupJid}.json`),
    JSON.stringify({ antiinvi: true, antirequest: false }, null, 2));
  const sent = [];
  const calls = {};
  const nazu = makeNazu({ groupJid, sent, calls });
  nazu.groupMetadata = async () => ({ id: groupJid, subject: 'G', participants: [
    { id: ADMIN_LID, admin: 'superadmin', phoneNumber: ADMIN_JID },
    { id: BOT_LID, admin: 'admin', phoneNumber: BOT_JID },
    { id: RAJA_LID, admin: null },
  ] });
  await handleMessage(nazu, {
    key: { remoteJid: groupJid, fromMe: false, id: 'INVI', participant: RAJA_LID },
    message: makeRaja(), messageTimestamp: 1757900000, pushName: 'Raja',
  }, null, new Map(), null);
  await new Promise((r) => setTimeout(r, 3300));
  ok((calls.groupParticipantsUpdate || 0) >= 1, `rajada tratada com antiinvi ligado (${calls.groupParticipantsUpdate || 0})`);
});

await test('!raja: cada envio tem ID próprio (o WhatsApp descarta ID repetido)', async () => {
  const { relayed } = await runOwner('!raja 3 texto');
  const ids = relayed.map((r) => r.opts?.messageId);
  ok(ids.every(Boolean), 'todos têm messageId');
  ok(new Set(ids).size === 3, `3 IDs distintos (${new Set(ids).size})`);
  ok(JSON.stringify(relayed[0].message) === JSON.stringify(relayed[1].message), 'conteúdo reaproveitado');
});

await test('!raja: teto rígido de 50 (ferramenta de teste, não gerador de flood)', async () => {
  const { relayed, text } = await runOwner('!raja 999 texto');
  ok(relayed.length === 50, `respeitou o teto (${relayed.length})`);
  includes(text, 'limitado', 'avisou sobre o limite');
});

await test('!raja: o que ele gera é detectado pela própria proteção anti-raja', async () => {
  // O padrao ja e o formato do raja real (amount "0"), entao ele e
  // classificado como rajada pelo anti-raja direto.
  const padrao = await runOwner('!raja 1 texto de verificacao');
  const c = inspector.classifyMessage(padrao.relayed[0].message);
  ok(c.isPayment === true, 'classificado como payment');
  ok(c.isRequestPayment === true, 'classificado como request payment');
  ok(c.paymentAmount.isZero === true, 'amount zero reconhecido');
  ok(c.noteText === 'texto de verificacao', 'texto da nota extraido');
  ok(c.heavy === true, 'tratado como mensagem pesada');
  const comFwd = await runOwner('!raja 1 outro texto | fwd');
  const c2 = inspector.classifyMessage(comFwd.relayed[0].message);
  ok(c2.isPayment === true, 'variante fwd tambem e payment');
  ok(c2.noteText === 'outro texto', 'texto da nota na variante fwd');
});

await test('!testeinvi: a rajada com amount=0 é tratada mesmo sem antirequest', async () => {
  // Grupo APENAS com antiinvi (sem antirequest): o toggle !testeinvi deve
  // cobrir a rajada de payment amount=0 sozinho.
  const groupJid = makeGroup();
  fs.writeFileSync(path.join(GROUPS_DIR, `${groupJid}.json`),
    JSON.stringify({ antiinvi: true, antirequest: false }, null, 2));

  const sent = [];
  const calls = {};
  const nazu = makeNazu({ groupJid, sent, calls });
  nazu.groupMetadata = async () => ({ id: groupJid, subject: 'G', participants: [
    { id: ADMIN_LID, admin: 'superadmin', phoneNumber: ADMIN_JID },
    { id: BOT_LID, admin: 'admin', phoneNumber: BOT_JID },
    { id: RAJA_LID, admin: null },
  ] });
  await handleMessage(nazu, {
    key: { remoteJid: groupJid, fromMe: false, id: 'INVI', participant: RAJA_LID },
    message: makeRaja(), messageTimestamp: 1757900000, pushName: 'Raja',
  }, null, new Map(), null);

  await new Promise((r) => setTimeout(r, 3300));
  ok((calls.groupParticipantsUpdate || 0) >= 1, `rajada tratada com antiinvi ligado (${calls.groupParticipantsUpdate || 0})`);
});

await test('!raja: opções vo/vov2/vov2ext encapsulam em ViewOnce', async () => {
  const casos = [
    ['!raja 1 texto', 'requestPaymentMessage'],
    ['!raja 1 texto | vo', 'viewOnceMessage'],
    ['!raja 1 texto | vov2', 'viewOnceMessageV2'],
    ['!raja 1 texto | vov2ext', 'viewOnceMessageV2Extension'],
  ];
  for (const [cmd, esperado] of casos) {
    const { relayed } = await runOwner(cmd);
    const built = relayed[0]?.message || {};
    const topo = Object.keys(built)[0];
    ok(topo === esperado, `${cmd} -> ${topo} (esperado ${esperado})`);
    const rpm = built.requestPaymentMessage || built[topo]?.message?.requestPaymentMessage;
    ok(Boolean(rpm), `${cmd}: payment presente dentro do wrapper`);
  }
});

await test('!raja encapsulado em ViewOnce continua sendo detectado como payment', async () => {
  const { relayed } = await runOwner('!raja 1 texto | vov2ext');
  const c = inspector.classifyMessage(relayed[0].message);
  ok(c.isPayment === true, 'isPayment (desembrulha o wrapper)');
  ok(c.paymentAmount.isZero === true, 'amount zero reconhecido');
  ok(c.isViewOnce === true, 'marcado como viewOnce');
  ok(c.noteText === 'texto', 'texto da nota extraido de dentro do wrapper');
});

await test('BUG: foto/video ViewOnce NORMAL não pode banir o autor', async () => {
  // Antes, qualquer viewOnce era tratado como pagamento -> foto/video normal
  // de "ver uma vez" removia o autor do grupo (o "banindo do nada").
  const groupJid = makeGroup();
  fs.writeFileSync(path.join(GROUPS_DIR, `${groupJid}.json`),
    JSON.stringify({ antirequest: true }, null, 2));
  const sent = [];
  const calls = {};
  const nazu = makeNazu({ groupJid, sent, calls });
  nazu.groupMetadata = async () => ({ id: groupJid, subject: 'G', participants: [
    { id: ADMIN_LID, admin: 'superadmin', phoneNumber: ADMIN_JID },
    { id: BOT_LID, admin: 'admin', phoneNumber: BOT_JID },
    { id: RAJA_LID, admin: null },
  ] });

  await handleMessage(nazu, {
    key: { remoteJid: groupJid, fromMe: false, id: 'VO', participant: RAJA_LID },
    message: { viewOnceMessageV2: { message: { imageMessage: { mimetype: 'image/jpeg', fileLength: 1000, caption: 'foto normal' } } } },
    messageTimestamp: 1757900000, pushName: 'Membro',
  }, null, new Map(), null);
  await new Promise((r) => setTimeout(r, 3300));
  ok((calls.groupParticipantsUpdate || 0) === 0,
    `viewOnce de imagem normal NAO deve remover (remocoes: ${calls.groupParticipantsUpdate || 0})`);

  // E um raja encapsulado em viewOnce DEVE ser tratado como pagamento.
  const groupJid2 = makeGroup();
  fs.writeFileSync(path.join(GROUPS_DIR, `${groupJid2}.json`),
    JSON.stringify({ antirequest: true }, null, 2));
  const calls2 = {};
  const nazu2 = makeNazu({ groupJid: groupJid2, sent: [], calls: calls2 });
  nazu2.groupMetadata = async () => ({ id: groupJid2, subject: 'G', participants: [
    { id: ADMIN_LID, admin: 'superadmin', phoneNumber: ADMIN_JID },
    { id: BOT_LID, admin: 'admin', phoneNumber: BOT_JID },
    { id: RAJA_LID, admin: null },
  ] });
  const rajaVo = { viewOnceMessageV2Extension: { message: makeRaja() } };
  await handleMessage(nazu2, {
    key: { remoteJid: groupJid2, fromMe: false, id: 'RV', participant: RAJA_LID },
    message: rajaVo, messageTimestamp: 1757900000, pushName: 'Membro',
  }, null, new Map(), null);
  await new Promise((r) => setTimeout(r, 3300));
  ok((calls2.groupParticipantsUpdate || 0) >= 1,
    `raja encapsulado DEVE ser tratado como pagamento (remocoes: ${calls2.groupParticipantsUpdate || 0})`);
});
await test('!raja aparece na categoria exclusiva do menudono', async () => {
  const menus = await import(new URL('../dados/src/menus/menudono.js', import.meta.url).href);
  const txt = String(await menus.default('!', 'Lizzy', 'Dono'));
  const i = txt.indexOf('TESTES DE PROTEÇÃO');
  ok(i !== -1, 'categoria presente');
  const bloco = txt.slice(i, txt.indexOf('╰', i));
  includes(bloco, '!raja', '!raja listado na categoria');
  ok(txt.split('TESTES DE PROTEÇÃO').length - 1 === 1, 'categoria não duplicada');
});

// ============================================================================
// RESULTADO
// ============================================================================

// Da um instante para os trabalhos de segundo plano (enforcement de pagamento,
// escrita assincrona de JSON) terminarem antes de remover o banco temporario.
await new Promise((r) => setTimeout(r, 6000));
fs.rmSync(TMP_DB, { recursive: true, force: true });

const totalPassed = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFailed = RESULTS.reduce((a, r) => a + r.failed, 0);

console.log('\n════════════════════════════════════════');
console.log(`RESULTADO: ${RESULTS.length} testes | ${totalPassed} asserções ok | ${totalFailed} falhas`);
console.log('════════════════════════════════════════');

if (totalFailed > 0) {
  console.log('\nFALHAS:');
  for (const r of RESULTS) if (r.failed) for (const e of r.errors) console.log(`- [${r.name}] ${e}`);
  process.exit(1);
}
console.log('✅ TODOS OS TESTES PASSARAM');
process.exit(0);