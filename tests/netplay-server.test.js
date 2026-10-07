/**
 * Teste do SERVIDOR de netplay (tools/netplay-server/server.js).
 *
 * Sobe o processo REAL, conecta clientes socket.io de verdade e verifica o que
 * o dono pediu: o servidor se DESLIGA sozinho quando nao ha salas.
 *
 * Uso: node tests/netplay-server.test.js
 */
import { spawn } from 'child_process';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');
const SERVER_DIR = path.join(PROJECT, 'tools', 'netplay-server');
const ENTRY = path.join(SERVER_DIR, 'server.js');

// socket.io-client mora no pacote do servidor (devDependency).
const { io } = await import(new URL('../tools/netplay-server/node_modules/socket.io-client/build/esm/index.js', import.meta.url).href);

const RESULTS = [];
let CURRENT = null;
function test(name, fn) {
  CURRENT = { name, passed: 0, failed: 0, errors: [] };
  RESULTS.push(CURRENT);
  return Promise.resolve()
    .then(fn)
    .catch((e) => { CURRENT.failed++; CURRENT.errors.push(`EXCEÇÃO: ${e?.stack || e}`); })
    .then(() => {
      console.log(`${CURRENT.failed === 0 ? '✅' : '❌'} ${CURRENT.name} (${CURRENT.passed} ok, ${CURRENT.failed} falhas)`);
      for (const e of CURRENT.errors) console.log(`   ↳ ${e}`);
    });
}
function ok(c, m) { if (c) CURRENT.passed++; else { CURRENT.failed++; CURRENT.errors.push(`ASSERT: ${m}`); } }

// ---------------------------------------------------------------------------
// Helpers de processo/porta
// ---------------------------------------------------------------------------
function portaVaga() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

function subirServidor(porta, envExtra = {}) {
  const logs = [];
  const child = spawn(process.execPath, [ENTRY], {
    cwd: SERVER_DIR,
    env: { ...process.env, PORT: String(porta), ...envExtra },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => logs.push(String(d)));
  child.stderr.on('data', (d) => logs.push(String(d)));
  const saiu = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
  return { child, logs, saiu };
}

function conectar(porta) {
  return io(`http://127.0.0.1:${porta}`, {
    transports: ['websocket'],
    reconnection: false,
    timeout: 4000,
  });
}

function abrirSala(sock, { sessionId, playerId, gameId = 'kof97' }) {
  return new Promise((resolve) => {
    sock.emit('open-room', {
      extra: { sessionid: sessionId, userid: playerId, game_id: gameId, player_name: 'P' },
      maxPlayers: 2,
    }, (err) => resolve(err || null));
  });
}

function entrarSala(sock, { sessionId, playerId }) {
  return new Promise((resolve) => {
    sock.emit('join-room', {
      extra: { sessionid: sessionId, userid: playerId, player_name: 'P2' },
    }, (err) => resolve(err || null));
  });
}

function esperar(ms) { return new Promise((r) => { const t = setTimeout(r, ms); t.unref?.(); }); }

async function status(porta, timeoutMs = 1500) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(`http://127.0.0.1:${porta}/status`, { signal: ctl.signal });
    return r.ok ? await r.json() : null;
  } catch { return null; } finally { clearTimeout(t); }
}

async function esperarStatus(porta, tentativas = 40) {
  for (let i = 0; i < tentativas; i++) {
    const s = await status(porta);
    if (s) return s;
    await esperar(150);
  }
  return null;
}

/** Espera o processo sair; devolve o codigo (ou null se ainda vivo). */
async function esperarSair(saiu, timeoutMs) {
  return Promise.race([
    saiu,
    esperar(timeoutMs).then(() => null),
  ]);
}

// ─────────────────────────────────────────────────────────────────────────
// 1) o servidor fica no ar enquanto ha sala e some quando ela fecha
// ─────────────────────────────────────────────────────────────────────────
await test('sobe, aceita sala, e SAI sozinho quando a sala fecha', async () => {
  const porta = await portaVaga();
  const srv = subirServidor(porta, {
    NETPLAY_GRACE_MS: '8000',
    NETPLAY_IDLE_SHUTDOWN_MS: '1200',
  });
  try {
    const st = await esperarStatus(porta);
    ok(st && st.plugin === 'netplay', 'servidor responde /status');
    ok(st.rooms === 0, 'comeca sem salas');

    const c1 = conectar(porta);
    await new Promise((r) => c1.on('connect', r));
    const err = await abrirSala(c1, { sessionId: 'S1', playerId: 'u1' });
    ok(!err, 'sala criada sem erro');

    const st2 = await status(porta);
    ok(st2.rooms === 1, 'conta 1 sala ativa');
    ok(st2.players === 1, 'conta 1 jogador');

    // fecha a sala -> o servidor deve se encerrar em ~1.2s
    c1.emit('leave-room');
    c1.close();
    const code = await esperarSair(srv.saiu, 6000);
    ok(code !== null, 'o processo SAIU sozinho depois de fechar a sala');
    ok((srv.logs.join('') || '').includes('encerrando'), 'logou o motivo do encerramento');
  } finally {
    try { srv.child.kill('SIGKILL'); } catch { /* ok */ }
  }
});

// ─────────────────────────────────────────────────────────────────────────
// 2) a ultima de DUAS salas fecha -> sai; enquanto houver uma, fica
// ─────────────────────────────────────────────────────────────────────────
await test('com 2 salas, so sai quando a ULTIMA fecha', async () => {
  const porta = await portaVaga();
  const srv = subirServidor(porta, {
    NETPLAY_GRACE_MS: '8000',
    NETPLAY_IDLE_SHUTDOWN_MS: '1500',
  });
  try {
    await esperarStatus(porta);
    const c1 = conectar(porta); const c2 = conectar(porta);
    await Promise.all([new Promise((r) => c1.on('connect', r)), new Promise((r) => c2.on('connect', r))]);
    await abrirSala(c1, { sessionId: 'A', playerId: 'a1' });
    await abrirSala(c2, { sessionId: 'B', playerId: 'b1' });
    ok((await status(porta)).rooms === 2, '2 salas ativas');

    // fecha UMA -> deve continuar vivo
    c1.emit('leave-room'); c1.close();
    await esperar(2500);
    const st = await status(porta);
    ok(st && st.rooms === 1, 'continua vivo com 1 sala restante');

    // fecha a ultima -> sai
    c2.emit('leave-room'); c2.close();
    const code = await esperarSair(srv.saiu, 6000);
    ok(code !== null, 'saiu ao fechar a ultima sala');
  } finally {
    try { srv.child.kill('SIGKILL'); } catch { /* ok */ }
  }
});

// ─────────────────────────────────────────────────────────────────────────
// 3) sala nova CANCELA o desligamento pendente
// ─────────────────────────────────────────────────────────────────────────
await test('sala nova cancela o desligamento pendente', async () => {
  const porta = await portaVaga();
  const srv = subirServidor(porta, {
    NETPLAY_GRACE_MS: '8000',
    NETPLAY_IDLE_SHUTDOWN_MS: '3000',
  });
  try {
    await esperarStatus(porta);
    const c1 = conectar(porta);
    await new Promise((r) => c1.on('connect', r));
    await abrirSala(c1, { sessionId: 'X', playerId: 'x1' });
    c1.emit('leave-room'); c1.close();       // dispara o timer (3s)
    await esperar(800);
    // antes do timer, entra outra pessoa e cria sala
    const c2 = conectar(porta);
    await new Promise((r) => c2.on('connect', r));
    await abrirSala(c2, { sessionId: 'Y', playerId: 'y1' });
    await esperar(3500);                     // passa o tempo do timer antigo
    const st = await status(porta);
    ok(st && st.rooms === 1, 'segue vivo porque entrou sala nova');
    c2.emit('leave-room'); c2.close();
    const code = await esperarSair(srv.saiu, 8000);
    ok(code !== null, 'sai depois que essa sala tambem fecha');
  } finally {
    try { srv.child.kill('SIGKILL'); } catch { /* ok */ }
  }
});

// ─────────────────────────────────────────────────────────────────────────
// 4) sem sala nenhuma, o servidor NAO fica ligado para sempre (grace)
// ─────────────────────────────────────────────────────────────────────────
await test('sem nenhuma sala, sai depois do grace', async () => {
  const porta = await portaVaga();
  const srv = subirServidor(porta, {
    NETPLAY_GRACE_MS: '1500',
    NETPLAY_IDLE_SHUTDOWN_MS: '1500',
  });
  try {
    await esperarStatus(porta);
    const code = await esperarSair(srv.saiu, 7000);
    ok(code !== null, 'saiu sem ninguem criar sala');
    ok((srv.logs.join('') || '').includes('nenhuma sala'), 'motivo: nenhuma sala criada');
  } finally {
    try { srv.child.kill('SIGKILL'); } catch { /* ok */ }
  }
});

// ─────────────────────────────────────────────────────────────────────────
// 5) NETPLAY_SELF_SHUTDOWN=0 mantem o servidor fixo
// ─────────────────────────────────────────────────────────────────────────
await test('NETPLAY_SELF_SHUTDOWN=0 nao desliga sozinho', async () => {
  const porta = await portaVaga();
  const srv = subirServidor(porta, {
    NETPLAY_SELF_SHUTDOWN: '0',
    NETPLAY_GRACE_MS: '1000',
    NETPLAY_IDLE_SHUTDOWN_MS: '1000',
  });
  try {
    await esperarStatus(porta);
    await esperar(2600);
    const st = await status(porta);
    ok(st && st.selfShutdown === false, 'continua no ar (selfShutdown=false)');
  } finally {
    try { srv.child.kill('SIGKILL'); } catch { /* ok */ }
  }
});

// ─────────────────────────────────────────────────────────────────────────
// 6) dois jogadores na MESMA sala (o caso do !kof)
// ─────────────────────────────────────────────────────────────────────────
await test('dois jogadores entram na mesma sala', async () => {
  const porta = await portaVaga();
  const srv = subirServidor(porta, { NETPLAY_GRACE_MS: '8000', NETPLAY_IDLE_SHUTDOWN_MS: '2000' });
  try {
    await esperarStatus(porta);
    const c1 = conectar(porta); const c2 = conectar(porta);
    await Promise.all([new Promise((r) => c1.on('connect', r)), new Promise((r) => c2.on('connect', r))]);
    await abrirSala(c1, { sessionId: 'K', playerId: 'j1' });
    // /list mostra a sala com vaga (1/2) para o game_id
    const l1 = await (await fetch(`http://127.0.0.1:${porta}/list?game_id=kof97`)).json();
    ok(Object.keys(l1).length === 1, '/list mostra a sala do kof97 com vaga');
    const err = await entrarSala(c2, { sessionId: 'K', playerId: 'j2' });
    ok(!err, 'segundo jogador entra sem erro');
    const st = await status(porta);
    ok(st.rooms === 1 && st.players === 2, '1 sala com 2 jogadores');
    // cheia (2/2): sai da lista de "open rooms" (comportamento oficial do /list)
    const l2 = await (await fetch(`http://127.0.0.1:${porta}/list?game_id=kof97`)).json();
    ok(Object.keys(l2).length === 0, '/list nao lista sala cheia (2/2)');
    c1.emit('leave-room'); c1.close(); c2.emit('leave-room'); c2.close();
    const code = await esperarSair(srv.saiu, 8000);
    ok(code !== null, 'sai quando os dois saem');
  } finally {
    try { srv.child.kill('SIGKILL'); } catch { /* ok */ }
  }
});

// ─────────────────────────────────────────────────────────────────────────
// resumo
// ─────────────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(60));
let passed = 0, failed = 0;
for (const r of RESULTS) { passed += r.passed; failed += r.failed; }
console.log(`Total: ${RESULTS.length} testes / ${passed} asserções ok, ${failed} falhas`);
process.exit(failed === 0 ? 0 : 1);
