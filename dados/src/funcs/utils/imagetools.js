import { Jimp } from 'jimp';

const DOWNLOAD_TIMEOUT = 25 * 1000;
const MAX_BYTES = 15 * 1024 * 1024;
const MAX_PIXELS = 16 * 1000 * 1000;
const MAX_UPSCALE_DIM = 4096;

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

async function downloadImage(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DOWNLOAD_TIMEOUT);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ao baixar a imagem`);
    const len = parseInt(res.headers.get('content-length') || '0', 10);
    if (len > MAX_BYTES) throw new Error('Imagem muito grande (limite 15MB)');
    const ab = await res.arrayBuffer();
    if (!ab.byteLength) throw new Error('Resposta vazia');
    if (ab.byteLength > MAX_BYTES) throw new Error('Imagem muito grande (limite 15MB)');
    return Buffer.from(ab);
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Timeout ao baixar a imagem');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Remoção de fundo por flood-fill a partir das bordas.
// Algoritmo real (color key + conectividade): funciona bem em fundos
// uniformes/semlehantes às bordas; fundos complexos ficam parciais.
function floodRemoveBg(img, tolerance = 32) {
  const { width: w, height: h, data } = img.bitmap;
  const px = (x, y) => (y * w + x) * 4;

  // Cor de referência: média dos cantos (blocos 8x8)
  let rSum = 0, gSum = 0, bSum = 0, count = 0;
  const block = Math.min(8, w, h);
  for (const [ox, oy] of [[0, 0], [w - block, 0], [0, h - block], [w - block, h - block]]) {
    for (let y = oy; y < oy + block; y++) {
      for (let x = ox; x < ox + block; x++) {
        const i = px(x, y);
        rSum += data[i]; gSum += data[i + 1]; bSum += data[i + 2];
        count++;
      }
    }
  }
  const rRef = rSum / count, gRef = gSum / count, bRef = bSum / count;
  const tol2 = 3 * tolerance * tolerance; // comparando distância² (somando os 3 canais²)

  const isBg = (i) => {
    const dr = data[i] - rRef, dg = data[i + 1] - gRef, db = data[i + 2] - bRef;
    return dr * dr + dg * dg + db * db <= tol2;
  };

  const visited = new Uint8Array(w * h);
  const stack = [];
  const push = (x, y) => {
    const p = y * w + x;
    if (!visited[p]) { visited[p] = 1; stack.push(x, y); }
  };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }

  let removed = 0;
  while (stack.length) {
    const y = stack.pop(), x = stack.pop();
    const i = px(x, y);
    if (!isBg(i)) continue;
    if (data[i + 3] !== 0) { data[i + 3] = 0; removed++; }
    if (x > 0 && !visited[y * w + x - 1]) push(x - 1, y);
    if (x < w - 1 && !visited[y * w + x + 1]) push(x + 1, y);
    if (y > 0 && !visited[(y - 1) * w + x]) push(x, y - 1);
    if (y < h - 1 && !visited[(y + 1) * w + x]) push(x, y + 1);
  }
  return removed / (w * h);
}

async function removeBg(url) {
  try {
    if (!url || typeof url !== 'string') {
      return { ok: false, msg: 'URL da imagem é obrigatória' };
    }

    const cached = getCached(`removebg:${url}`);
    if (cached) return { ok: true, ...cached, cached: true };

    const bufferIn = await downloadImage(url);

    let img;
    try {
      img = await Jimp.read(bufferIn);
    } catch {
      return { ok: false, msg: 'A URL não retornou uma imagem válida.' };
    }
    if (img.width * img.height > MAX_PIXELS) {
      return { ok: false, msg: 'Imagem com resolução muito alta para processar.' };
    }

    const removedRatio = floodRemoveBg(img);
    if (removedRatio >= 0.985) {
      return { ok: false, msg: 'Não foi possível separar o objeto do fundo (fundo ocupa a imagem inteira).' };
    }
    if (removedRatio <= 0.005) {
      return { ok: false, msg: 'Não foi detectado um fundo uniforme para remover.' };
    }

    const buffer = await img.getBuffer('image/png');

    const result = {
      status: true,
      criador: 'Tokyo',
      type: 'image',
      mime: 'image/png',
      buffer,
    };

    setCache(`removebg:${url}`, result);
    return { ok: true, ...result };

  } catch (error) {
    return { ok: false, msg: error.message || 'Erro ao remover fundo da imagem' };
  }
}

async function upscale(url, scale = 2) {
  try {
    if (!url || typeof url !== 'string') {
      return { ok: false, msg: 'URL da imagem é obrigatória' };
    }

    const factor = parseInt(scale, 10);
    if (!Number.isFinite(factor) || factor < 2 || factor > 4) {
      return { ok: false, msg: 'Scale inválido. Use um valor inteiro entre 2 e 4.' };
    }

    const cached = getCached(`upscale:${url}:${factor}`);
    if (cached) return { ok: true, ...cached, cached: true };

    const bufferIn = await downloadImage(url);

    let img;
    try {
      img = await Jimp.read(bufferIn);
    } catch {
      return { ok: false, msg: 'A URL não retornou uma imagem válida.' };
    }
    const targetW = img.width * factor;
    const targetH = img.height * factor;
    if (targetW > MAX_UPSCALE_DIM || targetH > MAX_UPSCALE_DIM) {
      return { ok: false, msg: `Imagem final excederia ${MAX_UPSCALE_DIM}px. Reduza o scale.` };
    }

    // Upscale por interpolação bicúbica (não é upscaling por IA).
    img.resize({ w: targetW, h: targetH, mode: 'bicubicInterpolation' });

    const buffer = await img.getBuffer('image/png');

    const result = {
      status: true,
      criador: 'Tokyo',
      type: 'image',
      mime: 'image/png',
      scale: factor,
      buffer,
    };

    setCache(`upscale:${url}:${factor}`, result);
    return { ok: true, ...result };

  } catch (error) {
    return { ok: false, msg: error.message || 'Erro ao melhorar imagem' };
  }
}

export default {
  removeBg,
  upscale
};

export {
  removeBg,
  upscale
};
