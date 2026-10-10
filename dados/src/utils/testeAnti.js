// Analisador do comando `!testeanti` (teste, por grupo).
//
// Porte ESM do analisador "BypassKN Defensive Guard v2.0.0" (CommonJS),
// recebido em `dados/bypasskn.zip`. A logica de varredura/classificacao foi
// mantida identica; alem dela o wrapper `detectarAnomalia` le sinais de
// ENVELOPE (stub/nao decifrada e distribuicao seletiva), que o pacote original
// nao olhava.
//
// E "pos-decodificacao": roda sobre o objeto que o Baileys ja entregou. Nao
// intercepta protobuf, transporte, decrypt nem download de midia.

export const TEXT_FIELDS_BY_TYPE = Object.freeze({
  conversation: [''], extendedTextMessage: ['text'], imageMessage: ['caption'], videoMessage: ['caption'],
  documentMessage: ['caption', 'fileName'], audioMessage: [], stickerMessage: [],
  locationMessage: ['name', 'address'], liveLocationMessage: ['caption'], contactMessage: ['displayName'],
  contactsArrayMessage: [], listMessage: ['title', 'description', 'buttonText', 'footerText'],
  buttonsMessage: ['contentText', 'footerText'], templateMessage: ['hydratedTemplate', 'fourRowTemplate'],
  pollCreationMessage: ['name'], pollCreationMessageV2: ['name'], pollCreationMessageV3: ['name'],
  eventMessage: ['name', 'description', 'location'], productMessage: ['title', 'description'],
  requestPhoneNumberMessage: [], paymentInviteMessage: ['serviceType'],
  declinePaymentRequestMessage: ['key'], cancelPaymentRequestMessage: ['key']
});

export const WRAPPER_KEYS = new Set([
  'ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension',
  'documentWithCaptionMessage', 'editedMessage', 'deviceSentMessage'
]);

export const STRUCTURAL_STRING_KEYS = new Set([
  'id', 'key', 'jid', 'remoteJid', 'participant', 'fileName', 'mimetype', 'mediaKey', 'fileSha256',
  'fileEncSha256', 'messageSecret', 'token', 'url', 'directPath', 'thumbnailDirectPath', 'serviceType',
  'currency', 'amount', 'timestamp', 'stanzaId'
]);

export const KNOWN_TYPES = new Set(Object.keys(TEXT_FIELDS_BY_TYPE).concat([
  'protocolMessage', 'senderKeyDistributionMessage', 'messageContextInfo', 'reactionMessage', 'stickerPackMessage',
  'groupInviteMessage', 'groupMentionMessage', 'pinInChatMessage', 'keepInChatMessage', 'pollUpdateMessage',
  'listResponseMessage', 'buttonsResponseMessage', 'templateButtonReplyMessage', 'interactiveResponseMessage',
  'requestPaymentMessage', 'paymentRequestMessage', 'paymentInviteMessage', 'encryptedReactionMessage'
]));

const ASCII_TEXT_KEYS = ['text', 'caption', 'name', 'description', 'title', 'address', 'contentText', 'footerText', 'buttonText', 'displayName', 'conversation'];

export const DEFAULT_TESTEANTI_CONFIG = Object.freeze({
  maxDepth: 10,
  maxNodes: 2500,
  maxProperties: 12000,
  maxArrayItems: 600,
  maxStringChars: 100000,
  suspiciousTextChars: 2000,
  severeTextChars: 100000,
  maxFindings: 80
});

const isPlainContainer = (v) => v !== null && typeof v === 'object' && !Buffer.isBuffer(v) && !(v instanceof Date);

export function measureContent(root, options = {}) {
  const limits = { ...DEFAULT_TESTEANTI_CONFIG, ...options };
  const findings = [];
  const reasons = [];
  const seen = new WeakSet();
  let nodes = 0, properties = 0, arrays = 0, strings = 0, truncated = false;
  const add = (f) => { if (findings.length < limits.maxFindings) findings.push(f); else truncated = true; };
  const stop = (why) => { truncated = true; if (!reasons.includes(why)) reasons.push(why); };

  function visit(value, path, depth, parentType, keyName) {
    if (++nodes > limits.maxNodes) { stop('maxNodes'); return; }
    if (depth > limits.maxDepth) { stop('maxDepth'); return; }
    if (typeof value === 'string') {
      strings++;
      const field = keyName || '';
      const structural = STRUCTURAL_STRING_KEYS.has(field);
      const textLike = !structural && (field === ''
        || ASCII_TEXT_KEYS.includes(field)
        || TEXT_FIELDS_BY_TYPE[parentType]?.includes(field));
      if (textLike && value.length > limits.suspiciousTextChars) {
        const severe = value.length >= limits.severeTextChars;
        add({ code: severe ? 'TEXT_LENGTH_SEVERE' : 'TEXT_LENGTH_HIGH', path, length: value.length, limit: severe ? limits.severeTextChars : limits.suspiciousTextChars });
      }
      if (value.length > limits.maxStringChars) { add({ code: 'STRING_RESOURCE_LIMIT', path, length: value.length, limit: limits.maxStringChars }); stop('maxStringChars'); }
      return;
    }
    if (!isPlainContainer(value)) return;
    if (seen.has(value)) { add({ code: 'CIRCULAR_REFERENCE', path }); return; }
    seen.add(value);
    if (Array.isArray(value)) {
      arrays++;
      if (value.length > limits.maxArrayItems) { add({ code: 'ARRAY_TOO_LARGE', path, length: value.length, limit: limits.maxArrayItems }); stop('maxArrayItems'); }
      const n = Math.min(value.length, limits.maxArrayItems);
      for (let i = 0; i < n && nodes <= limits.maxNodes; i++) visit(value[i], `${path}[${i}]`, depth + 1, parentType, String(i));
      return;
    }
    let entries;
    try { entries = Object.entries(value); } catch { add({ code: 'OBJECT_ENUMERATION_FAILED', path }); return; }
    properties += entries.length;
    if (properties > limits.maxProperties) {
      add({ code: 'PROPERTY_RESOURCE_LIMIT', path, count: properties, limit: limits.maxProperties });
      stop('maxProperties');
      entries = entries.slice(0, Math.max(0, limits.maxProperties - (properties - entries.length)));
    }
    const ownTypeKeys = entries.filter(([k]) => Object.hasOwn(TEXT_FIELDS_BY_TYPE, k));
    if (depth === 0 && ownTypeKeys.length > 1) add({ code: 'MULTIPLE_ROOT_MESSAGE_TYPES', path, types: ownTypeKeys.map(([k]) => k).slice(0, 10) });
    for (const [k, child] of entries) {
      if (nodes > limits.maxNodes || (truncated && reasons.includes('maxProperties'))) break;
      const nextType = Object.hasOwn(TEXT_FIELDS_BY_TYPE, k) ? k : parentType;
      visit(child, path ? `${path}.${k}` : k, depth + 1, nextType, k);
    }
  }

  visit(root, '', 0, null, '');
  return { findings, truncated, truncationReasons: reasons, counters: { nodes, properties, arrays, strings }, limits };
}

export function inspectMessageRoot(message) {
  const root = message?.message;
  if (!root || typeof root !== 'object' || Array.isArray(root)) {
    return { validRoot: false, types: [], wrapperDepth: 0, leafType: null, flags: ['MISSING_OR_INVALID_MESSAGE_ROOT'] };
  }
  const flags = [];
  const types = Object.keys(root);
  const seen = new Set();
  if (types.length === 0) flags.push('EMPTY_MESSAGE_ROOT');
  if (types.length > 1) flags.push('MULTIPLE_MESSAGE_TYPES_AT_ROOT');
  let current = root, wrapperDepth = 0, leafType = null;
  while (current && typeof current === 'object' && !Array.isArray(current)) {
    const keys = Object.keys(current);
    const wrapper = keys.find((k) => WRAPPER_KEYS.has(k) && current[k] && typeof current[k] === 'object' && current[k].message && typeof current[k].message === 'object');
    if (!wrapper) { leafType = keys.find((k) => KNOWN_TYPES.has(k)) || keys[0] || null; break; }
    if (seen.has(current)) { flags.push('WRAPPER_CYCLE'); break; }
    seen.add(current);
    wrapperDepth++;
    current = current[wrapper].message;
    if (wrapperDepth > 10) { flags.push('WRAPPER_DEPTH_EXCEEDED'); break; }
  }
  if (leafType && !KNOWN_TYPES.has(leafType)) flags.push('UNKNOWN_LEAF_TYPE');
  return { validRoot: true, types, wrapperDepth, leafType, flags };
}

export function analyzeMessage(message, options = {}) {
  const structural = inspectMessageRoot(message);
  const content = measureContent(message?.message ?? message, options);
  const findings = [];
  for (const f of structural.flags) findings.push({ code: f, severity: f === 'UNKNOWN_LEAF_TYPE' ? 'low' : 'medium' });
  for (const f of content.findings) {
    findings.push({ ...f, severity: (f.code === 'TEXT_LENGTH_SEVERE' || f.code.includes('RESOURCE_LIMIT') || f.code === 'ARRAY_TOO_LARGE') ? 'high' : 'medium' });
  }
  if (content.truncated) findings.push({ code: 'ANALYSIS_INCOMPLETE', severity: 'medium', reasons: content.truncationReasons });
  const high = findings.some((f) => f.severity === 'high');
  const medium = findings.some((f) => f.severity === 'medium');
  const classification = high ? 'HIGH_SEVERITY_REVIEW' : medium ? 'SUSPICIOUS_REVIEW' : 'NORMAL_OR_UNCONFIRMED';
  return {
    classification,
    validRoot: structural.validRoot,
    messageTypes: structural.types,
    leafType: structural.leafType,
    wrapperDepth: structural.wrapperDepth,
    findings: findings.slice(0, options.maxFindings ?? DEFAULT_TESTEANTI_CONFIG.maxFindings),
    contentCounters: content.counters,
    analysisTruncated: content.truncated
  };
}

const SEVERITY_RANK = { NORMAL: 0, MEDIA: 1, ALTA: 2 };

/**
 * Decide se a mensagem recebida esta "fora dos padroes".
 *
 * Combina o analisador de conteudo (porte do BypassKN) com dois sinais de
 * ENVELOPE que ele nao olhava e que sao justamente as violacoes que motivaram
 * o comando:
 *   - STUB_UNDECRYPTABLE: mensagem que nao decifrou (stub "Message absent from
 *     node"); ela nem chega a ter conteudo para o analisador varrer.
 *   - SELECTIVE_DISTRIBUTION: o relatorio de distribuicao seletiva de Sender
 *     Key (a mensagem "invisivel").
 *
 * @param {object} info WebMessageInfo que o Baileys entregou
 * @param {object} [options] limites do analisador + severidade minima
 * @returns {{ anomalia: boolean, severidade: string, motivos: string[] }}
 */
export function detectarAnomalia(info, options = {}) {
  const motivos = [];
  let severidade = 'NORMAL';
  const sobe = (sev) => { if ((SEVERITY_RANK[sev] ?? 0) > (SEVERITY_RANK[severidade] ?? 0)) severidade = sev; };

  if (info && typeof info === 'object') {
    if (info.messageStubType !== undefined && info.messageStubType !== null) {
      motivos.push('STUB_UNDECRYPTABLE');
      severidade = 'ALTA';
    }
    const sel = info.selectiveDistribution;
    if (sel !== undefined && sel !== null && sel !== false) {
      motivos.push('SELECTIVE_DISTRIBUTION');
      severidade = 'ALTA';
    }
  }

  let analise = null;
  // So' analisa o CONTEUDO quando existe um corpo de mensagem. Sem corpo
  // (stub/reacao/protocolo) a varredura por si so nao e' anomalia -- o sinal
  // util nesse caso e' o do ENVELOPE, checado acima.
  const corpo = info?.message;
  const temConteudo = corpo && typeof corpo === 'object' && !Array.isArray(corpo) && Object.keys(corpo).length > 0;
  if (temConteudo) {
    try {
      analise = analyzeMessage(info, options);
    } catch {
      analise = null;
    }
  }

  if (analise) {
    if (analise.classification === 'HIGH_SEVERITY_REVIEW') {
      severidade = 'ALTA';
      for (const f of analise.findings) {
        if (f.severity === 'high' && !motivos.includes(f.code)) motivos.push(f.code);
      }
    } else if (analise.classification === 'SUSPICIOUS_REVIEW') {
      sobe('MEDIA');
      for (const f of analise.findings) {
        if (f.severity === 'medium' && !motivos.includes(f.code)) motivos.push(f.code);
      }
    }
  }

  if (motivos.length === 0) return { anomalia: false, severidade: 'NORMAL', motivos: [] };
  return { anomalia: true, severidade, motivos };
}
