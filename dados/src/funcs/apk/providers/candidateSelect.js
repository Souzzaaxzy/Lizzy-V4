/**
 * Pontuação e escolha do candidato vencedor.
 *
 * Regras (nada de "primeiro que apareceu"):
 *   - correspondência FORTE de nome ou package é obrigatória;
 *   - APK único > bundle (bundle só é aceito se nada mais existir);
 *   - variante: universal > nodpi > mais arquiteturas;
 *   - integridade disponível na fonte (hash/assinatura) soma;
 *   - prioridade da fonte só desempata.
 *
 * A pontuação é INTERNA (seleção técnica); não é mostrada ao usuário.
 */

import { isSingleApk, architectureScore } from './providerUtils.js';

/**
 * Correspondência entre a consulta e o candidato (0..1).
 *
 * O package entra na conta: um app chamado "NewPipe" de package
 * `org.musicdownloader.mytube` é um clone, enquanto `org.schabi.newpipe` casa o
 * termo também no package — isso separa o oficial do sósia, o que a tarefa
 * exige ("não selecionar apenas porque o nome contém a palavra").
 */
export function matchScore(query, candidate) {
  const q = norm(query);
  if (!q) return 0;
  const name = norm(candidate.name);
  const pkg = norm(candidate.packageName);

  const qTokens = tokens(query);
  const nameTokens = tokens(candidate.name);
  const pkgTokens = tokens(candidate.packageName);
  const pkgHasQ = pkgTokens.includes(q) || pkgTokens[pkgTokens.length - 1] === q;
  const nameHasQ = nameTokens.includes(q) || (nameTokens[0] === q);

  // Package id exato digitado pelo usuário: identidade máxima.
  if (pkg && pkg === q) return 1;
  // Nome exato E package relacionado ao termo: identidade máxima.
  if (name === q && pkgHasQ) return 1;
  // Nome exato, package sem relação: ainda é bom, mas não é prova do oficial.
  if (name === q) return 0.9;
  // Package contém o termo (sinal forte de que é o app canônico).
  if (pkgHasQ) return 0.85;
  // O nome COMEÇA com o termo: "spotify" -> "Spotify: Music and Podcasts".
  if (nameTokens[0] === q) return 0.8;
  // Tokens da consulta em sequência no nome.
  if (qTokens.length && nameHasQ && subsequence(qTokens, nameTokens)) return 0.78;
  // Termo como token isolado no nome.
  if (nameTokens.includes(q)) return 0.7;
  // Substring no nome (termo colado).
  if (name.includes(q)) return 0.5;
  return 0;
}

/** Canais instáveis: não são o que o usuário quer por padrão. */
const UNSTABLE = ['beta', 'alpha', 'debug', 'nightly', 'dev', 'canary', 'test', 'rc'];

/** Sinaliza variante/canal instável em nome, versão ou package. */
export function isUnstable(candidate) {
  const hay = `${candidate.name || ''} ${candidate.versionName || ''} ${candidate.packageName || ''}`.toLowerCase();
  return UNSTABLE.some((w) => new RegExp(`(^|[^a-z])${w}([^a-z]|$)`).test(hay));
}

/** Correspondência suficiente para considerar o candidato? */
export function isStrongMatch(query, candidate) {
  return matchScore(query, candidate) >= 0.7;
}

/**
 * Pontuação total do candidato (para ordenar).
 * @param {object} candidate
 * @param {{priority?: number, query?: string}} ctx
 */
export function candidateScore(candidate, ctx = {}) {
  let score = 0;

  score += matchScore(ctx.query || '', candidate) * 100;

  // Formato: APK único vale muito; bundle é último recurso.
  score += isSingleApk(candidate.type) ? 40 : -30;

  // Variante.
  score += architectureScore(candidate.architecture) / 10;

  // Integridade verificável na fonte.
  if (candidate.sha256) score += 12;
  if (candidate.md5) score += 8;
  if (candidate.signerSha256 || candidate.signerSha1) score += 10;

  // Tamanho informado ajuda (permite checar o limite antes de baixar).
  if (candidate.size) score += 3;

  // Canal instável (beta/debug/nightly) perde para o estável.
  if (isUnstable(candidate)) score -= 25;

  // O package refletir o termo é um bom sinal do app canônico.
  const q = norm(ctx.query || '');
  const pkgTokens = tokens(candidate.packageName);
  if (q && (pkgTokens.includes(q) || pkgTokens[pkgTokens.length - 1] === q)) score += 15;

  // Desempate por prioridade da fonte (menor índice = maior prioridade).
  if (typeof ctx.priority === 'number') score += Math.max(0, 10 - ctx.priority);

  // Um candidato que a fonte não consegue entregar fica por último.
  if (candidate.downloadable === false) score -= 100;

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
 * Melhor APK ÚNICO entre os candidatos (ignora bundles).
 * Devolve `null` quando só há bundles/sem correspondência.
 */
export function pickBestSingleApk(candidates, query) {
  const singles = candidates.filter((c) => isSingleApk(c.type) && c.downloadable !== false && isStrongMatch(query, c));
  return singles.length ? rankCandidates(singles, { query })[0] : null;
}

/** Há apenas resultados em bundle? (para a mensagem específica) */
export function onlyBundles(candidates, query) {
  const relevant = candidates.filter((c) => isStrongMatch(query, c));
  return relevant.length > 0 && relevant.every((c) => !isSingleApk(c.type));
}

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

export default {
  matchScore,
  isStrongMatch,
  candidateScore,
  rankCandidates,
  pickBestSingleApk,
  onlyBundles,
};
