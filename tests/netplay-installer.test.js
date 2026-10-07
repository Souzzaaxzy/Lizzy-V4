/**
 * Regressão do INSTALADOR do netplay.
 *
 * O bug: o download do `cloudflared` ficava DEPOIS de um `return` de
 * "node_modules já existe" — então, no caminho comum (deps já instaladas), ele
 * NUNCA era baixado e a sala continuava "indisponível" mesmo depois de
 * atualizar. Este teste trava a ESTRUTURA que causou isso.
 *
 * Uso: node tests/netplay-installer.test.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');
const read = (rel) => fs.readFileSync(path.join(PROJECT, rel), 'utf8');

const RESULTS = [];
let CURRENT = null;
function test(name, fn) {
  CURRENT = { name, passed: 0, failed: 0, errors: [] };
  RESULTS.push(CURRENT);
  return Promise.resolve()
    .then(fn)
    .catch((e) => { CURRENT.failed++; CURRENT.errors.push(`EXCEÇÃO: ${e?.stack || e}`); })
    .then(() => {
      console.log(`${CURRENT.failed === 0 ? '✅' : '❌'} ${CURRENT.name} (${CURRENT.passed} ok, ${CURRENT.failed} falhas)`);
      for (const e of CURRENT.errors) console.log(`   ↳ ${e}`);
    });
}
function ok(c, m) { if (c) CURRENT.passed++; else { CURRENT.failed++; CURRENT.errors.push(`ASSERT: ${m}`); } }

/** Trecho da função (do nome até o próximo `\n}` na coluna 0). */
function corpo(src, assinatura) {
  const i = src.indexOf(assinatura);
  if (i < 0) return '';
  const fim = src.indexOf('\n}', i);
  return fim < 0 ? src.slice(i) : src.slice(i, fim + 2);
}

const update = read('dados/src/.scripts/update.js');
const config = read('dados/src/.scripts/config.js');

// ─────────────────────────────────────────────────────────────────────────
await test('update.js: baixa o cloudflared SEM depender do node_modules', () => {
  const fn = corpo(update, 'async function netplayDeps(');
  ok(fn.length > 0, 'achou netplayDeps');
  ok(fn.includes('baixar-cloudflared.mjs'), 'referencia o baixador');
  ok(/bin['"]\s*,\s*['"]cloudflared/.test(fn) || fn.includes("'bin', 'cloudflared'"), 'aponta tools/netplay-server/bin/cloudflared');
  // O bug: um `return` de "node_modules ja existe" ANTES do download. O codigo
  // real fecha 3 parenteses (`'node_modules'))) return;`), por isso o `\)+`.
  const antesDoDownload = fn.slice(0, fn.indexOf('baixar-cloudflared.mjs'));
  ok(!/node_modules'\)+\s*return/.test(antesDoDownload), 'NAO tem early-return de node_modules antes do download (bug antigo)');
  // O download precisa estar DEPOIS do bloco de node_modules (independente).
  const posNm = fn.indexOf('node_modules');
  const posDl = fn.indexOf('baixar-cloudflared.mjs');
  ok(posNm >= 0 && posDl > posNm, 'o download vem depois do bloco de deps (nao e pulado)');
});

// ─────────────────────────────────────────────────────────────────────────
await test('config.js: baixa o cloudflared nos DOIS caminhos', () => {
  const fn = corpo(config, 'async function installNetplayDependencies(');
  ok(fn.length > 0, 'achou installNetplayDependencies');
  ok(fn.includes('baixar-cloudflared.mjs'), 'referencia o baixador');
  ok(!/node_modules'\)\)\s*\{?\s*return\s*\{\s*name:\s*'Netplay Server',\s*status:\s*`\$\{colors\.green\}✅ Já instalado/.test(fn)
    || fn.indexOf('baixarTunel') < fn.indexOf('Já instalado'), 'nao retorna antes de tentar o tunel');
  // `baixarTunel` precisa ser CHAMADO antes do return de "ja instalado".
  const iJaInstalado = fn.indexOf('Já instalado');
  const iChamada = fn.indexOf('await baixarTunel()');
  ok(iChamada >= 0, 'chama baixarTunel()');
  ok(iChamada < iJaInstalado, 'chama o download ANTES do return de "já instalado"');
});

// ─────────────────────────────────────────────────────────────────────────
await test('o baixador existe e e oficial (release da Cloudflare)', () => {
  const dl = read('tools/netplay-server/baixar-cloudflared.mjs');
  ok(dl.includes('github.com/cloudflare/cloudflared/releases'), 'baixa do release oficial');
  ok(dl.includes('cloudflared-linux-amd64'), 'tem asset linux x64');
  ok(dl.includes('cloudflared-linux-arm64'), 'tem asset linux arm64');
  ok(dl.includes("process.platform"), 'escolhe por plataforma');
  ok(dl.includes('chmodSync'), 'marca como executavel');
});

// ─────────────────────────────────────────────────────────────────────────
await test('o binario fica FORA do git', () => {
  const gi = read('.gitignore');
  ok(gi.includes('tools/netplay-server/bin/'), 'bin/ do netplay ignorado');
});

// ─────────────────────────────────────────────────────────────────────────
await test('o modulo acha o binario no caminho esperado', async () => {
  const mod = await import(new URL('../dados/src/funcs/utils/netplayServer.js', import.meta.url).href);
  // Sem CLOUDFLARED_PATH e sem binario local, devolve '' (nao inventa).
  const sem = mod.acharCloudflared({ CLOUDFLARED_PATH: '/nao/existe' });
  ok(sem === '', 'caminho inexistente -> vazio');
  // CLOUDFLARED_PATH e ESTRITO.
  const com = mod.acharCloudflared({ CLOUDFLARED_PATH: '/bin/sh' });
  ok(com === '/bin/sh', 'usa o caminho explicito quando existe');
});

// ─────────────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(60));
let passed = 0, failed = 0;
for (const r of RESULTS) { passed += r.passed; failed += r.failed; }
console.log(`Total: ${RESULTS.length} testes / ${passed} asserções ok, ${failed} falhas`);
process.exit(failed === 0 ? 0 : 1);
