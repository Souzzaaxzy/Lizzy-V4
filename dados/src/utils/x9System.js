/**
 * ═══════════════════════════════════════════════════════════════
 * X9 SYSTEM - Sistema de Solicitações de Entrada
 * Integrado com comandos !aprovar e !aprovar all
 * ═══════════════════════════════════════════════════════════════
 */

// Lista completa de DDIs por país
const DDI_LIST = {
    // África
    '244': 'Angola 🇦🇴',
    '258': 'Moçambique 🇲🇿',
    '233': 'Gana 🇬🇭',
    '254': 'Quênia 🇰🇪',
    '255': 'Tanzânia 🇹🇿',
    '234': 'Nigéria 🇳🇬',
    '27': 'África do Sul 🇿🇦',
    '225': 'Costa do Marfim 🇨🇮',
    '216': 'Tunísia 🇹🇳',
    '213': 'Argélia 🇩🇿',
    '212': 'Marrocos 🇲🇦',
    '20': 'Egito 🇪🇬',
    '249': 'Sudão 🇸🇩',
    '252': 'Somália 🇸🇴',
    '251': 'Etiópia 🇪🇹',
    '245': 'Guiné-Bissau 🇬🇼',
    
    // América
    '55': 'Brasil 🇧🇷',
    '1': 'EUA/Canadá 🇺🇸🇨🇦',
    '54': 'Argentina 🇦🇷',
    '56': 'Chile 🇨🇱',
    '57': 'Colômbia 🇨🇴',
    '51': 'Peru 🇵🇪',
    '52': 'México 🇲🇽',
    '598': 'Uruguai 🇺🇾',
    '595': 'Paraguai 🇵🇾',
    '593': 'Equador 🇪🇨',
    '591': 'Bolívia 🇧🇴',
    '507': 'Panamá 🇵🇦',
    '503': 'El Salvador 🇸🇻',
    '502': 'Guatemala 🇬🇹',
    '504': 'Honduras 🇭🇳',
    '505': 'Nicarágua 🇳🇮',
    '506': 'Costa Rica 🇨🇷',
    
    // Ásia
    '81': 'Japão 🇯🇵',
    '82': 'Coreia do Sul 🇰🇷',
    '86': 'China 🇨🇳',
    '91': 'Índia 🇮🇳',
    '92': 'Paquistão 🇵🇰',
    '60': 'Malásia 🇲🇾',
    '62': 'Indonésia 🇮🇩',
    '63': 'Filipinas 🇵🇭',
    '65': 'Singapura 🇸🇬',
    '66': 'Tailândia 🇹🇭',
    '84': 'Vietnã 🇻🇳',
    '95': 'Myanmar 🇲🇲',
    '856': 'Laos 🇱🇦',
    '855': 'Camboja 🇰🇭',
    '880': 'Bangladesh 🇧🇩',
    '94': 'Sri Lanka 🇱🇰',
    '977': 'Nepal 🇳🇵',
    '98': 'Irã 🇮🇷',
    '962': 'Jordânia 🇯🇴',
    '966': 'Arábia Saudita 🇸🇦',
    '971': 'Emirados 🇦🇪',
    '972': 'Israel 🇮🇱',
    '973': 'Bahrein 🇧🇭',
    '974': 'Catar 🇶🇦',
    '975': 'Butão 🇧🇹',
    '976': 'Mongólia 🇲🇳',
    '992': 'Tajiquistão 🇹🇯',
    '993': 'Turcomenistão 🇹🇲',
    '994': 'Azerbaijão 🇦🇿',
    '995': 'Geórgia 🇬🇪',
    '996': 'Quirguistão 🇰🇬',
    '998': 'Uzbequistão 🇺🇿',
    
    // Europa
    '7': 'Rússia 🇷🇺',
    '20': 'Egito 🇪🇬',
    '30': 'Grécia 🇬🇷',
    '31': 'Países Baixos 🇳🇱',
    '32': 'Bélgica 🇧🇪',
    '33': 'França 🇫🇷',
    '34': 'Espanha 🇪🇸',
    '36': 'Hungria 🇭🇺',
    '39': 'Itália 🇮🇹',
    '40': 'Romênia 🇷🇴',
    '41': 'Suíça 🇨🇭',
    '43': 'Áustria 🇦🇹',
    '44': 'Reino Unido 🇬🇧',
    '45': 'Dinamarca 🇩🇰',
    '46': 'Suécia 🇸🇪',
    '47': 'Noruega 🇳🇴',
    '48': 'Polônia 🇵🇱',
    '49': 'Alemanha 🇩🇪',
    '351': 'Portugal 🇵🇹',
    '352': 'Luxemburgo 🇱🇺',
    '353': 'Irlanda 🇮🇪',
    '354': 'Islândia 🇮🇸',
    '355': 'Albânia 🇦🇱',
    '356': 'Malta 🇲🇹',
    '357': 'Chipre 🇨🇾',
    '358': 'Finlândia 🇫🇮',
    '359': 'Bulgária 🇧🇬',
    '370': 'Lituânia 🇱🇹',
    '371': 'Letônia 🇱🇻',
    '372': 'Estônia 🇪🇪',
    '373': 'Moldávia 🇲🇩',
    '375': 'Bielorrússia 🇧🇾',
    '376': 'Andorra 🇦🇩',
    '377': 'Mônaco 🇲🇨',
    '378': 'San Marino 🇸🇲',
    '380': 'Ucrânia 🇺🇦',
    '381': 'Sérvia 🇷🇸',
    '382': 'Montenegro 🇲🇪',
    '383': 'Kosovo 🇽🇰',
    '385': 'Croácia 🇭🇷',
    '386': 'Eslovênia 🇸🇮',
    '387': 'Bósnia 🇧🇦',
    '389': 'Macedônia 🇲🇰',
    '420': 'República Tcheca 🇨🇿',
    '421': 'Eslováquia 🇸🇰',
    '423': 'Liechtenstein 🇱🇮',
    '358': 'Åland Islands 🇦🇽',
    
    // Oceania
    '61': 'Austrália 🇦🇺',
    '64': 'Nova Zelândia 🇳🇿',
    '675': 'Papua Nova Guiné 🇵🇬',
    '676': 'Tonga 🇹🇴',
    '677': 'Ilhas Salomão 🇸🇧',
    '678': 'Vanuatu 🇻🇺',
    '679': 'Fiji 🇫🇯',
    '680': 'Palau 🇵🇼',
    '681': 'Wallis e Futuna 🇼🇫',
    '682': 'Cook Islands 🇨🇰',
    '683': 'Niue 🇳🇺',
    '685': 'Samoa 🇼🇸',
    '686': 'Kiribati 🇰🇮',
    '687': 'Nova Caledônia 🇳🇨',
    '688': 'Tuvalu 🇹🇻',
    '689': 'Polinésia Francesa 🇵🇫',
    '850': 'Coreia do Norte 🇰🇵',
    
    // outros
    '670': 'Timor-Leste 🇹🇱',
    '500': 'Malvinas 🇫🇰',
    '508': 'São Pedro e Miquelão 🇵🇲',
    '590': 'Guadalupe 🇬🇵',
    '594': 'Guiana Francesa 🇬🇫',
    '596': 'Martinica 🇲🇶',
    '687': 'Nova Caledônia 🇳🇨',
};

// Ordem de prioridade: DDIs de 3 dígitos primeiro, depois 2 dígitos, depois 1 dígito
const DDI_PRIORITY = [
    // 3 dígitos
    '966', '971', '880', '856', '855', '677', '676', '675', '670',
    '596', '594', '590', '508', '500', '423', '421', '420', '389',
    '387', '385', '383', '382', '381', '380', '378', '377', '376',
    '375', '373', '372', '371', '370', '359', '358', '357', '356',
    '355', '354', '353', '352', '351', '258', '255', '254', '252',
    '251', '249', '245', '244', '234', '233', '225', '216', '213',
    '212', '208', '205', '203', '202', '201', '200', '98', '95',
    '94', '93', '92', '91', '90', '86', '85', '84', '82', '81',
    // 2 dígitos
    '65', '64', '63', '62', '61', '60', '56', '55', '54', '53',
    '52', '51', '49', '48', '47', '46', '45', '44', '43', '42',
    '41', '40', '39', '36', '34', '33', '32', '31', '30', '20',
    // 1 dígito
    '7', '1'
];

function getCountryFromNumber(number) {
    if (!number) return 'Desconhecido 🌐';
    
    // Extrai apenas números
    let clean = number.replace(/\D/g, '');
    
    // Se começa com 00, remove
    if (clean.startsWith('00')) {
        clean = clean.substring(2);
    }
    
    // Se começa com +, remove
    if (clean.startsWith('+')) {
        clean = clean.substring(1);
    }
    
    // Procura o DDI na lista de prioridade
    for (const ddi of DDI_PRIORITY) {
        if (clean.startsWith(ddi)) {
            return DDI_LIST[ddi] || 'Desconhecido 🌐';
        }
    }
    
    return 'Desconhecido 🌐';
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
┃ 🌍 País: {pais}
┃ 🔗 Via: {origem}
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

// Templates para notificações de mudanças no grupo
const X9_GROUP_NAME_CHANGED = `╭━━━〔 📝 X9 • NOME ALTERADO 〕━━━⬣
┃ 👤 Por: @{admin}
┃ 📌 Anterior: {oldName}
┃ 🆕 Novo: {newName}
┃ 🕒 Horário: {hora}
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣`;

const X9_GROUP_DESC_CHANGED = `╭━━━〔 📜 X9 • DESCRIÇÃO ALTERADA 〕━━━⬣
┃ 👤 Por: @{admin}
┃ 📝 Nova descrição: {newDesc}
┃ 🕒 Horário: {hora}
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣`;

const X9_GROUP_DESC_REMOVED = `╭━━━〔 📜 X9 • DESCRIÇÃO REMOVIDA 〕━━━⬣
┃ 👤 Por: @{admin}
┃ 🕒 Horário: {hora}
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣`;

const X9_GROUP_PHOTO_CHANGED = `╭━━━〔 📸 X9 • FOTO ALTERADA 〕━━━⬣
┃ 👤 Por: @{admin}
┃ 🕒 Horário: {hora}
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣`;

const X9_GROUP_LINK_CHANGED = `╭━━━〔 🔗 X9 • LINK REDEFINIDO 〕━━━⬣
┃ 👤 Por: @{admin}
┃ 🕒 Horário: {hora}
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣`;

const X9_GROUP_LOCKED = `╭━━━〔 🔒 X9 • GRUPO BLOQUEADO 〕━━━⬣
┃ 👤 Por: @{admin}
┃ 📌 Apenas admins podem enviar mensagens
┃ 🕒 Horário: {hora}
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣`;

const X9_GROUP_UNLOCKED = `╭━━━〔 🔓 X9 • GRUPO DESBLOQUEADO 〕━━━⬣
┃ 👤 Por: @{admin}
┃ 📌 Todos podem enviar mensagens
┃ 🕒 Horário: {hora}
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣`;

const X9_GROUP_EDIT_RESTRICTED = `╭━━━〔 ✏️ X9 • EDIÇÃO RESTRITA 〕━━━⬣
┃ 👤 Por: @{admin}
┃ 📌 Apenas admins podem editar
┃ 🕒 Horário: {hora}
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣`;

const X9_GROUP_EDIT_FREE = `╭━━━〔 ✏️ X9 • EDIÇÃO LIBERADA 〕━━━⬣
┃ 👤 Por: @{admin}
┃ 📌 Todos podem editar
┃ 🕒 Horário: {hora}
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣`;

const X9_GROUP_TEMPORARY_ON = `╭━━━〔 ⏱️ X9 • MENSAGENS TEMPORÁRIAS 〕━━━⬣
┃ 👤 Por: @{admin}
┃ ⏱️ Tempo: {duration}
┃ 🕒 Horário: {hora}
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━⬣`;

const X9_GROUP_TEMPORARY_OFF = `╭━━━〔 ⏱️ X9 • MENSAGENS TEMPORÁRIAS 〕━━━⬣
┃ 👤 Por: @{admin}
┃ ⏱️ Desativadas
┃ 🕒 Horário: {hora}
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
        .replace(/{admin}/g, vars.admin || '')
        .replace(/{oldName}/g, vars.oldName || '')
        .replace(/{newName}/g, vars.newName || '')
        .replace(/{newDesc}/g, vars.newDesc || '')
        .replace(/{duration}/g, vars.duration || '');
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

// Normaliza JID - extrai APENAS o número real do telefone
// NUNCA usa LID (Linked Identity) - é apenas um identificador interno
function normalizeJid(participant) {
    if (!participant) return null;
    
    // Se é string
    if (typeof participant === 'string') {
        // Se já tem @, retorna como está
        if (participant.includes('@')) {
            // Se for LID, retorna null (não é número real)
            if (participant.includes('@lid')) return null;
            return participant;
        }
        // Se não tem @, adiciona
        return `${participant}@s.whatsapp.net`;
    }
    
    // Se é objeto (pode vir como { pn: 'numero', lid: '...', id: '...' })
    if (typeof participant === 'object') {
        // PRIORIDADE: pn > id > number (nunca usa lid!)
        const num = participant.pn || participant.id || participant.number;
        
        if (typeof num === 'string') {
            // Remove qualquer @ que possa ter
            const cleanNum = num.split('@')[0];
            
            // Verifica se é um número válido (apenas dígitos)
            if (/^\d+$/.test(cleanNum)) {
                return `${cleanNum}@s.whatsapp.net`;
            }
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
    
    if (!participantJid && participantPn) {
        participantJid = normalizeJid(participantPn);
    }
    if (!participantJid) {
        const authorJid = normalizeJid(author || authorPn);
        if (authorJid) participantJid = authorJid;
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
    
    // Detecta o país pelo DDI
    const pais = getCountryFromNumber(participantNumber);
    
    // Armazena dados
    const data = {
        groupId,
        participantJid,
        participantNumber,
        pais,
        time: formatTime(now),
        status: 'pending'
    };
    
    x9Store.add(groupId, participantJid, data);
    markProcessed(key);
    
    // Template
    const vars = {
        numero: participantNumber,
        pais: pais,
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
    try {
        // Normaliza o JID para garantir consistência
        const normalizedJid = normalizeJid(participantJid);
        const cleanJid = (normalizedJid || participantJid || '').replace(/@.+$/, '');
        
        console.log(`[X9] ========== APROVANDO ==========`);
        console.log(`[X9] Input JID: ${participantJid}`);
        console.log(`[X9] Normalized: ${normalizedJid}`);
        console.log(`[X9] Clean: ${cleanJid}`);
        console.log(`[X9] Group: ${groupId}`);
        console.log(`[X9] Admin: ${adminJid}`);
        
        // Tenta buscar no store com diferentes formatos
        let req = x9Store.get(groupId, normalizedJid);
        if (!req) req = x9Store.get(groupId, participantJid);
        if (!req) req = x9Store.getByParticipantNumber(cleanJid);
        
        console.log(`[X9] Store request found:`, req ? 'SIM' : 'NÃO');
        
        if (!req) {
            console.log('[X9] Requisição não encontrada no store');
            console.log('[X9] Store keys:', [...x9Store.requests.keys()]);
            return null;
        }
        
        console.log(`[X9] Request data:`, JSON.stringify(req));
        
        const now = new Date();
        const adminNumber = adminJid.replace(/@.*$/, '');
        
        // Deleta mensagem original se existir
        if (req.messageId) {
            try {
                await sock.sendMessage(groupId, { 
                    delete: { id: req.messageId, remoteJid: groupId, fromMe: true } 
                });
                console.log('[X9] Card original deletado');
            } catch (e) {
                console.log('[X9] Erro ao deletar card:', e.message);
            }
        }
        
        // Envia mensagem de aprovação com quem aprovou
        const vars = {
            admin: adminNumber,
            numero: req.participantNumber,
            hora: formatTime(now)
        };
        
        const approvedText = parseTemplate(X9_APPROVED_TEMPLATE, vars);
        console.log(`[X9] Enviando card: ${approvedText}`);
        
        const sent = await sock.sendMessage(groupId, {
            text: approvedText,
            mentions: [req.participantJid, adminJid]
        });
        
        x9Store.update(groupId, req.participantJid, { status: 'approved' });
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
    try {
        // Normaliza o JID para garantir consistência
        const normalizedJid = normalizeJid(participantJid);
        const cleanJid = (normalizedJid || participantJid || '').replace(/@.+$/, '');
        
        console.log(`[X9] ========== REJEITANDO ==========`);
        console.log(`[X9] Input JID: ${participantJid}`);
        console.log(`[X9] Normalized: ${normalizedJid}`);
        console.log(`[X9] Clean: ${cleanJid}`);
        
        // Tenta buscar no store com diferentes formatos
        let req = x9Store.get(groupId, normalizedJid);
        if (!req) req = x9Store.get(groupId, participantJid);
        if (!req) req = x9Store.getByParticipantNumber(cleanJid);
        
        if (!req) {
            console.log('[X9] Requisição não encontrada no store');
            console.log('[X9] Store keys:', [...x9Store.requests.keys()]);
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
        
        // Envia mensagem de rejeição
        const vars = {
            admin: adminNumber,
            numero: req.participantNumber,
            hora: formatTime(now)
        };
        
        const rejectedText = parseTemplate(X9_REJECTED_TEMPLATE, vars);
        
        const sent = await sock.sendMessage(groupId, {
            text: rejectedText,
            mentions: [req.participantJid, adminJid]
        });
        
        x9Store.update(groupId, req.participantJid, { status: 'rejected' });
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
    console.log('[X9] notifyWhatsAppApproval called');
    console.log('[X9] groupId:', groupId);
    console.log('[X9] participantJid:', participantJid);
    console.log('[X9] adminJid:', adminJid);
    console.log('[X9] Store keys:', [...x9Store.requests.keys()]);
    
    const req = x9Store.get(groupId, participantJid);
    console.log('[X9] Found request:', req ? 'SIM' : 'NÃO');
    
    if (!req || req.status !== 'pending') {
        console.log('[X9] Request not found or not pending');
        return null;
    }

    const now = new Date();
    const adminNumber = adminJid ? adminJid.replace(/@.*$/, '') : 'Admin';

    const vars = {
        numero: req.participantNumber,
        hora: formatTime(now),
        admin: adminNumber
    };

    const notification = parseTemplate(X9_APPROVED_TEMPLATE, vars);
    console.log('[X9] Sending notification:', notification);

    try {
        await sock.sendMessage(groupId, {
            text: notification,
            mentions: [participantJid, adminJid].filter(Boolean)
        });

        x9Store.update(groupId, participantJid, { status: 'approved' });
        console.log('[X9] ✅ Notificação enviada via WhatsApp');
    } catch (error) {
        console.error('[X9] Erro na notificação:', error.message);
    }
}

/**
 * Envia notificação quando rejeitado via WhatsApp (sem comando)
 */
export async function notifyWhatsAppRejection(sock, groupId, participantJid, adminJid) {
    console.log('[X9] notifyWhatsAppRejection called');
    console.log('[X9] groupId:', groupId);
    console.log('[X9] participantJid:', participantJid);
    console.log('[X9] adminJid:', adminJid);
    
    const req = x9Store.get(groupId, participantJid);
    console.log('[X9] Found request:', req ? 'SIM' : 'NÃO');
    
    if (!req || req.status !== 'pending') {
        console.log('[X9] Request not found or not pending');
        return null;
    }

    const now = new Date();
    const adminNumber = adminJid ? adminJid.replace(/@.*$/, '') : 'Admin';

    const vars = {
        numero: req.participantNumber,
        hora: formatTime(now),
        admin: adminNumber
    };

    const notification = parseTemplate(X9_REJECTED_TEMPLATE, vars);
    console.log('[X9] Sending notification:', notification);

    try {
        await sock.sendMessage(groupId, {
            text: notification,
            mentions: [participantJid, adminJid].filter(Boolean)
        });

        x9Store.update(groupId, participantJid, { status: 'rejected' });
        console.log('[X9] ✅ Rejeição enviada via WhatsApp');
    } catch (error) {
        console.error('[X9] Erro na notificação:', error.message);
    }
}

/**
 * Envia notificação de mudança no grupo (nome, descrição, etc)
 */
export async function notifyGroupChange(sock, groupId, changeType, adminJid, extraData = {}) {
    console.log('[X9] notifyGroupChange called');
    console.log('[X9] groupId:', groupId);
    console.log('[X9] changeType:', changeType);
    console.log('[X9] adminJid:', adminJid);
    
    const now = new Date();
    // adminJid já contém @s.whatsapp.net, então usa direto
    const adminText = adminJid || 'Admin';
    
    let template;
    const vars = {
        admin: adminText,
        hora: formatTime(now),
        ...extraData
    };
    
    switch (changeType) {
        case 'name_changed':
            template = X9_GROUP_NAME_CHANGED;
            break;
        case 'desc_changed':
            template = X9_GROUP_DESC_CHANGED;
            break;
        case 'desc_removed':
            template = X9_GROUP_DESC_REMOVED;
            break;
        case 'photo_changed':
            template = X9_GROUP_PHOTO_CHANGED;
            break;
        case 'link_changed':
            template = X9_GROUP_LINK_CHANGED;
            break;
        case 'locked':
            template = X9_GROUP_LOCKED;
            break;
        case 'unlocked':
            template = X9_GROUP_UNLOCKED;
            break;
        case 'edit_restricted':
            template = X9_GROUP_EDIT_RESTRICTED;
            break;
        case 'edit_free':
            template = X9_GROUP_EDIT_FREE;
            break;
        case 'temporary_on':
            template = X9_GROUP_TEMPORARY_ON;
            break;
        case 'temporary_off':
            template = X9_GROUP_TEMPORARY_OFF;
            break;
        default:
            console.log('[X9] Unknown change type:', changeType);
            return null;
    }
    
    const notification = parseTemplate(template, vars);
    console.log('[X9] Sending notification:', notification);
    
    try {
        const mention = adminJid ? [adminJid] : [];
        await sock.sendMessage(groupId, {
            text: notification,
            mentions: mention
        });
        console.log('[X9] ✅ Notificação de mudança enviada');
    } catch (error) {
        console.error('[X9] Erro ao enviar notificação:', error.message);
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
