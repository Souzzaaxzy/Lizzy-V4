import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

function lerConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf-8'));
  } catch {
    return {};
  }
}

function raiz() {
  const cfg = lerConfig();
  const base = process.env.TOPGEAR_PUBLIC_URL || cfg.publicUrl;
  return base ? String(base).replace(/\/$/, '').replace(/\/index\.html$/, '') : '';
}

function pagina(jogoId) {
  const base = raiz();
  if (!base) return '';
  return jogoId ? `${base}/?jogo=${encodeURIComponent(jogoId)}` : base;
}

export default { pagina, raiz, config: lerConfig };
