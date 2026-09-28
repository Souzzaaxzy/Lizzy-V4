/**
 * Testes do comando `!togif` / `!tomp4` — figurinha → GIF/MP4.
 *
 * A conversão vive na FORK (`lib/Utils/sticker-convert.js`) porque o FFmpeg
 * sozinho NÃO decodifica WebP animado (ignora ANIM/ANMF; medido). Aqui o teste
 * rodeia o handler real e prova que o comando:
 *   1. recusa quando não há figurinha marcada;
 *   2. manda uma figurinha ANIMADA como vídeo (MP4, gifPlayback) no `!tomp4`;
 *   3. manda o GIF como documento no `!togif`;
 *   4. avisa quando a figurinha é ESTÁTICA.
 *
 * O fixture é um webp animado de verdade; se não houver ffmpeg para gerá-lo,
 * o teste gera os frames com o `sharp` (que também é quem valida a conversão),
 * mantendo o teste independente do binário.
 *
 * Uso: node tests/togif.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-togif-db-'));
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

function ok(cond, message) {
  if (cond) CURRENT.passed += 1;
  else { CURRENT.failed += 1; CURRENT.errors.push(`ASSERT FALHOU: ${message}`); }
}

function includes(hay, needle, label) {
  ok(typeof hay === 'string' && hay.includes(needle), `${label ?? needle} — esperado conter "${needle}"`);
}

// ============================================================================
// FIXTURES — webp animado + webp estático (via sharp, deps da fork)
// ============================================================================

const { default: sharp } = await import('sharp');
const baileys = await import('@itsliaaa/baileys');
const http = await import('node:http');
const crypto = await import('node:crypto');
const { proto, hkdf, MEDIA_HKDF_KEY_MAPPING } = baileys;

/** Cifra como o WhatsApp (hkdf + AES-256-CBC) — o download da lib decripta. */
function cifrar(plaintext, mediaKey, type) {
  const info = `WhatsApp ${MEDIA_HKDF_KEY_MAPPING[type]} Keys`;
  const expanded = Buffer.from(hkdf(mediaKey, 112, { info }));
  const iv = expanded.subarray(0, 16);
  const cipherKey = expanded.subarray(16, 48);
  const cipher = crypto.createCipheriv('aes-256-cbc', cipherKey, iv);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}

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
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  porta = servidor.address().port;
}
/** Publica um webp cifrado e devolve o `stickerMessage` que aponta para ele. */
function publicarSticker(plaintext) {
  const mediaKey = crypto.randomBytes(32);
  const cifrado = cifrar(plaintext, mediaKey, 'sticker');
  const rota = `/s-${Math.random().toString(36).slice(2)}.enc`;
  servidos.set(rota, cifrado);
  return proto.Message.StickerMessage.create({
    url: `http://127.0.0.1:${porta}${rota}`,
    mediaKey,
    mimetype: 'image/webp',
    fileLength: plaintext.length,
    isAnimated: plaintext.length > 100
  });
}

/** Extrai os chunks de um WebP (para remontar como animado). */
function webpChunks(buf) {
  const out = [];
  let off = 12;
  while (off + 8 <= buf.length) {
    const four = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    out.push({ four, size, body: off + 8 });
    off += 8 + size + (size & 1);
  }
  return out;
}
const u24 = (n) => { const b = Buffer.alloc(3); b.writeUIntLE(n, 0, 3); return b; };
const chunk = (four, payload) => {
  const h = Buffer.alloc(8);
  h.write(four, 0, 'ascii');
  h.writeUInt32LE(payload.length, 4);
  return Buffer.concat([h, payload, payload.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)]);
};

/**
 * Monta um WebP ANIMADO de verdade (chunks VP8X[ANIM flag] + ANIM + ANMF).
 *
 * O `sharp` não escreve `ANIM`/`ANMF` sozinho (o `animated:true` da ENTRADA é
 * que decodifica), então o fixture é montado à mão a partir de dois keyframes —
 * é exatamente o formato que as figurinhas do WhatsApp usam.
 */
function buildAnimatedWebp(width, height, imgFour, imgBody, frames) {
  const vp8x = Buffer.concat([Buffer.from([0x02, 0, 0, 0]), u24(width - 1), u24(height - 1)]);
  const anim = Buffer.concat([Buffer.from([0, 0, 0, 0]), Buffer.from([0, 0])]);
  const anmfs = frames.map((f) => {
    const hdr = Buffer.concat([u24(0), u24(0), u24(width - 1), u24(height - 1), u24(f.duration || 100), Buffer.from([0])]);
    return chunk('ANMF', Buffer.concat([hdr, chunk(imgFour, imgBody)]));
  });
  const body = Buffer.concat([chunk('VP8X', vp8x), chunk('ANIM', anim), ...anmfs]);
  const riff = Buffer.alloc(12);
  riff.write('RIFF', 0, 'ascii');
  riff.writeUInt32LE(body.length + 4, 4);
  riff.write('WEBP', 8, 'ascii');
  return Buffer.concat([riff, body]);
}

/** WebP ESTÁTICO. */
async function makeStaticWebp() {
  return sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 1 } } })
    .webp()
    .toBuffer();
}

async function makeAnimatedWebp() {
  const base = await sharp({ create: { width: 128, height: 128, channels: 4, background: { r: 220, g: 40, b: 70, alpha: 1 } } }).webp().toBuffer();
  const cs = webpChunks(base);
  const img = cs.find((c) => c.four === 'VP8 ' || c.four === 'VP8L');
  const body = base.subarray(img.body, img.body + img.size);
  const frames = Array.from({ length: 10 }, () => ({ duration: 100 }));
  return buildAnimatedWebp(128, 128, img.four, body, frames);
}

const ANIMATED = await makeAnimatedWebp();
const STATIC = await makeStaticWebp();

// ============================================================================
// HANDLER REAL
// ============================================================================

const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';

let groupCounter = 0;
function makeGroup() {
  groupCounter += 1;
  const jid = `1203639000000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(path.join(GRUPOS_DIR, `${jid}.json`), JSON.stringify({ modobrincadeira: true }, null, 2));
  return jid;
}

/**
 * Executa o comando respondendo uma figurinha.
 *
 * Como o handler decripta a mídia via `getFileBuffer` + `downloadContentFromMessage`
 * (que baixa do CDN), aqui trocamos a figurinha por uma URL de dados: o
 * `downloadContentFromMessage` não é chamado quando o stickerMessage já está no
 * cache local? Não — então simulamos o download com um socket que injeta o proxy
 * de mídia. Para o teste do COMANDO (não da lib), basta provar a resposta quando
 * NÃO há figurinha e a construção do payload quando a conversão roda.
 */
async function run({ groupJid, text, sticker = null, sent = [] }) {
  const nazu = {
    sendMessage: async (jid, content, options) => { sent.push({ jid, content, options }); return { key: { id: 'SENT' } }; },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
    onWhatsApp: async (jid) => [{ jid, exists: false }],
    signalRepository: { lidMapping: { getPNForLID: async () => null } },
    contacts: { getName: () => undefined },
    getName: () => undefined,
    groupMetadata: async () => ({
      id: groupJid,
      subject: 'G',
      participants: [{ id: BOT_LID, lid: BOT_LID, phoneNumber: BOT_JID, admin: 'admin' }]
    }),
    groupParticipantsUpdate: async () => ({}),
    groupRequestParticipantsList: async () => [],
    groupRequestParticipantsUpdate: async () => ({}),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {}, sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => 'x', react: async () => ({}),
    // O comando chama getFileBuffer(stickerMessage, 'sticker') internamente;
    // esse caminho usa `downloadContentFromMessage`. Em vez de mockar a lib
    // inteira, expomos o buffer pelo próprio stickerMessage (mediaKey + url
    // apontando para um data: URL) — o handler baixa e decripta.
  };
  const sender = { lid: '5551000000001@lid', jid: '5511000000001@s.whatsapp.net', name: 'User', isAdmin: true };
  const parts = [{ lid: sender.lid, jid: sender.jid, name: 'User', isAdmin: true }, { lid: BOT_LID, jid: BOT_JID, name: 'Lizzy', isAdmin: true }];
  nazu.groupMetadata = async () => ({
    id: groupJid, subject: 'G',
    participants: parts.map((p) => ({ id: p.lid, lid: p.lid, phoneNumber: p.jid, admin: p.isAdmin ? 'admin' : null }))
  });
  const contextInfo = { remoteJid: groupJid };
  if (sticker) contextInfo.quotedMessage = { stickerMessage: sticker };
  const info = {
    key: { remoteJid: groupJid, fromMe: true, id: `M-${Math.random().toString(36).slice(2, 8)}`, participant: sender.lid },
    message: { extendedTextMessage: { text, contextInfo } },
    messageTimestamp: 1757900000, pushName: 'User'
  };
  await handleMessage(nazu, info, null, new Map(), null);
  return sent;
}

function textOf(sent) {
  return sent.map((s) => s.content?.text ?? '').join('\n');
}

// ============================================================================
// 1) SEM FIGURINHA
// ============================================================================

await test('1. !togif sem figurinha marcada: pede para marcar', async () => {
  const groupJid = makeGroup();
  const sent = await run({ groupJid, text: '!togif' });
  includes(textOf(sent), 'Marque uma figurinha', 'avisa');
});

await test('2. !tomp4 sem figurinha marcada: pede para marcar', async () => {
  const groupJid = makeGroup();
  const sent = await run({ groupJid, text: '!tomp4' });
  includes(textOf(sent), 'Marque uma figurinha', 'avisa');
});

// ============================================================================
// 2) CONVERSÃO (via módulo da fork, que é o que o comando usa)
// ============================================================================

await test('3. a fork converte figurinha animada em GIF', async () => {
  const out = await baileys.stickerToGif(ANIMATED);
  ok(out.mime === 'image/gif', 'mime gif');
  ok(out.buffer.slice(0, 3).toString('latin1') === 'GIF', 'magic GIF');
  ok(out.pages >= 2, 'mais de um frame');
});

await test('4. a fork converte figurinha animada em MP4', async () => {
  const out = await baileys.stickerToMp4(ANIMATED);
  ok(out.mime === 'video/mp4', 'mime mp4');
  ok(out.buffer.slice(4, 8).toString('latin1') === 'ftyp', 'container MP4');
});

await test('5. isAnimatedWebP distingue animada de estática', async () => {
  ok(baileys.isAnimatedWebP(ANIMATED) === true, 'animada');
  ok(baileys.isAnimatedWebP(STATIC) === false, 'estática');
});

await test('6. a fork exporta as funções (o bot importa direto)', async () => {
  ok(typeof baileys.stickerToGif === 'function', 'stickerToGif exportado');
  ok(typeof baileys.stickerToMp4 === 'function', 'stickerToMp4 exportado');
  ok(typeof baileys.isAnimatedWebP === 'function', 'isAnimatedWebP exportado');
});

// ============================================================================
// 4) COMANDO PONTA A PONTA (figurinha cifrada servida por HTTP local)
// ============================================================================

await subirServidor();

await test('8. !tomp4 (figurinha animada): envia VÍDEO mp4 com gifPlayback', async () => {
  const groupJid = makeGroup();
  const sticker = publicarSticker(ANIMATED);
  const sent = await run({ groupJid, text: '!tomp4', sticker });
  const video = sent.find((s) => s.content?.video);
  ok(!!video, 'enviou um vídeo');
  ok(video?.content?.mimetype === 'video/mp4', 'mimetype mp4');
  ok(video?.content?.gifPlayback === true, 'gifPlayback ligado');
  ok(Buffer.isBuffer(video?.content?.video) && video.content.video.slice(4, 8).toString('latin1') === 'ftyp', 'container MP4');
});

await test('9. !togif (figurinha animada): envia o GIF como documento', async () => {
  const groupJid = makeGroup();
  const sticker = publicarSticker(ANIMATED);
  const sent = await run({ groupJid, text: '!togif', sticker });
  const doc = sent.find((s) => s.content?.document);
  ok(!!doc, 'enviou o documento');
  ok(doc?.content?.mimetype === 'image/gif', 'mimetype gif');
  ok(doc?.content?.document?.slice(0, 3).toString('latin1') === 'GIF', 'magic GIF');
  ok(doc?.content?.fileName === 'figurinha.gif', 'nome do arquivo');
});

await test('10. figurinha ESTÁTICA: avisa para usar o !toimg', async () => {
  const groupJid = makeGroup();
  const sticker = publicarSticker(STATIC);
  const sent = await run({ groupJid, text: '!togif', sticker });
  const t = textOf(sent);
  includes(t, 'estática', 'avisa que é estática');
  includes(t, 'toimg', 'sugere o toimg');
});

// ============================================================================
// 3) MENU
// ============================================================================

await test('7. !togif está no menufig e no blockPv', async () => {
  const menufig = await import(new URL('../dados/src/menus/menufig.js', import.meta.url).href);
  const texto = await menufig.default('!', 'Abyss', 'Kannon');
  includes(texto, '!togif', 'menufig lista o togif');
  const bp = await import(new URL('../dados/src/utils/blockPv.js', import.meta.url).href);
  ok(bp.menuCommandsMap.menufig.commands.includes('togif'), 'blockPv inclui togif');
  ok(bp.menuCommandsMap.menufig.commands.includes('tomp4'), 'blockPv inclui tomp4');
});

// ============================================================================
// RESUMO
// ============================================================================

const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log(`\n${totalFail === 0 ? '✅' : '❌'} ${RESULTS.length} testes / ${totalOk} asserções (${totalFail} falhas)`);
process.exit(totalFail === 0 ? 0 : 1);
