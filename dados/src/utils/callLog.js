/**
 * O log do sistema de chamada (`!callp` / `!vozp`) — limpo e com o que importa.
 *
 * ## Por que existe
 *
 * O `lizzy-call` fala muito: cada stanza sinalizada, cada `ack` de keepalive
 * (`relaylatency`, `peer_state`), cada estágio do relay, o estado da call a cada
 * mudança… Misturado com o resto do bot, o resultado fica ilegível — e o que
 * interessa (a call subiu? a mídia ficou pronta? por que caiu?) se perde.
 *
 * Este módulo é o **único** caminho do log da chamada para o console.
 *
 * ## Duas regras
 *
 * 1. **Ruído sai de vez.** `sinalização ->` (uma por stanza), `ack de
 *    relaylatency`/`peer_state` sem erro (keepalive) e os estágios repetitivos do
 *    relay não aparecem.
 * 2. **Repetição é colapsada.** A mesma linha seguida N vezes sai uma vez, com
 *    `(xN)`. Sem isso, um roster estável imprime a cada atualização.
 *
 * O que sobra é o que responde "onde parou": subida, prontidão da mídia, roster,
 * queda, erro e os estágios decisivos do relay.
 *
 * Módulo **puro**: recebe a linha e devolve o que fazer; quem escreve é o
 * chamador. Testável sem console nem processo.
 */

/** Prefixo único, para o log da chamada ser reconhecível e filtrável. */
export const PREFIXO = '📞';

/** Trechos que marcam ruído. Testados com `includes` — basta um pedaço estável. */
export const RUIDO = [
  'sinalização ->',          // uma por stanza; sem valor individual
  'ack trouxe group_info',   // o roster logo abaixo já diz
  'enc_rekey cifrado',       // detalhe de crypto
  'epoch de chave tx=',      // o "epoch NAO aplicado" é que importa
  'stun_alloc_visto',        // estágio repetitivo
  'transporte_iniciando',    // o "conexao_aberta/falhou" é que importa
  'relay_list_recebida',
  'captura sem ponteiro',
  'midia: engine criou',     // o "midia PRONTA" é que importa
];

/** Um `ack` sem erro é rotina; com erro (`error=500`), é notícia. */
export const ehRuido = (linha) => {
  if (linha === null || linha === undefined) return true;
  const s = String(linha).trim();
  if (!s) return true;
  // Objeto/lixo sem texto util (ex.:  = '[object Object]') nao diz
  // nada: nao vale imprimir.
  if (s === '[object Object]' || s === '0') return true;
  // Um  e' rotina (keepalive).  e
  // qualquer  sao noticia. A regra vem ANTES do RUIDO para que um
  // ack com erro nunca seja escondido por uma lista.
  if (/ack de .*error=0\b/.test(s)) return true;
  if (RUIDO.some((r) => s.includes(r))) return true;
  return false;
};

/**
 * Cria o log da chamada. Devolve um `(msg) => void` pronto para o `log` do motor.
 *
 * @param {object} [opts]
 * @param {(linha: string) => void} [opts.escrever] saída (default: `console.log`)
 * @param {boolean} [opts.colapsarRepeticao] (default: true)
 * @returns {(msg: unknown) => void}
 */
export function criarLogDaCall(opts = {}) {
  const escrever = typeof opts.escrever === 'function' ? opts.escrever : (l) => console.log(l);
  const colapsar = opts.colapsarRepeticao !== false;

  let ultima = null;
  let vezes = 0;

  /** Fecha a sequencia: se ela repetiu, avisa a contagem (uma linha curta). */
  const fecharRepeticao = () => {
    if (ultima !== null && vezes > 1) escrever(`${PREFIXO} … a anterior repetiu (x${vezes})`);
    ultima = null;
    vezes = 0;
  };

  const log = (msg) => {
    const linha = String(msg ?? '').trim();
    if (ehRuido(linha)) return;

    const formatada = `${PREFIXO} ${linha}`;
    // A repeticao e' comparada SEM o `id`: o mesmo evento (ex.: `ack de peer_state
    // error=500`) chega com um id por stanza, e sem isso cada um viraria uma
    // linha nova.
    const chave = formatada.replace(/\(id=[^)]*\)/g, '(id=…)');
    if (colapsar && ultima === chave) {
      // Repeticao seguida: NAO reimprime a linha (era o que deixava o log
      // ilegivel). A contagem sai quando a sequencia terminar ou no `flush()`.
      vezes += 1;
      return;
    }

    fecharRepeticao();
    ultima = chave;
    vezes = 1;
    escrever(formatada);
  };

  /**
   * Fecha a sequencia em curso. O chamador usa no fim de um ciclo (fim da call,
   * saida do comando) para a contagem nao se perder se a linha repetida for a
   * ultima coisa que aconteceu.
   */
  log.flush = fecharRepeticao;
  return log;
}
