import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOGS_DIR = path.join(__dirname, '..', '..', '..', 'database');
const LOGS_FILE = path.join(LOGS_DIR, 'groupLogs.json');

function ensureLogsDir() {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
}

function loadLogs() {
  ensureLogsDir();
  try {
    if (fs.existsSync(LOGS_FILE)) {
      return JSON.parse(fs.readFileSync(LOGS_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error('Erro ao carregar logs:', e);
  }
  return {};
}

function saveLogs(logs) {
  ensureLogsDir();
  try {
    fs.writeFileSync(LOGS_FILE, JSON.stringify(logs, null, 2));
  } catch (e) {
    console.error('Erro ao salvar logs:', e);
  }
}

export function addGroupEvent(groupId, event) {
  const logs = loadLogs();
  
  if (!logs[groupId]) {
    logs[groupId] = [];
  }
  
  const logEntry = {
    ...event,
    timestamp: Date.now()
  };
  
  logs[groupId].push(logEntry);
  
  // Manter apenas os últimos 500 eventos por grupo
  if (logs[groupId].length > 500) {
    logs[groupId] = logs[groupId].slice(-500);
  }
  
  saveLogs(logs);
}

export function getGroupLogs(groupId, limit = 50) {
  const logs = loadLogs();
  const groupLogs = logs[groupId] || [];
  return groupLogs.slice(-limit).reverse();
}

export function formatLogEntry(log) {
  const date = new Date(log.timestamp);
  const dataFormatada = date.toLocaleDateString('pt-BR');
  const horaFormatada = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  
  let formatted = '';
  
  switch (log.type) {
    case 'request_approved':
      formatted = `📥 Solicitação de entrada aprovada

👮 Autor:
@${log.authorJid?.split('@')[0] || 'desconhecido'}

👤 Vítima:
@${log.victimJid?.split('@')[0] || 'desconhecido'}

✅ Ação:
Solicitação aceita

📅 Data:
${dataFormatada}

🕒 Hora:
${horaFormatada}`;
      break;
      
    case 'request_rejected':
      formatted = `📥 Solicitação de entrada rejeitada

👮 Autor:
@${log.authorJid?.split('@')[0] || 'desconhecido'}

👤 Vítima:
@${log.victimJid?.split('@')[0] || 'desconhecido'}

❌ Ação:
Solicitação rejeitada

📅 Data:
${dataFormatada}

🕒 Hora:
${horaFormatada}`;
      break;
      
    default:
      formatted = `📋 Evento: ${log.type}\n📅 ${dataFormatada} ${horaFormatada}`;
  }
  
  return { text: formatted, mentions: [log.authorJid, log.victimJid].filter(Boolean) };
}

export function getLogStats(groupId) {
  const logs = loadLogs();
  const groupLogs = logs[groupId] || [];
  
  const stats = {
    total: groupLogs.length,
    approved: 0,
    rejected: 0,
    other: 0
  };
  
  groupLogs.forEach(log => {
    if (log.type === 'request_approved') stats.approved++;
    else if (log.type === 'request_rejected') stats.rejected++;
    else stats.other++;
  });
  
  return stats;
}

export default {
  addGroupEvent,
  getGroupLogs,
  formatLogEntry,
  getLogStats
};
