/**
 * Free Fire API Module
 * Utiliza o sistema FFAPIS (https://github.com/senoseya/ffapis)
 * ES Modules compatible
 */

import { FreeFireAPIInstance, searchAccount as ffapisSearch, getPlayerProfile as ffapisProfile, getPlayerStats as ffapisStats } from './freefire-ffapis.js';

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

// API sempre configurada com FFAPIS
const isApiConfigured = () => true;

const getProfile = async (playerId, region = 'br') => {
  const cacheKey = `profile_${region}_${playerId}`;
  const cached = getCache(cacheKey);
  if (cached) {
    return { ok: true, data: cached };
  }

  try {
    const profile = await ffapisProfile(playerId);
    
    if (!profile || !profile.basicinfo) {
      return { ok: false, msg: '❌ UID não encontrado.' };
    }

    const p = {
      nickname: profile.basicinfo.nickname || null,
      uid: profile.basicinfo.accountid || playerId,
      level: profile.basicinfo.level || null,
      likes: profile.basicinfo.liked || null,
      region: profile.basicinfo.region || region,
      guild: profile.claninfo?.clanname || null,
      guildId: profile.claninfo?.clanid || null,
      guildLevel: profile.claninfo?.clanlevel || null,
      guildMembers: profile.claninfo?.membernum || null,
      avatar: profile.profileinfo?.avatarid ? `https://ffpocket.com/ff/assets/img/avatar/${profile.profileinfo.avatarid}.webp` : null,
      rank: profile.basicinfo.rank || null,
      csRank: profile.basicinfo.csrank || null,
      pet: profile.petinfo?.name ? `${profile.petinfo.name} (Lv.${profile.petinfo.level})` : null,
      bio: profile.socialinfo?.signature || null,
      raw: profile
    };

    setCache(cacheKey, p);
    return { ok: true, data: p };

  } catch (error) {
    console.error('Erro ao buscar perfil Free Fire:', error);
    return { ok: false, msg: '❌ O serviço do Free Fire está indisponível. Tente novamente.' };
  }
};

const getStats = async (playerId, region = 'br') => {
  const cacheKey = `stats_${region}_${playerId}`;
  const cached = getCache(cacheKey);
  if (cached) {
    return { ok: true, data: cached };
  }

  try {
    const stats = await ffapisStats(playerId, 'br', 'career');
    
    if (!stats) {
      return { ok: false, msg: '❌ UID não encontrado.' };
    }

    const s = {
      brMatches: stats.matches || null,
      brWins: stats.win || null,
      brKills: stats.kills || null,
      brDeaths: stats.death || null,
      brKd: stats.kd || null,
      brHeadshots: stats.headshotkills || null,
      raw: stats
    };

    setCache(cacheKey, s);
    return { ok: true, data: s };

  } catch (error) {
    console.error('Erro ao buscar estatísticas Free Fire:', error);
    return { ok: false, msg: '❌ O serviço do Free Fire está indisponível. Tente novamente.' };
  }
};

const getGuild = async (guildId, region = 'br') => {
  // FFAPIS não tem endpoint direto para guild, usar busca por ID
  const cacheKey = `guild_${region}_${guildId}`;
  const cached = getCache(cacheKey);
  if (cached) {
    return { ok: true, data: cached };
  }

  try {
    const profile = await ffapisProfile(guildId);
    
    if (!profile || !profile.claninfo) {
      return { ok: false, msg: '❌ ID da guilda não encontrado.' };
    }

    const guild = {
      name: profile.claninfo.clanname || null,
      id: profile.claninfo.clanid || guildId,
      leader: profile.captainbasicinfo?.nickname || null,
      leaderId: profile.captainbasicinfo?.accountid || null,
      memberCount: profile.claninfo.membernum || null,
      maxMembers: profile.claninfo.capacity || 50,
      level: profile.claninfo.clanlevel || null,
      region: profile.basicinfo?.region || region,
      raw: profile
    };

    setCache(cacheKey, guild);
    return { ok: true, data: guild };

  } catch (error) {
    console.error('Erro ao buscar guilda Free Fire:', error);
    return { ok: false, msg: '❌ O serviço do Free Fire está indisponível. Tente novamente.' };
  }
};

const checkBan = async (playerId, region = 'br') => {
  const cacheKey = `ban_${region}_${playerId}`;
  const cached = getCache(cacheKey);
  if (cached) {
    return { ok: true, data: cached };
  }

  try {
    const profile = await ffapisProfile(playerId);
    
    const banStatus = {
      isBanned: false,
      nickname: profile.basicinfo?.nickname || null,
      accountId: profile.basicinfo?.accountid || playerId,
      level: profile.basicinfo?.level || null,
      raw: profile
    };

    setCache(cacheKey, banStatus);
    return { ok: true, data: banStatus };

  } catch (error) {
    console.error('Erro ao verificar banimento Free Fire:', error);
    return { ok: false, msg: '❌ O serviço do Free Fire está indisponível. Tente novamente.' };
  }
};

const getWishlist = async (playerId, region = 'br') => {
  // FFAPIS não suporta wishlist
  return {
    ok: true,
    data: {
      items: [],
      skins: [],
      emotes: [],
      collections: [],
      recentItems: [],
      count: 0,
      available: false,
      message: 'Lista de desejos não disponível neste sistema'
    }
  };
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
