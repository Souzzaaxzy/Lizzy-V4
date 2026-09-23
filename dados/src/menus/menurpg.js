import { boldItalic } from './layout.js';

export default async function menuRpg(prefix, botName = "MeuBot", userName = "Usuário") {
    return `╭━━━꧁༺ ✦ ${botName} ✦ ༻꧂━━━╮
┃ 𖤐 𝐎𝐥á, @${userName}
┃ ⚔️ Aventura e progressão
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ👤 ${boldItalic('PERFIL & STATUS')} 👤ㅤ ༻꧂━━━╮
│ 📜 ${prefix}perfilrpg
│ 💰 ${prefix}carteira
│ 🏆 ${prefix}toprpg
│ 🌎 ${prefix}rankglobal
│ ⭐ ${prefix}ranklvl
│ 🎒 ${prefix}inv
│ ⚔️ ${prefix}equipamentos
│ 🏅 ${prefix}conquistas
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ🌟 ${boldItalic('EVOLUÇÃO & PRESTIGE')} 🌟ㅤ ༻꧂━━━╮
│ ⬆️ ${prefix}evoluir
│ 🔥 ${prefix}prestige
│ 🔥 ${prefix}streak
│ 🎁 ${prefix}reivindicar
│ ⚡ ${prefix}speedup
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ💰 ${boldItalic('ECONOMIA & FINANÇAS')} 💰ㅤ ༻꧂━━━╮
│ 🏦 ${prefix}dep <valor|all>
│ 💸 ${prefix}sacar <valor|all>
│ 💳 ${prefix}pix @user <valor>
│ 🛒 ${prefix}loja
│ 🛍️ ${prefix}comprar <item>
│ 📦 ${prefix}vender <item> <qtd>
│ 💼 ${prefix}vagas
│ 👷 ${prefix}emprego <vaga>
│ 🚪 ${prefix}demitir
│ 🧬 ${prefix}habilidades
│ 📅 ${prefix}desafiosemanal
│ 🗓️ ${prefix}desafiomensal
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ📈 ${boldItalic('INVESTIMENTOS')} 📈ㅤ ༻꧂━━━╮
│ 📊 ${prefix}investir
│ 📈 ${prefix}investir <ação> <qtd>
│ 💹 ${prefix}sell <ação> <qtd>
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ🎰 ${boldItalic('CASSINO & APOSTAS')} 🎰ㅤ ༻꧂━━━╮
│ 🎲 ${prefix}dados <valor>
│ 🪙 ${prefix}coinflip <cara|coroa> <valor>
│ 🚀 ${prefix}crash <valor>
│ 🎰 ${prefix}slots <valor>
│ 💰 ${prefix}apostar <valor>
│ 🎯 ${prefix}roleta <valor> <cor>
│ 🃏 ${prefix}blackjack <valor>
│ 🎟️ ${prefix}loteria
│ 🛒 ${prefix}loteria comprar <qtd>
│ 🐎 ${prefix}corrida <valor> <cavalo>
│ 🔨 ${prefix}leilao
│ 💎 ${prefix}topriqueza
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ🎯 ${boldItalic('ATIVIDADES DIÁRIAS')} 🎯ㅤ ༻꧂━━━╮
│ 🎁 ${prefix}diario
│ 💼 ${prefix}work
│ ⛏️ ${prefix}mine
│ 🎣 ${prefix}fish
│ 📦 ${prefix}coletar
│ 🌾 ${prefix}colher
│ 🏹 ${prefix}caçar
│ 🌱 ${prefix}plantar <planta>
│ 🌿 ${prefix}cultivar <planta>
│ 🏡 ${prefix}plantacao
│ 🍳 ${prefix}cook <receita>
│ 📖 ${prefix}receitas
│ 🥕 ${prefix}ingredientes
│ 🍖 ${prefix}eat <comida>
│ 💵 ${prefix}vendercomida <item>
│ 🌱 ${prefix}sementes
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ🗺️ ${boldItalic('AVENTURA & EXPLORAÇÃO')} 🗺️ㅤ ༻꧂━━━╮
│ 🌎 ${prefix}explore
│ 🏰 ${prefix}masmorra
│ 👹 ${prefix}bossrpg
│ 🎉 ${prefix}eventos
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ🏰 ${boldItalic('DUNGEONS & RAIDS')} 🏰ㅤ ༻꧂━━━╮
│ 📜 ${prefix}dungeon
│ 🏗️ ${prefix}dungeon criar <tipo>
│ 🚪 ${prefix}dungeon entrar <id>
│ ⚔️ ${prefix}dungeon iniciar
│ 🚶 ${prefix}dungeon sair
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ⚔️ ${boldItalic('CLASSES & PROFISSÕES')} ⚔️ㅤ ༻꧂━━━╮
│ 📚 ${prefix}class
│ 🛡️ ${prefix}class <nome>
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ🏠 ${boldItalic('HOUSING')} 🏠ㅤ ༻꧂━━━╮
│ 🏡 ${prefix}casa
│ 🏠 ${prefix}casa comprar <tipo>
│ 📦 ${prefix}casa coletar
│ 🎨 ${prefix}casa decorar <item>
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ🛒 ${boldItalic('MERCADO')} 🛒ㅤ ༻꧂━━━╮
│ 🔨 ${prefix}auction
│ 💰 ${prefix}auction vender <item> <preço>
│ 🛍️ ${prefix}auction comprar <nº>
│ 📦 ${prefix}auction meus
│ ❌ ${prefix}auction cancelar <nº>
│
│ 🌐 MERCADO GERAL
│ 🏪 ${prefix}mercado
│ 📋 ${prefix}listar <item> <preço>
│ 🛒 ${prefix}cmerc <nº>
│ 📜 ${prefix}meusan
│ ❌ ${prefix}cancelar <nº>
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ⚔️ ${boldItalic('COMBATE & BATALHAS')} ⚔️ㅤ ༻꧂━━━╮
│ ⚔️ ${prefix}duelrpg @user
│ 🏟️ ${prefix}arena
│ 🏆 ${prefix}torneio
│ 🥷 ${prefix}assaltar @user
│ 💀 ${prefix}crime
│ ⚔️ ${prefix}guerra
│ 🎯 ${prefix}desafio
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ🔨 ${boldItalic('CRAFTING & EQUIPAMENTOS')} 🔨ㅤ ༻꧂━━━╮
│ 🔥 ${prefix}forge <item>
│ ✨ ${prefix}enchant
│ 🗑️ ${prefix}dismantle <item>
│ 🔧 ${prefix}reparar <item>
│ ⛏️ ${prefix}materiais
│ 💰 ${prefix}precos
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ💝 ${boldItalic('SOCIAL & RELACIONAMENTOS')} 💝ㅤ ༻꧂━━━╮
│ 💍 ${prefix}casar @user
│ 💔 ${prefix}divorciar
│ ❤️ ${prefix}namorar @user
│ ❌ ${prefix}terminar
│ 💑 ${prefix}relacionamento
│ 🏆 ${prefix}casais
│ 🤗 ${prefix}abracarrpg @user
│ 💋 ${prefix}beijarrpg @user
│ 👊 ${prefix}baterrpg @user
│ 🛡️ ${prefix}proteger @user
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ👨‍👩‍👧 ${boldItalic('FAMÍLIA & ADOÇÃO')} 👨‍👩‍👧ㅤ ༻꧂━━━╮
│ 👪 ${prefix}familia
│ 👶 ${prefix}adotaruser @user
│ ❌ ${prefix}deserdar @user
│ 🌳 ${prefix}arvore
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ🏰 ${boldItalic('CLÃ & COMUNIDADE')} 🏰ㅤ ༻꧂━━━╮
│ 🏰 ${prefix}criarcla <nome>
│ 📜 ${prefix}cla
│ ➕ ${prefix}convidar @user
│ 🚪 ${prefix}sair
│ ✅ ${prefix}aceitarconvite
│ ❌ ${prefix}recusarconvite
│ 🗑️ ${prefix}expulsar @user
│ 🚫 ${prefix}rmconvite @user
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ📜 ${boldItalic('MISSÕES & CONQUISTAS')} 📜ㅤ ༻꧂━━━╮
│ 📋 ${prefix}missoes
│ 🏅 ${prefix}conquistas
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ🐾 ${boldItalic('PETS & COMPANHEIROS')} 🐾ㅤ ༻꧂━━━╮
│ 🐕 ${prefix}pets
│ 🐾 ${prefix}adotar <pet>
│ 🍖 ${prefix}feed <nº>
│ 🏋️ ${prefix}train <nº>
│ 🌟 ${prefix}evolve <nº>
│ ⚔️ ${prefix}petbattle <nº>
│ ✏️ ${prefix}renamepet <nº> <nome>
│ 🎲 ${prefix}petbet <valor> <nº> @user
│ 🎒 ${prefix}equippet
│ 🚫 ${prefix}unequippet
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ⭐ ${boldItalic('REPUTAÇÃO & FAMA')} ⭐ㅤ ༻꧂━━━╮
│ ⭐ ${prefix}rep
│ 🗳️ ${prefix}vote @user
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ💎 ${boldItalic('LOJA PREMIUM')} 💎ㅤ ༻꧂━━━╮
│ 💎 ${prefix}lojapremium
│ 🛒 ${prefix}comprarpremium <item>
│ 🚀 ${prefix}boost
│ 🏠 ${prefix}propriedades
│ 📜 ${prefix}cprop <id>
│ 🏡 ${prefix}cprops
│ 💰 ${prefix}tributos
│ 📊 ${prefix}meustats
│ 🎁 ${prefix}doar <valor>
│ 🎁 ${prefix}presente @user <item>
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ🔧 ${boldItalic('ADMIN RPG')} 🔧ㅤ ༻꧂━━━╮
│ 👑 ${prefix}rpgadd @user <valor>
│ 👑 ${prefix}rpgremove @user <valor>
│ ⭐ ${prefix}rpgsetlevel @user <nivel>
│ 🎒 ${prefix}rpgadditem @user <item> <qtd>
│ 🗑️ ${prefix}rpgremoveitem
│ 🔄 ${prefix}rpgresetplayer
│ 💥 ${prefix}rpgresetglobal confirmar
│ 👶 ${prefix}resetadot @user
│ 📊 ${prefix}rpgstats
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯

╭─────────────────╮
╰─────────────────╯`;
}
