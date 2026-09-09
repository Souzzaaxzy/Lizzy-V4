/**
 * Spotify Download - Implementação direta sem API externa
 * Busca: API oficial do Spotify (Client Credentials, requer SPOTIFY_CLIENT_ID/SECRET no .env)
 *         com fallback para Brave Search e vreden.my.id
 * Download: spotisaver.net (terceiro, não oficial)
 */

import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const SEARCH_BASE_URL = 'https://vreden.my.id';
const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';
const DOWNLOAD_BASE_URL = 'https://spotisaver.net';
const BRAVE_SEARCH_URL = 'https://search.brave.com/search';
const BRAVE_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

// Cache de busca Brave (parcial, por query)
const braveCache = new Map();
const BRAVE_CACHE_TTL = 60 * 60 * 1000;
function getBraveCached(key) {
  const item = braveCache.get(key);
  if (!item) return null;
  if (Date.now() - item.ts > BRAVE_CACHE_TTL) {
    braveCache.delete(key);
    return null;
  }
  return item.val;
}
function setBraveCache(key, val) {
  if (braveCache.size >= 500) {
    const oldestKey = braveCache.keys().next().value;
    braveCache.delete(oldestKey);
  }
  braveCache.set(key, { val, ts: Date.now() });
}

// Cache simples
const cache = new Map();
const CACHE_TTL = 30 * 60 * 1000;

function getCached(key) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() - item.ts > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return item.val;
}

function setCache(key, val) {
  if (cache.size >= 500) {
    const oldestKey = cache.keys().next().value;
    cache.delete(oldestKey);
  }
  cache.set(key, { val, ts: Date.now() });
}

// Headers para spotisaver
const SPOTISAVER_HEADERS = {
  'accept': '*/*',
  'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
  'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1'
};

/**
 * Extrair ID da track do Spotify de uma URL
 */
function extractTrackId(url) {
  if (!url) return null;
  const trackMatch = url.match(/track\/([a-zA-Z0-9]+)/);
  return trackMatch ? trackMatch[1] : null;
}

/**
 * Valida se é uma URL válida do Spotify
 */
function isValidSpotifyUrl(url) {
  if (!url || typeof url !== 'string') return false;
  return url.includes('open.spotify.com/') || url.includes('spotify.com/');
}

/**
 * Busca músicas no Spotify
 * @param {string} query - Nome da música ou artista
 * @param {number} limit - Número de resultados
 * @returns {Promise<Object>} Resultados da busca
 */
/**
 * Busca tracks do Spotify via Brave Search (HTML publico, sem API)
 */
async function searchViaBrave(query) {
  try {
    const cached = getBraveCached('brave:' + query);
    if (cached) return cached;
    const response = await fetch(BRAVE_SEARCH_URL + '?q=' + encodeURIComponent(query + ' site:open.spotify.com/track'), {
      headers: {
        'User-Agent': BRAVE_USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        'Referer': 'https://search.brave.com/',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'same-origin',
        'Upgrade-Insecure-Requests': '1'
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(45000)
    });
    if (!response.ok) {
      return { ok: false, msg: 'Busca Brave indisponível (status ' + response.status + ')' };
    }
    const html = await response.text();
    const urlRegex = new RegExp('https://open\\.spotify\\.com/track/[a-zA-Z0-9]+', 'g');
    const uniqueUrls = [...new Set(html.match(urlRegex) || [])].slice(0, 5);
    const found = [];
    for (const url of uniqueUrls) {
      const pos = html.indexOf(url);
      const segment = html.slice(pos, pos + 3000);
      const tm = segment.match(/title="([^"]+)"[^>]*>[^<]*/);
      let title = tm ? tm[1].replace(/\| Spotify$/i, '').trim() : url;
      const titleMatch = title.match(/^(.*?)\s*-\s*song and lyrics by (.*)$/i);
      const name = titleMatch ? titleMatch[1].trim() : title.split('|')[0].trim();
      const artist = titleMatch ? titleMatch[2].trim() : '';
      found.push({ name, artist, song_link: url, link: url, source: 'brave' });
    }
    if (!found.length) return { ok: false, msg: 'Nenhuma música encontrada no Brave Search' };
    setBraveCache('brave:' + query, found);
    return { ok: true, results: found };
  } catch (error) {
    console.error('Erro na busca Brave do Spotify:', error.message);
    return { ok: false, msg: 'Erro na busca Brave do Spotify: ' + error.message };
  }
}

// ── Busca oficial (API do Spotify, Client Credentials) ────────────────
let spotifyTokenCache = null;
async function getSpotifyToken() {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;

  if (spotifyTokenCache && spotifyTokenCache.expiresAt > Date.now() + 60000) {

    return spotifyTokenCache.token;
  }
  if (!id || !secret) throw new Error('SPOTIFY_CREDENTIALS_MISSING');
  const basic = Buffer.from(`${id}:${secret}`).toString('base64');
  const res = await axios.post('https://accounts.spotify.com/api/token',
    new URLSearchParams({ grant_type: 'client_credentials' }),
    {
      timeout: 15000,
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    }
  );
  const token = res.data?.access_token;
  if (!token) throw new Error('SPOTIFY_TOKEN_FAIL');
  spotifyTokenCache = { token, expiresAt: Date.now() + (res.data.expires_in || 3600) * 1000 };
  return token;
}

/** Monta o mesmo formato devolvido pela busca (results[].name/artist/song_link/link). */
function mapSpotifyTrack(track) {

  const artists = Array.isArray(track.artists) ? track.artists.map(a => a.name) : [];
  return {
    name: track.name,
    artist: artists.join(', '),
    artists: artists,
    song_link: track.external_urls?.spotify || `https://open.spotify.com/track/${track.id}`,
    link: track.external_urls?.spotify || `https://open.spotify.com/track/${track.id}`,
    id: track.id,
    duration_ms: track.duration_ms,
    album: track.album?.name,
    image: track.album?.images?.[1]?.url || track.album?.images?.[0]?.url || null,
    source: 'spotify-api'
  };
}

async function searchViaSpotifyAPI(query) {
  try {
    const token = await getSpotifyToken();
    const res = await axios.get(`${SPOTIFY_API_BASE}/search`, {
      params: {
        q: query,
        type: 'track',
        limit: 5
      },
      timeout: 15000,
      headers: { Authorization: `Bearer ${token}` }
    });
    const tracks = res.data?.tracks?.items;
    if (!Array.isArray(tracks) || !tracks.length) return { ok: false, msg: 'Nenhuma música encontrada no Spotify' };
    const results = tracks.filter(t => t && t.id && t.external_urls?.spotify).map(mapSpotifyTrack);
    if (!results.length) return { ok: false, msg: 'Nenhuma música encontrada no Spotify' };
    return { ok: true, results };
  } catch (error) {
    if (error.message === 'SPOTIFY_CREDENTIALS_MISSING' || error.message === 'SPOTIFY_TOKEN_FAIL') {
      return { ok: false, msg: error.message, code: 'NOT_CONFIGURED' };
    }
    console.error('Falha na busca oficial do Spotify:', error.message);
    return { ok: false, msg: 'Falha na busca oficial do Spotify: ' + error.message };
  }
}

async function search(query) {
  try {
    if (!query || typeof query !== 'string') {
      return {
        ok: false,
        msg: 'Query inválida'
      };
    }

    const cached = getCached(`search:${query}`);
    if (cached) return cached;

    try {
      const official = await searchViaSpotifyAPI(query);
      if (official.ok && official.results.length) {
        const result = {
          ok: true,
          query,
          total: official.results.length,
          results: official.results,
          source: 'spotify-api'
        };
        setCache(`search:${query}`, result);
        return result;
      }
    } catch (officialError) {
      console.error('Falha na busca oficial do Spotify, tentando Brave:', officialError.message);
    }

    try {
      const brave = await searchViaBrave(query);
      if (brave.ok && brave.results.length) {
        const result = {
          ok: true,
          query,
          total: brave.results.length,
          results: brave.results,
          source: 'brave'
        };
        setCache(`search:${query}`, result);
        return result;
      }
      if (brave.msg) {
        return { ok: false, query, msg: brave.msg };
      }
    } catch (braveError) {
      console.error('Falha na busca Brave, tentando vreden:', braveError.message);
    }

    const response = await axios.get(`${SEARCH_BASE_URL}/api/v2/search/spotify`, {
      params: {
        query: query,
      },
      timeout: 120000
    });

    if (!response.data || (response.data.status_code !== undefined && response.data.status_code !== 200)) {
      const apiMsg = response.data?.message || response.data?.msg || 'Erro ao buscar no Spotify';
      return {
        ok: false,
        msg: apiMsg
      };
    }

    const raw = response.data.result ?? response.data.data ?? response.data.results ?? [];
    const list = Array.isArray(raw)
      ? raw
      : Array.isArray(raw.search_data)
        ? raw.search_data
        : Array.isArray(raw.tracks)
          ? raw.tracks
          : Array.isArray(raw.data)
            ? raw.data
            : [];

    const result = {
      ok: true,
      query,
      total: list.length,
      results: list
    };

    setCache(`search:${query}`, result);
    return result;
  } catch (error) {
    console.error('Erro na busca do Spotify:', error.message);
    return {
      ok: false,
      msg: 'Erro ao buscar no Spotify: ' + error.message
    };
  }
}

/**
 * Faz download direto de uma música do Spotify via URL
 * @param {string} url - URL do track do Spotify
 * @returns {Promise<Object>} Dados do download
 */
async function download(url) {
  try {
    // Validação melhorada da URL
    if (!isValidSpotifyUrl(url)) {
      console.log('[Spotify] URL inválida:', url);
      return {
        ok: false,
        msg: 'URL inválida do Spotify. Certifique-se de usar uma URL do Spotify válida.'
      };
    }

    // Verificar cache
    const cached = getCached(`download:${url}`);
    if (cached) return cached;

    // Extrair ID da track
    const trackId = extractTrackId(url);
    if (!trackId) {
      console.log('[Spotify] Não foi possível extrair ID da URL:', url);
      return {
        ok: false,
        msg: 'Não foi possível extrair o ID da música. Verifique se a URL está correta.'
      };
    }

    console.log(`[Spotify] Processando track ID: ${trackId}`);

    // Etapa 1: Obter informações da faixa
    const infoResponse = await axios.get(`${DOWNLOAD_BASE_URL}/api/get_playlist.php`, {
      params: {
        id: trackId,
        type: 'track',
        lang: 'en'
      },
      headers: {
        ...SPOTISAVER_HEADERS,
        'referer': `${DOWNLOAD_BASE_URL}/en/track/${trackId}/`
      },
      timeout: 120000
    });

    const trackData = infoResponse.data?.tracks?.[0];
    
    if (!trackData) {
      return {
        ok: false,
        msg: 'Informações da música não encontradas'
      };
    }

    console.log(`[Spotify] 🎵 Música: ${trackData.name}`);
    console.log(`[Spotify] 🎤 Artista: ${trackData.artists?.[0]}`);

    // Etapa 2: Preparar payload para download
    const payload = {
      track: {
        name: trackData.name,
        artists: trackData.artists || [],
        album: trackData.album,
        image: {
          url: trackData.image?.url,
          width: trackData.image?.width || 640,
          height: trackData.image?.height || 640
        },
        id: trackId,
        external_url: trackData.external_url,
        duration_ms: trackData.duration_ms,
        preview_url: trackData.preview_url || null,
        explicit: trackData.explicit || false,
        release_date: trackData.release_date
      },
      download_dir: 'downloads',
      filename_tag: 'SPOTISAVER',
      user_ip: '138.118.236.9',
      is_premium: false
    };

    // Etapa 3: Baixar a música
    console.log(`[Spotify] ⬇️  Iniciando download...`);
    
    const downloadResponse = await axios.post(
      `${DOWNLOAD_BASE_URL}/api/download_track.php`,
      payload,
      {
        headers: {
          ...SPOTISAVER_HEADERS,
          'content-type': 'application/json',
          'origin': DOWNLOAD_BASE_URL,
          'referer': `${DOWNLOAD_BASE_URL}/en/track/${trackId}/`
        },
        timeout: 120000,
        responseType: 'arraybuffer'
      }
    );

    console.log(`[Spotify] ✅ Download concluído`);

    const artists = Array.isArray(trackData.artists) ? trackData.artists : [trackData.artists];

    const result = {
      ok: true,
      buffer: Buffer.from(downloadResponse.data),
      title: trackData.name,
      artists: artists,
      albumImage: trackData.image?.url,
      year: trackData.release_date?.split('-')[0],
      duration: trackData.duration_ms,
      filename: `${artists.join(', ')} - ${trackData.name}.mp3`
    };

    setCache(`download:${url}`, result);
    return result;
  } catch (error) {
    console.error('Erro no download do Spotify:', error.message);
    
    if (error.response?.status === 404) {
      return {
        ok: false,
        msg: 'Música não encontrada no Spotify'
      };
    }
    
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      return {
        ok: false,
        msg: 'Timeout ao baixar a música. Tente novamente.'
      };
    }

    return {
      ok: false,
      msg: error.message || 'Erro ao baixar do Spotify'
    };
  }
}

/**
 * Busca e faz download de uma música do Spotify
 * @param {string} query - Nome da música ou artista
 * @returns {Promise<Object>} Dados da busca e download
 */
async function searchDownload(query) {
  try {
    // Buscar primeiro resultado
    const searchResult = await search(query);
    
    if (!searchResult.ok || !searchResult.results?.length) {
      return {
        ok: false,
        msg: 'Nenhuma música encontrada com esse nome'
      };
    }

    const track = searchResult.results[0];
    
    if (!track.song_link) {
      return {
        ok: false,
        msg: 'Link da música não encontrado'
      };
    }

    // Fazer download
    const downloadResult = await download(track.song_link);
    
    if (!downloadResult.ok) {
      return downloadResult;
    }

    return {
      ok: true,
      buffer: downloadResult.buffer,
      query,
      track: {
        name: track.name,
        artists: track.artists,
        link: track.link
      },
      title: downloadResult.title,
      artists: downloadResult.artists,
      albumImage: downloadResult.albumImage,
      year: downloadResult.year,
      duration: downloadResult.duration,
      filename: downloadResult.filename
    };
  } catch (error) {
    console.error('Erro na busca/download do Spotify:', error.message);
    return {
      ok: false,
      msg: error.message || 'Erro ao buscar no Spotify'
    };
  }
}

export default {
  download,
  search,
  searchDownload
};