import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Função para normalizar texto (remover acentos)
function normalizar(texto) {
    if (!texto || typeof texto !== 'string') return '';
    return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// Arquivo de persistência
const blockPvFile = path.join(process.cwd(), 'dados', 'database', 'blockPv.json');

// Dados em memória
export let blockPvData = {
    menus: [],      // Menus bloqueados no PV (array de menuKey)
    commands: []    // Comandos bloqueados no PV (array de command names)
};

// Carregar dados do arquivo
export function loadBlockPvData() {
    try {
        if (fs.existsSync(blockPvFile)) {
            const content = fs.readFileSync(blockPvFile, 'utf-8') || '';
            if (content && content.trim() && content.trim().startsWith('{')) {
                const loadedData = JSON.parse(content);
                blockPvData.menus = loadedData.menus || [];
                blockPvData.commands = loadedData.commands || [];
            }
        }
    } catch (e) {
        console.warn('[BlockPV] Erro ao carregar dados:', e.message);
    }
    return blockPvData;
}

// Salvar dados no arquivo
export function saveBlockPvData() {
    try {
        const dir = path.dirname(blockPvFile);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(blockPvFile, JSON.stringify(blockPvData, null, 2), 'utf-8');
    } catch (e) {
        console.error('[BlockPV] Erro ao salvar dados:', e.message);
    }
}

// Verificar se é PV
export function isPrivateChat(isGroup) {
    return !isGroup;
}

// Verificar se comando está bloqueado no PV
export function isCommandBlockedInPV(command) {
    if (!command || typeof command !== 'string') {
        return { blocked: false };
    }
    
    const cmd = command.toLowerCase();
    
    // Verificar bloqueio individual de comando
    if (blockPvData.commands.includes(cmd)) {
        return { blocked: true, reason: 'command', command: cmd };
    }
    
    // Verificar bloqueio por menu
    const menuInfo = getCommandMenu(cmd);
    if (menuInfo && blockPvData.menus.includes(menuInfo.menuKey)) {
        return { blocked: true, reason: 'menu', menuName: menuInfo.menuName, command: cmd };
    }
    
    return { blocked: false };
}

// Bloquear menu no PV
export function blockMenuInPV(menuKey) {
    if (!blockPvData.menus.includes(menuKey)) {
        blockPvData.menus.push(menuKey);
        saveBlockPvData();
        return true;
    }
    return false;
}

// Desbloquear menu no PV
export function unblockMenuInPV(menuKey) {
    const index = blockPvData.menus.indexOf(menuKey);
    if (index > -1) {
        blockPvData.menus.splice(index, 1);
        saveBlockPvData();
        return true;
    }
    return false;
}

// Bloquear comando no PV
export function blockCommandInPV(command) {
    const cmd = command.toLowerCase();
    if (!blockPvData.commands.includes(cmd)) {
        blockPvData.commands.push(cmd);
        saveBlockPvData();
        return true;
    }
    return false;
}

// Desbloquear comando no PV
export function unblockCommandInPV(command) {
    const cmd = command.toLowerCase();
    const index = blockPvData.commands.indexOf(cmd);
    if (index > -1) {
        blockPvData.commands.splice(index, 1);
        saveBlockPvData();
        return true;
    }
    return false;
}

// Listar bloqueios
export function listBlockPV() {
    return {
        menus: blockPvData.menus.map(key => {
            const menuInfo = menuCommandsMap[key];
            return menuInfo ? menuInfo.menuName : key;
        }),
        commands: [...blockPvData.commands]
    };
}

// Verificar se menu existe
export function menuExists(menuKey) {
    return menuCommandsMap.hasOwnProperty(menuKey);
}

// Encontrar menu pela chave ou pelo nome
export function findMenuByKeyOrName(input) {
    if (!input || typeof input !== 'string') {
        return null;
    }
    
    const normalizedInput = normalizar(input).toLowerCase();
    
    // Primeiro, tenta encontrar pela chave exata
    if (menuCommandsMap[normalizedInput]) {
        return normalizedInput;
    }
    
    // Depois, tenta encontrar pelo nome do menu
    for (const [key, data] of Object.entries(menuCommandsMap)) {
        const normalizedMenuName = normalizar(data.menuName).toLowerCase();
        if (normalizedMenuName === normalizedInput) {
            return key;
        }
    }
    
    return null;
}

// Verificar se comando existe
export function commandExists(command) {
    if (!command || typeof command !== 'string') {
        return false;
    }
    const cmd = command.toLowerCase();
    return getCommandMenu(cmd) !== null;
}

// Verificar se um menu está bloqueado no PV
export function isMenuBlocked(menuKey) {
    if (!menuKey || typeof menuKey !== 'string') {
        return false;
    }
    return blockPvData.menus.includes(menuKey);
}

// Verificar se um comando de menu está bloqueado no PV (retorna mensagem de erro ou null)
export function checkMenuBlockedInPV(menuKey, menuName) {
    if (isMenuBlocked(menuKey)) {
        return `❌ O menu "${menuName}" está desativado para conversas privadas.\n\nUse este comando em um grupo.`;
    }
    return null;
}

// Mapear comandos de menu para suas chaves
export const menuCommandMap = {
    // Diversão
    'menubn': { key: 'menubn', name: 'Diversão' },
    'menubrincadeira': { key: 'menubn', name: 'Diversão' },
    'menubrincadeiras': { key: 'menubn', name: 'Diversão' },
    'gamemenu': { key: 'menubn', name: 'Diversão' },
    // Downloads
    'menudown': { key: 'menudown', name: 'Downloads' },
    'menudownload': { key: 'menudown', name: 'Downloads' },
    'menudownloads': { key: 'menudown', name: 'Downloads' },
    'downmenu': { key: 'menudown', name: 'Downloads' },
    'downloadmenu': { key: 'menudown', name: 'Downloads' },
    // IA
    'menuia': { key: 'menuia', name: 'IA' },
    'menuias': { key: 'menuia', name: 'IA' },
    'menuinteligencia': { key: 'menuia', name: 'IA' },
    // Ferramentas
    'menuferramentas': { key: 'menuferramentas', name: 'Ferramentas' },
    'menuferramenta': { key: 'menuferramentas', name: 'Ferramentas' },
    'ferramentas': { key: 'menuferramentas', name: 'Ferramentas' },
    'toolsmenu': { key: 'menuferramentas', name: 'Ferramentas' },
    'tools': { key: 'menuferramentas', name: 'Ferramentas' },
    // Admin
    'menuadms': { key: 'menuadm', name: 'Admin' },
    'menuadmin': { key: 'menuadm', name: 'Admin' },
    'menustaff': { key: 'menuadm', name: 'Admin' },
    'menuadm': { key: 'menuadm', name: 'Admin' },
    'adminmenu': { key: 'menuadm', name: 'Admin' },
    // Dono
    'menudono': { key: 'menudono', name: 'Dono' },
    'donomenu': { key: 'menudono', name: 'Dono' },
    'donomenu': { key: 'menudono', name: 'Dono' },
    // Figurinhas
    'menufig': { key: 'menufig', name: 'Figurinhas' },
    'menusticker': { key: 'menufig', name: 'Figurinhas' },
    'figurinhasmenu': { key: 'menufig', name: 'Figurinhas' },
    'stickermenu': { key: 'menufig', name: 'Figurinhas' },
    // Logos
    'menulogos': { key: 'menulogos', name: 'Logos' },
    'logomenu': { key: 'menulogos', name: 'Logos' },
    'logosmenu': { key: 'menulogos', name: 'Logos' },
    // Edits
    'menuedits': { key: 'menuedits', name: 'Edições' },
    'editmenu': { key: 'menuedits', name: 'Edições' },
    'editsmenu': { key: 'menuedits', name: 'Edições' },
    // Membresia
    'menumemb': { key: 'menumemb', name: 'Membresia' },
    'menumembro': { key: 'menumemb', name: 'Membresia' },
    'membmenu': { key: 'menumemb', name: 'Membresia' },
    // RPG
    'menurpg': { key: 'menurpg', name: 'RPG' },
    'rpgmenu': { key: 'menurpg', name: 'RPG' },
    // VIP
    'menuvip': { key: 'menuvip', name: 'VIP' },
    'vipmenu': { key: 'menuvip', name: 'VIP' },
    // Futebol
    'menufut': { key: 'menufut', name: 'Futebol' },
    'futmenu': { key: 'menufut', name: 'Futebol' },
    'futebolmenu': { key: 'menufut', name: 'Futebol' },
    // Áudios
    'menuaudio': { key: 'menuaudio', name: 'Áudios' },
    'menuáudio': { key: 'menuaudio', name: 'Áudios' },
    'audiosmenu': { key: 'menuaudio', name: 'Áudios' },
};

// Mapeamento de menus para comandos
// Cada menu pode ter múltiplos comandos (aliases)

export const menuCommandsMap = {
    // Menu principal mostra esses menus:
    menuia: {
        menuName: 'IA',
        commands: ['chatgpt', 'ia', 'gemini', 'gpt', 'groq', 'llama', 'deepseek']
    },
    menudown: {
        menuName: 'Downloads',
        commands: ['play', 'play2', 'playvid', 'playaudio', 'playmp3', 'ytmp3', 'ytmp4', 'ytsearch', 'spotify', 'tiktok', 'tk', 'twitter', 'ig', 'instagram', 'fb', 'facebook', 'mediafire', 'gitclone']
    },
    menulogos: {
        menuName: 'Logos',
        commands: ['logo', 'logos', 'logo2', 'slogo', 'logobrasileirao', 'logoml', 'logoff']
    },
    menuedits: {
        menuName: 'Edições',
        commands: ['tobeijoflip', 'tobeijoflop', 'publicar', 'borrado', 'rip', 'gelo', 'fire', 'triggered', 'wasted', 'blur', 'sepia', 'negativo', 'pixelar', 'aumentar']
    },
    menuadm: {
        menuName: 'Admin',
        commands: ['ban', 'kick', 'add', 'promover', 'rebaixar', 'setfoto', 'setnome', 'desc', 'link', 'tagall', 'hidetag', 'mt', 'marcar', 'rall', 'banlist', 'adminlist', 'infogp', 'voteban', 'approve', 'blockconversa', 'desbloquear', 'trancar', 'destrancar', 'abrir', 'ativarevento', 'desativarevento']
    },
    menubn: {
        menuName: 'Diversão',
        commands: ['tictactoe', 'connect4', 'uno', 'memoria', 'wordle', 'quiz', 'forca', 'digitar', 'batalhanaval', 'stop', 'anagrama', 'dueloquiz', 'cacapalavras', 'jogodavelha', 'eununca', 'vab', 'chance', 'quando', 'sorte', 'casal', 'shipo', 'sn', 'fchk', 'masc', 'femn', 'ppk', 'fdc', 'fui', 'gay', 'fav', 'pne', 'rankcorno', 'rankbixa', 'rankviado', 'rankotaku', 'rankgato', 'rankfeio', 'rankbonito', 'top10', 'petpet', 'advinhar', 'fazer', 'piada', 'piadas', 'dadu', 'dice', 'rolar', 'gayrate', 'fortune', '8ball', 'bafometro', 'vcsabia', 'coracao', 'fselecao', 'cuidado', 'zuer', 'perdao', 'inspire', 'motivacao', 'fato', 'fake', 'ta', 'caracoroa', 'roletarussa', 'minerioca', 'par', 'ímpar', 'pet', 'coinflip', 'slots', 'abraço', 'capa', 'carimbo', 'socar', 'beijar', 'matar', 'chute', 'tapa', 'abraçar', 'festejar', 'dedada', 'estapear', 'atirar', 'selar', 'bancoimortal', 'ship', 'fake2', 'sorteiovip', 'sorteio', 'corno', 'rankot']
    },
    menudono: {
        menuName: 'Dono',
        commands: ['cmd', 'exec', 'bc', 'broadcast', 'sair', 'entrar', 'blockmenupv', 'unblockmenupv', 'blockcmdpv', 'unblockcmdpv', 'listblockpv', 'nomebot', 'fotobot', 'bloquear', 'desbloquear', 'userblock', 'block', 'unblock', 'listblocks', 'modoligado', 'mododesligado', 'verificar', 'criarpv', 'deletepv', 'backup', 'setgroq', 'vergroq', 'settipoia', 'settipochat', 'regrasgp', 'rconfig', 'bconfig', 'config', 'addpalavra', 'delpalavra', 'listapc', 'antipalavras', 'addsticker', 'delsticker', 'listasticker', 'blackpalavra', 'bcgc', 'msgauto', 'addmsg', 'delmsg', 'listmsg', 'statusbot', 'att', 'update', 'restart', 'desligar', 'ligar', 'ping']
    },
    menumemb: {
        menuName: 'Membros',
        commands: ['perfil', 'hist', 'historico', 'rank', 'transações', 'inventário', 'inv', 'status', 'rep', 'reputação', 'daily', 'semana', 'mensal', 'saldo', 'depositar', 'sacar', 'transferir', 'enviar', 'roubar', 'bet', 'apostar', 'minerar', 'trabalho', 'trab', 'daily', 'emprego', 'procurar', 'mineraca', 'encontrar']
    },
    ferramentas: {
        menuName: 'Ferramentas',
        commands: ['encurtar', 'google', 'calc', 'calcular', 'wikipedia', 'wiki', 'clima', 'traduzir', 'tradutor', 'noticias', 'news', 'horario', 'dolar', 'euro', 'bitcoin', 'cep', 'ip', 'dns', 'niver', 'idade', 'calcular', 'ping', 'calc', 'ocr', 'scan', 'dicionario', 'aurora', 'audio', 'voz', 'tts']
    },
    menufig: {
        menuName: 'Figurinhas',
        commands: ['sticker', 's', 'f', 'fig', 'sg', 'sf', 'toimg', 'rmbg', 'semfundo', 'attp', 'attp2', 'dado', 'fsticker']
    },
    alteradores: {
        menuName: 'Alteradores',
        commands: ['alugar', 'comprar', 'vender', 'contratar', 'demitir', 'transporte', 'viajar', 'locomover', 'casar', 'divorciar', 'adotar', 'libertar', 'nomepet', 'abandonar']
    },
    menurpg: {
        menuName: 'RPG',
        commands: ['rpg', 'pegar', 'equipar', 'statusrpg', 'iniciarpg', 'usar', 'craftar', 'craft', 'minerar', 'caçar', 'coletar', 'venderitens', 'missao', 'missoes', 'diario', 'semanal', 'boss', 'explorar', 'aventura', 'dungeon', 'pvprpg', 'treinar', 'treino', 'descansar', 'hospital', 'assassinar', 'roubarpg', 'faccao', 'facções']
    },
    menuvip: {
        menuName: 'VIP',
        commands: ['vip', 'viplist', 'listavip', 'comprarvip', 'vipstatus', 'diariOvip', 'vantagens']
    },
    menu: {
        menuName: 'Menu',
        commands: ['menu', 'help', 'comandos', 'commands']
    },
    menufut: {
        menuName: 'Futebol',
        commands: ['fut', 'futebol', 'times', ' palpitar', 'palpite', 'cartoes', 'classificacao', 'bj', 'bolão', 'palpites']
    }
};

// Função para obter todos os comandos únicos
export function getAllCommands() {
    const allCommands = new Set();
    for (const menuData of Object.values(menuCommandsMap)) {
        for (const cmd of menuData.commands) {
            allCommands.add(cmd);
        }
    }
    return Array.from(allCommands);
}

// Função para obter o menu de um comando
export function getCommandMenu(command) {
    if (!command || typeof command !== 'string') {
        return null;
    }
    
    const cmd = command.toLowerCase();
    for (const [menuKey, menuData] of Object.entries(menuCommandsMap)) {
        if (menuData.commands.includes(cmd)) {
            return {
                menuKey,
                menuName: menuData.menuName
            };
        }
    }
    return null;
}

// Função para obter todos os menus
export function getAllMenus() {
    return Object.entries(menuCommandsMap).map(([key, data]) => ({
        key,
        name: data.menuName
    }));
}
