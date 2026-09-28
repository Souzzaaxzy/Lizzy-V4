/**
 * Testes do ANTI-ROUBO refatorado (modelo RAVENA-BOT/Kimori).
 *
 * Cobre:
 *   - o módulo puro `funcs/utils/antiRoubo.js` (telefone + LID, add/remover/
 *     listar/autorizar/decidir enforcement, migração do formato antigo);
 *   - os comandos pelo handler real: `!antiroubo` (menu/on/off), `!perm`,
 *     `!delp`, `!listperm`, `!limparperm`;
 *   - o ENFORCEMENT: promoção/rebaixamento não autorizado é revertido; o dono
 *     do grupo, o dono do bot e os autorizados passam.
 *
 * Uso: node tests/antiroubo.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-ar-'));
process.env.DATABASE_PATH = TMP_DB;
const GRUPOS_DIR = path.join(TMP_DB, 'grupos');
const DONO_DIR = path.join(TMP_DB, 'dono');
fs.mkdirSync(GRUPOS_DIR, { recursive: true });
fs.mkdirSync(DONO_DIR, { recursive: true });

const ar = await import(new URL('../dados/src/funcs/utils/antiRoubo.js', import.meta.url).href);

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
const handleParticipants = indexModule.handleGroupParticipantsUpdate;

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';
const SUB_JID = '5511888888888@s.whatsapp.net';
const SUB_LID = '222000000000002@lid';
const CREATOR_JID = '5511777777777@s.whatsapp.net';
const CREATOR_LID = '333000000000003@lid';

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
function makeGroup(extra = {}) {
  groupCounter += 1;
  const jid = `1203639300000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(path.join(GRUPOS_DIR, `${jid}.json`), JSON.stringify({ modobrincadeira: true, ...extra }, null, 2));
  return jid;
}
function lerGrupo(jid) {
  try { return JSON.parse(fs.readFileSync(path.join(GRUPOS_DIR, `${jid}.json`), 'utf-8')); } catch { return {}; }
}
// O anti-roubo tem arquivo PRÓPRIO (`dono/antiRoubo/<grupo>.json`), como o
// `ATIVAÇÕES-GRUPO` do bot de referência.
const AR_DIR = path.join(DONO_DIR, 'antiRoubo');
function lerAntiRoubo(jid) {
  try { return JSON.parse(fs.readFileSync(path.join(AR_DIR, `${jid}.json`), 'utf-8')); } catch { return {}; }
}

function participantes() {
  return [
    { lid: BOT_LID, jid: BOT_JID, id: BOT_LID, phoneNumber: BOT_JID, name: 'Lizzy', admin: 'superadmin' },
    { lid: OWNER_LID, jid: OWNER_JID, id: OWNER_LID, phoneNumber: OWNER_JID, name: 'Dono', admin: 'admin' },
    { lid: CREATOR_LID, jid: CREATOR_JID, id: CREATOR_LID, phoneNumber: CREATOR_JID, name: 'Criador', admin: 'admin' },
    { lid: SUB_LID, jid: SUB_JID, id: SUB_LID, phoneNumber: SUB_JID, name: 'Autorizado', isAdmin: false },
    { lid: '999000000000009@lid', jid: '5511999990009@s.whatsapp.net', id: '999000000000009@lid', phoneNumber: '5511999990009@s.whatsapp.net', name: 'Intruso', isAdmin: false },
  ];
}

async function run({ text, from, senderLid, senderJid, isAdmin = false, mentions = [], quotedParticipant = null, owner, fromMe = false }) {
  const sent = [];
  const gid = from || makeGroup();
  const partes = participantes();
  const nazu = {
    sendMessage: async (jid, content, options) => { sent.push({ jid, content, options }); return { key: { id: 'SENT' } }; },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
    onWhatsApp: async (jid) => [{ jid, exists: true, lid: null }],
    signalRepository: { lidMapping: { getPNForLID: async () => null } },
    contacts: { getName: () => undefined }, getName: () => undefined,
    groupMetadata: async () => ({ id: gid, subject: 'G', owner: owner || `${DONO_NUM}@s.whatsapp.net`, participants: partes }),
    profilePictureUrl: async () => 'x', react: async () => ({}),
    groupParticipantsUpdate: async () => ({}), readMessages: async () => {}, sendPresenceUpdate: async () => {},
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
  };
  const ctxt = { remoteJid: gid, mentionedJid: mentions };
  if (quotedParticipant) ctxt.participant = quotedParticipant;
  const info = {
    key: { remoteJid: gid, fromMe, id: `M-${Math.random().toString(36).slice(2, 8)}`, participant: senderLid },
    message: { extendedTextMessage: { text, contextInfo: ctxt } },
    messageTimestamp: 1757900000, pushName: 'U',
  };
  await handleMessage(nazu, info, null, new Map(), null);
  // `persistGroupData()` é assíncrono (writeJsonFileAsync): sem esta espera o
  // teste lê o JSON antes da gravação (corrida).
  await new Promise((r) => setTimeout(r, 250));
  return { sent, txt: sent.map((s) => s.content?.text ?? s.content?.caption ?? '').join('\n'), grupo: lerGrupo(gid), ar: lerAntiRoubo(gid), gid };
}

// O throttle é 3 cmd/5s por remetente; o helper roda como o BOT/OWNER (fromMe)
// quando possível para não esbarrar nele, e repete uma vez se ainda cair.
async function enviar(opts) {
  let r = await run(opts);
  for (let i = 0; i < 3 && r.txt.includes('Calma aí'); i++) r = await run(opts);
  return r;
}
// `fromMe: true` no dono: o gate de dono (isOwner) já é verdadeiro por ele, e
// isso pula o throttle (3 cmd/5s por remetente), que senão deixaria a suíte
// flaky ao acumular comandos entre os testes.
const comoDono = (t, extra = {}) => enviar({ text: t, senderLid: OWNER_LID, senderJid: OWNER_JID, isAdmin: true, fromMe: true, ...extra });
const comoIntruso = (t, extra = {}) => enviar({ text: t, senderLid: '999000000000009@lid', senderJid: '5511999990009@s.whatsapp.net', ...extra });

// ============================================================================
// 1) MÓDULO PURO
// ============================================================================

await test('1. toNum/baseJid/isLid descartam :device e resolvem LID', () => {
  ok(ar.toNum('5511999999999:14@s.whatsapp.net') === '5511999999999', 'toNum device');
  ok(ar.toNum('+55 (11) 99999-9999') === '5511999999999', 'toNum formatado');
  ok(ar.baseJid('222000000000002:3@lid') === '222000000000002@lid', 'baseJid lid');
  ok(ar.isLid('1@lid') && !ar.isLid('1@s.whatsapp.net'), 'isLid');
});

await test('2. normalizarEstado migra o formato antigo (authorizedUsers)', () => {
  const e = ar.normalizarEstado({ enabled: true, authorizedUsers: ['5511000000001@s.whatsapp.net', '222000000000002@lid'] });
  ok(e.enabled === true, 'enabled');
  ok(e.ar_permitidos.includes('5511000000001@s.whatsapp.net'), 'PN migrado');
  ok(e.ar_permitidos_lid.includes('222000000000002@lid'), 'LID migrado');
  ok(ar.normalizarEstado(null).ar_permitidos.length === 0, 'null tolerado');
  ok(ar.normalizarEstado('lixo').ar_permitidos_lid.length === 0, 'lixo tolerado');
});

await test('3. mapaIdentidades + resolverAlvo (LID <-> telefone)', () => {
  const { lidToPhone, phoneToLid } = ar.mapaIdentidades(participantes());
  ok(lidToPhone.get('222000000000002') === '5511888888888', 'lid->phone');
  ok(phoneToLid.get('5511888888888') === '222000000000002', 'phone->lid');
  const r1 = ar.resolverAlvo({ alvoRaw: '222000000000002@lid', participants: participantes() });
  ok(r1.telNum === '5511888888888' && r1.lidNum === '222000000000002', 'LID -> PN');
  const r2 = ar.resolverAlvo({ alvoRaw: '5511888888888@s.whatsapp.net', participants: participantes() });
  ok(r2.lidNum === '222000000000002', 'PN -> LID');
  const r3 = ar.resolverAlvo({ texto: 'perm @5511999999999', participants: participantes() });
  ok(r3.telNum === '5511999999999', '@numero digitado');
});

await test('4. add/remove/autoriza/listagem (telefone + LID)', () => {
  let est = ar.estadoVazio();
  let a = ar.adicionarPermissao(est, { telNum: '5511888888888', lidNum: '222000000000002' });
  ok(a.addedTel && a.addedLid, 'adiciona tel+lid');
  ok(ar.adicionarPermissao(a.estado, { telNum: '5511888888888' }).jaExistia, 'duplicado');
  ok(ar.estaAutorizado(a.estado, ['5511888888888']), 'autorizado por telefone');
  ok(ar.estaAutorizado(a.estado, ['222000000000002']), 'autorizado por LID');
  ok(!ar.estaAutorizado(a.estado, ['5511000000000']), 'nao autorizado');
  ok(ar.listarTelefonesAutorizados(a.estado, participantes()).length === 1, 'lista sem duplicar LID/PN');
  const rem = ar.removerPermissao(a.estado, { telNum: '5511888888888' });
  ok(rem.encontrado && rem.removedTel, 'removeu telefone');
  ok(!ar.removerPermissao(rem.estado, { telNum: '5511000000000' }).encontrado, 'inexistente');
  ok(ar.limparPermissoes(a.estado).ar_permitidos.length === 0, 'limpar');
});

await test('5. decidirEnforcement (dono do grupo, dono do bot, autorizado, punir)', () => {
  const ligado = ar.definirAtivo(ar.estadoVazio(), true);
  ok(ar.decidirEnforcement({ antiRoubo: ligado, acao: 'promote', formasAutor: ['5511'] }).acao === 'punir', 'nao autorizado -> punir');
  ok(ar.decidirEnforcement({ antiRoubo: ligado, acao: 'promote', formasAutor: ['5511777777777'], isDonoGrupo: true }).acao === 'permitir', 'dono do grupo');
  ok(ar.decidirEnforcement({ antiRoubo: ligado, acao: 'promote', formasAutor: [], isDonoBot: true }).acao === 'permitir', 'dono do bot');
  ok(ar.decidirEnforcement({ antiRoubo: ligado, acao: 'demote', formasAutor: [], eBot: true }).acao === 'permitir', 'bot');
  ok(ar.decidirEnforcement({ antiRoubo: { enabled: false }, acao: 'promote', formasAutor: [] }).acao === 'permitir', 'anti off');
  const comAut = ar.definirAtivo(ar.adicionarPermissao(ar.estadoVazio(), { lidNum: '222000000000002' }).estado, true);
  ok(ar.decidirEnforcement({ antiRoubo: comAut, acao: 'promote', formasAutor: ['222000000000002'] }).motivo === 'autorizado', 'autorizado por LID');
  ok(ar.acoesDeReversao('demote').vitimas === 'promote', 'reversao demote -> promote');
  ok(ar.acoesDeReversao('promote').vitimas === 'demote', 'reversao promote -> demote');
});

// ============================================================================
// 2) COMANDOS (handler real)
// ============================================================================

await test('6. !antiroubo mostra o menu com status e autorizados', async () => {
  const gid = makeGroup();
  const r = await comoDono('!antiroubo', { from: gid });
  contem(r.txt, 'ANTI-ROUBO', 'titulo');
  contem(r.txt, 'INATIVO', 'status inicial');
  contem(r.txt, 'Dono do grupo', 'dono do grupo');
  contem(r.txt, 'listperm', 'lista os comandos');
  ok(r.sent.some((s) => s.content?.mentions?.length), 'menciona alguem');
});

await test('7. !antiroubo on ativa; off desativa (persiste)', async () => {
  const gid = makeGroup();
  await comoDono('!antiroubo on', { from: gid });
  ok(lerAntiRoubo(gid).enabled === true, 'ligou no arquivo do anti-roubo');
  await comoDono('!antiroubo off', { from: gid });
  ok(lerAntiRoubo(gid).enabled === false, 'desligou no arquivo do anti-roubo');
});

await test('8. !perm adiciona (por menção LID) e liga o anti', async () => {
  const gid = makeGroup();
  await comoDono('!antiroubo on', { from: gid });
  const r = await comoDono(`!perm @${SUB_LID.split('@')[0]}`, { from: gid, mentions: [SUB_LID] });
  contem(r.txt, 'Autorizados', 'confirmou');
  const g = lerAntiRoubo(gid);
  ok(g.ar_permitidos_lid.includes(SUB_LID), 'gravou o LID');
  ok(g.ar_permitidos.includes(SUB_JID), 'gravou o telefone (resolvido)');
  ok(g.enabled === true, 'anti ligado');
});

await test('9. !perm sem alvo responde o uso', async () => {
  const gid = makeGroup();
  await comoDono('!antiroubo on', { from: gid });
  const r = await comoDono('!perm', { from: gid });
  contem(r.txt, 'Marque um ou mais usuários', 'uso');
});

await test('10. !perm exige o anti ligado', async () => {
  const gid = makeGroup();
  const r = await comoDono(`!perm @${SUB_LID.split('@')[0]}`, { from: gid, mentions: [SUB_LID] });
  contem(r.txt, 'Ative o anti-roubo', 'pede para ativar');
});

await test('11. !delp remove; !limparperm limpa tudo', async () => {
  const gid = makeGroup();
  await comoDono('!antiroubo on', { from: gid });
  await comoDono(`!perm @${SUB_LID.split('@')[0]}`, { from: gid, mentions: [SUB_LID] });
  ok(lerAntiRoubo(gid).ar_permitidos_lid.length === 1, 'tem 1 antes');
  await comoDono(`!delp @${SUB_LID.split('@')[0]}`, { from: gid, mentions: [SUB_LID] });
  ok(lerAntiRoubo(gid).ar_permitidos_lid.length === 0, 'removeu');
  await comoDono(`!perm @${SUB_LID.split('@')[0]}`, { from: gid, mentions: [SUB_LID] });
  const r = await comoDono('!limparperm', { from: gid });
  contem(r.txt, 'limpas', 'confirmou limpeza');
  ok(lerAntiRoubo(gid).ar_permitidos.length === 0 && lerAntiRoubo(gid).ar_permitidos_lid.length === 0, 'zerou tudo');
});

await test('12. !listperm lista os autorizados', async () => {
  const gid = makeGroup();
  await comoDono('!antiroubo on', { from: gid });
  await comoDono(`!perm @${SUB_LID.split('@')[0]}`, { from: gid, mentions: [SUB_LID] });
  const r = await comoDono('!listperm', { from: gid });
  contem(r.txt, 'AUTORIZADOS', 'titulo');
  contem(r.txt, '5511888888888', 'mostra o telefone resolvido');
});

await test('13. comando de permissoes e so do dono do bot', async () => {
  const gid = makeGroup();
  await comoDono('!antiroubo on', { from: gid });
  const r = await comoIntruso(`!perm @${SUB_LID.split('@')[0]}`, { from: gid, mentions: [SUB_LID] });
  contem(r.txt, 'Apenas o Dono do Bot', 'intruso barrado');
  ok((lerAntiRoubo(gid).ar_permitidos_lid || []).length === 0, 'nada foi gravado');
});

// ============================================================================
// 3) ENFORCEMENT (handleGroupParticipantsUpdate)
// ============================================================================

function orch(over = {}) {
  const sent = [];
  const calls = [];
  const nazu = {
    sendMessage: async (jid, content) => { sent.push({ jid, content }); return { key: { id: 'S' } }; },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID },
    groupParticipantsUpdate: async (jid, list, action) => { calls.push({ jid, list, action }); return {}; },
    groupMetadata: async () => ({ id: 'g@g.us', subject: 'G', owner: `${CREATOR_JID}`, participants: participantes() }),
  };
  return { nazu, sent, calls, ...over };
}

await test('14. ENFORCEMENT: promocao NAO autorizada e revertida', async () => {
  const gid = makeGroup({ antiRoubo: { enabled: true, ar_permitidos: [], ar_permitidos_lid: [] } });
  const { nazu, sent, calls } = orch();
  await handleParticipants(nazu, {
    id: gid, action: 'promote', participants: ['5511999990009@s.whatsapp.net'],
    author: '999000000000009@lid',
  }, String(DONO_NUM));
  const rebaixou = calls.filter((c) => c.action === 'demote');
  ok(rebaixou.length === 2, 'rebaixou executor + vitima (2 demotes)');
  ok(rebaixou.some((c) => c.list.includes('999000000000009@lid')), 'rebaixou o executor');
  ok(sent.some((s) => /ANTI-ROUBO/.test(s.content?.text || '')), 'avisou o grupo');
});

await test('15. ENFORCEMENT: autorizado (LID na lista) passa, sem reversao', async () => {
  const gid = makeGroup({ antiRoubo: { enabled: true, ar_permitidos: [], ar_permitidos_lid: [SUB_LID] } });
  const { nazu, calls } = orch();
  await handleParticipants(nazu, {
    id: gid, action: 'promote', participants: ['5511999990009@s.whatsapp.net'],
    author: SUB_LID,
  }, String(DONO_NUM));
  ok(calls.filter((c) => c.action === 'demote').length === 0, 'nao reverteu');
});

await test('16. ENFORCEMENT: autorizado cadastrado por TELEFONE passa (mensagem por LID)', async () => {
  const gid = makeGroup({ antiRoubo: { enabled: true, ar_permitidos: [SUB_JID], ar_permitidos_lid: [] } });
  const { nazu, calls } = orch();
  await handleParticipants(nazu, {
    id: gid, action: 'demote', participants: ['5511999990009@s.whatsapp.net'],
    author: SUB_LID,
  }, String(DONO_NUM));
  ok(calls.filter((c) => c.action === 'promote').length === 0, 'nao re-promoveu (autorizado)');
});

await test('17. ENFORCEMENT: rebaixamento NAO autorizado re-promove a vitima', async () => {
  const gid = makeGroup({ antiRoubo: { enabled: true, ar_permitidos: [], ar_permitidos_lid: [] } });
  const { nazu, calls } = orch();
  await handleParticipants(nazu, {
    id: gid, action: 'demote', participants: [CREATOR_JID],
    author: '999000000000009@lid',
  }, String(DONO_NUM));
  ok(calls.filter((c) => c.action === 'demote').some((c) => c.list.includes('999000000000009@lid')), 'rebaixou executor');
  ok(calls.filter((c) => c.action === 'promote').some((c) => c.list.includes(CREATOR_JID)), 're-promoveu vitima');
});

await test('18. ENFORCEMENT: dono do grupo passa', async () => {
  const gid = makeGroup({ antiRoubo: { enabled: true, ar_permitidos: [], ar_permitidos_lid: [] } });
  const { nazu, calls } = orch();
  await handleParticipants(nazu, {
    id: gid, action: 'promote', participants: ['5511999990009@s.whatsapp.net'],
    author: CREATOR_JID,
  }, String(DONO_NUM));
  ok(calls.length === 0, 'dono do grupo nao foi punido');
});

await test('19. ENFORCEMENT: anti desligado nao faz nada', async () => {
  const gid = makeGroup({ antiRoubo: { enabled: false } });
  const { nazu, calls } = orch();
  await handleParticipants(nazu, {
    id: gid, action: 'promote', participants: ['5511999990009@s.whatsapp.net'],
    author: '999000000000009@lid',
  }, String(DONO_NUM));
  ok(calls.length === 0, 'sem reversao');
});

await test('20. ENFORCEMENT: acoes do proprio bot sao ignoradas', async () => {
  const gid = makeGroup({ antiRoubo: { enabled: true, ar_permitidos: [], ar_permitidos_lid: [] } });
  const { nazu, calls } = orch();
  await handleParticipants(nazu, {
    id: gid, action: 'promote', participants: ['5511999990009@s.whatsapp.net'],
    author: BOT_LID,
  }, String(DONO_NUM));
  ok(calls.length === 0, 'bot ignorado');
});

// ============================================================================
// RESUMO
// ============================================================================

const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log(`\n${totalFail === 0 ? 'OK' : 'ERR'} ${RESULTS.length} testes / ${totalOk} assercoes (${totalFail} falhas)`);
process.exit(totalFail === 0 ? 0 : 1);
