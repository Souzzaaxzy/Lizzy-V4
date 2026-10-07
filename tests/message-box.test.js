/**
 * Testes da caixa "NOVA MENSAGEM" (GP/PV) impressa no terminal pelo handler.
 *
 * O handler monta a caixa em console.log antes de processar o comando. Um
 * refactor de logs (remocao de console.log em massa) pode apagar a caixa sem
 * que nenhum teste perceba, porque o sintoma so aparece no terminal do host.
 * Este teste roda o handler REAL com um socket falso e exige que a caixa saia
 * para texto, comando e cada tipo de midia — com e sem legenda — em grupo e no
 * privado.
 *
 * Uso: node tests/message-box.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// IMPORTANTE: redireciona o banco ANTES de importar o index.js (paths.js le
// DATABASE_PATH no carregamento). Nenhum grupo de teste toca o banco real.
const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-box-db-'));
process.env.DATABASE_PATH = TMP_DB;
fs.mkdirSync(path.join(TMP_DB, 'grupos'), { recursive: true });

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
  for (const err of CURRENT.errors) console.log(`   ↳ ${err}`);
}

function ok(cond, message) {
  if (cond) CURRENT.passed += 1;
  else {
    CURRENT.failed += 1;
    CURRENT.errors.push(`ASSERT FALHOU: ${message}`);
  }
}

function includes(haystack, needle, label) {
  ok(typeof haystack === 'string' && haystack.includes(needle),
    `${label ?? needle} — esperado conter "${needle}" (obtido: ${JSON.stringify(String(haystack).slice(0, 120))})`);
}

function notIncludes(haystack, needle, label) {
  ok(typeof haystack === 'string' && !haystack.includes(needle),
    `${label ?? needle} — não deveria conter "${needle}"`);
}

// ============================================================================
// HANDLER REAL
// ============================================================================

const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;
if (typeof handleMessage !== 'function') throw new Error('index.js não exporta o handler');

// ============================================================================
// FIXTURES
// ============================================================================

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';
const GRUPOS_DIR = path.join(TMP_DB, 'grupos');

let groupCounter = 0;
let authorCounter = 0;

function makeGroup() {
  groupCounter += 1;
  const groupJid = `1203638000000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(
    path.join(GRUPOS_DIR, `${groupJid}.json`),
    JSON.stringify({ groupName: 'Grupo Box' }, null, 2)
  );
  return groupJid;
}

function makeNazu(groupJid, authorLid, authorJid) {
  return {
    sendMessage: async () => ({ key: { id: 'SENT' } }),
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
    onWhatsApp: async (jid) => (jid === authorJid ? [{ jid, exists: true, lid: authorLid }] : [{ jid, exists: false }]),
    signalRepository: { lidMapping: { getPNForLID: async () => null } },
    groupMetadata: async () => ({
      id: groupJid,
      subject: 'Grupo Box',
      participants: [
        { id: authorLid, admin: 'admin', phoneNumber: authorJid },
        { id: BOT_LID, admin: 'admin', phoneNumber: BOT_JID },
      ],
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

const captured = [];
const origLog = console.log;

/**
 * Executa uma mensagem pelo handler real e devolve o texto dos console.log
 * capturados (a caixa é impressa por console.log).
 */
async function run(message, { isGroup = true } = {}) {
  captured.length = 0;
  const groupJid = makeGroup();
  authorCounter += 1;
  const authorLid = `88${String(authorCounter).padStart(6, '0')}777@lid`;
  const authorJid = `5588${String(authorCounter).padStart(6, '0')}666@s.whatsapp.net`;
  const chatJid = isGroup ? groupJid : authorJid;

  const info = {
    key: { remoteJid: chatJid, fromMe: false, id: `BOX-${authorCounter}`, participant: isGroup ? authorLid : undefined },
    message,
    messageTimestamp: 1757900000,
    pushName: 'Autor',
  };

  console.log = (...a) => { captured.push(a.map(String).join(' ')); };
  try {
    await handleMessage(makeNazu(groupJid, authorLid, authorJid), info, null, new Map(), null);
  } finally {
    console.log = origLog;
  }

  return captured.join('\n');
}

// ============================================================================
// TESTES
// ============================================================================

await test('caixa aparece para TEXTO simples no grupo', async () => {
  const out = await run({ conversation: 'oi galera, tudo bem?' });
  includes(out, 'NOVA MENSAGEM GP', 'título GP');
  includes(out, 'Grupo  >', 'linha do grupo');
  includes(out, 'Usuario >', 'linha do usuário');
  includes(out, 'oi galera, tudo bem?', 'prévia do texto');
  includes(out, '╭─', 'borda superior');
  includes(out, '╰─', 'borda inferior');
});

await test('caixa aparece para COMANDO no grupo', async () => {
  const out = await run({ extendedTextMessage: { text: '!ping' } });
  includes(out, 'NOVA MENSAGEM GP');
  includes(out, '!ping', 'prévia do comando');
});

await test('caixa aparece para IMAGEM sem legenda', async () => {
  const out = await run({ imageMessage: { mimetype: 'image/jpeg' } });
  includes(out, 'NOVA MENSAGEM GP');
  includes(out, '📷 Foto', 'rótulo de foto');
});

await test('caixa aparece para IMAGEM com legenda', async () => {
  const out = await run({ imageMessage: { mimetype: 'image/jpeg', caption: 'olha essa foto' } });
  includes(out, '📷 Foto: olha essa foto', 'rótulo + legenda');
});

await test('caixa aparece para VÍDEO', async () => {
  const out = await run({ videoMessage: { mimetype: 'video/mp4' } });
  includes(out, '🎬 Vídeo', 'rótulo de vídeo');
});

await test('caixa aparece para ÁUDIO', async () => {
  const out = await run({ audioMessage: { mimetype: 'audio/ogg; codecs=opus', ptt: true } });
  includes(out, '🎵 Áudio', 'rótulo de áudio');
});

await test('caixa aparece para FIGURINHA', async () => {
  const out = await run({ stickerMessage: { mimetype: 'image/webp' } });
  includes(out, '🔖 Figurinha', 'rótulo de figurinha');
});

await test('caixa aparece para DOCUMENTO', async () => {
  const out = await run({ documentMessage: { mimetype: 'application/pdf', fileName: 'doc.pdf' } });
  includes(out, '📄 Documento', 'rótulo de documento');
});

await test('caixa PV aparece no privado (sem linha de grupo)', async () => {
  const out = await run({ conversation: 'oi no privado' }, { isGroup: false });
  includes(out, 'NOVA MENSAGEM PV', 'título PV');
  includes(out, 'ID      >', 'linha do ID');
  notIncludes(out, 'NOVA MENSAGEM GP', 'não deve ser GP');
  notIncludes(out, 'Grupo  >', 'PV não tem linha de grupo');
});

await test('caixa NÃO aparece para mensagem vazia (nem texto nem mídia)', async () => {
  const out = await run({});
  notIncludes(out, 'NOVA MENSAGEM', 'sem conteúdo não imprime caixa');
});

// ============================================================================
// RESUMO
// ============================================================================

console.log('\n' + '─'.repeat(60));
let passed = 0;
let failed = 0;
for (const r of RESULTS) {
  passed += r.passed;
  failed += r.failed;
}
console.log(`Total: ${RESULTS.length} testes / ${passed} asserções ok, ${failed} falhas`);
process.exit(failed === 0 ? 0 : 1);
