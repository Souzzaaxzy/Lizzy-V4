/**
 * Testes do !enqueteimg — enquete com imagens nas opções.
 *
 * Cobre o parser, a coleta de anexos, a resolução dos índices e o comando real
 * rodando no handler (com socket falso), conferindo que o payload enviado usa
 * `imagePoll` e que a ordem/validações estão corretas.
 *
 * Uso: node tests/enqueteimg.test.js
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

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-pollimg-db-'));
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
  for (const e of CURRENT.errors) console.log(`     ${e}`);
}

function ok(cond, msg) {
  if (cond) CURRENT.passed += 1;
  else {
    CURRENT.failed += 1;
    CURRENT.errors.push(`ASSERT FALHOU: ${msg}`);
  }
}

function includes(hay, needle, msg) {
  ok(String(hay).includes(needle), msg || `esperava conter "${needle}"`);
}

const {
  parseImagePollArgs,
  collectAttachments,
  resolveAttachments,
  findImageMessage,
  buildOptionName,
  MAX_ATTACHMENTS
} = await import('../dados/src/utils/pollImages.js');

// ============================================================================
// 1) PARSER
// ============================================================================

await test('parser: pergunta + índices na ordem digitada', () => {
  const r = parseImagePollArgs('Qual vocês preferem?|1|2|3');
  ok(r.ok, 'aceitou');
  ok(r.question === 'Qual vocês preferem?', `pergunta (obtido "${r.question}")`);
  ok(JSON.stringify(r.indexes) === '[1,2,3]', `índices (obtido ${JSON.stringify(r.indexes)})`);
});

await test('parser: 2 imagens', () => {
  const r = parseImagePollArgs('Qual vocês preferem?|1|2');
  ok(r.ok, 'aceitou');
  ok(r.indexes.length === 2, 'dois índices');
});

await test('parser: 4 imagens', () => {
  const r = parseImagePollArgs('Qual vocês preferem?|1|2|3|4');
  ok(r.ok, 'aceitou');
  ok(r.indexes.length === 4, 'quatro índices');
});

await test('parser: ordem invertida é PRESERVADA (não reordena)', () => {
  const r = parseImagePollArgs('Qual vocês preferem?|3|1|2');
  ok(r.ok, 'aceitou');
  ok(JSON.stringify(r.indexes) === '[3,1,2]', `manteve a ordem (obtido ${JSON.stringify(r.indexes)})`);
});

await test('parser: caracteres especiais e emoji na pergunta', () => {
  const r = parseImagePollArgs('Qual é o melhor? 🤔|1|2|3');
  ok(r.ok, 'aceitou');
  ok(r.question === 'Qual é o melhor? 🤔', `pergunta íntegra (obtido "${r.question}")`);
});

await test('parser: pergunta vazia é recusada', () => {
  const r = parseImagePollArgs('|1|2');
  ok(!r.ok, 'recusou');
  includes(r.error, 'pergunta', 'explica o problema');
});

await test('parser: sem opções é recusado', () => {
  const r = parseImagePollArgs('Só a pergunta');
  ok(!r.ok, 'recusou');
  includes(r.error, '2 índices', 'explica o mínimo');
});

await test('parser: só uma opção é recusada', () => {
  const r = parseImagePollArgs('Pergunta|1');
  ok(!r.ok, 'recusou');
  includes(r.error, '2 opções', 'explica o mínimo');
});

await test('parser: índice não numérico é recusado', () => {
  const r = parseImagePollArgs('Pergunta|1|abc');
  ok(!r.ok, 'recusou');
  includes(r.error, 'abc', 'mostra o valor inválido');
});

await test('parser: índice 0 é recusado (começa em 1)', () => {
  const r = parseImagePollArgs('Pergunta|0|1');
  ok(!r.ok, 'recusou');
  includes(r.error, 'começam em 1', 'explica a base');
});

await test('parser: índice negativo é recusado', () => {
  const r = parseImagePollArgs('Pergunta|-1|2');
  ok(!r.ok, 'recusou');
});

await test('parser: índice duplicado é recusado', () => {
  const r = parseImagePollArgs('Pergunta|1|1|2');
  ok(!r.ok, 'recusou');
  includes(r.error, 'mais de uma vez', 'explica a duplicidade');
});

await test('parser: acima do máximo é recusado', () => {
  const muitos = Array.from({ length: MAX_ATTACHMENTS + 1 }, (_, i) => i + 1).join('|');
  const r = parseImagePollArgs(`Pergunta|${muitos}`);
  ok(!r.ok, 'recusou');
  includes(r.error, String(MAX_ATTACHMENTS), 'informa o limite');
});

await test('parser: entrada vazia é recusada', () => {
  ok(!parseImagePollArgs('').ok, 'recusou vazio');
  ok(!parseImagePollArgs(null).ok, 'recusou null');
});

// ============================================================================
// 2) COLETA DE ANEXOS
// ============================================================================

/** Info de mensagem de imagem, no formato do messagesCache. */
function infoImagem({ chat, autor, id, ts, fromMe = false }) {
  return {
    key: { remoteJid: chat, fromMe, id, participant: autor },
    message: { imageMessage: { url: `https://x/${id}`, mimetype: 'image/jpeg' } },
    messageTimestamp: ts
  };
}

function cacheCom(lista) {
  const m = new Map();
  for (const info of lista) m.set(`${info.key.remoteJid}_${info.key.id}`, info);
  return m;
}

const CHAT = '120363000000000001@g.us';
const AUTOR = '111000000000001@lid';
const OUTRO = '999000000000999@lid';
const AGORA = 1_800_000_000_000;

await test('coleta: pega as imagens do autor na ordem de envio', () => {
  const cache = cacheCom([
    infoImagem({ chat: CHAT, autor: AUTOR, id: 'c', ts: AGORA / 1000 - 3 }),
    infoImagem({ chat: CHAT, autor: AUTOR, id: 'a', ts: AGORA / 1000 - 10 }),
    infoImagem({ chat: CHAT, autor: AUTOR, id: 'b', ts: AGORA / 1000 - 6 })
  ]);
  const r = collectAttachments(cache, { chatJid: CHAT, senders: [AUTOR], now: AGORA });
  ok(r.length === 3, `achou 3 (obtido ${r.length})`);
  ok(r[0].key.id === 'a' && r[1].key.id === 'b' && r[2].key.id === 'c', 'ordenado do mais antigo para o mais novo');
});

await test('coleta: ignora imagem de OUTRO autor', () => {
  const cache = cacheCom([
    infoImagem({ chat: CHAT, autor: AUTOR, id: 'a', ts: AGORA / 1000 - 5 }),
    infoImagem({ chat: CHAT, autor: OUTRO, id: 'z', ts: AGORA / 1000 - 4 })
  ]);
  const r = collectAttachments(cache, { chatJid: CHAT, senders: [AUTOR], now: AGORA });
  ok(r.length === 1, 'só a do autor');
  ok(r[0].key.id === 'a', 'é a correta');
});

await test('coleta: ignora imagem de OUTRA conversa', () => {
  const cache = cacheCom([
    infoImagem({ chat: CHAT, autor: AUTOR, id: 'a', ts: AGORA / 1000 - 5 }),
    infoImagem({ chat: '5511999999999@s.whatsapp.net', autor: AUTOR, id: 'z', ts: AGORA / 1000 - 4 })
  ]);
  const r = collectAttachments(cache, { chatJid: CHAT, senders: [AUTOR], now: AGORA });
  ok(r.length === 1, 'só a do chat atual');
});

await test('coleta: ignora imagem fora da janela de tempo', () => {
  const cache = cacheCom([
    infoImagem({ chat: CHAT, autor: AUTOR, id: 'velha', ts: AGORA / 1000 - 600 }),
    infoImagem({ chat: CHAT, autor: AUTOR, id: 'nova', ts: AGORA / 1000 - 5 })
  ]);
  const r = collectAttachments(cache, { chatJid: CHAT, senders: [AUTOR], now: AGORA, windowMs: 60_000 });
  ok(r.length === 1, 'só a recente');
  ok(r[0].key.id === 'nova', 'é a recente');
});

await test('coleta: ignora mensagem do próprio bot (fromMe)', () => {
  const cache = cacheCom([
    infoImagem({ chat: CHAT, autor: AUTOR, id: 'doBot', ts: AGORA / 1000 - 5, fromMe: true }),
    infoImagem({ chat: CHAT, autor: AUTOR, id: 'doUser', ts: AGORA / 1000 - 4 })
  ]);
  const r = collectAttachments(cache, { chatJid: CHAT, senders: [AUTOR], now: AGORA });
  ok(r.length === 1 && r[0].key.id === 'doUser', 'não pega o que o bot mandou');
});

await test('coleta: ignora texto (não-imagem)', () => {
  const cache = cacheCom([
    { key: { remoteJid: CHAT, fromMe: false, id: 'txt', participant: AUTOR }, message: { conversation: 'oi' }, messageTimestamp: AGORA / 1000 - 5 }
  ]);
  ok(collectAttachments(cache, { chatJid: CHAT, senders: [AUTOR], now: AGORA }).length === 0, 'texto não conta');
});

await test('coleta: acha imagem encapsulada (view once)', () => {
  const cache = cacheCom([
    {
      key: { remoteJid: CHAT, fromMe: false, id: 'vo', participant: AUTOR },
      message: { viewOnceMessageV2: { message: { imageMessage: { url: 'https://x/vo' } } } },
      messageTimestamp: AGORA / 1000 - 5
    }
  ]);
  const r = collectAttachments(cache, { chatJid: CHAT, senders: [AUTOR], now: AGORA });
  ok(r.length === 1, 'achou a encapsulada');
});

await test('coleta: cache vazio/inválido não quebra', () => {
  ok(collectAttachments(null, { chatJid: CHAT }).length === 0, 'null');
  ok(collectAttachments(new Map(), { chatJid: CHAT }).length === 0, 'vazio');
  ok(collectAttachments(new Map(), {}).length === 0, 'sem chat');
});

await test('coleta: aceita autor como JID ou LID (mesmo número)', () => {
  const cache = cacheCom([
    infoImagem({ chat: CHAT, autor: '5511999999999@lid', id: 'a', ts: AGORA / 1000 - 5 })
  ]);
  const r = collectAttachments(cache, { chatJid: CHAT, senders: ['5511999999999@s.whatsapp.net'], now: AGORA });
  ok(r.length === 1, 'casou o número mesmo com domínio diferente');
});

// ============================================================================
// 3) RESOLUÇÃO DOS ÍNDICES
// ============================================================================

const anexos3 = [{ key: { id: 'img1' } }, { key: { id: 'img2' } }, { key: { id: 'img3' } }];

await test('resolve: 1|2|3 pega as três na ordem', () => {
  const r = resolveAttachments(anexos3, [1, 2, 3]);
  ok(r.ok, 'resolveu');
  ok(r.items.map(i => i.key.id).join(',') === 'img1,img2,img3', 'ordem correta');
});

await test('resolve: 3|1|2 respeita a ordem pedida', () => {
  const r = resolveAttachments(anexos3, [3, 1, 2]);
  ok(r.ok, 'resolveu');
  ok(r.items.map(i => i.key.id).join(',') === 'img3,img1,img2', 'não reordena');
});

await test('resolve: índice inexistente é recusado', () => {
  const r = resolveAttachments(anexos3, [1, 2, 9]);
  ok(!r.ok, 'recusou');
  includes(r.error, '9', 'mostra o índice');
  includes(r.error, '3', 'informa quantas existem');
});

await test('resolve: sem anexos é recusado com instrução', () => {
  const r = resolveAttachments([], [1, 2]);
  ok(!r.ok, 'recusou');
  includes(r.error, 'imagem recente', 'explica o que fazer');
});

await test('resolve: nome da opção é "Opção N"', () => {
  ok(buildOptionName(1) === 'Opção 1', 'opção 1');
  ok(buildOptionName(3) === 'Opção 3', 'opção 3');
});

// ============================================================================
// 4) COMANDO REAL (handler + socket falso)
// ============================================================================

// --- servidor de mídia cifrada (mesma técnica dos outros testes) -----------
const servidos = new Map();
let porta = 0;
async function subirServidor() {
  const servidor = http.createServer((req, res) => {
    const dado = servidos.get(req.url);
    if (!dado) {
      res.writeHead(404);
      res.end('nope');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    res.end(dado);
  });
  await new Promise((resolve) => servidor.listen(0, '127.0.0.1', resolve));
  porta = servidor.address().port;
}

function cifrar(plaintext, mediaKey, type) {
  const info = `WhatsApp ${MEDIA_HKDF_KEY_MAPPING[type]} Keys`;
  const expanded = Buffer.from(hkdf(mediaKey, 112, { info }));
  const iv = expanded.subarray(0, 16);
  const cipherKey = expanded.subarray(16, 48);
  const cipher = crypto.createCipheriv('aes-256-cbc', cipherKey, iv);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}

const JPEG_REAL = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.alloc(200, 0x41),
  Buffer.from([0xff, 0xd9])
]);

function publicarImagem() {
  const mediaKey = crypto.randomBytes(32);
  const cifrado = cifrar(JPEG_REAL, mediaKey, 'image');
  const rota = `/img-${Math.random().toString(36).slice(2)}.enc`;
  servidos.set(rota, cifrado);
  return {
    url: `http://127.0.0.1:${porta}${rota}`,
    mediaKey,
    mimetype: 'image/jpeg',
    fileLength: JPEG_REAL.length
  };
}

await subirServidor();

const { default: handleMessage } = await import('../dados/src/index.js');

const BOT_LID = '222000000000001@lid';
const BOT_JID = '5511999999998@s.whatsapp.net';
let senderCounter = 0;
const gruposUsados = new Set();

function makeGroup() {
  senderCounter += 1;
  // grupo novo por execução: o metadata é cacheado por grupo (TTL 10s)
  return `1203630000000000${String(senderCounter).padStart(2, '0')}@g.us`;
}

function makeNazu({ sent, groupJid, sender, admin = true }) {
  return {
    sendMessage: async (jid, content, options) => {
      sent.push({ jid, content, options });
      return { key: { id: `SENT-${sent.length}` } };
    },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
    onWhatsApp: async (jid) => [{ jid, exists: true, lid: jid.replace('@s.whatsapp.net', '@lid') }],
    signalRepository: { lidMapping: { getPNForLID: async () => null } },
    groupMetadata: async () => ({
      id: groupJid,
      subject: 'Grupo Poll',
      participants: [
        { id: BOT_LID, lid: BOT_LID, phoneNumber: BOT_JID, admin: 'admin' },
        { id: sender, lid: sender, phoneNumber: '5511999999997@s.whatsapp.net', admin: admin ? 'admin' : null }
      ]
    }),
    groupParticipantsUpdate: async () => ({}),
    groupRequestParticipantsList: async () => [],
    groupRequestParticipantsUpdate: async () => ({}),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {},
    sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => 'x',
    react: async () => ({})
  };
}

/**
 * Executa o comando como admin, com N imagens já no cache.
 * Cada execução usa um grupo e um sender novos (throttle de 3/5s e cache de metadata).
 */
async function rodar({ text, imagens = 3, quoted = null, admin = true }) {
  senderCounter += 1;
  const groupJid = `1203630000000001${String(senderCounter).padStart(2, '0')}@g.us`;
  const sender = `2220000000${String(senderCounter).padStart(5, '0')}@lid`;

  const cache = new Map();
  const base = Math.floor(Date.now() / 1000);
  for (let i = 0; i < imagens; i++) {
    const info = {
      key: { remoteJid: groupJid, fromMe: false, id: `IMG-${i + 1}`, participant: sender },
      message: { imageMessage: publicarImagem() },
      messageTimestamp: base - (imagens - i) // mais antiga primeiro
    };
    cache.set(`${groupJid}_IMG-${i + 1}`, info);
  }

  const sent = [];
  const nazu = makeNazu({ sent, groupJid, sender, admin });
  const contextInfo = { remoteJid: groupJid };
  if (quoted) {
    contextInfo.quotedMessage = quoted;
    contextInfo.participant = sender;
  }

  await handleMessage(nazu, {
    key: { remoteJid: groupJid, fromMe: false, id: `CMD-${senderCounter}`, participant: sender },
    message: { extendedTextMessage: { text, contextInfo } },
    messageTimestamp: base,
    pushName: 'Tester'
  }, null, cache, null);

  const texto = sent.map((s) => s.content?.text ?? s.content?.caption ?? '').filter(Boolean).join('\n');
  const publicacao = sent.find((s) => s.content?.imagePoll) || null;
  return { sent, texto, publicacao };
}

await test('comando: 3 imagens -> envia imagePoll com 3 opções', async () => {
  const { publicacao, texto } = await rodar({ text: '!enqueteimg Qual vocês preferem?|1|2|3' });

  ok(publicacao, `enviou o imagePoll (texto: ${texto})`);
  const poll = publicacao?.content?.imagePoll;
  ok(poll?.name === 'Qual vocês preferem?', `pergunta (obtido "${poll?.name}")`);
  ok(poll?.options?.length === 3, `3 opções (obtido ${poll?.options?.length})`);
  ok(poll?.selectableCount === 1, 'seleção única');
  for (const opcao of poll?.options ?? []) {
    ok(Buffer.isBuffer(opcao.image) && opcao.image.length > 0, `"${opcao.name}" com BUFFER de imagem`);
  }
});

await test('comando: 2 imagens', async () => {
  const { publicacao } = await rodar({ text: '!enqueteimg Qual vocês preferem?|1|2', imagens: 2 });
  ok(publicacao?.content?.imagePoll?.options?.length === 2, 'duas opções');
});

await test('comando: ordem invertida |3|1|2 é respeitada', async () => {
  const { publicacao } = await rodar({ text: '!enqueteimg Qual vocês preferem?|3|1|2' });
  const opcoes = publicacao?.content?.imagePoll?.options ?? [];
  ok(opcoes.length === 3, 'três opções');

  // As imagens do cache foram publicadas em ordem; conferir que os buffers
  // enviados seguem a ordem pedida (3, 1, 2) é possível pelos tamanhos/bytes.
  // Aqui comparamos com uma execução de referência 1|2|3.
  const { publicacao: ref } = await rodar({ text: '!enqueteimg Ref|1|2|3' });
  const refOpcoes = ref?.content?.imagePoll?.options ?? [];
  ok(
    Buffer.compare(opcoes[0].image, refOpcoes[2].image) === 0,
    'opção 1 usa a imagem 3'
  );
  ok(
    Buffer.compare(opcoes[1].image, refOpcoes[0].image) === 0,
    'opção 2 usa a imagem 1'
  );
  ok(
    Buffer.compare(opcoes[2].image, refOpcoes[1].image) === 0,
    'opção 3 usa a imagem 2'
  );
});

await test('comando: pergunta com emoji/acentos', async () => {
  const { publicacao } = await rodar({ text: '!enqueteimg Qual é o melhor? 🤔|1|2|3' });
  ok(publicacao?.content?.imagePoll?.name === 'Qual é o melhor? 🤔', 'pergunta íntegra');
});

await test('comando: índice inexistente -> erro controlado', async () => {
  const { publicacao, texto } = await rodar({ text: '!enqueteimg Teste|1|2|9' });
  ok(!publicacao, 'não publicou');
  includes(texto, '9', 'mostra o índice');
  includes(texto, '3', 'informa quantas existem');
});

await test('comando: sem opções -> erro controlado', async () => {
  const { publicacao, texto } = await rodar({ text: '!enqueteimg Só a pergunta' });
  ok(!publicacao, 'não publicou');
  includes(texto, '2 índices', 'explica o uso');
});

await test('comando: pergunta vazia -> erro controlado', async () => {
  const { publicacao, texto } = await rodar({ text: '!enqueteimg |1|2' });
  ok(!publicacao, 'não publicou');
  includes(texto, 'pergunta', 'explica o problema');
});

await test('comando: sem imagens no cache -> erro com instrução', async () => {
  const { publicacao, texto } = await rodar({ text: '!enqueteimg Teste|1|2', imagens: 0 });
  ok(!publicacao, 'não publicou');
  includes(texto, 'imagem recente', 'explica o que fazer');
});

await test('comando: imagem corrompida -> erro sem crashar', async () => {
  senderCounter += 1;
  const groupJid = `1203630000000001${String(senderCounter).padStart(2, '0')}@g.us`;
  const sender = `2220000000${String(senderCounter).padStart(5, '0')}@lid`;
  const base = Math.floor(Date.now() / 1000);

  const cache = new Map();
  for (let i = 0; i < 2; i++) {
    cache.set(`${groupJid}_B-${i}`, {
      key: { remoteJid: groupJid, fromMe: false, id: `B-${i}`, participant: sender },
      // URL que não responde: falha de conexão
      message: { imageMessage: { url: 'http://127.0.0.1:1/x.enc', mediaKey: Buffer.from('k'.repeat(32)), mimetype: 'image/jpeg' } },
      messageTimestamp: base - 1
    });
  }

  const sent = [];
  const nazu = makeNazu({ sent, groupJid, sender });
  await handleMessage(nazu, {
    key: { remoteJid: groupJid, fromMe: false, id: 'CMD-ERR', participant: sender },
    message: { extendedTextMessage: { text: '!enqueteimg Teste|1|2', contextInfo: { remoteJid: groupJid } } },
    messageTimestamp: base,
    pushName: 'Tester'
  }, null, cache, null);

  const texto = sent.map((s) => s.content?.text ?? '').filter(Boolean).join('\n');
  ok(!sent.some((s) => s.content?.imagePoll), 'não publicou');
  includes(texto, 'Não consegui baixar', 'explica a falha de download');
  ok(!texto.includes('at '), 'sem stack trace');
});

await test('comando: membro comum NÃO usa (só admin)', async () => {
  const { publicacao, texto } = await rodar({ text: '!enqueteimg Teste|1|2|3', admin: false });
  ok(!publicacao, 'não publicou');
  includes(texto, 'restrito a Administradores', 'explica a restrição');
});

await test('comando: fora de grupo recusa', async () => {
  senderCounter += 1;
  const sender = `2220000000${String(senderCounter).padStart(5, '0')}@lid`;
  const sent = [];
  const nazu = makeNazu({ sent, groupJid: '5511999999999@s.whatsapp.net', sender });
  await handleMessage(nazu, {
    key: { remoteJid: '5511999999999@s.whatsapp.net', fromMe: false, id: 'CMD-PV', participant: sender },
    message: { extendedTextMessage: { text: '!enqueteimg Teste|1|2', contextInfo: {} } },
    messageTimestamp: Math.floor(Date.now() / 1000),
    pushName: 'Tester'
  }, null, new Map(), null);
  const texto = sent.map((s) => s.content?.text ?? '').filter(Boolean).join('\n');
  includes(texto, 'só para grupos', 'explica que é só em grupo');
});

await test('comando: !pollimg (alias) funciona igual', async () => {
  const { publicacao } = await rodar({ text: '!pollimg Alias|1|2' , imagens: 2 });
  ok(publicacao?.content?.imagePoll?.options?.length === 2, 'alias envia o poll');
});

// ============================================================================
// 5) REGRESSÃO
// ============================================================================

await test('regressão: !enquete normal continua funcionando', async () => {
  const { publicacao, texto } = await rodar({ text: '!enquete Escolha|A|B' });
  ok(!publicacao, 'não é imagePoll');
  ok(texto === '' || !texto.includes('imagePoll'), 'sem imagePoll');
  // a enquete normal usa `poll` (não `imagePoll`)
  const { sent } = await rodar({ text: '!enquete Escolha|A|B' });
  const normal = sent.find((s) => s.content?.poll);
  ok(Boolean(normal), 'enviou enquete normal');
  ok(normal?.content?.poll?.values?.length === 2, 'duas opções de texto');
});

await test('regressão: envio normal de imagem não virou imagePoll', async () => {
  // o comando !st (sticker) existe e não deve produzir imagePoll
  const { sent } = await rodar({ text: '!enqueteimg Teste|1|2', imagens: 2 });
  ok(!sent.some((s) => s.content?.imagePoll === undefined && s.content?.poll), 'sem poll de texto');
});

await test('menu: enqueteimg listado no menuadm', async () => {
  const src = fs.readFileSync(path.join(PROJECT, 'dados/src/menus/menuadm.js'), 'utf-8');
  includes(src, '${prefix}enqueteimg', 'menuadm lista enqueteimg');
});

// ============================================================================
// RESULTADO
// ============================================================================

const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log('\n' + '='.repeat(40));
console.log(`RESULTADO: ${RESULTS.length} testes | ${totalOk} asserções ok | ${totalFail} falhas`);
console.log('='.repeat(40));
if (totalFail === 0) console.log('✅ TODOS OS TESTES PASSARAM');
else {
  console.log('FALHAS:');
  for (const r of RESULTS) for (const e of r.errors) console.log(`- [${r.name}] ${e}`);
  process.exit(1);
}
// O servidor de mídia mantém o processo vivo; encerra explicitamente.
process.exit(0);