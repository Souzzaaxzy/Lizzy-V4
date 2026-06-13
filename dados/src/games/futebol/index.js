// ═══════════════════════════════════════════════════════════════
// 🏆 HANDLER DE COMANDOS DE FUTEBOL - KAISERBOT
// ═══════════════════════════════════════════════════════════════

import db from './database/index.js';
import { 
  getMenuFut, 
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
  const { sender, senderName, from, nazu } = messageInfo;
  const command = args[0]?.toLowerCase();
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
      if (!player) {
        return reply('❌ Você não está registrado!\nUse *!fut entrar* para começar.');
      }
      
      const validAttrs = ['pac', 'sho', 'pas', 'dri', 'def', 'phy'];
      const attrName = ATTR_NAMES[subCommand];
      
      if (!attrName) {
        let text = '🏋️ *TREINOS DISPONÍVEIS*\n\n';
        text += 'Custo: 5.000 FC Coins por treino\n';
        text += 'Ganho: 1-3 pontos por atributo\n\n';
        text += '━━━━━━━━━━━━━━━━━━━━━━━━\n\n';
        
        Object.entries(ATTR_NAMES).forEach(([key, name]) => {
          text += `• !fut treinar ${key} - ${name}\n`;
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
      // Encontrar desafio pendente para este usuário
      const challengeKey = `${sender}_${Object.keys(pendingX1).find(k => k.endsWith(`_${sender}`))}`;
      const challengeId = pendingX1.get(challengeKey);
      
      if (!challengeId) {
        return reply('❌ Nenhum desafio pendente para você!');
      }
      
      const matchData = db.matches.find(m => m.id === challengeId);
      if (!matchData) {
        return reply('❌ Desafio não encontrado ou expirado!');
      }
      
      // Simular partida
      const result = db.simulateX1Match(challengeId);
      if (!result) {
        return reply('❌ Erro ao processar partida!');
      }
      
      // Limpar desafio pendente
      pendingX1.delete(challengeKey);
      
      return reply(getX1ResultMessage(result));
    
    case 'recusarx1':
      const refuseKey = `${sender}_${Object.keys(pendingX1).find(k => k.endsWith(`_${sender}`))}`;
      if (pendingX1.has(refuseKey)) {
        pendingX1.delete(refuseKey);
        return reply('❌ Você recusou o desafio de X1.');
      }
      return reply('❌ Você não tem desafios pendentes.');
    
    // ═══════════════════════════════════════════════════════════════
    // SALDO
    // ═══════════════════════════════════════════════════════════════
    case 'saldo':
    case 'coins':
    case 'dinheiro':
      if (!player) {
        return reply('❌ Você não está registrado!\nUse *!fut entrar* para começar.');
      }
      return reply(`💰 *SEU SALDO*\n\n💎 FC Coins: ${player.economy.fcCoins.toLocaleString()}`);
    
    // ═══════════════════════════════════════════════════════════════
    // CLUBE
    // ═══════════════════════════════════════════════════════════════
    case 'criarclube':
    case 'criar':
      if (!player) {
        return reply('❌ Você não está registrado!\nUse *!fut entrar* para começar.');
      }
      
      if (player.currentClub) {
        return reply('❌ Você já está em um clube!\nSaias primeiro com *!fut sairclube*.');
      }
      
      const clubName = args.slice(1).join(' ');
      if (!clubName || clubName.length < 3) {
        return reply('📌 Use: *!fut criarclube [nome]*\n\nO nome deve ter pelo menos 3 caracteres.');
      }
      
      if (clubName.length > 20) {
        return reply('❌ Nome do clube muito longo! Máximo: 20 caracteres.');
      }
      
      // Verificar se já existe clube com este nome
      if (db.getClubByName(clubName)) {
        return reply('❌ Já existe um clube com este nome!');
      }
      
      const newClub = db.createClub(clubName, sender, senderName);
      return reply(`✅ *CLUBE CRIADO!* ✅\n\n⚽ ${clubName}\n👑 Presidente: ${senderName}\n\nAgora você pode contratar jogadores com *!fut proposta @usuario [salário]*`);
    
    case 'clube':
      if (!player) {
        return reply('❌ Você não está registrado!');
      }
      
      if (!player.currentClub) {
        return reply('❌ Você não está em nenhum clube!\n\n📌 Crie um: *!fut criarclube [nome]*');
      }
      
      const club = db.getClub(player.currentClub);
      if (!club) {
        return reply('❌ Clube não encontrado!');
      }
      
      return reply(getClubMessage(club, db.players));
    
    case 'membros':
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
      
      const result = db.removePlayerFromClub(player.currentClub, sender);
      if (!result.success) {
        return reply(`❌ ${result.error}`);
      }
      
      return reply('✅ Você saiu do clube!');
    
    // ═══════════════════════════════════════════════════════════════
    // CONTRATAÇÕES
    // ═══════════════════════════════════════════════════════════════
    case 'proposta':
    case 'contratar':
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
      
      const proposalResult = db.createProposal(player.currentClub, targetUser, salary, salary * 10);
      if (!proposalResult.success) {
        return reply(`❌ ${proposalResult.error}`);
      }
      
      return reply(`✅ *PROPOSTA ENVIADA!* ✅\n\n📝 Para: @${targetUser.split('@')[0]}\n💰 Salário: ${salary.toLocaleString()}/sem\n🎁 Bônus: ${(salary * 10).toLocaleString()}\n\nO jogador foi notificado!`);
    
    case 'propostas':
      if (!player) {
        return reply('❌ Você não está registrado!');
      }
      
      const proposals = db.getPlayerProposals(sender);
      if (proposals.length === 0) {
        return reply('📭 Você não tem propostas pendentes.');
      }
      
      let proposalsText = `📝 *SUAS PROPOSTAS (${proposals.length})*\n\n`;
      proposals.forEach(p => {
        proposalsText += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        proposalsText += `⚽ Clube: ${p.clubName}\n`;
        proposalsText += `💰 Salário: ${p.salary.toLocaleString()}/sem\n`;
        proposalsText += `🎁 Bônus: ${p.signingBonus.toLocaleString()}\n`;
        proposalsText += `📌 ID: ${p.id}\n`;
      });
      
      return reply(proposalsText);
    
    case 'aceitarproposta':
      if (!player) {
        return reply('❌ Você não está registrado!');
      }
      
      if (player.currentClub) {
        return reply('❌ Você já está em um clube!');
      }
      
      const proposalId = args[1];
      if (!proposalId) {
        return reply('📌 Use: *!fut aceitarproposta [id]*');
      }
      
      const acceptResult = db.acceptProposal(proposalId, sender);
      if (!acceptResult.success) {
        return reply(`❌ ${acceptResult.error}`);
      }
      
      const acceptedClub = db.getClub(player.currentClub);
      return reply(`✅ *CONTRATO ACEITO!* ✅\n\n⚽ Você agora é jogador do ${acceptedClub?.name}!\n💰 Salário: ${player.salary.toLocaleString()}/sem\n🎁 Bônus de assinatura já creditado!`);
    
    case 'recusarproposta':
      // Simplificado - remove todas as propostas do jogador
      const playerProposals = db.market.proposals.filter(p => p.playerId === sender);
      if (playerProposals.length === 0) {
        return reply('📭 Você não tem propostas para recusar.');
      }
      
      db.market.proposals = db.market.proposals.filter(p => p.playerId !== sender);
      db.save();
      
      return reply('✅ Propostas recusadas com sucesso!');
    
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
  
  if (!player && args[0]?.toLowerCase() !== 'entrar' && args[0]?.toLowerCase() !== 'registrar') {
    // Redirecionar para comando de entrada
    return handleFutCommand(['entrar'], messageInfo, reply);
  }
  
  return handleFutCommand(args, messageInfo, reply);
}