/**
 * League of Legends API Module
 * API da Riot Games
 * https://developer.riotgames.com
 * (Mesma API Key do Valorant)
 */

import axios from 'axios';
import { getApiKey as dbGetApiKey } from '../utils/database.js';

// URLs das APIs - usar região br1 como padrão
const API_BASE_URL = 'https://br1.api.riotgames.com/lol';

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
    const keyData = dbGetApiKey('valorant');
    return keyData?.key || null;
  } catch (e) {
    return null;
  }
};

// Verificar se a API está configurada
const isApiConfigured = () => {
  return !!getApiKey();
};

// Criar cliente axios
const createClient = () => {
  const apiKey = getApiKey();
  return axios.create({
    baseURL: API_BASE_URL,
    headers: {
      'X-Riot-Token': apiKey
    },
    timeout: 15000
  });
};

// Obter informações do invocador
const getPlayer = async (summonerName) => {
  if (!summonerName) {
    return { ok: false, msg: '❌ Nome do invocador é obrigatório.' };
  }
  
  const cacheKey = `lol_player_${summonerName.toLowerCase()}`;
  
  const cached = getCache(cacheKey);
  if (cached) {
    return { ok: true, data: cached };
  }

  if (!isApiConfigured()) {
    return { ok: false, msg: '❌ API Key não configurada. Use !keyvalorant <api_key>' };
  }

  try {
    const client = createClient();
    
    // Buscar invocador
    const response = await client.get(`/summoner/v4/summoners/by-name/${encodeURIComponent(summonerName)}`);
    const summoner = response.data;

    // Buscar rank
    const rankResponse = await client.get(`/league/v4/entries/by-summoner/${summoner.id}`);
    const rankedData = rankResponse.data;

    // Processar dados de rank
    const soloRank = rankedData.find(q => q.queueType === 'RANKED_SOLO_5x5');
    const flexRank = rankedData.find(q => q.queueType === 'RANKED_FLEX_SR');

    // Formatar emblema
    const getTierEmoji = (tier) => {
      const emojis = {
        'IRON': '⚫',
        'BRONZE': '🟤',
        'SILVER': '⚪',
        'GOLD': '🟡',
        'PLATINUM': '🟢',
        'DIAMOND': '🔵',
        'MASTER': '🟣',
        'GRANDMASTER': '🔴',
        'CHALLENGER': '⭐'
      };
      return emojis[tier?.toUpperCase()] || '❓';
    };

    const data = {
      id: summoner.id,
      accountId: summoner.accountId,
      puuid: summoner.puuid,
      name: summoner.name,
      level: summoner.summonerLevel,
      profileIconId: summoner.profileIconId,
      profileIconUrl: `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/profile-icons/${summoner.profileIconId}.jpg`,
      soloQueue: soloRank ? {
        tier: soloRank.tier,
        rank: soloRank.rank,
        lp: soloRank.leaguePoints,
        wins: soloRank.wins,
        losses: soloRank.losses,
        winRate: ((soloRank.wins / (soloRank.wins + soloRank.losses)) * 100).toFixed(1),
        emoji: getTierEmoji(soloRank.tier)
      } : null,
      flexQueue: flexRank ? {
        tier: flexRank.tier,
        rank: flexRank.rank,
        lp: flexRank.leaguePoints,
        wins: flexRank.wins,
        losses: flexRank.losses,
        winRate: ((flexRank.wins / (flexRank.wins + flexRank.losses)) * 100).toFixed(1),
        emoji: getTierEmoji(flexRank.tier)
      } : null,
      raw: { summoner, rankedData }
    };

    setCache(cacheKey, data);
    return { ok: true, data };

  } catch (error) {
    console.error('Erro LoL:', error.response?.status, error.message);
    
    if (error.response?.status === 404) {
      return { ok: false, msg: `❌ Invocador "${summonerName}" não encontrado.\n\n💡 Verifique se o nome está correto e se está na região BR.` };
    }
    if (error.response?.status === 403) {
      return { ok: false, msg: '❌ API Key inválida ou sem permissão na API do LoL.\n💡 Use !keyriot <sua_key> para configurar.' };
    }
    if (error.response?.status === 429) {
      return { ok: false, msg: '❌ Limite de requisições excedido. Tente novamente em alguns minutos.' };
    }
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      return { ok: false, msg: '❌ Não foi possível conectar à API da Riot. Tente novamente.' };
    }
    return { ok: false, msg: `❌ Erro: ${error.message}` };
  }
};

// Obter lista de mestre/challenger do servidor
const getChallengerPlayers = async () => {
  const cacheKey = 'lol_challenger';
  
  const cached = getCache(cacheKey);
  if (cached) {
    return { ok: true, data: cached };
  }

  if (!isApiConfigured()) {
    return { ok: false, msg: '❌ API Key não configurada.' };
  }

  try {
    const client = createClient();
    const response = await client.get('/league/v4/challengerleagues/by-queue/RANKED_SOLO_5x5');
    
    const players = response.data.entries.slice(0, 10).map((entry, index) => ({
      rank: index + 1,
      name: entry.summonerName,
      leaguePoints: entry.leaguePoints,
      wins: entry.wins,
      losses: entry.losses,
      winRate: ((entry.wins / (entry.wins + entry.losses)) * 100).toFixed(1)
    }));

    setCache(cacheKey, players);
    return { ok: true, data: players };

  } catch (error) {
    console.error('Erro ao buscar challenger:', error.message);
    return { ok: false, msg: '❌ Erro ao buscar ranking challenger.' };
  }
};

// Obter lista de mestre
const getMasterPlayers = async () => {
  const cacheKey = 'lol_master';
  
  const cached = getCache(cacheKey);
  if (cached) {
    return { ok: true, data: cached };
  }

  if (!isApiConfigured()) {
    return { ok: false, msg: '❌ API Key não configurada.' };
  }

  try {
    const client = createClient();
    const response = await client.get('/league/v4/masterleagues/by-queue/RANKED_SOLO_5x5');
    
    const players = response.data.entries.slice(0, 10).map((entry, index) => ({
      rank: index + 1,
      name: entry.summonerName,
      leaguePoints: entry.leaguePoints,
      wins: entry.wins,
      losses: entry.losses,
      winRate: ((entry.wins / (entry.wins + entry.losses)) * 100).toFixed(1)
    }));

    setCache(cacheKey, players);
    return { ok: true, data: players };

  } catch (error) {
    console.error('Erro ao buscar master:', error.message);
    return { ok: false, msg: '❌ Erro ao buscar ranking master.' };
  }
};

export {
  isApiConfigured,
  getPlayer,
  getChallengerPlayers,
  getMasterPlayers
};
