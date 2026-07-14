/**
 * PUBG API Module
 * API Pública da PUBG
 * https://developer.pubg.com
 */

import axios from 'axios';
import { getApiKey as dbGetApiKey } from '../utils/database.js';

// URLs das APIs
const PUBG_API_URL = 'https://api.pubg.com';
const SHROUD_API_URL = 'https://api.pubg.sh';

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

// Obter API Key do banco de dados
const getApiKey = () => {
  try {
    const keyData = dbGetApiKey('pubg');
    return keyData?.key || null;
  } catch (e) {
    return null;
  }
};

// Verificar se a API está configurada
const isApiConfigured = () => {
  return !!getApiKey();
};

// Normalizar nome do jogador
const normalizeName = (name) => {
  if (!name) return '';
  return name.trim().replace(/\s+/g, '%20');
};

// Obter estatísticas do jogador via API pública (shrouds)
const getPlayerStats = async (playerName) => {
  const cacheKey = `pubg_${playerName.toLowerCase()}`;
  
  const cached = getCache(cacheKey);
  if (cached) {
    return { ok: true, data: cached };
  }

  if (!isApiConfigured()) {
    return { ok: false, msg: '❌ API Key não configurada. Use !keypubg <api_key>' };
  }

  try {
    const apiKey = getApiKey();
    
    // Usar API oficial com headers necessários
    const response = await axios.get(`${PUBG_API_URL}/shards/steam/players?filter[playerNames]=${normalizeName(playerName)}`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/vnd.api+json'
      },
      timeout: 15000
    });

    if (!response.data?.data || response.data.data.length === 0) {
      return { ok: false, msg: '❌ Jogador não encontrado.' };
    }

    const playerData = response.data.data[0];
    const playerId = playerData.id;
    
    // Buscar estatísticas de temporada
    const seasonId = 'division.bro.official.pc-2018-01'; // Temporada padrão (pode variar)
    
    try {
      const statsResponse = await axios.get(`${PUBG_API_URL}/shards/steam/players/${playerId}/seasons/${seasonId}/ranked`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/vnd.api+json'
        },
        timeout: 15000
      });

      const rankedStats = statsResponse.data?.data?.attributes?.rankedGameModeStats;

      const data = {
        id: playerId,
        name: playerData.attributes.stats?.name || playerName,
        shardId: playerData.attributes.shardId,
        stats: playerData.attributes.stats ? {
          level: playerData.attributes.stats.level || 0,
          kills: playerData.attributes.stats.kills || 0,
          deaths: playerData.attributes.stats.deaths || 0,
          kd: playerData.attributes.stats.kills && playerData.attributes.stats.deaths 
            ? (playerData.attributes.stats.kills / playerData.attributes.stats.deaths).toFixed(2) 
            : '0.00',
          wins: playerData.attributes.stats.wins || 0,
          losses: playerData.attributes.stats.losses || 0,
          winRate: playerData.attributes.stats.wins && playerData.attributes.stats.games > 0
            ? ((playerData.attributes.stats.wins / playerData.attributes.stats.games) * 100).toFixed(1)
            : '0',
          gamesPlayed: playerData.attributes.stats.games || 0,
          headshots: playerData.attributes.stats.headshotKills || 0,
          headshotRate: playerData.attributes.stats.headshotKills && playerData.attributes.stats.kills > 0
            ? ((playerData.attributes.stats.headshotKills / playerData.attributes.stats.kills) * 100).toFixed(1)
            : '0',
          roadKills: playerData.attributes.stats.roadKills || 0,
          vehicleKills: playerData.attributes.stats.vehicleKills || 0,
          longestKill: playerData.attributes.stats.longestKill?.toFixed(0) || 0,
          damageDealt: playerData.attributes.stats.damageDealt?.toFixed(0) || 0,
          heals: playerData.attributes.stats.heals || 0,
          revives: playerData.attributes.stats.revives || 0,
          walkDistance: ((playerData.attributes.stats.walkDistance || 0) / 1000).toFixed(1),
          rideDistance: ((playerData.attributes.stats.rideDistance || 0) / 1000).toFixed(1),
          avgSurvivalTime: playerData.attributes.stats.averageSurvivalTime 
            ? (playerData.attributes.stats.averageSurvivalTime / 60).toFixed(1) 
            : '0'
        } : null,
        raw: playerData
      };

      setCache(cacheKey, data);
      return { ok: true, data };
      
    } catch (statsError) {
      // Se não conseguir estatísticas detalhadas, retorna dados básicos
      const data = {
        id: playerId,
        name: playerData.attributes.stats?.name || playerName,
        shardId: playerData.attributes.shardId,
        stats: playerData.attributes.stats ? {
          kills: playerData.attributes.stats.kills || 0,
          deaths: playerData.attributes.stats.deaths || 0,
          wins: playerData.attributes.stats.wins || 0,
          gamesPlayed: playerData.attributes.stats.games || 0
        } : null,
        message: 'Estatísticas detalhadas não disponíveis para esta temporada'
      };

      setCache(cacheKey, data);
      return { ok: true, data };
    }

  } catch (error) {
    if (error.response?.status === 404) {
      return { ok: false, msg: '❌ Jogador não encontrado. Verifique o nome.' };
    }
    if (error.response?.status === 401 || error.response?.status === 403) {
      return { ok: false, msg: '❌ API Key inválida ou sem permissão.' };
    }
    if (error.response?.status === 429) {
      return { ok: false, msg: '❌ Limite de requisições excedido.' };
    }
    console.error('Erro ao buscar jogador PUBG:', error.message);
    return { ok: false, msg: '❌ Erro ao buscar dados do jogador.' };
  }
};

// Obter perfil do jogador
const getPlayer = async (playerName) => {
  if (!playerName) {
    return { ok: false, msg: '❌ Nome do jogador é obrigatório.' };
  }
  return getPlayerStats(playerName);
};

// Obter matches recentes
const getRecentMatches = async (playerName) => {
  const cacheKey = `pubg_matches_${playerName.toLowerCase()}`;
  
  const cached = getCache(cacheKey);
  if (cached) {
    return { ok: true, data: cached };
  }

  if (!isApiConfigured()) {
    return { ok: false, msg: '❌ API Key não configurada.' };
  }

  try {
    const apiKey = getApiKey();
    
    const response = await axios.get(`${PUBG_API_URL}/shards/steam/players?filter[playerNames]=${normalizeName(playerName)}`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/vnd.api+json'
      },
      timeout: 15000
    });

    if (!response.data?.data || response.data.data.length === 0) {
      return { ok: false, msg: '❌ Jogador não encontrado.' };
    }

    const playerData = response.data.data[0];
    const matches = playerData.relationships?.matches?.data || [];
    
    const matchList = matches.slice(0, 5).map(match => ({
      id: match.id,
      matchId: match.id
    }));

    setCache(cacheKey, matchList);
    return { ok: true, data: matchList };

  } catch (error) {
    console.error('Erro ao buscar matches PUBG:', error.message);
    return { ok: false, msg: '❌ Erro ao buscar partidas.' };
  }
};

// Obter informações de um match específico
const getMatchInfo = async (matchId) => {
  const cacheKey = `pubg_match_${matchId}`;
  
  const cached = getCache(cacheKey);
  if (cached) {
    return { ok: true, data: cached };
  }

  if (!isApiConfigured()) {
    return { ok: false, msg: '❌ API Key não configurada.' };
  }

  try {
    const apiKey = getApiKey();
    
    const response = await axios.get(`${PUBG_API_URL}/shards/steam/matches/${matchId}`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/vnd.api+json'
      },
      timeout: 15000
    });

    const matchData = response.data;
    
    const data = {
      id: matchData.data?.id,
      gameMode: matchData.data?.attributes?.gameMode,
      mapName: matchData.data?.attributes?.mapName,
      duration: Math.floor((matchData.data?.attributes?.duration || 0) / 60),
      createdAt: matchData.data?.attributes?.createdAt,
      matchType: matchData.data?.attributes?.matchType,
      telemetryUrl: matchData.data?.relationships?.assets?.data?.[0]?.id
    };

    setCache(cacheKey, data);
    return { ok: true, data };

  } catch (error) {
    if (error.response?.status === 404) {
      return { ok: false, msg: '❌ Partida não encontrada.' };
    }
    console.error('Erro ao buscar match PUBG:', error.message);
    return { ok: false, msg: '❌ Erro ao buscar partida.' };
  }
};

export {
  isApiConfigured,
  getPlayer,
  getPlayerStats,
  getRecentMatches,
  getMatchInfo
};
