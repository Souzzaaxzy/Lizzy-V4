/**
 * Testes do !antimidia (era !antifoton).
 *
 * O comando apaga fotos e vídeos NORMAIS de quem não é admin. Visualização
 * única é isenta de propósito: o objetivo é justamente forçar o envio como
 * view once.
 *
 * Uso: node tests/antimidia.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import { proto } from '@itsliaaa/baileys';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-antimidia-db-'));
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

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';
const ADMIN_LID = '222000000000001@lid';
const USER_LID = '333000000000001@lid';

let groupCounter = 0;
let senderCounter = 0;

/** Grupo novo a cada execução: o metadata é cacheado por grupo. */
function makeGroup(flags = {}) {
  groupCounter += 1;
  const jid = `1203632000000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(
    path.join(GRUPOS_DIR, `${jid}.json`),
    JSON.stringify({ modobrincadeira: true, groupName: 'Grupo AM', ...flags }, null, 2)
  );
  return jid;
}

function readGroup(jid) {
  try {
    return JSON.parse(fs.readFileSync(path.join(GRUPOS_DIR, `${jid}.json`), 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Socket falso. `apagadas` registra as mensagens que o bot mandou apagar.
 * O bot precisa ser admin para poder apagar (o comando exige isso).
 */
function makeNazu({ sent, apagadas, groupJid }) {
  return {
    sendMessage: async (jid, content) => {
      sent.push({ jid, content });
      if (content?.delete) apagadas.push(content.delete);
      return { key: { id: 'SENT' } };
    },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
    onWhatsApp: async (jid) => [{ jid, exists: true, lid: jid.replace('@s.whatsapp.net', '@lid') }],
    signalRepository: { lidMapping: { getPNForLID: async () => null } },
    groupMetadata: async () => ({
      id: groupJid,
      subject: 'Grupo AM',
      participants: [
        { id: BOT_LID, lid: BOT_LID, phoneNumber: BOT_JID, admin: 'admin' },
        { id: ADMIN_LID, lid: ADMIN_LID, phoneNumber: '5511999999998@s.whatsapp.net', admin: 'admin' },
        { id: USER_LID, lid: USER_LID, phoneNumber: '5511999999997@s.whatsapp.net', admin: null },
      ],
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

/** Executa uma mensagem (comando ou mídia) no handler real. */
async function executar({ groupJid, sender, message, text }) {
  const sent = [];
  const apagadas = [];
  const nazu = makeNazu({ sent, apagadas, groupJid });
  const conteudo = message
    ? { ...message, extendedTextMessage: text ? { text } : undefined }
    : { extendedTextMessage: text ? { text } : undefined };

  await handleMessage(nazu, {
    key: { remoteJid: groupJid, fromMe: false, id: `M-${Math.random().toString(36).slice(2, 9)}`, participant: sender },
    message: conteudo,
    messageTimestamp: 1757900000,
    pushName: 'Tester',
  }, null, new Map(), null);

  const texto = sent.map((s) => s.content?.text ?? s.content?.caption ?? '').filter(Boolean).join('\n');
  return { sent, apagadas, texto };
}

/**
 * Executa um comando como ADMIN.
 *
 * O sender precisa estar no metadata do grupo (senão o handler nega por não ser
 * admin), e o metadata é cacheado por grupo — então usamos o ADMIN_LID fixo com
 * um grupo novo a cada execução. Também evita o throttle de 3 comandos/5s.
 */
async function comando(text) {
  const groupJid = makeGroup();
  return executar({ groupJid, sender: ADMIN_LID, text });
}

/** Comando em um grupo que já existe (para testar o estado anterior). */
async function comandoNo(groupJid, text) {
  return executar({ groupJid, sender: ADMIN_LID, text });
}

// Mídias de teste
const IMAGEM = { imageMessage: { url: 'https://x/y', mimetype: 'image/jpeg' } };
const VIDEO = { videoMessage: { url: 'https://x/y', mimetype: 'video/mp4', seconds: 5 } };
const IMAGEM_VO2 = { viewOnceMessageV2: { message: { imageMessage: { url: 'https://x/y', mimetype: 'image/jpeg' } } } };
const VIDEO_VO2 = { viewOnceMessageV2: { message: { videoMessage: { url: 'https://x/y', mimetype: 'video/mp4', seconds: 5 } } } };
const TEXTO = { conversation: 'oi' };

// ============================================================================
// 1) O COMANDO
// ============================================================================

await test('!antimidia: liga o toggle e persiste no grupo', async () => {
  const groupJid = makeGroup();
  const { texto } = await comandoNo(groupJid, '!antimidia');

  includes(texto, 'agora serão apagados', 'avisa que ativou');
  includes(texto, 'vídeos', 'menciona vídeos (o comando cobre os dois)');
  const salvo = readGroup(groupJid);
  ok(salvo?.antimidia === true, `salvou antimidia=true (obtido ${JSON.stringify(salvo?.antimidia)})`);
});

await test('!antimidia: o segundo toque desliga', async () => {
  const groupJid = makeGroup({ antimidia: true });
  const { texto } = await comandoNo(groupJid, '!antimidia');
  includes(texto, 'não serão mais apagados', 'avisa que desativou');
  ok(readGroup(groupJid)?.antimidia === false, 'salvou antimidia=false');
});

await test('!antimidia: só em grupo e só admin', async () => {
  // Fora de grupo.
  const pv = await executar({ groupJid: '5511999999999@s.whatsapp.net', sender: ADMIN_LID, text: '!antimidia' });
  includes(pv.texto, 'só pode ser usado em grupo', 'recusa fora de grupo');

  // Não-admin.
  const groupJid = makeGroup();
  const naoAdmin = await executar({ groupJid, sender: USER_LID, text: '!antimidia' });
  includes(naoAdmin.texto, 'precisa ser adm', 'recusa não-admin');
  ok(readGroup(groupJid)?.antimidia === undefined, 'não ligou o toggle');
});

await test('!antifoton: nome ANTIGO continua funcionando (retrocompatibilidade)', async () => {
  const groupJid = makeGroup();
  const { texto } = await comandoNo(groupJid, '!antifoton');
  includes(texto, 'agora serão apagados', 'o alias antigo liga o recurso');
  const salvo = readGroup(groupJid);
  ok(salvo?.antimidia === true, 'gravou na chave nova (antimidia)');
  ok(salvo?.antifoton === undefined, 'limpou a chave antiga');
});

await test('!antimidia: grupo com a flag antiga continua ATIVO', async () => {
  // Grupo que ligou o recurso antes da renomeação (só tem `antifoton`).
  const groupJid = makeGroup({ antifoton: true });
  const { apagadas } = await executar({ groupJid, sender: USER_LID, message: IMAGEM });
  ok(apagadas.length === 1, `apagou mesmo com a flag antiga (obtido ${apagadas.length})`);
});

// ============================================================================
// 2) O QUE É APAGADO (o pedido principal)
// ============================================================================

await test('foto normal de não-admin: apagada', async () => {
  const groupJid = makeGroup({ antimidia: true });
  const { apagadas, texto } = await executar({ groupJid, sender: USER_LID, message: IMAGEM });
  ok(apagadas.length === 1, 'mandou apagar a foto');
  ok(apagadas[0]?.id !== undefined, 'apontou a mensagem certa');
  includes(texto, 'Fotos', 'avisa que fotos não são permitidas');
});

await test('VÍDEO normal de não-admin: apagado (novidade)', async () => {
  const groupJid = makeGroup({ antimidia: true });
  const { apagadas, texto } = await executar({ groupJid, sender: USER_LID, message: VIDEO });
  ok(apagadas.length === 1, 'mandou apagar o vídeo');
  includes(texto, 'Vídeos', 'a mensagem fala em vídeos');
});

await test('view once (foto e vídeo): NÃO é apagado', async () => {
  const groupJid = makeGroup({ antimidia: true });

  const r1 = await executar({ groupJid, sender: USER_LID, message: IMAGEM_VO2 });
  ok(r1.apagadas.length === 0, `foto view once preservada (apagadas: ${r1.apagadas.length})`);

  const r2 = await executar({ groupJid, sender: USER_LID, message: VIDEO_VO2 });
  ok(r2.apagadas.length === 0, `vídeo view once preservado (apagadas: ${r2.apagadas.length})`);
});

await test('admin e dono: não são afetados', async () => {
  const groupJid = makeGroup({ antimidia: true });

  const admin = await executar({ groupJid, sender: ADMIN_LID, message: IMAGEM });
  ok(admin.apagadas.length === 0, 'mídia de admin preservada');

  // `fromMe` marca como enviado pelo próprio bot (dono).
  const sent = [];
  const apagadas = [];
  const nazu = makeNazu({ sent, apagadas, groupJid });
  await handleMessage(nazu, {
    key: { remoteJid: groupJid, fromMe: true, id: 'M-BOT', participant: BOT_LID },
    message: IMAGEM,
    messageTimestamp: 1757900000,
    pushName: 'Bot',
  }, null, new Map(), null);
  ok(apagadas.length === 0, 'mídia do próprio bot preservada');
});

await test('texto e outros tipos: não são afetados', async () => {
  const groupJid = makeGroup({ antimidia: true });
  const r = await executar({ groupJid, sender: USER_LID, message: TEXTO });
  ok(r.apagadas.length === 0, 'texto não é apagado');
});

await test('desligado: nada é apagado', async () => {
  const groupJid = makeGroup({ antimidia: false });
  const r = await executar({ groupJid, sender: USER_LID, message: IMAGEM });
  ok(r.apagadas.length === 0, 'não apaga com o toggle desligado');
});

await test('grupo sem a config: nada é apagado', async () => {
  const groupJid = makeGroup();
  const v = await executar({ groupJid, sender: USER_LID, message: VIDEO });
  ok(v.apagadas.length === 0, 'grupo sem config não apaga');
});

// ============================================================================
// 3) AUTORREGISTRO NO MENU E NO PAINEL
// ============================================================================

await test('!menubn/menuadm: o comando aparece como antimidia', () => {
  const src = fs.readFileSync(path.join(PROJECT, 'dados/src/menus/menuadm.js'), 'utf-8');
  includes(src, '${prefix}antimidia', 'menu mostra antimidia');
  notIncludes(src, '${prefix}antifoton', 'menu não mostra mais o nome antigo');
});

await test('painel de antis: usa a chave nova e enxerga a antiga', () => {
  const src = fs.readFileSync(path.join(PROJECT, 'dados/src/index.js'), 'utf-8');
  includes(src, "key: 'antimidia'", 'lista usa a chave nova');
  includes(src, "legacyKey: 'antifoton'", 'declara a chave antiga como legada');
  includes(src, 'system.legacyKey', 'o painel consulta a chave legada');
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