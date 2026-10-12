/**
 * Testes do `!nuke` (dono).
 *
 * Roda o handler REAL (NazuninhaBotExec) com socket Baileys falso:
 *   - o bug antigo: `AllgroupMembers` vem em LID e o comando montava
 *     `<base-do-LID>@s.whatsapp.net` (numero que nao existe) -> ninguem era
 *     removido. Agora o alvo e' o proprio LID;
 *   - admins entram na lista de banimento;
 *   - o bot e o dono NAO entram;
 *   - ao executar como DONO: renomeia o grupo, muda a descricao e envia a
 *     mensagem de payment (nota) com o texto do arquivamento;
 *   - o pagamento sai por `relayMessage` (o caminho do `!rajar`), nao por
 *     `sendMessage`;
 *   - o bot SAI do grupo por ultimo;
 *   - subdono com permissao bane, mas NAO renomeia/descreve.
 *
 * Uso: node tests/nuke.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');

// Banco temporario ANTES de importar o index (paths.js le DATABASE_PATH no load).
const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-nuke-db-'));
process.env.DATABASE_PATH = TMP_DB;
fs.mkdirSync(path.join(TMP_DB, 'grupos'), { recursive: true });
fs.mkdirSync(path.join(TMP_DB, 'dono'), { recursive: true });

// CONFIG_PATH tambem ANTES do import: o paths.js resolve CONFIG_FILE no load.
// Sem isso o handler leria o config.json do repositorio e o teste sujaria a
// arvore de trabalho (era o que acontecia: perdia o newline final do arquivo).
const REPO_CONFIG = path.join(PROJECT, 'dados', 'src', 'config.json');
const TMP_CONFIG = path.join(TMP_DB, 'config.json');
process.env.CONFIG_PATH = TMP_CONFIG;
fs.copyFileSync(REPO_CONFIG, TMP_CONFIG);

const RESULTS = [];
let CURRENT = null;
function test(name, fn) {
  CURRENT = { name, passed: 0, failed: 0, errors: [] };
  RESULTS.push(CURRENT);
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      return r.then(() => finish(name)).catch((e) => { CURRENT.failed++; CURRENT.errors.push(`EXCEÇÃO: ${e?.stack || e}`); finish(name); });
    }
    finish(name);
  } catch (e) {
    CURRENT.failed++; CURRENT.errors.push(`EXCEÇÃO: ${e?.stack || e}`); finish(name);
  }
  return Promise.resolve();
}
function finish(name) {
  console.log(`${CURRENT.failed === 0 ? '✅' : '❌'} ${name} (${CURRENT.passed} ok, ${CURRENT.failed} falhas)`);
  for (const e of CURRENT.errors) console.log(`     ${e.split('\n')[0]}`);
}
function ok(c, m) { if (c) CURRENT.passed++; else { CURRENT.failed++; CURRENT.errors.push(`ASSERT FALHOU: ${m}`); } }
function eq(a, b, m) { ok(a === b, `${m} — esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`); }

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';
const MEMBRO_A_LID = '111000000000012@lid';
const MEMBRO_B_LID = '111000000000013@lid';
const ADMIN_LID = '111000000000010@lid';

let groupCounter = 0;
let authorCounter = 0;
const GRUPOS = path.join(TMP_DB, 'grupos');

function nextAuthor() {
  authorCounter++;
  return {
    lid: `99${String(authorCounter).padStart(6, '0')}888@lid`,
    jid: `5599${String(authorCounter).padStart(6, '0')}777@s.whatsapp.net`,
  };
}

function makeGroup() {
  groupCounter++;
  const jid = `1203639600000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(path.join(GRUPOS, `${jid}.json`), JSON.stringify({ groupName: 'G' }, null, 2));
  return jid;
}

function makeNazu({ sent, relayed, groupJid, removals, subjects, descriptions, leaves, pictures, botIsAdmin = true }) {
  return {
    sendMessage: async (jid, content, options) => { sent.push({ jid, content, options }); return { key: { id: `S-${sent.length}` } }; },
    relayMessage: async (jid, message, options) => { relayed.push({ jid, message, options }); return { key: { id: options?.messageId } }; },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
    onWhatsApp: async (jid) => [{ jid, exists: true, lid: jid }],
    signalRepository: { lidMapping: { getPNForLID: async () => null } },
    groupMetadata: async () => ({
      id: groupJid, subject: 'G',
      participants: [
        { id: ADMIN_LID, admin: 'admin', phoneNumber: '5511900000010@s.whatsapp.net' },
        { id: MEMBRO_A_LID, admin: null, phoneNumber: '5511900000012@s.whatsapp.net' },
        { id: MEMBRO_B_LID, admin: null, phoneNumber: '5511900000013@s.whatsapp.net' },
        { id: BOT_LID, admin: botIsAdmin ? 'admin' : null, phoneNumber: BOT_JID },
      ],
    }),
    groupParticipantsUpdate: async (jid, jids, action) => { removals.push({ jid, jids, action }); return jids.map(j => ({ status: '200', jid: j })); },
    groupUpdateSubject: async (jid, subject) => { subjects.push({ jid, subject }); },
    groupUpdateDescription: async (jid, description) => { descriptions.push({ jid, description }); },
    removeProfilePicture: async (jid) => { pictures.push({ jid }); },
    groupLeave: async (jid) => { leaves.push({ jid }); },
    groupSettingUpdate: async () => ({}),
    groupRequestParticipantsList: async () => [],
    groupRequestParticipantsUpdate: async () => ({}),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {},
    sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => 'x',
    react: async () => ({}),
  };
}

const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;
if (typeof handleMessage !== 'function') throw new Error('index.js não exporta o handler');

const CONFIG_PATH = REPO_CONFIG;
let CONFIG_BACKUP = null;

/** Torna `sender` o dono do bot (numerodono no config) e restaura depois.
 *
 * Escreve em `TMP_CONFIG` (respeitado por utils/paths.js) para NUNCA tocar o
 * config.json do repositório — sem isso o teste deixava o arquivo alterado
 * (perdia o newline final) e sujava a árvore de trabalho. */
function setOwner({ jid, lid }) {
  const cfg = JSON.parse(fs.readFileSync(TMP_CONFIG, 'utf-8'));
  if (CONFIG_BACKUP === null) CONFIG_BACKUP = JSON.parse(JSON.stringify(cfg));
  cfg.numerodono = jid;
  cfg.lidowner = lid;
  fs.writeFileSync(TMP_CONFIG, JSON.stringify(cfg, null, 2) + '\n');
}
function restoreConfig() {
  if (CONFIG_BACKUP !== null) fs.writeFileSync(TMP_CONFIG, JSON.stringify(CONFIG_BACKUP, null, 2) + '\n');
}

/** Executa `!nuke` e devolve tudo o que o comando fez. */
async function runNuke(opts = {}) {
  const sent = [];
  const relayed = [];
  const removals = [];
  const subjects = [];
  const descriptions = [];
  const pictures = [];
  const leaves = [];
  const author = opts.author || nextAuthor();
  const groupJid = opts.groupJid || makeGroup();
  const nazu = makeNazu({ sent, relayed, groupJid, removals, subjects, descriptions, pictures, leaves, botIsAdmin: opts.botIsAdmin });
  const info = {
    key: { remoteJid: groupJid, fromMe: false, id: `NUKE-${groupCounter}-${Math.random().toString(36).slice(2, 7)}`, participant: author.lid },
    message: { extendedTextMessage: { text: '!nuke', contextInfo: { remoteJid: groupJid } } },
    messageTimestamp: 1757900000, pushName: 'Autor',
  };
  await handleMessage(nazu, info, null, new Map(), null);
  const out = sent.map((s) => s.content?.text ?? '').filter(Boolean).join('\n');
  return { sent, relayed, removals, subjects, descriptions, pictures, leaves, out, groupJid, author };
}

/** Todos os jids banidos (achatados). */
const bannedJids = (removals) => removals.flatMap((r) => r.jids);

// ============================================================================
// PERMISSAO
// ============================================================================

await test('!nuke: membro comum é recusado e nada acontece', async () => {
  const r = await runNuke();
  ok(/dono/i.test(r.out), `recusa nao-dono (${r.out.slice(0, 60)})`);
  eq(r.removals.length, 0, 'nenhuma remoção');
  eq(r.subjects.length, 0, 'não renomeou');
  eq(r.relayed.length, 0, 'não enviou pagamento');
  eq(r.leaves.length, 0, 'não saiu');
});

await test('!nuke: fora de grupo é recusado', async () => {
  const sent = [];
  const removals = [];
  const author = nextAuthor();
  const nazu = makeNazu({ sent, relayed: [], groupJid: 'x@s.whatsapp.net', removals, subjects: [], descriptions: [], leaves: [] });
  const info = {
    key: { remoteJid: author.jid, fromMe: false, id: 'PV-1', participant: author.jid },
    message: { extendedTextMessage: { text: '!nuke' } },
    messageTimestamp: 1757900000, pushName: 'Autor',
  };
  await handleMessage(nazu, info, null, new Map(), null);
  const out = sent.map((s) => s.content?.text ?? '').join('\n');
  ok(/grupo/i.test(out), `recusa fora de grupo (${out.slice(0, 60)})`);
});

// ============================================================================
// O BUG ANTIGO: o alvo do banimento
// ============================================================================

await test('BUG CORRIGIDO: o alvo do banimento é o LID (não um JID inventado)', async () => {
  const author = nextAuthor();
  setOwner(author);
  try {
    const r = await runNuke({ author, authorIsAdmin: false });
    const jids = bannedJids(r.removals);
    // O bug antigo mandava `<base-do-LID>@s.whatsapp.net` (111000000000012@...),
    // um numero que nao existe. O alvo certo e' o LID.
    ok(jids.includes(MEMBRO_A_LID), `bane o membro A pelo LID (${MEMBRO_A_LID})`);
    ok(jids.includes(MEMBRO_B_LID), 'bane o membro B pelo LID');
    ok(!jids.some(j => j === '111000000000012@s.whatsapp.net'), 'NAO manda o LID como @s.whatsapp.net');
    ok(!jids.some(j => /^1110000\d+@s\.whatsapp\.net$/.test(j)), 'nenhum JID montado a partir do LID');
  } finally {
    restoreConfig();
  }
});

await test('!nuke: admins entram na lista de banimento', async () => {
  const author = nextAuthor();
  setOwner(author);
  try {
    const r = await runNuke({ author });
    const jids = bannedJids(r.removals);
    ok(jids.includes(ADMIN_LID), 'bane tambem o admin do grupo');
  } finally {
    restoreConfig();
  }
});

await test('!nuke: o bot e o dono NÃO são banidos', async () => {
  const author = nextAuthor();
  setOwner(author);
  try {
    const r = await runNuke({ author });
    const jids = bannedJids(r.removals);
    ok(!jids.includes(BOT_LID), 'o bot não se bane');
    ok(!jids.includes(author.lid), 'o dono (autor) não é banido');
    eq(jids.length, 3, 'sobram os 3 membros (admin + 2 membros)');
  } finally {
    restoreConfig();
  }
});

// ============================================================================
// NOME, DESCRICAO E PAYMENT (so na execucao do DONO)
// ============================================================================

await test('DONO: renomeia o grupo para "𝐀𝐫𝐜𝐡𝐢𝐯𝐞𝐝 𝐁𝐲 𝐊𝐚𝐧𝐧𝐨𝐧"', async () => {
  const author = nextAuthor();
  setOwner(author);
  try {
    const r = await runNuke({ author });
    eq(r.subjects.length, 1, 'mudou o nome uma vez');
    eq(r.subjects[0].jid, r.groupJid, 'no grupo certo');
    eq(r.subjects[0].subject, '𝐀𝐫𝐜𝐡𝐢𝐯𝐞𝐝 𝐁𝐲 𝐊𝐚𝐧𝐧𝐨𝐧', 'nome exato');
  } finally {
    restoreConfig();
  }
});

await test('DONO: muda a descrição com o texto do arquivamento', async () => {
  const author = nextAuthor();
  setOwner(author);
  try {
    const r = await runNuke({ author });
    eq(r.descriptions.length, 1, 'mudou a descrição uma vez');
    const d = r.descriptions[0].description;
    ok(d.startsWith('b𖤐 𝐆𝐑𝐎𝐔𝐏 𝐀𝐑𝐂𝐇𝐈𝐕𝐄𝐃 𖤐'), 'começa com o cabeçalho');
    ok(d.includes('ㅤ𝐔𝐧𝐟𝐨𝐫𝐭𝐮𝐧𝐚𝐭𝐞𝐥𝐲, 𝐭𝐡𝐢𝐬 𝐠𝐫𝐨𝐮𝐩 𝐡𝐚𝐬 𝐛𝐞𝐞𝐧 𝐚𝐫𝐜𝐡𝐢𝐯𝐞𝐝.'), 'tem a 1ª linha');
    ok(d.includes('ㅤ𝐁𝐮𝐭 𝐞𝐯𝐞𝐧 𝐢𝐧 𝐢𝐭𝐬 𝐟𝐚𝐥𝐥, 𝐢𝐭 𝐥𝐞𝐚𝐯𝐞𝐬 𝐢𝐭𝐬 𝐦𝐚𝐫𝐤.'), 'tem a linha do "leaves its mark"');
    ok(d.trimEnd().endsWith('𝐀𝐫𝐜𝐡𝐢𝐯𝐞𝐝 𝐁𝐲 𝐊𝐚𝐧𝐧𝐨𝐧'), 'termina com "Archived By Kannon"');
  } finally {
    restoreConfig();
  }
});

await test('DONO: envia a mensagem de PAYMENT com o texto do arquivamento', async () => {
  const author = nextAuthor();
  setOwner(author);
  try {
    const r = await runNuke({ author });
    // O pagamento sai por relayMessage (o caminho do !rajar), nao por sendMessage.
    eq(r.relayed.length, 1, 'enviou 1 mensagem por relayMessage');
    const msg = r.relayed[0].message;
    ok(msg.requestPaymentMessage, 'é um requestPaymentMessage');
    const nota = msg.requestPaymentMessage?.noteMessage?.extendedTextMessage?.text || '';
    ok(nota.startsWith('𓆩 𝐀𝐑𝐂𝐇𝐈𝐕𝐄𝐃 𝐁𝐘 𝐊𝐀𝐍𝐍𝐎𝐍 𓆪'), 'a nota começa com o título');
    ok(nota.includes('ㅤUnfortunately, this group has been archived.'), 'tem a 1ª linha em inglês');
    ok(nota.includes('ㅤNo more noise, no more movement, just silence.'), 'tem a linha do silêncio');
    ok(nota.includes("ㅤThis chapter is closed, and there's no turning back."), 'tem a linha do "no turning back"');
    ok(nota.trimEnd().endsWith('The group is archived. The legacy remains. ☾.'), 'termina com a frase final');
    eq(r.relayed[0].options?.messageId, msg ? r.relayed[0].options.messageId : null, 'sai com messageId');
    ok(!!r.relayed[0].options?.messageId, 'messageId presente (o WhatsApp descarta id repetido)');
  } finally {
    restoreConfig();
  }
});

await test('DONO: remove a foto do grupo', async () => {
  const author = nextAuthor();
  setOwner(author);
  try {
    const r = await runNuke({ author });
    eq(r.pictures.length, 1, 'removeu a foto uma vez');
    eq(r.pictures[0].jid, r.groupJid, 'no grupo certo');
  } finally {
    restoreConfig();
  }
});

await test('DONO: a foto sai junto do ritual (nome + descrição + foto)', async () => {
  const author = nextAuthor();
  setOwner(author);
  try {
    const r = await runNuke({ author });
    eq(r.subjects.length, 1, 'renomeou');
    eq(r.descriptions.length, 1, 'descreveu');
    eq(r.pictures.length, 1, 'removeu a foto');
  } finally {
    restoreConfig();
  }
});

await test('DONO: sem removeProfilePicture na fork, o ritual não quebra', async () => {
  const author = nextAuthor();
  setOwner(author);
  try {
    const sent = [], relayed = [], removals = [], subjects = [], descriptions = [], pictures = [], leaves = [];
    const groupJid = makeGroup();
    const nazu = makeNazu({ sent, relayed, groupJid, removals, subjects, descriptions, pictures, leaves });
    delete nazu.removeProfilePicture; // fork antiga
    const info = {
      key: { remoteJid: groupJid, fromMe: false, id: 'NUKE-NOPIC', participant: author.lid },
      message: { extendedTextMessage: { text: '!nuke', contextInfo: { remoteJid: groupJid } } },
      messageTimestamp: 1757900000, pushName: 'Autor',
    };
    await handleMessage(nazu, info, null, new Map(), null);
    eq(subjects.length, 1, 'ainda renomeia');
    eq(descriptions.length, 1, 'ainda descreve');
    eq(pictures.length, 0, 'não tenta remover a foto');
    ok(removals.length > 0, 'ainda bane');
    eq(leaves.length, 1, 'ainda sai');
  } finally {
    restoreConfig();
  }
});

// ============================================================================
// ORDEM E SAIDA
// ============================================================================

await test('!nuke: bane ANTES de sair do grupo (o bot sai por último)', async () => {
  const author = nextAuthor();
  setOwner(author);
  try {
    // Ordem observada pelo log de operações: nome -> descrição -> payment -> bans -> leave.
    const ordem = [];
    const sent = [], relayed = [], removals = [], subjects = [], descriptions = [], pictures = [], leaves = [];
    const groupJid = makeGroup();
    const nazu = makeNazu({ sent, relayed, groupJid, removals, subjects, descriptions, pictures, leaves });
    nazu.groupUpdateSubject = async (j, s) => { ordem.push('subject'); subjects.push({ jid: j, subject: s }); };
    nazu.groupUpdateDescription = async (j, d) => { ordem.push('description'); descriptions.push({ jid: j, description: d }); };
    nazu.removeProfilePicture = async (j) => { ordem.push('picture'); pictures.push({ jid: j }); };
    nazu.relayMessage = async (j, m, o) => { ordem.push('payment'); relayed.push({ jid: j, message: m, options: o }); return { key: { id: o?.messageId } }; };
    nazu.groupParticipantsUpdate = async (j, jids, a) => { ordem.push('ban'); removals.push({ jid: j, jids, action: a }); return jids.map(x => ({ status: '200', jid: x })); };
    nazu.groupLeave = async (j) => { ordem.push('leave'); leaves.push({ jid: j }); };

    const info = {
      key: { remoteJid: groupJid, fromMe: false, id: 'NUKE-ORD', participant: author.lid },
      message: { extendedTextMessage: { text: '!nuke', contextInfo: { remoteJid: groupJid } } },
      messageTimestamp: 1757900000, pushName: 'Autor',
    };
    await handleMessage(nazu, info, null, new Map(), null);

    ok(ordem.indexOf('subject') === 0, `1º renomeia (ordem: ${ordem.join(' > ')})`);
    ok(ordem.indexOf('description') === 1, '2º descreve');
    ok(ordem.indexOf('picture') === 2, '3º remove a foto');
    ok(ordem.indexOf('payment') === 3, '4º manda o payment');
    ok(ordem.indexOf('ban') === 4, '5º bane');
    eq(ordem[ordem.length - 1], 'leave', 'sai por último');
  } finally {
    restoreConfig();
  }
});

// ============================================================================
// SUBDONO
// ============================================================================

await test('SUBDONO: bane, mas NÃO renomeia/descreve o grupo', async () => {
  const author = nextAuthor();
  // NAO chama setOwner: o autor nao e' o dono. Adiciona como subdono com `all`.
  const subdonos = await import(new URL('../dados/src/utils/subdonos.js', import.meta.url).href);
  subdonos.adicionar(author.lid, { perms: ['all'] });
  try {
    const r = await runNuke({ author });
    ok(r.removals.length > 0, 'o subdono bane');
    eq(r.subjects.length, 0, 'mas NÃO renomeia');
    eq(r.descriptions.length, 0, 'nem muda a descrição');
    eq(r.pictures.length, 0, 'nem remove a foto');
    // O payment e o leave continuam (fazem parte do comando, nao do ritual do dono).
    eq(r.relayed.length, 1, 'envia o payment');
    eq(r.leaves.length, 1, 'sai do grupo');
  } finally {
    subdonos.remover(author.lid);
  }
});

// ============================================================================
// RESULTADO
// ============================================================================

console.log('\n' + '='.repeat(70));
const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
const suites = RESULTS.length;
const falhas = RESULTS.filter(r => r.failed > 0).length;
console.log(`RESULTADO: ${suites - falhas}/${suites} testes ok, ${totalOk} asserções ok, ${totalFail} falhas`);
process.exit(totalFail > 0 ? 1 : 0);
