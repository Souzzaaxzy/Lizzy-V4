/**
 * ═══════════════════════════════════════════════════════════════
 * X9 SYSTEM - Sistema Moderno de Solicitações de Entrada v2
 * ═══════════════════════════════════════════════════════════════
 * 
 * Sistema refatorado para usar APIs modernas do Baileys:
 * - Botões interativos
 * - Detecção de eventos nativos do WhatsApp
 * - Anti-duplicação robusto
 */

// ═══════════════════════════════════════════════════════════════
// MAPA DE PAÍSES POR DDI
// ═══════════════════════════════════════════════════════════════
const COUNTRY_CODES = {
    '244': 'Angola 🇦🇴',
    '55': 'Brasil 🇧🇷',
    '351': 'Portugal 🇵🇹',
    '34': 'Espanha 🇪🇸',
    '1': 'Estados Unidos 🇺🇸',
    '44': 'Reino Unido 🇬🇧',
    '49': 'Alemanha 🇩🇪',
    '39': 'Itália 🇮🇹',
    '33': 'França 🇫🇷',
    '54': 'Argentina 🇦🇷',
    '56': 'Chile 🇨🇱',
    '57': 'Colômbia 🇨🇴',
    '51': 'Peru 🇵🇪',
    '52': 'México 🇲🇽',
    '593': 'Equador 🇪🇨',
    '507': 'Panamá 🇵🇦',
    '505': 'Nicarágua 🇳🇮',
    '504': 'Honduras 🇭🇳',
    '502': 'Guatemala 🇬🇹',
    '503': 'El Salvador 🇸🇻',
    '225': 'Costa do Marfim 🇨🇮',
    '234': 'Nigéria 🇳🇬',
    '233': 'Gana 🇬🇭',
    '254': 'Quênia 🇰🇪',
    '27': 'África do Sul 🇿🇦',
    '20': 'Egito 🇪🇬',
    '966': 'Arábia Saudita 🇸🇦',
    '971': 'Emirados Árabes 🇦🇪',
    '62': 'Indonésia 🇮🇩',
    '60': 'Malásia 🇲🇾',
    '65': 'Singapura 🇸🇬',
    '66': 'Tailândia 🇹🇭',
    '63': 'Filipinas 🇵🇭',
    '81': 'Japão 🇯🇵',
    '82': 'Coréia do Sul 🇰🇷',
    '86': 'China 🇨🇳',
    '91': 'Índia 🇮🇳',
    '61': 'Austrália 🇦🇺',
    '64': 'Nova Zelândia 🇳🇿',
    '32': 'Bélgica 🇧🇪',
    '31': 'Holanda 🇳🇱',
    '41': 'Suíça 🇨🇭',
    '43': 'Áustria 🇦🇹',
    '47': 'Noruega 🇳🇴',
    '46': 'Suécia 🇸🇪',
    '45': 'Dinamarca 🇩🇰',
    '358': 'Finlândia 🇫🇮',
    '30': 'Grécia 🇬🇷',
    '90': 'Turquia 🇹🇷',
    '7': 'Rússia 🇷🇺',
    '380': 'Ucrânia 🇺🇦',
};

function getCountryFromNumber(number) {
    if (!number) return 'Desconhecido 🌍';
    
    const cleanNumber = number.replace(/\D/g, '');
    const ddi3 = cleanNumber.substring(0, 3);
    if (COUNTRY_CODES[ddi3]) return COUNTRY_CODES[ddi3];
    
    const ddi2 = cleanNumber.substring(0, 2);
    if (COUNTRY_CODES[ddi2]) return COUNTRY_CODES[ddi2];
    
    const ddi1 = cleanNumber.substring(0, 1);
    if (COUNTRY_CODES[ddi1]) return COUNTRY_CODES[ddi1];
    
    return 'Desconhecido 🌍';
}

// ═══════════════════════════════════════════════════════════════
// SISTEMA ANTI-DUPLICAÇÃO
// ═══════════════════════════════════════════════════════════════
class X9AntiDuplication {
    constructor() {
        this.processedRequests = new Map();
        this.processedMessages = new Map();
        this.pendingActions = new Map();
        this.lockDuration = 30000;
    }
    
    generateRequestKey(groupId, participantId) {
        return `${groupId}:${participantId}`;
    }
    
    isRequestProcessed(groupId, participantId) {
        const key = this.generateRequestKey(groupId, participantId);
        return this.processedRequests.has(key);
    }
    
    markRequestProcessed(groupId, participantId) {
        const key = this.generateRequestKey(groupId, participantId);
        this.processedRequests.set(key, Date.now());
    }
    
    markMessageProcessed(messageId) {
        this.processedMessages.set(messageId, Date.now());
    }
    
    isMessageProcessed(messageId) {
        return this.processedMessages.has(messageId);
    }
    
    tryAcquireLock(groupId, participantId) {
        const key = `${groupId}:${participantId}`;
        const now = Date.now();
        const existing = this.pendingActions.get(key);
        if (existing && now - existing < this.lockDuration) return false;
        this.pendingActions.set(key, now);
        return true;
    }
    
    releaseLock(groupId, participantId) {
        const key = `${groupId}:${participantId}`;
        this.pendingActions.delete(key);
    }
    
    destroy() {
        this.processedRequests.clear();
        this.processedMessages.clear();
        this.pendingActions.clear();
    }
}

const x9AntiDuplication = new X9AntiDuplication();

// ═══════════════════════════════════════════════════════════════
// ARMAZENAMENTO DE SOLICITAÇÕES
// ═══════════════════════════════════════════════════════════════
class X9RequestStore {
    constructor() {
        this.requests = new Map();
        this.messageMap = new Map();
    }
    
    add(groupId, participantId, requestData) {
        const key = `${groupId}:${participantId}`;
        this.requests.set(key, {
            ...requestData,
            status: 'pending',
            createdAt: Date.now()
        });
        return key;
    }
    
    get(groupId, participantId) {
        const key = `${groupId}:${participantId}`;
        return this.requests.get(key);
    }
    
    getByMessageId(messageId) {
        const key = this.messageMap.get(messageId);
        return key ? this.requests.get(key) : null;
    }
    
    updateStatus(groupId, participantId, status, adminJid = null) {
        const key = `${groupId}:${participantId}`;
        const request = this.requests.get(key);
        if (request) {
            request.status = status;
            request.updatedAt = Date.now();
            if (adminJid) request.adminJid = adminJid;
        }
        return request;
    }
    
    setMessageId(groupId, participantId, messageId) {
        const key = `${groupId}:${participantId}`;
        this.messageMap.set(messageId, key);
    }
}

const x9RequestStore = new X9RequestStore();

// ═══════════════════════════════════════════════════════════════
// FORMATADORES
// ═══════════════════════════════════════════════════════════════

function formatDate(date = new Date()) {
    return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
}

function formatTime(date = new Date()) {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function generateRequestId() {
    return `X9-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function getRequestOrigin(method) {
    switch (method) {
        case 'linked_group_join': return '🔗 Link de convite direto';
        case 'invite_link': return '🔗 Link de convite';
        case 'profile_qr_code': return '📱 QR Code do perfil';
        case 'contact_card': return '📇 Cartão de contato';
        case 'manual_add': return '👤 Adicionado manualmente';
        default: return '🌐 Via WhatsApp';
    }
}

// ═══════════════════════════════════════════════════════════════
// CONSTRUTORES DE MENSAGEM
// ═══════════════════════════════════════════════════════════════

function buildPendingRequestCard(data) {
    const { participantName, participantNumber, country, origin, time, date } = data;
    return `╭━━━〔 🔎 X9 • SOLICITAÇÃO DE ENTRADA 〕━━━⬣
┃ 👤 Nome: ${participantName || 'Não disponível'}
┃ 📞 Número: +${participantNumber}
┃ 🌍 País: ${country}
┃ 🔗 Origem: ${origin}
┃ 🕒 Horário: ${time}
┃ 📅 Data: ${date}
┃ 📌 Status: Aguardando aprovação
╰━━━━━━━━━━━━━━━━━━⬣

Deseja aprovar esta solicitação?`;
}

function buildApprovedCard(data) {
    const { participantName, participantNumber, adminNumber, time } = data;
    return `╭━━━〔 ✅ SOLICITAÇÃO APROVADA 〕━━━⬣
┃ 👤 ${participantName || participantNumber}
┃ 👮 Aprovado por: @${adminNumber}
┃ 🕒 ${time}
╰━━━━━━━━━━━━━━━━━━⬣`;
}

function buildRejectedCard(data) {
    const { participantName, participantNumber, adminNumber, time } = data;
    return `╭━━━〔 ❌ SOLICITAÇÃO NEGADA 〕━━━⬣
┃ 👤 ${participantName || participantNumber}
┃ 👮 Negado por: @${adminNumber}
┃ 🕒 ${time}
╰━━━━━━━━━━━━━━━━━━⬣`;
}

function buildWhatsAppApprovalNotification(data) {
    const { participantName, participantNumber, adminNumber, time } = data;
    return `╭━━━〔 ✅ X9 • SOLICITAÇÃO APROVADA 〕━━━⬣
┃ 👤 Solicitante: ${participantName || participantNumber}
┃ 👮 Aprovado por: @${adminNumber}
┃ 🕒 ${time}
╰━━━━━━━━━━━━━━━━━━⬣`;
}

function buildWhatsAppRejectionNotification(data) {
    const { participantName, participantNumber, adminNumber, time } = data;
    return `╭━━━〔 ❌ X9 • SOLICITAÇÃO NEGADA 〕━━━⬣
┃ 👤 Solicitante: ${participantName || participantNumber}
┃ 👮 Negado por: @${adminNumber}
┃ 🕒 ${time}
╰━━━━━━━━━━━━━━━━━━⬣`;
}

// ═══════════════════════════════════════════════════════════════
// FUNÇÕES AUXILIARES
// ═══════════════════════════════════════════════════════════════

async function getParticipantName(sock, jid) {
    if (!jid) return 'Desconhecido';
    try {
        const name = sock.getName(jid);
        if (name && name !== jid) return name;
    } catch (e) {}
    return jid.replace(/@.*$/, '');
}

async function getProfilePicture(sock, jid) {
    if (!jid) return null;
    try {
        return await sock.profilePictureUrl(jid, 'image');
    } catch (e) {
        return null;
    }
}

export async function isGroupAdmin(sock, groupId, userJid) {
    try {
        const metadata = await sock.groupMetadata(groupId);
        const participant = metadata?.participants?.find(p => p.id === userJid);
        return participant?.admin === 'admin' || participant?.admin === 'superadmin';
    } catch (e) {
        return false;
    }
}

export function isX9ButtonCallback(callbackData) {
    return callbackData?.selectedButtonId?.startsWith('x9_') || false;
}

export function cleanupX9System() {
    x9AntiDuplication.destroy();
}

// ═══════════════════════════════════════════════════════════════
// PROCESSAMENTO PRINCIPAL
// ═══════════════════════════════════════════════════════════════

/**
 * Normaliza o JID do participante de diferentes formatos
 */
function normalizeParticipantJid(participant) {
    if (!participant) return null;
    
    // Se já é string
    if (typeof participant === 'string') {
        if (participant.includes('@s.whatsapp.net') || participant.includes('@lid')) {
            return participant;
        }
        return `${participant}@s.whatsapp.net`;
    }
    
    // Se é objeto
    if (typeof participant === 'object') {
        // Tenta diferentes propriedades
        const jid = participant.pn || participant.lid || participant.id || participant;
        if (typeof jid === 'string') {
            if (jid.includes('@s.whatsapp.net') || jid.includes('@lid')) {
                return jid;
            }
            return `${jid}@s.whatsapp.net`;
        }
    }
    
    return null;
}

export async function processNewJoinRequest(sock, eventData, groupSettings) {
    const { id: groupId, participant, participantPn, method, author, authorPn } = eventData;
    
    console.log('[X9] ======================================');
    console.log('[X9] 📩 Novo evento de solicitação');
    console.log('[X9] Raw participant:', participant);
    console.log('[X9] participantPn:', participantPn);
    console.log('[X9] X9 ativo:', groupSettings?.x9);
    
    // Normaliza participant JID
    let participantJid = normalizeParticipantJid(participant);
    
    // Fallback para participantPn se participant não funcionar
    if (!participantJid && participantPn) {
        participantJid = normalizeParticipantJid(participantPn);
    }
    
    console.log('[X9] Normalized participantJid:', participantJid);
    
    // Validações básicas
    if (!groupId || !participantJid) {
        console.log('[X9] ❌ Dados insuficientes');
        return null;
    }
    
    // Verifica se X9 está ativo
    if (!groupSettings?.x9) {
        console.log('[X9] ❌ X9 desativado para este grupo');
        return null;
    }
    
    // Verifica anti-duplicação
    if (x9AntiDuplication.isRequestProcessed(groupId, participantJid)) {
        console.log('[X9] ⚠️ Já processada, ignorando');
        return null;
    }
    
    const requestId = generateRequestId();
    const now = new Date();
    
    // Coleta informações
    const participantNumber = participantJid.replace(/@.*$/, '');
    const participantName = await getParticipantName(sock, participantJid);
    const country = getCountryFromNumber(participantNumber);
    
    console.log(`[X9] 📋 Processando: ${participantName} (+${participantNumber})`);
    
    // Prepara dados da solicitação
    const requestData = {
        requestId,
        groupId,
        participantJid,
        participantNumber,
        participantName,
        country,
        origin: getRequestOrigin(method),
        time: formatTime(now),
        date: formatDate(now),
        method,
        author: author || authorPn || null,
        status: 'pending'
    };
    
    // Armazena
    x9RequestStore.add(groupId, participantJid, requestData);
    x9AntiDuplication.markRequestProcessed(groupId, participantJid);
    
    // Constrói card
    const cardText = buildPendingRequestCard(requestData);
    const mentions = [participantJid];
    if (author) mentions.push(author);
    
    console.log('[X9] 📤 Enviando card...');
    console.log('[X9] Card:', cardText);
    
    try {
        // Envia mensagem com botões
        const sentMessage = await sock.sendMessage(groupId, {
            text: cardText,
            mentions,
            footer: 'X9 System • Lizzy',
            buttons: [
                {
                    buttonId: `x9_approve_${participantNumber}`,
                    buttonText: { displayText: '🟢 Aceitar' },
                    type: 1
                },
                {
                    buttonId: `x9_reject_${participantNumber}`,
                    buttonText: { displayText: '🔴 Negar' },
                    type: 1
                }
            ],
            headerType: 1
        });
        
        console.log('[X9] ✅ Mensagem enviada:', sentMessage?.key?.id);
        
        if (sentMessage?.key?.id) {
            x9RequestStore.setMessageId(groupId, participantJid, sentMessage.key.id);
            x9AntiDuplication.markMessageProcessed(sentMessage.key.id);
            requestData.messageId = sentMessage.key.id;
            x9RequestStore.add(groupId, participantJid, requestData);
        }
        
        return sentMessage;
        
    } catch (error) {
        console.error('[X9] ❌ Erro ao enviar:', error.message);
        return null;
    }
}

export async function processX9ButtonCallback(sock, message, callbackData, senderJid, isGroupAdmin) {
    const { selectedButtonId } = callbackData;
    
    if (!selectedButtonId || !selectedButtonId.startsWith('x9_')) {
        return { handled: false };
    }
    
    if (!isGroupAdmin) {
        console.log(`[X9] Usuário ${senderJid} não é admin`);
        return { handled: true, action: 'ignored' };
    }
    
    // Parse: x9_approve_NUMBER ou x9_reject_NUMBER
    const parts = selectedButtonId.split('_');
    if (parts.length < 3) {
        console.log('[X9] Formato inválido');
        return { handled: true, action: 'invalid' };
    }
    
    const action = parts[1];
    const participantNumber = parts.slice(2).join('_');
    const participantJid = `${participantNumber}@s.whatsapp.net`;
    
    // Busca em todos os grupos conhecidos
    let foundRequest = null;
    let groupId = null;
    
    for (const [key, request] of x9RequestStore.requests) {
        if (request.participantNumber === participantNumber && request.status === 'pending') {
            foundRequest = request;
            groupId = request.groupId;
            break;
        }
    }
    
    if (!foundRequest) {
        console.log(`[X9] Solicitação não encontrada para ${participantNumber}`);
        return { handled: true, action: 'not_found' };
    }
    
    if (!x9AntiDuplication.tryAcquireLock(groupId, participantJid)) {
        console.log('[X9] Lock ativo, ignorando');
        return { handled: true, action: 'locked' };
    }
    
    try {
        if (action === 'approve') {
            return await handleApproval(sock, groupId, participantJid, foundRequest, senderJid);
        } else if (action === 'reject') {
            return await handleRejection(sock, groupId, participantJid, foundRequest, senderJid);
        }
    } finally {
        x9AntiDuplication.releaseLock(groupId, participantJid);
    }
    
    return { handled: true };
}

async function handleApproval(sock, groupId, participantJid, request, adminJid) {
    const now = new Date();
    const adminNumber = adminJid.replace(/@.*$/, '');
    
    // Aprova
    try {
        await sock.groupRequestParticipantsUpdate(groupId, [participantJid], 'approve');
    } catch (error) {
        console.error('[X9] Erro ao aprovar:', error.message);
    }
    
    x9RequestStore.updateStatus(groupId, participantJid, 'approved', adminJid);
    
    const cardData = {
        participantName: request.participantName,
        participantNumber: request.participantNumber,
        adminNumber,
        time: formatTime(now)
    };
    
    const updatedText = buildApprovedCard(cardData);
    const mentions = [adminJid, participantJid];
    
    try {
        if (request.messageId) {
            // Tenta deletar mensagem original
            try {
                await sock.sendMessage(groupId, { delete: { id: request.messageId, remoteJid: groupId, fromMe: true } });
            } catch (e) {}
        }
    } catch (e) {}
    
    // Envia nova mensagem
    await sock.sendMessage(groupId, {
        text: updatedText,
        mentions
    });
    
    console.log(`[X9] ✅ Aprovado: ${request.participantNumber}`);
    return { handled: true, action: 'approved' };
}

async function handleRejection(sock, groupId, participantJid, request, adminJid) {
    const now = new Date();
    const adminNumber = adminJid.replace(/@.*$/, '');
    
    // Rejeita
    try {
        await sock.groupRequestParticipantsUpdate(groupId, [participantJid], 'reject');
    } catch (error) {
        console.error('[X9] Erro ao rejeitar:', error.message);
    }
    
    x9RequestStore.updateStatus(groupId, participantJid, 'rejected', adminJid);
    
    const cardData = {
        participantName: request.participantName,
        participantNumber: request.participantNumber,
        adminNumber,
        time: formatTime(now)
    };
    
    const updatedText = buildRejectedCard(cardData);
    const mentions = [adminJid];
    
    try {
        if (request.messageId) {
            try {
                await sock.sendMessage(groupId, { delete: { id: request.messageId, remoteJid: groupId, fromMe: true } });
            } catch (e) {}
        }
    } catch (e) {}
    
    await sock.sendMessage(groupId, {
        text: updatedText,
        mentions
    });
    
    console.log(`[X9] ❌ Rejeitado: ${request.participantNumber}`);
    return { handled: true, action: 'rejected' };
}

export async function processWhatsAppNativeAction(sock, eventData, groupSettings) {
    const { id: groupId, action, author, authorPn, participant, participants } = eventData;
    
    if (!groupSettings?.x9) return null;
    
    const isApproval = action === 'add' || action === 'approve';
    const isRejection = action === 'remove' || action === 'reject';
    
    if (!isApproval && !isRejection) return null;
    
    const targetParticipant = participant || (participants && participants[0]);
    const adminJid = author || authorPn;
    
    if (!targetParticipant || !adminJid) return null;
    
    const targetJid = normalizeParticipantJid(targetParticipant);
    if (!targetJid) return null;
    
    const existingRequest = x9RequestStore.get(groupId, targetJid);
    if (existingRequest && existingRequest.status !== 'pending') {
        console.log('[X9] Solicitação já processada, sincronizando...');
        return null;
    }
    
    const now = new Date();
    const adminNumber = adminJid.replace(/@.*$/, '');
    const participantNumber = targetJid.replace(/@.*$/, '');
    const participantName = existingRequest?.participantName || await getParticipantName(sock, targetJid);
    
    const cardData = {
        participantName,
        participantNumber,
        adminNumber,
        time: formatTime(now)
    };
    
    const notificationText = isApproval 
        ? buildWhatsAppApprovalNotification(cardData)
        : buildWhatsAppRejectionNotification(cardData);
    
    const mentions = [adminJid, targetJid];
    
    try {
        await sock.sendMessage(groupId, {
            text: notificationText,
            mentions
        });
        
        console.log(`[X9] Notificação via WhatsApp: ${isApproval ? 'aprovado' : 'rejeitado'}`);
        
        if (existingRequest) {
            x9RequestStore.updateStatus(groupId, targetJid, isApproval ? 'approved' : 'rejected', adminJid);
        }
        
        return { action: isApproval ? 'approved' : 'rejected' };
    } catch (error) {
        console.error('[X9] Erro ao enviar notificação:', error.message);
        return null;
    }
}

// Exports
export {
    x9AntiDuplication,
    x9RequestStore,
    formatDate,
    formatTime,
    generateRequestId,
    getCountryFromNumber,
    buildPendingRequestCard,
    buildApprovedCard,
    buildRejectedCard
};
