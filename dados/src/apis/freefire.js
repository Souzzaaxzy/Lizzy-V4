/**
 * Free Fire API Module
 * Utiliza a Free Fire Community API
 * ES Modules compatible
 */

import { getApiKey as dbGetApiKey } from '../utils/database.js';

// Cache para armazenar respostas (5 minutos)
const cache = new Map();
const CACHE_DURATION = 5 * 60 * 1000;

// Limpa cache antigo periodicamente
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of cache.entries()) {
    if (now - value.timestamp > CACHE_DURATION) {
      cache.delete(key);
    }
  }
}, 60000);

const setCache = (key, data) => {
  cache.set(key, { data, timestamp: Date.now() });
};

const getCache = (key) => {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.data;
  }
  cache.delete(key);
  return null;
};

const getApiKey = () => {
  try {
    return dbGetApiKey('freefire');
  } catch (e) {
    return null;
  }
};

const fetchWithTimeout = async (url, options = {}, timeout = 10000) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
};

const formatDuration = (seconds) => {
  if (!seconds || isNaN(seconds)) return 'Não informado';
  
  const horas = Math.floor(seconds / 3600);
  const minutos = Math.floor((seconds % 3600) / 60);
  const segs = seconds % 60;
  
  let resultado = [];
  if (horas > 0) resultado.push(`${horas}h`);
  if (minutos > 0) resultado.push(`${minutos}m`);
  if (segs > 0 || resultado.length === 0) resultado.push(`${segs}s`);
  
  return resultado.join(' ');
};

const formatDate = (dateString) => {
  if (!dateString) return 'Não informado';
  
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return 'Não informado';
    
    const dia = String(date.getDate()).padStart(2, '0');
    const mes = String(date.getMonth() + 1).padStart(2, '0');
    const ano = date.getFullYear();
    
    return `${dia}/${mes}/${ano}`;
  } catch (e) {
    return 'Não informado';
  }
};

const summarizeDescription = (description) => {
  if (!description) return 'Não informado';
  
  let summary = description.replace(/[\n\r\t]+/g, ' ').trim();
  
  if (summary.length > 100) {
    summary = summary.substring(0, 97) + '...';
  }
  
  return summary || 'Não informado';
};

const isApiConfigured = () => {
  const apiKey = getApiKey();
  return apiKey && apiKey.key;
};

const getProfile = async (playerId) => {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { ok: false, msg: '❌ A API Key do Free Fire ainda não foi configurada pelo proprietário do bot.' };
  }

  const cacheKey = `profile_${playerId}`;
  const cached = getCache(cacheKey);
  if (cached) {
    return { ok: true, data: cached };
  }

  try {
    const response = await fetchWithTimeout(
      `https://api.ffmptools.com/api/free-fire/player/info?playerId=${playerId}&apiKey=${apiKey.key}`
    );

    if (!response.ok) {
      if (response.status === 404) {
        return { ok: false, msg: '❌ UID não encontrado.' };
      }
      throw new Error(`HTTP ${response.status}`);
    }

    const result = await response.json();

    if (!result.success || !result.data) {
      return { ok: false, msg: '❌ UID não encontrado.' };
    }

    const data = result.data;
    
    const profile = {
      nickname: data.nickname || null,
      uid: data.playerId || playerId,
      level: data.level || null,
      likes: data.likes || null,
      region: data.region || null,
      guild: data.crewName || null,
      guildId: data.crewId || null,
      avatar: data.avatar || null,
      banner: data.banner || null,
      rank: data.brRank || null,
      csRank: data.csRank || null,
      pet: data.pet || null,
      bio: data.bio || null
    };

    setCache(cacheKey, profile);
    return { ok: true, data: profile };

  } catch (error) {
    if (error.name === 'AbortError') {
      return { ok: false, msg: '❌ A consulta demorou mais que o esperado.' };
    }
    console.error('Erro ao buscar perfil Free Fire:', error);
    return { ok: false, msg: '❌ O serviço do Free Fire está indisponível. Tente novamente em alguns minutos.' };
  }
};

const getStats = async (playerId) => {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { ok: false, msg: '❌ A API Key do Free Fire ainda não foi configurada pelo proprietário do bot.' };
  }

  const cacheKey = `stats_${playerId}`;
  const cached = getCache(cacheKey);
  if (cached) {
    return { ok: true, data: cached };
  }

  try {
    const response = await fetchWithTimeout(
      `https://api.ffmptools.com/api/free-fire/player/stats?playerId=${playerId}&apiKey=${apiKey.key}`
    );

    if (!response.ok) {
      if (response.status === 404) {
        return { ok: false, msg: '❌ UID não encontrado.' };
      }
      throw new Error(`HTTP ${response.status}`);
    }

    const result = await response.json();

    if (!result.success || !result.data) {
      return { ok: false, msg: '❌ UID não encontrado.' };
    }

    const data = result.data;
    const stats = data.stats || data;

    const statsFormatted = {
      brMatches: stats.brMatches || stats.matches || stats.games || null,
      brWins: stats.brWins || stats.wins || null,
      brKills: stats.brKills || stats.kills || null,
      brDeaths: stats.brDeaths || stats.deaths || null,
      brKd: stats.brKd || stats.kd || null,
      brHeadshots: stats.brHeadshots || stats.headshots || null,
      brHeadshotRate: stats.brHeadshotRate || stats.headshotRate || null,
      csMatches: stats.csMatches || stats.csGames || null,
      csWins: stats.csWins || null,
      csKills: stats.csKills || null,
      wins: stats.wins || stats.brWins || null,
      losses: stats.losses || stats.deaths || null,
      gamesPlayed: stats.gamesPlayed || stats.matches || stats.brMatches || null,
      playTime: stats.playTime || stats.timePlayed || formatDuration(stats.secondsPlayed),
      secondsPlayed: stats.secondsPlayed || null,
      season: data.season || null,
      currentRank: data.currentRank || null,
      maxRank: data.maxRank || null
    };

    if (!statsFormatted.brKd && statsFormatted.brKills && statsFormatted.brDeaths) {
      statsFormatted.brKd = (statsFormatted.brKills / Math.max(1, statsFormatted.brDeaths)).toFixed(2);
    }

    if (!statsFormatted.brHeadshotRate && statsFormatted.brHeadshots && statsFormatted.brKills) {
      statsFormatted.brHeadshotRate = ((statsFormatted.brHeadshots / Math.max(1, statsFormatted.brKills)) * 100).toFixed(1);
    }

    setCache(cacheKey, statsFormatted);
    return { ok: true, data: statsFormatted };

  } catch (error) {
    if (error.name === 'AbortError') {
      return { ok: false, msg: '❌ A consulta demorou mais que o esperado.' };
    }
    console.error('Erro ao buscar estatísticas Free Fire:', error);
    return { ok: false, msg: '❌ O serviço do Free Fire está indisponível. Tente novamente em alguns minutos.' };
  }
};

const getGuild = async (guildId) => {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { ok: false, msg: '❌ A API Key do Free Fire ainda não foi configurada pelo proprietário do bot.' };
  }

  const cacheKey = `guild_${guildId}`;
  const cached = getCache(cacheKey);
  if (cached) {
    return { ok: true, data: cached };
  }

  try {
    const response = await fetchWithTimeout(
      `https://api.ffmptools.com/api/free-fire/guild/info?guildId=${guildId}&apiKey=${apiKey.key}`
    );

    if (!response.ok) {
      if (response.status === 404) {
        return { ok: false, msg: '❌ ID da guilda não encontrado.' };
      }
      throw new Error(`HTTP ${response.status}`);
    }

    const result = await response.json();

    if (!result.success || !result.data) {
      return { ok: false, msg: '❌ ID da guilda não encontrado.' };
    }

    const data = result.data;

    const guild = {
      name: data.name || data.crewName || null,
      id: data.id || guildId,
      leader: data.leaderName || data.leader || null,
      leaderId: data.leaderId || null,
      memberCount: data.memberCount || data.members || null,
      maxMembers: data.maxMembers || 50,
      level: data.level || data.guildLevel || null,
      slogan: data.slogan || data.description || null,
      region: data.region || null
    };

    setCache(cacheKey, guild);
    return { ok: true, data: guild };

  } catch (error) {
    if (error.name === 'AbortError') {
      return { ok: false, msg: '❌ A consulta demorou mais que o esperado.' };
    }
    console.error('Erro ao buscar guilda Free Fire:', error);
    return { ok: false, msg: '❌ O serviço do Free Fire está indisponível. Tente novamente em alguns minutos.' };
  }
};

const checkBan = async (playerId) => {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { ok: false, msg: '❌ A API Key do Free Fire ainda não foi configurada pelo proprietário do bot.' };
  }

  const cacheKey = `ban_${playerId}`;
  const cached = getCache(cacheKey);
  if (cached) {
    return { ok: true, data: cached };
  }

  try {
    const response = await fetchWithTimeout(
      `https://api.ffmptools.com/api/free-fire/player/ban?playerId=${playerId}&apiKey=${apiKey.key}`
    );

    if (!response.ok) {
      if (response.status === 404) {
        return { ok: false, msg: '❌ UID não encontrado.' };
      }
      throw new Error(`HTTP ${response.status}`);
    }

    const result = await response.json();

    const banStatus = {
      isBanned: result.data?.isBanned || result.isBanned || false,
      bannedAt: result.data?.bannedAt || result.bannedAt || null,
      reason: result.data?.reason || result.reason || null,
      expiresAt: result.data?.expiresAt || result.expiresAt || null
    };

    setCache(cacheKey, banStatus);
    return { ok: true, data: banStatus };

  } catch (error) {
    if (error.name === 'AbortError') {
      return { ok: false, msg: '❌ A consulta demorou mais que o esperado.' };
    }
    console.error('Erro ao verificar banimento Free Fire:', error);
    return { ok: false, msg: '❌ O serviço do Free Fire está indisponível. Tente novamente em alguns minutos.' };
  }
};

const getWishlist = async (playerId) => {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { ok: false, msg: '❌ A API Key do Free Fire ainda não foi configurada pelo proprietário do bot.' };
  }

  const cacheKey = `wishlist_${playerId}`;
  const cached = getCache(cacheKey);
  if (cached) {
    return { ok: true, data: cached };
  }

  try {
    const response = await fetchWithTimeout(
      `https://api.ffmptools.com/api/free-fire/player/wishlist?playerId=${playerId}&apiKey=${apiKey.key}`
    );

    if (!response.ok) {
      if (response.status === 404) {
        return { ok: false, msg: '❌ UID não encontrado.' };
      }
      if (response.status === 400 || response.status === 500) {
        return { ok: true, data: { items: [], skins: [], emotes: [], collections: [], recentItems: [], count: 0 } };
      }
      throw new Error(`HTTP ${response.status}`);
    }

    const result = await response.json();

    if (!result.success && result.msg !== 'No wishlist data available') {
      return { ok: true, data: { items: [], skins: [], emotes: [], collections: [], recentItems: [], count: 0 } };
    }

    const wishlist = {
      items: result.data?.items || [],
      skins: result.data?.skins || [],
      emotes: result.data?.emote || [],
      collections: result.data?.collections || [],
      recentItems: result.data?.recentItems || [],
      count: result.data?.count || 0
    };

    setCache(cacheKey, wishlist);
    return { ok: true, data: wishlist };

  } catch (error) {
    if (error.name === 'AbortError') {
      return { ok: false, msg: '❌ A consulta demorou mais que o esperado.' };
    }
    if (error.message.includes('400') || error.message.includes('500')) {
      return { ok: true, data: { items: [], skins: [], emotes: [], collections: [], recentItems: [], count: 0 } };
    }
    console.error('Erro ao buscar wishlist Free Fire:', error);
    return { ok: false, msg: '❌ O serviço do Free Fire está indisponível. Tente novamente em alguns minutos.' };
  }
};

export {
  isApiConfigured,
  getProfile,
  getStats,
  getGuild,
  checkBan,
  getWishlist,
  formatDuration,
  formatDate,
  summarizeDescription
};
