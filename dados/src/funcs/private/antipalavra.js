// --- SISTEMA ANTIPALAVRA ---
// Sistema de blacklist de palavras com ações individuais (ban ou adv)
// Cada palavra pode ter sua própria ação configurada
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GRUPOS_DIR = path.join(__dirname, '../../../database/grupos');

// Ações válidas
const ACOES_VALIDAS = ['ban', 'adv'];

// --- HELPERS ---

/**
 * Remove acentos e normaliza texto para comparação
 */
const normalizeText = (text) => {
    if (!text || typeof text !== 'string') return '';
    return text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Remove acentos
        .trim();
};

/**
 * Carrega dados do grupo
 */
const loadGroupData = (groupId) => {
    try {
        const groupFile = path.join(GRUPOS_DIR, `${groupId}.json`);
        if (fs.existsSync(groupFile)) {
            const data = JSON.parse(fs.readFileSync(groupFile, 'utf8'));
            return data;
        }
        return {};
    } catch (err) {
        console.error(`[ANTIPALAVRA] Erro ao carregar dados do grupo ${groupId}:`, err.message);
        return {};
    }
};

/**
 * Salva dados do grupo
 */
const saveGroupData = (groupId, data) => {
    try {
        const dir = path.dirname(path.join(GRUPOS_DIR, `${groupId}.json`));
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        const groupFile = path.join(GRUPOS_DIR, `${groupId}.json`);
        fs.writeFileSync(groupFile, JSON.stringify(data, null, 2));
        return true;
    } catch (err) {
        console.error(`[ANTIPALAVRA] Erro ao salvar dados do grupo ${groupId}:`, err.message);
        return false;
    }
};

/**
 * Obtém ou inicializa configuração de antipalavra do grupo
 */
const getAntipalavraConfig = (groupData) => {
    if (!groupData.antipalavra) {
        groupData.antipalavra = {
            enabled: false,
            blacklist: [],
            stats: {
                totalBans: 0,
                totalAdvs: 0,
                totalDetections: 0,
                lastUpdate: new Date().toISOString()
            }
        };
    }
    
    // Garante que todos os campos existem
    if (!groupData.antipalavra.blacklist) {
        groupData.antipalavra.blacklist = [];
    }
    if (!groupData.antipalavra.stats) {
        groupData.antipalavra.stats = {
            totalBans: 0,
            totalAdvs: 0,
            totalDetections: 0,
            lastUpdate: new Date().toISOString()
        };
    }
    
    // Migra palavras antigas que não têm ação definida
    groupData.antipalavra.blacklist = groupData.antipalavra.blacklist.map(item => {
        if (!item.acao) {
            item.acao = 'ban'; // Padrão para palavras antigas
        }
        return item;
    });
    
    return groupData.antipalavra;
};

// --- FUNÇÕES DE GERENCIAMENTO DA BLACKLIST ---

/**
 * Ativa o sistema antipalavra no grupo
 */
const enableAntipalavra = (groupId) => {
    const groupData = loadGroupData(groupId);
    const config = getAntipalavraConfig(groupData);
    
    if (config.enabled) {
        return {
            success: false,
            message: '⚠️ O sistema antipalavra já está ativo neste grupo!'
        };
    }
    
    config.enabled = true;
    config.stats.lastUpdate = new Date().toISOString();
    
    if (saveGroupData(groupId, groupData)) {
        return {
            success: true,
            message: '✅ Sistema antipalavra ativado! Use comandos para adicionar palavras à blacklist.'
        };
    }
    
    return {
        success: false,
        message: '❌ Erro ao ativar o sistema antipalavra.'
    };
};

/**
 * Desativa o sistema antipalavra no grupo
 */
const disableAntipalavra = (groupId) => {
    const groupData = loadGroupData(groupId);
    const config = getAntipalavraConfig(groupData);
    
    if (!config.enabled) {
        return {
            success: false,
            message: '⚠️ O sistema antipalavra já está desativado neste grupo!'
        };
    }
    
    config.enabled = false;
    config.stats.lastUpdate = new Date().toISOString();
    
    if (saveGroupData(groupId, groupData)) {
        return {
            success: true,
            message: '✅ Sistema antipalavra desativado! A blacklist foi mantida.'
        };
    }
    
    return {
        success: false,
        message: '❌ Erro ao desativar o sistema antipalavra.'
    };
};

/**
 * Adiciona uma palavra à blacklist com ação específica
 * @param {string} groupId - ID do grupo
 * @param {string} palavra - Palavra a adicionar
 * @param {string} acao - Ação a ser tomada: 'ban' ou 'adv'
 */
const addPalavraBlacklist = (groupId, palavra, acao) => {
    if (!palavra || typeof palavra !== 'string') {
        return {
            success: false,
            message: '❌ Palavra inválida!'
        };
    }
    
    // Valida a ação
    if (!acao || !ACOES_VALIDAS.includes(acao.toLowerCase())) {
        return {
            success: false,
            message: `❌ Ação inválida! Use:\n• ban - Banimento imediato\n• adv - Advertência\n\nExemplo: ${groupPrefix || '/'}antipalavra add spam ban`
        };
    }
    
    const groupData = loadGroupData(groupId);
    const config = getAntipalavraConfig(groupData);
    const palavraNormalizada = normalizeText(palavra);
    const acaoNormalizada = acao.toLowerCase();
    
    if (!palavraNormalizada) {
        return {
            success: false,
            message: '❌ A palavra não pode estar vazia!'
        };
    }
    
    // Verifica se já existe
    const exists = config.blacklist.some(item => 
        normalizeText(item.palavra) === palavraNormalizada
    );
    
    if (exists) {
        return {
            success: false,
            message: '⚠️ Esta palavra já está na blacklist!'
        };
    }
    
    // Adiciona à blacklist com a ação especificada
    config.blacklist.push({
        palavra: palavra.trim(),
        palavraNormalizada: palavraNormalizada,
        acao: acaoNormalizada,
        addedAt: new Date().toISOString(),
        detections: 0
    });
    
    config.stats.lastUpdate = new Date().toISOString();
    
    if (saveGroupData(groupId, groupData)) {
        const acaoTexto = acaoNormalizada === 'ban' ? '🚫 Banimento imediato' : '⚠️ Advertência';
        return {
            success: true,
            message: `✅ Palavra "${palavra}" adicionada!\n📊 Ação: ${acaoTexto}\n📊 Total de palavras: ${config.blacklist.length}`
        };
    }
    
    return {
        success: false,
        message: '❌ Erro ao adicionar palavra à blacklist.'
    };
};

/**
 * Remove uma palavra da blacklist
 */
const removePalavraBlacklist = (groupId, palavra) => {
    if (!palavra || typeof palavra !== 'string') {
        return {
            success: false,
            message: '❌ Palavra inválida!'
        };
    }
    
    const groupData = loadGroupData(groupId);
    const config = getAntipalavraConfig(groupData);
    const palavraNormalizada = normalizeText(palavra);
    
    const initialLength = config.blacklist.length;
    config.blacklist = config.blacklist.filter(item => 
        normalizeText(item.palavra) !== palavraNormalizada
    );
    
    if (config.blacklist.length === initialLength) {
        return {
            success: false,
            message: '⚠️ Esta palavra não está na blacklist!'
        };
    }
    
    config.stats.lastUpdate = new Date().toISOString();
    
    if (saveGroupData(groupId, groupData)) {
        return {
            success: true,
            message: `✅ Palavra "${palavra}" removida da blacklist!\n📊 Total de palavras: ${config.blacklist.length}`
        };
    }
    
    return {
        success: false,
        message: '❌ Erro ao remover palavra da blacklist.'
    };
};

/**
 * Lista todas as palavras da blacklist
 */
const listPalavrasBlacklist = (groupId) => {
    const groupData = loadGroupData(groupId);
    const config = getAntipalavraConfig(groupData);
    
    if (config.blacklist.length === 0) {
        return {
            success: true,
            message: '📋 A blacklist está vazia. Use o comando para adicionar palavras.',
            blacklist: []
        };
    }
    
    // Ordena por número de detecções (maior primeiro)
    const sorted = [...config.blacklist].sort((a, b) => b.detections - a.detections);
    
    let message = `📋 *BLACKLIST DE PALAVRAS*\n`;
    message += `━━━━━━━━━━━━━━━━━━━━━\n`;
    message += `📊 Status: ${config.enabled ? '✅ Ativo' : '❌ Desativado'}\n`;
    message += `🔢 Total de palavras: ${config.blacklist.length}\n`;
    message += `🚫 Total de bans: ${config.stats.totalBans}\n`;
    message += `⚠️ Total de advertências: ${config.stats.totalAdvs}\n`;
    message += `🔍 Total de detecções: ${config.stats.totalDetections}\n`;
    message += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
    
    sorted.forEach((item, index) => {
        const acaoIcone = item.acao === 'ban' ? '🚫' : '⚠️';
        const acaoTexto = item.acao === 'ban' ? 'Ban' : 'Advertência';
        message += `${index + 1}. "${item.palavra}" → ${acaoIcone} ${acaoTexto}\n`;
        message += `   └ 🔍 Detecções: ${item.detections}\n\n`;
    });
    
    return {
        success: true,
        message: message.trim(),
        blacklist: sorted
    };
};

/**
 * Limpa toda a blacklist
 */
const clearBlacklist = (groupId) => {
    const groupData = loadGroupData(groupId);
    const config = getAntipalavraConfig(groupData);
    
    if (config.blacklist.length === 0) {
        return {
            success: false,
            message: '⚠️ A blacklist já está vazia!'
        };
    }
    
    const count = config.blacklist.length;
    config.blacklist = [];
    config.stats.lastUpdate = new Date().toISOString();
    
    if (saveGroupData(groupId, groupData)) {
        return {
            success: true,
            message: `✅ Blacklist limpa! ${count} palavra(s) removida(s).`
        };
    }
    
    return {
        success: false,
        message: '❌ Erro ao limpar blacklist.'
    };
};

// --- VERIFICAÇÃO DE MENSAGENS ---

/**
 * Verifica se uma mensagem contém palavras da blacklist
 * Retorna a primeira palavra detectada com sua ação ou null
 */
const checkMessage = (groupId, messageText) => {
    if (!messageText || typeof messageText !== 'string') {
        return null;
    }
    
    const groupData = loadGroupData(groupId);
    const config = getAntipalavraConfig(groupData);
    
    // Se desativado ou sem palavras, não verifica
    if (!config.enabled || config.blacklist.length === 0) {
        return null;
    }
    
    const messageNormalized = normalizeText(messageText);
    
    // Verifica cada palavra da blacklist
    for (const item of config.blacklist) {
        // Verifica se a palavra existe na mensagem (como palavra completa ou parte de palavra)
        if (messageNormalized.includes(item.palavraNormalizada)) {
            // Incrementa contador de detecções
            item.detections++;
            config.stats.totalDetections++;
            config.stats.lastUpdate = new Date().toISOString();
            saveGroupData(groupId, groupData);
            
            return {
                detected: true,
                palavra: item.palavra,
                palavraOriginal: item.palavra,
                acao: item.acao // 'ban' ou 'adv'
            };
        }
    }
    
    return null;
};

/**
 * Registra um banimento
 */
const registerBan = (groupId, userId, palavra) => {
    const groupData = loadGroupData(groupId);
    const config = getAntipalavraConfig(groupData);
    
    config.stats.totalBans++;
    config.stats.lastUpdate = new Date().toISOString();
    
    // Adiciona ao histórico de bans (opcional, para estatísticas)
    if (!config.banHistory) {
        config.banHistory = [];
    }
    
    config.banHistory.push({
        userId: userId,
        palavra: palavra,
        bannedAt: new Date().toISOString()
    });
    
    // Mantém apenas os últimos 100 bans
    if (config.banHistory.length > 100) {
        config.banHistory = config.banHistory.slice(-100);
    }
    
    saveGroupData(groupId, groupData);
};

/**
 * Registra uma advertência
 */
const registerAdvertencia = (groupId) => {
    const groupData = loadGroupData(groupId);
    const config = getAntipalavraConfig(groupData);
    
    config.stats.totalAdvs++;
    config.stats.lastUpdate = new Date().toISOString();
    
    saveGroupData(groupId, groupData);
};

/**
 * Retorna o caminho do arquivo de dados do grupo
 */
const getGroupFilePath = (groupId) => {
    return path.join(GRUPOS_DIR, `${groupId}.json`);
};

/**
 * Aplica advertência a um usuário (usa o sistema existente de advertências)
 * Retorna o número de advertências atual e se deve banir
 */
const applyAdvertencia = async (groupId, userId, palavra, senderJid, nazu) => {
    const groupFilePath = getGroupFilePath(groupId);
    let groupData = {};
    
    try {
        if (fs.existsSync(groupFilePath)) {
            groupData = JSON.parse(fs.readFileSync(groupFilePath, 'utf8'));
        }
    } catch (err) {
        console.error('[ANTIPALAVRA] Erro ao carregar dados do grupo:', err.message);
    }
    
    groupData.warnings = groupData.warnings || {};
    groupData.warnings[userId] = groupData.warnings[userId] || [];
    
    // Adiciona advertência
    groupData.warnings[userId].push({
        reason: `Palavra proibida: ${palavra}`,
        timestamp: Date.now(),
        issuer: 'sistema-antipalavra'
    });
    
    const warningCount = groupData.warnings[userId].length;
    
    try {
        fs.writeFileSync(groupFilePath, JSON.stringify(groupData, null, 2));
    } catch (err) {
        console.error('[ANTIPALAVRA] Erro ao salvar advertência:', err.message);
    }
    
    // Registra a advertência nas estatísticas do antipalavra
    registerAdvertencia(groupId);
    
    return {
        warningCount,
        shouldBan: warningCount >= 3
    };
};

/**
 * Obtém estatísticas do antipalavra
 */
const getStats = (groupId) => {
    const groupData = loadGroupData(groupId);
    const config = getAntipalavraConfig(groupData);
    
    return {
        enabled: config.enabled,
        totalWords: config.blacklist.length,
        totalBans: config.stats.totalBans || 0,
        totalAdvs: config.stats.totalAdvs || 0,
        totalDetections: config.stats.totalDetections || 0,
        lastUpdate: config.stats.lastUpdate,
        topWords: config.blacklist
            .sort((a, b) => b.detections - a.detections)
            .slice(0, 5)
            .map(item => ({
                palavra: item.palavra,
                acao: item.acao,
                detections: item.detections
            }))
    };
};

/**
 * Verifica se o sistema está ativo
 */
const isActive = (groupId) => {
    const groupData = loadGroupData(groupId);
    const config = getAntipalavraConfig(groupData);
    return config.enabled === true;
};

// --- EXPORTS ---

export {
    enableAntipalavra,
    disableAntipalavra,
    addPalavraBlacklist,
    removePalavraBlacklist,
    listPalavrasBlacklist,
    clearBlacklist,
    checkMessage,
    registerBan,
    registerAdvertencia,
    applyAdvertencia,
    getStats,
    isActive,
    getGroupFilePath
};
