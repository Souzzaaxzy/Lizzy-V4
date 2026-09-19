/**
 * Testes da visualização de mídia encapsulada: View Once V1/V2/V2Extension,
 * mensagem efêmera, documento com legenda etc.
 *
 * Dois problemas reais cobertos aqui:
 *
 * 1. **Caminho errado do ViewOnceV2.** A mídia fica em
 *    `viewOnceMessageV2.message.imageMessage`. Vários comandos liam
 *    `viewOnceMessageV2.imageMessage` (faltando `.message`) e nunca achavam
 *    nada — o `!pv` sempre respondia "Não foi possível obter a mídia".
 *
 * 2. **Enviar a URL do CDN em vez do buffer.** O que está na URL do WhatsApp é
 *    conteúdo CIFRADO. Ao receber `{ image: { url } }`, o Baileys faz um fetch
 *    cru e reenvia aqueles bytes como se fossem a mídia — o destinatário recebia
 *    um arquivo ilegível ("não foi possível baixar a mídia"). Era o `!revelar`.
 *
 * Por isso o teste NÃO se contenta em ver "enviou algo": ele cifra uma mídia de
 * verdade no mesmo formato do WhatsApp, serve por HTTP local e confere que o
 * comando entrega o conteúdo JÁ DESCRIPTOGRAFADO (o buffer original).
 *
 * Uso: node tests/viewonce-v2.test.js
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

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-vo-db-'));
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
  ok(typeof haystack === 'string' && haystack.includes(needle), `${label ?? needle} — esperado conter "${needle}"`);
}

function notIncludes(haystack, needle, label) {
  ok(typeof haystack === 'string' && !haystack.includes(needle), `${label ?? needle} — não deveria conter "${needle}"`);
}

// ============================================================================
// MÓDULOS
// ============================================================================

const vo = await import(new URL('../dados/src/utils/viewOnce.js', import.meta.url).href);
const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;

// ============================================================================
// MÍDIA CIFRADA DE VERDADE (mesmo formato do WhatsApp)
// ============================================================================

/** Cifra um conteúdo em AES-256-CBC com as chaves derivadas da mediaKey. */
function cifrar(plaintext, mediaKey, type) {
  const info = `WhatsApp ${MEDIA_HKDF_KEY_MAPPING[type]} Keys`;
  const expanded = Buffer.from(hkdf(mediaKey, 112, { info }));
  const iv = expanded.subarray(0, 16);
  const cipherKey = expanded.subarray(16, 48);
  const cipher = crypto.createCipheriv('aes-256-cbc', cipherKey, iv);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}

/** Imagem JPEG mínima, só para ter bytes reconhecíveis. */
const JPEG_FAKE = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.from('conteudo-real-da-foto-'.repeat(20)),
  Buffer.from([0xff, 0xd9]),
]);
const MP4_FAKE = Buffer.concat([Buffer.from('ftypisom'), Buffer.from('video-real-'.repeat(30))]);
const OGG_FAKE = Buffer.concat([Buffer.from('OggS'), Buffer.from('audio-real-'.repeat(30))]);

let servidor = null;
let porta = 0;
/** URL -> bytes que o servidor entrega. */
const servidos = new Map();

async function subirServidor() {
  if (servidor) return;
  servidor = http.createServer((req, res) => {
    const conteudo = servidos.get(req.url);
    if (!conteudo) {
      res.writeHead(404).end('nao encontrado');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': conteudo.length });
    res.end(conteudo);
  });
  await new Promise((resolve) => servidor.listen(0, '127.0.0.1', resolve));
  porta = servidor.address().port;
  console.log(`   (servidor de mídia fake em 127.0.0.1:${porta})`);
}

/** Publica um conteúdo cifrado e devolve o proto de mídia que aponta para ele. */
function publicarMidia(tipoProto, plaintext, type) {
  const mediaKey = crypto.randomBytes(32);
  const cifrado = cifrar(plaintext, mediaKey, type);
  const rota = `/midia-${Math.random().toString(36).slice(2)}.enc`;
  servidos.set(rota, cifrado);

  const mimetype =
    tipoProto === 'ImageMessage' ? 'image/jpeg'
      : tipoProto === 'VideoMessage' ? 'video/mp4'
        : tipoProto === 'AudioMessage' ? 'audio/ogg'
          : 'application/octet-stream';

  return proto.Message[tipoProto].create({
    url: `http://127.0.0.1:${porta}${rota}`,
    mediaKey,
    mimetype,
    fileLength: plaintext.length,
    // Sem directPath de propósito: assim o download usa a nossa URL.
  });
}

// ============================================================================
// 1) RESOLVEDOR (puro) — TODAS AS FORMAS DE ENCAPSULAMENTO
// ============================================================================

const mediaKeyFixa = Buffer.from('k'.repeat(32));
const imgProto = proto.Message.ImageMessage.create({ url: 'https://mmg.whatsapp.net/x', mediaKey: mediaKeyFixa, directPath: '/v/x', mimetype: 'image/jpeg' });
const vidProto = proto.Message.VideoMessage.create({ url: 'https://mmg.whatsapp.net/v', mediaKey: mediaKeyFixa, directPath: '/v/v', mimetype: 'video/mp4', seconds: 5 });
const audProto = proto.Message.AudioMessage.create({ url: 'https://mmg.whatsapp.net/a', mediaKey: mediaKeyFixa, directPath: '/v/a', mimetype: 'audio/ogg' });
const docProto = proto.Message.DocumentMessage.create({ url: 'https://mmg.whatsapp.net/d', mediaKey: mediaKeyFixa, directPath: '/v/d', mimetype: 'application/pdf' });

await test('resolvedor: acha a mídia direta e encapsulada', () => {
  const casos = [
    ['imageMessage direto', { imageMessage: imgProto }, 'image'],
    ['videoMessage direto', { videoMessage: vidProto }, 'video'],
    ['audioMessage direto', { audioMessage: audProto }, 'audio'],
    ['viewOnce V1', { viewOnceMessage: { message: { imageMessage: imgProto } } }, 'image'],
    ['viewOnce V2 imagem', { viewOnceMessageV2: { message: { imageMessage: imgProto } } }, 'image'],
    ['viewOnce V2 vídeo', { viewOnceMessageV2: { message: { videoMessage: vidProto } } }, 'video'],
    ['viewOnce V2Ext áudio', { viewOnceMessageV2Extension: { message: { audioMessage: audProto } } }, 'audio'],
    ['efêmera > V2 > imagem', { ephemeralMessage: { message: { viewOnceMessageV2: { message: { imageMessage: imgProto } } } } }, 'image'],
    ['efêmera > imagem', { ephemeralMessage: { message: { imageMessage: imgProto } } }, 'image'],
    ['documento com legenda', { documentWithCaptionMessage: { message: { documentMessage: docProto } } }, 'document'],
    ['V2 > docComLegenda > doc', { viewOnceMessageV2: { message: { documentWithCaptionMessage: { message: { documentMessage: docProto } } } } }, 'document'],
    ['com messageContextInfo', { messageContextInfo: { deviceListMetadataVersion: 2 }, imageMessage: imgProto }, 'image'],
  ];
  for (const [nome, conteudo, esperado] of casos) {
    const r = vo.extractMedia(conteudo);
    ok(r?.type === esperado, `${nome} -> ${r?.type} (esperado ${esperado})`);
  }
});

await test('resolvedor: o caminho ERRADO do V2 não acha nada', () => {
  // Este era o bug: `viewOnceMessageV2.imageMessage` (sem `.message`) é undefined.
  const msg = proto.Message.create({ viewOnceMessageV2: { message: { imageMessage: imgProto } } });
  ok(msg.viewOnceMessageV2.imageMessage === undefined, 'sem `.message` a mídia não existe (confirma o bug antigo)');
  ok(msg.viewOnceMessageV2.message.imageMessage !== undefined, 'com `.message` a mídia está lá');
  ok(vo.extractMedia(msg)?.type === 'image', 'o resolvedor acha pelo caminho certo');
});

await test('resolvedor: marca viewOnce e a cadeia percorrida', () => {
  const v2 = { viewOnceMessageV2: { message: { imageMessage: imgProto } } };
  const eph = { ephemeralMessage: { message: { viewOnceMessageV2: { message: { imageMessage: imgProto } } } } };

  ok(vo.extractMedia(v2).viewOnce === true, 'V2 marcado como viewOnce');
  ok(vo.extractMedia(eph).viewOnce === true, 'efêmera+V2 marcado como viewOnce');
  ok(vo.extractMedia({ imageMessage: imgProto }).viewOnce === false, 'mídia direta não é viewOnce');
  ok(vo.extractMedia(eph).chain.length === 3, `cadeia com 3 níveis (obtido ${vo.extractMedia(eph).chain.length})`);
});

await test('resolvedor: sem mídia devolve null (não inventa)', () => {
  ok(vo.extractMedia({ conversation: 'oi' }) === null, 'texto puro');
  ok(vo.extractMedia({ extendedTextMessage: { text: 'oi' } }) === null, 'texto estendido');
  ok(vo.extractMedia(null) === null, 'null');
  ok(vo.extractMedia(undefined) === null, 'undefined');
  ok(vo.extractMedia({}) === null, 'objeto vazio');
  ok(vo.extractMedia({ stickerMessage: null }) === null, 'campo nulo');
});

await test('resolvedor: prioriza o primeiro conteúdo com mídia', () => {
  const v2 = { viewOnceMessageV2: { message: { imageMessage: imgProto } } };
  ok(vo.resolveMedia([v2, { videoMessage: vidProto }])?.type === 'image', 'usa o primeiro (citado)');
  ok(vo.resolveMedia([null, { videoMessage: vidProto }])?.type === 'video', 'pula o nulo');
  ok(vo.resolveMedia([{ conversation: 'x' }, v2])?.type === 'image', 'pula texto');
  ok(vo.resolveMedia([]) === null, 'lista vazia');
  ok(vo.resolveMedia([null, null]) === null, 'só nulos');
});

await test('resolvedor: describeMediaError explica os casos conhecidos', () => {
  includes(vo.describeMediaError(new Error('404 Not Found')), 'expirou', '404');
  includes(vo.describeMediaError(new Error('429 Too Many Requests')), 'limitando', '429');
  includes(vo.describeMediaError(new Error('ETIMEDOUT')), 'conexão', 'timeout');
  includes(vo.describeMediaError(new Error('No valid media URL or directPath')), 'incompletos', 'sem URL');
  ok(vo.describeMediaError(new Error('erro qualquer')) === null, 'erro desconhecido -> null');
});

await test('resolvedor: mediaTypeLabel em português', () => {
  ok(vo.mediaTypeLabel('image') === 'imagem', 'image');
  ok(vo.mediaTypeLabel('video') === 'vídeo', 'video');
  ok(vo.mediaTypeLabel('audio') === 'áudio', 'audio');
  ok(vo.mediaTypeLabel('sticker') === 'figurinha', 'sticker');
  ok(vo.mediaTypeLabel('document') === 'documento', 'document');
});

await test('extractQuoted: acha a citação em QUALQUER tipo de mensagem', () => {
  const citada = { conversation: 'alvo' };

  ok(vo.extractQuoted({ extendedTextMessage: { contextInfo: { quotedMessage: citada } } }) === citada, 'texto');
  ok(vo.extractQuoted({ conversation: 'oi' }) === null, 'sem citação -> null');

  const emImagem = { imageMessage: { contextInfo: { quotedMessage: citada } } };
  ok(vo.extractQuoted(emImagem) === citada, 'comando na legenda de uma imagem');

  const emAudio = { audioMessage: { contextInfo: { quotedMessage: citada } } };
  ok(vo.extractQuoted(emAudio) === citada, 'comando em áudio');

  const efemera = { ephemeralMessage: { message: { extendedTextMessage: { contextInfo: { quotedMessage: citada } } } } };
  ok(vo.extractQuoted(efemera) === citada, 'dentro de mensagem efêmera');

  ok(vo.extractQuoted(null) === null, 'null -> null');
  ok(vo.extractQuoted(undefined) === null, 'undefined -> null');
});

await test('extractText: texto de conversa, texto estendido e legenda', () => {
  ok(vo.extractText({ conversation: '  oi  ' }) === 'oi', 'conversation com trim');
  ok(vo.extractText({ extendedTextMessage: { text: 'texto' } }) === 'texto', 'extendedTextMessage');
  ok(vo.extractText({ imageMessage: { caption: 'legenda' } }) === 'legenda', 'legenda de imagem');
  ok(vo.extractText({ videoMessage: { caption: 'legenda v' } }) === 'legenda v', 'legenda de vídeo');
  ok(vo.extractText({ audioMessage: {} }) === '', 'áudio sem legenda -> vazio');
  ok(
    vo.extractText({ viewOnceMessageV2: { message: { imageMessage: { caption: 'vo' } } } }) === 'vo',
    'legenda dentro de view once V2'
  );
  ok(
    vo.extractText({ ephemeralMessage: { message: { extendedTextMessage: { text: 'ef' } } } }) === 'ef',
    'texto dentro de efêmera'
  );
  ok(vo.extractText({ stickerMessage: {} }) === '', 'figurinha -> vazio');
  ok(vo.extractText(null) === '', 'null -> vazio');
  ok(vo.extractText({ extendedTextMessage: { text: '   ' } }) === '', 'só espaços -> vazio');
});

// ============================================================================
// 2) COMANDOS REAIS — o download tem de ENTREGAR O CONTEÚDO DESCRIPTOGRAFADO
// ============================================================================

await subirServidor();

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';
let groupCounter = 0;

function makeGroup() {
  groupCounter += 1;
  const jid = `1203633000000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(
    path.join(TMP_DB, 'grupos', `${jid}.json`),
    JSON.stringify({ modobrincadeira: true, groupName: 'Grupo VO' }, null, 2)
  );
  return jid;
}

function makeNazu(sent, groupJid) {
  return {
    sendMessage: async (jid, content) => {
      sent.push({ jid, content });
      return { key: { id: 'SENT' } };
    },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
    onWhatsApp: async (jid) => [{ jid, exists: true, lid: jid.replace('@s.whatsapp.net', '@lid') }],
    signalRepository: { lidMapping: { getPNForLID: async () => null } },
    groupMetadata: async () => ({
      id: groupJid,
      subject: 'Grupo VO',
      participants: [{ id: BOT_LID, lid: BOT_LID, phoneNumber: BOT_JID, admin: 'admin' }],
    }),
    groupParticipantsUpdate: async () => ({}),
    groupRequestParticipantsList: async () => [],
    groupRequestParticipantsUpdate: async () => ({}),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {},
    sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => 'x',
    react: async () => ({}),
  };
}

/**
 * Executa um comando citando (quote) um conteúdo de mensagem.
 * `fromMe: true` faz o handler considerar o autor como dono — necessário para
 * os comandos exclusivos (o `!pv`).
 */
async function citar(command, quotedContent) {
  const sent = [];
  const groupJid = makeGroup();
  const nazu = makeNazu(sent, groupJid);
  await handleMessage(nazu, {
    key: { remoteJid: groupJid, fromMe: true, id: `M-${Math.random().toString(36).slice(2, 9)}`, participant: BOT_LID },
    message: {
      extendedTextMessage: {
        text: `!${command}`,
        contextInfo: { remoteJid: groupJid, quotedMessage: quotedContent },
      },
    },
    messageTimestamp: 1757900000,
    pushName: 'Tester',
  }, null, new Map(), null);
  const texto = sent.map((s) => s.content?.text ?? s.content?.caption ?? '').filter(Boolean).join('\n');
  return { sent, texto };
}

await test('!revelar (ViewOnceV2): entrega a imagem DESCRIPTOGRAFADA, não a URL', async () => {
  const imagem = publicarMidia('ImageMessage', JPEG_FAKE, 'image');
  const { sent, texto } = await citar('revelar', { viewOnceMessageV2: { message: { imageMessage: imagem } } });

  const msg = sent.find((s) => s.content?.image);
  ok(Boolean(msg), 'o comando enviou uma imagem');
  ok(Buffer.isBuffer(msg?.content?.image), 'enviou BUFFER (não a URL do CDN)');
  ok(msg?.content?.image?.equals(JPEG_FAKE), 'o conteúdo é a foto original, já descriptografada');
  notIncludes(texto, 'não foi possível', 'sem erro de download');
});

await test('!revelar (ViewOnceV2 vídeo): entrega o vídeo descriptografado', async () => {
  const video = publicarMidia('VideoMessage', MP4_FAKE, 'video');
  const { sent } = await citar('revelar', { viewOnceMessageV2: { message: { videoMessage: video } } });

  const msg = sent.find((s) => s.content?.video);
  ok(Buffer.isBuffer(msg?.content?.video), 'enviou BUFFER de vídeo');
  ok(msg?.content?.video?.equals(MP4_FAKE), 'conteúdo do vídeo correto');
});

await test('!revelar (ViewOnceV1 e V2Extension): demais encapsulamentos funcionam', async () => {
  const v1 = publicarMidia('ImageMessage', JPEG_FAKE, 'image');
  const r1 = await citar('revelar', { viewOnceMessage: { message: { imageMessage: v1 } } });
  ok(Buffer.isBuffer(r1.sent.find((s) => s.content?.image)?.content?.image), 'V1 entrega buffer');

  const ext = publicarMidia('AudioMessage', OGG_FAKE, 'audio');
  const r2 = await citar('revelar', { viewOnceMessageV2Extension: { message: { audioMessage: ext } } });
  ok(Buffer.isBuffer(r2.sent.find((s) => s.content?.audio)?.content?.audio), 'V2Extension entrega buffer de áudio');
});

await test('!revelar (efêmera + V2): funciona também', async () => {
  const imagem = publicarMidia('ImageMessage', JPEG_FAKE, 'image');
  const { sent } = await citar('revelar', {
    ephemeralMessage: { message: { viewOnceMessageV2: { message: { imageMessage: imagem } } } },
  });
  const msg = sent.find((s) => s.content?.image);
  ok(Buffer.isBuffer(msg?.content?.image), 'enviou buffer');
  ok(msg?.content?.image?.equals(JPEG_FAKE), 'conteúdo correto');
});

await test('!revelar sem mídia: mantém a mensagem de uso', async () => {
  const { sent, texto } = await citar('revelar', { conversation: 'só texto' });
  ok(sent.length === 0 || !sent.some((s) => s.content?.image || s.content?.video), 'não tentou enviar mídia');
  includes(texto, 'marque uma imagem', 'explica o uso');
});

await test('!s (figurinha): não estoura erro de CÓDIGO ao processar a mídia', async () => {
  // O comando converte em figurinha, e a conversão depende do ffmpeg do
  // sistema. Neste ambiente ele não existe, então o esperado é uma falha
  // CONTROLADA — nunca um erro de código (ReferenceError/TypeError), que ficaria
  // escondido atrás do "Ocorreu um erro interno" genérico.
  //
  // Foi exatamente por aqui que passou um `ReferenceError: outBuffer is not
  // defined` introduzido numa correção anterior: o catch genérico engoliu o
  // erro e a asserção antiga era permissiva demais (`usouMidia || !reclamou`),
  // então o teste seguia verde. Agora olhamos o erro REAL que foi logado.
  const erros = [];
  const origError = console.error;
  console.error = (...a) => { erros.push(a.map(String).join(' ')); };
  let sent;
  let texto;
  try {
    const imagem = publicarMidia('ImageMessage', JPEG_FAKE, 'image');
    const r = await citar('s', { viewOnceMessageV2: { message: { imageMessage: imagem } } });
    sent = r.sent;
    texto = r.texto;
  } finally {
    console.error = origError;
  }

  const erroDeCodigo = erros.find((e) => /ReferenceError|TypeError|is not defined|is not a function/.test(e));
  ok(!erroDeCodigo, `nenhum erro de código (achado: ${erroDeCodigo?.slice(0, 80) || 'nenhum'})`);
  notIncludes(texto, 'Marque uma imagem ou um vídeo', 'reconheceu a mídia do ViewOnceV2 (não pediu de novo)');

  // Se o ffmpeg existir, a figurinha sai; se não, a falha é controlada.
  const usouMidia = sent.some((s) => s.content?.sticker);
  const falhouControlado = texto.includes('Ocorreu um erro interno');
  ok(usouMidia || falhouControlado, `enviou a figurinha ou falhou de forma controlada (texto: ${texto.slice(0, 50)})`);
});

await test('!s sem mídia: ainda pede a mídia (não regride)', async () => {
  const { texto } = await citar('s', { conversation: 'oi' });
  includes(texto, 'Marque uma imagem', 'pede a mídia quando não há nenhuma');
});

await test('!pv (ViewOnceV2): acha a mídia (antes sempre falhava)', async () => {
  const imagem = publicarMidia('ImageMessage', JPEG_FAKE, 'image');
  const { sent, texto } = await citar('pv', { viewOnceMessageV2: { message: { imageMessage: imagem } } });

  notIncludes(texto, 'Não foi possível obter a mídia', 'não cai no erro de mídia ausente');
  const enviada = sent.find((s) => s.content?.image);
  ok(Boolean(enviada), 'encaminhou a imagem para o dono');
  ok(Buffer.isBuffer(enviada?.content?.image), 'encaminhou o buffer baixado');
});

await test('!s não deixa arquivo temporário para trás (mesmo com ffmpeg falhando)', async () => {
  // A conversão escreve um arquivo de entrada em database/tmp e precisa
  // removê-lo SEMPRE. Quando o ffmpeg falha (ou não existe no sistema), o
  // unlink antigo não rodava e cada uso deixava um .jpg órfão para sempre.
  const tmpDir = path.join(PROJECT, 'dados', 'database', 'tmp');
  const antes = fs.existsSync(tmpDir) ? fs.readdirSync(tmpDir).length : 0;

  const imagem = publicarMidia('ImageMessage', JPEG_FAKE, 'image');
  await citar('s', { viewOnceMessageV2: { message: { imageMessage: imagem } } });

  const depois = fs.existsSync(tmpDir) ? fs.readdirSync(tmpDir).length : 0;
  ok(depois <= antes, `nenhum temporário acumulado (antes ${antes}, depois ${depois})`);
});

// ============================================================================

if (servidor) servidor.close();

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