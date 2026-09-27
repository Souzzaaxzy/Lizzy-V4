/**
 * Orquestrador do `!apk`: pesquisa → download → validação → cache.
 *
 * Aqui NÃO há Baileys: o envio é feito pelo `index.js` (que já tem o `nazu` e o
 * `reply`). Este módulo devolve um caminho de arquivo pronto para enviar, ou um
 * erro com CÓDIGO estável. É assim que o `case 'apk'` fica fino.
 *
 * Fluxo:
 *   1. `findApp(query)`  → registro do app no índice do F-Droid (ou motivo);
 *   2. `prepareApk(rec)` → cache íntegro? usa; senão baixa, valida e guarda.
 *
 * Concorrência: um semáforo simples limita quantos APKs são baixados ao mesmo
 * tempo (sem fila global nova — só um contador aqui dentro).
 */

import { searchCatalog, buildApkUrl, assertAllowedUrl, ensureCatalog, MAX_INDEX_BYTES } from './fdroidIndex.js';
import { downloadApkToTemp, safeUnlink } from './apkDownload.js';
import { validateApk } from './apkFile.js';
import { getCachedApk, storeApk, pruneCache } from './apkCache.js';

/** Códigos estáveis de erro do comando (o usuário vê texto amigável). */
export const APK_CODES = Object.freeze({
  QUERY_EMPTY: 'APK_QUERY_EMPTY',
  NOT_FOUND: 'APK_NOT_FOUND',
  NO_CONFIDENT_MATCH: 'APK_NO_CONFIDENT_MATCH',
  AMBIGUOUS: 'APK_AMBIGUOUS',
  SEARCH_ERROR: 'APK_SEARCH_ERROR',
  METADATA_ERROR: 'APK_METADATA_ERROR',
  CATALOG_ERROR: 'APK_CATALOG_ERROR',
  DOWNLOAD_ERROR: 'APK_DOWNLOAD_ERROR',
  DOWNLOAD_TIMEOUT: 'APK_DOWNLOAD_TIMEOUT',
  SIZE_LIMIT: 'APK_SIZE_LIMIT',
  INVALID_FILE: 'APK_INVALID_FILE',
  PACKAGE_MISMATCH: 'APK_PACKAGE_MISMATCH',
  VERSION_MISMATCH: 'APK_VERSION_MISMATCH',
  HASH_MISMATCH: 'APK_HASH_MISMATCH',
  SIGNATURE_ERROR: 'APK_SIGNATURE_ERROR',
  SEND_ERROR: 'APK_SEND_ERROR',
  CACHE_ERROR: 'APK_CACHE_ERROR',
  URL_NOT_ALLOWED: 'APK_URL_NOT_ALLOWED',
  TIMEOUT: 'APK_TIMEOUT',
});

/** Mensagens curtas para o usuário, sem stack trace. */
export const APK_USER_MESSAGES = Object.freeze({
  [APK_CODES.QUERY_EMPTY]: 'Informe o nome do aplicativo.\nExemplo: *!apk firefox*',
  [APK_CODES.NOT_FOUND]: '❌ Não encontrei esse aplicativo no F-Droid.',
  [APK_CODES.NO_CONFIDENT_MATCH]: '❌ Não encontrei um aplicativo correspondente no F-Droid.\n\n💡 Tente o nome exato do app ou o *package id* (ex.: *!apk org.videolan.vlc*).',
  [APK_CODES.AMBIGUOUS]: '❌ Encontrei vários aplicativos parecidos. Seja mais específico (tente o nome exato ou o package id).',
  [APK_CODES.SEARCH_ERROR]: '❌ Não consegui pesquisar no F-Droid agora. Tente novamente.',
  [APK_CODES.METADATA_ERROR]: '❌ Os dados desse aplicativo estão incompletos no F-Droid.',
  [APK_CODES.CATALOG_ERROR]: '❌ Não consegui carregar o catálogo do F-Droid agora. Tente novamente.',
  [APK_CODES.DOWNLOAD_ERROR]: '❌ Não consegui baixar o APK.',
  [APK_CODES.DOWNLOAD_TIMEOUT]: '❌ O download demorou demais e foi cancelado.',
  [APK_CODES.SIZE_LIMIT]: '❌ Esse APK é grande demais para eu baixar.',
  [APK_CODES.INVALID_FILE]: '❌ O arquivo baixado não é um APK válido.',
  [APK_CODES.PACKAGE_MISMATCH]: '❌ O APK baixado não corresponde ao aplicativo esperado.',
  [APK_CODES.VERSION_MISMATCH]: '❌ A versão do APK não corresponde à esperada.',
  [APK_CODES.HASH_MISMATCH]: '❌ A verificação de integridade (SHA-256) falhou.',
  [APK_CODES.SIGNATURE_ERROR]: '❌ A assinatura do APK não confere com a do F-Droid.',
  [APK_CODES.SEND_ERROR]: '❌ Não consegui enviar o APK.',
  [APK_CODES.CACHE_ERROR]: '❌ Erro ao acessar o cache de APKs.',
  [APK_CODES.URL_NOT_ALLOWED]: '❌ Origem do download não permitida.',
  [APK_CODES.TIMEOUT]: '❌ A operação demorou demais.',
});

export class ApkError extends Error {
  constructor(code, message, details = {}) {
    super(message || code);
    this.name = 'ApkError';
    this.code = code;
    this.details = details;
  }
}

/** Mensagem amigável para um código. */
export function userMessageFor(code) {
  return APK_USER_MESSAGES[code] || '❌ Não consegui processar o APK.';
}

// ---------------------------------------------------------------------------
// Semáforo de downloads simultâneos
// ---------------------------------------------------------------------------

const MAX_CONCURRENT = Number(process.env.APK_MAX_CONCURRENT) || 2;
let active = 0;
const waiters = [];

async function acquireSlot() {
  if (active < MAX_CONCURRENT) { active++; return; }
  await new Promise((resolve) => waiters.push(resolve));
  active++;
}

function releaseSlot() {
  active--;
  const next = waiters.shift();
  if (next) next();
}

/** Expostos para teste/introspecção. */
export function downloadStats() {
  return { active, waiting: waiters.length, max: MAX_CONCURRENT };
}

// ---------------------------------------------------------------------------
// Cooldown por usuário
// ---------------------------------------------------------------------------

/**
 * Cooldown próprio do `!apk` (o throttle global do bot é de 3 comandos/5s e não
 * impede alguém pedir 3 APKs grandes em sequência). Evita que um usuário só
 * dispare vários downloads.
 */
const APK_COOLDOWN_MS = Number(process.env.APK_COOLDOWN_MS) || 20000;
const lastUseByUser = new Map();

export function checkCooldown(userId, now = Date.now()) {
  const last = lastUseByUser.get(userId) || 0;
  const remaining = APK_COOLDOWN_MS - (now - last);
  if (remaining > 0) return { ok: false, remainingMs: remaining };
  lastUseByUser.set(userId, now);
  if (lastUseByUser.size > 5000) {
    for (const [k, v] of lastUseByUser) {
      if (now - v > APK_COOLDOWN_MS) lastUseByUser.delete(k);
    }
  }
  return { ok: true };
}

/** Exclusivo para testes. */
export function resetCooldown() {
  lastUseByUser.clear();
}

// ---------------------------------------------------------------------------
// Pesquisa
// ---------------------------------------------------------------------------

/**
 * Procura o aplicativo no catálogo do F-Droid.
 * @param {string} query
 * @returns {Promise<{ok: true, record: object} | {ok: false, code: string, candidates?: object[]}>}
 */
export async function findApp(query) {
  const q = String(query || '').trim();
  if (!q) return { ok: false, code: APK_CODES.QUERY_EMPTY };

  // Um package id resolve SEM rede de busca (o catálogo bastou), mas o catálogo
  // ainda precisa existir.
  let result;
  try {
    result = await searchCatalog(q);
  } catch (error) {
    if (String(error?.message || '').includes(MAX_INDEX_BYTES)) {
      return { ok: false, code: APK_CODES.CATALOG_ERROR };
    }
    return { ok: false, code: APK_CODES.SEARCH_ERROR };
  }

  if (!result.ok) {
    const code = result.reason === 'APK_QUERY_EMPTY' ? APK_CODES.QUERY_EMPTY
      : result.reason === 'APK_AMBIGUOUS' ? APK_CODES.AMBIGUOUS
        : result.reason === 'APK_NO_CONFIDENT_MATCH' ? APK_CODES.NO_CONFIDENT_MATCH
          : APK_CODES.NOT_FOUND;
    return { ok: false, code, candidates: result.candidates || [] };
  }
  return { ok: true, record: result.matches[0] };
}

// ---------------------------------------------------------------------------
// Preparo do arquivo (cache → download → validação → cache)
// ---------------------------------------------------------------------------

/**
 * Devolve um APK pronto para enviar, validado contra os metadados do F-Droid.
 *
 * @param {object} record registro do catálogo (saída de findApp)
 * @param {{allowedHosts?: Set<string>, log?: (msg: string, extra?: object) => void}} [opts]
 * @returns {Promise<{path: string, cached: boolean, size: number, sha256: string, identity: object, signers: Array, metadata: object}>}
 * @throws {ApkError}
 */
export async function prepareApk(record, opts = {}) {
  const log = opts.log || (() => {});
  if (!record?.packageName || !record?.file?.sha256) {
    throw new ApkError(APK_CODES.METADATA_ERROR, 'Registro sem metadados de arquivo.', { record: record?.packageName });
  }

  const expected = {
    packageName: record.packageName,
    versionCode: record.versionCode,
    sha256: record.file.sha256,
    signerSha256: record.signerSha256,
  };

  // 1) Cache — só usa se estiver ÍNTEGRO (tamanho + sha + package).
  try {
    const cached = await getCachedApk(record.packageName, expected);
    if (cached.hit) {
      log(`[APK] cache hit package=${record.packageName} size=${cached.metadata.size}`);
      return {
        path: cached.path,
        temporary: false,
        cached: true,
        size: cached.metadata.size,
        sha256: cached.metadata.sha256,
        identity: { packageName: record.packageName },
        signers: [],
        metadata: cached.metadata,
      };
    }
    if (cached.reason) log(`[APK] cache miss package=${record.packageName} reason=${cached.reason}`);
  } catch (error) {
    // Falha no cache NÃO deve impedir o download.
    log(`[APK] cache erro package=${record.packageName}: ${error?.message}`);
  }

  // 2) URL do APK — SEMPRE do índice, nunca do usuário; host precisa ser do F-Droid.
  const url = buildApkUrl(record, opts.repoAddress);
  if (!url) throw new ApkError(APK_CODES.METADATA_ERROR, 'Metadados sem nome de arquivo válido.');
  const allowed = assertAllowedUrl(url, opts.allowedHosts, { allowInsecure: opts.allowInsecure });
  if (!allowed.ok) throw new ApkError(APK_CODES.URL_NOT_ALLOWED, allowed.reason);

  log(`[APK] download started package=${record.packageName} url=${url} expectedSize=${record.file.size}`);

  await acquireSlot();
  let temp = null;
  try {
    const dl = await downloadApkToTemp(url, {
      allowedHosts: opts.allowedHosts,
      maxBytes: opts.maxBytes,
      allowInsecure: opts.allowInsecure,
    });
    temp = dl.path;
    log(`[APK] downloaded size=${dl.size} sha256=${dl.sha256}`);

    const verdict = validateApk(temp, expected);
    if (!verdict.ok) {
      // Arquivo inválido: apaga JÁ e reporta o código específico.
      await safeUnlink(temp);
      temp = null;
      throw new ApkError(mapValidationCode(verdict.code), verdict.message, {
        actual: verdict.actualSha256,
        expected: expected.sha256,
      });
    }
    log(`[APK] validation=success package=${verdict.identity.packageName} version=${verdict.identity.versionName}`);

    // 3) Guarda no cache para o próximo pedido.
    let finalPath = temp;
    let temporary = true;
    try {
      const stored = await storeApk({
        packageName: record.packageName,
        fromPath: temp,
        name: record.name,
        versionName: verdict.identity.versionName ?? record.versionName,
        versionCode: verdict.identity.versionCode ?? record.versionCode,
        sha256: dl.sha256,
        size: dl.size,
        signerSha256: record.signerSha256,
      });
      finalPath = stored.path;
      temporary = false;
      await safeUnlink(temp);
      temp = null;
      await pruneCache().catch(() => {});
    } catch (error) {
      // Cache falhou, mas o arquivo validado continua servindo para o envio.
      // Como ele é temporário, o chamador precisa apagá-lo após enviar.
      log(`[APK] cache store falhou: ${error?.message}`);
      temp = null; // a responsabilidade da limpeza passa para o chamador
    }

    return {
      path: finalPath,
      temporary,
      cached: false,
      size: dl.size,
      sha256: dl.sha256,
      identity: verdict.identity,
      signers: verdict.signers || [],
      metadata: {
        packageName: verdict.identity.packageName,
        name: record.name,
        versionName: verdict.identity.versionName,
        versionCode: verdict.identity.versionCode,
        sha256: dl.sha256,
        size: dl.size,
        signerSha256: record.signerSha256,
        source: 'fdroid',
        downloadedAt: new Date().toISOString(),
      },
    };
  } finally {
    releaseSlot();
    if (temp) await safeUnlink(temp);
  }
}

function mapValidationCode(code) {
  switch (code) {
    case 'APK_PACKAGE_MISMATCH': return APK_CODES.PACKAGE_MISMATCH;
    case 'APK_VERSION_MISMATCH': return APK_CODES.VERSION_MISMATCH;
    case 'APK_HASH_MISMATCH': return APK_CODES.HASH_MISMATCH;
    case 'APK_SIGNATURE_ERROR': return APK_CODES.SIGNATURE_ERROR;
    case 'APK_INVALID_FILE': return APK_CODES.INVALID_FILE;
    case 'APK_METADATA_ERROR': return APK_CODES.METADATA_ERROR;
    default: return APK_CODES.INVALID_FILE;
  }
}

/**
 * Fluxo completo, sem Baileys: pesquisa + prepara. Devolve o registro e o
 * arquivo pronto (ou um `ApkError`).
 */
export async function resolveApk(query, opts = {}) {
  const found = await findApp(query);
  if (!found.ok) return found;
  const prepared = await prepareApk(found.record, opts);
  return { ok: true, record: found.record, prepared };
}

export default {
  APK_CODES,
  APK_USER_MESSAGES,
  ApkError,
  userMessageFor,
  findApp,
  prepareApk,
  resolveApk,
  downloadStats,
  checkCooldown,
  resetCooldown,
};
