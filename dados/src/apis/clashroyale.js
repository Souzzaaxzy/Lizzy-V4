/**
 * Clash Royale API Module
 * API Oficial da Supercell
 * https://developer.clashroyale.com
 */

import axios from 'axios';

// Configuração da API
const API_BASE_URL = 'https://api.clashroyale.com/v1';
const API_KEY = process.env.CLASH_ROYALE_API_KEY || '';

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

// Verificar se a API está configurada
const isApiConfigured = () => {
  return !!API_KEY;
};

// Criar cliente axios com headers
const createClient = () => {
  return axios.create({
    baseURL: API_BASE_URL,
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
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
    return { ok: false, msg: '❌ API Key do Clash Royale não configurada.' };
  }

  try {
    const client = createClient();
    const response = await client.get(`/players/%23${tag}`);
    const player = response.data;

    const data = {
      tag: player.tag,
      name: player.name,
      trophies: player.trophies,
      bestTrophies: player.bestTrophies,
      level: player.expLevel,
      wins: player.wins,
      losses: player.losses,
      totalBattles: player.battleCount,
      winRate: player.wins && player.battleCount 
        ? ((player.wins / player.battleCount) * 100).toFixed(1) 
        : '0',
      threeCrownWins: player.threeCrownWins,
      cardsFound: player.cards ? player.cards.length : 0,
      currentFavouriteCard: player.currentFavouriteCard?.name || 'Nenhuma',
      clan: player.clan ? {
        tag: player.clan.tag,
        name: player.clan.name,
        role: player.clan.role,
        badgeId: player.clan.badgeId
      } : null,
      arena: {
        id: player.arena?.id,
        name: player.arena?.name
      },
      leagueStatistics: player.leagueStatistics || null,
      achievements: player.achievements || [],
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
    console.error('Erro ao buscar jogador Clash Royale:', error.message);
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
    return { ok: false, msg: '❌ API Key do Clash Royale não configurada.' };
  }

  try {
    const client = createClient();
    const response = await client.get(`/players/%23${tag}/battles`);
    const battles = response.data.slice(0, limit).map(battle => ({
      type: battle.type,
      mode: battle.gameMode?.name || battle.type,
      result: battle.team[0].crowns > battle.opponent[0].crowns ? 'victory' : 
              battle.team[0].crowns < battle.opponent[0].crowns ? 'defeat' : 'draw',
      crowns: {
        team: battle.team[0].crowns,
        opponent: battle.opponent[0].crowns
      },
      deck: battle.team[0].cards?.map(c => c.name) || [],
      opponent: {
        name: battle.opponent[0].name || 'Oponente',
        tag: battle.opponent[0].tag,
        trophies: battle.opponent[0].trophies
      },
      timestamp: battle.battleTime,
      raw: battle
    }));

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

// Obter informações do clã
const getClan = async (clanTag) => {
  const tag = normalizeTag(clanTag);
  const cacheKey = `clan_${tag}`;
  
  const cached = getCache(cacheKey);
  if (cached) {
    return { ok: true, data: cached };
  }

  if (!isApiConfigured()) {
    return { ok: false, msg: '❌ API Key do Clash Royale não configurada.' };
  }

  try {
    const client = createClient();
    const response = await client.get(`/clans/%23${tag}`);
    const clan = response.data;

    const data = {
      tag: clan.tag,
      name: clan.name,
      description: clan.description || 'Sem descrição',
      type: clan.type,
      badgeId: clan.badgeId,
      clanScore: clan.clanScore,
      clanWarTrophies: clan.clanWarTrophies,
      requiredTrophies: clan.requiredTrophies,
      donationsPerWeek: clan.donationsPerWeek,
      memberCount: clan.members?.length || 0,
      location: clan.location?.name || 'Global',
      warDay: clan.warDay || 0,
      warLeague: clan.warLeague?.name || 'Sem guerra',
      members: clan.members?.slice(0, 10).map(m => ({
        tag: m.tag,
        name: m.name,
        role: m.role,
        trophies: m.trophies,
        donations: m.donations,
        donationsReceived: m.donationsReceived
      })) || [],
      raw: clan
    };

    setCache(cacheKey, data);
    return { ok: true, data };

  } catch (error) {
    if (error.response?.status === 404) {
      return { ok: false, msg: '❌ Clã não encontrado.' };
    }
    if (error.response?.status === 429) {
      return { ok: false, msg: '❌ Limite de requisições excedido.' };
    }
    console.error('Erro ao buscar clã:', error.message);
    return { ok: false, msg: '❌ Erro ao buscar dados do clã.' };
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
    return { ok: false, msg: '❌ API Key do Clash Royale não configurada.' };
  }

  try {
    const client = createClient();
    const response = await client.get(`/locations/global/players?limit=${limit}`);
    
    const players = response.data.map((p, index) => ({
      rank: index + 1,
      tag: p.tag,
      name: p.name,
      trophies: p.trophies,
      clan: p.clan?.name || 'Sem clã',
      arena: p.arena?.name || 'Desconhecida'
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

// Obter ranking de clãs
const getTopClans = async (limit = 10) => {
  const cacheKey = `top_clans_${limit}`;
  
  const cached = getCache(cacheKey);
  if (cached) {
    return { ok: true, data: cached };
  }

  if (!isApiConfigured()) {
    return { ok: false, msg: '❌ API Key do Clash Royale não configurada.' };
  }

  try {
    const client = createClient();
    const response = await client.get(`/locations/global/clans?limit=${limit}`);
    
    const clans = response.data.map((c, index) => ({
      rank: index + 1,
      tag: c.tag,
      name: c.name,
      clanScore: c.clanScore,
      warTrophies: c.clanWarTrophies,
      memberCount: c.members?.length || 0,
      badgeId: c.badgeId
    }));

    setCache(cacheKey, clans);
    return { ok: true, data: clans };

  } catch (error) {
    if (error.response?.status === 429) {
      return { ok: false, msg: '❌ Limite de requisições excedido.' };
    }
    console.error('Erro ao buscar ranking de clãs:', error.message);
    return { ok: false, msg: '❌ Erro ao buscar ranking.' };
  }
};

// Obter cartas do jogo
const getCards = async () => {
  const cacheKey = 'cards_all';
  
  const cached = getCache(cacheKey);
  if (cached) {
    return { ok: true, data: cached };
  }

  if (!isApiConfigured()) {
    return { ok: false, msg: '❌ API Key do Clash Royale não configurada.' };
  }

  try {
    const client = createClient();
    const response = await client.get('/cards');
    
    const cards = response.data.map(c => ({
      id: c.id,
      name: c.name,
      rarity: c.rarity,
      elixirCost: c.elixirCost,
      type: c.type,
      arena: c.arena,
      description: c.description
    }));

    setCache(cacheKey, cards);
    return { ok: true, data: cards };

  } catch (error) {
    console.error('Erro ao buscar cartas:', error.message);
    return { ok: false, msg: '❌ Erro ao buscar cartas.' };
  }
};

// Obter torneios
const getTournaments = async (searchQuery = '', limit = 5) => {
  if (!isApiConfigured()) {
    return { ok: false, msg: '❌ API Key do Clash Royale não configurada.' };
  }

  try {
    const client = createClient();
    const query = searchQuery ? `?name=${encodeURIComponent(searchQuery)}` : '';
    const response = await client.get(`/tournaments${query}&limit=${limit}`);
    
    const tournaments = response.data.map(t => ({
      tag: t.tag,
      name: t.name,
      status: t.status,
      maxPlayers: t.maxPlayers,
      currentPlayers: t.currentPlayers,
      createdTime: t.createdTime,
      preparationTime: t.preparationTime,
      startedTime: t.startedTime,
      finishedTime: t.finishedTime
    }));

    return { ok: true, data: tournaments };

  } catch (error) {
    console.error('Erro ao buscar torneios:', error.message);
    return { ok: false, msg: '❌ Erro ao buscar torneios.' };
  }
};

export {
  isApiConfigured,
  getPlayer,
  getPlayerBattles,
  getClan,
  getTopPlayers,
  getTopClans,
  getCards,
  getTournaments,
  normalizeTag
};
