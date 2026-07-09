import fs from 'fs';
import path from 'path';

// Arquivo de banco de dados para mutes temporários
const TEMP_MUTE_FILE = path.join(process.cwd(), 'dados', 'database', 'tempMute.json');

// Estrutura do banco de dados:
// {
//   "groupId1": {
//     "userId1": {
//       "adminId": "admin_jid",
//       "adminName": "Nome do Admin",
//       "startTime": timestamp,
//       "endTime": timestamp,
//       "originalTime": "2h",
//       "createdAt": ISO string
//     }
//   }
// }

let tempMuteCache = null;
let lastSave = 0;
const SAVE_DEBOUNCE_MS = 1000;

// Callback para notificar expiração (injetado posteriormente)
let onMuteExpiredCallback = null;

function loadTempMuteData() {
  if (tempMuteCache !== null) return tempMuteCache;
  
  try {
    if (fs.existsSync(TEMP_MUTE_FILE)) {
      const data = fs.readFileSync(TEMP_MUTE_FILE, 'utf-8');
      tempMuteCache = JSON.parse(data);
    } else {
      tempMuteCache = {};
    }
  } catch (error) {
    console.error('❌ Erro ao carregar tempMute.json:', error);
    tempMuteCache = {};
  }
  
  return tempMuteCache;
}

function saveTempMuteData() {
  const now = Date.now();
  if (now - lastSave < SAVE_DEBOUNCE_MS) {
    setTimeout(() => saveTempMuteData(), SAVE_DEBOUNCE_MS - (now - lastSave));
    return;
  }
  
  lastSave = now;
  
  try {
    const dir = path.dirname(TEMP_MUTE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(TEMP_MUTE_FILE, JSON.stringify(tempMuteCache, null, 2));
  } catch (error) {
    console.error('❌ Erro ao salvar tempMute.json:', error);
  }
}

// Converte tempo em texto para milissegundos
function parseTimeToMs(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return null;
  
  const match = timeStr.trim().match(/^(\d+)\s*([smhd])$/i);
  if (!match) return null;
  
  const value = parseInt(match[1]);
  const unit = match[2].toLowerCase();
  
  if (value <= 0) return null;
  
  switch (unit) {
    case 's': return value * 1000;
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'd': return value * 24 * 60 * 60 * 1000;
    default: return null;
  }
}

// Converte ms para texto legível
function formatTimeRemaining(ms) {
  if (ms <= 0) return '0 segundos';
  
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  const parts = [];
  if (days > 0) parts.push(`${days} dia${days > 1 ? 's' : ''}`);
  if (hours % 24 > 0) parts.push(`${hours % 24} hora${hours % 24 > 1 ? 's' : ''}`);
  if (minutes % 60 > 0) parts.push(`${minutes % 60} minuto${minutes % 60 > 1 ? 's' : ''}`);
  if (seconds % 60 > 0 && days === 0 && hours === 0) parts.push(`${seconds % 60} segundo${seconds % 60 > 1 ? 's' : ''}`);
  
  return parts.slice(0, 2).join(' e ');
}

// Verifica se usuário está temporariamente mutado
function isUserTempMuted(groupId, userId, idsMatch) {
  const data = loadTempMuteData();
  const groupMutes = data[groupId];
  
  if (!groupMutes) return { muted: false };
  
  const now = Date.now();
  
  for (const [mutedUserId, muteInfo] of Object.entries(groupMutes)) {
    if (idsMatch(mutedUserId, userId)) {
      if (muteInfo.endTime > now) {
        return {
          muted: true,
          remaining: muteInfo.endTime - now,
          endTime: muteInfo.endTime,
          adminName: muteInfo.adminName,
          originalTime: muteInfo.originalTime
        };
      } else {
        // Mute expirou, remover
        delete groupMutes[mutedUserId];
        saveTempMuteData();
      }
    }
  }
  
  return { muted: false };
}

// Adiciona mute temporário
function addTempMute(groupId, userId, adminId, adminName, timeStr) {
  const data = loadTempMuteData();
  
  if (!data[groupId]) {
    data[groupId] = {};
  }
  
  const durationMs = parseTimeToMs(timeStr);
  if (!durationMs) return { success: false, error: 'Tempo inválido' };
  
  const now = Date.now();
  const endTime = now + durationMs;
  
  data[groupId][userId] = {
    adminId: adminId,
    adminName: adminName,
    startTime: now,
    endTime: endTime,
    originalTime: timeStr,
    createdAt: new Date(now).toISOString()
  };
  
  tempMuteCache = data;
  saveTempMuteData();
  
  // Agenda a expiração do mute
  scheduleMuteExpiration(groupId, userId, endTime);
  
  return {
    success: true,
    endTime: endTime,
    durationMs: durationMs
  };
}

// Remove mute temporário
function removeTempMute(groupId, userId, idsMatch) {
  const data = loadTempMuteData();
  const groupMutes = data[groupId];
  
  if (!groupMutes) return { success: false, error: 'Nenhum mute encontrado' };
  
  for (const [mutedUserId] of Object.entries(groupMutes)) {
    if (idsMatch(mutedUserId, userId)) {
      delete groupMutes[mutedUserId];
      tempMuteCache = data;
      saveTempMuteData();
      return { success: true };
    }
  }
  
  return { success: false, error: 'Usuário não está mutado' };
}

// Remove todos os mutes expirados (para limpeza)
function cleanupExpiredMutes(idsMatch) {
  const data = loadTempMuteData();
  const now = Date.now();
  let hasChanges = false;
  
  for (const groupId of Object.keys(data)) {
    for (const [userId, muteInfo] of Object.entries(data[groupId])) {
      if (muteInfo.endTime <= now) {
        delete data[groupId][userId];
        hasChanges = true;
        
        // Notificar que o mute expirou (via callback)
        if (onMuteExpiredCallback) {
          onMuteExpiredCallback(groupId, userId, muteInfo);
        }
      }
    }
    
    // Remove grupo vazio
    if (Object.keys(data[groupId]).length === 0) {
      delete data[groupId];
      hasChanges = true;
    }
  }
  
  if (hasChanges) {
    tempMuteCache = data;
    saveTempMuteData();
  }
}

// Obtém informações de um mute específico
function getTempMuteInfo(groupId, userId, idsMatch) {
  const data = loadTempMuteData();
  const groupMutes = data[groupId];
  
  if (!groupMutes) return null;
  
  for (const [mutedUserId, muteInfo] of Object.entries(groupMutes)) {
    if (idsMatch(mutedUserId, userId)) {
      return {
        ...muteInfo,
        remaining: Math.max(0, muteInfo.endTime - Date.now())
      };
    }
  }
  
  return null;
}

// Define o callback para notificação de expiração
function setMuteExpiredCallback(callback) {
  onMuteExpiredCallback = callback;
}

// Agenda timeout para um mute específico expirar
const scheduledTimeouts = new Map();

function scheduleMuteExpiration(groupId, userId, endTime) {
  const key = `${groupId}:${userId}`;
  const now = Date.now();
  const delay = endTime - now;
  
  // Se já passou, não agenda
  if (delay <= 0) return;
  
  // Cancela timeout anterior se existir
  if (scheduledTimeouts.has(key)) {
    clearTimeout(scheduledTimeouts.get(key));
  }
  
  // Agenda novo timeout (máximo 2^31-1 ms para setTimeout)
  const maxTimeout = 2147483647;
  if (delay > maxTimeout) {
    // Para tempos muito longos, agenda um intermediate check
    const intermediateDelay = maxTimeout;
    scheduledTimeouts.set(key, setTimeout(() => {
      scheduleMuteExpiration(groupId, userId, endTime);
    }, intermediateDelay));
  } else {
    scheduledTimeouts.set(key, setTimeout(() => {
      scheduledTimeouts.delete(key);
      // Trigger cleanup
      import('./helpers.js').then(({ idsMatch }) => {
        const data = loadTempMuteData();
        if (data[groupId] && data[groupId][userId]) {
          const muteInfo = data[groupId][userId];
          if (muteInfo.endTime <= Date.now()) {
            delete data[groupId][userId];
            if (Object.keys(data[groupId]).length === 0) {
              delete data[groupId];
            }
            tempMuteCache = data;
            saveTempMuteData();
            
            // Notificar expiração
            if (onMuteExpiredCallback) {
              onMuteExpiredCallback(groupId, userId, muteInfo);
            }
          }
        }
      }).catch(() => {});
    }, delay));
  }
}

// Carrega e agenda todos os mutes existentes
function loadAndScheduleAllMutes() {
  const data = loadTempMuteData();
  for (const groupId of Object.keys(data)) {
    for (const userId of Object.keys(data[groupId])) {
      scheduleMuteExpiration(groupId, userId, data[groupId][userId].endTime);
    }
  }
}

// Verifica periodicamente e limpa mutes expirados
let cleanupInterval = null;

function startCleanupScheduler() {
  if (cleanupInterval) return;
  
  // Carrega e agenda todos os mutes existentes
  loadAndScheduleAllMutes();
  
  // Cleanup periódico como backup
  cleanupInterval = setInterval(() => {
    import('./helpers.js').then(({ idsMatch }) => {
      cleanupExpiredMutes(idsMatch);
    }).catch(() => {
      cleanupExpiredMutes(() => false);
    });
  }, 30000); // A cada 30 segundos
}

// Cache de avisos (para evitar spam)
const warningCooldowns = new Map();

function shouldSendWarning(userId, groupId, cooldownMs = 30000) {
  const key = `${groupId}:${userId}`;
  const now = Date.now();
  
  if (warningCooldowns.has(key)) {
    const lastWarning = warningCooldowns.get(key);
    if (now - lastWarning < cooldownMs) {
      return false;
    }
  }
  
  warningCooldowns.set(key, now);
  return true;
}

function clearWarningCooldown(userId, groupId) {
  const key = `${groupId}:${userId}`;
  warningCooldowns.delete(key);
}

export {
  parseTimeToMs,
  formatTimeRemaining,
  isUserTempMuted,
  addTempMute,
  removeTempMute,
  getTempMuteInfo,
  cleanupExpiredMutes,
  startCleanupScheduler,
  setMuteExpiredCallback,
  shouldSendWarning,
  clearWarningCooldown,
  TEMP_MUTE_FILE
};
