/**
 * SALAS DE ARCADE (multiplayer) — convite + aceite.
 *
 * Roda o handler REAL com socket falso:
 *   - `!kof @fulano` manda o CONVITE (layout + mencoes), nao o card solo;
 *   - responder `sim` cria a sala e manda os DOIS links (host + convidado);
 *   - `nao` recusa;
 *   - `sim` sem convite NAO e tratado (segue o fluxo normal);
 *   - sem `EMUGAMES_NETPLAY_URL` o convite e recusado com aviso.
 *
 * Uso: node tests/arcade-room.test.js
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-arcade-room-'));
process.env.DATABASE_PATH = TMP_DB;
fs.mkdirSync(path.join(TMP_DB, 'grupos'), { recursive: true });
process.env.EMUGAMES_NETPLAY_URL = 'https://netplay.exemplo.com';
process.env.TOPGEAR_PUBLIC_URL = 'https://emugames.exemplo.com';

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
function desbold(s) {
  return String(s)
    .replace(/[\u{1D400}-\u{1D433}]/gu, (c) => String.fromCharCode(65 + (c.codePointAt(0) - 0x1D400)))
    .replace(/[\u{1D7CE}-\u{1D7FF}]/gu, (c) => String.fromCharCode(48 + (c.codePointAt(0) - 0x1D7CE)))
    .replace(/[\u{1D468}-\u{1D49B}]/gu, (c) => String.fromCharCode(65 + (c.codePointAt(0) - 0x1D468)))
    .replace(/[\u{1D7CE}-\u{1D7FF}]/gu, (c) => String.fromCharCode(48 + (c.codePointAt(0) - 0x1D7CE)));
}

const arcadeRooms = await import(new URL('../dados/src/utils/arcadeRooms.js', import.meta.url).href);
const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';
// Um par NOVO de lids a cada teste: o handler tem throttle de 3 comandos/5s por
// remetente, e reusar o mesmo anfitriao mediria o rate limit em vez do comando.
let parN = 0;
function novoPar() {
  parN += 1;
  const n = String(parN).padStart(3, '0');
  return { anf: `1110000000${n}01@lid`, conv: `1110000000${n}02@lid` };
}

let g = 0, a = 0, u = 0;
function makeGroup() {
  g += 1;
  const jid = `1203637500000${String(g).padStart(4, '0')}@g.us`;
  fs.writeFileSync(path.join(TMP_DB, 'grupos', `${jid}.json`), JSON.stringify({ groupName: 'GP Arcade' }, null, 2));
  return jid;
}
function makeNazu(groupJid, P) {
  const sent = [];
  return {
    sent,
    sendMessage: async (jid, content, options) => { sent.push({ jid, content, options }); return { key: { id: 'SENT' } }; },
    relayMessage: async () => ({}),
    waUploadToServer: async () => ({}),
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
    onWhatsApp: async () => [],
    signalRepository: { lidMapping: { getPNForLID: async () => null } },
    groupMetadata: async () => ({
      id: groupJid, subject: 'GP Arcade',
      participants: [
        { id: P.anf, admin: 'admin', phoneNumber: '5511000000901@s.whatsapp.net' },
        { id: P.conv, admin: null, phoneNumber: '5511000000902@s.whatsapp.net' },
        { id: BOT_LID, admin: 'admin', phoneNumber: BOT_JID },
      ],
    }),
    groupParticipantsUpdate: async () => ({}),
    groupRequestParticipantsList: async () => [],
    groupRequestParticipantsUpdate: async () => ({}),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {}, sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => 'https://x/p.jpg', react: async () => ({}),
  };
}

/** Executa uma mensagem (comando ou texto) no handler real. */
async function run({ grupo, texto, autorLid, mencionados = [], citado = null, isCmd, P }) {
  // remetente unico por execucao: o handler tem throttle de 3 comandos/5s por
  // sender, entao reusar mediria o rate limit em vez do comando.
  const nazu = makeNazu(grupo, P);
  a += 1;
  const autor = autorLid || `77${String(a).padStart(6, '0')}333@lid`;
  const ctx = { remoteJid: grupo };
  if (mencionados.length) ctx.mentionedJid = mencionados;
  if (citado) ctx.quotedMessage = citado;
  const msg = isCmd
    ? { extendedTextMessage: { text: texto, contextInfo: ctx } }
    : { extendedTextMessage: { text: texto, contextInfo: ctx } };
  const info = {
    key: { remoteJid: grupo, fromMe: false, id: `M-${a}`, participant: autor },
    message: msg, messageTimestamp: 1757900000, pushName: 'Autor',
  };
  await handleMessage(nazu, info, null, new Map(), null);
  const all = nazu.sent.map((s) => s.content?.text ?? s.content?.caption ?? '').filter(Boolean).join('\n');
  const mencoes = nazu.sent.flatMap((s) => s.content?.mentions || []);
  return { text: all, sent: nazu.sent, mencoes };
}

// ─────────────────────────── convite ───────────────────────────

await test('!kof @fulano manda o CONVITE (nao o card solo)', async () => {
  arcadeRooms.limparTudo();
  const P = novoPar();
  const grupo = makeGroup();
  const r = await run({ grupo, texto: '!kof', autorLid: P.anf, mencionados: [P.conv], isCmd: true });
  const t = desbold(r.text);
  ok(t.includes('SALA DE ARCADE'), 'tem o titulo da sala');
  ok(t.includes('responda *sim*') && t.includes('responda *nao*'), 'explica sim/nao');
  ok(t.includes('The King of Fighters') || t.includes("'97"), 'cita o jogo');
  ok(r.mencoes.includes(P.anf) && r.mencoes.includes(P.conv), 'menciona os dois');
  ok(r.sent.length === 1, 'uma mensagem (convite), nao o card');
});

await test('o convite fica pendente para o convidado', async () => {
  arcadeRooms.limparTudo();
  const P = novoPar();
  const grupo = makeGroup();
  await run({ grupo, texto: '!kof', autorLid: P.anf, mencionados: [P.conv], isCmd: true });
  const c = arcadeRooms.convitePendente(grupo, P.conv);
  ok(c && c.jogoId === 'kof97', 'convite gravado com o jogo certo');
  ok(arcadeRooms.mesmoUsuario(c.convidado, P.conv), 'convidado correto');
});

await test('sem URL e SEM porta publicada o convite e recusado com aviso', async () => {
  arcadeRooms.limparTudo();
  const P = novoPar();
  const salvo = {
    url: process.env.EMUGAMES_NETPLAY_URL,
    w1: process.env.WORKER_1,
    w2: process.env.WORKER_2,
    rid: process.env.RUNTIME_ID,
    ru: process.env.RUNTIME_URL,
    hn: process.env.HOSTNAME,
  };
  // Sem URL e sem porta publicada a deteccao automatica nao tem o que usar ->
  // a sala fica indisponivel (comportamento correto).
  delete process.env.EMUGAMES_NETPLAY_URL;
  delete process.env.WORKER_1;
  delete process.env.WORKER_2;
  delete process.env.RUNTIME_ID;
  delete process.env.RUNTIME_URL;
  delete process.env.HOSTNAME;
  try {
    const grupo = makeGroup();
    const r = await run({ grupo, texto: '!kof', autorLid: P.anf, mencionados: [P.conv], isCmd: true });
    ok(desbold(r.text).includes('indisponível'), 'avisa que a sala esta indisponivel');
    ok(desbold(r.text).includes('EMUGAMES_NETPLAY_URL'), 'diz qual env configurar');
    ok(!arcadeRooms.convitePendente(grupo, P.conv), 'nao cria convite');
  } finally {
    if (salvo.url !== undefined) process.env.EMUGAMES_NETPLAY_URL = salvo.url;
    if (salvo.w1 !== undefined) process.env.WORKER_1 = salvo.w1;
    if (salvo.w2 !== undefined) process.env.WORKER_2 = salvo.w2;
    if (salvo.rid !== undefined) process.env.RUNTIME_ID = salvo.rid;
    if (salvo.ru !== undefined) process.env.RUNTIME_URL = salvo.ru;
    if (salvo.hn !== undefined) process.env.HOSTNAME = salvo.hn;
  }
});

await test('com porta publicada o convite sai SEM configurar nada', async () => {
  arcadeRooms.limparTudo();
  const P = novoPar();
  const salvo = { url: process.env.EMUGAMES_NETPLAY_URL, w1: process.env.WORKER_1, ru: process.env.RUNTIME_URL };
  delete process.env.EMUGAMES_NETPLAY_URL;
  process.env.WORKER_1 = '12000';
  process.env.RUNTIME_URL = 'https://abc.prod-runtime.all-hands.dev';
  try {
    const grupo = makeGroup();
    const r = await run({ grupo, texto: '!kof', autorLid: P.anf, mencionados: [P.conv], isCmd: true });
    ok(desbold(r.text).includes('SALA DE ARCADE'), 'convite sai sem configuracao manual');
    ok(arcadeRooms.convitePendente(grupo, P.conv), 'convite gravado');
  } finally {
    if (salvo.url !== undefined) process.env.EMUGAMES_NETPLAY_URL = salvo.url;
    if (salvo.w1 !== undefined) process.env.WORKER_1 = salvo.w1; else delete process.env.WORKER_1;
    if (salvo.ru !== undefined) process.env.RUNTIME_URL = salvo.ru; else delete process.env.RUNTIME_URL;
  }
});

await test('!kof sem mencionar ninguem manda o card solo', async () => {
  arcadeRooms.limparTudo();
  const P = novoPar();
  const grupo = makeGroup();
  const r = await run({ grupo, texto: '!kof', autorLid: P.anf, isCmd: true });
  // o card vai por relayMessage; aqui so garantimos que NAO veio convite
  ok(!desbold(r.text).includes('SALA DE ARCADE'), 'nao e convite');
});

// ─────────────────────────── aceite ───────────────────────────

await test('responder "sim" cria a sala e manda os DOIS links', async () => {
  arcadeRooms.limparTudo();
  const P = novoPar();
  const grupo = makeGroup();
  await run({ grupo, texto: '!kof', autorLid: P.anf, mencionados: [P.conv], isCmd: true });
  const r = await run({ grupo, texto: 'sim', autorLid: P.conv, isCmd: false });
  const t = desbold(r.text);
  ok(t.includes('SALA CRIADA') || t.includes('SALA DE ARCADE'), 'caixa de sala criada');
  ok(t.includes('Código:') || t.includes('Codigo:'), 'mostra o codigo');
  ok(t.includes('host=1'), 'link do anfitriao tem host=1');
  ok(t.includes('sala='), 'link tem o codigo da sala');
  // O link leva a URL do servidor da sala (`?netplay=`), porque o site mora no
  // Cloudflare e o servidor sobe no host do bot.
  ok(t.includes('netplay=https') || t.includes('netplay=http'), 'link aponta o servidor de netplay');
  const links = r.text.match(/https?:\/\/[^\s]+/g) || [];
  ok(links.length >= 2, `dois links (obtido ${links.length})`);
  ok(!arcadeRooms.convitePendente(grupo, P.conv), 'convite consumido');
});

await test('o codigo da sala existe no modulo (estaNaSala)', async () => {
  arcadeRooms.limparTudo();
  const P = novoPar();
  const grupo = makeGroup();
  await run({ grupo, texto: '!kof', autorLid: P.anf, mencionados: [P.conv], isCmd: true });
  const r = await run({ grupo, texto: 'sim', autorLid: P.conv, isCmd: false });
  const m = desbold(r.text).match(/C[oó]digo:\s*([A-Z0-9]{6})/);
  ok(m, 'codigo no texto');
  const sala = arcadeRooms.buscarSala(grupo, m[1]);
  ok(sala, 'sala encontrada pelo codigo');
  ok(arcadeRooms.estaNaSala(sala, P.anf) && arcadeRooms.estaNaSala(sala, P.conv), 'os dois estao na sala');
});

await test('responder "nao" recusa (sem criar sala)', async () => {
  arcadeRooms.limparTudo();
  const P = novoPar();
  const grupo = makeGroup();
  await run({ grupo, texto: '!kof', autorLid: P.anf, mencionados: [P.conv], isCmd: true });
  const r = await run({ grupo, texto: 'nao', autorLid: P.conv, isCmd: false });
  ok(desbold(r.text).includes('recusou'), 'avisa a recusa');
  ok(!desbold(r.text).includes('SALA CRIADA'), 'nao cria sala');
  ok(!arcadeRooms.convitePendente(grupo, P.conv), 'convite consumido');
});

await test('"sim" de quem NAO foi convidado nao e tratado', async () => {
  arcadeRooms.limparTudo();
  const P = novoPar();
  const grupo = makeGroup();
  await run({ grupo, texto: '!kof', autorLid: P.anf, mencionados: [P.conv], isCmd: true });
  const outro = '999000000000999@lid';
  const r = await run({ grupo, texto: 'sim', autorLid: outro, isCmd: false });
  ok(!desbold(r.text).includes('SALA CRIADA'), 'nao cria sala para terceiro');
  ok(arcadeRooms.convitePendente(grupo, P.conv), 'convite do convidado segue pendente');
});

await test('convite expira em 5 min', () => {
  arcadeRooms.limparTudo();
  const jogo = { id: 'kof97', nome: 'KOF 97' };
  const agora = 1_000_000;
  arcadeRooms.criarConvite({ grupo: 'gX', anfitriao: 'a@lid', convidado: 'b@lid', jogo, agora });
  ok(arcadeRooms.convitePendente('gX', 'b@lid', agora + 60_000), 'vale depois de 1 min');
  ok(!arcadeRooms.convitePendente('gX', 'b@lid', agora + 6 * 60_000), 'expira depois de 5 min');
});

// ─────────────────────────── player (sala) ───────────────────────────

await test('o player tem o modo sala (netplay) e nao fecha no X', () => {
  const html = read('dados/emugames/index.html');
  ok(html.includes('EJS_EXPERIMENTAL_NETPLAY'), 'liga o netplay (flag experimental)');
  ok(html.includes('EJS_netplayServer'), 'aponta o servidor de netplay');
  ok(html.includes('EJS_ready'), 'usa o hook de pronto para entrar na sala');
  ok(/openRoom\(/.test(html) && /joinRoom\(/.test(html), 'cria/entra na sala automaticamente');
  ok(/exitEmulation:\s*!EM_SALA/.test(html), 'sem botao de fechar em modo sala');
  ok(/if \(EM_SALA\) return;/.test(html), 'modo sala NAO desliga ao sair da aba (so inatividade)');
  ok(html.includes("'desligado por inatividade"), 'inatividade continua fechando (3 min)');
});

await test('a inatividade de 3 min continua valendo', () => {
  const html = read('dados/emugames/index.html');
  ok(/INATIVIDADE_MS\s*=\s*3 \* 60 \* 1000/.test(html), '3 minutos');
  ok(/Date\.now\(\) - ocioso < LIMITE/.test(html), 'fecha quando passa o limite');
});

// ─────────────────────────── resumo ───────────────────────────

console.log('\n' + '─'.repeat(60));
let passed = 0, failed = 0;
for (const r of RESULTS) { passed += r.passed; failed += r.failed; }
console.log(`Total: ${RESULTS.length} testes / ${passed} asserções ok, ${failed} falhas`);
process.exit(failed === 0 ? 0 : 1);
