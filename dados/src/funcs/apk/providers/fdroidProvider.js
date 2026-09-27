/**
 * Provider F-Droid.
 *
 * Fonte: índice oficial assinado (`https://f-droid.org/repo/index-v2.json`).
 * É a fonte com METADADOS ESTRUTURADOS: por versão traz `file.sha256`,
 * `file.size`, `versionCode/versionName` e `manifest.signer.sha256` — então é a
 * única em que dá para validar hash E assinatura contra a própria fonte.
 *
 * A lógica de catálogo/busca vive em `../fdroidIndex.js` (scanner streaming do
 * índice, ~60 MB, sem carregar tudo na memória). Este arquivo só a adapta à
 * interface comum de provider.
 */

import { searchCatalog, buildApkUrl, assertAllowedUrl, ensureCatalog } from '../fdroidIndex.js';
import { normalizeCandidate, providerError, APK_TYPE, PROVIDER_LABELS } from './providerUtils.js';

export const ID = 'fdroid';
export const LABEL = PROVIDER_LABELS.fdroid;
export const ALLOWED_HOSTS = Object.freeze(['f-droid.org', 'www.f-droid.org']);

/** F-Droid sempre entrega APK único (o índice só publica `.apk`). */
export function search(query, opts = {}) {
  return searchCatalog(query).then((result) => {
    if (!result.ok) {
      return { ok: false, reason: result.reason, candidates: filterFound(result.candidates || []), provider: ID };
    }
    const candidates = result.matches.map((record) => toCandidate(record, opts));
    return { ok: true, candidates, provider: ID };
  }).catch((error) => {
    throw providerError(ID, 'SEARCH_ERROR', { cause: error?.message });
  });
}

/** Converte o registro do catálogo no candidato comum. */
export function toCandidate(record, opts = {}) {
  const url = buildApkUrl(record, opts.repoAddress);
  const allowed = url ? assertAllowedUrl(url, opts.allowedHosts) : { ok: false };
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

/** Apenas os candidatos que o provider realmente consegue entregar. */
function filterFound(candidates) {
  return candidates.map((c) => normalizeCandidate({
    source: ID,
    name: c.name,
    packageName: c.packageName,
    versionName: c.versionName,
    versionCode: c.versionCode,
    type: APK_TYPE.APK,
    size: c.file?.size ?? null,
    pageUrl: `https://f-droid.org/packages/${c.packageName}/`,
    downloadable: false,
  }));
}

/** Garante o catálogo carregado (chamado pelo manager antes da busca paralela). */
export function warmup() {
  return ensureCatalog();
}

export default { ID, LABEL, ALLOWED_HOSTS, search, warmup };
