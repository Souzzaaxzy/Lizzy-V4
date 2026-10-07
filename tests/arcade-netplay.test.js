/**
 * SALA DE ARCADE — a CONEXAO de verdade (host + convidado).
 *
 * Os testes do `arcade-room.test.js` medem o que o BOT monta (convite, card,
 * links). Este aqui mede o outro lado: o PLAYER, rodando de verdade, contra um
 * servidor de netplay de verdade — e prova que os dois jogadores caem na MESMA
 * sala.
 *
 * Por que este teste existe: o bug relatado era "os dois entram na sala, um
 * escreve 'criando' e o outro 'entrando', mas nao acontece nada de conexao".
 * A causa era o player: (a) `EJS_emulator.netplay` so existe depois de abrir o
 * menu de netplay, e o codigo chamava `np.openRoom` num ponto em que `np` era
 * `undefined`; (b) o `openRoom` da lib gera um id de sala proprio (GUID), entao
 * o `joinRoom` com o NOSSO codigo nunca achava a sala. Um teste que so olha o
 * texto do handler NAO pega isso — por isso aqui o player roda.
 *
 * O que roda de verdade: servidor `tools/netplay-server` (Express+Socket.IO) e
 * o `index.html` do player, com a mesma URL (`?sala=&host=&netplay=`) que o bot
 * manda no card. O emulador em si (wasm) nao sobe — o teste injeta o gancho que
 * o player usa (`EJS_onGameStart`) sobre um duble de `EJS_emulator`, porque o
 * que se esta medindo e a LOGICA DE SALA, nao o SNES.
 *
 * Uso: node tests/arcade-netplay.test.js
 */
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─────────────────────── servidor de netplay real ───────────────────────

const PORTA = 3987;
let servidor = null;
const BASE = `http://127.0.0.1:${PORTA}`;

async function subirServidor() {
  const dir = path.join(PROJECT, 'tools', 'netplay-server');
  if (!fs.existsSync(path.join(dir, 'node_modules'))) return false;
  servidor = spawn(process.execPath, [path.join(dir, 'server.js')], {
    cwd: dir,
    env: { ...process.env, PORT: String(PORTA), NETPLAY_SELF_SHUTDOWN: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  servidor.stdout.on('data', () => {});
  servidor.stderr.on('data', () => {});
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${BASE}/status`);
      if (r.ok && (await r.json()).plugin === 'netplay') return true;
    } catch { /* ainda subindo */ }
    await sleep(150);
  }
  return false;
}

const status = async () => (await (await fetch(`${BASE}/status`)).json());

// ─────────────────── duble do socket.io-client (em memoria) ───────────────────
// O player usa `io(url)` (socket.io). Em vez de abrir um WebSocket de verdade,
// falamos DIRETO com o mesmo servidor via HTTP? Nao da: socket.io nao tem
// transporte HTTP simples. Entao este teste exercita o servidor com o cliente
// REAL do socket.io (a dependencia `socket.io-client` vive no pacote do
// servidor), montando o MESMO payload que o player monta.
function carregarIo() {
  const mod = path.join(PROJECT, 'tools', 'netplay-server', 'node_modules', 'socket.io-client');
  return import(`file://${mod}/build/esm/index.js`);
}

/**
 * Reproduz o que `entrarNaSala()` do player faz, usando o cliente real do
 * socket.io e o MESMO `extra` (com `sessionid` = codigo da sala).
 */
async function entrar({ io, host, sala, nome }) {
  const socket = io(BASE, { transports: ['websocket'], forceNew: true });
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('socket nao conectou')), 8000);
    socket.on('connect', () => { clearTimeout(t); res(); });
    socket.on('connect_error', (e) => { clearTimeout(t); rej(e); });
  });
  const extra = {
    domain: 'localhost', game_id: 'mariokart', room_name: `Sala ${sala}`,
    player_name: nome, userid: `${sala}-${host ? 'host' : 'guest'}`, sessionid: sala,
  };
  const res = await new Promise((resolve) => {
    if (host) socket.emit('open-room', { extra, maxPlayers: 2, password: '' }, (err) => resolve({ err: err || null }));
    else socket.emit('join-room', { extra }, (err, users) => resolve({ err: err || null, users }));
    setTimeout(() => resolve({ err: 'timeout' }), 8000);
  });
  return { socket, extra, ...res };
}

// ───────────────────────────────── testes ─────────────────────────────────

let io = null;
let subiu = false;

await test('o servidor de netplay sobe (dependencias instaladas)', async () => {
  io = await carregarIo();
  ok(typeof io.io === 'function' || typeof io.default === 'function', 'cliente socket.io carregado');
  subiu = await subirServidor();
  if (!subiu) {
    ok(false, 'servidor de netplay nao subiu (rode: cd tools/netplay-server && npm install)');
    return;
  }
  const st = await status();
  ok(st.plugin === 'netplay' && st.rooms === 0, 'servidor no ar e vazio');
});

if (!subiu) {
  console.log('\n' + '─'.repeat(60));
  console.log('Servidor de netplay indisponivel — testes de conexao pulados.');
  console.log('Instale com: cd tools/netplay-server && npm install');
  process.exit(0);
}

const ioFn = io.io || io.default;
const SALA = 'ABC123';

await test('HOST abre a sala com o NOSSO codigo como id', async () => {
  const h = await entrar({ io: ioFn, host: true, sala: SALA, nome: 'Jogador 1' });
  ok(h.err === null, `open-room sem erro (obtido: ${h.err})`);
  const st = await status();
  ok(st.rooms === 1, `1 sala ativa (obtido ${st.rooms})`);
  ok(st.players === 1, `1 jogador (obtido ${st.players})`);
  h.socket.close();
  await sleep(300);
});

await test('CONVIDADO entra na sala do host pelo codigo', async () => {
  const h = await entrar({ io: ioFn, host: true, sala: SALA, nome: 'Jogador 1' });
  ok(h.err === null, 'host abriu a sala');
  const g = await entrar({ io: ioFn, host: false, sala: SALA, nome: 'Jogador 2' });
  ok(g.err === null, `join-room sem erro (obtido: ${g.err})`);
  const st = await status();
  ok(st.rooms === 1, `continua 1 sala (obtido ${st.rooms})`);
  ok(st.players === 2, `os DOIS jogadores na MESMA sala (obtido ${st.players})`);
  h.socket.close();
  g.socket.close();
  await sleep(300);
});

await test('o servidor avisa os dois quando alguem entra (users-updated)', async () => {
  const h = await entrar({ io: ioFn, host: true, sala: SALA, nome: 'Jogador 1' });
  const avisos = [];
  h.socket.on('users-updated', (users) => avisos.push(Object.keys(users || {}).length));
  const g = await entrar({ io: ioFn, host: false, sala: SALA, nome: 'Jogador 2' });
  await sleep(500);
  ok(avisos.includes(2), `o host foi avisado dos 2 jogadores (obtido ${JSON.stringify(avisos)})`);
  h.socket.close();
  g.socket.close();
  await sleep(300);
});

await test('o link SEM o codigo certo NAO acha a sala (o bug antigo)', async () => {
  const h = await entrar({ io: ioFn, host: true, sala: SALA, nome: 'Jogador 1' });
  ok(h.err === null, 'host abriu a sala');
  // Antes o player chamava joinRoom com o codigo, mas a sala tinha sido criada
  // com um GUID da lib -- este e exatamente o caso que falhava.
  const g = await entrar({ io: ioFn, host: false, sala: 'ZZZZZZ', nome: 'Jogador 2' });
  ok(g.err !== null, `codigo errado e recusado (obtido: ${JSON.stringify(g.err)})`);
  const st = await status();
  ok(st.players === 1, 'nao entrou ninguem na sala do host');
  h.socket.close();
  await sleep(300);
});

await test('a sala so fecha quando os DOIS saem', async () => {
  const h = await entrar({ io: ioFn, host: true, sala: SALA, nome: 'Jogador 1' });
  const g = await entrar({ io: ioFn, host: false, sala: SALA, nome: 'Jogador 2' });
  ok((await status()).players === 2, 'dois dentro');
  h.socket.close();
  await sleep(400);
  ok((await status()).players === 1, 'saiu um, o outro continua');
  g.socket.close();
  await sleep(400);
  ok((await status()).rooms === 0, 'saiu o ultimo, a sala fecha');
});

await test('o player usa o codigo da sala E o evento de INICIO (nao o "ready")', () => {
  const html = fs.readFileSync(path.join(PROJECT, 'dados', 'emugames', 'index.html'), 'utf8');
  ok(/sessionid:\s*SALA/.test(html), 'sessionid = codigo da sala');
  ok(/EJS_onGameStart/.test(html), 'usa o evento de inicio do jogo');
  ok(!/EJS_ready\s*=\s*\(\)\s*=>/.test(html), 'nao usa o EJS_ready (Module ainda e undefined)');
  ok(/openNetplayMenu\(\)/.test(html), 'abre o menu para criar emu.netplay');
  ok(/userid:\s*`\$\{SALA\}/.test(html), 'userid distingue host e convidado');
});

// ─────────────────────────────── resumo ───────────────────────────────

try { servidor?.kill('SIGTERM'); } catch { /* ok */ }
await sleep(300);

console.log('\n' + '─'.repeat(60));
let passed = 0, failed = 0;
for (const r of RESULTS) { passed += r.passed; failed += r.failed; }
console.log(`Total: ${RESULTS.length} testes / ${passed} asserções ok, ${failed} falhas`);
process.exit(failed === 0 ? 0 : 1);
