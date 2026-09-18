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

    // `messageTimestamp` vem em segundos (number, Long ou string).
    const ts = Number(info.messageTimestamp) * 1000;
    if (!Number.isFinite(ts) || now - ts > windowMs || ts > now) continue;

    encontrados.push({ key: info.key, image, timestamp: ts });
  }

  // Ordem de envio: mais antiga primeiro.
  encontrados.sort((a, b) => a.timestamp - b.timestamp);
  return encontrados.slice(-max);
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
