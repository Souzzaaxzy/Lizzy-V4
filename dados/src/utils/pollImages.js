/**
 * Suporte ao comando `!enqueteimg` — enquetes cujas opções são imagens.
 *
 * Duas responsabilidades, ambas puras (sem Baileys), para poder testar sem socket:
 *
 * 1. `parseImagePollArgs(q)` — lê `PERGUNTA|1|2|3` e devolve a pergunta e os
 *    índices, preservando a ORDEM digitada (não reordena, não deduplica em
 *    silêncio: índice repetido é erro, porque duas opções apontando para a mesma
 *    imagem não fazem sentido e o usuário provavelmente errou).
 *
 * 2. `collectAttachments(...)` — resolve "de onde vêm as imagens".
 *
 * Por que a coleta é necessária: o WhatsApp NÃO entrega várias imagens numa
 * mensagem só (a exceção é o álbum, que chega como pai + filhos). Então o
 * usuário manda as imagens e depois o comando; as imagens ficam no
 * `messagesCache` que o bot já mantém. A coleta usa esse cache — nenhum sistema
 * paralelo de mídia.
 *
 * O critério é restritivo de propósito (mesmo chat, mesmo autor, janela curta),
 * para não pegar imagem de outra conversa nem mídia antiga por engano.
 */

/** Quantas imagens, no máximo, a coleta considera. */
export const MAX_ATTACHMENTS = 12;

/** Janela padrão (ms) em que as imagens precisam ter sido enviadas. */
export const DEFAULT_WINDOW_MS = 2 * 60 * 1000;

/**
 * Campos de mídia que contam como "imagem anexada" — inclusive encapsulados.
 * Mantém a mesma ordem de prioridade do resto do bot.
 */
const IMAGE_PATHS = [
  (m) => m?.imageMessage,
  (m) => m?.viewOnceMessage?.message?.imageMessage,
  (m) => m?.viewOnceMessageV2?.message?.imageMessage,
  (m) => m?.viewOnceMessageV2Extension?.message?.imageMessage,
  (m) => m?.ephemeralMessage?.message?.imageMessage,
  (m) => m?.documentWithCaptionMessage?.message?.imageMessage,
];

/** Extrai o imageMessage de um conteúdo, em qualquer encapsulamento. */
export function findImageMessage(content) {
  if (!content || typeof content !== 'object') return null;
  for (const get of IMAGE_PATHS) {
    const image = get(content);
    if (image && typeof image === 'object') return image;
  }
  return null;
}

/** Verdadeiro quando o conteúdo é uma imagem. */
export function isImageContent(content) {
  return Boolean(findImageMessage(content));
}

/**
 * Lê os argumentos do comando.
 *
 * Formato: `PERGUNTA|1|2|3`. Cada número é a posição (1-based) da imagem na
 * sequência de anexos. A ordem digitada é a ordem das opções.
 *
 * @param {string} raw texto depois do comando
 * @returns {{ ok: true, question: string, indexes: number[] }
 *          | { ok: false, error: string }}
 */
export function parseImagePollArgs(raw) {
  const texto = String(raw ?? '').trim();
  if (!texto) {
    return { ok: false, error: 'Informe a pergunta e os índices das imagens.' };
  }

  const partes = texto.split('|').map((v) => v.trim());
  const pergunta = (partes.shift() ?? '').trim();

  if (!pergunta) {
    return { ok: false, error: 'A pergunta (antes do primeiro `|`) está vazia.' };
  }
  if (partes.length === 0 || partes.every((p) => p === '')) {
    return { ok: false, error: 'Informe pelo menos 2 índices de imagem, ex.: `Pergunta|1|2`.' };
  }

  const indexes = [];
  for (const parte of partes) {
    // Aceita "1" e também "1" com espaços; rejeita "1a", "-1", "0".
    if (!/^\d+$/.test(parte)) {
      return { ok: false, error: `Índice inválido: \`${parte}\`. Use apenas números, ex.: \`1\`.` };
    }
    const n = Number.parseInt(parte, 10);
    if (n < 1) {
      return { ok: false, error: 'Os índices começam em 1.' };
    }
    indexes.push(n);
  }

  if (indexes.length < 2) {
    return { ok: false, error: 'Uma enquete precisa de pelo menos 2 opções.' };
  }
  if (indexes.length > MAX_ATTACHMENTS) {
    return { ok: false, error: `Máximo de ${MAX_ATTACHMENTS} opções.` };
  }

  const repetido = indexes.find((n, i) => indexes.indexOf(n) !== i);
  if (repetido !== undefined) {
    return { ok: false, error: `O índice \`${repetido}\` aparece mais de uma vez. Cada opção precisa de uma imagem diferente.` };
  }

  return { ok: true, question: pergunta, indexes };
}

/**
 * Normaliza um JID/LID para comparação (só a parte antes do `@`, sem device).
 * Em grupo o autor pode vir como LID ou como JID; comparar o número evita
 * depender de qual dos dois o WhatsApp mandou.
 */
function normalizeId(id) {
  return String(id ?? '').split('@')[0].split(':')[0];
}

/** Autor de uma mensagem do cache (grupo usa `participant`, PV usa o próprio chat). */
function authorOf(info) {
  return info?.key?.participant || info?.key?.remoteJid || null;
}

/**
 * Coleta as imagens anexadas recentemente na conversa, na ordem em que foram
 * enviadas (mais antiga primeiro), para que "1" seja a primeira imagem.
 *
 * @param {Map} messagesCache cache já mantido pelo bot (`remoteJid_id` -> info)
 * @param {object} opts
 * @param {string} opts.chatJid conversa atual
 * @param {string[]} opts.senders ids aceitos como autor (LID e/ou JID)
 * @param {number} [opts.now] timestamp atual em ms (injetável nos testes)
 * @param {number} [opts.windowMs] janela de tempo aceita
 * @param {number} [opts.max] máximo de imagens
 * @returns {Array<{ key: object, image: object, timestamp: number }>}
 */
export function collectAttachments(messagesCache, opts = {}) {
  const { chatJid, senders = [], now = Date.now(), windowMs = DEFAULT_WINDOW_MS, max = MAX_ATTACHMENTS } = opts;
  if (!messagesCache || typeof messagesCache.values !== 'function' || !chatJid) return [];

  const aceitos = new Set(senders.filter(Boolean).map(normalizeId));
  const encontrados = [];

  for (const info of messagesCache.values()) {
    if (!info?.key?.remoteJid || info.key.remoteJid !== chatJid) continue;
    if (info.key.fromMe) continue; // o comando é do usuário, não do bot

    const autor = authorOf(info);
    if (aceitos.size > 0 && !aceitos.has(normalizeId(autor))) continue;

    const image = findImageMessage(info.message);
    if (!image) continue;

    // `messageTimestamp` vem em segundos (number, Long ou string). Usa valor
    // ABSOLUTO de propósito: um relógio levemente à frente do nosso não pode
    // descartar uma imagem legítima (era o caso do `ts > now`, que jogava fora
    // o álbum inteiro quando os filhos vinham com timestamp adiantado).
    const ts = Number(info.messageTimestamp) * 1000;
    if (!Number.isFinite(ts) || Math.abs(now - ts) > windowMs) continue;

    encontrados.push({ key: info.key, image, timestamp: ts });
  }

  // Ordem de CHEGADA: o Map preserva a ordem de inserção, que é a ordem em que
  // as mensagens chegaram (mais antiga primeiro). Não reordenar por timestamp:
  // dois filhos de álbum podem cair no mesmo segundo e embaralhar a sequência.
  return encontrados.slice(-max);
}

/** AssociationType do proto (MessageAssociation.AssociationType). */
export const ASSOCIATION_MEDIA_ALBUM = 1;
export const ASSOCIATION_MEDIA_POLL = 7;

/**
 * Quando a mensagem é filha de um ÁLBUM, devolve o id do pai e quantas imagens
 * o álbum espera.
 *
 * Por que isso existe: quando o usuário SELECIONA várias imagens e digita o
 * comando na legenda, o WhatsApp não manda uma mensagem só — manda um pai
 * (`albumMessage`, sem legenda) mais um filho por imagem, em mensagens
 * separadas com ~1,5s entre elas. A legenda vai em UM dos filhos. No instante
 * em que esse filho chega, os outros ainda não estão no cache — sem esperar o
 * álbum completar, o comando só enxerga a primeira imagem.
 *
 * @returns {{ parentId: string, expected: number|null }|null}
 */
export function albumContextOf(message, messagesCache, chatJid) {
  const assoc = message?.messageContextInfo?.messageAssociation;
  if (!assoc || assoc.associationType !== ASSOCIATION_MEDIA_ALBUM) return null;
  const parentId = assoc.parentMessageKey?.id;
  if (!parentId) return null;

  const parent = messagesCache?.get?.(`${chatJid}_${parentId}`);
  const expected = parent?.message?.albumMessage?.expectedImageCount ?? null;
  return { parentId, expected: typeof expected === 'number' ? expected : null };
}

/**
 * Filhos de um álbum já presentes no cache, na ordem de chegada.
 * O escopo é o id do pai (único por álbum), então não precisa filtrar autor —
 * e evita a ambiguidade LID/JID.
 */
export function collectAlbumChildren(messagesCache, chatJid, parentId, { max = MAX_ATTACHMENTS } = {}) {
  if (!messagesCache || typeof messagesCache.values !== 'function' || !chatJid || !parentId) return [];

  const filhos = [];
  for (const info of messagesCache.values()) {
    if (!info?.key?.remoteJid || info.key.remoteJid !== chatJid) continue;
    const assoc = info?.message?.messageContextInfo?.messageAssociation;
    if (!assoc || assoc.associationType !== ASSOCIATION_MEDIA_ALBUM) continue;
    if (assoc.parentMessageKey?.id !== parentId) continue;

    const image = findImageMessage(info.message);
    if (!image) continue;

    filhos.push({ key: info.key, image, timestamp: Number(info.messageTimestamp) * 1000 });
    if (filhos.length >= max) break;
  }
  return filhos;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Espera o álbum completar.
 *
 * O total esperado vem do próprio pai (`albumMessage.expectedImageCount`), então
 * dá para parar de esperar no momento certo em vez de chutar um tempo fixo. Se o
 * pai não estiver disponível, para quando a contagem estabiliza.
 */
export async function waitForAlbumChildren(
  messagesCache,
  { chatJid, parentId, expected = null, max = MAX_ATTACHMENTS, timeoutMs = 6000, pollMs = 400 }
) {
  const limite = Date.now() + timeoutMs;
  let filhos = collectAlbumChildren(messagesCache, chatJid, parentId, { max });
  if (expected && filhos.length >= expected) return filhos;

  let anterior = filhos.length;
  while (Date.now() < limite) {
    await sleep(pollMs);
    filhos = collectAlbumChildren(messagesCache, chatJid, parentId, { max });
    if (expected && filhos.length >= expected) return filhos;
    // Sem total conhecido: para quando a contagem para de crescer.
    if (!expected && filhos.length > 0 && filhos.length === anterior) return filhos;
    anterior = filhos.length;
  }
  return filhos;
}

/**
 * Entrada principal da coleta: decide de onde vêm as imagens do comando.
 *
 * 1. Se a mensagem faz parte de um ÁLBUM, espera os irmãos e usa o álbum — é o
 *    fluxo "selecionar as imagens e digitar o comando na legenda".
 * 2. Caso contrário, usa as imagens recentes do autor na conversa.
 */
export async function collectPollImages(
  messagesCache,
  {
    chatJid,
    senders = [],
    message = null,
    now = Date.now(),
    windowMs = DEFAULT_WINDOW_MS,
    max = MAX_ATTACHMENTS,
    albumWaitMs = 6000,
    albumPollMs = 400
  } = {}
) {
  const album = albumContextOf(message, messagesCache, chatJid);
  if (album) {
    const filhos = await waitForAlbumChildren(messagesCache, {
      chatJid,
      parentId: album.parentId,
      expected: album.expected,
      max,
      timeoutMs: albumWaitMs,
      pollMs: albumPollMs
    });
    if (filhos.length) return filhos;
  }
  return collectAttachments(messagesCache, { chatJid, senders, now, windowMs, max });
}

/**
 * Resolve os índices (1-based) sobre a lista de anexos coletados.
 *
 * @returns {{ ok: true, items: Array<{ key: object, image: object }> }
 *          | { ok: false, error: string }}
 */
export function resolveAttachments(attachments, indexes) {
  const lista = Array.isArray(attachments) ? attachments : [];
  if (lista.length === 0) {
    return {
      ok: false,
      error: 'Não encontrei nenhuma imagem recente. Envie as imagens e depois o comando (ou responda uma imagem).',
    };
  }

  const items = [];
  for (const n of indexes) {
    const item = lista[n - 1];
    if (!item) {
      return {
        ok: false,
        error: `A imagem \`${n}\` não existe — encontrei apenas ${lista.length}.`,
      };
    }
    items.push(item);
  }
  return { ok: true, items };
}

/**
 * Nome de exibição de cada opção. O protocolo EXIGE um nome por opção (o hash
 * da opção é calculado sobre ele), e a enquete com imagens não tem onde o
 * usuário digitar um texto por imagem — então geramos "Opção N".
 */
export function buildOptionName(index) {
  return `Opção ${index}`;
}
