/**
 * `!callp` — sobe uma chamada de VOZ no grupo.
 *
 * Roda o handler REAL com socket falso. Desde a correção do "conectando..."
 * infinito, **quem cria a chamada é o motor de mídia** (medido no pacote
 * `lizzy-call`: `startGroupCall` faz o motor emitir o `<call><offer>`;
 * `joinVoipOngoingCall` é silencioso sem estado de call). Então o que este teste
 * mede é o que é do BOT:
 *
 *   - guardas (grupo, admin, mínimo de membros);
 *   - QUEM é convidado (todos menos o bot, deduplicado);
 *   - que a criação vai para a MÍDIA, não para a sinalização separada;
 *   - o registro da call ativa e o `encerrar`;
 *   - mensagens honestas quando a mídia não está disponível.
 *
 * Uso: node tests/callp.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-callp-'));
process.env.DATABASE_PATH = TMP_DB;
const GRUPOS_DIR = path.join(TMP_DB, 'grupos');
fs.mkdirSync(GRUPOS_DIR, { recursive: true });

const RESULTS = [];
let CURRENT = null;

function test(name, fn) {
  CURRENT = { name, passed: 0, failed: 0, errors: [] };
  RESULTS.push(CURRENT);
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      return r.then(() => finish(name)).catch((e) => {
        CURRENT.failed += 1; CURRENT.errors.push(`EXCEÇÃO: ${e?.stack || e}`); finish(name);
      });
    }
    finish(name);
  } catch (e) {
    CURRENT.failed += 1; CURRENT.errors.push(`EXCEÇÃO: ${e?.stack || e}`); finish(name);
  }
  return Promise.resolve();
}
function finish(name) {
  console.log(`${CURRENT.failed === 0 ? '✅' : '❌'} ${name} (${CURRENT.passed} ok, ${CURRENT.failed} falhas)`);
  for (const err of CURRENT.errors) console.log(`     ${err.split('\n')[0]}`);
}
function ok(cond, msg) {
  if (cond) CURRENT.passed += 1;
  else { CURRENT.failed += 1; CURRENT.errors.push(`ASSERT FALHOU: ${msg}`); }
}
function includes(hay, needle, label) {
  ok(typeof hay === 'string' && hay.includes(needle),
    `${label ?? needle} \u2014 esperado conter "${needle}"`);
}

// ============================================================================

const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;
if (typeof handleMessage !== 'function') throw new Error('index.js não exporta o handler');

const callState = await import(new URL('../dados/src/funcs/utils/callOffer.js', import.meta.url).href);
const callMedia = await import(new URL('../dados/src/funcs/utils/callMedia.js', import.meta.url).href);

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';

let groupCounter = 0;
let personCounter = 0;

function makeGroup(extra = {}) {
  groupCounter += 1;
  const jid = `1203638300000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(path.join(GRUPOS_DIR, `${jid}.json`),
    JSON.stringify({ groupName: `Grupo Callp ${groupCounter}`, ...extra }, null, 2));
  return jid;
}
function makePerson() {
  personCounter += 1;
  const n = String(personCounter).padStart(4, '0');
  return { lid: `5571${n}000000@lid`, jid: `5513${n}999999@s.whatsapp.net`, name: `5571${n}000000` };
}

/**
 * Dublê do motor de mídia: registra a criação/encerramento e permite forçar
 * falha. Assim o teste mede o CONTRATO do bot sem carregar WASM.
 */
function instalarDubleMidia({ ok = true, motivo = null, stage = 'pronta', callId = 'CALL-1' } = {}) {
  const chamadas = [];
  callMedia.__setDubleEntrar({
    entrar: async ({ grupo, participantes }) => {
      chamadas.push({ tipo: 'entrar', grupo, participantes });
      if (!ok) return { ok: false, motivo, stage: 'falhou' };
      return { ok: true, callId, stage };
    },
    sair: async (grupo) => { chamadas.push({ tipo: 'sair', grupo }); return { ok: true }; },
    estagio: () => stage
  });
  return chamadas;
}

function makeNazu({ sent, groupJid, participants }) {
  const map = {};
  for (const p of participants) { map[p.jid] = p.lid; map[p.lid] = p.jid; }
  return {
    sent,
    sendMessage: async (jid, content) => { sent.push({ jid, content }); return { key: { id: 'SENT' } }; },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
    onWhatsApp: async (jid) => (map[jid] ? [{ jid, exists: true, lid: map[jid] }] : [{ jid, exists: false }]),
    signalRepository: { lidMapping: { getPNForLID: async (lid) => map[lid] || null } },
    groupMetadata: async () => ({
      id: groupJid, subject: 'Grupo Callp',
      participants: participants.map((p) => ({ id: p.lid, admin: p.isAdmin ? 'admin' : null, phoneNumber: p.jid }))
    }),
    groupParticipantsUpdate: async () => ({}),
    groupRequestParticipantsList: async () => [],
    groupRequestParticipantsUpdate: async () => ({}),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {}, sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => null, react: async () => ({})
  };
}

async function run({ groupJid, sender, text, participants, sent = [] }) {
  const nazu = makeNazu({ sent, groupJid, participants });
  const info = {
    key: { remoteJid: groupJid, fromMe: false, id: `M-${Math.random().toString(36).slice(2, 10)}`, participant: sender.lid },
    message: { extendedTextMessage: { text, contextInfo: { remoteJid: groupJid, mentionedJid: [] } } },
    messageTimestamp: Math.floor(Date.now() / 1000),
    pushName: sender.name
  };
  await handleMessage(nazu, info, null, new Map(), null);
  return {
    text: sent.map((s) => s.content?.text ?? '').filter(Boolean).join('\n'),
    newsletter: sent.some((s) => s.content?.contextInfo?.forwardedNewsletterMessageInfo?.newsletterJid),
    sent
  };
}

function setup(n = 3) {
  const groupJid = makeGroup();
  const admin = makePerson();
  const outros = [];
  for (let i = 0; i < n; i++) outros.push(makePerson());
  const participants = [
    { lid: admin.lid, jid: admin.jid, isAdmin: true },
    ...outros.map((p) => ({ lid: p.lid, jid: p.jid, isAdmin: false })),
    { lid: BOT_LID, jid: BOT_JID, name: 'Lizzy', isAdmin: true }
  ];
  return { groupJid, admin, participants };
}

// ============================================================================
// 1) ESTADO
// ============================================================================

await test('o registro de calls ativas começa vazio e é isolado por grupo', () => {
  ok(callState.obterCall('a@g.us') === null, 'grupo desconhecido não tem call');
  callState.registrarCall('a@g.us', { callId: 'X' });
  ok(callState.obterCall('a@g.us').callId === 'X', 'registrou');
  ok(callState.obterCall('b@g.us') === null, 'outro grupo não vê a call');
  callState.limparCall('a@g.us');
  ok(callState.obterCall('a@g.us') === null, 'limpou');
});

// ============================================================================
// 2) GUARDAS
// ============================================================================

await test('!callp só em grupo', async () => {
  const { admin, participants } = setup(2);
  const chamadas = instalarDubleMidia();
  const out = await run({ groupJid: admin.jid, sender: admin, text: '!callp', participants });
  ok(chamadas.length === 0, 'não criou call no PV');
  void out;
});

await test('!callp só para admins', async () => {
  const { groupJid, participants } = setup(2);
  const membro = makePerson();
  participants.push({ lid: membro.lid, jid: membro.jid, isAdmin: false });
  const chamadas = instalarDubleMidia();
  const out = await run({ groupJid, sender: membro, text: '!callp', participants });
  includes(out.text, 'adm', 'avisa que precisa ser adm');
  ok(chamadas.length === 0, 'membro comum não sobe chamada');
});

await test('grupo pequeno (só o bot + quem pediu): recusa', async () => {
  const groupJid = makeGroup();
  const admin = makePerson();
  const participants = [
    { lid: admin.lid, jid: admin.jid, isAdmin: true },
    { lid: BOT_LID, jid: BOT_JID, name: 'Lizzy', isAdmin: true }
  ];
  const chamadas = instalarDubleMidia();
  const out = await run({ groupJid, sender: admin, text: '!callp', participants });
  ok(chamadas.length === 0, 'não criou call');
  includes(out.text, 'pelo menos 2 outros membros', 'explica a regra');
});

// ============================================================================
// 3) CRIAÇÃO — pelo MOTOR, não pela sinalização
// ============================================================================

await test('!callp cria a chamada pelo MOTOR de mídia', async () => {
  const { groupJid, admin, participants } = setup(3);
  const chamadas = instalarDubleMidia();
  const out = await run({ groupJid, sender: admin, text: '!callp', participants });
  const criou = chamadas.find((c) => c.tipo === 'entrar');
  ok(Boolean(criou), 'chamou o motor para criar a call');
  ok(criou.grupo === groupJid, 'passou o grupo certo');
  includes(out.text, 'Chamada de voz iniciada', 'avisa no grupo');
});

await test('!callp convida todos os membros menos o bot', async () => {
  const { groupJid, admin, participants } = setup(3);
  const chamadas = instalarDubleMidia();
  await run({ groupJid, sender: admin, text: '!callp', participants });
  const criou = chamadas.find((c) => c.tipo === 'entrar');
  const jids = criou.participantes;
  // admin + 3 outros = 4 humanos; o bot não entra na lista de convidados.
  ok(jids.length === 4, `convidou os 4 membros humanos (veio ${jids.length})`);
  ok(!jids.some((j) => String(j).startsWith(BOT_LID.split('@')[0])), 'não convidou a si mesmo');
  ok(new Set(jids.map((j) => String(j).split('@')[0])).size === jids.length, 'sem convidado repetido');
});

await test('o aviso carrega o cabeçalho de canal e o estado do áudio', async () => {
  const { groupJid, admin, participants } = setup(3);
  instalarDubleMidia({ stage: 'pronta' });
  const out = await run({ groupJid, sender: admin, text: '!callp', participants });
  ok(out.newsletter, 'tem o cabeçalho de newsletter');
  includes(out.text, 'Áudio: pronto', 'diz que o áudio está pronto');
  includes(out.text, '!musicap', 'ensina o comando');
});

await test('quando a mídia ainda está conectando, o aviso diz o estágio', async () => {
  const { groupJid, admin, participants } = setup(3);
  instalarDubleMidia({ stage: 'aguardando_roster' });
  const out = await run({ groupJid, sender: admin, text: '!callp', participants });
  includes(out.text, 'conectando', 'avisa que está conectando');
  includes(out.text, 'aguardando_roster', 'mostra o estágio');
});

await test('guarda a call ativa em memória', async () => {
  const { groupJid, admin, participants } = setup(3);
  instalarDubleMidia({ callId: 'CALL-ABC' });
  await run({ groupJid, sender: admin, text: '!callp', participants });
  const ativa = callState.obterCall(groupJid);
  ok(ativa && ativa.callId === 'CALL-ABC', 'registrou o id do motor');
  ok(!('callpCall' in JSON.parse(fs.readFileSync(path.join(GRUPOS_DIR, `${groupJid}.json`), 'utf-8'))),
    'não persistiu no JSON do grupo');
  callState.limparCall(groupJid);
});

await test('não sobe duas ao mesmo tempo', async () => {
  const { groupJid, admin, participants } = setup(3);
  instalarDubleMidia();
  await run({ groupJid, sender: admin, text: '!callp', participants });
  const chamadas2 = instalarDubleMidia();
  const out2 = await run({ groupJid, sender: admin, text: '!callp', participants });
  includes(out2.text, 'Já existe', 'avisa que já tem uma');
  ok(chamadas2.length === 0, 'não criou de novo');
  callState.limparCall(groupJid);
});

// ============================================================================
// 4) FALHAS E ENCERRAR
// ============================================================================

await test('mídia ausente: avisa e NÃO registra call', async () => {
  const { groupJid, admin, participants } = setup(3);
  instalarDubleMidia({ ok: false, motivo: 'pacote_de_midia_ausente' });
  const out = await run({ groupJid, sender: admin, text: '!callp', participants });
  includes(out.text, 'Não consegui subir', 'avisa');
  includes(out.text, 'lizzy-call', 'diz o que falta');
  ok(callState.obterCall(groupJid) === null, 'não deixou call pendurada');
});

await test('!callp encerrar derruba a mídia e limpa o estado', async () => {
  const { groupJid, admin, participants } = setup(3);
  instalarDubleMidia();
  await run({ groupJid, sender: admin, text: '!callp', participants });
  const chamadas2 = instalarDubleMidia();
  const out = await run({ groupJid, sender: admin, text: '!callp encerrar', participants });
  ok(chamadas2.some((c) => c.tipo === 'sair'), 'derrubou a pilha de mídia');
  includes(out.text, 'encerrada', 'avisa');
  ok(callState.obterCall(groupJid) === null, 'limpou o registro');
});

await test('!callp encerrar sem call ativa não inventa', async () => {
  const { groupJid, admin, participants } = setup(2);
  instalarDubleMidia();
  const out = await run({ groupJid, sender: admin, text: '!callp encerrar', participants });
  includes(out.text, 'Não há chamada', 'avisa');
});

// ============================================================================

callMedia.__setDubleEntrar(null);
callMedia.__setDuble(null);

const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log('\n' + '='.repeat(40));
console.log(`RESULTADO: ${RESULTS.length} testes | ${totalOk} asserções ok | ${totalFail} falhas`);
console.log('='.repeat(40));
if (totalFail > 0) process.exit(1);
