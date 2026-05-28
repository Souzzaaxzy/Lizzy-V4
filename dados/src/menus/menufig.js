async function menuSticker(prefix, botName = "MeuBot", userName = "Usuário", {
    header = `╔══════════════════════════════════════════════╗\n║              🤖 ${botName}              ║\n║              Olá, ${userName}!              ║\n╚══════════════════════════════════════════════╝`,
    menuTopBorder = "╭──────────────────────────────────────────────╮",
    bottomBorder = "╰──────────────────────────────────────────────╯",
    menuTitleIcon = "🍧ฺꕸ▸",
    menuItemIcon = "•.̇𖥨֗🍓⭟",
    separatorIcon = "❁",
    middleBorder = "│",
    createStickerMenuTitle = "🎨 CRIAÇÃO DE FIGURINHAS",
    managementMenuTitle = "⚙️ GERENCIAMENTO DE FIGURINHAS"
} = {}) {
    return `${header}

${menuTopBorder}
│ ${createStickerMenuTitle}
${middleBorder}
${middleBorder} ${menuItemIcon}${prefix}emojimix
${middleBorder} ${menuItemIcon}${prefix}ttp
${middleBorder} ${menuItemIcon}${prefix}attp
${middleBorder} ${menuItemIcon}${prefix}sticker
${middleBorder} ${menuItemIcon}${prefix}sticker2
${middleBorder} ${menuItemIcon}${prefix}sbg
${middleBorder} ${menuItemIcon}${prefix}sfundo
${middleBorder} ${menuItemIcon}${prefix}qc
${bottomBorder}

${menuTopBorder}
│ ${managementMenuTitle}
${middleBorder}
${middleBorder} ${menuItemIcon}${prefix}figualeatoria
${middleBorder} ${menuItemIcon}${prefix}figurinhas
${middleBorder} ${menuItemIcon}${prefix}rename
${middleBorder} ${menuItemIcon}${prefix}rgtake
${middleBorder} ${menuItemIcon}${prefix}take
${middleBorder} ${menuItemIcon}${prefix}toimg
${middleBorder} ${menuItemIcon}${prefix}brat
${middleBorder} ${menuItemIcon}${prefix}bratvid
${bottomBorder}
`;
}
export default menuSticker;
