/**
 * Descoberta da URL pública HTTPS do host.
 *
 * Por que existe: o adaptador do AntiFantasma (que roda na bot do usuário)
 * precisa de uma URL absoluta para falar com a API. Exigir que o administrador
 * descubra e digite essa URL à mão é uma fonte de erro — a maioria das
 * plataformas já expõe o próprio domínio numa variável de ambiente.
 *
 * A função é pura em relação ao ambiente: recebe um objeto de variáveis e
 * devolve a URL. Isso permite testar cada plataforma sem mexer no processo.
 *
 * Nada aqui é específico do AntiFantasma: serve para qualquer endpoint público
 * do bot.
 */

/**
 * Mapeamento PORTA → URL neste tipo de runtime.
 *
 * Medido neste ambiente: as variáveis `WORKER_1=12000` e `WORKER_2=12001` são
 * portas publicadas, e cada uma responde num subdomínio próprio:
 *
 *   12000 -> https://work-1-<host>
 *   12001 -> https://work-2-<host>
 *
 * Comprovado por teste: subir um servidor na 12000 e chamar
 * `https://work-1-<host>/` devolveu 200; derrubando o servidor, voltou 502.
 * Portas fora dessa lista NÃO têm subdomínio — nelas a única URL possível é a
 * base do runtime (sem mapeamento de porta).
 *
 * É por isso que a detecção precisa saber a PORTA: sem ela, uma API ouvindo na
 * 12001 seria anunciada com a URL da 12000, e o adaptador do usuário falaria
 * com o serviço errado.
 */
const WORKER_PORTS = ['WORKER_1', 'WORKER_2'];

/**
 * Lista as portas publicadas com subdomínio próprio, na ordem em que devem ser
 * tentadas.
 *
 * @param {object} [env]
 * @returns {number[]} ex.: `[12000, 12001]`
 */
export function portasPublicadas(env = process.env) {
  if (!env || typeof env !== 'object') return [];
  const out = [];
  for (const nome of WORKER_PORTS) {
    const n = Number(env[nome]);
    if (Number.isFinite(n) && n > 0 && !out.includes(n)) out.push(n);
  }
  return out;
}

/**
 * Variáveis que trazem o domínio/site de cada plataforma, na ordem em que são
 * consultadas. `montar` recebe o valor da variável e devolve a URL completa.
 *
 * A ordem importa pouco (cada plataforma define as suas), mas a primeira que
 * existir vence — daí a mais específica vir antes da genérica.
 */
const FONTES = [
  // Override explícito do administrador — sempre ganha.
  { nome: 'ANTIFANTASMA_PUBLIC_URL', montar: (v) => v },
  { nome: 'PUBLIC_URL', montar: (v) => v },
  // OpenHands runtime (este ambiente): já vem com esquema.
  { nome: 'RUNTIME_URL', montar: (v) => v },
  // Render: já vem com esquema.
  { nome: 'RENDER_EXTERNAL_URL', montar: (v) => v },
  // Railway: só o domínio.
  { nome: 'RAILWAY_PUBLIC_DOMAIN', montar: (v) => `https://${v}` },
  { nome: 'RAILWAY_STATIC_URL', montar: (v) => (v.startsWith('http') ? v : `https://${v}`) },
  // Vercel: só o domínio.
  { nome: 'VERCEL_URL', montar: (v) => `https://${v}` },
  // Koyeb: domínio.
  { nome: 'KOYEB_PUBLIC_DOMAIN', montar: (v) => `https://${v}` },
  // Fly.io: nome do app.
  { nome: 'FLY_APP_NAME', montar: (v) => `https://${v}.fly.dev` },
  // Heroku: nome do app.
  { nome: 'HEROKU_APP_NAME', montar: (v) => `https://${v}.herokuapp.com` },
  // Azure App Service: hostname sem esquema.
  { nome: 'WEBSITE_HOSTNAME', montar: (v) => `https://${v}` },
  // GitHub Codespaces.
  {
    nome: 'CODESPACE_NAME',
    montar: (v, env) => {
      const dom = env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN;
      return dom ? `https://${v}-${env.PORT || 3000}.${dom}` : null;
    },
  },
  // Genéricos por último.
  { nome: 'PUBLIC_HOSTNAME', montar: (v) => (v.startsWith('http') ? v : `https://${v}`) },
  { nome: 'DOMAIN', montar: (v) => (v.startsWith('http') ? v : `https://${v}`) },
];

/** Normaliza para `https://host` sem barra no fim. `null` quando inválido. */
function normalizar(valor) {
  if (typeof valor !== 'string' || !valor.trim()) return null;
  let bruto = valor.trim();

  // Remove barra final para não gerar `//` ao concatenar caminhos.
  bruto = bruto.replace(/\/+$/, '');

  // Sem esquema: assume https (nunca http — a KEY não deve trafegar insegura).
  if (!/^https?:\/\//i.test(bruto)) return `https://${bruto}`;

  // http:// só é aceito em localhost (desenvolvimento).
  if (/^http:\/\//i.test(bruto)) {
    const host = bruto.slice('http://'.length);
    const ehLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?/i.test(host);
    return ehLocal ? bruto : bruto.replace(/^http:/i, 'https:');
  }

  return bruto;
}

/** Host base do runtime, sem esquema (ex.: `abc.prod-runtime.all-hands.dev`). */
function hostDoRuntime(env) {
  // 1) O caminho direto: `RUNTIME_URL` já traz o host completo.
  const bruto = env?.RUNTIME_URL;
  if (typeof bruto === 'string' && bruto.trim()) {
    const semEsquema = bruto.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    if (semEsquema) return semEsquema;
  }

  // 2) Fallback por `RUNTIME_ID`: em alguns lançamentos do runtime a
  //    `RUNTIME_URL` não vem, mas o `RUNTIME_ID` sim. O domínio segue um padrão
  //    fixo da plataforma, então dá para reconstruí-lo.
  const id = env?.RUNTIME_ID;
  if (typeof id === 'string' && /^[a-z0-9-]+$/i.test(id.trim())) {
    return `${id.trim()}.prod-runtime.all-hands.dev`;
  }

  // 3) Último recurso: o próprio `HOSTNAME` do container costuma ser
  //    `runtime-<id>-<hash>-<sufixo>`. Extraindo o `<id>`, chegamos ao mesmo
  //    domínio. Verificado neste ambiente: `HOSTNAME` e `RUNTIME_URL` apontam
  //    para o mesmo id.
  const hostname = env?.HOSTNAME;
  if (typeof hostname === 'string') {
    const m = /^runtime-([a-z0-9]+)-/i.exec(hostname.trim());
    if (m) return `${m[1]}.prod-runtime.all-hands.dev`;
  }

  return null;
}

/**
 * Monta a URL pública do runtime para uma PORTA específica.
 *
 * Se a porta está na lista de portas publicadas, devolve o subdomínio dela
 * (`https://work-N-<host>`). Caso contrário devolve a URL base do runtime — que
 * é o único endereço válido para portas sem mapeamento.
 *
 * @returns {string|null}
 */
function urlDoRuntimeParaPorta(env, porta) {
  // Usa o host derivado (RUNTIME_URL, RUNTIME_ID ou HOSTNAME) — não só a
  // `RUNTIME_URL`, senão o fallback não teria efeito.
  const host = hostDoRuntime(env);
  if (!host) return null;

  const n = Number(porta);
  if (!Number.isFinite(n) || n <= 0) return `https://${host}`;

  const publicadas = portasPublicadas(env);
  const idx = publicadas.indexOf(n);
  if (idx < 0) return `https://${host}`;

  return `https://work-${idx + 1}-${host}`;
}

/**
 * Descobre a URL pública HTTPS do host.
 *
 * @param {object} [env] variáveis de ambiente (padrão: `process.env`)
 * @param {{porta?: number}} [opts] porta da API, quando já se sabe qual é. Com
 *   ela, o retorno respeita o mapeamento porta→subdomínio deste runtime.
 * @returns {string|null} ex.: `https://work-1-meu-host.dev`, ou `null` se
 *   nenhuma plataforma conhecida definir o domínio (aí o administrador usa
 *   `ANTIFANTASMA_PUBLIC_URL`).
 */
export function detectarUrlPublica(env = process.env, opts = {}) {
  if (!env || typeof env !== 'object') return null;

  // Override do administrador tem precedência absoluta (e ignora a porta).
  for (const nome of ['ANTIFANTASMA_PUBLIC_URL', 'PUBLIC_URL']) {
    const normalizada = normalizar(env[nome]);
    if (normalizada) return normalizada;
  }

  // Neste runtime a URL depende da PORTA: `work-1`/`work-2` são subdomínios
  // distintos. Resolver isso antes das outras fontes evita anunciar a porta
  // errada. O host vem de `RUNTIME_URL`, `RUNTIME_ID` ou `HOSTNAME` (fallbacks).
  const porta = opts.porta ?? portaConfigurada(env);
  const doRuntime = urlDoRuntimeParaPorta(env, porta);
  if (doRuntime) return doRuntime;

  for (const fonte of FONTES) {
    const valor = env[fonte.nome];
    if (!valor) continue;
    let montada;
    try {
      montada = fonte.montar(String(valor), env);
    } catch {
      montada = null;
    }
    const normalizada = normalizar(montada);
    if (normalizada) return normalizada;
  }

  return null;
}

/** Porta em que a API deve ouvir. `0` quando não configurada. */
export function portaConfigurada(env = process.env) {
  const n = Number(env?.ANTIFANTASMA_PORT);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Endpoint completo de execução do AntiFantasma.
 *
 * @param {object} [env]
 * @param {{porta?: number}} [opts]
 * @returns {string|null} ex.: `https://host/api/antifantasma/exec`
 */
export function endpointAntiFantasma(env = process.env, opts = {}) {
  const base = detectarUrlPublica(env, opts);
  return base ? `${base}/api/antifantasma/exec` : null;
}

/**
 * Escolhe a porta em que a API deve subir.
 *
 * Ordem: `ANTIFANTASMA_PORT` (escolha explícita do administrador) → primeira
 * porta publicada disponível (`WORKER_1`, depois `WORKER_2`) → nenhuma.
 *
 * A preferência pelas portas publicadas é o que faz o "detectar sozinho"
 * funcionar de verdade: nelas existe subdomínio HTTPS, então o adaptador do
 * usuário tem um endereço alcançável de fora.
 *
 * @param {object} [env]
 * @returns {number} `0` quando não há porta utilizável
 */
export function escolherPorta(env = process.env) {
  const explicita = portaConfigurada(env);
  if (explicita) return explicita;
  const publicadas = portasPublicadas(env);
  return publicadas.length ? publicadas[0] : 0;
}

/**
 * Linha de log para o início do bot. Devolve `null` quando não há o que dizer
 * (nem URL detectada, nem porta configurada) — assim o boot não imprime ruído
 * num bot que não usa a API.
 *
 * @param {object} [env]
 * @param {{porta?: number}} [opts] porta efetivamente em uso (a do servidor no
 *   ar tem prioridade sobre a variável de ambiente).
 * @returns {{url: string|null, porta: number, endpoint: string|null, texto: string}|null}
 */
export function resumoParaLog(env = process.env, opts = {}) {
  const porta = Number(opts.porta) > 0 ? Number(opts.porta) : portaConfigurada(env);
  const url = detectarUrlPublica(env, { porta });
  const endpoint = url ? `${url}/api/antifantasma/exec` : null;

  if (!url && !porta) return null;

  const linhas = ['🔐 AntiFantasma (plugin remoto)'];
  if (url) linhas.push(`   URL pública: ${url}`);
  else linhas.push('   URL pública: não detectada (defina ANTIFANTASMA_PUBLIC_URL)');
  linhas.push(`   Porta da API: ${porta || 'não configurada (defina ANTIFANTASMA_PORT)'}`);
  if (endpoint) linhas.push(`   Endpoint:    ${endpoint}`);

  return { url, porta, endpoint, texto: linhas.join('\n') };
}