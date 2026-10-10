// Detector do comando `!testmsg` (teste, por grupo).
//
// Alvo: mensagens que escondem o LINK/preview em campos que o WhatsApp Web
// desenha, mas que o bot NAO le (o texto simples e' limpo, tipo conversa).
// Por isso o anti-link comum nao pega: ele so' olha `conversation` /
// `extendedTextMessage.text`.
//
// Puro: sem socket, sem disco, sem log.

const WRAPPERS = new Set([
  'ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension',
  'documentWithCaptionMessage', 'editedMessage', 'deviceSentMessage'
]);

const LINK_RE = /(?:https?:\/\/|www\.|wa\.me\/|chat\.whatsapp\.com\/|whatsapp\.com\/channel\/|whatsapp\.com\/Channel\/|t\.me\/|[a-z0-9-]+\.(?:com|net|org|br|io|me|tv|link|xyz|info|app|gg|to|co)(?:\/|\b))/i;

// Link de CANAL/CONVITE (o que o raja traz). Estreito de proposito: usado para
// detectar link no TEXTO visivel sem confundir com link comum de mensagem.
const LINK_CANAL_RE = /whatsapp\.com\/channel\/|whatsapp\.com\/Channel\/|chat\.whatsapp\.com\/|wa\.me\/|t\.me\//i;

// Campos que carregam link/preview/anuncio. O bot nunca le esses; o cliente, sim.
const LINK_KEYS = new Set([
  'matchedText', 'canonicalUrl', 'linkPreviewMetadata', 'paymentLinkMetadata',
  'paymentExtendedMetadata', 'externalAdReply', 'quotedAd', 'actionLink',
  'sourceUrl', 'mediaUrl', 'thumbnailUrl', 'videoContentUrl', 'url', 'linkUrl',
  'title', 'description',
  // Tipos de mensagem de CANAL (o "card de canal" — a presenca deles e' o link).
  'newsletterAdminInviteMessage', 'newsletterFollowerInviteMessage', 'newsletterFollowerInviteMessageV2'
]);

/** Desembrulha wrappers (viewOnce/efemera/...) e devolve o conteudo folha. */
function conteudoFolha(message, maxHops = 10) {
  let atual = message;
  let hops = 0;
  while (atual && typeof atual === 'object' && hops++ < maxHops) {
    const chave = Object.keys(atual).find((k) => WRAPPERS.has(k) && atual[k] && typeof atual[k] === 'object' && atual[k].message);
    if (!chave) break;
    atual = atual[chave].message;
  }
  return atual && typeof atual === 'object' ? atual : null;
}

/** Texto "visivel" que o bot le hoje (o mesmo caminho do getMessageText). */
export function textoPrincipal(message) {
  const folha = conteudoFolha(message);
  if (!folha) return '';
  return folha.conversation
    || folha.extendedTextMessage?.text
    || folha.imageMessage?.caption
    || folha.videoMessage?.caption
    || folha.documentMessage?.caption
    || '';
}

/**
 * Procura strings com link/preview em campos que o bot NAO le.
 * @returns {{campo:string, valor:string}[]}
 */
export function extrairLinksEscondidos(message, options = {}) {
  const achados = [];
  const maxDepth = options.maxDepth ?? 12;
  const maxNodes = options.maxNodes ?? 5000;
  const seen = new WeakSet();
  let nodes = 0;

  function visit(val, caminho, profundidade) {
    if (nodes++ > maxNodes || profundidade > maxDepth) return;
    if (val === null || typeof val !== 'object') return;
    if (Buffer.isBuffer(val) || val instanceof Uint8Array) return;
    if (seen.has(val)) return;
    seen.add(val);
    if (Array.isArray(val)) {
      for (let i = 0; i < val.length; i++) visit(val[i], `${caminho}[${i}]`, profundidade + 1);
      return;
    }
    let entradas;
    try {
      entradas = Object.entries(val);
    } catch {
      return;
    }
    for (const [k, v] of entradas) {
      const p = caminho ? `${caminho}.${k}` : k;
      const ehTipoCanal = k === 'newsletterAdminInviteMessage' || k === 'newsletterFollowerInviteMessage' || k === 'newsletterFollowerInviteMessageV2';
      if (typeof v === 'string' && LINK_KEYS.has(k) && LINK_RE.test(v)) {
        achados.push({ campo: p, valor: v });
      } else if (ehTipoCanal && v && typeof v === 'object') {
        // O "card de canal": a PRESENCA do tipo ja' e' o link (o cliente
        // desenha o card que leva ao canal).
        const alvo = (typeof v.newsletterJid === 'string' && v.newsletterJid)
          || (typeof v.caption === 'string' && v.caption)
          || 'card de canal';
        achados.push({ campo: p, valor: String(alvo) });
      }
      visit(v, p, profundidade + 1);
    }
  }

  if (message && typeof message === 'object') visit(message, '', 0);
  return achados;
}

/**
 * True quando ha link escondido: existe URL num campo de preview/ad E o texto
 * visivel NAO tem link. (Se o texto tivesse o link, seria mensagem normal de
 * link e o anti-link comum pegaria — nao e' o caso alvo.)
 */
export function temLinkEscondido(message) {
  if (!message || typeof message !== 'object') return false;
  const escondidos = extrairLinksEscondidos(message);
  if (escondidos.length === 0) return false;
  const texto = textoPrincipal(message);
  const linkNoTexto = typeof texto === 'string' && LINK_RE.test(texto);
  return !linkNoTexto;
}

/**
 * Decisão do `!testmsg` para uma mensagem recebida (WebMessageInfo).
 *
 * Junta o sinal de TRANSPORTE com o de CONTEUDO:
 *
 *   • PAIRWISE_GROUP_PAYLOAD — `info.pairwiseGroupPayload === true`: stanza de
 *     GRUPO carregando enc PAREADO (`msg`/`pkmsg`). É a forma do retry, e
 *     também o transporte usado para entregar conteudo a um device excluido da
 *     chave rotacionada (o "raja"). MEDIDO na amostra real do dono: o `!get`
 *     mostrou `pairwiseGroupPayload: true` com conteudo `conversation` normal.
 *     ATENCAO: a propria fork avisa que um retry BENIGNO tambem carrega isso —
 *     e' sinal de transporte, nao prova.
 *
 *   • LINK_ESCONDIDO — URL/preview num campo que o cliente desenha e o bot nao
 *     le (matchedText, canonicalUrl, externalAdReply...), com o texto visivel
 *     sem link.
 *
 * @param {object} info WebMessageInfo
 * @returns {{detectado:boolean, motivos:string[]}}
 */
/**
 * Registra um `pairwiseGroupPayload` por remetente e devolve quantos ocorreram
 * na janela. É o que separa a RAJADA do raja (10 mensagens seguidas) do RETRY
 * benigno (1, no maximo alguns) — sem isso o flag sozinho daria falso positivo
 * em usuário comum que teve um device reenviado.
 *
 * O mapa é passado pelo chamador (mantém o módulo puro). Podado por tempo e por
 * tamanho, para não crescer sem limite.
 */
export function registrarPairwise(mapa, chave, agora = Date.now(), janelaMs = 60000) {
  if (!chave || !(mapa instanceof Map)) return 0;
  const arr = (mapa.get(chave) || []).filter((t) => agora - t < janelaMs);
  arr.push(agora);
  mapa.set(chave, arr);
  if (mapa.size > 5000) mapa.delete(mapa.keys().next().value);
  return arr.length;
}

/**
 * Decisão do `!testmsg` para uma mensagem recebida (WebMessageInfo).
 *
 * Regras (pensadas para NÃO dar falso positivo em usuário comum):
 *
 *   • LINK_CANAL_VISIVEL — link de canal/convite (whatsapp.com/channel,
 *     chat.whatsapp.com, wa.me, t.me) no texto. Prova por si.
 *   • LINK_ESCONDIDO — URL/preview num campo que o cliente desenha e o bot não
 *     lê (matchedText, canonicalUrl, externalAdReply...). Prova por si.
 *   • PAIRWISE_BURST — `pairwiseGroupPayload` é a assinatura de transporte do
 *     raja, MAS a própria fork avisa que um retry BENIGNO também carrega o flag.
 *     Por isso ele SÓ conclui sozinho quando aparece em RAJADA (>= 4 do mesmo
 *     autor na janela) — o retry normal é 1. Um `pairwiseGroupPayload` isolado
 *     NÃO é marcado (evita punir quem só teve um device reenviado).
 *
 * @param {object} info WebMessageInfo
 * @param {{pairwiseBurst?:boolean}} [opts]
 * @returns {{detectado:boolean, motivos:string[]}}
 */
export function detectarTestMsg(info, opts = {}) {
  if (!info || typeof info !== 'object') return { detectado: false, motivos: [] };
  const motivos = [];

  if (info.message && temLinkEscondido(info.message)) motivos.push('LINK_ESCONDIDO');

  const texto = textoPrincipal(info.message);
  if (typeof texto === 'string' && LINK_CANAL_RE.test(texto)) motivos.push('LINK_CANAL_VISIVEL');

  // `pairwiseGroupPayload` só entra com rajada (o retry benigno é isolado).
  if (info.pairwiseGroupPayload === true && opts.pairwiseBurst) motivos.push('PAIRWISE_BURST');

  return { detectado: motivos.length > 0, motivos };
}
