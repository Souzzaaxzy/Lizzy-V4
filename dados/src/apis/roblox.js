/**
 * Roblox API Module
 * API Pública - Não requer API Key
 * https://api.roblox.com
 */

import axios from 'axios';

// Configuração da API
const API_BASE_URL = 'https://users.roblox.com/v1';
const THUMBNAIL_URL = 'https://thumbnails.roblox.com/v1';
const GAMES_URL = 'https://games.roblox.com/v1';

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

// Verificar se a API está configurada (sempre true - pública)
const isApiConfigured = () => {
  return true;
};

// Criar cliente axios
const createClient = (baseURL) => {
  return axios.create({
    baseURL,
    timeout: 15000
  });
};

// Buscar usuário por nome de usuário
const getUserByUsername = async (username) => {
  if (!username) return null;
  
  try {
    const client = createClient(API_BASE_URL);
    const response = await client.post('/users/get-by-username', {
      usernames: [username],
      excludeBannedUsers: false
    });
    
    if (response.data?.data?.length > 0) {
      return response.data.data[0];
    }
    return null;
  } catch (error) {
    console.error('Erro ao buscar usuário por nome:', error.message);
    return null;
  }
};

// Obter informações do usuário por ID
const getUserById = async (userId) => {
  const cacheKey = `user_${userId}`;
  
  const cached = getCache(cacheKey);
  if (cached) {
    return { ok: true, data: cached };
  }

  try {
    const client = createClient(API_BASE_URL);
    const response = await client.get(`/users/${userId}`);
    const user = response.data;

    // Buscar thumbnail
    let avatarUrl = '';
    try {
      const thumbClient = createClient(THUMBNAIL_URL);
      const thumbResponse = await thumbClient.get(`/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png&isCircular=false`);
      if (thumbResponse.data?.data?.[0]?.imageUrl) {
        avatarUrl = thumbResponse.data.data[0].imageUrl;
      }
    } catch (e) {
      // Thumbnail é opcional
    }

    const data = {
      id: user.id,
      username: user.name,
      displayName: user.displayName,
      description: user.description || 'Sem descrição',
      createdAt: user.created,
      updatedAt: user.updated,
      isBanned: user.isBanned || false,
      avatarUrl: avatarUrl,
      raw: user
    };

    setCache(cacheKey, data);
    return { ok: true, data };

  } catch (error) {
    if (error.response?.status === 404) {
      return { ok: false, msg: '❌ Usuário não encontrado.' };
    }
    console.error('Erro ao buscar usuário Roblox:', error.message);
    return { ok: false, msg: '❌ Erro ao buscar dados do usuário.' };
  }
};

// Obter perfil completo (usuário + stats)
const getPlayer = async (usernameOrId) => {
  // Primeiro tenta buscar por nome se não for número
  let userId = null;
  
  if (/^\d+$/.test(usernameOrId)) {
    userId = parseInt(usernameOrId);
  } else {
    const user = await getUserByUsername(usernameOrId);
    if (user) {
      userId = user.id;
    }
  }

  if (!userId) {
    return { ok: false, msg: '❌ Usuário não encontrado.' };
  }

  return getUserById(userId);
};

// Obter estatísticas do usuário (presença, etc)
const getUserPresence = async (userId) => {
  const cacheKey = `presence_${userId}`;
  
  const cached = getCache(cacheKey);
  if (cached) {
    return { ok: true, data: cached };
  }

  try {
    const client = createClient('https://presence.roblox.com/v1');
    const response = await client.post('/users/get-presence', {
      userIds: [parseInt(userId)]
    });
    
    const presence = response.data?.userPresences?.[0];
    
    if (!presence) {
      return { ok: false, msg: '❌ Não foi possível obter presença.' };
    }

    let statusText = 'Offline';
    let gameInfo = '';
    
    if (presence.userPresenceType === 1) {
      statusText = '🟢 Online';
    } else if (presence.userPresenceType === 2) {
      statusText = '🎮 In Game';
      if (presence.lastLocation) {
        gameInfo = `\n🎯 Jogando: ${presence.lastLocation}`;
      }
    } else if (presence.userPresenceType === 3) {
      statusText = '📱 No Mobile';
      if (presence.lastLocation) {
        gameInfo = `\n🎯 Jogando: ${presence.lastLocation}`;
      }
    } else {
      statusText = '⚫ Offline';
    }

    const data = {
      status: statusText,
      lastLocation: presence.lastLocation || 'N/A',
      placeId: presence.lastLocation !== 'Offline' ? presence.gameId : null,
      raw: presence
    };

    setCache(cacheKey, data);
    return { ok: true, data };

  } catch (error) {
    console.error('Erro ao buscar presença:', error.message);
    return { ok: false, msg: '❌ Erro ao buscar presença.' };
  }
};

// Obter jogos favoritos do usuário
const getFavoriteGames = async (userId) => {
  const cacheKey = `favorites_${userId}`;
  
  const cached = getCache(cacheKey);
  if (cached) {
    return { ok: true, data: cached };
  }

  try {
    const client = createClient(GAMES_URL);
    const response = await client.get(`/users/${userId}/games?accessFilter=2&limit=10`);
    
    const games = response.data?.data?.map(game => ({
      id: game.id,
      name: game.name,
      description: game.description || 'Sem descrição',
      thumbUrl: game.thumbnail?.url || '',
      playing: game.playing || 0,
      visits: game.visits || 0,
      maxPlayers: game.maxPlayers || 0
    })) || [];

    setCache(cacheKey, games);
    return { ok: true, data: games };

  } catch (error) {
    console.error('Erro ao buscar jogos favoritos:', error.message);
    return { ok: false, msg: '❌ Erro ao buscar jogos.' };
  }
};

// Buscar usuários por nome (autocomplete)
const searchUsers = async (query) => {
  if (!query || query.length < 3) {
    return { ok: false, msg: '❌ Digite pelo menos 3 caracteres.' };
  }

  try {
    const client = createClient(API_BASE_URL);
    const response = await client.post('/users/get-by-username', {
      usernames: [query],
      excludeBannedUsers: false
    });

    if (response.data?.data?.length > 0) {
      const user = response.data.data[0];
      return { 
        ok: true, 
        data: {
          id: user.id,
          name: user.name,
          displayName: user.displayName
        }
      };
    }
    
    return { ok: false, msg: '❌ Nenhum usuário encontrado.' };

  } catch (error) {
    console.error('Erro ao buscar usuários:', error.message);
    return { ok: false, msg: '❌ Erro ao buscar usuários.' };
  }
};

export {
  isApiConfigured,
  getPlayer,
  getUserById,
  getUserByUsername,
  getUserPresence,
  getFavoriteGames,
  searchUsers
};
