/**
 * messageInspector.js
 *
 * Motor de diagnostico do comando "!get".
 *
 * Responsabilidade unica: transformar um objeto de mensagem do Baileys em um
 * relatorio textual seguro para leitura humana, sem nunca lancar excecao por
 * causa de BigInt, Buffer, Uint8Array, Long do protobuf, referencias circulares
 * ou campos gigantes.
 *
 * Este modulo NAO acessa rede, disco, socket ou credenciais. Ele apenas le o
 * objeto que o Baileys entregou.
 */

import crypto from 'crypto';

// ============================================================================
// CONSTANTES
// ============================================================================

const MAX_DEPTH = 14;
const MAX_ARRAY_ITEMS = 200;
const MAX_OBJECT_KEYS = 300;
const MAX_STRING_LEN = 4000;
const MAX_BINARY_PREVIEW = 24;
// Quantas mencoes sao LISTADAS no relatorio. A CONTAGEM nunca e limitada.
const MAX_MENTIONS_DISPLAYED = 25;

/** Chaves cujo conteúdo nunca deve ir para o WhatsApp. */
const SENSITIVE_KEY_PATTERN = /(apikey|api_key|secret|password|passwd|senha|token|privatekey|private_key|sessionkey|session_key|credential|authorization|bearer|authcred|noisekey|signedprekey|signed_prekey|identitykey|identity_key|prekey|advsecret|adv_secret|registrationid|masterkey|mastersecret|nKey)/i;

/**
 * Wrappers que só encapsulam outra mensagem. A detecção genérica de tipo os
 * reconhece pela terminação "Message" + presença de ".message", mas esta lista
 * documenta a cadeia esperada e serve de fallback para nomes conhecidos.
 */
const KNOWN_WRAPPERS = [
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'ephemeralMessage',
  'documentWithCaptionMessage',
  'editedMessage',
  'deviceSentMessage',
  'associatedChildMessage',
  'botForwardedMessage',
  'botInvokeMessage',
  'botTaskMessage',
  'groupMentionedMessage',
  'groupStatusMessage',
  'groupStatusMessageV2',
  'groupStatusMentionMessage',
  'statusMentionMessage',
  'limitSharingMessage',
  'lottieStickerMessage',
  'newsletterAdminProfileMessage',
  'newsletterAdminProfileMessageV2',
  'newsletterAdminProfileStatusMessage',
  'pollCreationMessageV2',
  'pollCreationMessageV3',
  'pollCreationMessageV4',
  'pollCreationOptionImageMessage',
  'questionMessage',
  'questionReplyMessage',
  'spoilerMessage',
  'statusAddYours',
  'eventCoverImage',
];

/** Estruturas de pagamento conhecidas no proto do WhatsApp. */
const PAYMENT_MESSAGE_TYPES = [
  'requestPaymentMessage',
  'sendPaymentMessage',
  'paymentInviteMessage',
  'cancelPaymentRequestMessage',
  'declinePaymentRequestMessage',
  'paymentReminderMessage',
  'splitPaymentMessage',
  'invoiceMessage',
  'paymentLinkMetadata',
  'paymentExtendedMetadata',
  'paymentMessage',
];

// ============================================================================
// HELPERS DE TIPO
// ============================================================================

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isBufferLike(value) {
  return Buffer.isBuffer(value) || value instanceof Uint8Array || ArrayBuffer.isView(value);
}

/**
 * protobufjs com Long carregado devolve instancias de Long (com low/high),
 * que quebram JSON.stringify. Detectamos o formato e convertemos para string.
 */
function isLongLike(value) {
  if (value === null || typeof value !== 'object') return false;
  if (typeof value.toNumber === 'function' && typeof value.low === 'number' && typeof value.high === 'number') return true;
  return typeof value.low === 'number' && typeof value.high === 'number' && typeof value.toString === 'function';
}

function longToSafeString(value) {
  try {
    if (typeof value.toString === 'function' && value.constructor && value.constructor.name === 'Long') {
      return value.toString();
    }
    const lo = BigInt(value.low >>> 0);
    const hi = BigInt(value.high | 0);
    const combined = (hi << 32n) + lo;
    if (typeof value.unsigned === 'boolean' && value.unsigned) {
      return (hi < 0n ? combined + (1n << 64n) : combined).toString();
    }
    return combined.toString();
  } catch {
    return '[Long inválido]';
  }
}

/** Converte qualquer valor numérico/longo em string sem perder precisão. */
function numericToSafeString(value) {
  if (typeof value === 'bigint') return value.toString();
  if (isLongLike(value)) return longToSafeString(value);
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value;
  return null;
}

function hexDigest(bufferLike, algo = 'sha256') {
  try {
    return crypto.createHash(algo).update(Buffer.from(bufferLike)).digest('hex');
  } catch {
    return null;
  }
}

function binarySummary(value) {
  const buffer = Buffer.from(value.buffer ?? value, value.byteOffset ?? 0, value.byteLength ?? undefined);
  const length = buffer.length;
  const preview = buffer.subarray(0, Math.min(MAX_BINARY_PREVIEW, length)).toString('hex');
  const sha = hexDigest(buffer);
  return {
    __binary: true,
    tipo: value instanceof Buffer ? 'Buffer' : value?.constructor?.name || 'Uint8Array',
    bytes: length,
    previewHex: length ? `${preview}${length > MAX_BINARY_PREVIEW ? '…' : ''}` : '',
    sha256: sha || undefined,
  };
}

function truncateString(value) {
  if (value.length <= MAX_STRING_LEN) return value;
  return `${value.slice(0, MAX_STRING_LEN)}… [truncado, ${value.length} chars]`;
}

// ============================================================================
// SERIALIZACAO SEGURA
// ============================================================================

/**
 * Converte um objeto arbitrario (mensagem do Baileys) em estrutura
 * JSON-serializavel, tratando BigInt/Buffer/Long/circulares e redigindo
 * qualquer campo com aparencia de credencial.
 *
 * @param {*} value valor a serializar
 * @param {{ obscureSensitive?: boolean }} [options]
 * @returns {*} copia segura do valor
 */
export function toSafeObject(value, options = {}) {
  const { obscureSensitive = true } = options;
  const seen = new WeakSet();

  const sensitive = (keyHint) => obscureSensitive && keyHint && SENSITIVE_KEY_PATTERN.test(keyHint);

  const walk = (node, depth, keyHint) => {
    if (node === null) return null;
    if (node === undefined) return undefined;

    // Redação vem antes de qualquer retorno: campos com nome de credencial
    // nunca devem chegar ao relatório, seja string, número ou objeto.
    if (sensitive(keyHint)) return '[REDACTED: campo sensível]';

    const type = typeof node;

    if (type === 'boolean') return node;
    if (type === 'bigint') return `${node}n`;

    if (type === 'number') {
      if (Number.isFinite(node)) return node;
      if (Number.isNaN(node)) return 'NaN';
      return node > 0 ? 'Infinity' : '-Infinity';
    }

    if (type === 'string') return truncateString(node);

    if (type === 'function') return '[Function]';
    if (type === 'symbol') return node.toString();

    if (type !== 'object') return `[${type}]`;

    if (isLongLike(node)) return longToSafeString(node);
    if (isBufferLike(node)) return binarySummary(node);

    if (depth >= MAX_DEPTH) return '[profundidade máxima atingida]';

    if (seen.has(node)) return '[referência circular]';
    seen.add(node);

    try {
      if (node instanceof Date) return node.toISOString();

      if (Array.isArray(node)) {
        const limited = node.slice(0, MAX_ARRAY_ITEMS).map((item) => walk(item, depth + 1, keyHint));
        if (node.length > MAX_ARRAY_ITEMS) {
          limited.push(`[… +${node.length - MAX_ARRAY_ITEMS} itens]`);
        }
        return limited;
      }

      if (isPlainObject(node) || !node.constructor) {
        const out = {};
        const keys = Object.keys(node);
        for (const key of keys.slice(0, MAX_OBJECT_KEYS)) {
          const serialized = walk(node[key], depth + 1, key);
          if (serialized !== undefined) out[key] = serialized;
        }
        if (keys.length > MAX_OBJECT_KEYS) {
          out['__maisCampos'] = `+${keys.length - MAX_OBJECT_KEYS} campos omitidos`;
        }
        return out;
      }

      // Instâncias de classe (ex.: Long de outra lib, objetos exóticos).
      const fallback = {};
      const keys = Object.keys(node).slice(0, MAX_OBJECT_KEYS);
      for (const key of keys) {
        const serialized = walk(node[key], depth + 1, key);
        if (serialized !== undefined) fallback[key] = serialized;
      }
      if (!keys.length) return `[${node.constructor?.name || 'objeto'}]`;
      return fallback;
    } finally {
      // Não removemos do WeakSet de propósito: evita explosão exponencial em
      // estruturas com o mesmo subobjeto repetido (ex.: contextInfo repetido).
    }
  };

  return walk(value, 0, null);
}

/**
 * JSON.stringify tolerante a qualquer estrutura de mensagem do Baileys.
 * Nunca lanca: em ultimo caso devolve uma descricao textual do erro.
 */
export function safeJsonStringify(value, options = {}) {
  const { indent = 2 } = options;
  try {
    return JSON.stringify(toSafeObject(value, options), null, indent);
  } catch (error) {
    return `[falha ao serializar: ${error?.message || error}]`;
  }
}

// ============================================================================
// NORMALIZACAO / CLASSIFICACAO
// ============================================================================

/** Extrai o nome do wrapper de um conteúdo (ex.: viewOnceMessageV2). */
function innerNameOf(content) {
  if (!content || typeof content !== 'object') return null;
  const keys = Object.keys(content);
  return keys.find((k) => (k === 'conversation' || k.includes('Message')) && k !== 'senderKeyDistributionMessage') || null;
}

/**
 * Percorre a cadeia de encapsulamento (viewOnce → ephemeral → media) e devolve
 * o caminho completo, o conteúdo mais interno e a lista de tipos encontrados.
 */
export function resolveTypeChain(content) {
  const chain = [];
  let current = content;
  let guard = 0;

  while (current && typeof current === 'object' && guard < 12) {
    guard += 1;
    const name = innerNameOf(current);
    if (!name) break;
    chain.push(name);

    if (name === 'conversation') {
      return { chain, innerType: 'conversation', innerContent: current, leaf: current };
    }

    const node = current[name];
    const nested = node?.message ?? node?.editedMessage ?? node?.originalMessage ?? node?.groupStatusMessage;

    // Só continua descendo quando o wrapper carrega uma mensagem dentro.
    const looksLikeWrapper = name.includes('Message') && nested && typeof nested === 'object';
    if (!looksLikeWrapper) {
      return { chain, innerType: name, innerContent: current, leaf: node };
    }

    current = nested;
  }

  return {
    chain: chain.length ? chain : ['desconhecido'],
    innerType: chain[chain.length - 1] || 'desconhecido',
    innerContent: current,
    leaf: chain.length ? current?.[chain[chain.length - 1]] : undefined,
  };
}

/** true quando o tipo é reconhecidamente um wrapper de outra mensagem. */
function isWrapperType(name, content) {
  if (!name) return false;
  if (KNOWN_WRAPPERS.includes(name)) return true;
  const node = content?.[name];
  return Boolean(node && typeof node === 'object' && node.message && Object.keys(node.message).length);
}

/** Cadeia de encapsulamento somente com wrappers conhecidos. */
export function wrapperChain(content) {
  const wrappers = [];
  let current = content;
  let guard = 0;
  while (current && typeof current === 'object' && guard < 12) {
    guard += 1;
    const name = innerNameOf(current);
    if (!name || !isWrapperType(name, current)) break;
    wrappers.push(name);
    const node = current[name];
    current = node?.message ?? node?.editedMessage ?? node?.groupStatusMessage;
  }
  return wrappers;
}

// ============================================================================
// COLETA GENÉRICA DE CAMPOS
// ============================================================================

const FIELD_LABELS = {
  mimetype: 'MIME',
  fileName: 'Arquivo',
  fileLength: 'Tamanho (bytes)',
  fileSha256: 'fileSha256',
  fileEncSha256: 'fileEncSha256',
  mediaKey: 'mediaKey',
  mediaKeyTimestamp: 'mediaKeyTimestamp',
  directPath: 'directPath',
  url: 'URL',
  width: 'Largura',
  height: 'Altura',
  seconds: 'Duração (s)',
  ptt: 'PTT (voz)',
  gifPlayback: 'GIF',
  isAnimated: 'Animado',
  caption: 'Legenda',
  title: 'Título',
  description: 'Descrição',
  pageCount: 'Páginas',
  documentPageCount: 'Páginas',
  jpegThumbnail: 'Thumbnail (JPEG)',
  thumbnail: 'Thumbnail',
  packname: 'Pack',
  packId: 'Pack ID',
  author: 'Autor',
  emojis: 'Emojis',
  isAvatar: 'Avatar',
  waveform: 'Waveform',
  streamingSidecar: 'Sidecar',
  firstFrameLength: 'Primeiro frame (bytes)',
  firstFrameSidecar: 'Sidecar do 1º frame',
  latitude: 'Latitude',
  longitude: 'Longitude',
  name: 'Nome',
  vcard: 'vCard',
  displayName: 'Nome exibido',
  contactVcard: 'Contato vCard',
  selectedButtonId: 'Botão selecionado',
  selectedRowId: 'Linha selecionada',
  singleSelectReply: 'Resposta de lista',
  nativeFlowResponseMessage: 'Resposta de flow',
  text: 'Texto',
  contentText: 'Texto',
  hydratedContentText: 'Texto',
  inviteLinkGroupTypeV2: 'Tipo de convite',
  timezone: 'Fuso',
  comment: 'Comentário',
  encrypted: 'Criptografado',
  duration: 'Duração',
  quality: 'Qualidade',
  status: 'Status',
  amount: 'Valor',
  value: 'Valor',
  offset: 'Offset (centavos)',
  currency: 'Moeda',
  currencyCode: 'Moeda',
  currencyCodeIso4217: 'Moeda (ISO 4217)',
  amount1000: 'amount1000',
  requestFrom: 'Solicitado de',
  expiryTimestamp: 'Expira em (timestamp)',
  receiverJid: 'Recebedor',
  transactionData: 'Dados da transação',
  referenceId: 'Referência',
  noteMessage: 'Nota',
  requestMessageKey: 'Chave da solicitação',
  confirmationText: 'Texto de confirmação',
  inviteType: 'Tipo de convite',
  serviceType: 'Serviço',
  referralId: 'Indicação',
  incentiveEligible: 'Elegível a incentivo',
  primaryAmount: 'Valor primário',
  exchangeAmount: 'Valor de câmbio',
  useNoviFiatFormat: 'Formato Novi',
  txnStatus: 'Status da transação',
  futureproofed: 'Futureproofed',
  code: 'Código',
  hexColor: 'Cor (hex)',
  businessOwnerJid: 'Dono do negócio',
  catalogUrl: 'URL do catálogo',
};

export function labelFor(key) {
  return FIELD_LABELS[key] || key;
}

/**
 * Nome exibível de um campo, sem repetir a chave já traduzida.
 */
function fieldLine(path, value) {
  const label = labelFor(path);
  return label === path ? `${path}: ${formatFieldValue(value)}` : `${label} (${path}): ${formatFieldValue(value)}`;
}

/**
 * Coleta recursivamente todos os campos escalares de uma estrutura de mídia /
 * conteúdo, para que tipos desconhecidos continuem sendo inspecionados.
 */
export function collectFields(node, options = {}) {
  const {
    prefix = '',
    out = new Map(),
    depth = 0,
    maxDepth = 4,
    includeBinaryMeta = true,
  } = options;

  if (node === null || node === undefined || typeof node !== 'object') return out;
  if (depth > maxDepth) return out;

  for (const key of Object.keys(node)) {
    const value = node[key];
    if (value === null || value === undefined) continue;

    const path = prefix ? `${prefix}.${key}` : key;

    // Mesma redação aplicada na serialização: campos com nome de credencial
    // não aparecem no relatório por nenhum caminho.
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      out.set(path, '[REDACTED: campo sensível]');
      continue;
    }

    if (isBufferLike(value)) {
      if (includeBinaryMeta) out.set(path, binarySummary(value));
      continue;
    }
    if (isLongLike(value) || typeof value === 'bigint') {
      out.set(path, numericToSafeString(value));
      continue;
    }
    if (typeof value === 'object') {
      if (Array.isArray(value)) {
        // Arrays vazios são ruído no relatório (proto os materializa como []).
        if (value.length) out.set(path, `[array com ${value.length} item(ns)]`);
        continue;
      }
      // Long do protobuf devolve low/high apenas em Object.keys; tratar aqui
      // evita perder precisão ao herdar o tipo Int32 de alguma implementação.
      const ownKeys = Object.keys(value);
      if (ownKeys.length <= 2 && typeof value.toString === 'function' && value.constructor && value.constructor.name !== 'Object') {
        out.set(path, `[${value.constructor.name}] ${String(value)}`);
        continue;
      }
      collectFields(value, { ...options, prefix: path, out, depth: depth + 1, maxDepth });
      continue;
    }
    out.set(path, value);
  }

  return out;
}

/** Formata valor escalar para exibição em uma linha. */
export function formatFieldValue(value) {
  if (value === null) return 'null';
  if (value === undefined) return 'não fornecido';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return value.length > 4000 ? `${value.slice(0, 4000)}… [campo longo, ${value.length} chars]` : value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'bigint') return value.toString();
  if (value && value.__binary) {
    return `${value.tipo}(${value.bytes} bytes)${value.previewHex ? ` hex:${value.previewHex}` : ''}${value.sha256 ? ` sha256:${value.sha256.slice(0, 16)}…` : ''}`;
  }
  if (Array.isArray(value)) return value.map((v) => formatFieldValue(v)).join(', ');
  return String(value);
}

// ============================================================================
// ESTRUTURAS ESPECIAIS
// ============================================================================

/**
 * Classificação barata e defensiva de uma mensagem recebida.
 *
 * Roda ANTES de qualquer trabalho pesado (resolução de LID, banco, mídia) e
 * devolve o mínimo necessário para decidir como tratar a mensagem.
 *
 * Não faz I/O, não serializa a mensagem inteira e não percorre `mentionedJid`
 * — apenas lê os campos que interessam, em tempo constante.
 *
 * @param {object} message conteúdo da mensagem (info.message)
 * @returns {{
 *   type: string|null,          // tipo externo (getContentType-like)
 *   isPayment: boolean,         // requestPaymentMessage / sendPaymentMessage / paymentInvite
 *   isRequestPayment: boolean,
 *   paymentAmount: { raw: *, isZero: boolean, present: boolean },
 *   noteText: string|null,      // texto da nota do payment (raja)
 *   noteContextInfo: object|null,
 *   mentionCount: number,       // quantas menções no contextInfo da NOTA
 *   hasMentions: boolean,
 *   mentionPath: string|null,
 *   isCatalog: boolean,
 *   isViewOnce: boolean,
 *   isEphemeral: boolean,
 *   isForwardedBurst: boolean,  // noteMessage + forwardingScore alto (padrão raja)
 *   heavy: boolean,             // merece tratamento defensivo antes dos handlers
 * }}
 */
export function classifyMessage(message) {
  const empty = {
    type: null, isPayment: false, isRequestPayment: false,
    paymentAmount: { raw: null, isZero: false, present: false, zeroPath: null, innerValue: null },
    noteText: null, noteContextInfo: null,
    mentionCount: 0, hasMentions: false, mentionPath: null,
    isCatalog: false, isViewOnce: false, isEphemeral: false,
    isForwardedBurst: false, heavy: false,
    messageContextInfo: null, hasMessageSecret: false, isInvisiblePayment: false,
    // A classificação NUNCA deixa buraco: sem entrada válida é NORMAL, com os
    // sinais todos em false. Um `undefined` aqui faria o handler tratar uma
    // entrada inesperada como ameaça.
    category: 'NORMAL',
    protectedSelective: false,
    protectedDecryptFailure: false,
    decryptFail: null,
    hasDecryptedContent: false,
    // Sinais de estrutura do transporte: `null` quando não há report, para não
    // inventar evidência numa entrada que nunca os teve.
    reportHasPhash: null,
    reportDensity: null,
    reportSkdmRecentMs: null,
    pairwiseGroupPayload: false,
  };

  if (!message || typeof message !== 'object') return empty;
  // Arrays e strings não são mensagens: devolve o padrão em vez de tentar
  // desembrulhar um formato impossível.
  if (Array.isArray(message) || typeof message === 'string') return empty;

  const type = innerNameOf(message);

  // ── Onde está o CONTEÚDO e onde está o SINAL ──────────────────────────────
  //
  // `classifyMessage` é chamada com dois níveis, de propósito:
  //   - com o CONTEÚDO (`info.message`) — uso original do handler;
  //   - com o `info` inteiro — necessário para o AntiFantasma, porque a fork
  //     anexa `selectiveDistribution` ao `fullMessage` (o info), e numa
  //     mensagem fantasma `info.message` é `undefined`.
  //
  // Por isso: se o objeto tem `key`/`messageStubType` (cara de info), o
  // conteúdo real é `message.message`; senão o próprio objeto já é o conteúdo.
  // Isso mantém os DOIS usos corretos com uma única fonte de verdade.
  const looksLikeInfo = message.key != null || message.messageStubType != null;
  // Numa mensagem fantasma o info NÃO tem `message` (o payload não decifrou):
  // nesse caso o conteúdo é declaradamente AUSENTE, e não o próprio info —
  // cair para o info faria "existe conteúdo" ser sempre verdadeiro e a
  // PROTECTED_DECRYPT_FAILURE nunca seria classificada.
  const contentAbsent = looksLikeInfo && !(message.message && typeof message.message === 'object');
  const contentRoot = contentAbsent
    ? {}
    : (looksLikeInfo ? message.message : message);

  // Desembrulha os wrappers (viewOnce/ephemeral/documentWithCaption/...) antes
  // de procurar payment. O raja pode chegar encapsulado em ViewOnce; sem
  // desembrulhar, o `isPayment` ficaria false e a protecao nao pegaria.
  const { innerContent } = resolveTypeChain(contentRoot);
  const leaf = innerContent && typeof innerContent === 'object' ? innerContent : contentRoot;

  const requestPayment = leaf.requestPaymentMessage || null;
  const sendPayment = leaf.sendPaymentMessage || null;
  const paymentInvite = leaf.paymentInviteMessage || null;
  const isPayment = Boolean(requestPayment || sendPayment || paymentInvite);

  // O texto do "raja" vive dentro da NOTA do pagamento, não em conversation.
  const noteMessage = requestPayment?.noteMessage || sendPayment?.noteMessage || null;
  const noteExt = noteMessage?.extendedTextMessage || null;
  const noteText = noteExt?.text ?? noteMessage?.conversation ?? null;
  const noteContextInfo = noteExt?.contextInfo || noteMessage?.contextInfo || null;

  const noteMentions = noteContextInfo?.mentionedJid;
  const mentionCount = Array.isArray(noteMentions) ? noteMentions.length : 0;

  // amount1000 pode vir como string "0", número 0 ou Long — sem converter nada.
  const rawAmount = requestPayment ? requestPayment.amount1000 : null;
  const amountPresent = requestPayment ? Object.prototype.hasOwnProperty.call(requestPayment, 'amount1000') : false;
  const amountIsNull = rawAmount === null || rawAmount === undefined;
  const amountStr = amountIsNull ? '' : String(rawAmount).trim();
  const amountZeroish = amountStr !== '' && ZERO_LIKE.test(amountStr);

  // O card também desaparece quando `amount1000` simplesmente não vem e só
  // `amount.value` está zerado. O fallback é condicional de propósito: quando o
  // campo principal existe e tem valor, ele manda — assim um pagamento legítimo
  // (amount1000 = 1500) não vira "invisível" por causa do campo interno.
  const primarySpeaks = amountPresent && !amountIsNull && !amountZeroish;
  const innerAmountStr = requestPayment?.amount?.value === null || requestPayment?.amount?.value === undefined
    ? ''
    : String(requestPayment.amount.value).trim();
  const innerAmountZeroish = innerAmountStr !== '' && ZERO_LIKE.test(innerAmountStr);

  // Qual caminho provou o zero. O relatório do !get precisa saber disso para não
  // afirmar "amount1000 = 0" quando o campo nem veio no proto.
  const amountZeroPath = amountZeroish ? 'amount1000'
    : (!primarySpeaks && innerAmountZeroish) ? 'amount.value'
    : null;
  const isZero = amountZeroPath !== null;

  const forwardedScore = noteContextInfo?.forwardingScore;
  const isForwardedBurst = Boolean(noteExt && (noteContextInfo?.isForwarded === true || (typeof forwardedScore === 'number' && forwardedScore >= 100)));

  // `messageContextInfo` fica no TOPO do Message (irmao do requestPaymentMessage),
  // nao dentro dele. O Baileys inclui `messageSecret` (reporting token) ao ENVIAR
  // quase qualquer tipo de mensagem, entao a presenca do campo, sozinha, NAO
  // identifica nada: e apenas um sinal de anomalia para o relatorio do !get.
  const contextInfoTop = message.messageContextInfo || leaf.messageContextInfo || null;
  const hasMessageSecret = Boolean(contextInfoTop?.messageSecret);

  const isCatalog = Boolean(leaf.productMessage || leaf.catalogMessage || leaf.orderMessage || leaf.interactiveMessage?.nativeFlowMessage?.name === 'mpm');
  const isViewOnce = Boolean(message.viewOnceMessage || message.viewOnceMessageV2 || message.viewOnceMessageV2Extension);
  const isEphemeral = Boolean(message.ephemeralMessage || message.viewOnceMessageV2Extension);

  // "heavy" = merece proteção antes dos handlers caros (não significa bloquear).
  const heavy = isPayment || mentionCount > 50 || isCatalog;

  // Estado malformado medido: card de pagamento SEM valor. É o que faz o
  // WhatsApp não renderizar a mensagem (o "raja invisível"). O `messageSecret`
  // chegou a ser tratado como assinatura, mas a amostra real do dono não o
  // carrega, então o marcador é o valor zerado — em `amount1000` ou em
  // `amount.value`.
  const isInvisiblePayment = isPayment && isZero;

  // ── Classificação central do AntiFantasma ────────────────────────────────
  //
  // Ponto ÚNICO onde o "que é esta mensagem" é decidido, para os comandos não
  // repetirem o mesmo conjunto de `if`s. É apenas RÓTULO: não decide punição
  // (isso continua no handler, com as guardas de admin/whitelist/dedup).
  //
  // A ordem reflete a especificidade: primeiro o pagamento (que é verificável
  // no próprio payload), depois os estados de transporte que só existem quando
  // a fork marca `selectiveDistribution`.
  //
  // `PROTECTED_*` são os estados do mecanismo de distribuição seletiva — o
  // `decrypt-fail="hide"` combinado com a falha de decifragem que a fork
  // reporta. Compatibilidade: `protectedSelective` é o MESMO booleano que o
  // handler já usava lendo `info.selectiveDistribution`, então nada que dependa
  // daquilo quebra.
  // O sinal pode estar em DOIS lugares, dependendo de com o que a função foi
  // chamada: no `info` (a fork anexa ao fullMessage) ou no próprio conteúdo
  // (se algum dia for colocado ali). Os dois são aceitos para não depender de
  // qual nível o chamador passou.
  const selectiveReport = message.selectiveDistribution ?? contentRoot.selectiveDistribution ?? null;
  // A fork atribui um RELATÓRIO (objeto). Aceita também `true`, de
  // implementações que só sinalizam a presença.
  const protectedSelective = selectiveReport != null && selectiveReport !== false;
  const decryptFail = typeof selectiveReport === 'object' && selectiveReport !== null
    ? (selectiveReport.decryptFail ?? null)
    : null;

  // ── Sinais de ESTRUTURA do transporte (aditivos) ─────────────────────────
  //
  // O `decrypt-fail` é ligado pelo remetente; estes não dependem da boa vontade
  // dele, então são o que corrobora um ataque de verdade:
  //   • `hasPhash` — ausente na stanza rotacionada (o fan-out normal carrega);
  //   • `density` — endereçados ÷ dispositivos do grupo;
  //   • `skdmRecentMs` — SenderKeyDistributionMessage fresco do mesmo autor.
  // Só fazem sentido quando HÁ report; sem ele ficam `null` (nunca inventados).
  const temReport = typeof selectiveReport === 'object' && selectiveReport !== null;
  const reportHasPhash = temReport && Object.prototype.hasOwnProperty.call(selectiveReport, 'hasPhash')
    ? selectiveReport.hasPhash
    : null;
  const reportDensity = temReport && typeof selectiveReport.density === 'number'
    ? selectiveReport.density
    : null;
  const reportSkdmRecentMs = temReport && typeof selectiveReport.skdmRecentMs === 'number'
    ? selectiveReport.skdmRecentMs
    : null;
  // Stanza de grupo com enc pareado (transport do retry) — vem do fullMessage.
  const pairwiseGroupPayload = message.pairwiseGroupPayload === true
    || contentRoot.pairwiseGroupPayload === true;
  // Mensagem sem payload decifrável: veio CONTEÚDO de verdade? (o stub de
  // grupo). A classificação distingue "não veio nada" de "veio e é pagamento
  // zerado".
  //
  // O teste tem de ser sobre o CONTEÚDO, não sobre `leaf`: quando não há
  // conteúdo, `leaf` cai no próprio objeto passado (o info), que TEM chaves —
  // usar `Object.keys(leaf)` diria "tem conteúdo" sempre. Aqui olhamos o
  // conteúdo resolvido a partir do wrapper.
  const resolvedContent = innerContent && typeof innerContent === 'object' ? innerContent : null;
  const declaredContent = contentRoot && typeof contentRoot === 'object' && contentRoot !== message
    ? contentRoot
    : null;
  const hasDecryptedContent = Boolean(
    (resolvedContent && Object.keys(resolvedContent).length > 0)
    || (declaredContent && Object.keys(declaredContent).length > 0)
  );
  const protectedDecryptFailure = protectedSelective && !hasDecryptedContent;

  let category;
  if (isZero) {
    category = 'PAYMENT_ZERO';
  } else if (protectedDecryptFailure) {
    category = 'PROTECTED_DECRYPT_FAILURE';
  } else if (protectedSelective) {
    category = 'PROTECTED_SELECTIVE';
  } else {
    category = 'NORMAL';
  }

  return {
    type, isPayment,
    isRequestPayment: Boolean(requestPayment),
    paymentAmount: { raw: rawAmount ?? null, isZero, present: amountPresent, zeroPath: amountZeroPath, innerValue: innerAmountStr || null },
    noteText: typeof noteText === 'string' ? noteText : null,
    noteContextInfo,
    mentionCount,
    hasMentions: mentionCount > 0,
    mentionPath: mentionCount > 0 ? 'requestPaymentMessage.noteMessage.extendedTextMessage.contextInfo.mentionedJid' : null,
    isCatalog, isViewOnce, isEphemeral, isForwardedBurst, heavy,
    messageContextInfo: contextInfoTop,
    hasMessageSecret,
    isInvisiblePayment,
    // Categoria central + os sinais que a compõem (o handler consome isto em um
    // lugar só, em vez de espalhar verificações).
    category,
    protectedSelective,
    protectedDecryptFailure,
    decryptFail,
    hasDecryptedContent,
    // Sinais de estrutura do transporte (null quando não há report).
    reportHasPhash,
    reportDensity,
    reportSkdmRecentMs,
    pairwiseGroupPayload,
  };
}

/**
 * Verifica se algum campo do objeto contém uma assinatura textual, sem
 * serializar. É seguro contra referências circulares e tipos especiais — ao
 * contrário de JSON.stringify, que lança em ambos os casos.
 *
 * @param {*} node objeto a inspecionar
 * @param {string} needle texto procurado (case-insensitive)
 * @param {number} [maxDepth]
 * @returns {boolean}
 */
export function hasTextSignature(node, needle, maxDepth = 8) {
  const wanted = String(needle).toLowerCase();
  const seen = new WeakSet();

  const walk = (value, depth) => {
    if (depth > maxDepth) return false;
    if (typeof value === 'string') return value.toLowerCase().includes(wanted);
    if (value === null || typeof value !== 'object') return false;
    if (isBufferLike(value)) return false;
    if (seen.has(value)) return false;
    seen.add(value);

    for (const key of Object.keys(value)) {
      if (key.toLowerCase().includes(wanted)) return true;
      if (walk(value[key], depth + 1)) return true;
    }
    return false;
  };

  return walk(node, 0);
}

/** Localiza recursivamente todas as chaves cujo nome contém um termo. */
export function findKeysDeep(root, matcher, options = {}) {
  const hits = [];
  const seen = new WeakSet();
  const { maxDepth = 8, maxHits = 40 } = options;
  const walk = (node, path, depth) => {
    if (hits.length >= maxHits) return;
    if (!node || typeof node !== 'object' || depth > maxDepth) return;
    if (isBufferLike(node)) return;
    if (seen.has(node)) return;
    seen.add(node);

    for (const key of Object.keys(node)) {
      const value = node[key];
      const nextPath = path ? `${path}.${key}` : key;
      if (matcher(key)) {
        hits.push({ path: nextPath, key, value });
        if (hits.length >= maxHits) return;
      }
      if (value && typeof value === 'object') walk(value, nextPath, depth + 1);
    }
  };

  walk(root, '', 0);
  return hits;
}

/** Estruturas de pagamento em qualquer profundidade da mensagem. */
export function findPaymentStructures(root) {
  const hits = findKeysDeep(root, (key) => /payment|money|invoice|transaction|requestFrom|amount/i.test(key), { maxHits: 60 });
  const byPath = new Map();
  for (const hit of hits) {
    if (!byPath.has(hit.path)) byPath.set(hit.path, hit);
  }
  return [...byPath.values()];
}

const ZERO_LIKE = /^(-?0+)(\.0+)?$/;

/**
 * Classifica um campo numérico distinguiindo ausência real de zero.
 * @returns {{ estado: string, valor: string|null }}
 */
export function classifyAmount(value, present) {
  if (!present || value === undefined) return { estado: 'ausente (campo não enviado no proto)', valor: null };
  if (value === null) return { estado: 'null explícito', valor: null };
  if (isLongLike(value)) {
    const str = longToSafeString(value);
    const isZero = ZERO_LIKE.test(str);
    return { estado: isZero ? 'presente com valor "0"' : 'presente com valor diferente de "0"', valor: str };
  }
  if (typeof value === 'bigint') {
    return { estado: value === 0n ? 'presente com valor "0"' : 'presente com valor diferente de "0"', valor: value.toString() };
  }
  if (typeof value === 'number') {
    return { estado: value === 0 ? 'presente com valor "0"' : 'presente com valor diferente de "0"', valor: String(value) };
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const isZero = ZERO_LIKE.test(trimmed);
    return { estado: isZero ? 'presente com valor "0"' : 'presente com valor diferente de "0"', valor: value };
  }
  return { estado: typeof value, valor: String(value) };
}

/** Monta a seção de pagamento a partir do conteúdo alvo. */
export function buildPaymentReport(rawMessage, webMessage) {
  const message = normalizeInput(rawMessage);
  const { innerType, innerContent } = resolveTypeChain(message);
  const leaf = innerContent?.[innerType] || {};

  const paymentTypesPresent = PAYMENT_MESSAGE_TYPES.filter((type) => Boolean(message[type]));
  const hitsDeep = findPaymentStructures(message).filter(
    (hit) => /payment|invoice|transaction|money/i.test(hit.path) || /amount|requestFrom|expiry|currency|receiverJid/i.test(hit.key),
  );

  const webPaymentInfo = webMessage?.paymentInfo ? { paymentInfo: webMessage.paymentInfo } : {};
  const webQuotedPaymentInfo = webMessage?.quotedPaymentInfo ? { quotedPaymentInfo: webMessage.quotedPaymentInfo } : {};

  if (!paymentTypesPresent.length && !hitsDeep.length && !webMessage?.paymentInfo && !webMessage?.quotedPaymentInfo) {
    return { isPayment: false, lines: [] };
  }

  const lines = [];
  const isRequestPayment = paymentTypesPresent.includes('requestPaymentMessage');
  const isSendPayment = paymentTypesPresent.includes('sendPaymentMessage');

  if (isRequestPayment) lines.push('📌 *Tipo: Request Payment*');
  if (isSendPayment) lines.push('📌 *Tipo: Send Payment*');
  lines.push(`💳 *SEÇÃO PAYMENT*`);
  lines.push(`• Estruturas de pagamento encontradas: ${paymentTypesPresent.length ? paymentTypesPresent.join(', ') : '(apenas campos aninhados)'}`);

  for (const type of paymentTypesPresent) {
    const node = message[type] || {};
    lines.push('');
    lines.push(`*${type}*`);
    const fields = collectFields(node, { maxDepth: 3 });
    if (!fields.size) lines.push('• Estrutura vazia.');
    for (const [path, value] of fields) {
      lines.push(`• ${fieldLine(path, value)}`);
    }
  }

  // Campos de pagamento que não estão dentro de um tipo conhecido.
  const nested = hitsDeep.filter((hit) => !paymentTypesPresent.some((type) => hit.path.startsWith(type)));
  if (nested.length) {
    lines.push('');
    lines.push('*Campos aninhados*');
    for (const hit of nested) {
      if (hit.value && typeof hit.value === 'object' && !isLongLike(hit.value) && !isBufferLike(hit.value)) {
        lines.push(`• ${hit.path} → objeto {${Object.keys(hit.value).join(', ') || 'vazio'}}`);
        for (const [path, value] of collectFields(hit.value, { maxDepth: 2 })) {
          lines.push(`   - ${fieldLine(path, value)}`);
        }
      } else {
        lines.push(`• ${hit.path}: ${formatFieldValue(hit.value)}`);
      }
    }
  }

  // ------------------------------------------------------------- análise de valor
  const amountFields = findKeysDeep(message, (key) => /^amount|^value$|^offset$|amount1000/i.test(key), { maxHits: 24 });
  const currencyFields = findKeysDeep(message, (key) => /^currency/i.test(key), { maxHits: 8 });

  if (amountFields.length || currencyFields.length) {
    lines.push('');
    lines.push('💰 *ANÁLISE DE VALOR*');
    for (const field of amountFields) {
      const { estado, valor } = classifyAmount(field.value, true);
      lines.push(`• ${field.path}: ${valor ?? '(sem valor)'} → ${estado}`);
    }
    for (const field of currencyFields) {
      lines.push(`• ${field.path}: ${formatFieldValue(field.value)}`);
    }
    lines.push('_Um campo ausente e um campo com valor "0" são situações diferentes: o primeiro não foi enviado no proto, o segundo foi explicitamente zerado._');
    // Diagnóstico direto do estado que torna o card invisível, com o caminho que
    // provou o zero — sem afirmar "amount1000 = 0" quando o campo nem veio.
    const zeroCheck = classifyMessage(message);
    if (zeroCheck.isPayment) {
      const pa = zeroCheck.paymentAmount;
      if (pa.isZero) {
        lines.push(`🎯 *Estado malformado:* card de pagamento SEM valor (zero em \`${pa.zeroPath}\`).`);
        lines.push('   - É essa combinação que faz o WhatsApp não renderizar a mensagem.');
      } else {
        lines.push('✅ Card de pagamento com valor presente — não é o estado malformado.');
      }
    }
  }

  if (Object.keys(webPaymentInfo).length) {
    lines.push('');
    lines.push('🧾 *paymentInfo (WebMessageInfo)*');
    appendPaymentInfo(lines, webMessage.paymentInfo, 'paymentInfo');
  }
  if (Object.keys(webQuotedPaymentInfo).length) {
    lines.push('');
    lines.push('🧾 *quotedPaymentInfo (WebMessageInfo)*');
    appendPaymentInfo(lines, webMessage.quotedPaymentInfo, 'quotedPaymentInfo');
  }

  // Contexto/participantes envolvidos no fluxo de pagamento
  const participantKeys = findKeysDeep(leaf, (key) => /^(requestFrom|receiverJid|participant|sender|recipient)$/i.test(key), { maxHits: 10 });
  if (participantKeys.length) {
    lines.push('');
    lines.push('👤 *Participantes do pagamento*');
    for (const hit of participantKeys) {
      lines.push(`• ${hit.path}: ${describeIdentifier(hit.value, 'any')}`);
    }
  }

  return { isPayment: true, lines };
}

function appendPaymentInfo(lines, info, label) {
  const fields = collectFields(info, { maxDepth: 3 });
  if (!fields.size) lines.push(`• ${label} sem campos escalares.`);
  for (const [path, value] of fields) {
    lines.push(`• ${fieldLine(`${label}.${path}`, value)}`);
  }
  const amountFields = findKeysDeep(info, (key) => /^amount|^value$/i.test(key), { maxHits: 8 });
  for (const field of amountFields) {
    const { estado, valor } = classifyAmount(field.value, true);
    lines.push(`• ${label}.${field.path}: ${valor ?? '(sem valor)'} → ${estado}`);
  }
}

/**
 * Aceita tanto um objeto de conteúdo ({ imageMessage: ... }) quanto um
 * WebMessageInfo ({ message: {...} }) e devolve sempre o conteúdo.
 * Isso mantém os builders reutilizáveis a partir de qualquer chamador.
 */
function normalizeInput(input) {
  if (!input || typeof input !== 'object') return {};
  if (input.message && typeof input.message === 'object') return input.message;
  return input;
}

/** Monta a seção de ViewOnce. */
export function buildViewOnceReport(rawMessage) {
  const message = normalizeInput(rawMessage);
  const wrappers = wrapperChain(message);
  const viewOnceTypes = ['viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension'];
  const present = viewOnceTypes.filter((t) => message[t]);

  if (!present.length) {
    return { isViewOnce: false, lines: [] };
  }

  const lines = ['👁️ *SEÇÃO VIEW ONCE*'];
  lines.push(`• É ViewOnce: Sim`);
  lines.push(`• Versão: ${present.join(', ')}`);
  lines.push(`• Cadeia de encapsulamento: ${wrappers.length ? wrappers.join(' -> ') : '(vazia)'}`);

  for (const type of present) {
    const node = message[type];
    const inner = node?.message;
    const innerType = innerNameOf(inner) || 'desconhecido';
    lines.push(`• ${type} → mensagem interna: ${innerType}`);
    if (inner?.[innerType]) {
      lines.push(`• ViewOnce (node.${type}.viewOnce): ${node.viewOnce === undefined ? 'não fornecido' : formatFieldValue(node.viewOnce)}`);
      const innerMedia = inner[innerType];
      const hasThumb = Boolean(innerMedia?.jpegThumbnail || innerMedia?.thumbnail);
      lines.push(`• Thumbnail interna: ${hasThumb ? 'Sim' : 'Não'}`);
      lines.push(`• mediaKey interna: ${innerMedia?.mediaKey ? formatFieldValue(binarySummary(Buffer.from(innerMedia.mediaKey))) : 'não fornecida'}`);
      lines.push(`• MIME interna: ${innerMedia?.mimetype ?? 'não fornecido'}`);
    }
  }

  const v1 = message.viewOnceMessage?.message;
  if (v1) {
    lines.push(`• Legenda/caption V1: ${v1.imageMessage?.caption || v1.videoMessage?.caption || 'não fornecida'}`);
  }

  return { isViewOnce: true, lines };
}

/**
 * Monta a seção de `messageContextInfo` (envelope).
 *
 * Fica no TOPO do Message, como irmão do tipo da mensagem — por isso não
 * aparecia em nenhuma seção do relatório. É onde vive o `messageSecret`, que é
 * a assinatura do raja "invisível": um requestPaymentMessage carregando
 * messageSecret é o estado malformado que impede o card de renderizar.
 */
export function buildMessageContextReport(rawMessage) {
  const message = normalizeInput(rawMessage);
  const ctx = message.messageContextInfo;

  if (!ctx || typeof ctx !== 'object' || !Object.keys(ctx).length) {
    return {
      hasContext: false,
      hasSecret: false,
      lines: [
        '• Sem `messageContextInfo` nesta mensagem.',
        '   - O Baileys só adiciona esse envelope ao ENVIAR (generateWAMessageContent),',
        '     então a AUSÊNCIA aqui não prova nada sobre a mensagem original —',
        '     o fragmento citado pode não carregar o envelope.',
      ],
    };
  }

  const lines = [];
  const hasSecret = Boolean(ctx.messageSecret);

  lines.push('• messageContextInfo presente: Sim');
  lines.push(`• messageSecret: ${hasSecret ? 'PRESENTE' : 'ausente'}`);
  if (hasSecret) {
    const buf = Buffer.from(ctx.messageSecret);
    const sha = hexDigest(buf);
    lines.push(`   - bytes: ${buf.length}`);
    lines.push(`   - hex: ${buf.toString('hex')}`);
    if (sha) lines.push(`   - sha256: ${sha}`);
    // Explicação no próprio relatório, para o diagnóstico não depender de
    // interpretação de quem lê. O `messageSecret` acompanha quase todo tipo de
    // mensagem (é o reporting token do Baileys), então PRESENÇA não é assinatura
    // de nada; é a COMBINAÇÃO com um card de pagamento sem valor que caracteriza
    // o estado malformado.
    lines.push('   - ⚠️ presente JUNTO com payment sem valor = estado malformado (card não renderiza)');
    lines.push('   - ℹ️ sozinho NÃO é assinatura: o reporting token acompanha quase todo tipo de mensagem');
  }
  if (ctx.botMessageSecret) {
    lines.push(`• botMessageSecret: presente (${Buffer.from(ctx.botMessageSecret).length} bytes)`);
  }
  if (ctx.deviceListMetadata) {
    const dm = ctx.deviceListMetadata;
    lines.push(`• deviceListMetadata: presente (recipientKeyHash ${dm.recipientKeyHash ? 'sim' : 'não'})`);
  }
  if (ctx.deviceListMetadataVersion !== undefined && ctx.deviceListMetadataVersion !== null) {
    lines.push(`• deviceListMetadataVersion: ${ctx.deviceListMetadataVersion}`);
  }
  if (ctx.paddingBytes) {
    lines.push(`• paddingBytes: ${Buffer.from(ctx.paddingBytes).length} bytes`);
  }

  const conhecidos = new Set([
    'messageSecret', 'botMessageSecret', 'deviceListMetadata',
    'deviceListMetadataVersion', 'paddingBytes',
  ]);
  // Diagnóstico genérico: o envelope pode ganhar campos novos a qualquer
  // momento, então tudo que não foi mapeado acima também aparece.
  for (const k of Object.keys(ctx)) {
    if (conhecidos.has(k)) continue;
    lines.push(`• ${k}: ${formatFieldValue(ctx[k])}`);
  }

  return { hasContext: true, hasSecret, lines };
}

/** Monta a seção de menções. */
export function buildMentionsReport(rawMessage) {
  const keys = findKeysDeep(normalizeInput(rawMessage), (key) => /mentionedJid|groupMentions|nonJidMentions|statusMentions/i.test(key), { maxHits: 20 });

  if (!keys.length) {
    return { mentions: [], total: 0, truncated: false, lines: ['• Nenhuma menção detectada na mensagem (mentionedJid ausente).'] };
  }

  const lines = [];
  const allMentions = new Set();
  let total = 0;
  let truncated = false;

  for (const hit of keys) {
    const value = hit.value;
    if (Array.isArray(value)) {
      lines.push(`• ${hit.path}: ${value.length} item(ns)`);
      // Conta e coleta TODAS as menções; só a EXIBIÇÃO é limitada. Antes o
      // resumo informava 25 enquanto o proto tinha 348, porque o contador saía
      // da lista já truncada para leitura.
      total += value.length;
      for (const item of value) {
        if (typeof item === 'string') allMentions.add(item);
      }
      for (const item of value.slice(0, MAX_MENTIONS_DISPLAYED)) {
        if (typeof item === 'string') {
          const kind = item.endsWith('@lid') ? 'LID' : item.endsWith('@s.whatsapp.net') ? 'JID (PN)' : item.endsWith('@g.us') ? 'Grupo' : 'outro';
          lines.push(`   - ${item}  [${kind}]`);
        } else if (item && typeof item === 'object') {
          lines.push(`   - ${Object.entries(item).map(([k, v]) => `${k}=${formatFieldValue(v)}`).join(' | ')}`);
        }
      }
      if (value.length > MAX_MENTIONS_DISPLAYED) {
        truncated = true;
        lines.push(`   … +${value.length - MAX_MENTIONS_DISPLAYED} itens (exibição limitada; a contagem acima é o total real)`);
      }
    } else {
      lines.push(`• ${hit.path}: ${formatFieldValue(value)}`);
    }
  }

  // Resumo LID x JID do conjunto completo (útil no diagnóstico de rajada).
  const lidCount = [...allMentions].filter((m) => m.endsWith('@lid')).length;
  const pnCount = [...allMentions].filter((m) => m.endsWith('@s.whatsapp.net')).length;
  if (total > 0) {
    lines.push(`• Total real de menções: ${total} (únicas: ${allMentions.size})`);
    lines.push(`• Composição: ${lidCount} LID / ${pnCount} JID (PN)`);
    if (total > 50) {
      lines.push('• ⚠️ Volume de menções muito acima do normal — padrão típico de rajada.');
    }
  }

  const mentionAll = Array.from(allMentions).some((m) => /^(all|todos)@/i.test(m));
  lines.push(`• Menção a todos: ${mentionAll ? 'Sim' : 'Não detectada'}`);

  return { mentions: [...allMentions], total, truncated, lines };
}

/** Seção de contexto / citação. */
export function buildContextReport(rawMessage) {
  const message = normalizeInput(rawMessage);
  const contexts = findKeysDeep(message, (key) => key === 'contextInfo', { maxHits: 6 });
  if (!contexts.length) {
    return { hasContext: false, lines: ['• Sem contextInfo nesta mensagem.'] };
  }

  const lines = [];
  let quote = null;

  for (const ctx of contexts) {
    const ci = ctx.value;
    if (!ci || typeof ci !== 'object') continue;

    lines.push(`• Contexto em: ${ctx.path}`);
    lines.push(`   - stanzaId (mensagem citada): ${ci.stanzaId ?? 'não fornecido'}`);
    lines.push(`   - participant (autor citado): ${ci.participant ?? 'não fornecido'}`);
    lines.push(`   - remoteJid (chat citado): ${ci.remoteJid ?? 'não fornecido'}`);
    lines.push(`   - quotedMessage: ${ci.quotedMessage ? 'Sim' : 'não fornecido'}`);

    if (ci.quotedMessage) {
      const quotedType = innerNameOf(ci.quotedMessage);
      quote = { type: quotedType, content: ci.quotedMessage, contextInfo: ci, path: ctx.path };
      lines.push(`   - Tipo da mensagem citada: ${quotedType || 'desconhecido'}`);
      const previewText = quotedPreview(ci.quotedMessage);
      if (previewText) lines.push(`   - Prévia do conteúdo citado: ${previewText}`);
    }

    for (const field of ['mentionedJid', 'expiration', 'ephemeralSettingTimestamp', 'forwardingScore', 'isForwarded', 'conversionSource', 'expiration', 'placeholderKey', 'parentGroupJid', 'groupSubject', 'isSampled', 'isSpoiler', 'nonJidMentions', 'rankingVersion', 'pairedMediaType', 'afterReadDuration']) {
      if (ci[field] === undefined) continue;
      if (field === 'mentionedJid') {
        lines.push(`   - mentionedJid: ${Array.isArray(ci[field]) ? `${ci[field].length} item(ns)` : formatFieldValue(ci[field])}`);
      } else {
        lines.push(`   - ${field}: ${formatFieldValue(ci[field])}`);
      }
    }

    if (ci.externalAdReply) {
      lines.push(`   - externalAdReply: presente`);
      for (const [k, v] of Object.entries(ci.externalAdReply).slice(0, 20)) {
        lines.push(`      • ${k}: ${formatFieldValue(v)}`);
      }
    }
    if (ci.forwardedNewsletterMessageInfo) {
      lines.push(`   - newsletter de origem: ${formatFieldValue(ci.forwardedNewsletterMessageInfo.newsletterName || ci.forwardedNewsletterMessageInfo.newsletterJid)}`);
    }
    if (ci.disappearingMode) {
      lines.push(`   - disappearingMode: ${Object.entries(ci.disappearingMode).map(([k, v]) => `${k}=${formatFieldValue(v)}`).join(' | ')}`);
    }
  }

  return { hasContext: true, lines, quote };
}

/** Prévia textual de uma mensagem citada. */
export function quotedPreview(quotedMessage) {
  if (!quotedMessage) return '';
  const { innerType, innerContent } = resolveTypeChain(quotedMessage);
  const node = innerContent?.[innerType];
  const candidates = [
    innerContent?.conversation,
    node?.text,
    node?.caption,
    node?.fileName,
    node?.title,
    node?.name,
    node?.selectedButtonId,
    node?.singleSelectReply?.selectedRowId,
  ];
  const text = candidates.find((c) => typeof c === 'string' && c.length);
  return text ? truncateString(text) : '';
}

/** Seção de mídia (imagem/vídeo/áudio/documento/sticker). */
export function buildMediaReport(content) {
  const { innerType, innerContent } = resolveTypeChain(content);
  const MEDIA_TYPES = {
    imageMessage: 'Imagem',
    videoMessage: 'Vídeo',
    audioMessage: 'Áudio',
    pttMessage: 'Áudio (voz)',
    documentMessage: 'Documento',
    documentWithCaptionMessage: 'Documento com legenda',
    stickerMessage: 'Sticker',
    lottieStickerMessage: 'Sticker animado (lottie)',
  };

  if (!MEDIA_TYPES[innerType]) return { lines: [] };

  const node = innerContent?.[innerType] || {};
  const lines = [`📎 *${MEDIA_TYPES[innerType].toUpperCase()}*`];
  const fields = collectFields(node);

  for (const [path, value] of fields) {
    lines.push(`• ${fieldLine(path, value)}`);
  }

  if (!fields.size) lines.push('• Nenhum metadado exposto pelo Baileys para esta mídia.');

  return { lines };
}

// ============================================================================
// RELATORIO PRINCIPAL
// ============================================================================

function tsToDate(timestamp) {
  const num = typeof timestamp === 'number' ? timestamp : Number(numericToSafeString(timestamp));
  if (!Number.isFinite(num) || num <= 0) return null;
  try {
    return new Date(num * 1000).toISOString();
  } catch {
    return null;
  }
}

/**
 * Divide um texto longo em partes que cabem no limite de mensagem do WhatsApp.
 *
 * O limite é em BYTES (não caracteres) e o relatório é cheio de multibyte
 * (acentos/emojis), então medimos bytes. O corte acontece SEMPRE em quebra de
 * linha, para nunca partir um caractere nem uma linha do relatório no meio.
 *
 * @param {string} text texto completo
 * @param {number} maxBytes limite por parte (em bytes UTF-8)
 * @returns {string[]} partes na ordem original
 */
export function splitTextForWhatsApp(text, maxBytes = 55000) {
  const content = String(text ?? '');
  if (!content) return [''];
  if (Buffer.byteLength(content, 'utf8') <= maxBytes) return [content];

  const parts = [];
  let current = [];

  const flush = () => {
    if (current.length) {
      parts.push(current.join('\n'));
      current = [];
    }
  };

  for (const rawLine of content.split('\n')) {
    let line = rawLine;
    // Uma única linha maior que o limite (ex.: RAW minificado) precisa ser
    // fatiada por conta própria; fatiamos por code point para não corromper.
    while (Buffer.byteLength(line, 'utf8') > maxBytes) {
      flush();
      const chars = Array.from(line);
      let slice = '';
      let size = 0;
      let taken = 0;
      for (const ch of chars) {
        const chSize = Buffer.byteLength(ch, 'utf8');
        if (size + chSize > maxBytes) break;
        slice += ch;
        size += chSize;
        taken += 1;
      }
      parts.push(slice);
      line = chars.slice(taken).join('');
    }

    const candidate = current.concat(line).join('\n');
    if (Buffer.byteLength(candidate, 'utf8') > maxBytes) {
      flush();
    }
    current.push(line);
  }

  flush();
  return parts;
}

/**
 * Descreve um identificador individual (JID ou LID), deixando explícito quando
 * o campo não existe em vez de simplesmente ocultá-lo.
 */
export function describeIdentifier(value, expected = 'any') {
  if (value === undefined) return 'não existe / não fornecido';
  if (value === null) return 'null';
  if (typeof value !== 'string' || !value.length) return formatFieldValue(value);

  const server = value.split('@')[1] || '';
  const kind = server === 'lid' ? 'LID'
    : server === 's.whatsapp.net' || server === 'c.us' ? 'JID (número)'
    : server === 'g.us' ? 'JID de grupo'
    : server === 'newsletter' ? 'JID de canal'
    : server === 'broadcast' ? 'JID de broadcast'
    : 'JID (outro domínio)';

  const mismatch = (expected === 'lid' && server !== 'lid') || (expected === 'jid' && (server === 'lid' || !server));
  return `${value} [${kind}]${mismatch ? ' ⚠️ (formato diferente do esperado — pode indicar fallback da conversão)' : ''}`;
}

function describeChat(remoteJid) {
  if (!remoteJid) return 'desconhecido';
  if (!remoteJid.includes('@')) return `Outro (${remoteJid})`;
  const server = remoteJid.split('@')[1] || '';
  if (remoteJid.endsWith('@g.us')) return 'Grupo';
  if (remoteJid.endsWith('@newsletter')) return 'Canal/Newsletter';
  if (remoteJid.endsWith('@broadcast')) return remoteJid.includes('status') ? 'Status' : 'Broadcast';
  if (remoteJid.endsWith('@lid')) return 'Privado (endereçado por LID)';
  if (remoteJid.endsWith('@s.whatsapp.net')) return 'Privado (endereçado por PN)';
  if (remoteJid.endsWith('@hosted')) return 'Privado (hosted)';
  return `Outro (${remoteJid.split('@')[1] || 'sem servidor'})`;
}

function labelFromEnum(enumObject, value) {
  if (enumObject == null || value === undefined || value === null) return null;
  try {
    const numeric = typeof value === 'number' ? value : Number(numericToSafeString(value));
    if (!Number.isFinite(numeric)) return null;
    return enumObject[numeric] ?? null;
  } catch {
    return null;
  }
}

/**
 * Gera o relatório completo do comando !get.
 *
 * @param {object} params
 * @param {object} params.info        WebMessageInfo recebido pelo handler
 * @param {object|null} params.cached informação completa buscada no messagesCache
 * @param {object} [params.extra]     dados auxiliares já resolvidos pelo index.js
 * @param {boolean} [params.summaryOnly] retorna apenas o resumo inicial
 * @returns {{summary: string, full: string}}
 */
/**
 * Gera o relatório completo do comando !get.
 *
 * O alvo é a mensagem MARCADA (citada). Quando o bot tem a mensagem original
 * completa no cache interno, ela é usada; caso contrário usamos o fragmento
 * que veio no contextInfo.quotedMessage — deixando claro qual foi a fonte.
 *
 * @param {object} params
 * @param {object} params.info      WebMessageInfo da mensagem de comando
 * @param {object|null} params.target mensagem alvo a inspecionar
 * @param {'cache'|'contextInfo'|'self'} params.origin fonte do alvo
 * @param {object|null} params.quotedContext contextInfo da citação
 * @param {object} [params.extra]   dados auxiliares resolvidos pelo index.js
 * @returns {{summary: string, full: string}}
 */
export function buildMessageReport({ info, target = null, origin = 'self', quotedContext = null, envelope = null, extra = {} }) {
  const targetMessage = target?.message || target || {};
  // Envelope do evento que trouxe o comando (stubType, paymentInfo, labels...).
  // Quando o alvo é a própria mensagem do comando, o envelope é ela mesma.
  const commandEnvelope = envelope || info || null;

  // Um WebMessageInfo "sintético" permite reaproveitar o mesmo relatório para
  // as três origens (cache completo, fragmento citado, mensagem própria).
  const source = target?.message
    ? target
    : { key: quotedContext ? { remoteJid: quotedContext.remoteJid, id: quotedContext.stanzaId, participant: quotedContext.participant } : info?.key, message: targetMessage };

  const key = source?.key || info?.key || {};

  const outerType = innerNameOf(targetMessage) || 'desconhecido';
  const { chain, innerType, innerContent } = resolveTypeChain(targetMessage);
  const wrappers = wrapperChain(targetMessage);

  const lines = [];
  const push = (text = '') => lines.push(text);
  const section = (title) => {
    push('');
    push('━━━━━━━━━━━━━━━━━━');
    push(`*${title}*`);
  };
  const row = (label, value) => push(`• ${label}: ${value === undefined || value === null || value === '' ? 'não fornecido' : value}`);

  // ------------------------------------------------------------------ cabeçalho
  // O summary já abre com "🔎 *GET MESSAGE*"; aqui vai só o "Detalhes completos:"
  // para não repetir o título quando o relatório é enviado logo em seguida.
  push('*Detalhes completos*');
  push('');
  push(`• Fonte do alvo: ${ORIGIN_LABEL[origin] || origin}`);

  // ------------------------------------------------------------- identificação
  section('IDENTIFICAÇÃO');
  row('Tipo externo', outerType);
  row('Tipo interno', innerType);
  row('Cadeia de tipos', chain.join(' -> '));
  row('Encapsulamento', wrappers.length ? wrappers.join(' -> ') : 'nenhum (mensagem direta)');
  row('ID da mensagem alvo', key.id);
  row('Timestamp', timestampOf(source));
  row('FromMe', key.fromMe === undefined ? 'não fornecido (desconhecido para mensagens citadas)' : key.fromMe);
  row('PushName', source?.pushName ?? info?.pushName);
  row('Status', describeStatus(source?.status));
  row('verifiedBizName', source?.verifiedBizName);
  row('Categoria', source?.category);
  row('Broadcast', source?.broadcast);
  row('Participant (autor) — alvo', key.participant);
  row('Participant (autor) — comando', info?.key?.participant);
  row('fromMe do comando', info?.key?.fromMe);
  row('Origem do bot (comando)', extra.isBotSender ? 'próprio bot' : 'terceiro');
  row('Enviada pelo próprio bot (comando)', info?.key?.fromMe ? 'Sim' : 'Não');
  row('Possui participant', key.participant ? 'Sim' : 'Não');

  // ----------------------------------------------------------------- identidade
  section('IDENTIDADE (JID / LID)');
  row('remoteJid (chat)', key.remoteJid);
  row('remoteJidAlt', key.remoteJidAlt);
  row('remoteJidUsername', key.remoteJidUsername);
  row('participant', key.participant);
  row('participantAlt (PN/LID alternativo)', key.participantAlt);
  row('participantUsername', key.participantUsername);
  row('addressingMode', key.addressingMode);
  row('senderPn', key.senderPn ?? '<campo inexistente nesta versão do Baileys>');
  row('senderLid', key.senderLid ?? '<campo inexistente nesta versão do Baileys>');
  row('recipient', key.recipient);
  row('server_id', key.server_id);
  row('Sender resolvido (handler)', extra.sender);
  row('Sender original antes da conversão p/ LID', extra.senderJidOriginal);

  push('');
  push('*JID (número) x LID (identificador interno)*');
  const identity = extra.identity || {};
  push(`• JID do remetente: ${describeIdentifier(identity.senderJid, 'jid')}`);
  push(`• LID do remetente: ${describeIdentifier(identity.senderLid, 'lid')}`);
  push(`• JID do chat: ${describeIdentifier(identity.chatJid, 'jid')}`);
  push(`• LID do chat: ${identity.chatLid === null ? 'não aplicável (chat não é conversa individual)' : describeIdentifier(identity.chatLid, 'lid')}`);
  push(`• JID do participant: ${describeIdentifier(identity.participantJid, 'jid')}`);
  push(`• LID do participant: ${describeIdentifier(identity.participantLid, 'lid')}`);
  push(`• JID do autor citado (contextInfo.participant): ${describeIdentifier(identity.quotedAuthorJid ?? quotedContext?.participant ?? key.participant, 'jid')}`);
  push(`• LID do autor citado: ${describeIdentifier(identity.quotedAuthorLid, 'lid')}`);
  push(`• Chat onde a mensagem alvo está: ${describeIdentifier(key.remoteJid, 'any')}`);
  if (commandEnvelope?.key?.remoteJid && commandEnvelope.key.remoteJid !== key.remoteJid) {
    push(`• Chat onde o comando foi digitado: ${describeIdentifier(commandEnvelope.key.remoteJid, 'any')}`);
  }
  push(`• recipient (destinatário do protocolo): ${describeIdentifier(key.recipient, 'any')}`);
  push(`• remoteJidAlt (contraparte do chat): ${describeIdentifier(key.remoteJidAlt, 'any')}`);
  push(`• participantAlt (contraparte do participant): ${describeIdentifier(key.participantAlt, 'any')}`);
  push(`• remetente PN<->LID mapeado pelo Baileys: ${identity.mapped ? 'Sim' : 'Não (ou não resolvido)'}`);
  push('_JID e LID são identificadores distintos: o JID carrega o número, o LID é o identificador interno._');

  const knownKeyFields = [
    'remoteJid', 'remoteJidAlt', 'remoteJidUsername', 'fromMe', 'id', 'participant',
    'participantAlt', 'participantUsername', 'addressingMode', 'senderPn', 'senderLid',
    'recipient', 'server_id',
  ];
  const otherKeyFields = Object.keys(key).filter((k) => !knownKeyFields.includes(k));
  if (otherKeyFields.length) {
    row('Outros campos de key', otherKeyFields.map((k) => `${k}=${formatFieldValue(key[k])}`).join(' | '));
  }

  // ----------------------------------------------------------------------- chat
  section('CHAT');
  row('RemoteJid', key.remoteJid);
  row('Tipo de chat', describeChat(key.remoteJid));
  row('É grupo', key.remoteJid?.endsWith('@g.us') ? 'Sim' : 'Não');
  row('Participant', key.participant);
  row('Nome do grupo', extra.groupName);
  row('Total de membros', extra.groupMemberCount);
  row('Cargo do autor no grupo', extra.senderIsAdmin === true ? 'Administrador' : extra.senderIsAdmin === false ? 'Membro' : 'não verificado');

  // ------------------------------------------------------------------ conteúdo
  section('CONTEÚDO');
  row('Tipo do conteúdo', innerType);
  const leafContent = innerContent?.[innerType] ?? innerContent;
  const contentFields = collectFields(leafContent, { maxDepth: 3 });
  for (const [path, value] of contentFields) {
    if (typeof value === 'string' && value.length > 400) {
      push(`• ${labelFor(path)} (${path}):`);
      push(value);
      continue;
    }
    row(`${labelFor(path)} (${path})`, formatFieldValue(value));
  }
  if (!contentFields.size) {
    push('• Nenhum campo escalar no nível principal — estrutura inspecionada genericamente abaixo.');
  }

  // ------------------------------------------------------------------ viewOnce
  const viewOnce = buildViewOnceReport(targetMessage);
  if (viewOnce.isViewOnce) {
    section('VIEW ONCE');
    for (const line of viewOnce.lines) push(line);
  }

  // ------------------------------------------------------------------- payment
  // paymentInfo/quotedPaymentInfo vivem no WebMessageInfo do envelope, não no proto interno do alvo.
  const payment = buildPaymentReport(targetMessage, commandEnvelope);
  if (payment.isPayment) {
    section('PAYMENT');
    for (const line of payment.lines) push(line);
  }

  // ------------------------------------------------------- messageContextInfo
  // Fica no topo do Message (irmao do tipo), por isso precisa de secao propria:
  // e onde vive o messageSecret que caracteriza o raja invisivel.
  const msgCtx = buildMessageContextReport(targetMessage);
  section('MESSAGE CONTEXT INFO (envelope)');
  for (const line of msgCtx.lines) push(line);

  // ------------------------------------------------------------------- mentions
  section('MENTIONS');
  const mentions = buildMentionsReport(targetMessage);
  for (const line of mentions.lines) push(line);
  // O comando em si também pode carregar menções (fora da mensagem alvo).
  if (origin !== 'self') {
    const commandMentions = buildMentionsReport(commandEnvelope?.message || {});
    const detected = commandMentions.mentions.filter((m) => !mentions.mentions.includes(m));
    if (detected.length) {
      push('');
      push('*Menções no comando (não no alvo)*');
      for (const item of detected) {
        push(`• ${describeIdentifier(item, 'any')}`);
      }
    }
  }

  // -------------------------------------------------------------------- context
  section('CONTEXT');
  const context = buildContextReport(targetMessage);
  for (const line of context.lines) push(line);
  if (quotedContext) {
    push(`• ContextInfo da citação recebida (${extra.quotedPath || 'contextInfo'}):`);
    push(`   - stanzaId: ${quotedContext.stanzaId ?? 'não fornecido'}`);
    push(`   - participant: ${quotedContext.participant ?? 'não fornecido'}`);
    push(`   - remoteJid: ${quotedContext.remoteJid ?? 'não fornecido'}`);
  }

  // ---------------------------------------------------------------------- media
  const media = buildMediaReport(targetMessage);
  if (media.lines.length) {
    section('MEDIA');
    for (const line of media.lines) push(line);
  }

  // ------------------------------------------------------------- mensagens especiais
  section('MENSAGENS ESPECIAIS');
  for (const line of buildSpecialReport(targetMessage, source)) push(line);

  // ---------------------------------------------------- estrutura do envelopamento
  if (origin !== 'self') {
    section('ENVELOPE RECEBIDO (WebMessageInfo do comando)');
    push('_Dados do evento que trouxe o comando: aqui ficam stubType, paymentInfo e afins._');
    const envFields = Object.keys(commandEnvelope || {}).filter((f) => f !== 'key' && f !== 'message');
    if (envFields.length) {
      for (const field of envFields) {
        const value = commandEnvelope[field];
        if (value === undefined) continue;
        push(`• ${field}: ${summarizeTopLevel(value)}`);
      }
    } else {
      push('• Sem campos adicionais além de key/message.');
    }

    const stubInfo = [];
    if (commandEnvelope?.messageStubType !== undefined) {
      stubInfo.push(`StubType: ${describeStubType(commandEnvelope.messageStubType)}`);
    }
    if (commandEnvelope?.messageStubParameters?.length) {
      stubInfo.push(`StubParameters: ${formatFieldValue(commandEnvelope.messageStubParameters)}`);
    }
    if (stubInfo.length) {
      push('');
      push('*STUB / EVENTO*');
      for (const line of stubInfo) push(`• ${line}`);
    }
  }

  // ---------------------------------------------------- estrutura do alvo
  section('ESTRUTURA DO ALVO (WebMessageInfo)');
  const topFields = Object.keys(source || {});
  for (const field of topFields) {
    if (field === 'key' || field === 'message') continue;
    const value = source[field];
    if (value === undefined) continue;
    push(`• ${field}: ${summarizeTopLevel(value)}`);
  }
  if (!topFields.filter((f) => f !== 'key' && f !== 'message').length) {
    push('• Sem campos adicionais além de key/message.');
  }

  // --------------------------------------------------------------- árvore do proto
  section('CAMPOS DO PROTO (safe)');
  push('```');
  push(safeJsonStringify(targetMessage, { indent: 2 }));
  push('```');

  // ------------------------------------------------------------------ raw message
  section('RAW MESSAGE');
  push('```');
  push(safeJsonStringify(source, { indent: 2 }));
  push('```');

  const full = lines.join('\n');

  const summaryLines = [
    '🔎 *GET MESSAGE*',
    '',
    `• Fonte: ${ORIGIN_LABEL[origin] || origin}`,
    `• Tipo: ${outerType}${chain.length > 1 ? ` (cadeia: ${chain.join(' -> ')})` : ''}`,
    `• ID: ${key.id ?? 'não fornecido'}`,
    `• Timestamp: ${timestampOf(source) || 'não fornecido'}`,
    `• FromMe: ${key.fromMe ?? 'não fornecido'}`,
    `• PushName: ${source?.pushName ?? info?.pushName ?? 'não fornecido'}`,
    `• Chat: ${key.remoteJid ?? 'não fornecido'} (${describeChat(key.remoteJid)})`,
    `• Participant: ${key.participant ?? 'não fornecido'}`,
    `• ViewOnce: ${viewOnce.isViewOnce ? 'Sim' : 'Não'}`,
    `• Payment: ${payment.isPayment ? 'Sim (ver seção PAYMENT)' : 'Não'}`,
    `• messageSecret (envelope): ${msgCtx.hasSecret ? 'presente (não é assinatura sozinho)' : 'ausente'}`,
    `• Menções: ${mentions.total ? `${mentions.total} no alvo${mentions.truncated ? ' (exibição limitada)' : ''}` : 'nenhuma no alvo'}`,
    `• Encaminhada: ${hasTextSignature({ t: targetMessage, c: commandEnvelope?.message }, 'isForwarded') ? 'Sim (campo isForwarded presente)' : 'Não detectada'}`,
    `• Citação interna: ${context.quote ? `${context.quote.type || 'desconhecido'} (${context.quote.contextInfo?.stanzaId || 'sem id'})` : 'não'}`,
    '',
    '_Detalhes técnicos completos abaixo._',
  ];

  return { summary: summaryLines.join('\n'), full };
}

const ORIGIN_LABEL = {
  cache: 'cache interno (mensagem original completa)',
  contextInfo: 'contextInfo.quotedMessage (fragmento entregue pelo WhatsApp)',
  self: 'a própria mensagem do comando (sem citação)',
};

function summarizeTopLevel(value) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return formatFieldValue(binarySummary(value));
  if (Array.isArray(value)) return `array(${value.length})`;
  if (value && typeof value === 'object') {
    if (isLongLike(value)) return longToSafeString(value);
    const keys = Object.keys(value).slice(0, 12);
    return keys.length ? `objeto {${keys.join(', ')}}` : 'objeto vazio';
  }
  return formatFieldValue(value);
}

function timestampOf(webMessage) {
  const ts = webMessage?.messageTimestamp;
  const raw = numericToSafeString(ts);
  const date = tsToDate(raw);
  if (!raw) return null;
  return date ? `${raw} (${date})` : raw;
}

function describeStatus(status) {
  if (status === undefined || status === null) return 'não fornecido';
  const label = labelFromEnum(statusLabelMap, status);
  return label ? `${numericToSafeString(status)} (${label})` : formatFieldValue(status);
}

let statusLabelMap = null;

function buildSpecialReport(rawMessage, source) {
  const lines = [];
  const message = normalizeInput(rawMessage);
  const outerType = innerNameOf(message);
  const add = (condition, text) => {
    if (condition) lines.push(`• ${text}`);
  };

  add(outerType === 'reactionMessage', `Reação: emojis=${message.reactionMessage?.text ?? 'n/a'} | alvo=${message.reactionMessage?.key?.id ?? 'n/a'}`);
  add(Boolean(message.pollCreationMessage || message.pollCreationMessageV2 || message.pollCreationMessageV3 || message.pollCreationMessageV4), 'Enquete (poll creation)');
  add(Boolean(message.pollUpdateMessage), `Voto de enquete: criador=${message.pollUpdateMessage?.pollCreationMessageKey?.id ?? 'n/a'}`);
  add(Boolean(message.contactMessage || message.contactsArrayMessage), 'Contato(s) compartilhado(s)');
  add(Boolean(message.locationMessage || message.liveLocationMessage), 'Localização');
  add(Boolean(message.eventMessage), 'Evento de agenda');
  add(Boolean(message.buttonsMessage || message.buttonsResponseMessage), 'Mensagem com botões');
  add(Boolean(message.listMessage || message.listResponseMessage), 'Mensagem de lista');
  add(Boolean(message.interactiveMessage || message.interactiveResponseMessage), 'Mensagem interativa');
  add(Boolean(message.templateMessage || message.templateButtonReplyMessage), 'Template');
  add(Boolean(message.ephemeralMessage || message.messageContextInfo?.expiration || message.imageMessage?.expiration), 'Mensagem temporária (disappearing)');
  add(Boolean(message.protocolMessage), `ProtocolMessage tipo=${describeProtocolType(message.protocolMessage?.type)}`);
  add(Boolean(message.editedMessage), 'Edição de mensagem');
  add(Boolean(message.ptvMessage), 'Vídeo mensagem (PTV)');
  add(Boolean(message.albumMessage), 'Álbum');
  add(Boolean(message.productMessage || message.orderMessage), 'Catálogo/pedido');
  add(Boolean(message.keepInChatMessage), 'Keep in chat');
  add(Boolean(message.newsletterAdminInviteMessage), 'Convite de newsletter');
  add(Boolean(message.requestPhoneNumberMessage), 'Solicitação de número');
  add(Boolean(message.pinInChatMessage), 'Fixar mensagem');
  add(Boolean(source?.messageStubType !== undefined), `StubType: ${describeStubType(source?.messageStubType)}`);
  add(Boolean(source?.messageStubParameters?.length), `StubParameters: ${formatFieldValue(source?.messageStubParameters)}`);
  add(Boolean(source?.labels?.length), `Labels: ${formatFieldValue(source?.labels)}`);
  add(Boolean(source?.reactions?.length), `Reações acumuladas: ${source?.reactions?.length ?? 0}`);
  add(Boolean(source?.pollUpdates?.length), `Votos acumulados: ${source?.pollUpdates?.length ?? 0}`);

  // Varredura genérica: qualquer contexto de citação aninhado também conta.
  const forwardHits = findKeysDeep(message, (k) => k === 'isForwarded', { maxHits: 8 })
    .filter((hit) => hit.value === true || hit.value === 'true');
  const forwarded = forwardHits.length > 0;
  add(forwarded, `Mensagem encaminhada (isForwarded=true em ${forwardHits.map((h) => h.path).join(', ')})`);

  const scoreHits = findKeysDeep(message, (k) => k === 'forwardingScore', { maxHits: 8 });
  add(scoreHits.length > 0, `forwardingScore: ${scoreHits.map((h) => `${h.path}=${formatFieldValue(h.value)}`).join(', ')}`);

  if (!lines.length) lines.push('• Nenhuma estrutura especial reconhecida; use a seção RAW para investigar.');
  return lines;
}

let stubLabelMap = null;
let protocolTypeMap = null;

export function describeStubType(value) {
  if (value === undefined || value === null) return 'não fornecido';
  if (!stubLabelMap) stubLabelMap = {};
  const numeric = typeof value === 'number' ? value : Number(numericToSafeString(value));
  if (!Number.isFinite(numeric)) return formatFieldValue(value);
  return `${numeric}${stubLabelMap[numeric] ? ` (${stubLabelMap[numeric]})` : ''}`;
}

export function describeProtocolType(value) {
  if (value === undefined || value === null) return 'não fornecido';
  if (!protocolTypeMap) protocolTypeMap = {};
  const numeric = typeof value === 'number' ? value : Number(numericToSafeString(value));
  if (!Number.isFinite(numeric)) return formatFieldValue(value);
  const known = { 0: 'REVOKE', 3: 'EPHEMERAL_SETTING', 4: 'EPHEMERAL_SYNC_RESPONSE', 5: 'HISTORY_SYNC_NOTIFICATION', 11: 'SHARE_PHONE_NUMBER', 14: 'MESSAGE_EDIT', 30: 'GROUP_MEMBER_LABEL_CHANGE', 32: 'MESSAGE_UNSCHEDULE' };
  const label = protocolTypeMap[numeric] || known[numeric];
  return `${numeric}${label ? ` (${label})` : ''}`;
}

/**
 * Permite que o chamador (index.js) injete os mapas de enum do Baileys sem
 * criar dependencia do pacote dentro deste modulo.
 */
export function registerEnumLabels({ status, stub, protocol } = {}) {
  if (status) statusLabelMap = status;
  if (stub) stubLabelMap = stub;
  if (protocol) protocolTypeMap = protocol;
}
