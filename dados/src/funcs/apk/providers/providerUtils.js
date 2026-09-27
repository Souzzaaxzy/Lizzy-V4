/**
 * Peças comuns dos providers de APK — normalização de candidato, limites de
 * requisição e checagem de tipo/variante.
 *
 * Cada provider devolve CANDIDATOS no mesmo formato; o APKManager (apkService)
 * é quem compara, pontua e decide. O provider NUNCA baixa: quem baixa é o
 * downloader central, a partir de `downloadUrl`, com o host já validado.
 *
 * Módulo sem Baileys e sem socket; as requisições usam o `httpClient.js`
 * existente ou `fetch` (Node ≥ 20).
 */

import { apiClient, mediaClient, scrapingClient } from '../../../utils/httpClient.js';

/** Timeout próprio de cada requisição de provider. */
export const PROVIDER_TIMEOUT_MS = Number(process.env.APK_PROVIDER_TIMEOUT_MS) || 10000;
/** Teto de bytes de uma resposta de provider (HTML/JSON). */
export const MAX_PROVIDER_RESPONSE_BYTES = Number(process.env.APK_PROVIDER_MAX_BYTES) || 4 * 1024 * 1024;

/** Tipos de pacote. Só APK ÚNICO passa; bundles são rejeitados. */
export const APK_TYPE = Object.freeze({ APK: 'apk', XAPK: 'xapk', APKS: 'apks', APKM: 'apkm', AAB: 'aab', UNKNOWN: 'unknown' });

/** Nome amigável do provider para a legenda/log. */
export const PROVIDER_LABELS = Object.freeze({
  apkmirror: 'APKMirror',
  apkcombo: 'APKCombo',
  apkpure: 'APKPure',
  fdroid: 'F-Droid',
  aptoide: 'Aptoide',
});

/**
 * Classifica o tipo do arquivo pela URL/nome.
 * `.apk` => apk; `.xapk/.apks/.apkm/.aab` => bundle correspondente.
 */
export function classifyType(urlOrName) {
  const s = String(urlOrName || '').toLowerCase().split('?')[0];
  if (s.endsWith('.apk')) return APK_TYPE.APK;
  if (s.endsWith('.xapk')) return APK_TYPE.XAPK;
  if (s.endsWith('.apks')) return APK_TYPE.APKS;
  if (s.endsWith('.apkm')) return APK_TYPE.APKM;
  if (s.endsWith('.aab')) return APK_TYPE.AAB;
  return APK_TYPE.UNKNOWN;
}

/** Um tipo é instalável como APK único? */
export function isSingleApk(type) {
  return type === APK_TYPE.APK;
}

/**
 * Extrai a arquitetura (variante) de um texto: "universal", uma lista de ABIs
 * ("arm64-v8a, armeabi-v7a"...) ou "nodpi". `null` quando não há sinal.
 */
export function parseArchitecture(text) {
  const t = String(text || '').toLowerCase();
  if (!t) return null;
  if (t.includes('universal')) return 'universal';
  const abis = ['arm64-v8a', 'armeabi-v7a', 'armeabi', 'x86_64', 'x86', 'mips'];
  const found = abis.filter((a) => t.includes(a));
  if (found.length) return found.join(', ');
  if (t.includes('nodpi')) return 'nodpi';
  return null;
}

/**
 * Pontua a variante para desempate, na ordem pedida:
 * universal > nodpi > mais arquiteturas > sem restrição. Maior = melhor.
 */
export function architectureScore(architecture) {
  if (!architecture) return 0;
  const a = String(architecture).toLowerCase();
  if (a === 'universal') return 100;
  const abis = a.split(',').map((s) => s.trim()).filter(Boolean);
  if (abis.includes('nodpi')) return 80;
  return 10 + Math.min(abis.length, 6) * 10;
}

/**
 * Normaliza um resultado de provider. Todo campo é opcional exceto
 * `source`/`name`; a validação real acontece depois, no arquivo baixado.
 */
export function normalizeCandidate(raw = {}) {
  const source = String(raw.source || '').toLowerCase();
  const downloadUrl = raw.downloadUrl || null;
  const type = raw.type || classifyType(downloadUrl || raw.pageUrl || raw.name);
  return {
    source,
    sourceLabel: PROVIDER_LABELS[source] || source,
    name: raw.name || null,
    packageName: raw.packageName || null,
    versionName: raw.versionName || null,
    versionCode: raw.versionCode != null ? Number(raw.versionCode) : null,
    type,
    size: raw.size != null ? Number(raw.size) : null,
    downloadUrl,
    pageUrl: raw.pageUrl || null,
    sha256: raw.sha256 || null,
    md5: raw.md5 || null,
    signerSha256: raw.signerSha256 || null,
    signerSha1: raw.signerSha1 || null,
    architecture: parseArchitecture(raw.architecture) || null,
    minAndroid: raw.minAndroid || null,
    // Sinais objetivos de "qual é o app oficial" (só desempate técnico).
    popularity: raw.popularity != null ? Number(raw.popularity) : null,
    developer: raw.developer || null,
    // `downloadable: false` marca resultado que não tem APK único pela fonte.
    downloadable: raw.downloadable !== false && Boolean(downloadUrl),
  };
}

/** Erro de provider com código estável (ex.: APK_MIRROR_TIMEOUT). */
export class ProviderError extends Error {
  constructor(code, message, details = {}) {
    super(message || code);
    this.name = 'ProviderError';
    this.code = code;
    this.details = details;
  }
}

/** Código de erro por provider+motivo (ex.: apkmirror + TIMEOUT). */
export function providerError(providerId, reason, details) {
  const prefix = String(providerId).toUpperCase().replace(/[^A-Z0-9]/g, '_');
  return new ProviderError(`APK_${prefix}_${reason}`, `${providerId}: ${reason}`, details);
}

/**
 * GET/HEAD com timeout, teto de bytes e cancelamento.
 *
 * @param {string} url
 * @param {{timeoutMs?: number, asJson?: boolean, html?: boolean, headers?: object, method?: string}} [opts]
 */
export async function providerRequest(url, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? PROVIDER_TIMEOUT_MS;
  // Cada tipo de resposta tem seu cliente já existente: JSON (apiClient),
  // HTML de scraping (scrapingClient) e binário (mediaClient). O mediaClient é
  // arraybuffer, então JSON NUNCA deve passar por ele.
  const client = opts.asJson ? apiClient : (opts.html ? scrapingClient : mediaClient);
  const method = String(opts.method || 'get').toLowerCase();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await client[method](url, {
      timeout: timeoutMs,
      signal: controller.signal,
      maxContentLength: MAX_PROVIDER_RESPONSE_BYTES,
      headers: { Accept: opts.asJson ? 'application/json' : 'text/html,*/*', ...(opts.headers || {}) },
      validateStatus: (s) => s >= 200 && s < 400,
    });
    let data = res.data;
    // apiClient normalmente já entrega JSON; se vier Buffer/string (proxy com
    // content-type errado), decodificamos aqui para o provider não tratar isso.
    if (opts.asJson && (Buffer.isBuffer(data) || typeof data === 'string')) {
      try { data = JSON.parse(Buffer.isBuffer(data) ? data.toString('utf8') : data); } catch { /* mantém original */ }
    }
    const finalUrl = res.request?.res?.responseUrl || res.config?.url || url;
    return { status: res.status, data, finalUrl };
  } finally {
    clearTimeout(timer);
  }
}

/** Texto localizado (Aptoide usa string; F-Droid usa mapa de idiomas). */
export function localizedText(value, preferred = ['pt-BR', 'pt', 'en-US']) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  for (const lang of preferred) if (value[lang]) return value[lang];
  return Object.values(value).find((v) => typeof v === 'string' && v) || '';
}

export default {
  PROVIDER_TIMEOUT_MS,
  MAX_PROVIDER_RESPONSE_BYTES,
  APK_TYPE,
  PROVIDER_LABELS,
  ProviderError,
  providerError,
  providerRequest,
  normalizeCandidate,
  classifyType,
  isSingleApk,
  parseArchitecture,
  architectureScore,
  localizedText,
};
