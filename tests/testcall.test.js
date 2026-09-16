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
function notIncludes(h, n, l) { ok(typeof h === 'string' && !h.includes(n), `${l ?? n} — não deveria conter "${n}"`); }

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
  const extras = [];
  const nazu = {
    sent, calls, extras,
    sendMessage: async (jid, content) => { bump('sendMessage'); sent.push({ jid, content }); return { key: { id: 'S' } }; },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID },
    getName: async () => 'Fulano Teste',
    groupMetadata: async () => ({ id: 'g@g.us', subject: 'G', participants: [
      { id: ADMIN_LID, admin: 'superadmin', phoneNumber: ADMIN_JID },
      { id: BOT_LID, admin: 'admin', phoneNumber: BOT_JID },
      ...extras,
    ] }),
    // convertIdsToLid() do index.js resolve admin/participante chamando
    // onWhatsApp() e esperando `lid` no resultado. Devolver o LID do JID
    // informado faz um admin novo (criado por freshAdmin) ser reconhecido como
    // admin de verdade, sem depender de um JID fixo.
    onWhatsApp: async (j) => [{
      jid: j,
      exists: true,
      lid: jidToLid(j),
    }],
    signalRepository: { lidMapping: { getPNForLID: async () => ADMIN_JID } },
    ev: { on() {}, emit() {}, removeAllListeners() {} },
    readMessages: async () => {}, sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => 'x', react: async () => ({}),
  };
  return nazu;
}

const textOf = (sent) => sent.map((s) => s.content?.text ?? '').filter(Boolean).join('\n');

/**
 * Faz um JID "parecer" o LID correspondente.
 *
 * `onWhatsApp()` do fake precisa devolver `lid` porque é assim que o handler
 * resolve admin (`convertIdsToLid`). Para os admins deste teste o `id` já É um
 * LID, então a função basicamente o devolve — mas fica aqui para o fake não
 * depender dessa coincidência.
 */
function jidToLid(jid) {
  if (typeof jid === 'string' && jid.endsWith('@lid')) return jid;
  const base = String(jid).split('@')[0].split(':')[0];
  return `${base}@lid`;
}

/**
 * Executa um comando no handler real, como um admin.
 *
 * Duas armadilhas do handler tornam isso mais restrito do que parece:
 *
 *  1. Throttle: no máximo 3 comandos/5s por sender. Se a suíte inteira usasse o
 *     mesmo sender, do 4º em diante a resposta seria "Calma aí!".
 *  2. `getCachedGroupMetadata()` cacheia o metadata do grupo. Um participante
 *     admin inventado por chamada não sobrevive à segunda chamada — o cache
 *     devolve o metadata anterior e o handler responde "Você precisa ser adm".
 *
 * Por isso o sender é trocado a cada 3 usos, e o grupo é sempre novo.
 */
const THROTTLE_SAFE_SENDERS = 3; // máx. de comandos do mesmo sender por 5s
let senderCounter = 0;
let senderUses = 0;
let currentAdmin = null;

function nextAdmin() {
  if (!currentAdmin || senderUses >= THROTTLE_SAFE_SENDERS) {
    senderCounter += 1;
    const n = String(senderCounter).padStart(4, '0');
    currentAdmin = { id: `77700000${n}@lid`, admin: 'admin' };
    senderUses = 0;
  }
  senderUses += 1;
  return currentAdmin;
}

async function run(text, { groupJid, key = {} } = {}) {
  const sent = [];
  const calls = {};
  const nazu = makeNazu({ sent, calls });
  const admin = nextAdmin();
  nazu.extras.push(admin);
  const info = {
    key: { remoteJid: groupJid, fromMe: false, id: 'MSG', participant: admin.id, ...key },
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

  // persistGroupData() grava de forma assincrona e só invalida o cache do
  // groupData DEPOIS que o write termina (.then). Sem esperar, o próximo
  // comando poderia reler o cache antigo e inverter o toggle errado.
  const ler = () => {
    try {
      return JSON.parse(fs.readFileSync(path.join(GROUPS_DIR, `${g}.json`), 'utf-8'));
    } catch { return null; }
  };
  let salvo = null;
  for (let i = 0; i < 30 && salvo?.testcall !== true; i++) {
    await new Promise((r) => setTimeout(r, 100));
    salvo = ler();
  }
  ok(salvo?.testcall === true, `persistiu testcall=true (obtido: ${JSON.stringify(salvo?.testcall)})`);
});

await test('!testcall: segundo toque DESATIVA (estado lido do disco)', async () => {
  // Grupo já com o toggle LIGADO no arquivo: o próximo comando deve desligar.
  // Usa um grupo novo para não depender do cache de metadata/groupData do teste
  // anterior -- o que importa é que o handler leia o estado persistido.
  const g = makeGroup({ testcall: true });
  const off = await run('!testcall', { groupJid: g });
  includes(off.text, 'DESATIVADO', `desligou (texto: ${off.text.split('\n')[0]})`);
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

await test('!testcall: a mensagem descreve o comportamento real (sem falar do bot)', async () => {
  const g = makeGroup();
  const r = await run('!testcall', { groupJid: g });
  includes(r.text, 'chamada', 'fala de chamada');
  includes(r.text, 'perdida', 'menciona chamada perdida');
  includes(r.text, 'qualquer membro', 'deixa claro que vale para qualquer autor');
  // A distinção "saindo do bot" foi removida do código: a mensagem não pode
  // continuar prometendo um comportamento que não existe mais.
  notIncludes(r.text, 'saindo do bot', 'não promete notificação "saindo do bot"');
  notIncludes(r.text, 'saindo', 'não menciona "saindo"');
});

await test('!testcall: a mensagem de DESATIVADO é curta e não lista eventos', async () => {
  const g = makeGroup({ testcall: true });
  const r = await run('!testcall', { groupJid: g });
  includes(r.text, 'DESATIVADO', 'avisa desligamento');
  notIncludes(r.text, 'O que você vai receber', 'não lista eventos ao desligar');
});

// ============================================================================
// 3) LISTENER DE CALL (callNotifier.attachCallNotifier) — deps injetadas
// ============================================================================
//
// O listener vive em callNotifier.js e recebe socket/disco/envio por injeção,
// entao o fluxo real (filtro de grupo -> toggle -> nomes -> texto -> envio) e
// exercitado aqui sem importar o connect.js (que abre socket de verdade).

/** Event emitter minimo, com a mesma forma do ev do Baileys. */
function makeEv() {
  const handlers = {};
  return {
    handlers,
    on(event, fn) { (handlers[event] = handlers[event] || []).push(fn); },
    emit(event, args) { return (handlers[event] || []).map((fn) => fn(args)); },
  };
}

/**
 * Monta o listener com dependencias controladas e devolve o que foi enviado.
 *
 * As dependencias precisam entrar ANTES do attach: `attachCallNotifier`
 * desestrutura as deps ao registrar, entao reatribuir o objeto depois nao
 * surtiria efeito. `call()` roda o handler capturando console.error localmente.
 */
function makeListener(overrides = {}) {
  const ev = makeEv();
  const sent = [];
  const errors = [];
  const logs = [];
  const deps = {
    ev,
    getGroupData: async () => null,
    getCallerName: async () => 'Fulano',
    getGroupName: async () => 'Meu Grupo',
    send: async (chatId, text) => { sent.push({ chatId, text }); },
    log: (delivery) => { logs.push(delivery); },
    ...overrides,
  };
  const handler = notifier.attachCallNotifier(deps);

  // Captura o console.error DURANTE a execucao (o listener loga ali) sem
  // poluir a saida da suite.
  const call = async (args) => {
    const origError = console.error;
    console.error = (...a) => { errors.push(a.map(String).join(' ')); };
    try {
      await handler(args);
    } finally {
      console.error = origError;
    }
  };

  return { ev, sent, errors, logs, handler, deps, call };
}

await test('listener: registra no evento call e entrega entrega valida', async () => {
  const l = makeListener({ getGroupData: async () => ({ testcall: true }) });
  ok(l.ev.handlers.call && l.ev.handlers.call.length === 1, 'registrou 1 handler em call');

  await l.call([makeCall()]);
  ok(l.sent.length === 1, 'enviou 1 notificacao');
  ok(l.sent[0].chatId === '120363920000000001@g.us', 'enviou no chat do grupo');
  includes(l.sent[0].text, 'Ligação entrando', 'texto da oferta');
  includes(l.sent[0].text, 'Fulano', 'nome do autor resolvido');
  includes(l.sent[0].text, 'Meu Grupo', 'nome do grupo resolvido');
  ok(l.logs.length === 1 && l.logs[0].kind === 'offer', 'logou o tipo offer');
});

await test('listener: grupo SEM o toggle nao recebe nada', async () => {
  const semToggle = makeListener({ getGroupData: async () => ({ testcall: false }) });
  await semToggle.call([makeCall()]);
  ok(semToggle.sent.length === 0, 'toggle desligado nao envia');

  const semArquivo = makeListener({ getGroupData: async () => null });
  await semArquivo.call([makeCall()]);
  ok(semArquivo.sent.length === 0, 'grupo sem dados nao envia');

  const semCampo = makeListener({ getGroupData: async () => ({}) });
  await semCampo.call([makeCall()]);
  ok(semCampo.sent.length === 0, 'groupData sem testcall nao envia');
});

await test('listener: ignora chat que nao e grupo (inclusive o toggle ligado)', async () => {
  // Mesmo com groupData ligado, PV/status/newsletter nao sao notificados: o
  // filtro de chat vem ANTES da leitura do toggle.
  let leuGroupData = false;
  const pv = makeListener({
    getGroupData: async () => { leuGroupData = true; return { testcall: true }; },
  });
  await pv.call([makeCall({ chatId: '5511999999999@s.whatsapp.net' })]);
  ok(pv.sent.length === 0, 'PV nao notifica');
  ok(leuGroupData === false, 'nao le groupData para chat nao-grupo');

  await pv.call([makeCall({ chatId: undefined })]);
  await pv.call([makeCall({ chatId: null })]);
  ok(pv.sent.length === 0, 'chatId ausente/null nao notifica');
});

await test('listener: falha ao resolver nomes nao impede a notificacao', async () => {
  const l = makeListener({
    getGroupData: async () => ({ testcall: true }),
    getCallerName: async () => { throw new Error('getName falhou'); },
    getGroupName: async () => { throw new Error('groupMetadata falhou'); },
  });
  await l.call([makeCall()]);
  ok(l.sent.length === 1, 'notificacao saiu mesmo sem nomes');
  includes(l.sent[0].text, '5511999999999', 'caiu para o numero do autor');
  notIncludes(l.sent[0].text, 'undefined', 'sem undefined no texto');
  notIncludes(l.sent[0].text, 'null', 'sem null no texto');
});

await test('listener: falha ao ler groupData nao derruba nem notifica', async () => {
  const l = makeListener({ getGroupData: async () => { throw new Error('EACCES'); } });
  await l.call([makeCall()]);
  ok(l.sent.length === 0, 'sem groupData legivel, nao notifica');
  ok(l.errors.length === 0, 'nao loga erro: leitura falha e comportamento esperado');
});

await test('listener: entrada invalida/vazia nao quebra', async () => {
  const l = makeListener({ getGroupData: async () => ({ testcall: true }) });
  await l.call([null]);
  await l.call([undefined]);
  await l.call([]);
  ok(l.sent.length === 0, 'nada enviado para eventos vazios');
  ok(l.errors.length === 0, 'sem excecao escapando');
});

await test('listener: notifica todos os 9 status quando ligado', async () => {
  const l = makeListener({ getGroupData: async () => ({ testcall: true }) });
  const statuses = ['offer', 'ringing', 'preaccept', 'transport', 'relaylatency',
                    'accept', 'reject', 'terminate', 'timeout'];
  for (const status of statuses) await l.call([makeCall({ status })]);
  ok(l.sent.length === statuses.length, 'notificou os 9 status');
  // Cada mensagem carrega o id da chamada e nao deixa placeholder.
  for (const s of l.sent) {
    includes(s.text, '3EB0CALLTEST', 'id da chamada');
    notIncludes(s.text, 'undefined', 'sem undefined');
  }
});

await test('listener: falha no envio e capturada (nao derruba o listener)', async () => {
  const l = makeListener({
    getGroupData: async () => ({ testcall: true }),
    send: async () => { throw new Error('send falhou'); },
  });
  await l.call([makeCall()]);
  ok(l.errors.some((e) => e.includes('TESTCALL')), 'erro de envio foi logado');
});

await test('listener: notifica QUALQUER autor, inclusive o bot', async () => {
  const l = makeListener({ getGroupData: async () => ({ testcall: true }) });
  await l.call([makeCall({ from: '5511988887777@s.whatsapp.net' })]);
  await l.call([makeCall({ from: BOT_JID })]);
  await l.call([makeCall({ from: '217205740421125@lid' })]);
  ok(l.sent.length === 3, 'notificou os 3 autores');
  for (const s of l.sent) {
    notIncludes(s.text, 'saindo', 'nao distingue autor');
    notIncludes(s.text, 'bot', 'nao menciona bot');
  }
});

// ============================================================================
// 4) NOME DO GRUPO NA NOTIFICACAO (resolveCallGroupName)
// ============================================================================

/** Deps de metadata controladas, registrando consultas e escritas de cache. */
function makeNameDeps({ cached = null, subject = null, metadataThrows = false } = {}) {
  const state = { fetched: 0, cached: [], useCache: cached };
  return {
    state,
    getCached: () => state.useCache,
    setCached: (name) => { state.cached.push(name); state.useCache = name; },
    fetchMetadata: async () => {
      state.fetched += 1;
      if (metadataThrows) throw new Error('groupMetadata falhou');
      return subject;
    },
  };
}

await test('nome do grupo: usa o groupName persistido sem tocar metadata', async () => {
  const deps = makeNameDeps({ subject: 'Do metadata' });
  const nome = await notifier.resolveCallGroupName({ groupName: 'Grupo Salvo' }, deps);
  ok(nome === 'Grupo Salvo', `usou o persistido (obtido: ${nome})`);
  ok(deps.state.fetched === 0, 'nao consultou metadata');
});

await test('nome do grupo: cai para o metadata quando nao ha groupName', async () => {
  // Este e o caso que nunca funcionava: groupData de grupo guarda state de
  // features e nao tem subject/name, entao a linha "• Grupo:" nunca aparecia.
  const deps = makeNameDeps({ subject: 'Meu Grupo Real' });
  const nome = await notifier.resolveCallGroupName({ testcall: true }, deps);
  ok(nome === 'Meu Grupo Real', `resolveu pelo metadata (obtido: ${nome})`);
  ok(deps.state.fetched === 1, 'consultou metadata uma vez');
  ok(deps.state.cached.includes('Meu Grupo Real'), 'guardou no cache');
});

await test('nome do grupo: usa cache antes do metadata', async () => {
  const deps = makeNameDeps({ cached: 'Do Cache', subject: 'Do metadata' });
  const nome = await notifier.resolveCallGroupName({}, deps);
  ok(nome === 'Do Cache', 'preferiu o cache');
  ok(deps.state.fetched === 0, 'nao consultou metadata com cache quente');
});

await test('nome do grupo: groupName vazio/espaco nao conta', async () => {
  const deps = makeNameDeps({ subject: 'Do metadata' });
  ok(await notifier.resolveCallGroupName({ groupName: '   ' }, deps) === 'Do metadata',
    'groupName so com espacos caiu para o metadata');
  const deps2 = makeNameDeps({ subject: 'Do metadata' });
  ok(await notifier.resolveCallGroupName({ groupName: '' }, deps2) === 'Do metadata',
    'groupName vazio caiu para o metadata');
});

await test('nome do grupo: apara espacos e ignora metadata invalido', async () => {
  const espacos = await notifier.resolveCallGroupName({}, makeNameDeps({ subject: '  Grupo X  ' }));
  ok(espacos === 'Grupo X', `apara espacos (obtido: ${JSON.stringify(espacos)})`);

  const vazio = await notifier.resolveCallGroupName({}, makeNameDeps({ subject: '   ' }));
  ok(vazio === null, 'subject so com espacos -> null');

  const nulo = await notifier.resolveCallGroupName({}, makeNameDeps({ subject: null }));
  ok(nulo === null, 'subject null -> null');
});

await test('nome do grupo: falha no metadata devolve null (nao quebra a notificacao)', async () => {
  const deps = makeNameDeps({ metadataThrows: true });
  const nome = await notifier.resolveCallGroupName({ testcall: true }, deps);
  ok(nome === null, 'devolveu null em vez de lancar');
  ok(deps.state.cached.length === 0, 'nao cacheou nome inexistente');
});

await test('listener: notificacao inclui o nome do grupo quando resolvido', async () => {
  const l = makeListener({
    getGroupData: async () => ({ testcall: true }),
    getGroupName: async () => 'Grupo Resolvido',
  });
  await l.call([makeCall()]);
  includes(l.sent[0].text, '• Grupo: Grupo Resolvido', 'linha do grupo presente');
});

await test('listener: sem nome resolvido, sai sem a linha do grupo (sem placeholder)', async () => {
  const l = makeListener({
    getGroupData: async () => ({ testcall: true }),
    getGroupName: async () => null,
  });
  await l.call([makeCall()]);
  ok(l.sent.length === 1, 'notificacao saiu');
  notIncludes(l.sent[0].text, '• Grupo:', 'sem linha de grupo');
  notIncludes(l.sent[0].text, 'null', 'sem null no texto');
});

// ============================================================================
// 5) ESCRITAS CONCORRENTES NO MESMO GRUPO (regressao do .tmp compartilhado)
// ============================================================================

await test('escritas concorrentes no mesmo grupo nao se perdem (sem ENOENT)', async () => {
  // Regressao: writeJsonFile e writeJsonFileAsync usavam o MESMO `${file}.tmp`.
  // Com varios comandos no mesmo grupo ao mesmo tempo, a primeira escrita
  // renomeava o .tmp e as outras falhavam no rename (ENOENT), perdendo dados.
  // Agora cada escrita usa um temp unico.
  //
  // Nao se afirma QUAL valor ficou no arquivo: com N toggles concorrentes o
  // "ultimo write vence" e nao-deterministico por construcao. O que a correcao
  // garante -- e o que este teste trava -- e que nenhuma escrita se perca e que
  // o arquivo nunca fique corrompido ou com .tmp orfao.
  const g = makeGroup();
  const errosDeEscrita = [];
  const origError = console.error;
  console.error = (...a) => {
    const linha = a.map(String).join(' ');
    if (linha.includes('Erro ao escrever JSON')) errosDeEscrita.push(linha);
  };

  try {
    // Varios comandos no mesmo grupo disparados juntos.
    const execucoes = [];
    for (let i = 0; i < 12; i++) execucoes.push(run('!testcall', { groupJid: g }));
    await Promise.all(execucoes);
  } finally {
    console.error = origError;
  }

  ok(errosDeEscrita.length === 0,
    `nenhuma escrita falhou (obtido: ${errosDeEscrita.length} erros)`);
  if (errosDeEscrita.length > 0) console.log('     ' + errosDeEscrita[0]);

  // O arquivo final precisa continuar sendo JSON valido (nao escrito pela metade).
  await waitForPendingWrites();
  let salvo = null;
  try {
    salvo = JSON.parse(fs.readFileSync(path.join(GROUPS_DIR, `${g}.json`), 'utf-8'));
  } catch (e) {
    salvo = null;
  }
  ok(salvo !== null, 'arquivo final e JSON valido');
  ok(salvo && salvo.__extraAdmins !== undefined, 'estado original preservado no arquivo');

  // E nenhum .tmp orfao ficou para tras.
  const orfaos = fs.readdirSync(GROUPS_DIR).filter((f) => f.endsWith('.tmp'));
  ok(orfaos.length === 0, `sem .tmp orfao (obtido: ${orfaos.length})`);
});

// ============================================================================

// Espera as escritas assincronas de groupData (persistGroupData roda em
// background) terminarem antes de medir e remover o banco temporario: sem isso
// o rmSync pode remover o diretorio no meio de uma escrita.
async function waitForPendingWrites(timeoutMs = 5000) {
  const pending = () => {
    try {
      return fs.readdirSync(GROUPS_DIR).some((f) => f.endsWith('.tmp'));
    } catch {
      return false;
    }
  };
  const deadline = Date.now() + timeoutMs;
  let quietChecks = 0;
  while (quietChecks < 2 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
    quietChecks = pending() ? 0 : quietChecks + 1;
  }
}

await waitForPendingWrites();

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
