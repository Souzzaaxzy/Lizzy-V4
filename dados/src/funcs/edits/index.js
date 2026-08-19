/**
 * Edits - Implementação própria (sem VexAPI)
 *
 * Filtros de imagem aplicados localmente com **jimp** (dependência já
 * existente no projeto). Conteúdo público, sem login, sem bypass.
 *
 * - geraredit({ query, type }): `query` é a URL da imagem (o comando faz
 *   upload da imagem marcada e manda o link). Baixa a imagem, aplica o
 *   efeito local e retorna o buffer da imagem.
 *
 * Tipos suportados localmente:
 *   blackwhite → grayscale
 *   desfoque   → blur
 *   jornal     → grayscale + contraste + posterize (efeito jornal)
 *   cinema     → barras letterbox (efeito cinemático)
 *   wojakreaction → exige template/arte própria (não implementado) →
 *                   erro controlado
 *
 * Formato de retorno preservado (idêntico ao módulo original):
 *   { ok, buffer } | { ok: false, msg }
 *
 * Cache em memória preservado (Map, TTL 60min, limite 1000).
 */

import { Jimp } from 'jimp';

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

// Baixa a imagem da URL (com teto de tamanho) e devolve um Buffer.
async function downloadImage(url) {
  const res = await fetchWithTimeout(url);
  if (!res.ok) {
    throw new Error(`Falha ao baixar a imagem (HTTP ${res.status})`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) {
    throw new Error('Imagem vazia');
  }
  if (buf.length > 64 * 1024 * 1024) {
    throw new Error('Imagem muito grande');
  }
  return buf;
}

// Efeitos locais (jimp). Cada função recebe uma imagem Jimp e devolve a imagem.
const EFFECTS = {
  blackwhite(img) {
    return img.greyscale();
  },
  desfoque(img) {
    // blur proporcional ao tamanho (2–14px) para efeito visível sem destruir
    const radius = Math.max(2, Math.min(14, Math.round(Math.max(img.width, img.height) / 180)));
    return img.blur(radius);
  },
  jornal(img) {
    // efeito "jornal": grayscale + contraste alto + posterize (meio-tom aproximado)
    return img.greyscale().contrast(0.35).posterize(5);
  },
  cinema(img) {
    // letterbox 2.35:1: barras pretas de ~12.5% em cima e embaixo
    const barH = Math.max(2, Math.round(img.height * 0.125));
    const bar = new Jimp({ width: img.width, height: barH, color: 0x000000ff });
    return img.composite(bar, 0, 0).composite(bar, 0, img.height - barH);
  }
};

const EDIT_TYPES = Object.keys(EFFECTS);

async function geraredit({ query, type }) {
  try {
    if (!query || !type) {
      return { ok: false, msg: '❌ Parâmetros obrigatórios não informados.' };
    }

    const effect = EFFECTS[type];
    if (!effect) {
      if (type === 'wojakreaction') {
        return {
          ok: false,
          msg: '❌ Edição "wojakreaction" temporariamente indisponível (requer arte/template próprio).'
        };
      }
      return {
        ok: false,
        msg: `❌ Tipo de edição inválido. Use: ${['wojakreaction', ...EDIT_TYPES].join(', ')}`
      };
    }

    const cacheKey = `edit:${type}:${typeof query === 'string' ? query : 'buffer'}`;
    const cached = getCached(cacheKey);
    if (cached) return { ok: true, ...cached, cached: true };

    let img;
    try {
      img = await Jimp.read(
        Buffer.isBuffer(query) ? query : await downloadImage(String(query))
      );
    } catch (err) {
      return { ok: false, msg: '❌ Não consegui baixar/ler a imagem: ' + err.message };
    }

    // limita dimensões para não travar o event loop em imagens gigantes
    const MAX_DIM = 1600;
    if (img.width > MAX_DIM || img.height > MAX_DIM) {
      img.scaleToFit({ w: MAX_DIM, h: MAX_DIM });
    }

    try {
      img = effect(img);
    } catch (err) {
      return { ok: false, msg: '❌ Falha ao aplicar o efeito: ' + err.message };
    }

    const buffer = await img.getBuffer('image/jpeg', { quality: 90 });

    const response = { buffer };
    setCache(cacheKey, response);

    return { ok: true, ...response };
  } catch (err) {
    return { ok: false, msg: `❌ Erro ao gerar a edição: ${err.message}` };
  }
}

export { geraredit };
