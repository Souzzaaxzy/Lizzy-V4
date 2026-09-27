/**
 * Detecção de bloqueio/rejeição nas fontes que NÃO têm API pública.
 *
 * APKMirror, APKCombo e APKPure ficam atrás de proteção (Cloudflare / desafio
 * JS). A tarefa proíbe explicitamente contornar isso, e os termos do APKPure
 * proíbem automação com carga acima de uso humano. Então estes providers fazem
 * uma requisição NORMAL (sem técnicas evasivas) e, ao encontrar bloqueio,
 * devolvem "indisponível" em vez de tentar burlar.
 *
 * Este módulo só classifica a resposta. Não implementa bypass.
 */

/** Marcadores de desafio Cloudflare / interstício JS. */
const CHALLENGE_MARKERS = [
  'just a moment',
  'cf-mitigated',
  'cf-chl-',
  'challenge-platform',
  'enable javascript and cookies to continue',
  'attention required! | cloudflare',
  'cf-browser-verification',
];

/**
 * A resposta é uma página de bloqueio/desafio (não conteúdo real)?
 * @param {{status: number, data: any, headers?: object}} res
 */
export function isBlockedResponse(res) {
  if (!res) return false;
  if (res.status === 403 || res.status === 429 || res.status === 503) return true;
  const text = typeof res.data === 'string' ? res.data.slice(0, 4000).toLowerCase() : '';
  if (!text) return false;
  return CHALLENGE_MARKERS.some((m) => text.includes(m));
}

/**
 * O robots.txt proíbe o caminho? (verificação simples, por prefixo/segmento)
 * @param {string} robots texto do robots.txt
 * @param {string} path caminho a testar (ex.: "/r2")
 * @param {string} [userAgent]
 */
export function robotsDisallows(robots, path, userAgent = '*') {
  if (!robots || typeof robots !== 'string') return false;
  const blocks = [];
  let currentAgents = [];
  let capture = false;
  for (const rawLine of robots.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const [rawKey, ...rest] = line.split(':');
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(':').trim();
    if (key === 'user-agent') {
      currentAgents = [value.toLowerCase()];
      capture = value === '*' || value.toLowerCase() === userAgent.toLowerCase();
    } else if (key === 'disallow' && capture) {
      if (value) blocks.push(value);
    }
  }
  const p = path.startsWith('/') ? path : `/${path}`;
  return blocks.some((rule) => {
    if (rule === '/') return true;
    // Converte o padrão do robots (com `*` e `$`) para regex simples.
    const pattern = rule.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$');
    try {
      return new RegExp(pattern).test(p);
    } catch {
      return p.startsWith(rule);
    }
  });
}

export default { isBlockedResponse, robotsDisallows };
