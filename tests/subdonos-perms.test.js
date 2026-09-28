/**
 * Testes do sistema de permissões de SUBDONOS (handler real).
 *
 * Cobre o que foi pedido nesta rodada:
 *   1. `!grantsubcmd` / `!delsubcmd` / `!listsubcmd` NAO existem mais;
 *   2. um subdono usa de fato os comandos liberados com `!sub.permitir` —
 *      inclusive quando foi cadastrado pelo NUMERO e a menção chega como LID;
 *   3. `!sub.permitir @user all` da ACESSO TOTAL (como o dono), preservando a
 *      hierarquia (gestao de subdonos e identidade do dono seguem do principal);
 *   4. o `!listasubdonos` mostra o NOME primeiro e o NUMERO depois.
 *
 * Uso: node tests/subdonos-perms.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-subperm-'));
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
      return r.then(() => finish(name)).catch((e) => { CURRENT.failed += 1; CURRENT.errors.push(`EXCECAO: ${e?.stack || e}`); finish(name); });
    }
    finish(name);
  } catch (e) { CURRENT.failed += 1; CURRENT.errors.push(`EXCECAO: ${e?.stack || e}`); finish(name); }
  return Promise.resolve();
}
function finish(name) {
  console.log(`${CURRENT.failed === 0 ? 'OK ' : 'ERR'} ${name} (${CURRENT.passed} ok, ${CURRENT.failed} falhas)`);
  for (const err of CURRENT.errors) console.log(`     ${err.split('\n')[0]}`);
}
function ok(c, m) { if (c) CURRENT.passed += 1; else { CURRENT.failed += 1; CURRENT.errors.push(`ASSERT FALHOU: ${m}`); } }
function contem(h, n, l) { ok(typeof h === 'string' && h.includes(n), `${l ?? n} — esperado conter "${n}"`); }
function naoContem(h, n, l) { ok(typeof h === 'string' && !h.includes(n), `${l ?? n} — NAO deveria conter "${n}"`); }

// ============================================================================
// HANDLER REAL
// ============================================================================

const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';
const SUB_JID = '5511888888888@s.whatsapp.net';
const SUB_LID = '222000000000002@lid';

// Le a config REAL sem importar `paths.js` no topo (import estatico e icado
// antes de `DATABASE_PATH` e apontaria para o banco de verdade).
const CFG = (() => {
  try {
    const p = process.env.CONFIG_PATH || path.join(HERE, '..', 'dados', 'src', 'config.json');
    return JSON.parse(fs.readFileSync(p, 'utf-8')) || {};
  } catch { return {}; }
})();
const DONO_NUM = String(CFG.numerodono || '').replace(/\D/g, '');
const OWNER_JID = `${DONO_NUM}@s.whatsapp.net`;
const OWNER_LID = CFG.lidowner || `${DONO_NUM}@lid`;

let groupCounter = 0;
function makeGroup() {
  groupCounter += 1;
  const jid = `1203639200000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(path.join(GRUPOS_DIR, `${jid}.json`), JSON.stringify({ modobrincadeira: true }, null, 2));
  return jid;
}

function participantes() {
  return [
    { lid: BOT_LID, jid: BOT_JID, id: BOT_LID, name: 'Lizzy', isAdmin: true },
    { lid: OWNER_LID, jid: OWNER_JID, id: OWNER_LID, phoneNumber: OWNER_JID, name: 'Dono', isAdmin: true },
    { lid: SUB_LID, jid: SUB_JID, id: SUB_LID, phoneNumber: SUB_JID, name: 'Sub', isAdmin: false },
  ];
}

async function run({ text, senderLid, senderJid, mentions = [], getName }) {
  const sent = [];
  const groupJid = makeGroup();
  const partes = participantes();
  const nazu = {
    sendMessage: async (jid, content, options) => { sent.push({ jid, content, options }); return { key: { id: 'SENT' } }; },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
    onWhatsApp: async (jid) => [{ jid, exists: false }],
    signalRepository: { lidMapping: { getPNForLID: async () => null } },
    contacts: { getName: (jid) => (getName ? getName(jid) : undefined) },
    getName: (jid) => (getName ? getName(jid) : undefined),
    groupMetadata: async () => ({ id: groupJid, subject: 'G', participants: partes }),
    profilePictureUrl: async () => 'x', react: async () => ({}),
    groupParticipantsUpdate: async () => ({}), readMessages: async () => {}, sendPresenceUpdate: async () => {},
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
  };
  const info = {
    key: { remoteJid: groupJid, fromMe: false, id: `M-${Math.random().toString(36).slice(2, 8)}`, participant: senderLid },
    message: { extendedTextMessage: { text, contextInfo: { remoteJid: groupJid, mentionedJid: mentions } } },
    messageTimestamp: 1757900000, pushName: 'User',
  };
  await handleMessage(nazu, info, null, new Map(), null);
  return sent.map((s) => s.content?.text ?? s.content?.caption ?? '').join('\n');
}

// O throttle e 3 comandos/5s POR REMETENTE (pulado com `fromMe`). O subdono
// precisa de `fromMe: false` para NAO virar "dono", entao o teste repete uma
// vez quando o throttle dispara — na 4a tentativa o contador e limpo
// (`commandThrottle.delete`), entao a repeticao passa.
async function enviar(text, senderLid, senderJid, mentions) {
  let r = await run({ text, senderLid, senderJid, mentions });
  if (r.includes('Calma aí')) r = await run({ text, senderLid, senderJid, mentions });
  return r;
}
const comoDono = (t, mentions) => enviar(t, OWNER_LID, OWNER_JID, mentions);
const comoSub = (t) => enviar(t, SUB_LID, SUB_JID);

function limpar() { sub.limparTudo(); }

// ============================================================================
// 1) COMANDOS REMOVIDOS
// ============================================================================

await test('1. grantsubcmd/delsubcmd/listsubcmd NAO existem mais', async () => {
  limpar();
  for (const c of ['!grantsubcmd play', '!delsubcmd play', '!listsubcmd']) {
    const r = await comoDono(c);
    contem(r, 'Comando não encontrado', `${c} removido`);
  }
});

// ============================================================================
// 2) !sub.permitir FUNCIONA (subdono usa o comando liberado)
// ============================================================================

await test('2. subdono cadastrado pelo NUMERO usa o comando liberado (mencao LID)', async () => {
  limpar();
  sub.adicionar(SUB_JID);                       // cadastrado pelo TELEFONE
  const r = await comoDono(`!sub.permitir @${SUB_LID.split('@')[0]} play`, [SUB_LID]);
  contem(r, 'liberado', 'liberou play');
  ok(sub.podeUsar(SUB_JID, 'play'), 'permissao gravada');
  const exec = await comoSub('!play teste');
  naoContem(exec, 'não está disponível para subdonos', 'subdono executa o liberado');
});

await test('3. sem permissao o subdono NAO usa o comando', async () => {
  limpar();
  sub.adicionar(SUB_LID);
  const r = await comoSub('!infoserver');
  contem(r, 'não está disponível para subdonos', 'bloqueado sem permissao');
});

// ============================================================================
// 3) ACESSO TOTAL (`all`)
// ============================================================================

await test('4. `!sub.permitir @user all` grava o acesso total', async () => {
  limpar();
  sub.adicionar(SUB_LID);
  const r = await comoDono(`!sub.permitir @${SUB_LID.split('@')[0]} all`, [SUB_LID]);
  contem(r, 'ACESSO TOTAL', 'confirma o acesso total');
  ok(sub.temAcessoTotal(SUB_LID), 'temAcessoTotal');
  ok(sub.podeUsar(SUB_LID, 'qualquercoisa'), 'cobre qualquer comando');
});

await test('5. com acesso total o subdono usa comando exclusivo do dono', async () => {
  limpar();
  sub.adicionar(SUB_LID);
  await comoDono(`!sub.permitir @${SUB_LID.split('@')[0]} all`, [SUB_LID]);
  const r = await comoSub('!infoserver');
  contem(r, 'INFORMAÇÕES DO SERVIDOR', 'executou comando de dono');
});

await test('6. HIERARQUIA: acesso total NAO abre a gestao de subdonos', async () => {
  limpar();
  sub.adicionar(SUB_LID);
  await comoDono(`!sub.permitir @${SUB_LID.split('@')[0]} all`, [SUB_LID]);
  const add = await comoSub('!addsubdono 5511000000000');
  contem(add, 'Apenas o Dono', 'addsubdono barrado para o subdono');
  const del = await comoSub('!delsubdono 5511000000000');
  contem(del, 'Apenas o Dono', 'delsubdono barrado');
});

await test('7. HIERARQUIA: acesso total NAO redefine a identidade do dono', async () => {
  limpar();
  sub.adicionar(SUB_LID);
  await comoDono(`!sub.permitir @${SUB_LID.split('@')[0]} all`, [SUB_LID]);
  const r = await comoSub('!numero-dono 5511000000000');
  contem(r, 'exclusivo para o meu dono', 'numero-dono barrado');
  const n = await comoSub('!nomedono Hack');
  contem(n, 'exclusivo para o meu dono', 'nomedono barrado');
});

await test('8. `!sub.revogar all` tira o acesso total', async () => {
  limpar();
  sub.adicionar(SUB_LID);
  await comoDono(`!sub.permitir @${SUB_LID.split('@')[0]} all`, [SUB_LID]);
  ok(sub.temAcessoTotal(SUB_LID), 'tinha o total');
  const r = await comoDono(`!sub.revogar @${SUB_LID.split('@')[0]} all`, [SUB_LID]);
  contem(r, 'ACESSO TOTAL revogado', 'revogou');
  ok(!sub.temAcessoTotal(SUB_LID), 'nao tem mais');
  const exec = await comoSub('!infoserver');
  contem(exec, 'não está disponível para subdonos', 'voltou a ser barrado');
});

await test('9. acesso total limpa as permissoes avulsas (fica so `all`)', async () => {
  limpar();
  sub.adicionar(SUB_LID);
  await comoDono(`!sub.permitir @${SUB_LID.split('@')[0]} play`, [SUB_LID]);
  await comoDono(`!sub.permitir @${SUB_LID.split('@')[0]} all`, [SUB_LID]);
  const perms = sub.permsProprias(SUB_LID);
  ok(perms.length === 1 && perms[0] === 'all', 'sobrou apenas `all`');
});

// ============================================================================
// 4) !sub.perms mostra o total
// ============================================================================

await test('10. `!sub.perms` mostra o ACESSO TOTAL', async () => {
  limpar();
  sub.adicionar(SUB_LID);
  await comoDono(`!sub.permitir @${SUB_LID.split('@')[0]} all`, [SUB_LID]);
  const r = await comoDono(`!sub.perms @${SUB_LID.split('@')[0]}`, [SUB_LID]);
  contem(r, 'ACESSO TOTAL', 'painel mostra o total');
});

// ============================================================================
// 5) !listasubdonos: nome primeiro, numero depois
// ============================================================================

await test('11. `!listasubdonos` mostra NOME antes do NUMERO', async () => {
  limpar();
  sub.adicionar(SUB_JID);
  const t = await run({
    text: '!listasubdonos',
    senderLid: OWNER_LID, senderJid: OWNER_JID,
    getName: (jid) => (String(jid).includes('5511888888888') ? 'Fulano da Silva' : undefined),
  });
  contem(t, 'Fulano da Silva', 'nome do subdono');
  contem(t, 'wa.me/5511888888888', 'numero do subdono');
  ok(t.indexOf('Fulano da Silva') < t.indexOf('wa.me/5511888888888'), 'nome vem antes do numero');
});

// ============================================================================
// RESUMO
// ============================================================================

const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log(`\n${totalFail === 0 ? 'OK' : 'ERR'} ${RESULTS.length} testes / ${totalOk} assercoes (${totalFail} falhas)`);
process.exit(totalFail === 0 ? 0 : 1);
