/**
 * Pontuação e escolha do candidato vencedor.
 *
 * O problema que isto resolve: a busca textual de qualquer loja devolve
 * vizinhos (procurar "whatsapp" lista "WhatsApp Business", "WhatsApp Spy";
 * "tiktok" lista "TikTok for Android TV", "TikTok Lite"). Pegar "o primeiro" dá
 * o app errado. A escolha precisa olhar SINAIS OBJETIVOS antes de "quem veio
 * primeiro":
 *
 *   1. o TOKEN do termo bate com o último segmento do package id
 *      ("com.whatsapp" para "whatsapp") — é o app canônico, não um vizinho;
 *   2. o nome COMEÇA com o termo ("WhatsApp Messenger");
 *   3. popularidade (a Aptoide informa os downloads) — o oficial tem ordens de
 *      grandeza mais;
 *   4. APK único, variante (universal > nodpi > mais ABIs), hash/assinatura;
 *   5. canal estável (beta/debug/nightly perdem);
 *   6. prioridade da fonte — só para desempate.
 *
 * A pontuação é INTERNA (seleção técnica); não é mostrada ao usuário.
 */

import { isSingleApk, architectureScore } from './providerUtils.js';

/** Canais instáveis: não são o que o usuário quer por padrão. */
const UNSTABLE = ['beta', 'alpha', 'debug', 'nightly', 'dev', 'canary', 'preview', 'eval', 'test'];
/** Qualificadores de VARIANTE do MESMO app (Lite, Go, TV, Business, Pro...). */
const VARIANTS = ['lite', 'go', 'tv', 'watch', 'business', 'b4b', 'pro', 'plus', 'pad', 'wear', 'androidtv', 'beta'];
/** Ruído claro: app diferente que só menciona o termo. */
const NOISE = ['wallpaper', 'theme', 'launcher', 'icon pack', 'widget', 'sticker', 'simulator', 'keyboard', 'guide', 'tips', 'downloader', 'spy', 'hidden', 'hide', 'clone', 'mod'];

function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').trim();
}

function tokens(s) {
  return norm(s).split(/[^a-z0-9]+/).filter(Boolean);
}

/** Os tokens de `needle` aparecem em sequência em `hay`? */
function subsequence(needle, hay) {
  for (let i = 0; i + needle.length <= hay.length; i++) {
    if (needle.every((t, k) => hay[i + k] === t)) return true;
  }
  return false;
}

/** Sinais derivados do par (consulta, candidato), todos objetivos. */
export function signals(query, candidate) {
  const q = norm(query);
  const name = norm(candidate.name);
  const pkg = norm(candidate.packageName);
  const qTokens = tokens(query);
  const nameTokens = tokens(candidate.name);
  const pkgTokens = tokens(candidate.packageName);

  const pkgLast = pkgTokens.length ? pkgTokens[pkgTokens.length - 1] : '';
  const nameHasQ = nameTokens.includes(q);

  return {
    q,
    exactPkg: pkg === q,
    // O token do termo é um segmento do package (com.whatsapp): sinal FORTE de
    // app canônico. `pkgEndToken` é o caso mais forte (último segmento).
    pkgExactToken: pkgTokens.includes(q),
    pkgEndToken: pkgLast === q,
    nameExact: name === q,
    nameStartsWith: Boolean(nameTokens[0]) && nameTokens[0].startsWith(q),
    nameHasQ,
    nameSubsequence: qTokens.length > 1 && subsequence(qTokens, nameTokens),
    nameSubstring: name.includes(q),
    noise: NOISE.some((w) => name.includes(w)),
    variant: VARIANTS.some((w) => nameTokens.includes(w) || pkgTokens.includes(w)),
    unstable: isUnstable(candidate),
    singleApk: isSingleApk(candidate.type),
    popularity: Number(candidate.popularity || 0),
    hasSigner: Boolean(candidate.signerSha256 || candidate.signerSha1),
  };
}

/** Sinaliza variante/canal instável em nome, versão ou package. */
export function isUnstable(candidate) {
  const hay = `${candidate.name || ''} ${candidate.versionName || ''} ${candidate.packageName || ''}`.toLowerCase();
  return UNSTABLE.some((w) => new RegExp(`(^|[^a-z])${w}([^a-z]|$)`).test(hay));
}

/**
 * É candidato relevante para a consulta? (filtro, não ordenação)
 * Relevante = o termo identifica o app: nome começa/contém o termo, ou o
 * package id traz o termo como token. Ruído evidente fica de fora.
 */
export function isRelevant(query, candidate) {
  const s = signals(query, candidate);
  if (!s.q) return false;
  if (s.noise && !s.exactPkg && !s.nameExact) return false;
  return s.pkgExactToken || s.pkgEndToken || s.exactPkg || s.nameExact || s.nameStartsWith
    || s.nameHasQ || s.nameSubsequence || s.nameSubstring;
}

/** Compatibilidade com o nome antigo. */
export function isStrongMatch(query, candidate) {
  return isRelevant(query, candidate);
}

/**
 * Pontuação total do candidato (para ordenar). Maior = melhor.
 *
 * A base é IDENTIDADE, e a popularidade é o desempate objetivo que separa o app
 * oficial de um sósia com nome parecido (2 bilhões de downloads vs 3 mil). Sem
 * esse desempate, "WhatsApp Spy" ou "Curiosidades WhatsApp" competiriam de
 * igual para igual com o oficial.
 *
 * @param {object} candidate
 * @param {{query?: string, priority?: number}} ctx
 */
export function candidateScore(candidate, ctx = {}) {
  const query = ctx.query || '';
  const s = signals(query, candidate);
  let score = 0;

  // --- identidade ---
  if (s.exactPkg) {
    score += 250;                     // o usuário digitou o package id
  } else if (s.nameStartsWith) {
    score += 100;                     // "WhatsApp Messenger" p/ "whatsapp"
  } else if (s.nameExact) {
    score += 100;
  } else if (s.nameHasQ) {
    score += 40;                      // termo como token no meio do nome
  } else if (s.nameSubsequence) {
    score += 35;
  } else if (s.nameSubstring) {
    score += 20;
  }
  // Package terminando/tendo o termo como token reforça que é o canônico, mas
  // sozinho não basta (um clone pode ter "whatsapp" no meio do package).
  if (!s.exactPkg && s.pkgEndToken) score += 50;
  else if (!s.exactPkg && s.pkgExactToken) score += 30;

  // --- penalidades de "app errado" ---
  if (s.noise) score -= 60;
  // Variante do MESMO app (Lite/Go/TV/Business): válida, mas nunca antes do
  // canal principal quando ele existe.
  if (s.variant && !s.exactPkg) score -= 40;
  if (s.unstable && !s.exactPkg) score -= 30;

  // --- formato e variante ---
  score += s.singleApk ? 40 : -200;   // bundle nunca ganha de APK único
  score += architectureScore(candidate.architecture) / 10;

  // --- integridade verificável na fonte ---
  if (candidate.sha256) score += 12;  // sha256 > md5 (mais forte)
  else if (candidate.md5) score += 8;
  if (s.hasSigner) score += 10;

  // --- popularidade: desempate OBJETIVO entre candidatos de nome parecido ---
  // 2B downloads → +58; 1M → +39; 3k → +22; 100 → +13. Log para não atropelar
  // a identidade, mas forte o bastante para o oficial ganhar do clone.
  if (s.popularity > 0) score += Math.min(60, Math.log10(s.popularity) * 6.5);

  // --- prioridade da fonte: só desempate ---
  if (typeof ctx.priority === 'number') score += Math.max(0, 8 - ctx.priority);

  // --- resultado que a fonte não consegue entregar vai para o fim ---
  if (candidate.downloadable === false) score -= 500;

  return score;
}

/**
 * Ordena candidatos do melhor para o pior.
 * @param {Array<object>} candidates
 * @param {{query?: string, priorityOf?: (source: string) => number}} opts
 */
export function rankCandidates(candidates, opts = {}) {
  const priorityOf = opts.priorityOf || (() => 99);
  return [...candidates]
    .map((c) => ({ candidate: c, score: candidateScore(c, { query: opts.query, priority: priorityOf(c.source) }) }))
    .sort((a, b) => b.score - a.score)
    .map((x) => ({ ...x.candidate, _score: x.score }));
}

/**
 * Melhor APK ÚNICO entre os candidatos relevantes (ignora bundles).
 * Devolve `null` quando só há bundles / nada relevante.
 */
export function pickBestSingleApk(candidates, query) {
  const singles = candidates.filter((c) => isSingleApk(c.type) && c.downloadable !== false && isRelevant(query, c));
  return singles.length ? rankCandidates(singles, { query })[0] : null;
}

/** Há apenas resultados em bundle? (para a mensagem específica) */
export function onlyBundles(candidates, query) {
  const relevant = candidates.filter((c) => isRelevant(query, c));
  return relevant.length > 0 && relevant.every((c) => !isSingleApk(c.type));
}

export default {
  signals,
  isRelevant,
  isStrongMatch,
  isUnstable,
  candidateScore,
  rankCandidates,
  pickBestSingleApk,
  onlyBundles,
};
