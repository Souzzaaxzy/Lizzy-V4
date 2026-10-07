#!/usr/bin/env node
/**
 * Baixa o `cloudflared` (binario OFICIAL da Cloudflare) para
 * `tools/netplay-server/bin/`.
 *
 * O binario tem ~40 MB e NAO vai para o git (ver .gitignore) -- este script o
 * obtem do release oficial. O tunel e o que publica o servidor de netplay com
 * HTTPS sem abrir porta, sem IP publico e **sem conta** (quick tunnel).
 *
 * Uso:
 *   node tools/netplay-server/baixar-cloudflared.mjs
 *   node tools/netplay-server/baixar-cloudflared.mjs --force   # rebaixa
 *
 * Nao baixa nada em plataforma sem binario oficial (ele apenas avisa).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN_DIR = path.join(HERE, 'bin');
const DEST = path.join(BIN_DIR, 'cloudflared');
const FORCE = process.argv.includes('--force');

const BASE = 'https://github.com/cloudflare/cloudflared/releases/latest/download';

/** asset oficial por plataforma/arquitetura. */
function asset() {
  const p = process.platform;
  const a = process.arch;
  if (p === 'linux') {
    if (a === 'x64') return 'cloudflared-linux-amd64';
    if (a === 'arm64') return 'cloudflared-linux-arm64';
    if (a === 'arm') return 'cloudflared-linux-arm';
    if (a === 'ia32') return 'cloudflared-linux-386';
  }
  if (p === 'darwin') return a === 'arm64' ? 'cloudflared-darwin-arm64.tgz' : 'cloudflared-darwin-amd64.tgz';
  if (p === 'win32') return 'cloudflared-windows-amd64.exe';
  return '';
}

async function baixar(url, dest) {
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${url}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 1_000_000) throw new Error(`arquivo pequeno demais (${buf.length} bytes) -- nao parece o binario`);
  fs.writeFileSync(dest, buf);
  return buf.length;
}

async function main() {
  const nome = asset();
  if (!nome) {
    console.log(`[cloudflared] plataforma sem binario oficial (${process.platform}/${process.arch}).`);
    console.log('[cloudflared] baixe manualmente de https://github.com/cloudflare/cloudflared/releases');
    console.log('[cloudflared] e aponte CLOUDFLARED_PATH para ele.');
    return;
  }
  if (fs.existsSync(DEST) && !FORCE) {
    console.log(`[cloudflared] ja existe em ${DEST} (use --force para rebaixar).`);
    return;
  }
  fs.mkdirSync(BIN_DIR, { recursive: true });
  console.log(`[cloudflared] baixando ${nome}...`);
  const bytes = await baixar(`${BASE}/${nome}`, DEST);
  if (process.platform !== 'win32') fs.chmodSync(DEST, 0o755);
  console.log(`[cloudflared] pronto: ${DEST} (${(bytes / 1024 / 1024).toFixed(1)} MB)`);
}

main().catch((e) => {
  console.error(`[cloudflared] falha: ${e?.message || e}`);
  console.error('[cloudflared] o bot continua funcionando; sem o tunel a sala precisa de EMUGAMES_NETPLAY_URL.');
  process.exit(1);
});
