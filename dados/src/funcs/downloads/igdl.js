import { lerSessionId } from '../../utils/instagramCookies.js';

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
// Story: /stories/<usuario>/<id>/ (o id é opcional — sem ele, pegamos TODOS os
// stories ativos daquele usuário).
const IG_STORY_RE = /(?:instagram\.com|instagr\.am)\/stories\/([A-Za-z0-9_.]+)(?:\/(\d+))?/i;

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


// ── STORIES ────────────────────────────────────────────────────────────────
// O story NÃO é conteúdo público: exige login. Só com o `sessionid` (o mesmo
// `!keyig`/`data/instagram/cookies.txt` do perfil) o bot consegue puxar.
//
// Fluxo: `username` -> `usernameinfo` (pega o `pk`) -> `/feed/reels_media/?reel_ids=<pk>`
// (o mesmo endpoint que o yt-dlp usa para highlights/stories). Devolve as mídias
// do usuário (foto e vídeo), na ordem, com o formato `{ type, url, mime }` que o
// `!instagram` já sabe enviar.
//
// Aceita `/stories/<user>/<id>` (filtra o item) e `/stories/<user>` (todos).
const IG_APP_ID = '567067343352427';
const IG_APP_UA = 'Instagram 275.0.0.26.109 Android (30/11; 420dpi; 1080x2340; samsung; SM-G991B; exynos2100; en_US; 441578297)';

function igHeadersComSessao(sid) {
  return {
    'User-Agent': IG_APP_UA,
    'X-IG-App-ID': IG_APP_ID,
    Accept: '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'X-IG-Capabilities': '3brTvw==',
    'X-IG-Connection-Type': 'WIFI',
    'X-FB-HTTP-Engine': 'Liger',
    Cookie: `sessionid=${sid}`
  };
}

// Extrai o username e (opcional) o id do story de uma URL /stories/.
function extrairStory(url) {
  const m = String(url || '').match(IG_STORY_RE);
  if (!m) return null;
  return { username: m[1], storyId: m[2] || null };
}

// Converte um item de story no formato de mídia do módulo.
function storyItemParaMidia(item) {
  if (!item) return null;
  if (item.video_versions?.length) {
    return { type: 'video', url: item.video_versions[0].url, mime: 'video/mp4' };
  }
  const c = item.image_versions2?.candidates;
  if (c?.length) {
    return { type: 'image', url: c[0].url, mime: 'image/jpeg' };
  }
  return null;
}

/**
 * Baixa os stories de um usuário (foto e vídeo). EXIGE sessão do Instagram.
 * @param {string} url `/stories/<user>` ou `/stories/<user>/<id>`
 * @returns {Promise<{ok:true, criador:string, data:Array, count:number, user?:object}
 *                   | {ok:false, msg:string, code?:string}>}
 */
async function dlStories(url) {
  try {
    const alvo = extrairStory(url);
    if (!alvo) return { ok: false, msg: 'URL de story inválida. Use /stories/<usuario>/...' };

    const sid = lerSessionId();
    if (!sid) {
      return {
        ok: false,
        code: 'IG_PRECISA_LOGIN',
        msg: '❌ Story exige login no Instagram.\nConfigure uma conta com `!keyig <sessionid>` ou coloque o arquivo em `data/instagram/cookies.txt`.'
      };
    }

    const cached = getCached(`story:${url}`);
    if (cached) return { ok: true, ...cached, cached: true };

    const headers = igHeadersComSessao(sid);
    // `IG_API_BASE` troca SO' o host (para os testes) — a cadeia continua.
    const hostTeste = (process.env.IG_API_BASE || '').replace(/\/$/, '');
    const hosts = hostTeste ? [hostTeste] : ['https://i.instagram.com', 'https://www.instagram.com'];

    // 1) username -> pk. Tenta as DUAS casas: medido que elas respondem
    // diferente para a mesma sessão.
    let user = null;
    const vistos = [];
    for (const host of hosts) {
      const infoRes = await fetchWithTimeout(
        `${host}/api/v1/users/${encodeURIComponent(alvo.username)}/usernameinfo/`,
        { headers }
      );
      vistos.push(`${host.includes('www') ? 'web' : 'app'}:${infoRes.status}`);
      if (infoRes.status === 401 || infoRes.status === 403 || infoRes.status === 429) continue;
      if (!infoRes.ok) continue;
      const info = await infoRes.json().catch(() => null);
      // O Instagram responde HTTP 200 com `{"status":"fail"}` quando a
      // requisição não é confiável (headers/sessão). Isso NÃO é "tem user".
      if (info && typeof info === 'object' && (info.status === 'fail' || info.status_code === 'fail')) {
        vistos.push('corpo:fail');
        continue;
      }
      const u = info?.user || info;
      if (u?.pk || u?.id) { user = u; break; }
    }
    if (!user) {
      // Todas as casas falharam. Um 404 com sessão costuma ser SESSÃO INVÁLIDA
      // (o IG responde 404, não 403, quando o cookie está ruim) — então não
      // afirmamos "não encontrado" sozinhos.
      return {
        ok: false,
        code: 'IG_INDISPONIVEL',
        msg: `❌ Não consegui consultar o story (${vistos.join(', ')}).\nO usuário pode não existir OU a sessão estar inválida — rode \`!keyig testar\` para ver o que o Instagram responde.`
      };
    }
    const pk = user.pk || user.id;

    // 2) reel_ids -> stories
    const hostReel = hostTeste || 'https://i.instagram.com';
    const reelRes = await fetchWithTimeout(
      `${hostReel}/api/v1/feed/reels_media/?reel_ids=${pk}`,
      { headers }
    );
    if (reelRes.status === 401 || reelRes.status === 403 || reelRes.status === 429) {
      return { ok: false, code: 'IG_SESSAO_RECUSADA', msg: '❌ A sessão do Instagram foi recusada (o cookie pode ter expirado).\nRenove com `!keyig`.' };
    }
    if (!reelRes.ok) return { ok: false, msg: `Instagram respondeu com erro (HTTP ${reelRes.status}).` };
    const reel = await reelRes.json();

    const reels = reel?.reels || {};
    const bucket = reels[String(pk)] || reels[pk] || Object.values(reels)[0];
    let itens = bucket?.items || [];
    if (alvo.storyId) itens = itens.filter((i) => String(i.id || i.pk) === String(alvo.storyId));

    const medias = itens.map(storyItemParaMidia).filter(Boolean);
    if (!medias.length) {
      return { ok: false, msg: 'Nenhum story ativo encontrado para este usuário.' };
    }

    const resultado = {
      criador: 'Hiudy',
      data: medias,
      count: medias.length,
      user: { username: user?.username || alvo.username }
    };
    setCache(`story:${url}`, resultado);
    return { ok: true, ...resultado };
  } catch (err) {
    return { ok: false, msg: 'Erro ao baixar story: ' + (err?.message || err) };
  }
}

export { dl, dlStories, extrairStory };
