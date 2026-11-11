/**
 * !modotake — assinatura automática nas figurinhas.
 *
 * Toggle por grupo: ativado, TODA figurinha enviada é reenviada com a
 * assinatura do `!take` de QUEM ENVIOU (author/pack do `take.json`, com queda
 * para o nick do contato). Só adm liga/desliga; a automação vale para todos.
 *
 * O teste roda o HANDLER REAL com socket falso e figurinha cifrada de verdade
 * (hkdf + AES-256-CBC, servida por HTTP local) — então o `getFileBuffer`
 * percorre o caminho real de download.
 *
 * Uso: node tests/modotake.test.js
 */

import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import { proto, hkdf, MEDIA_HKDF_KEY_MAPPING } from '@itsliaaa/baileys';
import webpmux from 'node-webpmux';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(HERE, '..');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-modotake-'));
process.env.DATABASE_PATH = TMP;
process.env.CONFIG_PATH = path.join(TMP, 'config.json');
const GRUPOS = path.join(TMP, 'grupos');
const USERS = path.join(TMP, 'users');
fs.mkdirSync(GRUPOS, { recursive: true });
fs.mkdirSync(USERS, { recursive: true });
fs.writeFileSync(process.env.CONFIG_PATH, JSON.stringify({
  nomebot: 'Lizzy', prefixo: '!', numerodono: '5599999999999', nomedono: 'Dono'
}));

const RESULTS = []; let CURRENT = null;
function test(n, fn) { CURRENT = { n, p: 0, f: 0, e: [] }; RESULTS.push(CURRENT);
  try { const r = fn(); if (r?.then) return r.then(() => fin()).catch((e) => { CURRENT.f++; CURRENT.e.push('EXC: ' + (e?.stack || e)); fin(); }); fin(); }
  catch (e) { CURRENT.f++; CURRENT.e.push('EXC: ' + (e?.stack || e)); fin(); } return Promise.resolve(); }
function fin() { console.log(`${CURRENT.f === 0 ? '✅' : '❌'} ${CURRENT.n} (${CURRENT.p} ok, ${CURRENT.f} falhas)`); for (const x of CURRENT.e) console.log('     ' + x.split('\n')[0]); }
function ok(c, m) { if (c) CURRENT.p++; else { CURRENT.f++; CURRENT.e.push('ASSERT: ' + m); } }
function contem(h, n, m) { ok(typeof h === 'string' && h.includes(n), `${m || n} — esperado "${n}"`); }

// ── Mídia cifrada de verdade (o mesmo formato do WhatsApp) ───────────────────
const mkMediaKey = () => crypto.randomBytes(32);

/** Sobe um servidor local que devolve a figurinha CIFRADA. */
async function subirMidia(plain) {
  // MESMA derivação que a fork usa para decifrar: a chave sai do `hkdf` da
  // mediaKey (112 bytes) — o IV e a chave do AES vêm dos primeiros bytes
  // expandidos, e o MAC é o hkdf do ciphertext com esse IV como salt. Cifrar
  // com a mediaKey crua (IV aleatório) dá "bad decrypt" no download real.
  const key = mkMediaKey();
  const info = `WhatsApp ${MEDIA_HKDF_KEY_MAPPING.sticker} Keys`;
  const expanded = Buffer.from(hkdf(key, 112, { info }));
  const iv = expanded.subarray(0, 16);
  const cipherKey = expanded.subarray(16, 48);
  const cipher = crypto.createCipheriv('aes-256-cbc', cipherKey, iv);
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const mac = hkdf(enc, 32, { info, salt: iv });
  const file = Buffer.concat([enc, mac.subarray(0, 10)]);
  const srv = http.createServer((_, res) => { res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); res.end(file); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${srv.address().port}/s.webp`,
    mediaKey: key, fileSha256: crypto.randomBytes(32), fileEncSha256: crypto.randomBytes(32),
    fileLength: file.length, length: file.length,
    fechar: () => new Promise((r) => srv.close(r)),
  };
}


/** Lê author/pack de DENTRO do webp (o `sendSticker` grava no EXIF, não no content). */
async function lerAssinatura(buffer) {
  const img = new webpmux.Image();
  await img.load(buffer);
  if (!img.exif) return { author: null, pack: null };
  const txt = img.exif.toString('utf-8');
  const j = JSON.parse(txt.slice(txt.indexOf('{')));
  return { author: j['sticker-pack-publisher'] || '', pack: j['sticker-pack-name'] || '' };
}

const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), crypto.randomBytes(64)]);

const mod = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handle = mod.default ?? mod;

const BOT_LID = '111111111111111@lid';
let gc = 0;

function makeGroup(flags = {}) {
  gc += 1;
  const jid = `1203639000000000${String(gc).padStart(3, '0')}@g.us`;
  fs.writeFileSync(path.join(GRUPOS, `${jid}.json`), JSON.stringify({ modobrincadeira: true, groupName: 'G', ...flags }, null, 2));
  return jid;
}

/** Socket falso. Guarda o que foi enviado e o que foi convertido. */
function makeNazu({ sent, groupJid, sender, comoAdmin }) {
  return {
    sendMessage: async (jid, content, options) => {
      sent.push({ jid, content, options });
      return { key: { id: `S-${sent.length}` } };
    },
    user: { id: '5599999999999:5@s.whatsapp.net', lid: BOT_LID, name: 'Lizzy' },
    getName: async () => 'Nick do Contato',
    onWhatsApp: async (j) => [{ jid: j, exists: true }],
    signalRepository: { lidMapping: { getPNForLID: async () => null } },
    groupMetadata: async () => ({
      id: groupJid, subject: 'G',
      participants: [
        { id: BOT_LID, lid: BOT_LID, phoneNumber: '5599999999999@s.whatsapp.net', admin: 'admin' },
        { id: sender, lid: sender, phoneNumber: '5511999999997@s.whatsapp.net', admin: comoAdmin ? 'admin' : null },
      ],
    }),
    groupParticipantsUpdate: async () => ({}),
    groupRequestParticipantsList: async () => [],
    groupRequestParticipantsUpdate: async () => ({}),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {}, sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => 'x', react: async () => ({}),
  };
}

let senderN = 0;
function novoLid() { senderN += 1; return `22200000${String(senderN).padStart(5, '0')}@lid`; }

/** Roda uma mensagem pelo handler. */
async function rodar({ groupJid, sender, text, sticker, admin = true }) {
  const sent = [];
  const nazu = makeNazu({ sent, groupJid, sender, comoAdmin: admin });
  const msg = sticker
    ? { stickerMessage: sticker }
    : { extendedTextMessage: { text, contextInfo: { remoteJid: groupJid } } };
  await handle(nazu, {
    key: { remoteJid: groupJid, fromMe: false, id: `M-${Math.random().toString(36).slice(2, 9)}`, participant: sender },
    message: msg, messageTimestamp: 1757900000, pushName: 'Tester',
  }, null, new Map(), null);
  const texto = sent.map((s) => s.content?.text ?? s.content?.caption ?? '').filter(Boolean).join('\n');
  return { sent, texto };
}

const salvarTake = (jid, dados) => fs.writeFileSync(path.join(USERS, 'take.json'), JSON.stringify({ [jid]: dados }, null, 2));

// ── 1) O TOGGLE ──────────────────────────────────────────────────────────────

await test('1. !modotake liga e desliga (adm)', async () => {
  const g = makeGroup();
  const s = novoLid();
  const on = await rodar({ groupJid: g, sender: s, text: '!modotake' });
  contem(on.texto, 'ativado', 'avisa que ativou');
  ok(JSON.parse(fs.readFileSync(path.join(GRUPOS, `${g}.json`))).modotake === true, 'gravou true no grupo');
  const off = await rodar({ groupJid: g, sender: s, text: '!modotake' });
  contem(off.texto, 'desativado', 'avisa que desativou');
  ok(JSON.parse(fs.readFileSync(path.join(GRUPOS, `${g}.json`))).modotake === false, 'gravou false');
});

await test('2. membro comum NÃO liga o modo', async () => {
  const g = makeGroup();
  const s = novoLid();
  const r = await rodar({ groupJid: g, sender: s, text: '!modotake', admin: false });
  contem(r.texto, 'adm', 'recusa por permissão');
  ok(!JSON.parse(fs.readFileSync(path.join(GRUPOS, `${g}.json`))).modotake, 'não gravou nada');
});

// ── 2) A AUTOMAÇÃO ───────────────────────────────────────────────────────────

await test('3. figurinha enviada é reenviada com a assinatura do autor', async () => {
  const g = makeGroup({ modotake: true });
  const autor = novoLid();
  salvarTake(autor, { author: 'Autor Teste', pack: 'Pack Teste' });

  const midia = await subirMidia(WEBP);
  const { sent } = await rodar({
    groupJid: g, sender: autor,
    sticker: { url: midia.url, mediaKey: midia.mediaKey, fileSha256: midia.fileSha256, fileEncSha256: midia.fileEncSha256, fileLength: midia.length, mimetype: 'image/webp', isAnimated: false },
  });
  await midia.fechar();

  const figurinha = sent.find((s) => s.content?.sticker);
  ok(!!figurinha, 'reenviou a figurinha');
  const ass = await lerAssinatura(figurinha.content.sticker);
  ok(ass.author === 'Autor Teste', `author = "Autor Teste" (veio "${ass.author}")`);
  ok(ass.pack === 'Pack Teste', `packname = "Pack Teste" (veio "${ass.pack}")`);
  ok(!!figurinha.content.sticker, 'enviou um webp');
  ok(figurinha.options?.quoted, 'responde a figurinha original');
});

await test('4. modo DESLIGADO não mexe em nada', async () => {
  const g = makeGroup({ modotake: false });
  const autor = novoLid();
  salvarTake(autor, { author: 'A', pack: 'P' });
  const midia = await subirMidia(WEBP);
  const { sent } = await rodar({
    groupJid: g, sender: autor,
    sticker: { url: midia.url, mediaKey: midia.mediaKey, fileSha256: midia.fileSha256, fileEncSha256: midia.fileEncSha256, fileLength: midia.length, mimetype: 'image/webp' },
  });
  await midia.fechar();
  ok(!sent.find((s) => s.content?.sticker), 'não reenviou nada');
});

await test('5. sem take configurado, cai no NICK do contato', async () => {
  const g = makeGroup({ modotake: true });
  const autor = novoLid();
  fs.writeFileSync(path.join(USERS, 'take.json'), JSON.stringify({}, null, 2));
  const midia = await subirMidia(WEBP);
  const { sent } = await rodar({
    groupJid: g, sender: autor,
    sticker: { url: midia.url, mediaKey: midia.mediaKey, fileSha256: midia.fileSha256, fileEncSha256: midia.fileEncSha256, fileLength: midia.length, mimetype: 'image/webp' },
  });
  await midia.fechar();
  const figurinha = sent.find((s) => s.content?.sticker);
  ok(!!figurinha, 'reenviou');
  const ass = await lerAssinatura(figurinha.content.sticker);
  ok(ass.pack === 'Nick do Contato', `pack = nick (veio "${ass.pack}")`);
});

await test('6. figurinha ANIMADA também é reenviada (webp, sem ffmpeg)', async () => {
  // O decoder de WebP do ffmpeg IGNORA os chunks ANIM/ANMF (0 frames), então o
  // caminho `type: 'video'` quebraria uma figurinha animada. O handler manda
  // SEMPRE como imagem — e como ela JÁ é webp, o `sendSticker` devolve o buffer
  // direto (sem ffmpeg). Este teste roda sem ffmpeg no PATH e exige que funcione.
  const g = makeGroup({ modotake: true });
  const autor = novoLid();
  salvarTake(autor, { author: 'A', pack: 'P' });
  const midia = await subirMidia(WEBP);
  const { sent } = await rodar({
    groupJid: g, sender: autor,
    sticker: { url: midia.url, mediaKey: midia.mediaKey, fileSha256: midia.fileSha256, fileEncSha256: midia.fileEncSha256, fileLength: midia.length, mimetype: 'image/webp', isAnimated: true },
  });
  await midia.fechar();
  const figurinha = sent.find((s) => s.content?.sticker);
  ok(!!figurinha, 'reenviou');
  const ass = await lerAssinatura(figurinha.content.sticker);
  ok(ass.pack === 'P', `assinatura aplicada (veio "${ass.pack}")`);
});

await test('7. mensagem de TEXTO não é afetada', async () => {
  const g = makeGroup({ modotake: true });
  const s = novoLid();
  const { sent } = await rodar({ groupJid: g, sender: s, text: 'bom dia pessoal' });
  ok(!sent.find((x) => x.content?.sticker), 'não reenviou figurinha de um texto');
});

await test('8. mensagem própria do bot é ignorada', async () => {
  const g = makeGroup({ modotake: true });
  const autor = novoLid();
  salvarTake(autor, { author: 'A', pack: 'P' });
  const midia = await subirMidia(WEBP);
  const sent = [];
  const nazu = makeNazu({ sent, groupJid: g, sender: autor, comoAdmin: true });
  await handle(nazu, {
    key: { remoteJid: g, fromMe: true, id: 'MF', participant: autor },
    message: { stickerMessage: { url: midia.url, mediaKey: midia.mediaKey, fileSha256: midia.fileSha256, fileEncSha256: midia.fileEncSha256, fileLength: midia.length, mimetype: 'image/webp' } },
    messageTimestamp: 1757900000, pushName: 'Tester',
  }, null, new Map(), null);
  await midia.fechar();
  ok(!sent.find((s) => s.content?.sticker), 'não reprocessa o que o próprio bot mandou');
});

await test('9. a assinatura é de QUEM ENVIOU, não de quem ligou o modo', async () => {
  const g = makeGroup({ modotake: true });
  const adminQueLigou = novoLid();
  const quemEnviou = novoLid();
  salvarTake(adminQueLigou, { author: 'ADMIN', pack: 'ADMIN' });
  salvarTake(quemEnviou, { author: 'ENVIOU', pack: 'ENVIOU' });
  const midia = await subirMidia(WEBP);
  const { sent } = await rodar({
    groupJid: g, sender: quemEnviou,
    sticker: { url: midia.url, mediaKey: midia.mediaKey, fileSha256: midia.fileSha256, fileEncSha256: midia.fileEncSha256, fileLength: midia.length, mimetype: 'image/webp' },
  });
  await midia.fechar();
  const figurinha = sent.find((s) => s.content?.sticker);
  ok(!!figurinha, 'reenviou');
  const ass = await lerAssinatura(figurinha.content.sticker);
  ok(ass.author === 'ENVIOU', `usa o take de quem enviou (veio "${ass.author}")`);
});

// ── 3) Menu ──────────────────────────────────────────────────────────────────

await test('10. está no menuadm (MODOS & ATIVAÇÕES) e no blockPv', () => {
  const menu = fs.readFileSync(path.join(RAIZ, 'dados', 'src', 'menus', 'menuadm.js'), 'utf-8');
  ok(menu.includes('modotake'), 'menuadm lista o comando');
  const i = menu.indexOf('MODOS & ATIVA');
  ok(i > 0 && menu.indexOf('modotake') > i, 'está na categoria MODOS & ATIVAÇÕES');
  const bp = fs.readFileSync(path.join(RAIZ, 'dados', 'src', 'utils', 'blockPv.js'), 'utf-8');
  ok(/'modotake'/.test(bp), 'blockPv registra o comando');
});

console.log('════════════════════════════════════════');
const tOk = RESULTS.reduce((a, r) => a + r.p, 0), tF = RESULTS.reduce((a, r) => a + r.f, 0);
console.log(`RESULTADO: ${RESULTS.length} testes | ${tOk} asserções ok | ${tF} falhas`);
console.log('════════════════════════════════════════');
fs.rmSync(TMP, { recursive: true, force: true });
if (tF > 0) { console.log('\nFALHAS:'); for (const r of RESULTS) if (r.f) for (const e of r.e) console.log(`- [${r.n}] ${e}`); process.exit(1); }
console.log('✅ TODOS OS TESTES PASSARAM'); process.exit(0);
