// Ponto de entrada para paineis Pterodactyl/HostSquare.
//
// ## Por que este arquivo existe
//
// O Startup Command do painel roda:
//
//     /usr/local/bin/ts-node --esm "/home/container/${MAIN_FILE}"
//
// A comparacao dele e' `[[ "${MAIN_FILE}" == "*.js" ]]` -- com ASPAS, o que
// faz a comparacao ser LITERAL em vez de glob. Resultado medido: o ramo do
// `node` NUNCA e' escolhido e o painel sempre executa o `ts-node`.
//
// Como o nome do arquivo tem limite de 16 caracteres no painel, este `app.js`
// da um caminho curto ao painel e delega para o start real do bot.
//
// ## Requisito: typescript 5.x
//
// O `ts-node@10.9.2` (global do painel) NAO e' compativel com o TypeScript 7,
// que e' o que o `npm install typescript` traz hoje. Com o TS 7 ele morre com
// `Cannot read properties of undefined (reading 'fileExists')`.
//
// Por isso o `typescript` esta' fixado em 5.6.3 no `package.json` (e o
// `package-lock.json`). NAO troque por `typescript` sem versao.
import('./dados/src/.scripts/start.js').catch((e) => {
  console.error('Falha ao iniciar o bot:', e?.message || e);
  process.exit(1);
});
