/**
 * Group Status — recepção das respostas.
 *
 * O corpo do listener vive AQUI, não no `connect.js`: importar o `connect.js`
 * num teste abre conexão de verdade (gera QR e conecta), então testar por lá é
 * inviável. O `connect.js` só faz a fiação — passa `ev`, o socket e as funções
 * de que este módulo precisa.
 *
 * ## Por que escutar `group-status.answer` e não varrer `messages.upsert`
 *
 * A fork emite `group-status.answer` dentro do `upsertMessage`, que é o ponto
 * por onde TODA mensagem passa — inclusive as offline. Escutar o evento
 * dedicado é mais barato (a mensagem comum nem chega aqui) e mais difícil de
 * quebrar do que procurar o tipo dentro do `upsert`.
 *
 * O módulo também trata o caminho de reserva: se a fork instalada for anterior
 * e não emitir o evento, o handler de mensagens pode chamar `processarResposta`
 * diretamente com a mensagem crua.
 */

import { registrarResposta, registrarPergunta } from './groupStatusQA.js';

/** Evita registrar o listener duas vezes na mesma conexão. */
let listenerAttached = false;

/**
 * Processa UMA resposta de Group Status.
 *
 * Valida o que pode ser validado antes de gravar: precisa de grupo, precisa do
 * id do status (é o que liga a resposta à pergunta) e precisa que a pergunta
 * seja CONHECIDA — responder a um status que o bot não publicou é ignorado, não
 * inventado.
 *
 * @param {object} dados
 * @param {string} dados.grupoJid
 * @param {string} dados.statusId
 * @param {string} [dados.responseId]
 * @param {string} [dados.participante] JID/LID de quem respondeu
 * @param {string} [dados.texto]
 * @param {number} [dados.recebidoEm]
 * @param {string} [dados.pushName]
 * @returns {{ok: boolean, motivo?: string, duplicada?: boolean}}
 */
export function processarResposta(dados = {}) {
    const { grupoJid, statusId } = dados;
    if (!grupoJid || !statusId) return { ok: false, motivo: 'sem_status' };
    const r = registrarResposta(grupoJid, {
        statusId,
        id: dados.responseId,
        participante: dados.participante,
        pushName: dados.pushName,
        texto: dados.texto,
        recebidoEm: dados.recebidoEm
    });
    return r;
}

/**
 * Liga o listener de respostas ao socket.
 *
 * Idempotente: uma reconexão não duplica o listener (o que faria a mesma
 * resposta ser processada duas vezes — a dedup do storage pegaria, mas gastaria
 * trabalho à toa).
 *
 * @param {object} deps
 * @param {object} deps.ev        o `sock.ev` (EventEmitter)
 * @param {Function} [deps.log]   logger opcional
 * @returns {boolean} se anexou agora
 */
export function attachGroupStatusListener({ ev, log = () => {} } = {}) {
    if (!ev || typeof ev.on !== 'function') {
        log('[STATUSQA] socket sem emitter — listener não anexado');
        return false;
    }
    if (listenerAttached) return false;
    listenerAttached = true;

    ev.on('group-status.answer', (dados) => {
        try {
            // O grupo é o `remoteJid` da resposta. Sem ele não há como isolar —
            // e isolar por grupo é requisito de segurança.
            const grupoJid = dados?.statusRemoteJid || dados?.key?.remoteJid || null;
            const statusId = dados?.statusId || null;
            if (!grupoJid || !statusId) return;

            const r = processarResposta({
                grupoJid,
                statusId,
                responseId: dados.responseId || dados?.key?.id,
                participante: dados.participant,
                pushName: dados.pushName,
                texto: dados.texto,
                recebidoEm: Number(dados.messageTimestamp || 0) * 1000 || Date.now()
            });

            if (r.ok && !r.duplicada) {
                log(`[STATUSQA] resposta registrada | grupo=${grupoJid} status=${statusId}`);
            } else if (r.ok && r.duplicada) {
                log(`[STATUSQA] resposta DUPLICADA ignorada | status=${statusId}`);
            } else {
                log(`[STATUSQA] resposta ignorada | motivo=${r.motivo} status=${statusId}`);
            }
        } catch (err) {
            // Um erro aqui não pode derrubar o processamento de mensagens.
            log(`[STATUSQA] erro ao processar resposta: ${err?.message || err}`);
        }
    });

    return true;
}

/**
 * Reinicia o estado do módulo (usado em teste).
 */
export function _resetListener() {
    listenerAttached = false;
}

export { registrarPergunta };
