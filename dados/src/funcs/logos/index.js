import { Jimp, loadFont, HorizontalAlign, VerticalAlign } from 'jimp';
import { fileURLToPath } from 'url';

const FONT_URL = new URL('./fonts/dejavu-bold-96.fnt', import.meta.url);

let fontPromise = null;
function getFont() {
  if (!fontPromise) fontPromise = loadFont(fileURLToPath(FONT_URL));
  return fontPromise;
}

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

const CANVAS_W = 1200;
const CANVAS_H = 640;
const TEXT_MAX_W = 1080;
const TEXT_MAX_H = 460;

// Estilos locais de logo (implementação própria, sem VexAPI).
// bg: gradiente vertical do fundo; text: gradiente vertical do texto;
// shadow/glow/outline: efeitos aplicados sobre a camada de texto.
const STYLES = {
  amongus:        { bg: [0x0b1026, 0x1b2a4e], text: [0xff4d4d, 0xb3001b], outline: 0xffffff, stars: true },
  royal:          { bg: [0x0d0d0d, 0x2a1a3a], text: [0xf6d365, 0xb8860b], shadow: { color: 0x000000, blur: 6, dx: 4, dy: 6 } },
  mascotemetal:   { bg: [0x1a1a1a, 0x3d3d3d], text: [0xf2f2f2, 0x6e6e6e], outline: 0x000000 },
  firework:       { bg: [0x0a0a23, 0x1c1c3c], text: [0xffd34d, 0xff6a00], glow: { color: 0xff9500, blur: 14 }, stars: true },
  summerbeach:    { bg: [0x0e6ba8, 0xf2c14e], text: [0xffffff, 0xfff3c4], shadow: { color: 0xb25b00, blur: 4, dx: 4, dy: 5 } },
  cloudsky:       { bg: [0x0b4f8a, 0x62b6ff], text: [0xffffff, 0xd8ecff], shadow: { color: 0x0b3d6b, blur: 5, dx: 3, dy: 5 } },
  techstyle:      { bg: [0x02140d, 0x063023], text: [0x9dffde, 0x00d484], glow: { color: 0x00ff9d, blur: 12 } },
  watercolor:     { bg: [0xf7c9d9, 0xa8c6f0], text: [0x5a2a6b, 0x301245], shadow: { color: 0xffffff, blur: 3, dx: 2, dy: 2 } },
  ligatures:      { bg: [0x000000, 0x1c1c1c], text: [0xffffff, 0xd9d9d9], outline: 0x5a5a5a },
  graffitistyle:  { bg: [0x1e1e1e, 0x383838], text: [0xff2ea6, 0x00e5ff], shadow: { color: 0x000000, blur: 4, dx: 5, dy: 5 } },
  frozen:         { bg: [0x06123a, 0x0e4d8c], text: [0xffffff, 0x9be3ff], glow: { color: 0x7fdcff, blur: 12 } },
  colorful:       { bg: [0x14061f, 0x2a0f3d], text: [0xffe14d, 0xff2ea6], outline: 0x3d1052 },
  balloon:        { bg: [0x5e1a6b, 0xc23a8f], text: [0xffffff, 0xffc8e8], shadow: { color: 0x4a0e57, blur: 5, dx: 4, dy: 6 } },
  multicolor:     { bg: [0x0a0a0a, 0x212121], text: [0x00e5ff, 0xff2ea6], outline: 0x000000 },
  metal:          { bg: [0x121212, 0x2b2b2b], text: [0xfafafa, 0x8c8c8c], outline: 0x050505 },
  doubleexposure: { bg: [0x041a1a, 0x0c3b3b], text: [0x5df2ff, 0xb44dff], shadow: { color: 0x000000, blur: 4, dx: 3, dy: 3 } },
  mascoteneon:    { bg: [0x050505, 0x101010], text: [0xffb3ff, 0xff00c8], glow: { color: 0xff2ec4, blur: 16 } },
  eraser:         { bg: [0xd8d8d8, 0xf5f5f5], text: [0x3d3d3d, 0x141414], shadow: { color: 0xffffff, blur: 2, dx: 2, dy: 2 } },
  america:        { bg: [0x0a1480, 0x6d0f1b], text: [0xffffff, 0xffe9e9], outline: 0x1a237e, stars: true },
  snow:           { bg: [0x0a1e3c, 0x143c6e], text: [0xffffff, 0xcfe8ff], glow: { color: 0xe6f4ff, blur: 10 } },
  sunset:         { bg: [0x2a0e44, 0xd4482b], text: [0xffe66d, 0xff8a3d], shadow: { color: 0x38104a, blur: 4, dx: 4, dy: 5 } },
  halloween:      { bg: [0x0c0502, 0x2c1402], text: [0xffc33d, 0xff7b00], glow: { color: 0xff9500, blur: 14 } },
  blood:          { bg: [0x0a0000, 0x2b0000], text: [0xff2e2e, 0x8c0000], shadow: { color: 0x000000, blur: 5, dx: 4, dy: 6 } },
  hallobat:       { bg: [0x07000f, 0x1c0930], text: [0x94ff5e, 0x5ac62b], glow: { color: 0x84f542, blur: 13 } },
  cemiterio:      { bg: [0x0f1410, 0x2a332a], text: [0xd3e6d0, 0x7fa37a], shadow: { color: 0x000000, blur: 5, dx: 4, dy: 5 } },
  ffavatar:       { bg: [0x3a0d02, 0x7c2a04], text: [0xfff14d, 0xffb300], outline: 0x4d1500 },
  vintage3d:      { bg: [0x2b1a0c, 0x5a3c1e], text: [0xf3e2b8, 0xc39a55], shadow: { color: 0x1c1004, blur: 4, dx: 5, dy: 6 } },
  hollywood:      { bg: [0x000000, 0x1a1a1a], text: [0xffe88c, 0xc99500], glow: { color: 0xffd700, blur: 12 } },
  glitch:         { bg: [0x030303, 0x141414], text: [0xffffff, 0xe8e8e8], glitch: true },
  galaxy:         { bg: [0x0b0218, 0x2b0b4e], text: [0xdcc6ff, 0x8a5fd0], stars: true, glow: { color: 0x9b6aff, blur: 10 } },
  glossy:         { bg: [0x0a2a5e, 0x0e4fa8], text: [0xffffff, 0xcfe6ff], shadow: { color: 0x061a3d, blur: 4, dx: 3, dy: 4 } },
  dragonfire:     { bg: [0x1c0300, 0x4d1000], text: [0xffe14d, 0xff5e00], glow: { color: 0xff8a00, blur: 14 } },
  pubgavatar:     { bg: [0x141408, 0x2c2c14], text: [0xffe14d, 0xe0a500], outline: 0x000000 },
  comics:         { bg: [0x0d2a6b, 0x123c9c], text: [0xffe14d, 0xffb300], outline: 0x000000, shadow: { color: 0x000000, blur: 3, dx: 6, dy: 7 } },
};

function hexToRgb(hex) {
  return { r: (hex >> 16) & 0xff, g: (hex >> 8) & 0xff, b: hex & 0xff };
}

function verticalGradient(img, topHex, bottomHex) {
  const top = hexToRgb(topHex);
  const bottom = hexToRgb(bottomHex);
  const h = img.height;
  img.scan((x, y, idx) => {
    const t = y / (h - 1);
    img.bitmap.data[idx] = top.r + (bottom.r - top.r) * t;
    img.bitmap.data[idx + 1] = top.g + (bottom.g - top.g) * t;
    img.bitmap.data[idx + 2] = top.b + (bottom.b - top.b) * t;
    img.bitmap.data[idx + 3] = 255;
  });
  return img;
}

function colorizeTextLayer(layer, topHex, bottomHex) {
  const top = hexToRgb(topHex);
  const bottom = hexToRgb(bottomHex);
  const h = layer.height;
  layer.scan((x, y, idx) => {
    if (layer.bitmap.data[idx + 3] > 0) {
      const t = h > 1 ? y / (h - 1) : 0;
      layer.bitmap.data[idx] = top.r + (bottom.r - top.r) * t;
      layer.bitmap.data[idx + 1] = top.g + (bottom.g - top.g) * t;
      layer.bitmap.data[idx + 2] = top.b + (bottom.b - top.b) * t;
    }
  });
  return layer;
}

function alphaBBox(img) {
  let minX = img.width, minY = img.height, maxX = -1, maxY = -1;
  img.scan((x, y, idx) => {
    if (img.bitmap.data[idx + 3] > 0) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  });
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function addStars(img, count = 90) {
  let seed = 42;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < count; i++) {
    const x = Math.floor(rand() * img.width);
    const y = Math.floor(rand() * img.height);
    const size = rand() < 0.7 ? 1 : 2;
    const vals = [255, 255, 255, 120 + Math.floor(rand() * 135)];
    for (let dx = 0; dx < size; dx++) for (let dy = 0; dy < size; dy++) {
      const idx = ((y + dy) * img.width + (x + dx)) * 4;
      if (idx >= 0 && idx < img.bitmap.data.length - 3) {
        img.bitmap.data[idx] = vals[0];
        img.bitmap.data[idx + 1] = vals[1];
        img.bitmap.data[idx + 2] = vals[2];
        img.bitmap.data[idx + 3] = Math.min(255, img.bitmap.data[idx + 3] + vals[3]);
      }
    }
  }
  return img;
}

async function renderLogo(query, cfg) {
  const font = await getFont();
  const bg = new Jimp({ width: CANVAS_W, height: CANVAS_H, color: 0x000000ff });
  verticalGradient(bg, cfg.bg[0], cfg.bg[1]);
  if (cfg.stars) addStars(bg);

  // Camada de texto isolada para permitir efeitos e centralização
  const layer = new Jimp({ width: CANVAS_W, height: TEXT_MAX_H + 120, color: 0x00000000 });
  layer.print({
    font,
    x: 0,
    y: 0,
    text: query,
    maxWidth: TEXT_MAX_W,
    maxHeight: TEXT_MAX_H + 120,
    alignmentX: HorizontalAlign.CENTER,
    alignmentY: VerticalAlign.MIDDLE,
  });
  const bbox = alphaBBox(layer);
  if (!bbox) throw new Error('Texto vazio ou não renderizável.');
  let textLayer = layer.crop({ x: bbox.x, y: bbox.y, w: bbox.w, h: bbox.h });

  // Reduz escala se o texto embrulhado exceder a área útil
  const fit = Math.min(TEXT_MAX_W / textLayer.width, TEXT_MAX_H / textLayer.height, 1);
  if (fit < 1) textLayer = textLayer.scale(fit);

  const styled = colorizeTextLayer(textLayer.clone(), cfg.text[0], cfg.text[1]);
  const layers = [];

  if (cfg.glitch) {
    const red = colorizeTextLayer(textLayer.clone(), 0xff0000, 0xff0000);
    const cyan = colorizeTextLayer(textLayer.clone(), 0x00e5ff, 0x00e5ff);
    red.scan((x, y, idx) => { red.bitmap.data[idx + 3] = red.bitmap.data[idx + 3] > 0 ? 200 : 0; });
    cyan.scan((x, y, idx) => { cyan.bitmap.data[idx + 3] = cyan.bitmap.data[idx + 3] > 0 ? 200 : 0; });
    layers.push({ img: red, dx: -4, dy: 0 }, { img: cyan, dx: 4, dy: 0 });
  }
  if (cfg.shadow) {
    const sh = colorizeTextLayer(textLayer.clone(), cfg.shadow.color, cfg.shadow.color);
    sh.blur(cfg.shadow.blur);
    layers.push({ img: sh, dx: cfg.shadow.dx, dy: cfg.shadow.dy });
  }
  if (cfg.glow) {
    const gl = colorizeTextLayer(textLayer.clone(), cfg.glow.color, cfg.glow.color);
    gl.blur(cfg.glow.blur);
    layers.push({ img: gl, dx: 0, dy: 0 });
  }
  if (cfg.outline != null) {
    const ol = colorizeTextLayer(textLayer.clone(), cfg.outline, cfg.outline);
    ol.blur(2);
    layers.push({ img: ol, dx: 0, dy: 0 });
  }
  layers.push({ img: styled, dx: 0, dy: 0 });

  const baseX = Math.round((CANVAS_W - textLayer.width) / 2);
  const baseY = Math.round((CANVAS_H - textLayer.height) / 2);
  for (const { img, dx, dy } of layers) {
    bg.composite(img, baseX + dx, baseY + dy);
  }
  return bg.getBuffer('image/png');
}

async function gerarLogo({ query, type }) {
  try {
    if (!query || !type) {
      return { ok: false, msg: '❌ Parâmetros obrigatórios não informados.' };
    }

    const normalizedType = String(type).toLowerCase().trim();
    const cfg = STYLES[normalizedType];
    if (!cfg) {
      return { ok: false, msg: `❌ Tipo de logo desconhecido: "${normalizedType}".` };
    }

    const cacheKey = `logo:${normalizedType}:${query}`;
    const cached = getCached(cacheKey);
    if (cached) return { ok: true, ...cached, cached: true };

    const buffer = await renderLogo(String(query), cfg);
    if (!buffer || buffer.length === 0) {
      return { ok: false, msg: '❌ Resposta não é uma imagem válida.' };
    }

    const response = { buffer, mime: 'image/png' };
    setCache(cacheKey, response);

    return { ok: true, ...response };

  } catch (err) {
    return { ok: false, msg: `❌ Erro ao gerar o logo: ${err.message}` };
  }
}

export { gerarLogo, STYLES };
