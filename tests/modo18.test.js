/**
 * `!modo18` — liga/desliga o MENU +18, com exclusividade em relacao ao `!modolite`.
 *
 * Roda o handler REAL com socket falso. O ponto central e' a regra pedida pelo
 * dono: **os dois nao podem ficar ligados juntos**. Cobre tambem que, com o
 * modo +18 desligado, os comandos do menu +18 NAO respondem (menos o proprio
 * `!menu18`, que avisa por que).
 *
 * Uso: node tests/modo18.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

// Banco temporario ANTES de importar o bot: o `paths.js` le o ambiente no load.
const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-modo18-'));
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

/** Normaliza o MATHEMATICAL BOLD/ITALIC do layout para ASCII (como o vab18). */
function desbold(text) {
  if (typeof text !== 'string') return text;
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp >= 0x1d400 && cp <= 0x1d419) out += String.fromCharCode(65 + (cp - 0x1d400));
    else if (cp >= 0x1d41a && cp <= 0x1d433) out += String.fromCharCode(97 + (cp - 0x1d41a));
    else if (cp >= 0x1d468 && cp <= 0x1d481) out += String.fromCharCode(65 + (cp - 0x1d468));
    else if (cp >= 0x1d482 && cp <= 0x1d49b) out += String.fromCharCode(97 + (cp - 0x1d482));
    else out += ch;
  }
  return out;
}
function includesTxt(hay, needle, label) {
  ok(typeof hay === 'string' && desbold(hay).includes(needle),
    `${label ?? needle} \u2014 esperado conter "${needle}"`);
}

// ============================================================================

const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;
if (typeof handleMessage !== 'function') throw new Error('index.js não exporta o handler');

const menu18Mode = await import(new URL('../dados/src/funcs/utils/menu18Mode.js', import.meta.url).href);

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';

let groupCounter = 0;
let personCounter = 0;

function makeGroup(extra = {}) {
  groupCounter += 1;
  const jid = `1203638100000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(path.join(GRUPOS_DIR, `${jid}.json`),
    JSON.stringify({ groupName: `Grupo 18 ${groupCounter}`, modobrincadeira: true, modo18: true, ...extra }, null, 2));
  return jid;
}
function readGroup(jid) {
  return JSON.parse(fs.readFileSync(path.join(GRUPOS_DIR, `${jid}.json`), 'utf-8'));
}
function makePerson() {
  personCounter += 1;
  const n = String(personCounter).padStart(4, '0');
  return { lid: `5571${n}000000@lid`, jid: `5513${n}999999@s.whatsapp.net`, name: `5571${n}000000` };
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
      id: groupJid, subject: 'Grupo 18',
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

/** Executa uma mensagem no handler (remetente novo por chamada, throttle 3/5s). */
async function run({ groupJid, sender, text, participants, sent = [], remoteJid = null }) {
  const alvo = remoteJid || groupJid;
  const nazu = makeNazu({ sent, groupJid, participants });
  const info = {
    key: { remoteJid: alvo, fromMe: false, id: `M-${Math.random().toString(36).slice(2, 10)}`, participant: sender.lid },
    message: { extendedTextMessage: { text, contextInfo: { remoteJid: alvo, mentionedJid: [] } } },
    messageTimestamp: Math.floor(Date.now() / 1000),
    pushName: sender.name
  };
  await handleMessage(nazu, info, null, new Map(), null);
  return {
    text: sent.map((s) => s.content?.text ?? '').filter(Boolean).join('\n'),
    poll: sent.find((s) => s.content?.poll)?.content.poll,
    newsletter: sent.some((s) => s.content?.contextInfo?.forwardedNewsletterMessageInfo?.newsletterJid),
    sent
  };
}

function setup(groupExtra = {}) {
  const groupJid = makeGroup(groupExtra);
  const admin = makePerson();
  const membro = makePerson();
  const participants = [
    { lid: admin.lid, jid: admin.jid, isAdmin: true },
    { lid: membro.lid, jid: membro.jid, isAdmin: false },
    { lid: BOT_LID, jid: BOT_JID, name: 'Lizzy', isAdmin: true }
  ];
  return { groupJid, admin, membro, participants };
}

// ============================================================================
// 1) MODULO
// ============================================================================

await test('modulo: lista do menu +18 e visao do flag', () => {
  ok(menu18Mode.MENU18_COMMANDS.includes('menu18'), 'inclui o menu18');
  ok(menu18Mode.MENU18_COMMANDS.includes('plaq1') && menu18Mode.MENU18_COMMANDS.includes('plaq10'), 'inclui as plaquinhas');
  ok(menu18Mode.MENU18_COMMANDS.includes('vab18') && menu18Mode.MENU18_COMMANDS.includes('eununca18') && menu18Mode.MENU18_COMMANDS.includes('hotseat'),
    'inclui as brincadeiras +18');
  ok(!menu18Mode.isMenu18Command('vab') && !menu18Mode.isMenu18Command('eununca') && !menu18Mode.isMenu18Command('modo18'),
    'nao inclui os comandos normais do menu de brincadeiras');
  ok(menu18Mode.isModo18Ativo({ modo18: true }) === true, 'liga com true');
  ok(menu18Mode.isModo18Ativo({ modo18: false }) === false, 'desliga com false');
  ok(menu18Mode.isModo18Ativo({}) === false, 'sem o campo, NAO libera (opt-in)');
});

await test('a lista bate com o `menuCommandsMap.menu18` do blockPv (sem divergir)', async () => {
  const blockPv = await import(new URL('../dados/src/utils/blockPv.js', import.meta.url).href);
  const doBlockPv = blockPv.menuCommandsMap.menu18.commands;
  const nossos = [...menu18Mode.MENU18_COMMANDS];
  for (const cmd of doBlockPv) {
    ok(nossos.includes(cmd), `o blockPv lista "${cmd}" e o modo18 tambem precisa listar`);
  }
});

// ============================================================================
// 2) TOGGLE
// ============================================================================

await test('!modo18 desativa e ativa, gravando o flag no grupo', async () => {
  const { groupJid, admin, participants } = setup({ modo18: true });
  const off = await run({ groupJid, sender: admin, text: '!modo18', participants });
  includes(off.text, '+18 desativado', 'avisa que desativou');
  ok(readGroup(groupJid).modo18 === false, 'gravou modo18=false');
  ok(readGroup(groupJid).modo18Off === true, 'marcou modo18Off');

  const on = await run({ groupJid, sender: admin, text: '!modo18', participants });
  includes(on.text, '+18 ativado', 'avisa que ativou');
  ok(readGroup(groupJid).modo18 === true, 'gravou modo18=true');
  ok(!('modo18Off' in readGroup(groupJid)), 'limpou o modo18Off');
});

await test('!modo18 so para admins (membro comum nao muda nada)', async () => {
  const { groupJid, membro, participants } = setup({ modo18: true });
  const out = await run({ groupJid, sender: membro, text: '!modo18', participants });
  ok(readGroup(groupJid).modo18 === true, 'segue ativo');
  ok(!/desativado|ativado/i.test(out.text), 'nao respondeu como toggle');
});

// ============================================================================
// 3) EXCLUSIVIDADE
// ============================================================================

await test('!modo18 NAO liga com o modo lite ativo', async () => {
  const { groupJid, admin, participants } = setup({ modo18: false, modolite: true });
  const out = await run({ groupJid, sender: admin, text: '!modo18', participants });
  includes(out.text, 'Modo Lite', 'explica o conflito');
  ok(readGroup(groupJid).modo18 === false, 'nao ligou o modo18');
});

await test('ativar o !modolite DESLIGA o modo18 no mesmo ato', async () => {
  const { groupJid, admin, participants } = setup({ modolite: false });
  const out = await run({ groupJid, sender: admin, text: '!modolite', participants });
  includes(out.text, 'Modo Lite ativado', 'avisou o lite');
  includes(out.text, '+18', 'menciona o modo18 desligado');
  const g = readGroup(groupJid);
  ok(g.modolite === true, 'lite ligado');
  ok(g.modo18 === false, 'modo18 desligado junto (nunca os dois ligados)');
});

await test('nunca terminam os dois ligados (varredura de estados)', async () => {
  const { groupJid, admin, participants } = setup({});
  // Alterna varias vezes e confere o invariante a cada passo.
  for (let i = 0; i < 6; i++) {
    const cmd = i % 2 === 0 ? '!modo18' : '!modolite';
    await run({ groupJid, sender: admin, text: cmd, participants });
    const g = readGroup(groupJid);
    ok(!(g.modolite === true && g.modo18 === true),
      `passo ${i} (${cmd}): os dois nao podem estar ligados`);
  }
});

// ============================================================================
// 4) O MENU +18 OBEDECE AO FLAG
// ============================================================================

await test('!menu18 avisa e nao envia o menu com o modo18 desligado', async () => {
  const { groupJid, admin, participants } = setup({ modo18: false });
  const out = await run({ groupJid, sender: admin, text: '!menu18', participants });
  includes(out.text, 'Modo +18', 'avisa que esta desativado');
  ok(!out.text.includes('PLAQUINHA'), 'nao enviou o menu');
});

await test('!menu18 funciona com o modo18 ligado', async () => {
  const { groupJid, admin, participants } = setup({ modo18: true });
  const out = await run({ groupJid, sender: admin, text: '!menu18', participants });
  ok(out.text.includes('PLAQUINHA') || out.text.includes('!plaq1'), 'enviou o menu');
});

await test('os comandos +18 avisam que o modo esta off (nada de silencio)', async () => {
  const { groupJid, participants } = setup({ modo18: false });
  // Remetente novo por comando: `sendMessage` e' limitado a 3/5s por remetente.
  for (const cmd of ['!plaq1', '!vab18', '!eununca18', '!hotseat', '!menupraq']) {
    const quem = makePerson();
    const out = await run({ groupJid, sender: quem, text: cmd, participants });
    includes(out.text, 'Modo +18', `${cmd} avisa o motivo`);
    ok(!/PLAQUINHA|ISSO OU AQUILO|EU NUNCA/i.test(out.text), `${cmd} nao entrega o conteudo`);
  }
});

await test('!menu18 nao vaza pelo PRIVADO com o modo off (correcao)', async () => {
  const { groupJid, admin, participants } = setup({ modo18: true });
  // No PV nao ha grupo dono; o menu +18 nao pode abrir por esse caminho.
  const out = await run({ groupJid, sender: admin, text: '!menu18', participants, remoteJid: admin.jid });
  ok(!out.text.includes('PLAQUINHA'), 'nao enviou o menu no PV');
  includes(out.text, 'Modo +18', 'avisa que esta desativado');
});

await test('logo apos desativar, o menu ja nao abre (cache invalidado)', async () => {
  const { groupJid, admin, participants } = setup({ modo18: true });
  // Antes da correcao o cache de groupData sobrevivia ate' 5s e o menu ainda saia.
  await run({ groupJid, sender: admin, text: '!modo18', participants }); // desliga
  const out = await run({ groupJid, sender: admin, text: '!menu18', participants });
  ok(!out.text.includes('PLAQUINHA'), 'o menu nao abre logo apos desativar');
  includes(out.text, 'Modo +18', 'avisa o motivo');
});

await test('o aviso de ativar/desativar carrega o cabecalho de canal', async () => {
  const { groupJid, admin, participants } = setup({ modo18: true });
  const off = await run({ groupJid, sender: admin, text: '!modo18', participants });
  ok(off.newsletter, 'o aviso de desativar tem o cabecalho de canal');
  const on = await run({ groupJid, sender: admin, text: '!modo18', participants });
  ok(on.newsletter, 'o aviso de ativar tem o cabecalho de canal');
});

await test('!vab18 segue funcionando com o modo18 ligado (regressao)', async () => {
  const { groupJid, admin, participants } = setup({ modo18: true });
  const out = await run({ groupJid, sender: admin, text: '!vab18', participants });
  includesTxt(out.poll?.name || '', 'ISSO OU AQUILO', 'enviou a enquete picante');
});

// ============================================================================

const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log('\n' + '='.repeat(40));
console.log(`RESULTADO: ${RESULTS.length} testes | ${totalOk} asserções ok | ${totalFail} falhas`);
console.log('='.repeat(40));
if (totalFail > 0) process.exit(1);
