// ═══════════════════════════════════════════════════════════════
// 🏆 SISTEMA DE FUTEBOL GLOBAL - KAISERBOT
// Banco de dados principal
// ═══════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Diretório do banco de dados
const DB_DIR = path.join(__dirname, '../../database/futebol');
const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

ensureDir(DB_DIR);

// Arquivos do banco de dados
const FILES = {
  PLAYERS: path.join(DB_DIR, 'players.json'),
  CLUBS: path.join(DB_DIR, 'clubs.json'),
  MATCHES: path.join(DB_DIR, 'matches.json'),
  TOURNAMENTS: path.join(DB_DIR, 'tournaments.json'),
  GLOBAL_RANKING: path.join(DB_DIR, 'global_ranking.json'),
  SEASONS: path.join(DB_DIR, 'seasons.json'),
  MARKET: path.join(DB_DIR, 'market.json'),
  CONFIG: path.join(DB_DIR, 'config.json')
};

// Funções auxiliares para ler/escrever JSON
const readJSON = (filePath, defaultValue = {}) => {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  } catch (e) {
    console.error(`Erro ao ler ${filePath}:`, e);
  }
  return defaultValue;
};

const writeJSON = (filePath, data) => {
  try {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    return true;
  } catch (e) {
    console.error(`Erro ao escrever ${filePath}:`, e);
    return false;
  }
};

// ═══════════════════════════════════════════════════════════════
// ESTRUTURAS DE DADOS
// ═══════════════════════════════════════════════════════════════

// Divisões do sistema
const DIVISIONS = [
  { id: 'bronze_3', name: 'Bronze III', emoji: '🥉', points: 0, minOVR: 0, maxOVR: 65 },
  { id: 'bronze_2', name: 'Bronze II', emoji: '🥉', points: 250, minOVR: 60, maxOVR: 70 },
  { id: 'bronze_1', name: 'Bronze I', emoji: '🥉', points: 500, minOVR: 65, maxOVR: 75 },
  { id: 'prata_3', name: 'Prata III', emoji: '🥈', points: 850, minOVR: 70, maxOVR: 78 },
  { id: 'prata_2', name: 'Prata II', emoji: '🥈', points: 1300, minOVR: 73, maxOVR: 82 },
  { id: 'prata_1', name: 'Prata I', emoji: '🥈', points: 1750, minOVR: 78, maxOVR: 85 },
  { id: 'ouro_3', name: 'Ouro III', emoji: '🥇', points: 2350, minOVR: 82, maxOVR: 88 },
  { id: 'ouro_2', name: 'Ouro II', emoji: '🥇', points: 3100, minOVR: 85, maxOVR: 90 },
  { id: 'ouro_1', name: 'Ouro I', emoji: '🥇', points: 3850, minOVR: 88, maxOVR: 92 },
  { id: 'elite_3', name: 'Elite III', emoji: '💎', points: 4850, minOVR: 90, maxOVR: 94 },
  { id: 'elite_2', name: 'Elite II', emoji: '💎', points: 6100, minOVR: 92, maxOVR: 95 },
  { id: 'elite_1', name: 'Elite I', emoji: '💎', points: 7350, minOVR: 94, maxOVR: 97 },
  { id: 'lenda_3', name: 'Lenda III', emoji: '👑', points: 8850, minOVR: 95, maxOVR: 99 },
  { id: 'lenda_2', name: 'Lenda II', emoji: '👑', points: 10650, minOVR: 96, maxOVR: 99 },
  { id: 'lenda_1', name: 'Lenda I', emoji: '👑', points: 12450, minOVR: 97, maxOVR: 99 },
  { id: 'mestre_3', name: 'Mestre III', emoji: '🔥', points: 14650, minOVR: 98, maxOVR: 100 },
  { id: 'mestre_2', name: 'Mestre II', emoji: '🔥', points: 17250, minOVR: 98, maxOVR: 100 },
  { id: 'mestre_1', name: 'Mestre I', emoji: '🔥', points: 19850, minOVR: 99, maxOVR: 100 },
  { id: 'pro_3', name: 'Pro III', emoji: '⚡', points: 23050, minOVR: 99, maxOVR: 100 },
  { id: 'pro_2', name: 'Pro II', emoji: '⚡', points: 26850, minOVR: 99, maxOVR: 100 },
  { id: 'pro_1', name: 'Pro I', emoji: '⚡', points: 30650, minOVR: 99, maxOVR: 100 },
  { id: 'worldclass_2', name: 'World Class II', emoji: '🌟', points: 35650, minOVR: 99, maxOVR: 100 },
  { id: 'worldclass_1', name: 'World Class I', emoji: '🌟', points: 42650, minOVR: 99, maxOVR: 100 },
  { id: 'topglobal', name: 'Top Global', emoji: '🏆', points: null, minOVR: 99, maxOVR: 100 }
];

// Habilidades disponíveis
const SKILLS = [
  { id: 'aprendizado_rapido', name: 'Aprendizado Rápido', desc: 'Treinos rendem 20% mais atributos', maxLevel: 3, cost: [50000, 100000, 200000] },
  { id: 'recuperacao_fisica', name: 'Recuperação Física', desc: 'Reduz custo de treino em 15%', maxLevel: 3, cost: [50000, 100000, 200000] },
  { id: 'competidor', name: 'Competidor', desc: '+5% pontos em X1', maxLevel: 3, cost: [75000, 150000, 300000] },
  { id: 'veterano', name: 'Veterano', desc: '+10% XP Football', maxLevel: 3, cost: [75000, 150000, 300000] },
  { id: 'líder', name: 'Líder', desc: 'Bônus para time no draft 5v5', maxLevel: 3, cost: [100000, 200000, 400000] },
  { id: 'finalizador', name: 'Finalizador', desc: '+10% em finalizações', maxLevel: 3, cost: [100000, 200000, 400000] },
  { id: 'maestro', name: 'Maestro', desc: '+10% em passes', maxLevel: 3, cost: [100000, 200000, 400000] },
  { id: 'muralha', name: 'Muralha', desc: '+10% em defesa', maxLevel: 3, cost: [100000, 200000, 400000] },
  { id: 'reflexo_felino', name: 'Reflexo Felino', desc: '+10% físico', maxLevel: 3, cost: [100000, 200000, 400000] },
  { id: 'drible_mestra', name: 'Drible Mestre', desc: '+10% em drible', maxLevel: 3, cost: [100000, 200000, 400000] }
];

// Slots de habilidades por divisão
const SKILL_SLOTS = {
  bronze_3: 1, bronze_2: 1, bronze_1: 1,
  prata_3: 2, prata_2: 2, prata_1: 2,
  ouro_3: 3, ouro_2: 3, ouro_1: 3,
  elite_3: 4, elite_2: 4, elite_1: 4,
  lenda_3: 5, lenda_2: 5, lenda_1: 5,
  mestre_3: 5, mestre_2: 5, mestre_1: 5,
  pro_3: 5, pro_2: 5, pro_1: 5,
  worldclass_2: 5, worldclass_1: 5,
  topglobal: 5
};

// ═══════════════════════════════════════════════════════════════
// CLASSE DO BANCO DE DADOS
// ═══════════════════════════════════════════════════════════════

class FootballDB {
  constructor() {
    this.players = readJSON(FILES.PLAYERS, {});
    this.clubs = readJSON(FILES.CLUBS, {});
    this.matches = readJSON(FILES.MATCHES, []);
    this.tournaments = readJSON(FILES.TOURNAMENTS, []);
    this.globalRanking = readJSON(FILES.GLOBAL_RANKING, { players: [], clubs: [] });
    this.seasons = readJSON(FILES.SEASONS, { current: 1, history: [] });
    this.market = readJSON(FILES.MARKET, { proposals: [], negotiations: [] });
    this.config = readJSON(FILES.CONFIG, {
      fcCoinsName: 'FC Coins',
      currentSeason: 1,
      championsActive: false
    });
  }

  // Salvar todos os dados
  save() {
    writeJSON(FILES.PLAYERS, this.players);
    writeJSON(FILES.CLUBS, this.clubs);
    writeJSON(FILES.MATCHES, this.matches);
    writeJSON(FILES.TOURNAMENTS, this.tournaments);
    writeJSON(FILES.GLOBAL_RANKING, this.globalRanking);
    writeJSON(FILES.SEASONS, this.seasons);
    writeJSON(FILES.MARKET, this.market);
    writeJSON(FILES.CONFIG, this.config);
  }

  // ═══════════════════════════════════════════════════════════════
  // JOGADORES
  // ═══════════════════════════════════════════════════════════════

  getPlayer(userId) {
    return this.players[userId] || null;
  }

  createPlayer(userId, userName) {
    const player = {
      id: userId,
      name: userName,
      createdAt: Date.now(),
      ovr: 60,
      attributes: {
        pac: 60,  // Velocidade
        sho: 60,  // Finalização
        pas: 60,  // Passe
        dri: 60,  // Drible
        def: 60,  // Defesa
        phy: 60   // Físico
      },
      division: {
        id: 'bronze_3',
        points: 0,
        protectionMatches: 0,
        winStreak: 0
      },
      stats: {
        matches: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        goalsFor: 0,
        goalsAgainst: 0
      },
      economy: {
        fcCoins: 250000,
        totalEarned: 250000,
        totalSpent: 0
      },
      energy: {
        current: 200,
        max: 200,
        lastRest: Date.now()
      },
      skills: [],
      achievements: [],
      history: [],
      currentClub: null,
      salary: 0,
      weeklySalary: 0,
      // Sistema de XP e Evolução
      xp: {
        level: 1,
        currentXP: 0,
        evolutionPoints: 0, // Pontos para distribuir em atributos
        totalXP: 0
      },
      soloStats: {
        victories: 0,
        draws: 0,
        losses: 0,
        streak: 0,
        bestStreak: 0,
        totalPlayed: 0
      },
      // Sistema de Forma
      form: {
        current: 0, // -5 a +5
        history: [] // últimas 10 partidas
      },
      unlockedTitles: ['Novato'],
      equippedTitle: null,
      // Sistema de MVP
      mvpCount: 0,
      // Sistema de Caixa Diária
      dailyReward: {
        lastClaim: 0,
        streak: 0
      },
      // Sistema de Missões Semanais
      weeklyMissions: null,
      weeklyReset: 0,
      // Sistema de Reputação
      reputation: 50, // 0-100, começa em 50
      // Sistema de Rivalidades
      rivalries: {} // { userId: level }
    };
    
    this.players[userId] = player;
    this.save();
    return player;
  }

  hasPlayer(userId) {
    return !!this.players[userId];
  }

  // ═══════════════════════════════════════════════════════════════
  // SISTEMA DE REPUTAÇÃO
  // ═══════════════════════════════════════════════════════════════

  updateReputation(userId, amount) {
    const player = this.players[userId];
    if (!player) return null;
    
    player.reputation = Math.max(0, Math.min(100, (player.reputation || 50) + amount));
    this.save();
    return player.reputation;
  }

  getReputationBadge(reputation) {
    if (reputation >= 90) return '⭐ Lendário';
    if (reputation >= 75) return '🌟 Profissional';
    if (reputation >= 60) return '👍 Confiável';
    if (reputation >= 40) return '😐 Neutro';
    if (reputation >= 20) return '⚠️ Questionável';
    return '❌ Reprovado';
  }

  // ═══════════════════════════════════════════════════════════════
  // SISTEMA DE RIVALIDADE
  // ═══════════════════════════════════════════════════════════════

  updateRivalry(userId1, userId2, amount) {
    const p1 = this.players[userId1];
    const p2 = this.players[userId2];
    if (!p1 || !p2) return null;
    
    if (!p1.rivalries) p1.rivalries = {};
    if (!p2.rivalries) p2.rivalries = {};
    
    // Aumentar rivalidade mútua
    p1.rivalries[userId2] = Math.min(100, (p1.rivalries[userId2] || 0) + amount);
    p2.rivalries[userId1] = Math.min(100, (p2.rivalries[userId1] || 0) + amount);
    
    this.save();
    return {
      player1: p1.rivalries[userId2],
      player2: p2.rivalries[userId1]
    };
  }

  getRivalry(userId1, userId2) {
    const p1 = this.players[userId1];
    if (!p1 || !p1.rivalries) return 0;
    return p1.rivalries[userId2] || 0;
  }

  getRivalryLevel(level) {
    if (level >= 80) return '🔥 Odio Máximo';
    if (level >= 60) return '⚔️ Rivalidade Alta';
    if (level >= 40) return '😤 Rivalidade Média';
    if (level >= 20) return '🤔 Desconfiança';
    if (level >= 5) return '👀 Observando';
    return '—';
  }

  // ═══════════════════════════════════════════════════════════════
  // SISTEMA DE TEMPORADAS
  // ═══════════════════════════════════════════════════════════════

  seasonConfig = {
    active: true,
    number: 1,
    startDate: Date.now(),
    durationDays: 30,
    resetDivisions: true,
    keepXP: true,
    keepOVR: true,
    keepAchievements: true
  };

  getSeasonStatus() {
    const now = Date.now();
    const durationMs = this.seasonConfig.durationDays * 24 * 60 * 60 * 1000;
    const endDate = this.seasonConfig.startDate + durationMs;
    const remainingMs = endDate - now;
    
    if (remainingMs <= 0) {
      return { active: false, ended: true };
    }
    
    const daysLeft = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
    
    return {
      active: true,
      number: this.seasonConfig.number,
      daysLeft: daysLeft,
      endDate: endDate,
      resetDivisions: this.seasonConfig.resetDivisions
    };
  }

  resetSeason() {
    this.seasonConfig.number++;
    this.seasonConfig.startDate = Date.now();
    
    // Resetar divisões se configurado
    if (this.seasonConfig.resetDivisions) {
      Object.values(this.players).forEach(player => {
        player.division = { id: 'bronze_3', points: 0, winStreak: 0 };
        player.seasonStats = { ...player.stats };
      });
    }
    
    // Manter XP, OVR, conquistas, títulos
    // Resetar ranking global
    this.globalRanking = { players: [], clubs: [] };
    this.save();
    
    return {
      newSeason: this.seasonConfig.number,
      message: `🏆 Temporada ${this.seasonConfig.number} começou!`
    };
  }

  getSeasonRewards() {
    // Recompensas da temporada atual
    const ranking = this.globalRanking?.players || [];
    
    return {
      top1: { coins: 50000, xp: 5000, title: 'Campeão da Temporada' },
      top10: { coins: 10000, xp: 1000, title: 'Elite da Temporada' },
      top100: { coins: 2500, xp: 250, title: 'Destaque da Temporada' }
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // SISTEMA DE CÓDIGOS PROMOCIONAIS
  // ═══════════════════════════════════════════════════════════════

  // Códigos promocionais
  promoCodes = {};

  // Log de uso de códigos
  promoCodeLogs = [];

  // Gerar código aleatório
  generatePromoCode(length = 6) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < length; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  // Criar código promocional
  createPromoCode(options = {}) {
    const code = options.code || this.generatePromoCode();
    
    // Verificar se código já existe
    if (this.promoCodes[code]) {
      return { success: false, error: 'Código já existe!' };
    }

    const promoCode = {
      code: code,
      type: options.type || 'normal', // 'normal' ou 'mysterious'
      rewards: {
        coins: options.coins || 0,
        xp: options.xp || 0,
        title: options.title || null
      },
      mysteriousRewards: options.mysteriousRewards || null, // { minCoins, maxCoins, minXP, maxXP, rareChance }
      maxUses: options.maxUses || null, // null = ilimitado
      currentUses: 0,
      expiresAt: options.expiresAt || null, // timestamp ou null = nunca expira
      createdAt: Date.now(),
      createdBy: options.createdBy || 'admin',
      active: true,
      usedBy: [] // lista de userIds que já usaram
    };

    this.promoCodes[code] = promoCode;
    this.save();
    
    return { success: true, code: promoCode };
  }

  // Resgatar código
  redeemPromoCode(userId, code) {
    const player = this.players[userId];
    if (!player) return { success: false, error: 'Jogador não encontrado!' };

    const promoCode = this.promoCodes[code.toUpperCase()];
    
    if (!promoCode) {
      return { success: false, error: 'Código inválido!' };
    }

    if (!promoCode.active) {
      return { success: false, error: 'Código desativado!' };
    }

    // Verificar expiração
    if (promoCode.expiresAt && Date.now() > promoCode.expiresAt) {
      return { success: false, error: 'Código expirado!' };
    }

    // Verificar limite de usos
    if (promoCode.maxUses && promoCode.currentUses >= promoCode.maxUses) {
      return { success: false, error: 'Limite de usos atingido!' };
    }

    // Verificar se jogador já usou
    if (promoCode.usedBy.includes(userId)) {
      return { success: false, error: 'Você já usou este código!' };
    }

    // Calcular recompensas
    let rewards;
    let displayRewards;

    if (promoCode.type === 'mysterious') {
      // Código misterioso - recompensas variáveis
      const config = promoCode.mysteriousRewards;
      const coins = Math.floor(Math.random() * (config.maxCoins - config.minCoins + 1)) + config.minCoins;
      const xp = Math.floor(Math.random() * (config.maxXP - config.minXP + 1)) + config.minXP;
      
      rewards = { coins, xp, title: null };
      displayRewards = {
        coins: coins,
        xp: xp,
        title: '???'
      };
    } else {
      // Código normal
      rewards = { ...promoCode.rewards };
      displayRewards = { ...promoCode.rewards };
    }

    // Aplicar recompensas
    if (rewards.coins > 0) {
      player.economy.fcCoins += rewards.coins;
      player.economy.totalEarned += rewards.coins;
    }
    
    if (rewards.xp > 0) {
      const xpResult = this.addXP(userId, rewards.xp);
      rewards.leveledUp = xpResult.leveledUp;
      rewards.newLevel = xpResult.leveledUp ? xpResult.levelsGained : null;
    }
    
    if (rewards.title && !player.unlockedTitles.includes(rewards.title)) {
      player.unlockedTitles.push(rewards.title);
    }

    // Atualizar código
    promoCode.currentUses++;
    promoCode.usedBy.push(userId);

    // Registrar no log
    this.promoCodeLogs.push({
      userId: userId,
      playerName: player.name,
      code: code.toUpperCase(),
      rewards: rewards,
      timestamp: Date.now()
    });

    // Verificar conquistas
    if (rewards.coins > 0) {
      this.checkAchievements(userId, 'match', player.stats.matches);
    }

    this.save();

    return {
      success: true,
      type: promoCode.type,
      rewards: displayRewards,
      leveledUp: rewards.leveledUp,
      newLevel: rewards.newLevel
    };
  }

  // Listar códigos (para admin)
  listPromoCodes() {
    return Object.values(this.promoCodes).map(c => ({
      code: c.code,
      type: c.type,
      rewards: c.type === 'mysterious' ? '???' : c.rewards,
      maxUses: c.maxUses || '∞',
      currentUses: c.currentUses,
      expiresAt: c.expiresAt ? new Date(c.expiresAt).toLocaleString() : 'Nunca',
      active: c.active
    }));
  }

  // Desativar código
  deactivatePromoCode(code) {
    if (!this.promoCodes[code.toUpperCase()]) {
      return { success: false, error: 'Código não encontrado!' };
    }
    this.promoCodes[code.toUpperCase()].active = false;
    this.save();
    return { success: true };
  }

  // Ver logs
  getPromoCodeLogs(limit = 50) {
    return this.promoCodeLogs.slice(-limit).reverse();
  }

  // Obter código misterioso ativo aleatório
  getRandomMysteriousCode() {
    const mysteriousCodes = Object.values(this.promoCodes)
      .filter(c => c.type === 'mysterious' && c.active && 
        (!c.expiresAt || Date.now() < c.expiresAt) &&
        (!c.maxUses || c.currentUses < c.maxUses));
    
    if (mysteriousCodes.length === 0) return null;
    return mysteriousCodes[Math.floor(Math.random() * mysteriousCodes.length)];
  }

  // ═══════════════════════════════════════════════════════════════
  // SISTEMA DE TORNEIOS
  // ═══════════════════════════════════════════════════════════════

  // Torneios ativos
  tournaments = {};
  tournamentIdCounter = 0;

  // Criar torneio
  createTournament(options = {}) {
    const id = ++this.tournamentIdCounter;
    
    const tournament = {
      id: id,
      name: options.name || 'Torneio Sem Nome',
      type: options.type || 'x1', // 'x1' ou 'club'
      maxPlayers: options.maxPlayers || 16,
      entryCost: options.entryCost || 0,
      prize: options.prize || 0,
      prizeDistribution: options.prizeDistribution || { 1: 100 }, // % por posição
      status: 'registration', // registration, in_progress, completed, cancelled
      participants: [],
      matches: [],
      rounds: 0,
      winner: null,
      trophyTitle: options.trophyTitle || null,
      createdAt: Date.now(),
      startedAt: null,
      endedAt: null,
      createdBy: options.createdBy || 'admin'
    };

    this.tournaments[id] = tournament;
    this.save();
    
    return { success: true, tournament: tournament };
  }

  // Inscrição com verificação de economia
  joinTournament(tournamentId, userId) {
    const tournament = this.tournaments[tournamentId];
    const player = this.players[userId];
    
    if (!tournament) {
      return { success: false, error: 'Torneio não encontrado!' };
    }
    
    if (tournament.status !== 'registration') {
      return { success: false, error: 'Inscrições encerradas!' };
    }
    
    if (tournament.participants.some(p => p.id === userId)) {
      return { success: false, error: 'Você já está inscrito!' };
    }
    
    if (tournament.participants.length >= tournament.maxPlayers) {
      return { success: false, error: 'Torneio lotado!' };
    }
    
    if (tournament.entryCost > 0) {
      if (!player || player.economy.fcCoins < tournament.entryCost) {
        return { success: false, error: `FC Coins insuficientes! Necessário: ${tournament.entryCost}` };
      }
      player.economy.fcCoins -= tournament.entryCost;
      player.economy.totalSpent += tournament.entryCost;
    }
    
    tournament.participants.push({
      id: userId,
      name: player?.name || 'Desconhecido',
      ovr: player?.ovr || 70,
      registeredAt: Date.now()
    });
    
    this.save();
    
    return { 
      success: true, 
      message: `Inscrito no torneio *${tournament.name}*!`,
      paid: tournament.entryCost
    };
  }

  // Iniciar torneio
  startTournament(tournamentId) {
    const tournament = this.tournaments[tournamentId];
    
    if (!tournament) {
      return { success: false, error: 'Torneio não encontrado!' };
    }
    
    if (tournament.status !== 'registration') {
      return { success: false, error: 'Torneio já foi iniciado!' };
    }
    
    const participants = tournament.participants;
    if (participants.length < 2) {
      return { success: false, error: 'Mínimo 2 participantes!' };
    }
    
    // Embaralhar participantes
    const shuffled = participants.sort(() => Math.random() - 0.5);
    
    // Adicionar BYEs se necessário
    const sizes = [2, 4, 8, 16, 32, 64];
    const size = sizes.find(s => s >= shuffled.length) || 16;
    while (shuffled.length < size) {
      shuffled.push({ id: 'BYE', name: 'BYE', ovr: 0, isBye: true });
    }
    
    tournament.participants = shuffled;
    tournament.status = 'in_progress';
    tournament.startedAt = Date.now();
    
    // Gerar partidas da primeira rodada
    this.generateTournamentBracket(tournament);
    
    this.save();
    
    return { success: true, message: 'Torneio iniciado!', matches: tournament.matches.length };
  }

  // Gerar chaveamento do torneio
  generateTournamentBracket(tournament) {
    const participants = tournament.participants;
    const matches = [];
    const rounds = Math.log2(participants.length);
    
    tournament.rounds = rounds;
    
    // Partidas por rodada
    const matchesPerRound = participants.length / 2;
    
    for (let round = 0; round < rounds; round++) {
      const matchesInRound = participants.length / Math.pow(2, round + 1);
      for (let i = 0; i < matchesInRound; i++) {
        matches.push({
          round: round + 1,
          matchNumber: i + 1,
          player1: null,
          player2: null,
          score1: null,
          score2: null,
          winner: null,
          status: round === 0 ? 'pending' : 'waiting',
          playedAt: null
        });
      }
    }
    
    // Distribuir jogadores na primeira rodada
    let matchIndex = 0;
    for (let i = 0; i < participants.length; i += 2) {
      matches[matchIndex].player1 = participants[i];
      matches[matchIndex].player2 = participants[i + 1];
      matches[matchIndex].status = 'pending';
      matchIndex++;
    }
    
    tournament.matches = matches;
  }

  // Processar uma partida do torneio
  playTournamentMatch(tournamentId, matchIndex) {
    const tournament = this.tournaments[tournamentId];
    if (!tournament || tournament.status !== 'in_progress') {
      return { success: false, error: 'Torneio não está ativo!' };
    }
    
    const match = tournament.matches[matchIndex];
    if (!match || match.status !== 'pending') {
      return { success: false, error: 'Partida não disponível!' };
    }
    
    // Pular BYE
    if (match.player1?.isBye || match.player2?.isBye) {
      match.winner = match.player1?.isBye ? match.player2 : match.player1;
      match.status = 'completed';
      match.playedAt = Date.now();
      this.advanceTournamentMatch(tournament, match.round, matchIndex);
      this.save();
      return { success: true, bye: true, winner: match.winner };
    }
    
    const p1 = this.players[match.player1.id];
    const p2 = this.players[match.player2.id];
    
    // Calcular chances baseado em OVR + forma
    const ovr1 = match.player1.ovr || 70;
    const ovr2 = match.player2.ovr || 70;
    const form1 = this.getFormInfo(p1).bonus;
    const form2 = this.getFormInfo(p2).bonus;
    
    const ovrDiff = ovr1 - ovr2;
    const luckFactor = (Math.random() - 0.5) * 10;
    const p1Chance = 50 + (ovrDiff * 2) + (form1 * 50) - (form2 * 50) + luckFactor;
    
    // Gerar placar
    let score1, score2;
    
    if (Math.random() * 100 < p1Chance) {
      score1 = Math.floor(Math.random() * 3) + 1;
      score2 = Math.floor(Math.random() * score1);
    } else {
      score2 = Math.floor(Math.random() * 3) + 1;
      score1 = Math.floor(Math.random() * score2);
    }
    
    match.score1 = score1;
    match.score2 = score2;
    match.winner = score1 > score2 ? match.player1 : match.player2;
    match.loser = score1 > score2 ? match.player2 : match.player1;
    match.status = 'completed';
    match.playedAt = Date.now();
    
    // Avançar vencedor
    this.advanceTournamentMatch(tournament, match.round, matchIndex);
    
    // Atualizar forma
    this.updatePlayerForm(match.player1.id, score1 > score2 ? 'win' : score1 === score2 ? 'draw' : 'loss');
    this.updatePlayerForm(match.player2.id, score2 > score1 ? 'win' : score1 === score2 ? 'draw' : 'loss');
    
    // XP por vitória no torneio
    const xpReward = 20;
    this.addXP(match.winner.id, xpReward);
    
    this.save();
    
    return { 
      success: true, 
      match: match,
      xpReward: xpReward
    };
  }

  // Avançar vencedor para próxima rodada
  advanceTournamentMatch(tournament, currentRound, matchIndex) {
    if (currentRound >= tournament.rounds) {
      // Finais - Tournament Over
      tournament.status = 'completed';
      tournament.endedAt = Date.now();
      tournament.winner = tournament.matches[matchIndex].winner;
      
      // Dar prêmio
      this.awardTournamentPrize(tournament);
      return;
    }
    
    // Encontrar partida da próxima rodada
    const nextRound = currentRound + 1;
    const matchesInNextRound = tournament.matches.filter(m => m.round === nextRound);
    const positionInRound = matchIndex % matchesInNextRound.length;
    const nextMatch = matchesInNextRound[positionInRound];
    
    // Determinar se é player1 ou player2 na próxima partida
    const isPlayer1 = Math.floor(matchIndex / (tournament.matches.length / Math.pow(2, currentRound))) % 2 === 0;
    
    if (isPlayer1) {
      nextMatch.player1 = tournament.matches[matchIndex].winner;
      if (nextMatch.player1 && nextMatch.player2) nextMatch.status = 'pending';
    } else {
      nextMatch.player2 = tournament.matches[matchIndex].winner;
      if (nextMatch.player1 && nextMatch.player2) nextMatch.status = 'pending';
    }
  }

  // Premiar campeão
  awardTournamentPrize(tournament) {
    if (!tournament.winner) return;
    
    const player = this.players[tournament.winner.id];
    if (!player) return;
    
    // Premio em coins
    if (tournament.prize > 0) {
      player.economy.fcCoins += tournament.prize;
      player.economy.totalEarned += tournament.prize;
    }
    
    // XP
    const xpPrize = 500;
    this.addXP(tournament.winner.id, xpPrize);
    
    // Troféu
    if (tournament.trophyTitle) {
      if (!player.unlockedTitles) player.unlockedTitles = ['Novato'];
      player.unlockedTitles.push(tournament.trophyTitle);
      player.equippedTitle = tournament.trophyTitle;
    }
    
    // Conquista
    this.checkAchievements(tournament.winner.id, 'match', player.stats.matches);
    
    this.save();
  }

  // Ver estado do torneio
  getTournamentStatus(tournamentId) {
    const tournament = this.tournaments[tournamentId];
    if (!tournament) return null;
    
    const statusLabels = {
      'registration': '📝 Inscrições Abertas',
      'in_progress': '⚔️ Em Andamento',
      'completed': '🏆 Finalizado',
      'cancelled': '❌ Cancelado'
    };
    
    let text = `🏆 *${tournament.name}*\n\n`;
    text += `${statusLabels[tournament.status] || tournament.status}\n`;
    text += `Tipo: ${tournament.type === 'x1' ? '👤 X1 Individual' : '⚽ Clube 5x5'}\n`;
    text += `Participantes: ${tournament.participants.filter(p => !p.isBye).length}/${tournament.maxPlayers}\n`;
    
    if (tournament.status === 'registration') {
      text += `\n💰 Custo: ${tournament.entryCost} FC Coins\n`;
      text += `🏆 Prêmio: ${tournament.prize} FC Coins`;
    }
    
    if (tournament.winner) {
      text += `\n\n🏆 CAMPEÃO: ${tournament.winner.name}`;
    }
    
    return text;
  }

  // Listar torneios ativos
  listActiveTournaments() {
    return Object.values(this.tournaments)
      .filter(t => t.status === 'registration')
      .map(t => ({
        id: t.id,
        name: t.name,
        type: t.type,
        participants: t.participants.filter(p => !p.isBye).length,
        maxPlayers: t.maxPlayers,
        entryCost: t.entryCost,
        prize: t.prize
      }));
  }

  // Obter partidas de uma rodada
  getTournamentRound(tournamentId, round) {
    const tournament = this.tournaments[tournamentId];
    if (!tournament) return [];
    
    return tournament.matches.filter(m => m.round === round);
  }

  // ═══════════════════════════════════════════════════════════════
  // SISTEMA DE XP E NÍVEIS
  // ═══════════════════════════════════════════════════════════════

  // Calcular XP necessário para o próximo nível
  getXPForLevel(level) {
    // Progressão: nível * 100 + (nível - 1) * 20
    // Nível 1→2: 100, 2→3: 140, 3→4: 180, etc.
    return Math.floor(level * 100 + (level - 1) * 20);
  }

  // Calcular bônus de XP baseado nas habilidades
  getXPBonus(player) {
    let bonus = 0;
    if (player.skills) {
      const aprendizado = player.skills.find(s => s.id === 'aprendizado_rapido');
      if (aprendizado) {
        bonus = aprendizado.level * 5; // +5% por nível
      }
    }
    return bonus / 100; // Retorna multiplicador (1.05, 1.10, 1.15)
  }

  // Adicionar XP a um jogador
  addXP(userId, amount) {
    const player = this.players[userId];
    if (!player) return { success: false, error: 'Jogador não encontrado' };
    if (!player.xp) {
      player.xp = { level: 1, currentXP: 0, evolutionPoints: 0, totalXP: 0 };
    }

    // Aplicar bônus de habilidade
    const bonus = this.getXPBonus(player);
    const finalAmount = Math.floor(amount * bonus);
    
    player.xp.totalXP += finalAmount;
    player.xp.currentXP += finalAmount;

    const result = {
      success: true,
      xpGained: finalAmount,
      bonusApplied: bonus > 1 ? Math.round((bonus - 1) * 100) : 0
    };

    // Verificar subida de nível
    const xpNeeded = this.getXPForLevel(player.xp.level);
    const levelsGained = [];

    while (player.xp.currentXP >= xpNeeded && player.xp.level < 100) {
      player.xp.currentXP -= xpNeeded;
      player.xp.level++;
      
      // Dar pontos de evolução (2 por nível)
      const evoPoints = 2;
      player.xp.evolutionPoints += evoPoints;
      
      levelsGained.push({
        level: player.xp.level,
        evoPoints: evoPoints
      });

      // Verificar marcos de nível
      this.checkLevelMilestone(player, player.xp.level);
    }

    if (levelsGained.length > 0) {
      result.leveledUp = true;
      result.levelsGained = levelsGained;
      result.totalEvolutionPoints = player.xp.evolutionPoints;
    }

    this.save();
    return result;
  }

  // Verificar marcos de nível e dar recompensas
  checkLevelMilestone(player, level) {
    const milestones = {
      10: { coins: 1000, message: '🏆 Nível 10! +1.000 FC Coins' },
      25: { coins: 2500, message: '⭐ Nível 25! +2.500 FC Coins' },
      50: { coins: 5000, message: '👑 Nível 50! +5.000 FC Coins' },
      75: { coins: 10000, message: '🌟 Nível 75! +10.000 FC Coins' },
      100: { coins: 25000, message: '💎 Nível 100! +25.000 FC Coins - LENDÁRIO!' }
    };

    if (milestones[level]) {
      player.economy.fcCoins += milestones[level].coins;
      player.economy.totalEarned += milestones[level].coins;
      player.milestoneReward = milestones[level].message;
    }
  }

  // Usar pontos de evolução
  useEvolutionPoint(userId, attribute, points) {
    const player = this.players[userId];
    if (!player) return { success: false, error: 'Jogador não encontrado' };
    if (!player.xp || player.xp.evolutionPoints < points) {
      return { success: false, error: 'Pontos de evolução insuficientes!' };
    }

    const validAttrs = ['pac', 'sho', 'pas', 'dri', 'def', 'phy'];
    const attrLower = attribute.toLowerCase();
    if (!validAttrs.includes(attrLower)) {
      return { success: false, error: 'Atributo inválido! Use: pac, sho, pas, dri, def, phy' };
    }

    const currentValue = player.attributes[attrLower];
    if (currentValue + points > 99) {
      return { success: false, error: `Máximo 99 para ${attrLower.toUpperCase()}!` };
    }

    player.attributes[attrLower] += points;
    player.xp.evolutionPoints -= points;
    
    // Recalcular OVR
    const oldOVR = player.ovr;
    player.ovr = this.calculateOVR(player.attributes);
    
    this.save();

    return {
      success: true,
      attribute: attrLower,
      pointsUsed: points,
      newValue: player.attributes[attrLower],
      oldOVR: oldOVR,
      newOVR: player.ovr,
      remainingPoints: player.xp.evolutionPoints
    };
  }

  // Obter informações de XP
  getXPInfo(userId) {
    const player = this.players[userId];
    if (!player) return null;
    if (!player.xp) {
      player.xp = { level: 1, currentXP: 0, evolutionPoints: 0, totalXP: 0 };
    }

    const xpNeeded = this.getXPForLevel(player.xp.level);
    const bonus = this.getXPBonus(player);

    return {
      level: player.xp.level,
      currentXP: player.xp.currentXP,
      xpNeeded: xpNeeded,
      progress: Math.round((player.xp.currentXP / xpNeeded) * 100),
      evolutionPoints: player.xp.evolutionPoints,
      totalXP: player.xp.totalXP,
      xpBonus: bonus > 1 ? Math.round((bonus - 1) * 100) : 0,
      ovr: player.ovr
    };
  }

  // Resetar XP de um jogador
  resetPlayerXP(userId) {
    const player = this.players[userId];
    if (!player) return { success: false, error: 'Jogador não encontrado' };
    
    player.xp = { level: 1, currentXP: 0, evolutionPoints: 0, totalXP: 0 };
    this.save();
    return { success: true };
  }

  // ═══════════════════════════════════════════════════════════════
  // SISTEMA DE FORMA
  // ═══════════════════════════════════════════════════════════════

  getFormInfo(player) {
    const form = player.form?.current || 0;
    let emoji, label, bonus;
    
    if (form >= 4) {
      emoji = '🔥'; label = 'Excelente'; bonus = 0.05;
    } else if (form >= 2) {
      emoji = '🙂'; label = 'Boa'; bonus = 0.02;
    } else if (form >= -1) {
      emoji = '😐'; label = 'Normal'; bonus = 0;
    } else if (form >= -3) {
      emoji = '⚠️'; label = 'Ruim'; bonus = -0.02;
    } else {
      emoji = '❄️'; label = 'Péssima'; bonus = -0.05;
    }
    
    return { emoji, label, bonus, value: form };
  }

  updatePlayerForm(userId, result) {
    const player = this.players[userId];
    if (!player) return;
    
    // result: 'win', 'draw', 'loss'
    if (!player.form) {
      player.form = { current: 0, history: [] };
    }
    
    // Adicionar resultado ao histórico (máximo 10)
    player.form.history.push(result);
    if (player.form.history.length > 10) {
      player.form.history.shift();
    }
    
    // Calcular forma baseada no histórico
    let wins = 0, draws = 0, losses = 0;
    player.form.history.forEach(r => {
      if (r === 'win') wins++;
      else if (r === 'draw') draws++;
      else losses++;
    });
    
    // Sequência atual
    const lastResult = player.form.history[player.form.history.length - 1];
    let streak = 0;
    for (let i = player.form.history.length - 1; i >= 0; i--) {
      if (player.form.history[i] === lastResult) streak++;
      else break;
    }
    
    // Calcular forma (-5 a +5)
    let newForm = Math.round((wins * 0.5) - (losses * 0.5) + (draws * 0.1));
    newForm = Math.max(-5, Math.min(5, newForm));
    
    // Bônus por sequência
    if (streak >= 5 && lastResult === 'win') newForm = Math.min(5, newForm + 1);
    if (streak >= 4 && lastResult === 'loss') newForm = Math.max(-5, newForm - 1);
    
    player.form.current = newForm;
    this.save();
    
    return this.getFormInfo(player);
  }

  // ═══════════════════════════════════════════════════════════════
  // SISTEMA DE CONQUISTAS
  // ═══════════════════════════════════════════════════════════════

  ACHIEVEMENTS = {
    // Vitórias
    first_win: { name: 'Primeira Vitória', desc: 'Ganhe sua primeira partida', type: 'win', target: 1, reward: { coins: 500, xp: 50 } },
    wins_10: { name: '10 Vitórias', desc: 'Ganhe 10 partidas', type: 'win', target: 10, reward: { coins: 1000, xp: 100 } },
    wins_100: { name: '100 Vitórias', desc: 'Ganhe 100 partidas', type: 'win', target: 100, reward: { coins: 5000, xp: 500 } },
    wins_500: { name: '500 Vitórias', desc: 'Ganhe 500 partidas', type: 'win', target: 500, reward: { coins: 20000, xp: 2000 } },
    
    // Partidas
    first_match: { name: 'Primeira Partida', desc: 'Jogue sua primeira partida', type: 'match', target: 1, reward: { coins: 100, xp: 20 } },
    matches_100: { name: 'Veterano', desc: 'Jogue 100 partidas', type: 'match', target: 100, reward: { coins: 2000, xp: 200 } },
    matches_500: { name: 'Lenda', desc: 'Jogue 500 partidas', type: 'match', target: 500, reward: { coins: 10000, xp: 1000 } },
    
    // Solo
    solo_first_win: { name: 'Primeira Vitória Solo', desc: 'Ganhe seu primeiro Fut Solo', type: 'solo_win', target: 1, reward: { coins: 300, xp: 30 } },
    solo_50: { name: '50 Vitórias Solo', desc: 'Ganhe 50 partidas Solo', type: 'solo_win', target: 50, reward: { coins: 3000, xp: 300 } },
    solo_100: { name: 'Rei do Solo', desc: 'Ganhe 100 partidas Solo', type: 'solo_win', target: 100, reward: { coins: 10000, xp: 1000, title: 'Rei do Solo' } },
    
    // Clubes
    first_club: { name: 'Primeiro Clube', desc: 'Entre em um clube pela primeira vez', type: 'club_join', target: 1, reward: { coins: 500, xp: 50 } },
    
    // Divisões
    promoted: { name: 'Primeira Promoção', desc: 'Suba de divisão pela primeira vez', type: 'promotion', target: 1, reward: { coins: 1000, xp: 100 } },
    reached_gold: { name: 'Chegou ao Ouro', desc: 'Alcance a divisão Ouro', type: 'division', target: 'ouro', reward: { coins: 2000, xp: 200 } },
    reached_elite: { name: 'Chegou ao Elite', desc: 'Alcance a divisão Elite', type: 'division', target: 'elite', reward: { coins: 5000, xp: 500 } },
    reached_lenda: { name: 'Chegou ao Lenda', desc: 'Alcance a divisão Lenda', type: 'division', target: 'lenda', reward: { coins: 10000, xp: 1000 } },
    reached_mestre: { name: 'Chegou ao Mestre', desc: 'Alcance a divisão Mestre', type: 'division', target: 'mestre', reward: { coins: 25000, xp: 2500 } },
    reached_pro: { name: 'Chegou ao Pro', desc: 'Alcance a divisão Pro', type: 'division', target: 'pro', reward: { coins: 50000, xp: 5000 } },
    
    // XP/Nível
    level_10: { name: 'Nível 10', desc: 'Alcance o nível 10', type: 'level', target: 10, reward: { coins: 1000, xp: 0 } },
    level_25: { name: 'Nível 25', desc: 'Alcance o nível 25', type: 'level', target: 25, reward: { coins: 2500, xp: 0 } },
    level_50: { name: 'Nível 50', desc: 'Alcance o nível 50', type: 'level', target: 50, reward: { coins: 10000, xp: 0 } },
    level_100: { name: 'Lendário', desc: 'Alcance o nível 100', type: 'level', target: 100, reward: { coins: 50000, xp: 0, title: 'Lendário' } },
    
    // MVP
    mvp_1: { name: 'Primeiro MVP', desc: 'Ganhe seu primeiro MVP', type: 'mvp', target: 1, reward: { coins: 300, xp: 50 } },
    mvp_50: { name: 'Colecionador de MVPs', desc: 'Ganhe 50 MVPs', type: 'mvp', target: 50, reward: { coins: 5000, xp: 500, title: 'MVP' } },
    
    // Sequência
    streak_5: { name: 'Sequência', desc: 'Ganhe 5 seguidas', type: 'streak', target: 5, reward: { coins: 1000, xp: 100 } },
    streak_10: { name: 'Invencível', desc: 'Ganhe 10 seguidas', type: 'streak', target: 10, reward: { coins: 5000, xp: 500, title: 'Invencível' } }
  };

  checkAchievements(userId, type, value) {
    const player = this.players[userId];
    if (!player) return [];
    
    if (!player.achievements) player.achievements = [];
    const newAchievements = [];
    
    Object.entries(this.ACHIEVEMENTS).forEach(([id, ach]) => {
      if (ach.type !== type) return;
      if (player.achievements.includes(id)) return;
      
      let unlocked = false;
      if (ach.target === 'ouro' || ach.target === 'elite' || ach.target === 'lenda' || ach.target === 'mestre' || ach.target === 'pro') {
        unlocked = player.division?.id?.startsWith(ach.target);
      } else {
        unlocked = value >= ach.target;
      }
      
      if (unlocked) {
        player.achievements.push(id);
        if (ach.reward?.coins) {
          player.economy.fcCoins += ach.reward.coins;
          player.economy.totalEarned += ach.reward.coins;
        }
        if (ach.reward?.title) {
          if (!player.unlockedTitles) player.unlockedTitles = ['Novato'];
          player.unlockedTitles.push(ach.reward.title);
        }
        
        newAchievements.push(ach);
      }
    });
    
    if (newAchievements.length > 0) this.save();
    return newAchievements;
  }

  getAchievements(userId) {
    const player = this.players[userId];
    if (!player) return [];
    return (player.achievements || []).map(id => this.ACHIEVEMENTS[id]).filter(Boolean);
  }

  // ═══════════════════════════════════════════════════════════════
  // SISTEMA DE MVP
  // ═══════════════════════════════════════════════════════════════

  calculateMVP(player1, player2, matchResult, player1Goals, player2Goals) {
    // player1 é quem estamos calculando
    const p1Score = player1.ovr * 0.5 + player1Goals * 10 + (matchResult === 'win' ? 30 : matchResult === 'draw' ? 15 : 0);
    const p2Score = player2.ovr * 0.5 + player2Goals * 10 + (matchResult === 'loss' ? 30 : matchResult === 'draw' ? 15 : 0);
    
    if (p1Score > p2Score) {
      return { winner: player1, loser: player2 };
    } else {
      return { winner: player2, loser: player1 };
    }
  }

  awardMVP(userId) {
    const player = this.players[userId];
    if (!player) return null;
    
    player.mvpCount = (player.mvpCount || 0) + 1;
    
    // Recompensa por MVP
    const xpReward = 10;
    const coinsReward = 100;
    this.addXP(userId, xpReward);
    player.economy.fcCoins += coinsReward;
    player.economy.totalEarned += coinsReward;
    
    // +3 reputação por MVP
    this.updateReputation(userId, 3);
    
    // Verificar conquistas de MVP
    this.checkAchievements(userId, 'mvp', player.mvpCount);
    
    this.save();
    return { xp: xpReward, coins: coinsReward };
  }

  // ═══════════════════════════════════════════════════════════════
  // SISTEMA DE CAIXA DIÁRIA
  // ═══════════════════════════════════════════════════════════════

  claimDailyReward(userId) {
    const player = this.players[userId];
    if (!player) return { success: false, error: 'Jogador não encontrado' };
    
    const now = Date.now();
    const dailyMs = 24 * 60 * 60 * 1000;
    
    if (!player.dailyReward) {
      player.dailyReward = { lastClaim: 0, streak: 0 };
    }
    
    if (now - player.dailyReward.lastClaim < dailyMs) {
      const remainingMs = dailyMs - (now - player.dailyReward.lastClaim);
      const hours = Math.floor(remainingMs / (60 * 60 * 1000));
      const mins = Math.ceil((remainingMs % (60 * 60 * 1000)) / 60000);
      return { 
        success: false, 
        error: `⏳ Próxima caixa em ${hours}h ${mins}min` 
      };
    }
    
    // Calcular recompensa baseada na sequência
    player.dailyReward.streak = (player.dailyReward.streak || 0) + 1;
    player.dailyReward.lastClaim = now;
    
    const streak = player.dailyReward.streak;
    const baseCoins = 500;
    const baseXP = 50;
    const streakBonus = Math.min(streak * 0.1, 1); // até 100% de bônus
    
    const coinsReward = Math.floor(baseCoins * (1 + streakBonus));
    const xpReward = Math.floor(baseXP * (1 + streakBonus));
    
    this.addXP(userId, xpReward);
    player.economy.fcCoins += coinsReward;
    player.economy.totalEarned += coinsReward;
    
    // Verificar conquistas de sequência
    if (streak === 5) this.checkAchievements(userId, 'streak', 5);
    if (streak === 10) this.checkAchievements(userId, 'streak', 10);
    
    this.save();
    
    return { 
      success: true, 
      coins: coinsReward, 
      xp: xpReward, 
      streak: streak 
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // SISTEMA DE MISSÕES SEMANAIS
  // ═══════════════════════════════════════════════════════════════

  generateWeeklyMissions(userId) {
    const player = this.players[userId];
    if (!player) return null;
    
    const now = Date.now();
    const weeklyMs = 7 * 24 * 60 * 60 * 1000;
    
    // Gerar novas missões se necessário
    if (!player.weeklyMissions || now - (player.weeklyReset || 0) > weeklyMs) {
      const missions = [
        { id: 'win_matches', desc: 'Ganhe 10 partidas', current: 0, target: 10, type: 'win' },
        { id: 'play_solo', desc: 'Jogue 20 vezes no Fut Solo', current: 0, target: 20, type: 'solo' },
        { id: 'win_x1', desc: 'Ganhe 5 X1', current: 0, target: 5, type: 'x1' },
        { id: 'score_goals', desc: 'Marque 30 gols', current: 0, target: 30, type: 'goals' },
        { id: 'train', desc: 'Treine 15 vezes', current: 0, target: 15, type: 'train' },
        { id: 'earn_mvp', desc: 'Ganhe 3 MVPs', current: 0, target: 3, type: 'mvp' }
      ];
      
      // Selecionar 3 missões aleatórias
      const shuffled = missions.sort(() => Math.random() - 0.5);
      player.weeklyMissions = shuffled.slice(0, 3).map(m => ({ ...m, completed: false }));
      player.weeklyReset = now;
      this.save();
    }
    
    return player.weeklyMissions;
  }

  updateWeeklyMission(userId, type) {
    const player = this.players[userId];
    if (!player || !player.weeklyMissions) return [];
    
    const completedMissions = [];
    
    player.weeklyMissions.forEach(mission => {
      if (mission.completed || mission.type !== type) return;
      
      mission.current++;
      if (mission.current >= mission.target) {
        mission.completed = true;
        completedMissions.push(mission);
        
        // Recompensa
        const reward = {
          coins: mission.target * 100,
          xp: mission.target * 20
        };
        this.addXP(userId, reward.xp);
        player.economy.fcCoins += reward.coins;
        player.economy.totalEarned += reward.coins;
      }
    });
    
    if (completedMissions.length > 0) this.save();
    return completedMissions;
  }

  // ═══════════════════════════════════════════════════════════════
  // FUT SOLO
  // ═══════════════════════════════════════════════════════════════

  // Configurações do Fut Solo
  soloConfig = {
    normal: { xpWin: 6, coinsWin: 200, xpDraw: 3, coinsDraw: 100, xpLoss: 1, coinsLoss: 50 },
    dificil: { xpWin: 8, coinsWin: 300, xpDraw: 4, coinsDraw: 150, xpLoss: 2, coinsLoss: 75 },
    extremo: { xpWin: 12, coinsWin: 500, xpDraw: 6, coinsDraw: 250, xpLoss: 3, coinsLoss: 100 },
    streakBonus: { 3: 0.10, 5: 0.20, 10: 0.35 }
  };

  // Simular partida Fut Solo
  simulateSoloMatch(userId, difficulty) {
    const player = this.players[userId];
    if (!player) return { success: false, error: 'Jogador não encontrado' };

    // Verificar energia
    if (!player.energy || player.energy.current < 30) {
      return { success: false, error: '⚡ Energia insuficiente! (mínimo 30)' };
    }

    // Consumir energia (30 por partida)
    player.energy.current -= 30;
    
    // Calcular OVR do adversário baseado na dificuldade
    const playerOVR = player.ovr;
    let enemyOVR;
    
    switch (difficulty) {
      case 'normal':
        enemyOVR = playerOVR + Math.floor(Math.random() * 5) - 2; // -2 a +2
        break;
      case 'dificil':
        enemyOVR = playerOVR + Math.floor(Math.random() * 5) + 3; // +3 a +7
        break;
      case 'extremo':
        enemyOVR = playerOVR + Math.floor(Math.random() * 8) + 8; // +8 a +15
        break;
      default:
        enemyOVR = playerOVR;
    }
    
    enemyOVR = Math.min(99, Math.max(40, enemyOVR));

    // Simular resultado baseado nas estatísticas
    const playerStrength = playerOVR + player.attributes.dri * 0.2 + player.attributes.sho * 0.1;
    const enemyStrength = enemyOVR * 1.2;
    const randomFactor = Math.random();
    
    // Calcular probabilidades
    const winChance = playerStrength / (playerStrength + enemyStrength);
    let result;
    let playerGoals, enemyGoals;

    if (randomFactor < winChance - 0.15) {
      result = 'win';
      playerGoals = Math.floor(Math.random() * 3) + 2;
      enemyGoals = Math.floor(Math.random() * playerGoals);
    } else if (randomFactor > winChance + 0.15) {
      result = 'loss';
      enemyGoals = Math.floor(Math.random() * 3) + 2;
      playerGoals = Math.floor(Math.random() * enemyGoals);
    } else {
      result = 'draw';
      playerGoals = Math.floor(Math.random() * 3) + 1;
      enemyGoals = playerGoals;
    }

    // Atualizar estatísticas solo
    if (!player.soloStats) {
      player.soloStats = { victories: 0, draws: 0, losses: 0, streak: 0, bestStreak: 0, totalPlayed: 0 };
    }
    player.soloStats.totalPlayed++;

    // Atualizar streak
    if (result === 'win') {
      player.soloStats.victories++;
      player.soloStats.streak++;
      if (player.soloStats.streak > player.soloStats.bestStreak) {
        player.soloStats.bestStreak = player.soloStats.streak;
      }
    } else if (result === 'loss') {
      player.soloStats.losses++;
      player.soloStats.streak = 0;
    } else {
      player.soloStats.draws++;
    }

    // ATUALIZAR ESTATÍSTICAS GLOBAIS (perfil do jogador)
    if (!player.stats) {
      player.stats = { matches: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 };
    }
    player.stats.matches++;
    player.stats.goalsFor += playerGoals;
    player.stats.goalsAgainst += enemyGoals;
    if (result === 'win') {
      player.stats.wins++;
      this.updateReputation(userId, 1);
    } else if (result === 'loss') {
      player.stats.losses++;
      this.updateReputation(userId, -0.5);
    } else {
      player.stats.draws++;
    }

    // Calcular recompensas
    const config = this.soloConfig[difficulty] || this.soloConfig.normal;
    let xpReward, coinsReward;

    if (result === 'win') {
      xpReward = config.xpWin;
      coinsReward = config.coinsWin;
    } else if (result === 'draw') {
      xpReward = config.xpDraw;
      coinsReward = config.coinsDraw;
    } else {
      xpReward = config.xpLoss;
      coinsReward = config.coinsLoss;
    }

    // Bônus de sequência
    let streakBonus = 0;
    for (const [streak, bonus] of Object.entries(this.soloConfig.streakBonus)) {
      if (player.soloStats.streak >= parseInt(streak)) {
        streakBonus = bonus;
      }
    }

    xpReward = Math.floor(xpReward * (1 + streakBonus));
    coinsReward = Math.floor(coinsReward * (1 + streakBonus));

    // Adicionar XP
    const xpResult = this.addXP(userId, xpReward);

    // Adicionar coins
    player.economy.fcCoins += coinsReward;
    player.economy.totalEarned += coinsReward;

    // Atualizar forma
    this.updatePlayerForm(userId, result === 'win' ? 'win' : result === 'draw' ? 'draw' : 'loss');
    
    // Atualizar conquistas
    if (result === 'win') {
      this.checkAchievements(userId, 'solo_win', player.soloStats.victories);
    }
    this.checkAchievements(userId, 'match', player.soloStats.totalPlayed);
    
    // Atualizar missões semanais
    this.updateWeeklyMission(userId, 'solo');
    if (result === 'win') {
      this.updateWeeklyMission(userId, 'win');
    }

    this.save();

    return {
      success: true,
      result: result,
      playerGoals: playerGoals,
      enemyGoals: enemyGoals,
      enemyOVR: enemyOVR,
      difficulty: difficulty,
      xpGained: xpResult.xpGained,
      xpBonus: xpResult.bonusApplied,
      coinsGained: coinsReward,
      streak: player.soloStats.streak,
      streakBonus: Math.round(streakBonus * 100),
      leveledUp: xpResult.leveledUp,
      newLevel: xpResult.leveledUp ? xpResult.levelsGained : null,
      evolutionPoints: xpResult.leveledUp ? xpResult.totalEvolutionPoints : null
    };
  }

  // Obter ranking solo
  getSoloRanking() {
    return Object.values(this.players)
      .filter(p => p.soloStats && p.soloStats.victories > 0)
      .sort((a, b) => b.soloStats.victories - a.soloStats.victories)
      .slice(0, 10)
      .map((p, i) => ({
        rank: i + 1,
        name: p.name,
        victories: p.soloStats.victories,
        winRate: p.soloStats.totalPlayed > 0 
          ? Math.round((p.soloStats.victories / p.soloStats.totalPlayed) * 100) 
          : 0,
        bestStreak: p.soloStats.bestStreak
      }));
  }

  calculateOVR(attributes) {
    // Fórmula inspirada no EA FC
    const { pac, sho, pas, dri, def, phy } = attributes;
    
    // Pesos diferentes para cada atributo
    const pacWeight = 0.15;
    const shoWeight = 0.25;
    const pasWeight = 0.15;
    const driWeight = 0.20;
    const defWeight = 0.10;
    const phyWeight = 0.15;
    
    const ovr = Math.round(
      (pac * pacWeight) +
      (sho * shoWeight) +
      (pas * pasWeight) +
      (dri * driWeight) +
      (def * defWeight) +
      (phy * phyWeight)
    );
    
    return Math.min(99, Math.max(40, ovr));
  }

  updatePlayerOVR(userId) {
    const player = this.players[userId];
    if (player) {
      player.ovr = this.calculateOVR(player.attributes);
      this.save();
    }
  }

  getPlayerByGroup(userId, groupId) {
    const player = this.players[userId];
    if (!player) return null;
    
    // Verificar se o jogador tem dados neste grupo
    if (!player.groups) {
      player.groups = {};
    }
    
    if (!player.groups[groupId]) {
      player.groups[groupId] = {
        division: { ...player.division },
        stats: { ...player.stats },
        matches: 0
      };
    }
    
    return player;
  }

  // ═══════════════════════════════════════════════════════════════
  // CLUBES
  // ═══════════════════════════════════════════════════════════════

  getClub(clubId) {
    return this.clubs[clubId] || null;
  }

  getClubByName(name) {
    const clubName = name.toLowerCase();
    return Object.values(this.clubs).find(c => c.name.toLowerCase() === clubName);
  }

  createClub(name, ownerId, ownerName) {
    const clubId = `club_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const club = {
      id: clubId,
      name: name,
      createdAt: Date.now(),
      president: {
        id: ownerId,
        name: ownerName
      },
      players: [{
        id: ownerId,
        name: ownerName,
        role: 'President',
        salary: 0,
        joinedAt: Date.now()
      }],
      stats: {
        matches: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        titles: 0
      },
      economy: {
        balance: 100000, // FC Coins inicial
        totalEarned: 100000,
        totalSpent: 0,
        weeklyCosts: 0
      },
      championships: [],
      formation: '4-4-2',
      groupId: null
    };
    
    this.clubs[clubId] = club;
    
    // Atualizar o dono
    if (this.players[ownerId]) {
      this.players[ownerId].currentClub = clubId;
      this.players[ownerId].salary = 0;
    }
    
    this.save();
    return club;
  }

  addPlayerToClub(clubId, playerId, salary = 0) {
    const club = this.clubs[clubId];
    if (!club) return false;
    
    if (club.players.length >= 5) {
      return { success: false, error: 'Clube já tem 5 jogadores' };
    }
    
    const player = this.players[playerId];
    if (!player) return { success: false, error: 'Jogador não encontrado' };
    
    if (player.currentClub) {
      return { success: false, error: 'Jogador já está em um clube' };
    }
    
    const member = {
      id: playerId,
      name: player.name,
      role: 'Jogador',
      salary: salary,
      joinedAt: Date.now(),
      signingBonus: salary * 10
    };
    
    club.players.push(member);
    club.economy.balance -= member.signingBonus;
    club.economy.weeklyCosts += salary;
    club.economy.totalSpent += member.signingBonus;
    
    player.currentClub = clubId;
    player.salary = salary;
    player.weeklySalary = salary;
    
    this.save();
    return { success: true, member };
  }

  removePlayerFromClub(clubId, playerId) {
    const club = this.clubs[clubId];
    if (!club) return false;
    
    const playerIndex = club.players.findIndex(p => p.id === playerId);
    if (playerIndex === -1) return false;
    
    const member = club.players[playerIndex];
    
    // Presidente não pode sair assim
    if (member.role === 'President') {
      return { success: false, error: 'Presidente não pode sair. Transfira a presidência ou dissolva o clube.' };
    }
    
    club.players.splice(playerIndex, 1);
    club.economy.weeklyCosts -= member.salary;
    
    if (this.players[playerId]) {
      this.players[playerId].currentClub = null;
      this.players[playerId].salary = 0;
      this.players[playerId].weeklySalary = 0;
    }
    
    this.save();
    return { success: true };
  }

  isClubComplete(clubId) {
    const club = this.clubs[clubId];
    return club && club.players.length === 5;
  }

  // ═══════════════════════════════════════════════════════════════
  // PARTIDAS X1
  // ═══════════════════════════════════════════════════════════════

  createX1Match(player1Id, player2Id) {
    const matchId = `x1_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const match = {
      id: matchId,
      type: 'x1',
      player1: {
        id: player1Id,
        name: this.players[player1Id]?.name || 'Jogador 1',
        ovr: this.players[player1Id]?.ovr || 60
      },
      player2: {
        id: player2Id,
        name: this.players[player2Id]?.name || 'Jogador 2',
        ovr: this.players[player2Id]?.ovr || 60
      },
      status: 'pending',
      challengedAt: Date.now(),
      expiresAt: Date.now() + (10 * 60 * 1000), // 10 minutos para aceitar
      result: null
    };
    
    this.matches.push(match);
    this.save();
    return match;
  }
  
  getPendingChallengeForPlayer(playerId) {
    return this.matches.find(m => 
      m.type === 'x1' && 
      m.status === 'pending' && 
      m.player2.id === playerId &&
      m.expiresAt > Date.now()
    );
  }

  simulateX1Match(matchId) {
    const match = this.matches.find(m => m.id === matchId);
    if (!match || match.status !== 'accepted') return null;
    
    const p1 = match.player1;
    const p2 = match.player2;
    
    // Obter dados dos jogadores do banco
    const p1Data = this.players[p1.id];
    const p2Data = this.players[p2.id];
    
    // Calcular bônus de forma (-5% a +5%)
    const form1 = this.getFormInfo(p1Data).bonus;
    const form2 = this.getFormInfo(p2Data).bonus;
    
    // Calcular bônus de reputação (-2% a +2%)
    const rep1 = ((p1Data.reputation || 50) - 50) / 50 * 0.02;
    const rep2 = ((p2Data.reputation || 50) - 50) / 50 * 0.02;
    
    // Calcular rivalidade (0 a 10%)
    const rivalry = this.getRivalry(p1.id, p2.id);
    const rivalryBonus = rivalry / 10; // máximo 10%
    
    // Cálculo baseado em OVR e fator sorte
    const ovrDiff = p1.ovr - p2.ovr;
    const luckFactor = (Math.random() - 0.5) * 15; // -7.5 a +7.5 (reduzido)
    
    // Probabilidade ajustada por OVR + forma + reputação + rivalidade
    const p1Chance = 50 + (ovrDiff * 2) + (form1 * 100) + (rep1 * 100) + luckFactor;
    
    // Gerar placar com bônus de rivalidade
    let score1, score2;
    const rivalryMatch = rivalry >= 50; // Partida de rivalidade intensa
    
    if (Math.random() * 100 < p1Chance) {
      // Jogador 1 vence
      const diff = Math.floor(Math.random() * (rivalryMatch ? 4 : 3)) + 1;
      score1 = Math.floor(Math.random() * (rivalryMatch ? 4 : 3)) + 1;
      score2 = score1 - diff;
      if (score2 < 0) score2 = 0;
    } else {
      // Jogador 2 vence
      const diff = Math.floor(Math.random() * (rivalryMatch ? 4 : 3)) + 1;
      score2 = Math.floor(Math.random() * (rivalryMatch ? 4 : 3)) + 1;
      score1 = score2 - diff;
      if (score1 < 0) score1 = 0;
    }
    
    // Se der empate, dar vitória para quem teve mais sorte
    if (score1 === score2) {
      if (luckFactor > 0) {
        score1++;
      } else {
        score2++;
      }
    }
    
    // Atualizar rivalidade após partida intensa
    if (rivalryMatch) {
      this.updateRivalry(p1.id, p2.id, 5);
    }
    
    match.result = {
      score1,
      score2,
      winner: score1 > score2 ? p1.id : p2.id,
      loser: score1 > score2 ? p2.id : p1.id,
      completedAt: Date.now(),
      rivalry: rivalryMatch
    };
    
    match.status = 'completed';
    
    // Atualizar estatísticas dos jogadores
    this.updateMatchStats(p1.id, p2.id, score1, score2, match.result.winner);
    
    // Calcular pontos ganhos (com bônus de rivalidade)
    const winnerPoints = this.calculateMatchPoints(p1.id, p2.id, true);
    const loserPoints = this.calculateMatchPoints(p2.id, p1.id, false);
    
    match.rewards = {
      winner: winnerPoints,
      loser: loserPoints,
      rivalryBonus: rivalryMatch
    };
    
    // Adicionar XP aos jogadores (com bônus de rivalidade)
    const baseXP = rivalryMatch ? 20 : 15;
    const baseXPLoss = rivalryMatch ? 8 : 5;
    const xpWinner = this.addXP(p1.id, score1 > score2 ? baseXP : baseXPLoss);
    const xpLoser = this.addXP(p2.id, score1 > score2 ? baseXPLoss : baseXP);
    
    match.xpRewards = {
      winner: { xp: xpWinner.xpGained, leveledUp: xpWinner.leveledUp },
      loser: { xp: xpLoser.xpGained, leveledUp: xpLoser.leveledUp }
    };
    
    // Atualizar forma
    this.updatePlayerForm(p1.id, score1 > score2 ? 'win' : score1 === score2 ? 'draw' : 'loss');
    this.updatePlayerForm(p2.id, score2 > score1 ? 'win' : score2 === score1 ? 'draw' : 'loss');
    
    // Atualizar conquistas
    if (score1 > score2) {
      this.checkAchievements(p1.id, 'win', this.players[p1.id].stats.wins);
      this.checkAchievements(p1.id, 'match', this.players[p1.id].stats.matches);
    } else {
      this.checkAchievements(p2.id, 'win', this.players[p2.id].stats.wins);
      this.checkAchievements(p2.id, 'match', this.players[p2.id].stats.matches);
    }
    
    // Atualizar missões semanais
    if (score1 > score2) {
      this.updateWeeklyMission(p1.id, 'win');
      this.updateWeeklyMission(p1.id, 'goals');
    } else {
      this.updateWeeklyMission(p2.id, 'win');
      this.updateWeeklyMission(p2.id, 'goals');
    }
    
    // Escolher MVP
    const mvpResult = this.calculateMVP(this.players[p1.id], this.players[p2.id], score1 > score2 ? 'win' : 'draw', score1, score2);
    const mvpId = mvpResult.winner.id;
    const mvpReward = this.awardMVP(mvpId);
    match.mvp = { id: mvpId, name: mvpResult.winner.name, reward: mvpReward };
    
    this.save();
    return match;
  }

  updateMatchStats(player1Id, player2Id, score1, score2, winnerId) {
    const p1 = this.players[player1Id];
    const p2 = this.players[player2Id];
    
    if (p1) {
      p1.stats.matches++;
      p1.stats.goalsFor += score1;
      p1.stats.goalsAgainst += score2;
      if (winnerId === player1Id) {
        p1.stats.wins++;
        p1.division.winStreak++;
        // Reputação +2 por vitória
        this.updateReputation(player1Id, 2);
      } else if (score1 === score2) {
        p1.stats.draws++;
        p1.division.winStreak = 0;
      } else {
        p1.stats.losses++;
        p1.division.winStreak = 0;
        // Reputação -1 por derrota
        this.updateReputation(player1Id, -1);
      }
    }
    
    if (p2) {
      p2.stats.matches++;
      p2.stats.goalsFor += score2;
      p2.stats.goalsAgainst += score1;
      if (winnerId === player2Id) {
        p2.stats.wins++;
        p2.division.winStreak++;
        // Reputação +2 por vitória
        this.updateReputation(player2Id, 2);
      } else if (score1 === score2) {
        p2.stats.draws++;
        p2.division.winStreak = 0;
      } else {
        p2.stats.losses++;
        p2.division.winStreak = 0;
        // Reputação -1 por derrota
        this.updateReputation(player2Id, -1);
      }
    }
  }

  // Atualiza estatísticas globais E solo (para modos Solo)
  updateGlobalStats(userId, goalsFor, goalsAgainst, result) {
    const player = this.players[userId];
    if (!player) return;

    // Estatísticas globais
    if (!player.stats) {
      player.stats = { matches: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 };
    }
    player.stats.matches++;
    player.stats.goalsFor += goalsFor;
    player.stats.goalsAgainst += goalsAgainst;

    if (result === 'win') {
      player.stats.wins++;
    } else if (result === 'loss') {
      player.stats.losses++;
    } else {
      player.stats.draws++;
    }

    // Estatísticas solo
    if (!player.soloStats) {
      player.soloStats = { victories: 0, draws: 0, losses: 0, streak: 0, bestStreak: 0, totalPlayed: 0 };
    }
    player.soloStats.totalPlayed++;
    if (result === 'win') {
      player.soloStats.victories++;
      player.soloStats.streak++;
      if (player.soloStats.streak > player.soloStats.bestStreak) {
        player.soloStats.bestStreak = player.soloStats.streak;
      }
    } else if (result === 'loss') {
      player.soloStats.losses++;
      player.soloStats.streak = 0;
    } else {
      player.soloStats.draws++;
    }
  }

  calculateMatchPoints(winnerId, loserId, isWinner) {
    const winner = this.players[winnerId];
    const loser = this.players[loserId];
    
    if (!winner || !loser) return { points: 0, coins: 0 };
    
    // Pontos base
    let basePoints = isWinner ? 25 : -15;
    
    // Ajuste por divisão do adversário
    const winnerDiv = this.getDivisionIndex(winner.division.id);
    const loserDiv = this.getDivisionIndex(loser.division.id);
    
    if (isWinner) {
      if (loserDiv > winnerDiv) {
        // Vitória contra divisão superior
        basePoints = 35 + Math.floor(Math.random() * 15);
      } else if (loserDiv < winnerDiv) {
        // Vitória contra divisão inferior
        basePoints = 15;
      }
      
      // Bônus por sequência de vitórias
      if (winner.division.winStreak >= 10) {
        basePoints = Math.floor(basePoints * 1.35);
      } else if (winner.division.winStreak >= 5) {
        basePoints = Math.floor(basePoints * 1.20);
      } else if (winner.division.winStreak >= 3) {
        basePoints = Math.floor(basePoints * 1.10);
      }
    }
    
    // Moedas de recompensa
    const coins = isWinner ? 1000 + (winner.ovr * 10) : 200;
    
    // Atualizar FC Coins
    winner.economy.fcCoins += coins;
    winner.economy.totalEarned += coins;
    
    // Atualizar pontos de divisão
    if (winner.division.protectionMatches <= 0) {
      winner.division.points = Math.max(0, winner.division.points + basePoints);
      
      // Verificar subida de divisão
      this.checkPromotion(winnerId);
    } else {
      winner.division.protectionMatches--;
    }
    
    return { points: basePoints, coins };
  }

  getDivisionIndex(divId) {
    return DIVISIONS.findIndex(d => d.id === divId);
  }

  checkPromotion(playerId) {
    const player = this.players[playerId];
    if (!player) return;
    
    const currentIndex = this.getDivisionIndex(player.division.id);
    if (currentIndex >= DIVISIONS.length - 1) return; // Já é Top Global
    
    const nextDiv = DIVISIONS[currentIndex + 1];
    if (player.division.points >= nextDiv.points) {
      player.division.id = nextDiv.id;
      player.division.protectionMatches = 5;
      
      // Recompensa por subir
      player.economy.fcCoins += 10000;
      player.economy.totalEarned += 10000;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // TREINOS
  // ═══════════════════════════════════════════════════════════════

  trainAttribute(userId, attribute) {
    const player = this.players[userId];
    if (!player) return { success: false, error: 'Jogador não encontrado' };
    
    const validAttrs = ['pac', 'sho', 'pas', 'dri', 'def', 'phy'];
    if (!validAttrs.includes(attribute)) {
      return { success: false, error: 'Atributo inválido' };
    }
    
    // Verificar cooldown de treino (30 minutos por atributo)
    if (!player.trainingCooldown) {
      player.trainingCooldown = {};
    }
    
    const cooldownMs = 30 * 60 * 1000; // 30 minutos
    const lastTraining = player.trainingCooldown[attribute] || 0;
    
    if (Date.now() - lastTraining < cooldownMs) {
      const remainingMs = cooldownMs - (Date.now() - lastTraining);
      const remainingMin = Math.ceil(remainingMs / 60000);
      return { 
        success: false, 
        error: `⏳ Cooldown ativo!\n\nAguarde ${remainingMin} minuto(s) para treinar ${attribute.toUpperCase()} novamente.` 
      };
    }
    
    // Verificar energia
    const energyCost = 30;
    if (!player.energy || player.energy.current < energyCost) {
      const currentEnergy = player.energy?.current || 0;
      const maxEnergy = player.energy?.max || 200;
      return { success: false, error: `⚡ Energia insuficiente!\nNecesário: ${energyCost}\nSua energia: ${currentEnergy}/${maxEnergy}\n\nUse !fut descansar para recuperar.` };
    }
    
    const gain = Math.floor(Math.random() * 3) + 1;
    
    // Verificar bônus de aprendizado rápido
    let finalGain = gain;
    const aprendizadoRapido = player.skills.find(s => s.id === 'aprendizado_rapido');
    if (aprendizadoRapido) {
      finalGain = Math.floor(gain * (1 + (aprendizadoRapido.level * 0.2)));
    }
    
    // Verificar se atributo já está no máximo
    if (player.attributes[attribute] >= 99) {
      return { success: false, error: 'Atributo já está no máximo (99)' };
    }
    
    // Gastar energia e atualizar cooldown
    player.energy.current -= energyCost;
    player.trainingCooldown[attribute] = Date.now();
    player.attributes[attribute] = Math.min(99, player.attributes[attribute] + finalGain);
    
    this.updatePlayerOVR(userId);
    this.save();
    
    return {
      success: true,
      attribute: attribute.toUpperCase(),
      gain: finalGain,
      newValue: player.attributes[attribute],
      newOVR: player.ovr,
      energySpent: energyCost,
      remainingEnergy: player.energy.current
    };
  }
  
  quickRest(userId) {
    const player = this.players[userId];
    if (!player) return { success: false, error: 'Jogador não encontrado' };
    
    // Verificar cooldown de 30 minutos
    const cooldownMs = 30 * 60 * 1000; // 30 minutos
    const lastCommand = player.lastRestCommand || 0;
    
    if (Date.now() - lastCommand < cooldownMs) {
      const remainingMs = cooldownMs - (Date.now() - lastCommand);
      const remainingMin = Math.ceil(remainingMs / 60000);
      return { 
        success: false, 
        error: `⏳ Cooldown ativo!\n\nAguarde ${remainingMin} minuto(s) para descansar novamente.\n\n💡 Dica: A energia recupera automaticamente com o tempo!` 
      };
    }
    
    const maxEnergy = player.energy?.max || 200;
    const currentEnergy = player.energy?.current || 0;
    
    // Recupera energia completa (200)
    const actualGain = maxEnergy - currentEnergy;
    
    if (!player.energy) {
      player.energy = { current: 200, max: 200, lastRest: Date.now() };
    }
    
    player.energy.current = maxEnergy;
    player.energy.lastRest = Date.now();
    player.lastRestCommand = Date.now();
    
    this.save();
    
    return { success: true, energyGained: actualGain, currentEnergy: player.energy.current, maxEnergy };
  }

  // ═══════════════════════════════════════════════════════════════
  // HABILIDADES
  // ═══════════════════════════════════════════════════════════════

  buySkill(userId, skillId) {
    const player = this.players[userId];
    if (!player) return { success: false, error: 'Jogador não encontrado' };
    
    const skillInfo = SKILLS.find(s => s.id === skillId);
    if (!skillInfo) return { success: false, error: 'Habilidade não encontrada' };
    
    const maxSlots = SKILL_SLOTS[player.division.id] || 1;
    
    // Verificar slots disponíveis
    if (player.skills.length >= maxSlots) {
      return { success: false, error: `Limite de habilidades atingido (${maxSlots} slots)` };
    }
    
    // Verificar se já tem esta habilidade
    const existingSkill = player.skills.find(s => s.id === skillId);
    if (existingSkill) {
      if (existingSkill.level >= skillInfo.maxLevel) {
        return { success: false, error: 'Habilidade já está no nível máximo' };
      }
      // Upgrade
      const cost = skillInfo.cost[existingSkill.level];
      if (player.economy.fcCoins < cost) {
        return { success: false, error: `FC Coins insuficientes. Necesário: ${cost}` };
      }
      
      player.economy.fcCoins -= cost;
      player.economy.totalSpent += cost;
      existingSkill.level++;
      
      this.save();
      return { success: true, skill: existingSkill, newLevel: existingSkill.level };
    }
    
    // Nova habilidade
    const cost = skillInfo.cost[0];
    if (player.economy.fcCoins < cost) {
      return { success: false, error: `FC Coins insuficientes. Necesário: ${cost}` };
    }
    
    player.economy.fcCoins -= cost;
    player.economy.totalSpent += cost;
    player.skills.push({ id: skillId, level: 1 });
    
    this.save();
    return { success: true, skill: { id: skillId, level: 1 } };
  }

  // ═══════════════════════════════════════════════════════════════
  // PROPOSTAS
  // ═══════════════════════════════════════════════════════════════

  createProposal(fromClubId, toPlayerId, salary, signingBonus) {
    const club = this.clubs[fromClubId];
    const player = this.players[toPlayerId];
    
    if (!club) return { success: false, error: 'Clube não encontrado' };
    if (!player) return { success: false, error: 'Jogador não encontrado' };
    if (player.currentClub) return { success: false, error: 'Jogador já está em um clube' };
    if (club.players.length >= 5) return { success: false, error: 'Clube já está completo' };
    
    const totalCost = (signingBonus || salary * 10) + (signingBonus || 0);
    if (club.economy.balance < totalCost) {
      return { success: false, error: 'Clube não tem FC Coins suficientes' };
    }
    
    const proposalId = `prop_${Date.now()}`;
    const proposal = {
      id: proposalId,
      clubId: fromClubId,
      clubName: club.name,
      playerId: toPlayerId,
      salary: salary,
      signingBonus: signingBonus || salary * 10,
      createdAt: Date.now(),
      expiresAt: Date.now() + (24 * 60 * 60 * 1000) // 24 horas
    };
    
    this.market.proposals.push(proposal);
    this.save();
    
    return { success: true, proposal };
  }

  getPlayerProposals(playerId) {
    return this.market.proposals.filter(p => 
      p.playerId === playerId && p.expiresAt > Date.now()
    );
  }

  acceptProposal(proposalId, playerId) {
    const proposal = this.market.proposals.find(p => 
      p.id === proposalId && p.playerId === playerId
    );
    
    if (!proposal) return { success: false, error: 'Proposta não encontrada' };
    if (proposal.expiresAt < Date.now()) return { success: false, error: 'Proposta expirada' };
    
    const player = this.players[playerId];
    if (player.currentClub) return { success: false, error: 'Você já está em um clube' };
    
    const result = this.addPlayerToClub(proposal.clubId, playerId, proposal.salary);
    if (!result.success) return result;
    
    // Remover proposta
    this.market.proposals = this.market.proposals.filter(p => p.id !== proposalId);
    this.save();
    
    return { success: true };
  }

  // ═══════════════════════════════════════════════════════════════
  // NEGOCIAÇÕES
  // ═══════════════════════════════════════════════════════════════

  createNegotiation(clubId, playerId, salary, counterOffer = false) {
    const negotiationId = `neg_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    
    const negotiation = {
      id: negotiationId,
      clubId: clubId,
      clubName: this.clubs[clubId]?.name || 'Clube',
      playerId: playerId,
      playerName: this.players[playerId]?.name || 'Jogador',
      salary: salary,
      counterOffer: counterOffer, // true se é contra-oferta do jogador
      createdAt: Date.now(),
      expiresAt: Date.now() + (24 * 60 * 60 * 1000),
      status: 'pending' // pending, accepted, rejected, expired
    };
    
    this.market.negotiations.push(negotiation);
    this.save();
    
    return negotiation;
  }

  getPlayerNegotiations(playerId) {
    return this.market.negotiations.filter(n => 
      n.playerId === playerId && n.status === 'pending'
    );
  }

  getClubNegotiations(clubId) {
    return this.market.negotiations.filter(n => 
      n.clubId === clubId && n.status === 'pending'
    );
  }

  getNegotiation(negotiationId) {
    return this.market.negotiations.find(n => n.id === negotiationId);
  }

  acceptNegotiation(negotiationId, byPlayer = false) {
    const neg = this.getNegotiation(negotiationId);
    if (!neg) return { success: false, error: 'Negociação não encontrada' };
    if (neg.status !== 'pending') return { success: false, error: 'Negociação já encerrada' };
    
    // Adicionar jogador ao clube
    const player = this.players[neg.playerId];
    if (!player) return { success: false, error: 'Jogador não encontrado' };
    if (player.currentClub) return { success: false, error: 'Jogador já está em um clube' };
    
    const club = this.clubs[neg.clubId];
    if (!club) return { success: false, error: 'Clube não encontrado' };
    if (club.players.length >= 5) return { success: false, error: 'Clube cheio' };
    
    // Verificar se clube tem saldo
    const weeklyCost = neg.salary * 5; // 5 semanas de salário como bônus de assinatura
    if (club.economy.balance < weeklyCost) {
      return { success: false, error: 'Clube não tem FC Coins suficientes' };
    }
    
    // Contratar
    player.currentClub = neg.clubId;
    player.salary = neg.salary;
    player.weeklySalary = neg.salary;
    player.joinedClubAt = Date.now();
    
    // Gastar do clube
    club.economy.balance -= weeklyCost;
    club.players.push({
      id: neg.playerId,
      name: neg.playerName,
      ovr: player.ovr,
      salary: neg.salary,
      joinedAt: Date.now()
    });
    
    // Encerrar negociação
    neg.status = 'accepted';
    neg.respondedAt = Date.now();
    
    // Limpar outras negociações pendentes do jogador
    this.market.negotiations = this.market.negotiations.filter(n => 
      n.id !== negotiationId && n.playerId !== neg.playerId && n.status === 'pending'
    );
    
    this.save();
    
    return { success: true, negotiation: neg };
  }

  rejectNegotiation(negotiationId) {
    const neg = this.getNegotiation(negotiationId);
    if (!neg) return { success: false, error: 'Negociação não encontrada' };
    
    neg.status = 'rejected';
    neg.respondedAt = Date.now();
    this.save();
    
    return { success: true };
  }

  // ═══════════════════════════════════════════════════════════════
  // RANKING GLOBAL
  // ═══════════════════════════════════════════════════════════════

  updateGlobalRanking() {
    // Ranking de jogadores
    const players = Object.values(this.players)
      .filter(p => p.division.id !== 'bronze_3') // Filtrar novos
      .sort((a, b) => {
        if (a.division.id === 'topglobal' && b.division.id !== 'topglobal') return -1;
        if (b.division.id === 'topglobal' && a.division.id !== 'topglobal') return 1;
        if (a.division.id === 'worldclass_1' && !['worldclass_1', 'topglobal'].includes(b.division.id)) return -1;
        if (b.division.id === 'worldclass_1' && !['worldclass_1', 'topglobal'].includes(a.division.id)) return 1;
        return b.division.points - a.division.points;
      })
      .slice(0, 100);
    
    this.globalRanking.players = players.map((p, i) => ({
      rank: i + 1,
      id: p.id,
      name: p.name,
      ovr: p.ovr,
      division: p.division.id,
      points: p.division.points
    }));
    
    // Ranking de clubes
    const clubs = Object.values(this.clubs)
      .filter(c => c.players.length === 5)
      .sort((a, b) => {
        if (b.stats.wins !== a.stats.wins) return b.stats.wins - a.stats.wins;
        const aOVR = a.players.reduce((sum, p) => sum + (this.players[p.id]?.ovr || 0), 0) / a.players.length;
        const bOVR = b.players.reduce((sum, p) => sum + (this.players[p.id]?.ovr || 0), 0) / b.players.length;
        return bOVR - aOVR;
      })
      .slice(0, 50);
    
    this.globalRanking.clubs = clubs.map((c, i) => ({
      rank: i + 1,
      id: c.id,
      name: c.name,
      players: c.players.length,
      wins: c.stats.wins,
      titles: c.stats.titles
    }));
    
    this.save();
  }

  getTopGlobal(limit = 10) {
    return this.globalRanking.players.slice(0, limit);
  }

  getClubRanking(limit = 10) {
    return this.globalRanking.clubs.slice(0, limit);
  }
}

export default new FootballDB();