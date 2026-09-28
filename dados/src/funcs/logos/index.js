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

/**
 * Estilos de DOIS textos (linha de cima + linha de baixo).
 *
 * Substituem a API externa (`apisnodz.com.br/api/logotipos`) que o `!pornhub`,
 * `!avengers` e companhia usavam: o comando travava e devolvia um link de API
 * em vez de gerar a imagem no bot. Aqui tudo roda local, com jimp.
 *
 * `accent` e' a cor do bloco de destaque (o retangulo do pornhub, o emblema do
 * avengers); `top`/`bottom` sao os gradientes do fundo.
 */
const STYLES2 = {
  pornhub:        { bg: [0x0a0a0a, 0x1c1c1c], top: [0xffffff, 0xffffff], bottom: [0xffffff, 0xffffff], accent: 0xffa31a, badge: true },
  avengers:       { bg: [0x0b0f1a, 0x1d2a44], top: [0xffffff, 0xdbe6ff], bottom: [0xffd34d, 0xff8a00], accent: 0xffd700, outline: 0x0b1a33, glow: { color: 0x4d8cff, blur: 10 } },
  graffiti:       { bg: [0x141414, 0x2e2e2e], top: [0xff2ea6, 0xff2ea6], bottom: [0x00e5ff, 0x00e5ff], outline: 0x000000, shadow: { color: 0x000000, blur: 4, dx: 5, dy: 5 } },
  captainamerica: { bg: [0x0a1a4d, 0x123c9c], top: [0xffffff, 0xdbe6ff], bottom: [0xff4d4d, 0xb30000], outline: 0x0a1a4d, stars: true },
  stone3d:        { bg: [0x1a1a1a, 0x3d3d3d], top: [0xcfcfcf, 0x8a8a8a], bottom: [0xf5f5f5, 0xa8a8a8], outline: 0x050505, shadow: { color: 0x000000, blur: 6, dx: 5, dy: 7 } },
  neon2:          { bg: [0x050510, 0x0e0e24], top: [0x9be7ff, 0x00b3ff], bottom: [0xff9bf0, 0xff00c8], glow: { color: 0x00e5ff, blur: 14 } },
  thor:           { bg: [0x0b0f1a, 0x22304d], top: [0xffffff, 0xcfe6ff], bottom: [0x8ad4ff, 0x2b8cff], glow: { color: 0x66c2ff, blur: 14 }, outline: 0x0a1a33 },
  deadpool:       { bg: [0x1a0202, 0x3d0505], top: [0xff4d4d, 0xb30000], bottom: [0xffffff, 0xd9d9d9], outline: 0x000000, shadow: { color: 0x000000, blur: 5, dx: 5, dy: 6 } },
  blackpink:      { bg: [0x0a0208, 0x24081a], top: [0xff9bd4, 0xff2ea6], bottom: [0xffffff, 0xd9d9d9], glow: { color: 0xff2ea6, blur: 12 } },
  amongus2:       { bg: [0x0b1026, 0x1b2a4e], top: [0xffffff, 0xdbe6ff], bottom: [0xff4d4d, 0xb3001b], outline: 0xffffff, stars: true }
};
/** Estilos que exigem dois textos (o proprio comando escolhe o estilo). */
const TWO_TEXT_TYPES = Object.keys(STYLES2);

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

/**
 * Arredonda os cantos de uma imagem, deixando o resto com alpha 0.
 *
 * Usado pelo bloco de destaque (o retangulo do pornhub tem cantos arredondados).
 */
function roundCorners(img, radius) {
  const r = Math.max(0, Math.min(radius, Math.floor(Math.min(img.width, img.height) / 2)));
  if (!r) return img;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      // distancia ate' o centro do circulo de canto mais proximo
      const cx = x < r ? r : x >= img.width - r ? img.width - 1 - r : x;
      const cy = y < r ? r : y >= img.height - r ? img.height - 1 - r : y;
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > r * r) {
        img.bitmap.data[(y * img.width + x) * 4 + 3] = 0;
      }
    }
  }
  return img;
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

/**
 * Renderiza uma camada de texto com a paleta dada, ja' recortada e ajustada.
 *
 * `maxH` limita a altura de cada linha: com dois textos o espaco vertical e'
 * dividido, senao as duas linhas juntas estourariam o canvas.
 */
async function renderTextBlock(font, text, palette, maxH = TEXT_MAX_H) {
  const layer = new Jimp({ width: CANVAS_W, height: maxH + 160, color: 0x00000000 });
  layer.print({
    font,
    x: 0,
    y: 0,
    text,
    maxWidth: TEXT_MAX_W,
    maxHeight: maxH + 160,
    alignmentX: HorizontalAlign.CENTER,
    alignmentY: VerticalAlign.MIDDLE,
  });
  const bbox = alphaBBox(layer);
  if (!bbox) throw new Error('Texto vazio ou não renderizável.');
  let out = layer.crop({ x: bbox.x, y: bbox.y, w: bbox.w, h: bbox.h });
  const fit = Math.min(TEXT_MAX_W / out.width, maxH / out.height, 1);
  if (fit < 1) out = out.scale(fit);
  return { img: out, colored: colorizeTextLayer(out.clone(), palette[0], palette[1]) };
}

/** Deixa a camada com texto branco solido — e' a mascara usada pelos efeitos. */
function solidWhite(img) {
  const out = img.clone();
  out.scan((x, y, idx) => {
    if (out.bitmap.data[idx + 3] > 0) {
      out.bitmap.data[idx] = 255;
      out.bitmap.data[idx + 1] = 255;
      out.bitmap.data[idx + 2] = 255;
    }
  });
  return out;
}

/** Empilha dois textos (cima/baixo) numa unica camada, centrados. */
async function renderTwoTextBlock(font, topText, bottomText, cfg) {
  const gap = Math.round(CANVAS_H * 0.06);
  const each = Math.round((TEXT_MAX_H - gap) / 2);
  const a = await renderTextBlock(font, topText, cfg.top, each);
  const b = await renderTextBlock(font, bottomText, cfg.bottom, each);

  const w = Math.max(a.img.width, b.img.width);
  const h = a.img.height + gap + b.img.height;

  // Camada COLORIDA: cada linha com a SUA paleta (cima/baixo).
  const colored = new Jimp({ width: w, height: h, color: 0x00000000 });
  colored.composite(a.colored, Math.round((w - a.img.width) / 2), 0);
  colored.composite(b.colored, Math.round((w - b.img.width) / 2), a.img.height + gap);

  // Camada MASCARA: as duas linhas em branco solido. Os efeitos (sombra, glow,
  // contorno) sao construidos a partir DESTA camada, porque eles precisam de uma
  // silhueta unica — colorir a mascara de novo com um unico gradiente apagaria a
  // paleta propria de cada linha.
  const mask = new Jimp({ width: w, height: h, color: 0x00000000 });
  mask.composite(solidWhite(a.img), Math.round((w - a.img.width) / 2), 0);
  mask.composite(solidWhite(b.img), Math.round((w - b.img.width) / 2), a.img.height + gap);

  return { colored, mask };
}

async function renderLogo(query, cfg) {
  const font = await getFont();
  const bg = new Jimp({ width: CANVAS_W, height: CANVAS_H, color: 0x000000ff });
  verticalGradient(bg, cfg.bg[0], cfg.bg[1]);
  if (cfg.stars) addStars(bg);

  let textLayer;
  let maskLayer = null; // silhueta branca, para sombra/glow/contorno em 2 textos
  if (Array.isArray(query)) {
    // ESTILO DE DOIS TEXTOS (o handler passa [texto1, texto2])
    const two = await renderTwoTextBlock(font, String(query[0]), String(query[1] ?? ''), cfg);
    textLayer = two.colored;
    maskLayer = two.mask;
  } else {
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
    textLayer = layer.crop({ x: bbox.x, y: bbox.y, w: bbox.w, h: bbox.h });

    // Reduz escala se o texto embrulhado exceder a área útil
    const fit = Math.min(TEXT_MAX_W / textLayer.width, TEXT_MAX_H / textLayer.height, 1);
    if (fit < 1) textLayer = textLayer.scale(fit);
  }

  // A `styled` e' o que vai por CIMA. Em 2 textos a camada ja' esta' colorida
  // linha a linha, entao NAO se aplica um gradiente unico (ele apagaria a paleta
  // de cada linha). Em 1 texto, colore-se normalmente.
  const styled = maskLayer
    ? textLayer
    : colorizeTextLayer(textLayer.clone(), cfg.text?.[0] ?? cfg.top[0], cfg.text?.[1] ?? cfg.top[1]);
  // Silhueta usada pelos efeitos: em 2 textos e' a mascara branca das duas
  // linhas; em 1 texto e' a propria camada de texto.
  const effectSource = maskLayer ?? textLayer;
  const layers = [];

  if (cfg.glitch) {
    const red = colorizeTextLayer(effectSource.clone(), 0xff0000, 0xff0000);
    const cyan = colorizeTextLayer(effectSource.clone(), 0x00e5ff, 0x00e5ff);
    red.scan((x, y, idx) => { red.bitmap.data[idx + 3] = red.bitmap.data[idx + 3] > 0 ? 200 : 0; });
    cyan.scan((x, y, idx) => { cyan.bitmap.data[idx + 3] = cyan.bitmap.data[idx + 3] > 0 ? 200 : 0; });
    layers.push({ img: red, dx: -4, dy: 0 }, { img: cyan, dx: 4, dy: 0 });
  }
  if (cfg.shadow) {
    const sh = colorizeTextLayer(effectSource.clone(), cfg.shadow.color, cfg.shadow.color);
    sh.blur(cfg.shadow.blur);
    layers.push({ img: sh, dx: cfg.shadow.dx, dy: cfg.shadow.dy });
  }
  if (cfg.glow) {
    const gl = colorizeTextLayer(effectSource.clone(), cfg.glow.color, cfg.glow.color);
    gl.blur(cfg.glow.blur);
    layers.push({ img: gl, dx: 0, dy: 0 });
  }
  if (cfg.outline != null) {
    const ol = colorizeTextLayer(effectSource.clone(), cfg.outline, cfg.outline);
    ol.blur(2);
    layers.push({ img: ol, dx: 0, dy: 0 });
  }
  layers.push({ img: styled, dx: 0, dy: 0 });

  const baseX = Math.round((CANVAS_W - textLayer.width) / 2);
  const baseY = Math.round((CANVAS_H - textLayer.height) / 2);

  // Bloco de destaque (o retangulo laranja do pornhub): vai ATRAS do texto, para
  // o estilo ter o fundo caracteristico em vez de so' texto solto no gradiente.
  if (cfg.badge && cfg.accent != null) {
    const padX = Math.round(textLayer.width * 0.07) + 28;
    const padY = Math.round(textLayer.height * 0.07) + 22;
    const bw = textLayer.width + padX * 2;
    const bh = textLayer.height + padY * 2;
    const bx = Math.max(0, Math.round((CANVAS_W - bw) / 2));
    const by = Math.max(0, Math.round((CANVAS_H - bh) / 2));
    const badge = new Jimp({ width: bw, height: bh, color: cfg.accent * 256 + 0xff });
    roundCorners(badge, Math.round(Math.min(bw, bh) * 0.12));
    bg.composite(badge, bx, by);
  }
  for (const { img, dx, dy } of layers) {
    bg.composite(img, baseX + dx, baseY + dy);
  }
  return bg.getBuffer('image/png');
}

/**
 * Gera um logo LOCALMENTE (jimp), sem nenhuma API externa.
 *
 * `query` pode ser:
 *  - string  -> estilo de 1 texto (tabela `STYLES`)
 *  - array   -> estilo de 2 textos `[linhaDeCima, linhaDeBaixo]` (`STYLES2`)
 *
 * O comando `!amongus` aparece nas duas tabelas: quando vem array ele usa
 * `amongus2` (2 textos), senao `amongus` (1 texto).
 */
async function gerarLogo({ query, type }) {
  try {
    if (!query || !type) {
      return { ok: false, msg: '❌ Parâmetros obrigatórios não informados.' };
    }

    const normalizedType = String(type).toLowerCase().trim();
    const twoText = Array.isArray(query);
    // `amongus` existe nos dois modos: o sufixo evita a colisao das tabelas
    const styleKey = twoText && normalizedType === 'amongus' ? 'amongus2' : normalizedType;
    const cfg = twoText ? STYLES2[styleKey] : STYLES[styleKey];
    if (!cfg) {
      return { ok: false, msg: `❌ Tipo de logo desconhecido: "${normalizedType}".` };
    }
    if (twoText && (!query[0] || !query[1])) {
      return { ok: false, msg: '❌ Este logotipo precisa de dois textos (ex: Abyss/Bot).' };
    }

    const cacheKey = `logo:${styleKey}:${twoText ? `${query[0]}|${query[1]}` : query}`;
    const cached = getCached(cacheKey);
    if (cached) return { ok: true, ...cached, cached: true };

    // NAO converter com String(): em 2 textos o `query` e' um array
    // (`['abyss','bot']`) e `String()` o viraria "abyss,bot" numa unica linha —
    // era por isso que a segunda linha nunca aparecia. O `renderLogo` decide pelo
    // tipo (array = 2 textos).
    const buffer = await renderLogo(Array.isArray(query) ? query.map(String) : String(query), cfg);
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

export { gerarLogo, STYLES, STYLES2, TWO_TEXT_TYPES };
