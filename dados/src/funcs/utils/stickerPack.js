/**
 * `!s <prompt>` → pack de figurinhas a partir de uma busca.
 *
 * Fluxo (pedido do dono):
 *   1. o usuário digita `!s <pesquisa>`;
 *   2. o bot pesquisa no Pinterest **prefixando "icon"** — ou seja, a busca real
 *      é `icon <pesquisa>`;
 *   3. pega de 10 a 15 imagens;
 *   4. converte cada uma em figurinha (webp) e envia TUDO como um **pacote de
 *      figurinhas** (`stickerPackMessage`: capa + figurinhas).
 *
 * Este módulo é PURO (não conhece socket nem fs): quem chama passa as URLs já
 * encontradas e um `baixar`/`converter` — o que deixa a lógica testável sem
 * subir o handler.
 */

/** Prefixo fixo da busca (pedido: "usuário pesquisa X, bot pesquisa icon X"). */
export const PREFIXO_BUSCA = 'icon';

/** Faixa de figurinhas do pack. */
export const MIN_FIGURINHAS = 10;
export const MAX_FIGURINHAS = 15;

/** Teto de figurinhas do pacote (limite do WhatsApp/fork). */
export const MAX_FIGURINHAS_PACK = 60;

/** Monta o termo de busca: `icon <prompt>`. */
export function montarTermoBusca(prompt) {
  const limpo = String(prompt ?? '').trim().replace(/\s+/g, ' ');
  if (!limpo) return '';
  return `${PREFIXO_BUSCA} ${limpo}`;
}

/**
 * Escolhe quantas figurinhas usar (entre 10 e 15), limitado ao que existe.
 *
 * @param {number} disponiveis
 * @param {() => number} [rng]
 * @returns {number}
 */
export function escolherQuantidade(disponiveis, rng = Math.random) {
  const total = Math.max(Number(disponiveis) || 0, 0);
  if (total <= MIN_FIGURINHAS) return Math.min(total, MIN_FIGURINHAS);
  const alvo = MIN_FIGURINHAS + Math.floor(rng() * (MAX_FIGURINHAS - MIN_FIGURINHAS + 1));
  return Math.min(alvo, total, MAX_FIGURINHAS_PACK);
}

/**
 * Monta o pacote a partir das URLs de imagem.
 *
 * Baixa e converte cada imagem em figurinha (webp) via `converter`; usa a
 * primeira como capa. Ignora as que falharem — o pack sai com o que der certo.
 *
 * @param {object} opts
 * @param {string[]} opts.urls
 * @param {(url: string) => Promise<Buffer|null>} opts.converter  baixa+converte p/ webp
 * @param {string} [opts.nome]      nome do pacote
 * @param {string} [opts.publisher] autor do pacote
 * @param {number} [opts.quantidade] quantas usar (default: escolhe 10..15)
 * @param {() => number} [opts.rng]
 * @returns {Promise<{ok: boolean, motivo?: string, stickers?: Array, cover?: Buffer,
 *                    nome: string, publisher: string, total: number}>}
 */
export async function montarPack({ urls, converter, nome = 'Pack', publisher = 'Bot', quantidade, rng = Math.random }) {
  const lista = [...new Set((urls || []).filter((u) => typeof u === 'string' && /^https?:\/\//i.test(u)))];
  if (!lista.length) return { ok: false, motivo: 'sem_imagens', nome, publisher, total: 0 };

  const alvo = Number.isFinite(quantidade) && quantidade > 0
    ? Math.min(Math.floor(quantidade), lista.length, MAX_FIGURINHAS_PACK)
    : escolherQuantidade(lista.length, rng);

  const stickers = [];
  for (const url of lista) {
    if (stickers.length >= alvo) break;
    let webp = null;
    try {
      webp = await converter(url);
    } catch { webp = null; }
    if (Buffer.isBuffer(webp) && webp.length > 0) stickers.push({ data: webp });
  }

  if (!stickers.length) return { ok: false, motivo: 'conversao_falhou', nome, publisher, total: 0 };

  return {
    ok: true,
    stickers,
    cover: stickers[0].data, // a primeira vira capa do pacote
    nome,
    publisher,
    total: stickers.length
  };
}

/**
 * Monta o conteúdo do `sendMessage` para o pacote (formato da fork).
 */
export function conteudoPack({ stickers, cover, nome, publisher, descricao = '' }) {
  return {
    stickers,
    cover,
    name: nome,
    publisher,
    description: descricao
  };
}

export default {
  PREFIXO_BUSCA,
  MIN_FIGURINHAS,
  MAX_FIGURINHAS,
  MAX_FIGURINHAS_PACK,
  montarTermoBusca,
  escolherQuantidade,
  montarPack,
  conteudoPack
};
