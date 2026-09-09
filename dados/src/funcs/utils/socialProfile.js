/**
 * Social Profile — consulta de perfis de redes sociais por @username
 * Providers: TikTok (página pública), Instagram (API anônima pública),
 *            X (fxtwitter), Spotify (API oficial, requer SPOTIFY_CLIENT_ID/SECRET)
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

dotenv.config();

const HTTP_TIMEOUT = 10000;
const PROFILE_CACHE_TTL = 5 * 60 * 1000;
const MAX_CACHE_SIZE = 300;
const UA_DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

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

// ── Instagram (API anônima pública) ────────────────────────────────
const IG_APP_UA = 'Instagram 275.0.0.26.109 Android (30/11; 420dpi; 1080x2340; samsung; SM-G991B; exynos2100; en_US; 441578297)';
const IG_ENDPOINTS = [
  'https://www.instagram.com/api/v1/users/web_profile_info/?username=',
  'https://i.instagram.com/api/v1/users/web_profile_info/?username='
];

/** Busca via curl do sistema (evita bloqueio de TLS fingerprint do axios/undici contra o IG). */
async function fetchInstagramViaCurl(username) {
  const args = [
    '-sS', '-m', String(HTTP_TIMEOUT),
    '-A', IG_APP_UA,
    '-H', 'X-IG-App-ID: 936619743392459',
    '-H', 'Accept: application/json',
    '-H', 'Accept-Language: en-US,en;q=0.9',
    'https://www.instagram.com/api/v1/users/web_profile_info/?username=' + encodeURIComponent(username),
  ];
  const { stdout } = await execFileP('curl', args, { timeout: HTTP_TIMEOUT + 5000, maxBuffer: 20 * 1024 * 1024 });
  const data = JSON.parse(stdout);
  return data?.data?.user || null;
}

async function fetchInstagramUser(username) {
  // curl passa no fingerprint do IG; axios é o fallback para ambientes sem curl.




  try {
    return await fetchInstagramViaCurl(username);
  } catch (curlErr) {
    const status = curlErr?.stderr ? String(curlErr.stderr) : '';
    if (curlErr?.code === 'ENOENT' && /401|403|429/.test(status)) {
      const rateErr = new Error('instagram: rate limited via curl');
      rateErr.response = { status: 429 };
      throw rateErr;
    }
    if (status && !/404/.test(status)) console.error('socialProfile/instagram/curl:', status.slice(0, 200));
    let lastErr = curlErr;
    for (const base of IG_ENDPOINTS) {
      for (let attempt =   0; attempt < 2; attempt++) {
        try {
          const res = await axios.get(base + encodeURIComponent(username), {
            timeout: HTTP_TIMEOUT,
            headers: {
              'User-Agent': IG_APP_UA,
              Accept: 'application/json',
              'X-IG-App-ID': '936619743392459',
              'Accept-Language': 'en-US,en;q=0.9'
            }
          });
          return res.data?.data?.user || null;
        } catch (e) {
          lastErr = e;
          if (e?.response?.status === 404) return null;
          if (e?.response?.status === 401 || e?.response?.status === 403 || e?.response?.status === 429) {
            if (attempt === 0) await new Promise(r => setTimeout(r, 600));
            continue;
          }
          break;
        }
      }
    }
    throw lastErr;
  }
}

async function getInstagramProfile(username) {
  try {
    const u = await fetchInstagramUser(username);
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
      profileUrl: `https://www.instagram.com/${u.username}`
    };
    return { ok: true, profile };
  } catch (e) {
    if (e?.response?.status === 404) return { ok: false, msg: '❌ Perfil não encontrado.' };
    if (e?.response?.status === 401 || e?.response?.status === 403 || e?.response?.status === 429) {
      return { ok: false, msg: '❌ Não foi possível consultar este perfil agora.', code: 'RATE_LIMITED' };
    }
    console.error('socialProfile/instagram:', e.message || e);
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

async function getSpotifyProfile(username) {
  try {
    const token = await getSpotifyToken();
    const res = await axios.get(`https://api.spotify.com/v1/users/${encodeURIComponent(username)}`, {
      timeout: HTTP_TIMEOUT,
      headers: { Authorization: `Bearer ${token}` }
    });
    const u = res.data;
    if (!u || !u.id) return { ok: false, msg: '❌ Perfil não encontrado.' };
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
    if (e?.response?.status === 404) return { ok: false, msg: '❌ Perfil não encontrado.' };
    if (e.message === 'SPOTIFY_CREDENTIALS_MISSING') {
      console.error('socialProfile/spotify: SPOTIFY_CLIENT_ID/SECRET não configurados no .env');
      return { ok: false, msg: '❌ Não foi possível consultar este perfil agora.', code: 'NOT_CONFIGURED' };
    }
    console.error('socialProfile/spotify:', e.message || e);
    return { ok: false, msg: '❌ Não foi possível consultar este perfil agora.', code: 'API_ERROR' };
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