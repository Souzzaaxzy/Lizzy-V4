/**
 * Modo 18 — liga/desliga o **menu +18** (`!menu18`) e os comandos dele.
 *
 * O flag fica no JSON do grupo (`modo18`, booleano), ao lado do `modolite`, e é
 * alterado pelo comando `!modo18` (adm do grupo). Quando DESLIGADO, os comandos
 * do menu +18 não respondem; quando LIGADO, respondem.
 *
 * ## Contrato do estado (consistente com o `modolite`)
 * A **ausência** do flag não libera nada: `isModo18Ativo()` só devolve `true`
 * quando `modo18 === true`. Grupo sem o campo ⇒ menu +18 bloqueado. O
 * `!modo18` grava `true`/`false` explícito (e mantém um `modo18Off` para
 * registrar a escolha, igual ao `modoliteOff`).
 *
 * ## Exclusividade com o `!modolite`
 * O modo lite filtra justamente o conteúdo picante; deixar os dois ligados no
 * mesmo grupo seria contraditório. Por isso `!modo18` e `!modolite` são
 * mutuamente exclusivos — quem guarda essa regra é o `index.js` (nos dois
 * `case`), porque depende do estado do grupo e do fluxo de resposta. Aqui fica
 * só a definição da lista de comandos e a leitura do flag.
 *
 * Mesma lista que o `blockPv` já usa para o menu18 (`menuCommandsMap.menu18`),
 * que é a fonte dos comandos +18 do projeto.
 */

/** Comandos que o menu +18 expõe e que o `!modo18` liga/desliga. */
export const MENU18_COMMANDS = Object.freeze([
  // O próprio menu e os aliases dele.
  'menu18', 'menuplaquinha', 'menuplaquinhas', 'menupraq',
  // Categoria PLAQUINHA.
  'plaq1', 'plaq2', 'plaq3', 'plaq4', 'plaq5',
  'plaq6', 'plaq7', 'plaq8', 'plaq9', 'plaq10',
  // Categoria BRINCADEIRAS.
  'vab18', 'eununca18', 'hotseat',
]);

const MENU18_SET = new Set(MENU18_COMMANDS);

/** `true` se o comando pertence ao menu +18 (`!menu18` + comandos dele). */
export function isMenu18Command(command) {
  if (typeof command !== 'string') return false;
  return MENU18_SET.has(command);
}

/**
 * O menu +18 está liberado para este grupo?
 *
 * Exige `modo18 === true` — a ausência do campo NÃO libera (o menu +18 é
 * opt-in, ao contrário do modo lite global).
 */
export function isModo18Ativo(groupData) {
  return groupData?.modo18 === true;
}
