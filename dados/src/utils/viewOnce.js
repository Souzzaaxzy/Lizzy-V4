/**
 * Resolução de mídia em mensagens — View Once (V1/V2/V2Extension), efêmeras e
 * outros encapsulamentos.
 *
 * Por que este módulo existe: o WhatsApp quase nunca entrega a mídia "crua".
 * Uma foto de visualização única chega como
 *
 *     viewOnceMessageV2.message.imageMessage
 *
 * e ainda pode vir dentro de `ephemeralMessage` num grupo com mensagens
 * temporárias:
 *
 *     ephemeralMessage.message.viewOnceMessageV2.message.imageMessage
 *
 * Cada comando fazia esse caminho "na mão" e, quando esquecia um nível, não
 * achava mídia nenhuma — era o caso do `!pv`, que lia
 * `viewOnceMessageV2.imageMessage` (faltando `.message`) e por isso sempre
 * respondia "Não foi possível obter a mídia".
 *
 * Aqui a cadeia é percorrida de forma genérica: qualquer wrapper que carregue
 * outra mensagem dentro é descascado, em qualquer profundidade.
 *
 * O módulo é puro (não importa o Baileys), então dá para testar sem socket.
 */

/** Campos de mídia do proto e o "tipo" correspondente. */
const MEDIA_TYPES = {
  imageMessage: 'image',
  videoMessage: 'video',
  ptvMessage: 'video',
  audioMessage: 'audio',
  stickerMessage: 'sticker',
  documentMessage: 'document',
};

/** Ordem fixa de checagem dos campos de mídia (resultado previsível). */
const MEDIA_KEYS = Object.keys(MEDIA_TYPES);

/**
 * Wrappers conhecidos, do mais externo para o mais interno.
 *
 * Precisam estar explícitos: `viewOnceMessageV2` e `viewOnceMessageV2Extension`
 * NÃO terminam em "Message", então uma detecção por sufixo os ignoraria — e era
 * justamente o ViewOnceV2 que quebrava.
 */
const WRAPPER_KEYS = [
  'viewOnceMessageV2Extension',
  'viewOnceMessageV2',
  'viewOnceMessage',
  'ephemeralMessage',
  'documentWithCaptionMessage',
  'deviceSentMessage',
  'editedMessage',
  'groupStatusMessage',
  'albumMessage',
  'commentMessage',
];

/** Campos de um wrapper que guardam a mensagem de dentro. */
const WRAPPER_CHILDREN = ['message', 'editedMessage', 'groupStatusMessage', 'originalMessage'];

/**
 * Qual chave de `content` representa a mensagem, em ordem de prioridade.
 *
 * A ordem importa: `messageContextInfo` acompanha quase toda mensagem e também
 * contém "Message" no nome. Se a escolha fosse "a primeira chave que parece
 * mensagem", ela poderia vencer o conteúdo real.
 */
function nextKeyOf(content) {
  if (!content || typeof content !== 'object') return null;

  // 1) Mídia (onde a maioria dos casos termina).
  for (const k of MEDIA_KEYS) {
    if (content[k] != null && typeof content[k] === 'object') return k;
  }

  // 2) Wrappers conhecidos.
  for (const k of WRAPPER_KEYS) {
    if (content[k] != null && typeof content[k] === 'object') return k;
  }

  // 3) Texto puro.
  if (content.conversation != null) return 'conversation';

  // 4) Rede de segurança para wrappers novos: qualquer chave *Message* que
  //    carregue uma mensagem dentro.
  const fallback = Object.keys(content).find(
    (k) =>
      k !== 'senderKeyDistributionMessage' &&
      /Message/.test(k) &&
      content[k] &&
      typeof content[k] === 'object' &&
      WRAPPER_CHILDREN.some((f) => content[k][f] && typeof content[k][f] === 'object')
  );

  return fallback || null;
}

/**
 * Percorre a cadeia de encapsulamento até a mídia.
 *
 * Em cada nível: se a chave já é um campo de mídia, paramos ali; senão, desce
 * pelo filho do wrapper (`message`, `editedMessage`...).
 *
 * @param {object} content conteúdo de mensagem (`info.message` ou um quoted)
 * @returns {{media: object, type: string, viewOnce: boolean, chain: string[]}|null}
 */
function walkToMedia(content) {
  let current = content;
  const chain = [];
  let guard = 0;
  let viewOnce = false;

  while (current && typeof current === 'object' && guard < 12) {
    guard += 1;

    const key = nextKeyOf(current);
    if (!key) return null;
    chain.push(key);
    if (key.startsWith('viewOnce')) viewOnce = true;

    // Chegou na mídia.
    if (MEDIA_TYPES[key]) {
      const media = current[key];
      if (!media || typeof media !== 'object') return null;
      return { media, type: MEDIA_TYPES[key], viewOnce, chain };
    }

    // Texto puro não tem mídia.
    if (key === 'conversation') return null;

    // Desce um nível quando o wrapper carrega outra mensagem dentro.
    const node = current[key];
    const child = WRAPPER_CHILDREN.map((f) => node?.[f]).find((v) => v && typeof v === 'object');
    if (!child) return null;

    current = child;
  }

  return null;
}

/**
 * Extrai a mídia de um conteúdo, seja qual for o encapsulamento.
 *
 * @param {object} content `info.message` ou `contextInfo.quotedMessage`
 * @returns {{media: object, type: string, viewOnce: boolean, chain: string[]}|null}
 */
export function extractMedia(content) {
  return walkToMedia(content);
}

/**
 * Percorre a cadeia de encapsulamento e devolve o conteúdo mais interno.
 *
 * @param {object} content conteúdo de mensagem
 * @returns {{leaf: object|null, chain: string[], viewOnce: boolean}}
 */
export function unwrapContent(content) {
  const chain = [];
  let current = content;
  let guard = 0;
  let viewOnce = false;

  while (current && typeof current === 'object' && guard < 12) {
    guard += 1;
    const key = nextKeyOf(current);
    if (!key) break;

    chain.push(key);
    if (key.startsWith('viewOnce')) viewOnce = true;

    const node = current[key];
    // `conversation` é texto puro; mídia é folha.
    if (key === 'conversation' || MEDIA_TYPES[key]) {
      return { leaf: node ?? null, chain, viewOnce };
    }

    const child = WRAPPER_CHILDREN.map((f) => node?.[f]).find((v) => v && typeof v === 'object');
    if (!child) return { leaf: node ?? null, chain, viewOnce };

    current = child;
  }

  return { leaf: current ?? null, chain, viewOnce };
}

/**
 * Procura mídia em vários conteúdos, na ordem dada.
 *
 * Uso típico: `resolveMedia([quoted, info.message])` — dá prioridade ao que foi
 * marcado/citado e cai para a mensagem do próprio comando.
 *
 * @param {Array<object|null|undefined>} contents
 * @returns {{media: object, type: string, viewOnce: boolean, chain: string[], source: number}|null}
 */
export function resolveMedia(contents) {
  const list = Array.isArray(contents) ? contents : [contents];

  for (let i = 0; i < list.length; i++) {
    const found = extractMedia(list[i]);
    if (found) return { ...found, source: i };
  }
  return null;
}

/**
 * Verdadeiro quando o conteúdo é de visualização única.
 * @param {object} content
 */
export function isViewOnce(content) {
  return unwrapContent(content).viewOnce;
}

/**
 * Mensagem marcada/citada (`contextInfo.quotedMessage`) de um conteúdo.
 *
 * Não assume o tipo do topo: o comando pode chegar como texto
 * (`extendedTextMessage`) ou como legenda de mídia (`imageMessage`, etc.), e em
 * ambos o `contextInfo` fica no nó do tipo. Desce wrappers (efêmera) também.
 *
 * @param {object} content `info.message`
 * @returns {object|null}
 */
export function extractQuoted(content) {
  let current = content;
  let guard = 0;

  while (current && typeof current === 'object' && guard < 12) {
    guard += 1;

    for (const key of Object.keys(current)) {
      const node = current[key];
      if (node && typeof node === 'object' && node.contextInfo?.quotedMessage) {
        return node.contextInfo.quotedMessage;
      }
    }

    const wrapperKey = WRAPPER_KEYS.find((k) => current[k] && typeof current[k] === 'object');
    if (!wrapperKey) break;
    const wrapper = current[wrapperKey];
    const child = WRAPPER_CHILDREN.map((f) => wrapper?.[f]).find((v) => v && typeof v === 'object');
    if (!child) break;
    current = child;
  }

  return null;
}

/**
 * Texto "legível" de um conteúdo: conversa, texto estendido ou a legenda de uma
 * mídia — descascando qualquer encapsulamento. Devolve string vazia quando não
 * há texto.
 *
 * Existe para responder uma mensagem de texto (ou uma mídia com legenda) e
 * levar esse texto ao status sem depender do tipo da mensagem.
 *
 * @param {object} content
 * @returns {string}
 */
export function extractText(content) {
  const MEDIA_CAPTION_KEYS = ['imageMessage', 'videoMessage', 'ptvMessage', 'documentMessage', 'audioMessage'];
  let current = content;
  let guard = 0;

  while (current && typeof current === 'object' && guard < 12) {
    guard += 1;

    if (typeof current.conversation === 'string' && current.conversation.trim()) {
      return current.conversation.trim();
    }
    const extended = current.extendedTextMessage?.text;
    if (typeof extended === 'string' && extended.trim()) return extended.trim();

    for (const key of MEDIA_CAPTION_KEYS) {
      const caption = current[key]?.caption;
      if (typeof caption === 'string' && caption.trim()) return caption.trim();
    }

    const wrapperKey = WRAPPER_KEYS.find((k) => current[k] && typeof current[k] === 'object');
    if (!wrapperKey) break;
    const wrapper = current[wrapperKey];
    const child = WRAPPER_CHILDREN.map((f) => wrapper?.[f]).find((v) => v && typeof v === 'object');
    if (!child) break;
    current = child;
  }

  return '';
}

/** Nome amigável do tipo de mídia (para mensagens ao usuário). */
export function mediaTypeLabel(type) {
  switch (type) {
    case 'image': return 'imagem';
    case 'video': return 'vídeo';
    case 'audio': return 'áudio';
    case 'sticker': return 'figurinha';
    case 'document': return 'documento';
    default: return 'mídia';
  }
}

/**
 * Traduz o erro de download em algo que o usuário entenda, quando for um caso
 * conhecido. Devolve `null` quando não há nada específico a dizer.
 */
export function describeMediaError(error) {
  const msg = String(error?.message || error || '');
  if (/404|410|not found|expired/i.test(msg)) {
    return 'a mídia expirou ou já foi removida dos servidores do WhatsApp';
  }
  if (/429|rate|too many/i.test(msg)) {
    return 'o WhatsApp está limitando os downloads agora (tente de novo em instantes)';
  }
  if (/timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket|fetch failed/i.test(msg)) {
    return 'a conexão com o servidor de mídia falhou';
  }
  if (/No valid media URL|mediaKey|empty media key/i.test(msg)) {
    return 'os dados da mídia vieram incompletos na mensagem';
  }
  return null;
}