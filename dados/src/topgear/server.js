import http from 'node:http';
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

const cfg = lerConfig();
const PORT = Number(process.env.TOPGEAR_PORT || cfg.port || 8099);
const HOST = process.env.TOPGEAR_HOST || cfg.host || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

let server = null;
let porta = 0;
let subindo = null;

function seguro(alvo) {
  const rel = path.relative(ROOT, alvo);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function servir(req, res) {
  const url = new URL(req.url, 'http://localhost');
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const alvo = path.join(ROOT, rel);

  if (!seguro(alvo)) {
    res.writeHead(403).end('forbidden');
    return;
  }

  fs.readFile(alvo, (err, data) => {
    if (err) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(alvo)] || 'application/octet-stream',
      'cache-control': 'public, max-age=3600',
      'access-control-allow-origin': '*',
      'cross-origin-resource-policy': 'cross-origin',
      'content-security-policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' data:; connect-src 'self'; worker-src 'self' blob:"
    });
    res.end(data);
  });
}

export function iniciar() {
  if (porta) return Promise.resolve(porta);
  if (subindo) return subindo;
  subindo = new Promise((resolve) => {
    server = http.createServer(servir);
    server.on('error', (e) => {
      console.error('[TOPGEAR] servidor:', e.message);
      subindo = null;
      resolve(0);
    });
    server.listen(PORT, HOST, () => {
      porta = server.address().port;
      console.log(`[TOPGEAR] servidor de jogo em http://${HOST}:${porta}`);
      resolve(porta);
    });
  });
  return subindo;
}

export function portaEmUso() {
  return porta;
}

export function baseUrl() {
  return process.env.TOPGEAR_PUBLIC_URL || cfg.publicUrl || (porta ? `http://localhost:${porta}` : '');
}

export default { iniciar, portaEmUso, baseUrl };
