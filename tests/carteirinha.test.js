/**
 * !carteirinha — o documento do membro (PNG).
 *
 * Roda o HANDLER REAL com socket falso e confere o PNG gerado de verdade
 * (magic bytes + dimensoes), alem do modulo puro (serie estavel, erro sem nome).
 *
 * Uso: node tests/carteirinha.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-cart-'));
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
      return r.then(() => finish(name)).catch((e) => {
        CURRENT.failed += 1; CURRENT.errors.push(`EXCECAO: ${e?.stack || e}`); finish(name);
      });
    }
    finish(name);
  } catch (e) {
    CURRENT.failed += 1; CURRENT.errors.push(`EXCECAO: ${e?.stack || e}`); finish(name);
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

// ============================================================================
// HANDLER REAL + MODULO
// ============================================================================

const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;
if (typeof handleMessage !== 'function') throw new Error('index.js nao exporta o handler');

const cart = await import(new URL('../dados/src/utils/carteirinha.js', import.meta.url).href);

/** Le largura/altura de um PNG. */
function pngInfo(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 24) return null;
  if (buf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

// ============================================================================
// FIXTURES
// ============================================================================

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';
const AUTOR_LID = '111000000000002@lid';
const AUTOR_JID = '5511000000002@s.whatsapp.net';
const ALVO_LID = '111000000000003@lid';
const ALVO_JID = '5511000000003@s.whatsapp.net';

let groupCounter = 0;
let senderCounter = 0;

function makeGroup() {
  groupCounter += 1;
  const groupJid = `1203639222222200${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(
    path.join(GRUPOS_DIR, `${groupJid}.json`),
    JSON.stringify({ groupName: 'Grupo Cart' }, null, 2)
  );
  return groupJid;
}

/** Uma foto de verdade (PNG 4x4 solido) para o modulo desenhar. */
function fotoPng() {
  // PNG 4x4 RGB minimo, escrito a mao (sem depender de lib).
  const w = 4, h = 4;
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0;   // filtro 0
    for (let x = 0; x < w; x++) {
      const i = y * (1 + w * 3) + 1 + x * 3;
      raw[i] = 40; raw[i + 1] = 120; raw[i + 2] = 200;
    }
  }
  const idat = zlib.deflateSync(raw);
  const chunk = (tipo, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const t = Buffer.from(tipo);
    const crcBuf = Buffer.concat([t, data]);
    let c = 0xffffffff;
    for (const b of crcBuf) {
      c ^= b;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    const crc = Buffer.alloc(4); crc.writeUInt32BE((c ^ 0xffffffff) >>> 0);
    return Buffer.concat([len, t, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)),
  ]);
}

function makeNazu({ sent, groupJid, foto = null }) {
  return {
    sendMessage: async (jid, content, options) => {
      sent.push({ jid, content, options });
      return { key: { id: `SENT-${sent.length}` } };
    },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
    onWhatsApp: async (jid) => {
      const m = { [AUTOR_JID]: AUTOR_LID, [ALVO_JID]: ALVO_LID, [BOT_JID]: BOT_LID };
      return m[jid] ? [{ jid, exists: true, lid: m[jid] }] : [{ jid, exists: false }];
    },
    signalRepository: {
      lidMapping: {
        getPNForLID: async (l) => ({ [AUTOR_LID]: AUTOR_JID, [ALVO_LID]: ALVO_JID, [BOT_LID]: BOT_JID }[l] || null),
      },
    },
    groupMetadata: async () => ({
      id: groupJid,
      subject: 'Grupo Cart',
      participants: [
        { id: AUTOR_LID, admin: 'admin', phoneNumber: AUTOR_JID, notify: 'Ana', joinedAt: 1700000000 },
        { id: ALVO_LID, admin: null, phoneNumber: ALVO_JID, notify: 'Alvo', joinedAt: 1710000000 },
        { id: BOT_LID, admin: 'admin', phoneNumber: BOT_JID, notify: 'Lizzy' },
      ],
    }),
    groupParticipantsUpdate: async () => ({}),
    groupRequestParticipantsList: async () => [],
    groupRequestParticipantsUpdate: async () => ({}),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {},
    sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => (foto ? 'https://exemplo.test/foto.png' : null),
    react: async () => ({}),
  };
}

/** Roda o comando pelo handler real. `fetch` e' dublado para servir a foto. */
async function rodar({ groupJid, texto = '!carteirinha', de = AUTOR_LID, mencionados = [], foto = null }) {
  senderCounter += 1;
  const sent = [];
  const nazu = makeNazu({ sent, groupJid, foto });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => foto.buffer.slice(foto.byteOffset, foto.byteOffset + foto.byteLength),
  });
  try {
    const ci = { remoteJid: groupJid };
    if (mencionados.length) ci.mentionedJid = mencionados;
    const info = {
      key: { remoteJid: groupJid, fromMe: false, id: `C-${senderCounter}`, participant: de },
      message: { extendedTextMessage: { text: texto, contextInfo: ci } },
      messageTimestamp: Math.floor(Date.now() / 1000),
      pushName: 'Ana',
    };
    await handleMessage(nazu, info, null, new Map(), null);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const imgMsg = sent.find((s) => s.content?.image) || null;
  const texto2 = sent.map((s) => s.content?.text ?? s.content?.caption ?? '').filter(Boolean).join('\n');
  return { sent, imgMsg, texto: texto2 };
}

// ============================================================================
// 1) O MODULO
// ============================================================================

await test('modulo: gera um PNG 900x560 com a foto', async () => {
  const r = await cart.gerarCarteirinha({
    foto: fotoPng(), nome: 'Kannon', cargo: 'Dono', entrouEm: 1700000000000, id: '5511978819676@s.whatsapp.net',
  });
  ok(r.ok, `gerou (msg: ${r.msg || '-'})`);
  const info = pngInfo(r.buffer);
  ok(!!info, 'e um PNG de verdade (magic bytes)');
  ok(info?.w === 900 && info?.h === 560, `900x560 (veio ${info?.w}x${info?.h})`);
  ok(r.mime === 'image/png', 'o mime');
});

await test('modulo: sem nome = erro controlado (nao quebra)', async () => {
  const r = await cart.gerarCarteirinha({ nome: '' });
  ok(r.ok === false, 'recusou');
  includes(r.msg, 'Nome é obrigatório', 'a mensagem');
});

await test('modulo: sem foto usa o placeholder (nao quebra)', async () => {
  const r = await cart.gerarCarteirinha({ nome: 'Sem Foto', cargo: 'Membro' });
  ok(r.ok, 'gerou mesmo sem foto');
  ok(!!pngInfo(r.buffer), 'PNG valido');
});

await test('modulo: foto invalida cai no placeholder', async () => {
  const r = await cart.gerarCarteirinha({ foto: Buffer.from('nao e imagem'), nome: 'X' });
  ok(r.ok, 'gerou com a foto invalida (placeholder)');
});

await test('modulo: a serie e ESTAVEL por id (nao e aleatoria)', async () => {
  const a = cart.serieDe('5511978819676@s.whatsapp.net');
  const b = cart.serieDe('5511978819676@s.whatsapp.net');
  const c = cart.serieDe('5511000000000@s.whatsapp.net');
  ok(a === b, 'o mesmo id da a mesma serie');
  ok(a !== c, 'ids diferentes dao series diferentes');
  ok(/^LZ-\d{6}$/.test(a), `formato LZ-000000 (veio ${a})`);
});

await test('modulo: dataBR formata em pt-BR', async () => {
  const d = cart.dataBR(Date.UTC(2026, 0, 15, 15, 0, 0));
  ok(/15\/01\/2026/.test(d), `15/01/2026 (veio ${d})`);
});

// ============================================================================
// 2) O COMANDO (handler real)
// ============================================================================

await test('!carteirinha: manda a IMAGEM da propria pessoa', async () => {
  const g = makeGroup();
  const r = await rodar({ groupJid: g, foto: fotoPng(), de: AUTOR_LID });
  ok(!!r.imgMsg, 'mandou uma imagem');
  ok(Buffer.isBuffer(r.imgMsg?.content?.image), 'a imagem e um Buffer');
  const info = pngInfo(r.imgMsg?.content?.image);
  ok(info?.w === 900 && info?.h === 560, `o PNG e 900x560 (veio ${info?.w}x${info?.h})`);
  includes(r.imgMsg?.content?.caption, 'CARTEIRINHA', 'a legenda');
  includes(r.imgMsg?.content?.caption, 'Ana', 'o nome de quem pediu');
});

await test('!carteirinha @alvo: faz a do alvo (nome resolvido)', async () => {
  const g = makeGroup();
  const r = await rodar({ groupJid: g, mencionados: [ALVO_LID], foto: fotoPng(), de: AUTOR_LID });
  ok(!!r.imgMsg, 'mandou a imagem');
  includes(r.imgMsg?.content?.caption, 'Alvo', 'o nome do alvo (nao o LID)');
  ok(!r.imgMsg?.content?.caption.includes(ALVO_LID.split('@')[0]), 'nao mostra o LID');
});

await test('!carteirinha: sem foto de perfil ainda gera (placeholder)', async () => {
  const g = makeGroup();
  const r = await rodar({ groupJid: g, foto: null, de: AUTOR_LID });
  ok(!!r.imgMsg, 'mandou a imagem mesmo sem foto');
  ok(!!pngInfo(r.imgMsg?.content?.image), 'PNG valido');
});

await test('!carteirinha: so em grupo', async () => {
  senderCounter += 1;
  const sent = [];
  const nazu = makeNazu({ sent, groupJid: 'pv', foto: fotoPng() });
  const info = {
    key: { remoteJid: `${AUTOR_JID}`, fromMe: false, id: 'PV1', participant: AUTOR_LID },
    message: { extendedTextMessage: { text: '!carteirinha', contextInfo: {} } },
    messageTimestamp: Math.floor(Date.now() / 1000),
    pushName: 'Ana',
  };
  await handleMessage(nazu, info, null, new Map(), null);
  const txt = sent.map((s) => s.content?.text ?? '').join('\n');
  includes(txt, 'só funciona em grupos', 'recusa no privado');
});

// ============================================================================
// 3) MENU
// ============================================================================

await test('menu: !carteirinha no menumemb e no blockPv', async () => {
  const menu = fs.readFileSync(path.join(HERE, '..', 'dados/src/menus/menumemb.js'), 'utf-8');
  includes(menu, 'carteirinha', 'o comando no menumemb');
  const bp = fs.readFileSync(path.join(HERE, '..', 'dados/src/utils/blockPv.js'), 'utf-8');
  includes(bp, "'carteirinha'", 'esta no blockPv');
});

// ============================================================================

console.log('\n========================================');
const totOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log(`RESULTADO: ${RESULTS.length} testes | ${totOk} asserções ok | ${totFail} falhas`);
console.log('========================================');
process.exit(totFail > 0 ? 1 : 0);
