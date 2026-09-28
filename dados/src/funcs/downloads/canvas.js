import { Jimp, loadFont, measureText, HorizontalAlign, VerticalAlign } from 'jimp';
import { splitEmoji, preloadEmoji, hasEmoji } from './emojiRender.js';
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

/** Escala da fonte bitmap por glifo. */
const FONT_SCALE = (font) => font?.common?.lineHeight / 113 || 1;

/**
 * Largura de um trecho para a fonte bitmap (soma dos xadvance, como o jimp faz).
 *
 * `measureText` do jimp devolve 0 para qualquer char ausente da fonte — que e'
 * exatamente o caso do emoji. Por isso o emoji NUNCA entra nesta conta: ele tem
 * largura propria (a altura da linha) e e' desenhado como imagem.
 */
function measureRun(font, text) {
  return measureText(font, text);
}

/** Limite de caracteres do texto (o auto-ajuste da escala cuida do resto). */
const MAX_TEXT_CHARS = 300;

/**
 * Recorta o texto ao limite, preservando o emoji inteiro.
 *
 * O corte e' por code point (spread), nunca por indice de string: cortar no meio
 * de um par surrogate quebraria o emoji, e cortar dentro de um ZWJ mudaria a
 * figurinha (`👨‍👩‍👧` viraria outra coisa).
 */
function clampText(text, max = MAX_TEXT_CHARS) {
  const t = String(text);
  if (t.length <= max) return t;
  return [...t].slice(0, max).join('') + '…';
}

/**
 * Largura de uma palavra mista (texto + emoji) na escala da fonte.
 *
 * Espelha o que o jimp faria com o texto, trocando cada emoji pela largura da
 * linha — assim a quebra de linha do bitmap font continua valendo com emoji no
 * meio, e um emoji "cabe" como um caractere.
 *
 * E' exportado porque e' o unico jeito de medir texto com emoji: o `measureText`
 * do jimp devolve 0 para o emoji (char ausente da fonte).
 */
export function measureMixed(font, text, emojiWidth = null) {
  const scale = FONT_SCALE(font);
  const emW = emojiWidth ?? (font?.common?.lineHeight || 113) * scale;
  let w = 0;
  for (const run of splitEmoji(text)) {
    w += run.type === 'emoji' ? emW : measureRun(font, run.value);
  }
  return w;
}

/**
 * Quebra um texto em linhas na largura dada, respeitando emoji.
 *
 * E' a fonte UNICA da quebra de linha: o mesmo calculo alimenta o desenho
 * (`renderMixedLayer`) e a escolha de escala (`renderScaledLayer`). Sem isso,
 * medir a altura exigiria renderizar o texto so' para contar as linhas.
 *
 * @returns {{ lines, widths, maxWidth, height, lineHeight, emojiSize, spaceW }}
 */
export function layoutLines(font, text, maxW, emojiImages = new Map()) {
  const lineHeight = font?.common?.lineHeight || 113;
  const emojiSize = Math.round(lineHeight);
  const spaceW = measureRun(font, ' ');

  /**
   * Quebra uma palavra larga demais em pedacos que caibam.
   *
   * Sem isto, uma palavra/URL sem espacos maior que a largura faria o texto
   * inteiro ser reduzido por escala — medido: 200 caracteres viravam um risco de
   * 462x5 px, ilegivel.
   */
  const breakWord = (word, limit) => {
    const out = [];
    for (const run of splitEmoji(word)) {
      const units = run.type === 'emoji'
        ? [{ type: 'emoji', value: run.value }]
        : [...run.value].map((ch) => ({ type: 'text', value: ch }));
      let chunk = '';
      let chunkW = 0;
      let emojis = 0;
      for (const unit of units) {
        const uW = unit.type === 'emoji' ? emojiSize : measureRun(font, unit.value);
        if (chunk && chunkW + uW > limit) {
          out.push({ word: chunk, w: chunkW, emojis });
          chunk = '';
          chunkW = 0;
          emojis = 0;
        }
        chunk += unit.value;
        if (unit.type === 'emoji') emojis += 1;
        chunkW += uW;
      }
      if (chunk) out.push({ word: chunk, w: chunkW, emojis });
    }
    return out;
  };

  const lines = [];
  const widths = [];
  let current = [];
  let currentW = 0;
  const flush = () => {
    lines.push(current);
    widths.push(currentW);
    current = [];
    currentW = 0;
  };
  for (const rawWord of String(text).replace(/[\r\n]+/g, ' \n').split(' ')) {
    for (const piece of breakWord(rawWord, maxW)) {
      if (current.length && currentW + spaceW + piece.w > maxW) flush();
      current.push(piece);
      currentW += (current.length > 1 ? spaceW : 0) + piece.w;
    }
  }
  flush();
  if (lines.length > 1 && lines[lines.length - 1].length === 0) {
    lines.pop();
    widths.pop();
  }
  return {
    lines,
    widths,
    maxWidth: widths.length ? Math.max(...widths) : 0,
    height: lines.length * lineHeight,
    lineHeight,
    emojiSize,
    spaceW,
  };
}

/**
 * Desenha texto (fonte bitmap) + emoji (imagem) numa layer propria.
 *
 * ## Como o layout funciona
 *
 * O jimp desenha uma linha de cada vez, e o emoji nao pode entrar no `print()`
 * (a fonte nao tem o glifo e o jimp o troca por "?"). Entao:
 *
 *   1. `layoutLines` quebra o texto em linhas (descontando a largura do emoji);
 *   2. o TEXTO vai para uma layer propria, que e' recolorida e desfocada;
 *   3. os EMOJIS entram depois por `composite()`, na linha de base do texto, e
 *      por isso mantem a cor original.
 *
 * @param emojiImages Map cluster -> Jimp image (de `preloadEmoji`)
 */
export function renderMixedLayer(font, text, maxW, maxH, colorHex, blurPx = 0, opts = {}) {
  const {
    alignX = HorizontalAlign.CENTER,
    alignY = VerticalAlign.MIDDLE,
    y = 0,
    emojiImages = new Map(),
  } = opts;

  const { lines, widths, lineHeight, emojiSize, spaceW } = layoutLines(font, text, maxW, emojiImages);
  const totalH = lines.length * lineHeight;
  let startY = y;
  if (alignY === VerticalAlign.MIDDLE) startY = y + Math.max(0, (maxH - totalH) / 2);
  else if (alignY === VerticalAlign.BOTTOM) startY = y + Math.max(0, maxH - totalH);

  const layerH = Math.max(1, Math.ceil(startY + totalH));
  const textLayer = new Jimp({ width: maxW, height: layerH, color: 0x00000000 });
  const placements = [];

  lines.forEach((line, li) => {
    const lineW = widths[li];
    let x = 0;
    if (alignX === HorizontalAlign.CENTER) x = Math.max(0, (maxW - lineW) / 2);
    else if (alignX === HorizontalAlign.RIGHT) x = Math.max(0, maxW - lineW);

    const baseY = Math.round(startY + li * lineHeight);

    line.forEach((piece, pi) => {
      if (pi) x += spaceW;
      for (const run of splitEmoji(piece.word)) {
        if (run.type === 'text') {
          if (run.value) {
            textLayer.print({
              font, x: Math.round(x), y: baseY, text: run.value,
              maxWidth: maxW, maxHeight: layerH,
              alignmentX: HorizontalAlign.LEFT, alignmentY: VerticalAlign.TOP,
            });
            x += measureRun(font, run.value);
          }
          continue;
        }
        const img = emojiImages.get(run.value);
        if (img) {
          placements.push({ img, x: Math.round(x), y: Math.round(baseY + (lineHeight - emojiSize) / 2) });
        } else {
          // sem imagem (rede fora): mantem o "?" do jimp, em vez de sumir com o
          // caractere — o usuario ve' que algo ficou de fora
          textLayer.print({
            font, x: Math.round(x), y: baseY, text: '?',
            maxWidth: maxW, maxHeight: layerH,
            alignmentX: HorizontalAlign.LEFT, alignmentY: VerticalAlign.TOP,
          });
        }
        x += emojiSize;
      }
    });
  });

  const rgb = {
    r: (colorHex >> 16) & 0xff,
    g: (colorHex >> 8) & 0xff,
    b: colorHex & 0xff,
  };
  textLayer.scan((x, y, idx) => {
    if (textLayer.bitmap.data[idx + 3] > 0) {
      textLayer.bitmap.data[idx] = rgb.r;
      textLayer.bitmap.data[idx + 1] = rgb.g;
      textLayer.bitmap.data[idx + 2] = rgb.b;
    }
  });
  if (blurPx > 0) textLayer.blur(Math.min(blurPx, 100));

  const layer = new Jimp({ width: maxW, height: layerH, color: 0x00000000 });
  layer.composite(textLayer, 0, 0);
  for (const p of placements) {
    layer.composite(p.img.clone().resize({ w: emojiSize, h: emojiSize }), p.x, p.y);
  }
  return layer;
}

/** Numero de passos da busca binaria de escala. */
const FIT_STEPS = 22;
/** Menor escala considerada (abaixo disto o texto e' ilegivel de qualquer forma). */
const MIN_FIT_SCALE = 0.08;

/**
 * Renderiza TEXTO + EMOJI centralizado num box, escolhendo a maior escala que caiba.
 *
 * ## Por que a escala e' da FONTE, e nao do bloco depois de desenhado
 *
 * A fonte tem 113 px de altura de linha: em 460 px cabem so' ~4 linhas de ~7
 * caracteres. A abordagem anterior desenhava nesse tamanho e depois reduzia o
 * bloco inteiro por escala, o que encolhia TUDO junto — medido: uma frase de 94
 * caracteres virava uma tira de 128 px de largura com 15 linhas.
 *
 * Aqui a escala entra na LARGURA usada para quebrar: com a fonte menor, cabem
 * mais palavras por linha e o bloco fica naturalmente mais quadrado. A busca
 * binaria acha a maior escala cujo bloco cabe no box — sem renderizar 22 vezes,
 * porque a altura vem do layout (`layoutLines`), nao dos pixels.
 */
export async function renderScaledLayer(font, text, boxW, boxH, colorHex, blurPx = 0) {
  const emojiImages = await preloadEmoji(text);

  const layoutAt = (scale) => layoutLines(font, text, boxW / scale, emojiImages);
  const fits = (scale) => {
    const L = layoutAt(scale);
    return L.height * scale <= boxH && L.maxWidth * scale <= boxW;
  };

  let lo = MIN_FIT_SCALE;
  let hi = 1;
  let best = fits(1) ? 1 : lo;
  if (best !== 1) {
    for (let i = 0; i < FIT_STEPS; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) {
        best = mid;
        lo = mid;
      } else {
        hi = mid;
      }
    }
  }

  const layout = layoutAt(best);
  const drawW = Math.max(1, Math.ceil(boxW / best));
  const layer = renderMixedLayer(font, text, drawW, Math.max(1, Math.ceil(layout.height)), colorHex, blurPx, {
    alignX: HorizontalAlign.LEFT,
    alignY: VerticalAlign.TOP,
    emojiImages,
  });
  if (best < 1) layer.scale(best);

  const out = new Jimp({ width: boxW, height: boxH, color: 0x00000000 });
  out.composite(layer, Math.max(0, Math.round((boxW - layer.width) / 2)), Math.max(0, Math.round((boxH - layer.height) / 2)));

  return { layer: out, scale: best, blockW: layer.width, blockH: layer.height, emojiImages };
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
    const texto = clampText(query);
    const img = new Jimp({ width: 512, height: 512, color: bgHex * 256 + 0xff });
    // Auto-ajuste + emoji: a frase inteira cabe (o `print()` sozinho parava em
    // ~4 linhas curtas) e o emoji sai desenhado, nao como "?".
    const { layer: textLayer } = await renderScaledLayer(font, texto, 460, 460, textHex, blurPx);
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
 * Gera sticker animado Brat: o texto surge palavra por palavra (typewriter)
 * até formar a frase inteira, pausa e recomeça em loop. Ritmo por BPM
 * (1 palavra por batida). Retorna Buffer webp animado (512x512).
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
    const blurPx = Math.max(0, parseInt(blur, 10) || 2);

    const font = await getFont();

    const words = String(query).trim().split(/\s+/);
    const wordsPerStep = Math.max(1, Math.ceil(words.length / 20)); // teto de ~20 passos
    const steps = Math.ceil(words.length / wordsPerStep);
    /**
     * Ritmo da animacao — TODA palavra fica o mesmo tempo na tela.
     *
     * Duas armadilhas, as duas medidas no arquivo gerado:
     *
     * 1. O codigo antigo usava `fps = round(bpm/60)` (2 fps a 120 bpm), o que ja'
     *    dava um video a 2 quadros por segundo.
     * 2. Ele somava `holdFrames = max(2, fps)` quadros PARADOS com a frase
     *    completa "para o loop respirar". Mas o encoder de webp FUNDE frames
     *    identicos e soma as duracoes, entao o hold nao era uma pausa separada:
     *    ele entrava na conta da ultima palavra. Resultado medido:
     *    `duracoes = [500, 500, 1500]` — a palavra final 3x mais lenta, que e' o
     *    "a palavra final demora uns 2 segundos".
     *
     * Agora o video roda a 25 fps (o maximo que o WhatsApp exibe) e cada passo
     * ocupa `framesPerStep` quadros iguais; nao ha hold, entao a ultima palavra
     * dura exatamente o mesmo que as demais (medido: `[520]` a 120 bpm).
     */
    const FPS = 25;
    const framesPerStep = Math.max(1, Math.round((FPS * 60) / bpmNum)); // 1 palavra por batida

    const texto = clampText(query);
    const fullText = words.join(' ');

    const buffer = await withTempDir(async dir => {
      // Auto-ajuste (o mesmo do !brat): a frase inteira cabe em 460x460 sem
      // depender do teto de altura do print(); textos longos passam a caber.
      // E o emoji entra como imagem — a fonte bitmap nao tem esse glifo.
      // A escala e' a MESMA em todos os frames (calculada pela frase completa),
      // entao as palavras ja' exibidas nao se movem quando as novas aparecem.
      const { scale } = await renderScaledLayer(font, fullText, 460, 460, textHex, blurPx);
      const emojiImages = await preloadEmoji(texto);

      let frameIdx = 0;
      // Cache por conteudo: cada passo e' escrito framesPerStep vezes, entao sem
      // isto o mesmo frame seria rasterizado varias vezes sem necessidade.
      const pngByText = new Map();
      const writeFrame = async text => {
        let png = pngByText.get(text);
        if (!png) {
          // Cada frame usa a MESMA largura de quebra e a MESMA escala da frase
          // completa: as palavras que ja' apareceram ficam exatamente onde
          // estavam, e o bloco e' centralizado verticalmente no box.
          const drawW = Math.max(1, Math.ceil(460 / scale));
          const layer = renderMixedLayer(font, text, drawW, 8192, textHex, blurPx, {
            alignX: HorizontalAlign.LEFT,
            alignY: VerticalAlign.TOP,
            emojiImages,
          });
          if (scale < 1) layer.scale(scale);
          const frame = new Jimp({ width: 512, height: 512, color: bgHex * 256 + 0xff });
          frame.composite(
            layer,
            26 + Math.max(0, Math.round((460 - layer.width) / 2)),
            26 + Math.max(0, Math.round((460 - layer.height) / 2))
          );
          png = await frame.getBuffer('image/png');
          pngByText.set(text, png);
        }
        await fsp.writeFile(
          path.join(dir, `frame-${String(frameIdx++).padStart(3, '0')}.png`),
          png
        );
      };

      for (let i = 0; i < steps; i++) {
        const stepText = words.slice(0, (i + 1) * wordsPerStep).join(' ');
        for (let r = 0; r < framesPerStep; r++) await writeFrame(stepText);
      }
      const outFile = path.join(dir, 'out.webp');
      await runFfmpeg([
        '-framerate', String(FPS),
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
