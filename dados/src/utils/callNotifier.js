/**
 * Notificacoes de chamada (call) para grupos com o toggle `!testcall` ligado.
 *
 * O Baileys entrega eventos de chamada por `ev.on('call', ([call]) => ...)`, onde
 * `call` tem `chatId`, `from`, `id`, `status`, `isVideo`, `isGroup` e, em alguns
 * casos, `callerPn`. Isso e SINALIZACAO apenas: a lib nao carrega audio/video,
 * entao nao existe "entrar na chamada" -- so da para observar e recusar.
 *
 * Este modulo e puro (nao abre socket, nao toca disco): quem le o `groupData` e
 * quem envia a mensagem e o connect.js. Assim da para testar sem WhatsApp.
 */

import { CallStatus, isMissedCall } from '@itsliaaa/baileys';

/**
 * Extrai o numero de um JID/LID para exibir de forma legivel.
 * Mantem o JID completo quando nao parece um numero (ex.: newsletter).
 */
export function displayUser(jid) {
    if (typeof jid !== 'string' || !jid) return 'desconhecido';
    const [user] = jid.split('@');
    // JIDs de device vem como "5511999999999:5" -- mostra so o numero.
    return user.split(':')[0] || 'desconhecido';
}

/**
 * Classifica o evento em uma das situacoes que o bot notifica.
 *
 * @param {object} call evento de `ev.on('call')`
 * @param {string} [botJid] JID do proprio bot, para distinguir chamada saindo
 * @returns {{kind: string, label: string, emoji: string}|null}
 */
export function classifyCallEvent(call, botJid = null) {
    if (!call || typeof call !== 'object') return null;

    const status = call.status;
    // Uma chamada feita PELO bot aparece com from = proprio bot.
    const fromBot = Boolean(botJid) && call.from === botJid;
    const quem = fromBot ? 'saindo' : 'entrando';

    // Toda notificacao comeca com o status; o rotulo diz o que aconteceu.
    switch (status) {
        case CallStatus.Offer:
            return {
                kind: 'offer',
                emoji: '📞',
                label: fromBot
                    ? 'Ligação saindo do bot'
                    : `Ligação entrando${call.isGroup ? ' (em grupo)' : ''}`
            };
        case CallStatus.Ringing:
            return { kind: 'ringing', emoji: '', label: 'Chamando' };
        case CallStatus.PreAccept:
            return { kind: 'preaccept', emoji: '', label: 'Chamada recebida pelo destino' };
        case CallStatus.Transport:
            return { kind: 'transport', emoji: '🔗', label: 'Conectando a chamada' };
        case CallStatus.RelayLatency:
            return { kind: 'relaylatency', emoji: '📶', label: 'Latência da chamada' };
        case CallStatus.Accept:
            return { kind: 'accept', emoji: '✅', label: 'Chamada atendida' };
        case CallStatus.Reject:
            return { kind: 'reject', emoji: '❌', label: fromBot ? 'Chamada recusada pelo bot' : 'Chamada recusada' };
        case CallStatus.Terminate:
            return { kind: 'terminate', emoji: '', label: 'Chamada encerrada' };
        case CallStatus.Timeout:
            // Este e o caso "tentativa de ligacao que ninguem atendeu".
            return { kind: 'timeout', emoji: '', label: 'Chamada perdida (ninguém atendeu)' };
        default:
            return { kind: 'unknown', emoji: '', label: `Evento de chamada (${status || 'sem status'})` };
    }
}

/**
 * Monta o texto da notificacao de uma chamada.
 *
 * @param {object} call       evento de `ev.on('call')`
 * @param {object} [options]
 * @param {string} [options.botJid]     JID do bot (para marcar chamada saindo)
 * @param {string} [options.callerName] nome do autor, quando conhecido
 * @param {string} [options.groupName]  nome do grupo
 * @returns {{text: string, kind: string}|null}
 */
export function buildCallNotification(call, options = {}) {
    const info = classifyCallEvent(call, options.botJid);
    if (!info) return null;

    const { callerName, groupName } = options;

    const linhas = [`${info.emoji} *${info.label}*`];
    linhas.push('');

    const autor = callerName || displayUser(call.from);
    linhas.push(`• Autor: ${autor}`);
    if (call.callerPn && call.callerPn !== call.from) {
        linhas.push(`• Número: ${displayUser(call.callerPn)}`);
    }
    if (call.isVideo !== undefined) {
        linhas.push(`• Tipo: ${call.isVideo ? 'Vídeo' : 'Voz'}`);
    }
    if (call.isGroup) {
        linhas.push(`• Chamada de grupo: Sim${call.groupJid ? ` (${call.groupJid})` : ''}`);
    }
    if (Number.isFinite(call.latencyMs)) {
        linhas.push(`• Latência: ${call.latencyMs}ms`);
    }
    if (groupName) linhas.push(`• Grupo: ${groupName}`);
    linhas.push(`• Chat: ${call.chatId || 'não fornecido'}`);
    linhas.push(`• ID da chamada: ${call.id || 'não fornecido'}`);

    return { text: linhas.join('\n'), kind: info.kind };
}

/**
 * Decide se um grupo deve ou nao notificar determinado evento.
 *
 * `groupData.testcall` e o toggle criado pelo comando `!testcall`. Grupos sem o
 * toggle ligado nao recebem nada.
 *
 * @param {object|null} groupData dados do grupo
 * @returns {boolean}
 */
export function shouldNotifyCall(groupData) {
    return Boolean(groupData && groupData.testcall);
}

export { CallStatus, isMissedCall };