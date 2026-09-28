/**
 * Testes do comando `!cf` (`!melhoresamigos`) — GRUPO de amizades.
 *
 * O comando veio de outro bot e foi REFATORADO em relação à primeira versão
 * (que era `!ma` com uma lista solta). Agora é um grupo por criador:
 *
 *     !cf criar <nome>     cria/renomeia o grupo
 *     !cf add @a @b ...     adiciona um ou vários (menções OU resposta)
 *     !cf kick @a @b ...    remove um ou vários
 *     !cf del               apaga o grupo
 *     !cf                   mini menu do grupo
 *
 * O "Nick" passa a ser o NOME DO CONTATO (store.contacts) — nunca o LID. Aqui
 * o socket falso fornece `store.contacts` justamente para provar isso.
 *
 * Roda o HANDLER REAL com socket falso. Uso: node tests/amigos.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Banco temporário ANTES de importar o bot (paths.js lê DATABASE_PATH no load).
const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-amigos-db-'));
process.env.DATABASE_PATH = TMP_DB;
const GRUPOS_DIR = path.join(TMP_DB, 'grupos');
const DONO_DIR = path.join(TMP_DB, 'dono');
fs.mkdirSync(GRUPOS_DIR, { recursive: true });
fs.mkdirSync(DONO_DIR, { recursive: true });

const CF_FILE = path.join(DONO_DIR, 'amigos.json');

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
  ok(typeof haystack === 'string' && desbold(haystack).includes(needle), `${label ?? needle} — esperado conter "${needle}"`);
}

function notIncludes(haystack, needle, label) {
  ok(typeof haystack === 'string' && !desbold(haystack).includes(needle), `${label ?? needle} — não deveria conter "${needle}"`);
}

/** Normaliza bold Unicode (vários blocos) para ASCII antes de comparar. */
function desbold(text) {
  if (typeof text !== 'string') return text;
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp >= 0x1d400 && cp <= 0x1d419) out += String.fromCharCode(65 + (cp - 0x1d400));
    else if (cp >= 0x1d41a && cp <= 0x1d433) out += String.fromCharCode(97 + (cp - 0x1d41a));
    else if (cp >= 0x1d468 && cp <= 0x1d481) out += String.fromCharCode(65 + (cp - 0x1d468));
    else if (cp >= 0x1d482 && cp <= 0x1d49b) out += String.fromCharCode(97 + (cp - 0x1d482));
    else if (cp >= 0x1d5d4 && cp <= 0x1d5ed) out += String.fromCharCode(65 + (cp - 0x1d5d4));
    else if (cp >= 0x1d5ee && cp <= 0x1d607) out += String.fromCharCode(97 + (cp - 0x1d5ee));
    else if (cp >= 0x1d63c && cp <= 0x1d655) out += String.fromCharCode(65 + (cp - 0x1d63c));
    else if (cp >= 0x1d656 && cp <= 0x1d66f) out += String.fromCharCode(97 + (cp - 0x1d656));
    else if (cp >= 0x1d7ce && cp <= 0x1d7e7) out += String.fromCharCode(48 + (cp - 0x1d7ce));
    else out += ch;
  }
  return out;
}

// ============================================================================
// HANDLER REAL + FIXTURES
// ============================================================================

const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;
if (typeof handleMessage !== 'function') throw new Error('index.js não exporta o handler');

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';

let groupCounter = 0;
let senderCounter = 0;

/** Grupo novo a cada teste (o metadata é cacheado por grupo, TTL 10s). */
function makeGroup(extra = {}) {
  groupCounter += 1;
  const jid = `1203637000000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(
    path.join(GRUPOS_DIR, `${jid}.json`),
    JSON.stringify({ modobrincadeira: true, groupName: `Grupo CF ${groupCounter}`, ...extra }, null, 2)
  );
  return jid;
}

/** Pessoa com LID, JID, nome de contato e número próprios. */
function makePerson(label) {
  senderCounter += 1;
  const n = String(senderCounter).padStart(4, '0');
  return {
    lid: `5551${n}000000@lid`,
    jid: `5511${n}999999@s.whatsapp.net`,
    name: `Contato ${label ?? n}`,
    number: `5511${n}999999`,
  };
}

function makeNazu({ sent, groupJid, participants, getNameImpl, metaNotifyImpl, contactsExtra }) {
  const map = {};
  const contacts = {};
  for (const p of participants) {
    if (p.jid && p.lid) map[p.jid] = p.lid;
    if (p.lid && p.jid) map[p.lid] = p.jid;
    // `store.contacts` é a AGENDA da sessão: aqui é a fonte do "Nick".
    if (p.name) contacts[p.jid] = { notify: p.name };
  }
  Object.assign(contacts, contactsExtra || {});
  return {
    sent,
    store: { contacts },
    sendMessage: async (jid, content, options) => {
      sent.push({ jid, content, options });
      return { key: { id: 'SENT' } };
    },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
    onWhatsApp: async (jid) => {
      const lid = map[jid];
      return lid ? [{ jid, exists: true, lid }] : [{ jid, exists: false }];
    },
    signalRepository: { lidMapping: { getPNForLID: async (lid) => map[lid] || null } },
    getName: getNameImpl || (async (_group, jid) => {
      // O bot devolve o NOME DO CONTATO (agenda) — é a fonte preferida.
      const p = participants.find((x) => x.lid === jid || x.jid === jid);
      return p?.name || String(jid || '').split('@')[0];
    }),
    groupMetadata: async () => ({
      id: groupJid,
      subject: 'Grupo CF',
      participants: participants.map((p) => ({
        id: p.lid,
        lid: p.lid,
        phoneNumber: p.jid,
        notify: metaNotifyImpl ? metaNotifyImpl(p) : p.name,
        admin: p.isAdmin ? 'admin' : null,
      })),
    }),
    groupParticipantsUpdate: async () => ({}),
    groupRequestParticipantsList: async () => [],
    groupRequestParticipantsUpdate: async () => ({}),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {},
    sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => 'https://example.com/pic.jpg',
    react: async () => ({}),
  };
}

/**
 * Executa um comando no handler real.
 *
 * `fromMe: true` pula o throttle de 3 comandos/5s por remetente (que
 * atrapalharia uma suíte longa) sem mudar nada do comando testado.
 *
 * - `mentionIds`: JIDs/LIDs marcados (o handler normaliza para LID);
 * - `quoted`: pessoa RESPONDIDA (o alvo quando não há menção).
 */
async function run({ groupJid, sender, text, mentions = [], quoted = null, sent = [], participants, getNameImpl, metaNotifyImpl, contactsExtra }) {
  const nazu = makeNazu({ sent, groupJid, participants, getNameImpl, metaNotifyImpl, contactsExtra });
  const contextInfo = { remoteJid: groupJid };
  if (mentions.length) contextInfo.mentionedJid = mentions.map((m) => m.lid || m);
  if (quoted) contextInfo.participant = quoted.lid;
  const info = {
    key: { remoteJid: groupJid, fromMe: true, id: `M-${Math.random().toString(36).slice(2, 10)}`, participant: sender.lid },
    message: { extendedTextMessage: { text, contextInfo } },
    messageTimestamp: 1757900000,
    pushName: sender.name,
  };
  await handleMessage(nazu, info, null, new Map(), null);
  return sent;
}

function textOf(sent) {
  return sent.map((s) => s.content?.text ?? '').filter(Boolean).join('\n');
}

function readCF() {
  try {
    return JSON.parse(fs.readFileSync(CF_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function resetCF() {
  try { fs.rmSync(CF_FILE, { force: true }); } catch {}
}

/** Grupo com o usuário, dois alvos e o bot. */
function setup() {
  const groupJid = makeGroup();
  const user = makePerson('Usuario');
  const alvo = makePerson('Alvo');
  const alvo2 = makePerson('Alvo2');
  const participants = [
    { lid: user.lid, jid: user.jid, name: user.name, isAdmin: true },
    { lid: alvo.lid, jid: alvo.jid, name: alvo.name },
    { lid: alvo2.lid, jid: alvo2.jid, name: alvo2.name },
    { lid: BOT_LID, jid: BOT_JID, name: 'Lizzy', isAdmin: true },
  ];
  return { groupJid, user, alvo, alvo2, participants };
}

// ============================================================================
// 1) GUARDAS
// ============================================================================

await test('1. fora de grupo: avisa que só funciona em grupo', async () => {
  resetCF();
  const { user } = setup();
  const sent = await run({ groupJid: user.jid, sender: user, text: '!cf', participants: [] });
  includes(textOf(sent), 'só funciona em grupos', 'aviso de PV');
});

await test('2. modo brincadeira desligado: recusa', async () => {
  resetCF();
  const groupJid = makeGroup({ modobrincadeira: false });
  const user = makePerson('U');
  const partes = [{ lid: user.lid, jid: user.jid, name: user.name }];
  const sent = await run({ groupJid, sender: user, text: '!cf', participants: partes });
  includes(textOf(sent), 'modo brincadeira está desligado', 'aviso de modo');
});

// ============================================================================
// 2) CRIAR
// ============================================================================

await test('3. !cf criar sem nome: mostra o exemplo', async () => {
  resetCF();
  const { groupJid, user, participants } = setup();
  const sent = await run({ groupJid, sender: user, text: '!cf criar', participants });
  includes(textOf(sent), 'Informe o nome', 'pede o nome');
  includes(textOf(sent), 'cf criar', 'exemplo de criar');
});

await test('4. !cf criar <nome>: cria o grupo e persiste o nome', async () => {
  resetCF();
  const { groupJid, user, participants } = setup();
  const sent = await run({ groupJid, sender: user, text: '!cf criar Melhores Amigos', participants });
  const t = textOf(sent);
  includes(t, 'Melhores Amigos', 'mostra o nome do grupo');
  includes(t, 'Integrantes: 0/20', 'integrantes 0/20');
  const banco = readCF();
  ok(banco[user.lid]?.nome === 'Melhores Amigos', 'persistiu o nome');
  ok(Array.isArray(banco[user.lid]?.membros), 'tem lista de membros');
});

// ============================================================================
// 3) ADD
// ============================================================================

await test('5. !cf add sem alvo: mostra o exemplo', async () => {
  resetCF();
  const { groupJid, user, participants } = setup();
  const sent = await run({ groupJid, sender: user, text: '!cf add', participants });
  includes(textOf(sent), 'cf add', 'exemplo de add');
});

await test('6. !cf add antes de criar: pede para criar primeiro', async () => {
  resetCF();
  const { groupJid, user, alvo, participants } = setup();
  const sent = await run({ groupJid, sender: user, text: '!cf add', mentions: [alvo], participants });
  includes(textOf(sent), 'criou seu grupo', 'pede criar primeiro');
});

await test('7. !cf add por MENÇÃO: adiciona e persiste', async () => {
  resetCF();
  const { groupJid, user, alvo, participants } = setup();
  await run({ groupJid, sender: user, text: '!cf criar Grupo', participants });
  const sent = await run({ groupJid, sender: user, text: '!cf add', mentions: [alvo], participants });
  includes(textOf(sent), 'Adicionados', 'confirma adição');
  const lista = readCF()[user.lid].membros;
  ok(lista.length === 1 && lista[0].id === alvo.lid, 'salvou o alvo pelo LID');
});

await test('8. !cf add por RESPOSTA (sem menção): adiciona', async () => {
  resetCF();
  const { groupJid, user, alvo, participants } = setup();
  await run({ groupJid, sender: user, text: '!cf criar Grupo', participants });
  const sent = await run({ groupJid, sender: user, text: '!cf add', quoted: alvo, participants });
  includes(textOf(sent), 'Adicionados', 'confirma adição por resposta');
  ok(readCF()[user.lid].membros.length === 1, 'adicionou 1');
});

await test('9. !cf add MÚLTIPLO: adiciona 2 de uma vez', async () => {
  resetCF();
  const { groupJid, user, alvo, alvo2, participants } = setup();
  await run({ groupJid, sender: user, text: '!cf criar Grupo', participants });
  const sent = await run({ groupJid, sender: user, text: '!cf add', mentions: [alvo, alvo2], participants });
  includes(textOf(sent), 'Integrantes: 2/20', '2 integrantes');
  ok(readCF()[user.lid].membros.length === 2, 'salvou os 2');
});

await test('10. !cf add de quem já está: só avisa', async () => {
  resetCF();
  const { groupJid, user, alvo, participants } = setup();
  await run({ groupJid, sender: user, text: '!cf criar Grupo', participants });
  await run({ groupJid, sender: user, text: '!cf add', mentions: [alvo], participants });
  const sent = await run({ groupJid, sender: user, text: '!cf add', mentions: [alvo], participants });
  includes(textOf(sent), 'Já estavam', 'avisa duplicado');
  ok(readCF()[user.lid].membros.length === 1, 'não duplicou');
});

await test('11. !cf add de si mesmo: recusa', async () => {
  resetCF();
  const { groupJid, user, participants } = setup();
  await run({ groupJid, sender: user, text: '!cf criar Grupo', participants });
  const sent = await run({ groupJid, sender: user, text: '!cf add', mentions: [user], participants });
  includes(textOf(sent), 'você mesmo', 'recusa auto-add');
  ok(readCF()[user.lid].membros.length === 0, 'não se adicionou');
});

// ============================================================================
// 4) KICK
// ============================================================================

await test('12. !cf kick: remove um membro', async () => {
  resetCF();
  const { groupJid, user, alvo, participants } = setup();
  await run({ groupJid, sender: user, text: '!cf criar Grupo', participants });
  await run({ groupJid, sender: user, text: '!cf add', mentions: [alvo], participants });
  const sent = await run({ groupJid, sender: user, text: '!cf kick', mentions: [alvo], participants });
  includes(textOf(sent), 'Removidos', 'confirma remoção');
  ok(readCF()[user.lid].membros.length === 0, 'removeu do arquivo');
});

await test('13. !cf kick MÚLTIPLO: remove 2', async () => {
  resetCF();
  const { groupJid, user, alvo, alvo2, participants } = setup();
  await run({ groupJid, sender: user, text: '!cf criar Grupo', participants });
  await run({ groupJid, sender: user, text: '!cf add', mentions: [alvo, alvo2], participants });
  const sent = await run({ groupJid, sender: user, text: '!cf kick', mentions: [alvo, alvo2], participants });
  includes(textOf(sent), 'Removidos', 'remove os 2');
  ok(readCF()[user.lid].membros.length === 0, 'lista zerada');
});

await test('14. !cf kick de quem não está: avisa', async () => {
  resetCF();
  const { groupJid, user, alvo, participants } = setup();
  await run({ groupJid, sender: user, text: '!cf criar Grupo', participants });
  const sent = await run({ groupJid, sender: user, text: '!cf kick', mentions: [alvo], participants });
  includes(textOf(sent), 'ainda não tem membros', 'avisa lista vazia');
});

await test('15. !cf kick sem alvo: pede exemplo', async () => {
  resetCF();
  const { groupJid, user, alvo, participants } = setup();
  await run({ groupJid, sender: user, text: '!cf criar Grupo', participants });
  await run({ groupJid, sender: user, text: '!cf add', mentions: [alvo], participants });
  const sent = await run({ groupJid, sender: user, text: '!cf kick', participants });
  includes(textOf(sent), 'cf kick', 'exemplo de kick');
});

// ============================================================================
// 5) DEL
// ============================================================================

await test('16. !cf del: apaga o grupo', async () => {
  resetCF();
  const { groupJid, user, alvo, participants } = setup();
  await run({ groupJid, sender: user, text: '!cf criar Grupo', participants });
  await run({ groupJid, sender: user, text: '!cf add', mentions: [alvo], participants });
  const sent = await run({ groupJid, sender: user, text: '!cf del', participants });
  includes(textOf(sent), 'apagado com sucesso', 'confirma a exclusão');
  ok(!readCF()[user.lid], 'removeu o grupo do arquivo');
});

await test('17. !cf del sem grupo: recusa', async () => {
  resetCF();
  const { groupJid, user, participants } = setup();
  const sent = await run({ groupJid, sender: user, text: '!cf del', participants });
  includes(textOf(sent), 'não possui um grupo', 'avisa que não existe');
});

// ============================================================================
// 6) MINI MENU + NICK
// ============================================================================

await test('18. mini menu: monta a caixa, medalhas e os rodapés certos', async () => {
  resetCF();
  const { groupJid, user, alvo, alvo2, participants } = setup();
  await run({ groupJid, sender: user, text: '!cf criar Café da Firma', participants });
  await run({ groupJid, sender: user, text: '!cf add', mentions: [alvo, alvo2], participants });
  const sent = await run({ groupJid, sender: user, text: '!cf', participants });
  const t = textOf(sent);

  includes(t, '╭━━〔 Café da Firma 〕━━╮', 'cabeçalho com o nome');
  includes(t, '👥 Membros: 20', 'linha de membros');
  includes(t, '📊 Integrantes: 2/20', 'linha de integrantes');
  includes(t, '🥇 1º', 'medalha do 1º');
  includes(t, '🥈 2º', 'medalha do 2º');
  includes(t, '💙 Nick:', 'linha de nick');
  includes(t, '📅 No grupo há', 'linha de tempo');
  includes(t, 'Para adicionar: *!cf add*', 'rodapé add');
  includes(t, 'Para remover: *!cf kick*', 'rodapé kick');
  includes(t, 'Limite: *20 membros*', 'rodapé limite');
});

await test('19. Nick é o NOME DO CONTATO — nunca o LID', async () => {
  resetCF();
  const { groupJid, user, alvo, participants } = setup();
  await run({ groupJid, sender: user, text: '!cf criar Grupo', participants });
  await run({ groupJid, sender: user, text: '!cf add', mentions: [alvo], participants });
  const sent = await run({ groupJid, sender: user, text: '!cf', participants });
  const t = textOf(sent);

  includes(t, `💙 Nick: ${alvo.name}`, 'o nick é o nome do contato');
  notIncludes(t, `💙 Nick: ${alvo.lid.split('@')[0]}`, 'o nick NÃO é o LID');
  notIncludes(t, `Nick: ${alvo.number}`, 'o nick não caiu no número (havia nome)');

  // A menção usa o número do JID (@<numero>), como o WhatsApp espera.
  const card = sent.find((s) => Array.isArray(s.content?.mentions) && s.content.mentions.includes(alvo.lid));
  ok(!!card, 'menciona o membro pelo LID');
  includes(t, `@${alvo.lid.split('@')[0]}`, 'mostra a menção @numero');
});

await test('19b. o nome vem do `getName` do contato — não do metadata/número', async () => {
  resetCF();
  // Grupo NOVO + membro pré-gravado: assim o ÚNICO comando naquele grupo é o
  // `!cf` final, e o metadata cacheado (TTL 10s) é o que passamos com override.
  const groupJid = makeGroup();
  const user = makePerson('Usuario');
  const alvo = makePerson('Alvo');
  const participants = [
    { lid: user.lid, jid: user.jid, name: user.name, isAdmin: true },
    { lid: alvo.lid, jid: alvo.jid, name: alvo.name },
    { lid: BOT_LID, jid: BOT_JID, name: 'Lizzy', isAdmin: true },
  ];
  fs.writeFileSync(CF_FILE, JSON.stringify({
    [user.lid]: { nome: 'Grupo', criadoEm: Date.now(), membros: [{ id: alvo.lid, desde: Date.now() }] },
  }, null, 2));

  // `getName` devolve o NOME DA AGENDA; o metadata devolve o NÚMERO.
  const sent = await run({
    groupJid, sender: user, text: '!cf', participants,
    getNameImpl: async (_g, jid) => (jid.includes(alvo.lid.split('@')[0]) ? 'NomeDaAgenda' : user.name),
    metaNotifyImpl: (p) => p.jid.split('@')[0], // metadata entrega o número
    contactsExtra: { [alvo.jid]: {} },
  });
  const t = textOf(sent);
  includes(t, '💙 Nick: NomeDaAgenda', 'usa o nome do contato (getName)');
  notIncludes(t, `Nick: ${alvo.number}`, 'não usa o número do metadata');
});

await test('19c. sem nome nenhum: cai no NÚMERO (nunca no LID)', async () => {
  resetCF();
  const groupJid = makeGroup();
  const user = makePerson('Usuario');
  const alvo = makePerson('Alvo');
  const participants = [
    { lid: user.lid, jid: user.jid, name: user.name, isAdmin: true },
    { lid: alvo.lid, jid: alvo.jid, name: alvo.name },
    { lid: BOT_LID, jid: BOT_JID, name: 'Lizzy', isAdmin: true },
  ];
  fs.writeFileSync(CF_FILE, JSON.stringify({
    [user.lid]: { nome: 'Grupo', criadoEm: Date.now(), membros: [{ id: alvo.lid, desde: Date.now() }] },
  }, null, 2));

  const nLid = alvo.lid.split('@')[0];
  const sent = await run({
    groupJid, sender: user, text: '!cf', participants,
    getNameImpl: async (_g, jid) => jid.split('@')[0],  // devolve o id cru
    metaNotifyImpl: () => '',                          // metadata sem nome
    contactsExtra: { [alvo.jid]: {} },                 // agenda sem nome
  });
  const t = textOf(sent);
  includes(t, `💙 Nick: ${alvo.number}`, 'cai no número de telefone');
  notIncludes(t, `💙 Nick: ${nLid}`, 'NUNCA cai no LID');
});

await test('20. sem grupo criado: o mini menu convida a criar', async () => {
  resetCF();
  const { groupJid, user, participants } = setup();
  const sent = await run({ groupJid, sender: user, text: '!cf', participants });
  const t = textOf(sent);
  includes(t, 'ainda não possui', 'avisa que não tem grupo');
  includes(t, 'cf criar', 'ensina a criar');
});

// ============================================================================
// 7) LIMITE, ALIAS, PERSISTÊNCIA, NEWSLETTER
// ============================================================================

await test('21. limite de 20: o 21º não entra', async () => {
  resetCF();
  const { groupJid, user, alvo, participants } = setup();
  const cheio = [];
  for (let i = 0; i < 20; i++) cheio.push({ id: `7000${i}@lid`, desde: Date.now() });
  fs.writeFileSync(CF_FILE, JSON.stringify({ [user.lid]: { nome: 'Cheio', criadoEm: Date.now(), membros: cheio } }, null, 2));
  const sent = await run({ groupJid, sender: user, text: '!cf add', mentions: [alvo], participants });
  includes(textOf(sent), 'Limite de 20', 'avisa o limite');
  ok(readCF()[user.lid].membros.length === 20, 'não passou de 20');
});

await test('22. alias !melhoresamigos é o mesmo comando', async () => {
  resetCF();
  const { groupJid, user, participants } = setup();
  const s1 = await run({ groupJid, sender: user, text: '!melhoresamigos', participants });
  includes(textOf(s1), 'Amigos', 'melhoresamigos responde');
});

await test('23. persistência: grava em DONO_DIR/amigos.json', async () => {
  resetCF();
  const { groupJid, user, participants } = setup();
  await run({ groupJid, sender: user, text: '!cf criar Grupo', participants });
  ok(fs.existsSync(CF_FILE), 'existe amigos.json em dono/');
});

await test('24. newsletter: a resposta leva o cabeçalho de canal', async () => {
  resetCF();
  const { groupJid, user, participants } = setup();
  const sent = await run({ groupJid, sender: user, text: '!cf criar Grupo', participants });
  const sessao = sent.find((s) => s.content?.contextInfo?.forwardedNewsletterMessageInfo?.newsletterJid);
  ok(!!sessao, 'a mensagem tem newsletter no content');
});

// ============================================================================
// RESUMO
// ============================================================================

const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log(`\n${totalFail === 0 ? '✅' : '❌'} ${RESULTS.length} testes / ${totalOk} asserções (${totalFail} falhas)`);
process.exit(totalFail === 0 ? 0 : 1);
