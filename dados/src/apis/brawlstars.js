/**
 * Brawl Stars API Module
 * API Oficial da Supercell
 * https://developer.clashroyale.com
 * (Mesma API Key do Clash Royale)
 */

import axios from 'axios';
import { getApiKey as dbGetApiKey } from '../utils/database.js';

// Configuração da API
const API_BASE_URL = 'https://api.brawlstars.com/v1';

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

// Obter API Key do banco de dados (usa a mesma do Clash Royale)
const getApiKey = () => {
  try {
    const keyData = dbGetApiKey('clashroyale');
    return keyData?.key || null;
  } catch (e) {
    return null;
  }
};

// Verificar se a API está configurada
const isApiConfigured = () => {
  return !!getApiKey();
};

// Criar cliente axios com headers
const createClient = () => {
  const apiKey = getApiKey();
  return axios.create({
    baseURL: API_BASE_URL,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    timeout: 15000
  });
};

// Normalizar tag do jogador (adicionar # se necessário)
const normalizeTag = (tag) => {
  if (!tag) return '';
  const cleanTag = tag.trim().replace(/^#/, '').toUpperCase();
  return cleanTag;
};

// Obter informações do jogador
const getPlayer = async (playerTag) => {
  const tag = normalizeTag(playerTag);
  const cacheKey = `player_${tag}`;
  
  const cached = getCache(cacheKey);
  if (cached) {
    return { ok: true, data: cached };
  }

  if (!isApiConfigured()) {
    return { ok: false, msg: '❌ API Key não configurada. Use !keybs <api_key>' };
  }

  try {
    const client = createClient();
    const response = await client.get(`/players/%23${tag}`);
    const player = response.data;

    const data = {
      tag: player.tag,
      name: player.name,
      trophies: player.trophies,
      highestTrophies: player.highestTrophies,
      expLevel: player.expLevel,
      expPoints: player.expPoints,
      wins: player.wins,
      losses: player.losses,
      draws: player.draws || 0,
      winRate: player.wins && (player.wins + player.losses + (player.draws || 0)) > 0
        ? ((player.wins / (player.wins + player.losses + (player.draws || 0))) * 100).toFixed(1)
        : '0',
      totalBattles: player.battleStatistics?.total || 0,
      soloVictories: player.soloVictories || 0,
      duoVictories: player.duoVictories || 0,
      teamVictories: player.teamVictories || 0,
      club: player.club ? {
        tag: player.club.tag,
        name: player.club.name
      } : null,
      brawlers: player.brawlers?.slice(0, 10).map(b => ({
        id: b.id,
        name: b.name,
        power: b.power,
        rank: b.rank,
        trophies: b.trophies
      })) || [],
      raw: player
    };

    setCache(cacheKey, data);
    return { ok: true, data };

  } catch (error) {
    if (error.response) {
      if (error.response.status === 404) {
        return { ok: false, msg: '❌ Jogador não encontrado. Verifique a tag.' };
      }
      if (error.response.status === 403) {
        return { ok: false, msg: '❌ API Key inválida ou sem permissão.' };
      }
      if (error.response.status === 429) {
        return { ok: false, msg: '❌ Limite de requisições excedido. Tente novamente em alguns minutos.' };
      }
    }
    console.error('Erro ao buscar jogador Brawl Stars:', error.message);
    return { ok: false, msg: '❌ Erro ao buscar dados do jogador.' };
  }
};

// Obter batalhas recentes do jogador
const getPlayerBattles = async (playerTag, limit = 5) => {
  const tag = normalizeTag(playerTag);
  const cacheKey = `battles_${tag}`;
  
  const cached = getCache(cacheKey);
  if (cached) {
    return { ok: true, data: cached };
  }

  if (!isApiConfigured()) {
    return { ok: false, msg: '❌ API Key não configurada.' };
  }

  try {
    const client = createClient();
    const response = await client.get(`/players/%23${tag}/battlelog`);
    const battles = response.data.items.slice(0, limit).map(battle => {
      const battleData = battle.battle || battle;
      const isVictory = battleData.result === 'victory';
      
      return {
        mode: battleData.mode,
        type: battleData.type,
        result: battleData.result,
        trophyChange: battleData.trophyChange || 0,
        timestamp: battle.battleTime,
        player: {
          tag: battle.player?.tag,
          name: battle.player?.name,
          brawler: battleData.player?.brawler?.name || battleData.player?.brawler?.name || 'Brawler'
        },
        teams: {
          winners: battleData.teams?.[0]?.map(p => p.name) || [],
          losers: battleData.teams?.[1]?.map(p => p.name) || []
        },
        isVictory: isVictory,
        raw: battle
      };
    });

    setCache(cacheKey, battles);
    return { ok: true, data: battles };

  } catch (error) {
    if (error.response?.status === 404) {
      return { ok: false, msg: '❌ Jogador não encontrado ou sem batalhas.' };
    }
    if (error.response?.status === 429) {
      return { ok: false, msg: '❌ Limite de requisições excedido.' };
    }
    console.error('Erro ao buscar batalhas:', error.message);
    return { ok: false, msg: '❌ Erro ao buscar batalhas.' };
  }
};

// Obter informações do clube
const getClub = async (clubTag) => {
  const tag = normalizeTag(clubTag);
  const cacheKey = `club_${tag}`;
  
  const cached = getCache(cacheKey);
  if (cached) {
    return { ok: true, data: cached };
  }

  if (!isApiConfigured()) {
    return { ok: false, msg: '❌ API Key não configurada.' };
  }

  try {
    const client = createClient();
    const response = await client.get(`/clubs/%23${tag}`);
    const club = response.data;

    const data = {
      tag: club.tag,
      name: club.name,
      description: club.description || 'Sem descrição',
      type: club.type,
      badgeId: club.badgeId,
      requiredTrophies: club.requiredTrophies,
      trophies: club.trophies,
      members: club.members?.length || 0,
      memberList: club.members?.slice(0, 10).map(m => ({
        tag: m.tag,
        name: m.name,
        role: m.role,
        trophies: m.trophies
      })) || [],
      raw: club
    };

    setCache(cacheKey, data);
    return { ok: true, data };

  } catch (error) {
    if (error.response?.status === 404) {
      return { ok: false, msg: '❌ Clube não encontrado.' };
    }
    if (error.response?.status === 429) {
      return { ok: false, msg: '❌ Limite de requisições excedido.' };
    }
    console.error('Erro ao buscar clube:', error.message);
    return { ok: false, msg: '❌ Erro ao buscar dados do clube.' };
  }
};

// Obter ranking de jogadores
const getTopPlayers = async (limit = 10) => {
  const cacheKey = `top_players_${limit}`;
  
  const cached = getCache(cacheKey);
  if (cached) {
    return { ok: true, data: cached };
  }

  if (!isApiConfigured()) {
    return { ok: false, msg: '❌ API Key não configurada.' };
  }

  try {
    const client = createClient();
    const response = await client.get(`/rankings/br/players?limit=${limit}`);
    
    const players = response.data.items.map((p, index) => ({
      rank: index + 1,
      tag: p.tag,
      name: p.name,
      trophies: p.trophies,
      club: p.club?.name || 'Sem clube'
    }));

    setCache(cacheKey, players);
    return { ok: true, data: players };

  } catch (error) {
    if (error.response?.status === 429) {
      return { ok: false, msg: '❌ Limite de requisições excedido.' };
    }
    console.error('Erro ao buscar ranking:', error.message);
    return { ok: false, msg: '❌ Erro ao buscar ranking.' };
  }
};

// Obter ranking de clubes
const getTopClubs = async (limit = 10) => {
  const cacheKey = `top_clubs_${limit}`;
  
  const cached = getCache(cacheKey);
  if (cached) {
    return { ok: true, data: cached };
  }

  if (!isApiConfigured()) {
    return { ok: false, msg: '❌ API Key não configurada.' };
  }

  try {
    const client = createClient();
    const response = await client.get(`/rankings/br/clubs?limit=${limit}`);
    
    const clubs = response.data.items.map((c, index) => ({
      rank: index + 1,
      tag: c.tag,
      name: c.name,
      trophies: c.trophies,
      memberCount: c.members || 0
    }));

    setCache(cacheKey, clubs);
    return { ok: true, data: clubs };

  } catch (error) {
    if (error.response?.status === 429) {
      return { ok: false, msg: '❌ Limite de requisições excedido.' };
    }
    console.error('Erro ao buscar ranking de clubes:', error.message);
    return { ok: false, msg: '❌ Erro ao buscar ranking.' };
  }
};

// Obter informações de um brawler
const getBrawler = async (brawlerId) => {
  const cacheKey = `brawler_${brawlerId}`;
  
  const cached = getCache(cacheKey);
  if (cached) {
    return { ok: true, data: cached };
  }

  if (!isApiConfigured()) {
    return { ok: false, msg: '❌ API Key não configurada.' };
  }

  try {
    const client = createClient();
    const response = await client.get(`/brawlers/${brawlerId}`);
    const brawler = response.data;

    const data = {
      id: brawler.id,
      name: brawler.name,
      description: brawler.description,
      class: brawler.class?.name || 'Desconhecida',
      rarity: brawler.rarity?.name || 'Desconhecida',
      unlockPower: brawler.unlockPower || 1,
      powerLevels: brawler.powerLevels || 10,
      speed: brawler.speed || 0,
      health: brawler.health || 0,
      raw: brawler
    };

    setCache(cacheKey, data);
    return { ok: true, data };

  } catch (error) {
    if (error.response?.status === 404) {
      return { ok: false, msg: '❌ Brawler não encontrado.' };
    }
    console.error('Erro ao buscar brawler:', error.message);
    return { ok: false, msg: '❌ Erro ao buscar brawler.' };
  }
};

export {
  isApiConfigured,
  getPlayer,
  getPlayerBattles,
  getClub,
  getTopPlayers,
  getTopClubs,
  getBrawler,
  normalizeTag
};
