/**
 * Testes do comando `!midiaprefix` (dados/src/index.js), que unificou
 * `!fotoprefix` + `!videoprefix` + `!msgprefix`.
 *
 * Roda o handler REAL com socket falso e `DATABASE_PATH`/`CONFIG_PATH`
 * temporários (não toca o banco real).
 *
 * A mídia de teste é CIFRADA DE VERDADE (hkdf + AES-256-CBC, o mesmo formato do
 * WhatsApp) e servida por um HTTP local — assim o `getFileBuffer` percorre o
 * caminho real de download, em vez de um stub. É o que torna o teste de GIF
 * confiável: o buffer que chega ao conversor é o que o download entregou.
 *
 * Uso: node tests/midiaprefix.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import crypto from 'crypto';
import { spawnSync } from 'child_process';
import { hkdf, MEDIA_HKDF_KEY_MAPPING } from '@itsliaaa/baileys';

const RESULTS = [];
let CURRENT = null;

function test(name, fn) {
  CURRENT = { name, passed: 0, failed: 0, errors: [] };
  RESULTS.push(CURRENT);
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      return r.then(() => finish(name)).catch((e) => { CURRENT.failed += 1; CURRENT.errors.push(`EXCEÇÃO: ${e?.stack || e}`); finish(name); });
    }
    finish(name);
  } catch (e) {
    CURRENT.failed += 1;
    CURRENT.errors.push(`EXCEÇÃO: ${e?.stack || e}`);
    finish(name);
  }
  return Promise.resolve();
}
function finish(name) {
  console.log(`${CURRENT.failed === 0 ? '✅' : '❌'} ${name} (${CURRENT.passed} ok, ${CURRENT.failed} falhas)`);
  for (const e of CURRENT.errors) console.log(`     ${e.split('\n')[0]}`);
}
function ok(c, m) { if (c) CURRENT.passed += 1; else { CURRENT.failed += 1; CURRENT.errors.push(`ASSERT FALHOU: ${m}`); } }
function eq(a, b, m) { ok(a === b, `${m} — esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`); }
function contem(h, n, l) { ok(typeof h === 'string' && h.includes(n), `${l || n} — esperado conter "${n}"`); }
function naoContem(h, n, l) { ok(typeof h === 'string' && !h.includes(n), `${l || n} — não deveria conter "${n}"`); }

// ============================================================================
// CARGA DO HANDLER REAL (banco e config temporários)
// ============================================================================

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-midiaprefix-db-'));
const TMP_CONFIG = path.join(TMP_DB, 'config.json');
process.env.DATABASE_PATH = TMP_DB;
process.env.CONFIG_PATH = TMP_CONFIG;
fs.mkdirSync(path.join(TMP_DB, 'grupos'), { recursive: true });
fs.mkdirSync(path.join(TMP_DB, 'dono'), { recursive: true });
fs.writeFileSync(TMP_CONFIG, JSON.stringify({ prefixo: '!', nomebot: 'Abyss', nomedono: 'Dono', numerodono: '5511000000000', debug: false }, null, 2));

// O comando APAGA a mídia anterior ao salvar. O repositório tem um
// `dados/midias/prefix_media.jpg` versionado — o teste guarda o estado original
// e o devolve no fim, para não sujar a árvore de trabalho.
const MIDIA_DIR = new URL('../dados/midias/', import.meta.url);
const ARQUIVOS_PREFIX_MEDIA = ['prefix_media.jpg', 'prefix_media.mp4'];
const BACKUP_MIDIAS = new Map();
for (const nome of ARQUIVOS_PREFIX_MEDIA) {
  const u = new URL(nome, MIDIA_DIR);
  if (fs.existsSync(u)) BACKUP_MIDIAS.set(nome, fs.readFileSync(u));
}
function restaurarMidias() {
  for (const nome of ARQUIVOS_PREFIX_MEDIA) {
    const u = new URL(nome, MIDIA_DIR);
    try {
      if (BACKUP_MIDIAS.has(nome)) fs.writeFileSync(u, BACKUP_MIDIAS.get(nome));
      else if (fs.existsSync(u)) fs.rmSync(u);
    } catch { /* ignore */ }
  }
}

const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;
if (typeof handleMessage !== 'function') throw new Error('index.js não exporta o handler');
const db = await import(new URL('../dados/src/utils/database.js', import.meta.url).href);

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const ffmpegOk = spawnSync(FFMPEG, ['-version'], { stdio: 'ignore' }).status === 0;
console.log(`     ℹ️ FFmpeg: ${ffmpegOk ? 'disponível' : 'AUSENTE (testes de GIF serão pulados)'}`);

// ============================================================================
// MÍDIA CIFRADA + SERVIDOR LOCAL
// ============================================================================

function cifrar(plaintext, mediaKey, type) {
  const info = `WhatsApp ${MEDIA_HKDF_KEY_MAPPING[type]} Keys`;
  const expanded = Buffer.from(hkdf(mediaKey, 112, { info }));
  const iv = expanded.subarray(0, 16);
  const cipherKey = expanded.subarray(16, 48);
  const cipher = crypto.createCipheriv('aes-256-cbc', cipherKey, iv);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}

const JPEG_REAL = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('foto-real-'.repeat(40)), Buffer.from([0xff, 0xd9])]);
const MP4_REAL = Buffer.concat([Buffer.from('ftypisom'), Buffer.from('video-real-'.repeat(40))]);

let servidor = null;
const servidos = new Map();
let seq = 0;

async function subirServidor() {
  if (servidor) return;
  servidor = http.createServer((req, res) => {
    const conteudo = servidos.get(req.url);
    if (!conteudo) { res.writeHead(404).end('nao encontrado'); return; }
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': conteudo.length });
    res.end(conteudo);
  });
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
}

/** Publica bytes cifrados no servidor e devolve o objeto de mídia do proto. */
function midiaEnviada(tipo, plaintext) {
  const mediaKey = crypto.randomBytes(32);
  const cifrado = cifrar(plaintext, mediaKey, tipo === 'image' ? 'image' : (tipo === 'video' ? 'video' : 'image'));
  const rota = `/m${seq++}`;
  servidos.set(rota, cifrado);
  // URL ABSOLUTA. O proto NÃO leva `directPath`: quando ele existe, a fork
  // monta `https://<host><directPath>` e ignora a `url` — o que faria o fetch
  // falar TLS com um servidor HTTP (o erro "wrong version number"). Sem
  // `directPath`, a `url` é usada como está.
  const url = `http://127.0.0.1:${servidor.address().port}${rota}`;
  const base = { url, fileLength: cifrado.length, mediaKey };
  if (tipo === 'image') return { imageMessage: { ...base, mimetype: 'image/jpeg' } };
  if (tipo === 'video') return { videoMessage: { ...base, mimetype: 'video/mp4' } };
  if (tipo === 'gif') return { imageMessage: { ...base, mimetype: 'image/gif' } };
  if (tipo === 'webp') return { stickerMessage: { ...base, mimetype: 'image/webp', isAnimated: true } };
  return {};
}
const midiaMarcada = midiaEnviada;

/** GIF animado real, gerado pelo FFmpeg. */
function gifDeTeste() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-gif-'));
  const out = path.join(dir, 'a.gif');
  const r = spawnSync(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc=size=32x32:rate=5:duration=1',
    '-vf', 'fps=5,scale=32:32:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse',
    out,
  ], { stdio: 'ignore' });
  let buf = null;
  if (r.status === 0 && fs.existsSync(out)) buf = fs.readFileSync(out);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  return buf;
}
const GIF_REAL = ffmpegOk ? gifDeTeste() : null;

// ============================================================================
// SOCKET FALSO
// ============================================================================

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';
const OWNER_JID = '5511000000000@s.whatsapp.net';
const OTHER_JID = '5511888888888@s.whatsapp.net';

let groupCounter = 0;
const newGroupJid = () => { groupCounter += 1; return `1203638000000000${String(groupCounter).padStart(3, '0')}@g.us`; };

function makeNazu({ sent, senderJid, groupJid }) {
  return {
    sendMessage: async (jid, content, options) => { sent.push({ jid, content, options }); return { key: { id: 'SENT' } }; },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Abyss' },
    onWhatsApp: async (jid) => [{ jid, exists: true, lid: '999000000000001@lid' }],
    signalRepository: { lidMapping: { getPNForLID: async () => null } },
    groupMetadata: async () => ({
      id: groupJid, subject: 'Grupo Teste',
      participants: [
        { id: BOT_LID, admin: 'admin', phoneNumber: BOT_JID },
        { id: `${String(senderJid).split('@')[0]}@lid`, admin: 'admin', phoneNumber: senderJid },
      ],
    }),
    groupParticipantsUpdate: async () => ({}),
    groupRequestParticipantsList: async () => [],
    groupRequestParticipantsUpdate: async () => ({}),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {},
    sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => null,
  };
}

// ============================================================================
// EXECUÇÃO
// ============================================================================

let senderCounter = 0;
let throttleBypass = true;
async function rodar({ comando, midia = null, marcada = null, sender = OWNER_JID, fromMe = throttleBypass } = {}) {
  const sent = [];
  const groupJid = newGroupJid();
  const nazu = makeNazu({ sent, senderJid: sender, groupJid });

  const ctx = {};
  if (marcada) ctx.quotedMessage = marcada;
  const temCtx = Object.keys(ctx).length > 0;
  // Quando a mídia é a PRÓPRIA mensagem, o texto do comando vai na `caption` DE
  // DENTRO do objeto de mídia (`imageMessage.caption`, `videoMessage.caption`,
  // ...) — é de lá que o `getMessageText` do handler lê. Sem isso o comando nem
  // é reconhecido e nada é enviado.
  const message = midia
    ? (() => {
        const tipo = Object.keys(midia).find((k) => k.endsWith('Message'));
        const node = { ...midia[tipo], caption: comando };
        if (temCtx) node.contextInfo = ctx;
        return { [tipo]: node };
      })()
    : { extendedTextMessage: { text: comando, ...(temCtx ? { contextInfo: ctx } : {}) } };

  senderCounter += 1;
  const info = {
    key: { remoteJid: groupJid, fromMe, id: `CMD-${senderCounter}`, participant: `${String(sender).split('@')[0]}@lid` },
    message,
    messageTimestamp: 1757900000,
    pushName: 'Tester',
  };
  await handleMessage(nazu, info, null, new Map(), null);
  const textos = sent.map((s) => s.content?.text).filter(Boolean).join('\n---\n');
  return { sent, textos, nazu, groupJid };
}

await subirServidor();

// ============================================================================
// SEÇÃO 1 — TEXTO
// ============================================================================

await test('1. salva o texto e resolve #prefixo# e #numerodele# na prévia', async () => {
  const { textos } = await rodar({ comando: '!midiaprefix Use #prefixo# antes, #numerodele#!' });
  contem(textos, 'salvo', 'confirmou o salvamento');
  contem(textos, 'Use ! antes', '#prefixo# resolvido');
  contem(textos, '@5511000000000', '#numerodele# resolvido');
  eq(db.loadMsgPrefix(), 'Use #prefixo# antes, #numerodele#!', 'texto persistido literal');
});

await test('2. sem argumento mostra o painel com as instruções', async () => {
  const { textos } = await rodar({ comando: '!midiaprefix' });
  contem(textos, 'MIDIA DA RESPOSTA PREFIXO', 'título');
  contem(textos, '#prefixo#', 'explica #prefixo#');
  contem(textos, '#numerodele#', 'explica #numerodele#');
  contem(textos, 'midiaprefix off', 'explica como remover');
});

// ============================================================================
// SEÇÃO 2 — MÍDIA (download real)
// ============================================================================

await test('3. salva IMAGEM (bytes reais descriptografados)', async () => {
  const { textos } = await rodar({ comando: '!midiaprefix', midia: midiaEnviada('image', JPEG_REAL) });
  contem(textos, 'Imagem da resposta prefixo atualizado', 'confirmou');
  ok(Boolean(db.isPrefixMediaEnabled()), 'mídia ativa');
  eq(db.getPrefixMediaType(), 'image', 'tipo image');
  eq(db.getPrefixMediaIsGif(), false, 'não é gif');
  const salvo = fs.readFileSync(db.getPrefixMediaPath());
  ok(salvo.equals(JPEG_REAL), 'o arquivo salvo é o JPEG original descriptografado');
});

await test('4. salva VÍDEO (marcado)', async () => {
  const { textos } = await rodar({ comando: '!midiaprefix', marcada: midiaMarcada('video', MP4_REAL) });
  contem(textos, 'Vídeo da resposta prefixo atualizado', 'confirmou');
  eq(db.getPrefixMediaType(), 'video', 'tipo video');
  eq(db.getPrefixMediaIsGif(), false, 'não é gif');
  ok(fs.readFileSync(db.getPrefixMediaPath()).equals(MP4_REAL), 'MP4 original salvo');
});

await test('5. GIF é convertido para MP4 e marcado como isGif', async () => {
  if (!ffmpegOk || !GIF_REAL) { console.log('     ⏭  pulado (sem FFmpeg)'); eq(1, 1, 'pulado'); return; }
  const { textos } = await rodar({ comando: '!midiaprefix', marcada: midiaEnviada('gif', GIF_REAL) });
  contem(textos, 'GIF da resposta prefixo atualizado', 'confirmou como GIF');
  eq(db.getPrefixMediaType(), 'video', 'GIF vira video');
  eq(db.getPrefixMediaIsGif(), true, 'marcado como gif');
  const salvo = fs.readFileSync(db.getPrefixMediaPath());
  ok(salvo.length > 0, 'arquivo salvo não é vazio');
  ok(salvo.subarray(4, 12).toString('ascii').includes('ftyp'), 'o arquivo salvo é MP4 (não os bytes do GIF)');
  ok(db.getPrefixMediaPath().endsWith('.mp4'), 'extensão .mp4');
});

await test('6. WebP animado (figurinha) também é tratado como GIF', async () => {
  if (!ffmpegOk || !GIF_REAL) { console.log('     ⏭  pulado (sem FFmpeg)'); eq(1, 1, 'pulado'); return; }
  await rodar({ comando: '!midiaprefix', marcada: midiaEnviada('webp', GIF_REAL) });
  eq(db.getPrefixMediaIsGif(), true, 'webp animado marcado como gif');
  eq(db.getPrefixMediaType(), 'video', 'salvo como video');
});

// ============================================================================
// SEÇÃO 3 — REMOÇÃO
// ============================================================================

await test('7. off remove mídia E texto', async () => {
  await rodar({ comando: '!midiaprefix off' });
  await rodar({ comando: '!midiaprefix texto qualquer' });
  await rodar({ comando: '!midiaprefix', midia: midiaEnviada('image', JPEG_REAL) });
  ok(Boolean(db.isPrefixMediaEnabled()), 'pré-condição: mídia ativa');
  const { textos } = await rodar({ comando: '!midiaprefix off' });
  contem(textos, 'removida', 'confirmou remoção');
  ok(!db.isPrefixMediaEnabled(), 'mídia removida (isPrefixMediaEnabled é falsy)');
  eq(db.loadMsgPrefix(), false, 'texto removido');
});

await test('8. off sem nada configurado avisa (não finge sucesso)', async () => {
  await rodar({ comando: '!midiaprefix off' });
  const { textos } = await rodar({ comando: '!midiaprefix off' });
  contem(textos, 'Não há nada configurado', 'aviso honesto');
});

// ============================================================================
// SEÇÃO 4 — ALIASES ANTIGOS
// ============================================================================

await test('9. aliases antigos apontam para o mesmo comando', async () => {
  for (const cmd of ['!fotoprefix', '!videoprefix', '!gifprefix', '!msgprefix']) {
    const { textos } = await rodar({ comando: `${cmd} texto via ${cmd}` });
    contem(textos, 'salvo', `${cmd} salvou`);
    eq(db.loadMsgPrefix(), `texto via ${cmd}`, `${cmd} persistiu`);
  }
});

// ============================================================================
// SEÇÃO 5 — RESPOSTA AO "PREFIXO"
// ============================================================================

await test('10. só TEXTO: "prefixo" responde o texto com #prefixo# resolvido', async () => {
  await rodar({ comando: '!midiaprefix Use #prefixo# antes!' });
  const { sent } = await rodar({ comando: 'prefixo' });
  const texto = sent.map((s) => s.content?.text).filter(Boolean).join('\n');
  contem(texto, 'Use ! antes!', 'texto configurado enviado');
  ok(!sent.some((s) => s.content?.video || s.content?.image), 'sem mídia');
});

await test('11. só MÍDIA: "prefixo" envia a mídia com legenda padrão', async () => {
  await rodar({ comando: '!midiaprefix off' });
  await rodar({ comando: '!midiaprefix', midia: midiaEnviada('image', JPEG_REAL) });
  const { sent } = await rodar({ comando: 'prefixo' });
  const comImagem = sent.find((s) => s.content?.image);
  ok(comImagem, 'enviou imagem');
  contem(comImagem.content.caption, 'Meu prefixo atual neste grupo é', 'legenda padrão');
  ok(Array.isArray(comImagem.content.mentions) && comImagem.content.mentions.length > 0, 'menciona quem digitou');
  ok(Buffer.isBuffer(comImagem.content.image) && comImagem.content.image.equals(JPEG_REAL), 'reenviou o JPEG salvo');
});

await test('12. MÍDIA + TEXTO: o texto vira a LEGENDA da mídia', async () => {
  await rodar({ comando: '!midiaprefix off' });
  await rodar({ comando: '!midiaprefix', midia: midiaEnviada('image', JPEG_REAL) });
  await rodar({ comando: '!midiaprefix Olá #numerodele#, use #prefixo#' });
  const { sent } = await rodar({ comando: 'prefixo' });
  const comImagem = sent.find((s) => s.content?.image);
  ok(comImagem, 'enviou imagem');
  contem(comImagem.content.caption, 'Olá @5511000000000, use !', 'texto como legenda, variáveis resolvidas');
  naoContem(comImagem.content.caption, '#numerodele#', 'variável não sai crua');
});

await test('13. GIF salvo é enviado com gifPlayback=true', async () => {
  if (!ffmpegOk || !GIF_REAL) { console.log('     ⏭  pulado (sem FFmpeg)'); eq(1, 1, 'pulado'); return; }
  await rodar({ comando: '!midiaprefix', marcada: midiaEnviada('gif', GIF_REAL) });
  eq(db.getPrefixMediaIsGif(), true, 'pré-condição: gif');
  const { sent } = await rodar({ comando: 'prefixo' });
  const comVideo = sent.find((s) => s.content?.video);
  ok(comVideo, 'enviou como vídeo (MP4)');
  eq(comVideo.content.gifPlayback, true, 'gifPlayback ligado');
});

await test('14. nenhuma configuração: "prefixo" responde o prefixo simples', async () => {
  await rodar({ comando: '!midiaprefix off' });
  const { sent } = await rodar({ comando: 'prefixo' });
  const texto = sent.map((s) => s.content?.text).filter(Boolean).join('\n');
  contem(texto, 'Prefixo atual deste grupo: !', 'responde o prefixo');
  ok(!sent.some((s) => s.content?.video || s.content?.image), 'sem mídia');
});

// ============================================================================
// SEÇÃO 6 — PERMISSÃO
// ============================================================================

await test('15. não-dono é recusado (texto e mídia)', async () => {
  const r1 = await rodar({ comando: '!midiaprefix texto do intruso', sender: OTHER_JID, fromMe: false });
  contem(r1.textos, 'apenas para o meu dono', 'recusou texto');
  const r2 = await rodar({ comando: '!midiaprefix', midia: midiaEnviada('image', JPEG_REAL), sender: OTHER_JID, fromMe: false });
  contem(r2.textos, 'apenas para o meu dono', 'recusou mídia');
});


// ============================================================================
// SEÇÃO 7 — MENU, HELP E ESTRUTURA
// ============================================================================

await test('16. menu mostra midiaprefix e não os antigos', () => {
  const menu = fs.readFileSync(new URL('../dados/src/menus/menudono.js', import.meta.url), 'utf8');
  contem(menu, 'midiaprefix', 'menu tem midiaprefix');
  naoContem(menu, 'fotoprefix', 'sem fotoprefix');
  naoContem(menu, 'msgprefix', 'sem msgprefix');
  naoContem(menu, 'videoprefix', 'sem videoprefix');
});

await test('17. help do prefixo descreve o comando unificado', () => {
  const src = fs.readFileSync(new URL('../dados/src/index.js', import.meta.url), 'utf8');
  contem(src, 'Mídia / Mensagem de Prefixo', 'título do help');
  contem(src, 'midiaprefix <mensagem>', 'exemplo do help');
});

await test('18. msgprefix/fotoprefix/videoprefix só existem como alias', () => {
  const src = fs.readFileSync(new URL('../dados/src/index.js', import.meta.url), 'utf8');
  eq((src.match(/case 'msgprefix'/g) || []).length, 1, 'msgprefix só como alias');
  eq((src.match(/case 'fotoprefix'/g) || []).length, 1, 'fotoprefix só como alias');
  eq((src.match(/case 'videoprefix'/g) || []).length, 1, 'videoprefix só como alias');
  eq((src.match(/case 'midiaprefix'/g) || []).length, 1, 'uma case midiaprefix');
});

await test('19. os dois gatilhos de "prefixo" usam o mesmo helper', () => {
  const src = fs.readFileSync(new URL('../dados/src/index.js', import.meta.url), 'utf8');
  const usos = (src.match(/responderPrefixo\(/g) || []).length;
  eq(usos, 3, '1 definição + 2 chamadas (não duplicado)');
});

// ============================================================================
// FINAL
// ============================================================================

try { servidor?.close(); } catch { /* ignore */ }
restaurarMidias();
try { fs.rmSync(TMP_DB, { recursive: true, force: true }); } catch { /* ignore */ }

const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log('\n════════════════════════════════════════');
console.log(`RESULTADO: ${RESULTS.length} testes | ${totalOk} asserções ok | ${totalFail} falhas`);
console.log('════════════════════════════════════════');
if (totalFail > 0) {
  console.log('\nFALHAS:');
  for (const r of RESULTS) if (r.failed) for (const e of r.errors) console.log(`- [${r.name}] ${e}`);
  process.exit(1);
}
console.log('✅ TODOS OS TESTES PASSARAM');
process.exit(0);
