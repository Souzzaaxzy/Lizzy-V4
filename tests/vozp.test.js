/**
 * `!vozp` — CHAT DE VOZ no grupo (o "voice chat" do WhatsApp).
 *
 * É o mesmo fluxo do `!callp`, com UMA diferença que é o ponto todo: o motor
 * sobe a call com o marcador de voice chat (`isLightWeight`), então a chamada
 * NÃO toca para o grupo. O que este teste mede é o CONTRATO do bot:
 *
 *   - o flag de voice chat CHEGA no motor (e o `!callp` manda `false`);
 *   - guardas (grupo, admin, mínimo de membros);
 *   - a mensagem e o registro da call (marcada como chat de voz);
 *   - `!vozp encerrar` derruba;
 *   - recusa quando já existe call, dizendo QUAL é;
 *   - mensagens honestas quando a mídia não está disponível.
 *
 * Uso: node tests/vozp.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-vozp-'));
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
  ok(typeof hay === 'string' && hay.includes(needle), `${label ?? needle} — esperado conter "${needle}"`);
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
  const jid = `1203638400000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(path.join(GRUPOS_DIR, `${jid}.json`),
    JSON.stringify({ groupName: `Grupo Vozp ${groupCounter}`, ...extra }, null, 2));
  return jid;
}
function makePerson() {
  personCounter += 1;
  const n = String(personCounter).padStart(4, '0');
  return { lid: `5572${n}000000@lid`, jid: `5514${n}999999@s.whatsapp.net`, name: `5572${n}000000` };
}

/**
 * Dublê do motor de mídia: registra se o pedido foi (ou não) voice chat.
 * Assim o teste prova o flag sem carregar WASM.
 */
function instalarDubleMidia({ ok = true, motivo = null, stage = 'pronta', callId = 'VC-1' } = {}) {
  const chamadas = [];
  callMedia.__setDubleEntrar({
    entrar: async (opts) => {
      chamadas.push({ tipo: 'entrar', ...opts });
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
      id: groupJid, subject: 'Grupo Vozp',
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
// 1) O FLAG DE VOICE CHAT CHEGA NO MOTOR
// ============================================================================

await test('!vozp pede VOICE CHAT ao motor (isLightWeight=true)', async () => {
  const { groupJid, admin, participants } = setup(3);
  const chamadas = instalarDubleMidia();
  await run({ groupJid, sender: admin, text: '!vozp', participants });
  const criou = chamadas.find((c) => c.tipo === 'entrar');
  ok(Boolean(criou), 'chamou o motor');
  ok(criou.voiceChat === true, `voiceChat=true (veio ${criou.voiceChat})`);
});

await test('!callp continua pedindo CHAMADA comum (voiceChat=false)', async () => {
  const { groupJid, admin, participants } = setup(3);
  const chamadas = instalarDubleMidia();
  await run({ groupJid, sender: admin, text: '!callp', participants });
  const criou = chamadas.find((c) => c.tipo === 'entrar');
  ok(Boolean(criou), 'chamou o motor');
  ok(criou.voiceChat === false, `voiceChat=false (veio ${criou.voiceChat})`);
});

await test('callMedia repassa voiceChat como isLightWeight para o pacote', () => {
  // O contrato que liga o bot ao `lizzy-call`: a opção `voiceChat` vira
  // `isLightWeight` na chamada do motor. Trava a ligação (o WASM só marca voice
  // chat por esse parâmetro).
  const src = fs.readFileSync(path.join(HERE, '..', 'dados/src/funcs/utils/callMedia.js'), 'utf-8');
  includes(src, 'isLightWeight: !!voiceChat', 'isLightWeight ligado ao voiceChat');
});

// ============================================================================
// 2) GUARDAS
// ============================================================================

await test('!vozp só em grupo', async () => {
  const { admin, participants } = setup(2);
  const chamadas = instalarDubleMidia();
  const out = await run({ groupJid: admin.jid, sender: admin, text: '!vozp', participants });
  ok(chamadas.length === 0, 'não criou nada no PV');
  includes(out.text, 'grupo', 'avisa que é só em grupo');
});

await test('!vozp só para admins', async () => {
  const { groupJid, participants } = setup(2);
  const membro = makePerson();
  participants.push({ lid: membro.lid, jid: membro.jid, isAdmin: false });
  const chamadas = instalarDubleMidia();
  const out = await run({ groupJid, sender: membro, text: '!vozp', participants });
  includes(out.text, 'adm', 'avisa que precisa ser adm');
  ok(chamadas.length === 0, 'membro comum não inicia');
});

await test('!vozp em grupo pequeno: recusa com a regra', async () => {
  const groupJid = makeGroup();
  const admin = makePerson();
  const participants = [
    { lid: admin.lid, jid: admin.jid, isAdmin: true },
    { lid: BOT_LID, jid: BOT_JID, name: 'Lizzy', isAdmin: true }
  ];
  const chamadas = instalarDubleMidia();
  const out = await run({ groupJid, sender: admin, text: '!vozp', participants });
  ok(chamadas.length === 0, 'não criou');
  includes(out.text, 'pelo menos 2 outros membros', 'explica a regra');
});

// ============================================================================
// 3) MENSAGEM, REGISTRO E ENCERRAR
// ============================================================================

await test('!vozp avisa no grupo com o layout + newsletter e diz que NÃO toca', async () => {
  const { groupJid, admin, participants } = setup(3);
  instalarDubleMidia();
  const out = await run({ groupJid, sender: admin, text: '!vozp', participants });
  includes(out.text, 'Chat de voz iniciado', 'titulo');
  includes(out.text, 'Sem tocar', 'explica a diferenca do callp');
  includes(out.text, 'vozp encerrar', 'ensina a encerrar');
  ok(out.newsletter === true, 'leva o cabeçalho de canal (newsletter)');
});

await test('!vozp registra a call MARCADA como chat de voz', async () => {
  const { groupJid, admin, participants } = setup(3);
  instalarDubleMidia({ callId: 'VC-REG' });
  await run({ groupJid, sender: admin, text: '!vozp', participants });
  const ativa = callState.obterCall(groupJid);
  ok(ativa && ativa.callId === 'VC-REG', 'registrou a call');
  ok(ativa.voiceChat === true, 'marcada como voiceChat');
  callState.limparCall(groupJid);
});

await test('!callp registra a call como chamada comum (voiceChat=false)', async () => {
  const { groupJid, admin, participants } = setup(3);
  instalarDubleMidia({ callId: 'C-REG' });
  await run({ groupJid, sender: admin, text: '!callp', participants });
  const ativa = callState.obterCall(groupJid);
  ok(ativa && ativa.voiceChat === false, 'não marcada como chat de voz');
  callState.limparCall(groupJid);
});

await test('!vozp encerrar derruba a mídia e limpa o registro', async () => {
  const { groupJid, admin, participants } = setup(3);
  const chamadas = instalarDubleMidia({ callId: 'VC-2' });
  await run({ groupJid, sender: admin, text: '!vozp', participants });
  const out = await run({ groupJid, sender: admin, text: '!vozp encerrar', participants });
  includes(out.text, 'Chat de voz encerrado', 'confirma');
  ok(chamadas.some((c) => c.tipo === 'sair' && c.grupo === groupJid), 'derrubou a pilha de mídia');
  ok(callState.obterCall(groupJid) === null, 'limpou o registro');
});

await test('!vozp encerrar sem nada ativo: avisa sem quebrar', async () => {
  const { groupJid, admin, participants } = setup(3);
  instalarDubleMidia();
  const out = await run({ groupJid, sender: admin, text: '!vozp encerrar', participants });
  includes(out.text, 'Não há chat de voz ativo', 'avisa');
});

// ============================================================================
// 4) JÁ EXISTE CALL — DIZ QUAL É
// ============================================================================

await test('!vozp com uma CHAMADA ativa: recusa e diz que é chamada', async () => {
  const { groupJid, admin, participants } = setup(3);
  const chamadas = instalarDubleMidia();
  callState.registrarCall(groupJid, { callId: 'C-EXISTE', voiceChat: false });
  const out = await run({ groupJid, sender: admin, text: '!vozp', participants });
  includes(out.text, 'chamada', 'diz que é chamada');
  ok(!chamadas.some((c) => c.tipo === 'entrar'), 'não subiu outra');
  callState.limparCall(groupJid);
});

await test('!callp com um CHAT DE VOZ ativo: recusa e diz que é chat de voz', async () => {
  const { groupJid, admin, participants } = setup(3);
  const chamadas = instalarDubleMidia();
  callState.registrarCall(groupJid, { callId: 'VC-EXISTE', voiceChat: true });
  const out = await run({ groupJid, sender: admin, text: '!callp', participants });
  includes(out.text, 'chat de voz', 'diz que é chat de voz');
  ok(!chamadas.some((c) => c.tipo === 'entrar'), 'não subiu outra');
  callState.limparCall(groupJid);
});

// ============================================================================
// 5) MÍDIA INDISPONÍVEL — HONESTIDADE
// ============================================================================

await test('sem o pacote de mídia: avisa e não mente que iniciou', async () => {
  const { groupJid, admin, participants } = setup(3);
  instalarDubleMidia({ ok: false, motivo: 'pacote_de_midia_ausente' });
  const out = await run({ groupJid, sender: admin, text: '!vozp', participants });
  includes(out.text, 'mídia não está instalada', 'explica o motivo');
  ok(!out.text.includes('Chat de voz iniciado'), 'não anuncia sucesso');
  ok(callState.obterCall(groupJid) === null, 'não registra call que não subiu');
});

await test('falha do motor não derruba o handler', async () => {
  const { groupJid, admin, participants } = setup(3);
  instalarDubleMidia({ ok: false, motivo: 'falha_ao_entrar' });
  let threw = false;
  try {
    await run({ groupJid, sender: admin, text: '!vozp', participants });
  } catch { threw = true; }
  ok(!threw, 'não propagou exceção');
});

// ============================================================================
// 6) MENU
// ============================================================================

await test('!vozp está no menuadm, junto do !callp', async () => {
  const menu = await import(new URL('../dados/src/menus/menuadm.js', import.meta.url).href);
  const t = await menu.default('!', 'Lizzy', 'Teste');
  ok(t.includes('!vozp'), 'menuadm mostra !vozp');
  const i = t.indexOf('!callp');
  const j = t.indexOf('!vozp');
  ok(i > -1 && j === i + '!callp\n│ 🎙️ '.length, 'vem logo depois do !callp');
});

await test('menuCommandsMap registra callp e vozp no menu Admin', () => {
  const bp = fs.readFileSync(path.join(HERE, '..', 'dados/src/utils/blockPv.js'), 'utf-8');
  ok(bp.includes("'vozp'"), 'blockPv registra vozp');
  ok(bp.includes("'callp'"), 'blockPv registra callp');
});

// ============================================================================
// LIMPEZA E RESULTADO
// ============================================================================

callMedia.__setDubleEntrar(null);
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
