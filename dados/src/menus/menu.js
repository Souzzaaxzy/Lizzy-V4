export default async function menu(prefix, botName = "MeuBot", userName = "Usuário", {
    header = `╔══════════════════════════════════════════════╗\n║              🤖 ${botName}              ║\n║              Olá, ${userName}!              ║\n╚══════════════════════════════════════════════╝`,
    menuTopBorder = "╭──────────────────────────────────────────────╮",
    bottomBorder = "╰──────────────────────────────────────────────╯",
    menuTitleIcon = "🍧ฺꕸ▸",
    menuItemIcon = "•.̇𖥨֗🍓⭟",
    separatorIcon = "❁",
    middleBorder = "│"
} = {}) {
    return `${header}

${menuTopBorder}
│ 🌟 MENU PRINCIPAL
${middleBorder}
${middleBorder} ${menuItemIcon}${prefix}menuia
${middleBorder} ${menuItemIcon}${prefix}menudown
${middleBorder} ${menuItemIcon}${prefix}menulogos
${middleBorder} ${menuItemIcon}${prefix}menuedits
${middleBorder} ${menuItemIcon}${prefix}menuadm
${middleBorder} ${menuItemIcon}${prefix}menubn
${middleBorder} ${menuItemIcon}${prefix}menudono
${middleBorder} ${menuItemIcon}${prefix}menumemb
${middleBorder} ${menuItemIcon}${prefix}ferramentas
${middleBorder} ${menuItemIcon}${prefix}menufig
${middleBorder} ${menuItemIcon}${prefix}alteradores
${middleBorder} ${menuItemIcon}${prefix}menurpg
${middleBorder} ${menuItemIcon}${prefix}menuvip
${bottomBorder}`;
}
