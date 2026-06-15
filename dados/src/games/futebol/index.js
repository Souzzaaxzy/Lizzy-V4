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
  const { sender, senderName, from, nazu, mentionedJid } = messageInfo;
  const command = args[0]?.toLowerCase() || '';
  console.log('[FUT] Comando:', command, 'Args:', args);
  const subCommand = args[1]?.toLowerCase();
  
  const player = db.getPlayer(sender);
  
  // Wrapper para reply que envia mídia junto com o texto quando for o menu
  const sendReply = async (text, options = {}) => {
    const isMenuCommand = !args[1]; // Comandos sem sub-comando mostram menu
    const shouldSendMedia = messageInfo.hasMedia && messageInfo.mediaPath && isMenuCommand;
    
    if (shouldSendMedia) {
      try {
        const fs = await import('fs');
        const mediaBuffer = fs.readFileSync(messageInfo.mediaPath);
        const isVideo = messageInfo.mediaPath.endsWith('.mp4');
        
        await nazu.sendMessage(from, {
          [isVideo ? 'video' : 'image']: mediaBuffer,
          caption: text,
          ...(isVideo && { gifPlayback: true }),
          mimetype: isVideo ? 'video/mp4' : 'image/jpeg'
        }, { quoted: messageInfo.quotedMessage || null });
        return;
      } catch (e) {
        console.error('[FUT] Erro ao enviar mídia:', e);
      }
    }
    reply(text);
  };
  
  switch (command) {
    // ═══════════════════════════════════════════════════════════════
    // ENTRAR
    // ═══════════════════════════════════════════════════════════════
    case 'entrar':
    case 'registrar':
      if (player) {
        return sendReply('⚠️ Você já está registrado no sistema de futebol!');
      }
      
      const newPlayer = db.createPlayer(sender, senderName);
      return sendReply(getEnterMessage(senderName));
    
    // ═══════════════════════════════════════════════════════════════
    // MENU
    // ═══════════════════════════════════════════════════════════════
    case 'menu':
    case 'ajuda':
      return sendReply(getMenuFut(senderName));
    
    // ═══════════════════════════════════════════════════════════════
    // PERFIL
    // ═══════════════════════════════════════════════════════════════
    case 'perfil':
    case 'profile':
      if (!player) {
        return sendReply('❌ Você não está registrado!\nUse *!fut entrar* para começar.');
      }
      return sendReply(getProfileMessage(player));
    
    case 'stats':
    case 'estatisticas':
      if (!player) {
        return sendReply('❌ Você não está registrado!\nUse *!fut entrar* para começar.');
      }
      return sendReply(getStatsMessage(player));
    
    // ═══════════════════════════════════════════════════════════════
    // TREINOS
    // ═══════════════════════════════════════════════════════════════
    case 'treinar':
    case 'treino':
    case 'tre':
      if (!player) {
        return sendReply('❌ Você não está registrado!\nUse *!fut entrar* para começar.');
      }
      
      const validAttrs = ['pac', 'sho', 'pas', 'dri', 'def', 'phy'];
      const attrName = ATTR_NAMES[subCommand];
      
      if (!attrName) {
        let text = '🏋️ *TREINOS*\n\n⚡ Custo: 30 de energia\n📈 Ganho: 1-3 pontos\n\n';
        
        Object.entries(ATTR_NAMES).forEach(([key, name]) => {
          text += `• !fut tre ${key}\n`;
        });
        
        return sendReply(text);
      }
      
      const result = db.trainAttribute(sender, subCommand);
      if (!result.success) {
        return sendReply(`❌ ${result.error}`);
      }
      
      return sendReply(getTrainingMessage(result));
    
    // ═══════════════════════════════════════════════════════════════
    // DIVISÕES
    // ═══════════════════════════════════════════════════════════════
    case 'divisoes':
    case 'divisao':
    case 'division':
      return sendReply(getDivisionsMessage());
    
    case 'ranking':
      db.updateGlobalRanking();
      return sendReply(getTopGlobalMessage());
    
    // ═══════════════════════════════════════════════════════════════
    // HABILIDADES
    // ═══════════════════════════════════════════════════════════════
    case 'habilidades':
    case 'hab':
    case 'skills':
      if (!player) {
        return sendReply('❌ Você não está registrado!\nUse *!fut entrar* para começar.');
      }
      return sendReply(getSkillsMessage(player));
    
    case 'loja':
    case 'shop':
      if (subCommand === 'habilidades' || subCommand === 'skills') {
        if (!player) {
          return sendReply('❌ Você não está registrado!\nUse *!fut entrar* para começar.');
        }
        return sendReply(getSkillsShopMessage(player));
      }
      return sendReply('📌 Use: *!fut loja habilidades*');
    
    case 'comprar':
      if (subCommand === 'hab' || subCommand === 'skill') {
        if (!player) {
          return sendReply('❌ Você não está registrado!');
        }
        
        const skillId = args[2]?.toLowerCase();
        if (!skillId) {
          return sendReply('📌 Use: *!fut comprar hab [id]*\nEx: *!fut comprar hab 1*');
        }
        
        // Converter ID numérico para nome da habilidade
        const skillMap = {
          '1': 'aprendizado_rapido',
          '2': 'recuperacao_fisica',
          '3': 'competidor',
          '4': 'veterano',
          '5': 'lider',
          '6': 'finalizador',
          '7': 'maestro',
          '8': 'muralha',
          '9': 'reflexo_felino',
          '10': 'drible_mestra'
        };
        
        const skillToBuy = skillMap[skillId] || skillId;
        const buyResult = db.buySkill(sender, skillToBuy);
        
        if (!buyResult.success) {
          // Se a habilidade não foi encontrada, mostrar lista de habilidades
          if (buyResult.error === 'Habilidade não encontrada') {
            let habList = '📋 *HABILIDADES DISPONÍVEIS*\n\n';
            const skillList = [
              '1️⃣ Aprendizado Rápido',
              '2️⃣ Recuperação Física',
              '3️⃣ Competidor',
              '4️⃣ Veterano',
              '5️⃣ Líder',
              '6️⃣ Finalizador',
              '7️⃣ Maestro',
              '8️⃣ Muralha',
              '9️⃣ Reflexo Felino',
              '🔟 Drible Mestre'
            ];
            habList += skillList.join('\n');
            habList += '\n\n📌 Use: *!fut comprar hab [número]*';
            return sendReply(habList);
          }
          return sendReply(`❌ ${buyResult.error}`);
        }
        
        return sendReply(`✅ Habilidade adquirida com sucesso!\n\n💪 *${skillToBuy.replace(/_/g, ' ').toUpperCase()}* - Nível ${buyResult.newLevel}`);
      }
      return sendReply('📌 Use: *!fut comprar hab [id]*');
    
    // ═══════════════════════════════════════════════════════════════
    // X1
    // ═══════════════════════════════════════════════════════════════
    case 'x1':
      if (!player) {
        return sendReply('❌ Você não está registrado!\nUse *!fut entrar* para começar.');
      }
      
      // Pegar usuário mencionado
      const mentionedX1 = messageInfo.mentionedJid?.[0];
      if (!mentionedX1) {
        return sendReply('📌 Use: *!fut x1 @usuario*');
      }
      
      if (mentionedX1 === sender) {
        return sendReply('❌ Você não pode se desafiar!');
      }
      
      const targetPlayer = db.getPlayer(mentionedX1);
      if (!targetPlayer) {
        return sendReply('❌ Jogador não encontrado!\nUse *!fut entrar* para se registrar.');
      }
      
      // Verificar se já existe desafio pendente
      const existingChallenge = pendingX1.get(`${mentionedX1}_${sender}`);
      if (existingChallenge) {
        return sendReply('⚠️ Você já tem um desafio pendente com este jogador!');
      }
      
      // Criar desafio
      const match = db.createX1Match(sender, mentionedX1);
      pendingX1.set(`${sender}_${mentionedX1}`, match.id);
      
      return sendReply(getX1ChallengeMessage(player, targetPlayer, match.id));
    
    case 'aceitarx1':
    case 'ax1':
    case 'aceitar':
      // Buscar desafio pendente usando o banco de dados
      const pendingChallenge = db.getPendingChallengeForPlayer(sender);
      
      if (!pendingChallenge) {
        return sendReply('❌ Nenhum desafio pendente!\n\nUse *!fut x1 @usuario* para desafiar.');
      }
      
      // Atualizar status para accepted
      pendingChallenge.status = 'accepted';
      db.save();
      
      // Simular partida
      const matchResult = db.simulateX1Match(pendingChallenge.id);
      if (!matchResult) {
        return sendReply('❌ Erro ao processar partida!');
      }
      
      return sendReply(getX1ResultMessage(matchResult));
    
    case 'recusarx1':
    case 'rx1':
      const refuseChallenge = db.getPendingChallengeForPlayer(sender);
      if (refuseChallenge) {
        refuseChallenge.status = 'declined';
        db.save();
        return sendReply('❌ Desafio recusado.');
      }
      return sendReply('❌ Você não tem desafios pendentes.');
    
    // ═══════════════════════════════════════════════════════════════
    // FUT SOLO
    // ═══════════════════════════════════════════════════════════════
    case 'solo':
      if (!player) {
        return sendReply('❌ Você não está registrado!');
      }
      
      const difficulty = subCommand || 'normal';
      const validDiffs = ['normal', 'dificil', 'extremo'];
      
      if (!validDiffs.includes(difficulty)) {
        return sendReply(`📌 *MODOS DISPONÍVEIS:*
• !fut solo normal - Recompensas menores, mais fácil
• !fut solo dificil - Mais difícil, melhores recompensas
• !fut solo extremo - Muito difícil, melhores recompensas

⚡ Custo: 30 de energia`);
      }
      
      const soloResult = db.simulateSoloMatch(sender, difficulty);
      if (!soloResult.success) {
        return sendReply(`❌ ${soloResult.error}`);
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
        const xpInfo = db.getXPInfo(sender);
        const levelUpMsg = db.generateLevelUpMessage(
          senderName,
          soloResult.newLevel[0].level - soloResult.levelsGained.length,
          soloResult.newLevel[soloResult.newLevel.length - 1].level,
          soloResult.levelUpRewards,
          xpInfo
        );
        // Enviar mensagem especial de level up primeiro
        sendReply(levelUpMsg);
        // Não retorna aqui para continuar mostrando o resultado da partida
      }
      
      return sendReply(soloText);
    
    case 'soloscore':
    case 'rankingsolo':
      if (!player) {
        return sendReply('❌ Você não está registrado!');
      }
      
      const soloRanking = db.getSoloRanking();
      if (soloRanking.length === 0) {
        return sendReply('📭 Nenhum jogador no ranking ainda!\n\nJogue *!fut solo* para entrar!');
      }
      
      let rankText = `🏆 *RANKING FUT SOLO*\n\n`;
      soloRanking.forEach((p, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
        rankText += `${medal} ${p.name}\n`;
        rankText += `   Vitórias: ${p.victories} | WR: ${p.winRate}%\n`;
      });
      
      return sendReply(rankText);
    
    // ═══════════════════════════════════════════════════════════════
    // XP E EVOLUÇÃO
    // ═══════════════════════════════════════════════════════════════
    case 'xp':
    case 'nivel':
    case 'level':
      if (!player) {
        return sendReply('❌ Você não está registrado!');
      }
      
      const { getXPMessage } = await import('./menu.js');
      return sendReply(getXPMessage(player));
    
    case 'evoluir':
      if (!player) {
        return sendReply('❌ Você não está registrado!');
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
        return sendReply(evoHelp);
      }
      
      const evoResult = db.useEvolutionPoint(sender, evoAttr, evoPoints);
      if (!evoResult.success) {
        return sendReply(`❌ ${evoResult.error}`);
      }
      
      return sendReply(`💎 *EVOLUÇÃO REALIZADA!*\n\n`
        + `📈 ${evoResult.attribute.toUpperCase()}: ${evoResult.newValue - evoResult.pointsUsed} → ${evoResult.newValue} (+${evoResult.pointsUsed})\n`
        + `🎮 OVR: ${evoResult.oldOVR} → ${evoResult.newOVR}\n\n`
        + `💎 Pontos restantes: ${evoResult.remainingPoints}`);
    
    case 'atributos':
      if (!player) {
        return sendReply('❌ Você não está registrado!');
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
      
      return sendReply(attrText);
    
    // ═══════════════════════════════════════════════════════════════
    // FORMA E CONQUISTAS
    // ═══════════════════════════════════════════════════════════════
    case 'forma':
      if (!player) {
        return sendReply('❌ Você não está registrado!');
      }
      const formInfo = db.getFormInfo(player);
      let formText = `${formInfo.emoji} *FORMA: ${formInfo.label}*\n\n`;
      formText += `📊 Valor: ${formInfo.value > 0 ? '+' : ''}${formInfo.value}\n`;
      if (formInfo.bonus !== 0) {
        formText += `${formInfo.bonus > 0 ? '+' : ''}${(formInfo.bonus * 100).toFixed(0)}% desempenho\n`;
      }
      formText += `\n📝 Histórico: ${player.form?.history?.length || 0}/10 partidas`;
      return sendReply(formText);
    
    case 'conquistas':
    case 'achievements':
      if (!player) {
        return sendReply('❌ Você não está registrado!');
      }
      const achievements = db.getAchievements(sender);
      if (achievements.length === 0) {
        return sendReply('🏆 *CONQUISTAS*\n\n📭 Nenhuma conquista ainda!\n\nContinue jogando para desbloquear!');
      }
      let achText = `🏆 *CONQUISTAS (${achievements.length})*\n\n`;
      achievements.forEach(a => {
        achText += `✅ ${a.name}\n   ${a.desc}\n\n`;
      });
      return sendReply(achText);
    
    case 'diaria':
    case 'daily':
      if (!player) {
        return sendReply('❌ Você não está registrado!');
      }
      const dailyResult = db.claimDailyReward(sender);
      if (!dailyResult.success) {
        return sendReply(`❌ ${dailyResult.error}`);
      }
      return sendReply(`🎁 *CAIXA DIÁRIA!* 🎁\n\n`
        + `💰 +${dailyResult.coins.toLocaleString()} FC Coins\n`
        + `⭐ +${dailyResult.xp} XP\n`
        + `🔥 Sequência: ${dailyResult.streak} dias\n\n`
        + `Volte amanhã para mais!`);
    
    case 'semanal':
    case 'weekly':
      if (!player) {
        return sendReply('❌ Você não está registrado!');
      }
      const missions = db.generateWeeklyMissions(sender);
      if (!missions) {
        return sendReply('❌ Erro ao gerar missões!');
      }
      let missText = `📋 *MISSÕES SEMANAIS*\n\n`;
      missions.forEach((m, i) => {
        const status = m.completed ? '✅' : '⬜';
        const progress = `${m.current}/${m.target}`;
        missText += `${status} ${i + 1}. ${m.desc}\n   Progresso: ${progress}\n\n`;
      });
      missText += `💡 Use *!fut semanal* para ver novamente`;
      return sendReply(missText);
    
    case 'titulos':
      if (!player) {
        return sendReply('❌ Você não está registrado!');
      }
      const titles = player.unlockedTitles || ['Novato'];
      let titlesText = `🏅 *TÍTULOS*\n\n`;
      titles.forEach(t => {
        const equipped = player.equippedTitle === t ? ' [EQUIPADO]' : '';
        titlesText += `• ${t}${equipped}\n`;
      });
      titlesText += `\n💡 Use *!fut titulo [nome]* para equipar`;
      return sendReply(titlesText);
    
    case 'titulo':
      if (!player) {
        return sendReply('❌ Você não está registrado!');
      }
      const titleName = args.slice(1).join(' ');
      if (!titleName) {
        return sendReply('📌 Use: *!fut titulo [nome]*');
      }
      const titles2 = player.unlockedTitles || ['Novato'];
      const foundTitle = titles2.find(t => t.toLowerCase() === titleName.toLowerCase());
      if (!foundTitle) {
        return sendReply('❌ Você não possui esse título!');
      }
      player.equippedTitle = foundTitle;
      db.save();
      return sendReply(`✅ Título *${foundTitle}* equipado!`);
    
    // ═══════════════════════════════════════════════════════════════
    // TEMPORADA E RANKING
    // ═══════════════════════════════════════════════════════════════
    case 'temporada':
      if (!player) {
        return sendReply('❌ Você não está registrado!');
      }
      const seasonStatus = db.getSeasonStatus();
      if (!seasonStatus.active) {
        return sendReply('🏆 *TEMPORADA ENCERRADA*\n\nAguarde a nova temporada!');
      }
      const rewards = db.getSeasonRewards();
      let seasonText = `🏆 *TEMPORADA ${seasonStatus.number}*\n\n`;
      seasonText += `⏰ *${seasonStatus.daysLeft} dias* restantes\n\n`;
      seasonText += `🎁 *RECOMPENSAS:*\n`;
      seasonText += `🥇 1º Lugar: ${rewards.top1.coins.toLocaleString()} coins + ${rewards.top1.xp} XP + Título\n`;
      seasonText += `🏅 Top 10: ${rewards.top10.coins.toLocaleString()} coins + ${rewards.top10.xp} XP\n`;
      seasonText += `⭐ Top 100: ${rewards.top100.coins.toLocaleString()} coins + ${rewards.top100.xp} XP`;
      return sendReply(seasonText);
    
    case 'reputacao':
      if (!player) {
        return sendReply('❌ Você não está registrado!');
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
      return sendReply(repText);
    
    case 'rivalidade':
      if (!player) {
        return sendReply('❌ Você não está registrado!');
      }
      const rivalUser = messageInfo.mentionedJid?.[0];
      if (!rivalUser) {
        return sendReply('📌 Use: *!fut rivalidade @usuario*');
      }
      const rivalData = db.getPlayer(rivalUser);
      if (!rivalData) {
        return sendReply('❌ Jogador não encontrado!');
      }
      const rivalryLevel = db.getRivalry(sender, rivalUser);
      const rivalryLabel = db.getRivalryLevel(rivalryLevel);
      let rivalText = `⚔️ *RIVALIDADE*\n\n`;
      rivalText += `${player.name} vs ${rivalData.name}\n\n`;
      rivalText += `Nível: ${rivalryLevel}%\n`;
      rivalText += `Status: ${rivalryLabel}\n\n`;
      rivalText += `💡 A rivalidade aumenta a cada partida entre vocês!\n`;
      rivalText += `🔥 Partidas com rivalidade alta dão +XP e +Coins`;
      return sendReply(rivalText);
    
    case 'rivalidades':
      if (!player) {
        return sendReply('❌ Você não está registrado!');
      }
      const myRivalries = player.rivalries || {};
      const rivalsList = Object.entries(myRivalries)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
      
      if (rivalsList.length === 0) {
        return sendReply('⚔️ *MINHAS RIVALIDADES*\n\n📭 Nenhuma rivalidade ainda!\n\nJogue contra outros jogadores para criar!');
      }
      
      let rivalsText = `⚔️ *MINHAS RIVALIDADES*\n\n`;
      for (const [rivalId, level] of rivalsList) {
        const rivalPlayer = db.getPlayer(rivalId);
        const name = rivalPlayer?.name || 'Desconhecido';
        const label = db.getRivalryLevel(level);
        rivalsText += `⚔️ ${name}: ${level}% - ${label}\n`;
      }
      return sendReply(rivalsText);
    
    // ═══════════════════════════════════════════════════════════════
    // CÓDIGOS PROMOCIONAIS
    // ═══════════════════════════════════════════════════════════════
    case 'codigo':
      if (!player) {
        return sendReply('❌ Você não está registrado!');
      }
      const codeToRedeem = args[1]?.toUpperCase();
      if (!codeToRedeem) {
        return sendReply(`🎁 *CÓDIGO PROMOCIONAL*

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
        return sendReply(`❌ *ERRO*\n\n${redeemResult.error}`);
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
      
      return sendReply(redeemText);
    
    // ═══════════════════════════════════════════════════════════════
    // TORNEIOS
    // ═══════════════════════════════════════════════════════════════
    case 'torneio':
      if (!player) {
        return sendReply('❌ Você não está registrado!');
      }
      const tourAction = args[1];
      
      // Ver torneios disponíveis
      if (!tourAction || tourAction === 'listar' || tourAction === 'lista') {
        const activeTournaments = db.listActiveTournaments();
        if (activeTournaments.length === 0) {
          return sendReply('🏆 *TORNEIOS*\n\n📭 Nenhum torneio aberto no momento!');
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
        return sendReply(tourList);
      }
      
      // Entrar em torneio
      if (tourAction === 'entrar' || tourAction === 'entrar') {
        const tourId = parseInt(args[2]);
        if (!tourId) {
          return sendReply('📌 Use: *!fut torneio entrar [ID]*');
        }
        const joinResult = db.joinTournament(tourId, sender);
        if (!joinResult.success) {
          return sendReply(`❌ ${joinResult.error}`);
        }
        let joinText = `✅ *INSCRITO COM SUCESSO!*\n\n`;
        joinText += `${joinResult.message}\n`;
        if (joinResult.paid > 0) {
          joinText += `\n💰 Pagado: ${joinResult.paid} FC Coins`;
        }
        return sendReply(joinText);
      }
      
      // Ver torneio específico
      const tourId2 = parseInt(tourAction);
      if (tourId2 && db.tournaments[tourId2]) {
        return sendReply(db.getTournamentStatus(tourId2));
      }
      
      return sendReply(`🏆 *TORNEIOS*

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
        return sendReply('❌ Você não está registrado!\nUse *!fut entrar* para começar.');
      }
      return sendReply(`💰 *SEU SALDO*\n\n💎 FC Coins: ${player.economy.fcCoins.toLocaleString()}\n⚡ Energia: ${player.energy.current}/${player.energy.max}`);
    
    case 'energia':
    case 'energy':
      if (!player) {
        return sendReply('❌ Você não está registrado!');
      }
      return sendReply(`⚡ *SUA ENERGIA*\n\n${player.energy.current}/${player.energy.max}\n\n💡 Use *!fut descansar* para recuperar energia!`);
    
    case 'descansar':
    case 'rest':
      if (!player) {
        return sendReply('❌ Você não está registrado!');
      }
      const restResult = db.quickRest(sender);
      if (!restResult.success) {
        return sendReply(`❌ ${restResult.error}`);
      }
      return sendReply(`😴 *DESCANSO COMPLETO*\n\n⚡ Energia recuperada: +${restResult.energyGained}\n⚡ Energia atual: ${restResult.currentEnergy}/${restResult.maxEnergy} (100%)`);
    
    // ═══════════════════════════════════════════════════════════════
    // CLUBE
    // ═══════════════════════════════════════════════════════════════
    case 'criarclube':
    case 'criar':
    case 'cc':
      if (!player) {
        return sendReply('❌ Você não está registrado!\nUse *!fut entrar* para começar.');
      }
      
      if (player.currentClub) {
        return sendReply('❌ Você já está em um clube!\nSaias primeiro com *!fut sair*.');
      }
      
      const clubName = args.slice(1).join(' ');
      if (!clubName || clubName.length < 3) {
        return sendReply('📌 Use: *!fut criar [nome]*\n\nMínimo 3 caracteres, máximo 20.');
      }
      
      if (clubName.length > 20) {
        return sendReply('❌ Nome muito longo! Máximo: 20 caracteres.');
      }
      
      // Verificar se já existe clube com este nome
      if (db.getClubByName(clubName)) {
        return sendReply('❌ Já existe um clube com este nome!');
      }
      
      const newClub = db.createClub(clubName, sender, senderName);
      return sendReply(`✅ *CLUBE CRIADO!* ✅\n\n⚽ ${clubName}\n👑 Presidente: ${senderName}\n\nUse *!fut prop @user [salário]* para contratar!`);
    
    case 'clube':
    case 'meuclube':
      if (!player) {
        return sendReply('❌ Você não está registrado!');
      }
      
      if (!player.currentClub) {
        return sendReply('❌ Você não está em nenhum clube!\n\n📌 Use: *!fut criar [nome]*');
      }
      
      const club = db.getClub(player.currentClub);
      if (!club) {
        return sendReply('❌ Clube não encontrado!');
      }
      
      return sendReply(getClubMessage(club, db.players));
    
    case 'membros':
    case 'jogadores':
      if (!player) {
        return sendReply('❌ Você não está registrado!');
      }
      
      if (!player.currentClub) {
        return sendReply('❌ Você não está em nenhum clube!');
      }
      
      const clubForMembers = db.getClub(player.currentClub);
      if (!clubForMembers) {
        return sendReply('❌ Clube não encontrado!');
      }
      
      let membersText = `👥 *MEMBROS DO CLUBE ${clubForMembers.name}*\n\n`;
      clubForMembers.players.forEach((m, i) => {
        const pData = db.players[m.id];
        membersText += `${i + 1}. ${m.name} ${m.role === 'President' ? '👑' : ''}\n`;
        membersText += `   OVR: ${pData?.ovr || '?'} | Salário: ${m.salary.toLocaleString()}/sem\n\n`;
      });
      
      return sendReply(membersText);
    
    case 'sairclube':
    case 'sair':
      if (!player) {
        return sendReply('❌ Você não está registrado!');
      }
      
      if (!player.currentClub) {
        return sendReply('❌ Você não está em nenhum clube!');
      }
      
      const leaveResult = db.removePlayerFromClub(player.currentClub, sender);
      if (!leaveResult.success) {
        return sendReply(`❌ ${leaveResult.error}`);
      }
      
      return sendReply('✅ Você saiu do clube!');
    
    // ═══════════════════════════════════════════════════════════════
    // NEGOCIAÇÕES
    // ═══════════════════════════════════════════════════════════════
    case 'proposta':
    case 'prop':
      if (!player) {
        return sendReply('❌ Você não está registrado!');
      }
      
      if (!player.currentClub) {
        return sendReply('❌ Você não está em nenhum clube!');
      }
      
      const userClub = db.getClub(player.currentClub);
      if (userClub.president.id !== sender) {
        return sendReply('❌ Apenas o presidente pode fazer propostas!');
      }
      
      if (userClub.players.length >= 5) {
        return sendReply('❌ Seu clube já está completo (5 jogadores)!');
      }
      
      const targetUser = messageInfo.mentionedJid?.[0];
      if (!targetUser) {
        return sendReply('📌 Use: *!fut proposta @usuario [salário]*');
      }
      
      const targetP = db.getPlayer(targetUser);
      if (!targetP) {
        return sendReply('❌ Jogador não encontrado!');
      }
      
      if (targetP.currentClub) {
        return sendReply('❌ Jogador já está em um clube!');
      }
      
      const salary = parseInt(args[2]) || 5000;
      if (salary < 100) {
        return sendReply('❌ Salário mínimo: 100 FC Coins/semana');
      }
      
      const negotiation = db.createNegotiation(player.currentClub, targetUser, salary, false);
      
      return sendReply(`⚽ *NOVA PROPOSTA!* ⚽\n\n📤 De: ${userClub.name}\n💰 Salário: ${salary.toLocaleString()}/sem\n\n📩 Enviada para @${targetUser.split('@')[0]}!\n\n⏳ Aguardando resposta...`);
    
    case 'negociacoes':
    case 'negs':
    case 'negociar':
      if (!player) {
        return sendReply('❌ Você não está registrado!');
      }
      
      if (player.currentClub) {
        // Ver negociações do clube (presidente)
        const clubNegs = db.getClubNegotiations(player.currentClub);
        const club = db.getClub(player.currentClub);
        
        if (club.president.id !== sender) {
          return sendReply('❌ Apenas o presidente pode ver as negociações!');
        }
        
        if (clubNegs.length === 0) {
          return sendReply('📭 Nenhuma negociação pendente.');
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
        
        return sendReply(negsText);
      } else {
        // Ver negociações do jogador
        const playerNegs = db.getPlayerNegotiations(sender);
        
        if (playerNegs.length === 0) {
          return sendReply('📭 Você não tem negociações pendentes.');
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
        
        return sendReply(playerNegsText);
      }
    
    case 'aceitar':
    case 'ace':
      if (!player) {
        return sendReply('❌ Você não está registrado!');
      }
      
      const negId = args[1];
      if (!negId) {
        return sendReply('📌 Use: *!fut ace [id]*');
      }
      
      const acceptResult = db.acceptNegotiation(negId);
      if (!acceptResult.success) {
        return sendReply(`❌ ${acceptResult.error}`);
      }
      
      return sendReply(`✅ *CONTRATADO!* ✅\n\n⚽ Clube: ${acceptResult.negotiation.clubName}\n💰 Salário: ${acceptResult.negotiation.salary.toLocaleString()}/sem\n\nBem-vindo! 🏆`);
    
    case 'reprovar':
    case 'repro':
      if (!player) {
        return sendReply('❌ Você não está registrado!');
      }
      
      const rejectNegId = args[1];
      if (!rejectNegId) {
        return sendReply('📌 Use: *!fut repro [id]*');
      }
      
      const rejectResult = db.rejectNegotiation(rejectNegId);
      if (!rejectResult.success) {
        return sendReply(`❌ ${rejectResult.error}`);
      }
      
      return sendReply('❌ Negociação reprovada.');
    
    case 'contraprop':
    case 'cnt':
      if (!player) {
        return sendReply('❌ Você não está registrado!');
      }
      
      const negToCounterId = args[1];
      const counterSalary = parseInt(args[2]);
      
      if (!negToCounterId || !counterSalary) {
        return sendReply('📌 Use: *!fut cnt [id] [valor]*');
      }
      
      const existingNeg = db.getNegotiation(negToCounterId);
      if (!existingNeg) {
        return sendReply('❌ Negociação não encontrada!');
      }
      if (existingNeg.status !== 'pending') {
        return sendReply('❌ Esta negociação já foi encerrada!');
      }
      
      if (player.currentClub) {
        // Presidente fazendo contra-oferta
        if (player.currentClub !== existingNeg.clubId) {
          return sendReply('❌ Esta negociação não é do seu clube!');
        }
        
        const counterNeg = db.createNegotiation(player.currentClub, existingNeg.playerId, counterSalary, true);
        
        return sendReply(`🔄 *CONTRA-OFERTA ENVIADA!* 🔄\n\n📤 Para: @${existingNeg.playerName}\n💰 Novo salário: ${counterSalary.toLocaleString()}/sem\n\nAguardando resposta...`);
      } else {
        // Jogador fazendo contra-oferta
        if (existingNeg.playerId !== sender) {
          return sendReply('❌ Esta negociação não é sua!');
        }
        
        const counterNegFromPlayer = db.createNegotiation(existingNeg.clubId, sender, counterSalary, true);
        
        return sendReply(`🔄 *CONTRA-OFERTA ENVIADA!* 🔄\n\n📤 Para: ${existingNeg.clubName}\n💰 Salário proposto: ${counterSalary.toLocaleString()}/sem\n\nAguardando resposta...`);
      }
    
    case 'minhaspropostas':
    case 'verpropostas':
    case 'props':
      if (!player) {
        return sendReply('❌ Você não está registrado!');
      }
      
      const myNegs = db.getPlayerNegotiations(sender);
      if (myNegs.length === 0) {
        return sendReply('📭 Você não tem propostas.\n\n💡 Presidentes: use *!fut prop @user [salário]*');
      }
      
      let myProposalsText = `📝 *SUAS PROPOSTAS*\n\n`;
      myNegs.forEach((n, i) => {
        myProposalsText += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        myProposalsText += `${i + 1}. ${n.clubName}\n`;
        myProposalsText += `💰 ${n.salary.toLocaleString()}/sem\n`;
        myProposalsText += `${n.counterOffer ? '🔄 Contra-oferta' : '📤 Nova'}\n`;
        myProposalsText += `ID: ${n.id}\n`;
      });
      
      return sendReply(myProposalsText);
    
    // ═══════════════════════════════════════════════════════════════
    // GLOBAL
    // ═══════════════════════════════════════════════════════════════
    case 'topglobal':
      db.updateGlobalRanking();
      return sendReply(getTopGlobalMessage());
    
    case 'rankingclubes':
      db.updateGlobalRanking();
      return sendReply(getClubRankingMessage());
    
    // ═══════════════════════════════════════════════════════════════
    // COMANDOS ADMIN (apenas admins do grupo) - REFORMULADO
    // ═══════════════════════════════════════════════════════════════
    
    // Helper para verificar se é admin
    const checkAdmin = async () => {
      if (messageInfo.isGroupAdmin === true) return true;
      try {
        if (nazu?.groupMetadata) {
          const groupMetadata = await nazu.groupMetadata(from);
          const admins = groupMetadata.participants?.filter(p => p.admin === 'admin' || p.admin === 'superadmin') || [];
          return admins.some(a => a.id === sender);
        }
      } catch (e) {
        console.log('[FUT ADMIN] Erro ao verificar admin:', e.message);
      }
      return false;
    };
    
    // Função para processar comando admin (com alias legado)
    const processAdminCommand = async (action, argsArray) => {
      const isAdmin = await checkAdmin();
      if (!isAdmin) {
        return sendReply('❌ Apenas *admins do grupo* podem usar comandos administrativos!');
      }
      
      // Mapear comandos antigos para novos
      const legacyCommands = {
        'addcoins': 'futaddcoins',
        'remcoins': 'futremcoins',
        'setdiv': 'futsetdiv',
        'setovr': 'futsetovr',
        'setenergy': 'futsetenergy',
        'addxp': 'futaddxp',
        'setlevel': 'futsetlevel',
        'setevo': 'futsetevo',
        'addevo': 'futaddevo',
        'settreino': 'futsettreino',
        'resetxp': 'futresetxp',
        'setsolo': 'futsetsolo',
        'resetplayer': 'futresetplayer',
        'resetall': 'futresetall',
        'clubes': 'futclubereset',
        'x1reset': 'futresetx1',
        'addmvp': 'futaddmvp',
        'setrep': 'futsetrep',
        'addrep': 'futaddrep',
        'season': 'futseason',
        'seasonreset': 'futseasonreset',
        'seasonconfig': 'futseasonconfig'
      };
      
      const newCommand = legacyCommands[action];
      if (newCommand) {
        console.log(`[FUT ADMIN] Comando legado usado: !fut admin ${action} -> será migrado para !${newCommand}`);
      }
      
      // Processar baseado na ação
      switch (action) {
        case 'addcoins':
        case 'futaddcoins': {
          const targetUser = messageInfo.mentionedJid?.[0] || argsArray[2];
          const amount = parseInt(argsArray[3]);
          if (!targetUser || !amount) return sendReply('📌 Use: *!futaddcoins @user [valor]*');
          const targetPlayer = db.getPlayer(targetUser);
          if (!targetPlayer) return sendReply('❌ Jogador não encontrado!');
          targetPlayer.economy.fcCoins += amount;
          targetPlayer.economy.totalEarned += amount;
          db.save();
          return sendReply(`✅ Adicionados *${amount.toLocaleString()} FC Coins* para @${targetUser.split('@')[0]}!\n\n💰 Novo saldo: ${targetPlayer.economy.fcCoins.toLocaleString()}`);
        }
        
        case 'remcoins':
        case 'futremcoins': {
          const targetUser = messageInfo.mentionedJid?.[0] || argsArray[2];
          const amount = parseInt(argsArray[3]);
          if (!targetUser || !amount) return sendReply('📌 Use: *!futremcoins @user [valor]*');
          const targetPlayer = db.getPlayer(targetUser);
          if (!targetPlayer) return sendReply('❌ Jogador não encontrado!');
          targetPlayer.economy.fcCoins = Math.max(0, targetPlayer.economy.fcCoins - amount);
          db.save();
          return sendReply(`✅ Removidos *${amount.toLocaleString()} FC Coins* de @${targetUser.split('@')[0]}!\n\n💰 Novo saldo: ${targetPlayer.economy.fcCoins.toLocaleString()}`);
        }
        
        case 'setdiv':
        case 'futsetdiv': {
          const targetUser = messageInfo.mentionedJid?.[0] || argsArray[2];
          const division = argsArray[3];
          if (!targetUser || !division) return sendReply('📌 Use: *!futsetdiv @user [divisão]*\n\nDivisões: bronze, prata, ouro, elite, lenda, mestre, pro, worldclass, topglobal');
          const targetPlayer = db.getPlayer(targetUser);
          if (!targetPlayer) return sendReply('❌ Jogador não encontrado!');
          const divLower = division.toLowerCase().replace(/[_\s]/g, '_');
          targetPlayer.division = { id: divLower, name: divLower };
          db.save();
          return sendReply(`✅ Divisão de @${targetUser.split('@')[0]} alterada para *${divLower}*!`);
        }
        
        case 'setovr':
        case 'futsetovr': {
          const targetUser = messageInfo.mentionedJid?.[0] || argsArray[2];
          const ovr = parseInt(argsArray[3]);
          if (!targetUser || !ovr || ovr < 1 || ovr > 99) return sendReply('📌 Use: *!futsetovr @user [1-99]*');
          const targetPlayer = db.getPlayer(targetUser);
          if (!targetPlayer) return sendReply('❌ Jogador não encontrado!');
          targetPlayer.ovr = ovr;
          db.save();
          return sendReply(`✅ OVR de @${targetUser.split('@')[0]} alterado para *${ovr}*!`);
        }
        
        case 'setenergy':
        case 'futsetenergy': {
          const targetUser = messageInfo.mentionedJid?.[0] || argsArray[2];
          const energy = parseInt(argsArray[3]);
          if (!targetUser || energy === undefined || energy < 0 || energy > 200) return sendReply('📌 Use: *!futsetenergy @user [0-200]*');
          const targetPlayer = db.getPlayer(targetUser);
          if (!targetPlayer) return sendReply('❌ Jogador não encontrado!');
          if (!targetPlayer.energy) targetPlayer.energy = { current: energy, max: 200 };
          else targetPlayer.energy.current = energy;
          db.save();
          return sendReply(`✅ Energia de @${targetUser.split('@')[0]} alterada para *${energy}/200*!`);
        }
        
        case 'addxp':
        case 'futaddxp': {
          const targetUser = messageInfo.mentionedJid?.[0] || argsArray[2];
          const xp = parseInt(argsArray[3]);
          if (!targetUser || !xp) return sendReply('📌 Use: *!futaddxp @user [valor]*');
          const targetPlayer = db.getPlayer(targetUser);
          if (!targetPlayer) return sendReply('❌ Jogador não encontrado!');
          const xpResult = db.addXP(targetUser, xp);
          if (xpResult.leveledUp) {
            const xpInfo = db.getXPInfo(targetUser);
            const levelUpMsg = db.generateLevelUpMessage(targetPlayer.name, xpResult.previousLevel, xpResult.newLevel, xpResult.levelUpRewards, xpInfo);
            sendReply(levelUpMsg);
          }
          return sendReply(`✅ Adicionados *${xpResult.xpGained} XP* para @${targetUser.split('@')[0]}!`);
        }
        
        case 'setlevel':
        case 'futsetlevel': {
          const targetUser = messageInfo.mentionedJid?.[0] || argsArray[2];
          const level = parseInt(argsArray[3]);
          if (!targetUser || !level || level < 1) return sendReply('📌 Use: *!futsetlevel @user [nível]*');
          const lvlPlayer = db.getPlayer(targetUser);
          if (!lvlPlayer) return sendReply('❌ Jogador não encontrado!');
          if (!lvlPlayer.xp) lvlPlayer.xp = { level: 1, currentXP: 0, evolutionPoints: 0, totalXP: 0 };
          lvlPlayer.xp.level = level;
          lvlPlayer.xp.currentXP = 0;
          db.save();
          return sendReply(`✅ Nível de @${targetUser.split('@')[0]} definido para *${level}*!`);
        }
        
        case 'setevo':
        case 'futsetevo': {
          const targetUser = messageInfo.mentionedJid?.[0] || argsArray[2];
          const evoPoints = parseInt(argsArray[3]);
          if (!targetUser || evoPoints === undefined || evoPoints < 0) return sendReply('📌 Use: *!futsetevo @user [pontos]*');
          const evoPlayer = db.getPlayer(targetUser);
          if (!evoPlayer) return sendReply('❌ Jogador não encontrado!');
          if (!evoPlayer.xp) evoPlayer.xp = { level: 1, currentXP: 0, evolutionPoints: 0, totalXP: 0 };
          evoPlayer.xp.evolutionPoints = evoPoints;
          db.save();
          return sendReply(`✅ Pontos de Evolução de @${targetUser.split('@')[0]} definidos para *${evoPoints}*!`);
        }
        
        case 'addevo':
        case 'futaddevo': {
          const targetUser = messageInfo.mentionedJid?.[0] || argsArray[2];
          const evoPoints = parseInt(argsArray[3]);
          if (!targetUser || !evoPoints || evoPoints < 1) return sendReply('📌 Use: *!futaddevo @user [pontos]*');
          const addEvoPlayer = db.getPlayer(targetUser);
          if (!addEvoPlayer) return sendReply('❌ Jogador não encontrado!');
          if (!addEvoPlayer.xp) addEvoPlayer.xp = { level: 1, currentXP: 0, evolutionPoints: 0, totalXP: 0 };
          addEvoPlayer.xp.evolutionPoints += evoPoints;
          db.save();
          return sendReply(`✅ Adicionados *${evoPoints} Pontos de Evolução* para @${targetUser.split('@')[0]}!\n\n💎 Total: ${addEvoPlayer.xp.evolutionPoints}`);
        }
        
        case 'settreino':
        case 'futsettreino': {
          const targetUser = messageInfo.mentionedJid?.[0] || argsArray[2];
          const attr = argsArray[3]?.toLowerCase();
          const valor = parseInt(argsArray[4]);
          if (!targetUser || !attr || !valor || valor < 1 || valor > 99) return sendReply('📌 Use: *!futsettreino @user [attr] [1-99]*\n\nAttrs: pac, sho, pas, dri, def, phy');
          const treinoPlayer = db.getPlayer(targetUser);
          if (!treinoPlayer) return sendReply('❌ Jogador não encontrado!');
          const validAttrs = ['pac', 'sho', 'pas', 'dri', 'def', 'phy'];
          if (!validAttrs.includes(attr)) return sendReply('❌ Atributo inválido! Use: pac, sho, pas, dri, def, phy');
          const oldVal = treinoPlayer.attributes[attr];
          treinoPlayer.attributes[attr] = valor;
          treinoPlayer.ovr = db.calculateOVR(treinoPlayer.attributes);
          db.save();
          return sendReply(`✅ ${attr.toUpperCase()} de @${targetUser.split('@')[0]}: ${oldVal} → ${valor}\n🎮 Novo OVR: ${treinoPlayer.ovr}`);
        }
        
        case 'resetxp':
        case 'futresetxp': {
          const targetUser = messageInfo.mentionedJid?.[0] || argsArray[2];
          if (!targetUser) return sendReply('📌 Use: *!futresetxp @user*');
          const resetResult = db.resetPlayerXP(targetUser);
          if (!resetResult.success) return sendReply(`❌ ${resetResult.error}`);
          return sendReply(`✅ XP resetado para @${targetUser.split('@')[0]}!\n\nVoltou ao Nível 1.`);
        }
        
        case 'setsolo':
        case 'futsetsolo': {
          const targetUser = messageInfo.mentionedJid?.[0] || argsArray[2];
          if (!targetUser) return sendReply('📌 Use: *!futsetsolo @user reset*');
          const soloPlayer = db.getPlayer(targetUser);
          if (!soloPlayer) return sendReply('❌ Jogador não encontrado!');
          soloPlayer.soloStats = { victories: 0, draws: 0, losses: 0, streak: 0, bestStreak: 0, totalPlayed: 0 };
          db.save();
          return sendReply(`✅ Estatísticas Solo de @${targetUser.split('@')[0]} resetadas!`);
        }
        
        case 'resetplayer':
        case 'futresetplayer': {
          const targetUser = messageInfo.mentionedJid?.[0] || argsArray[2];
          if (!targetUser) return sendReply('📌 Use: *!futresetplayer @user*');
          if (!db.getPlayer(targetUser)) return sendReply('❌ Jogador não encontrado!');
          delete db.players[targetUser];
          db.save();
          return sendReply(`✅ Jogador resetado com sucesso! Ele precisará usar *!fut entrar* novamente.`);
        }
        
        case 'resetall':
        case 'futresetall': {
          const playersCount = Object.keys(db.players).length;
          Object.keys(db.players).forEach(userId => delete db.players[userId]);
          db.globalRanking = { players: [], clubs: [] };
          db.matches = [];
          db.tournaments = [];
          db.market = { proposals: [], negotiations: [] };
          db.save();
          return sendReply(`⚠️ *ATENÇÃO - RESET COMPLETO*\n\n${playersCount} jogadores resetados!\n\nTodos voltaram ao início.`);
        }
        
        case 'clubes':
        case 'futclubereset': {
          const clubsCount = Object.keys(db.clubs).length;
          Object.keys(db.clubs).forEach(clubId => {
            const club = db.clubs[clubId];
            club.players.forEach(p => {
              if (db.players[p.id]) {
                db.players[p.id].currentClub = null;
                db.players[p.id].salary = 0;
              }
            });
            delete db.clubs[clubId];
          });
          db.save();
          return sendReply(`✅ *${clubsCount} clubes* foram resetados!\n\nTodos os jogadores estão livres.`);
        }
        
        case 'x1reset':
        case 'futresetx1': {
          db.matches = db.matches.filter(m => m.status !== 'pending');
          db.save();
          return sendReply('✅ X1 pendentes foram limpos!');
        }
        
        case 'addmvp':
        case 'futaddmvp': {
          const targetUser = messageInfo.mentionedJid?.[0] || argsArray[2];
          const amount = parseInt(argsArray[3]) || 1;
          if (!targetUser) return sendReply('📌 Use: *!futaddmvp @user [qtd]*');
          const mvpPlayer = db.getPlayer(targetUser);
          if (!mvpPlayer) return sendReply('❌ Jogador não encontrado!');
          if (!mvpPlayer.mvpCount) mvpPlayer.mvpCount = 0;
          mvpPlayer.mvpCount += amount;
          db.save();
          return sendReply(`✅ Adicionados *${amount} MVP* para @${targetUser.split('@')[0]}!\n\n⭐ Total de MVPs: ${mvpPlayer.mvpCount}`);
        }
        
        case 'setrep':
        case 'futsetrep': {
          const targetUser = messageInfo.mentionedJid?.[0] || argsArray[2];
          const rep = parseInt(argsArray[3]);
          if (!targetUser || rep === undefined) return sendReply('📌 Use: *!futsetrep @user [valor]*');
          const repPlayer = db.getPlayer(targetUser);
          if (!repPlayer) return sendReply('❌ Jogador não encontrado!');
          repPlayer.reputation = rep;
          db.save();
          return sendReply(`✅ Reputação de @${targetUser.split('@')[0]} definida para *${rep}*!`);
        }
        
        case 'addrep':
        case 'futaddrep': {
          const targetUser = messageInfo.mentionedJid?.[0] || argsArray[2];
          const rep = parseInt(argsArray[3]) || 1;
          if (!targetUser) return sendReply('📌 Use: *!futaddrep @user [valor]*');
          const addRepPlayer = db.getPlayer(targetUser);
          if (!addRepPlayer) return sendReply('❌ Jogador não encontrado!');
          if (!addRepPlayer.reputation) addRepPlayer.reputation = 50;
          addRepPlayer.reputation += rep;
          db.save();
          return sendReply(`✅ Adicionados *${rep} pontos* de reputação para @${targetUser.split('@')[0]}!\n\n📊 Reputação: ${addRepPlayer.reputation}`);
        }
        
        case 'help':
        case 'ajuda':
        case undefined: {
          return sendReply(`⚙️ *COMANDOS ADMINISTRATIVOS*

💰 *!futaddcoins @user [valor]* - Adicionar coins
💸 *!futremcoins @user [valor]* - Remover coins
⭐ *!futaddxp @user [valor]* - Adicionar XP
📊 *!futsetlevel @user [nível]* - Definir nível
💎 *!futsetevo @user [pts]* - Definir pontos de evolução
➕ *!futaddevo @user [pts]* - Adicionar pontos de evolução
🎮 *!futsetovr @user [1-99]* - Definir OVR
⚡ *!futsetenergy @user [0-200]* - Definir energia
🏆 *!futsetdiv @user [divisão]* - Definir divisão
⭐ *!futsetrep @user [valor]* - Definir reputação
➕ *!futaddrep @user [valor]* - Adicionar reputação
🎯 *!futsettreino @user [attr] [1-99]* - Definir atributo
⭐ *!futaddmvp @user [qtd]* - Adicionar MVP
🎮 *!futsetsolo @user reset* - Resetar stats solo
🔄 *!futresetxp @user* - Resetar XP
🗑️ *!futresetplayer @user* - Resetar jogador
⚠️ *!futresetall* - Resetar TODOS
⚽ *!futresetx1* - Limpar X1 pendentes
🏟️ *!futclubereset* - Resetar clubes`);
        }
        
        default:
          return sendReply(`❌ Comando '${action}' não reconhecido!\n\nUse *!fut admin* para ver todos os comandos.`);
      }
    };
    
    // ═══════════════════════════════════════════════════════════════
    // COMANDOS ADMIN INDEPENDENTES
    // ═══════════════════════════════════════════════════════════════
    
    case 'futaddcoins':
    case 'futremcoins':
    case 'futsetdiv':
    case 'futsetovr':
    case 'futsetenergy':
    case 'futaddxp':
    case 'futsetlevel':
    case 'futsetevo':
    case 'futaddevo':
    case 'futsettreino':
    case 'futresetxp':
    case 'futsetsolo':
    case 'futresetplayer':
    case 'futresetall':
    case 'futclubereset':
    case 'futresetx1':
    case 'futaddmvp':
    case 'futsetrep':
    case 'futaddrep':
      return processAdminCommand(command, args);
    
    // ═══════════════════════════════════════════════════════════════
    // COMANDO INVÁLIDO
    // ═══════════════════════════════════════════════════════════════
    default:
      return sendReply(getMenuFut(senderName));
  }
}
        

// Handler para o comando principal !fut
export async function handleFut(args, messageInfo, reply) {
  // Verificar se o jogador existe
    
  const { sender } = messageInfo;
  const player = db.getPlayer(sender);
  
  const command = args[0]?.toLowerCase() || '';
  console.log('[FUT] Comando:', command, 'Args:', args);
  
  if (!player && command !== 'entrar' && command !== 'registrar') {
    // Redirecionar para comando de entrada
    return handleFutCommand(['entrar'], messageInfo, reply);
  }
  
  return handleFutCommand(args, messageInfo, reply);
}