import fs from 'fs';
import { MSG_COUNTER_FILE, DATABASE_DIR, GRUPOS_DIR } from './paths.js';
import { ensureJsonFileExists, loadJsonFile, getUserName } from './helpers.js';
import cron from 'node-cron';

// ═══════════════════════════════════════════════════════════════
// 📊 SISTEMA DE CONTADOR DE MENSAGENS
// ═══════════════════════════════════════════════════════════════

// Inicializa o banco de dados do contador de mensagens
ensureJsonFileExists(MSG_COUNTER_FILE, {
  groups: {},
  lastDailyReset: null,
  lastWeeklyReset: null
});

// Cache para otimização
let msgCounterCache = null;
let cacheTimestamp = 0;
const CACHE_TTL = 3000; // 3 segundos

// ═══════════════════════════════════════════════════════════════
// 🔄 FUNÇÕES DE CARREGAMENTO E SALVAMENTO
// ═══════════════════════════════════════════════════════════════

const loadMsgCounterData = () => {
  const now = Date.now();
  if (msgCounterCache && (now - cacheTimestamp) < CACHE_TTL) {
    return msgCounterCache;
  }
  try {
    const data = loadJsonFile(MSG_COUNTER_FILE, {
      groups: {},
      lastDailyReset: null,
      lastWeeklyReset: null
    });
    msgCounterCache = data;
    cacheTimestamp = now;
    return data;
  } catch (error) {
    console.error('❌ Erro ao carregar dados do contador de mensagens:', error);
    return {
      groups: {},
      lastDailyReset: null,
      lastWeeklyReset: null
    };
  }
};

const saveMsgCounterData = (data) => {
  try {
    ensureJsonFileExists(MSG_COUNTER_FILE);
    fs.writeFileSync(MSG_COUNTER_FILE, JSON.stringify(data, null, 2));
    msgCounterCache = data;
    cacheTimestamp = Date.now();
    return true;
  } catch (error) {
    console.error('❌ Erro ao salvar dados do contador de mensagens:', error);
    return false;
  }
};

// ═══════════════════════════════════════════════════════════════
// 🆕 INICIALIZAÇÃO DE GRUPO E USUÁRIO
// ═══════════════════════════════════════════════════════════════

const initGroupCounter = (groupId) => {
  const data = loadMsgCounterData();
  if (!data.groups[groupId]) {
    const today = getDateInfo();
    data.groups[groupId] = {
      daily: {
        date: today.date,
        total: 0,
        stickers: 0,
        images: 0,
        videos: 0,
        audios: 0,
        users: {},
        goalReached: false,
        goalNotificationSent: false
      },
      weekly: {
        weekStart: today.weekStart,
        total: 0,
        stickers: 0,
        images: 0,
        videos: 0,
        audios: 0,
        users: {},
        goalReached: false,
        goalNotificationSent: false
      },
      settings: {
        dailyGoal: null,
        weeklyGoal: null
      },
      lastUpdate: new Date().toISOString()
    };
    saveMsgCounterData(data);
  }
  return data.groups[groupId];
};

const initUserCounter = (groupData, userId, userName) => {
  const today = getDateInfo();
  
  if (!groupData.daily.users[userId]) {
    groupData.daily.users[userId] = {
      name: userName || 'Usuário',
      count: 0,
      stickers: 0,
      images: 0,
      videos: 0,
      audios: 0
    };
  }
  
  if (!groupData.weekly.users[userId]) {
    groupData.weekly.users[userId] = {
      name: userName || 'Usuário',
      count: 0,
      stickers: 0,
      images: 0,
      videos: 0,
      audios: 0
    };
  }
  
  return groupData;
};

// ═══════════════════════════════════════════════════════════════
// 📅 FUNÇÕES DE DATA
// ═══════════════════════════════════════════════════════════════

const getDateInfo = () => {
  const now = new Date();
  const brazilOffset = -3 * 60;
  const localTime = new Date(now.getTime() + brazilOffset * 60 * 1000);
  
  const year = localTime.getUTCFullYear();
  const month = localTime.getUTCMonth();
  const day = localTime.getUTCDate();
  
  const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  
  // Início da semana (segunda-feira)
  const dayOfWeek = localTime.getUTCDay();
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const weekStartDate = new Date(localTime);
  weekStartDate.setUTCDate(weekStartDate.getUTCDate() - daysToMonday);
  const weekStart = `${weekStartDate.getUTCFullYear()}-${String(weekStartDate.getUTCMonth() + 1).padStart(2, '0')}-${String(weekStartDate.getUTCDate()).padStart(2, '0')}`;
  
  return {
    date,
    weekStart,
    timestamp: localTime.getTime()
  };
};

const getDayOfWeek = () => {
  const now = new Date();
  const brazilOffset = -3 * 60;
  const localTime = new Date(now.getTime() + brazilOffset * 60 * 1000);
  return localTime.getUTCDay(); // 0 = domingo, 6 = sábado
};

const isNewDay = (lastReset) => {
  if (!lastReset) return true;
  const today = getDateInfo();
  const lastDate = new Date(lastReset);
  const brazilOffset = -3 * 60;
  const localLastDate = new Date(lastDate.getTime() + brazilOffset * 60 * 1000);
  const lastDateStr = `${localLastDate.getUTCFullYear()}-${String(localLastDate.getUTCMonth() + 1).padStart(2, '0')}-${String(localLastDate.getUTCDate()).padStart(2, '0')}`;
  return today.date !== lastDateStr;
};

const isNewWeek = (lastReset) => {
  if (!lastReset) return true;
  const today = getDateInfo();
  const lastDate = new Date(lastReset);
  const brazilOffset = -3 * 60;
  const localLastDate = new Date(lastDate.getTime() + brazilOffset * 60 * 1000);
  const dayOfWeek = localLastDate.getUTCDay();
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const lastWeekStartDate = new Date(localLastDate);
  lastWeekStartDate.setUTCDate(lastWeekStartDate.getUTCDate() - daysToMonday);
  const lastWeekStart = `${lastWeekStartDate.getUTCFullYear()}-${String(lastWeekStartDate.getUTCMonth() + 1).padStart(2, '0')}-${String(lastWeekStartDate.getUTCDate()).padStart(2, '0')}`;
  return today.weekStart !== lastWeekStart;
};

// ═══════════════════════════════════════════════════════════════
// 📝 CONTAGEM DE MENSAGENS
// ═══════════════════════════════════════════════════════════════

const incrementMessageCount = (groupId, userId, userName, messageType = 'text') => {
  const data = loadMsgCounterData();
  const groupData = initGroupCounter(groupId);
  const today = getDateInfo();
  
  // Verificar se é um novo dia
  if (groupData.daily.date !== today.date) {
    groupData.daily = {
      date: today.date,
      total: 0,
      stickers: 0,
      images: 0,
      videos: 0,
      audios: 0,
      users: {},
      goalReached: false,
      goalNotificationSent: false
    };
  }
  
  // Verificar se é uma nova semana
  if (groupData.weekly.weekStart !== today.weekStart) {
    groupData.weekly = {
      weekStart: today.weekStart,
      total: 0,
      stickers: 0,
      images: 0,
      videos: 0,
      audios: 0,
      users: {},
      goalReached: false,
      goalNotificationSent: false
    };
  }
  
  // Inicializar usuário
  initUserCounter(groupData, userId, userName);
  
  // Incrementar contadores
  groupData.daily.total += 1;
  groupData.daily.users[userId].count += 1;
  groupData.daily.users[userId].name = userName || groupData.daily.users[userId].name;
  
  groupData.weekly.total += 1;
  groupData.weekly.users[userId].count += 1;
  groupData.weekly.users[userId].name = userName || groupData.weekly.users[userId].name;
  
  // Incrementar tipo específico
  if (messageType === 'sticker') {
    groupData.daily.stickers += 1;
    groupData.daily.users[userId].stickers += 1;
    groupData.weekly.stickers += 1;
    groupData.weekly.users[userId].stickers += 1;
  } else if (messageType === 'image') {
    groupData.daily.images += 1;
    groupData.daily.users[userId].images += 1;
    groupData.weekly.images += 1;
    groupData.weekly.users[userId].images += 1;
  } else if (messageType === 'video') {
    groupData.daily.videos += 1;
    groupData.daily.users[userId].videos += 1;
    groupData.weekly.videos += 1;
    groupData.weekly.users[userId].videos += 1;
  } else if (messageType === 'audio') {
    groupData.daily.audios += 1;
    groupData.daily.users[userId].audios += 1;
    groupData.weekly.audios += 1;
    groupData.weekly.users[userId].audios += 1;
  }
  
  groupData.lastUpdate = new Date().toISOString();
  data.groups[groupId] = groupData;
  
  saveMsgCounterData(data);
  
  return {
    dailyTotal: groupData.daily.total,
    weeklyTotal: groupData.weekly.total,
    userDaily: groupData.daily.users[userId].count,
    userWeekly: groupData.weekly.users[userId].count
  };
};

// ═══════════════════════════════════════════════════════════════
// 📊 OBTENÇÃO DE ESTATÍSTICAS
// ═══════════════════════════════════════════════════════════════

const getGroupStats = (groupId) => {
  const data = loadMsgCounterData();
  const groupData = data.groups[groupId];
  
  if (!groupData) {
    return {
      daily: { total: 0, users: {} },
      weekly: { total: 0, users: {} },
      settings: { dailyGoal: null, weeklyGoal: null }
    };
  }
  
  const today = getDateInfo();
  
  // Verificar se é um novo dia
  if (groupData.daily.date !== today.date) {
    groupData.daily = {
      date: today.date,
      total: 0,
      users: {},
      goalReached: false,
      goalNotificationSent: false
    };
    data.groups[groupId] = groupData;
    saveMsgCounterData(data);
  }
  
  // Verificar se é uma nova semana
  if (groupData.weekly.weekStart !== today.weekStart) {
    groupData.weekly = {
      weekStart: today.weekStart,
      total: 0,
      users: {},
      goalReached: false,
      goalNotificationSent: false
    };
    data.groups[groupId] = groupData;
    saveMsgCounterData(data);
  }
  
  return {
    daily: groupData.daily,
    weekly: groupData.weekly,
    settings: groupData.settings
  };
};

const getUserStats = (groupId, userId) => {
  const stats = getGroupStats(groupId);
  
  return {
    daily: stats.daily.users[userId] || { name: 'Usuário', count: 0 },
    weekly: stats.weekly.users[userId] || { name: 'Usuário', count: 0 }
  };
};

const getTopUsers = (groupId, period = 'daily', limit = 5) => {
  const stats = getGroupStats(groupId);
  const users = period === 'daily' ? stats.daily.users : stats.weekly.users;
  
  const sortedUsers = Object.entries(users)
    .map(([id, data]) => ({
      id,
      name: data.name,
      count: data.count
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
  
  return sortedUsers;
};

// ═══════════════════════════════════════════════════════════════
// 🏆 RANKS
// ═══════════════════════════════════════════════════════════════

const getUserRank = (groupId, userId, period = 'daily') => {
  const stats = getGroupStats(groupId);
  const users = period === 'daily' ? stats.daily.users : stats.weekly.users;
  const userCount = users[userId]?.count || 0;
  
  const sortedUsers = Object.entries(users)
    .sort((a, b) => b[1].count - a[1].count);
  
  const rank = sortedUsers.findIndex(([id]) => id === userId) + 1;
  
  return {
    rank,
    count: userCount,
    total: sortedUsers.length
  };
};

// ═══════════════════════════════════════════════════════════════
// 🎯 SISTEMA DE METAS
// ═══════════════════════════════════════════════════════════════

const setDailyGoal = (groupId, goal) => {
  const data = loadMsgCounterData();
  initGroupCounter(groupId);
  
  data.groups[groupId].settings.dailyGoal = goal;
  
  // Resetar flags para permitir nova notificação quando a nova meta for atingida
  data.groups[groupId].daily.goalReached = false;
  data.groups[groupId].daily.goalNotificationSent = false;
  
  saveMsgCounterData(data);
  return true;
};

const setWeeklyGoal = (groupId, goal) => {
  const data = loadMsgCounterData();
  initGroupCounter(groupId);
  
  data.groups[groupId].settings.weeklyGoal = goal;
  
  // Resetar flags para permitir nova notificação quando a nova meta for atingida
  data.groups[groupId].weekly.goalReached = false;
  data.groups[groupId].weekly.goalNotificationSent = false;
  
  saveMsgCounterData(data);
  return true;
};

const checkGoals = (groupId) => {
  const data = loadMsgCounterData();
  const groupData = data.groups[groupId];
  
  if (!groupData) return { daily: false, weekly: false };
  
  const results = {
    daily: { reached: false, alreadyNotified: groupData.daily.goalNotificationSent },
    weekly: { reached: false, alreadyNotified: groupData.weekly.goalNotificationSent }
  };
  
  // Verificar meta diária
  if (groupData.settings.dailyGoal && !groupData.daily.goalNotificationSent) {
    if (groupData.daily.total >= groupData.settings.dailyGoal) {
      groupData.daily.goalReached = true;
      groupData.daily.goalNotificationSent = true;
      results.daily.reached = true;
    }
  }
  
  // Verificar meta semanal
  if (groupData.settings.weeklyGoal && !groupData.weekly.goalNotificationSent) {
    if (groupData.weekly.total >= groupData.settings.weeklyGoal) {
      groupData.weekly.goalReached = true;
      groupData.weekly.goalNotificationSent = true;
      results.weekly.reached = true;
    }
  }
  
  saveMsgCounterData(data);
  return results;
};

// ═══════════════════════════════════════════════════════════════
// 🔄 RESET AUTOMÁTICO
// ═══════════════════════════════════════════════════════════════

const resetDailyCounters = () => {
  const data = loadMsgCounterData();
  const today = getDateInfo();
  
  for (const groupId of Object.keys(data.groups)) {
    data.groups[groupId].daily = {
      date: today.date,
      total: 0,
      users: {},
      goalReached: false,
      goalNotificationSent: false
    };
    data.groups[groupId].lastUpdate = new Date().toISOString();
  }
  
  data.lastDailyReset = new Date().toISOString();
  saveMsgCounterData(data);
  
  console.log('🔄 Reset diário de contadores realizado às', new Date().toISOString());
  return true;
};

const resetWeeklyCounters = () => {
  const data = loadMsgCounterData();
  const today = getDateInfo();
  
  for (const groupId of Object.keys(data.groups)) {
    data.groups[groupId].weekly = {
      weekStart: today.weekStart,
      total: 0,
      users: {},
      goalReached: false,
      goalNotificationSent: false
    };
    data.groups[groupId].lastUpdate = new Date().toISOString();
  }
  
  data.lastWeeklyReset = new Date().toISOString();
  saveMsgCounterData(data);
  
  console.log('🔄 Reset semanal de contadores realizado às', new Date().toISOString());
  return true;
};

// ═══════════════════════════════════════════════════════════════
// 📤 MENSAGENS DE RESULTADO
// ═══════════════════════════════════════════════════════════════

const formatTopRanking = (topUsers, period, groupName) => {
  const periodName = period === 'daily' ? 'DIÁRIO' : 'SEMANAL';
  const emoji = period === 'daily' ? '📅' : '📆';
  
  let message = `╭━━━〔 🏆 TOP 5 ${periodName} ]━━━╮\n`;
  message += `┃ ${emoji} Grupo: ${groupName}\n`;
  message += `┣━━━━━━━━━━━━━━━━━━━━\n`;
  
  if (topUsers.length === 0) {
    message += `┃ Nenhuma mensagem ainda\n`;
  } else {
    const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
    topUsers.forEach((user, index) => {
      message += `┃ ${medals[index]} ${user.name}\n`;
      message += `┃    └─ 💬 ${user.count.toLocaleString('pt-BR')} mensagens\n`;
    });
  }
  
  message += `╰━━━━━━━━━━━━━━━━━━━━╯`;
  
  return message;
};

const formatDailyStats = (groupId) => {
  const stats = getGroupStats(groupId);
  const userCount = Object.keys(stats.daily.users).length;
  const topUsers = getTopUsers(groupId, 'daily', 5);
  const userRank = getUserRank(groupId, sender, 'daily'); // sender will be set externally
  
  let message = `╭━━━〔 📊 ESTATÍSTICAS DIÁRIAS 〕━━━╮\n`;
  message += `┃ 💬 Mensagens hoje: ${stats.daily.total.toLocaleString('pt-BR')}\n`;
  message += `┃ 👥 Usuários ativos: ${userCount}\n`;
  if (stats.settings.dailyGoal) {
    const progress = Math.min(100, Math.round((stats.daily.total / stats.settings.dailyGoal) * 100));
    message += `┃ 🎯 Meta: ${stats.settings.dailyGoal.toLocaleString('pt-BR')}\n`;
    message += `┃ 📈 Progresso: ${progress}%\n`;
  }
  message += `╰━━━━━━━━━━━━━━━━━━━━━━━━╯`;
  
  return message;
};

const formatWeeklyStats = (groupId) => {
  const stats = getGroupStats(groupId);
  const userCount = Object.keys(stats.weekly.users).length;
  
  let message = `╭━━━〔 📊 ESTATÍSTICAS SEMANAIS 〕━━━╮\n`;
  message += `┃ 💬 Mensagens na semana: ${stats.weekly.total.toLocaleString('pt-BR')}\n`;
  message += `┃ 👥 Usuários ativos: ${userCount}\n`;
  if (stats.settings.weeklyGoal) {
    const progress = Math.min(100, Math.round((stats.weekly.total / stats.settings.weeklyGoal) * 100));
    message += `┃ 🎯 Meta: ${stats.settings.weeklyGoal.toLocaleString('pt-BR')}\n`;
    message += `┃ 📈 Progresso: ${progress}%\n`;
  }
  message += `╰━━━━━━━━━━━━━━━━━━━━━━━━━━╯`;
  
  return message;
};

// ═══════════════════════════════════════════════════════════════
// 🚀 INICIALIZAÇÃO DO SISTEMA DE RESET AUTOMÁTICO
// ═══════════════════════════════════════════════════════════════

let resetSchedulerInitialized = false;
let nazuInstance = null;

const initResetScheduler = (nazu) => {
  if (resetSchedulerInitialized) return;
  
  nazuInstance = nazu;
  
  // Reset diário às 23:59 (um minuto antes da meia-noite)
  cron.schedule('59 23 * * *', async () => {
    console.log('🔄 Executando reset diário...');
    
    const data = loadMsgCounterData();
    
    // Enviar ranking diário final antes do reset
    for (const groupId of Object.keys(data.groups)) {
      const topUsers = getTopUsers(groupId, 'daily', 5);
      if (topUsers.length > 0 && nazuInstance) {
        try {
          const topMessage = `🌙 ═══ FIM DO DIA ═══ 🌙\n\n🏆 *TOP 5 DIÁRIO FINAL*\n\n${topUsers.map((user, i) => {
  const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
  return `${medals[i]} ${user.name} — ${user.count.toLocaleString('pt-BR')} mensagens`;
}).join('\n')}\n\n📊 Amanhã começa uma nova contagem!`;
          
          await nazuInstance.sendMessage(groupId, { text: topMessage });
        } catch (e) {
          console.error('Erro ao enviar ranking diário final:', e);
        }
      }
    }
    
    resetDailyCounters();
  }, {
    scheduled: true,
    timezone: 'America/Sao_Paulo'
  });
  
  // Reset semanal no domingo às 23:59
  cron.schedule('59 23 * * 0', async () => {
    console.log('🔄 Executando reset semanal...');
    
    const data = loadMsgCounterData();
    
    // Enviar ranking semanal final antes do reset
    for (const groupId of Object.keys(data.groups)) {
      const topUsers = getTopUsers(groupId, 'weekly', 5);
      if (topUsers.length > 0 && nazuInstance) {
        try {
          const topMessage = `🌅 ═══ FIM DA SEMANA ═══ 🌅\n\n🏆 *TOP 5 SEMANAL FINAL*\n\n${topUsers.map((user, i) => {
  const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
  return `${medals[i]} ${user.name} — ${user.count.toLocaleString('pt-BR')} mensagens`;
}).join('\n')}\n\n📊 Nova semana começa agora! Vamos juntos!`;
          
          await nazuInstance.sendMessage(groupId, { text: topMessage });
        } catch (e) {
          console.error('Erro ao enviar ranking semanal final:', e);
        }
      }
    }
    
    resetWeeklyCounters();
  }, {
    scheduled: true,
    timezone: 'America/Sao_Paulo'
  });
  
  resetSchedulerInitialized = true;
  console.log('✅ Sistema de reset automático do contador de mensagens iniciado');
};

// Variável para armazenar o sender (será definido quando o comando for executado)
let sender = null;
const setSender = (userId) => {
  sender = userId;
};

// ═══════════════════════════════════════════════════════════════
// 🧹 LIMPEZA DE USUÁRIos
// ═══════════════════════════════════════════════════════════════

const cleanInactiveUsers = (groupId, activeUserIds) => {
  const data = loadMsgCounterData();
  const groupData = data.groups[groupId];
  
  if (!groupData) return;
  
  // Manter apenas usuários ativos
  const activeSet = new Set(activeUserIds);
  
  for (const userId of Object.keys(groupData.daily.users)) {
    if (!activeSet.has(userId)) {
      delete groupData.daily.users[userId];
    }
  }
  
  for (const userId of Object.keys(groupData.weekly.users)) {
    if (!activeSet.has(userId)) {
      delete groupData.weekly.users[userId];
    }
  }
  
  data.groups[groupId] = groupData;
  saveMsgCounterData(data);
};

// ═══════════════════════════════════════════════════════════════
// 📤 EXPORTAÇÃO
// ═══════════════════════════════════════════════════════════════

export {
  loadMsgCounterData,
  saveMsgCounterData,
  initGroupCounter,
  initUserCounter,
  getDateInfo,
  getDayOfWeek,
  isNewDay,
  isNewWeek,
  incrementMessageCount,
  getGroupStats,
  getUserStats,
  getTopUsers,
  getUserRank,
  setDailyGoal,
  setWeeklyGoal,
  checkGoals,
  resetDailyCounters,
  resetWeeklyCounters,
  formatTopRanking,
  formatDailyStats,
  formatWeeklyStats,
  initResetScheduler,
  setSender,
  cleanInactiveUsers
};

// Export default as an object with all functions
const msgCounterExports = {
  loadMsgCounterData,
  saveMsgCounterData,
  initGroupCounter,
  initUserCounter,
  getDateInfo,
  getDayOfWeek,
  isNewDay,
  isNewWeek,
  incrementMessageCount,
  getGroupStats,
  getUserStats,
  getTopUsers,
  getUserRank,
  setDailyGoal,
  setWeeklyGoal,
  checkGoals,
  resetDailyCounters,
  resetWeeklyCounters,
  formatTopRanking,
  formatDailyStats,
  formatWeeklyStats,
  initResetScheduler,
  setSender,
  cleanInactiveUsers
};

export default msgCounterExports;
