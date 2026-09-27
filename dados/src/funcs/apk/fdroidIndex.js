/**
 * Camada de dados do F-Droid para o `!apk`.
 *
 * Fonte: o ÍNDICE OFICIAL assinado do repositório principal.
 *
 *   https://f-droid.org/repo/index-v2.json   (estrutura completa, com hash/tamanho)
 *   https://search.f-droid.org/api/search_apps?q=...  (descoberta por nome)
 *   https://f-droid.org/api/v1/packages/<id> (versões publicadas, por pacote)
 *
 * POR QUE O ÍNDICE, E NÃO A PÁGINA DE BUSCA:
 * a página de busca do F-Droid é HTML e NÃO traz o SHA-256 nem o tamanho de cada
 * APK. O índice v2 traz, por versão: `file.sha256`, `file.size`, `versionCode`,
 * `versionName`, `nativecode` e `manifest.signer.sha256` — ou seja, exatamente o
 * que a validação local precisa para conferir o arquivo baixado. É a "fonte
 * estruturada" em vez de scraping.
 *
 * POR QUE UM SCANNER E NÃO `JSON.parse` DO ÍNDICE INTEIRO:
 * o índice tem ~60 MB e vira ~250 MB de objetos depois de `JSON.parse`. Neste
 * bot, que já vive com centenas de MB, isso é um pico inaceitável. Então o
 * arquivo é lido em streaming e só os CAMPOS NECESSÁRIOS de cada pacote viram
 * objeto — o índice inteiro nunca existe na memória.
 *
 * Módulo sem Baileys. Recebe o `mediaClient`/`apiClient` já existentes.
 */

import { mediaClient, apiClient } from '../../utils/httpClient.js';

const INDEX_URL = 'https://f-droid.org/repo/index-v2.json';
const SEARCH_URL = 'https://search.f-droid.org/api/search_apps';
const PACKAGE_API = 'https://f-droid.org/api/v1/packages';

/** Hosts aceitos para download. Tudo fora disto é recusado (anti-SSRF). */
export const DEFAULT_ALLOWED_HOSTS = Object.freeze([
  'f-droid.org',
  'www.f-droid.org',
]);

/** Teto do índice baixado (o arquivo atual tem ~20 MB gzip / ~60 MB cru). */
export const MAX_INDEX_BYTES = 96 * 1024 * 1024;
/** Quanto tempo o catálogo em memória vale antes de novo download. */
export const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Scanner incremental do índice.
 *
 * Emite o texto BRUTO de cada objeto de pacote em `onPackage(pkgId, rawJson)`
 * para o chamador fazer `JSON.parse` só daquele pedaço. Usa `subarray` em vez de
 * um Buffer por byte: uma passada completa de 60 MB leva centenas de ms.
 */
export class IndexScanner {
  /**
   * @param {(pkgId: string, rawJson: string) => void} onPackage
   * @param {(key: string, rawJson: string) => void} [onTopLevel] recebe objetos
   *   de primeiro nível (ex.: `repo`), para ler endereço/mirrors do repositório.
   */
  constructor(onPackage, onTopLevel = null) {
    this.onPackage = onPackage;
    this.onTopLevel = onTopLevel;
    this.depth = 0;
    this.inString = false;
    this.escape = false;
    this.pendingKey = null;
    this.rootKey = null;
    this.afterColon = false;
    this.strBytes = [];

    this.capturing = false;
    this.capDepth = 0;
    this.capKey = null;
    this.capParts = [];
    this.capStart = 0;
    this.capInString = false;
    this.capEscape = false;
    this.capIsTopLevel = false;
  }

  /** Alimenta um pedaço do JSON. */
  write(chunk) {
    if (this.capturing) this.capStart = 0;

    for (let i = 0; i < chunk.length; i++) {
      const b = chunk[i];
      if (this.capturing) { this._capture(chunk, i); continue; }

      if (this.inString) {
        if (this.escape) { this.escape = false; this.strBytes.push(b); continue; }
        if (b === 0x5c) { this.escape = true; this.strBytes.push(b); continue; }
        if (b === 0x22) {
          this.inString = false;
          this.pendingKey = { value: Buffer.from(this.strBytes).toString('utf8'), depth: this.depthAtStringStart };
          this.strBytes = [];
          this.afterColon = false;
          continue;
        }
        this.strBytes.push(b);
        continue;
      }

      if (b === 0x22) { this.inString = true; this.depthAtStringStart = this.depth; this.strBytes = []; continue; }
      if (b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d) continue;
      if (b === 0x3a) { this.afterColon = true; continue; }
      if (b === 0x7b || b === 0x5b) {
        if (this.afterColon && this.pendingKey && this.depth === 1) {
          this.rootKey = this.pendingKey.value;
          // Objeto de primeiro nível (ex.: `repo`): capturamos para ler o
          // endereço do repositório, que fica fora de `packages`. `packages`
          // NUNCA é capturado inteiro (é o índice todo).
          if (b === 0x7b && this.onTopLevel && this.pendingKey.value !== 'packages') {
            this.capturing = true;
            this.capIsTopLevel = true;
            this.capDepth = 1;
            this.capKey = this.pendingKey.value;
            this.capParts = [];
            this.capStart = i;
            this.capInString = false;
            this.capEscape = false;
            this.pendingKey = null;
            this.afterColon = false;
            this.depth++;
            continue;
          }
        }
        if (
          b === 0x7b &&
          this.afterColon &&
          this.pendingKey &&
          this.pendingKey.depth === 2 &&
          this.rootKey === 'packages'
        ) {
          this.capturing = true;
          this.capIsTopLevel = false;
          this.capDepth = 1;
          this.capKey = this.pendingKey.value;
          this.capParts = [];
          this.capStart = i;
          this.capInString = false;
          this.capEscape = false;
          this.pendingKey = null;
          this.afterColon = false;
          this.depth++;
          continue;
        }
        this.depth++;
        this.pendingKey = null;
        this.afterColon = false;
        continue;
      }
      if (b === 0x7d || b === 0x5d) {
        this.depth--;
        this.pendingKey = null;
        this.afterColon = false;
        continue;
      }
      this.pendingKey = null;
      this.afterColon = false;
    }

    if (this.capturing) {
      this.capParts.push(chunk.subarray(this.capStart));
      this.capStart = chunk.length;
    }
  }

  _capture(chunk, i) {
    const b = chunk[i];
    if (this.capInString) {
      if (this.capEscape) { this.capEscape = false; return; }
      if (b === 0x5c) { this.capEscape = true; return; }
      if (b === 0x22) this.capInString = false;
      return;
    }
    if (b === 0x22) { this.capInString = true; return; }
    if (b === 0x7b || b === 0x5b) { this.capDepth++; return; }
    if (b === 0x7d || b === 0x5d) {
      this.capDepth--;
      if (this.capDepth === 0) {
        this.capParts.push(chunk.subarray(this.capStart, i + 1));
        // Os `{}` deste objeto foram consumidos durante a captura, então
        // restauramos a profundidade estrutural de volta ao nível "packages".
        this.depth--;
        this.capturing = false;
        const raw = Buffer.concat(this.capParts).toString('utf8');
        const key = this.capKey;
        const isTop = this.capIsTopLevel;
        this.capParts = [];
        this.capKey = null;
        this.capInString = false;
        this.capEscape = false;
        this.capIsTopLevel = false;
        if (isTop) this.onTopLevel(key, raw);
        else this.onPackage(key, raw);
      }
    }
  }
}

/** Escolhe o melhor texto de um campo localizado do índice. */
export function localizedText(value, preferred = ['pt-BR', 'pt', 'en-US']) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  for (const lang of preferred) {
    if (value[lang]) return value[lang];
  }
  const first = Object.values(value).find((v) => typeof v === 'string' && v);
  return first || '';
}

/** Versão alvo: a de maior `versionCode` (a "atual") entre as publicadas. */
export function pickLatestVersion(versions) {
  if (!versions || typeof versions !== 'object') return null;
  let best = null;
  for (const v of Object.values(versions)) {
    const code = Number(v?.manifest?.versionCode ?? v?.versionCode ?? -1);
    if (!best || code > best.code) best = { code, version: v };
  }
  return best?.version || null;
}

/**
 * Converte um objeto de pacote do índice no registro enxuto que usamos.
 * `null` quando não há APK publicável (sem `file`).
 */
export function toCatalogRecord(pkgId, pkg) {
  const version = pickLatestVersion(pkg?.versions);
  if (!version?.file?.sha256 || !version.file.name) return null;
  const meta = pkg.metadata || {};
  const signer = version.manifest?.signer?.sha256;
  return {
    packageName: pkgId,
    name: localizedText(meta.name) || pkgId,
    summary: localizedText(meta.summary),
    versionName: version.manifest?.versionName ?? null,
    versionCode: version.manifest?.versionCode ?? null,
    nativecode: version.manifest?.nativecode ?? [],
    file: {
      name: version.file.name,
      size: version.file.size ?? null,
      sha256: version.file.sha256,
    },
    signerSha256: Array.isArray(signer) ? signer[0] : (signer || meta.preferredSigner || null),
  };
}

// ---------------------------------------------------------------------------
// Catálogo em memória (singleton por processo)
// ---------------------------------------------------------------------------

/** @type {{map: Map<string, object>, repoAddress: string, allowedHosts: Set<string>, loadedAt: number, timestamp: number}|null} */
let catalog = null;
let catalogPromise = null;

export function getCatalogLoadedAt() {
  return catalog?.loadedAt ?? 0;
}

export function isCatalogFresh(now = Date.now()) {
  return Boolean(catalog) && (now - catalog.loadedAt) < CATALOG_TTL_MS;
}

/** Exposto para testes: injeta um catálogo sem tocar a rede. */
export function setCatalogForTest(next) {
  catalog = next;
  catalogPromise = null;
}

/**
 * Garante o catálogo carregado. Requisições concorrentes compartilham a MESMA
 * promessa — o índice não é baixado duas vezes ao mesmo tempo.
 *
 * @param {{force?: boolean}} [opts]
 */
export async function ensureCatalog(opts = {}) {
  if (!opts.force && isCatalogFresh()) return catalog;
  if (catalogPromise) return catalogPromise;

  catalogPromise = (async () => {
    const started = Date.now();
    const map = new Map();
    let repoAddress = 'https://f-droid.org/repo';
    let timestamp = 0;
    let bytes = 0;

    const res = await mediaClient.get(INDEX_URL, {
      responseType: 'stream',
      timeout: 120000,
      headers: { Accept: 'application/json' },
      // O índice chega gzip; o axios descomprime o stream.
      decompress: true,
    });

    let mirrors = [];
    const scanner = new IndexScanner(
      (pkgId, raw) => {
        let pkg;
        try {
          pkg = JSON.parse(raw);
        } catch {
          return; // pacote malformado: ignora, não derruba o índice inteiro
        }
        const record = toCatalogRecord(pkgId, pkg);
        if (record) map.set(pkgId, record);
      },
      (key, raw) => {
        if (key !== 'repo') return;
        try {
          const repo = JSON.parse(raw);
          if (repo?.address) repoAddress = repo.address;
          if (repo?.timestamp) timestamp = repo.timestamp;
          if (Array.isArray(repo?.mirrors)) mirrors = repo.mirrors;
        } catch {
          // header do repo ilegível: seguimos com o endereço padrão
        }
      }
    );

    const stream = res.data;
    try {
      for await (const chunk of stream) {
        bytes += chunk.length;
        if (bytes > MAX_INDEX_BYTES) {
          throw new Error(`índice excedeu ${MAX_INDEX_BYTES} bytes`);
        }
        // O header "repo" vem no começo: guardamos o endereço antes dos pacotes.
        scanner.write(chunk);
      }
    } finally {
      stream.destroy?.();
    }

    catalog = {
      map,
      repoAddress,
      allowedHosts: new Set([
        ...DEFAULT_ALLOWED_HOSTS,
        hostOf(repoAddress),
        // Espelhos oficiais listados no próprio índice assinado — é o que
        // permite tolerar um download pelo espelho sem abrir a porta para
        // hosts arbitrários.
        ...mirrors.map(hostOf),
      ].filter(Boolean)),
      loadedAt: Date.now(),
      timestamp,
    };
    console.log(`[APK] catálogo F-Droid carregado: ${map.size} apps em ${Date.now() - started}ms (${(bytes / 1048576).toFixed(1)} MB)`);
    return catalog;
  })();

  try {
    return await catalogPromise;
  } catch (error) {
    catalogPromise = null; // permite tentar de novo
    throw error;
  }
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Busca por NOME no catálogo, com pontuação por FORÇA de identidade.
 *
 * O motor de busca do F-Droid é full-text e devolve vizinhos (buscar "firefox"
 * lista FFUpdater, Joplin...). Então:
 *   1. descobrimos candidatos com a API de busca oficial;
 *   2. pontuamos cada um pelo quanto o termo identifica de fato o app;
 *   3. só devolvemos algo quando há correspondência FORTE (nome/pacote), nunca
 *      um "primeiro resultado" qualquer.
 *
 * @param {string} query
 * @returns {Promise<{ok: boolean, reason?: string, candidates?: object[], matches?: object[]}>}
 */
export async function searchCatalog(query) {
  const q = String(query || '').trim();
  if (!q) return { ok: false, reason: 'APK_QUERY_EMPTY' };

  const cat = await ensureCatalog();
  const apps = await searchAppIndex(q);

  const candidates = [];
  for (const app of apps) {
    const pkgId = packageIdFromUrl(app.url) || app.packageName;
    if (!pkgId) continue;
    const record = cat.map.get(pkgId);
    if (!record) continue; // arquivado / sem APK publicável
    candidates.push({ ...record, score: scoreMatch(q, record) });
  }

  // Caminho direto: usuário digitou o package id ou um sufixo exato dele.
  if (!candidates.length) {
    const direct = cat.map.get(q.toLowerCase()) || cat.map.get(q);
    if (direct) return { ok: true, matches: [direct] };
    return { ok: false, reason: 'APK_NOT_FOUND' };
  }

  candidates.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const top = candidates[0];
  const strong = top.score >= SCORE.NAME_STRONG;

  // Nenhuma correspondência de identidade: o termo só apareceu em descrições de
  // vários apps. NÃO escolhemos "o primeiro" — devolvemos "sem correspondência
  // confiável" com os candidatos, para o usuário refinar (nome exato/package).
  if (!strong) return { ok: false, reason: 'APK_NO_CONFIDENT_MATCH', candidates };

  // Empate forte (duas identidades igualmente plausíveis): não escolhe sozinho.
  const tied = candidates.filter((c) => c.score === top.score);
  if (tied.length > 1) return { ok: false, reason: 'APK_AMBIGUOUS', candidates: tied };

  return { ok: true, matches: [top], candidates };
}

/** Limiares de pontuação — "STRONG" é o mínimo para enviar sem perguntar. */
const SCORE = Object.freeze({ NAME_EXACT: 1000, PKG_EXACT: 900, NAME_STRONG: 600, WEAK: 50 });

/**
 * Pontua um candidato para a consulta.
 *
 * Só o NOME e o PACKAGE ID dão correspondência forte. Descrição/summary são
 * ruído demais: "firefox" bate na descrição de vários apps sem ser o Firefox.
 * Devolvemos valor baixo (WEAK_HIT) quando o termo só aparece no resumo, para
 * não escolher automaticamente.
 */
export function scoreMatch(query, record) {
  const Q = norm(query);
  if (!Q) return 0;
  const N = norm(record.name);
  const P = norm(record.packageName);
  const qt = tokens(query);
  const nt = tokens(record.name);
  const pt = tokens(record.packageName);

  if (N === Q) return SCORE.NAME_EXACT;
  if (P === Q) return SCORE.PKG_EXACT;
  if (pt[pt.length - 1] === Q) return SCORE.PKG_EXACT;
  if (nt[0] === Q) return SCORE.NAME_STRONG;
  for (let i = 0; i + qt.length <= nt.length; i++) {
    if (qt.every((t, k) => nt[i + k] === t)) return SCORE.NAME_STRONG;
  }
  if (pt.includes(Q)) return SCORE.NAME_STRONG;
  if (tokens(record.summary).includes(Q)) return SCORE.WEAK;
  return SCORE.WEAK;
}

/** Sinaliza se um resultado é forte o bastante para envio automático. */
export function isStrongMatch(record, query) {
  return scoreMatch(query, record) >= SCORE.NAME_STRONG;
}

function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').trim();
}

function tokens(s) {
  return norm(s).split(/[^a-z0-9]+/).filter(Boolean);
}

/** Id do pacote a partir da URL de app devolvida pela busca do F-Droid. */
export function packageIdFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const marker = '/packages/';
  const idx = url.indexOf(marker);
  if (idx >= 0) return url.slice(idx + marker.length).split(/[/?#]/)[0] || null;
  return null;
}

/** Descoberta de candidatos pelo endpoint oficial de busca. */
export async function searchAppIndex(query) {
  const res = await apiClient.get(SEARCH_URL, {
    params: { q: query },
    timeout: 30000,
  });
  const apps = Array.isArray(res.data?.apps) ? res.data.apps : [];
  return apps;
}

/** Versões publicadas de um pacote (API v1) — usada só para diagnóstico. */
export async function fetchPackageVersions(packageName) {
  const res = await apiClient.get(`${PACKAGE_API}/${encodeURIComponent(packageName)}`, { timeout: 30000 });
  return res.data;
}

/**
 * Monta a URL do APK a partir do endereço do repositório do índice.
 * NUNCA aceita URL vinda do usuário.
 */
export function buildApkUrl(record, repoAddress = catalog?.repoAddress || 'https://f-droid.org/repo') {
  const name = String(record?.file?.name || '');
  if (!name.startsWith('/') || name.includes('..')) return null;
  return `${repoAddress.replace(/\/+$/, '')}${name}`;
}

/** Recusa qualquer destino fora dos hosts conhecidos do F-Droid (anti-SSRF). */
export function assertAllowedUrl(url, allowedHosts = catalog?.allowedHosts || new Set(DEFAULT_ALLOWED_HOSTS), opts = {}) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'APK_URL_INVALID' };
  }
  // Só HTTPS. `allowInsecure` existe PARA TESTES (servidor local) e nunca é
  // ligado pelo comando — o `assertAllowedUrl` do caminho de produção usa o
  // padrão (false).
  if (parsed.protocol !== 'https:' && !(opts.allowInsecure && parsed.protocol === 'http:')) {
    return { ok: false, reason: 'APK_URL_INSECURE' };
  }
  if (!allowedHosts.has(parsed.hostname)) return { ok: false, reason: 'APK_URL_HOST_NOT_ALLOWED' };
  return { ok: true };
}

export default {
  MAX_INDEX_BYTES,
  CATALOG_TTL_MS,
  DEFAULT_ALLOWED_HOSTS,
  IndexScanner,
  ensureCatalog,
  isCatalogFresh,
  setCatalogForTest,
  searchCatalog,
  searchAppIndex,
  fetchPackageVersions,
  buildApkUrl,
  assertAllowedUrl,
  packageIdFromUrl,
  scoreMatch,
  isStrongMatch,
  localizedText,
  pickLatestVersion,
  toCatalogRecord,
};
