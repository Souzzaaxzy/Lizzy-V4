// ═══════════════════════════════════════════════════════════════
// 🏆 MENU DE FUTEBOL - KAISERBOT
// ═══════════════════════════════════════════════════════════════

import db from './database/index.js';

const DIVISIONS_EMOJI = {
  bronze_3: '🥉', bronze_2: '🥉', bronze_1: '🥉',
  prata_3: '🥈', prata_2: '🥈', prata_1: '🥈',
  ouro_3: '🥇', ouro_2: '🥇', ouro_1: '🥇',
  elite_3: '💎', elite_2: '💎', elite_1: '💎',
  lenda_3: '👑', lenda_2: '👑', lenda_1: '👑',
  mestre_3: '🔥', mestre_2: '🔥', mestre_1: '🔥',
  pro_3: '⚡', pro_2: '⚡', pro_1: '⚡',
  worldclass_2: '🌟', worldclass_1: '🌟',
  topglobal: '🏆'
};

const ATTR_NAMES = {
  pac: '⚡ Velocidade',
  sho: '🎯 Finalização',
  pas: '📤 Passe',
  dri: '⚽ Drible',
  def: '🛡️ Defesa',
  phy: '💪 Físico'
};

const ATTR_NAMES_SHORT = {
  pac: 'PAC', sho: 'SHO', pas: 'PAS',
  dri: 'DRI', def: 'DEF', phy: 'PHY'
};

// ═══════════════════════════════════════════════════════════════
// MENU PRINCIPAL
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// MENU PRINCIPAL - ESTILIZADO
// ═══════════════════════════════════════════════════════════════

export function getMenuFut(playerName = 'Jogador') {
  return `
⚽ ━━━━━━━━━━━━━━━━━━━━━━━━━━━ ┐
   *FUTEBOL GLOBAL* 🏆
⚽ ━━━━━━━━━━━━━━━━━━━━━━━━━━━ ┘

🌟 Bem-vindo, *${playerName}*!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 *PERFIL*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
👤 Perfil    → !fut perfil
📊 Stats     → !fut stats
💰 Saldo     → !fut saldo
⚡ Energia   → !fut energia

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚽ *TREINO*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🏋️ Treinar  → !fut tre pac/sho/pas/dri/def/phy
😴 Descansar → !fut descansar

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚔️ *PARTIDAS*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎮 X1        → !fut x1 @usuario
✅ Aceitar   → !fut ax1
❌ Recusar   → !fut rx1
🎯 Solo      → !fut solo [normal/dificil/extremo]
🔥 Rivalidade → !fut rivalidade @user

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🏆 *TORNEIOS*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 Ver       → !fut torneio
🎫 Entrar    → !fut torneio entrar [ID]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 *RANKINGS*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🥇 Divisões   → !fut divisoes
📈 Ranking    → !fut ranking
🌍 Top Global → !fut topglobal
⚽ Clubes     → !fut rankingclubes
⭐ Solo       → !fut soloscore

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⭐ *EVOLUÇÃO*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 XP        → !fut xp
💎 Evoluir   → !fut evoluir [attr] [pts]
🎯 Atributos → !fut atributos
🛒 Habilidades → !fut hab

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚙️ *CLUBE*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🏗️ Criar     → !fut criar [nome]
📋 Meu Clube → !fut clube
👥 Membros   → !fut membros
🚪 Sair      → !fut sair
💼 Proposta  → !fut prop @user [salário]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💼 *NEGOCIAÇÕES*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📨 Ver       → !fut negs
✅ Aceitar   → !fut ace [id]
❌ Recusar   → !fut repro [id]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎁 *RECOMPENSAS*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📦 Diária    → !fut diaria
📅 Semanal   → !fut semanal
🎫 Código    → !fut codigo [CODIGO]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🏅 *EXTRAS*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔥 Forma      → !fut forma
🏆 Conquistas → !fut conquistas
👑 Títulos    → !fut titulos
🏅 Temporada  → !fut temporada
⭐ Reputação  → !fut reputacao
⚔️ Rivalidades → !fut rivalidades

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ *ADMINISTRAÇÃO*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔧 Use *!fut admin* para acessar os comandos administrativos

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 Use *!fut entrar* para começar!`;
}

// ═══════════════════════════════════════════════════════════════
// MENU ADMIN - ESTILIZADO
// ═══════════════════════════════════════════════════════════════

export function getMenuAdminFut() {
  return `
🔧 ━━━━━━━━━━━━━━━━━━━━━━━━━━━ ┐
   *ADMIN FUTEBOL* ⚙️
🔧 ━━━━━━━━━━━━━━━━━━━━━━━━━━━ ┘

*⚠️ Apenas admins do grupo*

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
👤 *JOGADORES*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

💰 *addcoins*
📝 Adiciona FC Coins a um jogador
📌 Use: *!fut admin addcoins @user [valor]*
📌 Ex: *!fut admin addcoins @usuario 5000*

💸 *remcoins*
📝 Remove FC Coins de um jogador
📌 Use: *!fut admin remcoins @user [valor]*
📌 Ex: *!fut admin remcoins @usuario 1000*

🎮 *setovr*
📝 Define o Overall (OVR) de um jogador
📌 Use: *!fut admin setovr @user [1-99]*
📌 Ex: *!fut admin setovr @usuario 85*

⚡ *setenergy*
📝 Define a energia de um jogador
📌 Use: *!fut admin setenergy @user [0-200]*
📌 Ex: *!fut admin setenergy @usuario 150*

🏆 *setdiv*
📝 Define a divisão de um jogador
📌 Use: *!fut admin setdiv @user [bronze/prata/ouro/elite/lenda/mestre/pro/worldclass/topglobal]
📌 Ex: *!fut admin setdiv @usuario ouro*

👑 *resetplayer*
📝 Reseta completamente um jogador
📌 Use: *!fut admin resetplayer @user*
📌 Ex: *!fut admin resetplayer @usuario*

⭐ *addmvp*
📝 Adiciona MVPs a um jogador
📌 Use: *!fut admin addmvp @user [quantidade]*
📌 Ex: *!fut admin addmvp @usuario 5*

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⭐ *XP & EVOLUÇÃO*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📈 *addxp*
📝 Adiciona XP a um jogador
📌 Use: *!fut admin addxp @user [valor]*
📌 Ex: *!fut admin addxp @usuario 500*

🎯 *setlevel*
📝 Define o nível de XP de um jogador
📌 Use: *!fut admin setlevel @user [1-100]*
📌 Ex: *!fut admin setlevel @usuario 25*

💎 *setevo*
📝 Define pontos de evolução de um jogador
📌 Use: *!fut admin setevo @user [pontos]*
📌 Ex: *!fut admin setevo @usuario 100*

➕ *addevo*
📝 Adiciona pontos de evolução a um jogador
📌 Use: *!fut admin addevo @user [pontos]*
📌 Ex: *!fut admin addevo @usuario 50*

🔄 *resetxp*
📝 Reseta todo o XP de um jogador
📌 Use: *!fut admin resetxp @user*
📌 Ex: *!fut admin resetxp @usuario*

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 *ATRIBUTOS*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚡ *settreino*
📝 Define o valor de um atributo treinado
📌 Use: *!fut admin settreino @user [attr] [valor]*
📌 Attrs: pac, sho, pas, dri, def, phy
📌 Ex: *!fut admin settreino @usuario pac 80*

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🌟 *REPUTAÇÃO*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 *setrep*
📝 Define a reputação de um jogador (0-100)
📌 Use: *!fut admin setrep @user [0-100]*
📌 Ex: *!fut admin setrep @usuario 75*

➕ *addrep*
📝 Adiciona ou remove reputação
📌 Use: *!fut admin addrep @user [±valor]*
📌 Ex: *!fut admin addrep @usuario +10*

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🏆 *TEMPORADA*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 *season*
📝 Mostra o status atual da temporada

🔄 *season reset*
📝 Reseta todos os dados da temporada

⚙️ *season config*
📝 Configura os parâmetros da temporada

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎁 *CÓDIGOS*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🎫 *codigo criar*
📝 Cria um código promocional
📌 Use: *!fut admin codigo criar [CODIGO] [COINS] [XP] [USOS] [HORAS]*
📌 Ex: *!fut admin codigo criar VIP2026 5000 200 50 48*

🎲 *codigo misterioso*
📝 Cria código com valores aleatórios
📌 Use: *!fut admin codigo misterioso [MINC] [MAXC] [MINX] [MAXX] [USOS]*
📌 Ex: *!fut admin codigo misterioso 1000 5000 50 200 10*

📋 *codigo listar*
📝 Lista todos os códigos ativos

📜 *codigo log*
📝 Mostra o histórico de uso dos códigos

❌ *codigo desativar*
📝 Desativa um código promocional
📌 Use: *!fut admin codigo desativar [CODIGO]*
📌 Ex: *!fut admin codigo desativar VIP2026*

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🏆 *TORNEIOS*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

➕ *torneio criar*
📝 Cria um novo torneio
📌 Use: *!fut admin torneio criar [NOME]|[TIPO]|[MAX]|[ENTRADA]|[PREMIO]|[TROFÉU]*
📌 Ex: *!fut admin torneio criar Copa Legends|x1|16|1000|10000|Campeão*

▶️ *torneio iniciar*
📝 Inicia um torneio (muda para fase de jogos)
📌 Use: *!fut admin torneio iniciar [ID]*

⚽ *torneio jogar*
📝 Processa a próxima partida do torneio
📌 Use: *!fut admin torneio jogar [ID]*

👁️ *torneio ver*
📝 Mostra detalhes de um torneio
📌 Use: *!fut admin torneio ver [ID]*

❌ *torneio cancelar*
📝 Cancela um torneio
📌 Use: *!fut admin torneio cancelar [ID]*

📋 *torneio listar*
📝 Lista todos os torneios

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 *FUT SOLO*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔄 *setsolo*
📝 Reseta o ranking solo de um jogador
📌 Use: *!fut admin setsolo @user reset*

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💥 *RESET GERAL*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️ *resetall*
📝 Reseta TODOS os dados do sistema de futebol

🏠 *clubes reset*
📝 Reseta todos os clubes

⚔️ *x1reset*
📝 Limpa todos os X1 pendentes`;
}

// ═══════════════════════════════════════════════════════════════
// ENTRAR NO SISTEMA
// ═══════════════════════════════════════════════════════════════

export function getEnterMessage(playerName) {
  return `
⚽ *BEM-VINDO AO FUTEBOL GLOBAL!* ⚽

Parabéns, ${playerName}! Você entrou no mundo do futebol!

📊 *SEUS ATRIBUTOS INICIAIS:*
━━━━━━━━━━━━━━━━━━━━━━━━
⚡ PAC: 60 | 🎯 SHO: 60
📤 PAS: 60 | ⚽ DRI: 60
🛡️ DEF: 60 | 💪 PHY: 60
━━━━━━━━━━━━━━━━━━━━━━━━
🎮 OVR: 60

💰 FC Coins: 50.000
⚡ Energia: 200/200

📌 *COMANDOS:*
• !fut treinar [atributo] - Treinar
• !fut descansar - Recuperar energia
• !fut x1 @usuario - Jogar partida
• !fut criarclube - Criar um clube

Boa sorte! 🏆`;
}

// ═══════════════════════════════════════════════════════════════
// PERFIL DO JOGADOR
// ═══════════════════════════════════════════════════════════════

export function getProfileMessage(player) {
  const divEmoji = DIVISIONS_EMOJI[player.division.id] || '🏆';
  const divName = getDivisionName(player.division.id);
  
  let skillsText = 'Nenhuma';
  if (player.skills.length > 0) {
    skillsText = player.skills.map(s => {
      const skillInfo = db.SKILLS?.find(sk => sk.id === s.id);
      return `${skillInfo?.name || s.id} (N${s.level})`;
    }).join(', ');
  }
  
  let clubInfo = 'Nenhum';
  if (player.currentClub) {
    const club = db.getClub(player.currentClub);
    clubInfo = club?.name || 'Desconhecido';
  }
  
  // Info de XP
  const xpInfo = player.xp || { level: 1, currentXP: 0, evolutionPoints: 0 };
  const xpNeeded = Math.floor(xpInfo.level * 100 + (xpInfo.level - 1) * 20);
  
  // Info de Forma
  const formInfo = db.getFormInfo(player);
  
  return `
⚽ *PERFIL DE JOGADOR* ⚽

👤 *Nome:* ${player.name}
${player.equippedTitle ? `🏅 ${player.equippedTitle}\n` : ''}🏆 *Divisão:* ${divEmoji} ${divName}
📊 *OVR:* ${player.ovr}
⭐ *Nível:* ${xpInfo.level}
${formInfo.emoji} *Forma:* ${formInfo.label}
💰 *FC Coins:* ${player.economy.fcCoins.toLocaleString()}
${player.mvpCount > 0 ? `⭐ *MVPs:* ${player.mvpCount}` : ''}

━━━━━━━━━━━━━━━━━━━━━━━━
⚡ PAC: ${player.attributes.pac}
🎯 SHO: ${player.attributes.sho}
📤 PAS: ${player.attributes.pas}
⚽ DRI: ${player.attributes.dri}
🛡️ DEF: ${player.attributes.def}
💪 PHY: ${player.attributes.phy}
━━━━━━━━━━━━━━━━━━━━━━━━

⭐ *XP FUTEBOL:*
• Nível: ${xpInfo.level}
• XP: ${xpInfo.currentXP}/${xpNeeded}
• 💎 Pontos Evolução: ${xpInfo.evolutionPoints}

🏅 *ESTATÍSTICAS:*
• Partidas: ${player.stats.matches}
• Vitórias: ${player.stats.wins}
• Empates: ${player.stats.draws}
• Derrotas: ${player.stats.losses}
• Gols marcados: ${player.stats.goalsFor}
• Gols sofridos: ${player.stats.goalsAgainst}

🏟️ *CLUBE:* ${clubInfo}
💪 *Habilidades:* ${skillsText}
🎯 *Sequência:* ${player.division.winStreak} vitórias`;
}

// ═══════════════════════════════════════════════════════════════
// ESTATÍSTICAS
// ═══════════════════════════════════════════════════════════════

export function getStatsMessage(player) {
  const winRate = player.stats.matches > 0 
    ? ((player.stats.wins / player.stats.matches) * 100).toFixed(1) 
    : 0;
  
  const goalsPerMatch = player.stats.matches > 0 
    ? (player.stats.goalsFor / player.stats.matches).toFixed(2) 
    : 0;
  
  return `
📊 *ESTATÍSTICAS DETALHADAS*

👤 *${player.name}*

━━━━━━━━━━━━━━━━━━━━━━━━
⚽ *CAMPANHA:*
• Partidas: ${player.stats.matches}
• Vitórias: ${player.stats.wins} (${winRate}%)
• Empates: ${player.stats.draws}
• Derrotas: ${player.stats.losses}

⚽ *ATAQUE:*
• Gols marcados: ${player.stats.goalsFor}
• Gols/partida: ${goalsPerMatch}

🛡️ *DEFESA:*
• Gols sofridos: ${player.stats.goalsAgainst}

💰 *FINANCEIRO:*
• FC Coins: ${player.economy.fcCoins.toLocaleString()}
• Total ganho: ${player.economy.totalEarned.toLocaleString()}
• Total gasto: ${player.economy.totalSpent.toLocaleString()}

🎯 *MOMENTO:*
• Sequência: ${player.division.winStreak} vitórias
• Proteção: ${player.division.protectionMatches} partidas`;
}

// ═══════════════════════════════════════════════════════════════
// DIVISÕES
// ═══════════════════════════════════════════════════════════════

export function getDivisionsMessage() {
  const divisions = [
    { name: 'Top Global', emoji: '🏆', points: '---', players: 'Elite' },
    { name: 'World Class I', emoji: '🌟', points: '42.650+', players: 'Elite' },
    { name: 'World Class II', emoji: '🌟', points: '35.650+', players: 'Avançado' },
    { name: 'Pro I', emoji: '⚡', points: '30.650+', players: 'Alto Nível' },
    { name: 'Pro II', emoji: '⚡', points: '26.850+', players: 'Alto Nível' },
    { name: 'Pro III', emoji: '⚡', points: '23.050+', players: 'Avançado' },
    { name: 'Mestre I', emoji: '🔥', points: '19.850+', players: 'Veterano' },
    { name: 'Mestre II', emoji: '🔥', points: '17.250+', players: 'Veterano' },
    { name: 'Mestre III', emoji: '🔥', points: '14.650+', players: 'Experiente' },
    { name: 'Lenda I', emoji: '👑', points: '12.450+', players: 'Veterano' },
    { name: 'Lenda II', emoji: '👑', points: '10.650+', players: 'Veterano' },
    { name: 'Lenda III', emoji: '👑', points: '8.850+', players: 'Avançado' },
    { name: 'Elite I', emoji: '💎', points: '7.350+', players: 'Avançado' },
    { name: 'Elite II', emoji: '💎', points: '6.100+', players: 'Avançado' },
    { name: 'Elite III', emoji: '💎', points: '4.850+', players: 'Experiente' },
    { name: 'Ouro I', emoji: '🥇', points: '3.850+', players: 'Experiente' },
    { name: 'Ouro II', emoji: '🥇', points: '3.100+', players: 'Ativo' },
    { name: 'Ouro III', emoji: '🥇', points: '2.350+', players: 'Ativo' },
    { name: 'Prata I', emoji: '🥈', points: '1.750+', players: 'Ativo' },
    { name: 'Prata II', emoji: '🥈', points: '1.300+', players: 'Iniciante' },
    { name: 'Prata III', emoji: '🥈', points: '850+', players: 'Iniciante' },
    { name: 'Bronze I', emoji: '🥉', points: '500+', players: 'Iniciante' },
    { name: 'Bronze II', emoji: '🥉', points: '250+', players: 'Novo' },
    { name: 'Bronze III', emoji: '🥉', points: '0', players: 'Novo' }
  ];
  
  let text = '🏆 *SISTEMA DE DIVISÕES* 🏆\n\n';
  text += '━━━━━━━━━━━━━━━━━━━━━━━━\n';
  
  divisions.forEach((d, i) => {
    text += `${d.emoji} *${d.name}*\n`;
    text += `   📊 Pontos: ${d.points}\n`;
    if (i < divisions.length - 1) text += '\n';
  });
  
  text += '━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
  text += '💡 *COMO SUBIR:*\n';
  text += '• Vitória: +25 pontos (base)\n';
  text += '• Empate: +10 pontos\n';
  text += '• Derrota: -15 pontos\n';
  text += '• Sequências: bônus de até +35%\n';
  text += '• Divisões superiores: +35~50 pontos';
  
  return text;
}

// ═══════════════════════════════════════════════════════════════
// HABILIDADES
// ═══════════════════════════════════════════════════════════════

export function getSkillsMessage(player) {
  const slots = getSkillSlots(player.division.id);
  const owned = player.skills.map(s => {
    const info = db.SKILLS?.find(sk => sk.id === s.id);
    return `${info?.name || s.id} (Nível ${s.level})`;
  }).join('\n• ');
  
  return `
💪 *HABILIDADES*

📊 *Slots:* ${player.skills.length}/${slots}

${player.skills.length > 0 ? `✅ *Equipadas:*\n• ${owned}` : '❌ Nenhuma habilidade equipada'}

━━━━━━━━━━━━━━━━━━━━━━━━

💡 Use *!fut comprar hab [id]* para comprar

📋 *HABILIDADES DISPONÍVEIS:*
• aprendizado_rapido - Treinos rendem mais
• recuperacao_fisica - Menos custo em treino
• competidor - +5% pontos em X1
• veterano - +10% XP Football
• líder - Bônus para time
• finalizador - +10% finalização
• maestro - +10% passe
• muralha - +10% defesa
• reflexo_felino - +10% físico
• drible_mestra - +10% drible`;
}

// ═══════════════════════════════════════════════════════════════
// LOJA DE HABILIDADES
// ═══════════════════════════════════════════════════════════════

export function getSkillsShopMessage(player) {
  const slots = getSkillSlots(player.division.id);
  
  let text = `🛒 *LOJA DE HABILIDADES*\n\n`;
  text += `📊 Seus slots: ${player.skills.length}/${slots}\n`;
  text += `💰 FC Coins: ${player.economy.fcCoins.toLocaleString()}\n\n`;
  text += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  
  const skills = [
    { id: 'aprendizado_rapido', name: 'Aprendizado Rápido', desc: 'Treinos rendem 20% mais atributos', costs: ['50.000', '100.000', '200.000'] },
    { id: 'recuperacao_fisica', name: 'Recuperação Física', desc: 'Reduz custo de treino em 15%', costs: ['50.000', '100.000', '200.000'] },
    { id: 'competidor', name: 'Competidor', desc: '+5% pontos em X1', costs: ['75.000', '150.000', '300.000'] },
    { id: 'veterano', name: 'Veterano', desc: '+10% XP Football', costs: ['75.000', '150.000', '300.000'] },
    { id: 'líder', name: 'Líder', desc: 'Bônus para time no draft 5v5', costs: ['100.000', '200.000', '400.000'] },
    { id: 'finalizador', name: 'Finalizador', desc: '+10% em finalizações', costs: ['100.000', '200.000', '400.000'] },
    { id: 'maestro', name: 'Maestro', desc: '+10% em passes', costs: ['100.000', '200.000', '400.000'] },
    { id: 'muralha', name: 'Muralha', desc: '+10% em defesa', costs: ['100.000', '200.000', '400.000'] },
    { id: 'reflexo_felino', name: 'Reflexo Felino', desc: '+10% físico', costs: ['100.000', '200.000', '400.000'] },
    { id: 'drible_mestra', name: 'Drible Mestre', desc: '+10% em drible', costs: ['100.000', '200.000', '400.000'] }
  ];
  
  skills.forEach((s, i) => {
    const owned = player.skills.find(p => p.id === s.id);
    const currentLevel = owned?.level || 0;
    const nextCost = currentLevel < 3 ? s.costs[currentLevel] : 'MAX';
    
    text += `\n${i + 1}. *${s.name}*\n`;
    text += `   📝 ${s.desc}\n`;
    text += `   💰 Nível atual: ${currentLevel}/3\n`;
    text += `   💎 Próximo: ${nextCost}\n`;
  });
  
  text += `\n━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  text += `\n📌 *COMPRAR:*\n`;
  text += `Use: *!fut comprar hab [id]*\n`;
  text += `Ex: *!fut comprar hab 1*`;
  
  return text;
}

// ═══════════════════════════════════════════════════════════════
// TOP GLOBAL
// ═══════════════════════════════════════════════════════════════

export function getTopGlobalMessage() {
  const top = db.getTopGlobal(20);
  
  let text = `🏆 *TOP GLOBAL* 🏆\n\n`;
  text += `Os melhores jogadores de todos os grupos!\n\n`;
  text += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  
  if (top.length === 0) {
    text += `\nNenhum jogador no ranking ainda.\n`;
    text += `Jogue partidas para entrar!`;
  } else {
    top.forEach((p, i) => {
      const emoji = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
      const divEmoji = DIVISIONS_EMOJI[p.division] || '🏆';
      
      text += `\n${emoji} *${p.name}*\n`;
      text += `   🎮 OVR: ${p.ovr} | ${divEmoji}\n`;
      text += `   📊 Pontos: ${p.points?.toLocaleString() || 'N/A'}`;
    });
  }
  
  text += `\n━━━━━━━━━━━━━━━━━━━━━━━━`;
  
  return text;
}

// ═══════════════════════════════════════════════════════════════
// RANKING DE CLUBES
// ═══════════════════════════════════════════════════════════════

export function getClubRankingMessage() {
  const clubs = db.getClubRanking(15);
  
  let text = `🏆 *RANKING MUNDIAL DE CLUBES* 🏆\n\n`;
  text += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  
  if (clubs.length === 0) {
    text += `\nNenhum clube no ranking ainda.\n`;
    text += `Complete um clube com 5 jogadores!`;
  } else {
    clubs.forEach((c, i) => {
      const emoji = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
      
      text += `\n${emoji} *${c.name}*\n`;
      text += `   👥 ${c.players} jogadores\n`;
      text += `   🏆 Vitórias: ${c.wins} | Títulos: ${c.titles}`;
    });
  }
  
  text += `\n━━━━━━━━━━━━━━━━━━━━━━━━`;
  
  return text;
}

// ═══════════════════════════════════════════════════════════════
// CLUBE
// ═══════════════════════════════════════════════════════════════

export function getClubMessage(club, players) {
  const avgOVR = club.players.length > 0
    ? Math.round(club.players.reduce((sum, p) => sum + (players[p.id]?.ovr || 60), 0) / club.players.length)
    : 60;
  
  let text = `⚽ *CLUBE ${club.name.toUpperCase()}* ⚽\n\n`;
  
  text += `👑 *Presidente:* ${club.president.name}\n`;
  text += `💰 *Saldo:* ${club.economy.balance.toLocaleString()} FC Coins\n`;
  text += `📊 *OVR Médio:* ${avgOVR}\n\n`;
  
  text += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  text += `👥 *ELENCO (${club.players.length}/5):*\n\n`;
  
  club.players.forEach((m, i) => {
    const pData = players[m.id];
    const ovr = pData?.ovr || 60;
    const role = m.role === 'President' ? '👑' : '⚽';
    
    text += `${role} *${m.name}*\n`;
    text += `   🎮 OVR: ${ovr} | Salário: ${m.salary.toLocaleString()}/sem\n`;
  });
  
  text += `\n━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  text += `📊 *ESTATÍSTICAS:*\n`;
  text += `• Partidas: ${club.stats.matches}\n`;
  text += `• Vitórias: ${club.stats.wins}\n`;
  text += `• Empates: ${club.stats.draws}\n`;
  text += `• Derrotas: ${club.stats.losses}\n`;
  text += `• Títulos: ${club.stats.titles}`;
  
  return text;
}

// ═══════════════════════════════════════════════════════════════
// PROPOSTA
// ═══════════════════════════════════════════════════════════════

export function getProposalMessage(proposal) {
  return `
📝 *NOVA PROPOSTA DE CONTRATO*

⚽ *De:* ${proposal.clubName}

💰 *Salário:* ${proposal.salary.toLocaleString()} FC/semana
🎁 *Bônus:* ${proposal.signingBonus.toLocaleString()} FC

━━━━━━━━━━━━━━━━━━━━━━━━

📌 *Para aceitar:*
*!fut aceitarproposta ${proposal.id}*

📌 *Para recusar:*
*!fut recusarproposta ${proposal.id}*

⏰ Expira em 24 horas.`;
}

// ═══════════════════════════════════════════════════════════════
// TREINO
// ═══════════════════════════════════════════════════════════════

export function getTrainingMessage(result) {
  return `
🏋️ *TREINO REALIZADO!*

⚡ *${result.attribute}:* ${result.newValue} (+${result.gain})
🎮 *Novo OVR:* ${result.newOVR}
⚡ *Energia:* ${result.remainingEnergy}/200 (-${result.energySpent})`;
}

// ═══════════════════════════════════════════════════════════════
// X1
// ═══════════════════════════════════════════════════════════════

export function getX1ChallengeMessage(challenger, challenged, matchId) {
  return `
⚔️ *DESAFIO X1* ⚔️

${challenger.name} desafiou ${challenged.name}!

🎮 OVR: ${challenger.ovr} x ${challenged.ovr}

━━━━━━━━━━━━━━━━━━━━━━━━

📌 *${challenged.name}, aceite o desafio:*
*!fut aceitarx1*

📌 *Ou recuse:*
*!fut recusarx1*

⏰ Você tem 30 minutos para responder.`;
}

export function getX1ResultMessage(match) {
  const r = match.result;
  const winnerName = r.winner === match.player1.id ? match.player1.name : match.player2.name;
  const loserName = r.loser === match.player1.id ? match.player1.name : match.player2.name;
  
  return `
⚽ *RESULTADO X1* ⚽

${match.player1.name} ${r.score1} x ${r.score2} ${match.player2.name}

━━━━━━━━━━━━━━━━━━━━━━━━

🏆 *Vencedor:* ${winnerName}
😢 *Perdedor:* ${loserName}

${match.rewards ? `
💰 *Recompensas:*
• ${winnerName}: +${match.rewards.winner.coins.toLocaleString()} FC Coins
• ${loserName}: +${match.rewards.loser.coins.toLocaleString()} FC Coins` : ''}`;
}

// ═══════════════════════════════════════════════════════════════
// FUNÇÕES AUXILIARES
// ═══════════════════════════════════════════════════════════════

function getDivisionName(divId) {
  const names = {
    bronze_3: 'Bronze III', bronze_2: 'Bronze II', bronze_1: 'Bronze I',
    prata_3: 'Prata III', prata_2: 'Prata II', prata_1: 'Prata I',
    ouro_3: 'Ouro III', ouro_2: 'Ouro II', ouro_1: 'Ouro I',
    elite_3: 'Elite III', elite_2: 'Elite II', elite_1: 'Elite I',
    lenda_3: 'Lenda III', lenda_2: 'Lenda II', lenda_1: 'Lenda I',
    mestre_3: 'Mestre III', mestre_2: 'Mestre II', mestre_1: 'Mestre I',
    pro_3: 'Pro III', pro_2: 'Pro II', pro_1: 'Pro I',
    worldclass_2: 'World Class II', worldclass_1: 'World Class I',
    topglobal: 'Top Global'
  };
  return names[divId] || divId;
}

function getSkillSlots(divId) {
  const slots = {
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
  return slots[divId] || 1;
}

export { getDivisionName, getSkillSlots, DIVISIONS_EMOJI, ATTR_NAMES };