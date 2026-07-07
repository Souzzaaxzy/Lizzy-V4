import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Arquivo de persistência
const blockGroupFile = path.join(process.cwd(), 'dados', 'database', 'blockGroupMenus.json');

// Dados em memória: { "groupId": ["menuKey1", "menuKey2"] }
let blockGroupData = {};

// Carregar dados do arquivo
export function loadBlockGroupData() {
    try {
        if (fs.existsSync(blockGroupFile)) {
            const content = fs.readFileSync(blockGroupFile, 'utf-8') || '';
            if (content && content.trim() && content.trim().startsWith('{')) {
                blockGroupData = JSON.parse(content);
            }
        }
    } catch (e) {
        console.warn('[BlockGroupMenu] Erro ao carregar dados:', e.message);
    }
    return blockGroupData;
}

// Salvar dados no arquivo
export function saveBlockGroupData() {
    try {
        fs.writeFileSync(blockGroupFile, JSON.stringify(blockGroupData, null, 2), 'utf-8');
    } catch (e) {
        console.error('[BlockGroupMenu] Erro ao salvar dados:', e.message);
    }
}

// Obter menus bloqueados de um grupo
export function getGroupBlockedMenus(groupId) {
    return blockGroupData[groupId] || [];
}

// Verificar se comando está bloqueado no grupo
export function isCommandBlockedInGroup(command, groupId) {
    const cmd = command.toLowerCase();
    
    // Verificar bloqueio por menu no grupo
    const menuInfo = getCommandMenu(cmd);
    if (menuInfo) {
        const blockedMenus = getGroupBlockedMenus(groupId);
        if (blockedMenus.includes(menuInfo.menuKey)) {
            return { blocked: true, reason: 'menu', menuName: menuInfo.menuName, command: cmd };
        }
    }
    
    return { blocked: false };
}

// Bloquear menu no grupo
export function blockMenuInGroup(groupId, menuKey) {
    if (!blockGroupData[groupId]) {
        blockGroupData[groupId] = [];
    }
    
    if (!blockGroupData[groupId].includes(menuKey)) {
        blockGroupData[groupId].push(menuKey);
        saveBlockGroupData();
        return true;
    }
    return false;
}

// Desbloquear menu no grupo
export function unblockMenuInGroup(groupId, menuKey) {
    if (!blockGroupData[groupId]) {
        return false;
    }
    
    const index = blockGroupData[groupId].indexOf(menuKey);
    if (index > -1) {
        blockGroupData[groupId].splice(index, 1);
        
        // Limpar grupo se não tiver mais bloqueios
        if (blockGroupData[groupId].length === 0) {
            delete blockGroupData[groupId];
        }
        
        saveBlockGroupData();
        return true;
    }
    return false;
}

// Listar menus bloqueados no grupo
export function listGroupBlockedMenus(groupId) {
    const blockedMenus = getGroupBlockedMenus(groupId);
    return blockedMenus.map(key => {
        const menuInfo = menuCommandsMap[key];
        return menuInfo ? menuInfo.menuName : key;
    });
}

// Verificar se menu existe
export function menuExists(menuKey) {
    return menuCommandsMap.hasOwnProperty(menuKey);
}

// Mapeamento de menus para comandos
import { menuCommandsMap, getCommandMenu } from './blockPv.js';

// Re-exportar para uso em outros módulos
export { menuCommandsMap, getCommandMenu };
