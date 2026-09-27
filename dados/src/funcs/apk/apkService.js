/**
 * APKManager — orquestrador multi-source do `!apk`.
 *
 * Fluxo: `search(query)` consulta os providers habilitados EM PARALELO
 * (com timeout e isolamento de erro), normaliza e ordena os candidatos; depois
 * `acquire()` pega o melhor APK ÚNICO, baixa, valida contra os metadados da
 * própria fonte, guarda no cache e devolve o caminho para o `index.js` enviar.
 *
 * "Primeiro resultado válido" NÃO é o primeiro HTTP 200: é o primeiro candidato
 * que passou por download + validação (package, versão, hash, assinatura). Se o
 * candidato mais bem pontuado falhar, o próximo é tentado.
 *
 * Um provider que falha (bloqueio/timeout/erro) NÃO derruba o sistema: o erro é
 * isolado e os outros seguem.
 *
 * Aqui NÃO há Baileys: o envio é feito pelo `index.js`.
 */

import { downloadApkToTemp, safeUnlink } from './apkDownload.js';
import { validateApk } from './apkFile.js';
import { getCachedApk, storeApk, pruneCache } from './apkCache.js';
import { getEnabledProviders, getAllProviders, PROVIDER_ORDER } from './providers/index.js';
import { rankCandidates, pickBestSingleApk, onlyBundles, isStrongMatch } from './providers/candidateSelect.js';
import { isSingleApk, PROVIDER_LABELS } from './providers/providerUtils.js';

/** Códigos estáveis de erro do comando (o usuário vê texto amigável). */
export const APK_CODES = Object.freeze({
  QUERY_EMPTY: 'APK_QUERY_EMPTY',
  NOT_FOUND: 'APK_NOT_FOUND',
  NO_CONFIDENT_MATCH: 'APK_NO_CONFIDENT_MATCH',
  AMBIGUOUS: 'APK_AMBIGUOUS',
  ONLY_BUNDLE: 'APK_ONLY_BUNDLE',
  SEARCH_ERROR: 'APK_SEARCH_ERROR',
  ALL_PROVIDERS_FAILED: 'APK_ALL_PROVIDERS_FAILED',
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
  [APK_CODES.NOT_FOUND]: '❌ Não foi possível encontrar um APK válido para esse aplicativo.',
  [APK_CODES.NO_CONFIDENT_MATCH]: '❌ Não encontrei um aplicativo correspondente.\n\n💡 Tente o nome exato do app ou o *package id* (ex.: *!apk org.videolan.vlc*).',
  [APK_CODES.AMBIGUOUS]: '❌ Encontrei vários aplicativos parecidos. Seja mais específico (tente o nome exato ou o package id).',
  [APK_CODES.ONLY_BUNDLE]: '⚠️ Encontrei o aplicativo, mas somente em formato dividido/bundle.',
  [APK_CODES.SEARCH_ERROR]: '❌ Não consegui pesquisar agora. Tente novamente.',
  [APK_CODES.ALL_PROVIDERS_FAILED]: '❌ Nenhuma fonte respondeu. Tente novamente em instantes.',
  [APK_CODES.METADATA_ERROR]: '❌ Os dados desse aplicativo estão incompletos na fonte.',
  [APK_CODES.CATALOG_ERROR]: '❌ Não consegui carregar o catálogo agora. Tente novamente.',
  [APK_CODES.DOWNLOAD_ERROR]: '❌ Não consegui baixar o APK.',
  [APK_CODES.DOWNLOAD_TIMEOUT]: '❌ O download demorou demais e foi cancelado.',
  [APK_CODES.SIZE_LIMIT]: '❌ Esse APK é grande demais para eu baixar.',
  [APK_CODES.INVALID_FILE]: '❌ O arquivo baixado não é um APK válido.',
  [APK_CODES.PACKAGE_MISMATCH]: '❌ O APK baixado não corresponde ao aplicativo esperado.',
  [APK_CODES.VERSION_MISMATCH]: '❌ A versão do APK não corresponde à esperada.',
  [APK_CODES.HASH_MISMATCH]: '❌ A verificação de integridade do arquivo falhou.',
  [APK_CODES.SIGNATURE_ERROR]: '❌ A assinatura do APK não confere com a da fonte.',
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
// ---------------------------------------------------------------------------
// Pesquisa multi-source
// ---------------------------------------------------------------------------

/** Prioridade de desempate por fonte (menor = melhor). */
function priorityOf(source) {
  const idx = PROVIDER_ORDER.indexOf(String(source).toLowerCase());
  return idx < 0 ? PROVIDER_ORDER.length : idx;
}

/** Os providers habilitados agora. */
export function providers() {
  return getEnabledProviders();
}

/**
 * Consulta TODOS os providers habilitados em paralelo, com isolamento de erro.
 *
 * Cada provider tem timeout próprio e uma falha não afeta os outros: o que
 * der certo entra; o que falhar vira uma entrada em `errors`.
 *
 * @param {string} query
 * @param {{log?: Function}} [opts]
 * @returns {Promise<{candidates: Array<object>, errors: Array<object>}>}
 */
export async function searchAllProviders(query, opts = {}) {
  const log = opts.log || (() => {});
  const list = providers();
  if (!list.length) return { candidates: [], errors: [{ provider: 'none', code: 'APK_NO_PROVIDERS' }] };

  const results = await Promise.all(list.map(async (provider) => {
    log(`[APK] provider=${provider.ID} started`);
    try {
      const res = await provider.search(query, { timeoutMs: opts.timeoutMs });
      const candidates = res?.candidates || [];
      log(`[APK] provider=${provider.ID} result count=${candidates.length}`);
      return { provider: provider.ID, candidates, error: null };
    } catch (error) {
      // Erro isolado: registra e segue com os demais.
      log(`[APK] provider=${provider.ID} failed code=${error?.code || error?.name || 'ERROR'} detail=${error?.message || error}`);
      return { provider: provider.ID, candidates: [], error: { provider: provider.ID, code: error?.code || 'APK_PROVIDER_ERROR', message: error?.message } };
    }
  }));

  const candidates = [];
  const errors = [];
  for (const r of results) {
    candidates.push(...r.candidates.map((c) => ({ ...c, providerPriority: priorityOf(c.source) })));
    if (r.error) errors.push(r.error);
  }
  return { candidates, errors };
}

/**
 * Procura o aplicativo e devolve os candidatos ordenados (sem baixar nada).
 *
 * @param {string} query
 * @param {{log?: Function, timeoutMs?: number}} [opts]
 * @returns {Promise<{ok: true, candidates: Array<object>, best: object|null} | {ok: false, code: string, candidates?: Array<object>}>}
 */
export async function search(query, opts = {}) {
  const q = String(query || '').trim();
  if (!q) return { ok: false, code: APK_CODES.QUERY_EMPTY };

  const { candidates, errors } = await searchAllProviders(q, opts);
  opts.log?.(`[APK] search sources=${providers().map((p) => p.ID).join(',')} candidates=${candidates.length} errors=${errors.length}`);

  if (!candidates.length) {
    // Nenhum candidato: distinguir "todas as fontes falharam" de "não existe".
    if (errors.length && errors.length === providers().length) {
      return { ok: false, code: APK_CODES.ALL_PROVIDERS_FAILED, errors };
    }
    return { ok: false, code: APK_CODES.NOT_FOUND, errors };
  }

  const ranked = rankCandidates(candidates, { query: q, priorityOf });
  const strong = ranked.filter((c) => isStrongMatch(q, c));
  if (!strong.length) return { ok: false, code: APK_CODES.NO_CONFIDENT_MATCH, candidates: ranked };

  const best = pickBestSingleApk(ranked, q);
  if (!best) {
    // Só há bundle/dividido (ou nada entregável).
    if (onlyBundles(ranked, q)) return { ok: false, code: APK_CODES.ONLY_BUNDLE, candidates: ranked };
    return { ok: false, code: APK_CODES.NOT_FOUND, candidates: ranked };
  }
  return { ok: true, candidates: ranked, best };
}

/**
 * Compatibilidade com o código/command anterior: devolve o melhor app.
 * @deprecated use `search`.
 */
export async function findApp(query, opts = {}) {
  const res = await search(query, opts);
  if (!res.ok) return res;
  return { ok: true, record: res.best, candidates: res.candidates };
}

// ---------------------------------------------------------------------------
// Preparo do arquivo (cache → download → validação → cache)
// ---------------------------------------------------------------------------

/**
 * Devolve um APK pronto para enviar, validado contra os metadados da FONTE do
 * candidato (package sempre; versão/hash/assinatura quando a fonte informa).
 *
 * @param {object} candidate candidato normalizado (saída de `search`)
 * @param {{log?: Function, maxBytes?: number}} [opts]
 * @returns {Promise<{path, temporary, cached, size, sha256, identity, signers, metadata, source}>}
 * @throws {ApkError}
 */
export async function prepareApk(candidate, opts = {}) {
  const log = opts.log || (() => {});
  const url = candidate?.downloadUrl;
  if (!candidate?.packageName || !url) {
    throw new ApkError(APK_CODES.METADATA_ERROR, 'Candidato sem package/URL de download.', { source: candidate?.source });
  }
  if (!isSingleApk(candidate.type)) {
    throw new ApkError(APK_CODES.ONLY_BUNDLE, `Formato não suportado (${candidate.type}).`, { source: candidate.source });
  }

  const source = candidate.source;
  const expected = {
    packageName: candidate.packageName,
    versionCode: candidate.versionCode,
    sha256: candidate.sha256,
    md5: candidate.md5,
    signerSha256: candidate.signerSha256,
    signerSha1: candidate.signerSha1,
  };

  // 1) Cache — só usa se estiver ÍNTEGRO (tamanho + hash + package).
  try {
    const cached = await getCachedApk(candidate.packageName, {
      sha256: candidate.sha256,
      md5: candidate.md5,
      versionCode: candidate.versionCode,
    });
    if (cached.hit) {
      log(`[APK] cache hit package=${candidate.packageName} source=${source} size=${cached.metadata.size}`);
      return {
        path: cached.path,
        temporary: false,
        cached: true,
        size: cached.metadata.size,
        sha256: cached.metadata.sha256 || null,
        md5: cached.metadata.md5 || null,
        identity: { packageName: candidate.packageName },
        signers: [],
        source,
        metadata: cached.metadata,
      };
    }
    if (cached.reason) log(`[APK] cache miss package=${candidate.packageName} reason=${cached.reason}`);
  } catch (error) {
    log(`[APK] cache erro package=${candidate.packageName}: ${error?.message}`);
  }

  // 2) Download — host validado pelo downloader (lista do provider).
  log(`[APK] download started source=${source} package=${candidate.packageName} url=${url} expectedSize=${candidate.size}`);

  await acquireSlot();
  let temp = null;
  try {
    const allowedHosts = new Set(providerHosts(source));
    const dl = await downloadApkToTemp(url, {
      allowedHosts,
      maxBytes: opts.maxBytes,
    });
    temp = dl.path;
    log(`[APK] downloaded size=${dl.size} sha256=${dl.sha256}`);

    const verdict = validateApk(temp, expected);
    if (!verdict.ok) {
      await safeUnlink(temp);
      temp = null;
      throw new ApkError(mapValidationCode(verdict.code), verdict.message, {
        source,
        actual: verdict.actualSha256 || verdict.actualMd5,
        expected: expected.sha256 || expected.md5,
      });
    }
    log(`[APK] validation success package=${verdict.identity.packageName} version=${verdict.identity.versionName} source=${source}`);

    // 3) Cache.
    let finalPath = temp;
    let temporary = true;
    try {
      const stored = await storeApk({
        packageName: candidate.packageName,
        fromPath: temp,
        name: candidate.name,
        versionName: verdict.identity.versionName ?? candidate.versionName,
        versionCode: verdict.identity.versionCode ?? candidate.versionCode,
        sha256: verdict.identity && expected.sha256 ? dl.sha256 : (expected.sha256 || null),
        md5: expected.md5 || null,
        size: dl.size,
        signerSha256: candidate.signerSha256 || null,
        signerSha1: candidate.signerSha1 || null,
        source,
        pageUrl: candidate.pageUrl || null,
      });
      finalPath = stored.path;
      temporary = false;
      await safeUnlink(temp);
      temp = null;
      await pruneCache().catch(() => {});
    } catch (error) {
      log(`[APK] cache store falhou: ${error?.message}`);
      temp = null; // limpeza passa para o chamador
    }

    return {
      path: finalPath,
      temporary,
      cached: false,
      size: dl.size,
      sha256: dl.sha256,
      md5: null,
      identity: verdict.identity,
      signers: verdict.signers || [],
      source,
      metadata: {
        packageName: verdict.identity.packageName,
        name: candidate.name,
        versionName: verdict.identity.versionName,
        versionCode: verdict.identity.versionCode,
        sha256: dl.sha256,
        size: dl.size,
        signerSha256: candidate.signerSha256 || null,
        signerSha1: candidate.signerSha1 || null,
        source,
        pageUrl: candidate.pageUrl || null,
        downloadedAt: new Date().toISOString(),
      },
    };
  } finally {
    releaseSlot();
    if (temp) await safeUnlink(temp);
  }
}

/** Hosts permitidos do provider (anti-SSRF). */
function providerHosts(source) {
  const p = providers().find((x) => x.ID === source) || getAllProviders().find((x) => x.ID === source);
  return p?.ALLOWED_HOSTS || [];
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
 * Fluxo completo: pesquisa multi-source e tenta adquirir um APK válido.
 *
 * "Primeiro resultado VÁLIDO": percorre os candidatos por ordem de pontuação e
 * devolve o primeiro que passou por download + validação. Candidato inválido não
 * derruba o processo — o próximo é tentado. Isso é o que garante que a "primeira
 * resposta" (de um provider que só devolveu lixo) NÃO seja confundida com o
 * "primeiro APK válido".
 *
 * @returns {Promise<{ok:true, candidate, prepared} | {ok:false, code, ...}>}
 */
export async function acquire(query, opts = {}) {
  const log = opts.log || (() => {});
  // Reaproveita candidatos já pesquisados (o comando chama search() antes) para
  // não repetir as requisições aos providers.
  let res = opts.candidates ? { ok: true, candidates: opts.candidates } : await search(query, opts);
  if (!res.ok) return res;

  const attempts = [];
  for (const candidate of res.candidates) {
    if (!isSingleApk(candidate.type) || candidate.downloadable === false) continue;
    if (!isStrongMatch(query, candidate)) continue;
    try {
      const prepared = await prepareApk(candidate, opts);
      log(`[APK] provider winner=${candidate.source}`);
      return { ok: true, candidate, prepared, attempts };
    } catch (error) {
      attempts.push({ source: candidate.source, code: error?.code, message: error?.message });
      log(`[APK] candidate failed source=${candidate.source} code=${error?.code} detail=${error?.message}`);
      // Segue para o próximo candidato (outra fonte ou outra variante).
    }
  }

  // Nenhum candidato passou na validação.
  const lastCode = attempts.length ? attempts[attempts.length - 1].code : APK_CODES.NOT_FOUND;
  return { ok: false, code: lastCode || APK_CODES.NOT_FOUND, attempts, candidates: res.candidates };
}

/** Compatibilidade: pesquisa + adquire. */
export async function resolveApk(query, opts = {}) {
  return acquire(query, opts);
}

export default {
  APK_CODES,
  APK_USER_MESSAGES,
  ApkError,
  userMessageFor,
  providers,
  searchAllProviders,
  search,
  findApp,
  prepareApk,
  acquire,
  resolveApk,
  downloadStats,
  checkCooldown,
  resetCooldown,
};
