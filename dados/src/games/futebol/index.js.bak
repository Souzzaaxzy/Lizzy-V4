// ═══════════════════════════════════════════════════════════════
// 🏆 HANDLER DE COMANDOS DE FUTEBOL - KAISERBOT
// ═══════════════════════════════════════════════════════════════

import db from './database/index.js';
import { 
  getMenuFut,
  getMenuAdminFut, 
  getEnterMessage, 
  getProfileMessage, 
  getStatsMessage,
  getDivisionsMessage,
  getSkillsMessage,
  getSkillsShopMessage,
  getTopGlobalMessage,
  getClubRankingMessage,
  getClubMessage,
  getProposalMessage,
  getTrainingMessage,
  getX1ChallengeMessage,
  getX1ResultMessage,
  ATTR_NAMES
} from './menu.js';

// Armazena desafios pendentes
const pendingX1 = new Map();

export async function handleFutCommand(args, messageInfo, reply) {
  console.log("[FUT] Comando recebido:", command, "Args:", args);
  const { sender, senderName, from, nazu } = messageInfo;
  const command = args[0]?.toLowerCase() || '';
  const subCommand = args[1]?.toLowerCase();
  
  const player = db.getPlayer(sender);
  
  switch (command) {
    // ═══════════════════════════════════════════════════════════════
    // ENTRAR
    // ═══════════════════════════════════════════════════════════════
    case 'entrar':
    case 'registrar':
      if (player) {
        return reply('⚠️ Você já está registrado no sistema de futebol!');
      }
      
      const newPlayer = db.createPlayer(sender, senderName);
      return reply(getEnterMessage(senderName));
    
    // ═══════════════════════════════════════════════════════════════
    // MENU
    // ═══════════════════════════════════════════════════════════════
    case 'menu':
    case 'ajuda':
      return reply(getMenuFut(senderName));
    
    // ═══════════════════════════════════════════════════════════════
    // PERFIL
    // ═══════════════════════════════════════════════════════════════
    case 'perfil':
    case 'profile':
      if (!player) {
        return reply('❌ Você não está registrado!\nUse *!fut entrar* para começar.');
      }
      return reply(getProfileMessage(player));
    
    case 'stats':
    case 'estatisticas':
      if (!player) {
        return reply('❌ Você não está registrado!\nUse *!fut entrar* para começar.');
      }
      return reply(getStatsMessage(player));
    
    // ═══════════════════════════════════════════════════════════════
    // TREINOS
    // ═══════════════════════════════════════════════════════════════
    case 'treinar':
    case 'treino':
    case 'tre':
      if (!player) {
        return reply('❌ Você não está registrado!\nUse *!fut entrar* para começar.');
      }
      
      const validAttrs = ['pac', 'sho', 'pas', 'dri', 'def', 'phy'];
      const attrName = ATTR_NAMES[subCommand];
      
      if (!attrName) {
        let text = '🏋️ *TREINOS*\n\n⚡ Custo: 30 de energia\n📈 Ganho: 1-3 pontos\n\n';
        
        Object.entries(ATTR_NAMES).forEach(([key, name]) => {
          text += `• !fut tre ${key}\n`;
        });
        
        return reply(text);
      }
      
      const result = db.trainAttribute(sender, subCommand);
      if (!result.success) {
        return reply(`❌ ${result.error}`);
      }
      
      return reply(getTrainingMessage(result));
    
    // ═══════════════════════════════════════════════════════════════
    // DIVISÕES
    // ═══════════════════════════════════════════════════════════════
    case 'divisoes':
    case 'divisao':
    case 'division':
      return reply(getDivisionsMessage());
    
    case 'ranking':
      db.updateGlobalRanking();
      return reply(getTopGlobalMessage());
    
    // ═══════════════════════════════════════════════════════════════
    // HABILIDADES
    // ═══════════════════════════════════════════════════════════════
    case 'habilidades':
    case 'hab':
    case 'skills':
      if (!player) {
        return reply('❌ Você não está registrado!\nUse *!fut entrar* para começar.');
      }
      return reply(getSkillsMessage(player));
    
    case 'loja':
    case 'shop':
      if (subCommand === 'habilidades' || subCommand === 'skills') {
        if (!player) {
          return reply('❌ Você não está registrado!\nUse *!fut entrar* para começar.');
        }
        return reply(getSkillsShopMessage(player));
      }
      return reply('📌 Use: *!fut loja habilidades*');
    
    case 'comprar':
      if (subCommand === 'hab' || subCommand === 'skill') {
        if (!player) {
          return reply('❌ Você não está registrado!');
        }
        
        const skillId = args[2]?.toLowerCase();
        if (!skillId) {
          return reply('📌 Use: *!fut comprar hab [id]*\nEx: *!fut comprar hab 1*');
        }
        
        // Converter ID numérico para nome da habilidade
        const skillMap = {
          '1': 'aprendizado_rapido',
          '2': 'recuperacao_fisica',
          '3': 'competidor',
          '4': 'veterano',
          '5': 'líder',
          '6': 'finalizador',
          '7': 'maestro',
          '8': 'muralha',
          '9': 'reflexo_felino',
          '10': 'drible_mestra'
        };
        
        const skillToBuy = skillMap[skillId] || skillId;
        const buyResult = db.buySkill(sender, skillToBuy);
        
        if (!buyResult.success) {
          return reply(`❌ ${buyResult.error}`);
        }
        
        return reply(`✅ Habilidade adquirida com sucesso!\n\n💪 *${skillToBuy.replace(/_/g, ' ').toUpperCase()}* - Nível ${buyResult.newLevel}`);
      }
      return reply('📌 Use: *!fut comprar hab [id]*');
    
    // ═══════════════════════════════════════════════════════════════
    // X1
    // ═══════════════════════════════════════════════════════════════
    case 'x1':
      if (!player) {
        return reply('❌ Você não está registrado!\nUse *!fut entrar* para começar.');
      }
      
      // Pegar usuário mencionado
      const mentionedX1 = messageInfo.mentionedJid?.[0];
      if (!mentionedX1) {
        return reply('📌 Use: *!fut x1 @usuario*');
      }
      
      if (mentionedX1 === sender) {
        return reply('❌ Você não pode se desafiar!');
      }
      
      const targetPlayer = db.getPlayer(mentionedX1);
      if (!targetPlayer) {
        return reply('❌ Jogador não encontrado!\nUse *!fut entrar* para se registrar.');
      }
      
      // Verificar se já existe desafio pendente
      const existingChallenge = pendingX1.get(`${mentionedX1}_${sender}`);
      if (existingChallenge) {
        return reply('⚠️ Você já tem um desafio pendente com este jogador!');
      }
      
      // Criar desafio
      const match = db.createX1Match(sender, mentionedX1);
      pendingX1.set(`${sender}_${mentionedX1}`, match.id);
      
      return reply(getX1ChallengeMessage(player, targetPlayer, match.id));
    
    case 'aceitarx1':
    case 'ax1':
    case 'aceitar':
      // Buscar desafio pendente usando o banco de dados
      const pendingChallenge = db.getPendingChallengeForPlayer(sender);
      
      if (!pendingChallenge) {
        return reply('❌ Nenhum desafio pendente!\n\nUse *!fut x1 @usuario* para desafiar.');
      }
      
      // Atualizar status para accepted
      pendingChallenge.status = 'accepted';
      db.save();
      
      // Simular partida
      const matchResult = db.simulateX1Match(pendingChallenge.id);
      if (!matchResult) {
        return reply('❌ Erro ao processar partida!');
      }
      
      return reply(getX1ResultMessage(matchResult));
    
    case 'recusarx1':
    case 'rx1':
      const refuseChallenge = db.getPendingChallengeForPlayer(sender);
      if (refuseChallenge) {
        refuseChallenge.status = 'declined';
        db.save();
        return reply('❌ Desafio recusado.');
      }
      return reply('❌ Você não tem desafios pendentes.');
    
    // ═══════════════════════════════════════════════════════════════
    // FUT SOLO
    // ═══════════════════════════════════════════════════════════════
    case 'solo':
      if (!player) {
        return reply('❌ Você não está registrado!');
      }
      
      const difficulty = subCommand || 'normal';
      const validDiffs = ['normal', 'dificil', 'extremo'];
      
      if (!validDiffs.includes(difficulty)) {
        return reply(`📌 *MODOS DISPONÍVEIS:*
• !fut solo normal - Recompensas menores, mais fácil
• !fut solo dificil - Mais difícil, melhores recompensas
• !fut solo extremo - Muito difícil, melhores recompensas

⚡ Custo: 30 de energia`);
      }
      
      const soloResult = db.simulateSoloMatch(sender, difficulty);
      if (!soloResult.success) {
        return reply(`❌ ${soloResult.error}`);
      }
      
      let soloText = `⚽ *FUT SOLO*\n\n`;
      soloText += `${player.name} ${soloResult.playerGoals} x ${soloResult.enemyGoals} CPU\n`;
      soloText += `Dificuldade: ${difficulty.toUpperCase()}\n\n`;
      
      if (soloResult.result === 'win') soloText += `🏆 *VITÓRIA!*\n`;
      else if (soloResult.result === 'draw') soloText += `🤝 *EMPATE*\n`;
      else soloText += `❌ *DERROTA*\n`;
      
      soloText += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      soloText += `💰 +${soloResult.coinsGained} FC Coins\n`;
      soloText += `⭐ +${soloResult.xpGained} XP`;
      if (soloResult.xpBonus > 0) soloText += ` (+${soloResult.xpBonus}% bônus)`;
      soloText += `\n⚡ Energia: ${player.energy.current}/200 (-30)`;
      
      if (soloResult.streak > 1) {
        soloText += `\n🔥 Sequência: ${soloResult.streak}`;
        if (soloResult.streakBonus > 0) soloText += ` (+${soloResult.streakBonus}% bônus)`;
      }
      
      if (soloResult.leveledUp) {
        soloText += `\n\n🎉 *SUBIU DE NÍVEL!*`;
        soloResult.newLevel.forEach(lvl => {
          soloText += `\n📊 Nível ${lvl.level} (+${lvl.evoPoints} Pontos de Evolução)`;
        });
        soloText += `\n💡 Use *!fut evoluir [atributo] [pontos]* para melhorar!`;
      }
      
      return reply(soloText);
    
    case 'soloscore':
    case 'rankingsolo':
      if (!player) {
        return reply('❌ Você não está registrado!');
      }
      
      const soloRanking = db.getSoloRanking();
      if (soloRanking.length === 0) {
        return reply('📭 Nenhum jogador no ranking ainda!\n\nJogue *!fut solo* para entrar!');
      }
      
      let rankText = `🏆 *RANKING FUT SOLO*\n\n`;
      soloRanking.forEach((p, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
        rankText += `${medal} ${p.name}\n`;
        rankText += `   Vitórias: ${p.victories} | WR: ${p.winRate}%\n`;
      });
      
      return reply(rankText);
    
    // ═══════════════════════════════════════════════════════════════
    // XP E EVOLUÇÃO
    // ═══════════════════════════════════════════════════════════════
    case 'xp':
    case 'nivel':
    case 'level':
      if (!player) {
        return reply('❌ Você não está registrado!');
      }
      
      const xpInfo = db.getXPInfo(sender);
      const xpNeeded = db.getXPForLevel(xpInfo.level);
      const barLength = 15;
      const filled = Math.round((xpInfo.currentXP / xpNeeded) * barLength);
      const bar = '█'.repeat(filled) + '░'.repeat(barLength - filled);
      
      let xpText = `⭐ *XP FUTEBOL*\n\n`;
      xpText += `📊 Nível: ${xpInfo.level}\n`;
      xpText += `${bar}\n`;
      xpText += `${xpInfo.currentXP}/${xpNeeded} XP\n\n`;
      xpText += `💎 Pontos de Evolução: ${xpInfo.evolutionPoints}\n`;
      xpText += `📈 XP Total: ${xpInfo.totalXP}\n`;
      
      if (xpInfo.xpBonus > 0) {
        xpText += `\n🎯 Bônus: +${xpInfo.xpBonus}% (Aprendizado Rápido)`;
      }
      
      if (xpInfo.evolutionPoints > 0) {
        xpText += `\n\n💡 Use *!fut evoluir [atributo] [pontos]* para melhorar!`;
      }
      
      return reply(xpText);
    
    case 'evoluir':
      if (!player) {
        return reply('❌ Você não está registrado!');
      }
      
      const evoAttr = args[1];
      const evoPoints = parseInt(args[2]);
      
      if (!evoAttr || !evoPoints || evoPoints < 1) {
        const xpInfo = db.getXPInfo(sender);
        let evoHelp = `💎 *EVOLUIR ATRIBUTOS*\n\n`;
        evoHelp += `Pontos disponíveis: ${xpInfo.evolutionPoints}\n\n`;
        evoHelp += `📌 *COMO USAR:*\n`;
        evoHelp += `*!fut evoluir [atributo] [pontos]*\n\n`;
        evoHelp += `*ATRIBUTOS:*\n`;
        evoHelp += `• pac - Ritmo\n`;
        evoHelp += `• sho - Chute\n`;
        evoHelp += `• pas - Passe\n`;
        evoHelp += `• dri - Drible\n`;
        evoHelp += `• def - Defesa\n`;
        evoHelp += `• phy - Físico\n\n`;
        evoHelp += `*EXEMPLO:*\n`;
        evoHelp += `*!fut evoluir pac 2*\n`;
        evoHelp += `*→ PAC +2, OVR aumenta!*`;
        return reply(evoHelp);
      }
      
      const evoResult = db.useEvolutionPoint(sender, evoAttr, evoPoints);
      if (!evoResult.success) {
        return reply(`❌ ${evoResult.error}`);
      }
      
      return reply(`💎 *EVOLUÇÃO REALIZADA!*\n\n`
        + `📈 ${evoResult.attribute.toUpperCase()}: ${evoResult.newValue - evoResult.pointsUsed} → ${evoResult.newValue} (+${evoResult.pointsUsed})\n`
        + `🎮 OVR: ${evoResult.oldOVR} → ${evoResult.newOVR}\n\n`
        + `💎 Pontos restantes: ${evoResult.remainingPoints}`);
    
    case 'atributos':
      if (!player) {
        return reply('❌ Você não está registrado!');
      }
      
      let attrText = `⚡ *ATRIBUTOS*\n\n`;
      attrText += `🎮 OVR: ${player.ovr}\n\n`;
      attrText += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      Object.entries(player.attributes).forEach(([attr, val]) => {
        const attrDisplay = attr.toUpperCase();
        attrText += `${attrDisplay}: ${val}\n`;
      });
      attrText += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      
      const playerXPInfo = db.getXPInfo(sender);
      attrText += `\n💎 Pontos de Evolução: ${playerXPInfo.evolutionPoints}`;
      
      if (playerXPInfo.evolutionPoints > 0) {
        attrText += `\n💡 Use *!fut evoluir [attr] [pts]*`;
      }
      
      return reply(attrText);
    
    // ═══════════════════════════════════════════════════════════════
    // FORMA E CONQUISTAS
    // ═══════════════════════════════════════════════════════════════
    case 'forma':
      if (!player) {
        return reply('❌ Você não está registrado!');
      }
      const formInfo = db.getFormInfo(player);
      let formText = `${formInfo.emoji} *FORMA: ${formInfo.label}*\n\n`;
      formText += `📊 Valor: ${formInfo.value > 0 ? '+' : ''}${formInfo.value}\n`;
      if (formInfo.bonus !== 0) {
        formText += `${formInfo.bonus > 0 ? '+' : ''}${(formInfo.bonus * 100).toFixed(0)}% desempenho\n`;
      }
      formText += `\n📝 Histórico: ${player.form?.history?.length || 0}/10 partidas`;
      return reply(formText);
    
    case 'conquistas':
    case 'achievements':
      if (!player) {
        return reply('❌ Você não está registrado!');
      }
      const achievements = db.getAchievements(sender);
      if (achievements.length === 0) {
        return reply('🏆 *CONQUISTAS*\n\n📭 Nenhuma conquista ainda!\n\nContinue jogando para desbloquear!');
      }
      let achText = `🏆 *CONQUISTAS (${achievements.length})*\n\n`;
      achievements.forEach(a => {
        achText += `✅ ${a.name}\n   ${a.desc}\n\n`;
      });
      return reply(achText);
    
    case 'diaria':
    case 'daily':
      if (!player) {
        return reply('❌ Você não está registrado!');
      }
      const dailyResult = db.claimDailyReward(sender);
      if (!dailyResult.success) {
        return reply(`❌ ${dailyResult.error}`);
      }
      return reply(`🎁 *CAIXA DIÁRIA!* 🎁\n\n`
        + `💰 +${dailyResult.coins.toLocaleString()} FC Coins\n`
        + `⭐ +${dailyResult.xp} XP\n`
        + `🔥 Sequência: ${dailyResult.streak} dias\n\n`
        + `Volte amanhã para mais!`);
    
    case 'semanal':
    case 'semanal':
      if (!player) {
        return reply('❌ Você não está registrado!');
      }
      const missions = db.generateWeeklyMissions(sender);
      if (!missions) {
        return reply('❌ Erro ao gerar missões!');
      }
      let missText = `📋 *MISSÕES SEMANAIS*\n\n`;
      missions.forEach((m, i) => {
        const status = m.completed ? '✅' : '⬜';
        const progress = `${m.current}/${m.target}`;
        missText += `${status} ${i + 1}. ${m.desc}\n   Progresso: ${progress}\n\n`;
      });
      missText += `💡 Use *!fut semanal* para ver novamente`;
      return reply(missText);
    
    case 'titulos':
      if (!player) {
        return reply('❌ Você não está registrado!');
      }
      const titles = player.unlockedTitles || ['Novato'];
      let titlesText = `🏅 *TÍTULOS*\n\n`;
      titles.forEach(t => {
        const equipped = player.equippedTitle === t ? ' [EQUIPADO]' : '';
        titlesText += `• ${t}${equipped}\n`;
      });
      titlesText += `\n💡 Use *!fut titulo [nome]* para equipar`;
      return reply(titlesText);
    
    case 'titulo':
      if (!player) {
        return reply('❌ Você não está registrado!');
      }
      const titleName = args.slice(1).join(' ');
      if (!titleName) {
        return reply('📌 Use: *!fut titulo [nome]*');
      }
      const titles2 = player.unlockedTitles || ['Novato'];
      const foundTitle = titles2.find(t => t.toLowerCase() === titleName.toLowerCase());
      if (!foundTitle) {
        return reply('❌ Você não possui esse título!');
      }
      player.equippedTitle = foundTitle;
      db.save();
      return reply(`✅ Título *${foundTitle}* equipado!`);
    
    // ═══════════════════════════════════════════════════════════════
    // TEMPORADA E RANKING
    // ═══════════════════════════════════════════════════════════════
    case 'temporada':
      if (!player) {
        return reply('❌ Você não está registrado!');
      }
      const seasonStatus = db.getSeasonStatus();
      if (!seasonStatus.active) {
        return reply('🏆 *TEMPORADA ENCERRADA*\n\nAguarde a nova temporada!');
      }
      const rewards = db.getSeasonRewards();
      let seasonText = `🏆 *TEMPORADA ${seasonStatus.number}*\n\n`;
      seasonText += `⏰ *${seasonStatus.daysLeft} dias* restantes\n\n`;
      seasonText += `🎁 *RECOMPENSAS:*\n`;
      seasonText += `🥇 1º Lugar: ${rewards.top1.coins.toLocaleString()} coins + ${rewards.top1.xp} XP + Título\n`;
      seasonText += `🏅 Top 10: ${rewards.top10.coins.toLocaleString()} coins + ${rewards.top10.xp} XP\n`;
      seasonText += `⭐ Top 100: ${rewards.top100.coins.toLocaleString()} coins + ${rewards.top100.xp} XP`;
      return reply(seasonText);
    
    case 'reputacao':
      if (!player) {
        return reply('❌ Você não está registrado!');
      }
      const rep = player.reputation || 50;
      const badge = db.getReputationBadge(rep);
      let repText = `📊 *REPUTAÇÃO*\n\n`;
      repText += `${player.name}\n`;
      repText += `Valor: ${rep}/100\n`;
      repText += `Badge: ${badge}\n\n`;
      repText += `📈 *Como aumentar:*\n`;
      repText += `• Vitórias (+2)\n`;
      repText += `• MVPs (+3)\n`;
      repText += `• Conquistas (+1)\n\n`;
      repText += `📉 *Como diminuir:*\n`;
      repText += `• Derrotas (-1)\n`;
      repText += `• Abandono (-5)`;
      return reply(repText);
    
    case 'rivalidade':
      if (!player) {
        return reply('❌ Você não está registrado!');
      }
      const rivalUser = messageInfo.mentionedJid?.[0];
      if (!rivalUser) {
        return reply('📌 Use: *!fut rivalidade @usuario*');
      }
      const rivalData = db.getPlayer(rivalUser);
      if (!rivalData) {
        return reply('❌ Jogador não encontrado!');
      }
      const rivalryLevel = db.getRivalry(sender, rivalUser);
      const rivalryLabel = db.getRivalryLevel(rivalryLevel);
      let rivalText = `⚔️ *RIVALIDADE*\n\n`;
      rivalText += `${player.name} vs ${rivalData.name}\n\n`;
      rivalText += `Nível: ${rivalryLevel}%\n`;
      rivalText += `Status: ${rivalryLabel}\n\n`;
      rivalText += `💡 A rivalidade aumenta a cada partida entre vocês!\n`;
      rivalText += `🔥 Partidas com rivalidade alta dão +XP e +Coins`;
      return reply(rivalText);
    
    case 'rivalidades':
      if (!player) {
        return reply('❌ Você não está registrado!');
      }
      const myRivalries = player.rivalries || {};
      const rivalsList = Object.entries(myRivalries)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
      
      if (rivalsList.length === 0) {
        return reply('⚔️ *MINHAS RIVALIDADES*\n\n📭 Nenhuma rivalidade ainda!\n\nJogue contra outros jogadores para criar!');
      }
      
      let rivalsText = `⚔️ *MINHAS RIVALIDADES*\n\n`;
      for (const [rivalId, level] of rivalsList) {
        const rivalPlayer = db.getPlayer(rivalId);
        const name = rivalPlayer?.name || 'Desconhecido';
        const label = db.getRivalryLevel(level);
        rivalsText += `⚔️ ${name}: ${level}% - ${label}\n`;
      }
      return reply(rivalsText);
    
    // ═══════════════════════════════════════════════════════════════
    // CÓDIGOS PROMOCIONAIS
    // ═══════════════════════════════════════════════════════════════
    case 'codigo':
      if (!player) {
        return reply('❌ Você não está registrado!');
      }
      const codeToRedeem = args[1]?.toUpperCase();
      if (!codeToRedeem) {
        return reply(`🎁 *CÓDIGO PROMOCIONAL*

📌 Use: *!fut codigo [CÓDIGO]*

Exemplo: *!fut codigo ELITE2026*

💡 Códigos podem dar:
• FC Coins
• XP Futebol
• Títulos
• Itens especiais`);
      }
      
      const redeemResult = db.redeemPromoCode(sender, codeToRedeem);
      if (!redeemResult.success) {
        return reply(`❌ *ERRO*\n\n${redeemResult.error}`);
      }
      
      let redeemText = `🎉 *CÓDIGO RESGATADO!*\n\n`;
      
      if (redeemResult.type === 'mysterious') {
        redeemText += `🎲 *RECOMPENSA MISTERIOSA!*\n\n`;
      }
      
      if (redeemResult.rewards.coins > 0) {
        redeemText += `💰 +${redeemResult.rewards.coins.toLocaleString()} FC Coins\n`;
      }
      if (redeemResult.rewards.xp > 0) {
        redeemText += `⭐ +${redeemResult.rewards.xp} XP\n`;
      }
      if (redeemResult.rewards.title && redeemResult.rewards.title !== '???') {
        redeemText += `🏅 Título: ${redeemResult.rewards.title}\n`;
      }
      
      if (redeemResult.leveledUp) {
        redeemText += `\n🎉 *SUBIU DE NÍVEL!*`;
        redeemResult.newLevel.forEach(lvl => {
          redeemText += `\n📊 Nível ${lvl.level}!`;
        });
      }
      
      return reply(redeemText);
    
    // ═══════════════════════════════════════════════════════════════
    // TORNEIOS
    // ═══════════════════════════════════════════════════════════════
    case 'torneio':
      if (!player) {
        return reply('❌ Você não está registrado!');
      }
      const tourAction = args[1];
      
      // Ver torneios disponíveis
      if (!tourAction || tourAction === 'listar' || tourAction === 'lista') {
        const activeTournaments = db.listActiveTournaments();
        if (activeTournaments.length === 0) {
          return reply('🏆 *TORNEIOS*\n\n📭 Nenhum torneio aberto no momento!');
        }
        let tourList = `🏆 *TORNEIOS ABERTOS*\n\n`;
        activeTournaments.forEach(t => {
          const emoji = t.type === 'x1' ? '👤' : '⚽';
          tourList += `${emoji} *${t.name}*\n`;
          tourList += `   Jogadores: ${t.participants}/${t.maxPlayers}\n`;
          tourList += `   Entrada: ${t.entryCost} coins\n`;
          tourList += `   Prêmio: ${t.prize} coins\n`;
          tourList += `   ID: ${t.id}\n\n`;
        });
        tourList += `💡 Use *!fut torneio entrar [ID]* para participar`;
        return reply(tourList);
      }
      
      // Entrar em torneio
      if (tourAction === 'entrar' || tourAction === 'entrar') {
        const tourId = parseInt(args[2]);
        if (!tourId) {
          return reply('📌 Use: *!fut torneio entrar [ID]*');
        }
        const joinResult = db.joinTournament(tourId, sender);
        if (!joinResult.success) {
          return reply(`❌ ${joinResult.error}`);
        }
        let joinText = `✅ *INSCRITO COM SUCESSO!*\n\n`;
        joinText += `${joinResult.message}\n`;
        if (joinResult.paid > 0) {
          joinText += `\n💰 Pagado: ${joinResult.paid} FC Coins`;
        }
        return reply(joinText);
      }
      
      // Ver torneio específico
      const tourId2 = parseInt(tourAction);
      if (tourId2 && db.tournaments[tourId2]) {
        return reply(db.getTournamentStatus(tourId2));
      }
      
      return reply(`🏆 *TORNEIOS*

📌 *Comandos:*
• !fut torneio - Ver abertos
• !fut torneio entrar [ID] - Participar`);
    
    // ═══════════════════════════════════════════════════════════════
    // SALDO
    // ═══════════════════════════════════════════════════════════════
    case 'saldo':
    case 'coins':
    case 'dinheiro':
      if (!player) {
        return reply('❌ Você não está registrado!\nUse *!fut entrar* para começar.');
      }
      return reply(`💰 *SEU SALDO*\n\n💎 FC Coins: ${player.economy.fcCoins.toLocaleString()}\n⚡ Energia: ${player.energy.current}/${player.energy.max}`);
    
    case 'energia':
    case 'energy':
      if (!player) {
        return reply('❌ Você não está registrado!');
      }
      return reply(`⚡ *SUA ENERGIA*\n\n${player.energy.current}/${player.energy.max}\n\n💡 Use *!fut descansar* para recuperar energia!`);
    
    case 'descansar':
    case 'rest':
      if (!player) {
        return reply('❌ Você não está registrado!');
      }
      const restResult = db.quickRest(sender);
      if (!restResult.success) {
        return reply(`❌ ${restResult.error}`);
      }
      return reply(`😴 *DESCANSO COMPLETO*\n\n⚡ Energia recuperada: +${restResult.energyGained}\n⚡ Energia atual: ${restResult.currentEnergy}/${restResult.maxEnergy} (100%)`);
    
    // ═══════════════════════════════════════════════════════════════
    // CLUBE
    // ═══════════════════════════════════════════════════════════════
    case 'criarclube':
    case 'criar':
    case 'cc':
      if (!player) {
        return reply('❌ Você não está registrado!\nUse *!fut entrar* para começar.');
      }
      
      if (player.currentClub) {
        return reply('❌ Você já está em um clube!\nSaias primeiro com *!fut sair*.');
      }
      
      const clubName = args.slice(1).join(' ');
      if (!clubName || clubName.length < 3) {
        return reply('📌 Use: *!fut criar [nome]*\n\nMínimo 3 caracteres, máximo 20.');
      }
      
      if (clubName.length > 20) {
        return reply('❌ Nome muito longo! Máximo: 20 caracteres.');
      }
      
      // Verificar se já existe clube com este nome
      if (db.getClubByName(clubName)) {
        return reply('❌ Já existe um clube com este nome!');
      }
      
      const newClub = db.createClub(clubName, sender, senderName);
      return reply(`✅ *CLUBE CRIADO!* ✅\n\n⚽ ${clubName}\n👑 Presidente: ${senderName}\n\nUse *!fut prop @user [salário]* para contratar!`);
    
    case 'clube':
    case 'meuclube':
      if (!player) {
        return reply('❌ Você não está registrado!');
      }
      
      if (!player.currentClub) {
        return reply('❌ Você não está em nenhum clube!\n\n📌 Use: *!fut criar [nome]*');
      }
      
      const club = db.getClub(player.currentClub);
      if (!club) {
        return reply('❌ Clube não encontrado!');
      }
      
      return reply(getClubMessage(club, db.players));
    
    case 'membros':
    case 'jogadores':
      if (!player) {
        return reply('❌ Você não está registrado!');
      }
      
      if (!player.currentClub) {
        return reply('❌ Você não está em nenhum clube!');
      }
      
      const clubForMembers = db.getClub(player.currentClub);
      if (!clubForMembers) {
        return reply('❌ Clube não encontrado!');
      }
      
      let membersText = `👥 *MEMBROS DO CLUBE ${clubForMembers.name}*\n\n`;
      clubForMembers.players.forEach((m, i) => {
        const pData = db.players[m.id];
        membersText += `${i + 1}. ${m.name} ${m.role === 'President' ? '👑' : ''}\n`;
        membersText += `   OVR: ${pData?.ovr || '?'} | Salário: ${m.salary.toLocaleString()}/sem\n\n`;
      });
      
      return reply(membersText);
    
    case 'sairclube':
    case 'sair':
      if (!player) {
        return reply('❌ Você não está registrado!');
      }
      
      if (!player.currentClub) {
        return reply('❌ Você não está em nenhum clube!');
      }
      
      const leaveResult = db.removePlayerFromClub(player.currentClub, sender);
      if (!leaveResult.success) {
        return reply(`❌ ${leaveResult.error}`);
      }
      
      return reply('✅ Você saiu do clube!');
    
    // ═══════════════════════════════════════════════════════════════
    // NEGOCIAÇÕES
    // ═══════════════════════════════════════════════════════════════
    case 'proposta':
    case 'prop':
      if (!player) {
        return reply('❌ Você não está registrado!');
      }
      
      if (!player.currentClub) {
        return reply('❌ Você não está em nenhum clube!');
      }
      
      const userClub = db.getClub(player.currentClub);
      if (userClub.president.id !== sender) {
        return reply('❌ Apenas o presidente pode fazer propostas!');
      }
      
      if (userClub.players.length >= 5) {
        return reply('❌ Seu clube já está completo (5 jogadores)!');
      }
      
      const targetUser = messageInfo.mentionedJid?.[0];
      if (!targetUser) {
        return reply('📌 Use: *!fut proposta @usuario [salário]*');
      }
      
      const targetP = db.getPlayer(targetUser);
      if (!targetP) {
        return reply('❌ Jogador não encontrado!');
      }
      
      if (targetP.currentClub) {
        return reply('❌ Jogador já está em um clube!');
      }
      
      const salary = parseInt(args[2]) || 5000;
      if (salary < 100) {
        return reply('❌ Salário mínimo: 100 FC Coins/semana');
      }
      
      const negotiation = db.createNegotiation(player.currentClub, targetUser, salary, false);
      
      return reply(`⚽ *NOVA PROPOSTA!* ⚽\n\n📤 De: ${userClub.name}\n💰 Salário: ${salary.toLocaleString()}/sem\n\n📩 Enviada para @${targetUser.split('@')[0]}!\n\n⏳ Aguardando resposta...`);
    
    case 'negociacoes':
    case 'negs':
    case 'negociar':
      if (!player) {
        return reply('❌ Você não está registrado!');
      }
      
      if (player.currentClub) {
        // Ver negociações do clube (presidente)
        const clubNegs = db.getClubNegotiations(player.currentClub);
        const club = db.getClub(player.currentClub);
        
        if (club.president.id !== sender) {
          return reply('❌ Apenas o presidente pode ver as negociações!');
        }
        
        if (clubNegs.length === 0) {
          return reply('📭 Nenhuma negociação pendente.');
        }
        
        let negsText = `📝 *NEGOCIAÇÕES (${clubNegs.length})*\n\n`;
        clubNegs.forEach((n, i) => {
          negsText += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
          negsText += `${i + 1}. @${n.playerName}\n`;
          negsText += `   💰 ${n.salary.toLocaleString()}/sem\n`;
          negsText += `   ${n.counterOffer ? '🔄 Contra-oferta' : '📤 Proposta'}\n`;
          negsText += `   ID: ${n.id}\n`;
        });
        negsText += `\n📌 *AÇÕES:*\n`;
        negsText += `• !fut ace [id] - Contratar\n`;
        negsText += `• !fut repro [id] - Recusar\n`;
        negsText += `• !fut cnt [id] [valor] - Contra-oferta`;
        
        return reply(negsText);
      } else {
        // Ver negociações do jogador
        const playerNegs = db.getPlayerNegotiations(sender);
        
        if (playerNegs.length === 0) {
          return reply('📭 Você não tem negociações pendentes.');
        }
        
        let playerNegsText = `📝 *SUAS NEGOCIAÇÕES (${playerNegs.length})*\n\n`;
        playerNegs.forEach((n, i) => {
          playerNegsText += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
          playerNegsText += `${i + 1}. ${n.clubName}\n`;
          playerNegsText += `   💰 ${n.salary.toLocaleString()}/sem\n`;
          playerNegsText += `   ${n.counterOffer ? '🔄 Contra-oferta' : '📤 Proposta'}\n`;
          playerNegsText += `   ID: ${n.id}\n`;
        });
        playerNegsText += `\n📌 *AÇÕES:*\n`;
        playerNegsText += `• !fut ace [id] - Aceitar\n`;
        playerNegsText += `• !fut repro [id] - Recusar\n`;
        playerNegsText += `• !fut cnt [id] [valor] - Contra-oferta`;
        
        return reply(playerNegsText);
      }
    
    case 'aceitar':
    case 'ace':
      if (!player) {
        return reply('❌ Você não está registrado!');
      }
      
      const negId = args[1];
      if (!negId) {
        return reply('📌 Use: *!fut ace [id]*');
      }
      
      const acceptResult = db.acceptNegotiation(negId);
      if (!acceptResult.success) {
        return reply(`❌ ${acceptResult.error}`);
      }
      
      return reply(`✅ *CONTRATADO!* ✅\n\n⚽ Clube: ${acceptResult.negotiation.clubName}\n💰 Salário: ${acceptResult.negotiation.salary.toLocaleString()}/sem\n\nBem-vindo! 🏆`);
    
    case 'reprovar':
    case 'repro':
      if (!player) {
        return reply('❌ Você não está registrado!');
      }
      
      const rejectNegId = args[1];
      if (!rejectNegId) {
        return reply('📌 Use: *!fut repro [id]*');
      }
      
      const rejectResult = db.rejectNegotiation(rejectNegId);
      if (!rejectResult.success) {
        return reply(`❌ ${rejectResult.error}`);
      }
      
      return reply('❌ Negociação reprovada.');
    
    case 'contraprop':
    case 'cnt':
      if (!player) {
        return reply('❌ Você não está registrado!');
      }
      
      const negToCounterId = args[1];
      const counterSalary = parseInt(args[2]);
      
      if (!negToCounterId || !counterSalary) {
        return reply('📌 Use: *!fut cnt [id] [valor]*');
      }
      
      const existingNeg = db.getNegotiation(negToCounterId);
      if (!existingNeg) {
        return reply('❌ Negociação não encontrada!');
      }
      if (existingNeg.status !== 'pending') {
        return reply('❌ Esta negociação já foi encerrada!');
      }
      
      if (player.currentClub) {
        // Presidente fazendo contra-oferta
        if (player.currentClub !== existingNeg.clubId) {
          return reply('❌ Esta negociação não é do seu clube!');
        }
        
        const counterNeg = db.createNegotiation(player.currentClub, existingNeg.playerId, counterSalary, true);
        
        return reply(`🔄 *CONTRA-OFERTA ENVIADA!* 🔄\n\n📤 Para: @${existingNeg.playerName}\n💰 Novo salário: ${counterSalary.toLocaleString()}/sem\n\nAguardando resposta...`);
      } else {
        // Jogador fazendo contra-oferta
        if (existingNeg.playerId !== sender) {
          return reply('❌ Esta negociação não é sua!');
        }
        
        const counterNegFromPlayer = db.createNegotiation(existingNeg.clubId, sender, counterSalary, true);
        
        return reply(`🔄 *CONTRA-OFERTA ENVIADA!* 🔄\n\n📤 Para: ${existingNeg.clubName}\n💰 Salário proposto: ${counterSalary.toLocaleString()}/sem\n\nAguardando resposta...`);
      }
    
    case 'minhaspropostas':
    case 'verpropostas':
    case 'props':
      if (!player) {
        return reply('❌ Você não está registrado!');
      }
      
      const myNegs = db.getPlayerNegotiations(sender);
      if (myNegs.length === 0) {
        return reply('📭 Você não tem propostas.\n\n💡 Presidentes: use *!fut prop @user [salário]*');
      }
      
      let myProposalsText = `📝 *SUAS PROPOSTAS*\n\n`;
      myNegs.forEach((n, i) => {
        myProposalsText += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        myProposalsText += `${i + 1}. ${n.clubName}\n`;
        myProposalsText += `💰 ${n.salary.toLocaleString()}/sem\n`;
        myProposalsText += `${n.counterOffer ? '🔄 Contra-oferta' : '📤 Nova'}\n`;
        myProposalsText += `ID: ${n.id}\n`;
      });
      
      return reply(myProposalsText);
    
    // ═══════════════════════════════════════════════════════════════
    // GLOBAL
    // ═══════════════════════════════════════════════════════════════
    case 'topglobal':
      db.updateGlobalRanking();
      return reply(getTopGlobalMessage());
    
    case 'rankingclubes':
      db.updateGlobalRanking();
      return reply(getClubRankingMessage());
    
    // ═══════════════════════════════════════════════════════════════
    // COMANDOS ADMIN (apenas admins do grupo)
    // ═══════════════════════════════════════════════════════════════
    case 'admin': {
      // Verificar se é admin do grupo
      let isAdmin = false;
      try {
        const groupMetadata = await nazu.groupMetadata(from);
        const admins = groupMetadata.participants?.filter(p => p.admin === 'admin' || p.admin === 'superadmin') || [];
        isAdmin = admins.some(a => a.id === sender);
      } catch (e) {
        // Se não conseguir verificar, nega acesso
      }
      
      if (!isAdmin) {
        return reply('❌ Apenas *admins do grupo* podem usar comandos administrativos!');
      }
      
      const adminAction = subCommand;
      
      switch (adminAction) {
        case 'addcoins': {
          const targetUser = messageInfo.mentionedJid?.[0];
          const amount = parseInt(args[2]);
          if (!targetUser || !amount) {
            return reply('📌 Use: *!fut admin addcoins @user [valor]*');
          }
          const targetPlayer = db.getPlayer(targetUser);
          if (!targetPlayer) {
            return reply('❌ Jogador não encontrado!');
          }
          targetPlayer.fcCoins += amount;
          targetPlayer.totalEarned += amount;
          db.save();
          return reply(`✅ Adicionados *${amount.toLocaleString()} FC Coins* para @${targetUser.split('@')[0]}!\n\n💰 Novo saldo: ${targetPlayer.fcCoins.toLocaleString()}`);
        }
        
        case 'remcoins': {
          const targetUser = messageInfo.mentionedJid?.[0];
          const amount = parseInt(args[2]);
          if (!targetUser || !amount) {
            return reply('📌 Use: *!fut admin remcoins @user [valor]*');
          }
          const targetPlayer = db.getPlayer(targetUser);
          if (!targetPlayer) {
            return reply('❌ Jogador não encontrado!');
          }
          targetPlayer.fcCoins = Math.max(0, targetPlayer.fcCoins - amount);
          db.save();
          return reply(`✅ Removidos *${amount.toLocaleString()} FC Coins* de @${targetUser.split('@')[0]}!\n\n💰 Novo saldo: ${targetPlayer.fcCoins.toLocaleString()}`);
        }
        
        case 'setdiv': {
          const targetUser = messageInfo.mentionedJid?.[0];
          const division = args[2];
          if (!targetUser || !division) {
            return reply('📌 Use: *!fut admin setdiv @user [bronze/prata/ouro/platina/diamante]*');
          }
          const targetPlayer = db.getPlayer(targetUser);
          if (!targetPlayer) {
            return reply('❌ Jogador não encontrado!');
          }
          const validDivs = ['bronze', 'prata', 'ouRO', 'platina', 'diamante'];
          const divLower = division.toLowerCase();
          if (!validDivs.includes(divLower)) {
            return reply('❌ Divisão inválida! Use: bronze, prata, ouro, platina, diamante');
          }
          targetPlayer.division = divLower;
          db.save();
          return reply(`✅ Divisão de @${targetUser.split('@')[0]} alterada para *${divLower.toUpperCase()}*!`);
        }
        
        case 'setovr': {
          const targetUser = messageInfo.mentionedJid?.[0];
          const ovr = parseInt(args[2]);
          if (!targetUser || !ovr || ovr < 1 || ovr > 99) {
            return reply('📌 Use: *!fut admin setovr @user [1-99]*');
          }
          const targetPlayer = db.getPlayer(targetUser);
          if (!targetPlayer) {
            return reply('❌ Jogador não encontrado!');
          }
          targetPlayer.ovr = ovr;
          db.save();
          return reply(`✅ OVR de @${targetUser.split('@')[0]} alterado para *${ovr}*!`);
        }
        
        case 'setenergy': {
          const targetUser = messageInfo.mentionedJid?.[0];
          const energy = parseInt(args[2]);
          if (!targetUser || !energy || energy < 0 || energy > 200) {
            return reply('📌 Use: *!fut admin setenergy @user [0-200]*');
          }
          const targetPlayer = db.getPlayer(targetUser);
          if (!targetPlayer) {
            return reply('❌ Jogador não encontrado!');
          }
          if (!targetPlayer.energy) {
            targetPlayer.energy = { current: energy, max: 200, lastRest: Date.now() };
          } else {
            targetPlayer.energy.current = energy;
          }
          db.save();
          return reply(`✅ Energia de @${targetUser.split('@')[0]} alterada para *${energy}/200*!`);
        }
        
        case 'addxp': {
          const targetUser = messageInfo.mentionedJid?.[0];
          const xp = parseInt(args[2]);
          if (!targetUser || !xp) {
            return reply('📌 Use: *!fut admin addxp @user [valor]*');
          }
          const targetPlayer = db.getPlayer(targetUser);
          if (!targetPlayer) {
            return reply('❌ Jogador não encontrado!');
          }
          const xpResult = db.addXP(targetUser, xp);
          let msg = `✅ Adicionados *${xpResult.xpGained} XP* para @${targetUser.split('@')[0]}!`;
          if (xpResult.leveledUp) {
            msg += `\n🎉 Subiu para Nível ${xpResult.levelsGained[0].level}!`;
          }
          return reply(msg);
        }
        
        case 'setlevel': {
          const targetUser = messageInfo.mentionedJid?.[0];
          const level = parseInt(args[2]);
          if (!targetUser || !level || level < 1 || level > 100) {
            return reply('📌 Use: *!fut admin setlevel @user [1-100]*');
          }
          const lvlPlayer = db.getPlayer(targetUser);
          if (!lvlPlayer) {
            return reply('❌ Jogador não encontrado!');
          }
          if (!lvlPlayer.xp) {
            lvlPlayer.xp = { level: 1, currentXP: 0, evolutionPoints: 0, totalXP: 0 };
          }
          lvlPlayer.xp.level = level;
          lvlPlayer.xp.currentXP = 0;
          db.save();
          return reply(`✅ Nível de @${targetUser.split('@')[0]} definido para *${level}*!`);
        }
        
        case 'setevo': {
          const targetUser = messageInfo.mentionedJid?.[0];
          const evoPoints = parseInt(args[2]);
          if (!targetUser || evoPoints === undefined || evoPoints < 0) {
            return reply('📌 Use: *!fut admin setevo @user [pontos]*');
          }
          const evoPlayer = db.getPlayer(targetUser);
          if (!evoPlayer) {
            return reply('❌ Jogador não encontrado!');
          }
          if (!evoPlayer.xp) {
            evoPlayer.xp = { level: 1, currentXP: 0, evolutionPoints: 0, totalXP: 0 };
          }
          evoPlayer.xp.evolutionPoints = evoPoints;
          db.save();
          return reply(`✅ Pontos de Evolução de @${targetUser.split('@')[0]} definidos para *${evoPoints}*!`);
        }
        
        case 'addevo': {
          const targetUser = messageInfo.mentionedJid?.[0];
          const evoPoints = parseInt(args[2]);
          if (!targetUser || !evoPoints || evoPoints < 1) {
            return reply('📌 Use: *!fut admin addevo @user [pontos]*');
          }
          const addEvoPlayer = db.getPlayer(targetUser);
          if (!addEvoPlayer) {
            return reply('❌ Jogador não encontrado!');
          }
          if (!addEvoPlayer.xp) {
            addEvoPlayer.xp = { level: 1, currentXP: 0, evolutionPoints: 0, totalXP: 0 };
          }
          addEvoPlayer.xp.evolutionPoints += evoPoints;
          db.save();
          return reply(`✅ Adicionados *${evoPoints} Pontos de Evolução* para @${targetUser.split('@')[0]}!\n\n💎 Total: ${addEvoPlayer.xp.evolutionPoints}`);
        }
        
        case 'settreino': {
          const targetUser = messageInfo.mentionedJid?.[0];
          const attr = args[2]?.toLowerCase();
          const valor = parseInt(args[3]);
          if (!targetUser || !attr || !valor || valor < 1 || valor > 99) {
            return reply('📌 Use: *!fut admin settreino @user [attr] [1-99]*\n\nAttrs: pac, sho, pas, dri, def, phy');
          }
          const treinoPlayer = db.getPlayer(targetUser);
          if (!treinoPlayer) {
            return reply('❌ Jogador não encontrado!');
          }
          const validAttrs = ['pac', 'sho', 'pas', 'dri', 'def', 'phy'];
          if (!validAttrs.includes(attr)) {
            return reply('❌ Atributo inválido! Use: pac, sho, pas, dri, def, phy');
          }
          const oldVal = treinoPlayer.attributes[attr];
          treinoPlayer.attributes[attr] = valor;
          treinoPlayer.ovr = db.calculateOVR(treinoPlayer.attributes);
          db.save();
          return reply(`✅ ${attr.toUpperCase()} de @${targetUser.split('@')[0]}: ${oldVal} → ${valor}\n🎮 Novo OVR: ${treinoPlayer.ovr}`);
        }
        
        case 'resetxp': {
          const targetUser = messageInfo.mentionedJid?.[0];
          if (!targetUser) {
            return reply('📌 Use: *!fut admin resetxp @user*');
          }
          const resetResult = db.resetPlayerXP(targetUser);
          if (!resetResult.success) {
            return reply(`❌ ${resetResult.error}`);
          }
          return reply(`✅ XP resetado para @${targetUser.split('@')[0]}!\n\nVoltou ao Nível 1.`);
        }
        
        case 'setsolo': {
          const targetUser = messageInfo.mentionedJid?.[0];
          const resetSolo = args[2] === 'reset';
          if (!targetUser) {
            return reply('📌 Use: *!fut admin setsolo @user reset*');
          }
          const soloPlayer = db.getPlayer(targetUser);
          if (!soloPlayer) {
            return reply('❌ Jogador não encontrado!');
          }
          soloPlayer.soloStats = { victories: 0, draws: 0, losses: 0, streak: 0, bestStreak: 0, totalPlayed: 0 };
          db.save();
          return reply(`✅ Estatísticas Solo de @${targetUser.split('@')[0]} resetadas!`);
        }
        
        case 'resetplayer': {
          const targetUser = messageInfo.mentionedJid?.[0];
          if (!targetUser) {
            return reply('📌 Use: *!fut admin resetplayer @user*');
          }
          if (!db.getPlayer(targetUser)) {
            return reply('❌ Jogador não encontrado!');
          }
          delete db.players[targetUser];
          db.save();
          return reply(`✅ Jogador resetado com sucesso! Ele precisará usar *!fut entrar* novamente.`);
        }
        
        case 'resetall': {
          // Resetar todos os jogadores
          const playersCount = Object.keys(db.players).length;
          Object.keys(db.players).forEach(userId => {
            delete db.players[userId];
          });
          // Resetar rankings e temporadas
          db.globalRanking = { players: [], clubs: [] };
          db.matches = [];
          db.tournaments = [];
          db.market = { proposals: [], negotiations: [] };
          db.save();
          return reply(`⚠️ *ATENÇÃO - RESET COMPLETO*\n\n${playersCount} jogadores resetados!\n\nTodos voltaram ao início.`);
        }
        
        case 'clubes': {
          // Resetar apenas clubes
          const clubsCount = Object.keys(db.clubs).length;
          Object.keys(db.clubs).forEach(clubId => {
            const club = db.clubs[clubId];
            // Remover clubes dos jogadores
            club.players.forEach(p => {
              if (db.players[p.id]) {
                db.players[p.id].currentClub = null;
                db.players[p.id].salary = 0;
              }
            });
            delete db.clubs[clubId];
          });
          db.save();
          return reply(`✅ *${clubsCount} clubes* foram resetados!\n\nTodos os jogadores estão livres.`);
        }
        
        case 'x1reset': {
          // Limpar X1 pendentes
          db.matches = db.matches.filter(m => m.type !== 'x1');
          db.save();
          return reply('✅ Partidas X1 pendentes limpas!');
        }
        
        case 'setrep': {
          const targetUser = messageInfo.mentionedJid?.[0];
          const rep = parseInt(args[2]);
          if (!targetUser || rep === undefined || rep < 0 || rep > 100) {
            return reply('📌 Use: *!fut admin setrep @user [0-100]*');
          }
          const repPlayer = db.getPlayer(targetUser);
          if (!repPlayer) {
            return reply('❌ Jogador não encontrado!');
          }
          repPlayer.reputation = rep;
          db.save();
          return reply(`✅ Reputação de @${targetUser.split('@')[0]} definida para *${rep}*!\n\n${db.getReputationBadge(rep)}`);
        }
        
        case 'addrep': {
          const targetUser = messageInfo.mentionedJid?.[0];
          const amount = parseInt(args[2]);
          if (!targetUser || !amount) {
            return reply('📌 Use: *!fut admin addrep @user [valor]*');
          }
          const addRepPlayer = db.getPlayer(targetUser);
          if (!addRepPlayer) {
            return reply('❌ Jogador não encontrado!');
          }
          const newRep = db.updateReputation(targetUser, amount);
          return reply(`✅ Reputação de @${targetUser.split('@')[0]} ajustada!\n\nNova reputação: ${newRep}`);
        }
        
        case 'season': {
          const action = args[1];
          if (action === 'reset') {
            const result = db.resetSeason();
            return reply(`🔄 *TEMPORADA RESETADA!*\n\n${result.message}`);
          }
          if (action === 'config') {
            const days = parseInt(args[2]);
            const resetDiv = args[3] === 'true';
            if (days) db.seasonConfig.durationDays = days;
            if (resetDiv !== undefined) db.seasonConfig.resetDivisions = resetDiv;
            db.save();
            return reply(`✅ Config: ${db.seasonConfig.durationDays} dias, Reset div: ${db.seasonConfig.resetDivisions}`);
          }
          const status = db.getSeasonStatus();
          if (!status.active) {
            return reply('🏆 TEMPORADA ENCERRADA\n\nUse !fut admin season reset');
          }
          return reply(`🏆 TEMPORADA ${status.number}\nDias restantes: ${status.daysLeft}`);
        }
        
        // ═══════════════════════════════════════════════════════════════
        // CÓDIGOS PROMOCIONAIS (ADMIN)
        // ═══════════════════════════════════════════════════════════════
        case 'codigo':
        case 'promo': {
          const subAction = args[1];
          
          // Criar código normal
          if (subAction === 'criar') {
            const code = args[2]?.toUpperCase();
            const coins = parseInt(args[3]) || 0;
            const xp = parseInt(args[4]) || 0;
            const maxUses = args[5] ? parseInt(args[5]) : null;
            const hours = parseInt(args[6]) || 0;
            
            if (!code) {
              return reply(`📌 *CRIAR CÓDIGO*

*!fut admin codigo criar [CODIGO] [COINS] [XP] [USOS] [HORAS]*

Exemplo:
*!fut admin codigo criar ELITE2026 5000 200 50 48*

• Código: ELITE2026
• Coins: 5000
• XP: 200
• Usos: 50 (null = ilimitado)
• Horas: 48 (0 = nunca expira)`);
            }
            
            const expiresAt = hours > 0 ? Date.now() + (hours * 60 * 60 * 1000) : null;
            const result = db.createPromoCode({
              code: code,
              type: 'normal',
              coins: coins,
              xp: xp,
              maxUses: maxUses,
              expiresAt: expiresAt,
              createdBy: sender
            });
            
            if (!result.success) {
              return reply(`❌ ${result.error}`);
            }
            
            let createText = `✅ *CÓDIGO CRIADO!*\n\n`;
            createText += `🎁 Código: *${code}*\n`;
            createText += `💰 Coins: ${coins.toLocaleString()}\n`;
            createText += `⭐ XP: ${xp}\n`;
            createText += `👥 Usos: ${maxUses || 'Ilimitado'}\n`;
            createText += `⏰ Expira: ${hours > 0 ? `${hours}h` : 'Nunca'}`;
            return reply(createText);
          }
          
          // Criar código misterioso
          if (subAction === 'misterioso' || subAction === 'mysterious') {
            const minCoins = parseInt(args[2]) || 100;
            const maxCoins = parseInt(args[3]) || 1000;
            const minXP = parseInt(args[4]) || 10;
            const maxXP = parseInt(args[5]) || 100;
            const maxUses = args[6] ? parseInt(args[6]) : null;
            
            const result = db.createPromoCode({
              type: 'mysterious',
              mysteriousRewards: { minCoins, maxCoins, minXP, maxXP },
              maxUses: maxUses,
              createdBy: sender
            });
            
            if (!result.success) {
              return reply(`❌ ${result.error}`);
            }
            
            let mystText = `🎲 *CÓDIGO MISTERIOSO CRIADO!*\n\n`;
            mystText += `🎁 Código: *${result.code.code}*\n`;
            mystText += `💰 Coins: ${minCoins} ~ ${maxCoins}\n`;
            mystText += `⭐ XP: ${minXP} ~ ${maxXP}\n`;
            mystText += `👥 Usos: ${maxUses || 'Ilimitado'}`;
            return reply(mystText);
          }
          
          // Listar códigos
          if (subAction === 'listar' || subAction === 'list') {
            const codes = db.listPromoCodes();
            if (codes.length === 0) {
              return reply('📭 Nenhum código criado ainda!');
            }
            let listText = `📋 *CÓDIGOS PROMOCIONAIS*\n\n`;
            codes.forEach(c => {
              const status = c.active ? '🟢' : '🔴';
              listText += `${status} ${c.code}\n`;
              listText += `   Tipo: ${c.type === 'mysterious' ? '🎲 Misterioso' : '🧾 Normal'}\n`;
              listText += `   Usos: ${c.currentUses}/${c.maxUses}\n`;
              listText += `   Expira: ${c.expiresAt}\n\n`;
            });
            return reply(listText);
          }
          
          // Logs de uso
          if (subAction === 'log' || subAction === 'logs') {
            const logs = db.getPromoCodeLogs(20);
            if (logs.length === 0) {
              return reply('📭 Nenhum resgate registrado!');
            }
            let logText = `📜 *LOG DE CÓDIGOS*\n\n`;
            logs.forEach(log => {
              const date = new Date(log.timestamp).toLocaleString();
              logText += `👤 ${log.playerName}\n`;
              logText += `🎁 Código: ${log.code}\n`;
              logText += `💰 +${log.rewards.coins?.toLocaleString() || 0} coins\n`;
              logText += `📅 ${date}\n\n`;
            });
            return reply(logText);
          }
          
          // Desativar código
          if (subAction === 'desativar' || subAction === 'disable') {
            const codeToDisable = args[2]?.toUpperCase();
            if (!codeToDisable) {
              return reply('📌 Use: *!fut admin codigo desativar [CODIGO]*');
            }
            const result = db.deactivatePromoCode(codeToDisable);
            if (!result.success) {
              return reply(`❌ ${result.error}`);
            }
            return reply(`✅ Código *${codeToDisable}* desativado!`);
          }
          
          // Help
          return reply(`🎁 *COMANDOS DE CÓDIGOS*

📌 *Criar código normal:*
*!fut admin codigo criar [COD] [COINS] [XP] [USOS] [HORAS]*

📌 *Criar código misterioso:*
*!fut admin codigo misterioso [MINC] [MAXC] [MINX] [MAXX] [USOS]*

📌 *Listar códigos:*
*!fut admin codigo listar*

📌 *Ver logs:*
*!fut admin codigo log*

📌 *Desativar código:*
*!fut admin codigo desativar [CODIGO]*`);
        }
        
        // ═══════════════════════════════════════════════════════════════
        // TORNEIOS (ADMIN)
        // ═══════════════════════════════════════════════════════════════
        case 'torneio':
        case 'tourney': {
          const tourAction = args[1];
          
          // Criar torneio
          if (tourAction === 'criar' || tourAction === 'create') {
            const name = args.slice(2).join(' ').split('|')[0]?.trim();
            const type = args.join(' ').includes('club') ? 'club' : 'x1';
            
            // Parse: nome|tipo|maxPlayers|entry|prize
            const parts = args.slice(2).join(' ').split('|');
            const tourName = parts[0]?.trim() || 'Torneio Sem Nome';
            const tourType = parts[1]?.toLowerCase() === 'club' ? 'club' : 'x1';
            const maxPlayers = parseInt(parts[2]) || 8;
            const entryCost = parseInt(parts[3]) || 0;
            const prize = parseInt(parts[4]) || 0;
            const trophy = parts[5]?.trim() || null;
            
            if (!tourName || tourName.length < 3) {
              return reply(`📌 *CRIAR TORNEIO*

*!fut admin torneio criar [NOME]|[TIPO]|[MAX]|[ENTRADA]|[PREMIO]|[TROFÉU]*

Exemplo:
*!fut admin torneio criar Copa Legends|x1|16|1000|10000|Campeão da Copa*

• Nome: Copa Legends
• Tipo: x1 ou club
• Max jogadores: 16
• Entrada: 1000 coins
• Prêmio: 10000 coins
• Troféu: Campeão da Copa (opcional)`);
            }
            
            const result = db.createTournament({
              name: tourName,
              type: tourType,
              maxPlayers: maxPlayers,
              entryCost: entryCost,
              prize: prize,
              trophyTitle: trophy,
              createdBy: sender
            });
            
            if (!result.success) {
              return reply(`❌ ${result.error}`);
            }
            
            let createText = `🏆 *TORNEIO CRIADO!*\n\n`;
            createText += `📛 Nome: ${tourName}\n`;
            createText += `🎯 Tipo: ${tourType === 'x1' ? '👤 X1' : '⚽ Clube'}\n`;
            createText += `👥 Máximo: ${maxPlayers} jogadores\n`;
            createText += `💰 Entrada: ${entryCost} FC Coins\n`;
            createText += `🏆 Prêmio: ${prize} FC Coins\n`;
            if (trophy) createText += `🏅 Troféu: ${trophy}\n`;
            createText += `\nID do Torneio: *${result.tournament.id}*`;
            return reply(createText);
          }
          
          // Iniciar torneio
          if (tourAction === 'iniciar' || tourAction === 'start') {
            const tourId = parseInt(args[2]);
            if (!tourId) {
              return reply('📌 Use: *!fut admin torneio iniciar [ID]*');
            }
            const startResult = db.startTournament(tourId);
            if (!startResult.success) {
              return reply(`❌ ${startResult.error}`);
            }
            return reply(`⚔️ *TORNEIO INICIADO!*\n\n${startResult.message}\n\nPartidas geradas! Use *!fut admin torneio jogar [ID]* para prosseguir.`);
          }
          
          // Jogar próxima partida
          if (tourAction === 'jogar' || tourAction === 'play') {
            const tourId = parseInt(args[2]);
            if (!tourId) {
              return reply('📌 Use: *!fut admin torneio jogar [ID]*');
            }
            const tournament = db.tournaments[tourId];
            if (!tournament) {
              return reply('❌ Torneio não encontrado!');
            }
            
            // Encontrar próxima partida pendente
            const pendingMatch = tournament.matches.findIndex(m => m.status === 'pending');
            if (pendingMatch === -1) {
              if (tournament.status === 'completed') {
                return reply(`🏆 *TORNEIO FINALIZADO!*\n\nCampeão: ${tournament.winner?.name || 'Ninguém'}\n\n🏅 Troféu: ${tournament.trophyTitle || 'Nenhum'}`);
              }
              return reply('❌ Não há partidas pendentes!');
            }
            
            const playResult = db.playTournamentMatch(tourId, pendingMatch);
            
            if (playResult.bye) {
              return reply(`⚠️ *BYE*\n\n${playResult.winner.name} avança automaticamente!`);
            }
            
            let playText = `⚔️ *PARTIDA ${playResult.match.round}ª RODADA*\n\n`;
            playText += `${playResult.match.player1.name} ${playResult.match.score1} x ${playResult.match.score2} ${playResult.match.player2.name}\n\n`;
            playText += `🏆 Vencedor: ${playResult.match.winner.name}\n`;
            playText += `⭐ +${playResult.xpReward} XP`;
            
            return reply(playText);
          }
          
          // Ver torneio
          if (tourAction === 'ver' || tourAction === 'view') {
            const tourId = parseInt(args[2]);
            if (!tourId) {
              return reply('📌 Use: *!fut admin torneio ver [ID]*');
            }
            const status = db.getTournamentStatus(tourId);
            if (!status) {
              return reply('❌ Torneio não encontrado!');
            }
            
            let fullStatus = status + '\n\n';
            const tournament = db.tournaments[tourId];
            
            if (tournament.status === 'in_progress') {
              fullStatus += '*PARTICIPANTES:*\n';
              tournament.participants.filter(p => !p.isBye).forEach(p => {
                fullStatus += `• ${p.name} (OVR ${p.ovr})\n`;
              });
            }
            
            return reply(fullStatus);
          }
          
          // Cancelar torneio
          if (tourAction === 'cancelar' || tourAction === 'cancel') {
            const tourId = parseInt(args[2]);
            if (!tourId) {
              return reply('📌 Use: *!fut admin torneio cancelar [ID]*');
            }
            const tournament = db.tournaments[tourId];
            if (!tournament) {
              return reply('❌ Torneio não encontrado!');
            }
            tournament.status = 'cancelled';
            db.save();
            return reply(`❌ Torneio *${tournament.name}* cancelado!`);
          }
          
          // Listar torneios
          if (tourAction === 'listar' || tourAction === 'list') {
            const allTournaments = Object.values(db.tournaments);
            if (allTournaments.length === 0) {
              return reply('📭 Nenhum torneio criado ainda!');
            }
            let listText = `🏆 *TODOS OS TORNEIOS*\n\n`;
            allTournaments.slice(-10).reverse().forEach(t => {
              const statusEmoji = t.status === 'registration' ? '📝' : t.status === 'in_progress' ? '⚔️' : t.status === 'completed' ? '🏆' : '❌';
              listText += `${statusEmoji} #${t.id} ${t.name}\n`;
              listText += `   Status: ${t.status}\n`;
            });
            return reply(listText);
          }
          
          // Help
          return reply(`🏆 *COMANDOS DE TORNEIO*

📌 *Criar torneio:*
*!fut admin torneio criar [NOME]|[TIPO]|[MAX]|[ENTRADA]|[PREMIO]|[TROFÉU]*

📌 *Iniciar torneio:*
*!fut admin torneio iniciar [ID]*

📌 *Jogar partida:*
*!fut admin torneio jogar [ID]*

📌 *Ver torneio:*
*!fut admin torneio ver [ID]*

📌 *Cancelar torneio:*
*!fut admin torneio cancelar [ID]*

📌 *Listar torneios:*
*!fut admin torneio listar*

💡 Exemplo completo:
*!fut admin torneio criar Copa Legends|x1|16|1000|10000|Campeão da Copa*`);
        }
        
        case 'help':
        default: {
          return reply(getMenuAdminFut());
        }
      }
    }
    
    // ═══════════════════════════════════════════════════════════════
    // COMANDO INVÁLIDO
    // ═══════════════════════════════════════════════════════════════
    default:
      return reply(getMenuFut(senderName));
  }
}

// Handler para o comando principal !fut
export async function handleFut(args, messageInfo, reply) {
  // Verificar se o jogador existe
  const { sender } = messageInfo;
  const player = db.getPlayer(sender);
  
  const command = args[0]?.toLowerCase() || '';
  
  if (!player && command !== 'entrar' && command !== 'registrar') {
    // Redirecionar para comando de entrada
    return handleFutCommand(['entrar'], messageInfo, reply);
  }
  
  return handleFutCommand(args, messageInfo, reply);
}