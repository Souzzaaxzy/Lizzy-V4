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

function getCountryCode(number) {
    if (!number) return 'XX';
    const clean = number.replace(/\D/g, '');
    const ddi3 = clean.substring(0, 3);
    if (COUNTRY_CODES[ddi3]) return ddi3;
    const ddi2 = clean.substring(0, 2);
    if (COUNTRY_CODES[ddi2]) return ddi2;
    const ddi1 = clean.substring(0, 1);
    if (COUNTRY_CODES[ddi1]) return ddi1;
    return 'XX';
}

// Template do card
const X9_CARD_TEMPLATE = `╭━━━〔 🔎 X9 • NOVA SOLICITAÇÃO 〕━━━⬣
┃ 👤 Nome: @{numero}
┃ 📞 Lid: {lid}
┃ 🌍 Origem: {origem}
┃ 🕒 Horário: {hora}
┃ 📌 Status: Aguardando aprovação
╰━━━━━━━━━━━━━━━━━━━━━━━━━━⬣`;

const X9_APPROVED_TEMPLATE = `╭━━━〔 ✅ X9 • SOLICITAÇÃO APROVADA 〕━━━⬣
┃ 👤 Solicitante: @{numero}
┃ 👮 Aprovado por: @{admin}
┃ 🕒 Horário: {hora}
┃ 📌 Status: Concluído
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣`;

const X9_REJECTED_TEMPLATE = `╭━━━〔 ❌ X9 • SOLICITAÇÃO NEGADA 〕━━━⬣
┃ 👤 Solicitante: @{numero}
┃ 👮 Negado por: @{admin}
┃ 🕒 Horário: {hora}
┃ 📌 Status: Negado
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣`;

// Substitui variáveis no template
function parseTemplate(template, vars) {
    return template
        .replace(/{nome}/g, vars.nome || 'Usuário')
        .replace(/{numero}/g, vars.numero || '')
        .replace(/{pais}/g, vars.pais || 'Desconhecido')
        .replace(/{paiscod}/g, vars.paiscod || '')
        .replace(/{hora}/g, vars.hora || '')
        .replace(/{data}/g, vars.data || '')
        .replace(/{origem}/g, vars.origem || 'WhatsApp')
        .replace(/{grupo}/g, vars.grupo || '')
        .replace(/{admin}/g, vars.admin || '');
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

// Normaliza JID - extrai número de qualquer formato
function normalizeJid(participant) {
    if (!participant) return null;
    
    // Se é string
    if (typeof participant === 'string') {
        // Se já tem @, retorna como está
        if (participant.includes('@')) return participant;
        // Se não tem @, adiciona
        return `${participant}@s.whatsapp.net`;
    }
    
    // Se é objeto (pode vir como { pn: 'numero', lid: '...', id: '...' })
    if (typeof participant === 'object') {
        // Tenta extrair o número de diferentes propriedades
        const num = participant.pn || participant.lid || participant.id || participant.number;
        
        if (typeof num === 'string') {
            // Remove qualquer @ que possa ter
            const cleanNum = num.split('@')[0];
            // Se parece ser um número LID (letras/números sem @s.whatsapp.net)
            if (cleanNum.includes('lid') || !/^\d+$/.test(cleanNum)) {
                return cleanNum.includes('@') ? cleanNum : `${cleanNum}@lid`;
            }
            return `${cleanNum}@s.whatsapp.net`;
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

// ═══════════════════════════════════════════════════════════════
// FUNÇÕES PRINCIPAIS
// ═══════════════════════════════════════════════════════════════

/**
 * Envia card para nova solicitação de entrada com foto do usuário
 */
export async function processNewJoinRequest(sock, eventData, groupSettings) {
    const { id: groupId, participant, participantPn, method, author, authorPn } = eventData;
    
    // Extrai o JID do participante
    let participantJid = normalizeJid(participant);
    let participantLid = '';
    
    if (!participantJid && participantPn) {
        participantJid = normalizeJid(participantPn);
    }
    if (!participantJid) {
        const authorJid = normalizeJid(author || authorPn);
        if (authorJid) participantJid = authorJid;
    }
    
    // Extrai o LID se existir
    if (typeof participant === 'object' && participant) {
        if (participant.lid) participantLid = participant.lid;
        else if (participantPn && typeof participantPn === 'object' && participantPn.lid) {
            participantLid = participantPn.lid;
        }
    }
    
    if (!groupId || !participantJid) {
        console.log('[X9] ❌ Dados insuficientes');
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
    
    // Armazena dados
    const data = {
        groupId,
        participantJid,
        participantNumber,
        participantLid,
        time: formatTime(now),
        status: 'pending'
    };
    
    x9Store.add(groupId, participantJid, data);
    markProcessed(key);
    
    // Template
    const vars = {
        numero: participantNumber,
        lid: participantLid || 'N/A',
        origem: getOrigin(method),
        hora: formatTime(now)
    };
    
    const cardText = parseTemplate(X9_CARD_TEMPLATE, vars);
    
    console.log('[X9] Enviando card...');
    
    try {
        // Tenta obter a foto de perfil
        let photoUrl = null;
        try {
            photoUrl = await sock.profilePictureUrl(participantJid, 'image');
        } catch (e) {
            console.log('[X9] Sem foto de perfil');
        }
        
        let sent;
        
        if (photoUrl) {
            // Envia com foto
            sent = await sock.sendMessage(groupId, {
                image: { url: photoUrl },
                caption: cardText,
                mentions: [participantJid]
            });
            console.log(`[X9] ✅ Card com foto enviado`);
        } else {
            // Envia sem foto
            sent = await sock.sendMessage(groupId, {
                text: cardText,
                mentions: [participantJid]
            });
            console.log(`[X9] ✅ Card sem foto enviado`);
        }
        
        if (sent?.key?.id) {
            x9Store.setMessageId(groupId, participantJid, sent.key.id);
        }
        
        return sent;
    } catch (error) {
        console.error('[X9] ❌ Erro ao enviar card:', error.message);
        return null;
    }
}

/**
 * Envia card de aprovação mostrando quem aprovou
 */
export async function updateCardOnApprove(sock, groupId, participantJid, adminJid) {
    const req = x9Store.get(groupId, participantJid);
    if (!req) {
        console.log('[X9] Requisição não encontrada no store');
        return null;
    }
    
    const now = new Date();
    const adminNumber = adminJid.replace(/@.*$/, '');
    
    // Deleta mensagem original se existir
    if (req.messageId) {
        try {
            await sock.sendMessage(groupId, { 
                delete: { id: req.messageId, remoteJid: groupId, fromMe: true } 
            });
        } catch (e) {}
    }
    
    // Envia mensagem de aprovação com quem aprovou
    const vars = {
        admin: adminNumber,
        numero: req.participantNumber,
        hora: formatTime(now)
    };
    
    const approvedText = parseTemplate(X9_APPROVED_TEMPLATE, vars);
    
    try {
        const sent = await sock.sendMessage(groupId, {
            text: approvedText,
            mentions: [participantJid, adminJid]
        });
        
        x9Store.update(groupId, participantJid, { status: 'approved' });
        console.log(`[X9] ✅ Aprovado por ${adminNumber}`);
        return sent;
    } catch (error) {
        console.error('[X9] Erro ao enviar aprovação:', error.message);
        return null;
    }
}

/**
 * Envia card de rejeição mostrando quem rejeitou
 */
export async function updateCardOnReject(sock, groupId, participantJid, adminJid) {
    const req = x9Store.get(groupId, participantJid);
    if (!req) {
        console.log('[X9] Requisição não encontrada no store');
        return null;
    }
    
    const now = new Date();
    const adminNumber = adminJid.replace(/@.*$/, '');
    
    // Deleta mensagem original
    if (req.messageId) {
        try {
            await sock.sendMessage(groupId, { 
                delete: { id: req.messageId, remoteJid: groupId, fromMe: true } 
            });
        } catch (e) {}
    }
    
    // Envia mensagem de rejeição com quem rejeitou
    const vars = {
        admin: adminNumber,
        numero: req.participantNumber,
        hora: formatTime(now)
    };
    
    const rejectedText = parseTemplate(X9_REJECTED_TEMPLATE, vars);
    
    try {
        const sent = await sock.sendMessage(groupId, {
            text: rejectedText,
            mentions: [participantJid, adminJid]
        });
        
        x9Store.update(groupId, participantJid, { status: 'rejected' });
        console.log(`[X9] ❌ Rejeitado por ${adminNumber}`);
        return sent;
    } catch (error) {
        console.error('[X9] Erro ao enviar rejeição:', error.message);
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
    
    const vars = {
        numero: req.participantNumber,
        hora: formatTime(now),
        admin: adminNumber
    };
    
    const notification = parseTemplate(X9_APPROVED_TEMPLATE, vars);
    
    try {
        await sock.sendMessage(groupId, {
            text: notification,
            mentions: [participantJid, adminJid]
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

// Exports
export {
    x9Store,
    getCountryFromNumber,
    normalizeJid,
    // Templates para customização
    X9_CARD_TEMPLATE,
    X9_APPROVED_TEMPLATE,
    X9_REJECTED_TEMPLATE,
    parseTemplate
};
