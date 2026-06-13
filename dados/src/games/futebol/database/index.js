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
      weeklySalary: 0
    };
    
    this.players[userId] = player;
    this.save();
    return player;
  }

  hasPlayer(userId) {
    return !!this.players[userId];
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
    
    // Cálculo baseado em OVR e fator sorte
    const ovrDiff = p1.ovr - p2.ovr;
    const luckFactor = (Math.random() - 0.5) * 20; // -10 a +10
    
    // Probabilidade ajustada pelo OVR
    const p1Chance = 50 + (ovrDiff * 2) + luckFactor;
    
    // Gerar placar
    let score1, score2;
    
    if (Math.random() * 100 < p1Chance) {
      // Jogador 1 vence
      const diff = Math.floor(Math.random() * 3) + 1;
      score1 = Math.floor(Math.random() * 3) + 1;
      score2 = score1 - diff;
      if (score2 < 0) score2 = 0;
    } else {
      // Jogador 2 vence
      const diff = Math.floor(Math.random() * 3) + 1;
      score2 = Math.floor(Math.random() * 3) + 1;
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
    
    match.result = {
      score1,
      score2,
      winner: score1 > score2 ? p1.id : p2.id,
      loser: score1 > score2 ? p2.id : p1.id,
      completedAt: Date.now()
    };
    
    match.status = 'completed';
    
    // Atualizar estatísticas dos jogadores
    this.updateMatchStats(p1.id, p2.id, score1, score2, match.result.winner);
    
    // Calcular pontos ganhos
    const winnerPoints = this.calculateMatchPoints(p1.id, p2.id, true);
    const loserPoints = this.calculateMatchPoints(p2.id, p1.id, false);
    
    match.rewards = {
      winner: winnerPoints,
      loser: loserPoints
    };
    
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
      } else if (score1 === score2) {
        p1.stats.draws++;
        p1.division.winStreak = 0;
      } else {
        p1.stats.losses++;
        p1.division.winStreak = 0;
      }
    }
    
    if (p2) {
      p2.stats.matches++;
      p2.stats.goalsFor += score2;
      p2.stats.goalsAgainst += score1;
      if (winnerId === player2Id) {
        p2.stats.wins++;
        p2.division.winStreak++;
      } else if (score1 === score2) {
        p2.stats.draws++;
        p2.division.winStreak = 0;
      } else {
        p2.stats.losses++;
        p2.division.winStreak = 0;
      }
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
    
    // Gastar energia
    player.energy.current -= energyCost;
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
    
    const energyGain = Math.floor((player.energy?.max || 200) * 0.5);
    const currentEnergy = player.energy?.current || 0;
    const maxEnergy = player.energy?.max || 200;
    const actualGain = Math.min(energyGain, maxEnergy - currentEnergy);
    
    if (!player.energy) {
      player.energy = { current: 200, max: 200, lastRest: Date.now() };
    }
    
    player.energy.current = Math.min(maxEnergy, currentEnergy + actualGain);
    player.energy.lastRest = Date.now();
    
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