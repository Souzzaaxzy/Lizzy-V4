/**
 * Revogação de mensagem de PAGAMENTO (`requestPaymentMessage` / `sendPaymentMessage`).
 *
 * Por que existe um caminho próprio: o `!d` comum monta a key como mensagem de
 * TERCEIRO (`fromMe: false` + `participant`) e manda um `protocolMessage.REVOKE`
 * apontando para o alvo. Para mensagem comum isso funciona, mas o card de
 * pagamento é uma stanza especial e a revogação direta não tem efeito — a
 * mensagem continua visível.
 *
 * A mecânica que funciona (a mesma das implementações que apagam payment):
 *
 *   1. cria uma mensagem temporária e guarda o ID dela (`idTemp`);
 *   2. envia uma EDIÇÃO cujo ALVO (`protocolMessage.key.id`) é a mensagem de
 *      pagamento e cujo próprio id de stanza é o do pagamento — o servidor
 *      passa a tratar aquele id como uma mensagem editável do bot;
 *   3. a revogação daquele id (o do pagamento) então vale.
 *
 * As peças puras (detecção do pagamento, candidatas de key e o payload da
 * edição) ficam aqui, sem socket — é o que permite testar a mecânica sem abrir
 * conexão.
 */

/** Tipos de conteúdo que são um card/pedido de pagamento. */
export const PAYMENT_KEYS = [
  'requestPaymentMessage',
  'sendPaymentMessage',
  'paymentInviteMessage',
  'declinePaymentRequestMessage',
  'cancelPaymentRequestMessage',
  'paymentReminderMessage',
  'splitPaymentMessage',
];

/** Invólucros que podem carregar o pagamento dentro de `message`. */
const WRAPPERS = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'documentWithCaptionMessage',
  'editedMessage',
  'deviceSentMessage',
  'associatedChildMessage',
];

/**
 * O conteúdo é (ou encapsula) um pagamento?
 *
 * Olha o tipo em qualquer profundidade de invólucro: citar um payment às vezes
 * devolve o `quotedMessage` embrulhado, e uma checagem só no topo deixaria o
 * caso cair no caminho comum — que é justamente o que não apaga.
 */
export function isPaymentContent(content) {
  let current = content;
  let guard = 0;

  while (current && typeof current === 'object' && guard < 8) {
    guard += 1;

    for (const key of PAYMENT_KEYS) {
      if (current[key] && typeof current[key] === 'object') return true;
    }

    const wrapperKey = WRAPPERS.find((k) => current[k] && typeof current[k] === 'object');
    if (!wrapperKey) break;
    const child = current[wrapperKey]?.message;
    if (!child || typeof child !== 'object') break;
    current = child;
  }

  return false;
}

/** Identidade sem o sufixo `:device`, preservando o servidor (`@s.whatsapp.net` / `@lid`). */
export function baseId(id) {
  const [user, server] = String(id || '').split('@');
  const semDevice = user.split(':')[0];
  return server ? `${semDevice}@${server}` : semDevice;
}

/**
 * Alguma das identidades é o próprio bot?
 *
 * Compara por BASE (`:device` fora), porque o `nazu.user.id` traz o device e o
 * participant do metadata não. É isso que decide `fromMe` na hora de revogar.
 */
export function isBotAuthor(candidates, botIds) {
  const bots = new Set((botIds || []).filter(Boolean).map(baseId));
  if (bots.size === 0) return false;
  return (candidates || []).filter(Boolean).some((c) => bots.has(baseId(c)));
}

/**
 * Candidatas de key para a revogação, da mais específica para a mais genérica.
 *
 * `participant` pode chegar como LID e o servidor às vezes só casar pelo PN —
 * por isso as duas formas são tentadas antes de desistir do participant.
 */
export function buildPaymentDeleteKeys({ remoteJid, id, participant, participantPn, fromMe = false }) {
  if (!remoteJid || !id) return [];

  const keys = [];
  const seen = new Set();
  const add = (key) => {
    const signature = JSON.stringify(key);
    if (seen.has(signature)) return;
    seen.add(signature);
    keys.push(key);
  };

  if (fromMe) {
    add({ remoteJid, id, fromMe: true });
    return keys;
  }

  if (participant && participantPn) {
    add({ remoteJid, id, fromMe: false, participant, participantAlt: participantPn });
  }
  if (participantPn) add({ remoteJid, id, fromMe: false, participant: participantPn });
  if (participant) add({ remoteJid, id, fromMe: false, participant });
  add({ remoteJid, id, fromMe: false });

  return keys;
}

/**
 * Conteúdo da edição usada para habilitar a revogação do pagamento.
 *
 * O alvo (`edit.id`) é a mensagem TEMPORÁRIA; quem vai no `messageId` (o id da
 * própria stanza) é o id do PAGAMENTO. Essa inversão é o ponto do truque.
 */
export function buildPaymentEditContent(texto, idTemp) {
  return { text: texto, edit: { id: idTemp } };
}

/**
 * Resolve o PN de um participant que veio como LID.
 *
 * O resolver é injetado (`nazu.signalRepository.lidMapping.getPNForLID`) para o
 * módulo continuar puro. Devolve `null` quando não é LID ou quando a resolução
 * falha — nunca lança.
 */
export async function resolveParticipantPn(resolver, jid) {
  if (!jid || !String(jid).endsWith('@lid')) return null;
  try {
    const pn = await resolver?.(jid);
    return pn || null;
  } catch {
    return null;
  }
}
