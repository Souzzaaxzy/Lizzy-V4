import { Jimp, loadFont, HorizontalAlign, VerticalAlign } from 'jimp';
import { spawn } from 'child_process';
import { promises as fsp } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFMPEG_TIMEOUT = 60 * 1000;
const DOWNLOAD_TIMEOUT = 25 * 1000;

const FONT_URL = new URL('../logos/fonts/dejavu-bold-96.fnt', import.meta.url);

let fontPromise = null;
function getFont() {
  if (!fontPromise) fontPromise = loadFont(fileURLToPath(FONT_URL));
  return fontPromise;
}

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

const NAMED_COLORS = {
  white: 0xffffff, black: 0x000000, red: 0xff0000, green: 0x00ff00,
  blue: 0x0000ff, yellow: 0xffff00, purple: 0x800080, pink: 0xffc0cb,
  orange: 0xffa500, gray: 0x808080, grey: 0x808080, cyan: 0x00ffff,
  magenta: 0xff00ff, brown: 0x8b4513, lime: 0x32cd32, navy: 0x000080,
  teal: 0x008080, gold: 0xffd700, silver: 0xc0c0c0, maroon: 0x800000,
  olive: 0x808000, violet: 0xee82ee, indigo: 0x4b0082, coral: 0xff7f50,
};

function parseColor(value, fallbackHex) {
  if (value == null || value === '') return fallbackHex;
  const raw = String(value).trim().toLowerCase().replace(/^%23/, '');
  if (NAMED_COLORS[raw] != null) return NAMED_COLORS[raw];
  const hex = raw.replace(/^#/, '');
  if (/^[0-9a-f]{6}$/.test(hex)) return parseInt(hex, 16);
  if (/^[0-9a-f]{3}$/.test(hex)) {
    return parseInt(hex.split('').map(c => c + c).join(''), 16);
  }
  return fallbackHex;
}

async function downloadBuffer(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DOWNLOAD_TIMEOUT);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ab = await res.arrayBuffer();
    if (!ab.byteLength) throw new Error('conteúdo vazio');
    return Buffer.from(ab);
  } finally {
    clearTimeout(timer);
  }
}

function runFfmpeg(args, inputBuffer) {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', d => { stderr += d; });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('timeout ao processar mídia'));
    }, FFMPEG_TIMEOUT);
    child.on('error', err => {
      clearTimeout(timer);
      reject(err.code === 'ENOENT'
        ? new Error('FFmpeg não encontrado no sistema (instale ffmpeg)')
        : err);
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg saiu com código ${code}: ${stderr.slice(-300)}`));
    });
    if (inputBuffer) {
      child.stdin.on('error', () => {});
      child.stdin.end(inputBuffer);
    } else {
      child.stdin.end();
    }
  });
}

// Converte um buffer PNG em sticker webp estático (quadrado, 512x512)
async function pngToWebp(pngBuffer, outFile) {
  await runFfmpeg([
    '-i', 'pipe:0',
    '-vf', 'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000',
    '-c:v', 'libwebp', '-lossless', '0', '-q:v', '75',
    outFile,
  ], pngBuffer);
  return fsp.readFile(outFile);
}

function renderTextLayer(font, text, maxW, maxH, colorHex, blurPx = 0) {
  const layer = new Jimp({ width: maxW, height: maxH, color: 0x00000000 });
  layer.print({
    font,
    x: 0,
    y: 0,
    text,
    maxWidth: maxW,
    maxHeight: maxH,
    alignmentX: HorizontalAlign.CENTER,
    alignmentY: VerticalAlign.MIDDLE,
  });
  const rgb = {
    r: (colorHex >> 16) & 0xff,
    g: (colorHex >> 8) & 0xff,
    b: colorHex & 0xff,
  };
  layer.scan((x, y, idx) => {
    if (layer.bitmap.data[idx + 3] > 0) {
      layer.bitmap.data[idx] = rgb.r;
      layer.bitmap.data[idx + 1] = rgb.g;
      layer.bitmap.data[idx + 2] = rgb.b;
    }
  });
  if (blurPx > 0) layer.blur(Math.min(blurPx, 100));
  return layer;
}

async function withTempDir(fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'canvas-'));
  try {
    return await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Gera sticker estático Brat (texto desfocado sobre fundo sólido).
 * Retorna Buffer webp (512x512).
 */
async function gerarbrat(query, bg, text_color, blur) {
  try {
    if (!query) return { ok: false, msg: 'O texto (query) é obrigatório' };

    const cacheKey = `brat:${String(query).toLowerCase()}:${bg}:${text_color}:${blur}`;
    const cached = getCached(cacheKey);
    if (cached) return { ok: true, ...cached, cached: true };

    const bgHex = parseColor(bg, 0xffffff);
    const textHex = parseColor(text_color, 0x000000);
    const blurPx = Math.max(0, parseInt(blur, 10) || 0);

    const font = await getFont();
    const img = new Jimp({ width: 512, height: 512, color: bgHex * 256 + 0xff });
    const textLayer = renderTextLayer(font, String(query), 460, 460, textHex, blurPx);
    img.composite(textLayer, 26, 26);
    const pngBuffer = await img.getBuffer('image/png');

    const buffer = await withTempDir(dir => pngToWebp(pngBuffer, path.join(dir, 'out.webp')));

    const result = {
      criador: 'Tokyo',
      type: 'image',
      mime: 'image/webp',
      query,
      buffer,
    };

    setCache(cacheKey, result);
    return { ok: true, ...result };

  } catch (err) {
    return { ok: false, msg: err.message };
  }
}

/**
 * Gera sticker animado Brat (texto pulsando em loop, ritmo por BPM).
 * Retorna Buffer webp animado (512x512).
 */
async function gerarbratvid(query, bg, text_color, bpm, blur) {
  try {
    if (!query) return { ok: false, msg: 'O texto (query) é obrigatório' };

    const cacheKey = `bratvid:${String(query).toLowerCase()}:${bg}:${text_color}:${bpm}:${blur}`;
    const cached = getCached(cacheKey);
    if (cached) return { ok: true, ...cached, cached: true };

    const bgHex = parseColor(bg, 0xffffff);
    const textHex = parseColor(text_color, 0x000000);
    const bpmNum = Math.min(240, Math.max(30, parseFloat(bpm) || 120));
    const baseBlur = Math.max(0, parseInt(blur, 10) || 2);

    const font = await getFont();
    const frames = 16;
    const fps = Math.max(4, Math.round(bpmNum / 8));
    // Cada ciclo de pulso dura (60/bpm)s; o número de frames por pulso
    // define o quanto o desfoque oscila ao longo do loop.
    const pulseFrames = Math.max(2, Math.round((60 / bpmNum) * fps));

    const buffer = await withTempDir(async dir => {
      for (let i = 0; i < frames; i++) {
        const phase = (i % pulseFrames) / pulseFrames;
        const osc = 0.5 - 0.5 * Math.cos(2 * Math.PI * phase); // 0→1→0
        const frame = new Jimp({ width: 512, height: 512, color: bgHex * 256 + 0xff });
        const textLayer = renderTextLayer(font, String(query), 460, 460, textHex, Math.round(baseBlur + osc * 6));
        frame.composite(textLayer, 26, 26);
        const png = await frame.getBuffer('image/png');
        await fsp.writeFile(path.join(dir, `frame-${String(i).padStart(3, '0')}.png`), png);
      }
      const outFile = path.join(dir, 'out.webp');
      await runFfmpeg([
        '-framerate', String(fps),
        '-i', path.join(dir, 'frame-%03d.png'),
        '-c:v', 'libwebp_anim', '-lossless', '0', '-q:v', '75',
        '-loop', '0', '-preset', 'default',
        '-vf', 'scale=512:512',
        outFile,
      ]);
      return fsp.readFile(outFile);
    });

    const result = {
      criador: 'Tokyo',
      type: 'video',
      mime: 'image/webp',
      query,
      buffer,
    };

    setCache(cacheKey, result);
    return { ok: true, ...result };

  } catch (err) {
    return { ok: false, msg: err.message };
  }
}

function drawDisc(layer, cx, cy, radius, colorHex) {
  const rgb = {
    r: (colorHex >> 16) & 0xff,
    g: (colorHex >> 8) & 0xff,
    b: colorHex & 0xff,
  };
  const r2 = radius * radius;
  const minX = Math.max(0, Math.floor(cx - radius));
  const maxX = Math.min(layer.width - 1, Math.ceil(cx + radius));
  const minY = Math.max(0, Math.floor(cy - radius));
  const maxY = Math.min(layer.height - 1, Math.ceil(cy + radius));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy <= r2) {
        const idx = (y * layer.width + x) * 4;
        layer.bitmap.data[idx] = rgb.r;
        layer.bitmap.data[idx + 1] = rgb.g;
        layer.bitmap.data[idx + 2] = rgb.b;
        layer.bitmap.data[idx + 3] = 255;
      }
    }
  }
  return layer;
}

function drawLine(layer, x1, x2, y, thickness, colorHex) {
  const rgb = {
    r: (colorHex >> 16) & 0xff,
    g: (colorHex >> 8) & 0xff,
    b: colorHex & 0xff,
  };
  for (let yy = y; yy < y + thickness; yy++) {
    for (let xx = x1; xx < x2; xx++) {
      if (yy >= 0 && yy < layer.height && xx >= 0 && xx < layer.width) {
        const idx = (yy * layer.width + xx) * 4;
        layer.bitmap.data[idx] = rgb.r;
        layer.bitmap.data[idx + 1] = rgb.g;
        layer.bitmap.data[idx + 2] = rgb.b;
        layer.bitmap.data[idx + 3] = 255;
      }
    }
  }
  return layer;
}

function circleCrop(img, diameter) {
  img = img.cover({ w: diameter, h: diameter });
  const mask = new Jimp({ width: diameter, height: diameter, color: 0x00000000 });
  drawDisc(mask, diameter / 2, diameter / 2, diameter / 2, 0xffffff);
  img.mask(mask, 0, 0);
  return img;
}

/**
 * Gera card de boas-vindas (avatar circular + moldura + textos).
 * Retorna Buffer PNG (1200x600).
 */
async function gerarwelcomecard(avatar, nome, texto, fundo, corMoldura, corLinhas, glow) {
  try {
    if (!avatar || !nome) {
      return { ok: false, msg: 'Avatar e Nome são obrigatórios para o Welcome Card' };
    }

    const W = 1200, H = 600;
    const frameHex = parseColor(corMoldura, 0x8a5fd0);
    const linesHex = parseColor(corLinhas, 0x8a5fd0);

    // Fundo: imagem custom (cover) ou gradiente escuro padrão
    const card = new Jimp({ width: W, height: H, color: 0x101018ff });
    if (fundo) {
      try {
        const bgBuf = await downloadBuffer(fundo);
        const bgImg = await Jimp.read(bgBuf);
        bgImg.cover({ w: W, h: H });
        card.composite(bgImg, 0, 0);
        const shade = new Jimp({ width: W, height: H, color: 0x000000a0 });
        card.composite(shade, 0, 0);
      } catch {
        // fundo inválido/indisponível → mantém fundo padrão
      }
    }

    // Avatar circular com moldura
    const avatarD = 300;
    const ringW = 10;
    const cx = 280, cy = H / 2;
    let avatarImg;
    try {
      const avBuf = await downloadBuffer(avatar);
      avatarImg = await Jimp.read(avBuf);
    } catch {
      avatarImg = new Jimp({ width: avatarD, height: avatarD, color: 0x3d3d4dff });
    }
    const avatarCircle = circleCrop(avatarImg, avatarD);

    if (glow === true || glow === 'true') {
      const glowLayer = new Jimp({ width: W, height: H, color: 0x00000000 });
      drawDisc(glowLayer, cx, cy, avatarD / 2 + ringW, frameHex);
      glowLayer.blur(20);
      card.composite(glowLayer, 0, 0);
    }
    const ring = new Jimp({ width: W, height: H, color: 0x00000000 });
    drawDisc(ring, cx, cy, avatarD / 2 + ringW, frameHex);
    card.composite(ring, 0, 0);
    card.composite(avatarCircle, cx - avatarD / 2, cy - avatarD / 2);

    // Linhas decorativas
    const linesLayer = new Jimp({ width: W, height: H, color: 0x00000000 });
    drawLine(linesLayer, 520, 1140, 190, 4, linesHex);
    drawLine(linesLayer, 520, 1140, 410, 4, linesHex);
    card.composite(linesLayer, 0, 0);

    // Textos: renderiza em caixa larga, recorta pelo bbox alfa e escala para a zona
    const font = await getFont();
    const fitText = (text, colorHex, zoneY, zoneH) => {
      if (!text) return;
      const layer = renderTextLayer(font, text, 1200, 400, colorHex);
      let minX = layer.width, minY = layer.height, maxX = -1, maxY = -1;
      layer.scan((x, y, idx) => {
        if (layer.bitmap.data[idx + 3] > 0) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      });
      if (maxX < 0) return;
      let crop = layer.crop({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 });
      const fit = Math.min(620 / crop.width, zoneH / crop.height, 1);
      if (fit < 1) crop = crop.scale(fit * 0.98);
      card.composite(crop, 520 + (620 - crop.width) / 2, zoneY + (zoneH - crop.height) / 2);
    };
    fitText(String(nome), 0xffffff, 200, 110);
    fitText(String(texto || ''), 0xd8d8e8, 310, 90);

    const buffer = await card.getBuffer('image/png');

    return {
      ok: true,
      criador: 'Tokyo',
      type: 'image',
      mime: 'image/png',
      nome,
      buffer,
    };

  } catch (err) {
    return { ok: false, msg: err.message };
  }
}

export {
  gerarbrat,
  gerarbratvid,
  gerarwelcomecard
};
