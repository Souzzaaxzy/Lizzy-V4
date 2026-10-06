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

function pagina(jogoId) {
  const cfg = lerConfig();
  const base = process.env.TOPGEAR_PUBLIC_URL || cfg.publicUrl;
  if (!base) return '';
  const raiz = String(base).replace(/\/$/, '').replace(/\/index\.html$/, '');
  return jogoId ? `${raiz}/?jogo=${encodeURIComponent(jogoId)}` : raiz;
}

export default { pagina, config: lerConfig };
