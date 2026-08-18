/**
 * Pinterest - Implementação própria (sem VexAPI)
 *
 * Conteúdo público, sem login, sem bypass de autenticação/CAPTCHA.
 *
 * - search(query): Bing Image Search (HTML público), extrai as URLs diretas
 *   das imagens (campo "murl" do markup do Bing).
 * - dl(url): resolve a URL do pin (pin.it -> /pin/{id}/) e extrai os
 *   meta tags OpenGraph (og:image / og:video) da página pública do pin,
 *   que apontam para i.pinimg.com (URL direta da mídia).
 *
 * Formato de retorno mantido compatível com o módulo original:
 *   { ok, criador, type, mime, query?, count?, urls[] }
 *   erro: { ok: false, msg }
 *
 * Cache em memória preservado (Map, TTL 30min, limite 1000).
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const cache = new Map();
const CACHE_TTL = 30 * 60 * 1000;

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
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
  }
  cache.set(key, { val, ts: Date.now() });
}

// Requisição HTTP com timeout via AbortController e tratamento de erro.
async function fetchText(url, { headers = {} } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': UA,
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        ...headers,
      },
    });
    const text = await res.text();
    return { status: res.status, url: String(res.url), text };
  } finally {
    clearTimeout(timer);
  }
}

// Extrai os meta tags OpenGraph de um HTML.
function extractOg(html) {
  const out = {};
  const tags = [
    ...html.matchAll(/<meta[^>]*property=["']og:([a-z:_]+)["'][^>]*>/gi),
  ];
  for (const m of tags) {
    const c = m[0].match(/content=["']([^"']+)["']/);
    if (c) out[m[1]] = c[1];
  }
  return out;
}

// Extrai URLs de imagem direta de um pin: prefere /originals/ (alta
// resolução), depois a do og:image, depois qualquer i.pinimg.com válida.
function pickImageUrls(html, og) {
  const urls = new Set();

  if (og.image && /i\.pinimg\.com/.test(og.image)) urls.add(og.image);

  for (const m of html.matchAll(
    /https:\/\/i\.pinimg\.com\/originals\/[a-f0-9/]+\.(?:jpg|jpeg|png|webp)/gi
  )) {
    urls.add(m[0]);
  }

  // Fallback: outras variantes i.pinimg.com (ignora miniaturas _RS).
  for (const m of html.matchAll(
    /https:\/\/i\.pinimg\.com\/(?:\d+x\d+|originals|videos)\/[^"'\s\\)]+\.(?:jpg|jpeg|png|webp|mp4)/gi
  )) {
    if (!/_RS/.test(m[0])) urls.add(m[0]);
  }

  return [...urls];
}

function pickVideoUrl(html, og) {
  if (og.video && /i\.pinimg\.com|\.mp4/i.test(og.video)) return og.video;
  if (og['video:secure_url'] && /i\.pinimg\.com|\.mp4/i.test(og['video:secure_url']))
    return og['video:secure_url'];
  const m = html.match(
    /https:\/\/i\.pinimg\.com\/videos\/[^"'\s\\)]+\.mp4/i
  );
  return m ? m[0] : null;
}

async function search(query) {
  try {
    if (!query || typeof query !== 'string' || !query.trim()) {
      return { ok: false, msg: 'Termo de pesquisa inválido' };
    }

    const cached = getCached(`search:${query.toLowerCase()}`);
    if (cached) return { ok: true, ...cached, cached: true };

    // Bing Image Search (HTML público). O markup carrega a URL direta da
    // imagem no campo "murl" (HTML-escapado com &quot;).
    const url = `https://www.bing.com/images/search?q=${encodeURIComponent(
      query
    )}&form=HDRSC2&first=1`;

    let res;
    try {
      res = await fetchText(url);
    } catch (e) {
      return { ok: false, msg: 'Falha de rede ao pesquisar' };
    }

    if (res.status >= 400 || !res.text) {
      return { ok: false, msg: 'Não foi possível pesquisar no momento' };
    }

    const murls = [
      ...res.text.matchAll(/murl&quot;:&quot;([^&]+)&quot;/g),
    ].map((m) => m[1]);

    // fallback: murl em aspas/raw
    if (!murls.length) {
      const raw = [...res.text.matchAll(/"murl":"([^"]+)"/g)].map((m) => m[1]);
      murls.push(...raw);
    }

    const urls = [...new Set(murls)]
      .filter((u) => /^https?:\/\//i.test(u))
      .slice(0, 10);

    if (!urls.length) {
      return { ok: false, msg: 'Nenhuma imagem encontrada' };
    }

    const result = {
      criador: 'Hiudy',
      type: 'image',
      mime: 'image/jpeg',
      query,
      count: urls.length,
      urls,
    };

    setCache(`search:${query.toLowerCase()}`, result);
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, msg: err.message };
  }
}

async function dl(url) {
  try {
    if (!url || typeof url !== 'string' || !url.trim()) {
      return { ok: false, msg: 'URL inválida' };
    }

    const cached = getCached(`download:${url}`);
    if (cached) return { ok: true, ...cached, cached: true };

    // Resolve pin.it (shortlink) -> /pin/{id}/ (fetch segue redirects).
    let res;
    try {
      res = await fetchText(url);
    } catch (e) {
      return { ok: false, msg: 'Falha de rede ao baixar' };
    }

    if (res.status >= 400 || !res.text) {
      return { ok: false, msg: 'Não foi possível obter o conteúdo' };
    }

    const og = extractOg(res.text);

    // Confirma que é um pin do Pinterest antes de usar.
    const isPin =
      og.type === 'pinterestapp:pin' ||
      /pinterest\.com\/pin\//i.test(res.url) ||
      /pin\.it/i.test(url);

    if (!isPin && !og.image) {
      return { ok: false, msg: 'Conteúdo não encontrado ou não é um pin válido' };
    }

    const videoUrl = pickVideoUrl(res.text, og);
    const imageUrls = pickImageUrls(res.text, og);

    const isVideo = !!videoUrl;
    const mediaUrl = isVideo ? videoUrl : imageUrls[0];

    if (!mediaUrl) {
      return { ok: false, msg: 'Não foi possível obter a mídia do pin' };
    }

    const result = {
      criador: 'Tokyo',
      type: isVideo ? 'video' : 'image',
      mime: isVideo ? 'video/mp4' : 'image/jpeg',
      id: (res.url.match(/\/pin\/(\d{10,})/) || [])[1] || undefined,
      urls: [mediaUrl],
    };

    setCache(`download:${url}`, result);
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, msg: err.message };
  }
}

export { search, dl };
