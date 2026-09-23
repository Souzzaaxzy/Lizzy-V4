import { boldItalic } from './layout.js';

export default async function menuDono(prefix, botName = "MeuBot", userName = "Usuário") {
    return `╭━━━꧁༺ ✦ ${botName} ✦ ༻꧂━━━╮
┃ 𖤐 𝐎𝐥á, @${userName}
┃ 👑 Área do dono
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ📚 ${boldItalic('INÍCIO')} 📚ㅤ ༻꧂━━━╮
│ 📖 ${prefix}tutorial
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ⚡ ${boldItalic('FIGBAN')} ⚡ㅤ ༻꧂━━━╮
│ 🚫 ${prefix}setfigban
│ 🗑️ ${prefix}delfigban
│ 📋 ${prefix}listfigban
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ🤖 ${boldItalic('INTELIGÊNCIA ARTIFICIAL')} 🤖ㅤ ༻꧂━━━╮
│ 🔑 ${prefix}key
│ 📋 Status: ${prefix}key
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ🌌 ${boldItalic('REAÇÕES POR NOME')} 🌌ㅤ ༻꧂━━━╮
│ 😀 ${prefix}reacao
│ ➕ ${prefix}reacao add
│ ❌ ${prefix}reacao excluir
│ 🔄 ${prefix}reacao toggle
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ🤖 ${boldItalic('CONFIGURAÇÕES DO BOT')} 🤖ㅤ ༻꧂━━━╮
│ ⚡ ${prefix}prefixo
│ 📞 ${prefix}numerodono
│ 👤 ${prefix}nomedono
│ 📤 ${prefix}pv
│ 🤖 ${prefix}nomebot
│ ⚙ ${prefix}configcmdnotfound
│ 💬 ${prefix}setcmdmsg
│ 🖼 ${prefix}fotobot
│ 🖼 ${prefix}midiamenu
│ 🎵 ${prefix}audiomenu
│ 📖 ${prefix}lermais
│ 🎨 ${prefix}personalizargrupo
│ 📸 ${prefix}midiaprefix
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ🎨 ${boldItalic('DESIGN & APARÊNCIA')} 🎨ㅤ ༻꧂━━━╮
│ 🖌 ${prefix}designmenu
│ 📐 ${prefix}setborda
│ 📐 ${prefix}setbordafim
│ 📐 ${prefix}setbordameio
│ 🔹 ${prefix}setitem
│ ➖ ${prefix}setseparador
│ 📝 ${prefix}settitulo
│ 🏷 ${prefix}setheader
│ ♻ ${prefix}resetdesign
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ⚙️ ${boldItalic('AUTOMAÇÃO')} ⚙️ㅤ ༻꧂━━━╮
│ ➕ ${prefix}addauto
│ 🖼 ${prefix}addautomidia
│ 📋 ${prefix}listauto
│ ❌ ${prefix}delauto
│ 😀 ${prefix}addreact
│ 📋 ${prefix}listreact
│ ❌ ${prefix}delreact
│ ➕ ${prefix}addnopref
│ 📋 ${prefix}listnopref
│ ❌ ${prefix}delnopref
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ🛠️ ${boldItalic('COMANDOS PERSONALIZADOS')} 🛠️ㅤ ༻꧂━━━╮
│ ➕ ${prefix}addcmd
│ 🖼 ${prefix}addcmdmidia
│ 📋 ${prefix}listcmd
│ ❌ ${prefix}delcmd
│ 🧪 ${prefix}testcmd
│ 🔗 ${prefix}addalias
│ 📋 ${prefix}listalias
│ ❌ ${prefix}delalias
│ 🚫 ${prefix}addblackglobal
│ 📋 ${prefix}listblackglobal
│ ✅ ${prefix}rmblackglobal
│ ➕ ${prefix}addcase
│ ❌ ${prefix}delcase
│ 🎬 ${prefix}setgif
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ🚫 ${boldItalic('LIMITAÇÃO')} 🚫ㅤ ༻꧂━━━╮
│ 🚷 ${prefix}cmdlimitar
│ ✅ ${prefix}cmddeslimitar
│ 📋 ${prefix}cmdlimites
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ🔒 ${boldItalic('BLOQUEIO NO PV')} 🔒ㅤ ༻꧂━━━╮
│ 🚫 ${prefix}blockmenupv
│ ✅ ${prefix}unblockmenupv
│ 🚫 ${prefix}blockcmdpv
│ ✅ ${prefix}unblockcmdpv
│ 📋 ${prefix}listblockpv
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ👥 ${boldItalic('USUÁRIOS')} 👥ㅤ ༻꧂━━━╮
│ 👑 ${prefix}addsubdono
│ ❌ ${prefix}delsubdono
│ 📋 ${prefix}listasubdonos
│ 💎 ${prefix}addpremium
│ ❌ ${prefix}delpremium
│ 📋 ${prefix}listprem
│ ♻ ${prefix}resetgold
│ ➕ ${prefix}addindicacao
│ 🏆 ${prefix}topindica
│ ❌ ${prefix}delindicacao
│ 🚫 ${prefix}bangp
│ ✅ ${prefix}unbangp
│ 📋 ${prefix}listbangp
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ🔐 ${boldItalic('PERMISSÕES SUBDONO')} 🔐ㅤ ༻꧂━━━╮
│ ➕ ${prefix}grantsubcmd
│ ❌ ${prefix}delsubcmd
│ 📋 ${prefix}listsubcmd
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ💰 ${boldItalic('ALUGUEL')} 💰ㅤ ༻꧂━━━╮
│ ⚙ ${prefix}modoaluguel
│ ➕ ${prefix}addaluguel
│ 🔑 ${prefix}gerarcod
│ 📋 ${prefix}listaraluguel
│ ℹ ${prefix}infoaluguel
│ ⏳ ${prefix}esternaluguel
│ ❌ ${prefix}removeraluguel
│ 📜 ${prefix}listaluguel
│ 🧹 ${prefix}limparaluguel
│ 🎁 ${prefix}dayfree
│ 💵 ${prefix}setdiv
│ 📢 ${prefix}divulgar
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ🤖 ${boldItalic('SUB-BOTS')} 🤖ㅤ ༻꧂━━━╮
│ ➕ ${prefix}addsubbot
│ ❌ ${prefix}removesubbot
│ 📋 ${prefix}listarsubbots
│ 🔗 ${prefix}conectarsubbot
│ 🔑 ${prefix}gerarcodigo
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ💎 ${boldItalic('VIP')} 💎ㅤ ༻꧂━━━╮
│ ➕ ${prefix}addcmdvip
│ ❌ ${prefix}removecmdvip
│ 📋 ${prefix}listcmdvip
│ 🔄 ${prefix}togglecmdvip
│ 📊 ${prefix}statsvip
│ 💎 ${prefix}menuvip
│ ℹ ${prefix}infovip
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ⚡ ${boldItalic('MANUTENÇÃO')} ⚡ㅤ ༻꧂━━━╮
│ 🔄 ${prefix}atualizar
│ ♻ ${prefix}reiniciar
│ ➕ ${prefix}entrar
│ 🚪 ${prefix}sairgp
│ 👑 ${prefix}seradm
│ 👤 ${prefix}sermembro
│ 🚫 ${prefix}blockcmdg
│ ✅ ${prefix}unblockcmdg
│ 🚫 ${prefix}blockuserg
│ ✅ ${prefix}unblockuserg
│ 📋 ${prefix}listblocks
│ 🛡 ${prefix}antibanmarcar
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ📊 ${boldItalic('MONITORAMENTO')} 📊ㅤ ༻꧂━━━╮
│ 📋 ${prefix}listagp
│ 🚫 ${prefix}antipv
│ 🚫 ${prefix}antipv2
│ 🚫 ${prefix}antipv3
│ 🚫 ${prefix}antipv4
│ 💬 ${prefix}antipvmsg
│ 🚫 ${prefix}antispamcmd
│ 👁 ${prefix}viewmsg
│ 📂 ${prefix}cases
│ 🔍 ${prefix}getcase
│ 🌙 ${prefix}modoliteglobal
│ 🧠 ${prefix}iaclear
│ 🧹 ${prefix}limpardb
│ 📊 ${prefix}limparrankg
│ ♻ ${prefix}reviverqr
│ 💣 ${prefix}nuke
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ📡 ${boldItalic('TRANSMISSÕES')} 📡ㅤ ༻꧂━━━╮
│ 📢 ${prefix}tm
│ 💬 ${prefix}tm2
│ 📊 ${prefix}statustm
│ 📥 ${prefix}inscrevertm
│ ➕ ${prefix}divdono add
│ ❌ ${prefix}divdono rem
│ 📋 ${prefix}divdono list
│ 💬 ${prefix}divdono msg
│ 📤 ${prefix}divdono send
│ ⏰ ${prefix}divdono time
│ 📊 ${prefix}divdono status
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ🎮 ${boldItalic('APIs GAMES')} 🎮ㅤ ༻꧂━━━╮
│ 🔑 ${prefix}keyff
│ 🔑 ${prefix}keyvalorant
│ 🔑 ${prefix}keycr
│ 🔑 ${prefix}keybs
│ 🔑 ${prefix}keyroblox
│ 🔑 ${prefix}keypubg
│ ❌ ${prefix}delkeyff
│ ❌ ${prefix}delkeyvalorant
│ ❌ ${prefix}delkeycr
│ ❌ ${prefix}delkeybs
│ ❌ ${prefix}delkeyroblox
│ ❌ ${prefix}delkeypubg
│ 📋 ${prefix}listkeys
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ📈 ${boldItalic('SERVIÇOS SMM')} 📈ㅤ ༻꧂━━━╮
│ 💰 ${prefix}smm saldo
│ 📋 ${prefix}smm servicos
│ 📦 ${prefix}smm pedido
│ 📊 ${prefix}smm status
│ 🔑 ${prefix}smm setkey
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ👻 ${boldItalic('MENSAGENS INVISÍVEIS')} 👻ㅤ ༻꧂━━━╮
│ 📦 ${prefix}raja
│    Mostra a mensagem e a quantidade salvas
│ 💾 ${prefix}setmsgraja <qtd> <texto>
│    Salva a mensagem do raja (global)
│ 🚀 ${prefix}rajar
│    Dispara a mensagem salva
│ 👻 ${prefix}msghost @alvo [texto]
│    Apaga o comando e envia só ao alvo
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭─────────────────╮
╰─────────────────╯
`;
}
