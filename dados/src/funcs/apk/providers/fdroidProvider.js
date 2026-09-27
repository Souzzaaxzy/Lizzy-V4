/**
 * Provider F-Droid.
 *
 * DESEMPENHO: a versão anterior baixava o índice inteiro (~60 MB) ANTES de
 * responder — a primeira busca levava mais de um minuto. Agora a busca usa
 * apenas endpoints pequenos e rápidos:
 *
 *   1. `search.f-droid.org/api/search_apps?q=`  → lista de candidatos por nome;
 *   2. por candidato: `f-droid.org/api/v1/packages/<pkg>` (≈500 B) → versões
 *      publicadas;
 *   3. por candidato: um HEAD no `.apk` para tamanho e tipo.
 *
 * São requisições pequenas e paralelas (poucos candidatos), não o índice todo.
 * O índice grande fica só como ENRIQUECIMENTO opcional: quando já está em
 * memória (carregado em segundo plano), ele acrescenta `sha256` e o signer do
 * pacote — e aí a validação fica ainda mais forte. Sem ele, o F-Droid ainda
 * funciona (valida package + versão, como qualquer outra fonte).
 *
 * Método: endpoints JSON oficiais, nada de scraping.
 */

import {
  searchAppIndex, packageIdFromUrl, buildApkUrl, assertAllowedUrl,
  warmCatalog, isCatalogReady, lookupCatalog, repoAddress, allowedHosts,
} from '../fdroidIndex.js';
import { providerRequest, normalizeCandidate, providerError, APK_TYPE, PROVIDER_LABELS } from './providerUtils.js';

export const ID = 'fdroid';
export const LABEL = PROVIDER_LABELS.fdroid;
export const ALLOWED_HOSTS = Object.freeze(['f-droid.org', 'www.f-droid.org']);

const PACKAGE_API = 'https://f-droid.org/api/v1/packages';
const REPO = 'https://f-droid.org/repo';
/** Quantos candidatos enriquecem com versão/HEAD (limitado: poucas requisições). */
const MAX_ENRICH = Number(process.env.APK_FDROID_MAX_ENRICH) || 6;

/** Busca por nome/package nos endpoints oficiais (rápidos). */
export async function search(query, opts = {}) {
  const q = String(query || '').trim();
  if (!q) return { ok: false, reason: 'APK_QUERY_EMPTY', provider: ID, candidates: [] };

  // Garante que o índice grande esteja carregando em segundo plano (não espera).
  warmCatalog();

  // Se a consulta é um package id e o catálogo já está pronto, resolve direto.
  const candidates = [];
  const seen = new Set();
  const addCandidate = (c) => {
    if (c?.packageName && c.name && !seen.has(c.packageName)) {
      candidates.push(c);
      seen.add(c.packageName);
    }
  };

  if (isPackageId(q) && isCatalogReady()) {
    const rec = lookupCatalog(q);
    if (rec) addCandidate(toCandidate(rec));
  }

  let apps = [];
  try {
    apps = await searchAppIndex(q, { timeoutMs: opts.timeoutMs });
  } catch (error) {
    if (candidates.length) return { ok: true, provider: ID, candidates };
    const isAbort = error?.code === 'ERR_CANCELED' || error?.name === 'CanceledError' || /aborted|timeout/i.test(String(error?.message));
    throw providerError(ID, isAbort ? 'TIMEOUT' : 'SEARCH_ERROR', { cause: error?.message });
  }

  // Enriquece os primeiros candidatos em paralelo (versão + tamanho do APK).
  const ids = apps.map((a) => packageIdFromUrl(a.url)).filter(Boolean).slice(0, MAX_ENRICH);
  const enriched = await Promise.all(ids.map((pkgId) => enrich(pkgId, opts).catch(() => null)));

  for (const c of enriched) {
    if (c) addCandidate(c);
  }
  // Candidatos além do limite de enriquecimento entram só com o nome (servem de
  // fallback caso os enriquecidos não tenham APK).
  for (const a of apps) {
    const pkgId = packageIdFromUrl(a.url);
    if (!pkgId || seen.has(pkgId)) continue;
    addCandidate(normalizeCandidate({
      source: ID,
      name: a.name,
      packageName: pkgId,
      type: APK_TYPE.UNKNOWN,
      pageUrl: `https://f-droid.org/packages/${pkgId}/`,
      downloadable: false,
    }));
  }

  return { ok: true, provider: ID, candidates };
}

/** Resolve um pacote específico: versão publicada + tamanho do APK. */
async function enrich(packageName, opts = {}) {
  // Com o catálogo pronto, ele já dá hash/signer e não precisa de HEAD.
  const cached = isCatalogReady() ? lookupCatalog(packageName) : null;
  if (cached) return toCandidate(cached);

  const versions = await fetchVersions(packageName, opts).catch(() => null);
  if (!versions) return null;

  const code = versions.suggestedVersionCode
    || versions.packages?.[0]?.versionCode;
  if (!code) return null;

  const url = `${REPO}/${packageName}_${code}.apk`;
  const allowed = assertAllowedUrl(url, new Set(ALLOWED_HOSTS));
  if (!allowed.ok) return null;

  const head = await headApk(url, opts).catch(() => null);
  if (!head || !head.ok) return null;

  const versionName = (versions.packages || []).find((p) => p.versionCode === code)?.versionName
    || versions.packages?.[0]?.versionName || null;

  return normalizeCandidate({
    source: ID,
    name: null, // preenchido pelo chamador (a API de busca traz o nome)
    packageName,
    versionName,
    versionCode: code,
    type: head.type === APK_TYPE.APK ? APK_TYPE.APK : APK_TYPE.UNKNOWN,
    size: head.size,
    downloadUrl: head.type === APK_TYPE.APK ? url : null,
    pageUrl: `https://f-droid.org/packages/${packageName}/`,
    downloadable: head.type === APK_TYPE.APK,
  });
}

/** Versões publicadas de um pacote (API v1, ~500 B). */
async function fetchVersions(packageName, opts = {}) {
  const res = await providerRequest(`${PACKAGE_API}/${encodeURIComponent(packageName)}`, {
    asJson: true,
    timeoutMs: opts.timeoutMs,
  });
  const data = res.data;
  if (!data || data.error) return null;
  return data;
}

/** HEAD no APK: tamanho (Content-Length) e tipo. Não baixa o arquivo. */
async function headApk(url, opts = {}) {
  const res = await providerRequest(url, { html: true, timeoutMs: opts.timeoutMs, method: 'HEAD' });
  const size = Number(res.headers?.['content-length'] || 0) || null;
  const ctype = String(res.headers?.['content-type'] || '');
  const type = ctype.includes('android.package-archive') || url.endsWith('.apk') ? APK_TYPE.APK : APK_TYPE.UNKNOWN;
  return { ok: res.status >= 200 && res.status < 400, size, type };
}

/** Converte um registro do catálogo (quando disponível) no candidato comum. */
export function toCandidate(record, opts = {}) {
  const url = buildApkUrl(record, opts.repoAddress || repoAddress());
  const allowed = url ? assertAllowedUrl(url, opts.allowedHosts || allowedHosts()) : { ok: false };
  return normalizeCandidate({
    source: ID,
    name: record.name,
    packageName: record.packageName,
    versionName: record.versionName,
    versionCode: record.versionCode,
    type: APK_TYPE.APK,
    size: record.file?.size ?? null,
    downloadUrl: allowed.ok ? url : null,
    pageUrl: `https://f-droid.org/packages/${record.packageName}/`,
    sha256: record.file?.sha256 ?? null,
    signerSha256: record.signerSha256 ?? null,
    architecture: (record.nativecode || []).join(', ') || 'universal',
    downloadable: allowed.ok,
  });
}

/** A consulta parece um package id? */
export function isPackageId(q) {
  return /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+){1,}$/.test(q);
}

/**
 * Resolve um package id no F-Droid pelo caminho rápido: primeiro o catálogo (se
 * já carregado, traz hash/signer), senão a API de versões + HEAD no APK.
 */
export async function getByPackage(packageName, opts = {}) {
  if (isCatalogReady()) {
    const rec = lookupCatalog(packageName);
    if (rec) return toCandidate(rec, opts);
  }
  return enrich(packageName, opts).catch(() => null);
}

/** Garante o catálogo carregado (usado pelo manager para aquecer). */
export function warmup() {
  return warmCatalog();
}

export default { ID, LABEL, ALLOWED_HOSTS, search, getByPackage, warmup };
