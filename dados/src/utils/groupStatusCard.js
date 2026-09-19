/**
 * Group Status com contexto do AUTOR original — experimento `!testecard`.
 *
 * O que se investiga aqui: existe no protocolo uma forma de o WhatsApp
 * reconhecer, dentro de um Group Status, QUEM escreveu a mensagem publicada —
 * de modo que o próprio cliente resolva nome/foto do autor, em vez de o bot
 * montar uma imagem com nome + foto + texto.
 *
 * A estrutura encontrada é `StatusAttribution.GroupStatus.authorJid` (campo 1
 * de `StatusAttribution.GroupStatus`, que é o campo 6 de `StatusAttribution`,
 * carregado em `ContextInfo.statusAttributions`, campo 65). O proto descreve
 * esse campo como o JID de quem autorou o group status; bibliotecas que
 * implementam o mesmo protocolo (Cobalt, whatsmeow, elaina-baileys) o expõem
 * com a mesma finalidade.
 *
 * O módulo é puro: recebe o `proto` por parâmetro em vez de importar o Baileys,
 * então dá para testar sem abrir socket. Também não inventa campo nenhum —
 * monta only o que existe no WAProto e valida contra ele.
 */

/**
 * Metadados de audiência + permissão de repostagem que o status de grupo usa.
 * Mantidos iguais aos do `!statusgrupo` para não divergir do que já funcionava.
 */
export const STATUS_CONTEXT_INFO = {
  featureEligibilities: { canBeReshared: true, canReceiveMultiReact: true },
  statusSourceType: 4, // TEXT
  statusAttributions: [{ type: 10 }], // STATUS_CLOSE_SHARING
  statusAudienceMetadata: { audienceType: 1 }, // CLOSE_FRIENDS
};

/**
 * Extrai o texto de uma mensagem citada, descascando encapsulamentos.
 *
 * Reaproveita a mesma caminhada de `viewOnce.unwrapContent`, mas sem depender
 * dele para manter este módulo testável isoladamente.
 *
 * @param {object} quoted conteúdo citado (`contextInfo.quotedMessage`)
 * @returns {{text: string, media: {type: string, node: object}|null}}
 */
export function readQuotedContent(quoted) {
  const CAPTION_KEYS = ['imageMessage', 'videoMessage', 'ptvMessage', 'documentMessage', 'audioMessage'];
  const WRAPPERS = ['viewOnceMessageV2Extension', 'viewOnceMessageV2', 'viewOnceMessage', 'ephemeralMessage', 'documentWithCaptionMessage'];
  const CHILDREN = ['message', 'editedMessage', 'originalMessage', 'groupStatusMessage'];

  let current = quoted;
  let guard = 0;

  while (current && typeof current === 'object' && guard < 12) {
    guard += 1;

    const mediaKey = ['imageMessage', 'videoMessage', 'ptvMessage', 'audioMessage', 'stickerMessage', 'documentMessage']
      .find((k) => current[k] && typeof current[k] === 'object');
    if (mediaKey) {
      return {
        text: typeof current[mediaKey]?.caption === 'string' ? current[mediaKey].caption.trim() : '',
        media: { type: mediaKey, node: current[mediaKey] },
      };
    }

    if (typeof current.conversation === 'string' && current.conversation.trim()) {
      return { text: current.conversation.trim(), media: null };
    }
    if (typeof current.extendedTextMessage?.text === 'string' && current.extendedTextMessage.text.trim()) {
      return { text: current.extendedTextMessage.text.trim(), media: null };
    }
    for (const k of CAPTION_KEYS) {
      if (typeof current[k]?.caption === 'string' && current[k].caption.trim()) {
        return { text: current[k].caption.trim(), media: null };
      }
    }

    const wrapperKey = WRAPPERS.find((k) => current[k] && typeof current[k] === 'object');
    if (!wrapperKey) break;
    const wrapper = current[wrapperKey];
    const child = CHILDREN.map((f) => wrapper?.[f]).find((v) => v && typeof v === 'object');
    if (!child) break;
    current = child;
  }

  return { text: '', media: null };
}

/**
 * Monta o `StatusAttribution` que carrega a identidade do autor.
 *
 * Um único atributo, do tipo `GROUP_STATUS`, com `authorJid`. Não adiciona
 * nenhum outro campo: qualquer chave fora do WAProto seria descartada na
 * serialização (verificado) e passaria a falsa impressão de suporte.
 *
 * @param {object} proto o `proto` do Baileys
 * @param {string} authorJid JID ou LID de quem escreveu a mensagem original
 * @returns {object|null} atributo pronto, ou `null` se o proto não suportar
 */
export function buildAuthorAttribution(proto, authorJid) {
  if (!proto?.StatusAttribution?.Type || !proto?.StatusAttribution?.GroupStatus) return null;
  if (!authorJid || typeof authorJid !== 'string') return null;

  const tipo = proto.StatusAttribution.Type.GROUP_STATUS;
  if (typeof tipo !== 'number') return null;

  return proto.StatusAttribution.create({
    type: tipo,
    // O cliente lê o autor daqui para resolver nome/foto (é a finalidade do
    // campo, segundo o proto e as implementações que o usam).
    groupStatus: proto.StatusAttribution.GroupStatus.create({ authorJid }),
  });
}

/**
 * Monta o conteúdo do Group Status com contexto do autor original.
 *
 * Junta tudo que o protocolo permite carregar numa única stanza:
 *   - o CONTEÚDO da mensagem original (texto, ou legenda de uma mídia);
 *   - a IDENTIDADE do autor (`authorJid` na atribuição de status);
 *   - o CONTEXTO de participante (`participant`, `participantAlt`);
 *   - a REFERÊNCIA à mensagem (`quotedMessage`, `stanzaId`, `remoteJid`).
 *
 * O envio NÃO substitui o remetente da mensagem pelo bot: as identidades vão
 * nos campos de contexto, e o payload continua sendo um Group Status do grupo.
 *
 * @param {object} opts
 * @param {object} opts.proto `proto` do Baileys
 * @param {string} opts.authorJid identidade do autor original
 * @param {string} [opts.authorJidAlt] identidade alternativa (LID↔PN) do autor
 * @param {string} opts.text conteúdo da mensagem original
 * @param {object} [opts.quotedMessage] conteúdo citado cru, para referência
 * @param {string} [opts.stanzaId] id da mensagem original
 * @param {string} [opts.groupJid] JID do grupo (vai em `remoteJid`)
 * @returns {object|null} conteúdo pronto para `sendMessage`, ou `null` se faltar suporte
 */
export function buildAuthorContextStatus(opts = {}) {
  const { proto, authorJid, authorJidAlt, text, quotedMessage, stanzaId, groupJid } = opts;

  const atribuicao = buildAuthorAttribution(proto, authorJid);
  if (!atribuicao) return null;

  const texto = typeof text === 'string' ? text.trim() : '';
  if (!texto) return null;

  const contextInfo = {
    ...STATUS_CONTEXT_INFO,
    // Contexto de participante: quem escreveu a mensagem original.
    participant: authorJid,
    // Permite ao cliente correlacionar as duas identidades (LID e PN) quando
    // existirem; sem valor, o campo simplesmente não vai.
    ...(authorJidAlt ? { participantAlt: authorJidAlt } : {}),
    // Referência à mensagem original.
    ...(stanzaId ? { stanzaId } : {}),
    ...(quotedMessage ? { quotedMessage } : {}),
    ...(groupJid ? { remoteJid: groupJid } : {}),
    statusAttributions: [
      ...STATUS_CONTEXT_INFO.statusAttributions,
      atribuicao,
    ],
  };

  return { groupStatus: true, text: texto, contextInfo };
}

// ---------------------------------------------------------------------------
// Variações do experimento — cada uma isola UMA hipótese, para comparar no
// aparelho qual delas o cliente aceita/renderiza. A ordem vai da mais completa
// à mais conservadora.
// ---------------------------------------------------------------------------

/** Variantes disponíveis no `!testecard`. */
export const CARD_VARIANTS = ['full', 'attribution', 'quote', 'plain'];

/**
 * Monta o payload de UMA variante do experimento.
 *
 * @param {string} variant uma de `CARD_VARIANTS`
 * @param {object} opts mesmas opções de `buildAuthorContextStatus`
 * @returns {object|null}
 */
export function buildCardVariant(variant, opts = {}) {
  const base = buildAuthorContextStatus(opts);
  if (!base) return null;

  const ci = base.contextInfo;

  switch (variant) {
    // Tudo junto: conteúdo + identidade + contexto + referência.
    case 'full':
      return base;

    // Só a identidade do autor (sem participant/quote). Isola o efeito do
    // `authorJid`: se o nome aparecer aqui, o mérito é dele.
    case 'attribution':
      return {
        groupStatus: true,
        text: base.text,
        contextInfo: {
          ...STATUS_CONTEXT_INFO,
          statusAttributions: ci.statusAttributions,
        },
      };

    // Só o contexto de citação (como o `!statusgrupo` já faz hoje, mais a
    // referência). Serve de controle: mostra o que o cliente faz SEM o autor.
    case 'quote':
      return {
        groupStatus: true,
        text: base.text,
        contextInfo: {
          ...STATUS_CONTEXT_INFO,
          ...(ci.participant ? { participant: ci.participant } : {}),
          ...(ci.stanzaId ? { stanzaId: ci.stanzaId } : {}),
          ...(ci.remoteJid ? { remoteJid: ci.remoteJid } : {}),
        },
      };

    // Controle puro: status de grupo comum, sem nenhum campo do experimento.
    case 'plain':
      return {
        groupStatus: true,
        text: base.text,
        contextInfo: { ...STATUS_CONTEXT_INFO },
      };

    default:
      return null;
  }
}

/**
 * Descreve no console o que foi realmente enviado, para separar
 * "o servidor rejeitou" de "saiu e o cliente ignorou".
 *
 * @param {object} content payload montado
 * @returns {string} resumo de uma linha
 */
export function describePayload(content) {
  const ci = content?.contextInfo || {};
  const autores = (ci.statusAttributions || [])
    .filter((a) => a?.groupStatus?.authorJid)
    .map((a) => a.groupStatus.authorJid);

  return [
    `tipo=${Object.keys(content || {}).filter((k) => k !== 'contextInfo').join('+') || '?'}`,
    `bytes=${Buffer.isBuffer(content?.text) ? content.text.length : (content?.text?.length || 0)}`,
    `autor=${autores[0] || '-'}`,
    `participant=${ci.participant || '-'}`,
    `quote=${ci.stanzaId ? 'sim' : 'nao'}`,
    `remoteJid=${ci.remoteJid || '-'}`,
    `attributions=${(ci.statusAttributions || []).length}`,
  ].join(' | ');
}