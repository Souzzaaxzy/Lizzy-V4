/**
 * Provider Aptoide.
 *
 * Método: **API pública oficial** — `https://ws75.aptoide.com/api/7/...`
 * (a mesma que o site e os apps da Aptoide usam). Nada de scraping: é JSON
 * estruturado.
 *
 * Por que este provider existe no lugar do APKMirror/APKPure: aqueles dois
 * estão atrás do desafio Cloudflare (HTTP 403 "Just a moment...") e o APKPure
 * ainda publica `Disallow: /` no robots.txt do host de download e proíbe
 * automação nos termos. Contornar isso é proibido pela tarefa — então eles
 * ficam indisponíveis (ver `apkmirrorProvider.js`/`apkpureProvider.js`) e a
 * segunda fonte funcional é a Aptoide, que tem API oficial e devolve
 * package/versão/tamanho/md5/assinatura (SHA-1 do certificado)/URL direta.
 *
 * Endpoints usados (somente leitura, um por consulta):
 *   - busca:   /api/7/apps/search?query=<q>&limit=<n>
 *   - detalhe: /api/7/app/getMeta?package_name=<pkg>
 */

import { providerRequest, normalizeCandidate, providerError, APK_TYPE, PROVIDER_LABELS, parseArchitecture } from './providerUtils.js';

export const ID = 'aptoide';
export const LABEL = PROVIDER_LABELS.aptoide;
export const ALLOWED_HOSTS = Object.freeze([
  'ws75.aptoide.com',
  'pool.apk.aptoide.com',
]);

const API_BASE = 'https://ws75.aptoide.com/api/7';
const SEARCH_LIMIT = 10;

/** Busca por nome/package na API oficial. */
export async function search(query, opts = {}) {
  const q = String(query || '').trim();
  if (!q) return { ok: false, reason: 'APK_QUERY_EMPTY', provider: ID, candidates: [] };

  let payload;
  try {
    const url = `${API_BASE}/apps/search?query=${encodeURIComponent(q)}&limit=${SEARCH_LIMIT}`;
    const res = await providerRequest(url, { asJson: true, timeoutMs: opts.timeoutMs });
    payload = res.data;
  } catch (error) {
    const isAbort = error?.code === 'ERR_CANCELED' || error?.name === 'CanceledError' || /aborted|timeout/i.test(String(error?.message));
    throw providerError(ID, isAbort ? 'TIMEOUT' : 'SEARCH_ERROR', { cause: error?.message });
  }

  const list = payload?.datalist?.list;
  if (!Array.isArray(list)) {
    throw providerError(ID, 'INVALID_RESULT', { got: typeof list });
  }

  const candidates = list
    .map((app) => toCandidate(app, opts))
    .filter((c) => c.name && c.packageName);

  return { ok: true, provider: ID, candidates };
}

/** Converte um item da API no candidato comum. */
export function toCandidate(app, opts = {}) {
  const file = app.file || {};
  const path = file.path || file.path_alt || null;
  const type = path ? (String(path).toLowerCase().endsWith('.apk') ? APK_TYPE.APK : APK_TYPE.UNKNOWN) : APK_TYPE.UNKNOWN;
  const hostOk = path ? hostAllowed(path, opts.allowedHosts) : false;
  const sig = file.signature || {};
  return normalizeCandidate({
    source: ID,
    name: app.name,
    packageName: app.package,
    versionName: file.vername ?? null,
    versionCode: file.vercode ?? null,
    type,
    size: file.filesize ?? app.size ?? null,
    downloadUrl: hostOk ? path : null,
    pageUrl: app.package ? `https://en.aptoide.com/app/${encodeURIComponent(app.package)}` : null,
    md5: file.md5sum ?? null,
    // A Aptoide publica SHA-1 do certificado (não SHA-256).
    signerSha1: sig.sha1 ?? null,
    architecture: parseArchitecture(file.tags?.join(' ') || '') || 'universal',
    downloadable: hostOk && type === APK_TYPE.APK,
  });
}

/** O host da URL de download é da Aptoide? (anti-SSRF) */
function hostAllowed(url, allowedHosts) {
  try {
    const h = new URL(url).hostname;
    const set = allowedHosts || new Set(ALLOWED_HOSTS);
    return set.has(h);
  } catch {
    return false;
  }
}

export default { ID, LABEL, ALLOWED_HOSTS, search };
