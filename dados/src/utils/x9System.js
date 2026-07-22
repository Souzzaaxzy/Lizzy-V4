/**
 * ═══════════════════════════════════════════════════════════════
 * X9 SYSTEM - Sistema de Solicitações de Entrada
 * Integrado com comandos !aprovar e !aprovar all
 * ═══════════════════════════════════════════════════════════════
 */

const COUNTRY_CODES = {
    '244': 'Angola 🇦🇴', '55': 'Brasil 🇧🇷', '351': 'Portugal 🇵🇹',
    '34': 'Espanha 🇪🇸', '1': 'EUA 🇺🇸', '44': 'UK 🇬🇧',
    '49': 'Alemanha 🇩🇪', '39': 'Itália 🇮🇹', '33': 'França 🇫🇷',
    '54': 'Argentina 🇦🇷', '56': 'Chile 🇨🇱', '57': 'Colômbia 🇨🇴',
    '51': 'Peru 🇵🇪', '52': 'México 🇲🇽', '225': 'Costa do Marfim 🇨🇮',
    '234': 'Nigéria 🇳🇬', '27': 'África do Sul 🇿🇦', '966': 'Arábia Saudita 🇸🇦',
    '971': 'Emirados 🇦🇪', '62': 'Indonésia 🇮🇩', '63': 'Filipinas 🇵🇭',
    '81': 'Japão 🇯🇵', '82': 'Coreia 🇰🇷', '86': 'China 🇨🇳',
    '91': 'Índia 🇮🇳', '61': 'Austrália 🇦🇺',
};

function getCountryFromNumber(number) {
    if (!number) return 'Desconhecido 🌍';
    const clean = number.replace(/\D/g, '');
    const ddi3 = clean.substring(0, 3);
    if (COUNTRY_CODES[ddi3]) return COUNTRY_CODES[ddi3];
    const ddi2 = clean.substring(0, 2);
    if (COUNTRY_CODES[ddi2]) return COUNTRY_CODES[ddi2];
    const ddi1 = clean.substring(0, 1);
    if (COUNTRY_CODES[ddi1]) return COUNTRY_CODES[ddi1];
    return 'Desconhecido 🌍';
}

// Armazenamento de solicitações
const x9Store = {
    requests: new Map(), // key: groupId:participantJid
    messages: new Map(), // key: messageId -> {groupId, participantJid}
    
    add(groupId, participantJid, data) {
        const key = `${groupId}:${participantJid}`;
        this.requests.set(key, { ...data, status: 'pending', createdAt: Date.now() });
    },
    
    get(groupId, participantJid) {
        return this.requests.get(`${groupId}:${participantJid}`);
    },
    
    getByParticipantNumber(participantNumber) {
        for (const [key, req] of this.requests) {
            if (req.participantNumber === participantNumber && req.status === 'pending') {
                return req;
            }
        }
        return null;
    },
    
    update(groupId, participantJid, updates) {
        const req = this.requests.get(`${groupId}:${participantJid}`);
        if (req) Object.assign(req, updates);
        return req;
    },
    
    setMessageId(groupId, participantJid, messageId) {
        this.messages.set(messageId, { groupId, participantJid });
        const req = this.get(groupId, participantJid);
        if (req) req.messageId = messageId;
    },
    
    getByMessageId(messageId) {
        return this.messages.get(messageId);
    }
};

// Track processado
const processedKeys = new Set();
const LOCK_DURATION = 30000;

function isProcessed(key) {
    return processedKeys.has(key);
}

function markProcessed(key) {
    processedKeys.add(key);
    setTimeout(() => processedKeys.delete(key), LOCK_DURATION);
}

// Normaliza JID
function normalizeJid(participant) {
    if (!participant) return null;
    if (typeof participant === 'string') {
        return participant.includes('@') ? participant : `${participant}@s.whatsapp.net`;
    }
    if (typeof participant === 'object') {
        const jid = participant.pn || participant.lid || participant.id || participant;
        if (typeof jid === 'string') {
            return jid.includes('@') ? jid : `${jid}@s.whatsapp.net`;
        }
    }
    return null;
}

// Formatadores
function formatTime(date = new Date()) {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatDate(date = new Date()) {
    return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
}

function getOrigin(method) {
    const origins = {
        'linked_group_join': '🔗 Link de convite',
        'invite_link': '🔗 Link de convite',
        'profile_qr_code': '📱 QR Code',
        'manual_add': '👤 Adicionado',
    };
    return origins[method] || '🌐 Via WhatsApp';
}

// Cards
function buildCard(data) {
    const { participantName, participantNumber, country, origin, time, date } = data;
    return `╭━━━〔 🔎 X9 • SOLICITAÇÃO 〕━━━⬣
┃ 👤 Nome: ${participantName || 'Não disponível'}
┃ 📞 Número: +${participantNumber}
┃ 🌍 País: ${country}
┃ 🔗 Origem: ${origin}
┃ 🕒 Horário: ${time}
┃ 📅 Data: ${date}
┃ 📌 Status: Aguardando
╰━━━━━━━━━━━━━━━━━━⬣`;
}

function buildApprovedCard(data) {
    const { participantName, participantNumber, adminNumber, time } = data;
    return `╭━━━〔 ✅ APROVADO 〕━━━⬣
┃ 👤 ${participantName || participantNumber}
┃ 👮 @${adminNumber}
┃ 🕒 ${time}
╰━━━━━━━━━━━━━━━━━━⬣`;
}

function buildRejectedCard(data) {
    const { participantName, participantNumber, adminNumber, time } = data;
    return `╭━━━〔 ❌ NEGADO 〕━━━⬣
┃ 👤 ${participantName || participantNumber}
┃ 👮 @${adminNumber}
┃ 🕒 ${time}
╰━━━━━━━━━━━━━━━━━━⬣`;
}

// ═══════════════════════════════════════════════════════════════
// FUNÇÕES PRINCIPAIS
// ═══════════════════════════════════════════════════════════════

/**
 * Envia card para nova solicitação de entrada
 */
export async function processNewJoinRequest(sock, eventData, groupSettings) {
    const { id: groupId, participant, participantPn, method, author, authorPn } = eventData;
    
    let participantJid = normalizeJid(participant);
    if (!participantJid && participantPn) {
        participantJid = normalizeJid(participantPn);
    }
    
    if (!groupId || !participantJid) {
        console.log('[X9] Dados insuficientes');
        return null;
    }
    
    if (!groupSettings?.x9) {
        console.log('[X9] X9 desativado');
        return null;
    }
    
    const key = `${groupId}:${participantJid}`;
    if (isProcessed(key)) {
        console.log('[X9] Já processado');
        return null;
    }
    
    const now = new Date();
    const participantNumber = participantJid.replace(/@.*$/, '');
    
    // Tenta obter nome
    let participantName = participantNumber;
    try {
        const name = await sock.getName(participantJid);
        if (name && name !== participantJid) participantName = name;
    } catch (e) {}
    
    const data = {
        groupId,
        participantJid,
        participantNumber,
        participantName,
        country: getCountryFromNumber(participantNumber),
        origin: getOrigin(method),
        time: formatTime(now),
        date: formatDate(now),
        status: 'pending'
    };
    
    x9Store.add(groupId, participantJid, data);
    markProcessed(key);
    
    const cardText = buildCard(data);
    const mentions = [participantJid];
    
    try {
        const sent = await sock.sendMessage(groupId, {
            text: cardText,
            mentions
        });
        
        if (sent?.key?.id) {
            x9Store.setMessageId(groupId, participantJid, sent.key.id);
            console.log(`[X9] Card enviado: ${sent.key.id}`);
        }
        
        return sent;
    } catch (error) {
        console.error('[X9] Erro ao enviar card:', error.message);
        return null;
    }
}

/**
 * Atualiza card quando uma solicitação é aprovada via comando
 */
export async function updateCardOnApprove(sock, groupId, participantJid, adminJid) {
    const req = x9Store.get(groupId, participantJid);
    if (!req) {
        console.log('[X9] Requisição não encontrada no store');
        return null;
    }
    
    const now = new Date();
    const adminNumber = adminJid.replace(/@.*$/, '');
    
    const cardData = {
        participantName: req.participantName,
        participantNumber: req.participantNumber,
        adminNumber,
        time: formatTime(now)
    };
    
    const updatedText = buildApprovedCard(cardData);
    const mentions = [adminJid, participantJid];
    
    // Deleta mensagem original se existir
    if (req.messageId) {
        try {
            await sock.sendMessage(groupId, { 
                delete: { id: req.messageId, remoteJid: groupId, fromMe: true } 
            });
        } catch (e) {
            console.log('[X9] Não conseguiu deletar card antigo');
        }
    }
    
    // Envia novo card
    try {
        const sent = await sock.sendMessage(groupId, {
            text: updatedText,
            mentions
        });
        
        x9Store.update(groupId, participantJid, { status: 'approved' });
        console.log(`[X9] Card atualizado para aprovado`);
        
        return sent;
    } catch (error) {
        console.error('[X9] Erro ao atualizar card:', error.message);
        return null;
    }
}

/**
 * Atualiza card quando uma solicitação é negada via comando
 */
export async function updateCardOnReject(sock, groupId, participantJid, adminJid) {
    const req = x9Store.get(groupId, participantJid);
    if (!req) {
        console.log('[X9] Requisição não encontrada no store');
        return null;
    }
    
    const now = new Date();
    const adminNumber = adminJid.replace(/@.*$/, '');
    
    const cardData = {
        participantName: req.participantName,
        participantNumber: req.participantNumber,
        adminNumber,
        time: formatTime(now)
    };
    
    const updatedText = buildRejectedCard(cardData);
    const mentions = [adminJid];
    
    // Deleta mensagem original
    if (req.messageId) {
        try {
            await sock.sendMessage(groupId, { 
                delete: { id: req.messageId, remoteJid: groupId, fromMe: true } 
            });
        } catch (e) {}
    }
    
    try {
        const sent = await sock.sendMessage(groupId, {
            text: updatedText,
            mentions
        });
        
        x9Store.update(groupId, participantJid, { status: 'rejected' });
        console.log(`[X9] Card atualizado para negado`);
        
        return sent;
    } catch (error) {
        console.error('[X9] Erro ao atualizar card:', error.message);
        return null;
    }
}

/**
 * Envia notificação quando aprovado via WhatsApp (sem comando)
 */
export async function notifyWhatsAppApproval(sock, groupId, participantJid, adminJid) {
    const req = x9Store.get(groupId, participantJid);
    if (!req || req.status !== 'pending') return null;
    
    const now = new Date();
    const adminNumber = adminJid.replace(/@.*$/, '');
    
    const notification = `╭━━━〔 ✅ X9 • APROVADO 〕━━━⬣
┃ 👤 ${req.participantName || req.participantNumber}
┃ 👮 @${adminNumber}
┃ 🕒 ${formatTime(now)}
╰━━━━━━━━━━━━━━━━━━⬣`;
    
    try {
        await sock.sendMessage(groupId, {
            text: notification,
            mentions: [adminJid, participantJid]
        });
        
        x9Store.update(groupId, participantJid, { status: 'approved' });
        console.log('[X9] Notificação enviada via WhatsApp');
    } catch (error) {
        console.error('[X9] Erro na notificação:', error.message);
    }
}

/**
 * Verifica se é admin do grupo
 */
export async function isGroupAdmin(sock, groupId, userJid) {
    try {
        const metadata = await sock.groupMetadata(groupId);
        const participant = metadata?.participants?.find(p => p.id === userJid);
        return participant?.admin === 'admin' || participant?.admin === 'superadmin';
    } catch (e) {
        return false;
    }
}

/**
 * Busca requisição por número do participante
 */
export function findRequestByNumber(participantNumber) {
    for (const [key, req] of x9Store.requests) {
        if (req.participantNumber === participantNumber && req.status === 'pending') {
            return req;
        }
    }
    return null;
}

export function cleanupX9System() {
    x9Store.requests.clear();
    x9Store.messages.clear();
    processedKeys.clear();
}

// Exports adicionais
export {
    x9Store,
    getCountryFromNumber,
    normalizeJid
};
