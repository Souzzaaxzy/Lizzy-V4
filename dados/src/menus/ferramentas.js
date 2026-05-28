export default async function menuFerramentas(prefix, botName = "MeuBot", userName = "Usuário", {
    header = `╔══════════════════════════════════════════════╗\n║              🤖 ${botName}              ║\n║              Olá, ${userName}!              ║\n╚══════════════════════════════════════════════╝`,
    menuTopBorder = "╭──────────────────────────────────────────────╮",
    bottomBorder = "╰──────────────────────────────────────────────╯",
    menuTitleIcon = "🍧ฺꕸ▸",
    menuItemIcon = "•.̇𖥨֗🍓⭟",
    separatorIcon = "❁",
    middleBorder = "│",
    nicknameMenuTitle = "📱 GERADOR DE NOMES & IDENTIDADE",
    captureMenuTitle = "🖼️ CAPTURAS & VISUALIZAÇÃO",
    linkMenuTitle = "🌐 LINKS & UPLOADS",
    securityMenuTitle = "🔒 SEGURANÇA",
    timeMenuTitle = "🕐 TEMPO & CLIMA",
    languageMenuTitle = "📚 DICIONÁRIO & TRADUÇÃO",
    reminderMenuTitle = "⏰ LEMBRETES & LISTAS"
} = {}) {
    return `${header}

${menuTopBorder}
│ ${nicknameMenuTitle}
${middleBorder}
${middleBorder} ${menuItemIcon}${prefix}gerarnick
${bottomBorder}

${menuTopBorder}
│ ${captureMenuTitle}
${middleBorder}
${middleBorder} ${menuItemIcon}${prefix}ssweb
${middleBorder} ${menuItemIcon}${prefix}qrcode <texto>
${middleBorder} ${menuItemIcon}${prefix}lerqr (responda imagem)
${bottomBorder}

${menuTopBorder}
│ 🧮 CALCULADORA
${middleBorder}
${middleBorder} ${menuItemIcon}${prefix}calc <expressão>
${middleBorder} ${menuItemIcon}${prefix}calc converter <valor> <de> <para>
${bottomBorder}

${menuTopBorder}
│ 🔮 HORÓSCOPO & MISTICISMO
${middleBorder}
${middleBorder} ${menuItemIcon}${prefix}horoscopo <signo>
${middleBorder} ${menuItemIcon}${prefix}signos
${bottomBorder}

${menuTopBorder}
│ 📝 NOTAS PESSOAIS
${middleBorder}
${middleBorder} ${menuItemIcon}${prefix}nota add <texto>
${middleBorder} ${menuItemIcon}${prefix}notas
${middleBorder} ${menuItemIcon}${prefix}nota ver <id>
${middleBorder} ${menuItemIcon}${prefix}nota del <id>
${middleBorder} ${menuItemIcon}${prefix}nota fixar <id>
${middleBorder} ${menuItemIcon}${prefix}nota buscar <termo>
${bottomBorder}

${menuTopBorder}
│ ${linkMenuTitle}
${middleBorder}
${middleBorder} ${menuItemIcon}${prefix}encurtalink
${middleBorder} ${menuItemIcon}${prefix}upload
${bottomBorder}

${menuTopBorder}
│ ${securityMenuTitle}
${middleBorder}
${middleBorder} ${menuItemIcon}${prefix}verificar <link>
${bottomBorder}

${menuTopBorder}
│ ${timeMenuTitle}
${middleBorder}
${middleBorder} ${menuItemIcon}${prefix}hora <cidade/país>
${middleBorder} ${menuItemIcon}${prefix}clima <cidade>
${bottomBorder}

${menuTopBorder}
│ ${languageMenuTitle}
${middleBorder}
${middleBorder} ${menuItemIcon}${prefix}dicionario
${middleBorder} ${menuItemIcon}${prefix}tradutor
${bottomBorder}

${menuTopBorder}
│ ${reminderMenuTitle}
${middleBorder}
${middleBorder} ${menuItemIcon}${prefix}lembrete
${middleBorder} ${menuItemIcon}${prefix}meuslembretes
${middleBorder} ${menuItemIcon}${prefix}apagalembrete
${middleBorder}
${middleBorder} ${menuTitleIcon} OUTROS ${menuTitleIcon}
${middleBorder} ${menuItemIcon}${prefix}aniversario
${middleBorder} ${menuItemIcon}${prefix}estatisticas
${bottomBorder}
`;
}
