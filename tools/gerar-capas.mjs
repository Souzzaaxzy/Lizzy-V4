/**
 * Gera capas PLACEHOLDER dos jogos do EmuGames (docs/emugames/capas/<id>.gif).
 *
 * As capas sao o "capa" que aparece no card do !topgear / !metalslug / !kof.
 * O card procura `capas/<id>.gif` (GIF animado); o WhatsApp nao anima um `.gif`
 * cru, entao a fork converte para MP4 + gifPlayback no envio.
 *
 * Estes arquivos sao so um fallback: para usar uma arte/animação propria, e so
 * substituir o `.gif` mantendo o nome (o `id` do jogo).
 *
 * Uso: node tools/gerar-capas.mjs
 * Requer: sharp (ja e dependencia do bot).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEST = path.join(RAIZ, 'docs/emugames/capas');

const CORES = {
  snes: ['#1d4ed8', '#0b1b46'],
  arcade: ['#b91c1c', '#2a0808'],
  nes: ['#b91c1c', '#2a0808'],
  genesis: ['#0369a1', '#062231'],
  gba: ['#7c3aed', '#221048']
};

const NOMES = {
  snes: 'SUPER NINTENDO',
  arcade: 'NEO GEO · ARCADE',
  nes: 'NINTENDO',
  genesis: 'MEGA DRIVE',
  gba: 'GAME BOY ADVANCE'
};

function svg({ nome, console }) {
  const [c1, c2] = CORES[console] || CORES.snes;
  const sistema = NOMES[console] || console.toUpperCase();
  const titulo = nome.length > 22 ? nome.slice(0, 21) + '…' : nome;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${c1}"/>
      <stop offset="100%" stop-color="${c2}"/>
    </linearGradient>
  </defs>
  <rect width="1280" height="720" fill="url(#bg)"/>
  <rect x="48" y="48" width="1184" height="624" rx="28" fill="none" stroke="#ffffff" stroke-opacity="0.22" stroke-width="3"/>
  <text x="640" y="150" text-anchor="middle" fill="#ffffff" fill-opacity="0.72"
        font-family="DejaVu Sans, Arial, sans-serif" font-size="34" letter-spacing="10">EMUGAMES</text>
  <text x="640" y="430" text-anchor="middle" fill="#ffffff"
        font-family="DejaVu Sans, Arial, sans-serif" font-size="86" font-weight="bold">${titulo}</text>
  <text x="640" y="520" text-anchor="middle" fill="#ffffff" fill-opacity="0.80"
        font-family="DejaVu Sans, Arial, sans-serif" font-size="36" letter-spacing="6">${sistema}</text>
</svg>`;
}

const catalogo = JSON.parse(fs.readFileSync(path.join(RAIZ, 'docs/emugames/jogos.json'), 'utf-8'));
fs.mkdirSync(DEST, { recursive: true });

for (const jogo of catalogo.jogos || []) {
  const arquivo = jogo.capa || `${jogo.id}.gif`;
  const destino = path.join(DEST, arquivo);
  await sharp(Buffer.from(svg(jogo))).gif().toFile(destino);
  console.log(`capa: ${path.relative(RAIZ, destino)}`);
}
console.log('ok');
