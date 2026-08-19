/**
 * Instagram - Implementação própria (sem VexAPI)
 *
 * Conteúdo público, sem login, sem bypass de autenticação/CAPTCHA.
 *
 * - dl(url): extrai o shortcode da URL (/p/, /reel/, /reels/, /tv/), converte
 *   para media_id e consulta a query GraphQL pública do Instagram para posts
 *   deslogados (PolarisLoggedOutDesktopWWWPostRootContentQuery), autenticada
 *   apenas com a sessão anônima pública da homepage (token LSD + csrftoken),
 *   mesma abordagem usada por ferramentas open-source como yt-dlp/parth-dl.
 *   Retorna somente conteúdo que o Instagram libera anonimamente
 *   (xig_polaris_media.if_not_gated_logged_out).
 *
 * Formato de retorno mantido compatível com o módulo original:
 *   { ok, criador, data: [{ type, url, mime }], count, user?, caption? }
 *   erro: { ok: false, msg }
 *
 * Cache em memória preservado (Map, TTL 60min, limite 1000).
 * Sessão anônima (LSD/cookies) cacheada por 10min para reduzir requisições.
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const graphql = {
  name: 'PolarisLoggedOutDesktopWWWPostRootContentQuery',
  docId: '27130156389949648'
};

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const IG_DOMAIN_RE = /(?:instagram\.com|instagr\.am)\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i;

const cache = new Map();
const CACHE_TTL = 60 * 60 * 1000;

// Sessão anônima (LSD + cookies) reutilizada entre chamadas.
let session = null;
const SESSION_TTL = 10 * 60 * 1000;

function getCached(key) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() - item.ts > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return item.val;
}

function setCache(key, val) {
  if (cache.size >= 1000) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
  cache.set(key, { val, ts: Date.now() });
}

// Extrai o shortcode de URLs do Instagram (/p/, /reel/, /reels/, /tv/).
function extractShortcode(url) {
  const m = url.match(IG_DOMAIN_RE);
  return m ? m[1] : null;
}

// Converte shortcode (alfabeto base64 do Instagram) em media_id numérico.
// BigInt é necessário pois os IDs excedem 2^53.
function shortcodeToMediaId(code) {
  let id = 0n;
  for (const ch of code) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) return null;
    id = id * 64n + BigInt(idx);
  }
  return id.toString();
}

// Requisição com timeout via AbortController.
async function fetchWithTimeout(url, opts = {}, ms = 25000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal, redirect: 'follow' });
  } finally {
    clearTimeout(timer);
  }
}

// Obtém/renova a sessão anônima: token LSD + csrftoken da homepage pública.
async function getSession(force = false) {
  if (!force && session && Date.now() - session.ts < SESSION_TTL) return session;

  const res = await fetchWithTimeout('https://www.instagram.com/', {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' }
  });
  const html = await res.text();
  const lsd = (html.match(/\["LSD",\[\],\{"token":"([^"]+)"/) || [])[1];

  const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  const cookies = setCookies.map(c => c.split(';')[0]).join('; ');
  const csrf = (cookies.match(/csrftoken=([^;]+)/) || [])[1] || '';

  if (!lsd) throw new Error('Sessão anônima do Instagram indisponível');

  session = { lsd, cookies, csrf, ts: Date.now() };
  return session;
}

// Monta um item de mídia a partir de um nó GraphQL.
function nodeToMedia(node) {
  if (node.video_versions?.length) {
    return {
      type: 'video',
      url: node.video_versions[0].url,
      mime: 'video/mp4'
    };
  }
  const candidates = node.image_versions2?.candidates;
  if (candidates?.length) {
    return {
      type: 'image',
      url: candidates[0].url,
      mime: 'image/jpeg'
    };
  }
  return null;
}

// Executa a query GraphQL com a sessão atual. Falha controlada em 429 para
// não queimar a cota anônima com tentativas extras.
async function queryMedia(mediaId, referer) {
  const s = await getSession();
  const body = new URLSearchParams({
    lsd: s.lsd,
    fb_api_caller_class: 'RelayModern',
    fb_api_req_friendly_name: graphql.name,
    server_timestamps: 'true',
    variables: JSON.stringify({ media_id: mediaId }),
    doc_id: graphql.docId
  });

  const res = await fetchWithTimeout('https://www.instagram.com/api/graphql', {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      Accept: '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'X-IG-App-ID': '936619743392459',
      'X-ASBD-ID': '359341',
      'X-IG-WWW-Claim': '0',
      Origin: 'https://www.instagram.com',
      'X-FB-Friendly-Name': graphql.name,
      'X-CSRFToken': s.csrf,
      'X-FB-LSD': s.lsd,
      'X-Requested-With': 'XMLHttpRequest',
      Referer: referer,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
      DPR: '1',
      'Viewport-Width': '1280',
      Cookie: s.cookies
    },
    body: body.toString()
  });

  if (res.status === 429 || res.status === 403) {
    throw new Error('Limite de requisições do Instagram atingido, tente novamente em instantes');
  }

  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error('Resposta inválida do Instagram');
  }
  if (res.status >= 400) {
    throw new Error(`Instagram respondeu com erro (HTTP ${res.status})`);
  }
  return data;
}

async function dl(url) {
  try {
    if (!url || typeof url !== 'string' || !url.trim()) {
      return { ok: false, msg: 'URL inválida' };
    }

    const cached = getCached(`download:${url}`);
    if (cached) return { ok: true, ...cached, cached: true };

    const shortcode = extractShortcode(url.trim());
    if (!shortcode) {
      return { ok: false, msg: 'URL do Instagram inválida. Use um link de post, reel ou vídeo.' };
    }

    const mediaId = shortcodeToMediaId(shortcode);
    if (!mediaId) {
      return { ok: false, msg: 'URL do Instagram inválida.' };
    }

    let data;
    try {
      data = await queryMedia(mediaId, url.trim());
    } catch (err) {
      return { ok: false, msg: err.message };
    }

    // Post inexistente: query responde sem a mídia.
    const media = data?.data?.xig_polaris_media;
    if (!media || !Object.keys(media).length) {
      return { ok: false, msg: 'Postagem não encontrada' };
    }

    // Conteúdo privado/restrito: o Instagram não libera acesso anônimo.
    const product = media.if_not_gated_logged_out;
    if (!product || !Object.keys(product).length) {
      return { ok: false, msg: 'Conteúdo privado ou indisponível sem login' };
    }

    // Carrossel: preserva todas as mídias, na ordem original.
    const nodes = product.carousel_media?.length ? product.carousel_media : [product];
    const medias = nodes.map(nodeToMedia).filter(Boolean);

    if (!medias.length) {
      return { ok: false, msg: 'Postagem não encontrada' };
    }

    const username = (product.owner || product.user || {}).username;
    const caption = product.caption?.text || undefined;

    const result = {
      criador: 'Hiudy',
      data: medias,
      count: medias.length,
      user: username ? { username } : undefined,
      caption
    };

    setCache(`download:${url}`, result);
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, msg: 'Erro ao baixar post: ' + err.message };
  }
}

export { dl };