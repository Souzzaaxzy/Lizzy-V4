import { useMultiFileAuthState, DisconnectReason, makeCacheableSignalKeyStore, makeWASocket, fetchLatestBaileysVersion, isJidBroadcast, isJidNewsletter, isJidStatusBroadcast } from 'baileys';
import { Boom } from '@hapi/boom';
import NodeCache from 'node-cache';
import readline from 'readline';
import pino from 'pino';
import fs from 'fs/promises';
import path, { dirname, join } from 'path';
import qrcode from 'qrcode-terminal';
import { readFile } from 'fs/promises';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import axios from 'axios';
import util from 'util';
import PerformanceOptimizer from './utils/performanceOptimizer.js';
import RentalExpirationManager from './utils/rentalExpirationManager.js';
import ElectionManager from './utils/electionManager.js';
import { loadMsgBotOn } from './utils/database.js';
import { buildUserId } from './utils/helpers.js';
// ATENÇÃO: Se o seu arquivo se chama 'index-2(2).js', RENOMEIE PARA 'index.js'
// ou mude o caminho abaixo para './index-2(2).js'
import { handleGroupParticipantsUpdate } from './index.js';
import { initCaptchaIndex, loadCaptchaJson, saveCaptchaJson } from './utils/captchaIndex.js';
import CaptchaIndex from './utils/captchaIndex.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const modules = await import('./funcs/exports.js');
const {
    canvas
} = modules.default;


class MessageQueue {
    constructor(maxWorkers = 4, batchSize = 10, messagesPerBatch = 2) {
        this.queue = [];
        this.maxWorkers = maxWorkers;
        this.batchSize = batchSize;
        this.messagesPerBatch = messagesPerBatch;
        this.activeWorkers = 0;
        this.isProcessing = false;
        this.processingInterval = null;
        this.errorHandler = null;
        this.stats = {
            totalProcessed: 0,
            totalErrors: 0,
            currentQueueLength: 0,
            startTime: Date.now(),
            batchesProcessed: 0,
            avgBatchTime: 0
        };
        this.idCounter = 0; // Contador simples ao invés de crypto.randomUUID()
    }

    setErrorHandler(handler) {
        this.errorHandler = handler;
    }

    async add(message, processor) {
        return new Promise((resolve, reject) => {
            this.queue.push({
                message,
                processor,
                resolve,
                reject,
                timestamp: Date.now(),
                id: `msg_${++this.idCounter}_${Date.now()}`
            });

            this.stats.currentQueueLength = this.queue.length;

            if (!this.isProcessing) {
                this.startProcessing();
            }
        });
    }

    startProcessing() {
        if (this.isProcessing) return;

        this.isProcessing = true;
        // Usa processo recursivo em vez de setInterval para melhor performance
        this.processQueue();
    }

    stopProcessing() {
        this.isProcessing = false;
    }

    resume() {
        if (!this.isProcessing) {
            console.log('[MessageQueue] Retomando processamento');
            this.startProcessing();
        }
    }

    async processQueue() {
        // Processa mensagens em lotes paralelos
        while (this.isProcessing && this.queue.length > 0) {
            // Calcula quantos lotes podemos processar
            const availableBatches = Math.min(
                this.batchSize,
                Math.ceil(this.queue.length / this.messagesPerBatch)
            );

            if (availableBatches === 0) break;

            // Cria array de lotes
            const batches = [];
            for (let i = 0; i < availableBatches && this.queue.length > 0; i++) {
                const batchItems = [];
                for (let j = 0; j < this.messagesPerBatch && this.queue.length > 0; j++) {
                    const item = this.queue.shift();
                    if (item) batchItems.push(item);
                }
                if (batchItems.length > 0) {
                    batches.push(batchItems);
                }
            }

            this.stats.currentQueueLength = this.queue.length;

            // Processa todos os lotes em paralelo
            const batchStartTime = Date.now();
            await Promise.allSettled(
                batches.map(batch => this.processBatch(batch))
            );

            const batchDuration = Date.now() - batchStartTime;
            this.stats.batchesProcessed++;
            this.stats.avgBatchTime =
                (this.stats.avgBatchTime * (this.stats.batchesProcessed - 1) + batchDuration) /
                this.stats.batchesProcessed;
        }

        if (this.queue.length === 0) {
            this.stopProcessing();
        }
    }

    async processBatch(batchItems) {
        // Processa todas as mensagens do lote em paralelo
        const batchPromises = batchItems.map(item => this.processItem(item));

        const results = await Promise.allSettled(batchPromises);

        // Contabiliza resultados
        results.forEach((result, index) => {
            if (result.status === 'fulfilled') {
                this.stats.totalProcessed++;
            } else {
                this.stats.totalErrors++;
            }
        });
    }

    async processItem(item) {
        const { message, processor, resolve } = item;

        try {
            const result = await processor(message);
            resolve(result);
            return result;
        } catch (error) {
             /*
             CORREÇÃO: handleProcessingError já chama item.reject() internamente.
             Chamar reject(error) novamente aqui causava double-reject na mesma Promise,
             gerando UnhandledPromiseRejection que podia derrubar o processo.
             */
            await this.handleProcessingError(item, error);
            // Não relança o erro — o reject já foi feito dentro de handleProcessingError.
        }
    }

    async handleProcessingError(item, error) {
        this.stats.totalErrors++;

        console.error(`❌ Queue processing error for message ${item.id}:`, error.message);

        if (this.errorHandler) {
            try {
                await this.errorHandler(item, error);
            } catch (handlerError) {
                console.error('❌ Error handler failed:', handlerError.message);
            }
        }

        // Chama reject apenas aqui — único ponto de rejeição da Promise.
        item.reject(error);
    }

    getStatus() {
        const uptime = Date.now() - this.stats.startTime;
        return {
            queueLength: this.queue.length,
            activeWorkers: this.activeWorkers,
            maxWorkers: this.maxWorkers,
            batchSize: this.batchSize,
            messagesPerBatch: this.messagesPerBatch,
            isProcessing: this.isProcessing,
            totalProcessed: this.stats.totalProcessed,
            totalErrors: this.stats.totalErrors,
            currentQueueLength: this.stats.currentQueueLength,
            batchesProcessed: this.stats.batchesProcessed,
            avgBatchTime: Math.round(this.stats.avgBatchTime),
            uptime: uptime,
            uptimeFormatted: this.formatUptime(uptime),
            throughput: this.stats.totalProcessed > 0 ?
                (this.stats.totalProcessed / (uptime / 1000)).toFixed(2) : 0,
            errorRate: this.stats.totalProcessed > 0 ?
                ((this.stats.totalErrors / this.stats.totalProcessed) * 100).toFixed(2) : 0
        };
    }

    formatUptime(ms) {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);

        if (hours > 0) {
            return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
        } else if (minutes > 0) {
            return `${minutes}m ${seconds % 60}s`;
        } else {
            return `${seconds}s`;
        }
    }

    clear() {
        // Rejeita todas as mensagens pendentes antes de limpar
        this.queue.forEach(item => {
            if (item.reject) {
                item.reject(new Error('Queue cleared'));
            }
        });
        this.queue = [];
        this.stats.currentQueueLength = 0;
        this.stopProcessing();
    }

    async shutdown() {
        console.log('🛑 Finalizando MessageQueue...');
        this.stopProcessing();

        // Aguarda workers ativos terminarem (timeout de 10s)
        const shutdownTimeout = 10000;
        const startTime = Date.now();

        while (this.activeWorkers > 0 && (Date.now() - startTime) < shutdownTimeout) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        if (this.activeWorkers > 0) {
            console.warn(`⚠️ ${this.activeWorkers} workers ainda ativos após timeout de shutdown`);
        }

        this.clear();
        console.log('✅ MessageQueue finalizado');
    }
}

const messageQueue = new MessageQueue(8, 10, 2); // 8 workers, 10 lotes, 2 mensagens por lote

const configPath = path.join(__dirname, "config.json");
let config;
let DEBUG_MODE = false; // Modo debug para logs detalhados



global.CAPTCHA_LOCK = global.CAPTCHA_LOCK || new Set();


try {
    const configContent = readFileSync(configPath, "utf8");
    config = JSON.parse(configContent);


    if (!config.prefixo || !config.nomebot || !config.numerodono) {
        throw new Error('Configuração inválida: campos obrigatórios ausentes (prefixo, nomebot, numerodono)');
    }


    DEBUG_MODE = config.debug === true || process.env.ABYSS_DEBUG === '1';
    if (DEBUG_MODE) {
        console.log('🐛 Modo DEBUG ativado - Logs detalhados habilitados');
    }
} catch (err) {
    console.error(`❌ Erro ao carregar configuração: ${err.message}`);
    process.exit(1);
}

// NOTA: Se o seu arquivo principal for 'index-2(2).js', renomeie-o para 'index.js'
// ou ajuste o caminho abaixo para o nome correto do seu arquivo.
const indexModule = (await import('./index.js')).default ?? (await import('./index.js'));

const performanceOptimizer = new PerformanceOptimizer();

const {
    prefixo,
    nomebot,
    nomedono,
    numerodono
} = config;

const rentalExpirationManager = new RentalExpirationManager(null, {
    ownerNumber: numerodono,
    ownerName: nomedono,
    checkInterval: '0 */6 * * *',
    warningDays: 3,
    finalWarningDays: 1,
    cleanupDelayHours: 24,
    enableNotifications: true,
    enableAutoCleanup: true,
    logFile: path.join(__dirname, '../logs/rental_expiration.log')
});

const logger = pino({
    level: 'silent'
});

const AUTH_DIR = path.join(__dirname, '..', 'database', 'qr-code');
const DATABASE_DIR = path.join(__dirname, '..', 'database');
const GLOBAL_BLACKLIST_PATH = path.join(__dirname, '..', 'database', 'dono', 'globalBlacklist.json');

 /*
 CORREÇÃO: Cache em memória para a blacklist global.
 Antes, o arquivo era lido do disco em CADA evento de participante, gerando
 centenas de leituras por minuto em grupos ativos e saturando o disco.
 Agora o cache é revalidado apenas a cada 60 segundos.
 */
let _globalBlacklistCache = null;
let _globalBlacklistCacheTime = 0;
const GLOBAL_BLACKLIST_TTL_MS = 60_000;

let msgRetryCounterCache;
let messagesCache;

async function initializeOptimizedCaches(AbyssSock) {
    try {
        await performanceOptimizer.initialize();

        // Inicializa índice de captcha para busca rápida
        const requestCaptchaMsg = async (dataCaptcha) => {
            /*
                Vai receber apenas os ids expirados
            */
            await AbyssSock.sendMessage(dataCaptcha.groupId, { text: `⚠️ @${dataCaptcha.idOrigin.split('@')[0]} não resolveu o captcha a tempo e foi removido.` });
            await AbyssSock.groupParticipantsUpdate(dataCaptcha.groupId, [dataCaptcha.idOrigin], 'remove').catch(() => { });
        };
        await initCaptchaIndex(requestCaptchaMsg);

        msgRetryCounterCache = {
            get: (key) => performanceOptimizer.cacheGet('msgRetry', key),
            set: (key, value, ttl) => performanceOptimizer.cacheSet('msgRetry', key, value, ttl),
            del: (key) => performanceOptimizer.modules.cacheManager?.del('msgRetry', key)
        };

        messagesCache = new Map();

    } catch (error) {
        console.error('❌ Erro ao inicializar sistema de otimização:', error.message);

        msgRetryCounterCache = new NodeCache({
            stdTTL: 5 * 60,
            useClones: false
        });
        messagesCache = new Map();

    }
}
const codeMode = process.argv.includes('--code') || process.env.ABYSS_CODE_MODE === '1';

// Cleanup otimizado do cache de mensagens
let cacheCleanupInterval = null;
const setupMessagesCacheCleanup = () => {
    if (cacheCleanupInterval) clearInterval(cacheCleanupInterval);

    cacheCleanupInterval = setInterval(() => {
        if (!messagesCache || messagesCache.size <= 3000) return;

        const keysToDelete = Math.floor(messagesCache.size * 0.4); // Remove 40% dos mais antigos
        const keys = Array.from(messagesCache.keys()).slice(0, keysToDelete);
        keys.forEach(key => messagesCache.delete(key));

        console.log(`🧹 Cache limpo: ${keysToDelete} mensagens removidas (total: ${messagesCache.size})`);
    }, 300000); // A cada 5 minutos
};

// Inicia cleanup quando o bot conectar
const startCacheCleanup = () => {
    setupMessagesCacheCleanup();
};

const ask = (question) => {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    return new Promise((resolve) => rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim());
    }));
};

async function clearAuthDir(dirToRemove = AUTH_DIR) {
    // Mantém compatibilidade com múltiplas instâncias (ex: sub-bots) e com versões antigas do Node.
    try {
        const normalized = path.resolve(dirToRemove);

        // Guardrails: evita apagar diretórios perigosos.
        const rootPath = path.parse(normalized).root;
        if (normalized === rootPath) {
            console.error(`❌ Abortando limpeza: caminho inválido (${normalized})`);
            return;
        }

        const normalizedParts = normalized.split(path.sep).filter(Boolean);
        const looksLikeAuthDir = normalizedParts.includes('qr-code') || normalizedParts.includes('auth');
        if (!looksLikeAuthDir) {
            console.error(`❌ Abortando limpeza: caminho não parece diretório de auth/qr-code (${normalized})`);
            return;
        }

        if (typeof fs.rm === 'function') {
            await fs.rm(normalized, { recursive: true, force: true });
        } else if (typeof fs.rmdir === 'function') {
            // Node antigo: rmdir recursivo
            await fs.rmdir(normalized, { recursive: true }).catch(() => { });
        } else {
            throw new Error('API de remoção de diretório não disponível (fs.rm/fs.rmdir)');
        }

        console.log(`🗑️ Pasta de autenticação (${normalized}) excluída com sucesso.`);
    } catch (err) {
        console.error(`❌ Erro ao excluir pasta de autenticação (${dirToRemove}): ${err.message}`);
    }
}

async function loadGlobalBlacklist() {
    // Mantido para outras funções do connect.js que podem usar a blacklist
    const now = Date.now();
    if (_globalBlacklistCache !== null && (now - _globalBlacklistCacheTime) < GLOBAL_BLACKLIST_TTL_MS) {
        return _globalBlacklistCache;
    }
    try {
        const data = await fs.readFile(GLOBAL_BLACKLIST_PATH, 'utf-8');
        _globalBlacklistCache = JSON.parse(data).users || {};
        _globalBlacklistCacheTime = now;
        return _globalBlacklistCache;
    } catch (e) {
        console.error(`❌ Erro ao ler blacklist global: ${e.message}`);
        return _globalBlacklistCache ?? {};
    }
}

async function loadGroupSettings(groupId) {
    const groupFilePath = path.join(DATABASE_DIR, 'grupos', `${groupId}.json`);
    try {
        const data = await fs.readFile(groupFilePath, 'utf-8');
        return JSON.parse(data);
    } catch (e) {
        console.error(`❌ Erro ao ler configurações do grupo ${groupId}: ${e.message}`);
        return {};
    }
}

// NOTA: formatMessageText e createGroupMessage foram removidas 
// daqui pois agora estão centralizadas no index.js para evitar duplicidade.
// loadGroupSettings foi mantida pois é usada pelo handleGroupJoinRequest abaixo.





// A função handleGroupParticipantsUpdate foi removida daqui e agora é importada 
// diretamente do index.js para garantir que as correções de boas-vindas 
// e mensagens de saída funcionem corretamente e de forma centralizada.






export async function saveGroupSettings(groupId, settings) {
    try {

        const safeId = groupId.replace(/[^a-zA-Z0-9]/g, '_');


        const dirPath = path.join(__dirname, 'database', 'groups');
        const filePath = path.join(dirPath, `${safeId}.json`);


        await fs.mkdir(dirPath, { recursive: true });


        const data = JSON.stringify(settings, null, 2);

        await fs.writeFile(filePath, data, 'utf-8');

        if (global.DEBUG_MODE) {
            console.log(`📝 [Settings] Configurações de ${groupId} atualizadas.`);
        }
    } catch (error) {
        console.error(`❌ Erro ao salvar settings de ${groupId}:`, error);
    }
}
async function handleGroupJoinRequest(AbyssSock, inf) {
    try {
        const typeIds = { id: '', lid: '', participant: '' };
        const from = inf.id;
        let participantJid = inf.participantPn || inf.participant;

        if (!from || !participantJid) return;


        if (typeof participantJid === "object") {
            Object.assign(typeIds, {
                id: participantJid?.pn?.endsWith("s.whatsapp.net") ? participantJid?.pn : '',
                lid: participantJid?.pn?.endsWith("lid") ? participantJid?.pn : participantJid?.lid,
            });
            participantJid = participantJid.pn || participantJid.lid;
        } else {
            typeIds.lid = participantJid.endsWith("lid") ? participantJid : '';
            typeIds.id = participantJid.endsWith("s.whatsapp.net") ? participantJid : '';
        }

        typeIds.participant = participantJid;


        global.CAPTCHA_LOCK.add(participantJid);

        if (typeIds.lid) {
            global.CAPTCHA_LOCK.add(typeIds.lid);

        }
        if (typeIds.id) {
            global.CAPTCHA_LOCK.add(typeIds.id);

        }

        const groupSettings = await loadGroupSettings(from);


        if (groupSettings.autoAcceptRequests) {
            if (DEBUG_MODE) console.log(`[Auto-Accept] Aceitando ${participantJid} no grupo ${from}`);
            await AbyssSock.groupRequestParticipantsUpdate(from, [participantJid], 'approve');
            if (!groupSettings.captchaEnabled) return;
        }


        if (groupSettings.captchaEnabled) {

            const num1 = Math.floor(Math.random() * 10) + 1;
            const num2 = Math.floor(Math.random() * 10) + 1;
            const answer = num1 + num2;
            const timeAt = 5 * 60 * 1000;
            const expiresAt = Date.now() + timeAt;

            const numero = participantJid.split('@')[0];

            const foto = await AbyssSock.profilePictureUrl(participantJid, 'image')
                .catch(() => 'sem foto');

            const waInfo = await AbyssSock.onWhatsApp(participantJid)
                .catch(() => null);

            let nome = inf.participant;
            try {
                nome = await AbyssSock.getName(participantJid);
            } catch { }

            const metadata = await AbyssSock.groupMetadata(from).catch(() => null);
            const participanteMeta = metadata?.participants?.find(p => p.id === participantJid);



            CaptchaIndex.add(typeIds, from, answer, expiresAt, nome);

            await AbyssSock.sendMessage(from, {
                text: `🔐 *VERIFICAÇÃO DE SEGURANÇA*\n\n🌌 Viajante @${numero}!\n\nPara confirmar que não é uma sombra, resolva:\n❓ *${num1} + ${num2} = ?*\n\n⏱️ Você tem 5 minutos ou será removido.`,
                mentions: [participantJid]
            });
        }

    } catch (error) {
        console.error(`❌ Erro em handleGroupJoinRequest: ${error.message}`);
    }
}

const isValidJid = (str) => /^\d+@s\.whatsapp\.net$/.test(str);
const isValidLid = (str) => /^[a-zA-Z0-9_]+@lid$/.test(str);
const isValidUserId = (str) => isValidJid(str) || isValidLid(str);

/**
 * Validates if a participant object has a valid ID and extracts the ID
 * @param {object|string} participant - The participant object or string to validate
 * @returns {string|boolean} - The participant ID if valid, false otherwise
 */
function isValidParticipant(participant) {
    // If participant is already a string, validate it directly
    if (typeof participant === 'string') {
        if (participant.trim().length === 0) return false;
        return participant;
    }

    // If participant is an object with id property
    if (participant && typeof participant === 'object' && participant.hasOwnProperty('id')) {
        const id = participant.id;
        if (id === null || id === undefined || id === '') return false;
        if (typeof id === 'string' && id.trim().length === 0) return false;
        if (id === 0) return false;

        return id;
    }

    return false;
}

function collectJidsFromJson(obj, jidsSet = new Set()) {
    if (Array.isArray(obj)) {
        obj.forEach(item => collectJidsFromJson(item, jidsSet));
    } else if (obj && typeof obj === 'object') {
        Object.values(obj).forEach(value => collectJidsFromJson(value, jidsSet));
    } else if (typeof obj === 'string' && isValidJid(obj)) {
        jidsSet.add(obj);
    }
    return jidsSet;
}

function replaceJidsInJson(obj, jidToLidMap, orphanJidsSet, replacementsCount = { count: 0 }, removalsCount = { count: 0 }) {
    if (Array.isArray(obj)) {
        obj.forEach((item, index) => {
            const newItem = replaceJidsInJson(item, jidToLidMap, orphanJidsSet, replacementsCount, removalsCount);
            if (newItem !== item) obj[index] = newItem;
        });
    } else if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        Object.keys(obj).forEach(key => {
            const value = obj[key];
            if (typeof value === 'string' && isValidJid(value)) {
                if (jidToLidMap.has(value)) {
                    obj[key] = jidToLidMap.get(value);
                    replacementsCount.count++;
                } else if (orphanJidsSet.has(value)) {
                    delete obj[key];
                    removalsCount.count++;
                }
            } else {
                const newValue = replaceJidsInJson(value, jidToLidMap, orphanJidsSet, replacementsCount, removalsCount);
                if (newValue !== value) obj[key] = newValue;
            }
        });
    } else if (typeof obj === 'string' && isValidJid(obj)) {
        if (jidToLidMap.has(obj)) {
            replacementsCount.count++;
            return jidToLidMap.get(obj);
        } else if (orphanJidsSet.has(obj)) {
            removalsCount.count++;
            return null;
        }
    }
    return obj;
}

async function scanForJids(directory) {
    const uniqueJids = new Set();
    const affectedFiles = new Map();
    const jidFiles = new Map();

    const scanFileContent = async (filePath) => {
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const jsonObj = JSON.parse(content);
            const fileJids = collectJidsFromJson(jsonObj);
            if (fileJids.size > 0) {
                affectedFiles.set(filePath, Array.from(fileJids));
                fileJids.forEach(jid => uniqueJids.add(jid));
            }
        } catch (parseErr) {
            console.warn(`⚠️ Arquivo ${filePath} não é JSON válido. Usando fallback regex.`);
            const jidPattern = /(\d+@s\.whatsapp\.net)/g;
            const content = await fs.readFile(filePath, 'utf-8');
            let match;
            const fileJids = new Set();
            while ((match = jidPattern.exec(content)) !== null) {
                const jid = match[1];
                uniqueJids.add(jid);
                fileJids.add(jid);
            }
            if (fileJids.size > 0) {
                affectedFiles.set(filePath, Array.from(fileJids));
            }
        }
    };

    const checkAndScanFilename = async (fullPath) => {
        try {
            const basename = path.basename(fullPath, '.json');
            const filenameMatch = basename.match(/(\d+@s\.whatsapp\.net)/);
            if (filenameMatch) {
                const jidFromName = filenameMatch[1];
                if (isValidJid(jidFromName)) {
                    uniqueJids.add(jidFromName);
                    jidFiles.set(jidFromName, fullPath);
                }
            }
            await scanFileContent(fullPath);
        } catch (err) {
            console.error(`Erro ao processar ${fullPath}: ${err.message}`);
        }
    };

    const scanDir = async (dirPath) => {
        try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = join(dirPath, entry.name);
                if (entry.isDirectory()) {
                    await scanDir(fullPath);
                } else if (entry.name.endsWith('.json')) {
                    await checkAndScanFilename(fullPath);
                }
            }
        } catch (err) {
            console.error(`Erro ao escanear diretório ${dirPath}: ${err.message}`);
        }
    };

    await scanDir(directory);

    try {
        await scanFileContent(configPath);
        const configBasename = path.basename(configPath, '.json');
        const filenameMatch = configBasename.match(/(\d+@s\.whatsapp\.net)/);
        if (filenameMatch) {
            const jidFromName = filenameMatch[1];
            if (isValidJid(jidFromName)) {
                uniqueJids.add(jidFromName);
                jidFiles.set(jidFromName, configPath);
            }
        }
    } catch (err) {
        console.error(`Erro ao escanear config.json: ${err.message}`);
    }

    return {
        uniqueJids: Array.from(uniqueJids),
        affectedFiles: Array.from(affectedFiles.entries()),
        jidFiles: Array.from(jidFiles.entries())
    };
}

async function replaceJidsInContent(affectedFiles, jidToLidMap, orphanJidsSet) {
    let totalReplacements = 0;
    let totalRemovals = 0;
    const updatedFiles = [];

    for (const [filePath, jids] of affectedFiles) {
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            let jsonObj = JSON.parse(content);
            const replacementsCount = { count: 0 };
            const removalsCount = { count: 0 };
            replaceJidsInJson(jsonObj, jidToLidMap, orphanJidsSet, replacementsCount, removalsCount);
            if (replacementsCount.count > 0 || removalsCount.count > 0) {
                const updatedContent = JSON.stringify(jsonObj, null, 2);
                await fs.writeFile(filePath, updatedContent, 'utf-8');
                totalReplacements += replacementsCount.count;
                totalRemovals += removalsCount.count;
                updatedFiles.push(path.basename(filePath));
            }
        } catch (err) {
            console.error(`Erro ao substituir em ${filePath}: ${err.message}`);
        }
    }

    return { totalReplacements, totalRemovals, updatedFiles };
}

async function handleJidFiles(jidFiles, jidToLidMap, orphanJidsSet) {
    let totalReplacements = 0;
    let totalRemovals = 0;
    const updatedFiles = [];
    const renamedFiles = [];
    const deletedFiles = [];

    for (const [jid, oldPath] of jidFiles) {
        if (orphanJidsSet.has(jid)) {
            try {
                await fs.unlink(oldPath);
                deletedFiles.push(path.basename(oldPath));
                totalRemovals++;
                continue;
            } catch (err) {
                console.error(`Erro ao excluir arquivo órfão ${oldPath}: ${err.message}`);
            }
        }

        const lid = jidToLidMap.get(jid);
        if (!lid) {
            continue;
        }

        try {
            const content = await fs.readFile(oldPath, 'utf-8');
            let jsonObj = JSON.parse(content);
            const replacementsCount = { count: 0 };
            const removalsCount = { count: 0 };
            replaceJidsInJson(jsonObj, jidToLidMap, orphanJidsSet, replacementsCount, removalsCount);
            totalReplacements += replacementsCount.count;
            totalRemovals += removalsCount.count;

            const dir = path.dirname(oldPath);
            const newPath = join(dir, `${lid}.json`);

            try {
                await fs.access(newPath);
                continue;
            } catch { }

            const updatedContent = JSON.stringify(jsonObj, null, 2);
            await fs.writeFile(newPath, updatedContent, 'utf-8');
            await fs.unlink(oldPath);

            updatedFiles.push(path.basename(newPath));
            renamedFiles.push({ old: path.basename(oldPath), new: path.basename(newPath) });

        } catch (err) {
            console.error(`Erro ao processar renomeação de ${oldPath}: ${err.message}`);
        }
    }

    return { totalReplacements, totalRemovals, updatedFiles, renamedFiles, deletedFiles };
}

async function fetchLidWithRetry(AbyssSock, jid, maxRetries = 3) {
    if (!jid || !isValidJid(jid)) {
        console.warn(`⚠️ JID inválido fornecido: ${jid}`);
        return null;
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const result = await AbyssSock.onWhatsApp(jid);
            if (result && result[0] && result[0].lid) {
                return { jid, lid: result[0].lid };
            }
            return null;
        } catch (err) {
            if (attempt === maxRetries) {
                console.warn(`⚠️ Falha ao buscar LID para ${jid} após ${maxRetries} tentativas`);
            }
        }
        if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 100 * attempt));
        }
    }
    return null;
}

async function fetchLidsInBatches(AbyssSock, uniqueJids, batchSize = 5) {
    const lidResults = [];
    const jidToLidMap = new Map();
    let successfulFetches = 0;

    for (let i = 0; i < uniqueJids.length; i += batchSize) {
        const batch = uniqueJids.slice(i, i + batchSize);

        const batchPromises = batch.map(jid => fetchLidWithRetry(AbyssSock, jid));
        const batchResults = await Promise.allSettled(batchPromises);

        batchResults.forEach((result, index) => {
            if (result.status === 'fulfilled' && result.value) {
                const { jid, lid } = result.value;
                lidResults.push({ jid, lid });
                jidToLidMap.set(jid, lid);
                successfulFetches++;
            }
        });

        if (i + batchSize < uniqueJids.length) {
            await new Promise(resolve => setTimeout(resolve, 200));
        }
    }

    return { lidResults, jidToLidMap, successfulFetches };
}

async function updateOwnerLid(AbyssSock) {
    const ownerJid = `${numerodono}@s.whatsapp.net`;
    try {
        const result = await fetchLidWithRetry(AbyssSock, ownerJid);
        if (result) {
            config.lidowner = result.lid;
            await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
        }
    } catch (err) {
        console.error(`❌ Erro ao atualizar LID do dono: ${err.message}`);
    }
}

async function performMigration(AbyssSock) {
    let scanResult;
    try {
        scanResult = await scanForJids(DATABASE_DIR);
    } catch (err) {
        console.error(`Erro crítico no scan: ${err.message}`);
        return;
    }

    const { uniqueJids, affectedFiles, jidFiles } = scanResult;

    if (uniqueJids.length === 0) {
        return;
    }

    const { jidToLidMap, successfulFetches } = await fetchLidsInBatches(AbyssSock, uniqueJids);
    const orphanJidsSet = new Set(uniqueJids.filter(jid => !jidToLidMap.has(jid)));

    if (jidToLidMap.size === 0) {
        return;
    }

    let totalReplacements = 0;
    let totalRemovals = 0;
    const allUpdatedFiles = [];

    try {
        const renameResult = await handleJidFiles(jidFiles, jidToLidMap, orphanJidsSet);
        totalReplacements += renameResult.totalReplacements;
        totalRemovals += renameResult.totalRemovals;
        allUpdatedFiles.push(...renameResult.updatedFiles);

        const filteredAffected = affectedFiles.filter(([filePath]) => !jidFiles.some(([, jidPath]) => jidPath === filePath));
        const contentResult = await replaceJidsInContent(filteredAffected, jidToLidMap, orphanJidsSet);
        totalReplacements += contentResult.totalReplacements;
        totalRemovals += contentResult.totalRemovals;
        allUpdatedFiles.push(...contentResult.updatedFiles);
    } catch (processErr) {
        console.error(`Erro no processamento de substituições: ${processErr.message}`);
        return;
    }

}

// Variáveis de controle de reconexão (declaradas aqui para evitar temporal dead zone)
let reconnectAttempts = 0;
let isReconnecting = false; // Flag para evitar múltiplas reconexões simultâneas
let reconnectTimer = null; // Timer de reconexão para poder cancelar
let forbidden403Attempts = 0; // Contador específico para erro 403
const MAX_RECONNECT_ATTEMPTS = 10;
const MAX_403_ATTEMPTS = 3; // Máximo de 3 tentativas para erro 403
const RECONNECT_DELAY_BASE = 5000; // 5 segundos base

// CORREÇÃO: Timers do evento 'open' agora têm referência para serem cancelados
// caso o bot desconecte antes deles dispararem, evitando timers órfãos usando socket antigo.
let ownerMsgTimer = null;
let subBotInitTimer = null;
// fetchLatestBaileysVersion() faz uma requisição HTTP — se a rede estava instável
// (causa da desconexão), essa chamada podia falhar e impedir a reconexão.
let _cachedWAVersion = null;

async function getWAVersion() {
    if (_cachedWAVersion) return _cachedWAVersion;
    const { version } = await fetchLatestBaileysVersion();
    _cachedWAVersion = version;
    return version;
}

async function createBotSocket(authDir) {
    try {
        await fs.mkdir(path.join(DATABASE_DIR, 'grupos'), { recursive: true });
        await fs.mkdir(authDir, { recursive: true });
        const {
            state,
            saveCreds,
            signalRepository
        } = await useMultiFileAuthState(authDir, makeCacheableSignalKeyStore);

        // CORREÇÃO: Usa versão cacheada em vez de buscar na rede a cada reconexão.
        const version = await getWAVersion();
        console.log(`📱 Usando versão do WhatsApp: ${version.join('.')}`);

        const AbyssSock = makeWASocket({
            version: version,
            emitOwnEvents: true,
            fireInitQueries: true,
            generateHighQualityLinkPreview: true,
            syncFullHistory: false,
            markOnlineOnConnect: true,
            connectTimeoutMs: 120000,
            retryRequestDelayMs: 5000,
            qrTimeout: 180000,
            keepAliveIntervalMs: 30_000,
             /*
             CORREÇÃO: defaultQueryTimeoutMs era undefined (sem timeout), causando acúmulo
             de Promises pendentes que nunca resolviam, vazando memória ao longo do tempo.
             60 segundos é suficiente para qualquer query normal do WhatsApp.
             */
            defaultQueryTimeoutMs: 60_000,
            maxMsgRetryCount: 5,
            shouldIgnoreJid: (jid) =>
                isJidBroadcast(jid) || isJidStatusBroadcast(jid) || isJidNewsletter(jid),
            shouldSyncHistoryMessage: () => false,
            msgRetryCounterCache,
            auth: state,
            signalRepository,
            logger
        });

        if (codeMode && !AbyssSock.authState.creds.registered) {
            console.log('📱 Insira o número de telefone (com código de país, ex: +5511912345678 ou +554112345678): ');
            let phoneNumber = await ask('--> ');
            phoneNumber = phoneNumber.replace(/\D/g, '');
            if (!/^\d{10,15}$/.test(phoneNumber)) {
                console.log('⚠️ Número inválido! Use um número válido com código de país (ex: 551199999999).');
                process.exit(1);
            }
            const rawCode = await AbyssSock.requestPairingCode(phoneNumber);
            const formattedCode = rawCode?.match(/.{1,4}/g)?.join('-') || rawCode;
            console.log(`🔑 Código de pareamento: ${formattedCode}`);
            console.log('📲 Envie este código no WhatsApp para autenticar o bot.');
        }

        AbyssSock.ev.on('creds.update', saveCreds);

        AbyssSock.ev.on('groups.update', async (updates) => {
            if (!Array.isArray(updates) || updates.length === 0) return;

            if (DEBUG_MODE) {
                console.log('\n🐛 ========== GROUPS UPDATE ==========');
                console.log('📅 Timestamp:', new Date().toISOString());
                console.log('📊 Number of updates:', updates.length);

                updates.forEach((update, index) => {
                    console.log(`\n--- Update ${index + 1} ---`);
                    console.log('📦 Update data:', JSON.stringify(update, null, 2));
                });

                console.log('🐛 ====================================\n');
            }

            const updatePromises = updates.map(async (ev) => {
                if (!ev || !ev.id) return;

                try {
                    const groupId = ev.id;

                    // 🔹 Buscar config do grupo (se você tiver banco/json)
                    const groupData = await getGroupData(groupId).catch(() => null);

                    if (!groupData?.x9) return; // X9 desligado

                    let mensagem = null;

                    // 📸 FOTO ALTERADA
                    if (ev.imgUrl || ev.picUrl) {
                        mensagem = `📸 *X9 Report:* A foto do grupo foi alterada!`;
                        console.log('[DEBUG] Foto alterada detectada');
                    }

                    // 📝 NOME ALTERADO
                    else if (ev.subject) {
                        mensagem = `📝 *X9 Report:* Nome do grupo alterado para:\n*${ev.subject}*`;
                        console.log('[DEBUG] Nome alterado:', ev.subject);
                    }

                    // 📜 DESCRIÇÃO ALTERADA
                    else if (ev.desc) {
                        mensagem = `📜 *X9 Report:* Descrição do grupo foi alterada!`;
                        console.log('[DEBUG] Descrição alterada');
                    }

                    if (mensagem) {
                        await AbyssSock.sendMessage(groupId, {
                            text: mensagem
                        }).catch(err => {
                            console.error(`❌ Erro ao enviar X9: ${err.message}`);
                        });
                    }

                    // 🔹 Atualiza metadata (opcional)
                    if (DEBUG_MODE) {
                        const meta = await AbyssSock.groupMetadata(groupId).catch(() => null);
                        if (meta) {
                            console.log('🐛 Metadata atualizado para:', groupId);
                        }
                    }

                } catch (e) {
//                    console.error(`❌ Erro no groups.update (${ev.id}): ${e.message}`);
                }
            });

            await Promise.allSettled(updatePromises);
        });



        // Listener para solicitações de entrada em grupos (join requests)
        AbyssSock.ev.on('group.join-request', async (inf) => {
            if (DEBUG_MODE) {
                console.log('\n🐛 ========== GROUP JOIN REQUEST ==========');
                console.log('📅 Timestamp:', new Date().toISOString());
                console.log('🆔 Group ID:', inf.id);
                console.log('⚡ Action:', inf.action);
                console.log('👤 Participant:', inf.participant);
                console.log('📱 Participant Phone:', inf.participantPn);
                console.log('👮 Author:', inf.author);
                console.log('📝 Method:', inf.method);
                console.log('📦 Full event data:', JSON.stringify(inf, null, 2));
                console.log('🐛 ===========================================\n');
            }
            await handleGroupJoinRequest(AbyssSock, inf);
        });



        AbyssSock.ev.on('group-participants.update', async (inf) => {
            console.log(`[SOCKET EVENT] group-participants.update disparado: ${inf.action} em ${inf.id}`);
            if (DEBUG_MODE) {
                console.log('\n🐛 ========== GROUP PARTICIPANTS UPDATE ==========');
                console.log('📅 Timestamp:', new Date().toISOString());
                console.log('🆔 Group ID:', inf.id || inf.jid || 'unknown');
                console.log('⚡ Action:', inf.action);
                console.log('👥 Participants:', inf.participants);
                console.log(' Author:', inf.author || 'N/A');
                console.log('🐛 ================================================\n');
            }
            
            // Garante que o ID correto seja passado se estiver em 'jid'
            const updateData = {
                id: inf.id || inf.jid,
                participants: inf.participants,
                action: inf.action
            };

            // Chama o handler centralizado do index.js que corrigimos
            if (typeof handleGroupParticipantsUpdate === 'function') {
                await handleGroupParticipantsUpdate(AbyssSock, updateData);
            } else {
                console.error('\x1b[31m[ERRO CRÍTICO]\x1b[0m handleGroupParticipantsUpdate não foi importado corretamente de index.js');
            }
        });

        let messagesListenerAttached = false;

        const queueErrorHandler = async (item, error) => {
            console.error(`❌ Critical error processing message ${item.id}:`, error);

            if (error.message.includes('ENOSPC') || error.message.includes('ENOMEM')) {
                console.error('🚨 Critical system error detected, triggering emergency cleanup...');
                try {
                    await performanceOptimizer.emergencyCleanup();
                } catch (cleanupErr) {
                    console.error('❌ Emergency cleanup failed:', cleanupErr.message);
                }
            }

            console.error({
                messageId: item.id,
                errorType: error.constructor.name,
                errorMessage: error.message,
                stack: error.stack,
                messageTimestamp: item.timestamp,
                queueStatus: messageQueue.getStatus()
            });
        };

        messageQueue.setErrorHandler(queueErrorHandler);

        const processMessage = async (info) => {

            const isJoinRequest = info?.messageStubType === 172;


            if (isJoinRequest) {

                info.message = {
                    messageStubType: info.messageStubType,
                    messageStubParameters: info.messageStubParameters
                };
            }

            if (!info || !info.message || !info.key?.remoteJid) {
                return;
            }


            if (messagesCache && info.key?.id && info.key?.remoteJid) {

                const cacheKey = `${info.key.remoteJid}_${info.key.id}`;
                messagesCache.set(cacheKey, info);
            }


            if (typeof indexModule === 'function') {
                await indexModule(AbyssSock, info, null, messagesCache, rentalExpirationManager);
            } else {
                throw new Error('Módulo index.js não é uma função válida. Verifique o arquivo index.js.');
            }
        };

        const attachMessagesListener = () => {
            if (messagesListenerAttached) return;
            messagesListenerAttached = true;

            AbyssSock.ev.on('messages.upsert', async (m) => {
                if (!m.messages || !Array.isArray(m.messages)) return;


                if (m.type === 'append') {
                    const isJoinRequest = m.messages.some(info => info?.messageStubType === 172);
                    if (!isJoinRequest) return;
                }


                if (m.type !== 'notify' && m.type !== 'append') return;

                try {

                    const messageProcessingPromises = m.messages.map(info =>
                        messageQueue.add(info, processMessage).catch(err => {
                            console.error(`❌ Failed to queue message ${info.key?.id}: ${err.message}`);
                        })
                    );

                    await Promise.allSettled(messageProcessingPromises);

                } catch (err) {
                    console.error(`❌ Error in message upsert handler: ${err.message}`);

                    if (err.message.includes('ENOSPC') || err.message.includes('ENOMEM')) {
                        console.error('🚨 Critical system error detected, triggering emergency cleanup...');
                        try {
                            await performanceOptimizer.emergencyCleanup();
                        } catch (cleanupErr) {
                            console.error('❌ Emergency cleanup failed:', cleanupErr.message);
                        }
                    }
                }
            });

            AbyssSock.ev.on('messages.update', async (updates) => {
                for (const update of updates) {
                    // Mensagens deletadas (messageStubType: 1)
                    if (update.update.message === null && update.update.messageStubType === 1) {
                        try {
                            const groupId = update.key.remoteJid;
                            const senderId = update.key.participant || groupId;
                            
                            if (!groupId || !groupId.endsWith('@g.us')) continue;
                            
                            const fs = await import('fs');
                            
                            const normId = groupId.replace(/@g.us$/, '@g.us');
                            if (!normId) continue;
                            
                            const filePath = `./database/grupos/${normId}.json`;
                            if (!fs.existsSync(filePath)) {
                                fs.writeFileSync(filePath, JSON.stringify({}, null, 2));
                            }
                            
                            let groupData = {};
                            try {
                                const content = fs.readFileSync(filePath, 'utf-8');
                                groupData = JSON.parse(content);
                            } catch (e) { continue; }
                            
                            groupData.contador = groupData.contador || [];
                            const userIndex = groupData.contador.findIndex(u => u.id === senderId);
                            
                            if (userIndex !== -1) {
                                groupData.contador[userIndex].apagadas = (groupData.contador[userIndex].apagadas || 0) + 1;
                            } else {
                                groupData.contador.push({ id: senderId, msg: 0, cmd: 0, figu: 0, apagadas: 1, pushname: 'Usuário', firstSeen: new Date().toISOString(), lastActivity: new Date().toISOString() });
                            }
                            
                            fs.writeFileSync(filePath, JSON.stringify(groupData, null, 2));
                            console.log(`[DELETED] Msg apagada por ${senderId}`);
                        } catch (e) {
                            console.error('[DELETED] Erro:', e);
                        }
                        continue;
                    }
                    
                    if (update.update.pollUpdates) {
                        const pollUpdate = update.update.pollUpdates[0];
                        const pollMsgId = update.key.id;
                        const groupId = update.key.remoteJid;

                        try {
                            if (!global.pollVotes) global.pollVotes = {};
                            if (!global.pollVotes[pollMsgId]) global.pollVotes[pollMsgId] = {};

                            const voter = pollUpdate.pollUpdateMessageKey.participant || pollUpdate.pollUpdateMessageKey.remoteJid;
                            const voteNames = pollUpdate.vote?.selectedOptions?.map(opt => opt.name || opt) || [];

                            if (voteNames.length > 0) {
                                global.pollVotes[pollMsgId][voter] = voteNames;
                            } else {
                                delete global.pollVotes[pollMsgId][voter];
                            }

                            const { loadElections, saveElections } = await import('./utils/database.js');
                            const elections = loadElections();
                            const election = elections.find(e => e.groupId === groupId && e.pollMsgId === pollMsgId);

                            if (election && election.status === 'votacao') {
                                election.voters[voter] = true;
                                saveElections(elections);
                            }
                        } catch (e) {
                            console.error('Erro ao processar voto:', e);
                        }
                    }
                }
            });

            AbyssSock.ev.on('messages.upsert', async (m) => {
                if (m.type !== 'notify') return;
                for (const info of m.messages) {
                    const type = Object.keys(info.message || {})[0];
                    if (type === 'reactionMessage') {
                        const reaction = info.message.reactionMessage;
                        const targetId = reaction.key.id;
                        const emoji = reaction.text;
                        const voter = info.key.participant || info.key.remoteJid;
                        const groupId = info.key.remoteJid;

                        try {
                            const { loadElections, saveElections } = await import('./utils/database.js');
                            const elections = loadElections();
                            const election = elections.find(e => e.groupId === groupId && e.pollMsgId === targetId);

                            if (election && election.status === 'votacao') {
                                if (!election.reactionVotes) election.reactionVotes = {};
                                if (emoji) {
                                    election.reactionVotes[voter] = emoji;
                                } else {
                                    delete election.reactionVotes[voter];
                                }
                                saveElections(elections);
                            }
                        } catch (e) {
                            console.error('Erro ao processar reação de voto:', e);
                        }
                    }
                }
            });

            // Handler para detectar mensagens apagadas
            AbyssSock.ev.on('messages.delete', async (keys) => {
                console.log('[DEBUG DELETE] Evento messages.delete recebido:', JSON.stringify(keys));
                try {
                    for (const key of keys) {
                        console.log('[DEBUG DELETE] Processando key:', JSON.stringify(key));
                        const groupId = key.remoteJid;
                        const senderId = key.participant || key.remoteJid;
                        
                        // Ignorar se não for grupo ou se for o próprio bot
                        if (!groupId || !groupId.endsWith('@g.us')) continue;
                        if (senderId === AbyssSock.user?.id) continue;
                        
                        const { 
                            normalizeGroupId, 
                            buildGroupFilePath, 
                            writeJsonFile 
                        } = await import('./utils/paths.js');
                        const fs = await import('fs');
                        
                        const normId = groupId.replace(/@g.us$/, '@g.us');
                        if (!normId) continue;
                        
                        const filePath = `./database/grupos/${normId}.json`;
                        
                        // Criar arquivo se não existir
                        if (!fs.existsSync(filePath)) {
                            fs.writeFileSync(filePath, JSON.stringify({}, null, 2));
                        }
                        
                        let groupData = {};
                        try {
                            const content = fs.readFileSync(filePath, 'utf-8');
                            groupData = JSON.parse(content);
                        } catch (e) {
                            groupData = {};
                        }
                        
                        // Inicializar contador se não existir
                        groupData.contador = groupData.contador || [];
                        const userIndex = groupData.contador.findIndex(u => u.id === senderId);
                        
                        if (userIndex !== -1) {
                            // Usuário existe, incrementar apagadas
                            if (!groupData.contador[userIndex].apagadas) {
                                groupData.contador[userIndex].apagadas = 0;
                            }
                            groupData.contador[userIndex].apagadas++;
                        } else {
                            // Criar entrada para o usuário
                            groupData.contador.push({
                                id: senderId,
                                msg: 0,
                                cmd: 0,
                                figu: 0,
                                apagadas: 1,
                                pushname: 'Usuário',
                                firstSeen: new Date().toISOString(),
                                lastActivity: new Date().toISOString()
                            });
                        }
                        
                        fs.writeFileSync(filePath, JSON.stringify(groupData, null, 2));
                        console.log(`[DELETED] Mensagem apagada por ${senderId} em ${groupId}`);
                    }
                } catch (e) {
                    console.error('[DELETED] Erro ao processar mensagem deletada:', e);
                }
            });
        };

        AbyssSock.ev.on('connection.update', async (update) => {
            const {
                connection,
                lastDisconnect,
                qr
            } = update;
            if (qr && !AbyssSock.authState.creds.registered && !codeMode) {
                console.log('🔗 🌌 QR do Void gerado para autenticação:');
                qrcode.generate(qr, {
                    small: true
                }, (qrcodeText) => {
                    console.log(qrcodeText);
                });
                console.log('📱 ◈ Escaneie o QR nas sombras acima com o WhatsApp para autenticar o bot.');
            }
            if (connection === 'open') {
                 /*
                 CORREÇÃO: Todo o bloco de inicialização envolto em try/catch.
                 Antes, se qualquer await aqui falhasse (ex: initializeOptimizedCaches,
                 rentalExpirationManager.initialize), o erro era swallowed silenciosamente
                 pelo Baileys (async void) e o bot ficava num estado inconsistente sem reconectar.
                 */
                try {
                 /*
                 CORREÇÃO: Reset dos contadores de tentativa feito aqui, após conexão confirmada.
                 Antes era feito no início de startNazu() — antes de qualquer sucesso —
                 fazendo o limite MAX_RECONNECT_ATTEMPTS nunca ser atingido de fato.
                 */
                reconnectAttempts = 0;
                forbidden403Attempts = 0;
                console.log(`🔄 Conexão aberta. Inicializando sistema de otimização...`);

                    await initializeOptimizedCaches(AbyssSock);

                    await updateOwnerLid(AbyssSock);

                     /*
                     CORREÇÃO: performMigration é adiado para DEPOIS da inicialização completa.
                     Antes era await direto aqui — o scan do filesystem + chamadas AbyssSock.onWhatsApp()
                     podiam levar dezenas de segundos, fazendo o keepalive (30s) expirar e
                     o WhatsApp fechar a conexão por inatividade logo após a abertura.
                     */
                     setTimeout(() => {
                        performMigration(AbyssSock).catch(err => {
                            console.error('❌ Erro na migração (não-bloqueante):', err.message);
                        });
                    }, 10_000);

                    rentalExpirationManager.nazu = AbyssSock;
                    await rentalExpirationManager.initialize();

                    const electionManager = new ElectionManager(AbyssSock);
                    await electionManager.initialize();

                    attachMessagesListener();
                    startCacheCleanup(); // Inicia o sistema de limpeza de cache

                    // Envia mensagem de boas-vindas para o dono
                    try {
                        const msgBotOnConfig = loadMsgBotOn();

                        if (msgBotOnConfig.enabled) {
                             /*
                             CORREÇÃO: Timer salvo na variável ownerMsgTimer para poder ser
                             cancelado se o bot desconectar antes dos 3s (evita timer órfão
                             usando socket antigo após reconexão).
                             */
                            if (ownerMsgTimer) clearTimeout(ownerMsgTimer);
                            ownerMsgTimer = setTimeout(async () => {
                                ownerMsgTimer = null;
                                try {
                                    const ownerJid = buildUserId(numerodono, config);
                                    await AbyssSock.sendMessage(ownerJid, {
                                        text: msgBotOnConfig.message
                                    });
                                    console.log('✅ Mensagem de inicialização enviada para o dono');
                                } catch (sendError) {
                                    console.error('❌ Erro ao enviar mensagem de inicialização:', sendError.message);
                                }
                            }, 3000);
                        } else {
                            console.log('ℹ️ Mensagem de inicialização desativada');
                        }
                    } catch (msgError) {
                        console.error('❌ Erro ao processar mensagem de inicialização:', msgError.message);
                    }

                    // Inicializa sub-bots automaticamente
                    try {
                        const subBotManagerModule = await import('./utils/subBotManager.js');
                        const subBotManager = subBotManagerModule.default ?? subBotManagerModule;
                        console.log('🤖 Verificando sub-bots cadastrados...');
                        // CORREÇÃO: Timer salvo em subBotInitTimer para cancelamento em reconexão.
                        if (subBotInitTimer) clearTimeout(subBotInitTimer);
                        subBotInitTimer = setTimeout(async () => {
                            subBotInitTimer = null;
                            await subBotManager.initializeAllSubBots();
                        }, 5000);
                    } catch (error) {
                        console.error('❌ Erro ao inicializar sub-bots:', error.message);
                    }

                    console.log(`✅ Bot ${nomebot} iniciado com sucesso! Prefixo: ${prefixo} | Dono: ${nomedono}`);
                    console.log(`📊 Configuração: ${messageQueue.batchSize} lotes de ${messageQueue.messagesPerBatch} mensagens (${messageQueue.batchSize * messageQueue.messagesPerBatch} msgs paralelas)`);
                } catch (initErr) {
                    // CORREÇÃO: Erro crítico na inicialização — loga e dispara reconexão
                    // em vez de deixar o bot em estado parcialmente inicializado.
                    console.error('❌ Erro crítico na inicialização pós-conexão:', initErr.message);
                    setTimeout(() => startNazu(), 5000);
                }
            }
            if (connection === 'close') {
                const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
                const reasonMessage = {
                    [DisconnectReason.loggedOut]: 'Deslogado do WhatsApp',
                    401: 'Sessão expirada',
                    403: 'Acesso proibido (Forbidden)',
                    [DisconnectReason.connectionClosed]: 'Conexão fechada',
                    [DisconnectReason.connectionLost]: 'Conexão perdida',
                    [DisconnectReason.connectionReplaced]: 'Conexão substituída',
                    [DisconnectReason.timedOut]: 'Tempo de conexão esgotado',
                    [DisconnectReason.badSession]: 'Sessão inválida',
                    [DisconnectReason.restartRequired]: 'Reinício necessário',
                }[reason] || 'Motivo desconhecido';

                console.log(`❌ Conexão fechada. Código: ${reason} | Motivo: ${reasonMessage}`);

                // Limpa recursos antes de reconectar
                if (cacheCleanupInterval) {
                    clearInterval(cacheCleanupInterval);
                    cacheCleanupInterval = null;
                }

                // CORREÇÃO: Cancela timers órfãos do evento 'open' que ainda não dispararam.
                // Sem isso, eles usariam o socket antigo após a reconexão.
                if (ownerMsgTimer) { clearTimeout(ownerMsgTimer); ownerMsgTimer = null; }
                if (subBotInitTimer) { clearTimeout(subBotInitTimer); subBotInitTimer = null; }

                // Tratamento especial para erro 403 (Forbidden)
                if (reason === 403) {
                    forbidden403Attempts++;
                    console.log(`⚠️ Erro 403 detectado. Tentativa ${forbidden403Attempts}/${MAX_403_ATTEMPTS}`);

                    if (forbidden403Attempts >= MAX_403_ATTEMPTS) {
                        console.log('❌ Máximo de tentativas para erro 403 atingido. Apagando QR code e parando...');
                        await clearAuthDir(authDir);
                        console.log('🗑️ Autenticação removida. Reinicie o bot para gerar um novo QR code.');
                        process.exit(1);
                    }

                    // Aguarda antes de tentar reconectar
                    console.log('🔄 Tentando reconectar em 5 segundos...');
                    if (reconnectTimer) {
                        clearTimeout(reconnectTimer);
                    }
                    reconnectTimer = setTimeout(() => {
                        startNazu();
                    }, 5000);
                    return;
                }

                // Reset do contador 403 se for outro tipo de erro
                forbidden403Attempts = 0;

                if (reason === DisconnectReason.badSession || reason === DisconnectReason.loggedOut) {
                    await clearAuthDir(authDir);
                    console.log('🔄 Nova autenticação será necessária na próxima inicialização.');
                }

                // Não reconecta se conexão foi substituída (outra instância assumiu)
                if (reason === DisconnectReason.connectionReplaced) {
                    console.log('⚠️ Conexão substituída por outra instância. Não reconectando para evitar conflito.');
                    return;
                }

                // Delay antes de reconectar baseado no motivo
                let reconnectDelay = 5000;
                if (reason === DisconnectReason.timedOut) {
                    reconnectDelay = 3000; // Reconexão mais rápida para timeout
                } else if (reason === DisconnectReason.connectionLost) {
                    reconnectDelay = 2000; // Reconexão ainda mais rápida para perda de conexão
                } else if (reason === DisconnectReason.loggedOut || reason === DisconnectReason.badSession) {
                    reconnectDelay = 10000; // Delay maior para problemas de autenticação
                }

                console.log(`🔄 Aguardando ${reconnectDelay / 1000} segundos antes de reconectar...`);

                // Cancela timer anterior se existir
                if (reconnectTimer) {
                    clearTimeout(reconnectTimer);
                }

                reconnectTimer = setTimeout(() => {
                    reconnectAttempts = 0; // Reset ao reconectar por desconexão normal
                    forbidden403Attempts = 0; // Reset contador de erro 403
                    startNazu();
                }, reconnectDelay);
            }
        });
        return AbyssSock;
    } catch (err) {
        console.error(`❌ Erro ao criar socket do bot: ${err.message}`);
        throw err;
    }
}

async function startNazu() {
    // Evita múltiplas instâncias sendo criadas ao mesmo tempo
    if (isReconnecting) {
        console.log('⚠️ Reconexão já em andamento, ignorando chamada duplicada...');
        return;
    }

    isReconnecting = true;

     /*
     CORREÇÃO: try/finally garante que isReconnecting SEMPRE volta para false,
     independente do caminho de execução.
     Antes, qualquer exceção inesperada dentro de createBotSocket() que não fosse
     capturada pelo catch deixava isReconnecting = true para sempre, travando toda
     reconexão futura silenciosamente.
     */
    try {
         /*
         CORREÇÃO: reconnectAttempts NÃO é mais resetado aqui.
         Antes, era zerado logo ao entrar — ou seja, antes de qualquer tentativa ter sucesso.
         Isso fazia o limite MAX_RECONNECT_ATTEMPTS nunca ser atingido (o contador
         era apagado a cada ciclo). O reset correto acontece no evento 'connection.update'
         quando connection === 'open', confirmando conexão real.
         */
        console.log('🚀 Iniciando Abyss...');

        await createBotSocket(AUTH_DIR);
        // isReconnecting = false é feito no finally abaixo
    } catch (err) {
        reconnectAttempts++;
        console.error(`❌ Erro ao iniciar o bot (tentativa ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}): ${err.message}`);

        // Se excedeu tentativas, para de tentar
        if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            console.error(`❌ Máximo de tentativas de reconexão alcançado (${MAX_RECONNECT_ATTEMPTS}). Parando...`);
            process.exit(1);
        }

        if (err.message.includes('ENOSPC') || err.message.includes('ENOMEM')) {
            console.log('🧹 Tentando limpeza de emergência...');
            try {
                await performanceOptimizer.emergencyCleanup();
                console.log('✅ Limpeza de emergência concluída');
            } catch (cleanupErr) {
                console.error('❌ Falha na limpeza de emergência:', cleanupErr.message);
            }
        }

        // Delay exponencial (backoff) para evitar spam de conexões
        const delay = Math.min(RECONNECT_DELAY_BASE * Math.pow(1.5, reconnectAttempts - 1), 60000);
        console.log(`🔄 Aguardando ${Math.round(delay / 1000)} segundos antes de tentar novamente...`);

        // Cancela timer anterior se existir
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
        }

        reconnectTimer = setTimeout(() => {
            startNazu();
        }, delay);
    } finally {
        // CORREÇÃO: isReconnecting sempre liberado aqui — tanto em sucesso quanto em erro.
        isReconnecting = false;
    }
}

/**
 * Função unificada para desligamento gracioso
 */
async function gracefulShutdown(signal) {
    const signalName = signal === 'SIGTERM' ? 'SIGTERM' : 'SIGINT';
    console.log(`📡 ${signalName} recebido, parando bot graciosamente...`);

    // Cancela qualquer timer de reconexão pendente
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    isReconnecting = false;

    let shutdownTimeout;

    // Timeout de segurança para forçar saída após 15 segundos
    shutdownTimeout = setTimeout(() => {
        console.error('⚠️ Timeout de shutdown, forçando saída...');
        process.exit(1);
    }, 15000);

    try {
        // Desconecta sub-bots
        try {
            const subBotManagerModule = await import('./utils/subBotManager.js');
            const subBotManager = subBotManagerModule.default ?? subBotManagerModule;
            await subBotManager.disconnectAllSubBots();
            console.log('✅ Sub-bots desconectados');
        } catch (error) {
            console.error('❌ Erro ao desconectar sub-bots:', error.message);
        }

        // Limpa recursos
        if (cacheCleanupInterval) {
            clearInterval(cacheCleanupInterval);
            cacheCleanupInterval = null;
        }

        // Finaliza fila de mensagens
        await messageQueue.shutdown();
        console.log('✅ MessageQueue finalizado');

        // Finaliza otimizador
        await performanceOptimizer.shutdown();
        console.log('✅ Performance optimizer finalizado');

        clearTimeout(shutdownTimeout);
        console.log('✅ Desligamento concluído');
        process.exit(0);
    } catch (error) {
        console.error('❌ Erro durante desligamento:', error.message);
        clearTimeout(shutdownTimeout);
        process.exit(1);
    }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', async (error) => {
     /*
     CORREÇÃO: Antes, o handler apenas logava o erro e não fazia nada.
     Erros não capturados em Promises matavam o WebSocket interno silenciosamente,
     mas o processo continuava "vivo" sem conexão ativa — o bot aparecia rodando
     mas não respondia. Agora chama process.exit(1) para que o PM2/supervisor
     reinicie o processo limpo e com uma nova conexão.
     */
    console.error('🚨 Erro não capturado — reiniciando processo:', error.message);
    console.error(error.stack);

    if (error.message.includes('ENOSPC') || error.message.includes('ENOMEM')) {
        try {
            await performanceOptimizer.emergencyCleanup();
        } catch (cleanupErr) {
            console.error('❌ Falha na limpeza de emergência:', cleanupErr.message);
        }
    }

    process.exit(1);
});

 /*
 CORREÇÃO: Handler de unhandledRejection estava completamente ausente.
 Sem ele, Promises rejeitadas em listeners async do Baileys (que são void)
 eram swallowed silenciosamente — o bot ficava num estado inconsistente sem log.
 No Node 15+, unhandledRejection também derruba o processo sem stack trace útil.
 */
process.on('unhandledRejection', (reason, promise) => {
    console.error('🚨 Promise rejeitada sem tratamento:', reason);
    // Não chama process.exit aqui pois rejeições não críticas são comuns
    // em eventos do Baileys. O importante é logar para diagnóstico.
});

export { rentalExpirationManager, messageQueue };

startNazu();