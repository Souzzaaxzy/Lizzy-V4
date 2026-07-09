export default async function menuMembros(prefix, botName = "MeuBot", userName = "Usuário", {
    header = `╭──────────────────────────────────────────────╮⊰ 🌸 『 *${botName}* 』\n│Olá, #user#!\n╰──────────────────────────────────────────────╯`,
    menuTopBorder = "╭──────────────────────────────────────────────╮",
    bottomBorder = "╰──────────────────────────────────────────────╯",
    menuTitleIcon = "◈",
    menuItemIcon = "▸",
    separatorIcon = "❁",
    middleBorder = "│",
    perfilMenuTitle = "👤 PERFIL & ESTATÍSTICAS",
    botStatusMenuTitle = "🤖 STATUS DO BOT",
    personalMenuTitle = "⚙️ CONFIGURAÇÕES PESSOAIS",
    rankMenuTitle = "🏆 RANKINGS & GAMIFICAÇÃO",
    gamingMenuTitle = "🎮 CONTEÚDO GAMER"
} = {}) {
    const formattedHeader = header.replace(/#user#/g, userName);
    return `${formattedHeader}

${menuTopBorder}
│ ${perfilMenuTitle}
${middleBorder}
${middleBorder}${menuItemIcon}${prefix}perfil
${middleBorder}${menuItemIcon}${prefix}me
${bottomBorder}

${menuTopBorder}
│ ${botStatusMenuTitle}
${middleBorder}
${middleBorder}${menuItemIcon}${prefix}ping
${middleBorder}${menuItemIcon}${prefix}statusbot
${middleBorder}${menuItemIcon}${prefix}statusgp
${middleBorder}${menuItemIcon}${prefix}regras
${middleBorder}${menuItemIcon}${prefix}zipbot
${middleBorder}${menuItemIcon}${prefix}gitbot
${middleBorder}${menuItemIcon}${prefix}transcrever (responda um áudio)
${bottomBorder}

${menuTopBorder}
│ ${personalMenuTitle}
${middleBorder}
${middleBorder}${menuItemIcon}${prefix}mention
${middleBorder}${menuItemIcon}${prefix}afk
${middleBorder}${menuItemIcon}${prefix}voltei
${bottomBorder}

${menuTopBorder}
│ 👬 INTERAÇÃO SOCIAL
${middleBorder}
${middleBorder}${menuItemIcon}${prefix}roles
${middleBorder}${menuItemIcon}${prefix}role.vou
${middleBorder}${menuItemIcon}${prefix}role.nvou
${middleBorder}${menuItemIcon}${prefix}role.confirmados
${bottomBorder}

${menuTopBorder}
│ ${rankMenuTitle}
${middleBorder}
${middleBorder}${menuItemIcon}${prefix}rankativo
${middleBorder}${menuItemIcon}${prefix}rankinativo
${middleBorder}${menuItemIcon}${prefix}rankativos
${middleBorder}${menuItemIcon}${prefix}atividade
${middleBorder}${menuItemIcon}${prefix}checkativo / meativo
${middleBorder}${menuItemIcon}${prefix}totalcmd
${middleBorder}${menuItemIcon}${prefix}topcmd
${bottomBorder}

${menuTopBorder}
│ 📊 ESTATÍSTICAS DE MENSAGENS
${middleBorder}
${middleBorder}${menuItemIcon}${prefix}msgdiario
${middleBorder}${menuItemIcon}${prefix}msgsemanal
${middleBorder}${menuItemIcon}${prefix}topdiario
${middleBorder}${menuItemIcon}${prefix}topsemanal
${middleBorder}${menuItemIcon}${prefix}mediario
${middleBorder}${menuItemIcon}${prefix}mesemanal
${middleBorder}${menuItemIcon}${prefix}vermetas
${middleBorder}${menuItemIcon}${prefix}setdiario [número] (admin)
${middleBorder}${menuItemIcon}${prefix}setsemanal [número] (admin)
${bottomBorder}

${menuTopBorder}
│  CONQUISTAS & PRESENTES
${middleBorder}
${middleBorder}${menuItemIcon}${prefix}conquistas
${middleBorder}${menuItemIcon}${prefix}caixa diaria
${middleBorder}${menuItemIcon}${prefix}caixa rara
${middleBorder}${menuItemIcon}${prefix}caixa lendaria
${middleBorder}${menuItemIcon}${prefix}presente @user <tipo>
${middleBorder}${menuItemIcon}${prefix}inv
${bottomBorder}

${menuTopBorder}
│ ⭐ REPUTAÇÃO & DENÚNCIAS
${middleBorder}
${middleBorder}${menuItemIcon}${prefix}rep + @user
${middleBorder}${menuItemIcon}${prefix}rep - @user
${middleBorder}${menuItemIcon}${prefix}rep @user
${middleBorder}${menuItemIcon}${prefix}toprep
${middleBorder}${menuItemIcon}${prefix}denunciar @user <motivo>
${middleBorder}${menuItemIcon}${prefix}denuncias
${bottomBorder}

${menuTopBorder}
│ 📸 MOMENTOS DO GRUPO
${middleBorder}
${middleBorder}${menuItemIcon}${prefix}salvarm
${middleBorder}${menuItemIcon}${prefix}moment
${middleBorder}${menuItemIcon}${prefix}m [número]
${middleBorder}${menuItemIcon}${prefix}apm [número]
${bottomBorder}

${menuTopBorder}
│ ${gamingMenuTitle}
${middleBorder}
${middleBorder}${menuItemIcon}${prefix}likeff
${middleBorder}${menuItemIcon}${prefix}infoff
${bottomBorder}
`;
}