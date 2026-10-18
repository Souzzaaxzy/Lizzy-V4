import { Jimp, loadFont, HorizontalAlign, VerticalAlign } from 'jimp';
import { fileURLToPath } from 'url';

/**
 * CARTEIRINHA do membro.
 *
 * Gera um PNG (900x560) com a FOTO do perfil, o nome, o "cargo" no grupo, a
 * data de entrada e um numero de serie. E' um documento visual " unico por
 * pessoa, e nao um texto com emoji.
 *
 * ## Por que jimp e nao sharp
 *
 * O projeto ja' desenha os cards (welcome, logos, brat) com **jimp** + a fonte
 * bitmap (`logos/fonts/dejavu-bold-96.fnt`). Seguir o mesmo caminho evita uma
 * segunda engine de texto e reaproveita a fonte que ja' cobre acentos PT-BR.
 *
 * ## O desenho e' local
 *
 * A foto chega como **Buffer** (o chamador baixa do WhatsApp); o modulo nao
 * fala com a rede. Assim ele e' testavel sem socket e sem internet.
 */

// A fonte mora em `funcs/logos/fonts/` (este arquivo esta' em `utils/`, entao
// precisa voltar e entrar em `funcs`).
const FONT_URL = new URL('../funcs/logos/fonts/dejavu-bold-96.fnt', import.meta.url);

let fontPromise = null;
function getFont() {
  if (!fontPromise) fontPromise = loadFont(fileURLToPath(FONT_URL));
  return fontPromise;
}

// ── cores ────────────────────────────────────────────────────────────────────
const COR_FUNDO = 0x0e0e14ff;
const COR_PAINEL = 0x181822ff;
const COR_ACENTO = 0xcfb755ff;   // o dourado do layout da Lizzy
const COR_ACENTO_ESCURO = 0x8a7a2eff;
const COR_TEXTO = 0xffffffff;
const COR_TEXTO_FRACO = 0xb8b8c8ff;
const COR_FOTO_VAZIA = 0x2a2a3aff;

/** Desenha um disco cheio numa camada. */
function drawDisc(layer, cx, cy, radius, colorHex) {
  const r = (colorHex >> 24) & 0xff;
  const g = (colorHex >> 16) & 0xff;
  const b = (colorHex >> 8) & 0xff;
  const a = colorHex & 0xff;
  const r2 = radius * radius;
  const minX = Math.max(0, Math.floor(cx - radius));
  const maxX = Math.min(layer.width - 1, Math.ceil(cx + radius));
  const minY = Math.max(0, Math.floor(cy - radius));
  const maxY = Math.min(layer.height - 1, Math.ceil(cy + radius));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) {
        const idx = (y * layer.width + x) * 4;
        layer.bitmap.data[idx] = r;
        layer.bitmap.data[idx + 1] = g;
        layer.bitmap.data[idx + 2] = b;
        layer.bitmap.data[idx + 3] = a;
      }
    }
  }
  return layer;
}

/** Retangulo cheio (com alpha). */
function drawRect(layer, x0, y0, w, h, colorHex) {
  const r = (colorHex >> 24) & 0xff;
  const g = (colorHex >> 16) & 0xff;
  const b = (colorHex >> 8) & 0xff;
  const a = colorHex & 0xff;
  for (let y = y0; y < y0 + h; y++) {
    if (y < 0 || y >= layer.height) continue;
    for (let x = x0; x < x0 + w; x++) {
      if (x < 0 || x >= layer.width) continue;
      const idx = (y * layer.width + x) * 4;
      layer.bitmap.data[idx] = r;
      layer.bitmap.data[idx + 1] = g;
      layer.bitmap.data[idx + 2] = b;
      layer.bitmap.data[idx + 3] = a;
    }
  }
  return layer;
}

/** Recorta a imagem num circulo (com a foto "cover"). */
function circleCrop(img, diameter) {
  const out = img.clone().cover({ w: diameter, h: diameter });
  const mask = new Jimp({ width: diameter, height: diameter, color: 0x00000000 });
  drawDisc(mask, diameter / 2, diameter / 2, diameter / 2, 0xffffffff);
  out.mask(mask, 0, 0);
  return out;
}

/** Bounding box do que tem alpha > 0. */
function alphaBBox(layer) {
  let minX = layer.width;
  let minY = layer.height;
  let maxX = -1;
  let maxY = -1;
  layer.scan((x, y, idx) => {
    if (layer.bitmap.data[idx + 3] > 8) {
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
 * Renderiza UM texto e devolve a imagem ja' ajustada a uma caixa.
 *
 * O `print` do jimp desenha numa camada; recortamos pelo bbox alfa (senao a
 * caixa inteira vira area) e reduzimos se passar da largura/altura pedidas.
 */
async function renderText(texto, colorHex, maxW, maxH, align = HorizontalAlign.LEFT) {
  const str = String(texto ?? '').trim();
  if (!str) return null;
  const font = await getFont();
  const layer = new Jimp({ width: maxW + 80, height: maxH + 160, color: 0x00000000 });
  layer.print({
    font,
    x: 40,
    y: 40,
    text: str,
    maxWidth: maxW,
    maxHeight: maxH + 80,
    alignmentX: align,
    alignmentY: VerticalAlign.MIDDLE,
  });
  const bbox = alphaBBox(layer);
  if (!bbox) return null;
  let out = layer.crop({ x: bbox.x, y: bbox.y, w: bbox.w, h: bbox.h });
  const fit = Math.min(maxW / out.width, maxH / out.height, 1);
  if (fit < 1) out = out.scale(fit);
  // Colore: o print sai branco; pinta os pixels visiveis com a cor pedida.
  const r = (colorHex >>> 24) & 0xff;
  const g = (colorHex >>> 16) & 0xff;
  const b = (colorHex >>> 8) & 0xff;
  out.scan((x, y, idx) => {
    if (out.bitmap.data[idx + 3] > 0) {
      out.bitmap.data[idx] = r;
      out.bitmap.data[idx + 1] = g;
      out.bitmap.data[idx + 2] = b;
    }
  });
  return out;
}

/** Numero de serie curto e estavel a partir do id (nao e' aleatorio). */
export function serieDe(id) {
  const base = String(id || 'anon').replace(/[^a-zA-Z0-9]/g, '');
  let h = 0x811c9dc5;
  for (let i = 0; i < base.length; i++) {
    h ^= base.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const n = h % 1000000;
  return `LZ-${String(n).padStart(6, '0')}`;
}

/** Data no formato brasileiro (a partir de ms). */
export function dataBR(ms) {
  try {
    return new Date(ms).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  } catch {
    return '';
  }
}

/**
 * Gera a carteirinha.
 *
 * @param {object} p
 * @param {Buffer|null} p.foto      foto de perfil (PNG/JPG). Sem ela, um placeholder.
 * @param {string} p.nome           nome do membro
 * @param {string} [p.cargo]        cargo no grupo (Dono/Admin/Membro...)
 * @param {number} [p.entrouEm]     ms de quando entrou no grupo
 * @param {string} [p.serie]        numero de serie (default: derivado do id)
 * @param {string} [p.id]           id do membro (para a serie)
 * @param {string} [p.grupo]        nome do grupo (rodape)
 * @returns {Promise<{ok:boolean, buffer?:Buffer, mime?:string, msg?:string}>}
 */
export async function gerarCarteirinha({
  foto = null, nome, cargo = 'Membro', entrouEm = null,
  serie = null, id = null, grupo = null,
} = {}) {
  try {
    const nomeLimpo = String(nome ?? '').trim();
    if (!nomeLimpo) return { ok: false, msg: 'Nome é obrigatório para a carteirinha' };

    const W = 900;
    const H = 560;
    const card = new Jimp({ width: W, height: H, color: COR_FUNDO });

    // ── fundo: painel + barra de acento ──
    const painel = new Jimp({ width: W, height: H, color: 0x00000000 });
    drawRect(painel, 0, 0, W, 8, COR_ACENTO);            // barra do topo
    drawRect(painel, 0, H - 8, W, 8, COR_ACENTO_ESCURO); // barra de baixo
    drawRect(painel, 24, 24, W - 48, H - 48, 0x14141eff); // painel interno
    card.composite(painel, 0, 0);

    // ── foto circular com anel ──
    const fotoD = 200;
    const cx = 150;
    const cy = H / 2;
    let fotoImg;
    try {
      if (foto && Buffer.isBuffer(foto) && foto.length) {
        fotoImg = await Jimp.read(foto);
      } else {
        fotoImg = new Jimp({ width: fotoD, height: fotoD, color: COR_FOTO_VAZIA });
      }
    } catch {
      fotoImg = new Jimp({ width: fotoD, height: fotoD, color: COR_FOTO_VAZIA });
    }
    const anel = new Jimp({ width: W, height: H, color: 0x00000000 });
    drawDisc(anel, cx, cy, fotoD / 2 + 7, COR_ACENTO);
    card.composite(anel, 0, 0);
    card.composite(circleCrop(fotoImg, fotoD), cx - fotoD / 2, cy - fotoD / 2);

    // ── textos ──
    const xTexto = 290;
    const larguraTexto = W - xTexto - 40;

    const titulo = await renderText('CARTEIRINHA', COR_ACENTO, larguraTexto, 34);
    if (titulo) card.composite(titulo, xTexto, 62);

    const nomeImg = await renderText(nomeLimpo, COR_TEXTO, larguraTexto, 62);
    if (nomeImg) card.composite(nomeImg, xTexto, 118);

    const cargoImg = await renderText(String(cargo).toUpperCase(), COR_ACENTO, larguraTexto, 34);
    if (cargoImg) card.composite(cargoImg, xTexto, 200);

    // linha separadora
    const sep = new Jimp({ width: W, height: H, color: 0x00000000 });
    drawRect(sep, xTexto, 254, larguraTexto, 2, 0x3a3a4aff);
    card.composite(sep, 0, 0);

    const entrou = entrouEm ? dataBR(entrouEm) : null;
    const info1 = await renderText(entrou ? `No grupo desde ${entrou}` : 'Membro do grupo', COR_TEXTO_FRACO, larguraTexto, 34);
    if (info1) card.composite(info1, xTexto, 282);

    const numSerie = serie || serieDe(id || nomeLimpo);
    const info2 = await renderText(`Nº ${numSerie}`, COR_TEXTO_FRACO, larguraTexto, 34);
    if (info2) card.composite(info2, xTexto, 330);

    const rodape = await renderText(grupo ? `Grupo: ${grupo}` : 'Documento do grupo', COR_TEXTO_FRACO, larguraTexto, 30);
    if (rodape) card.composite(rodape, xTexto, 400);

    // ── selo (canto inferior direito) ──
    const selo = new Jimp({ width: W, height: H, color: 0x00000000 });
    drawDisc(selo, W - 90, H - 90, 46, 0x1e1e2aff);
    drawDisc(selo, W - 90, H - 90, 42, COR_ACENTO_ESCURO);
    drawDisc(selo, W - 90, H - 90, 36, 0x14141eff);
    card.composite(selo, 0, 0);
    const seloTxt = await renderText('LZ', COR_ACENTO, 60, 30, HorizontalAlign.CENTER);
    if (seloTxt) card.composite(seloTxt, W - 90 - seloTxt.width / 2, H - 90 - seloTxt.height / 2);

    const buffer = await card.getBuffer('image/png');
    return { ok: true, buffer, mime: 'image/png', nome: nomeLimpo, serie: numSerie };
  } catch (e) {
    return { ok: false, msg: e?.message || String(e) };
  }
}

export default { gerarCarteirinha, serieDe, dataBR };
