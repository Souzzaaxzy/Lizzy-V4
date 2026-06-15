// ═══════════════════════════════════════════════════════════════
// 🏆 SISTEMA ADMINISTRATIVO - FUTEBOL GLOBAL
// ═══════════════════════════════════════════════════════════════

export function getAdminMenuFut(senderName) {
  return `⚙️ *PAINEL ADMINISTRATIVO* ⚙️

Olá, *${senderName}*! Bem-vindo ao painel administrativo do Futebol Global.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔒 *ÁREA RESTRITA*
Somente administradores do grupo podem utilizar.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 *CATEGORIAS*

💰 Moedas
👤 Jogadores  
⭐ XP e Evolução
🎯 Atributos
🌟 Reputação
🏆 Temporadas
🎁 Códigos Promocionais
🏆 Torneios
📊 Fut Solo
⚔️ X1
🏟️ Clubes
☠️ Reset Global

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📝 *COMANDOS POR CATEGORIA*

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💰 MOEDAS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• !futaddcoins @user [valor]
• !futremcoins @user [valor]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
👤 JOGADORES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• !futsetovr @user [1-99]
• !futsetenergy @user [0-200]
• !futsetdiv @user [divisão]
• !futaddmvp @user [qtd]
• !futresetplayer @user

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⭐ XP E EVOLUÇÃO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• !futaddxp @user [valor]
• !futsetlevel @user [nível]
• !futsetevo @user [pontos]
• !futaddevo @user [pontos]
• !futresetxp @user

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 ATRIBUTOS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• !futsettreino @user [attr] [1-99]

*Atributos:* pac, sho, pas, dri, def, phy

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🌟 REPUTAÇÃO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• !futsetrep @user [valor]
• !futaddrep @user [+/-valor]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🏆 TEMPORADAS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• !futseason - Ver temporada atual
• !futseasonreset - Resetar temporada
• !futseasonconfig - Configurar temporada

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎁 CÓDIGOS PROMOCIONAIS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• !futcodigocriar [código] [valor]
• !futcodigomisterioso - Criar código aleatório
• !futcodigolistar - Listar códigos ativos
• !futcodigolog - Ver uso de códigos
• !futcodigodesativar [código]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🏆 TORNEIOS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• !futtorneiocriar [nome] [formato]
• !futtorneioiniciar [id]
• !futtorneiojogar [id] [resultado]
• !futtorneiover [id]
• !futtorneiocancelar [id]
• !futtorneiolistar

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 FUT SOLO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• !futsetsolo @user reset

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚔️ X1
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• !futresetx1 @user

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🏟️ CLUBES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• !futclubereset @user

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
☠️ RESET GLOBAL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• !futresetall ⚠️ RESETA TUDO!

*Este comando apaga TODOS os dados dos jogadores!*

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

💡 Use !futadmin [comando] para mais detalhes sobre um comando específico.

🔒 *Exclusivo para administradores*`;
}

export function getAccessDeniedMessage() {
  return `🚫 *ACESSO NEGADO*

Este painel é exclusivo para administradores do Futebol Global.

Apenas administradores do grupo podem utilizar comandos administrativos.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

💡 Use *!menufut* para ver os comandos disponíveis para membros.`;
}

export function getAdminCategoryMenu(category, senderName) {
  const categories = {
    'moedas': {
      title: '💰 MOEDAS',
      commands: [
        { cmd: '!futaddcoins', desc: 'Adicionar FC Coins', usage: '!futaddcoins @user 5000' },
        { cmd: '!futremcoins', desc: 'Remover FC Coins', usage: '!futremcoins @user 1000' }
      ]
    },
    'jogadores': {
      title: '👤 JOGADORES',
      commands: [
        { cmd: '!futsetovr', desc: 'Definir OVR do jogador', usage: '!futsetovr @user 85' },
        { cmd: '!futsetenergy', desc: 'Definir energia', usage: '!futsetenergy @user 200' },
        { cmd: '!futsetdiv', desc: 'Definir divisão', usage: '!futsetdiv @user bronze' },
        { cmd: '!futaddmvp', desc: 'Adicionar MVP', usage: '!futaddmvp @user 5' },
        { cmd: '!futresetplayer', desc: 'Resetar jogador', usage: '!futresetplayer @user' }
      ]
    },
    'xp': {
      title: '⭐ XP E EVOLUÇÃO',
      commands: [
        { cmd: '!futaddxp', desc: 'Adicionar XP', usage: '!futaddxp @user 1000' },
        { cmd: '!futsetlevel', desc: 'Definir nível', usage: '!futsetlevel @user 10' },
        { cmd: '!futsetevo', desc: 'Definir pontos de evo', usage: '!futsetevo @user 50' },
        { cmd: '!futaddevo', desc: 'Adicionar pontos de evo', usage: '!futaddevo @user 10' },
        { cmd: '!futresetxp', desc: 'Resetar XP', usage: '!futresetxp @user' }
      ]
    },
    'atributos': {
      title: '🎯 ATRIBUTOS',
      commands: [
        { cmd: '!futsettreino', desc: 'Definir atributo', usage: '!futsettreino @user pac 90' }
      ],
      note: '*Atributos:* pac, sho, pas, dri, def, phy'
    },
    'reputacao': {
      title: '🌟 REPUTAÇÃO',
      commands: [
        { cmd: '!futsetrep', desc: 'Definir reputação', usage: '!futsetrep @user 100' },
        { cmd: '!futaddrep', desc: 'Adicionar reputação', usage: '!futaddrep @user +10' }
      ]
    },
    'temporadas': {
      title: '🏆 TEMPORADAS',
      commands: [
        { cmd: '!futseason', desc: 'Ver temporada atual', usage: '!futseason' },
        { cmd: '!futseasonreset', desc: 'Resetar temporada', usage: '!futseasonreset' },
        { cmd: '!futseasonconfig', desc: 'Configurar temporada', usage: '!futseasonconfig' }
      ]
    },
    'codigos': {
      title: '🎁 CÓDIGOS PROMOCIONAIS',
      commands: [
        { cmd: '!futcodigocriar', desc: 'Criar código', usage: '!futcodigocriar DESCONTO 1000' },
        { cmd: '!futcodigomisterioso', desc: 'Criar código aleatório', usage: '!futcodigomisterioso 500' },
        { cmd: '!futcodigolistar', desc: 'Listar códigos', usage: '!futcodigolistar' },
        { cmd: '!futcodigolog', desc: 'Ver uso de códigos', usage: '!futcodigolog' },
        { cmd: '!futcodigodesativar', desc: 'Desativar código', usage: '!futcodigodesativar DESCONTO' }
      ]
    },
    'torneios': {
      title: '🏆 TORNEIOS',
      commands: [
        { cmd: '!futtorneiocriar', desc: 'Criar torneio', usage: '!futtorneiocriar Copa 8' },
        { cmd: '!futtorneioiniciar', desc: 'Iniciar torneio', usage: '!futtorneioiniciar 1' },
        { cmd: '!futtorneiojogar', desc: 'Registrar resultado', usage: '!futtorneiojogar 1 2-1' },
        { cmd: '!futtorneiover', desc: 'Ver torneio', usage: '!futtorneiover 1' },
        { cmd: '!futtorneiocancelar', desc: 'Cancelar torneio', usage: '!futtorneiocancelar 1' },
        { cmd: '!futtorneiolistar', desc: 'Listar torneios', usage: '!futtorneiolistar' }
      ]
    },
    'solo': {
      title: '📊 FUT SOLO',
      commands: [
        { cmd: '!futsetsolo', desc: 'Resetar estatísticas Solo', usage: '!futsetsolo @user reset' }
      ]
    },
    'x1': {
      title: '⚔️ X1',
      commands: [
        { cmd: '!futresetx1', desc: 'Resetar estatísticas X1', usage: '!futresetx1 @user' }
      ]
    },
    'clubes': {
      title: '🏟️ CLUBES',
      commands: [
        { cmd: '!futclubereset', desc: 'Resetar clube', usage: '!futclubereset @user' }
      ]
    },
    'reset': {
      title: '☠️ RESET GLOBAL',
      commands: [
        { cmd: '!futresetall', desc: 'RESETAR TUDO ⚠️', usage: '!futresetall', danger: true }
      ],
      warning: '⚠️ *PERIGO!* Este comando apaga TODOS os dados!'
    }
  };

  const cat = categories[category.toLowerCase()];
  if (!cat) {
    return `❌ Categoria "${category}" não encontrada.

Use *!futadmin* para ver todas as categorias.`;
  }

  let text = `${cat.title}\n\n`;

  for (const cmd of cat.commands) {
    text += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    text += `📌 *${cmd.cmd}*\n`;
    text += `${cmd.desc}\n`;
    text += `📝 Uso: ${cmd.usage}\n`;
    if (cmd.danger) {
      text += `\n⚠️ *COMANDO PERIGOSO!*\nUse com cautela!\n`;
    }
  }

  if (cat.note) {
    text += `\n${cat.note}\n`;
  }

  if (cat.warning) {
    text += `\n${cat.warning}\n`;
  }

  text += `\n━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  text += `💡 Use *!futadmin* para voltar ao menu principal.`;

  return text;
}
