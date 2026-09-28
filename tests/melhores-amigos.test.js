/**
 * Testes do comando `!ma` / `!melhoresamigos` / `!bestfriends`.
 *
 * O comando veio de outro bot e foi ADAPTADO ao handler da Lizzy. As trocas
 * relevantes (comprovadas aqui):
 *   - `yuta`/`yt` -> `nazu`/`info`;
 *   - `__ctxMencoesGlobal()`/`__normalizarAlvoUsuario()` -> `menc_os2`
 *     (o alvo respondido já resolvido como LID pelo handler);
 *   - `canalInfo(...)` -> `gerarContextNewsletter()` DENTRO do content (a fork
 *     lê `message.contextInfo`; em options seria ignorado);
 *   - o caminho de outro projeto -> `DONO_DIR/melhoresamigos.json`;
 *   - `fs.writeFileSync` cru -> `writeJsonFile` (atômico);
 *   - `jidNum`/`pushnames`/`buscarMembroPorJid` (inexistentes) -> nome real do
 *     metadata/`getName`, caindo no número.
 *
 * Roda o HANDLER REAL com socket falso. Uso: node tests/melhores-amigos.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Banco temporário ANTES de importar o bot (paths.js lê DATABASE_PATH no load).
const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-ma-db-'));
process.env.DATABASE_PATH = TMP_DB;
const GRUPOS_DIR = path.join(TMP_DB, 'grupos');
const DONO_DIR = path.join(TMP_DB, 'dono');
fs.mkdirSync(GRUPOS_DIR, { recursive: true });
fs.mkdirSync(DONO_DIR, { recursive: true });

const MA_FILE = path.join(DONO_DIR, 'melhoresamigos.json');

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

/**
 * Normaliza o MATHEMATICAL BOLD/ITALIC do layout para ASCII.
 *
 * Os cabeçalhos do comando saem em bold Unicode (`𝙉𝙊𝙑𝙊`), então comparar com
 * ASCII direto falharia mesmo com a mensagem correta. A comparação mede o
 * CONTEÚDO (o texto que o usuário lê), não o code point.
 */
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
    // MATHEMATICAL SANS-SERIF BOLD ITALIC: é o estilo dos cabeçalhos `𝙈𝙀𝙇...`.
    else if (cp >= 0x1d63c && cp <= 0x1d655) out += String.fromCharCode(65 + (cp - 0x1d63c));
    else if (cp >= 0x1d656 && cp <= 0x1d66f) out += String.fromCharCode(97 + (cp - 0x1d656));
    else if (cp >= 0x1d7ce && cp <= 0x1d7e7) out += String.fromCharCode(48 + (cp - 0x1d7ce));
    else if (cp >= 0x1d7ec && cp <= 0x1d805) out += String.fromCharCode(48 + (cp - 0x1d7ec));
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
    JSON.stringify({ modobrincadeira: true, groupName: `Grupo MA ${groupCounter}`, ...extra }, null, 2)
  );
  return jid;
}

/** Pessoa nova (LID + JID + nome) e sender novo por teste (throttle por sender). */
function makePerson(label) {
  senderCounter += 1;
  const n = String(senderCounter).padStart(4, '0');
  return {
    lid: `5551${n}000000@lid`,
    jid: `5511${n}999999@s.whatsapp.net`,
    name: `Pessoa ${label ?? n}`,
  };
}

function makeNazu({ sent, groupJid, participants }) {
  const map = {};
  for (const p of participants) {
    if (p.jid && p.lid) map[p.jid] = p.lid;
    if (p.lid && p.jid) map[p.lid] = p.jid;
  }
  return {
    sent,
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
    getName: async (_group, jid) => {
      const p = participants.find((x) => x.lid === jid || x.jid === jid);
      return p?.name || String(jid || '').split('@')[0];
    },
    groupMetadata: async () => ({
      id: groupJid,
      subject: 'Grupo MA',
      participants: participants.map((p) => ({
        id: p.lid,
        lid: p.lid,
        phoneNumber: p.jid,
        notify: p.name,
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
 * `quoted` é o participante RESPONDIDO (LID) — é o alvo do `!ma add/del`, o
 * mesmo que `menc_os2` resolve no handler.
 */
async function run({ groupJid, sender, text, quoted = null, sent = [], participants }) {
  const nazu = makeNazu({ sent, groupJid, participants });
  const contextInfo = { remoteJid: groupJid };
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

/** Texto juntando todas as mensagens enviadas. */
function textOf(sent) {
  return sent.map((s) => s.content?.text ?? '').filter(Boolean).join('\n');
}

function readMA() {
  try {
    return JSON.parse(fs.readFileSync(MA_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function resetMA() {
  try { fs.rmSync(MA_FILE, { force: true }); } catch {}
}

/** Grupo com 3 pessoas: o usuário, o alvo e o bot. */
function setup() {
  const groupJid = makeGroup();
  const user = makePerson('Usuario');
  const alvo = makePerson('Alvo');
  const participants = [
    { lid: user.lid, jid: user.jid, name: user.name, isAdmin: true },
    { lid: alvo.lid, jid: alvo.jid, name: alvo.name },
    { lid: BOT_LID, jid: BOT_JID, name: 'Lizzy', isAdmin: true },
  ];
  return { groupJid, user, alvo, participants };
}

// ============================================================================
// 1) GUARDAS
// ============================================================================

await test('1. fora de grupo: avisa que só funciona em grupo', async () => {
  resetMA();
  const { user } = setup();
  const sent = await run({
    groupJid: `${user.jid}`, // "chat" privado
    sender: user,
    text: '!ma',
    participants: [],
  });
  includes(textOf(sent), 'só funciona em grupos', 'aviso de PV');
});

await test('2. modo brincadeira desligado: recusa', async () => {
  resetMA();
  const groupJid = makeGroup({ modobrincadeira: false });
  const user = makePerson('U');
  const participantes = [{ lid: user.lid, jid: user.jid, name: user.name }];
  const sent = await run({ groupJid, sender: user, text: '!ma', participants: participantes });
  includes(textOf(sent), 'modo brincadeira está desligado', 'aviso de modo');
});

// ============================================================================
// 2) ADD
// ============================================================================

await test('3. !ma add sem responder ninguém: mostra o exemplo de uso', async () => {
  resetMA();
  const { groupJid, user, participants } = setup();
  const sent = await run({ groupJid, sender: user, text: '!ma add', participants });
  const t = textOf(sent);
  includes(t, 'Responda', 'pede para responder');
  includes(t, 'ma add', 'exemplo de add');
});

await test('4. !ma add respondendo a si mesmo: recusa', async () => {
  resetMA();
  const { groupJid, user, participants } = setup();
  const sent = await run({ groupJid, sender: user, text: '!ma add', quoted: user, participants });
  includes(textOf(sent), 'você mesmo', 'recusa auto-add');
});

await test('5. !ma add válido: registra 1/20, persiste e menciona o alvo', async () => {
  resetMA();
  const { groupJid, user, alvo, participants } = setup();
  const sent = await run({ groupJid, sender: user, text: '!ma add', quoted: alvo, participants });
  const t = textOf(sent);

  includes(t, 'NOVO', 'cabeçalho de novo amigo');
  includes(t, alvo.name, 'mostra o nick do alvo');
  includes(t, '1/20', 'contador 1/20');

  // Persistiu no arquivo do bot (fora do outro projeto).
  const banco = readMA();
  const lista = banco[user.lid] || [];
  ok(lista.length === 1 && lista[0].id === alvo.lid, 'salvou o alvo pelo LID');
  ok(typeof lista[0].desde === 'number' && lista[0].desde > 0, 'gravou o timestamp de início');

  // Menção real ao alvo.
  const comMencao = sent.find((s) => Array.isArray(s.content?.mentions) && s.content.mentions.includes(alvo.lid));
  ok(!!comMencao, 'a mensagem menciona o alvo');
});

await test('6. !ma add repetido: avisa que já está na lista', async () => {
  resetMA();
  const { groupJid, user, alvo, participants } = setup();
  await run({ groupJid, sender: user, text: '!ma add', quoted: alvo, participants });
  const sent = await run({ groupJid, sender: user, text: '!ma add', quoted: alvo, participants });
  includes(textOf(sent), 'já está nos seus melhores amigos', 'avisa duplicado');
});

// ============================================================================
// 3) LISTA
// ============================================================================

await test('7. lista vazia: mostra o convite para adicionar', async () => {
  resetMA();
  const { groupJid, user, participants } = setup();
  const sent = await run({ groupJid, sender: user, text: '!ma', participants });
  const t = textOf(sent);
  includes(t, 'ainda não possui', 'avisa lista vazia');
  includes(t, 'ma add', 'ensina a adicionar');
});

await test('8. lista com amigo: mostra medalha, nick e tempo', async () => {
  resetMA();
  const { groupJid, user, alvo, participants } = setup();
  await run({ groupJid, sender: user, text: '!ma add', quoted: alvo, participants });
  const sent = await run({ groupJid, sender: user, text: '!ma', participants });
  const t = textOf(sent);
  includes(t, '🥇', 'medalha do 1º');
  includes(t, alvo.name, 'nick do amigo');
  includes(t, 'Amizade', 'linha de tempo');
  includes(t, '1/20', 'cadastrados 1/20');

  const comMencao = sent.find((s) => Array.isArray(s.content?.mentions) && s.content.mentions.includes(alvo.lid));
  ok(!!comMencao, 'a lista menciona o amigo');
});

// ============================================================================
// 4) DEL / LIMPAR
// ============================================================================

await test('9. !ma del removendo um amigo', async () => {
  resetMA();
  const { groupJid, user, alvo, participants } = setup();
  await run({ groupJid, sender: user, text: '!ma add', quoted: alvo, participants });
  const sent = await run({ groupJid, sender: user, text: '!ma del', quoted: alvo, participants });
  const t = textOf(sent);
  includes(t, 'foi removido', 'confirma remoção');
  includes(t, '0/20', 'zera o contador');
  ok((readMA()[user.lid] || []).length === 0, 'removeu do arquivo');
});

await test('10. !ma del de quem não está na lista: recusa', async () => {
  resetMA();
  const { groupJid, user, alvo, participants } = setup();
  const sent = await run({ groupJid, sender: user, text: '!ma del', quoted: alvo, participants });
  includes(textOf(sent), 'não está na sua lista', 'avisa inexistente');
});

await test('11. !ma del sem responder: pede o exemplo', async () => {
  resetMA();
  const { groupJid, user, participants } = setup();
  const sent = await run({ groupJid, sender: user, text: '!ma del', participants });
  includes(textOf(sent), 'ma del', 'exemplo de del');
});

await test('12. !ma limpar esvazia a lista', async () => {
  resetMA();
  const { groupJid, user, alvo, participants } = setup();
  await run({ groupJid, sender: user, text: '!ma add', quoted: alvo, participants });
  const sent = await run({ groupJid, sender: user, text: '!ma limpar', participants });
  includes(textOf(sent), 'limpa com sucesso', 'confirma limpeza');
  ok((readMA()[user.lid] || []).length === 0, 'lista vazia no arquivo');
});

await test('13. !ma limpar sem nada: recusa', async () => {
  resetMA();
  const { groupJid, user, participants } = setup();
  const sent = await run({ groupJid, sender: user, text: '!ma limpar', participants });
  includes(textOf(sent), 'não possui melhores amigos', 'avisa vazio');
});

// ============================================================================
// 5) LIMITE
// ============================================================================

await test('14. limite de 20: não adiciona o 21º', async () => {
  resetMA();
  const { groupJid, user, alvo, participants } = setup();
  const cheio = [];
  for (let i = 0; i < 20; i++) cheio.push({ id: `7000${i}@lid`, desde: Date.now() });
  fs.writeFileSync(MA_FILE, JSON.stringify({ [user.lid]: cheio }, null, 2));

  const sent = await run({ groupJid, sender: user, text: '!ma add', quoted: alvo, participants });
  includes(textOf(sent), '20 melhores amigos permitidos', 'avisa o limite');
  ok(readMA()[user.lid].length === 20, 'não passou de 20 no arquivo');
});

// ============================================================================
// 6) ADAPTAÇÕES (newsletter / aliases / persistência)
// ============================================================================

await test('15. newsletter: a resposta leva o cabeçalho de canal', async () => {
  resetMA();
  const { groupJid, user, alvo, participants } = setup();
  const sent = await run({ groupJid, sender: user, text: '!ma add', quoted: alvo, participants });
  const sessao = sent.find((s) => s.content?.contextInfo?.forwardedNewsletterMessageInfo);
  ok(!!sessao, 'a mensagem tem forwardedNewsletterMessageInfo');
  ok(!!sessao?.content?.contextInfo?.forwardedNewsletterMessageInfo?.newsletterJid, 'newsletterJid real (não vazio)');
});

await test('16. aliases !melhoresamigos e !bestfriends são o mesmo comando', async () => {
  resetMA();
  const { groupJid, user, participants } = setup();
  const s1 = await run({ groupJid, sender: user, text: '!melhoresamigos', participants });
  const s2 = await run({ groupJid, sender: user, text: '!bestfriends', participants });
  includes(textOf(s1), 'MELHORES AMIGOS', 'melhoresamigos responde');
  includes(textOf(s2), 'MELHORES AMIGOS', 'bestfriends responde');
});

await test('17. persistência: o arquivo fica em DONO_DIR, fora do outro projeto', async () => {
  resetMA();
  const { groupJid, user, alvo, participants } = setup();
  await run({ groupJid, sender: user, text: '!ma add', quoted: alvo, participants });
  ok(fs.existsSync(MA_FILE), `existe ${path.basename(MA_FILE)} em dono/`);
  ok(!fs.existsSync(path.join(process.cwd(), 'src', 'dados', 'func', 'melhores-amigos.json')), 'não cria o caminho do outro bot');
});

await test('18. o alvo é gravado pelo LID (independe de JID/número)', async () => {
  resetMA();
  const { groupJid, user, alvo, participants } = setup();
  await run({ groupJid, sender: user, text: '!ma add', quoted: alvo, participants });
  const lista = readMA()[user.lid] || [];
  ok(lista[0]?.id === alvo.lid, 'gravou pelo LID');
  ok(!String(lista[0]?.id).includes('@s.whatsapp.net'), 'não gravou o JID');
});

// ============================================================================
// RESUMO
// ============================================================================

const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log(`\n${totalFail === 0 ? '✅' : '❌'} ${RESULTS.length} testes / ${totalOk} asserções (${totalFail} falhas)`);
process.exit(totalFail === 0 ? 0 : 1);
