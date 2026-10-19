/**
 * Versão do WhatsApp Web anunciada ao servidor.
 *
 * ## Por que existe
 *
 * O `fetchLatestBaileysVersion()` da lib lê o **código-fonte do GitHub**
 * (`raw.githubusercontent.com/.../lib/Defaults/index.js`) para descobrir a versão.
 * Essa fonte fica **atrás** do WhatsApp: medido, ela devolvia
 * `[2, 3000, 1041589577, 261700, 0]` enquanto o cliente real já estava em
 * `[2, 3000, 1050889999]`.
 *
 * Anunciar uma versão velha faz o servidor **recusar o pareamento de aparelho
 * novo** com `405 Connection Failure` — no QR **e** no código de pareamento
 * (sessões já pareadas continuam funcionando, o que explica "antes funcionava").
 *
 * O `fetchLatestWaWebVersion()` da mesma lib lê o **`sw.js` do próprio
 * WhatsApp Web** (`client_revision`) e é a fonte correta. Medido no mesmo
 * instante:
 *
 *   fetchLatestBaileysVersion : [2, 3000, 1041589577, 261700, 0] | isLatest: FALSE
 *   fetchLatestWaWebVersion   : [2, 3000, 1050889999]           | isLatest: TRUE
 *
 * ## O build id de 5 partes (voz nas calls)
 *
 * O servidor só habilita a stack de VOZ para um cliente que se anuncia como
 * desktop/UWP **com build id de 5 partes** (`validate-connection` dobra a 4ª em
 * `quaternary`; 3 partes é outro anúncio, mudo). O `fetchLatestWaWebVersion`
 * devolve 3 partes, então **preservamos a cauda** da versão de voz: os dois
 * primeiros campos vêm do `sw.js` e o resto (build + `0`) do pin.
 *
 * ## Rede
 *
 * É best-effort: qualquer falha cai no pin (`VOICE_CAPABLE_VERSION`), e o
 * resultado é **cacheado** para a reconexão não pagar a requisição de novo.
 *
 * Módulo puro: as dependências (fetchers, cache) entram por parâmetro, então dá
 * para testar sem rede.
 */

/** De onde a versão veio, para o log de boot. */
export const ORIGEM_WEB = 'whatsapp-web (sw.js)';
export const ORIGEM_PIN = 'pin do pacote (fallback)';
export const ORIGEM_CACHE = 'cache do processo';

/**
 * Monta a versão de 5 partes: os dois primeiros campos do WhatsApp Web + a cauda
 * do pin (build id de voz).
 *
 * @param {number[]} webVersion 3 partes vindas do `sw.js`
 * @param {number[]} pin        versão de voz fixada no pacote
 * @returns {number[]|null} 5 partes, ou null se a webVersion não servir
 */
export function montarVersaoDeVoz(webVersion, pin) {
  if (!Array.isArray(webVersion) || webVersion.length < 3) return null;
  if (!Array.isArray(pin) || pin.length < 5) return null;
  const partes = pin.slice();
  partes[0] = webVersion[0];
  partes[1] = webVersion[1];
  partes[2] = webVersion[2];
  return partes;
}

/**
 * Resolve a versão a anunciar, com cache e fallback.
 *
 * @param {object} opts
 * @param {() => Promise<{version?: number[]}>} opts.buscarWeb  `fetchLatestWaWebVersion`
 * @param {number[]} opts.pin                                    `VOICE_CAPABLE_VERSION`
 * @param {{valor?: number[], origem?: string}} [opts.cache]     cache mutável do chamador
 * @param {(msg: string) => void} [opts.log]
 * @returns {Promise<{version: number[], origem: string}>}
 */
export async function resolverVersaoWhatsApp({ buscarWeb, pin, cache, log } = {}) {
  const avisar = typeof log === 'function' ? log : () => {};

  if (cache && Array.isArray(cache.valor) && cache.valor.length >= 3) {
    return { version: cache.valor, origem: ORIGEM_CACHE };
  }

  const guardar = (version, origem) => {
    if (cache) { cache.valor = version; cache.origem = origem; }
    return { version, origem };
  };

  try {
    const r = await buscarWeb?.();
    const doWeb = montarVersaoDeVoz(r?.version, pin);
    if (doWeb) return guardar(doWeb, ORIGEM_WEB);
    avisar(`[VERSION] o WhatsApp Web devolveu ${JSON.stringify(r?.version)} — usando o pin`);
  } catch (e) {
    avisar(`[VERSION] falha ao buscar a versão do WhatsApp Web: ${e?.message || e} — usando o pin`);
  }

  return guardar(Array.isArray(pin) ? pin.slice() : [], ORIGEM_PIN);
}
