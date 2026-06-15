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
⚙️ !futadmin
Painel administrativo do Futebol Global

🔒 Exclusivo para administradores

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 Use *!fut entrar* para começar!`;
}

// ═══════════════════════════════════════════════════════════════
// MENU ADMIN - ESTILIZADO
// ═══════════════════════════════════════════════════════════════

export function getMenuAdminFut() {
  return `
🔧 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ┐
   ADMINISTRAÇÃO FUTEBOL GLOBAL ⚙️
🔧 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ┘

⚠️ *APENAS ADMINISTRADORES DO GRUPO*
⚠️ Use com responsabilidade!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
👤 JOGADORES - MOEDA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

💰 *addcoins* - Adicionar FC Coins
📝 Adiciona FC Coins diretamente ao saldo do jogador.
📌 Uso: !fut admin addcoins @usuario [valor]
📌 Exemplo: !fut admin addcoins @player 50000
📌 Valor mínimo: 1 | Sem máximo
⚠️ Afeta: compras, treinos, torneios, clubes

💸 *remcoins* - Remover FC Coins
📝 Remove FC Coins do saldo do jogador.
📌 Uso: !fut admin remcoins @usuario [valor]
📌 Exemplo: !fut admin remcoins @player 10000
⚠️ Não pode remover mais do que o jogador possui!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
👤 JOGADORES - STATUS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🎮 *setovr* - Definir Overall (OVR)
📝 Altera manualmente o OVR do jogador.
⚠️ Ignora progressão normal por XP e treinos.
📌 Uso: !fut admin setovr @usuario [1-99]
📌 Exemplo: !fut admin setovr @player 85
📌 Faixa permitida: 1 a 99
⚠️ Afeta: X1, Solo, Clubes, Torneios, Rankings

⚡ *setenergy* - Definir Energia
📝 Define a energia atual do jogador.
📌 Uso: !fut admin setenergy @usuario [0-200]
📌 Exemplo: !fut admin setenergy @player 200
📌 Faixa permitida: 0 a 200

🏆 *setdiv* - Definir Divisão
📝 Move o jogador para uma divisão específica.
📌 Uso: !fut admin setdiv @usuario [divisão]
📌 Divisões: bronze_3, prata_2, ouro_1, elite_3, lenda_2, mestre_1, pro_3, worldclass_1, topglobal
📌 Exemplo: !fut admin setdiv @player ouro_1
⚠️ Afeta: Rankings, desbloqueios, habilidades

⭐ *addmvp* - Adicionar MVP
📝 Adiciona MVPs ao contador do jogador.
📌 Uso: !fut admin addmvp @usuario [quantidade]
📌 Exemplo: !fut admin addmvp @player 10
📌 Recompensa: +100 FC Coins e +3 reputação por MVP

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ COMANDOS DE RISCO - JOGADORES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

👑 *resetplayer* - Resetar Jogador
📝 Remove TODOS os dados do jogador específico.
⚠️ ESTA AÇÃO NÃO PODE SER DESFEITA!
⚠️ Irá apagar:
• OVR e Atributos (volta a 60)
• XP e Pontos de Evolução
• FC Coins (volta a 250.000)
• Conquistas e Habilidades
• Histórico de Partidas
• Estatísticas Solo/X1
• Clubes e Propostas
• Reputação (volta a 50)
📌 Uso: !fut admin resetplayer @usuario
📌 Exemplo: !fut admin resetplayer @player

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⭐ XP & EVOLUÇÃO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📈 *addxp* - Adicionar XP
📝 Adiciona XP ao jogador (pode subir nível).
📌 Uso: !fut admin addxp @usuario [valor]
📌 Exemplo: !fut admin addxp @player 5000
📌 Cada nível ganha +2 pontos de evolução

🎯 *setlevel* - Definir Nível
📝 Define o nível do jogador diretamente.
📌 Uso: !fut admin setlevel @usuario [1-100]
📌 Exemplo: !fut admin setlevel @player 50
⚠️ Zera o XP atual e dá pontos de evolução

💎 *setevo* - Definir Pontos de Evolução
📝 Define a quantidade de pontos de evolução.
📌 Uso: !fut admin setevo @usuario [pontos]
📌 Exemplo: !fut admin setevo @player 200

➕ *addevo* - Adicionar Pontos de Evolução
📝 Adiciona pontos de evolução ao jogador.
📌 Uso: !fut admin addevo @usuario [pontos]
📌 Exemplo: !fut admin addevo @player 50

🔄 *resetxp* - Resetar XP
📝 Reseta todo o sistema de XP do jogador.
⚠️ Zera nível (volta a 1), XP e pontos de evolução.
📌 Uso: !fut admin resetxp @usuario
📌 Exemplo: !fut admin resetxp @player

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 ATRIBUTOS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚡ *settreino* - Definir Atributo
📝 Define o valor de um atributo específico.
📌 Uso: !fut admin settreino @usuario [attr] [valor]
📌 Atributos: pac (velocidade), sho (finalização), pas (passe), dri (drible), def (defesa), phy (físico)
📌 Exemplo: !fut admin settreino @player pac 99
📌 Valor permitido: 1 a 99
⚠️ Recalcula OVR automaticamente

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🌟 REPUTAÇÃO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 *setrep* - Definir Reputação
📝 Define a reputação do jogador (0-100).
📌 Uso: !fut admin setrep @usuario [0-100]
📌 Exemplo: !fut admin setrep @player 90
📌 Impacto:
• 90+: ⭐ Lendário (+2% bônus)
• 75-89: 🌟 Profissional (+1% bônus)
• 60-74: 👍 Confiável (normal)
• 40-59: 😐 Neutro (normal)
• 20-39: ⚠️ Questionável (-1%)
• 0-19: ❌ Reprovado (-2%)

➕ *addrep* - Ajustar Reputação
📝 Adiciona ou remove reputação.
📌 Uso: !fut admin addrep @usuario [+/-valor]
📌 Exemplo: !fut admin addrep @player +20
📌 Limite: 0 a 100

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🏆 TEMPORADA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 *season* - Status da Temporada
📝 Mostra informações da temporada atual.
📌 Uso: !fut admin season
📌 Exibe: número, datas, rankings, recompensas

🔄 *season reset* - Resetar Temporada
📝 Reseta todos os dados da temporada atual.
⚠️ O que é resetado:
• Rankings de temporada
• Conquistas de temporada
• Estatísticas de temporada
• Recompensas pendentes
⚠️ O que é preservado:
• XP e Nível
• FC Coins
• OVR e Atributos
• Divisão
• Conquistas gerais
📌 Uso: !fut admin season reset

⚙️ *season config* - Configurar Temporada
📝 Define os parâmetros da nova temporada.
📌 Uso: !fut admin season config [opções]
📌 Opções: duração, recompensas, bônus

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎁 CÓDIGOS PROMOCIONAIS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🎫 *codigo criar* - Criar Código
📝 Cria um código promocional com recompensas fixas.
📌 Uso: !fut admin codigo criar [CODIGO] [COINS] [XP] [USOS] [HORAS]
📌 Parâmetros:
• CODIGO: Nome do código (até 10 caracteres)
• COINS: FC Coins da recompensa
• XP: XP da recompensa
• USOS: Vezes que pode ser usado
• HORAS: Tempo até expirar (0 = nunca)
📌 Exemplo: !fut admin codigo criar VIP2026 5000 200 50 48
📌 Resultado: Código VIP2026 dá 5.000 coins + 200 XP
         Pode ser usado 50 vezes
         Expira em 48 horas

🎲 *codigo misterioso* - Criar Código Aleatório
📝 Cria código com valores aleatórios.
📌 Uso: !fut admin codigo misterioso [MINC] [MAXC] [MINX] [MAXX] [USOS]
📌 Parâmetros:
• MINC/MAXC: Range de coins
• MINX/MAXX: Range de XP
• USOS: Limite de usos
📌 Exemplo: !fut admin codigo misterioso 1000 5000 50 200 10
📌 Cada resgate terá valores aleatórios no range

📋 *codigo listar* - Listar Códigos
📝 Lista todos os códigos promocionais ativos.
📌 Uso: !fut admin codigo listar

📜 *codigo log* - Histórico de Uso
📝 Mostra quem usou cada código.
📌 Uso: !fut admin codigo log [código]
📌 Exemplo: !fut admin codigo log VIP2026

❌ *codigo desativar* - Desativar Código
📝 Desativa um código sem apagar o histórico.
📌 Uso: !fut admin codigo desativar [CODIGO]
📌 Exemplo: !fut admin codigo desativar VIP2026
⚠️ Código desativado não pode ser reativado!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🏆 TORNEIOS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📌 *ESTRUTURA DE UM TORNEIO:*
1. CRIAÇÃO → Define nome, tipo, premiações
2. INSCRIÇÃO → Jogadores entram (custa entrada)
3. INÍCIO → Gera chaveamento e inicia jogos
4. DISPUTA → Admin processa cada partida
5. FINAL → Entrega prêmios ao campeão

➕ *torneio criar* - Criar Torneio
📝 Cria um novo torneio.
📌 Uso: !fut admin torneio criar [NOME]|[TIPO]|[MAX]|[ENTRADA]|[PREMIO]|[TROFÉU]
📌 Parâmetros:
• NOME: Nome do torneio
• TIPO: x1, 5v5, ou draft
• MAX: Número máximo de jogadores (4, 8, 16, 32)
• ENTRADA: FC Coins para participar
• PREMIO: FC Coins para o campeão
• TROFÉU: Título do campeão
📌 Exemplo: !fut admin torneio criar Copa Legends|x1|16|1000|10000|Campeão da Copa
📌 Resultado: Torneio com 16 jogadores, entrada 1.000,
         prêmio 10.000 para o campeão "Campeão da Copa"

▶️ *torneio iniciar* - Iniciar Torneio
📝 Fecha inscrições e gera o chaveamento.
⚠️ Após iniciar, ninguém mais pode entrar!
📌 Uso: !fut admin torneio iniciar [ID]
📌 Exemplo: !fut admin torneio iniciar tourney_123

⚽ *torneio jogar* - Processar Partida
📝 Simula a próxima partida do torneio.
📌 Uso: !fut admin torneio jogar [ID]
📌 Exemplo: !fut admin torneio jogar tourney_123
⚠️ Execute uma vez por partida!

👁️ *torneio ver* - Ver Torneio
📝 Mostra detalhes e chaveamento atual.
📌 Uso: !fut admin torneio ver [ID]

❌ *torneio cancelar* - Cancelar Torneio
📝 Cancela o torneio e devolve entradas.
⚠️ Devolve FC Coins aos participantes!
📌 Uso: !fut admin torneio cancelar [ID]

📋 *torneio listar* - Listar Torneios
📝 Lista todos os torneios (ativos e finalizados).
📌 Uso: !fut admin torneio listar

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 FUT SOLO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔄 *setsolo* - Resetar Solo
📝 Reseta as estatísticas Solo do jogador.
📌 Uso: !fut admin setsolo @usuario reset
📌 Exemplo: !fut admin setsolo @player reset
⚠️ Zera: vitórias, derrotas, sequência, melhor sequência

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ RESET GERAL - EXTREMO PERIGO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

💥 *resetall* - Resetar Tudo
⚠️⚠️⚠️ ATENÇÃO: EXTREMAMENTE PERIGOSO! ⚠️⚠️⚠️
📝 Apaga TODOS os dados do Futebol Global.
⚠️ ESTA AÇÃO NÃO PODE SER DESFEITA!
⚠️ Irá apagar:
• TODOS os jogadores
• TODOS os clubes
• TODOS os rankings
• TODOS os torneios
• TODOS os códigos
• TODOS os X1 pendentes
• TODO o histórico
• TODAS as conquistas
📌 Uso: !fut admin resetall
📌 CONFIRMAÇÃO NECESSÁRIA: Este comando requer
         confirmação adicional antes de executar.

🏠 *clubes reset* - Resetar Clubes
⚠️ Remove TODOS os clubes e limpa currentClub dos jogadores.
📌 Uso: !fut admin clubes reset

⚔️ *x1reset* - Limpar X1
📝 Cancela todos os desafios X1 pendentes.
📌 Uso: !fut admin x1reset
`;
}export function getEnterMessage(playerName) {
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

🏅 *ESTATÍSTICAS GLOBAIS:*
• Partidas: ${player.stats.matches}
• Vitórias: ${player.stats.wins}
• Empates: ${player.stats.draws}
• Derrotas: ${player.stats.losses}
• Gols marcados: ${player.stats.goalsFor}
• Gols sofridos: ${player.stats.goalsAgainst}
${player.soloStats ? `• Sequência Solo: ${player.soloStats.streak} (Melhor: ${player.soloStats.bestStreak})` : ''}

🏏 *FUT SOLO:*
${player.soloStats ? `• Vitórias: ${player.soloStats.victories}
• Derrotas: ${player.soloStats.losses}
• Empates: ${player.soloStats.draws}
• Total: ${player.soloStats.totalPlayed}` : '• Nenhuma partida solo'}

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

// ═══════════════════════════════════════════════════════════════
// XP GLOBAL - SISTEMA REFORMULADO
// ═══════════════════════════════════════════════════════════════

export function getXPMessage(player) {
  const xpInfo = db.getXPInfo(player.id);
  if (!xpInfo) {
    return '❌ Não foi possível obter informações de XP.';
  }
  
  const divEmoji = DIVISIONS_EMOJI[xpInfo.division] || '🏆';
  const divName = getDivisionName(xpInfo.division);
  
  // Construir detalhes de bônus
  let bonusDetails = '';
  if (xpInfo.xpBonus > 0) {
    bonusDetails = `\n🎁 *Bônus Ativo:* +${xpInfo.xpBonus}%`;
  }
  
  // Barra de progresso
  const progressBar = xpInfo.progressBar || generateProgressBar(xpInfo.currentXP, xpInfo.xpNeeded);
  
  return `
⚡ *XP FUTEBOL GLOBAL* ⚡

🏆 *NÍVEL:* ${xpInfo.level}
${divEmoji} *Divisão:* ${divName} ${xpInfo.divisionBonus > 0 ? `(+${xpInfo.divisionBonus}% XP)` : ''}

━━━━━━━━━━━━━━━━━━━━━━━━
📊 *PROGRESSO*
━━━━━━━━━━━━━━━━━━━━━━━━
${progressBar}
✨ XP: ${xpInfo.currentXP.toLocaleString()} / ${xpInfo.xpNeeded.toLocaleString()}
📈 Para próximo nível: ${xpInfo.xpRemaining.toLocaleString()} XP
🎯 Progresso: ${xpInfo.progress}%

━━━━━━━━━━━━━━━━━━━━━━━━
💎 *RECOMPENSAS*
━━━━━━━━━━━━━━━━━━━━━━━━
🔓 Pontos de Evolução: ${xpInfo.evolutionPoints}
🌟 XP Total Acumulado: ${xpInfo.totalXP.toLocaleString()}${bonusDetails}

━━━━━━━━━━━━━━━━━━━━━━━━
📋 *ESTATÍSTICAS DE XP*
━━━━━━━━━━━━━━━━━━━━━━━━
⚽ Partidas Jogadas: ${xpInfo.matchesPlayed}
🎮 Partidas Solo: ${xpInfo.soloMatches}
⚔️ X1: ${xpInfo.x1Matches}
🏆 Torneios: ${xpInfo.tournamentMatches}
🔥 Sequência Atual: ${xpInfo.winStreak} vitórias
${xpInfo.form > 0 ? `📈 Forma: +${xpInfo.form}` : ''}

━━━━━━━━━━━━━━━━━━━━━━━━
💡 *COMO GANHAR XP:*
━━━━━━━━━━━━━━━━━━━━━━━━
✅ Vitória: +XP (base + bônus)
⚽ Gol marcado: +3 XP
🧤 Clean Sheet: +5 XP
🎯 Participação: +2 XP
🏆 Torneio: +20% bônus
⚔️ Rivalidade: +25% bônus
🔥 Sequência: até +40% bônus

💎 *Evolua seu jogador!*`;
}

function generateProgressBar(current, max, size = 20) {
  const percentage = current / max;
  const filled = Math.round(percentage * size);
  const empty = size - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

export { getDivisionName, getSkillSlots, DIVISIONS_EMOJI, ATTR_NAMES };
// ═══════════════════════════════════════════════════════════════
// 📋 MENU ADMINISTRATIVO DO FUTEBOL GLOBAL
// ═══════════════════════════════════════════════════════════════

export function getAdminMenuFut(senderName) {
  return `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚽ *FUTEBOL GLOBAL - PAINEL ADMIN* ⚽
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

👤 Administrador: ${senderName}
🔒 Acesso: *AUTORIZADO*

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💰 MOEDAS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

• *!futaddcoins* - Adicionar coins
• *!futremcoins* - Remover coins

📖 Como usar:
• *!futaddcoins @usuario 5000*
  └ Adiciona 5.000 FC Coins

• *!futremcoins @usuario 5000*
  └ Remove 5.000 FC Coins

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
👤 JOGADORES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

• *!futsetovr* - Definir overall
• *!futsetenergy* - Definir energia
• *!futsetdiv* - Definir divisão
• *!futaddmvp* - Adicionar MVP
• *!futresetplayer* - Resetar jogador

📖 Como usar:
• *!futsetovr @usuario 85*
  └ Define OVR do jogador (1-99)

• *!futsetenergy @usuario 200*
  └ Define energia maxima (0-200)

• *!futsetdiv @usuario ouro_1*
  └ Define a divisão do jogador

• *!futaddmvp @usuario 10*
  └ Adiciona MVPs ao jogador

• *!futresetplayer @usuario*
  └ Reseta jogador completamente

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⭐ XP E EVOLUÇÃO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

• *!futaddxp* - Adicionar XP
• *!futsetlevel* - Definir nível
• *!futsetevo* - Definir pontos evo
• *!futaddevo* - Adicionar pontos evo
• *!futresetxp* - Resetar XP

📖 Como usar:
• *!futaddxp @usuario 5000*
  └ Adiciona XP ao jogador

• *!futsetlevel @usuario 50*
  └ Define nível direto

• *!futsetevo @usuario 200*
  └ Define pontos de evolução

• *!futaddevo @usuario 50*
  └ Adiciona pontos de evolução

• *!futresetxp @usuario*
  └ Reseta XP para nível 1

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 ATRIBUTOS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

• *!futsettreino* - Definir atributo

📖 Como usar:
• *!futsettreino @usuario pac 99*

⚡ Atributos disponíveis:
• pac - Velocidade
• sho - Finalização
• pas - Passe
• dri - Drible
• def - Defesa
• phy - Físico

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🌟 REPUTAÇÃO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

• *!futsetrep* - Definir reputação
• *!futaddrep* - Adicionar reputação

📖 Como usar:
• *!futsetrep @usuario 90*
  └ Define reputação fixa (0-100)

• *!futaddrep @usuario 10*
  └ Adiciona pontos de reputação

💡 Reputação afeta negociações e
   aceitação em clubes

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🏆 TEMPORADAS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

• *!futseason* - Ver temporada atual
• *!futseasonreset* - Resetar temporada
• *!futseasonconfig* - Configurar temporada

📖 Como usar:
• *!futseason*
  └ Mostra informações da temporada

• *!futseasonreset*
  └ Reseta rankings e divisões

• *!futseasonconfig 30 sim*
  └ Configura: 30 dias, reseta divisões

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎁 CÓDIGOS PROMOCIONAIS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

• *!futcodigocriar* - Criar código
• *!futcodigomisterioso* - Criar código aleatório
• *!futcodigolistar* - Listar códigos
• *!futcodigolog* - Ver log de uso
• *!futcodigodesativar* - Desativar código

📖 Como usar:
• *!futcodigocriar normal 1000 100*
  └ Cria código: 1000 coins, 100 XP

• *!futcodigocriar titulo 500 50 Lendario*
  └ Cria código com título

• *!futcodigomisterioso 100 5000*
  └ Código com recompensas aleatórias

• *!futcodigolistar*
  └ Lista todos os códigos

• *!futcodigolog CODIGO123*
  └ Ver quem usou o código

• *!futcodigodesativar CODIGO123*
  └ Desativa o código

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🏆 TORNEIOS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

• *!futtorneiocriar* - Criar torneio
• *!futtorneioiniciar* - Iniciar torneio
• *!futtorneiover* - Ver torneio
• *!futtorneiocancelar* - Cancelar torneio
• *!futtorneiolistar* - Listar torneios

📖 Fluxo completo:
1️⃣ *!futtorneiocriar Copa Elite x1 16 500 5000*
   └ Nome: Copa Elite | Tipo: X1 | Max: 16
   └ Entrada: 500 | Prêmio: 5000

2️⃣ *!futtorneiolistar*
   └ Ver ID do torneio criado

3️⃣ *!futtorneioiniciar 1*
   └ Inicia o torneio (ID 1)

4️⃣ *!futtorneiover 1*
   └ Acompanhar andamento

5️⃣ *!futtorneiocancelar 1*
   └ Cancelar se necessário

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 FUT SOLO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

• *!futsetsolo* - Resetar stats solo

📖 Como usar:
• *!futsetsolo @usuario reset*

⚡ Stats resetadas:
• Vitórias, empates, derrotas
• Sequência atual e melhor
• Total de partidas

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚔️ X1
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

• *!futresetx1* - Limpar X1 pendentes

📖 Como usar:
• *!futresetx1*

⚡ Cancela todos os desafios X1
   que estão aguardando resposta

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🏟️ CLUBES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

• *!futclubereset* - Resetar clubes

📖 Como usar:
• *!futclubereset*

⚡ Remove todos os clubes e
   desvincula jogadores

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
☠️ ⚠️⚠️ RESET GLOBAL ⚠️⚠️ ☠️
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

• *!futresetall* - RESETAR TUDO

📖 Como usar:
• *!futresetall*

⚠️⚠️⚠️ *PERIGO EXTREMO* ⚠️⚠️⚠️

Este comando IRÁ APAGAR:
• Todos os jogadores
• Todos os clubes
• Todos os rankings
• Todos os torneios
• Todas as transações
• Todas as estatísticas

⚠️ Esta ação NÃO pode ser desfeita!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📚 USE *!futadmin* PARA VER ESTE MENU
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
}
