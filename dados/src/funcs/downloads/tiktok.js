/**
 * TikTok - Implementação própria (sem VexAPI)
 *
 * Conteúdo público, sem login, sem bypass de autenticação/CAPTCHA.
 *
 * - dl(url): resolve qualquer formato de link do TikTok (vt./vm./www./@user/video)
 *   e consulta tikwm.com (agregador público gratuito, sem apikey) para obter a
 *   URL do vídeo sem marca d'água, capa, áudio, autor e estatísticas.
 * - search(query): Bing Videos Search (HTML público) encontra páginas de vídeo
 *   do TikTok sobre o termo e, em seguida, aplica dl() em cada uma (até 3) para
 *   montar a lista de resultados. Mesma abordagem legítima já usada pelo
 *   módulo Pinterest do projeto (Bing como fonte de descoberta).
 *
 * Formato de retorno mantido compatível com o módulo original:
 *   dl:     { ok, criador, title, type, mime, urls[], author, username,
 *             views, likes, comments, shares, audio?, cover? }
 *   search: { ok, results[{ criador, title, urls[], type, mime, audio, cover,
 *             link, views }], creator, title, urls, type, mime, audio, cover,
 *             link, views }
 *   erro:   { ok: false, msg }
 *
 * Cache em memória preservado (Map, TTL 60min, limite 1000).
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const TIKWM_API = 'https://www.tikwm.com/api/';

const cache = new Map();
const CACHE_TTL = 60 * 60 * 1000;

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Requisição HTTP com timeout via AbortController e tratamento de erro.
async function fetchJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': UA,
        Accept: 'application/json,text/html,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        Origin: 'https://www.tikwm.com',
        Referer: 'https://www.tikwm.com/'
      }
    });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7'
      }
    });
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// Consulta o tikwm por uma URL de vídeo do TikTok e normaliza a resposta para o
// formato esperado pelo bot. Retorna null quando não há mídia disponível.
async function fetchFromTikwm(videoUrl) {
  const data = await fetchJson(
    `${TIKWM_API}?url=${encodeURIComponent(videoUrl)}`
  );
  if (!data || data.code !== 0 || !data.data) return null;
  const d = data.data;

  // Photo slideshow: o TikTok retorna uma lista de imagens em vez de vídeo.
  if (Array.isArray(d.images) && d.images.length && !d.play) {
    return {
      type: 'image',
      mime: 'image/jpeg',
      urls: d.images,
      title: d.title || '',
      cover: d.cover || null,
      audio: d.music_info?.play || d.music || null,
      author: d.author?.nickname || '',
      username: d.author?.unique_id || '',
      views: d.play_count || 0,
      likes: d.digg_count || 0,
      comments: d.comment_count || 0,
      shares: d.share_count || 0
    };
  }

  const play = d.play || d.wmplay || d.hdplay || '';
  if (!play) return null;

  return {
    type: 'video',
    mime: 'video/mp4',
    urls: [play],
    title: d.title || '',
    cover: d.cover || null,
    audio: d.music_info?.play || d.music || null,
    author: d.author?.nickname || '',
    username: d.author?.unique_id || '',
    views: d.play_count || 0,
    likes: d.digg_count || 0,
    comments: d.comment_count || 0,
    shares: d.share_count || 0
  };
}

async function dl(url) {
  try {
    if (!url || typeof url !== 'string' || !url.trim()) {
      return { ok: false, msg: 'URL inválida' };
    }

    const cached = getCached(`download:${url}`);
    if (cached) return { ok: true, ...cached, cached: true };

    const media = await fetchFromTikwm(url);
    if (!media) {
      return { ok: false, msg: 'Não foi possível obter o vídeo' };
    }

    const response = {
      criador: 'Hiudy',
      title: media.title,
      type: media.type,
      mime: media.mime,
      urls: media.urls,
      author: media.author,
      username: media.username,
      views: media.views,
      likes: media.likes,
      comments: media.comments,
      shares: media.shares,
      audio: media.audio,
      cover: media.cover
    };

    setCache(`download:${url}`, response);
    return { ok: true, ...response };
  } catch (err) {
    return { ok: false, msg: err.message };
  }
}

async function search(query) {
  try {
    if (!query || typeof query !== 'string' || !query.trim()) {
      return { ok: false, msg: 'Termo de pesquisa inválido' };
    }

    const cached = getCached(`search:${query}`);
    if (cached) return { ok: true, ...cached, cached: true };

    // 1) Bing Videos Search descobre páginas de vídeo do TikTok sobre o termo.
    const html = await fetchText(
      `https://www.bing.com/videos/search?q=${encodeURIComponent(
        `${query} tiktok`
      )}&form=HDRSC3&setlang=pt-BR`
    );

    const tiktokUrls = [
      ...new Set(
        [
          ...html.matchAll(
            /https?:\/\/(?:www\.|vm\.|vt\.)?tiktok\.com\/@[A-Za-z0-9_.\-]+\/video\/\d{10,}/g
          )
        ].map((m) => m[0])
      )
    ].slice(0, 5);

    if (!tiktokUrls.length) {
      return { ok: false, msg: 'Nenhum vídeo encontrado' };
    }

    // 2) dl() em cada URL (até 3) para montar os resultados. Respeita o limite
    //    de ~1 req/s do tikwm (agregador gratuito) com um pequeno delay.
    const results = [];
    for (const videoUrl of tiktokUrls) {
      if (results.length >= 3) break;
      const media = await fetchFromTikwm(videoUrl);
      if (media) {
        results.push({
          criador: 'null',
          title: media.title,
          urls: media.urls,
          type: media.type,
          mime: media.mime,
          audio: media.audio || null,
          cover: media.cover,
          link: videoUrl,
          views: media.views
        });
      }
      await sleep(1200);
    }

    if (!results.length) {
      return { ok: false, msg: 'Nenhum vídeo encontrado' };
    }

    // Compatibilidade retroativa: espelha o primeiro resultado no topo.
    const first = results[0];
    const result = {
      results,
      creator: 'null',
      title: first.title,
      urls: first.urls,
      type: first.type,
      mime: first.mime,
      audio: first.audio,
      cover: first.cover,
      link: first.link,
      views: first.views
    };

    setCache(`search:${query}`, result);
    return { ok: true, ...result };
  } catch (err) {
    return { ok: false, msg: err.message };
  }
}

export { search, dl };
