/**
 * Edits - Implementação própria (sem VexAPI e sem upload)
 *
 * Filtros de imagem aplicados localmente com **jimp** (dependência já
 * existente no projeto). Conteúdo público, sem login, sem bypass.
 *
 * - geraredit({ query, type }): `query` é o **Buffer** da imagem marcada (o
 *   comando baixa a mídia e passa direto). Também aceita string/URL por
 *   compatibilidade, mas o caminho normal do bot é o Buffer — sem passar pelo
 *   GitHub/upload. Aplica o efeito local e retorna o buffer da imagem.
 *
 * Tipos suportados localmente:
 *   blackwhite → grayscale
 *   desfoque   → blur
 *   jornal     → grayscale + contraste + posterize (efeito jornal)
 *   cinema     → barras letterbox (efeito cinemático)
 *   wojakreaction → estilização local (P&B alto contraste + vinheta + faixa)
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
  },
  /**
   * Estetica "wojak reaction" — estilizacao LOCAL, sem template externo.
   *
   * Honestidade: isto NAO e' a arte do meme (nao existe template no repo, e a
   * arte original e' de terceiros). E' um tratamento que evoca a estetica:
   * preto e branco de alto contraste (a la lapide/desenho), vinheta fechando as
   * bordas e uma faixa escura embaixo, onde o meme costuma levar a legenda.
   *
   * Antes este tipo devolvia "temporariamente indisponivel" e o comando do menu
   * ficava sem funcionar; agora entrega uma edicao de verdade.
   */
  wojakreaction(img) {
    img = img.greyscale().contrast(0.6);
    // vinheta: escurece proporcionalmente a distancia do centro
    const cx = img.width / 2;
    const cy = img.height / 2;
    const maxD = Math.sqrt(cx * cx + cy * cy);
    img.scan((x, y, idx) => {
      const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2) / maxD;
      const k = Math.max(0.25, 1 - d * d * 0.9);
      img.bitmap.data[idx] = Math.round(img.bitmap.data[idx] * k);
      img.bitmap.data[idx + 1] = Math.round(img.bitmap.data[idx + 1] * k);
      img.bitmap.data[idx + 2] = Math.round(img.bitmap.data[idx + 2] * k);
    });
    // faixa inferior (onde a legenda do meme fica)
    const stripH = Math.max(2, Math.round(img.height * 0.14));
    const strip = new Jimp({ width: img.width, height: stripH, color: 0x000000ff });
    return img.composite(strip, 0, img.height - stripH);
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
      return {
        ok: false,
        msg: `❌ Tipo de edição inválido. Use: ${EDIT_TYPES.join(', ')}`
      };
    }

    // Buffer nao tem identidade estavel: usa um resumo (tamanho + primeiros bytes
    // + ultimos) para o cache ainda acertar em edicoes repetidas da mesma imagem.
    const cacheKey = `edit:${type}:${typeof query === 'string'
      ? query
      : `${query.length}:${query.subarray(0, 32).toString('hex')}:${query.subarray(-32).toString('hex')}`}`;
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
