/**
 * Notificacoes de chamada (call) para grupos com o toggle `!testcall` ligado.
 *
 * O Baileys entrega eventos de chamada por `ev.on('call', ([call]) => ...)`, onde
 * `call` tem `chatId`, `from`, `id`, `status`, `isVideo`, `isGroup` e, em alguns
 * casos, `callerPn`. Isso e SINALIZACAO apenas: a lib nao carrega audio/video,
 * entao nao existe "entrar na chamada" -- so da para observar e recusar.
 *
 * Este modulo e puro (nao abre socket, nao toca disco): quem fornece socket,
 * `groupData`, resolucao de nomes e envio e o connect.js, via
 * `attachCallNotifier()`. Assim da para exercitar o fluxo real sem WhatsApp.
 */

import * as Baileys from '@itsliaaa/baileys';

/**
 * Constantes de status com fallback local.
 *
 * `CallStatus` vem do pacote (adicionado no fork). Importar com nome direto
 * (`import { CallStatus }`) derrubava o bot INTEIRO no boot caso o pacote
 * instalado fosse anterior ao fork -- um `import` nomeado inexistente e erro
 * fatal de resolucao ESM, nao algo que da para capturar com try/catch.
 *
 * Com o namespace + fallback, o modulo funciona com as duas versoes: se o
 * pacote tiver as constantes, usa as dele; se nao, usa estas, que sao
 * exatamente as mesmas strings que `getCallStatusFromNode` emite.
 */
const CallStatus = Baileys.CallStatus || Object.freeze({
    Offer: 'offer',
    Ringing: 'ringing',
    PreAccept: 'preaccept',
    Transport: 'transport',
    RelayLatency: 'relaylatency',
    Accept: 'accept',
    Reject: 'reject',
    Terminate: 'terminate',
    Timeout: 'timeout'
});

const isMissedCall = Baileys.isMissedCall || ((status) => status === CallStatus.Timeout);

/** Sufixo de JID de grupo. Toda notificacao do !testcall e por grupo. */
const GROUP_CHAT_SUFFIX = '@g.us';

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
 * Nao ha distincao de autor: qualquer chamada no grupo e tratada igual, seja de
 * quem for. O bot apenas observa e reporta.
 *
 * @param {object} call evento de `ev.on('call')`
 * @returns {{kind: string, label: string, emoji: string}|null}
 */
export function classifyCallEvent(call) {
    if (!call || typeof call !== 'object') return null;

    // "Chamada perdida" e um conceito proprio da lib (ninguem atendeu) e tem
    // rotulo especifico -- por isso sai antes do switch, que fica 1:1 com o
    // restante do ciclo de vida.
    if (isMissedCall(call.status)) {
        return { kind: 'timeout', emoji: '📵', label: 'Chamada perdida (ninguém atendeu)' };
    }

    switch (call.status) {
        case CallStatus.Offer:
            return { kind: 'offer', emoji: '📞', label: 'Ligação entrando' };
        case CallStatus.Ringing:
            return { kind: 'ringing', emoji: '🔔', label: 'Chamando' };
        case CallStatus.PreAccept:
            return { kind: 'preaccept', emoji: '📲', label: 'Chamada recebida pelo destino' };
        case CallStatus.Transport:
            return { kind: 'transport', emoji: '🔗', label: 'Conectando a chamada' };
        case CallStatus.RelayLatency:
            return { kind: 'relaylatency', emoji: '📶', label: 'Latência da chamada' };
        case CallStatus.Accept:
            return { kind: 'accept', emoji: '✅', label: 'Chamada atendida' };
        case CallStatus.Reject:
            return { kind: 'reject', emoji: '❌', label: 'Chamada recusada' };
        case CallStatus.Terminate:
            return { kind: 'terminate', emoji: '📴', label: 'Chamada encerrada' };
        default:
            return { kind: 'unknown', emoji: '📞', label: `Evento de chamada (${call.status || 'sem status'})` };
    }
}

/**
 * Monta o texto da notificacao de uma chamada.
 *
 * @param {object} call       evento de `ev.on('call')`
 * @param {object} [options]
 * @param {string} [options.callerName] nome do autor, quando conhecido
 * @param {string} [options.groupName]  nome do grupo
 * @returns {{text: string, kind: string}|null}
 */
export function buildCallNotification(call, options = {}) {
    const info = classifyCallEvent(call);
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

/**
 * Decide o destino de um evento de call, com os dados ja resolvidos.
 *
 * Concentra as duas condicoes que fazem uma notificacao existir -- ser grupo e
 * ter o toggle ligado -- para que a regra seja testavel sem socket e o listener
 * nunca precise reimplementa-la.
 *
 * @param {object} call evento de `ev.on('call')`
 * @param {object} [context]
 * @param {object|null} [context.groupData] dados do grupo (toggle)
 * @param {string|null} [context.callerName] nome do autor, quando conhecido
 * @param {string|null} [context.groupName] nome do grupo, quando conhecido
 * @returns {{chatId: string, text: string, kind: string}|null}
 */
export function buildCallDelivery(call, context = {}) {
    if (!call || typeof call !== 'object') return null;

    const chatId = call.chatId;
    if (typeof chatId !== 'string' || !chatId.endsWith(GROUP_CHAT_SUFFIX)) return null;
    if (!shouldNotifyCall(context.groupData)) return null;

    const notif = buildCallNotification(call, {
        callerName: context.callerName,
        groupName: context.groupName
    });
    if (!notif) return null;

    return { chatId, text: notif.text, kind: notif.kind };
}

/**
 * Resolve o nome do grupo para a notificacao.
 *
 * Ordem: o `groupName` que o index.js persiste no groupData -> cache -> metadata
 * do Baileys. Os `groupData` de grupo guardam state de features e NAO tinham
 * `subject`/`name`, entao a linha "• Grupo:" nunca aparecia: sem este fallback o
 * unico caminho que funcionava era o groupName persistido.
 *
 * As tres operacoes entram injetadas porque a leitura de metadata e I/O; sem
 * isso a ordem nao seria testavel.
 *
 * @param {object|null} groupData dados do grupo
 * @param {object} deps
 * @param {(key: string) => string|null|undefined} deps.getCached
 * @param {(name: string) => void} deps.setCached
 * @param {() => Promise<string|null>} deps.fetchMetadata
 * @returns {Promise<string|null>} nome utilizavel, ou null
 */
export async function resolveCallGroupName(groupData, deps) {
    const persisted = groupData && groupData.groupName;
    if (typeof persisted === 'string' && persisted.trim()) return persisted.trim();

    const cached = deps.getCached();
    if (typeof cached === 'string' && cached) return cached;

    let subject = null;
    try {
        subject = await deps.fetchMetadata();
    } catch (e) {
        return null;
    }
    if (typeof subject !== 'string') return null;

    const name = subject.trim();
    if (!name) return null;
    deps.setCached(name);
    return name;
}

/**
 * Registra o listener de `call` no socket.
 *
 * O modulo continua puro: socket, leitura do groupData, resolucao de nomes e
 * envio entram como dependencias injetadas. E o que permite exercitar o fluxo
 * real (filtro de grupo, toggle, texto, envio) sem abrir conexao.
 *
 * @param {object} deps
 * @param {object} deps.ev event emitter do Baileys (`sock.ev`)
 * @param {(chatId: string) => Promise<object|null>} deps.getGroupData
 * @param {(jid: string) => Promise<string|null>} deps.getCallerName
 * @param {(chatId: string, groupData: object|null) => Promise<string|null>} deps.getGroupName
 * @param {(chatId: string, text: string) => Promise<any>} deps.send
 * @param {(delivery: object, call: object) => void} [deps.log]
 * @returns {(args: [object]) => Promise<void>} handler registrado
 */
export function attachCallNotifier(deps) {
    const { ev, getGroupData, getCallerName, getGroupName, send, log } = deps;

    const handler = async ([call]) => {
        try {
            if (!call || typeof call !== 'object') return;

            const chatId = call.chatId;
            // Só grupos: o toggle vive no groupData daquele grupo. Checa antes
            // de qualquer I/O para não ler disco/network a toa.
            if (typeof chatId !== 'string' || !chatId.endsWith(GROUP_CHAT_SUFFIX)) return;

            let groupData = null;
            try { groupData = await getGroupData(chatId); } catch (e) { groupData = null; }
            if (!shouldNotifyCall(groupData)) return;

            // Nome do autor e do grupo são best-effort: se falharem, a
            // notificação sai com o número (e sem a linha do grupo) em vez de
            // não sair. Não há distinção de quem ligou: qualquer usuário do
            // grupo é notificado igual, inclusive o próprio bot.
            let callerName = null;
            try { callerName = await getCallerName(call.from); } catch (e) { /* segue com o número */ }

            let groupName = null;
            try { groupName = await getGroupName(chatId, groupData); } catch (e) { /* segue sem a linha */ }

            const delivery = buildCallDelivery(call, { groupData, callerName, groupName });
            if (!delivery) return;

            await send(delivery.chatId, delivery.text);
            if (typeof log === 'function') log(delivery, call);
        } catch (e) {
            // Uma falha aqui não pode derrubar o listener.
            console.error('[TESTCALL] Erro ao notificar chamada:', e?.message || e);
        }
    };

    ev.on('call', handler);
    return handler;
}

export { CallStatus, isMissedCall };