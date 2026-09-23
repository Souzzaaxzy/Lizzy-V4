/**
 * Envio de mídia com visibilidade restrita a UM membro do grupo.
 *
 * TÉCNICA
 * -------
 * Reusa a mesma rotação de Sender Key que o `!rajar` já usa: a mensagem é
 * cifrada com um estado NOVO da Sender Key e esse estado só é distribuído ao
 * subconjunto informado (`allowedParticipants`). Quem não está no subconjunto
 * não recebe o material da chave, então não consegue decifrar — e o cliente
 * esconde a entrada em vez de mostrar "aguardando mensagem".
 *
 * LIMITE HONESTO (o mesmo já documentado no `!rajar`)
 * ------------------------------------------------
 * A stanza continua endereçada AO GRUPO. Quem foi excluído **percebe que houve
 * uma mensagem** (recebe a referência); o que ele não consegue é **ler o
 * conteúdo**. Não é uma barreira contra o servidor do WhatsApp — é restrição de
 * distribuição de chave.
 *
 * FALHA FECHADA: se a API de rotação não existir na fork instalada, se o alvo
 * não for um JID válido, ou se a lista resolver vazia, **nada é enviado**. Cair
 * para o grupo inteiro seria mostrar exatamente o que se quer esconder.
 */

import { proto } from '@itsliaaa/baileys';

/**
 * A fork instalada expõe a API de rotação de Sender Key?
 * (É a mesma checagem que o `!rajar` faz antes de enviar.)
 */
export const supportsRestrictedMedia = (sock) =>
  typeof sock?.relayGroupMessageWithSenderKeyRotation === 'function';

/** Um JID minimamente utilizável: `algo@servidor`. */
export const isUsableJid = (jid) =>
  typeof jid === 'string' && /^[^@\s]+@[^@\s]+$/.test(jid);

/**
 * Normaliza o alvo para uma lista de UM único JID.
 *
 * Aceita JID (PN) ou LID — quem chama deve resolver para UMA forma só (ver
 * `resolveSenderJid`). Passar as duas formas do MESMO membro o faria contar
 * como dois destinatários, e a mensagem iria para dois dispositivos de quem
 * pediu em vez de um.
 *
 * @param {(string|string[]|null)} alvo
 * @returns {string[]} JIDs válidos, sem repetição
 */
export const normalizeRestrictedTargets = (alvo) => {
  const lista = (Array.isArray(alvo) ? alvo : [alvo])
    .filter((j) => isUsableJid(j));
  return [...new Set(lista)];
};

/**
 * Resolve o remetente para a forma que o GRUPO usa (LID ou PN).
 *
 * Por que isto existe: a lista de destinatários do `relayMessage` é usada
 * **como está** — a lib não converte LID↔PN ali. E o grupo endereça todos os
 * participantes num modo só (`addressingMode` do metadata, que é o que o campo
 * `id` de cada participante já reflete). Então mandar "LID e PN da mesma pessoa"
 * a conta como **dois** destinatários.
 *
 * A escolha é pelo metadata: se o participante aparece lá com aquele `id`,
 * é essa a forma certa. Sem correspondência, cai para o que foi informado.
 *
 * @param {object} params
 * @param {Array} [params.participants] lista do metadata do grupo
 * @param {string} params.sender         JID/LID de quem pediu
 * @param {string} [params.senderAlt]    o outro identificador conhecido
 * @returns {string|null}
 */
export const resolveSenderJid = ({ participants, sender, senderAlt }) => {
  const candidatos = normalizeRestrictedTargets([sender, senderAlt]);
  if (!Array.isArray(participants)) {
    return candidatos[0] || null;
  }
  // 1) Um `id` do metadata que case com qualquer candidato: é a forma do grupo.
  for (const p of participants) {
    if (!p?.id) continue;
    const bate = candidatos.includes(p.id)
      || candidatos.includes(p.phoneNumber)
      || candidatos.includes(p.lid)
      || candidatos.includes(p.pn);
    if (bate) return p.id;
  }
  // 2) Sem correspondência no metadata, usa o primeiro candidato válido.
  return candidatos[0] || null;
};

/**
 * Envia uma mensagem cujo CONTEÚDO só o alvo consegue decifrar.
 *
 * @param {object} params
 * @param {object} params.sock        socket da Baileys
 * @param {string} params.groupJid    grupo
 * @param {string[]} params.targets   JIDs que PODEM decifrar (não vazio)
 * @param {Buffer} params.mediaBuffer mídia já baixada
 * @param {boolean} params.isVideo    vídeo (com `gifPlayback` quando for GIF)
 * @param {string} [params.caption]   legenda opcional
 * @param {string[]} [params.mentions] menções reais da legenda
 * @param {Function} params.generateWAMessage
 * @param {Function} [params.generateMessageID]
 * @returns {Promise<{ok: boolean, reason?: string, messageId?: string}>}
 */
export const sendRestrictedMedia = async ({
  sock,
  groupJid,
  targets,
  mediaBuffer,
  isVideo,
  caption,
  mentions,
  generateWAMessage,
  generateMessageID
}) => {
  const alvos = normalizeRestrictedTargets(targets);
  if (alvos.length === 0) {
    return { ok: false, reason: 'sem_alvo_valido' };
  }
  if (!supportsRestrictedMedia(sock)) {
    return { ok: false, reason: 'fork_sem_api_de_rotacao' };
  }
  if (!Buffer.isBuffer(mediaBuffer) || mediaBuffer.length === 0) {
    return { ok: false, reason: 'buffer_vazio' };
  }
  if (typeof generateWAMessage !== 'function') {
    return { ok: false, reason: 'sem_gerador_de_mensagem' };
  }

  try {
    // `generateWAMessage` é quem faz o prepare/upload da mídia pelo caminho
    // normal da lib — `generateWAMessageFromContent` NÃO prepara mídia, e usá-lo
    // aqui deixava a mensagem sem a mediaKey (o upload nunca acontecia).
    //
    // O uploader é o `waUploadToServer` do PRÓPRIO socket (mesma função que o
    // `sendMessage` usa por dentro), então nada de pipeline paralelo.
    const upload = sock?.waUploadToServer;
    if (typeof upload !== 'function') {
      return { ok: false, reason: 'socket_sem_uploader' };
    }

    const baseMsg = await generateWAMessage(
      groupJid,
      isVideo
        ? { video: mediaBuffer, ...(caption ? { caption } : {}), gifPlayback: true }
        : { image: mediaBuffer, ...(caption ? { caption } : {}) },
      {
        userJid: sock?.user?.id,
        upload,
        ...(mentions && mentions.length ? { mentions } : {})
      }
    );

    const messageId = typeof generateMessageID === 'function'
      ? generateMessageID()
      : undefined;

    await sock.relayGroupMessageWithSenderKeyRotation(
      groupJid,
      baseMsg.message,
      { allowedParticipants: alvos, ...(messageId ? { messageId } : {}) }
    );

    return { ok: true, messageId };
  } catch (error) {
    // Falha fechada: propaga o motivo, não envia para o grupo inteiro.
    return { ok: false, reason: 'erro_no_envio', detail: error?.message || String(error) };
  }
};

export { proto };
