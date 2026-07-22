/**
 * ═══════════════════════════════════════════════════════════════
 * X9 SYSTEM - Sistema Moderno de Solicitações de Entrada
 * ═══════════════════════════════════════════════════════════════
 * 
 * Sistema refatorado para usar APIs modernas do Baileys:
 * - InteractiveMessage com botões
 * - Edição de mensagens
 * - Detecção de eventos nativos do WhatsApp
 * - Anti-duplicação robusto
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
    '255': 'Tanzânia 🇹🇿',
    '256': 'Uganda 🇺🇬',
    '27': 'África do Sul 🇿🇦',
    '20': 'Egito 🇪🇬',
    '966': 'Arábia Saudita 🇸🇦',
    '971': 'Emirados Árabes 🇦🇪',
    '973': 'Bahrein 🇧🇭',
    '965': 'Kuwait 🇰🇼',
    '974': 'Catar 🇶🇦',
    '968': 'Omã 🇴🇲',
    '62': 'Indonésia 🇮🇩',
    '60': 'Malásia 🇲🇾',
    '65': 'Singapura 🇸🇬',
    '66': 'Tailândia 🇹🇭',
    '84': 'Vietnã 🇻🇳',
    '63': 'Filipinas 🇵🇭',
    '81': 'Japão 🇯🇵',
    '82': 'Coréia do Sul 🇰🇷',
    '86': 'China 🇨🇳',
    '852': 'Hong Kong 🇭🇰',
    '886': 'Taiwan 🇹🇼',
    '91': 'Índia 🇮🇳',
    '880': 'Bangladesh 🇧🇩',
    '92': 'Paquistão 🇵🇰',
    '94': 'Sri Lanka 🇱🇰',
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
    '359': 'Bulgária 🇧🇬',
    '40': 'Romênia 🇷🇴',
    '36': 'Hungria 🇭🇺',
    '420': 'República Tcheca 🇨🇿',
    '48': 'Polônia 🇵🇱',
    '370': 'Lituânia 🇱🇹',
    '371': 'Letônia 🇱🇻',
    '373': 'Moldávia 🇲🇩',
    '98': 'Irã 🇮🇷',
    '964': 'Iraque 🇮🇶',
    '961': 'Líbano 🇱🇧',
    '962': 'Jordânia 🇯🇴',
    '970': 'Palestina 🇵🇸',
    '212': 'Marrocos 🇲🇦',
    '213': 'Argélia 🇩🇿',
    '216': 'Tunísia 🇹🇳',
    '218': 'Líbia 🇱🇾',
    '249': 'Sudão 🇸🇩',
    '967': 'Iêmen 🇾🇪',
    '237': 'Camarões 🇨🇲',
    '241': 'Gabão 🇬🇦',
    '226': 'Burkina Faso 🇧🇫',
    '227': 'Níger 🇳🇪',
    '228': 'Togo 🇹🇬',
    '229': 'Benin 🇧🇯',
    '235': 'Chade 🇹🇩',
    '236': 'República Centro-Africana 🇨🇫',
    '240': 'Guiné Equatorial 🇬🇶',
    '243': 'RD Congo 🇨🇩',
    '245': 'Guiné-Bissau 🇬🇼',
    '258': 'Moçambique 🇲🇿',
    '266': 'Lesoto 🇱🇸',
    '268': 'Suazilândia 🇸🇿',
    '269': 'Comores 🇰🇲',
    '291': 'Eritreia 🇪🇷',
    '291': 'Etiópia 🇪🇹',
    '355': 'Albânia 🇦🇱',
    '389': 'Macedônia 🇲🇰',
    '381': 'Sérvia 🇷🇸',
    '385': 'Croácia 🇭🇷',
    '386': 'Eslovênia 🇸🇮',
    '421': 'Eslováquia 🇸🇰',
    '377': 'Mônaco 🇲🇨',
    '379': 'Cidade do Vaticano 🇻🇦',
    '356': 'Malta 🇲🇹',
    '357': 'Chipre 🇨🇾',
    '353': 'Irlanda 🇮🇪',
    '354': 'Islândia 🇮🇸',
    '372': 'Estônia 🇪🇪',
    '374': 'Armênia 🇦🇲',
    '375': 'Bielorrússia 🇧🇾',
    '377': 'Andorra 🇦🇩',
    '378': 'San Marino 🇸🇲',
    '376': 'Liechtenstein 🇱🇮',
    '447': 'Guernsey 🇬🇬',
    '448': 'Jersey 🇯🇪',
    '441': 'Ilha de Man 🇮🇲',
};

/**
 * Obtém o país baseado no DDI
 */
function getCountryFromNumber(number) {
    if (!number) return 'Desconhecido 🌍';
    
    const cleanNumber = number.replace(/\D/g, '');
    
    // Tentar DDI de 3 dígitos primeiro
    const ddi3 = cleanNumber.substring(0, 3);
    if (COUNTRY_CODES[ddi3]) {
        return COUNTRY_CODES[ddi3];
    }
    
    // Tentar DDI de 2 dígitos
    const ddi2 = cleanNumber.substring(0, 2);
    if (COUNTRY_CODES[ddi2]) {
        return COUNTRY_CODES[ddi2];
    }
    
    // Tentar DDI de 1 dígito
    const ddi1 = cleanNumber.substring(0, 1);
    if (COUNTRY_CODES[ddi1]) {
        return COUNTRY_CODES[ddi1];
    }
    
    return 'Desconhecido 🌍';
}

// ═══════════════════════════════════════════════════════════════
// SISTEMA ANTI-DUPLICAÇÃO
// ═══════════════════════════════════════════════════════════════
class X9AntiDuplication {
    constructor() {
        this.processedRequests = new Map(); // requestId -> timestamp
        this.processedMessages = new Map(); // messageId -> timestamp
        this.pendingActions = new Map(); // groupId:participantId -> timestamp
        this.lockDuration = 30000; // 30 segundos de lock
        this.cleanupInterval = null;
        
        this.startCleanup();
    }
    
    startCleanup() {
        // Limpa registros antigos a cada 5 minutos
        this.cleanupInterval = setInterval(() => {
            this.cleanup();
        }, 5 * 60 * 1000);
    }
    
    cleanup() {
        const now = Date.now();
        
        // Limpa solicitações processadas
        for (const [key, timestamp] of this.processedRequests) {
            if (now - timestamp > this.lockDuration * 2) {
                this.processedRequests.delete(key);
            }
        }
        
        // Limpa mensagens processadas
        for (const [key, timestamp] of this.processedMessages) {
            if (now - timestamp > this.lockDuration * 2) {
                this.processedMessages.delete(key);
            }
        }
        
        // Limpa ações pendentes
        for (const [key, timestamp] of this.pendingActions) {
            if (now - timestamp > this.lockDuration) {
                this.pendingActions.delete(key);
            }
        }
    }
    
    /**
     * Gera uma chave única para a solicitação
     */
    generateRequestKey(groupId, participantId, requestId = null) {
        return `${groupId}:${participantId}${requestId ? `:${requestId}` : ''}`;
    }
    
    /**
     * Verifica se a solicitação já foi processada
     */
    isRequestProcessed(groupId, participantId, requestId = null) {
        const key = this.generateRequestKey(groupId, participantId, requestId);
        return this.processedRequests.has(key);
    }
    
    /**
     * Marca uma solicitação como processada
     */
    markRequestProcessed(groupId, participantId, requestId = null) {
        const key = this.generateRequestKey(groupId, participantId, requestId);
        this.processedRequests.set(key, Date.now());
    }
    
    /**
     * Verifica se a mensagem já foi processada
     */
    isMessageProcessed(messageId) {
        return this.processedMessages.has(messageId);
    }
    
    /**
     * Marca uma mensagem como processada
     */
    markMessageProcessed(messageId) {
        this.processedMessages.set(messageId, Date.now());
    }
    
    /**
     * Tenta adquirir um lock para ação
     * Retorna true se conseguiu (lock disponível)
     */
    tryAcquireLock(groupId, participantId) {
        const key = `${groupId}:${participantId}`;
        const now = Date.now();
        
        const existing = this.pendingActions.get(key);
        if (existing && now - existing < this.lockDuration) {
            return false; // Já existe lock ativo
        }
        
        this.pendingActions.set(key, now);
        return true;
    }
    
    /**
     * Libera o lock após ação
     */
    releaseLock(groupId, participantId) {
        const key = `${groupId}:${participantId}`;
        this.pendingActions.delete(key);
    }
    
    /**
     * Destrói o sistema (para shutdown)
     */
    destroy() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
        this.processedRequests.clear();
        this.processedMessages.clear();
        this.pendingActions.clear();
    }
}

// Instância global do anti-duplicação
const x9AntiDuplication = new X9AntiDuplication();

// ═══════════════════════════════════════════════════════════════
// ARMAZENAMENTO DE CARDAPIO DE SOLICITAÇÕES
// ═══════════════════════════════════════════════════════════════
class X9RequestStore {
    constructor() {
        this.requests = new Map(); // groupId:participantId -> request data
        this.messageMap = new Map(); // messageId -> request key
    }
    
    /**
     * Adiciona uma nova solicitação
     */
    add(groupId, participantId, requestData) {
        const key = `${groupId}:${participantId}`;
        this.requests.set(key, {
            ...requestData,
            status: 'pending',
            createdAt: Date.now()
        });
        return key;
    }
    
    /**
     * Obtém uma solicitação
     */
    get(groupId, participantId) {
        const key = `${groupId}:${participantId}`;
        return this.requests.get(key);
    }
    
    /**
     * Obtém uma solicitação pela chave
     */
    getByKey(key) {
        return this.requests.get(key);
    }
    
    /**
     * Obtém uma solicitação pela mensagem ID
     */
    getByMessageId(messageId) {
        const key = this.messageMap.get(messageId);
        return key ? this.requests.get(key) : null;
    }
    
    /**
     * Atualiza o status da solicitação
     */
    updateStatus(groupId, participantId, status, adminJid = null) {
        const key = `${groupId}:${participantId}`;
        const request = this.requests.get(key);
        if (request) {
            request.status = status;
            request.updatedAt = Date.now();
            if (adminJid) {
                request.adminJid = adminJid;
            }
        }
        return request;
    }
    
    /**
     * Associa uma mensagem ID à solicitação
     */
    setMessageId(groupId, participantId, messageId) {
        const key = `${groupId}:${participantId}`;
        this.messageMap.set(messageId, key);
    }
    
    /**
     * Remove uma solicitação
     */
    remove(groupId, participantId) {
        const key = `${groupId}:${participantId}`;
        const request = this.requests.get(key);
        if (request && request.messageId) {
            this.messageMap.delete(request.messageId);
        }
        this.requests.delete(key);
    }
    
    /**
     * Limpa todas as solicitações de um grupo
     */
    clearGroup(groupId) {
        for (const [key, request] of this.requests) {
            if (key.startsWith(`${groupId}:`)) {
                if (request.messageId) {
                    this.messageMap.delete(request.messageId);
                }
                this.requests.delete(key);
            }
        }
    }
}

// Instância global do armazenamento
const x9RequestStore = new X9RequestStore();

// ═══════════════════════════════════════════════════════════════
// FORMATADORES
// ═══════════════════════════════════════════════════════════════

/**
 * Formata data para o padrão brasileiro
 */
function formatDate(date = new Date()) {
    const dia = String(date.getDate()).padStart(2, '0');
    const mes = String(date.getMonth() + 1).padStart(2, '0');
    const ano = date.getFullYear();
    return `${dia}/${mes}/${ano}`;
}

/**
 * Formata hora para o padrão brasileiro
 */
function formatTime(date = new Date()) {
    const hora = String(date.getHours()).padStart(2, '0');
    const minuto = String(date.getMinutes()).padStart(2, '0');
    return `${hora}:${minuto}`;
}

/**
 * Gera ID único para a solicitação
 */
function generateRequestId() {
    return `X9-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Determina a origem da solicitação
 */
function getRequestOrigin(method) {
    switch (method) {
        case 'linked_group_join':
            return '🔗 Link de convite direto';
        case 'invite_link':
            return '🔗 Link de convite';
        case 'profile_qr_code':
            return '📱 QR Code do perfil';
        case 'contact_card':
            return '📇 Cartão de contato';
        case 'manual_add':
            return '👤 Adicionado manualmente';
        default:
            return '🌐 Via WhatsApp';
    }
}

// ═══════════════════════════════════════════════════════════════
// CONSTRUTORES DE MENSAGEM
// ═══════════════════════════════════════════════════════════════

/**
 * Constrói o card de solicitação pendente
 */
function buildPendingRequestCard(data) {
    const {
        participantName,
        participantNumber,
        participantJid,
        country,
        origin,
        time,
        date,
        requestId
    } = data;
    
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

/**
 * Constrói o card de solicitação aprovada
 */
function buildApprovedCard(data) {
    const {
        participantName,
        participantNumber,
        adminName,
        adminNumber,
        time
    } = data;
    
    return `╭━━━〔 ✅ SOLICITAÇÃO APROVADA 〕━━━⬣
┃ 👤 ${participantName || participantNumber}
┃ 👮 Aprovado por: @${adminNumber}
┃ 🕒 ${time}
╰━━━━━━━━━━━━━━━━━━⬣`;
}

/**
 * Constrói o card de solicitação negada
 */
function buildRejectedCard(data) {
    const {
        participantName,
        participantNumber,
        adminName,
        adminNumber,
        time
    } = data;
    
    return `╭━━━〔 ❌ SOLICITAÇÃO NEGADA 〕━━━⬣
┃ 👤 ${participantName || participantNumber}
┃ 👮 Negado por: @${adminNumber}
┃ 🕒 ${time}
╰━━━━━━━━━━━━━━━━━━⬣`;
}

/**
 * Constrói notificação de aprovação via WhatsApp
 */
function buildWhatsAppApprovalNotification(data) {
    const {
        participantName,
        participantNumber,
        adminName,
        adminNumber,
        time
    } = data;
    
    return `╭━━━〔 ✅ X9 • SOLICITAÇÃO APROVADA 〕━━━⬣
┃ 👤 Solicitante: ${participantName || participantNumber}
┃ 👮 Aprovado por: @${adminNumber}
┃ 🕒 ${time}
╰━━━━━━━━━━━━━━━━━━⬣`;
}

/**
 * Constrói notificação de rejeição via WhatsApp
 */
function buildWhatsAppRejectionNotification(data) {
    const {
        participantName,
        participantNumber,
        adminName,
        adminNumber,
        time
    } = data;
    
    return `╭━━━〔 ❌ X9 • SOLICITAÇÃO NEGADA 〕━━━⬣
┃ 👤 Solicitante: ${participantName || participantNumber}
┃ 👮 Negado por: @${adminNumber}
┃ 🕒 ${time}
╰━━━━━━━━━━━━━━━━━━⬣`;
}

// ═══════════════════════════════════════════════════════════════
// SISTEMA PRINCIPAL DE X9
// ═══════════════════════════════════════════════════════════════

/**
 * Processa uma nova solicitação de entrada
 */
export async function processNewJoinRequest(sock, eventData, groupSettings) {
    const { id: groupId, participant, participantPn, method, author, authorPn } = eventData;
    
    // Validações básicas
    if (!groupId || !participant) {
        console.log('[X9] Dados insuficientes para processar solicitação');
        return null;
    }
    
    // Verifica se X9 está ativo para este grupo
    if (!groupSettings?.x9) {
        console.log('[X9] X9 desativado para este grupo');
        return null;
    }
    
    // Verifica anti-duplicação
    if (x9AntiDuplication.isRequestProcessed(groupId, participant)) {
        console.log('[X9] Solicitação já processada, ignorando');
        return null;
    }
    
    const requestId = generateRequestId();
    const now = new Date();
    
    // Coleta informações do participante
    const participantNumber = participant.replace(/@.*$/, '');
    const participantName = await getParticipantName(sock, participant);
    const profilePic = await getProfilePicture(sock, participant);
    const country = getCountryFromNumber(participantNumber);
    
    // Prepara dados da solicitação
    const requestData = {
        requestId,
        groupId,
        participantJid: participant,
        participantNumber,
        participantName,
        profilePic,
        country,
        origin: getRequestOrigin(method),
        time: formatTime(now),
        date: formatDate(now),
        method,
        author: author || authorPn || null,
        authorName: author ? await getParticipantName(sock, author) : null,
        status: 'pending'
    };
    
    // Armazena a solicitação
    const storeKey = x9RequestStore.add(groupId, participant, requestData);
    
    // Marca como processada
    x9AntiDuplication.markRequestProcessed(groupId, participant);
    
    // Constrói a mensagem do card
    const cardText = buildPendingRequestCard(requestData);
    
    // Constrói mentions
    const mentions = [participant];
    if (author) mentions.push(author);
    
    // Contexto de newsletter (mantém o formato do bot)
    const newsletterCtx = {
        forwardingScore: 999,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
            newsletterJid: "120363410980452460@newsletter",
            newsletterName: "Lizzy"
        }
    };
    
    try {
        // Envia mensagem com botões
        const sentMessage = await sock.sendMessage(groupId, {
            text: cardText,
            mentions,
            contextInfo: newsletterCtx,
            footer: 'X9 System • Lizzy',
            buttons: [
                {
                    buttonId: `x9_approve_${groupId}_${participantNumber}`,
                    buttonText: { displayText: '🟢 Aceitar' },
                    type: 1
                },
                {
                    buttonId: `x9_reject_${groupId}_${participantNumber}`,
                    buttonText: { displayText: '🔴 Negar' },
                    type: 1
                }
            ],
            headerType: 1
        });
        
        // Armazena ID da mensagem
        if (sentMessage?.key?.id) {
            x9RequestStore.setMessageId(groupId, participant, sentMessage.key.id);
            x9AntiDuplication.markMessageProcessed(sentMessage.key.id);
            requestData.messageId = sentMessage.key.id;
            x9RequestStore.add(groupId, participant, requestData);
        }
        
        console.log(`[X9] Card de solicitação enviado para ${participantNumber} no grupo ${groupId}`);
        return sentMessage;
        
    } catch (error) {
        console.error(`[X9] Erro ao enviar card de solicitação:`, error);
        return null;
    }
}

/**
 * Processa callback de botão do X9
 */
export async function processX9ButtonCallback(sock, message, callbackData, senderJid, isGroupAdmin) {
    const { selectedButtonId } = callbackData;
    
    // Verifica se é um callback do X9
    if (!selectedButtonId || !selectedButtonId.startsWith('x9_')) {
        return { handled: false };
    }
    
    // Verifica se é admin
    if (!isGroupAdmin) {
        console.log(`[X9] Usuário ${senderJid} não é admin, ignorando callback`);
        return { handled: true, action: 'ignored' };
    }
    
    // Parse dos dados do botão
    // Formato: x9_approve_groupId_participantNumber ou x9_reject_groupId_participantNumber
    const parts = selectedButtonId.split('_');
    if (parts.length < 4) {
        console.log('[X9] Formato de botão inválido');
        return { handled: true, action: 'invalid' };
    }
    
    const action = parts[1]; // approve ou reject
    const groupId = parts.slice(2, -1).join('_'); // Everything except last (number) and first 2 (x9_action)
    const participantNumber = parts[parts.length - 1];
    const participantJid = `${participantNumber}@s.whatsapp.net`;
    
    console.log(`[X9] Callback recebido: ${action} para ${participantNumber} no grupo ${groupId}`);
    
    // Verifica se a solicitação existe
    const request = x9RequestStore.get(groupId, participantJid);
    if (!request) {
        console.log(`[X9] Solicitação não encontrada para ${participantNumber}`);
        return { handled: true, action: 'not_found' };
    }
    
    // Verifica se já foi processada
    if (request.status !== 'pending') {
        console.log(`[X9] Solicitação já foi ${request.status}`);
        return { handled: true, action: 'already_processed' };
    }
    
    // Adquire lock
    if (!x9AntiDuplication.tryAcquireLock(groupId, participantJid)) {
        console.log('[X9] Lock não adquirido, ação em progresso');
        return { handled: true, action: 'locked' };
    }
    
    try {
        if (action === 'approve') {
            return await handleX9Approval(sock, groupId, participantJid, request, senderJid);
        } else if (action === 'reject') {
            return await handleX9Rejection(sock, groupId, participantJid, request, senderJid);
        }
    } finally {
        x9AntiDuplication.releaseLock(groupId, participantJid);
    }
    
    return { handled: true };
}

/**
 * Processa aprovação via botão
 */
async function handleX9Approval(sock, groupId, participantJid, request, adminJid) {
    const now = new Date();
    const adminNumber = adminJid.replace(/@.*$/, '');
    const adminName = await getParticipantName(sock, adminJid);
    
    // Aprova o usuário no grupo
    try {
        await sock.groupRequestParticipantsUpdate(groupId, [participantJid], 'approve');
        console.log(`[X9] Usuário ${participantJid} aprovado no grupo ${groupId}`);
    } catch (error) {
        console.error(`[X9] Erro ao aprovar usuário:`, error);
        // Continua mesmo se falhar (pode já ter sido aprovado)
    }
    
    // Atualiza status
    x9RequestStore.updateStatus(groupId, participantJid, 'approved', adminJid);
    
    // Prepara dados para card
    const cardData = {
        participantName: request.participantName,
        participantNumber: request.participantNumber,
        adminName,
        adminNumber,
        time: formatTime(now)
    };
    
    // Constrói card atualizado
    const updatedText = buildApprovedCard(cardData);
    
    // Contexto de newsletter
    const newsletterCtx = {
        forwardingScore: 999,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
            newsletterJid: "120363410980452460@newsletter",
            newsletterName: "Lizzy"
        }
    };
    
    // Mention do admin
    const mentions = [adminJid, participantJid];
    
    // Se existir mensagem original, tenta editar ou deletar e enviar nova
    if (request.messageId) {
        try {
            // Tenta editar a mensagem original usando chatModify
            if (sock.chatModify && typeof sock.chatModify === 'function') {
                // Usando chatModify para editar a mensagem
                const editedMsg = await sock.chatModify({
                    update: {
                        message: updatedText,
                        key: {
                            remoteJid: groupId,
                            id: request.messageId,
                            fromMe: true
                        }
                    }
                }, groupId).catch(() => null);
                
                if (editedMsg) {
                    console.log(`[X9] Card editado com chatModify`);
                    return { handled: true, action: 'approved', data: cardData };
                }
            }
            
            // Fallback: tenta deletar a mensagem original e enviar nova
            try {
                if (sock.ev) {
                    // Emite um evento de exclusão para a mensagem original
                    sock.ev.emit('messages.delete', {
                        keys: [{
                            remoteJid: groupId,
                            id: request.messageId,
                            fromMe: true
                        }]
                    });
                }
            } catch (deleteError) {
                console.log(`[X9] Não foi possível deletar mensagem original`);
            }
        } catch (editError) {
            console.log(`[X9] Erro ao editar/deletar, enviando nova mensagem`);
        }
    }
    
    // Envia nova mensagem com status atualizado
    await sock.sendMessage(groupId, {
        text: updatedText,
        mentions,
        contextInfo: newsletterCtx
    });
    console.log(`[X9] Nova mensagem de aprovação enviada`);
    
    return { handled: true, action: 'approved', data: cardData };
}

/**
 * Processa rejeição via botão
 */
async function handleX9Rejection(sock, groupId, participantJid, request, adminJid) {
    const now = new Date();
    const adminNumber = adminJid.replace(/@.*$/, '');
    const adminName = await getParticipantName(sock, adminJid);
    
    // Rejeita o usuário no grupo
    try {
        await sock.groupRequestParticipantsUpdate(groupId, [participantJid], 'reject');
        console.log(`[X9] Usuário ${participantJid} rejeitado no grupo ${groupId}`);
    } catch (error) {
        console.error(`[X9] Erro ao rejeitar usuário:`, error);
        // Continua mesmo se falhar (pode já ter sido rejeitado)
    }
    
    // Atualiza status
    x9RequestStore.updateStatus(groupId, participantJid, 'rejected', adminJid);
    
    // Prepara dados para card
    const cardData = {
        participantName: request.participantName,
        participantNumber: request.participantNumber,
        adminName,
        adminNumber,
        time: formatTime(now)
    };
    
    // Constrói card atualizado
    const updatedText = buildRejectedCard(cardData);
    
    // Contexto de newsletter
    const newsletterCtx = {
        forwardingScore: 999,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
            newsletterJid: "120363410980452460@newsletter",
            newsletterName: "Lizzy"
        }
    };
    
    // Mention do admin
    const mentions = [adminJid];
    
    // Se existir mensagem original, tenta editar ou deletar e enviar nova
    if (request.messageId) {
        try {
            // Tenta editar a mensagem original usando chatModify
            if (sock.chatModify && typeof sock.chatModify === 'function') {
                // Usando chatModify para editar a mensagem
                const editedMsg = await sock.chatModify({
                    update: {
                        message: updatedText,
                        key: {
                            remoteJid: groupId,
                            id: request.messageId,
                            fromMe: true
                        }
                    }
                }, groupId).catch(() => null);
                
                if (editedMsg) {
                    console.log(`[X9] Card editado com chatModify`);
                    return { handled: true, action: 'rejected', data: cardData };
                }
            }
            
            // Fallback: tenta deletar a mensagem original e enviar nova
            try {
                if (sock.ev) {
                    // Emite um evento de exclusão para a mensagem original
                    sock.ev.emit('messages.delete', {
                        keys: [{
                            remoteJid: groupId,
                            id: request.messageId,
                            fromMe: true
                        }]
                    });
                }
            } catch (deleteError) {
                console.log(`[X9] Não foi possível deletar mensagem original`);
            }
        } catch (editError) {
            console.log(`[X9] Erro ao editar/deletar, enviando nova mensagem`);
        }
    }
    
    // Envia nova mensagem com status atualizado
    await sock.sendMessage(groupId, {
        text: updatedText,
        mentions,
        contextInfo: newsletterCtx
    });
    console.log(`[X9] Nova mensagem de rejeição enviada`);
    
    return { handled: true, action: 'rejected', data: cardData };
}

/**
 * Detecta e processa aprovações/rejeições feitas via WhatsApp
 * (sem usar os botões do bot)
 */
export async function processWhatsAppNativeAction(sock, eventData, groupSettings) {
    const { id: groupId, action, author, authorPn, participant, participants } = eventData;
    
    if (!groupSettings?.x9) {
        return null;
    }
    
    // Verifica se é uma ação de aprovação ou rejeição
    const isApproval = action === 'add' || action === 'approve';
    const isRejection = action === 'remove' || action === 'reject';
    
    if (!isApproval && !isRejection) {
        return null;
    }
    
    // Determina o participante e admin
    const targetParticipant = participant || (participants && participants[0]);
    const adminJid = author || authorPn;
    
    if (!targetParticipant || !adminJid) {
        return null;
    }
    
    // Verifica se não é ação do próprio bot
    if (targetParticipant === sock.user?.id) {
        return null;
    }
    
    // Verifica se a solicitação existe no store
    const existingRequest = x9RequestStore.get(groupId, targetParticipant);
    
    // Se já foi processada pelo bot, sincroniza
    if (existingRequest && existingRequest.status !== 'pending') {
        console.log(`[X9] Solicitação já processada pelo bot, sincronizando...`);
        // Não faz nada se já foi sincronizada
        return null;
    }
    
    const now = new Date();
    const adminNumber = adminJid.replace(/@.*$/, '');
    const adminName = await getParticipantName(sock, adminJid);
    const participantNumber = targetParticipant.replace(/@.*$/, '');
    const participantName = existingRequest?.participantName || await getParticipantName(sock, targetParticipant);
    
    const cardData = {
        participantName,
        participantNumber,
        adminName,
        adminNumber,
        time: formatTime(now)
    };
    
    const notificationText = isApproval 
        ? buildWhatsAppApprovalNotification(cardData)
        : buildWhatsAppRejectionNotification(cardData);
    
    // Contexto de newsletter
    const newsletterCtx = {
        forwardingScore: 999,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
            newsletterJid: "120363410980452460@newsletter",
            newsletterName: "Lizzy"
        }
    };
    
    const mentions = [adminJid, targetParticipant];
    
    // Envia notificação
    try {
        await sock.sendMessage(groupId, {
            text: notificationText,
            mentions,
            contextInfo: newsletterCtx
        });
        
        console.log(`[X9] Notificação de ${isApproval ? 'aprovação' : 'rejeição'} via WhatsApp enviada`);
        
        // Atualiza store se existir
        if (existingRequest) {
            x9RequestStore.updateStatus(groupId, targetParticipant, isApproval ? 'approved' : 'rejected', adminJid);
        }
        
        return { action: isApproval ? 'approved' : 'rejected', data: cardData };
    } catch (error) {
        console.error(`[X9] Erro ao enviar notificação:`, error);
        return null;
    }
}

/**
 * Obtém nome do participante
 */
async function getParticipantName(sock, jid) {
    if (!jid) return 'Desconhecido';
    
    try {
        // Tenta obter do cache/contatos
        const name = sock.getName(jid);
        if (name && name !== jid) {
            return name;
        }
    } catch (e) {
        // Ignora erros
    }
    
    // Tenta obter do WhatsApp
    try {
        const onWhatsApp = await sock.onWhatsApp(jid);
        if (onWhatsApp && onWhatsApp.length > 0) {
            const contact = onWhatsApp[0];
            if (contact.notifyName) {
                return contact.notifyName;
            }
        }
    } catch (e) {
        // Ignora erros
    }
    
    // Retorna o número como fallback
    return jid.replace(/@.*$/, '');
}

/**
 * Obtém foto de perfil do participante
 */
async function getProfilePicture(sock, jid) {
    if (!jid) return null;
    
    try {
        const url = await sock.profilePictureUrl(jid, 'image');
        return url;
    } catch (e) {
        return null;
    }
}

/**
 * Verifica se um usuário é admin do grupo
 */
export async function isGroupAdmin(sock, groupId, userJid) {
    try {
        const metadata = await sock.groupMetadata(groupId);
        const participant = metadata?.participants?.find(p => p.id === userJid);
        return participant?.admin === 'admin' || participant?.admin === 'superadmin';
    } catch (e) {
        console.error(`[X9] Erro ao verificar admin:`, e);
        return false;
    }
}

/**
 * Verifica se a mensagem é um callback de botão do X9
 */
export function isX9ButtonCallback(callbackData) {
    return callbackData?.selectedButtonId?.startsWith('x9_') || false;
}

/**
 * Limpa os dados do X9 System (para shutdown)
 */
export function cleanupX9System() {
    x9AntiDuplication.destroy();
    console.log('[X9] Sistema limpo e finalizado');
}

// Exporta classes e funções para uso externo
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
