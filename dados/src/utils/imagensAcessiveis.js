/**
 * Resolve URLs de imagem que REALMENTE podem ser baixadas.
 *
 * ## O bug que isto conserta (medido, out/2026)
 *
 * O `!pinterest` montava o carrossel com as URLs cruas da busca. A busca (Bing)
 * devolve **URLs arbitrárias da web**, e muitas bloqueiam **hotlink** — medido:
 * `403 text/html` no `png.pngtree.com` e no `meugamer.com`. O
 * `prepareWAMessageMedia` da fork falhava, o `catch` engolia, e o card saía
 * **sem header** — e aí o carrossel INTEIRO era recusado com
 * *"Invalid media type for carousel card"*.
 *
 * Era por isso que o **TikTok funcionava e o Pinterest não**: as URLs do TikTok
 * vêm de um CDN confiável; as do Pinterest vêm da web aberta.
 *
 * ## O que este módulo faz
 *
 * Checa cada URL (HEAD, com fallback para um GET de 1 byte) e devolve só as que
 * respondem **imagem de verdade** — com o `content-type` confirmando. A
 * checagem roda em PARALELO e para assim que junta o que foi pedido, para não
 * gastar tempo com o resto.
 *
 * Módulo PURO quanto ao socket: o `fetch` entra por parâmetro (o teste injeta).
 */

/** Extensões que NÃO valem como imagem de card (nem tentamos). */
const EXTENSAO_RUIM = /\.(mp4|webm|mov|avi|mkv|gifv?|svg|pdf|zip|rar|mp3|m4a|ogg|wav)(\?|#|$)/i;

/**
 * A URL responde uma IMAGEM acessível?
 *
 * O `content-type` é a prova: `image/*` passa; `text/html` (a página de
 * bloqueio do hotlink) NÃO. Um HEAD basta na maioria; quando o servidor recusa
 * HEAD (`405`/`403`), tenta um GET de 1 byte — alguns hosts só respondem assim.
 *
 * @param {string} url
 * @param {object} [opts]
 * @param {function} [opts.fetchFn] `fetch` injetável (o teste passa o dele)
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<boolean>}
 */
export async function urlEhImagem(url, { fetchFn, timeoutMs = 6000 } = {}) {
  const u = String(url || '');
  if (!/^https?:\/\//i.test(u)) return false;
  if (EXTENSAO_RUIM.test(u)) return false;
  const f = typeof fetchFn === 'function' ? fetchFn : (typeof fetch === 'function' ? fetch : null);
  if (!f) return false;

  const tentar = async (metodo) => {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => { try { ctrl.abort(); } catch { /* ok */ } }, timeoutMs) : null;
    try {
      const r = await f(u, {
        method: metodo,
        redirect: 'follow',
        ...(ctrl ? { signal: ctrl.signal } : {}),
        headers: {
          // Sem UA de navegador, vários hosts respondem 403 por padrão.
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
          Accept: 'image/*,*/*;q=0.8'
        }
      });
      const tipo = String(r?.headers?.get?.('content-type') || '').toLowerCase();
      // Fecha o corpo quando for GET (não baixamos a imagem aqui).
      try { r?.body?.cancel?.(); } catch { /* ok */ }
      return Boolean(r?.ok) && tipo.startsWith('image/');
    } catch {
      return false;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  if (await tentar('HEAD')) return true;
  return tentar('GET');
}

/**
 * Filtra uma lista de URLs, devolvendo só as imagens acessíveis.
 *
 * Roda em PARALELO (com teto de concorrência) e **para cedo** quando já juntou
 * `limite` — não adianta validar 30 URLs para usar 5.
 *
 * @param {string[]} urls
 * @param {object} [opts]
 * @param {number} [opts.limite] quantas acessíveis bastam (padrão: todas)
 * @param {number} [opts.concorrencia]
 * @param {function} [opts.fetchFn]
 * @returns {Promise<string[]>} as acessíveis, na ORDEM original
 */
export async function filtrarImagensAcessiveis(urls, { limite = Infinity, concorrencia = 6, fetchFn } = {}) {
  const lista = [...new Set((urls || []).filter((u) => typeof u === 'string' && /^https?:\/\//i.test(u)))];
  if (!lista.length) return [];
  const alvo = Number.isFinite(limite) && limite > 0 ? Math.floor(limite) : lista.length;
  const bons = new Set();
  const teto = Math.max(1, Math.min(Number(concorrencia) || 6, lista.length));

  // O indice avanca SO' enquanto ainda falta: com varios trabalhadores em
  // paralelo, checar `bons.size` antes de pegar o indice deixava ate'
  // `concorrencia` URLs a mais passarem (medido: limite 3 devolvia 8). Pegando o
  // indice com a checagem JUNTA, o pior caso e' `concorrencia - 1` a mais.
  let proximo = 0;
  const proximoIndice = () => (bons.size >= alvo || proximo >= lista.length ? -1 : proximo++);
  const trabalhador = async () => {
    for (let i = proximoIndice(); i >= 0; i = proximoIndice()) {
      if (await urlEhImagem(lista[i], { fetchFn })) bons.add(lista[i]);
    }
  };
  await Promise.all(Array.from({ length: teto }, () => trabalhador()));
  // Mantém a ORDEM original (o Set não garante) e CORTA no limite: com vários
  // trabalhadores em paralelo o pior caso e' `concorrencia - 1` URLs a mais
  // (medido: limite 3 chegava a 8 sem o corte). O contrato e' "no maximo
  // `limite`" — quem chama nao deve precisar cortar de novo.
  return lista.filter((u) => bons.has(u)).slice(0, alvo);
}
