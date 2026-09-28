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
 * Estilos de DOIS textos, com o layout MEDIDO das logos originais.
 *
 * ## Como estas cores/posicoes foram obtidas
 *
 * Baixei as imagens dos modelos originais (textpro.me / ephoto360) e analisei
 * pixel a pixel (`ffmpeg` -> rawvideo). O padrao que TODAS seguem:
 *
 *   - fundo **preto** (rgb 0,0,0) nos quatro cantos;
 *   - o texto no **centro** (faixas de y ~180-380 de 500);
 *   - um **brilho radial** na cor do tema ATRAS do texto, concentrado no centro
 *     (e' o que da o efeito de profundidade; sem ele sobra "texto colorido solto"
 *     num fundo chapado, que era o defeito da 1a versao).
 *
 * Cores de destaque medidas (hex dos pixels saturados no centro):
 *   thor #c00000/#e00000 + metal dourado | deadpool #a00000 | blackpink #e0a0c0
 *   pornhub #e08000 + branco | avengers #002060 (azul) | neon #80e0e0 (ciano)
 *   stone cinza #404040 (sem saturacao)
 *
 * `bg` e' o fundo (preto, como nas originais), `glow` e' o brilho radial, `top`
 * e `bottom` sao as cores da 1a e da 2a linha.
 */
const STYLES2 = {
  // duas palavras: "Porn" branco + "hub" preto sobre caixa laranja
  pornhub:        { bg: 0x000000, top: [0xffffff, 0xf0f0f0], bottom: [0x000000, 0x101010], accent: 0xe08000, twoPart: true },
  avengers:       { bg: 0x000000, top: [0xffffff, 0xcfe0ff], bottom: [0xffffff, 0xcfe0ff], glow: 0x2b6cff, glowStrength: 3.0, glowRadius: 0.44, emblem: 0x0a2a6b, emblemScale: 0.36, outline: 0x061a45 },
  graffiti:       { bg: 0x0a0a0a, top: [0xff2ea6, 0xd0007a], bottom: [0x00e5ff, 0x0090b0], outline: 0x000000, glow: 0xff2ea6 },
  captainamerica: { bg: 0x000000, top: [0xffffff, 0xdbe6ff], bottom: [0xff4d4d, 0xb30000], glow: 0x2b4cff, outline: 0x0a1a4d },
  stone3d:        { gradient: [0x1c1c1c, 0x050505], top: [0xe0e0e0, 0x9a9a9a], bottom: [0xffffff, 0xbdbdbd], outline: 0x0a0a0a, glow: 0x9a9a9a, glowRadius: 0.5, glowStrength: 1.1, shadow: { color: 0x000000, blur: 6, dx: 5, dy: 7 } },
  neon2:          { bg: 0x000a0a, top: [0x9be7ff, 0x00b3ff], bottom: [0xff9bf0, 0xff00c8], glow: 0x00e5ff, glowRadius: 0.46, glowStrength: 2.2 },
  thor:           { bg: 0x000000, top: [0xf5e6c8, 0xb08a3c], bottom: [0xf5e6c8, 0xb08a3c], glow: 0xc00000, glowStrength: 1.9, glowRadius: 0.48, outline: 0x2a1400 },
  deadpool:       { bg: 0x000000, top: [0xd60000, 0x7a0000], bottom: [0xd60000, 0x7a0000], outline: 0x000000, glow: 0xb00000, glowStrength: 2.6, glowRadius: 0.42 },
  blackpink:      { bg: 0x000000, top: [0xf0b0c8, 0xd080a0], bottom: [0xf0b0c8, 0xd080a0], glow: 0xe0a0c0, glowRadius: 0.30, glowStrength: 2.1 },
  amongus2:       { bg: 0x05060f, top: [0xffffff, 0xdbe6ff], bottom: [0xff4d4d, 0xb3001b], glow: 0x2b4cff, outline: 0xffffff }
};
/** Estilos que exigem dois textos (o proprio comando escolhe o estilo). */
const TWO_TEXT_TYPES = Object.keys(STYLES2);

/**
 * Brilho radial na cor do tema, ATRAS do texto.
 *
 * E' o que da o efeito das logos originais: as referencias medidas tem fundo
 * preto (rgb 0,0,0 nos cantos) e um halo colorido concentrado no centro, onde o
 * texto fica. Sem isto sobra "texto colorido" num fundo chapado — que era
 * exatamente o defeito da primeira versao.
 */
function radialGlow(img, hex, strength = 0.75, radiusScale = 0.40) {
  const c = hexToRgb(hex);
  const cx = img.width / 2;
  // o halo acompanha a altura do bloco de texto, nao o centro do canvas
  const cy = img.height * 0.48;
  const maxR = Math.min(img.width, img.height * 1.6) * radiusScale;
  img.scan((x, y, idx) => {
    const d = Math.hypot(x - cx, y - cy) / maxR;
    if (d >= 1) return;
    const k = (1 - d) * (1 - d) * strength; // queda suave
    img.bitmap.data[idx] = Math.min(255, img.bitmap.data[idx] + c.r * k);
    img.bitmap.data[idx + 1] = Math.min(255, img.bitmap.data[idx + 1] + c.g * k);
    img.bitmap.data[idx + 2] = Math.min(255, img.bitmap.data[idx + 2] + c.b * k);
  });
  return img;
}

/**
 * Fundo do logo.
 *
 * - `gradient: [topoHex, baseHex]` — gradiente vertical (a stone3d original e'
 *   cinza claro no topo escurecendo para preto na base; medido: brilho 44 no
 *   topo e 12 na base).
 * - senao, cor solida de `bg` (as demais originais sao preto liso).
 * O brilho do tema e' aplicado depois por `radialGlow`, por cima.
 */
function makeBackground(cfg) {
  const bg = new Jimp({ width: CANVAS_W, height: CANVAS_H, color: (cfg.bg ?? 0x000000) * 256 + 0xff });
  if (cfg.gradient) verticalGradient(bg, cfg.gradient[0], cfg.gradient[1]);
  if (cfg.stars) addStars(bg);
  return bg;
}

/** Bloco de texto: alinhado como as referencias (centro a ~42% da altura). */
function blitTextBlock(bg, textLayer, cfg) {
  const baseX = Math.round((CANVAS_W - textLayer.width) / 2);
  const baseY = Math.round(CANVAS_H * 0.50 - textLayer.height / 2);
  bg.composite(textLayer, baseX, baseY);
  return { baseX, baseY };
}

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
  const each = Math.round((TEXT_MAX_H - gap) / 2 * 1.25);
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
  const bg = makeBackground(cfg);

  // Brilho do tema ANTES do texto (fica atras dele, como nas logos originais).
  if (cfg.glow != null) radialGlow(bg, cfg.glow, cfg.glowStrength ?? 0.75, cfg.glowRadius ?? 0.40);

  const twoText = Array.isArray(query);
  let textLayer;
  let maskLayer = null;

  if (twoText && cfg.twoPart) {
    // Pornhub: "Porn" branco + "hub" preto dentro de uma caixa laranja, na MESMA
    // linha — o layout assinatura. (O ephoto original pinta a 2a palavra por
    // cima do retangulo, nao em outra linha.)
    const built = await renderTwoPartLine(font, String(query[0]), String(query[1]), cfg);
    textLayer = built.layer;
    maskLayer = built.layer;
  } else if (twoText) {
    const two = await renderTwoTextBlock(font, String(query[0]), String(query[1] ?? ''), cfg);
    textLayer = two.colored;
    maskLayer = two.mask;
  } else {
    const layer = new Jimp({ width: CANVAS_W, height: TEXT_MAX_H + 120, color: 0x00000000 });
    layer.print({
      font, x: 0, y: 0, text: query,
      maxWidth: TEXT_MAX_W, maxHeight: TEXT_MAX_H + 120,
      alignmentX: HorizontalAlign.CENTER, alignmentY: VerticalAlign.MIDDLE,
    });
    const bbox = alphaBBox(layer);
    if (!bbox) throw new Error('Texto vazio ou não renderizável.');
    textLayer = layer.crop({ x: bbox.x, y: bbox.y, w: bbox.w, h: bbox.h });
    const fit = Math.min(TEXT_MAX_W / textLayer.width, TEXT_MAX_H / textLayer.height, 1);
    if (fit < 1) textLayer = textLayer.scale(fit);
  }

  // Em DOIS textos a camada ja' vem colorida (cada linha com a sua paleta, e no
  // pornhub a caixa laranja junto). Recolorir aqui pintaria a caixa de branco e
  // a logo sairia sem o retangulo — que foi exatamente o defeito observado.
  const styled = twoText
    ? textLayer
    : colorizeTextLayer(textLayer.clone(), cfg.text?.[0] ?? cfg.top?.[0] ?? 0xffffff, cfg.text?.[1] ?? cfg.top?.[1] ?? 0xffffff);
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
  if (cfg.glowText) {
    const gl = colorizeTextLayer(effectSource.clone(), cfg.glowText, cfg.glowText);
    gl.blur(cfg.glowBlur ?? 10);
    layers.push({ img: gl, dx: 0, dy: 0 });
  }
  if (cfg.outline != null) {
    const ol = colorizeTextLayer(effectSource.clone(), cfg.outline, cfg.outline);
    ol.blur(2);
    layers.push({ img: ol, dx: 0, dy: 0 });
  }
  layers.push({ img: styled, dx: 0, dy: 0 });

  const baseX = Math.round((CANVAS_W - textLayer.width) / 2);
  const baseY = Math.round(CANVAS_H * 0.50 - textLayer.height / 2);

  // Emblema (o circulo do avengers): atras do texto, no centro.
  if (cfg.emblem != null) {
    const r = Math.min(CANVAS_W, CANVAS_H) * (cfg.emblemScale ?? 0.30);
    const emblem = new Jimp({ width: Math.round(r * 2), height: Math.round(r * 2), color: 0x00000000 });
    for (let y = 0; y < emblem.height; y++) {
      for (let x = 0; x < emblem.width; x++) {
        const dx = x - r;
        const dy = y - r;
        const d = Math.hypot(dx, dy);
        if (d <= r) {
          const i = (y * emblem.width + x) * 4;
          const c = hexToRgb(cfg.emblem);
          const k = 0.35 + 0.65 * (1 - d / r); // mais forte no centro
          emblem.bitmap.data[i] = Math.round(c.r * k);
          emblem.bitmap.data[i + 1] = Math.round(c.g * k);
          emblem.bitmap.data[i + 2] = Math.round(c.b * k);
          emblem.bitmap.data[i + 3] = 255;
        }
      }
    }
    // Sem `mode`: o jimp so' aceita os nomes do BlendMode dele (`blend` nao
    // existe e estourava "blendmode is not a function"). O emblema ja' vem com
    // alpha, entao o composite padrao (SRC_OVER) e' o correto.
    bg.composite(emblem, Math.round((CANVAS_W - emblem.width) / 2), Math.round(CANVAS_H * 0.50 - emblem.height / 2));
  }

  for (const { img, dx, dy } of layers) {
    bg.composite(img, baseX + dx, baseY + dy);
  }
  return bg.getBuffer('image/png');
}

/**
 * "Porn" (branco, fundo preto) + "hub" (preto, fundo laranja) na MESMA linha.
 *
 * E' o layout assinatura do modelo: sem a caixa laranja atras da segunda palavra
 * nao e' a logo do pornhub, e' so' texto.
 */
async function renderTwoPartLine(font, left, right, cfg) {
  const renderWord = (text, color) => {
    const l = new Jimp({ width: TEXT_MAX_W, height: 260, color: 0x00000000 });
    l.print({
      font, x: 0, y: 0, text, maxWidth: TEXT_MAX_W, maxHeight: 260,
      alignmentX: HorizontalAlign.CENTER, alignmentY: VerticalAlign.MIDDLE,
    });
    const bbox = alphaBBox(l);
    if (!bbox) return null;
    let out = l.crop({ x: bbox.x, y: bbox.y, w: bbox.w, h: bbox.h });
    return colorizeTextLayer(out, color, color);
  };

  const a = renderWord(left, 0xffffff);
  const b = renderWord(right, 0x000000);
  if (!a || !b) throw new Error('Texto vazio ou não renderizável.');

  // reduz para caber lado a lado com folga
  const gap = 14;
  const padX = 34;
  const padY = 44;
  const totalW = a.width + gap + b.width + padX * 2;
  const fit = Math.min(1, (CANVAS_W * 0.86) / totalW);
  if (fit < 1) { a.scale(fit); b.scale(fit); }

  const gapPx = Math.round(gap * fit);
  const boxPadX = Math.round(padX * fit);
  const boxPadY = Math.round(padY * fit);
  const textW = a.width + gapPx + b.width;
  const textH = Math.max(a.height, b.height);

  // A caixa e' MAIOR que o texto (padding), entao o canvas precisa comportar a
  // caixa inteira. Sem esta margem o jimp recortava a caixa para fora (offset
  // negativo) e a logo do pornhub saia sem o retangulo laranja — que e' o que a
  // define.
  const outW = textW + boxPadX * 2;
  const outH = textH + boxPadY * 2;
  const out = new Jimp({ width: outW, height: outH, color: 0x00000000 });

  // caixa laranja atras da parte preta (a 2a palavra)
  const boxX = boxPadX + a.width + gapPx;
  const box = new Jimp({
    width: b.width + boxPadX * 2,
    height: textH + boxPadY * 2,
    color: (cfg.accent ?? 0xe08000) * 256 + 0xff
  });
  roundCorners(box, Math.round(Math.min(box.width, box.height) * 0.14));
  out.composite(box, boxX - boxPadX, boxPadY - boxPadY);

  out.composite(a, boxPadX, Math.round(boxPadY + (textH - a.height) / 2));
  out.composite(b, boxX, Math.round(boxPadY + (textH - b.height) / 2));
  return { layer: out };
}

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
