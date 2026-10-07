/**
 * Gera as capas do EmuGames a partir de imagens REAIS do jogo.
 *
 * Composição (1280x720):
 *   - fundo: a BOXART do jogo, esticada, desfocada e escurecida;
 *   - centro: a TELA DE TÍTULO real (pixel-art, escalada com nearest-neighbor);
 *   - rodapé: nome do jogo + sistema.
 *
 * As imagens-fonte vêm do repositório público libretro-thumbnails
 * (`Named_Titles` / `Named_Boxarts`). Nada é baixado por este script — ele lê os
 * arquivos já colocados em `tools/capas-fonte/<id>.png` (título) e
 * `<id>-box.png` (boxart), e escreve `dados/emugames/capas/<capa>`.
 *
 * Uso: node tools/gerar-capas-libretro.mjs
 * Requer: sharp (dependência do bot).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FONTE = path.join(RAIZ, 'tools', 'capas-fonte');
const DEST = path.join(RAIZ, 'dados', 'emugames', 'capas');

const NOMES = { snes: 'SUPER NINTENDO', arcade: 'NEO GEO · ARCADE' };
const CORES = { snes: '#1d4ed8', arcade: '#b91c1c' };

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function svg({ nome, console }) {
  const cor = CORES[console] || CORES.snes;
  const sistema = NOMES[console] || String(console).toUpperCase();
  const titulo = nome.length > 30 ? nome.slice(0, 29) + '…' : nome;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720">
  <defs>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="55%" stop-color="#000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0.86"/>
    </linearGradient>
  </defs>
  <rect width="1280" height="720" fill="url(#fade)"/>
  <rect x="64" y="40" width="1152" height="6" rx="3" fill="${cor}" opacity="0.9"/>
  <text x="640" y="596" text-anchor="middle" fill="#ffffff"
        font-family="DejaVu Sans, Arial, sans-serif" font-size="60" font-weight="bold">${esc(titulo)}</text>
  <text x="640" y="648" text-anchor="middle" fill="${cor}"
        font-family="DejaVu Sans, Arial, sans-serif" font-size="30" letter-spacing="8">${esc(sistema)}</text>
  <text x="640" y="686" text-anchor="middle" fill="#ffffff" fill-opacity="0.45"
        font-family="DejaVu Sans, Arial, sans-serif" font-size="20" letter-spacing="10">EMUGAMES</text>
</svg>`;
}

const catalogo = JSON.parse(fs.readFileSync(path.join(RAIZ, 'dados/emugames/jogos.json'), 'utf-8'));
fs.mkdirSync(DEST, { recursive: true });

let feitos = 0;
for (const jogo of catalogo.jogos || []) {
  try {
    const tituloFonte = path.join(FONTE, `${jogo.id}.png`);
    const boxFonte = path.join(FONTE, `${jogo.id}-box.png`);
    if (!fs.existsSync(tituloFonte)) {
      console.log(`pula ${jogo.id}: sem titulo em tools/capas-fonte/`);
      continue;
    }

    // fundo: boxart esticada + desfoque + escurecida (se houver boxart)
    const base = sharp({
      create: { width: 1280, height: 720, channels: 3, background: '#0b0d12' },
    });
    const camadas = [];
    if (fs.existsSync(boxFonte)) {
      const fundo = await sharp(boxFonte)
        .resize(1280, 720, { fit: 'cover', position: 'centre' })
        .blur(26)
        .modulate({ brightness: 0.42, saturation: 0.9 })
        .toBuffer();
      camadas.push({ input: fundo, top: 0, left: 0 });
    }

    // título real, pixel-art (nearest), emoldurado no centro-alto
    const alvoW = 704;
    const titulo = await sharp(tituloFonte)
      .resize(alvoW, null, { kernel: 'nearest' })
      .png()
      .toBuffer();
    const meta = await sharp(titulo).metadata();
    const top = Math.max(8, Math.round(56 + (430 - meta.height) / 2));
    camadas.push({ input: titulo, top, left: Math.round((1280 - alvoW) / 2) });

    const destino = path.join(DEST, jogo.capa || `${jogo.id}.gif`);
    await base
      .composite([...camadas, { input: Buffer.from(svg(jogo)), top: 0, left: 0 }])
      .gif()
      .toFile(destino);
    console.log(`capa: ${path.relative(RAIZ, destino)}`);
    feitos += 1;
  } catch (e) {
    console.error(`falhou ${jogo.id}: ${e.message}`);
  }
}
console.log(`ok (${feitos})`);
