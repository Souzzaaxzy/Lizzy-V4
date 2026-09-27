/**
 * Cache de APKs do `!apk`.
 *
 * Antes de criar isto foi verificado o que já existia na Lizzy:
 *   - `funcs/downloads/apkmod.js` tem um cache EM MEMÓRIA só de metadados de
 *     busca (Map com TTL de 30 min) — não guarda arquivo, então não serve para
 *     "baixar o mesmo APK de novo";
 *   - `utils/optimizedCache.js` usa `node-cache` (também memória, dados JSON);
 *   - o bot mantém arquivos temporários em `DATABASE_DIR/tmp` (`utils/paths.js`)
 *     e TEM um limpeza de mídia (`utils/mediaCleaner.js`) que só cobre
 *     extensões de mídia conhecidas e NÃO conhece `.apk`.
 *
 * Não havia cache de ARQUIVO binário com verificação de integridade. Então este
 * módulo existe, isolado e pequeno:
 *
 *   APK_CACHE_ROOT/<packageName>/
 *     metadata.json
 *     <arquivo>.apk
 *
 * POR QUE O CACHE **NÃO** FICA EM `dados/database`
 * -------------------------------------------------
 * Ele ficava, e isso quebrou a ATUALIZAÇÃO do bot em produção: o atualizador faz
 * backup RECURSIVO de `dados/database` antes do `git reset --hard`, e um APK de
 * 135 MB (Instagram) fez o backup estourar o disco:
 *
 *     ENOSPC: no space left on device, copyfile '.../apk-cache/com.instagram.android.apk'
 *
 * O cache é descartável e pode ter centenas de MB; ele não é estado do bot e não
 * tem nada que ser preservado por backup. Agora vive fora do banco, em
 * `APK_CACHE_ROOT` (padrão: `<raiz do projeto>/data/apk-cache`, ou
 * `APK_CACHE_DIR`). `dados/database` volta a ser só o estado operacional.
 *
 * O `metadata.json` guarda packageName, name, versionName, versionCode, sha256,
 * md5, size, source, pageUrl e os signers (o que também serve de auditoria).
 *
 * Integridade é reconferida a CADA leitura (tamanho + hash + identidade do
 * APK): cache não é fonte de confiança, é só economia de banda. Se qualquer
 * coisa não bater, o arquivo é descartado e o chamador baixa de novo.
 *
 * O diretório é ignorado pelo git (ver .gitignore) — APK nunca vai para o repo.
 */

import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { ROOT_DIR, DATABASE_DIR } from '../../utils/paths.js';
import { FileSource, hashSource, APK_ERROR, ApkValidationError, readApkIdentity } from './apkFile.js';

/**
 * Raiz do cache. Fora do banco de propósito (ver o comentário acima).
 * `APK_CACHE_DIR` permite apontar para outro disco/volume.
 */
export const APK_CACHE_ROOT = process.env.APK_CACHE_DIR
  ? path.resolve(process.env.APK_CACHE_DIR)
  : path.join(ROOT_DIR, '..', 'data', 'apk-cache');

/** Diretório ANTIGO (dentro do banco), que o updater tentava copiar. */
export const LEGACY_CACHE_DIR = path.join(DATABASE_DIR, 'apk-cache');

/** @deprecated use APK_CACHE_ROOT. Mantido para compatibilidade. */
export const CACHE_DIR = APK_CACHE_ROOT;

/** Limites do cache — isolados e ajustáveis por ambiente. */
export const CACHE_LIMITS = Object.freeze({
  /** Tamanho total permitido no diretório do cache. */
  maxTotalBytes: Number(process.env.APK_CACHE_MAX_BYTES) || 512 * 1024 * 1024,
  /** Idade máxima de uma entrada antes de ser considerada velha. */
  maxAgeMs: Number(process.env.APK_CACHE_MAX_AGE_MS) || 30 * 24 * 60 * 60 * 1000,
});

/** Caminhos de uma entrada do cache. O packageName vem do índice, nunca do usuário. */
export function cachePaths(packageName) {
  const safe = String(packageName).replace(/[^A-Za-z0-9._-]/g, '_');
  const dir = path.join(APK_CACHE_ROOT, safe);
  return { dir, metaFile: path.join(dir, 'metadata.json'), apkFile: path.join(dir, `${safe}.apk`) };
}

export async function readCacheMetadata(packageName) {
  const { metaFile } = cachePaths(packageName);
  try {
    const raw = await fsp.readFile(metaFile, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Remove a entrada do cache (metadata + apk). Silencioso se não existir. */
export async function removeCacheEntry(packageName) {
  const { dir } = cachePaths(packageName);
  await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
}

/**
 * Devolve o APK em cache quando ele está ÍNTEGRO.
 *
 * Checa, nesta ordem: metadata existe, arquivo existe, tamanho confere,
 * SHA-256 confere e a identidade (package) confere. Qualquer falha invalida a
 * entrada. `expected` são os metadados do F-Droid do momento da consulta.
 *
 * @returns {Promise<{hit: true, path: string, metadata: object} | {hit: false, reason?: string}>}
 */
export async function getCachedApk(packageName, expected = {}) {
  const { apkFile } = cachePaths(packageName);
  const metadata = await readCacheMetadata(packageName);
  if (!metadata) return { hit: false };

  let stat;
  try {
    stat = await fsp.stat(apkFile);
  } catch {
    await removeCacheEntry(packageName);
    return { hit: false, reason: 'APK_CACHE_FILE_MISSING' };
  }
  if (!stat.isFile() || stat.size === 0) {
    await removeCacheEntry(packageName);
    return { hit: false, reason: 'APK_CACHE_EMPTY' };
  }

  // Tamanho declarado vs real (barato e pega truncamento).
  if (metadata.size != null && Number(metadata.size) !== stat.size) {
    await removeCacheEntry(packageName);
    return { hit: false, reason: 'APK_CACHE_SIZE_MISMATCH' };
  }

  // Hash do arquivo em cache. A fonte pode ter publicado sha256 OU md5 (a
  // Aptoide só publica md5); conferimos o que estiver registrado.
  const sha = hashSource(apkFile, ['sha256', 'md5']);
  if (metadata.sha256 && sha.sha256.toLowerCase() !== String(metadata.sha256).toLowerCase()) {
    await removeCacheEntry(packageName);
    return { hit: false, reason: 'APK_CACHE_HASH_MISMATCH' };
  }
  if (metadata.md5 && sha.md5.toLowerCase() !== String(metadata.md5).toLowerCase()) {
    await removeCacheEntry(packageName);
    return { hit: false, reason: 'APK_CACHE_HASH_MISMATCH' };
  }

  // Identidade do pacote dentro do próprio APK.
  try {
    const identity = readApkIdentity(apkFile);
    if (identity.packageName !== packageName) {
      await removeCacheEntry(packageName);
      return { hit: false, reason: 'APK_CACHE_PACKAGE_MISMATCH' };
    }
  } catch {
    await removeCacheEntry(packageName);
    return { hit: false, reason: 'APK_CACHE_CORRUPT' };
  }

  // Se a consulta de agora espera um hash/versão diferente (app atualizou),
  // o cache antigo não serve.
  if (expected.sha256 && String(expected.sha256).toLowerCase() !== sha.sha256.toLowerCase()) {
    return { hit: false, reason: 'APK_CACHE_STALE' };
  }
  if (expected.md5 && String(expected.md5).toLowerCase() !== sha.md5.toLowerCase()) {
    return { hit: false, reason: 'APK_CACHE_STALE' };
  }
  if (expected.versionCode != null && metadata.versionCode != null
    && Number(expected.versionCode) !== Number(metadata.versionCode)) {
    return { hit: false, reason: 'APK_CACHE_STALE' };
  }

  return { hit: true, path: apkFile, metadata };
}

/**
 * Move um APK baixado para o cache.
 *
 * Copia primeiro para um arquivo temporário na MESMA pasta e renomeia no fim —
 * uma interrupção no meio nunca deixa um `.apk` "meio escrito" parecendo válido.
 *
 * @param {{packageName: string, fromPath: string, name?: string, versionName?: string,
 *          versionCode?: number, sha256: string, size: number, signerSha256?: string}} entry
 */
export async function storeApk(entry) {
  const { packageName, fromPath } = entry;
  // sha256 OU md5: algumas fontes (Aptoide) só publicam md5. Exigir um deles.
  if (!packageName || !fromPath || (!entry.sha256 && !entry.md5)) {
    throw new Error('storeApk: packageName, fromPath e sha256/md5 são obrigatórios');
  }
  const { dir, metaFile, apkFile } = cachePaths(packageName);
  await fsp.mkdir(dir, { recursive: true });

  // Nome do temporário ÚNICO por escrita: com nome fixo, dois downloads do mesmo
  // app em paralelo escrevem no MESMO arquivo, um sobrescreve o outro (cache
  // corrompido) e o que "perde" deixa um lixo para trás.
  const tmp = `${apkFile}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.part`;
  try {
    await fsp.copyFile(fromPath, tmp);
    // Nome final fixo por pacote: uma versão nova substitui a antiga. `rename`
    // é atômico no mesmo diretório, então o cache nunca aparece pela metade.
    await fsp.rename(tmp, apkFile);
  } catch (error) {
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw error;
  }

  const metadata = {
    packageName,
    name: entry.name || packageName,
    versionName: entry.versionName ?? null,
    versionCode: entry.versionCode ?? null,
    sha256: entry.sha256 ?? null,
    md5: entry.md5 ?? null,
    size: entry.size ?? null,
    signerSha256: entry.signerSha256 ?? null,
    signerSha1: entry.signerSha1 ?? null,
    source: entry.source || 'unknown',
    pageUrl: entry.pageUrl ?? null,
    downloadedAt: new Date().toISOString(),
  };
  await fsp.writeFile(metaFile, JSON.stringify(metadata, null, 2), 'utf8');
  return { path: apkFile, metadata };
}

/** Removem `.part` órfãos (de uma interrupção) no diretório do cache. */
export async function cleanupCacheParts() {
  let removed = 0;
  try {
    for (const name of await fsp.readdir(APK_CACHE_ROOT)) {
      const dir = path.join(APK_CACHE_ROOT, name);
      let entries = [];
      try { entries = await fsp.readdir(dir); } catch { continue; }
      for (const f of entries) {
        if (!f.endsWith('.part')) continue;
        await fsp.rm(path.join(dir, f), { force: true }).catch(() => {});
        removed++;
      }
    }
  } catch {
    // diretório ausente: nada a limpar
  }
  return { removed };
}

/**
 * Remove o diretório de cache ANTIGO, que ficava dentro do banco.
 *
 * Existe porque a versão anterior gravava em `dados/database/apk-cache`, e esses
 * APKs (centenas de MB) ficavam no caminho do backup do atualizador — foi o que
 * causou o ENOSPC em produção. Rodar uma vez libera o espaço e evita que o
 * backup continue copiando lixo. Nunca lança.
 */
export async function removeLegacyCache() {
  // Se o cache ATUAL aponta para o mesmo caminho (ex.: APK_CACHE_DIR foi
  // configurado dentro do banco), a "limpeza do legado" apagaria o cache em uso.
  if (path.resolve(LEGACY_CACHE_DIR) === path.resolve(APK_CACHE_ROOT)) return false;
  try {
    await fsp.rm(LEGACY_CACHE_DIR, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Poda o cache: remove entradas velhas e, se ainda passar do teto, as mais
 * antigas até caber. Nunca deixa o diretório crescer sem controle.
 * Também remove o diretório legado (dentro do banco), se ainda existir.
 */
export async function pruneCache(limits = CACHE_LIMITS) {
  await removeLegacyCache();
  let names;
  try {
    names = await fsp.readdir(APK_CACHE_ROOT);
  } catch {
    return { removed: 0 };
  }

  const entries = [];
  const now = Date.now();
  for (const name of names) {
    const meta = await readCacheMetadata(name);
    const { dir, apkFile } = cachePaths(name);
    let size = 0;
    try {
      size = (await fsp.stat(apkFile)).size;
    } catch {
      size = 0;
    }
    const downloadedAt = meta?.downloadedAt ? Date.parse(meta.downloadedAt) : 0;
    entries.push({ name, dir, size, downloadedAt, expired: downloadedAt && (now - downloadedAt) > limits.maxAgeMs });
  }

  let removed = 0;
  for (const e of entries.filter((x) => x.expired)) {
    await fsp.rm(e.dir, { recursive: true, force: true }).catch(() => {});
    removed++;
  }

  const live = entries.filter((e) => !e.expired).sort((a, b) => a.downloadedAt - b.downloadedAt);
  let total = live.reduce((acc, e) => acc + e.size, 0);
  for (const e of live) {
    if (total <= limits.maxTotalBytes) break;
    await fsp.rm(e.dir, { recursive: true, force: true }).catch(() => {});
    total -= e.size;
    removed++;
  }
  return { removed, totalBytes: total };
}

/** Esvazia o cache (usado em testes e em manutenção manual). */
export async function clearCache() {
  await fsp.rm(APK_CACHE_ROOT, { recursive: true, force: true }).catch(() => {});
}

export default {
  APK_CACHE_ROOT,
  LEGACY_CACHE_DIR,
  CACHE_DIR,
  CACHE_LIMITS,
  cachePaths,
  readCacheMetadata,
  getCachedApk,
  storeApk,
  pruneCache,
  removeCacheEntry,
  removeLegacyCache,
  clearCache,
};
