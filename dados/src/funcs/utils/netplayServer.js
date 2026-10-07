/**
 * NETPLAY sob demanda — sobe o servidor de netplay SOMENTE quando alguem pede
 * uma sala de jogo.
 *
 * Regra (pedido do dono): o servidor NAO fica ligado o tempo todo. Ele sobe no
 * instante em que uma sala e criada (`!kof @fulano` + `sim`) e se DESLIGA
 * sozinho quando todas as salas fecham (o auto-desligamento vive no proprio
 * `tools/netplay-server/server.js`).
 *
 * Configuracao (env tem prioridade sobre `dados/emugames/netplay.json`):
 *   EMUGAMES_NETPLAY_URL     URL PUBLICA do servidor (ex.: https://netplay.x.com)
 *                            Sem ela a sala nao abre (o site e https e o
 *                            navegador bloqueia ws:// -> precisa de TLS/proxy).
 *   EMUGAMES_NETPLAY_PORT    porta LOCAL do processo (padrao 3000)
 *   EMUGAMES_NETPLAY_SPAWN   '1' sobe o servidor local ao pedir sala; '0' nunca
 *                            sobe (voce ja tem um servidor rodando). Padrao:
 *                            ligado quando a URL aponta para localhost.
 *
 * Modulo defensivo: `garantirNetplay()` NUNCA lanca — devolve
 * `{ ok, motivo, url }` para o comando decidir a mensagem.
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// dados/src/funcs/utils -> raiz do projeto (4 niveis acima)
const PROJECT_ROOT = path.resolve(HERE, '..', '..', '..', '..');
const SERVER_DIR = path.join(PROJECT_ROOT, 'tools', 'netplay-server');
const SERVER_ENTRY = path.join(SERVER_DIR, 'server.js');
const NETPLAY_JSON = path.join(PROJECT_ROOT, 'dados', 'emugames', 'netplay.json');

/** Processo do servidor (null quando nao foi esta subido por nos). */
let child = null;
/** Promise em andamento (evita subir dois servidores em pedidos simultaneos). */
let subindo = null;
/** Ultimo erro/motivo, para o comando poder explicar. */
let ultimoMotivo = '';

// ---------------------------------------------------------------------------
// Configuracao
// ---------------------------------------------------------------------------
function lerJson() {
  try {
    return JSON.parse(fs.readFileSync(NETPLAY_JSON, 'utf8')) || {};
  } catch {
    return {};
  }
}

function hostLocal(host) {
  return ['127.0.0.1', 'localhost', '::1', '0.0.0.0'].includes(String(host || '').toLowerCase());
}

/**
 * Resolve a configuracao efetiva: URL publica, porta local e se devemos subir
 * o processo. `env` e injetavel para teste.
 */
export function configNetplay(env = process.env, json = null) {
  const cfg = json || lerJson();
  const url = String(env.EMUGAMES_NETPLAY_URL || cfg.server || '').trim().replace(/\/+$/, '');

  let host = '';
  let portaDaUrl = 0;
  try {
    const u = new URL(url);
    host = u.hostname;
    if (u.port) portaDaUrl = Number(u.port) || 0;
  } catch { host = ''; }

  // Porta local: env/json manda; sem ela, usa a porta da propria URL (faz
  // sentido para `http://localhost:3210`); senao 3000.
  const porta = Number(env.EMUGAMES_NETPLAY_PORT || cfg.port || portaDaUrl || 3000) || 3000;

  // Subir o processo local? '1' liga, '0' desliga; sem a env, sobe quando a URL
  // aponta para a propria maquina (caso de dev / proxy local).
  const flag = String(env.EMUGAMES_NETPLAY_SPAWN ?? '').trim();
  const spawnar = flag === '0' ? false : flag === '1' ? true : hostLocal(host);

  return {
    url,
    porta,
    host,
    spawnar,
    // URL local (health check do processo que subimos).
    urlLocal: `http://127.0.0.1:${porta}`,
    configurado: Boolean(url),
  };
}

/** A sala multiplayer esta configurada? (existe URL publica) */
export function netplayConfigurado(env = process.env) {
  return configNetplay(env).configurado;
}

/** Porta local configurada. */
export function portaNetplay(env = process.env) {
  return configNetplay(env).porta;
}

// ---------------------------------------------------------------------------
// Health check do processo local
// ---------------------------------------------------------------------------
async function saudavel(urlLocal, timeoutMs = 1200) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(`${urlLocal}/status`, { signal: ctl.signal });
    if (!r.ok) return false;
    const j = await r.json();
    // Confere que e o NOSSO servidor (nao outro servico na mesma porta).
    return j?.plugin === 'netplay';
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

function aguardar(ms) {
  return new Promise((r) => {
    const t = setTimeout(r, ms);
    t.unref?.();
  });
}

// ---------------------------------------------------------------------------
// Ciclo de vida do processo
// ---------------------------------------------------------------------------
function ligarSaidaDoFilho(c) {
  const repassar = (buf) => {
    const txt = String(buf || '').trim();
    if (txt) console.log(txt.split('\n').map((l) => l.trim()).filter(Boolean).join('\n'));
  };
  c.stdout?.on('data', repassar);
  c.stderr?.on('data', repassar);
  c.on('exit', (code) => {
    if (child === c) child = null;
    console.log(`[NETPLAY] servidor encerrado (codigo ${code ?? 'null'}).`);
  });
  c.on('error', (e) => {
    if (child === c) child = null;
    ultimoMotivo = `falha ao iniciar: ${e?.message || e}`;
    console.error(`[NETPLAY] ${ultimoMotivo}`);
  });
}

/** Sobe o processo local (se ja houver um saudavel, nao sobe outro). */
async function subir(env, cfg) {
  if (await saudavel(cfg.urlLocal)) {
    ultimoMotivo = '';
    return true;
  }
  if (!fs.existsSync(SERVER_ENTRY)) {
    ultimoMotivo = `servidor ausente em ${SERVER_ENTRY}`;
    return false;
  }
  // Dependencias do servidor (express/socket.io/cors) vivem no pacote dele.
  if (!fs.existsSync(path.join(SERVER_DIR, 'node_modules'))) {
    ultimoMotivo = 'dependencias do netplay nao instaladas (rode: cd tools/netplay-server && npm install)';
    console.error(`[NETPLAY] ${ultimoMotivo}`);
    return false;
  }

  const c = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: SERVER_DIR,
    env: {
      ...env,
      PORT: String(cfg.porta),
      // Auto-desligamento do proprio servidor (o bot so o acorda).
      NETPLAY_SELF_SHUTDOWN: '1',
      NETPLAY_GRACE_MS: String(env.NETPLAY_GRACE_MS || 120 * 1000),
      NETPLAY_IDLE_SHUTDOWN_MS: String(env.NETPLAY_IDLE_SHUTDOWN_MS || 60 * 1000),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child = c;
  ligarSaidaDoFilho(c);

  // Espera ficar pronto (health check), ate ~8s.
  for (let i = 0; i < 40; i++) {
    if (await saudavel(cfg.urlLocal, 800)) {
      ultimoMotivo = '';
      return true;
    }
    if (c.exitCode !== null) break; // morreu antes de responder
    await aguardar(200);
  }
  ultimoMotivo = 'o servidor nao respondeu no tempo esperado';
  return false;
}

/**
 * Garante o servidor de netplay ATIVO para uma sala.
 * Devolve `{ ok, url, motivo }` — nunca lanca.
 *
 * Com servidor EXTERNO (`EMUGAMES_NETPLAY_SPAWN=0`, ou URL que nao e localhost)
 * a responsabilidade de estar no ar e do dono: aqui so devolvemos a URL, porque
 * o navegador do jogador e quem fala com ele (nao o bot). Subir processo so
 * faz sentido quando o servidor e local.
 */
export async function garantirNetplay(env = process.env) {
  const cfg = configNetplay(env);
  if (!cfg.configurado) {
    return { ok: false, url: '', motivo: 'sem EMUGAMES_NETPLAY_URL configurada' };
  }
  if (!cfg.spawnar) {
    return { ok: true, url: cfg.url, motivo: '' };
  }
  if (!subindo) {
    subindo = subir(env, cfg).finally(() => { subindo = null; });
  }
  const ok = await subindo;
  return { ok, url: cfg.url, motivo: ok ? '' : ultimoMotivo };
}

/** Derruba o processo que NOS subimos (usado no shutdown do bot). */
export function pararNetplay() {
  if (!child) return false;
  try { child.kill('SIGTERM'); } catch { /* ok */ }
  child = null;
  return true;
}

/** Estado para diagnostico (comando/painel). */
export async function estadoNetplay(env = process.env) {
  const cfg = configNetplay(env);
  if (!cfg.configurado) return { configurado: false, ativo: false, url: '', porta: cfg.porta };
  const ativo = await saudavel(cfg.spawnar ? cfg.urlLocal : cfg.url, 1500);
  return { configurado: true, ativo, url: cfg.url, porta: cfg.porta, local: cfg.spawnar };
}

// Ao encerrar o bot, nao deixa processo orfao.
process.on('exit', () => { try { pararNetplay(); } catch { /* ok */ } });

export default {
  configNetplay, netplayConfigurado, portaNetplay,
  garantirNetplay, pararNetplay, estadoNetplay,
};
