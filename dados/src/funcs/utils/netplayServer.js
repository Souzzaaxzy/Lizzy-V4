/**
 * NETPLAY sob demanda — sobe o servidor de netplay SOMENTE quando alguem pede
 * uma sala de jogo, e o publica na internet com HTTPS.
 *
 * Regra (pedido do dono): o servidor NAO fica ligado o tempo todo. Ele sobe no
 * instante em que uma sala e criada (`!kof @fulano` + `sim`) e se DESLIGA
 * sozinho quando todas as salas fecham (o auto-desligamento vive no proprio
 * `tools/netplay-server/server.js`).
 *
 * COMO O JOGADOR CHEGA ATE ELE (o problema do TLS)
 * O site do emulador e https; o navegador bloqueia `ws://` a partir de pagina
 * segura. Um servidor http puro nao serve. Resolvemos com **Cloudflare Tunnel**
 * (`cloudflared`), que da um endereco **HTTPS publico** para um servidor local
 * sem abrir porta, sem IP publico e **sem conta** (quick tunnel). Medido: HTTP
 * 200 e **WebSocket funcionando** atraves do tunel.
 *
 * Modos, em ordem de preferencia:
 *   1. `EMUGAMES_NETPLAY_URL` definida  -> usa essa URL (dominio proprio/proxy).
 *   2. Porta publicada pelo host (`WORKER_1/2`) -> detecta a URL HTTPS.
 *   3. **Cloudflare Tunnel** -> publica o servidor local (padrao quando ha o
 *      binario `cloudflared`). `EMUGAMES_NETPLAY_TUNNEL=0` desliga.
 *
 * Modulo defensivo: `garantirNetplay()` NUNCA lanca — devolve
 * `{ ok, motivo, url }` para o comando decidir a mensagem.
 */
import { spawn, spawnSync } from 'child_process';
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
/** Processo do tunel (Cloudflare). */
let tunel = null;
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
 * Portas PUBLICADAS pelo runtime (cada uma responde num subdominio HTTPS).
 * Medido: um servidor ouvindo na 12000 responde em `https://work-1-<runtime>/`
 * com HTTP 200, e na 12001 em `https://work-2-<runtime>/`. Fora dessas portas
 * nao ha subdominio.
 */
export function portasPublicadas(env = process.env) {
  const out = [];
  for (const k of ['WORKER_1', 'WORKER_2']) {
    const n = Number(env[k]);
    if (Number.isFinite(n) && n > 0) out.push(n);
  }
  return out;
}

/** Id do runtime (para montar o subdominio `work-N-<id>`). */
function runtimeId(env) {
  if (env.RUNTIME_ID) return String(env.RUNTIME_ID);
  try {
    return new URL(env.RUNTIME_URL).hostname.split('.')[0];
  } catch { /* segue */ }
  const m = /^runtime-([a-z0-9]+)-/i.exec(String(env.HOSTNAME || ''));
  return m ? m[1] : '';
}

/**
 * URL publica para uma porta, quando o ambiente a publica com TLS.
 * `''` quando nao da para saber.
 */
export function detectarUrlPublica(env = process.env, porta = 0) {
  const pub = portasPublicadas(env);
  const idx = pub.indexOf(Number(porta));
  if (idx < 0) return '';
  // Reaproveita o sufixo do RUNTIME_URL (ex.: `prod-runtime.all-hands.dev`).
  try {
    const host = new URL(env.RUNTIME_URL).hostname;
    const id = host.split('.')[0];
    const sufixo = host.slice(id.length + 1);
    if (id && sufixo) return `https://work-${idx + 1}-${id}.${sufixo}`;
  } catch { /* segue */ }
  const id = runtimeId(env);
  return id ? `https://work-${idx + 1}-${id}.prod-runtime.all-hands.dev` : '';
}

/**
 * Onde esta o binario do cloudflared.
 *
 * `CLOUDFLARED_PATH` e ESTRITO: quando definido, e a unica fonte consultada
 * (sem cair para a copia local/PATH). Assim um caminho errado falha de forma
 * previsivel em vez de silenciosamente usar outro binario.
 */
export function acharCloudflared(env = process.env) {
  if (env.CLOUDFLARED_PATH) {
    try { return fs.existsSync(env.CLOUDFLARED_PATH) ? env.CLOUDFLARED_PATH : ''; } catch { return ''; }
  }
  const candidatos = [
    path.join(SERVER_DIR, 'bin', 'cloudflared'),
    path.join(PROJECT_ROOT, 'bin', 'cloudflared'),
  ];
  for (const c of candidatos) {
    try { if (fs.existsSync(c)) return c; } catch { /* segue */ }
  }
  try {
    const r = spawnSync('cloudflared', ['--version'], { timeout: 8000 });
    if (r.status === 0) return 'cloudflared';
  } catch { /* segue */ }
  return '';
}

/**
 * Resolve a configuracao efetiva.
 *
 * Precedencia da URL: `EMUGAMES_NETPLAY_URL` > `netplay.json.server` > porta
 * publicada do host > **tunel Cloudflare**.
 */
export function configNetplay(env = process.env, json = null) {
  const cfg = json || lerJson();
  const explicita = String(env.EMUGAMES_NETPLAY_URL || cfg.server || '').trim().replace(/\/+$/, '');
  const portaExplicita = env.EMUGAMES_NETPLAY_PORT || cfg.port;
  const pub = portasPublicadas(env);

  const flagSpawn = String(env.EMUGAMES_NETPLAY_SPAWN ?? '').trim();
  const flagTunel = String(env.EMUGAMES_NETPLAY_TUNNEL ?? '').trim();

  let url = '';
  let porta = 3000;
  let host = '';
  let modo = 'nenhum';

  if (explicita) {
    url = explicita;
    modo = 'url';
    let portaDaUrl = 0;
    try {
      const u = new URL(url);
      host = u.hostname;
      if (u.port) portaDaUrl = Number(u.port) || 0;
    } catch { host = ''; }
    porta = Number(portaExplicita || portaDaUrl || 3000) || 3000;
  } else if (pub.length && flagTunel !== '1') {
    // Porta publicada pelo host (HTTPS de graca, sem tunel).
    porta = Number(portaExplicita || pub[0]) || pub[0];
    url = detectarUrlPublica(env, porta);
    modo = 'porta-publicada';
  } else {
    // Tunel Cloudflare: publica o servidor local (precisa do binario).
    porta = Number(portaExplicita || 3000) || 3000;
    modo = flagTunel === '0' ? 'nenhum' : 'tunel';
  }

  // Subir o processo local?
  let spawnar;
  if (flagSpawn === '0') spawnar = false;
  else if (flagSpawn === '1') spawnar = true;
  else if (modo === 'url') spawnar = hostLocal(host);
  else spawnar = modo === 'porta-publicada' || modo === 'tunel';

  return {
    url,
    porta,
    host,
    spawnar,
    modo,
    auto: modo !== 'url',
    tunel: modo === 'tunel',
    // URL local (health check do processo que subimos).
    urlLocal: `http://127.0.0.1:${porta}`,
    configurado: Boolean(url) || modo === 'tunel',
  };
}

/**
 * A sala multiplayer esta configurada? (URL, porta publicada ou tunel)
 *
 * NAO exige o binario do cloudflared: se faltar, o proprio bot o baixa na hora
 * (ver `garantirCloudflared`). Exigir o binario aqui bloqueava o convite com
 * "sala indisponivel" ANTES de qualquer tentativa -- e sem log nenhum.
 */
export function netplayConfigurado(env = process.env) {
  return configNetplay(env).modo !== 'nenhum';
}

/** Porta local configurada. */
export function portaNetplay(env = process.env) {
  return configNetplay(env).porta;
}

// ---------------------------------------------------------------------------
// Health check
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

async function urlPublicaResponde(url, timeoutMs = 2500) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(`${url}/status`, { signal: ctl.signal });
    if (!r.ok) return false;
    const j = await r.json();
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

/** Sobe o processo do servidor (se ja houver um saudavel, nao sobe outro). */
async function subirServidor(env, cfg) {
  if (await saudavel(cfg.urlLocal)) return true;
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
      NETPLAY_GRACE_MS: String(env.NETPLAY_GRACE_MS || 10 * 60 * 1000),
      NETPLAY_IDLE_SHUTDOWN_MS: String(env.NETPLAY_IDLE_SHUTDOWN_MS || 60 * 1000),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child = c;
  ligarSaidaDoFilho(c);

  // Espera ficar pronto (health check), ate ~8s.
  for (let i = 0; i < 40; i++) {
    if (await saudavel(cfg.urlLocal, 800)) return true;
    if (c.exitCode !== null) break; // morreu antes de responder
    await aguardar(200);
  }
  ultimoMotivo = 'o servidor nao respondeu no tempo esperado';
  return false;
}

// ---------------------------------------------------------------------------
// Tunel Cloudflare (HTTPS publico para o servidor local, sem conta)
// ---------------------------------------------------------------------------
const TUNEL_URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;
/** Quanto esperar o endereco do tunel ficar acessivel (DNS propaga devagar). */
const READY_TIMEOUT_MS = Number(process.env.NETPLAY_TUNNEL_READY_MS || 90 * 1000);

/**
 * Sobe o tunel e devolve a URL publica (`''` se falhar).
 */
export async function subirTunel(env, cfg, { timeoutMs = 45000 } = {}) {
  const bin = acharCloudflared(env);
  if (!bin) {
    ultimoMotivo = 'cloudflared nao encontrado (baixe para tools/netplay-server/bin/cloudflared ou defina CLOUDFLARED_PATH)';
    return '';
  }
  if (!(await saudavel(cfg.urlLocal, 800))) {
    ultimoMotivo = 'o servidor local precisa estar no ar antes do tunel';
    return '';
  }

  const c = spawn(bin, ['tunnel', '--url', cfg.urlLocal, '--no-autoupdate'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...env },
  });
  tunel = c;

  let buf = '';
  let url = '';
  const capturar = (d) => {
    buf += String(d);
    if (!url) {
      const m = TUNEL_URL_RE.exec(buf);
      if (m) url = m[0];
    }
  };
  c.stdout?.on('data', capturar);
  c.stderr?.on('data', capturar);
  c.on('error', (e) => {
    if (tunel === c) tunel = null;
    ultimoMotivo = `falha no tunel: ${e?.message || e}`;
    console.error(`[NETPLAY] ${ultimoMotivo}`);
  });
  c.on('exit', (code) => {
    if (tunel === c) tunel = null;
    console.log(`[NETPLAY] tunel encerrado (codigo ${code ?? 'null'}).`);
  });

  const limite = Date.now() + timeoutMs;
  while (!url && Date.now() < limite) {
    if (c.exitCode !== null) break;
    await aguardar(400);
  }
  if (!url) {
    ultimoMotivo = ultimoMotivo || 'o tunel nao devolveu a URL no tempo esperado';
    pararTunel();
    return '';
  }

  // Espera o endereco realmente servir. O subdominio novo do quick tunnel
  // leva um tempo para o DNS PROPAGAR (medido: os primeiros segundos dao
  // ENOTFOUND). Por isso a espera e por TEMPO, nao por numero de tentativas.
  const limitePronto = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < limitePronto) {
    if (await urlPublicaResponde(url, 5000)) {
      console.log(`[NETPLAY] tunel publico: ${url}`);
      return url;
    }
    if (c.exitCode !== null) break;
    await aguardar(1000);
  }
  ultimoMotivo = 'o tunel subiu mas a URL ainda nao respondeu';
  pararTunel();
  return '';
}

/**
 * Garante o binario do cloudflared: se nao existir, BAIXA na hora (release
 * oficial). E o que evita o "sala indisponivel" quando o instalador falhou ou
 * o binario nunca chegou -- o bot se resolve sozinho.
 */
export async function garantirCloudflared(env = process.env, { timeoutMs = 300000 } = {}) {
  const atual = acharCloudflared(env);
  if (atual) return atual;
  // CLOUDFLARED_PATH explicito e estrito: nao sobrescreve o que o dono apontou.
  if (env.CLOUDFLARED_PATH) return '';

  const baixador = path.join(SERVER_DIR, 'baixar-cloudflared.mjs');
  if (!fs.existsSync(baixador)) {
    console.log(`[NETPLAY] baixador ausente: ${baixador}`);
    return '';
  }
  console.log('[NETPLAY] cloudflared nao encontrado - baixando do release oficial...');
  try {
    await new Promise((resolve, reject) => {
      const c = spawn(process.execPath, [baixador], { stdio: ['ignore', 'pipe', 'pipe'] });
      const repassar = (b) => {
        const t = String(b || '').trim();
        if (t) console.log(t.split('\n').map((l) => l.trim()).filter(Boolean).join('\n'));
      };
      c.stdout?.on('data', repassar);
      c.stderr?.on('data', repassar);
      c.on('error', reject);
      const t = setTimeout(() => { try { c.kill('SIGKILL'); } catch { /* ok */ } reject(new Error('timeout')); }, timeoutMs);
      t.unref?.();
      c.on('exit', (code) => { clearTimeout(t); code === 0 ? resolve() : reject(new Error(`exit ${code}`)); });
    });
  } catch (e) {
    console.error(`[NETPLAY] falha ao baixar o cloudflared: ${e?.message || e}`);
    return '';
  }
  return acharCloudflared(env);
}

/** Derruba o tunel (se foi subido por nos). */
export function pararTunel() {
  if (!tunel) return false;
  try { tunel.kill('SIGTERM'); } catch { /* ok */ }
  tunel = null;
  return true;
}

// ---------------------------------------------------------------------------
// API publica
// ---------------------------------------------------------------------------
/**
 * Garante o servidor de netplay ATIVO para uma sala.
 * Devolve `{ ok, url, motivo }` — nunca lanca.
 */
export async function garantirNetplay(env = process.env) {
  const cfg = configNetplay(env);
  // Log SEMPRE: sem isto o "sala indisponivel" nao deixava rastro nenhum, e
  // ficava impossivel saber onde parou.
  console.log(`[NETPLAY] modo=${cfg.modo} porta=${cfg.porta} spawn=${cfg.spawnar} url=${cfg.url || '(a definir)'}`);

  if (cfg.modo === 'nenhum') {
    console.log('[NETPLAY] tunel desligado e sem URL - nao ha como publicar a sala');
    return { ok: false, url: '', motivo: 'sem URL e com o tunel desligado' };
  }
  if (cfg.modo === 'url' && !cfg.spawnar) {
    return { ok: true, url: cfg.url, motivo: '' };
  }

  if (!subindo) {
    subindo = (async () => {
      if (cfg.spawnar) {
        const okSrv = await subirServidor(env, cfg);
        if (!okSrv) {
          console.error(`[NETPLAY] servidor local nao subiu: ${ultimoMotivo}`);
          return { ok: false, url: cfg.url, motivo: ultimoMotivo };
        }
      }
      if (cfg.modo === 'tunel') {
        // Se o binario nao chegou pelo instalador, baixa AGORA.
        const bin = await garantirCloudflared(env);
        if (!bin) {
          console.error('[NETPLAY] sem cloudflared - nao consegui publicar a sala');
          return { ok: false, url: '', motivo: ultimoMotivo || 'cloudflared indisponivel' };
        }
        const url = await subirTunel(env, cfg);
        if (!url) {
          console.error(`[NETPLAY] tunel falhou: ${ultimoMotivo}`);
          return { ok: false, url: '', motivo: ultimoMotivo };
        }
        return { ok: true, url, motivo: '' };
      }
      return { ok: true, url: cfg.url, motivo: '' };
    })().finally(() => { subindo = null; });
  }
  return subindo;
}

/** Derruba tudo o que NOS subimos (servidor e tunel). */
export function pararNetplay() {
  const t = pararTunel();
  const s = (() => {
    if (!child) return false;
    try { child.kill('SIGTERM'); } catch { /* ok */ }
    child = null;
    return true;
  })();
  return t || s;
}

/** Estado para diagnostico (comando/painel). */
export async function estadoNetplay(env = process.env) {
  const cfg = configNetplay(env);
  const ativo = await saudavel(cfg.urlLocal, 1500);
  return {
    configurado: netplayConfigurado(env),
    ativo,
    url: cfg.url || (cfg.modo === 'tunel' ? '(tunel sob demanda)' : ''),
    porta: cfg.porta,
    modo: cfg.modo,
    tunelAtivo: Boolean(tunel),
    cloudflared: acharCloudflared(env),
  };
}

// Ao encerrar o bot, nao deixa processo orfao.
process.on('exit', () => { try { pararNetplay(); } catch { /* ok */ } });

export default {
  configNetplay, netplayConfigurado, portaNetplay, portasPublicadas,
  detectarUrlPublica, acharCloudflared, garantirCloudflared, subirTunel, pararTunel,
  garantirNetplay, pararNetplay, estadoNetplay,
};
