export default async function menuDono(prefix, botName = "MeuBot", userName = "Usuário") {
    return `╭━━━〔 👑 ${botName} • 𝐃𝐎𝐍𝐎 〕━━━╮
┃ 👋 Olá, @${userName}
┃ 👑 Painel do Proprietário
┃ ⚙️ Controle total da Lizzy
╰━━━━━━━━━━━━━━━━━━━━━━╯


╭─❖ 📚 INÍCIO
│ 📖 ${prefix}tutorial
╰──────────────


╭─❖ 🤖 INTELIGÊNCIA ARTIFICIAL
│ 🔑 ${prefix}setgroq
│ 📋 Status: ${prefix}setgroq
╰──────────────


╭─❖ 🌌 REAÇÕES POR NOME
│ 😀 ${prefix}reacao
│ ➕ ${prefix}reacao add
│ ❌ ${prefix}reacao excluir
│ 🔄 ${prefix}reacao toggle
╰──────────────


╭─❖ 🤖 CONFIGURAÇÕES DO BOT
│ ⚡ ${prefix}prefixo
│ 📞 ${prefix}numerodono
│ 👤 ${prefix}nomedono
│ 🤖 ${prefix}nomebot
│ ⚙ ${prefix}configcmdnotfound
│ 💬 ${prefix}setcmdmsg
│ 🖼 ${prefix}fotobot
│ 🖼 ${prefix}fotomenu
│ 🎥 ${prefix}videomenu
│ 🎵 ${prefix}audiomenu
│ 📖 ${prefix}lermais
│ 🎨 ${prefix}personalizargrupo
│ 📸 ${prefix}fotoprefix
│ 🎥 ${prefix}videoprefix
╰──────────────


╭─❖ 🎨 DESIGN & APARÊNCIA
│ 🖌 ${prefix}designmenu
│ 📐 ${prefix}setborda
│ 📐 ${prefix}setbordafim
│ 📐 ${prefix}setbordameio
│ 🔹 ${prefix}setitem
│ ➖ ${prefix}setseparador
│ 📝 ${prefix}settitulo
│ 🏷 ${prefix}setheader
│ ♻ ${prefix}resetdesign
╰──────────────


╭─❖ ⚙️ AUTOMAÇÃO
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
╰──────────────


╭─❖ 🛠️ COMANDOS PERSONALIZADOS
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
╰──────────────


╭─❖ 🚫 LIMITAÇÃO
│ 🚷 ${prefix}cmdlimitar
│ ✅ ${prefix}cmddeslimitar
│ 📋 ${prefix}cmdlimites
╰──────────────


╭─❖ 🔒 BLOQUEIO NO PV
│ 🚫 ${prefix}blockmenupv
│ ✅ ${prefix}unblockmenupv
│ 🚫 ${prefix}blockcmdpv
│ ✅ ${prefix}unblockcmdpv
│ 📋 ${prefix}listblockpv
╰──────────────


╭─❖ 👥 USUÁRIOS
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
╰──────────────


╭─❖ 💰 ALUGUEL
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
╰──────────────


╭─❖ 🤖 SUB-BOTS
│ ➕ ${prefix}addsubbot
│ ❌ ${prefix}removesubbot
│ 📋 ${prefix}listarsubbots
│ 🔗 ${prefix}conectarsubbot
│ 🔑 ${prefix}gerarcodigo
╰──────────────


╭─❖ 💎 VIP
│ ➕ ${prefix}addcmdvip
│ ❌ ${prefix}removecmdvip
│ 📋 ${prefix}listcmdvip
│ 🔄 ${prefix}togglecmdvip
│ 📊 ${prefix}statsvip
│ 💎 ${prefix}menuvip
│ ℹ ${prefix}infovip
╰──────────────


╭─❖ ⚡ MANUTENÇÃO
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
╰──────────────


╭─❖ 📊 MONITORAMENTO
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
│ 💬 ${prefix}msgprefix
╰──────────────


╭─❖ 📡 TRANSMISSÕES
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
╰──────────────


╭─❖ 🎮 APIs GAMES
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
╰──────────────


╭─❖ 📈 SERVIÇOS SMM
│ 💰 ${prefix}smm saldo
│ 📋 ${prefix}smm servicos
│ 📦 ${prefix}smm pedido
│ 📊 ${prefix}smm status
│ 🔑 ${prefix}smm setkey
╰──────────────`;
}
