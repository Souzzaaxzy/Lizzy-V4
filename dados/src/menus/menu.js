/**
 * Menu principal.
 *
 * O texto é dividido em DUAS partes, por causa do "ler mais" do WhatsApp:
 *
 *   - `visible` — APENAS o CABEÇALHO. É o que aparece na prévia, junto com a
 *     mídia (gif/foto/vídeo).
 *   - `rest` — TODAS as categorias (UTILIDADES, CRIAÇÃO, COMUNIDADE, JOGOS) + o
 *     fecho. Vai DEPOIS do prefixo invisível do "ler mais", então fica colapsado.
 *
 * A composição final é: `visible + lerMaisPrefix + rest`. Com o "ler mais"
 * desligado o prefixo é vazio, então o resultado é o menu inteiro.
 *
 * O bold é aplicado por `bold()`/`boldItalic()` (ASCII → mathematical bold do
 * Unicode) em vez de caracteres literais no arquivo: a fonte fica legível e
 * editável, e a conversão é determinística.
 */

import { bold, boldItalic, TOPO, RODAPE_BLOCO, FECHO } from './layout.js';

// Reexporta para quem importava `bold`/`boldItalic` do menu.js continuar
// funcionando (o módulo passou a ser o `layout.js`, fonte única).
export { bold, boldItalic };

/**
 * Monta uma categoria. `comandos` aceita `'nome'` (sem emoji) ou
 * `['emoji', 'nome']` — cada linha leva o emoji e o marcador da categoria.
 */
function categoria(prefix, titulo, emoji, marcador, comandos) {
  const linhas = comandos.map((c) => {
    const [ico, nome] = Array.isArray(c) ? c : [null, c];
    // O filler `ㅤ` (U+3164) faz o alinhamento do layout: com emoji fica
    // `marcador emoji ㅤcmd`; sem emoji fica `marcador ㅤcmd` (não sobra espaço).
    const meio = ico ? `${ico} ㅤ` : 'ㅤ';
    return `┃        ${marcador} ${meio}${prefix}${nome}`;
  });
  return [
    `╭━━━꧁༺ ㅤ${emoji} ${boldItalic(titulo)} ${emoji}ㅤ ༻꧂━━━╮`,
    ...linhas,
    RODAPE_BLOCO,
  ].join('\n');
}

export default async function menu(prefix, botName = 'MeuBot', userName = 'Usuário', {
  userCargo = 'Membro',
  userVip = false,
  ping = 0,
} = {}) {
  const header = `${TOPO(botName)}
┃ 𖤐 𝐎𝐥á, ${userName}
┃ 〆 𝐂𝐚𝐫𝐠𝐨: ${bold(userCargo)}
┃ ◈ 𝐕𝐈𝐏: ${bold(userVip ? 'Sim' : 'Não')}
┃ ⌁ 𝐏𝐢𝐧𝐠: ${bold(ping)}𝐦𝐬
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━━━╯`;

  // TODAS as categorias ficam no `rest` (abaixo do "ler mais"). A primeira é
  // UTILIDADES, como no layout pedido.
  const restante = [
    categoria(prefix, 'UTILIDADES', '⚙️', '𓆩', [
      ['🤖', 'menuia'], ['📥', 'menudown'], ['🛠️', 'ferramentas'], ['🖼️', 'menufig'],
    ]),
    categoria(prefix, 'CRIAÇÃO', '🎨', '◇', ['menulogos', 'menuedits', 'alteradores']),
    categoria(prefix, 'COMUNIDADE', '🛡️', '❖', ['menumemb', 'menuadm', 'menudono', 'menubn', 'menu18']),
    categoria(prefix, 'JOGOS', '🎮', '⟢', [
      ['⚽', 'menufut'], ['🎮', 'menurpg'], ['💎', 'menuvip'], ['🎯', 'menugames'],
    ]),
  ].join('\n\n\n');

  // `visible` = SÓ o cabeçalho (a prévia, junto com a mídia).
  const visible = header;
  const rest = `${restante}\n\n\n${FECHO(botName)}`;

  return { visible, rest, full: `${visible}\n\n\n${rest}`, header };
}
