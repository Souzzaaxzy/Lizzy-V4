/**
 * AntiFantasma — verificação de saúde do serviço.
 *
 * Usado pelo `!ghostcmd` para responder "a API está de pé?" SEM disparar nenhuma
 * ação real do anti-fantasma (nada de fechar grupo, banir ou reabrir). Bate no
 * endpoint de health, que é somente-leitura.
 *
 * A função é pura em relação ao ambiente: recebe a URL por parâmetro, o que
 * permite testar cada cenário (online, offline, erro) sem rede.
 */

/**
 * Consulta o health da API.
 *
 * @param {string} endpointUrl URL pública base (ex.: `https://host`)
 * @param {{timeoutMs?: number, fetchImpl?: Function}} [opts]
 * @returns {Promise<{ok: boolean, tipo: 'online'|'offline'|'erro', versao?: string, detalhe?: string}>}
 */
export async function verificarSaude(endpointUrl, opts = {}) {
  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 5000;
  const fetchImpl = opts.fetchImpl || globalThis.fetch;

  if (!endpointUrl || typeof endpointUrl !== 'string') {
    return { ok: false, tipo: 'erro', detalhe: 'url_ausente' };
  }
  if (typeof fetchImpl !== 'function') {
    return { ok: false, tipo: 'erro', detalhe: 'fetch_indisponivel' };
  }

  const url = `${endpointUrl.replace(/\/+$/, '')}/api/antifantasma/health`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchImpl(url, { signal: controller.signal });

    // Respondeu, mas não é o que esperávamos: serviço existe e está errado.
    if (!res || !res.ok) {
      return { ok: false, tipo: 'erro', detalhe: `http_${res?.status ?? 0}` };
    }

    let corpo = {};
    try { corpo = await res.json(); } catch { /* corpo ilegível */ }

    // Confere que é mesmo o nosso plugin, e não outro serviço na mesma porta.
    if (corpo?.plugin !== 'antifantasma') {
      return { ok: false, tipo: 'erro', detalhe: 'servico_diferente' };
    }

    return { ok: true, tipo: 'online', versao: corpo.version };
  } catch (e) {
    // Falha de rede/timeout: o serviço não respondeu.
    const abortado = e?.name === 'AbortError';
    return { ok: false, tipo: 'offline', detalhe: abortado ? 'timeout' : 'sem_resposta' };
  } finally {
    clearTimeout(timer);
  }
}