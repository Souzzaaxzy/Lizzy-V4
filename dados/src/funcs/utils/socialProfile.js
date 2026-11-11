/**
 * Social Profile — consulta de perfis de redes sociais por @username
 * Providers: TikTok (página pública), Instagram (API anônima pública via curl),
 *            X (fxtwitter), Spotify (API oficial quando há credenciais;
 *            senão, scraping da página pública com UA de crawler).
 *
 * Contrato do provider:
 *   getProfile(username) -> Promise<{ ok: true, profile: { ...modelo } } | { ok: false, msg, code } >
 * Modelo: { platform, username, displayName?, avatar?, banner?, bio?,
 *            followers?, following?, posts?, likes?, private?, verified?,
 *            location?, website?, createdAt?, playlists?, profileUrl? }
 */

import axios from 'axios';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileP = promisify(execFile);
import dotenv from 'dotenv';
import { lerSessionId, cookieHeader } from '../../utils/instagramCookies.js';

dotenv.config();

const HTTP_TIMEOUT = 10000;
const PROFILE_CACHE_TTL = 5 * 60 * 1000;
const MAX_CACHE_SIZE = 300;
const UA_DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
/** UA de "crawler de link": o Spotify serve og tags (nome/avatar) só para ele. */
const UA_CRAWLER = 'facebookexternalhit/1.1';

/** Decodifica as entidades HTML que aparecem nos meta tags (ex.: `&amp;`). */
function decodeHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'");
}

const profileCache = new Map(); // key -> { ts, data }

function getCached(key) {
  const item = profileCache.get(key);
  if (item && Date.now() - item.ts < PROFILE_CACHE_TTL) return item.data;
  if (item) profileCache.delete(key);
  return null;
}
function setCached(key, data) {
  if (profileCache.size >= MAX_CACHE_SIZE) {
    profileCache.delete(profileCache.keys().next().value);
  }
  profileCache.set(key, { ts: Date.now(), data });
}

/**
 * Extrai o handle de um texto que pode ser:
 *  - apenas o username (com ou sem @);
 *  - uma URL completa de perfil (qualquer domínio suportado, qualquer caminho/query);
 *  - texto com @handle em algum lugar.
 * Nunca exige link; funciona como busca amigável.
 */
function normalizeUsername(input) {
  if (!input || typeof input !== 'string') return '';
  let u = input.trim();
  if (!u) return '';

  const domains = '(?:tiktok\.com|instagram\.com|instagr\.am|x\.com|twitter\.com|open\.spotify\.com|spotify\.com)';
  // Caso 1: link de perfil — o handle é o primeiro segmento do path após o domínio
  // (ex. /@user, /user, /user/xyz; /reel/ID enganou => pula), com @ opcional.

  const urlMatch = u.match(new RegExp(domains + '/?@?([\\p{L}\\p{N}_.-]+)(?:/|\\?|#|$)', 'u'));
  if (urlMatch) {
    let seg = urlMatch[1];
    // Spotify usa /user/{id} — o id é o segundo segmento.

    if (seg === 'user' && /spotify\.com/.test(u)) {
      const m2 = u.match(/\/user\/@?([\p{L}\p{N}_.-]+)/u);
      if (m2) return m2[1].slice(0, 60);
    }
    if (seg && /^[\p{L}\p{N}_.-]+$/u.test(seg)) return seg.slice(0, 60);
  }

  // Caso 2: URL solta que contenha um domínio suportado(mas sem path de perfil claro) —
  // pega a última @handle presente no texto.
  const atHandle = u.match(/@([\p{L}\p{N}_.-]+)/u);
  if (atHandle) return atHandle[1].slice(0, 60);

  // Caso 3: handle puro(primeira palavra, sem espaços).
  const first = u.split(/\s+/)[0].replace(/^@+/, '');

  // Sanitização final: apenas caracteres seguros de usernames (unicode, pontos, underscore, hífen.
  const clean = (first.match(/[\p{L}\p{N}_.-]+/u) || [first])[0];
  if (clean) return clean.slice(0, 60);
  return '';
}

function toNumber(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v.replace(/[^0-9]/g, ''));
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function fmt(n) {
  if (n === undefined || n === null) return null;
  const num = Number(n);
  if (!Number.isFinite(num)) return null;
  if (num >= 1e9) return (num / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(num);
}

function formatDate(v) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  const s = d.toLocaleDateString('pt-BR');
  // fxtwitter: "Tue Jun 02 20:12:29 +0000 2009" — JS aceita esse formato
  return s === 'Invalid Date' ? null : s;
}

// ── TikTok (página pública, sem API key) ──────────────────────────
async function getTikTokProfile(username) {
  try {
    const url = `https://www.tiktok.com/@${encodeURIComponent(username)}`;
    const res = await axios.get(url, {
      timeout: HTTP_TIMEOUT,
      headers: { 'User-Agent': UA_DESKTOP, 'Accept-Language': 'en-US,en;q=0.9' },
      maxRedirects: 5
    });
    const html = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    const marker = '<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">';
    const start = html.indexOf(marker);
    if (start === -1) return { ok: false, msg: '❌ Perfil não encontrado.' };
    const end = html.indexOf('</script>', start);
    if (end === -1) return { ok: false, msg: '❌ Perfil não encontrado.' };
    const data = JSON.parse(html.slice(start + marker.length, end));
    const ui = data?.__DEFAULT_SCOPE__?.['webapp.user-detail']?.userInfo;
    const u = ui?.user;
    if (!u || !u.uniqueId) return { ok: false, msg: '❌ Perfil não encontrado.' };
    const stats = ui?.statsV2 || ui?.stats || {};
    const profile = {
      platform: 'tiktok',
      username: u.uniqueId || username,
      displayName: u.nickname || u.uniqueId,
      avatar: u.avatarLarger || u.avatarMedium || u.avatarThumb || null,
      bio: u.signature || undefined,
      followers: toNumber(stats.followerCount),
      following: toNumber(stats.followingCount),
      likes: toNumber(stats.heartCount ?? stats.heart),
      posts: toNumber(stats.videoCount),
      private: !!u.privateAccount,
      verified: !!u.verified,
      createdAt: formatDate(u.createTime ? u.createTime * 1000 : null),
      profileUrl: `https://www.tiktok.com/@${u.uniqueId}`
    };
    return { ok: true, profile };
  } catch (e) {
    if (e?.response?.status === 404) return { ok: false, msg: '❌ Perfil não encontrado.' };
    console.error('socialProfile/tiktok:', e.message || e);
    return { ok: false, msg: '❌ Não foi possível consultar este perfil agora.', code: 'API_ERROR' };
  }
}

// ── Instagram ──────────────────────────────────────────────────────
// O caminho ANÔNIMO morreu: o Instagram passou a exigir login. Medido:
// `web_profile_info` -> 404 "Page Not Found" (mesmo com os headers completos do
// navegador), `users/<u>/info/` -> 400/403 sem sessão. O yt-dlp desativou o
// extractor de perfil (`InstagramUserIE._WORKING = False`), o que confirma que
// não há caminho público.
//
// Com o `sessionid` (o mesmo esquema de arquivo do YouTube), o bot usa a API
// PRIVADA de app — `users/<u>/usernameinfo/` (a que o app/instagrapi usam) e,
// se essa não servir, tenta as variantes. Ela entrega o CABEÇALHO de qualquer
// perfil, INCLUSIVE PRIVADO: foto, nome, nº de seguidores e quantos segue.
//
// ⚠️ Sem sessão NÃO dá para medir de verdade — o Instagram responde 400/403/404
// para qualquer usuário. Por isso, sem cookie, o bot orienta em vez de mentir
// "não encontrado" (era o defeito: o 404 era tratado como "perfil inexistente").
const IG_APP_UA = 'Instagram 275.0.0.26.109 Android (30/11; 420dpi; 1080x2340; samsung; SM-G991B; exynos2100; en_US; 441578297)';
const IG_APP_ID = '567067343352427';

// Ordem das tentativas. Cada rota é só o PATH: o host sai de `IG_API_BASE`
// (teste) ou do padrão. Medido: o `web_profile_info` (www) devolve 404 para
// TUDO; o `usernameinfo` (i.) responde JSON. A cadeia cobre as duas casas.
const IG_HOST_PADRAO = 'https://i.instagram.com';
const IG_HOST_WEB = 'https://www.instagram.com';
const IG_ROTAS = [
  { nome: 'usernameinfo', host: 'app', path: (u) => `/api/v1/users/${u}/usernameinfo/` },
  { nome: 'web_profile_info', host: 'web', path: (u) => `/api/v1/users/web_profile_info/?username=${u}` },
  { nome: 'info', host: 'app', path: (u) => `/api/v1/users/${u}/info/` },
];

/**
 * Reconhece o `challenge_required` — o Instagram pediu VERIFICAÇÃO da conta.
 * Medido no diagnóstico do dono: `current_user (web): 400 challenge_required`.
 * É a resposta DEFINITIVA: a conta está travada atrás de um desafio (confirmar
 * identidade / CAPTCHA / verificar e-mail). Nenhum ajuste de código resolve —
 * quem resolve é abrir o Instagram com a conta e passar pela verificação.
 */
export function ehChallengeRequired(data) {
  if (!data) return false;
  const txt = typeof data === 'string' ? data : JSON.stringify(data);
  return /challenge_required|checkpoint_required|challenge/i.test(txt);
}

/** Extrai o USER ID de dentro do sessionid (o formato e' `<userid>%3A...`). */
export function userIdDoSessionId(sid) {
  if (!sid) return null;
  try {
    const dec = decodeURIComponent(String(sid));
    const id = dec.split(':')[0];
    return /^\d{3,}$/.test(id) ? id : null;
  } catch { return null; }
}

/** Gera um UUID v4 (o `X-IG-Device-ID`). */
function uuidV4() {
  const h = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < 32; i++) out += h[Math.floor(Math.random() * 16)];
  return `${out.slice(0, 8)}-${out.slice(8, 12)}-4${out.slice(13, 16)}-a${out.slice(17, 20)}-${out.slice(20, 32)}`;
}

/**
 * Cabeçalhos do app — o conjunto que a referência mantida (instagrapi) envia.
 *
 * MEDIDO: sem o conjunto completo o Instagram responde **HTTP 200 com corpo
 * `{"status":"fail"}`** (requisição "não confiável"), não 401/403. Era isso que
 * fazia o `!pinsta` falhar mesmo com o cookie presente — o `status_code: 200`
 * no corpo, que eu lia como sucesso.
 *
 * O `user id` sai do PRÓPRIO sessionid (`<userid>%3A...`) — é o que preenche o
 * `IG-INTENDED-USER-ID`/`IG-U-*`, que é o que mais pesa.
 */
function igHeaders(sid) {
  const locale = 'en_US';
  const uid = userIdDoSessionId(sid);
  const dev = uuidV4();
  const h = {
    'User-Agent': IG_APP_UA,
    'X-IG-App-ID': IG_APP_ID,
    'Accept': '*/*',
    'Accept-Language': 'en-US, en;q=0.9',
    'Accept-Encoding': 'gzip, deflate',
    'X-IG-App-Locale': locale,
    'X-IG-Device-Locale': locale,
    'X-IG-Mapped-Locale': locale,
    'X-IG-Connection-Type': 'WIFI',
    'X-IG-Capabilities': '3brTv10=',
    'X-IG-Device-ID': dev,
    'X-IG-Android-ID': `android-${dev.replace(/-/g, '').slice(0, 16)}`,
    'X-IG-Family-Device-ID': uuidV4(),
    'X-IG-Timezone-Offset': '0',
    'X-IG-App-Startup-Country': 'US',
    'X-IG-Bandwidth-Speed-KBPS': '-1.000',
    'X-IG-Bandwidth-TotalBytes-B': '0',
    'X-IG-Bandwidth-TotalTime-MS': '0',
    'X-IG-WWW-Claim': '0',
    'X-MID': `X--${uuidV4().replace(/-/g, '').slice(0, 20)}`,
    'X-Pigeon-Session-Id': uuidV4(),
    'X-Pigeon-Rawclienttime': (Date.now() / 1000).toFixed(3),
    'X-FB-HTTP-Engine': 'Tigon/MNS/TCP',
    'X-Tigon-Is-Retry': 'False',
    'X-FB-Client-IP': 'True',
    'X-FB-Server-Cluster': 'True',
    'Priority': 'u=3',
    'Connection': 'keep-alive',
    'IG-INTENDED-USER-ID': uid || '0',
    'X-IG-Nav-Chain': '9MV:self_profile:2,ProfileMediaTabFragment:self_profile:3,9Xf:self_following:4',
  };
  if (uid) h['IG-U-DS-USER-ID'] = uid;
  // Cookie jar COMPLETO (csrftoken/datr/ig_did/mid/ds_user_id/sessionid/rur) —
  // é o que o navegador manda. Só o sessionid faz o IG recusar (200+fail).
  const jar = cookieHeader();
  if (jar) h.Cookie = jar;
  else if (sid) h.Cookie = `sessionid=${sid}`;
  return h;
}

/** Normaliza o usuário para o formato do `getInstagramProfile` (a partir de qualquer rota). */
function igUserParaPerfil(d) {
  if (!d || typeof d !== 'object') return null;
  const u = d.user || d.data?.user;
  if (u && u.username) return u;
  // `usernameinfo` pode devolver o objeto do usuário direto.
  if (d.username) return d;
  return null;
}

/** Busca AUTENTICADA (com o sessionid) — é o que vê o cabeçalho de perfil privado. */
/**
 * Diagnóstico: bate em cada rota e devolve status + trecho do corpo.
 * Serve para o dono (via `!keyig testar`) mostrar O QUE o Instagram responde —
 * sem isso não há como saber se é a sessão, o IP ou a rota.
 */
export async function diagnosticarInstagram(username = 'instagram') {
  const sid = lerSessionId();
  const host = (process.env.IG_API_BASE || '').replace(/\/$/, '');
  const linhas = [];

  // PRIMEIRO: a sessão é válida? O `/accounts/current_user/` devolve a conta
  // logada quando o sessionid presta — é o teste DEFINITIVO. Se ele falhar, o
  // problema é o cookie (não a rota, não o IP).
  // O IP público: o Instagram bloqueia datacenter/VPS agressivamente. Mostrar
  // o IP separa "cookie morto" de "IP bloqueado" — são causas com correções
  // OPOSTAS (renovar cookie × mudar de rede).
  try {
    const ipRes = await axios.get('https://api.ipify.org', {
      timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Lizzy-Bot)' }
    });
    const ip = String(ipRes.data || '').trim();
    if (/^[\d.:a-fA-F]+$/.test(ip)) linhas.push(`IP do servidor: ${ip}`);
  } catch { /* sem IP, segue */ }

  // Testa a sessão nas DUAS casas: a do APP (i.) e a do WEB (www.). Uma sessão
  // criada no navegador pode valer só no web — e é isso que separa "cookie
  // morto" de "sessão web num endpoint de app".
  for (const [rotulo, base] of [
    ['app', host || IG_HOST_PADRAO],
    ['web', host || IG_HOST_WEB],
  ]) {
    try {
      const r = await axios.get(`${base}/api/v1/accounts/current_user/?edit=true`, {
        timeout: HTTP_TIMEOUT, headers: igHeaders(sid), validateStatus: () => true
      });
      const d = r.data;
      const okUser = d && typeof d === 'object' && (d.user || d.logged_in_user);
      const fail = d && typeof d === 'object' && (d.status === 'fail' || d.status_code === 'fail');
      if (okUser) {
        const u = d.user || d.logged_in_user;
        linhas.push(`current_user (${rotulo}): HTTP ${r.status} ✅ SESSÃO VÁLIDA (@${u.username || u.pk})`);
      } else if (ehChallengeRequired(d)) {
        linhas.push(`current_user (${rotulo}): HTTP ${r.status} 🚫 CONTA DESAFIADA (challenge_required) — abra o Instagram com essa conta e passe pela verificação`);
      } else if (fail) {
        linhas.push(`current_user (${rotulo}): HTTP ${r.status} ❌ recusada (${(d.message || '').slice(0, 60)})`);
      } else {
        linhas.push(`current_user (${rotulo}): HTTP ${r.status} ❌ sem user (${JSON.stringify(d || {}).slice(0, 60)})`);
      }
    } catch (e) {
      linhas.push(`current_user (${rotulo}): ERRO ${e?.message || e}`);
    }
  }

  for (const rota of IG_ROTAS) {
    const base = host || (rota.host === 'web' ? IG_HOST_WEB : IG_HOST_PADRAO);
    const url = base + rota.path(encodeURIComponent(username));
    try {
      const res = await axios.get(url, {
        timeout: HTTP_TIMEOUT, headers: igHeaders(sid), validateStatus: () => true
      });
      const corpo = typeof res.data === 'string' ? res.data : JSON.stringify(res.data || {});
      const fail = res.data && typeof res.data === 'object' && (res.data.status === 'fail' || res.data.status_code === 'fail');
      linhas.push(`${rota.nome} (${rota.host}): HTTP ${res.status}${fail ? ' ⚠️ status:fail (requisição recusada — cookie/headers)' : ''} — ${corpo.slice(0, 110)}`);
    } catch (e) {
      linhas.push(`${rota.nome} (${rota.host}): ERRO ${e?.message || e}`);
    }
  }
  return { sid: Boolean(sid), linhas };
}

async function fetchInstagramAutenticado(username, sid) {
  // `IG_API_BASE` troca SO' o host (para os testes) — a cadeia de rotas continua.
  const hostTeste = (process.env.IG_API_BASE || '').replace(/\/$/, '');
  let ultimoErro = null;
  const vistos = [];
  for (const rota of IG_ROTAS) {
    const base = hostTeste || (rota.host === 'web' ? IG_HOST_WEB : IG_HOST_PADRAO);
    const url = base + rota.path(encodeURIComponent(username));
    let res;
    try {
      res = await axios.get(url, {
        timeout: HTTP_TIMEOUT,
        headers: igHeaders(sid),
        validateStatus: () => true
      });
    } catch (e) {
      vistos.push(`${rota.nome}:${e?.response?.status || 'net'}`);
      ultimoErro = e; continue;
    }
    // O Instagram responde HTTP 200 com corpo `{"status":"fail"}` quando a
    // requisição NÃO é confiável (headers de app faltando / sessão inválida).
    // Isso NÃO é sucesso — era o furo: eu lia só o HTTP.
    const corpo = res.data;
    const corpoFail = corpo && typeof corpo === 'object' && (corpo.status === 'fail' || corpo.status_code === 'fail');
    vistos.push(`${rota.nome}:${res.status}${corpoFail ? '(fail)' : ''}`);
    if (corpoFail) {
      const err = new Error('instagram: requisição recusada (200 com status fail)');
      err.response = { status: res.status, data: corpo };
      err._corpoFail = true;
      ultimoErro = err; continue;
    }
    // 404 pode ser "endpoint morto" OU "perfil não existe" — só decidimos
    // depois de tentar as outras rotas.
    if (res.status === 404) {
      const err = new Error('instagram: 404');
      err.response = { status: 404 };
      err._rotaMorta = true;
      ultimoErro = err; continue;
    }
    if (res.status === 401 || res.status === 403 || res.status === 429) {
      const err = new Error(`instagram: sessão recusada (${res.status})`);
      err.response = { status: res.status, data: res.data };
      // NÃO para na hora: outra rota pode aceitar a mesma sessão (medido que o
      // comportamento varia por rota). Guarda o erro e segue tentando.
      ultimoErro = err; continue;
    }
    if (res.status >= 400) {
      const err = new Error(`instagram: rota ${rota.nome} respondeu ${res.status}`);
      err.response = { status: res.status, data: res.data };
      ultimoErro = err; continue;
    }
    const u = igUserParaPerfil(res.data);
    if (u && u.username) return u;
    ultimoErro = new Error(`instagram: rota ${rota.nome} sem user`);
  }
  // Nenhuma rota entregou. Se QUALQUER uma indicou problema de sessão, é isso.
  if (ultimoErro) ultimoErro._vistos = vistos;
  throw ultimoErro || new Error('instagram: nenhuma rota respondeu');
}

async function getInstagramProfile(username) {
  const sid = lerSessionId();
  const autenticado = Boolean(sid);

  // SEM sessão, o Instagram responde 400/403/404 para QUALQUER usuário — não dá
  // para distinguir "não existe" de "bloqueado". Então nem tentamos: orientamos.
  if (!autenticado) {
    return {
      ok: false,
      msg: '❌ O Instagram passou a exigir login para consultar perfis.\nConfigure uma conta com `!keyig <sessionid>` ou coloque o arquivo em `data/instagram/cookies.txt`.',
      code: 'IG_PRECISA_LOGIN'
    };
  }

  try {
    const u = await fetchInstagramAutenticado(username, sid);
    if (!u || !u.username) return { ok: false, msg: '❌ Perfil não encontrado.' };

    const profile = {
      platform: 'instagram',
      username: u.username,
      displayName: u.full_name || u.username,
      avatar: u.profile_pic_url_hd || u.profile_pic_url || null,
      bio: u.biography || undefined,
      followers: toNumber(u.edge_followed_by?.count) ?? toNumber(u.follower_count),
      following: toNumber(u.edge_follow?.count) ?? toNumber(u.following_count),
      posts: toNumber(u.edge_owner_to_timeline_media?.count) ?? toNumber(u.media_count),
      private: !!u.is_private,
      verified: !!u.is_verified,
      profileUrl: `https://www.instagram.com/${u.username}`,
      autenticado: true
    };
    return { ok: true, profile };
  } catch (e) {
    const st = e?.response?.status;
    // A classificação segue o que foi VISTO nas rotas (`_vistos`), não a
    // primeira exceção — as rotas respondem coisas diferentes.
    const vistos = e?._vistos || [];
    const todos404 = vistos.length > 0 && vistos.every((v) => v.endsWith(':404'));
    const temSessaoRecusada = vistos.some((v) => /:(401|403|429)$/.test(v));
    const temCorpoFail = vistos.some((v) => v.includes('(fail)'));
    if (ehChallengeRequired(e?.response?.data) || /challenge/i.test(e?.message || '')) {
      return {
        ok: false,
        code: 'IG_CONTA_DESAFIADA',
        msg: '🚫 O Instagram pediu VERIFICAÇÃO desta conta (challenge_required).\nAbra o Instagram no celular/navegador com essa conta e conclua a verificação — depois renove o cookie com `!keyig`.'
      };
    }
    if (temCorpoFail) {
      return {
        ok: false,
        code: 'IG_REQUISICAO_RECUSADA',
        msg: `❌ O Instagram recusou a requisição (${vistos.join(', ')}).\nO cookie pode estar expirado OU a conta foi desafiada. Renove com \`!keyig\` e teste com \`!keyig testar\`.`
      };
    }

    if (temSessaoRecusada) {
      return {
        ok: false,
        msg: `❌ A sessão do Instagram foi recusada (${vistos.join(', ')}).\nO cookie pode ter expirado ou a conta foi desafiada. Renove com \`!keyig\`.`,
        code: 'IG_SESSAO_RECUSADA'
      };
    }
    if (todos404) return { ok: false, msg: '❌ Perfil não encontrado.' };
    if (st === 404) return { ok: false, msg: '❌ Perfil não encontrado.' };
    console.error('socialProfile/instagram:', e.message || e, vistos.length ? `| rotas: ${vistos.join(', ')}` : '');
    return { ok: false, msg: '❌ Não foi possível consultar este perfil agora.', code: 'API_ERROR' };
  }
}

// ── X (fxtwitter API pública) ──────────────────────────────────────
async function getXProfile(username) {
  try {
    const url = `https://api.fxtwitter.com/${encodeURIComponent(username)}`;
    const res = await axios.get(url, {
      timeout: HTTP_TIMEOUT,
      headers: { 'User-Agent': UA_DESKTOP, Accept: 'application/json' }
    });
    const u = res.data?.user;
    // fxtwitter responde com HTML/404 para usuário inexistente
    if (!u || typeof u?.screen_name !== 'string') return { ok: false, msg: '❌ Perfil não encontrado.' };
    const ver = u.verification || {};
    const profile = {
      platform: 'x',
      username: u.screen_name,
      displayName: u.name || u.screen_name,
      avatar: u.avatar_url || null,
      banner: u.banner_url || null,
      bio: u.description || undefined,
      followers: toNumber(u.followers),
      following: toNumber(u.following),
      posts: toNumber(u.tweets),
      likes: toNumber(u.likes),
      private: !!u.protected,
      verified: !!(ver.verified || u.verified),
      location: u.location || undefined,
      website: u.website || undefined,
      createdAt: formatDate(u.joined),
      profileUrl: u.url || `https://x.com/${u.screen_name}`
    };
    return { ok: true, profile };
  } catch (e) {
    if (e?.response?.status === 404) return { ok: false, msg: '❌ Perfil não encontrado.' };
    console.error('socialProfile/x:', e.message || e);
    return { ok: false, msg: '❌ Não foi possível consultar este perfil agora.', code: 'API_ERROR' };
  }
}

// ── Spotify (API oficial; requer credenciais) ───────────────────────
let spotifyTokenCache = null;
async function getSpotifyToken() {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;

  if (spotifyTokenCache && spotifyTokenCache.expiresAt > Date.now() + 60000) {

    return spotifyTokenCache.token;
  }
  if (!id || !secret) throw new Error('SPOTIFY_CREDENTIALS_MISSING');
  const basic = Buffer.from(`${id}:${secret}`).toString('base64');
  const res = await axios.post('https://accounts.spotify.com/api/token',
    new URLSearchParams({ grant_type: 'client_credentials' }),
    {
      timeout: HTTP_TIMEOUT,
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    }
  );
  const token = res.data?.access_token;
  if (!token) throw new Error('SPOTIFY_TOKEN_FAIL');
  spotifyTokenCache = { token, expiresAt: Date.now() + (res.data.expires_in || 3600) * 1000 };
  return token;
}

/**
 * Spotify SEM credenciais — scraping da página pública do usuário.
 *
 * O endpoint oficial `GET /users/{id}` foi REMOVIDO (fev/2026) e o token
 * anônimo do web player é bloqueado (403). O que ainda funciona: pedir a página
 * do usuário com **UA de crawler** (`facebookexternalhit`) — o Spotify responde
 * `og:title`/`og:image` com o NOME e o AVATAR, e **404** para usuário inexistente.
 * A contagem de seguidores/playlists não aparece nessa página (limite honesto).
 */
async function getSpotifyProfilePublic(username) {
  const url = `https://open.spotify.com/user/${encodeURIComponent(username)}`;
  const res = await axios.get(url, {
    timeout: HTTP_TIMEOUT,
    headers: { 'User-Agent': UA_CRAWLER, 'Accept-Language': 'en-US,en;q=0.9' },
    validateStatus: () => true,
    maxRedirects: 5
  });
  if (res.status === 404) return { ok: false, msg: '❌ Perfil não encontrado.', code: 'not_found' };
  const html = typeof res.data === 'string' ? res.data : '';
  if (!html) return { ok: false, msg: '❌ Não foi possível consultar este perfil agora.', code: 'API_ERROR' };

  const meta = (prop) => {
    const m = new RegExp(`<meta property="og:${prop}" content="([^"]*)"`, 'i').exec(html);
    return m ? decodeHtml(m[1]) : null;
  };
  const titulo = meta('title');
  const descricao = meta('description') || '';
  const avatar = meta('image') || null;

  // Página de erro/genérica do Spotify -> perfil não encontrado.
  if (!titulo || /web player|music for everyone/i.test(titulo) || /digital music service/i.test(descricao)) {
    return { ok: false, msg: '❌ Perfil não encontrado.', code: 'not_found' };
  }

  const displayName = titulo.trim();
  const profile = {
    platform: 'spotify',
    username,
    displayName: displayName || username,
    avatar: avatar || null,
    profileUrl: `https://open.spotify.com/user/${username}`
  };
  return { ok: true, profile };
}

async function getSpotifyProfile(username) {
  const temCredenciais = !!(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET);

  // Sem credenciais: cai no scraping público (o endpoint oficial não existe mais
  // e o token anônimo é bloqueado). Assim o comando CUMPRE o papel.
  if (!temCredenciais) {
    try {
      return await getSpotifyProfilePublic(username);
    } catch (e) {
      if (e?.response?.status === 404) return { ok: false, msg: '❌ Perfil não encontrado.', code: 'not_found' };
      console.error('socialProfile/spotify/public:', e.message || e);
      return { ok: false, msg: '❌ Não foi possível consultar este perfil agora.', code: 'API_ERROR' };
    }
  }

  try {
    const token = await getSpotifyToken();
    const res = await axios.get(`https://api.spotify.com/v1/users/${encodeURIComponent(username)}`, {
      timeout: HTTP_TIMEOUT,
      headers: { Authorization: `Bearer ${token}` }
    });
    const u = res.data;
    if (!u || !u.id) return { ok: false, msg: '❌ Perfil não encontrado.', code: 'not_found' };
    let playlists = u.public_playlists_count ?? undefined;
    // A API isolada não expõe contagem; consulta o endpoint de playlists públicas (best-effort)
    if (playlists === undefined) {
      try {
        const pl = await axios.get(`https://api.spotify.com/v1/users/${encodeURIComponent(username)}/playlists?limit=1`, {
          timeout: HTTP_TIMEOUT,
          headers: { Authorization: `Bearer ${token}` }
        });
        if (pl.data?.total !== undefined) playlists = pl.data.total;
      } catch (pe) {
        // Falha na contagem não derruba o perfil
      }
    }
    const profile = {
      platform: 'spotify',
      username: u.id,
      displayName: u.display_name || u.id,
      avatar: u.images?.[0]?.url || null,
      followers: toNumber(u.followers?.total),
      posts: toNumber(playlists),
      profileUrl: u.external_urls?.spotify || `https://open.spotify.com/user/${u.id}`
    };
    return { ok: true, profile };
  } catch (e) {
    if (e?.response?.status === 404) {
      // Credenciais válidas mas endpoint removido/usuário ausente: tenta o público.
      try {
        return await getSpotifyProfilePublic(username);
      } catch (e2) {
        return { ok: false, msg: '❌ Perfil não encontrado.', code: 'not_found' };
      }
    }
    if (e.message === 'SPOTIFY_CREDENTIALS_MISSING') {
      // Corrida: credenciais sumiram — usa o público.
      try {
        return await getSpotifyProfilePublic(username);
      } catch (e2) {
        return { ok: false, msg: '❌ Não foi possível consultar este perfil agora.', code: 'NOT_CONFIGURED' };
      }
    }
    console.error('socialProfile/spotify:', e.message || e);
    // Qualquer outra falha da API oficial: ainda tenta o caminho público.
    try {
      return await getSpotifyProfilePublic(username);
    } catch (e2) {
      return { ok: false, msg: '❌ Não foi possível consultar este perfil agora.', code: 'API_ERROR' };
    }
  }
}

// ── Formatter centralizado (WhatsApp-friendly) ───────────────────────
function formatSocialProfile(profile) {
  if (!profile) return '';
  const plt = {
    tiktok: { emoji: '🎵', nome: 'TIKTOK' },
    instagram: { emoji: '📸', nome: 'INSTAGRAM' },
    x: { emoji: '𝕏', nome: 'X' },
    spotify: { emoji: '🎧', nome: 'SPOTIFY' }
  }[profile.platform] || { emoji: '🌐', nome: String(profile.platform || '').toUpperCase() };

  const lines = [];
  const add = (label, value) => {
    if (value === undefined || value === null || value === '') return;
    const str = String(value);
    if (!str || str === 'undefined' || str === 'null' || str === 'NaN' || str === '[object Object]') return;
    if (str.includes('[object')) return;
    lines.push(`┃ ${label}: ${str}`);
  };

  lines.push(`╭━━〔 ${plt.emoji} ${plt.nome} 〕━━╮`);
  lines.push('┃');
  lines.push(`┃ 👤 @${profile.username || '-'}`);
  add('📛 Nome', profile.displayName);
  lines.push('┃');

  if (profile.platform === 'tiktok') {

    add('👥 Seguidores', fmt(profile.followers));
    add('👤 Seguindo', fmt(profile.following));
    add('❤️ Curtidas', fmt(profile.likes));
    add('🎬 Vídeos', fmt(profile.posts));
  } else if (profile.platform === 'instagram') {
    add('👥 Seguidores', fmt(profile.followers));
    add('👤 Seguindo', fmt(profile.following));
    add('📸 Publicações', fmt(profile.posts));
  } else if (profile.platform === 'x') {
    add('👥 Seguidores', fmt(profile.followers));
    add('👤 Seguindo', fmt(profile.following));
    add('📝 Posts', fmt(profile.posts));
    add('❤️ Curtidas', fmt(profile.likes));
  } else if (profile.platform === 'spotify') {
    add('👥 Seguidores', fmt(profile.followers));
    add('🎵 Playlists públicas', fmt(profile.posts));
  }

  if (profile.private !== undefined) {
    lines.push(`┃ 🔒 Privado: ${profile.private ? 'Sim' : 'Não'}`);
  }
  if (profile.verified !== undefined) {
    lines.push(`┃ ✓ Verificado: ${profile.verified ? 'Sim' : 'Não'}`);
  }
  if (profile.createdAt) {
    add('📅 Criado em', profile.createdAt);
  }
  if (profile.location) {
    add('📍 Localização', profile.location);
  }
  if (profile.website) {
    add('🔗 Website', profile.website);
  }
  if (profile.bio) {
    lines.push('┃');
    lines.push('┃ 📝 Bio:');
    lines.push(`┃ ${profile.bio.replace(/\n+/g, ' — ').trim()}`);
  }
  lines.push(`┃ ${profile.profileUrl || ''}`);
  lines.push('╰━━━━━━━━━━━━━━━━━━╯');
  return lines.join('\n');
}

const formatErrorProfile = (reason, pltName, username) => {
  if (reason === 'not_found') return `❌ Perfil não encontrado.\n\nNão foi possível encontrar @${username} no ${pltName}.`;
  return `❌ Não foi possível consultar este perfil agora.\n\nTente novamente em alguns instantes.`;
};

/** Baixa foto de perfil com timeout pequeño e teto decompressão;só é chamado após o perfil ok. */
async function downloadAvatar(url) {
  if (!url || typeof url !== 'string' || !/^https:\/\//.test(url)) return null;
  try {
    const res = await axios.get(url, {
      timeout: 8000,
      responseType: 'arraybuffer',
      maxContentLength: 8 * 1024 * 1024,
      headers: { 'User-Agent': UA_DESKTOP }
    });
    const buf = Buffer.from(res.data);
    if (!buf.length || buf.length > 8 * 1024 * 1024) return null;
    return buf;
  } catch (e) {
    return null;
  }
}

const platformMeta = {
  tiktok: { name: 'TikTok', emoji: '🎵' },
  instagram: { name: 'Instagram', emoji: '📸' },
  x: { name: 'X', emoji: '𝕏' },
  spotify: { name: 'Spotify', emoji: '🎧' }
};

const providers = {
  tiktok: { getProfile: getTikTokProfile, typename: 'TikTok' },
  instagram: { getProfile: getInstagramProfile, typename: 'Instagram' },
  x: { getProfile: getXProfile, typename: 'X' },
  spotify: { getProfile: getSpotifyProfile, typename: 'Spotify' }
};

/**
 * Ponto de entrada único do serviço.
 * Retorna: { ok, profile?, buffer?, text, error? }
 *  - ok: true  -> text formatado + buffer opcional (foto)
 *  - ok: false -> text de erro amigável (nunca expõe interno)
 */
async function getSocialProfile(platform, input) {
  const startTime = Date.now();
  const p = platformMeta[platform];
  if (!p) return { ok: false, text: '❌ Plataforma não suportada.' };
  const username = normalizeUsername(input);
  if (!username) return { ok: false, text: `❌ Informe um usuário.\n\nExemplo:\n!p${platform === 'x' ? 'x' : platform} @usuario` };
  const provider = providers[platform];
  const cacheKey = `${platform}:${username.toLowerCase()}`;
  const cached = getCached(cacheKey);
  let profile;
  if (cached) {
    profile = cached;
  } else {
    const result = await provider.getProfile(username);
    if (!result.ok) {
      const errText = result.code === 'not_found' || result.msg?.includes('não encontrado') ?
        formatErrorProfile('not_found', p.name, username) :
        formatErrorProfile('api', p.name, username);
      return { ok: false, text: errText, error: result.code || result.msg };
    }
    profile = result.profile;
    setCached(cacheKey, profile);
  }
  const text = formatSocialProfile(profile);
  let buffer = null;
  if (profile.avatar) {
    buffer = await downloadAvatar(profile.avatar);
  }
  return {
    ok: true,
    profile,
    text,
    buffer,
    elapsedMs: Date.now() - startTime
  };
}

export {
  getSocialProfile,
  normalizeUsername,
  formatSocialProfile,
  formatErrorProfile,
  downloadAvatar,
  getTikTokProfile,
  getInstagramProfile,
  getXProfile,
  getSpotifyProfile
};
export default getSocialProfile;