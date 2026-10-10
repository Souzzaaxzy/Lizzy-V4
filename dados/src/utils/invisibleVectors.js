// Detectores dos vetores 3, 4, 5 e 6 de "alguns usuários não conseguem decifrar"
// (ver docs/mensagens-nao-decifraveis.md). Puros: sem socket, sem disco, sem log.
//
// Todos são OBSERVAÇÃO: devolvem um rótulo/motivo para o chamador decidir.

import { safeJsonStringify } from './messageInspector.js';

const WRAPPERS = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension', 'deviceSentMessage', 'documentWithCaptionMessage'];

/** Desembrulha wrappers (viewOnce/efêmera/...) até o conteúdo folha. */
function conteudoFolha(message, maxHops = 10) {
  let atual = message;
  let hops = 0;
  while (atual && typeof atual === 'object' && hops++ < maxHops) {
    const k = WRAPPERS.find((w) => atual[w] && typeof atual[w] === 'object' && atual[w].message);
    if (!k) break;
    atual = atual[k].message;
  }
  return atual && typeof atual === 'object' ? atual : null;
}

const temMaterial = (buf) => Boolean(buf && (buf.length === undefined || buf.length > 0));

// ===========================================================================
// #5 — ADD-ON (edição/reação/enquete) keyed por Message Secret
// ===========================================================================
/**
 * Uma edição/reação ("add-on") é cifrada com uma chave derivada do **Message
 * Secret** da mensagem-alvo. Se o alvo não tinha esse secret (não decifrou a
 * mensagem original), o add-on não decifra — fica invisível.
 *
 * Sinal observável: é um add-on (editedMessage / reaction / encReaction /
 * pollUpdate) que aponta para uma mensagem-alvo e NÃO traz um `messageSecret`
 * utilizável.
 *
 * @returns {{suspeito:boolean, motivo?:string, detalhe?:object}}
 */
export function analisarAddonSemSecret(info) {
  const msg = info?.message;
  if (!msg || typeof msg !== 'object') return { suspeito: false };
  const leaf = conteudoFolha(msg) || msg;

  const ehAddon = Boolean(
    leaf.protocolMessage?.editedMessage
    || leaf.reactionMessage
    || leaf.encReactionMessage
    || leaf.pollUpdateMessage
    || msg.messageContextInfo?.messageAssociation
    || msg.associatedChildMessage
  );
  if (!ehAddon) return { suspeito: false };

  // O secret pode vir no envelope (messageContextInfo.messageSecret) ou no
  // associado (associatedChildMessage.message.messageContextInfo.messageSecret).
  const secTopo = msg.messageContextInfo?.messageSecret || info?.messageContextInfo?.messageSecret || leaf.messageContextInfo?.messageSecret;
  const secAssoc = msg.associatedChildMessage?.message?.messageContextInfo?.messageSecret;
  const temSecret = temMaterial(secTopo) || temMaterial(secAssoc);

  const tipo = leaf.protocolMessage?.editedMessage ? 'edicao'
    : (leaf.reactionMessage || leaf.encReactionMessage) ? 'reacao'
    : leaf.pollUpdateMessage ? 'voto'
    : 'addon';

  if (!temSecret) {
    return { suspeito: true, motivo: 'ADDON_SEM_SECRET', detalhe: { tipo } };
  }
  return { suspeito: false };
}

// ===========================================================================
// #6 — Sender Key de STATUS (status que só alguns veem)
// ===========================================================================
/** A mensagem é um status (do grupo ou menção de status)? */
export function ehStatus(info) {
  const msg = info?.message;
  if (!msg) return false;
  return Boolean(
    msg.groupStatusMessageV2 || msg.groupStatusMessage
    || msg.statusMentionMessage || msg.groupStatusMentionMessage
    || msg.statusAddYours
    || msg.extendedTextMessage?.contextInfo?.isGroupStatus
  );
}

/**
 * Status cuja Sender Key foi rotacionada para excluir alguém: é um status E o
 * transporte marca distribuição seletiva (`info.selectiveDistribution`). O
 * excluído vê o status existir, mas não o conteúdo.
 *
 * @returns {{suspeito:boolean, motivo?:string}}
 */
export function analisarSenderKeyStatus(info) {
  if (!ehStatus(info)) return { suspeito: false };
  const sel = info?.selectiveDistribution;
  if (sel != null && sel !== false) return { suspeito: true, motivo: 'STATUS_SELECTIVE' };
  return { suspeito: false };
}

// ===========================================================================
// #4 — Salto de chain / retries (chave/epoch que o alvo não tem)
// ===========================================================================
/**
 * Repetições de retry indicam que o dispositivo não conseguiu decifrar e está
 * pedindo re-entrega. Um número alto de retries é objetivo e disponível
 * (`info.retryCount`), e é o sinal acessível do "não tenho a chave/epoch".
 * Também mede um salto de contador, quando o chamador passa o estado.
 *
 * @param {object} info
 * @param {Map} estado contador por autor (o chamador mantém)
 * @param {string} autor
 * @param {number} [limiteRetry=3]
 * @param {number} [limiteSalto=120]
 * @returns {{suspeito:boolean, motivo?:string, detalhe?:object}}
 */
export function analisarSaltoChain(info, estado, autor, limiteRetry = 3, limiteSalto = 120) {
  const retry = Number(info?.retryCount) || 0;
  if (retry >= limiteRetry) {
    return { suspeito: true, motivo: 'RETRY_ALTO', detalhe: { retry } };
  }
  // Salto de contador (quando existe um número monotônico de mensagem do autor).
  const contador = Number(info?.messageChainIndex ?? info?.chainIndex ?? NaN);
  if (Number.isFinite(contador) && estado instanceof Map && autor) {
    const ultimo = estado.get(autor);
    estado.set(autor, contador);
    if (estado.size > 5000) estado.delete(estado.keys().next().value);
    if (typeof ultimo === 'number' && contador - ultimo > limiteSalto) {
      return { suspeito: true, motivo: 'SALTO_CHAIN', detalhe: { de: ultimo, para: contador } };
    }
  }
  return { suspeito: false };
}

// ===========================================================================
// #3 — Trigger de retry + forja (mesmo ID, conteúdo diferente)
// ===========================================================================
/**
 * O ataque de "consistência de transcrição": o alvo recebe, sob o MESMO ID, um
 * conteúdo diferente do que os outros receberam. Como só vemos o que ESTE bot
 * recebeu, o que dá para medir aqui é o sinal indireto: o mesmo ID chegando
 * mais de uma vez com conteúdo diferente (dedup por id + hash do conteúdo).
 *
 * @param {Map} estado id -> hash do conteúdo (o chamador mantém)
 * @param {object} info
 * @returns {{suspeito:boolean, motivo?:string, detalhe?:object}}
 */
export function analisarForja(estado, info) {
  if (!(estado instanceof Map)) return { suspeito: false };
  const id = info?.key?.id;
  if (!id || !info?.message) return { suspeito: false };
  const hash = safeJsonStringify(info.message).slice(0, 4000);
  const anterior = estado.get(id);
  estado.set(id, hash);
  if (estado.size > 3000) estado.delete(estado.keys().next().value);
  if (typeof anterior === 'string' && anterior !== hash) {
    return { suspeito: true, motivo: 'ID_CONTEUDO_DIFERENTE', detalhe: { id } };
  }
  return { suspeito: false };
}
