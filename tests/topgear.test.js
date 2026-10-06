/**
 * !topgear — experiência Rich/Web (webview) experimental.
 *
 * Valida: servidor estático (HTML/JS/WASM), WASM executando, proteção contra
 * path traversal, e o handler real gerando o interactiveMessage com o botão
 * cta_url (webview_interaction: true) via relayMessage.
 *
 * Uso: node tests/topgear.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-tg-db-'));
process.env.DATABASE_PATH = TMP_DB;
process.env.TOPGEAR_PORT = '0';
fs.mkdirSync(path.join(TMP_DB, 'grupos'), { recursive: true });

const RESULTS = [];
let CURRENT = null;

function test(name, fn) {
  CURRENT = { name, passed: 0, failed: 0, errors: [] };
  RESULTS.push(CURRENT);
  return Promise.resolve()
    .then(fn)
    .catch((error) => {
      CURRENT.failed += 1;
      CURRENT.errors.push(`EXCEÇÃO: ${error?.stack || error}`);
    })
    .then(() => {
      console.log(`${CURRENT.failed === 0 ? '✅' : '❌'} ${name} (${CURRENT.passed} ok, ${CURRENT.failed} falhas)`);
      for (const err of CURRENT.errors) console.log(`     ${err.split('\n')[0]}`);
    });
}

function ok(cond, msg) {
  if (cond) CURRENT.passed += 1;
  else {
    CURRENT.failed += 1;
    CURRENT.errors.push(`ASSERT FALHOU: ${msg}`);
  }
}

const handleMessage = (await import(new URL('../dados/src/index.js', import.meta.url).href)).default;
const server = (await import(new URL('../dados/src/topgear/server.js', import.meta.url).href)).default;

const G = '120363826666666601@g.us';
fs.writeFileSync(path.join(TMP_DB, 'grupos', `${G}.json`), JSON.stringify({ modobrincadeira: true }, null, 2));

let relayed = null;
const sent = [];

function makeNazu() {
  return {
    sendMessage: async (jid, content) => { sent.push(content); return { key: { id: 'S' } }; },
    relayMessage: async (jid, message, opts) => { relayed = { jid, message, opts }; return 'ok'; },
    user: { id: '5599999999999:5@s.whatsapp.net', lid: '111111111111111@lid' },
    onWhatsApp: async (j) => [{ jid: j, exists: true }],
    signalRepository: { lidMapping: { getPNForLID: async () => null } },
    groupMetadata: async () => ({ id: G, participants: [{ id: '555000000000@lid', admin: 'admin', phoneNumber: '555000000000@s.whatsapp.net' }] }),
    groupParticipantsUpdate: async () => ({}),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {}, sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => null, react: async () => ({}),
    waUploadToServer: async () => ({})
  };
}

async function rodar(texto, { fromMe = true } = {}) {
  sent.length = 0;
  relayed = null;
  await handleMessage(makeNazu(), {
    key: { remoteJid: G, fromMe, id: `TG-${Math.random()}`, participant: '555000000000@lid' },
    message: { extendedTextMessage: { text: texto, contextInfo: { remoteJid: G } } },
    messageTimestamp: 1757900000, pushName: 'A'
  }, null, new Map(), null);
  return sent.map((s) => s.text || s.caption || '').filter(Boolean).join('\n');
}

const port = await server.iniciar();
const base = `http://localhost:${port}`;

await test('servidor: serve HTML, JS e WASM com os content-types certos', async () => {
  for (const [rota, tipo] of [['/index.html', 'text/html'], ['/style.css', 'text/css'], ['/app.js', 'text/javascript'], ['/engine/emulator.wasm', 'application/wasm']]) {
    const res = await fetch(base + rota);
    ok(res.status === 200, `${rota} responde 200 (veio ${res.status})`);
    ok((res.headers.get('content-type') || '').includes(tipo), `${rota} tem content-type ${tipo}`);
  }
});

await test('WASM: a engine carrega e executa de verdade', async () => {
  const res = await fetch(base + '/engine/emulator.wasm');
  const bytes = await res.arrayBuffer();
  const { instance } = await WebAssembly.instantiate(bytes, {});
  ok(instance.exports.seed() === 42, 'seed() responde 42');
  ok(instance.exports.frames() >= 0, 'frames() responde um número');
});

await test('servidor: bloqueia path traversal', async () => {
  for (const rota of ['/../../etc/passwd', '/%2e%2e/%2e%2e/etc/passwd', '/engine/../../../etc/passwd']) {
    const res = await fetch(base + rota);
    ok(res.status === 403 || res.status === 404, `${rota} bloqueado (veio ${res.status})`);
    const corpo = await res.text();
    ok(!corpo.includes('root:'), `${rota} não vaza /etc/passwd`);
  }
});

await test('!topgear: envia interactiveMessage com botão webview', async () => {
  const texto = await rodar('!topgear');
  ok(!!relayed, 'usou relayMessage');
  ok(relayed?.message?.interactiveMessage, 'gerou interactiveMessage');
  const btn = relayed?.message?.interactiveMessage?.nativeFlowMessage?.buttons?.[0];
  ok(btn?.name === 'cta_url', `botão é cta_url (veio ${btn?.name})`);
  const params = JSON.parse(btn?.buttonParamsJson || '{}');
  ok(params.webview_interaction === true, 'abre em webview');
  ok(String(params.url).endsWith('/index.html'), `url aponta o index.html (veio ${params.url})`);
  ok(texto.includes('Experiência enviada'), 'confirma o envio na resposta');
});

await test('!topgear: só em grupo e só para o dono', async () => {
  const naoDono = await rodar('!topgear', { fromMe: false });
  ok(!relayed, 'não-dono não dispara a experiência');
  ok(naoDono.length > 0, 'responde alguma coisa ao não-dono');
});

await test('!topgear NÃO está em nenhum menu nem no blockPv', async () => {
  const menus = fs.readdirSync(path.join(PROJECT, 'dados/src/menus'));
  for (const m of menus) {
    if (!m.endsWith('.js')) continue;
    const txt = fs.readFileSync(path.join(PROJECT, 'dados/src/menus', m), 'utf-8');
    ok(!txt.includes('topgear'), `${m} não cita topgear`);
  }
  const blockPv = fs.readFileSync(path.join(PROJECT, 'dados/src/utils/blockPv.js'), 'utf-8');
  ok(!blockPv.includes('topgear'), 'blockPv não cita topgear');
});

await test('nenhuma ROM comercial no repositório', () => {
  const dir = path.join(PROJECT, 'dados/src/topgear');
  const arquivos = fs.readdirSync(dir);
  for (const f of arquivos) {
    ok(!/\.(sfc|smc|fig|swc|rom|bin|zip)$/i.test(f), `${f} não é ROM`);
  }
  ok(arquivos.includes('index.html'), 'tem o index.html');
  ok(arquivos.includes('app.js'), 'tem o app.js');
});

const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log('\n════════════════════════════════════════');
console.log(`RESULTADO: ${RESULTS.length} testes | ${totalOk} asserções ok | ${totalFail} falhas`);
console.log('════════════════════════════════════════');

fs.rmSync(TMP_DB, { recursive: true, force: true });
if (totalFail > 0) {
  for (const r of RESULTS) if (r.failed) for (const e of r.errors) console.log(`- [${r.name}] ${e}`);
  process.exit(1);
}
console.log('✅ TODOS OS TESTES PASSARAM');
process.exit(0);
