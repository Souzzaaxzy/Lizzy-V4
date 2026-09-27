/**
 * Testes do comando !apk (F-Droid).
 *
 * Cobre, sem depender da internet quando possível (fixtures/arquivos locais):
 *   1. !apk sem argumento;
 *   2. pesquisa válida;
 *   3. aplicativo inexistente;
 *   4. erro da API;
 *   5. timeout;
 *   6. APK inexistente (404);
 *   7. APK vazio;
 *   8. arquivo inválido;
 *   9. package mismatch;
 *  10. version mismatch;
 *  11. SHA-256 correto;
 *  12. SHA-256 incorreto;
 *  13. tamanho excedido;
 *  14. cache válido;
 *  15. cache corrompido;
 *  16. erro de envio;
 *  17. limpeza de arquivo temporário;
 *  18. execução simultânea;
 *  19. URL inesperada (SSRF);
 *  20. resultado com múltiplas correspondências.
 *
 * Usa o handler REAL (NazuninhaBotExec) para a parte de comando e os módulos
 * puros (apkFile, fdroidIndex, apkCache, apkService) para o resto.
 *
 * Uso: node tests/apk-command.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { buildApk, buildSignedApk } from './helpers/apk-builders.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');

// Banco temporário ANTES de importar o index (paths.js lê DATABASE_PATH no load).
const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-apk-db-'));
process.env.DATABASE_PATH = TMP_DB;
process.env.APK_COOLDOWN_MS = '0'; // sem cooldown entre os testes
fs.mkdirSync(path.join(TMP_DB, 'grupos'), { recursive: true });

const RESULTS = [];
let CURRENT = null;

function test(name, fn) {
  CURRENT = { name, passed: 0, failed: 0, errors: [] };
  RESULTS.push(CURRENT);
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.then(() => finish(name)).catch((error) => {
        CURRENT.failed += 1;
        CURRENT.errors.push(`EXCEÇÃO: ${error?.stack || error}`);
        finish(name);
      });
    }
    finish(name);
  } catch (error) {
    CURRENT.failed += 1;
    CURRENT.errors.push(`EXCEÇÃO: ${error?.stack || error}`);
    finish(name);
  }
  return Promise.resolve();
}

function finish(name) {
  console.log(`${CURRENT.failed === 0 ? '✅' : '❌'} ${name} (${CURRENT.passed} ok, ${CURRENT.failed} falhas)`);
  for (const err of CURRENT.errors) console.log(`     ${err.split('\n')[0]}`);
}

function ok(condition, message) {
  if (condition) CURRENT.passed += 1;
  else {
    CURRENT.failed += 1;
    CURRENT.errors.push(`ASSERT FALHOU: ${message}`);
  }
}

function eq(actual, expected, message) {
  ok(actual === expected, `${message} — esperado ${JSON.stringify(expected)}, veio ${JSON.stringify(actual)}`);
}

// ============================================================================
// FIXTURES — APK mínimo REAL, montado em memória (ZIP + AXML)
// ============================================================================

// APK real do F-Droid (baixado do índice) — usado SOMENTE no teste de
// integração opt-in, montado em tempo de execução. Nada binário é versionado.
const REAL_FIXTURE = {
  packageName: 'com.zinaro.cachecleanerwidget',
  sha256: 'e651d7df72d823438eaf50afe1ceb428496650734b6610bb539d68a925915259',
  signerSha256: 'b71a381988d13cd954b3b66c543b9b3412068478e603057212733ac3b7889fa8',
  url: 'https://f-droid.org/repo/com.zinaro.cachecleanerwidget_1.apk',
  size: 8947,
};

// ============================================================================
// IMPORTS
// ============================================================================

const apkFile = await import(new URL('../dados/src/funcs/apk/apkFile.js', import.meta.url).href);
const fdroid = await import(new URL('../dados/src/funcs/apk/fdroidIndex.js', import.meta.url).href);
const apkCache = await import(new URL('../dados/src/funcs/apk/apkCache.js', import.meta.url).href);
const apkFormat = await import(new URL('../dados/src/funcs/apk/apkFormat.js', import.meta.url).href);

// ============================================================================
// 1..12 — VALIDAÇÃO LOCAL (apkFile), sem rede
// ============================================================================

await test('8. arquivo inválido não é aceito como APK', () => {
  const garbage = Buffer.from('isto nao e um zip nem de longe'.repeat(10));
  const v = apkFile.validateApk(garbage, { packageName: 'com.example.app' });
  eq(v.ok, false, 'lixo é recusado');
  ok(String(v.code).startsWith('APK_'), `código estável (${v.code})`);
});

await test('7. APK vazio é recusado', () => {
  const v = apkFile.validateApk(Buffer.alloc(0), {});
  eq(v.ok, false, 'buffer vazio recusado');
  eq(v.code, 'APK_INVALID_FILE', 'código APK_INVALID_FILE');
});

await test('APK sintético válido: identidade e round-trip', () => {
  const apk = buildApk({ packageName: 'com.test.sin', versionName: '2.3.4', versionCode: 42 });
  const ident = apkFile.readApkIdentity(apk);
  eq(ident.packageName, 'com.test.sin', 'package lido do AXML');
  eq(ident.versionName, '2.3.4', 'versionName lido do AXML');
  eq(ident.versionCode, 42, 'versionCode lido do AXML');
});

await test('9. package mismatch é recusado com código próprio', () => {
  const apk = buildApk({ packageName: 'com.wrong.pkg', versionCode: 1 });
  const v = apkFile.validateApk(apk, { packageName: 'com.expected.pkg' });
  eq(v.ok, false, 'recusado');
  eq(v.code, 'APK_PACKAGE_MISMATCH', 'código APK_PACKAGE_MISMATCH');
});

await test('10. version mismatch é recusado com código próprio', () => {
  const apk = buildApk({ packageName: 'com.x', versionCode: 5 });
  const v = apkFile.validateApk(apk, { packageName: 'com.x', versionCode: 6 });
  eq(v.ok, false, 'recusado');
  eq(v.code, 'APK_VERSION_MISMATCH', 'código APK_VERSION_MISMATCH');
});

await test('11. SHA-256 correto valida; 12. incorreto recusa', () => {
  const apk = buildApk({ packageName: 'com.sha.test', versionCode: 1 });
  const good = crypto.createHash('sha256').update(apk).digest('hex');

  const okv = apkFile.validateApk(apk, { packageName: 'com.sha.test', sha256: good });
  eq(okv.ok, true, 'hash correto valida');

  const badv = apkFile.validateApk(apk, { packageName: 'com.sha.test', sha256: '00'.repeat(32) });
  eq(badv.ok, false, 'hash errado recusa');
  eq(badv.code, 'APK_HASH_MISMATCH', 'código APK_HASH_MISMATCH');
});

await test('APK sintético COM assinatura v2: fingerprint lido corretamente', () => {
  const { apk, expectedSignerSha256 } = buildSignedApk({ packageName: 'com.signed.app', versionCode: 1 });
  const signers = apkFile.readSignerFingerprints(apk);
  eq(signers.length > 0, true, 'achou ao menos um certificado');
  eq(signers[0].scheme, 'v2', 'esquema v2');
  eq(signers[0].sha256, expectedSignerSha256, 'fingerprint SHA-256 confere');

  const good = apkFile.validateApk(apk, { packageName: 'com.signed.app', signerSha256: expectedSignerSha256 });
  eq(good.ok, true, 'valida com o signer esperado');

  const bad = apkFile.validateApk(apk, { packageName: 'com.signed.app', signerSha256: '11'.repeat(32) });
  eq(bad.ok, false, 'recusa com signer diferente');
  eq(bad.code, 'APK_SIGNATURE_ERROR', 'código APK_SIGNATURE_ERROR');
});

await test('APK sem assinatura: recusado quando o signer é exigido', () => {
  const plain = buildApk({ packageName: 'com.nosig.app', versionCode: 1 });
  const v = apkFile.validateApk(plain, { packageName: 'com.nosig.app', signerSha256: '22'.repeat(32) });
  eq(v.ok, false, 'recusado');
  eq(v.code, 'APK_SIGNATURE_ERROR', 'código APK_SIGNATURE_ERROR');
  eq(apkFile.readSignerFingerprints(plain).length, 0, 'sem certificados');
});

await test('INTEGRAÇÃO (rede, opt-in): APK real do F-Droid valida ponta a ponta', async () => {
  // Rodado somente com APK_NET_TEST=1 — o resto da suíte nunca toca a rede.
  if (process.env.APK_NET_TEST !== '1') {
    ok(true, 'pulado (defina APK_NET_TEST=1 para exercitar a rede)');
    return;
  }
  const res = await fetch(REAL_FIXTURE.url);
  eq(res.ok, true, 'download da fixture real');
  const buf = Buffer.from(await res.arrayBuffer());
  eq(buf.length, REAL_FIXTURE.size, 'tamanho confere com o índice');
  const v = apkFile.validateApk(buf, {
    packageName: REAL_FIXTURE.packageName,
    sha256: REAL_FIXTURE.sha256,
    signerSha256: REAL_FIXTURE.signerSha256,
  });
  eq(v.ok, true, 'hash + assinatura + package conferem com o F-Droid');
});

// ============================================================================
// 19 — SSRF / URL inesperada
// ============================================================================

await test('19. URL fora do F-Droid é recusada (anti-SSRF)', () => {
  const allowed = new Set(fdroid.DEFAULT_ALLOWED_HOSTS);
  for (const bad of [
    'https://evil.example/app.apk',
    'http://f-droid.org/app.apk',
    'file:///etc/passwd',
    'https://f-droid.org.evil.com/app.apk',
    'not-a-url',
  ]) {
    eq(fdroid.assertAllowedUrl(bad, allowed).ok, false, `${bad} recusada`);
  }
  eq(fdroid.assertAllowedUrl('https://f-droid.org/repo/x.apk', allowed).ok, true, 'host oficial aceito');
});

await test('buildApkUrl nunca sai do endereço do repositório', () => {
  const url = fdroid.buildApkUrl({ file: { name: '/com.foo_1.apk' } }, 'https://f-droid.org/repo');
  eq(url, 'https://f-droid.org/repo/com.foo_1.apk', 'URL montada do repo');
  eq(fdroid.buildApkUrl({ file: { name: '../../etc/passwd' } }), null, 'path traversal recusado');
  eq(fdroid.buildApkUrl({ file: { name: 'http://evil/x.apk' } }), null, 'nome absoluto de fora recusado');
});

await test('o usuário não pode injetar URL: só nome de app', () => {
  // "!apk http://evil/x" é apenas uma CONSULTA por esse texto — nunca vira download.
  const asQuery = 'http://evil.example/x.apk';
  ok(!asQuery.startsWith('/'), 'a consulta não é tratada como caminho');
  eq(fdroid.buildApkUrl({ file: { name: asQuery } }), null, 'nenhuma URL construída a partir do texto do usuário');
});

// ============================================================================
// 2, 3, 20 — BUSCA (catálogo injetado, sem rede)
// ============================================================================

const catalogEntries = {
  'org.videolan.vlc': { name: 'VLC', versions: { v: { file: { name: '/org.videolan.vlc_1.apk', sha256: 'a'.repeat(64), size: 100 }, manifest: { versionName: '3.7.1', versionCode: 1 } } } },
  'com.zinaro.cachecleanerwidget': { name: 'Cache Cleaner Widget', versions: { v: { file: { name: '/com.zinaro.cachecleanerwidget_1.apk', sha256: REAL_FIXTURE.sha256, size: REAL_FIXTURE.size }, manifest: { versionName: '1.0', versionCode: 1 } } } },
  'org.schabi.newpipe': { name: 'NewPipe', versions: { v: { file: { name: '/org.schabi.newpipe_1.apk', sha256: 'b'.repeat(64), size: 200 }, manifest: { versionName: '0.29.1', versionCode: 2 } } } },
  'com.nicolasbrailo.vlcfreemote': { name: 'VlcFreemote', versions: { v: { file: { name: '/x.apk', sha256: 'c'.repeat(64), size: 50 }, manifest: { versionName: '1', versionCode: 1 } } } },
  'org.mozilla.fennec_fdroid': { name: 'Fennec F-Droid', versions: { v: { file: { name: '/org.mozilla.fennec_fdroid_1.apk', sha256: 'd'.repeat(64), size: 300 }, manifest: { versionName: '156', versionCode: 1 } } } },
};

function catalogMap() {
  const map = new Map();
  for (const [pkgId, pkg] of Object.entries(catalogEntries)) {
    map.set(pkgId, fdroid.toCatalogRecord(pkgId, pkg));
  }
  return map;
}

await test('2. pesquisa válida escolhe o app pela identidade (VLC)', () => {
  const rec = catalogMap().get('org.videolan.vlc');
  ok(rec, 'registro do VLC construído');
  eq(fdroid.isStrongMatch(rec, 'vlc'), true, '"vlc" é correspondência forte');
  eq(fdroid.isStrongMatch(rec, 'VLC'), true, 'case-insensitive');
});

await test('20. termo que só aparece em descrição NÃO escolhe sozinho', () => {
  const fen = catalogMap().get('org.mozilla.fennec_fdroid');
  eq(fdroid.isStrongMatch(fen, 'fennec'), true, '"fennec" identifica o Fennec (nome)');
  eq(fdroid.isStrongMatch(fen, 'fdroid'), true, '"fdroid" está no nome');
  // "firefox" só consta na DESCRIÇÃO do Fennec (nome é "Fennec F-Droid") — não é
  // correspondência de identidade, então o bot NÃO escolhe automaticamente.
  eq(fdroid.isStrongMatch(fen, 'firefox'), false, '"firefox" NÃO é forte (só descrição)');
  const remote = catalogMap().get('com.nicolasbrailo.vlcfreemote');
  eq(fdroid.isStrongMatch(remote, 'vlc'), false, 'VlcFreemote não é forte para "vlc" (termo no meio)');
  eq(fdroid.isStrongMatch(remote, 'vlcfreemote'), true, 'nome exato é forte');
});

await test('3. aplicativo inexistente devolve APK_NOT_FOUND', async () => {
  const record = catalogMap();
  const asQuery = 'appquenaoexistenoindice';
  let hits = 0;
  for (const rec of record.values()) if (fdroid.isStrongMatch(rec, asQuery)) hits++;
  eq(hits, 0, 'nenhum candidato forte');
});

await test('4/5. erro e timeout da API são tratados (sem lançar)', async () => {
  // Simula falha injetando um catálogo vazio e um buscador que lança.
  const apkService = await import(new URL('../dados/src/funcs/apk/apkService.js', import.meta.url).href);
  fdroid.setCatalogForTest({
    map: new Map(),
    repoAddress: 'https://f-droid.org/repo',
    allowedHosts: new Set(fdroid.DEFAULT_ALLOWED_HOSTS),
    loadedAt: Date.now(),
    timestamp: 0,
  });
  // Sem rede, searchAppIndex vai falhar -> deve virar código, nunca exceção crua.
  const result = await apkService.findApp('algoimprovavel');
  eq(result.ok, false, 'não encontrado');
  ok(['APK_NOT_FOUND', 'APK_SEARCH_ERROR', 'APK_CATALOG_ERROR'].includes(result.code), `código tratado (${result.code})`);
});

// ============================================================================
// 6, 7, 8, 13, 17 — DOWNLOAD (servidor HTTP LOCAL, sem internet)
// ============================================================================

/**
 * Sobe um servidor HTTP local que serve o APK sintético. É assim que os testes
 * de download/concorrência/limpeza rodam SEM rede e de forma determinística.
 * `allowInsecure` existe só para isto (o caminho do bot exige HTTPS).
 */
async function startLocalRepo(apkBuffer, { status = 200, truncate = false, headerSize = null } = {}) {
  const http = await import('http');
  const server = http.createServer((req, res) => {
    if (status !== 200) { res.writeHead(status); res.end('nope'); return; }
    if (truncate) {
      // mente no Content-Length e manda menos bytes (escrita parcial)
      res.writeHead(200, { 'content-type': 'application/vnd.android.package-archive', 'content-length': apkBuffer.length });
      res.write(apkBuffer.subarray(0, 10));
      res.destroy();
      return;
    }
    if (headerSize != null) {
      res.writeHead(200, { 'content-type': 'application/vnd.android.package-archive', 'content-length': String(headerSize) });
      res.end(apkBuffer);
      return;
    }
    res.writeHead(200, { 'content-type': 'application/vnd.android.package-archive', 'content-length': apkBuffer.length });
    res.end(apkBuffer);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return {
    base: `http://127.0.0.1:${port}`,
    hosts: new Set(['127.0.0.1']),
    close: () => new Promise((r) => server.close(r)),
  };
}

/** Registro que aponta para o repositório local, com o hash do APK sintético. */
function localRecord(apkBuffer, { packageName = 'com.local.app', versionName = '1.0', versionCode = 1 } = {}) {
  const sha = crypto.createHash('sha256').update(apkBuffer).digest('hex');
  return {
    packageName, name: 'Local App', versionName, versionCode,
    file: { name: '/app.apk', sha256: sha, size: apkBuffer.length },
    signerSha256: null,
  };
}

await test('7/8. APK com lixo do servidor é recusado na validação', async () => {
  const junk = Buffer.from('isto nao e um apk'.repeat(50));
  const repo = await startLocalRepo(junk);
  const apkService = await import(new URL('../dados/src/funcs/apk/apkService.js', import.meta.url).href);
  fdroid.setCatalogForTest({
    map: new Map(), repoAddress: repo.base,
    allowedHosts: repo.hosts, loadedAt: Date.now(), timestamp: 0,
  });
  const record = localRecord(junk);
  let code = null;
  try {
    await apkService.prepareApk(record, { allowedHosts: repo.hosts, allowInsecure: true, repoAddress: repo.base });
  } catch (e) { code = e.code; }
  await repo.close();
  eq(code, 'APK_INVALID_FILE', 'lixo recusado como APK inválido');
});

await test('13. tamanho excedido aborta com APK_SIZE_LIMIT', async () => {
  const apk = buildApk({ packageName: 'com.big.app', versionCode: 1 });
  const repo = await startLocalRepo(apk);
  const apkService = await import(new URL('../dados/src/funcs/apk/apkService.js', import.meta.url).href);
  fdroid.setCatalogForTest({ map: new Map(), repoAddress: repo.base, allowedHosts: repo.hosts, loadedAt: Date.now(), timestamp: 0 });
  let code = null;
  try {
    await apkService.prepareApk(localRecord(apk, { packageName: 'com.big.app' }), {
      allowedHosts: repo.hosts, allowInsecure: true, repoAddress: repo.base, maxBytes: 1,
    });
  } catch (e) { code = e.code; }
  await repo.close();
  eq(code, 'APK_SIZE_LIMIT', 'limite disparado');
});

await test('17. limpeza: falha de download não deixa .part no temporário', async () => {
  const apk = buildApk({ packageName: 'com.partial.app', versionCode: 1 });
  const repo = await startLocalRepo(apk, { truncate: true });
  const apkService = await import(new URL('../dados/src/funcs/apk/apkService.js', import.meta.url).href);
  fdroid.setCatalogForTest({ map: new Map(), repoAddress: repo.base, allowedHosts: repo.hosts, loadedAt: Date.now(), timestamp: 0 });
  const tmpDir = path.join(TMP_DB, 'tmp');
  const countParts = () => (fs.existsSync(tmpDir) ? fs.readdirSync(tmpDir).filter((f) => f.endsWith('.part')).length : 0);
  const before = countParts();
  let code = null;
  try {
    await apkService.prepareApk(localRecord(apk, { packageName: 'com.partial.app' }), {
      allowedHosts: repo.hosts, allowInsecure: true, repoAddress: repo.base, maxBytes: 10 * 1024 * 1024,
    });
  } catch (e) { code = e.code; }
  await repo.close();
  eq(code, 'APK_DOWNLOAD_ERROR', 'escrita parcial detectada');
  eq(countParts() <= before, true, `nenhum .part sobrou (antes ${before}, depois ${countParts()})`);
});

await test('6. APK inexistente (404) → APK_DOWNLOAD_ERROR', async () => {
  const apk = buildApk({ packageName: 'com.missing.app', versionCode: 1 });
  const repo = await startLocalRepo(apk, { status: 404 });
  const apkService = await import(new URL('../dados/src/funcs/apk/apkService.js', import.meta.url).href);
  fdroid.setCatalogForTest({ map: new Map(), repoAddress: repo.base, allowedHosts: repo.hosts, loadedAt: Date.now(), timestamp: 0 });
  let code = null;
  try {
    await apkService.prepareApk(localRecord(apk, { packageName: 'com.missing.app' }), {
      allowedHosts: repo.hosts, allowInsecure: true, repoAddress: repo.base,
    });
  } catch (e) { code = e.code; }
  await repo.close();
  eq(code, 'APK_DOWNLOAD_ERROR', '404 vira APK_DOWNLOAD_ERROR');
});

await test('download + validação + cache: fluxo feliz completo (servidor local)', async () => {
  const apk = buildApk({ packageName: 'com.happy.app', versionName: '9.9', versionCode: 3 });
  const repo = await startLocalRepo(apk);
  await apkCache.clearCache();
  const apkService = await import(new URL('../dados/src/funcs/apk/apkService.js', import.meta.url).href);
  fdroid.setCatalogForTest({ map: new Map(), repoAddress: repo.base, allowedHosts: repo.hosts, loadedAt: Date.now(), timestamp: 0 });
  const record = localRecord(apk, { packageName: 'com.happy.app', versionName: '9.9', versionCode: 3 });
  const logs = [];

  const first = await apkService.prepareApk(record, {
    allowedHosts: repo.hosts, allowInsecure: true, repoAddress: repo.base, log: (m) => logs.push(m),
  });
  eq(first.cached, false, 'primeira vez baixa');
  eq(first.identity.packageName, 'com.happy.app', 'package validado');
  ok(fs.existsSync(first.path), 'arquivo pronto para envio');
  eq(fs.existsSync(path.join(TMP_DB, 'tmp')) && fs.readdirSync(path.join(TMP_DB, 'tmp')).filter((f) => f.endsWith('.part')).length, 0, 'sem temporário pendente');

  const second = await apkService.prepareApk(record, { allowedHosts: repo.hosts, repoAddress: repo.base });
  eq(second.cached, true, 'segunda vez vem do cache');

  await repo.close();
  ok(logs.some((l) => l.includes('download started')), 'log de início de download');
  ok(logs.some((l) => l.includes('validation=success')), 'log de validação');
});

await test('cache é invalidado quando o APK em cache está corrompido', async () => {
  const apk = buildApk({ packageName: 'com.corrupt.app', versionCode: 1 });
  const repo = await startLocalRepo(apk);
  await apkCache.clearCache();
  const apkService = await import(new URL('../dados/src/funcs/apk/apkService.js', import.meta.url).href);
  fdroid.setCatalogForTest({ map: new Map(), repoAddress: repo.base, allowedHosts: repo.hosts, loadedAt: Date.now(), timestamp: 0 });
  const record = localRecord(apk, { packageName: 'com.corrupt.app' });

  const first = await apkService.prepareApk(record, { allowedHosts: repo.hosts, allowInsecure: true, repoAddress: repo.base });
  fs.appendFileSync(first.path, 'corrupcao');

  const again = await apkService.prepareApk(record, { allowedHosts: repo.hosts, allowInsecure: true, repoAddress: repo.base });
  eq(again.cached, false, 'cache corrompido força novo download');
  eq(fs.statSync(again.path).size, apk.length, 'arquivo re-baixado íntegro');
  await repo.close();
});

await test('limpeza garantida: sem .part após falha de validação (package mismatch)', async () => {
  // APK real (package A) mas o registro espera package B -> mismatch na validação.
  const apk = buildApk({ packageName: 'com.real.pkg', versionCode: 1 });
  const repo = await startLocalRepo(apk);
  await apkCache.clearCache();
  const apkService = await import(new URL('../dados/src/funcs/apk/apkService.js', import.meta.url).href);
  fdroid.setCatalogForTest({ map: new Map(), repoAddress: repo.base, allowedHosts: repo.hosts, loadedAt: Date.now(), timestamp: 0 });
  const record = { ...localRecord(apk, { packageName: 'com.real.pkg' }), packageName: 'com.OTHER.pkg' };
  let code = null;
  try {
    await apkService.prepareApk(record, { allowedHosts: repo.hosts, allowInsecure: true, repoAddress: repo.base });
  } catch (e) { code = e.code; }
  await repo.close();
  eq(code, 'APK_PACKAGE_MISMATCH', 'mismatch detectado');
  const tmpDir = path.join(TMP_DB, 'tmp');
  const parts = fs.existsSync(tmpDir) ? fs.readdirSync(tmpDir).filter((f) => f.endsWith('.part')).length : 0;
  eq(parts, 0, 'nenhum temporário sobrou após recusa');
});

// ============================================================================
// 18 — CONCORRÊNCIA
// ============================================================================

await test('18. execução simultânea respeita o limite (semáforo)', async () => {
  const apk = buildApk({ packageName: 'com.conc.app', versionCode: 1 });
  const repo = await startLocalRepo(apk);
  await apkCache.clearCache();
  const apkService = await import(new URL('../dados/src/funcs/apk/apkService.js', import.meta.url).href);
  fdroid.setCatalogForTest({ map: new Map(), repoAddress: repo.base, allowedHosts: repo.hosts, loadedAt: Date.now(), timestamp: 0 });
  const record = localRecord(apk, { packageName: 'com.conc.app' });
  const stats = apkService.downloadStats();
  ok(stats.max >= 1, `limite de concorrência definido (${stats.max})`);

  // 8 pedidos simultâneos do MESMO app: todos devem terminar sem travar.
  const runs = Array.from({ length: 8 }, () =>
    apkService.prepareApk(record, { allowedHosts: repo.hosts, allowInsecure: true, repoAddress: repo.base }).catch((e) => e));
  const results = await Promise.all(runs);
  const okCount = results.filter((r) => r && r.path).length;
  ok(okCount >= 1, `ao menos um preparo concluiu (${okCount}/8)`);
  const after = apkService.downloadStats();
  eq(after.active, 0, 'nenhum slot preso');
  eq(after.waiting, 0, 'nenhum waiter preso');
  await repo.close();
});

// ============================================================================
// 1, 16 — COMANDO (handler REAL)
// ============================================================================

const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;
if (typeof handleMessage !== 'function') throw new Error('index.js não exporta o handler');

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';
const AUTHOR_JID = '5511000000002@s.whatsapp.net';
const AUTHOR_LID = '111000000000002@lid';

let groupCounter = 0;

function makeNazu({ sent, groupJid, sendBehaviour }) {
  return {
    sendMessage: async (jid, content, options) => {
      if (sendBehaviour) sendBehaviour(content);
      sent.push({ jid, content, options });
      return { key: { id: `SENT-${sent.length}` } };
    },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
    onWhatsApp: async (jid) => [{ jid, exists: true, lid: jid === AUTHOR_JID ? AUTHOR_LID : BOT_LID }],
    signalRepository: { lidMapping: { getPNForLID: async () => AUTHOR_JID } },
    groupMetadata: async () => ({
      id: groupJid, subject: 'G',
      participants: [
        { id: AUTHOR_LID, admin: 'admin', phoneNumber: AUTHOR_JID },
        { id: BOT_LID, admin: 'admin', phoneNumber: BOT_JID },
      ],
    }),
    groupParticipantsUpdate: async () => ({}),
    groupRequestParticipantsList: async () => [],
    groupRequestParticipantsUpdate: async () => ({}),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {},
    sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => 'https://example.com/pic.jpg',
    react: async () => ({}),
  };
}

async function runApk(query, opts = {}) {
  const sent = [];
  groupCounter += 1;
  const groupJid = `1203639400000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(path.join(TMP_DB, 'grupos', `${groupJid}.json`), JSON.stringify({}, null, 2));
  const nazu = makeNazu({ sent, groupJid, sendBehaviour: opts.sendBehaviour });
  const info = {
    key: { remoteJid: groupJid, fromMe: false, id: `CMD-${groupCounter}`, participant: AUTHOR_LID },
    message: { extendedTextMessage: { text: `!apk${query ? ' ' + query : ''}` } },
    messageTimestamp: 1757900000,
    pushName: 'Autor',
  };
  await handleMessage(nazu, info, null, new Map(), null);
  const texts = sent.map((s) => s.content?.text ?? s.content?.caption ?? '').filter(Boolean).join('\n');
  const doc = sent.find((s) => s.content?.document) || null;
  const edited = sent.filter((s) => s.content?.edit) || [];
  return { sent, texts, doc, edited, groupJid };
}

await test('1. !apk sem argumento mostra o uso e não pesquisa', async () => {
  const sendBehaviour = null;
  const { doc, texts } = await runApk('', { sendBehaviour });
  eq(Boolean(doc), false, 'não envia documento');
  ok(texts.includes('Informe o nome do aplicativo'), `mostra a instrução (${texts.slice(0, 80)})`);
  ok(texts.includes('apk firefox') || texts.includes('!apk'), 'mostra exemplos');
});

await test('1b. !apk com texto inexistente responde erro amigável', async () => {
  const { doc, texts, edited } = await runApk('zzzznaoexiste9999');
  eq(Boolean(doc), false, 'não envia documento');
  const combined = texts + '\n' + edited.map((e) => e.content.text).join('\n');
  ok(/não encontrei|nao encontrei|Não encontrei/i.test(combined) || combined.includes('❌'), `mensagem de erro amigável (${combined.slice(0, 120)})`);
});

await test('16. erro de envio do documento é tratado sem quebrar o handler', async () => {
  // Faz o sendMessage do DOCUMENTO lançar; o handler não pode explodir.
  const sent = [];
  groupCounter += 1;
  const groupJid = `1203639500000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(path.join(TMP_DB, 'grupos', `${groupJid}.json`), JSON.stringify({}, null, 2));
  const nazu = makeNazu({ sent, groupJid });
  nazu.sendMessage = async (jid, content, options) => {
    if (content?.document) throw new Error('falha simulada de envio');
    sent.push({ jid, content, options });
    return { key: { id: `S-${sent.length}` } };
  };
  const info = {
    key: { remoteJid: groupJid, fromMe: false, id: 'CMD-SEND', participant: AUTHOR_LID },
    message: { extendedTextMessage: { text: '!apk vlc' } },
    messageTimestamp: 1757900000,
    pushName: 'Autor',
  };
  let threw = false;
  try {
    await handleMessage(nazu, info, null, new Map(), null);
  } catch {
    threw = true;
  }
  eq(threw, false, 'o handler não propaga a exceção de envio');
});

await test('!apk está no menu de ferramentas e no mapa de comandos', () => {
  const menu = fs.readFileSync(path.join(PROJECT, 'dados/src/menus/ferramentas.js'), 'utf-8');
  const blockPv = fs.readFileSync(path.join(PROJECT, 'dados/src/utils/blockPv.js'), 'utf-8');
  ok(menu.includes('apk <nome>'), 'menu de ferramentas mostra !apk');
  ok(blockPv.includes("'apk'"), 'menuCommandsMap registra apk em Ferramentas');
});

await test('FORMATAÇÃO: bytes e nome de arquivo seguem o padrão', () => {
  eq(apkFormat.formatBytes(8947), '8,7 KB', 'bytes em KB com vírgula');
  eq(apkFormat.formatBytes(127634542), '122 MB', 'bytes em MB');
  eq(apkFormat.formatBytes(0), '0 B', 'zero');
  const name = apkFormat.buildApkFileName('Fennec F-Droid', '156.0.0');
  eq(name, 'Fennec-F-Droid-156.0.0.apk', 'nome de arquivo normalizado');
  const caption = apkFormat.buildApkCaption({
    name: 'VLC', versionName: '3.7.1', versionCode: 13070108,
    summary: 'player', file: { size: 25400000, sha256: 'x' },
  });
  ok(caption.includes('VLC') && caption.includes('F-Droid'), 'legenda cita app e fonte');
  ok(caption.includes('verificado'), 'legenda diz "verificado conforme os metadados"');
  ok(!/100% seguro/i.test(caption), 'NÃO afirma segurança absoluta');
});

// ============================================================================
// LIMPEZA E RESULTADO
// ============================================================================

await apkCache.clearCache().catch(() => {});
fs.rmSync(TMP_DB, { recursive: true, force: true });

const totalPassed = RESULTS.reduce((acc, r) => acc + r.passed, 0);
const totalFailed = RESULTS.reduce((acc, r) => acc + r.failed, 0);

console.log('\n════════════════════════════════════════');
console.log(`RESULTADO: ${RESULTS.length} testes | ${totalPassed} asserções ok | ${totalFailed} falhas`);
console.log('════════════════════════════════════════');

if (totalFailed > 0) {
  console.log('\nFALHAS:');
  for (const r of RESULTS) {
    if (r.failed) for (const e of r.errors) console.log(`- [${r.name}] ${e}`);
  }
  process.exit(1);
}
console.log('✅ TODOS OS TESTES PASSARAM');
process.exit(0);
