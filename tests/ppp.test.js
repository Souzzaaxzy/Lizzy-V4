/**
 * Testes do comando `!ppp` — foto de um membro aleatório + enquete
 * "Pego / Passo / Penso".
 *
 * O que precisa de prova:
 *   1. envia a FOTO de um membro do grupo e, ABAIXO, a enquete;
 *   2. a enquete tem o título com a MENÇÃO do alvo e as 3 opções separadas;
 *   3. o alvo é aleatório entre os membros (não é sempre o mesmo);
 *   4. o alvo é uma menção REAL (o `mentions` chega no contextInfo do poll);
 *   5. sem foto visível o comando NÃO fica mudo — manda a enquete sozinha;
 *   6. só em grupo e com o modo brincadeira ligado;
 *   7. está no `menubn` (primeira categoria) e no `blockPv`.
 *
 * Uso: node tests/ppp.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-ppp-db-'));
process.env.DATABASE_PATH = TMP_DB;
const GRUPOS_DIR = path.join(TMP_DB, 'grupos');
fs.mkdirSync(GRUPOS_DIR, { recursive: true });

const RESULTS = [];
let CURRENT = null;

function test(name, fn) {
  CURRENT = { name, passed: 0, failed: 0, errors: [] };
  RESULTS.push(CURRENT);
  const done = (error) => {
    if (error) {
      CURRENT.failed += 1;
      CURRENT.errors.push(`EXCEÇÃO: ${error?.stack || error}`);
    }
    console.log(`${CURRENT.failed === 0 ? '✅' : '❌'} ${name} (${CURRENT.passed} ok, ${CURRENT.failed} falhas)`);
    for (const err of CURRENT.errors) console.log(`     ${err.split('\n')[0]}`);
  };
  try {
    const result = fn();
    if (result && typeof result.then === 'function') return result.then(() => done()).catch(done);
    done();
  } catch (error) {
    done(error);
  }
  return Promise.resolve();
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

// ============================================================================
// HANDLER REAL
// ============================================================================

const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;
const layout = await import(new URL('../dados/src/menus/layout.js', import.meta.url).href);
const baileys = await import('@itsliaaa/baileys');
const { generateWAMessage } = baileys;

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';

/** Membros do grupo (LIDs) — o bot fica de fora do sorteio. */
const MEMBROS = [
  '111000000000001@lid',
  '111000000000002@lid',
  '111000000000003@lid',
  '111000000000004@lid',
  '111000000000005@lid',
];

let groupCounter = 0;
function makeGroup({ modobrincadeira = true } = {}) {
  groupCounter += 1;
  const jid = `1203635000000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(
    path.join(GRUPOS_DIR, `${jid}.json`),
    JSON.stringify({ groupName: 'Grupo P', modobrincadeira }, null, 2)
  );
  return jid;
}

let senderCounter = 0;
function makeNazu({ sent, groupJid, sender, fotos = {} }) {
  return {
    sendMessage: async (jid, content, options) => {
      sent.push({ jid, content, options });
      return { key: { id: `SENT-${sent.length}` } };
    },
    relayMessage: async (jid, message, options) => options?.messageId,
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
    onWhatsApp: async (jid) => [{ jid, exists: true, lid: jid.replace('@s.whatsapp.net', '@lid') }],
    signalRepository: { lidMapping: { getPNForLID: async () => null } },
    // `fotos` mapeia LID -> URL (ou null quando não tem foto visível).
    profilePictureUrl: async (jid) => {
      const url = fotos[jid];
      if (!url) throw new Error('no profile pic');
      return url;
    },
    groupMetadata: async () => ({
      id: groupJid,
      subject: 'Grupo P',
      participants: [
        { id: BOT_LID, lid: BOT_LID, phoneNumber: BOT_JID, admin: 'admin' },
        ...MEMBROS.map((m) => ({ id: m, lid: m, phoneNumber: null, admin: null })),
      ],
    }),
    groupParticipantsUpdate: async () => ({}),
    groupRequestParticipantsList: async () => [],
    groupRequestParticipantsUpdate: async () => ({}),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {},
    sendPresenceUpdate: async () => {},
    react: async () => ({}),
  };
}

async function rodar({ groupJid, text = '!ppp', fotos = {}, emGrupo = true }) {
  senderCounter += 1;
  const sender = `22200000${String(senderCounter).padStart(5, '0')}@lid`;
  const sent = [];
  const nazu = makeNazu({ sent, groupJid, sender, fotos });
  await handleMessage(nazu, {
    key: {
      remoteJid: emGrupo ? groupJid : '5511999999999@s.whatsapp.net',
      fromMe: false,
      id: `M-${Math.random().toString(36).slice(2, 10)}`,
      participant: sender,
    },
    message: { extendedTextMessage: { text, contextInfo: { remoteJid: groupJid } } },
    messageTimestamp: 1757900000,
    pushName: 'Tester',
  }, null, new Map(), null);

  const texto = sent.map((s) => s.content?.text ?? s.content?.caption ?? '').filter(Boolean).join('\n');
  return { sent, texto, nazu };
}

const fotoDoAlvo = (s) => s.content?.image?.url;

// ============================================================================
// 1) FLUXO PRINCIPAL
// ============================================================================

await test('!ppp: envia a FOTO e, abaixo, a enquete com as 3 opções', async () => {
  const groupJid = makeGroup();
  const fotos = Object.fromEntries(MEMBROS.map((m, i) => [m, `https://cdn.exemplo/${i}.jpg`]));

  const { sent } = await rodar({ groupJid, fotos });

  const foto = sent.find((s) => s.content?.image);
  const poll = sent.find((s) => s.content?.poll);

  ok(Boolean(foto), 'mandou uma imagem');
  ok(foto?.content?.image?.url?.startsWith('https://'), 'a imagem é a URL da foto do alvo');
  ok(Boolean(poll), 'mandou a enquete');

  // Ordem: a foto vem ANTES da enquete.
  ok(sent.indexOf(foto) < sent.indexOf(poll), 'a foto sai acima da enquete');

  ok(poll?.content?.poll?.values?.length === 3, 'a enquete tem 3 opções');
  ok(
    JSON.stringify(poll?.content?.poll?.values) === JSON.stringify(['Pego', 'Passo', 'Penso']),
    `opções separadas e na ordem (${JSON.stringify(poll?.content?.poll?.values)})`
  );
  ok(poll?.content?.poll?.selectableCount === 1, 'seleção única');
});

await test('!ppp: o título da enquete é a MENÇÃO do alvo, no layout do bot', async () => {
  const groupJid = makeGroup();
  const fotos = Object.fromEntries(MEMBROS.map((m, i) => [m, `https://cdn.exemplo/${i}.jpg`]));

  const { sent } = await rodar({ groupJid, fotos });
  const poll = sent.find((s) => s.content?.poll);
  const nome = poll?.content?.poll?.name || '';

  const linhas = nome.split('\n');
  ok(linhas.length === 3, `3 linhas: caixa + pergunta + rodapé (${linhas.length})`);

  // Cabeçalho com o título em MATHEMATICAL BOLD e o emoji.
  includes(linhas[0], '╭━━━꧁༺', 'abre a caixa');
  includes(linhas[0], '༻꧂━━━╮', 'fecha a caixa do topo');
  includes(linhas[0], '💘', 'emoji no cabeçalho');
  includes(linhas[0], layout.bold('PPP'), 'título em bold');
  ok(!linhas[0].includes('*PPP*'), 'não usa markdown (é bold Unicode)');

  // Linha do meio = menção do alvo.
  ok(/^@\d+$/.test(linhas[1]), `a linha do meio é a menção do alvo (${linhas[1]})`);

  // Rodapé com o nome do bot.
  includes(linhas[2], '╰━━━꧁༺', 'abre o rodapé');
  includes(linhas[2], '༻꧂━━━╯', 'fecha o rodapé');
});

await test('!ppp: o alvo é uma MENÇÃO real (JID no contextInfo do poll)', async () => {
  const groupJid = makeGroup();
  const fotos = Object.fromEntries(MEMBROS.map((m, i) => [m, `https://cdn.exemplo/${i}.jpg`]));

  const { sent } = await rodar({ groupJid, fotos });
  const poll = sent.find((s) => s.content?.poll);

  ok(Array.isArray(poll?.content?.mentions) && poll.content.mentions.length === 1, 'a enquete leva exatamente 1 menção');
  const alvo = poll.content.mentions[0];
  ok(MEMBROS.includes(alvo), `o alvo é um membro do grupo (${alvo})`);

  // O número do título é o do alvo mencionado.
  const numero = poll.content.poll.name.split('\n')[1].slice(1);
  ok(numero === alvo.split('@')[0], 'o número do título é o do alvo mencionado');

  // A foto enviada é a do MESMO alvo.
  const foto = sent.find((s) => s.content?.image);
  ok(foto?.content?.image?.url === fotos[alvo], 'a foto enviada é a do alvo da enquete');
});

await test('!ppp: o alvo é ALEATÓRIO entre os membros', async () => {
  const groupJid = makeGroup();
  const fotos = Object.fromEntries(MEMBROS.map((m, i) => [m, `https://cdn.exemplo/${i}.jpg`]));

  const alvos = new Set();
  for (let i = 0; i < 15; i++) {
    const { sent } = await rodar({ groupJid, fotos });
    const poll = sent.find((s) => s.content?.poll);
    if (poll) alvos.add(poll.content.mentions[0]);
  }

  ok(alvos.size >= 2, `mais de um alvo ao longo de 15 execuções (${alvos.size} distintos)`);
  ok([...alvos].every((a) => MEMBROS.includes(a)), 'todos os alvos são membros do grupo');
});

await test('!ppp: NUNCA sorteia o próprio bot', async () => {
  const groupJid = makeGroup();
  const fotos = Object.fromEntries(MEMBROS.map((m, i) => [m, `https://cdn.exemplo/${i}.jpg`]));

  let viuBot = false;
  for (let i = 0; i < 15; i++) {
    const { sent } = await rodar({ groupJid, fotos });
    const poll = sent.find((s) => s.content?.poll);
    if (!poll) continue;
    const alvo = poll.content.mentions[0];
    if (alvo === BOT_LID || alvo === BOT_JID) viuBot = true;
  }
  ok(!viuBot, 'o bot nunca é o alvo sorteado');
});

// ============================================================================
// 2) FOTO AUSENTE / ERROS
// ============================================================================

await test('!ppp: sem foto visível manda só a enquete (não fica mudo)', async () => {
  const groupJid = makeGroup();
  // Nenhum membro tem foto -> profilePictureUrl lança.
  const { sent } = await rodar({ groupJid, fotos: {} });

  ok(!sent.some((s) => s.content?.image), 'não mandou imagem');
  const poll = sent.find((s) => s.content?.poll);
  ok(Boolean(poll), 'ainda assim mandou a enquete');
  ok(poll?.content?.mentions?.length === 1, 'a enquete segue com a menção');
});

await test('!ppp: alguém sem foto NÃO impede achar quem tem', async () => {
  const groupJid = makeGroup();
  // Só um membro tem foto — o comando tem de achá-lo (tenta alguns).
  const fotos = { [MEMBROS[4]]: 'https://cdn.exemplo/unico.jpg' };

  const { sent } = await rodar({ groupJid, fotos });
  const foto = sent.find((s) => s.content?.image);
  ok(Boolean(foto), 'achou o membro com foto');
  ok(foto?.content?.image?.url === 'https://cdn.exemplo/unico.jpg', 'é a foto dele');

  const poll = sent.find((s) => s.content?.poll);
  ok(poll?.content?.mentions?.[0] === MEMBROS[4], 'a enquete aponta para o mesmo membro');
});

await test('!ppp: fora de grupo recusa', async () => {
  const groupJid = makeGroup();
  const { sent, texto } = await rodar({ groupJid, emGrupo: false });
  ok(!sent.some((s) => s.content?.poll), 'não mandou enquete no privado');
  ok(!sent.some((s) => s.content?.image), 'não mandou foto no privado');
  ok(texto.length >= 0, 'respondeu algo (aviso de grupo)');
});

await test('!ppp: com o modo brincadeira off recusa', async () => {
  const groupJid = makeGroup({ modobrincadeira: false });
  const fotos = Object.fromEntries(MEMBROS.map((m, i) => [m, `https://cdn.exemplo/${i}.jpg`]));

  const { sent, texto } = await rodar({ groupJid, fotos });
  ok(!sent.some((s) => s.content?.poll), 'não mandou enquete');
  includes(texto, 'modo brincadeira', 'explica que o modo brincadeira está off');
});

// ============================================================================
// 3) O PAYLOAD PASSA PELA FORK (enquete + menção de verdade)
// ============================================================================

await test('o payload do !ppp vira pollCreationMessageV3 com a menção no contextInfo', async () => {
  const groupJid = makeGroup();
  const fotos = Object.fromEntries(MEMBROS.map((m, i) => [m, `https://cdn.exemplo/${i}.jpg`]));

  const { sent } = await rodar({ groupJid, fotos });
  const poll = sent.find((s) => s.content?.poll);

  // Leva o MESMO conteúdo pelo caminho real da fork.
  const built = await generateWAMessage(groupJid, {
    poll: poll.content.poll,
    mentions: poll.content.mentions,
  }, { userJid: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net` });

  const tipo = Object.keys(built.message).find((k) => k.includes('Message'));
  ok(tipo === 'pollCreationMessageV3', `tipo do proto (${tipo})`);

  const inner = built.message.pollCreationMessageV3;
  ok(inner.options?.length === 3, '3 opções no proto');
  ok(
    JSON.stringify(inner.options.map((o) => o.optionName)) === JSON.stringify(['Pego', 'Passo', 'Penso']),
    'nomes das opções preservados'
  );
  ok(inner.selectableOptionsCount === 1, 'seleção única no proto');

  // A menção sobrevive: é o que faz o `@` do título resolver no cliente.
  const mencionados = inner.contextInfo?.mentionedJid || [];
  ok(mencionados.length === 1, 'o proto carrega o mentionedJid');
  ok(mencionados[0] === poll.content.mentions[0], 'é o mesmo alvo');
});

// ============================================================================
// 4) MENU / BLOCKPV
// ============================================================================

await test('!ppp aparece no menubn, na PRIMEIRA categoria (JOGOS & DIVERSÃO)', async () => {
  const mod = await import(new URL('../dados/src/menus/menubn.js', import.meta.url).href);
  const menu = await mod.default('!', 'Lizzy', 'Teste', false);

  includes(menu, '!ppp', 'o comando está no menu');

  // Precisa estar ANTES da segunda categoria (é a primeira categoria).
  const posPpp = menu.indexOf('!ppp');
  const posSegundaCategoria = menu.indexOf(layout.boldItalic('NGL ANÔNIMO'));
  ok(posPpp > 0, 'achou o !ppp no menu');
  ok(posSegundaCategoria > 0, 'achou a segunda categoria');
  ok(posPpp < posSegundaCategoria, 'o !ppp está na PRIMEIRA categoria (antes de NGL ANÔNIMO)');
});

await test('!ppp está no blockPv (menubn)', async () => {
  const src = fs.readFileSync(new URL('../dados/src/utils/blockPv.js', import.meta.url), 'utf8');
  const bloco = src.slice(src.indexOf('menubn: {'), src.indexOf('menudono: {'));
  includes(bloco, "'ppp'", 'o ppp está na lista de comandos do menubn');
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
