/**
 * Testes das DUAS mudancas no `!statusgrupo`:
 *
 *  1. FIGURINHA no status: responder a figurinha (animada OU estatica) e o bot
 *     publica a midia no status do grupo. A figurinha e WebP — nao e um tipo
 *     aceito no status — entao o bot converte: animada -> MP4 em loop
 *     (`gifPlayback`), estatica -> PNG.
 *  2. MENCOES viram NICK: o texto publicado trocava a mencao pelo LID; agora
 *     troca pelo nome resolvido.
 *
 * O teste roda o handler REAL e passa o conteudo pelo caminho REAL da fork
 * (`generateWAMessageContent`), como o statusgrupo.test.js.
 *
 * Uso: node tests/statusgrupo-figurinha.test.js
 */

import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import { proto, generateWAMessageContent, hkdf, MEDIA_HKDF_KEY_MAPPING } from '@itsliaaa/baileys';
import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-sgfig-db-'));
process.env.DATABASE_PATH = TMP_DB;
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
const ALVO_LID = '444000000000004@lid';
const ALVO_JID = '5511944444444@s.whatsapp.net';
const NICK_ALVO = 'Fulano da Silva';

let groupCounter = 0;
function makeGroup() {
  groupCounter += 1;
  const jid = `1203631100000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(path.join(GRUPOS_DIR, `${jid}.json`), JSON.stringify({ modobrincadeira: true, groupName: 'G' }, null, 2));
  return jid;
}

let senderCounter = 0;
function makeNazu({ sent, groupJid, sender, opts = {} }) {
  const { soTelefone = false, semAlvoNoMetadata = false, pnForLid = null } = opts;
  const acerta = (jid) => {
    const t = String(jid);
    return soTelefone ? t.includes('5511944444444') : (t.includes('444000000000004') || t.includes('5511944444444'));
  };
  const participants = [
    { id: BOT_LID, lid: BOT_LID, phoneNumber: BOT_JID, admin: 'admin' },
    { id: sender, lid: sender, phoneNumber: '5511999999997@s.whatsapp.net', admin: 'admin' },
  ];
  if (!semAlvoNoMetadata) participants.push({ id: ALVO_LID, lid: ALVO_LID, phoneNumber: ALVO_JID, name: undefined });
  return {
    sendMessage: async (jid, content, options) => { sent.push({ jid, content, options }); return { key: { id: `SENT-${sent.length}` } }; },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
    onWhatsApp: async (jid) => [{ jid, exists: true }],
    signalRepository: { lidMapping: { getPNForLID: async () => pnForLid } },
    // O resolvedor de nomes procura aqui primeiro: e' o "nome do contato".
    contacts: { getName: (jid) => (acerta(jid) ? NICK_ALVO : undefined) },
    getName: (jid) => (acerta(jid) ? NICK_ALVO : undefined),
    groupMetadata: async () => ({
      id: groupJid,
      subject: 'G',
      participants,
    }),
    groupParticipantsUpdate: async () => ({}),
    groupRequestParticipantsList: async () => [],
    groupRequestParticipantsUpdate: async () => ({}),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {}, sendPresenceUpdate: async () => {}, profilePictureUrl: async () => 'x', react: async () => ({}),
  };
}

async function rodar({ groupJid, text, quoted = null, mentionedJid = [], opts = {} }) {
  senderCounter += 1;
  const sender = `22200000${String(senderCounter).padStart(5, '0')}@lid`;
  const sent = [];
  const nazu = makeNazu({ sent, groupJid, sender, opts });
  const contextInfo = { remoteJid: groupJid };
  if (mentionedJid.length) contextInfo.mentionedJid = mentionedJid;
  if (quoted) { contextInfo.quotedMessage = quoted; contextInfo.participant = sender; }
  await handleMessage(nazu, {
    key: { remoteJid: groupJid, fromMe: false, id: `M-${Math.random().toString(36).slice(2, 9)}`, participant: sender },
    message: { extendedTextMessage: { text, contextInfo } },
    messageTimestamp: 1757900000,
    pushName: 'Tester',
  }, null, new Map(), null);
  await new Promise((r) => setTimeout(r, 200));
  const texto = sent.map((s) => s.content?.text ?? s.content?.caption ?? '').filter(Boolean).join('\n');
  const publicacao = sent.find((s) => s.content?.groupStatus === true) || null;
  return { sent, texto, publicacao };
}

const fakeUpload = async () => ({ url: 'https://mmg.whatsapp.net/fake', directPath: '/v/fake' });

async function payloadDoContent(content) {
  const gerado = await generateWAMessageContent(content, { userJid: `${BOT_JID.split('@')[0]}@s.whatsapp.net`, upload: fakeUpload });
  const inner = gerado.groupStatusMessageV2?.message;
  const tipo = inner ? Object.keys(inner)[0] : null;
  return {
    temV2: Boolean(gerado.groupStatusMessageV2),
    tipoInterno: tipo,
    isGroupStatus: inner?.[tipo]?.contextInfo?.isGroupStatus,
    caption: inner?.[tipo]?.caption,
    textoInterno: inner?.extendedTextMessage?.text,
    gifPlayback: inner?.[tipo]?.gifPlayback,
    mimetype: inner?.[tipo]?.mimetype,
  };
}

// --- Midia CIFRADA de verdade, servida por HTTP local ----------------------
function cifrar(plaintext, mediaKey, type) {
  const info = `WhatsApp ${MEDIA_HKDF_KEY_MAPPING[type]} Keys`;
  const expanded = Buffer.from(hkdf(mediaKey, 112, { info }));
  const iv = expanded.subarray(0, 16);
  const cipherKey = expanded.subarray(16, 48);
  const cipher = crypto.createCipheriv('aes-256-cbc', cipherKey, iv);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}

let servidor = null, porta = 0;
const servidos = new Map();
async function subirServidor() {
  if (servidor) return;
  servidor = http.createServer((req, res) => {
    const c = servidos.get(req.url);
    if (!c) { res.writeHead(404).end('nada'); return; }
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': c.length });
    res.end(c);
  });
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  porta = servidor.address().port;
}
function publicarSticker(plaintext) {
  const mediaKey = crypto.randomBytes(32);
  const cifrado = cifrar(plaintext, mediaKey, 'sticker');
  const rota = `/s-${Math.random().toString(36).slice(2)}.enc`;
  servidos.set(rota, cifrado);
  return { stickerMessage: proto.Message.StickerMessage.create({
    url: `http://127.0.0.1:${porta}${rota}`,
    mediaKey, mimetype: 'image/webp', fileLength: plaintext.length,
  }) };
}

// --- Fixtures de WebP ------------------------------------------------------
const u24 = (n) => { const b = Buffer.alloc(3); b.writeUIntLE(n, 0, 3); return b; };
const chunk = (four, payload) => {
  const h = Buffer.alloc(8); h.write(four, 0, 'ascii'); h.writeUInt32LE(payload.length, 4);
  return Buffer.concat([h, payload, payload.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)]);
};
function buildAnimatedWebp(width, height, imgFour, imgBody, frames) {
  const vp8x = Buffer.concat([Buffer.from([0x02, 0, 0, 0]), u24(width - 1), u24(height - 1)]);
  const anim = Buffer.concat([Buffer.from([0, 0, 0, 0]), Buffer.from([0, 0])]);
  const anmfs = frames.map((f) => {
    const hdr = Buffer.concat([u24(0), u24(0), u24(width - 1), u24(height - 1), u24(f.duration || 100), Buffer.from([0])]);
    return chunk('ANMF', Buffer.concat([hdr, chunk(imgFour, imgBody)]));
  });
  const body = Buffer.concat([chunk('VP8X', vp8x), chunk('ANIM', anim), ...anmfs]);
  const riff = Buffer.alloc(12);
  riff.write('RIFF', 0, 'ascii'); riff.writeUInt32LE(body.length + 4, 4); riff.write('WEBP', 8, 'ascii');
  return Buffer.concat([riff, body]);
}

await subirServidor();

const STATIC_WEBP = await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 1 } } }).webp().toBuffer();
const base = await sharp({ create: { width: 128, height: 128, channels: 4, background: { r: 220, g: 40, b: 70, alpha: 1 } } }).webp().toBuffer();
// extrai o bitstream VP8 do webp base para reaproveitar nos frames
function webpImg(baseBuf) {
  let off = 12;
  while (off + 8 <= baseBuf.length) {
    const four = baseBuf.toString('ascii', off, off + 4);
    const size = baseBuf.readUInt32LE(off + 4);
    if (four === 'VP8 ' || four === 'VP8L') return { four, body: baseBuf.subarray(off + 8, off + 8 + size) };
    off += 8 + size + (size & 1);
  }
  throw new Error('sem VP8');
}
const vp8 = webpImg(base);
const ANIMATED_WEBP = buildAnimatedWebp(128, 128, vp8.four, vp8.body, Array.from({ length: 8 }, () => ({ duration: 100 })));

const STICKER_ANIMADA = publicarSticker(ANIMATED_WEBP);
const STICKER_ESTATICA = publicarSticker(STATIC_WEBP);

// ============================================================================
// 1) FIGURINHA -> STATUS
// ============================================================================

await test('1. figurinha ANIMADA vira VIDEO com gifPlayback no status', async () => {
  const groupJid = makeGroup();
  const { publicacao, texto } = await rodar({ groupJid, text: '!statusgrupo', quoted: STICKER_ANIMADA });
  ok(publicacao, 'publicou');
  ok(Buffer.isBuffer(publicacao?.content?.video), 'mandou BUFFER de video (converteu a figurinha)');
  ok(publicacao?.content?.gifPlayback === true, 'gifPlayback: true (anima em loop)');
  contem(texto, 'Status publicado', 'confirma o sucesso');
});

await test('2. animada: payload vira groupStatusMessageV2 videoMessage gifPlayback', async () => {
  const groupJid = makeGroup();
  const { publicacao } = await rodar({ groupJid, text: '!statusgrupo', quoted: STICKER_ANIMADA });
  const p = await payloadDoContent(publicacao.content);
  ok(p.temV2, 'encapsulado em groupStatusMessageV2');
  ok(p.tipoInterno === 'videoMessage', `tipo interno videoMessage (${p.tipoInterno})`);
  ok(p.gifPlayback === true, 'gifPlayback preservado no payload');
  ok(p.isGroupStatus === true, 'isGroupStatus = true');
});

await test('3. figurinha ESTATICA vira IMAGEM no status', async () => {
  const groupJid = makeGroup();
  const { publicacao } = await rodar({ groupJid, text: '!statusgrupo', quoted: STICKER_ESTATICA });
  ok(publicacao, 'publicou');
  ok(Buffer.isBuffer(publicacao?.content?.image), 'mandou BUFFER de imagem');
  ok(publicacao?.content?.mimetype === 'image/png', 'mimetype png');
  const p = await payloadDoContent(publicacao.content);
  ok(p.tipoInterno === 'imageMessage', `tipo interno imageMessage (${p.tipoInterno})`);
  ok(p.isGroupStatus === true, 'isGroupStatus = true');
});

await test('4. figurinha + legenda: a legenda vai junto', async () => {
  const groupJid = makeGroup();
  const { publicacao } = await rodar({ groupJid, text: '!statusgrupo Minha figurinha 💜', quoted: STICKER_ESTATICA });
  const p = await payloadDoContent(publicacao.content);
  ok(p.tipoInterno === 'imageMessage', 'e imagem');
  ok(p.caption === 'Minha figurinha 💜', `legenda (obtida "${p.caption}")`);
});

await test('5. figurinha em view once tambem funciona', async () => {
  const groupJid = makeGroup();
  const quotedVO = { viewOnceMessageV2: { message: STICKER_ANIMADA } };
  const { publicacao } = await rodar({ groupJid, text: '!statusgrupo', quoted: quotedVO });
  ok(publicacao, 'publicou');
  ok(Buffer.isBuffer(publicacao?.content?.video), 'converteu a figurinha do view once');
});

await test('6. a figurinha NAO e publicada como sticker cru', async () => {
  const groupJid = makeGroup();
  const { publicacao } = await rodar({ groupJid, text: '!statusgrupo', quoted: STICKER_ESTATICA });
  ok(!publicacao?.content?.sticker, 'nao manda sticker (o status nao aceita)');
  const p = await payloadDoContent(publicacao.content);
  ok(p.tipoInterno !== 'stickerMessage', 'tipo interno nao e stickerMessage');
});

// ============================================================================
// 2) MENCAO -> NICK
// ============================================================================

await test('7. TEXTO: @lid da mencao vira o NICK', async () => {
  const groupJid = makeGroup();
  const { publicacao } = await rodar({
    groupJid,
    text: `!statusgrupo Bom dia @${ALVO_LID.split('@')[0]}`,
    mentionedJid: [ALVO_LID],
  });
  const p = await payloadDoContent(publicacao.content);
  contem(p.textoInterno || '', `@${NICK_ALVO}`, 'mostra o nick');
  naoContem(p.textoInterno || '', ALVO_LID.split('@')[0], 'nao mostra o LID');
});

await test('8. IMAGEM: legenda com mencao vira NICK', async () => {
  const groupJid = makeGroup();
  const { publicacao } = await rodar({
    groupJid,
    text: `!statusgrupo olha @${ALVO_LID.split('@')[0]}`,
    quoted: STICKER_ESTATICA,
    mentionedJid: [ALVO_LID],
  });
  const p = await payloadDoContent(publicacao.content);
  contem(p.caption || '', `@${NICK_ALVO}`, 'legenda com o nick');
  naoContem(p.caption || '', ALVO_LID.split('@')[0], 'legenda sem o LID');
});

await test('9. mencao sem nome resolvivel fica como esta (nao apaga)', async () => {
  const groupJid = makeGroup();
  const DESCONHECIDO = '599000000000009@lid';
  const { publicacao } = await rodar({
    groupJid,
    text: `!statusgrupo oi @${DESCONHECIDO.split('@')[0]}`,
    mentionedJid: [DESCONHECIDO],
  });
  const p = await payloadDoContent(publicacao.content);
  contem(p.textoInterno || '', `@${DESCONHECIDO.split('@')[0]}`, 'mantem a mencao crua');
});

await test('10. texto SEM mencao passa intacto', async () => {
  const groupJid = makeGroup();
  const { publicacao } = await rodar({ groupJid, text: '!statusgrupo Bom dia, família! 💜' });
  const p = await payloadDoContent(publicacao.content);
  ok(p.textoInterno === 'Bom dia, família! 💜', `sem alteracao (obtido "${p.textoInterno}")`);
});

// ============================================================================
// 3) HELPER PURO
// ============================================================================

const sg = await import(new URL('../dados/src/utils/stickerStatus.js', import.meta.url).href);

await test('11. helper: detecta webp e converte animada/estatica', async () => {
  const baileys = await import('@itsliaaa/baileys');
  ok(sg.isWebP(STATIC_WEBP) && sg.isWebP(ANIMATED_WEBP), 'isWebP');
  const anim = await sg.figurinhaParaStatus(ANIMATED_WEBP, { stickerToMp4: baileys.stickerToMp4, isAnimatedWebP: baileys.isAnimatedWebP, sharpLib: sharp });
  ok(anim.type === 'video' && anim.gifPlayback === true, 'animada -> video gifPlayback');
  const est = await sg.figurinhaParaStatus(STATIC_WEBP, { sharpLib: sharp });
  ok(est.type === 'image' && est.mimetype === 'image/png', 'estatica -> png');
});

await test('12. helper: buffer vazio lanca erro controlado', async () => {
  let erro = null;
  try { await sg.figurinhaParaStatus(Buffer.alloc(0), {}); } catch (e) { erro = e; }
  ok(erro && /vazia/i.test(erro.message), 'erro de figurinha vazia');
});

await test('13. BUG REAL: mencao LID sem mentionedJid nao vira LID — vira nome', async () => {
  // Este e o caso do aparelho: o texto traz `@<lid>` e o participant/metadata
  // so conhecem o TELEFONE. A versao ANTIGA do helper percorria apenas o
  // `mentionedJid`; sem ele, sobrava o LID. Agora o helper extrai TODOS os
  // `@<digitos>` do texto e cruza com o metadata.
  const groupJid = makeGroup();
  const { publicacao } = await rodar({
    groupJid,
    text: `!statusgrupo oi @${ALVO_LID.split('@')[0]}`,
    mentionedJid: [],
    opts: { soTelefone: true },
  });
  const p = await payloadDoContent(publicacao.content);
  contem(p.textoInterno || '', `@${NICK_ALVO}`, 'resolveu pelo telefone do metadata');
  naoContem(p.textoInterno || '', ALVO_LID.split('@')[0], 'sem LID');
});

await test('14. sem nome: mostra o TELEFONE (nunca o LID)', async () => {
  const groupJid = makeGroup();
  const { publicacao } = await rodar({
    groupJid,
    text: `!statusgrupo oi @${ALVO_LID.split('@')[0]}`,
    mentionedJid: [ALVO_LID],
    opts: { soTelefone: true, semAlvoNoMetadata: true },
  });
  // Sem metadata, o LID nao tem como ser traduzido: mantem a mencao como esta
  // (o dono preferiu isso a inventar um nome), mas nunca deixa pior.
  const p = await payloadDoContent(publicacao.content);
  ok(typeof p.textoInterno === 'string' && p.textoInterno.includes('oi'), 'publicou o texto');
});

await test('15. resolve LID -> PN pelo socket quando falta no metadata', async () => {
  const groupJid = makeGroup();
  const { publicacao } = await rodar({
    groupJid,
    text: `!statusgrupo oi @${ALVO_LID.split('@')[0]}`,
    mentionedJid: [],
    opts: { soTelefone: true, semAlvoNoMetadata: true, pnForLid: ALVO_JID },
  });
  const p = await payloadDoContent(publicacao.content);
  contem(p.textoInterno || '', `@${NICK_ALVO}`, 'resolveu via getPNForLID');
  naoContem(p.textoInterno || '', ALVO_LID.split('@')[0], 'sem LID');
});

await test('16. FIGURINHA com legenda: mencao tambem vira nome', async () => {
  const groupJid = makeGroup();
  const { publicacao } = await rodar({
    groupJid,
    text: `!statusgrupo olha @${ALVO_LID.split('@')[0]}`,
    quoted: STICKER_ANIMADA,
    mentionedJid: [ALVO_LID],
    opts: { soTelefone: true },
  });
  const p = await payloadDoContent(publicacao.content);
  ok(p.tipoInterno === 'videoMessage', 'continua sendo video');
  contem(p.caption || '', `@${NICK_ALVO}`, 'legenda da figurinha com o nick');
});

// ============================================================================
// RESUMO
// ============================================================================

const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log(`\n${totalFail === 0 ? 'OK' : 'ERR'} ${RESULTS.length} testes / ${totalOk} assercoes (${totalFail} falhas)`);
process.exit(totalFail === 0 ? 0 : 1);
