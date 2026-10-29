/**
 * AÇÕES DO GRUPO pedidas por fala/texto para a assistente.
 *
 * ## O pedido do dono
 *
 * *"na foto eu quero que ela mande a foto do grupo normalmente no chat"* e
 * *"qualquer membro manda 'lizzy manda o link do grupo' aí ela manda"*.
 *
 * ## Por que aqui (e nao no LLM)
 *
 * As duas ações são **determinísticas**: ou a pessoa pediu o link, ou pediu a
 * foto, ou não pediu nada. Um LLM não tem o convite do grupo para inventar (e
 * inventaria um link errado), e o repo já decidiu isso no `iapComandos.js`:
 * **ação com consequência casa por PADRÃO conhecido, não por palpite**.
 *
 * Também resolve o problema do contexto: o bloco de contexto leva a foto como
 * uma **URL em texto** ("- Foto: https://..."), que o LLM não consegue
 * *mostrar* — ele só sabe escrever. Aqui a foto é ENVIADA como imagem.
 *
 * ## Qualquer membro
 *
 * Diferente do `!linkgp` (que exige admin e serve para DIVULGAR o link), aqui
 * **qualquer membro** pode pedir — é a mesma informação que o WhatsApp já mostra
 * na tela do grupo. O que muda é só quem pede.
 *
 * Módulo PURO: não conhece socket, LLM nem arquivo — só texto → intenção.
 */

/**
 * Verbos/pedidos que transformam a menção em um PEDIDO.
 *
 * Sem um destes, "o link do grupo tá quebrado" é só um comentário — e viraria
 * uma resposta indesejada.
 */
const PEDIDO = [
  'manda', 'mandar', 'mandas', 'me manda', 'manda ai', 'manda o', 'manda a',
  'envia', 'enviar', 'me envia', 'envia o', 'envia a',
  'qual', 'quais', 'qual e', 'qual o', 'qual a',
  'quero', 'queria', 'preciso', 'precisava', 'gostaria',
  'passa', 'passar', 'me passa', 'passa o', 'passa a',
  'mostra', 'mostrar', 'me mostra', 'mostra o', 'mostra a',
  'consegue', 'pode', 'poderia', 'da', 'me da', 'vê', 've', 'ver'
];

/** O alvo LINK (o convite do grupo). */
const ALVO_LINK = /\b(link|convite|invite|endereco)\b/i;

/** O alvo FOTO (a imagem do grupo). */
const ALVO_FOTO = /\b(foto|fotografia|imagem|img|pic|icone|ft)\b/i;

/** Confirma que é DESTE grupo (evita "manda o link da musica"). */
const DO_GRUPO = /\b(grupo|gp|group|aqui|daqui|desse|deste|nosso)\b/i;

/**
 * Objetos que NÃO são o grupo: com eles, "manda o link X" é outra coisa.
 * (O `!play`/`!tiktok` já tratam esses pedidos.)
 */
const OUTRO_OBJETO = /\b(musica|musicas|som|faixa|audio|video|clipe|playlist|album|tiktok|pinterest|figurinha|figura|sticker|pdf|documento|arquivo|imagem da|foto da|foto do meu)\b/i;

/** Normaliza para os testes: sem acento, sem pontuação, sem o nome do agente. */
function paraPadroes(texto) {
  let t = String(texto || '')
    .replace(/[,.!?;:]+/g, ' ')
    .replace(/\b(lizzy|abyss)\b/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  try { t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch { /* ok */ }
  return t;
}

/** O texto tem um verbo de PEDIDO? */
function temPedido(t) {
  return PEDIDO.some((p) => new RegExp(`(^|\\s)${p}(\\s|$)`, 'i').test(t));
}

/**
 * Identifica a ação de grupo pedida.
 *
 * @param {string} texto a mensagem (já sem o nome do agente, se veio)
 * @returns {{ acao: 'link'|'foto' }|null} `null` quando não é um pedido conhecido
 */
export function identificarAcaoDoGrupo(texto) {
  const bruto = String(texto || '').trim();
  if (!bruto) return null;
  const t = paraPadroes(bruto);
  if (!t) return null;

  const pediuLink = ALVO_LINK.test(t);
  const pediuFoto = ALVO_FOTO.test(t);
  // Nem link nem foto: não é conosco.
  if (!pediuLink && !pediuFoto) return null;

  // Falar de OUTRO objeto (musica/video/figurinha) nunca é o link/foto do grupo.
  if (OUTRO_OBJETO.test(t)) return null;

  const palavras = t.split(/\s+/).filter(Boolean);
  const pedido = temPedido(t);
  const doGrupo = DO_GRUPO.test(t);

  // FRASE NOMINAL CURTA: "link do grupo", "foto do grupo", "Lizzy, link do
  // grupo". É como muita gente pede — o nome do agente já diz que é um pedido,
  // e uma frase de 2-3 palavras com o alvo + "grupo" não é comentário.
  // (Uma frase longa SEM verbo seria conversa: "o link do grupo ta quebrado".)
  if (doGrupo && palavras.length <= 4) {
    return { acao: pediuLink ? 'link' : 'foto' };
  }

  // Exige o PEDIDO. Sem ele é comentário ("esse link do grupo e antigo").
  if (!pedido) return null;

  // "link/foto" + confirmação de que é DESTE grupo.
  if (doGrupo) {
    return { acao: pediuLink ? 'link' : 'foto' };
  }

  // Sem dizer "grupo": aceita só quando é curto e sem outro assunto — "manda o
  // link", "qual a foto". Uma frase longa sem "grupo" é conversa.
  if (palavras.length <= 5) {
    return { acao: pediuLink ? 'link' : 'foto' };
  }

  return null;
}

/** As frases que descrevem a ação, para o prompt (a Lizzy usa para se oferecer). */
export function frasesDeAjudaDoGrupo() {
  return [
    '- "manda o link do grupo" -> envia o convite do grupo',
    '- "manda a foto do grupo" -> envia a foto do grupo'
  ].join('\n');
}
