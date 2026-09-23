/**
 * Primitivas de layout dos menus.
 *
 * Concentra as caixas decoradas (`꧁༺ ✦ ༻꧂`) e a conversão de bold, para que
 * TODOS os menus usem o mesmo desenho sem duplicar string em 15 arquivos.
 *
 * O bold é aplicado por código (ASCII → mathematical bold do Unicode) em vez de
 * caracteres literais: a fonte fica legível/editável e a conversão é
 * determinística.
 */

/**
 * Converte ASCII para um estilo "bold" do Unicode.
 *
 * São DOIS estilos no layout (medidos nos caracteres do pedido):
 *   - `bold`        → MATHEMATICAL BOLD (A = U+1D400) — cabeçalho;
 *   - `boldItalic`  → MATHEMATICAL BOLD ITALIC (A = U+1D468) — títulos das
 *     categorias.
 *
 * Acentos e emojis passam intactos (não têm equivalente nesses blocos).
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

// ── Caixas ───────────────────────────────────────────────────────────────────

export const TOPO = (botName) => `╭━━━꧁༺ ✦ ${botName} ✦ ༻꧂━━━╮`;
export const RODAPE_BLOCO = '╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯';
export const FECHO = (botName) => `╰━━━꧁༺ 𓆩 ✦ ${botName} ✦ 𓆪 ༻꧂━━━╯`;

/**
 * Cabeçalho de um menu temático.
 *
 * @param {string} botName
 * @param {string} userName
 * @param {string} titulo  título do menu (ex.: 'IA'); vai em bold
 * @param {string} [emoji] emoji do menu, exibido junto do título
 * @param {string[]} [descricoes] linhas extras de descrição (viram `┃ texto`)
 */
export function cabecalho(botName, userName, titulo, emoji = '', descricoes = []) {
  const linhas = [
    TOPO(botName),
    `┃ 𖤐 𝐎𝐥á, @${userName}`,
    `┃ 〆 ${emoji ? `${emoji} ` : ''}${bold(titulo)}`,
    ...descricoes.map((d) => `┃ ${d}`),
    '╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━━━╯',
  ];
  return linhas.join('\n');
}

/**
 * Abre uma categoria. O emoji aparece dos dois lados do título, como no layout.
 * O filler `ㅤ` (U+3164) mantém o respiro interno da caixa.
 */
export function abrirCategoria(titulo, emoji = '') {
  const miolo = emoji ? `${emoji} ${boldItalic(titulo)} ${emoji}` : boldItalic(titulo);
  return `╭━━━꧁༺ ㅤ${miolo}ㅤ ༻꧂━━━╮`;
}

/** Fecha uma categoria (usado entre as categorias). */
export const fecharCategoria = () => RODAPE_BLOCO;

/**
 * Uma categoria inteira: abertura + linhas + fechamento.
 *
 * @param {string[]} linhas corpo já pronto (cada uma sem o `┃ ` inicial)
 */
export function categoria(titulo, emoji, linhas) {
  return [abrirCategoria(titulo, emoji), ...linhas, RODAPE_BLOCO].join('\n');
}

/**
 * Linha de comando com marcador e emoji opcional.
 * O filler `ㅤ` alinha os dois casos (com e sem emoji).
 */
export function item(prefix, comando, { marcador = '𓆩', emoji = null } = {}) {
  const meio = emoji ? `${emoji} ㅤ` : 'ㅤ';
  return `┃        ${marcador} ${meio}${prefix}${comando}`;
}

export default {
  bold, boldItalic, TOPO, RODAPE_BLOCO, FECHO, cabecalho,
  abrirCategoria, fecharCategoria, categoria, item,
};
