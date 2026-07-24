// Import jimp first to ensure image processing library is available for baileys
import 'jimp';
import fsPromises from 'fs/promises';
import {
  downloadContentFromMessage,
  generateWAMessageFromContent,
  generateWAMessage,
  generateForwardMessageContent,
  getContentType,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  generateMessageID
} from '@itsliaaa/baileys';
import { handleFut, handleFutCommand } from './games/futebol/index.js';
import dotenv from 'dotenv';
// Imports para sistema de Games
import { 
  getProfile as ffGetProfile, 
  getStats as ffGetStats, 
  getGuild as ffGetGuild, 
  checkBan as ffCheckBan, 
  getWishlist as ffGetWishlist, 
  isApiConfigured as ffIsApiConfigured,
  formatDate as ffFormatDate
} from './apis/freefire.js';
// Clash Royale API
import {
  getPlayer as crGetPlayer,
  getPlayerBattles as crGetPlayerBattles,
  getClan as crGetClan,
  getTopPlayers as crGetTopPlayers,
  getTopClans as crGetTopClans,
  normalizeTag as crNormalizeTag
} from './apis/clashroyale.js';
// Brawl Stars API
import {
  getPlayer as bsGetPlayer,
  getPlayerBattles as bsGetPlayerBattles,
  getClub as bsGetClub,
  getTopPlayers as bsGetTopPlayers,
  getTopClubs as bsGetTopClubs,
  getBrawler as bsGetBrawler
} from './apis/brawlstars.js';
// Clash of Clans API
import {
  getPlayer as cocGetPlayer,
  getClan as cocGetClan,
  getClanWar as cocGetClanWar,
  getTopPlayers as cocGetTopPlayers,
  getTopClans as cocGetTopClans
} from './apis/clashofclans.js';
// Roblox API (pública, sem key)
import {
  getPlayer as robloxGetPlayer,
  getUserPresence as robloxGetPresence,
  getFavoriteGames as robloxGetFavorites,
  searchUsers as robloxSearch
} from './apis/roblox.js';
// Valorant API (Riot Games)
import {
  getPlayer as valorantGetPlayer,
  getMatchHistory as valorantGetMatches,
  getLeaderboard as valorantGetLeaderboard
} from './apis/valorant.js';
// League of Legends API (Riot Games)
import {
  getPlayer as lolGetPlayer,
  getChallengerPlayers as lolGetChallenger,
  getMasterPlayers as lolGetMaster
} from './apis/lol.js';
// PUBG API
import {
  getPlayer as pubgGetPlayer,
  getRecentMatches as pubgGetMatches
} from './apis/pubg.js';
import { 
  setApiKey, 
  deleteApiKey, 
  getApiKey, 
  getAllApiKeysStatus 
} from './utils/database.js';
// Suprimir warnings de execuções perdidas do node-cron
const originalWarn = console.warn;
console.warn = (...args) => {
  if (args[0] && args[0].includes && args[0].includes('missed execution')) return;
  originalWarn.apply(console, args);
};
// Funç