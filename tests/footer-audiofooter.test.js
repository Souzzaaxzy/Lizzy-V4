/**
 * `!footer` — testa a proto `audioFooter` (InteractiveMessage.Footer.audioMessage).
 *
 * Roda o handler REAL com socket falso, no mesmo estilo de `tests/musicap.test.js`.
 * O que se mede é o contrato do comando:
 *
 *   - sem resposta e sem link: ensina a usar;
 *   - respondendo algo que não é áudio: recusa;
 *   - respondendo um áudio (mídia CIFRADA servida por HTTP local): baixa,
 *     transcodifica para OGG/Opus e manda o card;
 *   - o card sai com `audioFooter` + `nativeFlow`, e o áudio é OGG/Opus.
 *
 * A mídia é servida cifrada de verdade (mesma técnica do statusgrupo.test.js):
 * o Baileys descriptografa com a mediaKey, então bytes crus não serviriam.
 * O ffmpeg é substituído pelo duble de `tests/helpers/fake-ffmpeg.js`.
 *
 * Uso: node tests/footer-audiofooter.test.js
 */

import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import { proto, hkdf, MEDIA_HKDF_KEY_MAPPING } from '@itsliaaa/baileys';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-footer-'));
process.env.DATABASE_PATH = TMP_DB;
process.env.FFMPEG_PATH = path.join(PROJECT, 'tests', 'helpers', 'fake-ffmpeg.js');
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
    `${label ?? needle} — esperado conter "${needle}"`);
}

// ============================================================================

const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;
if (typeof handleMessage !== 'function') throw new Error('index.js não exporta o handler');

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';

let groupCounter = 0;
let senderCounter = 0;

function makeGroup() {
  groupCounter += 1;
  const jid = `1203638500000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(path.join(GRUPOS_DIR, `${jid}.json`),
    JSON.stringify({ groupName: `Grupo Footer ${groupCounter}` }, null, 2));
  return jid;
}

// --- Mídia CIFRADA de verdade, servida por HTTP local ----------------------

function cifrar(plaintext, mediaKey, type) {
  const info = `WhatsApp ${MEDIA_HKDF_KEY_MAPPING[type]} Keys`;
  const expanded = Buffer.from(hkdf(mediaKey, 112, { info }));
  const iv = expanded.subarray(0, 16);
  const cipherKey = expanded.subarray(16, 48);
  const cipher = crypto.createCipheriv('aes-256-cbc', cipherKey, iv);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}

const AUDIO_REAL = Buffer.concat([Buffer.from('OggS'), Buffer.from('audio-original-'.repeat(20))]);

let servidor = null;
let porta = 0;
const servidos = new Map();

async function subirServidor() {
  if (servidor) return;
  servidor = http.createServer((req, res) => {
    const conteudo = servidos.get(req.url);
    if (!conteudo) { res.writeHead(404).end('nao encontrado'); return; }
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': conteudo.length });
    res.end(conteudo);
  });
  await new Promise((resolve) => servidor.listen(0, '127.0.0.1', resolve));
  porta = servidor.address().port;
}

/** Publica um áudio cifrado e devolve o proto que aponta para ele. */
function publicarAudio(plaintext = AUDIO_REAL) {
  const mediaKey = crypto.randomBytes(32);
  const cifrado = cifrar(plaintext, mediaKey, 'audio');
  const rota = `/a-${Math.random().toString(36).slice(2)}.enc`;
  servidos.set(rota, cifrado);
  return proto.Message.AudioMessage.create({
    url: `http://127.0.0.1:${porta}${rota}`,
    mediaKey,
    mimetype: 'audio/ogg; codecs=opus',
    ptt: true,
    fileLength: plaintext.length,
  });
}

// --- Socket falso ----------------------------------------------------------

function makeNazu({ sent, groupJid }) {
  return {
    sent,
    sendMessage: async (jid, content) => { sent.push({ jid, content }); return { key: { id: 'SENT' } }; },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
    onWhatsApp: async (jid) => [{ jid, exists: true }],
    signalRepository: { lidMapping: { getPNForLID: async () => null } },
    groupMetadata: async () => ({
      id: groupJid, subject: 'Grupo Footer',
      participants: [{ id: BOT_LID, admin: 'admin', phoneNumber: BOT_JID }]
    }),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {}, sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => null, react: async () => ({})
  };
}

async function run({ groupJid, text, citado = null, sent = [] }) {
  const nazu = makeNazu({ sent, groupJid });
  // Remetente único por chamada: o bot tem um throttle por usuário (3 comandos
  // por 5s) e reusar o mesmo id faria os testes dispararem o antiflood.
  senderCounter += 1;
  const senderLid = `5571${String(senderCounter).padStart(4, '0')}000000@lid`;
  const contextInfo = citado
    ? { remoteJid: groupJid, mentionedJid: [], quotedMessage: citado, participant: senderLid }
    : { remoteJid: groupJid, mentionedJid: [] };
  const info = {
    key: { remoteJid: groupJid, fromMe: false, id: `M-${Math.random().toString(36).slice(2, 10)}`, participant: senderLid },
    message: { extendedTextMessage: { text, contextInfo } },
    messageTimestamp: Math.floor(Date.now() / 1000),
    pushName: 'Tester'
  };
  await handleMessage(nazu, info, null, new Map(), null);
  return { sent, text: sent.map((s) => s.content?.text ?? '').filter(Boolean).join('\n') };
}

/** O card é a mensagem com `audioFooter` (não o aviso de texto). */
const acharCard = (sent) => sent.find((s) => s.content && 'audioFooter' in s.content);

// ============================================================================
// 1) GUARDAS
// ============================================================================

await test('sem responder e sem link: ensina a usar', async () => {
  const groupJid = makeGroup();
  const out = await run({ groupJid, text: '!footer' });
  includes(out.text, 'Responda um', 'explica o uso');
  ok(!acharCard(out.sent), 'não manda card sem áudio');
});

await test('respondendo algo que não é áudio: recusa', async () => {
  const groupJid = makeGroup();
  const out = await run({ groupJid, text: '!footer', citado: { conversation: 'oi' } });
  includes(out.text, 'não é um áudio', 'explica');
  ok(!acharCard(out.sent), 'não manda card');
});

// ============================================================================
// 2) CAMINHO FELIZ — áudio respondido
// ============================================================================

await test('respondendo um áudio: baixa, converte e manda o card com audioFooter', async () => {
  await subirServidor();
  const groupJid = makeGroup();
  const audio = publicarAudio();
  const out = await run({ groupJid, text: '!footer', citado: { audioMessage: audio } });

  const card = acharCard(out.sent);
  ok(Boolean(card), 'mandou o card com audioFooter');
  ok(Buffer.isBuffer(card?.content?.audioFooter), 'audioFooter é um Buffer');
  ok(Array.isArray(card?.content?.nativeFlow) && card.content.nativeFlow.length >= 1, 'tem nativeFlow');
  includes(card?.content?.text, 'Teste do audioFooter', 'texto do card');
});

await test('o áudio enviado no rodapé é OGG/Opus (formato que a fork rotula)', async () => {
  await subirServidor();
  const groupJid = makeGroup();
  const audio = publicarAudio();
  const out = await run({ groupJid, text: '!footer', citado: { audioMessage: audio } });

  const card = acharCard(out.sent);
  const buf = card?.content?.audioFooter;
  ok(buf && buf.subarray(0, 4).toString('latin1') === 'OggS', 'assinatura OggS');
  ok(buf && buf.includes(Buffer.from('OpusHead')), 'cabeçalho OpusHead');
});

await test('o áudio do rodapé chega ao proto como footer.audioMessage', async () => {
  await subirServidor();
  const groupJid = makeGroup();
  const audio = publicarAudio();
  const out = await run({ groupJid, text: '!footer', citado: { audioMessage: audio } });

  const card = acharCard(out.sent);
  // Mesmo caminho que a fork usa ao enviar: monta o conteúdo da mensagem.
  const { generateWAMessageContent } = await import('@itsliaaa/baileys');
  const conteudo = await generateWAMessageContent(
    { text: card.content.text, audioFooter: card.content.audioFooter, nativeFlow: card.content.nativeFlow },
    {
      userJid: BOT_JID,
      jid: groupJid,
      upload: async () => ({ url: 'https://mmg.whatsapp.net/fake', directPath: '/v/fake' })
    }
  );

  const footer = conteudo?.interactiveMessage?.footer;
  ok(Boolean(footer?.audioMessage), 'interactiveMessage.footer.audioMessage presente');
  ok(footer?.hasMediaAttachment === true, 'footer.hasMediaAttachment = true');
  ok(footer?.text === undefined, 'footer.text não é usado junto com áudio');
});

// ============================================================================

const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log('\n' + '='.repeat(40));
console.log(`RESULTADO: ${RESULTS.length} testes | ${totalOk} asserções ok | ${totalFail} falhas`);
console.log('='.repeat(40));
if (servidor) servidor.close();
// O servidor HTTP segura o event loop; sem o exit o processo ficaria pendurado.
process.exit(totalFail > 0 ? 1 : 0);
