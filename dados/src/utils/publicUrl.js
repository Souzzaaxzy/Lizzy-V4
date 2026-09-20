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

/**
 * Descobre a URL pública HTTPS do host.
 *
 * @param {object} [env] variáveis de ambiente (padrão: `process.env`)
 * @returns {string|null} ex.: `https://meu-app.fly.dev`, ou `null` se nenhuma
 *   plataforma conhecida definir o domínio (aí o administrador usa
 *   `ANTIFANTASMA_PUBLIC_URL`).
 */
export function detectarUrlPublica(env = process.env) {
  if (!env || typeof env !== 'object') return null;

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
 * @returns {string|null} ex.: `https://host/api/antifantasma/exec`
 */
export function endpointAntiFantasma(env = process.env) {
  const base = detectarUrlPublica(env);
  return base ? `${base}/api/antifantasma/exec` : null;
}

/**
 * Linha de log para o início do bot. Devolve `null` quando não há o que dizer
 * (nem URL detectada, nem porta configurada) — assim o boot não imprime ruído
 * num bot que não usa a API.
 *
 * @param {object} [env]
 * @returns {{url: string|null, porta: number, endpoint: string|null, texto: string}|null}
 */
export function resumoParaLog(env = process.env) {
  const url = detectarUrlPublica(env);
  const porta = portaConfigurada(env);
  const endpoint = url ? `${url}/api/antifantasma/exec` : null;

  if (!url && !porta) return null;

  const linhas = ['🔐 AntiFantasma (plugin remoto)'];
  if (url) linhas.push(`   URL pública: ${url}`);
  else linhas.push('   URL pública: não detectada (defina ANTIFANTASMA_PUBLIC_URL)');
  linhas.push(`   Porta da API: ${porta || 'não configurada (defina ANTIFANTASMA_PORT)'}`);
  if (endpoint) linhas.push(`   Endpoint:    ${endpoint}`);

  return { url, porta, endpoint, texto: linhas.join('\n') };
}