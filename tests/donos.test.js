/**
 * Testes do comando `!donos` (dono principal + subdonos).
 *
 * O comando usa o MESMO layout de caixa do `!dono` no TEXTO e, abaixo, mostra o
 * dono principal (nome + wa.me) e a lista dos subdonos (até MAX_SUBDONOS = 5).
 *
 * Uso: node tests/donos.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-donos-'));
process.env.DATABASE_PATH = TMP_DB;
const GRUPOS_DIR = path.join(TMP_DB, 'grupos');
const DONO_DIR = path.join(TMP_DB, 'dono');
fs.mkdirSync(GRUPOS_DIR, { recursive: true });
fs.mkdirSync(DONO_DIR, { recursive: true });

const sub = await import(new URL('../dados/src/utils/subdonos.js', import.meta.url).href);

const RESULTS = [];
let CURRENT = null;
function test(name, fn) {
  CURRENT = { name, passed: 0, failed: 0, errors: [] };
  RESULTS.push(CURRENT);
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      return r.then(() => finish(name)).catch((e) => { CURRENT.failed += 1; CURRENT.errors.push(`EXCEÇÃO: ${e?.stack || e}`); finish(name); });
    }
    finish(name);
  } catch (e) { CURRENT.failed += 1; CURRENT.errors.push(`EXCEÇÃO: ${e?.stack || e}`); finish(name); }
  return Promise.resolve();
}
function finish(name) {
  console.log(`${CURRENT.failed === 0 ? '✅' : '❌'} ${name} (${CURRENT.passed} ok, ${CURRENT.failed} falhas)`);
  for (const err of CURRENT.errors) console.log(`     ${err.split('\n')[0]}`);
}
function ok(c, m) { if (c) CURRENT.passed += 1; else { CURRENT.failed += 1; CURRENT.errors.push(`ASSERT FALHOU: ${m}`); } }
// O título sai em bold Unicode (MATHEMATICAL BOLD); compara o CONTEÚDO.
function desbold(text) {
  if (typeof text !== 'string') return text;
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp >= 0x1d400 && cp <= 0x1d419) out += String.fromCharCode(65 + (cp - 0x1d400));
    else if (cp >= 0x1d41a && cp <= 0x1d433) out += String.fromCharCode(97 + (cp - 0x1d41a));
    else if (cp >= 0x1d7ce && cp <= 0x1d7e7) out += String.fromCharCode(48 + (cp - 0x1d7ce));
    else out += ch;
  }
  return out;
}
function includes(h, n, l) { ok(typeof h === 'string' && desbold(h).includes(n), `${l ?? n} — esperado conter "${n}"`); }

// ============================================================================
// HANDLER REAL
// ============================================================================

const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';
// Lê o número do dono da config REAL sem importar `paths.js` no topo: import
// estático é içado ANTES de `DATABASE_PATH` ser setado, e isso faria o
// `paths.js` (e o SUBDONOS_FILE) apontarem para o banco de verdade.
const DONO_NUM = (() => {
  try {
    const cfgPath = process.env.CONFIG_PATH || path.join(HERE, '..', 'dados', 'src', 'config.json');
    return String(JSON.parse(fs.readFileSync(cfgPath, 'utf-8'))?.numerodono || '').replace(/\D/g, '');
  } catch { return ''; }
})();

let groupCounter = 0;
function makeGroup() {
  groupCounter += 1;
  const jid = `1203639100000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(path.join(GRUPOS_DIR, `${jid}.json`), JSON.stringify({ modobrincadeira: true }, null, 2));
  return jid;
}

async function run({ groupJid, text, sent = [], getName }) {
  const partes = [{ lid: BOT_LID, jid: BOT_JID, name: 'Lizzy', isAdmin: true }];
  const nazu = {
    sendMessage: async (jid, content, options) => { sent.push({ jid, content, options }); return { key: { id: 'SENT' } }; },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
    onWhatsApp: async (jid) => [{ jid, exists: false }],
    signalRepository: { lidMapping: { getPNForLID: async () => null } },
    contacts: { getName: (jid) => (getName ? getName(jid) : undefined) },
    getName: (jid) => (getName ? getName(jid) : undefined),
    groupMetadata: async () => ({ id: groupJid, subject: 'G', participants: partes }),
    groupParticipantsUpdate: async () => ({}), groupRequestParticipantsList: async () => [], groupRequestParticipantsUpdate: async () => ({}),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {}, sendPresenceUpdate: async () => {}, profilePictureUrl: async () => 'x', react: async () => ({}),
  };
  const info = {
    key: { remoteJid: groupJid, fromMe: true, id: `M-${Math.random().toString(36).slice(2, 8)}`, participant: BOT_LID },
    message: { extendedTextMessage: { text, contextInfo: { remoteJid: groupJid } } },
    messageTimestamp: 1757900000, pushName: 'User',
  };
  await handleMessage(nazu, info, null, new Map(), null);
  return sent;
}

const txt = (sent) => sent.map((s) => s.content?.text ?? '').join('\n');

// limpa entre casos
function limpar() {
  sub.limparTudo();
}

// ============================================================================
// 1) SEM SUBDONOS
// ============================================================================

await test('1. !donos sem subdonos: mostra o principal e "nenhum"', async () => {
  limpar();
  const groupJid = makeGroup();
  const sent = await run({ groupJid, text: '!donos' });
  const t = txt(sent);
  includes(t, 'DONOS DO BOT', 'título do comando');
  includes(t, 'Dono Principal', 'rótulo do principal');
  includes(t, `wa.me/${DONO_NUM}`, 'link do principal');
  includes(t, 'Subdonos:', 'rótulo dos subdonos');
  includes(t, 'nenhum', 'sem subdonos');
  includes(t, '╭', 'abre a caixa');
  includes(t, '╰', 'fecha a caixa');
});

// ============================================================================
// 2) COM SUBDONOS
// ============================================================================

await test('2. !donos com subdonos: lista os links deles', async () => {
  limpar();
  sub.adicionar('5511000000001@s.whatsapp.net');
  sub.adicionar('5511000000002@s.whatsapp.net');
  const groupJid = makeGroup();
  const sent = await run({ groupJid, text: '!donos' });
  const t = txt(sent);
  includes(t, '2/5', 'contagem x/5');
  includes(t, 'wa.me/5511000000001', 'link do 1º subdono');
  includes(t, 'wa.me/5511000000002', 'link do 2º subdono');
});

await test('3. !donos mostra o NOME do subdono quando disponível', async () => {
  limpar();
  sub.adicionar('5511000000001@s.whatsapp.net');
  const groupJid = makeGroup();
  const sent = await run({
    groupJid, text: '!donos',
    getName: (jid) => (String(jid).includes('5511000000001') ? 'Fulano da Silva' : undefined),
  });
  includes(txt(sent), '(Fulano da Silva)', 'nome entre parênteses');
});

await test('4. !donos respeita o teto de 5 (nunca lista mais)', async () => {
  limpar();
  // Cenário: o arquivo foi editado à mão com 6 entradas (o `adicionar` já
  // bloquearia o 6º, então escrevemos o banco direto).
  const arq = path.join(DONO_DIR, 'subdonos.json');
  const membros = Array.from({ length: 6 }, (_, i) => ({
    id: `55110000000${i + 1}0@s.whatsapp.net`, aliases: [], perms: [], addedAt: Date.now(),
  }));
  fs.writeFileSync(arq, JSON.stringify({ version: 2, subdonos: membros, basePerms: [] }, null, 2));

  const groupJid = makeGroup();
  const sent = await run({ groupJid, text: '!donos' });
  const t = txt(sent);
  includes(t, '5/5', 'marca 5/5');
  includes(t, 'wa.me/5511000000010', 'mostra o 1º');
  ok(!t.includes('wa.me/5511000000060'), 'o 6º NÃO aparece (teto de 5)');
});

// ============================================================================
// 3) ALIAS
// ============================================================================

await test('5. !listadonos é o mesmo comando', async () => {
  limpar();
  const groupJid = makeGroup();
  const sent = await run({ groupJid, text: '!listadonos' });
  includes(txt(sent), 'DONOS DO BOT', 'alias responde');
});

// ============================================================================
// RESUMO
// ============================================================================

const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log(`\n${totalFail === 0 ? '✅' : '❌'} ${RESULTS.length} testes / ${totalOk} asserções (${totalFail} falhas)`);
process.exit(totalFail === 0 ? 0 : 1);
