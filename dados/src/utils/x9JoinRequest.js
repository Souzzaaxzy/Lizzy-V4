import fs from 'fs';
import path from 'path';

/**
 * X9 — pedido de entrada (puro, sem socket).
 *
 * O evento `group.join-request` do WhatsApp é emitido em três momentos:
 *
 *   - `created`  → alguém PEDIU para entrar (é o card de solicitação);
 *   - `revoked`  → o próprio solicitante CANCELOU o pedido;
 *   - `rejected` → um admin RECUSOU o pedido.
 *
 * Só `created` é pedido novo. Tratar `rejected`/`revoked` como se fossem
 * `created` faz o bot reenviar o card de solicitação — o pedido "volta" com o
 * mesmo id, como se nunca tivesse sido resolvido, e o X9 anuncia uma
 * solicitação que já tinha sido negada.
 *
 * O corpo do listener vive AQUI (e não dentro do `connect.js`) porque importar
 * o connect abre conexão de verdade. Assim o teste roda exatamente o mesmo
 * caminho que a produção — foi replicar a lógica no teste que deixou passar o
 * defeito relatado.
 */

/** Actions canônicas do pedido de entrada. */
export const JOIN_ACTIONS = ['created', 'revoked', 'rejected'];

/**
 * Este evento é um PEDIDO NOVO (e não um pedido já resolvido)?
 *
 * Comparação estrita com `'created'`: qualquer outra coisa — inclusive um valor
 * inesperado vindo de uma versão futura do stub — **não** dispara o card. Na
 * dúvida, não anunciar uma solicitação é o lado seguro do erro.
 */
export function isNewJoinRequest(action) {
  return action === 'created';
}

/** O pedido foi resolvido (cancelado ou recusado) por alguém? */
export function isResolvedJoinRequest(action) {
  return action === 'revoked' || action === 'rejected';
}

/**
 * Identidade do ATOR (quem aprovou/recusou), para a menção do card.
 *
 * Prefere o PN ao LID de propósito: a menção `@<lid>` **não renderiza** no
 * cliente — o card diz "por @fulano" e o leitor veria o número interno do LID
 * em vez do contato. O LID continua como alternativa quando o PN não vem.
 */
export function resolveJoinActor({ author, authorPn } = {}) {
  return authorPn || author || null;
}

/**
 * Identidade do SOLICITANTE (quem pediu para entrar), para menção e busca.
 * Mesma preferência pelo PN do ator: é o número que a menção resolve.
 */
export function resolveJoinRequester({ participant, participantPn } = {}) {
  return participantPn || participant || null;
}

/**
 * Salva o evento no histórico de pedidos do grupo (`joinRequests`).
 *
 * Best-effort: falha de disco não pode derrubar o tratamento da solicitação.
 *
 * @returns {boolean} true se registrou
 */
export function recordJoinRequest(databaseDir, inf) {
  const { id: groupId, author, authorPn, participant, participantPn, action, method } = inf || {};
  if (!groupId || !databaseDir) return false;
  try {
    const groupFile = path.join(databaseDir, 'grupos', `${groupId}.json`);
    const groupData = fs.existsSync(groupFile)
      ? JSON.parse(fs.readFileSync(groupFile, 'utf-8'))
      : {};

    groupData.joinRequests = groupData.joinRequests || [];
    groupData.joinRequests.push({
      autor: author || null,
      autorPn: authorPn || null,
      vitima: participant || null,
      vitimaPn: participantPn || null,
      acao: action,
      metodo: method || null,
      data: new Date().toLocaleDateString('pt-BR'),
      hora: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      timestamp: Date.now(),
    });

    if (groupData.joinRequests.length > 100) {
      groupData.joinRequests = groupData.joinRequests.slice(-100);
    }

    fs.writeFileSync(groupFile, JSON.stringify(groupData, null, 2));
    return true;
  } catch {
    return false;
  }
}

/**
 * Trata um evento `group.join-request`.
 *
 * Este é o corpo que o `connect.js` executa no listener. Só `created` segue
 * para o envio do card; os pedidos já resolvidos retornam sem fazer nada.
 *
 * @param {object} deps
 * @param {object} deps.sock  socket do Baileys
 * @param {object} deps.inf   payload do evento
 * @param {string} deps.databaseDir  diretório do banco (para o histórico)
 * @param {Function} deps.processNewJoinRequest  do `x9System.js`
 * @param {Function} [deps.loadGroupSettings]  carrega as configs do grupo
 * @returns {Promise<{ignorado: boolean, motivo?: string, card?: object}>}
 */
export async function handleJoinRequestEvent({ sock, inf, databaseDir, processNewJoinRequest, loadGroupSettings, notifyRejection }) {
  const { id: groupId, action } = inf || {};

  // PEDIDO NOVO -> card de solicitação.
  if (isNewJoinRequest(action)) {
    if (groupId && databaseDir) recordJoinRequest(databaseDir, inf);

    if (!sock || typeof processNewJoinRequest !== 'function') {
      return { acao: 'novo', card: null };
    }

    const groupSettings = typeof loadGroupSettings === 'function'
      ? await loadGroupSettings(groupId)
      : { x9: true };

    const card = await processNewJoinRequest(sock, inf, groupSettings);
    return { acao: 'novo', card };
  }

  // RECUSA -> card de "quem recusou".
  //
  // MEDIDO: a recusa NÃO gera `group-participants.update`. Em `messages-recv.js`
  // o `revoked_membership_requests` só preenche `messageStubType`/
  // `messageStubParameters` — o `emitParticipantsUpdate` é chamado apenas nos
  // casos de `add`/`remove`/`promote`/`demote`. Então quem chega aqui é a ÚNICA
  // oportunidade de emitir o card de recusa; sem isto, o adm recusa e nada é
  // enviado.
  //
  // O solicitante vem do PN (o `normalizeJid` do x9System devolve `null` para
  // LID, então o store é chaveado pelo número) e o ator é quem recusou.
  if (action === 'rejected') {
    const requester = resolveJoinRequester(inf);
    const actor = resolveJoinActor(inf);

    if (groupId && databaseDir) recordJoinRequest(databaseDir, inf);

    if (!sock || !groupId || !requester || !actor || typeof notifyRejection !== 'function') {
      return { acao: 'recusa', enviado: false, requester, actor };
    }

    const card = await notifyRejection({ sock, groupId, requester, actor, inf });
    return { acao: 'recusa', enviado: Boolean(card), card, requester, actor };
  }

  // CANCELAMENTO pelo próprio solicitante: o pedido saiu, mas "negado por @X"
  // seria mentira (o ator é o próprio solicitante). Não se envia card.
  return { acao: 'ignorado', motivo: `action=${action}` };
}
