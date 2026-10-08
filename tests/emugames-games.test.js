/**
 * Os 13 jogos novos do EmuGames (SNES) + os 3 antigos.
 *
 * Roda o handler REAL com socket falso: cada comando de jogo chama o
 * `enviarCard`, que monta o card (capa + botão JOGAR) e envia por relayMessage.
 * Verifica também que cada jogo do catálogo tem ROM e capa no disco.
 *
 * Uso: node tests/emugames-games.test.js
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-arcade-games-'));
process.env.DATABASE_PATH = TMP_DB;
fs.mkdirSync(path.join(TMP_DB, 'grupos'), { recursive: true });

const RESULTS = [];
let CURRENT = null;
function test(name, fn) {
  CURRENT = { name, passed: 0, failed: 0, errors: [] };
  RESULTS.push(CURRENT);
  try {
    const r = fn();
    if (r && typeof r.then === 'function') return r.then(finish).catch((e) => { CURRENT.failed++; CURRENT.errors.push(`EXCEÇÃO: ${e?.stack || e}`); finish(); });
    finish();
  } catch (e) { CURRENT.failed++; CURRENT.errors.push(`EXCEÇÃO: ${e?.stack || e}`); finish(); }
  return Promise.resolve();
}
function finish() {
  console.log(`${CURRENT.failed === 0 ? '✅' : '❌'} ${CURRENT.name} (${CURRENT.passed} ok, ${CURRENT.failed} falhas)`);
  for (const e of CURRENT.errors) console.log(`   ↳ ${e}`);
}
function ok(c, m) { if (c) CURRENT.passed++; else { CURRENT.failed++; CURRENT.errors.push(`ASSERT: ${m}`); } }
const read = (rel) => fs.readFileSync(path.join(PROJECT, rel), 'utf8');

const CATALOGO = JSON.parse(read('dados/emugames/jogos.json')).jogos;

// O site (player + ROMs + capas) mora num repo proprio; o bot guarda so o
// `jogos.json`. Para os testes que olham ARQUIVO, achamos o site assim:
//   1. `EMUGAMES_SITE_DIR`;  2. clone irmao `../emugames`;  3. `dados/emugames`.
function acharSite() {
  const c = [process.env.EMUGAMES_SITE_DIR,
    path.resolve(PROJECT, '..', 'emugames'),
    path.resolve(PROJECT, 'emugames'),
    path.join(PROJECT, 'dados', 'emugames')].filter(Boolean);
  for (const x of c) if (fs.existsSync(path.join(x, 'index.html'))) return x;
  return null;
}
const SITE = acharSite();
const COMANDO_POR_ID = { topgear2: 'topgear', kof97: 'kof' };
const comandos = CATALOGO.map((j) => COMANDO_POR_ID[j.id] || j.id);

// ─────────────────────────── disco ───────────────────────────

await test('cada jogo do catálogo tem ROM e capa no disco', () => {
  if (!SITE) { console.log('\u23ed\uFE0F  (pulado: site fora do repo do bot)'); return; }
  const faltandoRom = [];
  const faltandoCapa = [];
  for (const j of CATALOGO) {
    const rom = path.join(SITE, j.rom);
    if (!fs.existsSync(rom)) faltandoRom.push(j.id);
    if (j.console === 'snes') {
      const capa = path.join(SITE, 'capas', j.capa || `${j.id}.gif`);
      if (!fs.existsSync(capa)) faltandoCapa.push(j.id);
    }
  }
  ok(faltandoRom.length === 0, `ROMs faltando: ${faltandoRom.join(', ')}`);
  ok(faltandoCapa.length === 0, `capas faltando: ${faltandoCapa.join(', ')}`);
});

await test('os 13 jogos novos do Drive estão no catálogo', () => {
  const esperados = ['marioworld', 'mariokart', 'fifa98', 'fifa97', 'gtracing', 'marvel', 'mk', 'mk2',
    'streetfighter5', 'streetfighter2turbo', 'streetfighterzero2', 'bomberman5', 'tekken2'];
  const ids = CATALOGO.map((j) => j.id);
  const faltando = esperados.filter((e) => !ids.includes(e));
  ok(faltando.length === 0, `faltando no catálogo: ${faltando.join(', ')}`);
});

await test('nomes de comando são curtos e sem colisão', () => {
  ok(new Set(comandos).size === comandos.length, 'sem comando duplicado');
  const gigantes = comandos.filter((c) => c.length > 20);
  ok(gigantes.length === 0, `comandos gigantes: ${gigantes.join(', ')}`);
  // os 3 street fighter separados
  ok(comandos.includes('streetfighter5') && comandos.includes('streetfighter2turbo') && comandos.includes('streetfighterzero2'),
    '3 street fighter separados');
});

// ─────────────────────────── handler real ───────────────────────────

const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';

let groupCounter = 0;
let authorCounter = 0;
function makeGroup() {
  groupCounter += 1;
  const g = `1203637100000${String(groupCounter).padStart(4, '0')}@g.us`;
  fs.writeFileSync(path.join(TMP_DB, 'grupos', `${g}.json`), JSON.stringify({ groupName: 'GP Emu' }, null, 2));
  return g;
}

function makeNazu(groupJid) {
  const relayed = [];
  return {
    relayed,
    sendMessage: async () => ({ key: { id: 'S' } }),
    relayMessage: async (jid, message, opts) => { relayed.push({ jid, message, opts }); return {}; },
    waUploadToServer: async () => ({}),
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
    onWhatsApp: async () => [],
    signalRepository: { lidMapping: { getPNForLID: async () => null } },
    groupMetadata: async () => ({ id: groupJid, subject: 'GP Emu', participants: [{ id: BOT_LID, admin: 'admin', phoneNumber: BOT_JID }] }),
    groupParticipantsUpdate: async () => ({}),
    groupRequestParticipantsList: async () => [],
    groupRequestParticipantsUpdate: async () => ({}),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {},
    sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => 'https://example.com/p.jpg',
    react: async () => ({}),
  };
}

async function run(command) {
  const groupJid = makeGroup();
  const nazu = makeNazu(groupJid);
  authorCounter += 1;
  const authorLid = `66${String(authorCounter).padStart(6, '0')}555@lid`;
  const info = {
    key: { remoteJid: groupJid, fromMe: false, id: `G-${command}-${authorCounter}`, participant: authorLid },
    message: { extendedTextMessage: { text: `!${command}`, contextInfo: { remoteJid: groupJid } } },
    messageTimestamp: 1757900000,
    pushName: 'Autor',
  };
  await handleMessage(nazu, info, null, new Map(), null);
  return nazu.relayed;
}

await test('cada comando de jogo envia UM card (relayMessage) com botão JOGAR', async () => {
  const falhas = [];
  for (const cmd of comandos) {
    const relayed = await run(cmd);
    if (relayed.length !== 1) { falhas.push(`${cmd}:${relayed.length} envios`); continue; }
    const msg = relayed[0].message || {};
    const inter = msg.interactiveMessage || {};
    const temBotao = JSON.stringify(inter).includes('JOGAR') || JSON.stringify(inter).includes('cta_url');
    if (!temBotao) falhas.push(`${cmd}:sem botão`);
  }
  ok(falhas.length === 0, `cards com problema: ${falhas.join(' | ')}`);
});

await test('o card aponta para o id correto do jogo (URL ?jogo=<id>)', async () => {
  // marioworld e mk2: o card deve referenciar o id do catálogo na URL do webview.
  for (const [cmd, id] of [['marioworld', 'marioworld'], ['mk2', 'mk2'], ['kof', 'kof97'], ['topgear', 'topgear2']]) {
    const relayed = await run(cmd);
    const blob = JSON.stringify(relayed[0]?.message || {});
    ok(blob.includes(`?jogo=${id}`), `${cmd} -> ?jogo=${id}`);
  }
});

// ─────────────────────────── resumo ───────────────────────────

console.log('\n' + '─'.repeat(60));
let passed = 0, failed = 0;
for (const r of RESULTS) { passed += r.passed; failed += r.failed; }
console.log(`Total: ${RESULTS.length} testes / ${passed} asserções ok, ${failed} falhas`);
process.exit(failed === 0 ? 0 : 1);
