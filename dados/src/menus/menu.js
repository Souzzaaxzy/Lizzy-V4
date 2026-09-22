/**
 * Menu principal.
 *
 * O texto é dividido em DUAS partes, por causa do "ler mais" do WhatsApp:
 *
 *   - `visible` — o CABEÇALHO + a PRIMEIRA CATEGORIA. É o que aparece na prévia,
 *     junto com a mídia (gif/foto/vídeo). Se a primeira categoria fosse para o
 *     "ler mais", a prévia ficaria só com o cabeçalho e o usuário não veria
 *     nenhum comando sem tocar em "ler mais".
 *   - `rest` — as demais categorias + o rodapé. Vai DEPOIS do prefixo invisível
 *     do "ler mais", então fica colapsado.
 *
 * A composição final é: `visible + lerMaisPrefix + rest`. Com o "ler mais"
 * desligado o prefixo é vazio, então o resultado é o menu inteiro.
 *
 * O bold é aplicado por `bold()` (ASCII → mathematical bold do Unicode) em vez de
 * caracteres literais no arquivo: a fonte fica legível/editável e a conversão é
 * determinística.
 */

/**
 * Converte ASCII para um estilo "bold" do Unicode.
 *
 * São DOIS estilos no layout (medidos nos caracteres do pedido):
 *   - `bold`        → MATHEMATICAL BOLD (A = U+1D400) — usado no cabeçalho;
 *   - `boldItalic`  → MATHEMATICAL BOLD ITALIC (A = U+1D468) — usado nos títulos
 *     das categorias.
 *
 * Converter por código (em vez de literais no arquivo) mantém a fonte legível e
 * editável, e a conversão é determinística. Os acentos e emojis passam intactos
 * (não têm equivalente nesses blocos).
 */
function converter(texto, baseMaiuscula, baseMinuscula, baseDigito) {
  let saida = '';
  for (const ch of String(texto)) {
    const c = ch.codePointAt(0);
    if (c >= 65 && c <= 90) saida += String.fromCodePoint(baseMaiuscula + (c - 65));
    else if (c >= 97 && c <= 122) saida += String.fromCodePoint(baseMinuscula + (c - 97));
    else if (baseDigito && c >= 48 && c <= 57) saida += String.fromCodePoint(baseDigito + (c - 48));
    else saida += ch;
  }
  return saida;
}

/** MATHEMATICAL BOLD (A = U+1D400, a = U+1D41A, 0 = U+1D7CE). */
export function bold(texto) {
  return converter(texto, 0x1D400, 0x1D41A, 0x1D7CE);
}

/** MATHEMATICAL BOLD ITALIC (A = U+1D468, a = U+1D482). Sem dígitos no bloco. */
export function boldItalic(texto) {
  return converter(texto, 0x1D468, 0x1D482, null);
}

const TOPO = (botName) => `╭━━━꧁༺ ✦ ${botName} ✦ ༻꧂━━━╮`;
const RODAPE_BLOCO = '╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯';
const FECHO = (botName) => `╰━━━꧁༺ 𓆩 ✦ ${botName} ✦ 𓆪 ༻꧂━━━╯`;

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

  // PRIMEIRA categoria: vai na parte VISÍVEL (junto com a mídia).
  const primeira = categoria(prefix, 'UTILIDADES', '⚙️', '𓆩', [
    ['🤖', 'menuia'], ['📥', 'menudown'], ['🛠️', 'ferramentas'], ['🖼️', 'menufig'],
  ]);

  // Demais categorias: ficam no "ler mais".
  const restante = [
    categoria(prefix, 'CRIAÇÃO', '🎨', '◇', ['menulogos', 'menuedits', 'alteradores']),
    categoria(prefix, 'COMUNIDADE', '🛡️', '❖', ['menumemb', 'menuadm', 'menudono', 'menubn']),
    categoria(prefix, 'JOGOS', '🎮', '⟢', [
      ['⚽', 'menufut'], ['🎮', 'menurpg'], ['💎', 'menuvip'], ['🎯', 'menugames'],
    ]),
  ].join('\n\n\n');

  const visible = `${header}\n\n\n${primeira}`;
  const rest = `${restante}\n\n\n${FECHO(botName)}`;

  return { visible, rest, full: `${visible}\n\n\n${rest}`, header };
}
