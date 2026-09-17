/**
 * Testes do !statusgrupo — Group Status nativo no próprio grupo.
 *
 * O que este teste garante (e por que é mais forte que "enviou algo"):
 *
 * O conteúdo capturado do comando é passado pelo MESMO caminho que a fork usaria
 * (`generateWAMessageContent`), e conferimos o payload resultante:
 *   - encapsulado em `groupStatusMessageV2`;
 *   - `contextInfo.isGroupStatus === true`;
 *   - destino é o JID do grupo (`@g.us`) e NUNCA `status@broadcast`.
 *
 * Sem isso, um teste que só olha "tem um campo image" passaria mesmo que o
 * comando mandasse uma mensagem comum — que é exatamente o que não queremos.
 *
 * Uso: node tests/statusgrupo.test.js
 */

import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import { proto, generateWAMessageContent, hkdf, MEDIA_HKDF_KEY_MAPPING } from '@itsliaaa/baileys';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-statusgp-db-'));
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
// HANDLER REAL
// ============================================================================

const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';
const USER_LID = '333000000000001@lid';

let groupCounter = 0;

function makeGroup(flags = {}) {
  groupCounter += 1;
  const jid = `1203631000000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(
    path.join(GRUPOS_DIR, `${jid}.json`),
    JSON.stringify({ modobrincadeira: true, groupName: 'Grupo SG', ...flags }, null, 2)
  );
  return jid;
}

/**
 * Socket falso. `senderNoMetadata` é o autor da mensagem; ele entra no metadata
 * como admin quando `comoAdmin` for true (o handler decide a permissão a partir
 * do metadata do grupo).
 */
function makeNazu({ sent, groupJid, senderNoMetadata = USER_LID, comoAdmin = false }) {
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
      subject: 'Grupo SG',
      participants: [
        { id: BOT_LID, lid: BOT_LID, phoneNumber: BOT_JID, admin: 'admin' },
        {
          id: senderNoMetadata,
          lid: senderNoMetadata,
          phoneNumber: '5511999999997@s.whatsapp.net',
          admin: comoAdmin ? 'admin' : null,
        },
      ],
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
 * Executa o comando como ADMIN.
 *
 * O sender precisa estar no metadata do grupo (senão o handler nega por não ser
 * admin), e o metadata é cacheado por grupo — então o admin é incluído no
 * metadata do grupo E varia por execução (o handler limita 3 comandos/5s por
 * sender; reutilizar o mesmo faria o 4º responder "Calma aí!").
 */
let senderCounter = 0;
async function rodar({ groupJid, text, quoted = null, sender = null, admin = true }) {
  if (!sender) {
    senderCounter += 1;
    sender = admin
      ? `22200000${String(senderCounter).padStart(5, '0')}@lid`
      : `33300000${String(senderCounter).padStart(5, '0')}@lid`;
  }
  const ehAdmin = admin;

  const sent = [];
  const nazu = makeNazu({ sent, groupJid, senderNoMetadata: sender, comoAdmin: ehAdmin });
  const contextInfo = { remoteJid: groupJid };
  if (quoted) {
    contextInfo.quotedMessage = quoted;
    contextInfo.participant = sender;
  }
  await handleMessage(nazu, {
    key: { remoteJid: groupJid, fromMe: false, id: `M-${Math.random().toString(36).slice(2, 9)}`, participant: sender },
    message: { extendedTextMessage: { text, contextInfo } },
    messageTimestamp: 1757900000,
    pushName: 'Tester',
  }, null, new Map(), null);

  const texto = sent.map((s) => s.content?.text ?? s.content?.caption ?? '').filter(Boolean).join('\n');
  const publicacao = sent.find((s) => s.content?.groupStatus === true) || null;
  return { sent, texto, publicacao };
}

/** upload falso: o generateWAMessageContent precisa dele para mídia. */
const fakeUpload = async () => ({ url: 'https://mmg.whatsapp.net/fake', directPath: '/v/fake' });

/** Passa o conteúdo capturado pelo caminho REAL da fork e inspeciona o payload. */
async function payloadDoContent(content) {
  const gerado = await generateWAMessageContent(content, {
    userJid: `${BOT_JID.split('@')[0]}@s.whatsapp.net`,
    upload: fakeUpload,
  });
  const vo = gerado.groupStatusMessageV2;
  const inner = vo?.message;
  const tipo = inner ? Object.keys(inner)[0] : null;
  return {
    chaves: Object.keys(gerado),
    temV2: Boolean(vo),
    tipoInterno: tipo,
    isGroupStatus: inner?.[tipo]?.contextInfo?.isGroupStatus,
    temSecret: Boolean(gerado.messageContextInfo?.messageSecret),
    caption: inner?.[tipo]?.caption,
    textoInterno: inner?.extendedTextMessage?.text,
  };
}

// --- Mídia de verdade, CIFRADA, servida por HTTP local ---------------------
// O download do Baileys usa a mediaKey para descriptografar; servir bytes
// crus não funcionaria. Mesma técnica do viewonce-v2.test.js.

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
  Buffer.from('conteudo-real-da-foto-'.repeat(20)),
  Buffer.from([0xff, 0xd9]),
]);
const MP4_REAL = Buffer.concat([Buffer.from('ftypisom'), Buffer.from('video-real-'.repeat(30))]);

let servidor = null;
let porta = 0;
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
}

/** Publica uma mídia cifrada e devolve o proto que aponta para ela. */
function publicarMidia(tipoProto, plaintext, type) {
  const mediaKey = crypto.randomBytes(32);
  const cifrado = cifrar(plaintext, mediaKey, type);
  const rota = `/m-${Math.random().toString(36).slice(2)}.enc`;
  servidos.set(rota, cifrado);

  const mimetype = tipoProto === 'ImageMessage' ? 'image/jpeg' : tipoProto === 'VideoMessage' ? 'video/mp4' : 'audio/ogg';
  return proto.Message[tipoProto].create({
    url: `http://127.0.0.1:${porta}${rota}`,
    mediaKey,
    mimetype,
    fileLength: plaintext.length,
  });
}

// Preenchidas no início da suíte (depois do servidor subir).
let IMAGEM;
let VIDEO;
let IMAGEM_VO2;

await subirServidor();
IMAGEM = { imageMessage: publicarMidia('ImageMessage', JPEG_REAL, 'image') };
VIDEO = { videoMessage: publicarMidia('VideoMessage', MP4_REAL, 'video') };
IMAGEM_VO2 = { viewOnceMessageV2: { message: { imageMessage: publicarMidia('ImageMessage', JPEG_REAL, 'image') } } };

// ============================================================================
// 1) GUARDAS
// ============================================================================

await test('!statusgrupo: fora de grupo recusa', async () => {
  const { texto, publicacao } = await rodar({ groupJid: '5511999999999@s.whatsapp.net', text: '!statusgrupo oi' });
  includes(texto, 'só funciona em grupos', 'explica que é só em grupo');
  ok(!publicacao, 'não publica nada fora de grupo');
});

await test('!statusgrupo: sem conteúdo e sem mídia recusa com o uso', async () => {
  const groupJid = makeGroup();
  const { texto, publicacao } = await rodar({ groupJid, text: '!statusgrupo' });
  includes(texto, 'Informe o conteúdo', 'explica o uso');
  includes(texto, 'statusgrupo', 'mostra exemplos');
  ok(!publicacao, 'não publica vazio');
});

await test('!statusgrupo: texto em branco não publica', async () => {
  const groupJid = makeGroup();
  const { texto, publicacao } = await rodar({ groupJid, text: '!statusgrupo    ' });
  includes(texto, 'Informe o conteúdo', 'exige conteúdo real');
  ok(!publicacao, 'não publica só espaços');
});

// ============================================================================
// 2) TEXTO
// ============================================================================

await test('!statusgrupo <texto>: publica como Group Status nativo', async () => {
  const groupJid = makeGroup();
  const { texto, publicacao } = await rodar({ groupJid, text: '!statusgrupo Bom dia, família! 💜' });

  ok(publicacao, 'o comando enviou um conteúdo com groupStatus');
  ok(publicacao?.content?.groupStatus === true, 'groupStatus: true (a fork encapsula a partir disso)');
  ok(publicacao?.jid === groupJid, `destino é o JID do grupo (obtido ${publicacao?.jid})`);
  ok(publicacao?.jid?.endsWith('@g.us'), 'destino termina em @g.us');
  notIncludes(publicacao?.jid || '', 'status@broadcast', 'NÃO usa status@broadcast');
  includes(texto, 'Status publicado', 'confirma o sucesso');
  notIncludes(texto, 'undefined', 'sem undefined');
});

await test('texto: o payload vira groupStatusMessageV2 com isGroupStatus', async () => {
  const groupJid = makeGroup();
  const { publicacao } = await rodar({ groupJid, text: '!statusgrupo Olá grupo' });
  const p = await payloadDoContent(publicacao.content);

  ok(p.temV2, 'encapsulado em groupStatusMessageV2');
  ok(p.tipoInterno === 'extendedTextMessage', `tipo interno correto (${p.tipoInterno})`);
  ok(p.isGroupStatus === true, 'contextInfo.isGroupStatus = true');
  ok(p.temSecret, 'messageSecret gerado');
  includes(p.textoInterno || '', 'Olá grupo', 'o texto foi preservado');
});

await test('texto: acentos e emojis preservados', async () => {
  const groupJid = makeGroup();
  const msg = 'Atenção: ação, coração 💜🔥 e ção!';
  const { publicacao } = await rodar({ groupJid, text: `!statusgrupo ${msg}` });
  const p = await payloadDoContent(publicacao.content);
  ok(p.textoInterno === msg, `texto íntegro (obtido "${p.textoInterno}")`);
});

// ============================================================================
// 3) IMAGEM
// ============================================================================

await test('!statusgrupo respondendo imagem: publica a mídia', async () => {
  const groupJid = makeGroup();
  const { publicacao, texto } = await rodar({ groupJid, text: '!statusgrupo', quoted: IMAGEM });

  ok(publicacao, 'publicou');
  ok(Buffer.isBuffer(publicacao?.content?.image), 'mandou BUFFER de imagem (baixado, não a URL)');
  includes(texto, 'Status publicado', 'confirma o sucesso');
});

await test('imagem: payload vira groupStatusMessageV2 com imageMessage', async () => {
  const groupJid = makeGroup();
  const { publicacao } = await rodar({ groupJid, text: '!statusgrupo', quoted: IMAGEM });
  const p = await payloadDoContent(publicacao.content);

  ok(p.temV2, 'encapsulado em groupStatusMessageV2');
  ok(p.tipoInterno === 'imageMessage', `tipo interno (${p.tipoInterno})`);
  ok(p.isGroupStatus === true, 'isGroupStatus = true');
});

await test('imagem + legenda: a legenda vai junto', async () => {
  const groupJid = makeGroup();
  const { publicacao } = await rodar({ groupJid, text: '!statusgrupo Olha isso 🔥', quoted: IMAGEM });
  const p = await payloadDoContent(publicacao.content);

  ok(p.tipoInterno === 'imageMessage', 'é imagem');
  ok(p.caption === 'Olha isso 🔥', `legenda preservada (obtida "${p.caption}")`);
});

// ============================================================================
// 4) VÍDEO
// ============================================================================

await test('!statusgrupo respondendo vídeo: publica o vídeo', async () => {
  const groupJid = makeGroup();
  const { publicacao } = await rodar({ groupJid, text: '!statusgrupo', quoted: VIDEO });

  ok(publicacao, 'publicou');
  ok(Buffer.isBuffer(publicacao?.content?.video), 'mandou BUFFER de vídeo');
  const p = await payloadDoContent(publicacao.content);
  ok(p.temV2, 'encapsulado em groupStatusMessageV2');
  ok(p.tipoInterno === 'videoMessage', `tipo interno (${p.tipoInterno})`);
  ok(p.isGroupStatus === true, 'isGroupStatus = true');
});

await test('vídeo + legenda: legenda preservada', async () => {
  const groupJid = makeGroup();
  const { publicacao } = await rodar({ groupJid, text: '!statusgrupo Novo vídeo!', quoted: VIDEO });
  const p = await payloadDoContent(publicacao.content);
  ok(p.caption === 'Novo vídeo!', `legenda (obtida "${p.caption}")`);
});

// ============================================================================
// 5) VISUALIZAÇÃO ÚNICA (reaproveita o resolvedor de mídia)
// ============================================================================

await test('respondendo mídia de visualização única: também publica', async () => {
  const groupJid = makeGroup();
  const { publicacao } = await rodar({ groupJid, text: '!statusgrupo', quoted: IMAGEM_VO2 });
  ok(publicacao, 'achou a mídia encapsulada em viewOnceMessageV2');
  ok(Buffer.isBuffer(publicacao?.content?.image), 'baixou o buffer');
});

// ============================================================================
// 6) ERROS
// ============================================================================

await test('mídia que não pode ser baixada: erro claro, sem stack trace', async () => {
  const groupJid = makeGroup();
  // Sem mediaKey o download falha.
  // mediaKey válida, mas URL que não responde: falha de CONEXÃO.
  const { texto, publicacao } = await rodar({
    groupJid,
    text: '!statusgrupo',
    quoted: {
      imageMessage: {
        url: 'http://127.0.0.1:1/nao-existe.enc',
        mediaKey: Buffer.from('k'.repeat(32)),
        mimetype: 'image/jpeg',
      },
    },
  });

  ok(!publicacao, 'não publicou nada');
  includes(texto, 'Não consegui baixar', 'explica a falha de download');
  includes(texto, 'conexão', 'diz que a conexão com o servidor de mídia falhou');
  notIncludes(texto, 'at ', 'não vaza stack trace');
  notIncludes(texto, 'ReferenceError', 'sem erro de código');
});

await test('mídia sem mediaKey: avisa que os dados vieram incompletos', async () => {
  const groupJid = makeGroup();
  const { texto, publicacao } = await rodar({
    groupJid,
    text: '!statusgrupo',
    quoted: { imageMessage: { url: 'http://127.0.0.1:1/x.enc', mimetype: 'image/jpeg' } },
  });

  ok(!publicacao, 'não publicou');
  includes(texto, 'Não consegui baixar', 'explica a falha');
  includes(texto, 'incompletos', 'diz que os dados da mídia vieram incompletos');
  notIncludes(texto, 'at ', 'sem stack trace');
});

await test('falha no envio: avisa sem quebrar', async () => {
  const groupJid = makeGroup();
  const sent = [];
  const adminFalha = '222000000000099@lid';
  const nazu = makeNazu({ sent, groupJid, senderNoMetadata: adminFalha, comoAdmin: true });
  // O envio do status falha; o aviso e a confirmação não devem estourar.
  nazu.sendMessage = async (jid, content) => {
    if (content?.groupStatus) throw new Error('relay failed');
    sent.push({ jid, content });
    return { key: { id: `S-${sent.length}` } };
  };

  await handleMessage(nazu, {
    key: { remoteJid: groupJid, fromMe: false, id: 'M-ERR', participant: adminFalha },
    message: { extendedTextMessage: { text: '!statusgrupo teste', contextInfo: { remoteJid: groupJid } } },
    messageTimestamp: 1757900000,
    pushName: 'Tester',
  }, null, new Map(), null);

  const texto = sent.map((s) => s.content?.text ?? '').filter(Boolean).join('\n');
  includes(texto, 'Não foi possível publicar', 'avisa a falha');
  notIncludes(texto, 'Status publicado', 'não confirma sucesso falso');
});

await test('tipo não suportado (documento): cai na mensagem de uso', async () => {
  const groupJid = makeGroup();
  const { texto, publicacao } = await rodar({
    groupJid,
    text: '!statusgrupo',
    quoted: { documentMessage: { url: 'https://x/y', mimetype: 'application/pdf', fileName: 'x.pdf' } },
  });
  ok(!publicacao, 'não publica documento');
  includes(texto, 'Informe o conteúdo', 'explica o uso');
});

// ============================================================================
// 7) PUBLICAÇÕES CONSECUTIVAS
// ============================================================================

await test('múltiplos status seguidos: cada um publica', async () => {
  // Mesmo sender e mesmo grupo nas duas: o metadata é cacheado por grupo, então
  // o admin continua válido; e como são 2 comandos, fica dentro do limite de
  // 3 comandos/5s por sender.
  const groupJid = makeGroup();
  const mesmoAdmin = '222000000000077@lid';
  const r1 = await rodar({ groupJid, text: '!statusgrupo primeiro', sender: mesmoAdmin });
  const r2 = await rodar({ groupJid, text: '!statusgrupo segundo', sender: mesmoAdmin });

  ok(r1.publicacao && r2.publicacao, 'as duas publicações aconteceram');
  const p1 = await payloadDoContent(r1.publicacao.content);
  const p2 = await payloadDoContent(r2.publicacao.content);
  ok(p1.textoInterno === 'primeiro' && p2.textoInterno === 'segundo', 'cada um com seu conteúdo');
  ok(p1.temV2 && p2.temV2, 'ambos viraram groupStatusMessageV2');
});

// ============================================================================
// 8) REGRESSÃO: MENSAGEM NORMAL NÃO VIRA GROUP STATUS
// ============================================================================

await test('mensagem normal não ganha groupStatus (sem regressão)', async () => {
  const groupJid = makeGroup();
  // Comando qualquer que envia texto normal.
  const { sent } = await rodar({ groupJid, text: '!s' });
  const normais = sent.filter((s) => s.content?.text);
  for (const n of normais) {
    ok(n.content.groupStatus === undefined, 'texto normal sem groupStatus');
  }
  ok(normais.length > 0, 'houve envio normal para comparar');
});

await test('alias grupostatus funciona; statusgp continua sendo o OUTRO comando', async () => {
  //  já existia (relatório de status do grupo) e NÃO é alias deste
  // comando -- o switch pega o primeiro match, então reusar o nome seria
  // enganoso. Aqui garantimos que os dois seguem distintos.
  const g1 = makeGroup();
  const a = await rodar({ groupJid: g1, text: '!grupostatus alias um' });
  ok(a.publicacao?.content?.groupStatus === true, 'grupostatus publica como group status');

  const g2 = makeGroup();
  const b = await rodar({ groupJid: g2, text: '!statusgp' });
  ok(!b.publicacao, 'statusgp NÃO publica group status (é o relatório do grupo)');
});

// ============================================================================
// 7) PERMISSÃO: SÓ ADMINISTRAÇÃO
// ============================================================================

await test('!statusgrupo: membro comum NÃO publica (só admins)', async () => {
  const groupJid = makeGroup();
  const { texto, publicacao } = await rodar({
    groupJid,
    text: '!statusgrupo tentando',
    admin: false,
  });

  ok(!publicacao, 'não publicou nada');
  includes(texto, 'Apenas administradores', 'explica a restrição');
  notIncludes(texto, 'Status publicado', 'não confirma sucesso');
  notIncludes(texto, 'at ', 'sem stack trace');
});

await test('!statusgrupo: membro comum nem chega a baixar mídia', async () => {
  // A checagem de permissão vem ANTES de qualquer I/O: um não-admin
  // respondendo mídia não deve disparar download.
  const groupJid = makeGroup();
  const { texto, publicacao } = await rodar({
    groupJid,
    text: '!statusgrupo',
    quoted: IMAGEM,
    admin: false,
  });

  ok(!publicacao, 'não publicou');
  includes(texto, 'Apenas administradores', 'barrou antes de processar a mídia');
});

await test('!statusgrupo: admin do grupo publica normalmente', async () => {
  const groupJid = makeGroup();
  const { publicacao } = await rodar({ groupJid, text: '!statusgrupo sou admin', admin: true });
  ok(publicacao?.content?.groupStatus === true, 'admin consegue publicar');
});

await test('!grupostatus (alias) também exige admin', async () => {
  const groupJid = makeGroup();
  const { texto, publicacao } = await rodar({ groupJid, text: '!grupostatus tentando', admin: false });
  ok(!publicacao, 'alias não publica para não-admin');
  includes(texto, 'Apenas administradores', 'alias também restrito');
});

// ============================================================================
// 8) MENU: APARECE NO MENUADM E NÃO NO MENUMEMB
// ============================================================================

await test('menuadm: statusgrupo listado (comando de administração)', async () => {
  const src = fs.readFileSync(path.join(PROJECT, 'dados/src/menus/menuadm.js'), 'utf-8');
  includes(src, '${prefix}statusgrupo', 'menuadm lista statusgrupo');

  // E o menu renderiza de fato.
  const mod = await import(new URL('../dados/src/menus/menuadm.js', import.meta.url).href);
  const texto = String(await (mod.default ?? mod)('!', 'Lizzy', 'Teste'));
  includes(texto, '!statusgrupo', 'a saída do menuadm traz o comando');
  includes(texto, 'GESTÃO DO GRUPO', 'está na seção de gestão do grupo');
});

await test('menumemb: statusgrupo NÃO aparece mais (é de admin)', async () => {
  const src = fs.readFileSync(path.join(PROJECT, 'dados/src/menus/menumemb.js'), 'utf-8');
  notIncludes(src, 'statusgrupo', 'menumemb não lista mais statusgrupo');

  const mod = await import(new URL('../dados/src/menus/menumemb.js', import.meta.url).href);
  const texto = String(await (mod.default ?? mod)('!', 'Lizzy', 'Teste', false));
  notIncludes(texto, 'statusgrupo', 'a saída do menumemb não traz o comando');
  includes(texto, 'statusgp', 'o statusgp (relatório) continua lá');
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