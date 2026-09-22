/**
 * invisibleAnalyzer.js
 *
 * Analisador FORENSE de mensagem invisivel/fantasma.
 *
 * PRINCIPIO
 * ---------
 * Nao existe `if (message.invisible)`. O que existe e um conjunto de
 * caracteristicas OBSERVAVEIS no objeto que o Baileys entregou (o
 * WebMessageInfo ja decodificado, mais os campos de transporte que a fork
 * anexa) e a CORRELACAO entre elas. Cada caracteristica sozinha tem peso
 * limitado; a classificacao final vem da soma e das combinacoes.
 *
 * FALSO POSITIVO E O RISCO REAL
 * -----------------------------
 * `@lid`, pagamento, `noteMessage`, `decrypt-fail` e ate distribuicao seletiva
 * aparecem em fluxo benigno. Por isso:
 *   - indicadores ambiguos (stub CIPHERTEXT, LID, wrapper aninhado) valem
 *     pouco sozinhos e nunca elevam a "fortemente compativel";
 *   - a classificacao distingue NORMAL / ATIPICA / SUSPEITA / FORTEMENTE
 *     COMPATIVEL / INCONCLUSIVA — sem "100% invisivel";
 *   - nada e inventado: campo ausente vira "NÃO DISPONIVEL".
 *
 * SEPARACAO DE CAMADAS
 * --------------------
 *   mensagem -> analyzeInvisibleMessage() -> resultado estruturado -> formatador
 *
 * Este modulo NAO formata texto e NAO toca rede/disco/socket. Ele e puro, o que
 * permite reutilizar o mesmo resultado no `!get`, no anti, em logs e em testes.
 *
 * LIMITES HONESTOS (o que NAO da para observar nesta camada)
 * ---------------------------------------------------------
 *   - o `<enc type="skmsg">` cru e consumido pela fork ANTES de o evento
 *     chegar ao handler: so vemos a consecuencia (`selectiveDistribution`);
 *   - material criptografico (chainKey, signingKey, mediaKey) nunca e exposto;
 *     quando aparece, vai como digest/contagem;
 *   - reuso de ID entre mensagens so e detectavel com um conjunto de IDs ja
 *     vistos — fora isso, marcamos como "NÃO DISPONIVEL".
 *
 * Arquitetura de detectores (cada responsabilidade isolada):
 *   KeyAnalyzer, LidAnalyzer, DistributionAnalyzer, DecryptionAnalyzer,
 *   SenderKeyAnalyzer, PaymentAnalyzer, ContextInfoAnalyzer,
 *   QuotedMessageAnalyzer, WrapperAnalyzer, StubAnalyzer, ProtobufAnalyzer
 *   (campos desconhecidos) e CorrelationEngine.
 */

// ============================================================================
// CATALOGO DE INDICADORES
// ============================================================================

/**
 * Cada indicador tem id, nome, categoria, severidade, peso e o que significa.
 * Os pesos foram calibrados por evidencia tecnica (ver docs no AGENTS.md), nao
 * por arbitrariedade:
 *
 *   fortes (estruturais, fora do controle do remetente): phash ausente,
 *   densidade baixa, SKDM fresco, report de distribuicao seletiva;
 *   medios: decrypt-fail (o remetente liga/desliga), payload pareado,
 *   pagamento sem valor (assinatura de conteudo);
 *   fracos/ambiguos: stub CIPHERTEXT, LID inconsistente, wrapper aninhado,
 *   campos desconhecidos;
 *   informativos (peso 0, so contexto): LID detectado, nota de pagamento,
 *   protocolMessage de edicao, SKDM observado.
 */
export const INDICADORES = Object.freeze({
  INV_001: { id: 'INV-001', nome: 'Distribuicao seletiva registrada', categoria: 'distribuicao', severidade: 'alta', peso: 5, descricao: 'A fork anexou `selectiveDistribution` ao evento: um skmsg de grupo nao decifrou para este dispositivo e o remetente marcou decrypt-fail. E assinatura de TRANSPORTE.' },
  INV_002: { id: 'INV-002', nome: 'decrypt-fail="hide" presente', categoria: 'criptografia', severidade: 'media', peso: 2, descricao: 'O remetente pediu para os clientes esconderem a entrada indecifravel. E ligado pelo remetente, entao sozinho nao prova intencao (o rereg_recovery do WhatsApp tambem carrega o atributo e decifra).' },
  INV_003: { id: 'INV-003', nome: 'Stanza rotacionada sem phash', categoria: 'distribuicao', severidade: 'alta', peso: 3, descricao: 'O fan-out normal de Sender Key anuncia o phash do conjunto enderecado; a stanza rotacionada nao. Nao depende da boa vontade do remetente.' },
  INV_004: { id: 'INV-004', nome: 'Densidade de destinatarios baixa', categoria: 'distribuicao', severidade: 'alta', peso: 3, descricao: 'Dispositivos enderecados muito abaixo do total do grupo indica subconjunto deliberado.' },
  INV_005: { id: 'INV-005', nome: 'SenderKeyDistributionMessage fresco', categoria: 'criptografia', severidade: 'alta', peso: 4, descricao: 'Um SKDM recente do MESMO autor no MESMO grupo. Quem entrou tarde/perdeu a chave nao recebe SKDM de um grupo onde ja esta; uma rotacao recebe. Separa as duas causas do mesmo erro.' },
  INV_006: { id: 'INV-006', nome: 'Payload pareado em stanza de grupo', categoria: 'distribuicao', severidade: 'media', peso: 2, descricao: 'Stanza de grupo com enc pareado (msg/pkmsg): e o transporte do retry, por onde o conteudo chega a quem foi excluido. Ocorre tambem por motivo benigno.' },
  INV_007: { id: 'INV-007', nome: 'Pagamento sem valor', categoria: 'payment', severidade: 'alta', peso: 6, descricao: 'requestPaymentMessage com amount1000 ou amount.value zerado. O WhatsApp nao tem o que desenhar no card e a mensagem fica sem conteudo visivel. E a assinatura de CONTEUDO do raja.' },
  INV_008: { id: 'INV-008', nome: 'Nota de pagamento com texto', categoria: 'payment', severidade: 'baixa', peso: 0, descricao: 'O texto vive em noteMessage.extendedTextMessage.text, nunca em conversation. Informativo: sozinho nao eleva; corrobora o pagamento sem valor.' },
  INV_009: { id: 'INV-009', nome: 'Mencoes em massa na nota', categoria: 'dispersao', severidade: 'media', peso: 3, descricao: 'Volume de mencoes na nota incompativel com uma conversa normal. So conta junto de nota de pagamento (a rajada real trazia centenas).' },
  INV_010: { id: 'INV-010', nome: 'Stub CIPHERTEXT (sem payload)', categoria: 'criptografia', severidade: 'baixa', peso: 1, descricao: 'A mensagem chegou sem conteudo decifravel. Ambiguo: e o mesmo estado de quem entrou tarde ou perdeu a Sender Key. Sozinho NAO classifica como ataque.' },
  INV_011: { id: 'INV-011', nome: 'Enderecamento por LID', categoria: 'addressing', severidade: 'baixa', peso: 0, descricao: 'A mensagem usa LID (identificador interno). E o fluxo atual do WhatsApp para grupos — NAO e prova de mensagem invisivel.' },
  INV_012: { id: 'INV-012', nome: 'LID inconsistente no enderecamento', categoria: 'addressing', severidade: 'media', peso: 2, descricao: 'addressingMode contradiz o formato do JID, ou falta a contraparte (PN<->LID) esperada. Pode indicar montagem manual do envelope.' },
  INV_013: { id: 'INV-013', nome: 'Encapsulamento aninhado', categoria: 'estrutura', severidade: 'baixa', peso: 1, descricao: 'Mais de uma camada de wrapper (viewOnce/ephemeral/...). Comum e benigno, mas e o transporte classico do raja encapsulado.' },
  INV_014: { id: 'INV-014', nome: 'Citacao sem stanzaId', categoria: 'contexto', severidade: 'media', peso: 2, descricao: 'quotedMessage presente sem stanzaId: referencia invalida ou montada manualmente.' },
  INV_015: { id: 'INV-015', nome: 'Campos desconhecidos no proto', categoria: 'estrutura', severidade: 'baixa', peso: 1, descricao: 'Campos presentes no objeto que nao constam no mapa conhecido desta versao. Pode ser apenas uma versao mais nova do proto.' },
  INV_016: { id: 'INV-016', nome: 'Mensagem de sistema/protocolo', categoria: 'sistema', severidade: 'baixa', peso: 0, descricao: 'protocolMessage/editedMessage: mensagem tecnicamente diferente, mas nao invisivel por si.' },
  INV_017: { id: 'INV-017', nome: 'Contexto de encaminhamento na nota', categoria: 'contexto', severidade: 'media', peso: 2, descricao: 'contextInfo da NOTA com isForwarded/forwardingScore alto. Fez parte do formato do raja real; sozinho e enfeite.' },
  INV_018: { id: 'INV-018', nome: 'SKDM observado no conteudo', categoria: 'criptografia', severidade: 'baixa', peso: 0, descricao: 'senderKeyDistributionMessage decifrado. Informativo: e a distribuicao de chave, normal em grupo. O bloco <enc type="skmsg"> cru NAO e observavel nesta camada.' },
  INV_019: { id: 'INV-019', nome: 'Card de pagamento zerado sem nota', categoria: 'payment', severidade: 'media', peso: 2, descricao: 'requestPaymentMessage sem valor, mas SEM texto na nota. O card tambem nao renderiza, porem nao carrega mensagem escondida — e um card malformado, nao a rajada. Peso reduzido de proposito.' },
  INV_020: { id: 'INV-020', nome: 'Nota com texto sem conteudo visivel', categoria: 'payment', severidade: 'media', peso: 2, descricao: 'O texto da NOTA existe mas so tem espaco/zero-width: o cliente desenha ~nada. Sozinho e ambiguo (varios envios usam caracteres invisiveis para "vazio"); pesa apenas quando ja ha outro indicador de pagamento na mesma mensagem.' },
  INV_021: { id: 'INV-021', nome: 'ID com sufixo de fonte/historico', categoria: 'estrutura', severidade: 'baixa', peso: 1, descricao: 'ID no formato `<id>_L0` (sufixo de origem/historico). Nao e o formato dos clientes (`3EB0...`) e pode indicar historico/relay, nao um envio direto. Ambiguo: nao e prova de nada.' },
  INV_022: { id: 'INV-022', nome: 'sendPaymentMessage sem referencia ao pedido', categoria: 'payment', severidade: 'media', peso: 3, descricao: 'O proto `SendPaymentMessage` tem `requestMessageKey` — o ponteiro para o pedido que este envio responde. Aqui ele esta AUSENTE e nao ha `amount` nenhum: o card nao responde a pedido algum e nao carrega valor. Severidade MEDIA de proposito: o campo existe no proto, mas nao ha amostra benigna confirmada que prove que ele sempre acompanha um envio legitimo — entao isto corrobora, nao prova.' },
  INV_023: { id: 'INV-023', nome: 'Envelope de pagamento com texto invisivel', categoria: 'payment', severidade: 'alta', peso: 6, descricao: 'ASSINATURA MEDIDA do raja: `sendPaymentMessage` cuja nota carrega texto INVISIVEL (`.` + zero-width). O `sendPaymentMessage` e o tipo de um envio de pagamento e, sozinho, nao carrega `amount` — com a nota invisivel, o card nao mostra nada e o texto viaja escondido. Confirmado contra o raja REAL e contra o espelho que o `!rajar` monta.' },
});

const AMBIGUOS = new Set(['INV-010', 'INV-011']); // stub/LID sozinhos -> nunca elevam

// ============================================================================
// MAPAS DO PROTO CONHECIDO (desta versao da fork)
// ============================================================================

/** Campos de Message (WAProto) conhecidos por esta versao. */
export const CAMPOS_MESSAGE = Object.freeze([
  'conversation', 'senderKeyDistributionMessage', 'imageMessage', 'contactMessage', 'locationMessage', 'extendedTextMessage', 'documentMessage', 'audioMessage', 'videoMessage', 'call', 'chat', 'protocolMessage', 'contactsArrayMessage', 'highlyStructuredMessage', 'fastRatchetKeySenderKeyDistributionMessage', 'sendPaymentMessage', 'liveLocationMessage', 'requestPaymentMessage', 'declinePaymentRequestMessage', 'cancelPaymentRequestMessage', 'templateMessage', 'stickerMessage', 'groupInviteMessage', 'templateButtonReplyMessage', 'productMessage', 'deviceSentMessage', 'messageContextInfo', 'listMessage', 'viewOnceMessage', 'orderMessage', 'listResponseMessage', 'ephemeralMessage', 'invoiceMessage', 'buttonsMessage', 'buttonsResponseMessage', 'paymentInviteMessage', 'interactiveMessage', 'reactionMessage', 'stickerSyncRmrMessage', 'interactiveResponseMessage', 'pollCreationMessage', 'pollUpdateMessage', 'keepInChatMessage', 'documentWithCaptionMessage', 'requestPhoneNumberMessage', 'viewOnceMessageV2', 'encReactionMessage', 'editedMessage', 'viewOnceMessageV2Extension', 'pollCreationMessageV2', 'scheduledCallCreationMessage', 'groupMentionedMessage', 'pinInChatMessage', 'pollCreationMessageV3', 'scheduledCallEditMessage', 'ptvMessage', 'botInvokeMessage', 'callLogMesssage', 'messageHistoryBundle', 'encCommentMessage', 'bcallMessage', 'lottieStickerMessage', 'eventMessage', 'encEventResponseMessage', 'commentMessage', 'newsletterAdminInviteMessage', 'placeholderMessage', 'secretEncryptedMessage', 'albumMessage', 'eventCoverImage', 'stickerPackMessage', 'statusMentionMessage', 'pollResultSnapshotMessage', 'pollCreationOptionImageMessage', 'associatedChildMessage', 'groupStatusMentionMessage', 'pollCreationMessageV4', 'statusAddYours', 'groupStatusMessage', 'richResponseMessage', 'statusNotificationMessage', 'limitSharingMessage', 'botTaskMessage', 'questionMessage', 'messageHistoryNotice', 'groupStatusMessageV2', 'botForwardedMessage', 'statusQuestionAnswerMessage', 'questionReplyMessage', 'questionResponseMessage', 'statusQuotedMessage', 'statusStickerInteractionMessage', 'pollCreationMessageV5', 'newsletterFollowerInviteMessageV2', 'pollResultSnapshotMessageV3', 'newsletterAdminProfileMessage', 'newsletterAdminProfileMessageV2', 'spoilerMessage', 'pollCreationMessageV6', 'conditionalRevealMessage', 'pollAddOptionMessage', 'eventInviteMessage', 'groupRootKeyShare', 'paymentReminderMessage', 'splitPaymentMessage', 'newsletterAdminProfileStatusMessage', 'rootSecretDistributeMessage',
]);

/** Wrappers FutureProofMessage (carregam `.message`). */
export const WRAPPERS_FUTUREPROOF = Object.freeze([
  'viewOnceMessage', 'ephemeralMessage', 'documentWithCaptionMessage', 'viewOnceMessageV2', 'editedMessage', 'viewOnceMessageV2Extension', 'groupMentionedMessage', 'botInvokeMessage', 'lottieStickerMessage', 'eventCoverImage', 'statusMentionMessage', 'pollCreationOptionImageMessage', 'associatedChildMessage', 'groupStatusMentionMessage', 'pollCreationMessageV4', 'statusAddYours', 'groupStatusMessage', 'limitSharingMessage', 'botTaskMessage', 'questionMessage', 'groupStatusMessageV2', 'botForwardedMessage', 'questionReplyMessage', 'newsletterAdminProfileMessage', 'newsletterAdminProfileMessageV2', 'spoilerMessage', 'newsletterAdminProfileStatusMessage',
]);

/** Campos de ContextInfo conhecidos. */
export const CAMPOS_CONTEXTINFO = Object.freeze([
  'stanzaId', 'participant', 'quotedMessage', 'remoteJid', 'mentionedJid', 'conversionSource', 'conversionData', 'conversionDelaySeconds', 'forwardingScore', 'isForwarded', 'quotedAd', 'placeholderKey', 'expiration', 'ephemeralSettingTimestamp', 'ephemeralSharedSecret', 'externalAdReply', 'entryPointConversionSource', 'entryPointConversionApp', 'entryPointConversionDelaySeconds', 'disappearingMode', 'actionLink', 'groupSubject', 'parentGroupJid', 'trustBannerType', 'trustBannerAction', 'isSampled', 'groupMentions', 'utm', 'forwardedNewsletterMessageInfo', 'businessMessageForwardInfo', 'smbClientCampaignId', 'smbServerCampaignId', 'dataSharingContext', 'alwaysShowAdAttribution', 'featureEligibilities', 'entryPointConversionExternalSource', 'entryPointConversionExternalMedium', 'ctwaSignals', 'ctwaPayload', 'forwardedAiBotMessageInfo', 'statusAttributionType', 'urlTrackingMap', 'pairedMediaType', 'rankingVersion', 'memberLabel', 'isQuestion', 'statusSourceType', 'statusAttributions', 'isGroupStatus', 'forwardOrigin', 'questionReplyQuotedMessage', 'statusAudienceMetadata', 'nonJidMentions', 'quotedType', 'botMessageSharingInfo', 'isSpoiler', 'mediaDomainInfo', 'partiallySelectedContent', 'afterReadDuration', 'crossAppSource', 'businessInteractionPills', 'posterStatusId',
]);

/** Campos de MessageKey conhecidos. */
export const CAMPOS_KEY = Object.freeze([
  'remoteJid', 'fromMe', 'id', 'participant', 'participantAlt', 'remoteJidAlt', 'remoteJidUsername', 'participantUsername', 'addressingMode', 'senderPn', 'senderLid', 'recipient', 'server_id',
]);

/** Campos de WebMessageInfo usados no diagnostico (envelope). */
export const CAMPOS_ENVELOPE = Object.freeze([
  'key', 'message', 'messageTimestamp', 'status', 'participant', 'pushName', 'messageStubType', 'messageStubParameters', 'paymentInfo', 'quotedPaymentInfo', 'retryCount', 'selectiveDistribution', 'pairwiseGroupPayload', 'verifiedBizName', 'broadcast', 'category',
]);

/** Tipos de mensagem de pagamento do proto. */
export const TIPOS_PAGAMENTO = Object.freeze([
  'requestPaymentMessage', 'sendPaymentMessage', 'paymentInviteMessage', 'declinePaymentRequestMessage', 'cancelPaymentRequestMessage', 'paymentReminderMessage', 'splitPaymentMessage', 'invoiceMessage', 'paymentLinkMetadata', 'paymentExtendedMetadata',
]);

/** Campos de ExtendedTextMessage (usados no escaneamento de campos desconhecidos). */
const CAMPOS_EXTENDED = Object.freeze([
  'text', 'matchedText', 'description', 'title', 'textArgb', 'backgroundArgb', 'font', 'previewType', 'jpegThumbnail', 'contextInfo', 'doNotPlayInline', 'thumbnailDirectPath', 'thumbnailSha256', 'thumbnailEncSha256', 'mediaKey', 'mediaKeyTimestamp', 'thumbnailHeight', 'thumbnailWidth', 'inviteLinkGroupType', 'inviteLinkParentGroupSubjectV2', 'inviteLinkParentGroupThumbnailV2', 'inviteLinkGroupTypeV2', 'viewOnce', 'videoHeight', 'videoWidth', 'faviconMMSMetadata', 'linkPreviewMetadata', 'paymentLinkMetadata', 'endCardTiles', 'videoContentUrl', 'musicMetadata', 'paymentExtendedMetadata',
]);

/**
 * Campos conhecidos por tipo de folha. So os tipos aqui mapeados participam do
 * escaneamento de "campos desconhecidos": para os demais, o proto tem muitas
 * variacoes e marcar tudo como desconhecido geraria ruido de falso positivo.
 */
const CAMPOS_POR_TIPO = Object.freeze({
  extendedTextMessage: CAMPOS_EXTENDED,
  conversation: Object.freeze([]),
});

const SET_MESSAGE = new Set(CAMPOS_MESSAGE);
const SET_CONTEXTINFO = new Set(CAMPOS_CONTEXTINFO);
const SET_KEY = new Set(CAMPOS_KEY);
const SET_ENVELOPE = new Set(CAMPOS_ENVELOPE);
const SET_WRAPPERS = new Set(WRAPPERS_FUTUREPROOF);
const SET_PAGAMENTO = new Set(TIPOS_PAGAMENTO);

// ============================================================================
// LIMIARES
// ============================================================================

export const LIMIAR_SUSPEITA = 3;
export const LIMIAR_FORTE = 9;
export const DENSIDADE_MINIMA = 0.5;
export const MENCao_EM_MASSA = 50;
export const ID_PADRAO = /^(3EB0|3A|BAE5|3EB0)[0-9A-F]{4,}$/i;

export const CLASSIFICACOES = Object.freeze([
  'NORMAL',
  'ATIPICA',
  'SUSPEITA',
  'FORTEMENTE_COMPATIVEL',
  'INCONCLUSIVA',
]);

// ============================================================================
// HELPERS PUROS
// ============================================================================

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const keysOf = (v) => (isObj(v) ? Object.keys(v) : []);
const has = (obj, k) => isObj(obj) && Object.prototype.hasOwnProperty.call(obj, k);
const str = (v) => (v === null || v === undefined ? '' : String(v));
const jidKind = (v) => {
  const s = str(v);
  if (!s) return null;
  if (s.endsWith('@lid')) return 'lid';
  if (s.endsWith('@g.us')) return 'grupo';
  if (s.endsWith('@s.whatsapp.net')) return 'pn';
  if (s.endsWith('@newsletter')) return 'newsletter';
  if (s.endsWith('@broadcast')) return 'broadcast';
  if (s === 'status@broadcast') return 'status';
  return 'desconhecido';
};
const isZeroLike = (v) => {
  if (typeof v === 'number') return v === 0;
  if (typeof v === 'bigint') return v === 0n;
  if (typeof v === 'string') {
    const t = v.trim();
    return t !== '' && /^(-?0+)(\.0+)?$/.test(t);
  }
  // Long do protobuf: {low, high, unsigned}
  if (isObj(v) && typeof v.low === 'number' && typeof v.high === 'number') {
    return v.low === 0 && v.high === 0;
  }
  return false;
};
const safeValue = (v) => {
  if (v === undefined) return 'não fornecido';
  if (v === null) return 'null';
  if (typeof v === 'bigint') return `${v}n`;
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  if (typeof v === 'string') return v.length > 120 ? `${v.slice(0, 120)}…` : v;
  if (v instanceof Uint8Array || Buffer.isBuffer(v)) return `bytes(${v.length})`;
  if (Array.isArray(v)) return `array(${v.length})`;
  if (isObj(v)) {
    if (typeof v.low === 'number' && typeof v.high === 'number') return safeValue(BigInt(v.high >>> 0) << 32n | BigInt(v.low >>> 0));
    const k = Object.keys(v).slice(0, 10);
    return k.length ? `{${k.join(', ')}}` : '{}';
  }
  return typeof v;
};
const tipoDe = (v) => {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (Array.isArray(v)) return 'array';
  if (v instanceof Uint8Array || Buffer.isBuffer(v)) return 'bytes';
  if (isObj(v)) {
    if (typeof v.low === 'number' && typeof v.high === 'number') return 'Long';
    return 'objeto';
  }
  return typeof v;
};

/** Nome do tipo de conteudo no nivel atual (espelha o inspector, sem acoplar). */
function nomeInterno(content) {
  if (!isObj(content)) return null;
  const k = Object.keys(content).find((x) => (x === 'conversation' || x.includes('Message')) && x !== 'senderKeyDistributionMessage');
  return k || null;
}

/** Percorre wrappers e devolve a cadeia + profundidade + conteudo folha. */
function percorrerWrappers(content, limite = 12) {
  const chain = [];
  let current = content;
  let guard = 0;
  while (isObj(current) && guard < limite) {
    guard += 1;
    const name = nomeInterno(current);
    if (!name) break;
    chain.push(name);
    if (name === 'conversation') break;
    const node = current[name];
    const nested = isObj(node) ? (node.message ?? node.editedMessage ?? node.originalMessage ?? node.groupStatusMessage) : null;
    const wrapper = name.includes('Message') && isObj(nested);
    if (!wrapper) break;
    current = nested;
  }
  const leafType = chain[chain.length - 1] || null;
  return { chain, depth: chain.length, leafType, leaf: leafType ? content : content };
}

/** Cadeia apenas com wrappers conhecidos (FutureProofMessage). */
function cadeiaWrappers(content, limite = 12) {
  const wrappers = [];
  let current = content;
  let guard = 0;
  while (isObj(current) && guard < limite) {
    guard += 1;
    const name = nomeInterno(current);
    if (!name) break;
    const node = current[name];
    const nested = isObj(node) ? (node.message ?? node.editedMessage ?? node.originalMessage ?? node.groupStatusMessage) : null;
    const isWrapper = SET_WRAPPERS.has(name) || (name.includes('Message') && isObj(nested) && keysOf(nested).length > 0);
    if (!isWrapper) break;
    wrappers.push(name);
    current = nested;
  }
  return wrappers;
}

/** Conteudo real (desembrulha o envelope `message` do WebMessageInfo). */
function conteudoRaiz(infoLike, contentLike) {
  if (isObj(contentLike) && !has(contentLike, 'key') && !has(contentLike, 'messageStubType')) return contentLike;
  if (isObj(infoLike) && isObj(infoLike.message)) return infoLike.message;
  if (isObj(contentLike)) return contentLike;
  if (isObj(infoLike) && !has(infoLike, 'key') && !has(infoLike, 'messageStubType')) return infoLike;
  return {};
}

/**
 * Desembrulha a mensagem ate o conteudo FOLHA (viewOnce -> ephemeral -> media).
 * Usado pelos detectores que leem campos do tipo (payment, protocolo), os quais
 * NÃO ficam no wrapper externo.
 */
function resolverFolha(content, limite = 12) {
  let current = content;
  let guard = 0;
  while (isObj(current) && guard < limite) {
    guard += 1;
    const name = nomeInterno(current);
    if (!name || name === 'conversation') break;
    const node = current[name];
    // Só desce por `node.message`: é a forma dos wrappers FutureProofMessage.
    // Descer por `editedMessage`/`originalMessage` (como a cadeia do inspector
    // faz) seria errado aqui — `protocolMessage` TAMBÉM tem um `editedMessage`,
    // e tratar isso como wrapper faria o protocolo sumir do detector.
    const nested = isObj(node) ? node.message : null;
    const wrapper = name.includes('Message') && isObj(nested);
    if (!wrapper) break;
    current = nested;
  }
  return isObj(current) ? current : content;
}

// ============================================================================
// DETECTORES (cada um isolado, todos puros)
// ============================================================================

/** KeyAnalyzer: formato/padrao de ID, campos reais da MessageKey da fork. */
export function analisarKey(key = {}, opts = {}) {
  const k = isObj(key) ? key : {};
  const id = str(k.id);
  const idFormato = id
    ? (ID_PADRAO.test(id) ? 'padrao (prefixo 3EB0/3A/BAE5 + hex)' : `fora do padrao (${id.length} chars)`)
    : 'ausente';
  // `_L<numero>` = sufixo de fonte/historico do WhatsApp (o cliente costuma
  // receber historico com esse sufixo). Nao e o formato de envio direto
  // (`3EB0...`), mas NAO e prova de nada — so contexto estrutural.
  const sufixoHistorico = /_L\d+$/.test(id) ? id.slice(id.lastIndexOf('_L')) : null;
  const vistos = opts.seenIds instanceof Set ? opts.seenIds : null;
  const reuso = vistos && id ? vistos.has(id) : null;

  const camposConhecidos = {};
  for (const campo of CAMPOS_KEY) {
    if (has(k, campo)) camposConhecidos[campo] = safeValue(k[campo]);
  }
  const desconhecidos = keysOf(k).filter((x) => !SET_KEY.has(x));

  const anomalias = [];
  if (!id) anomalias.push('MessageKey sem `id` — identificacao impossivel.');
  else if (sufixoHistorico) anomalias.push(`ID com sufixo de fonte/historico (\`${sufixoHistorico}\`) — nao e o formato de envio direto dos clientes.`);
  else if (!ID_PADRAO.test(id)) anomalias.push(`ID de mensagem fora do padrao dos clientes (${id.length} chars).`);
  if (reuso === true) anomalias.push('ID ja visto antes neste processo — possivel reutilizacao.');
  if (k.fromMe === true && (jidKind(k.remoteJid) === 'grupo') && !k.participant) anomalias.push('fromMe=true em grupo sem participant.');
  if (k.addressingMode && !['lid', 'pn'].includes(str(k.addressingMode))) anomalias.push(`addressingMode inesperado: ${k.addressingMode}`);

  return {
    disponivel: Boolean(id || keysOf(k).length),
    id: id || null,
    idFormato,
    sufixoHistorico,
    fromMe: has(k, 'fromMe') ? k.fromMe === true : null,
    remoteJid: k.remoteJid ?? null,
    remoteJidTipo: jidKind(k.remoteJid),
    participant: k.participant ?? null,
    participantTipo: jidKind(k.participant),
    participantAlt: k.participantAlt ?? null,
    remoteJidAlt: k.remoteJidAlt ?? null,
    addressingMode: k.addressingMode ?? null,
    server_id: k.server_id ?? null,
    // Campos citados na tarefa que NAO existem nesta versao da fork:
    ausentes: ['device', 'agent', 'to', 'from', 'status'].filter((campo) => !has(k, campo)),
    reuso,
    camposConhecidos,
    desconhecidos,
    anomalias,
  };
}

/** LidAnalyzer: LID vs JID, contraparte e inconsistencia. NUNCA acusa sozinho. */
export function analisarLid(key = {}, identity = null) {
  const k = isObj(key) ? key : {};
  const valores = [k.remoteJid, k.participant, k.participantAlt, k.remoteJidAlt].filter(Boolean);
  const lidDetectado = valores.some((v) => jidKind(v) === 'lid');
  const jidTradicional = valores.some((v) => jidKind(v) === 'pn');
  const principal = jidKind(k.remoteJid) === 'grupo' ? k.participant : k.remoteJid;
  const principalTipo = jidKind(principal);
  const alt = jidKind(k.remoteJid) === 'grupo' ? k.participantAlt : k.remoteJidAlt;
  const altPresente = Boolean(alt);

  const inconsistencias = [];
  const mode = str(k.addressingMode).toLowerCase();
  // Só conta como inconsistência uma CONTRADIÇÃO real entre o modo declarado e
  // o formato do identificador. "LID sem contraparte PN" NÃO entra: e o fluxo
  // normal de grupos em que a contraparte nao foi resolvida, e marcar isso daria
  // falso positivo em mensagem comum.
  if (mode === 'lid' && principalTipo === 'pn') inconsistencias.push('addressingMode="lid" mas o identificador principal e um PN.');
  if (mode === 'pn' && principalTipo === 'lid') inconsistencias.push('addressingMode="pn" mas o identificador principal e um LID.');

  return {
    disponivel: valores.length > 0,
    lidDetectado,
    jidTradicional,
    jidAlternativo: Boolean(k.remoteJidAlt),
    participanteAlternativo: Boolean(k.participantAlt),
    addressingMode: k.addressingMode ?? 'não fornecido',
    contraparteResolvida: altPresente,
    inconsistente: inconsistencias.length > 0,
    inconsistencias,
    identidadeResolvida: identity && isObj(identity)
      ? { senderJid: identity.senderJid ?? null, senderLid: identity.senderLid ?? null, chatJid: identity.chatJid ?? null, chatLid: identity.chatLid ?? null, mapped: identity.mapped === true }
      : null,
  };
}

/**
 * DistributionAnalyzer: le o report que a FORK anexa. Sem report, declara
 * indisponibilidade — nunca inventa destinatarios.
 */
export function analisarDistribuicao(info = {}) {
  const rep = isObj(info.selectiveDistribution) ? info.selectiveDistribution : null;
  if (!rep) {
    return {
      disponivel: false,
      seletiva: null,
      motivo: 'Informação de distribuição seletiva não disponível neste evento.',
      destinatarios: null,
      grupoDispositivos: null,
      exclusoes: null,
      densidade: null,
      phash: null,
      skdmRecentMs: null,
      encType: null,
      decryptFail: null,
      origem: 'campo `selectiveDistribution` (fork), ausente nesta mensagem',
    };
  }
  const enderecados = typeof rep.addressedDeviceCount === 'number' ? rep.addressedDeviceCount : null;
  const grupo = typeof rep.groupDeviceCount === 'number' ? rep.groupDeviceCount : null;
  const densidade = typeof rep.density === 'number' ? rep.density : null;
  const exclusoes = enderecados !== null && grupo !== null ? Math.max(0, grupo - enderecados) : null;
  const temPhash = has(rep, 'hasPhash') ? rep.hasPhash === true : null;
  const skdm = typeof rep.skdmRecentMs === 'number' ? rep.skdmRecentMs : null;
  // A presença do report já é a marca da fork, MAS exigir ao menos um sinal
  // objetivo evita rotular como "seletiva" um report que só tem a estrutura
  // vazia (ex.: fan-out normal com phash presente e densidade cheia). Sem isso
  // o próprio relatório da fork viraria indicador forte e daria falso positivo.
  const sinaisObjetivos = rep.decryptFail === 'hide'
    || temPhash === false
    || (typeof densidade === 'number' && densidade < DENSIDADE_MINIMA)
    || skdm !== null;

  return {
    disponivel: true,
    seletiva: sinaisObjetivos,
    sinaisObjetivos,
    motivo: null,
    kind: rep.kind ?? null,
    messageId: rep.messageId ?? null,
    groupJid: rep.groupJid ?? null,
    author: rep.author ?? null,
    encType: rep.encType ?? null,
    decryptFail: rep.decryptFail ?? null,
    destinatarios: enderecados,
    grupoDispositivos: grupo,
    exclusoes,
    densidade,
    phash: temPhash,
    skdmRecentMs: skdm,
    motivoFalha: rep.reason ?? null,
    origem: 'campo `selectiveDistribution` (fork), anexado no decode',
  };
}

/** DecryptionAnalyzer: falha, tipo, destinatario afetado, retry. */
export function analisarDescriptografia(info = {}, key = {}) {
  const stub = info.messageStubType;
  const params = Array.isArray(info.messageStubParameters) ? info.messageStubParameters : [];
  const paramTexto = params.map((p) => str(p)).join(' | ');
  const ciphertextStub = Number(stub) === 2; // StubType.CIPHERTEXT
  const report = isObj(info.selectiveDistribution) ? info.selectiveDistribution : null;
  const falha = ciphertextStub || Boolean(report) || /decrypt|no session|senderkey/i.test(paramTexto);
  const retryCount = typeof info.retryCount === 'number' ? info.retryCount : null;

  return {
    disponivel: falha || retryCount !== null || params.length > 0,
    falha,
    tipo: report?.encType ? `skmsg (${report.encType})` : (ciphertextStub ? 'CIPHERTEXT (stub)' : (falha ? 'erro reportado no stub' : null)),
    motivo: report?.reason ?? (params[0] ? str(params[0]) : null),
    destinatarioAfetado: falha ? 'este dispositivo (o payload nao decifrou aqui)' : null,
    retry: retryCount === null ? 'NÃO DISPONÍVEL' : `${retryCount} tentativa(s) registrada(s) na stanza`,
    senderKeyAusente: Boolean(report) || /no session|senderkey/i.test(paramTexto),
    compativelComFantasma: Boolean(report),
    observacao: 'Falha isolada de descriptografia NÃO é prova de mensagem invisível: é o mesmo estado de quem entrou tarde ou perdeu a Sender Key.',
  };
}

/**
 * SenderKeyAnalyzer: observa apenas o que e visivel nesta camada. O bloco
 * `<enc type="skmsg">` cru NAO existe aqui (a fork o consome no decode).
 */
export function analisarSenderKey(content = {}, info = {}) {
  const leaf = resolverFolha(content);
  const skdm = isObj(leaf.senderKeyDistributionMessage) ? leaf.senderKeyDistributionMessage : null;
  const fastRatchet = isObj(leaf.fastRatchetKeySenderKeyDistributionMessage) ? leaf.fastRatchetKeySenderKeyDistributionMessage : null;
  const report = isObj(info.selectiveDistribution) ? info.selectiveDistribution : null;
  const pareado = info.pairwiseGroupPayload === true;

  return {
    skdmObservado: Boolean(skdm || fastRatchet),
    skdmGrupo: skdm?.groupId ?? null,
    skdmTemMaterial: Boolean(skdm && skdm.axolotlSenderKeyDistributionMessage),
    skmsgCruObservavel: false,
    skmsgObservacao: 'Bloco <enc type="skmsg"> não observável nesta camada: a fork o resolve durante o decode (por isso o !get não expõe o ciphertext do skmsg).',
    encTypeNoReport: report?.encType ?? null,
    payloadPareado: pareado,
    payloadPareadoObservacao: pareado
      ? 'Stanza de grupo com enc pareado: transporte do retry. Ocorre também por motivo benigno.'
      : 'Sem payload pareado observável.',
  };
}

const NOTE_SEM_CONTEUDO = /^(?:[\s\u00a0\u200b-\u200f\u2028-\u202f\u2060-\u206f\ufeff]*)$/;

/**
 * O texto tem ZERO caracteres visiveis? `.` + zero-width nao conta como texto:
 * o cliente desenha quase nada, mas o campo esta presente. Serve para separar
 * "nota com conteudo" de "nota so com espaco/invisivel".
 */
const textoSemConteudoVisivel = (texto) => typeof texto === 'string'
  && texto.length > 0
  && NOTE_SEM_CONTEUDO.test(texto);

/**
 * O texto é essencialmente PADDING invisível? Cobre o caso da amostra real
 * (`.` + 9 zero-widths): há 1 caractere visível, mas 90% do texto é invisível.
 * Exige pelo menos 3 invisíveis e metade do texto — abaixo disso é texto normal.
 */
const paddingInvisivel = (texto) => {
  if (typeof texto !== 'string' || !texto.length) return false;
  const n = contarInvisiveis(texto);
  return n >= 3 && n / [...texto].length >= 0.5;
};

/** Quantos caracteres do texto são invisíveis (zero-width/BOM/variation selectors). */
const contarInvisiveis = (texto) => {
  if (typeof texto !== 'string') return 0;
  let n = 0;
  for (const c of texto) if (NOTE_SEM_CONTEUDO.test(c)) n += 1;
  return n;
};

/**
 * Procura o primeiro `contextInfo` na árvore, com profundidade limitada e
 * caminho de volta. Generaliza a busca além da cadeia de wrappers: o
 * `contextInfo` de um `sendPaymentMessage` vive em `noteMessage`, não no wrapper.
 */
function encontrarContextInfo(raiz, maxDepth = 5) {
  if (!isObj(raiz)) return null;
  const visitados = new WeakSet();
  const walk = (node, caminho, depth) => {
    if (depth > maxDepth || !isObj(node) || visitados.has(node)) return null;
    visitados.add(node);
    if (isObj(node.contextInfo) && keysOf(node.contextInfo).length) return { ctx: node.contextInfo, caminho: `${caminho}.contextInfo` };
    // Wrappers: segue o conteúdo interno antes de varrer as chaves.
    const nome = nomeInterno(node);
    if (nome && nome !== 'conversation' && isObj(node[nome])) {
      const nested = node[nome].message;
      const r = walk(isObj(nested) ? nested : node[nome], `${caminho}.${nome}`, depth + 1);
      if (r) return r;
    }
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (!isObj(v)) continue;
      const r = walk(v, `${caminho}.${k}`, depth + 1);
      if (r) return r;
    }
    return null;
  };
  return walk(raiz, 'message', 0);
}

/** PaymentAnalyzer: estrutura, valores e nota — sem inflar "pagamento" a "invisivel". */
export function analisarPagamento(content = {}) {
  const leaf = resolverFolha(content);
  const tipos = TIPOS_PAGAMENTO.filter((t) => isObj(leaf[t]));
  if (!tipos.length) {
    return { disponivel: false, tipos: [], nota: null, anomaliaZero: false, justificativa: null };
  }
  const request = isObj(leaf.requestPaymentMessage) ? leaf.requestPaymentMessage : null;
  const send = isObj(leaf.sendPaymentMessage) ? leaf.sendPaymentMessage : null;
  const base = request || send || null;

  const amount1000Presente = base ? has(base, 'amount1000') : false;
  const amount1000 = base ? base.amount1000 : undefined;
  const amountObj = isObj(base?.amount) ? base.amount : null;
  const valorPresente = amountObj ? has(amountObj, 'value') : false;
  const valor = amountObj ? amountObj.value : undefined;
  const offset = amountObj && has(amountObj, 'offset') ? amountObj.offset : null;

  const zero1000 = amount1000Presente && isZeroLike(amount1000);
  const zeroValor = valorPresente && isZeroLike(valor);
  const primarySpeaks = amount1000Presente && amount1000 !== null && amount1000 !== undefined && !zero1000;
  const zeroPath = zero1000 ? 'amount1000' : (!primarySpeaks && zeroValor ? 'amount.value' : null);

  const noteMsg = isObj(base?.noteMessage) ? base.noteMessage : null;
  const noteExt = isObj(noteMsg?.extendedTextMessage) ? noteMsg.extendedTextMessage : null;
  const noteTexto = noteExt ? str(noteExt.text) : (noteMsg && typeof noteMsg.conversation === 'string' ? noteMsg.conversation : '');
  const noteCtx = isObj(noteExt?.contextInfo) ? noteExt.contextInfo : (isObj(noteMsg?.contextInfo) ? noteMsg.contextInfo : null);
  const mencoes = Array.isArray(noteCtx?.mentionedJid) ? noteCtx.mentionedJid.length : 0;
  const forward = noteCtx && typeof noteCtx.forwardingScore === 'number' ? noteCtx.forwardingScore : null;

  // `SendPaymentMessage.requestMessageKey` aponta para o pedido que este envio
  // responde. Sem ele o card nao referencia pedido nenhum — e, como o tipo
  // tambem nao carrega `amount`, nao ha valor em lugar nenhum.
  const requestMessageKey = isObj(send?.requestMessageKey) ? send.requestMessageKey : null;
  const referenciaAusente = Boolean(send && !requestMessageKey);
  const cardZeradoSemReferencia = referenciaAusente && !request;

  return {
    disponivel: true,
    tipos,
    tipoPrincipal: request ? 'requestPaymentMessage' : (send ? 'sendPaymentMessage' : tipos[0]),
    requestPayment: Boolean(request),
    currencyCodeIso4217: base?.currencyCodeIso4217 ?? null,
    expiryTimestamp: base && has(base, 'expiryTimestamp') ? safeValue(base.expiryTimestamp) : null,
    requestFrom: request?.requestFrom ?? null,
    amount1000: {
      presente: amount1000Presente,
      valor: amount1000Presente ? safeValue(amount1000) : null,
      zero: zero1000,
    },
    amountValue: {
      presente: valorPresente,
      valor: valorPresente ? safeValue(valor) : null,
      zero: zeroValor,
    },
    amountOffset: offset,
    anomaliaZero: zeroPath !== null,
    zeroPath,
    requestMessageKey: requestMessageKey
      ? { id: requestMessageKey.id ?? null, remoteJid: requestMessageKey.remoteJid ?? null, fromMe: requestMessageKey.fromMe ?? null }
      : null,
    referenciaAusente,
    cardZeradoSemReferencia,
    nota: noteMsg
      ? {
        presente: true,
        texto: noteTexto || null,
        tamanho: noteTexto.length,
        invisiveis: contarInvisiveis(noteTexto),
        semConteudoVisivel: textoSemConteudoVisivel(noteTexto) || paddingInvisivel(noteTexto),
        mencoes,
        forwardingScore: forward,
        isForwarded: noteCtx?.isForwarded === true,
      }
      : { presente: false, texto: null, tamanho: 0, invisiveis: 0, semConteudoVisivel: false, mencoes: 0, forwardingScore: null, isForwarded: false },
    justificativa: zeroPath
      ? `Card de pagamento sem valor (zero em \`${zeroPath}\`): o WhatsApp nao tem o que desenhar e a mensagem fica sem conteudo visivel.`
      : request
        ? 'Request de pagamento com valor presente — nao e o estado malformado.'
        : 'Sem `amount` neste tipo de pagamento (o `sendPaymentMessage` nao carrega valor — quem carrega e o `requestPaymentMessage`); por isso o estado "zerado" NAO e avaliado aqui.',
  };
}

/** ContextInfoAnalyzer: campos presentes, citacao, mencoes, efemera, encaminhamento. */
export function analisarContexto(content = {}) {
  // A cadeia de wrappers NÃO é o único lugar onde mora o contextInfo: num
  // `sendPaymentMessage` ele fica em `noteMessage.extendedTextMessage`. Por isso
  // a busca é por profundidade limitada (não só pela cadeia), cobrindo os dois.
  const achado = encontrarContextInfo(content, 5);
  const ctx = achado?.ctx || null;
  const caminho = achado?.caminho || null;
  if (!ctx) {
    return { disponivel: false, caminho: null, campos: [], mencoes: 0, groupMentions: 0, naoJidMentions: null, citacao: null, efemera: null, encaminhamento: null, desconhecidos: [], anomalias: [] };
  }

  const mencoes = Array.isArray(ctx.mentionedJid) ? ctx.mentionedJid.length : 0;
  const groupMentions = Array.isArray(ctx.groupMentions) ? ctx.groupMentions.length : 0;
  const citacao = isObj(ctx.quotedMessage) ? { presente: true, tipo: nomeInterno(ctx.quotedMessage) || 'desconhecido', stanzaId: ctx.stanzaId ?? null, participant: ctx.participant ?? null } : null;
  const efemera = ctx.expiration || ctx.ephemeralSettingTimestamp || ctx.disappearingMode
    ? { expiration: ctx.expiration ?? null, ephemeralSettingTimestamp: ctx.ephemeralSettingTimestamp ?? null, disappearingMode: ctx.disappearingMode ?? null }
    : null;
  const encaminhamento = ctx.isForwarded || ctx.forwardingScore || ctx.forwardedNewsletterMessageInfo || ctx.businessMessageForwardInfo
    ? { isForwarded: ctx.isForwarded === true, forwardingScore: ctx.forwardingScore ?? null, newsletter: Boolean(ctx.forwardedNewsletterMessageInfo), business: Boolean(ctx.businessMessageForwardInfo) }
    : null;

  const anomalias = [];
  if (citacao && !ctx.stanzaId) anomalias.push('quotedMessage presente sem stanzaId.');
  if (mencoes > MENCao_EM_MASSA) anomalias.push(`Mencao em massa (${mencoes}) incompativel com conversa normal.`);
  if (Array.isArray(ctx.mentionedJid) && new Set(ctx.mentionedJid).size !== ctx.mentionedJid.length) anomalias.push('mentionedJid com duplicatas.');

  return {
    disponivel: true,
    caminho,
    campos: keysOf(ctx),
    desconhecidos: keysOf(ctx).filter((k) => !SET_CONTEXTINFO.has(k)),
    mencoes,
    groupMentions,
    naoJidMentions: typeof ctx.nonJidMentions === 'number' ? ctx.nonJidMentions : null,
    citacao,
    efemera,
    encaminhamento,
    externalAdReply: Boolean(ctx.externalAdReply),
    conversionSource: ctx.conversionSource ?? null,
    utm: Boolean(ctx.utm),
    businessOwnerJid: null,
    anomalias,
  };
}

/** QuotedMessageAnalyzer: profundidade da citacao e referencia. */
export function analisarCitacao(content = {}, limite = 5) {
  const contexto = analisarContexto(content);
  if (!contexto.disponivel || !contexto.citacao) {
    return { disponivel: false, existencia: false, profundidade: 0, tipos: [], referencia: null, anomalias: [] };
  }
  const tipos = [];
  const anomalias = [];
  // O contextInfo pode estar em `noteMessage` (sendPaymentMessage), não só na
  // cadeia de wrappers — por isso reutilizamos o mesmo localizador.
  const ctx = encontrarContextInfo(content)?.ctx || null;
  let quoted = ctx?.quotedMessage || null;
  let profundidade = 0;
  while (isObj(quoted) && profundidade < limite) {
    profundidade += 1;
    const t = nomeInterno(quoted);
    if (!t) break;
    tipos.push(t);
    const inner = quoted[t];
    const nested = isObj(inner) ? (inner.message ?? inner.contextInfo?.quotedMessage) : null;
    if (!isObj(nested)) break;
    quoted = nested;
  }
  if (ctx && !ctx.stanzaId) anomalias.push('Referencia de citacao sem stanzaId.');
  if (profundidade >= limite) anomalias.push(`Citacao aninhada no limite de profundidade (${limite}).`);

  return {
    disponivel: true,
    existencia: true,
    profundidade,
    tipos,
    referencia: { stanzaId: ctx?.stanzaId ?? null, participant: ctx?.participant ?? null },
    anomalias,
  };
}

/** WrapperAnalyzer: arvore de encapsulamento e profundidade. */
export function analisarWrappers(content = {}) {
  const wrappers = cadeiaWrappers(content);
  const { chain, depth, leafType } = percorrerWrappers(content);
  const desconhecidos = chain.filter((n) => !SET_MESSAGE.has(n));
  const wrappersDesconhecidos = wrappers.filter((n) => !SET_WRAPPERS.has(n));
  return {
    disponivel: chain.length > 0,
    chain,
    wrappers,
    profundidade: depth,
    tipoFolha: leafType,
    tipoExterno: chain[0] || null,
    aninhado: depth > 1,
    desconhecidos,
    wrappersDesconhecidos,
  };
}

/** StubAnalyzer: mensagem tecnicamente vazia vs visualmente vazia. */
const STUB_LABELS = {
  0: 'UNKNOWN', 1: 'REVOKE', 2: 'CIPHERTEXT', 3: 'FUTUREPROOF', 20: 'GROUP_CREATE', 27: 'GROUP_PARTICIPANT_ADD', 28: 'GROUP_PARTICIPANT_REMOVE', 74: 'VIEWED_ONCE', 130: 'DISAPPEARING_MODE', 213: 'CHANGE_LID',
};
export function analisarStub(info = {}) {
  const stub = info.messageStubType;
  const params = Array.isArray(info.messageStubParameters) ? info.messageStubParameters.map((p) => str(p)) : [];
  if (stub === undefined || stub === null) {
    return { disponivel: false, tipo: null, tipoLabel: null, parametros: [], vaziaTecnicamente: false, vaziaVisualmente: false };
  }
  const num = Number(stub);
  const label = STUB_LABELS[num] ?? `tipo ${num}`;
  return {
    disponivel: true,
    tipo: num,
    tipoLabel: label,
    parametros: params,
    vaziaTecnicamente: num === 2,
    vaziaVisualmente: num === 2 || num === 74 || num === 1,
    observacao: num === 2
      ? 'Mensagem sem payload decifravel: "tecnicamente vazia" (stub CIPHERTEXT), mesmo que o cliente mostre um placeholder.'
      : null,
  };
}

/** ProtocolAnalyzer: protocolMessage e seus tipos relevantes. */
export function analisarProtocolo(content = {}) {
  const leaf = resolverFolha(content);
  const proto = isObj(leaf.protocolMessage) ? leaf.protocolMessage : null;
  if (!proto) return { disponivel: false, tipo: null, edicao: false, revogacao: false, key: null, timestampMs: null };
  const tipo = proto.type ?? null;
  return {
    disponivel: true,
    tipo,
    edicao: isObj(proto.editedMessage) || String(proto.type) === '14',
    revogacao: String(proto.type) === '0' || proto.type === 'REVOKE',
    key: isObj(proto.key) ? { id: proto.key.id ?? null, remoteJid: proto.key.remoteJid ?? null } : null,
    timestampMs: proto.timestampMs === undefined ? null : safeValue(proto.timestampMs),
    historySyncNotification: Boolean(proto.historySyncNotification),
    appStateSyncKeyShare: Boolean(proto.appStateSyncKeyShare),
  };
}

/** ProtobufAnalyzer: campos desconhecidos, camada por camada. */
export function analisarCamposDesconhecidos({ content = {}, contextInfo = null, key = {}, envelope = {} } = {}) {
  const { chain } = percorrerWrappers(content);
  const tipoExterno = chain[chain.length - 1] || nomeInterno(content);
  const folha = tipoExterno ? content[tipoExterno] : null;
  const ehWrapper = SET_WRAPPERS.has(tipoExterno);

  // A varredura de campos desconhecidos so olha:
  //  - o nivel RAIZ do Message (onde cada chave deve ser um tipo conhecido);
  //  - as camadas de PRIMEIRA CLASSE que tem mapa fechado (extendedTextMessage);
  //  - a MessageKey e o envelope.
  // Tipos fora do mapa ficam como "sem mapa conhecido" — marcar seus campos
  // internos como desconhecidos daria falso positivo em massa (o proto varia
  // entre versoes e o usuario nao teria como agir sobre isso).
  const mapaFolha = CAMPOS_POR_TIPO[tipoExterno] || null;
  const foraDoMapaRaiz = keysOf(content).filter((k) => !SET_MESSAGE.has(k));
  const foraDoMapaFolha = mapaFolha && !ehWrapper
    ? (isObj(folha) ? keysOf(folha).filter((k) => !mapaFolha.includes(k)) : [])
    : [];
  const ctxDesconhecidos = isObj(contextInfo) ? keysOf(contextInfo).filter((k) => !SET_CONTEXTINFO.has(k)) : [];
  const keyDesconhecidos = keysOf(key).filter((k) => !SET_KEY.has(k));
  const envDesconhecidos = keysOf(envelope).filter((k) => !SET_ENVELOPE.has(k));

  const lista = [];
  const add = (path, name, value) => lista.push({ caminho: `${path}.${name}`, campo: name, tipo: tipoDe(value), valor: safeValue(value) });
  for (const k of foraDoMapaRaiz) add('message', k, content[k]);
  for (const k of foraDoMapaFolha) if (!foraDoMapaRaiz.includes(k)) add(tipoExterno || 'message', k, folha[k]);
  for (const k of ctxDesconhecidos) add('contextInfo', k, contextInfo[k]);
  for (const k of keyDesconhecidos) add('key', k, key[k]);
  for (const k of envDesconhecidos) add('WebMessageInfo', k, envelope[k]);

  return {
    disponivel: lista.length > 0,
    total: lista.length,
    campos: lista,
    semMapaConhecido: !mapaFolha && !ehWrapper && Boolean(tipoExterno),
    porCamada: {
      raiz: foraDoMapaRaiz,
      folha: foraDoMapaFolha,
      contextInfo: ctxDesconhecidos,
      key: keyDesconhecidos,
      envelope: envDesconhecidos,
    },
    observacao: 'Campo fora do mapa conhecido pode ser apenas uma versao mais nova do proto — nao e prova de nada.',
  };
}

// ============================================================================
// CORRELATION ENGINE
// ============================================================================

/**
 * Monta o conjunto de indicadores a partir das analises e soma os pesos.
 * Regra de ouro: indicador isolado NAO classifica; combinacao eleva.
 */
export function correlacionar(analises = {}) {
  const { key, lid, distribution, decryption, senderKey, payment, context, quoted, wrappers, stub, protocol, unknown, contentDisponivel = false } = analises;
  const indicadores = [];
  const evidencias = [];

  const push = (chave, evidencia) => {
    const meta = INDICADORES[chave];
    if (!meta) return;
    if (indicadores.some((i) => i.id === meta.id)) return;
    indicadores.push({ ...meta, evidencia: evidencia || null });
    if (evidencia) evidencias.push({ id: meta.id, texto: evidencia });
  };

  // ── Distribuicao seletiva ────────────────────────────────────────────────
  if (distribution?.disponivel && distribution.seletiva) {
    const partes = [];
    if (distribution.encType) partes.push(`enc=${distribution.encType}`);
    if (distribution.destinatarios !== null) partes.push(`enderecados=${distribution.destinatarios}`);
    if (distribution.grupoDispositivos !== null) partes.push(`grupo=${distribution.grupoDispositivos}`);
    if (distribution.exclusoes !== null) partes.push(`exclusoes≈${distribution.exclusoes}`);
    push('INV_001', `report da fork: ${partes.join(', ') || 'presente'}`);
    if (distribution.decryptFail === 'hide') push('INV_002', 'decrypt-fail="hide" na stanza');
    if (distribution.phash === false) push('INV_003', 'phash ausente na stanza rotacionada');
    if (typeof distribution.densidade === 'number' && distribution.densidade < DENSIDADE_MINIMA) {
      push('INV_004', `densidade=${distribution.densidade.toFixed(3)} (< ${DENSIDADE_MINIMA})`);
    }
    if (typeof distribution.skdmRecentMs === 'number') push('INV_005', `SKDM do mesmo autor há ${distribution.skdmRecentMs} ms`);
  }
  if (senderKey?.payloadPareado) push('INV_006', 'stanza de grupo com enc pareado (msg/pkmsg)');

  // ── Pagamento ────────────────────────────────────────────────────────────
  if (payment?.disponivel) {
    if (payment.anomaliaZero) {
      if (payment.nota?.presente && payment.nota.texto) push('INV_007', `zero provado por \`${payment.zeroPath}\``);
      else push('INV_019', `zero provado por \`${payment.zeroPath}\`, sem texto na nota`);
    }
    if (payment.nota?.presente && payment.nota.texto) push('INV_008', `nota com ${payment.nota.tamanho} chars`);
    if (payment.nota?.mencoes > MENCao_EM_MASSA && payment.anomaliaZero) push('INV_009', `${payment.nota.mencoes} menções na nota`);
    if ((payment.nota?.isForwarded || (payment.nota?.forwardingScore ?? 0) >= 100) && payment.anomaliaZero) {
      push('INV_017', `contextInfo da nota com isForwarded/forwardingScore=${payment.nota.forwardingScore}`);
    }
    // Card de pagamento SEM valor e SEM referência ao pedido: estruturalmente
    // incompleto. É um indicador próprio (não é a rajada, que é request+zero).
    if (payment.cardZeradoSemReferencia) {
      push('INV_022', 'sendPaymentMessage sem `requestMessageKey` e sem `amount`');
    }
  }

  // ── Descriptografia / transporte ─────────────────────────────────────────
  if (stub?.vaziaTecnicamente) push('INV_010', `stub ${stub.tipoLabel}${stub.parametros[0] ? `: ${stub.parametros[0]}` : ''}`);

  // Nota com texto so de espaco/zero-width. Ambiguo QUANDO SOZINHO (varias
  // ferramentas usam caracteres invisiveis para "campo vazio"), mas quando o
  // tipo e `sendPaymentMessage` isto VIRA a assinatura do raja (INV-023) — por
  // isso o INV-020 so entra nos demais tipos.
  if (payment?.nota?.semConteudoVisivel && payment?.tipoPrincipal !== 'sendPaymentMessage' && indicadores.length > 0) {
    push('INV_020', `nota com ${payment.nota.tamanho} chars, nenhum visível`);
  }

  // ASSINATURA do raja REAL medido: envelope de pagamento (sendPaymentMessage)
  // com a nota carregando apenas texto invisivel. O tipo nao tem `amount`, entao
  // o card nao tem o que mostrar e so a nota (escondida) existe.
  if (payment?.tipoPrincipal === 'sendPaymentMessage' && payment?.nota?.semConteudoVisivel) {
    push('INV_023', `sendPaymentMessage com nota de ${payment.nota.tamanho} chars, ${payment.nota.invisiveis} invisível(is)`);
  }

  // ── ID com sufixo de fonte/historico (`..._L0`) ──────────────────────────
  if (key?.sufixoHistorico) push('INV_021', `ID termina em \`${key.sufixoHistorico}\``);

  // ── Enderecamento ────────────────────────────────────────────────────────
  if (lid?.lidDetectado) push('INV_011', 'mensagem endereçada por LID');
  if (lid?.inconsistente) push('INV_012', lid.inconsistencias.join('; '));

  // ── Estrutura ────────────────────────────────────────────────────────────
  if (wrappers?.aninhado) push('INV_013', `cadeia: ${wrappers.chain.join(' -> ')}`);
  if (quoted?.disponivel && quoted.referencia && !quoted.referencia.stanzaId) push('INV_014', 'citacao sem stanzaId');
  if (unknown?.disponivel) push('INV_015', `${unknown.total} campo(s) fora do mapa conhecido`);
  if (protocol?.disponivel) push('INV_016', `protocolMessage type=${safeValue(protocol.tipo)}`);
  if (senderKey?.skdmObservado) push('INV_018', 'senderKeyDistributionMessage decifrado');

  const score = indicadores.reduce((acc, i) => acc + (Number(i.peso) || 0), 0);

  const fortes = indicadores.filter((i) => i.severidade === 'alta');
  const pesoMax = indicadores.reduce((acc, i) => Math.max(acc, Number(i.peso) || 0), 0);
  const estrutural = Boolean(
    distribution?.phash === false
    || (typeof distribution?.densidade === 'number' && distribution.densidade < DENSIDADE_MINIMA)
    || typeof distribution?.skdmRecentMs === 'number',
  );

  // Duas assinaturas se sustentam por si (combinacao de campos):
  //  - conteudo: pagamento zerado COM texto na nota (o raja "de CONTEUDO", no
  //    requestPaymentMessage) — o card nao renderiza E carrega uma mensagem;
  //  - ENVELOPE VAZIO: `sendPaymentMessage` com a nota de texto INVISIVEL. Este
  //    e o tipo do raja REAL medido (o `!rajar` tambem passou a usar): o
  //    `sendPaymentMessage` e o tipo de um envio de pagamento e, sozinho, nao
  //    carrega `amount` — com a nota invisivel, o card nao mostra nada e o texto
  //    viaja escondido.
  //  - transporte: report de distribuicao seletiva da fork + falha de decifragem
  //    + corroboracao ESTRUTURAL (phash ausente / densidade baixa / SKDM fresco).
  const assinaturaConteudo = Boolean(payment?.anomaliaZero && payment?.nota?.texto);
  const assinaturaEnvelopeVazio = Boolean(
    payment?.tipoPrincipal === 'sendPaymentMessage' && payment?.nota?.semConteudoVisivel,
  );
  const assinaturaTransporte = Boolean(distribution?.disponivel && distribution.seletiva && decryption?.falha && estrutural);

  let classificacao;
  if (!key?.disponivel && !contentDisponivel) {
    // Nada observavel: nunca inventar conclusao.
    classificacao = 'INCONCLUSIVA';
  } else if (assinaturaConteudo || assinaturaEnvelopeVazio || assinaturaTransporte) {
    classificacao = 'FORTEMENTE_COMPATIVEL';
  } else if (estrutural) {
    // Qualquer evidencia estrutural (phash ausente/densidade baixa/SKDM fresco)
    // ja caracteriza compatibilidade alta, com ou sem o report completo.
    classificacao = 'FORTEMENTE_COMPATIVEL';
  } else if (fortes.length >= 1 && score >= LIMIAR_FORTE) {
    classificacao = 'FORTEMENTE_COMPATIVEL';
  } else if (fortes.length >= 1 && score >= LIMIAR_SUSPEITA) {
    classificacao = 'SUSPEITA';
  } else if (pesoMax >= 3 && score >= LIMIAR_SUSPEITA) {
    // Indicador de peso medio/alto somado a outros: suspeita, nao certeza.
    classificacao = 'SUSPEITA';
  } else if (score > 0) {
    // Sinais fracos/ambiguos (LID, stub, wrapper, campo desconhecido) -> so atipica.
    classificacao = 'ATIPICA';
  } else {
    classificacao = 'NORMAL';
  }

  // O stub CIPHERTEXT sozinho (sem report e sem estrutural) e o caso classico de
  // "entrei tarde/perdi a chave": estado INCONCLUSIVO, nunca suspeita.
  if (classificacao === 'ATIPICA' && stub?.vaziaTecnicamente && !estrutural && !distribution?.disponivel && indicadores.length <= 2) {
    classificacao = 'INCONCLUSIVA';
  }

  /**
   * Indice de compatibilidade (0-99). E RELATIVO, nao probabilidade: uma
   * assinatura definitiva entra na faixa alta; sinais ambiguos, na baixa. O
   * numero existe para COMPARAR mensagens, nao para dizer "X% de certeza".
   */
  const PESO_MINIMO_ASSINATURA = 6;
  const TETO_SEM_ASSINATURA = 79;
  const REFERENCIA_SEM_ASSINATURA = 18;
  let indice = (assinaturaConteudo || assinaturaTransporte)
    ? Math.min(99, 90 + Math.max(0, score - PESO_MINIMO_ASSINATURA))
    : Math.min(TETO_SEM_ASSINATURA, Math.round((score / REFERENCIA_SEM_ASSINATURA) * TETO_SEM_ASSINATURA));
  if (classificacao === 'NORMAL') indice = 0;

  return {
    indicadores,
    evidencias,
    score,
    indice,
    fortes,
    pesoMax,
    ambiguos: indicadores.filter((i) => AMBIGUOS.has(i.id)),
    temEvidenciaEstrutural: estrutural,
    assinaturaConteudo,
    assinaturaEnvelopeVazio,
    assinaturaTransporte,
    classificacao,
  };
}

/**
 * Concatena a conclusao tecnica em frases curtas, explicando POR QUE a
 * mensagem foi classificada assim (a pergunta "de onde veio isso?").
 */
export function construirExplicacao({ classificacao, indicadores, distribution, payment, decryption, lid, assinaturaEnvelopeVazio }) {
  const linhas = [];
  if (classificacao === 'NORMAL') {
    linhas.push('Nenhuma caracteristica relevante encontrada. Mensagem compativel com o fluxo normal.');
    return linhas;
  }
  const nomes = indicadores.map((i) => i.nome);
  if (classificacao === 'FORTEMENTE_COMPATIVEL') {
    linhas.push('Padrao correspondente ao detector conhecido: houve combinacao de indicadores, nenhum deles isolado.');
    if (assinaturaEnvelopeVazio) {
      linhas.push('Assinatura de ENVELOPE VAZIO: `sendPaymentMessage` (tipo de um envio de pagamento, que NAO carrega `amount`) com a nota carregando apenas texto invisivel — o card nao mostra nada e o texto viaja escondido. E o formato do raja real, o mesmo que o `!rajar` monta.');
    }
    if (payment?.anomaliaZero && payment?.nota?.texto) {
      linhas.push('Assinatura de CONTEUDO: card de pagamento sem valor (zero em `' + payment.zeroPath + '`) COM texto na nota — e o formato que faz o WhatsApp nao renderizar a mensagem.');
    }
    if (distribution?.disponivel && decryption?.falha) {
      linhas.push('Assinatura de TRANSPORTE: a fork registrou distribuicao seletiva e a mensagem nao decifrou para este dispositivo.');
    }
    linhas.push(`Indicadores presentes: ${nomes.join(', ')}.`);
  } else if (classificacao === 'SUSPEITA') {
    linhas.push('Multiplos indicadores relacionados, mas sem a combinacao completa das assinaturas conhecidas.');
    linhas.push(`Indicadores: ${nomes.join(', ')}.`);
  } else if (classificacao === 'ATIPICA') {
    linhas.push('Existem caracteristicas incomuns, insuficientes para associacao com o padrao.');
    linhas.push(`Indicadores: ${nomes.join(', ')}.`);
  } else {
    linhas.push('Informacao insuficiente para classificar: faltam estruturas observaveis nesta mensagem.');
  }
  if (lid?.lidDetectado) linhas.push('Observacao: o LID detectado, sozinho, NAO indica mensagem invisivel — e o fluxo normal de enderecamento do WhatsApp.');
  return linhas;
}

// ============================================================================
// API PRINCIPAL
// ============================================================================

/**
 * Analisa uma mensagem e devolve o resultado estruturado (sem formatacao).
 *
 * @param {object} entrada
 * @param {object} entrada.info    WebMessageInfo do evento (envelope) OU o proprio conteudo
 * @param {object} [entrada.content] conteudo explicito (quando info e so o envelope)
 * @param {object} [entrada.key]   MessageKey (default: info.key)
 * @param {object} [entrada.identity] resolucao JID<->LID do handler (opcional)
 * @param {object} [entrada.quotedContext] contextInfo da citacao recebida (opcional)
 * @param {Set}    [entrada.seenIds] IDs ja vistos (deteccao de reuso)
 * @returns {object} resultado estruturado
 */
export function analyzeInvisibleMessage(entrada = {}) {
  const entradaSegura = isObj(entrada) ? entrada : {};
  const info = isObj(entradaSegura.info) ? entradaSegura.info : {};
  const content = conteudoRaiz(info, entradaSegura.content);
  const key = isObj(entradaSegura.key) ? entradaSegura.key : (isObj(info.key) ? info.key : {});
  const envelope = info;

  const keyA = analisarKey(key, { seenIds: entradaSegura.seenIds });
  const lidA = analisarLid(key, entradaSegura.identity || null);
  const distA = analisarDistribuicao(envelope);
  const decA = analisarDescriptografia({ ...envelope, ...(isObj(entradaSegura.envelopeExtra) ? entradaSegura.envelopeExtra : {}) }, key);
  const skA = analisarSenderKey(content, envelope);
  const payA = analisarPagamento(content);
  const ctxA = analisarContexto(content);
  const quotedA = analisarCitacao(content);
  const wrapA = analisarWrappers(content);
  const stubA = analisarStub({ ...envelope, ...(isObj(entradaSegura.envelopeExtra) ? entradaSegura.envelopeExtra : {}) });
  const protoA = analisarProtocolo(content);
  const unknownA = analisarCamposDesconhecidos({ content, contextInfo: ctxA.disponivel ? contextoBruto(content) : null, key, envelope });

  const contentDisponivel = isObj(content) && keysOf(content).length > 0;

  const correlacao = correlacionar({
    key: keyA, lid: lidA, distribution: distA, decryption: decA, senderKey: skA,
    payment: payA, context: ctxA, quoted: quotedA, wrappers: wrapA, stub: stubA,
    protocol: protoA, unknown: unknownA, contentDisponivel,
  });

  const explicacao = construirExplicacao({
    classificacao: correlacao.classificacao,
    indicadores: correlacao.indicadores,
    distribution: distA, payment: payA, decryption: decA, lid: lidA,
    assinaturaEnvelopeVazio: correlacao.assinaturaEnvelopeVazio,
  });

  return {
    detected: correlacao.classificacao === 'FORTEMENTE_COMPATIVEL' || correlacao.classificacao === 'SUSPEITA',
    classification: correlacao.classificacao,
    confidence: correlacao.indice,
    indicators: correlacao.indicadores,
    evidence: correlacao.evidencias,
    anomalies: [
      ...keyA.anomalias,
      ...lidA.inconsistencias,
      ...ctxA.anomalias,
      ...quotedA.anomalias,
      ...(unknownA.disponivel ? [`${unknownA.total} campo(s) fora do mapa conhecido.`] : []),
    ],
    structures: {
      tipoExterno: wrapA.tipoExterno,
      tipoFolha: wrapA.tipoFolha,
      chain: wrapA.chain,
      wrappers: wrapA.wrappers,
      profundidade: wrapA.profundidade,
      aninhado: wrapA.aninhado,
    },
    key: keyA,
    lid: lidA,
    distribution: distA,
    decryption: decA,
    senderKey: skA,
    payment: payA,
    context: ctxA,
    quoted: quotedA,
    wrappers: wrapA,
    stub: stubA,
    protocol: protoA,
    unknownFields: unknownA,
    correlation: {
      score: correlacao.score,
      indice: correlacao.indice,
      estrutural: correlacao.temEvidenciaEstrutural,
      assinaturaConteudo: correlacao.assinaturaConteudo,
      assinaturaEnvelopeVazio: correlacao.assinaturaEnvelopeVazio,
      assinaturaTransporte: correlacao.assinaturaTransporte,
    },
    explanation: explicacao,
    limitations: LIMITACOES,
  };
}

/** Extrai o contextInfo cru (para o detector de campos desconhecidos). */
function contextoBruto(content) {
  return encontrarContextInfo(content)?.ctx || null;
}

/** Limites honestos desta camada, expostos para o relatorio e para os testes. */
export const LIMITACOES = Object.freeze([
  'O bloco <enc type="skmsg"> cru nao existe nesta camada: a fork o consome no decode. Vemos a consequencia (`selectiveDistribution`).',
  'Reuso de ID so e detectavel com um conjunto de IDs ja vistos; sem isso fica NÃO DISPONIVEL.',
  'Material criptografico (chainKey/signingKey/mediaKey) nunca e exposto — quando aparece, vai como digest/contagem.',
  'Recursos do proto adicionados por versoes mais novas aparecem como "campos desconhecidos", nao como erro.',
]);

// ============================================================================
// FORMATADOR (separado do motor — o mesmo resultado serve a outros consumidores)
// ============================================================================

const CLASSIF_LABEL = {
  NORMAL: 'NORMAL',
  ATIPICA: 'ATÍPICA',
  SUSPEITA: 'SUSPEITA',
  FORTEMENTE_COMPATIVEL: 'FORTEMENTE COMPATÍVEL',
  INCONCLUSIVA: 'INCONCLUSIVA',
};
const ND = 'NÃO DISPONÍVEL';
const val = (v) => (v === null || v === undefined || v === '' ? ND : v);
const bool = (v) => (v === null || v === undefined ? ND : (v ? 'Sim' : 'Não'));

/**
 * Formata o resultado da analise na secao do `!get`.
 * @param {object} resultado saida de analyzeInvisibleMessage
 * @param {object} [opts]
 * @param {boolean} [opts.resumido] quando true, devolve so o bloco curto
 * @param {boolean} [opts.debug] quando true, inclui caminhos/tipos dos campos
 */
export function formatInvisibleSection(resultado, opts = {}) {
  if (!resultado || typeof resultado !== 'object' || Array.isArray(resultado)) return '';
  if (!resultado.classification && !resultado.key && !resultado.payment) return '';
  if (opts.resumido) return formatInvisibleResumo(resultado);

  const R = resultado;
  const L = [];
  const push = (t = '') => L.push(t);

  push('╭━━━〔 🕵️ ANÁLISE DE MENSAGEM INVISÍVEL 〕━━━⬣');
  push(`📌 Classificação: ${CLASSIF_LABEL[R.classification] || R.classification}`);
  push(`📊 Índice de compatibilidade: ${R.confidence}/100`);
  push('_Índice = força dos indicadores encontrados (escala relativa; não é probabilidade estatística)._');

  push('');
  push('🧬 ESTRUTURA');
  push(`├─ Tipo: ${val(R.structures?.tipoFolha)}`);
  push(`├─ Wrapper: ${R.structures?.wrappers?.length ? R.structures.wrappers.join(' -> ') : 'nenhum'}`);
  push(`├─ Profundidade: ${val(R.structures?.profundidade)}`);
  push(`└─ Campos desconhecidos: ${bool(R.unknownFields?.disponivel)} (${R.unknownFields?.total ?? 0})`);

  push('');
  push('🔑 MESSAGE KEY');
  push(`├─ ID: ${val(R.key?.id)}`);
  push(`├─ Formato do ID: ${val(R.key?.idFormato)}`);
  push(`├─ Remote JID: ${val(R.key?.remoteJid)} (${val(R.key?.remoteJidTipo)})`);
  push(`├─ Participant: ${val(R.key?.participant)}`);
  push(`├─ Participant Alt: ${val(R.key?.participantAlt)}`);
  push(`├─ LID: ${bool(R.lid?.lidDetectado)}`);
  push(`└─ Addressing: ${val(R.key?.addressingMode)}`);
  push(`   _Campos não presentes nesta versão da fork: ${R.key?.ausentes?.length ? R.key.ausentes.join(', ') : 'nenhum'}_`);

  push('');
  push('🪪 LID / ADDRESSING');
  push(`├─ LID detectado: ${bool(R.lid?.lidDetectado)}`);
  push(`├─ JID tradicional: ${bool(R.lid?.jidTradicional)}`);
  push(`├─ JID alternativo: ${bool(R.lid?.jidAlternativo)}`);
  push(`├─ Participante alternativo: ${bool(R.lid?.participanteAlternativo)}`);
  push(`└─ Inconsistência: ${bool(R.lid?.inconsistente)}`);
  if (R.lid?.inconsistencias?.length) for (const i of R.lid.inconsistencias) push(`   - ${i}`);
  push('   _@lid não é prova de mensagem invisível._');

  push('');
  push('📡 DISTRIBUIÇÃO');
  if (!R.distribution?.disponivel) {
    push(`├─ Seletiva: ${ND}`);
    push(`└─ ${R.distribution?.motivo || 'Informação de distribuição seletiva não disponível neste evento.'}`);
  } else {
    push(`├─ Seletiva: ${bool(R.distribution.seletiva)}`);
    push(`├─ Destinatários detectados: ${val(R.distribution.destinatarios)}`);
    push(`├─ Dispositivos do grupo: ${val(R.distribution.grupoDispositivos)}`);
    push(`├─ Exclusões detectadas: ${val(R.distribution.exclusoes)}`);
    push(`├─ Densidade: ${val(R.distribution.densidade)}`);
    push(`├─ phash presente: ${bool(R.distribution.phash)}`);
    push(`└─ SKDM recente (ms): ${val(R.distribution.skdmRecentMs)}`);
    push(`   _Origem: ${R.distribution.origem}_`);
  }

  push('');
  push('🔐 DESCRIPTOGRAFIA');
  push(`├─ Falha: ${bool(R.decryption?.falha)}`);
  push(`├─ Tipo: ${val(R.decryption?.tipo)}`);
  push(`├─ Destinatário afetado: ${val(R.decryption?.destinatarioAfetado)}`);
  push(`├─ Retry: ${val(R.decryption?.retry)}`);
  push(`├─ Sender Key ausente: ${bool(R.decryption?.senderKeyAusente)}`);
  push(`└─ SKMSG: ${R.senderKey?.skmsgCruObservavel ? 'Sim' : 'NÃO OBSERVÁVEL NESTA CAMADA'}`);
  if (R.decryption?.observacao) push(`   _${R.decryption.observacao}_`);
  push(`   _${R.senderKey?.skmsgObservacao || ''}_`);

  push('');
  push('💰 PAYMENT');
  if (!R.payment?.disponivel) {
    push(`└─ ${ND} (sem estrutura de pagamento)`);
  } else {
    push(`├─ Request: ${bool(R.payment.requestPayment)}`);
    push(`├─ amount1000: ${R.payment.amount1000.presente ? R.payment.amount1000.valor : 'ausente'}`);
    push(`├─ amount.value: ${R.payment.amountValue.presente ? R.payment.amountValue.valor : 'ausente'}`);
    push(`├─ amount.offset: ${val(R.payment.amountOffset)}`);
    push(`├─ Moeda: ${val(R.payment.currencyCodeIso4217)}`);
    push(`├─ Zero provado por: ${val(R.payment.zeroPath)}`);
    push(`├─ requestMessageKey: ${R.payment.requestMessageKey ? `presente (${R.payment.requestMessageKey.id || 'sem id'})` : (R.payment.requestPayment ? 'não aplicável (é um request)' : 'AUSENTE')}`);
    push(`└─ NoteMessage: ${R.payment.nota.presente ? `presente (${R.payment.nota.tamanho} chars, ${R.payment.nota.mencoes} menções${R.payment.nota.invisiveis ? `, ${R.payment.nota.invisiveis} invisível(is)` : ''})` : 'ausente'}`);
    push(`   _${R.payment.justificativa}_`);
  }

  push('');
  push('🧩 CONTEXTO');
  push(`├─ ContextInfo: ${bool(R.context?.disponivel)}${R.context?.caminho ? ` (${R.context.caminho})` : ''}`);
  push(`├─ Quoted: ${R.quoted?.disponivel ? `Sim (${R.quoted.profundidade} nível(is): ${R.quoted.tipos.join(' -> ')})` : 'Não'}`);
  push(`├─ Mentions: ${R.context?.disponivel ? R.context.mencoes : ND}`);
  push(`├─ Ephemeral: ${R.context?.efemera ? 'Sim' : (R.context?.disponivel ? 'Não' : ND)}`);
  push(`├─ ViewOnce: ${R.wrappers?.chain?.some((c) => c.startsWith('viewOnce')) ? 'Sim' : 'Não'}`);
  push(`└─ Protocol: ${R.protocol?.disponivel ? `tipo ${safeValue(R.protocol.tipo)}` : 'Não'}`);

  push('');
  push('⚠️ INDICADORES');
  const relevantes = (R.indicators || []).filter((i) => Number(i.peso) > 0);
  const informativos = (R.indicators || []).filter((i) => !Number(i.peso));
  if (!relevantes.length) {
    push('• Nenhum indicador com peso relevante encontrado.');
  } else {
    relevantes.forEach((ind, i) => {
      push(`${i + 1}. [${ind.id}] ${ind.nome} — severidade ${ind.severidade}, peso ${ind.peso}`);
      if (ind.evidencia) push(`   evidência: ${ind.evidencia}`);
    });
  }
  if (informativos.length) {
    push('');
    push('ℹ️ Informativos (peso 0 — não elevam a classificação):');
    for (const ind of informativos) push(`• [${ind.id}] ${ind.nome}${ind.evidencia ? ` — ${ind.evidencia}` : ''}`);
  }

  push('');
  push('🔬 ANOMALIAS');
  if (!R.anomalies?.length) push('• Nenhuma anomalia detectada.');
  else R.anomalies.slice(0, 40).forEach((a, i) => push(`${i + 1}. ${a}`));

  if (R.unknownFields?.disponivel) {
    push('');
    push('🧬 CAMPOS DESCONHECIDOS');
    push(`Encontrados: ${R.unknownFields.total}`);
    R.unknownFields.campos.slice(0, 40).forEach((c, i) => {
      push(`${i + 1}. campo: ${c.campo}`);
      push(`   tipo: ${c.tipo}`);
      push(`   caminho: ${c.caminho}`);
      if (c.valor !== undefined) push(`   valor: ${c.valor}`);
    });
  }

  if (opts.debug) {
    push('');
    push('🛠️ MODO DEBUG (camadas)');
    push(`• Key conhecidos: ${JSON.stringify(R.key?.camposConhecidos || {})}`);
    push(`• contextInfo campos: ${(R.context?.campos || []).join(', ') || ND}`);
    push(`• contextInfo desconhecidos: ${(R.context?.desconhecidos || []).join(', ') || 'nenhum'}`);
    push(`• key desconhecidos: ${(R.key?.desconhecidos || []).join(', ') || 'nenhum'}`);
    push(`• unknown por camada: ${JSON.stringify(R.unknownFields?.porCamada || {})}`);
    push(`• correlation: ${JSON.stringify(R.correlation || {})}`);
  }

  push('');
  push('🧠 CONCLUSÃO TÉCNICA');
  for (const linha of R.explanation || []) push(`• ${linha}`);
  if (R.correlation) {
    push(`• Evidência estrutural: ${bool(R.correlation.estrutural)} | Assinatura de conteúdo: ${bool(R.correlation.assinaturaConteudo)} | Envelope vazio: ${bool(R.correlation.assinaturaEnvelopeVazio)} | Assinatura de transporte: ${bool(R.correlation.assinaturaTransporte)}`);
  }
  if (R.limitations?.length) {
    push('');
    push('🧾 LIMITAÇÕES:');
    for (const l of R.limitations) push(`• ${l}`);
  }
  push('_Nenhum indicador isolado é considerado suficiente. O valor está na correlação._');
  push('╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣');

  return L.join('\n');
}

/** Bloco resumido — para quem quer só o veredito. */
export function formatInvisibleResumo(resultado) {
  if (!resultado || typeof resultado !== 'object' || Array.isArray(resultado)) return '';
  if (!resultado.classification && !resultado.key && !resultado.payment) return '';
  const R = resultado;
  const L = [];
  L.push('🕵️ INVISÍVEL');
  L.push(`Classificação: ${CLASSIF_LABEL[R.classification] || R.classification}`);
  L.push(`Compatibilidade: ${R.confidence}/100`);
  L.push('');
  if (!R.indicators?.length) {
    L.push('Indicadores: nenhum');
  } else {
    L.push('Indicadores:');
    R.indicators.slice(0, 6).forEach((ind, i) => {
      const last = i === Math.min(6, R.indicators.length) - 1;
      L.push(`${last ? '└─' : '├─'} ${ind.nome}`);
    });
  }
  L.push('');
  L.push('Use `!get full` para a análise completa.');
  return L.join('\n');
}

export default {
  analyzeInvisibleMessage,
  formatInvisibleSection,
  formatInvisibleResumo,
  analisarKey,
  analisarLid,
  analisarDistribuicao,
  analisarDescriptografia,
  analisarSenderKey,
  analisarPagamento,
  analisarContexto,
  analisarCitacao,
  analisarWrappers,
  analisarStub,
  analisarProtocolo,
  analisarCamposDesconhecidos,
  correlacionar,
  construirExplicacao,
  INDICADORES,
  LIMITACOES,
};