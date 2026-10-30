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
 * ## Os comandos (pedido do dono, out/2026)
 *
 * *"você adiciona os comandos: play, pin, figurinha aleatória, e o `!s` em modo
 * busca, exemplo 'lizzy me manda uma figurinha do <busca>', aí ela manda,
 * funciona igual ao `!s <busca>`"*.
 *
 * | ação | o que faz | comando equivalente |
 * |---|---|---|
 * | `link` | envia o convite do grupo | `!linkgp` (mas sem exigir admin) |
 * | `foto` | envia a foto do grupo | — |
 * | `play` | toca/baixa uma música | `!play <termo>` |
 * | `pin` | pesquisa imagens no Pinterest | `!pin <termo>` |
 * | `figurinha` | manda uma figurinha aleatória | `!figualeatoria` |
 * | `stickerBusca` | monta um pack de figurinhas do termo | `!s <termo>` |
 * | `mencao` | menciona alguém do grupo pelo nome | — |
 *
 * **FOTO de alguma coisa = `pin`** (pedido do dono, out/2026): *"o `!pin` é foto,
 * quando eu pedir foto ela busca lá"*. Então "me manda uma foto de gato" pesquisa
 * no Pinterest — só "foto **do grupo**" continua sendo a foto do grupo.
 *
 * A ORDEM da checagem importa: `stickerBusca` (o `!s` por busca) tem de vir
 * antes de `figurinha`, senão "manda uma figurinha de gato" cairia na aleatória.
 *
 * Módulo PURO: não conhece socket, LLM nem arquivo — só texto → intenção.
 */

import { identificarComando } from './iapComandos.js';

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
  'consegue', 'pode', 'poderia', 'da', 'me da', 'vê', 've', 'ver',
  // Os verbos dos comandos do bot (play/pin/figurinha). Sem eles, "toca a
  // musica X" nao casaria como PEDIDO e cairia como conversa.
  'toca', 'tocar', 'toque', 'toka', 'toga', 'bota', 'botar', 'coloca', 'colocar',
  'poe', 'poem', 'play', 'escuta', 'escutar', 'ouve', 'ouvir',
  'procura', 'procurar', 'busca', 'buscar', 'acha', 'achar',
  'baixa', 'baixar', 'traz', 'trazer', 'mande', 'envie'
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
const OUTRO_OBJETO = /\b(musica|musicas|som|faixa|audio|video|clipe|playlist|album|tiktok|pinterest|figurinha|figura|sticker|pdf|documento|arquivo)\b/i;

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

/**
 * O alvo FIGURINHA POR BUSCA ("me manda uma figurinha de gato").
 *
 * É o `!s <busca>`: o termo vai para a pesquisa de imagens e volta como PACK.
 * Precisa vir ANTES do alvo de figurinha aleatória.
 */
const ALVO_STICKER_BUSCA = /\b(figurinha|figura|sticker)s?\s+(do|da|de|sobre|com)\s+(.+)/i;

/** O alvo FIGURINHA ALEATÓRIA (sem termo). */
const ALVO_FIGURINHA = /\b(figurinha|figura|sticker)s?\b/i;

/**
 * Identifica a ação pedida — incluindo os comandos do bot.
 *
 * A ORDEM é a regra: plataforma específica antes da genérica, e a figurinha POR
 * BUSCA antes da aleatória.
 *
 * @param {string} texto a mensagem (já sem o nome do agente, se veio)
 * @returns {{ acao: string, termo?: string }|null}
 */
export function identificarAcaoDoBot(texto) {
  const bruto = String(texto || '').trim();
  if (!bruto) return null;
  const t = paraPadroes(bruto);
  if (!t) return null;
  const palavras = t.split(/\s+/).filter(Boolean);
  const pedido = temPedido(t);

  // 1) FIGURINHA POR BUSCA — "manda uma figurinha de gato" (= `!s gato`).
  //    Exige PEDIDO (senão "essa figurinha de gato é boa" viraria comando).
  const mSticker = ALVO_STICKER_BUSCA.exec(t);
  if (mSticker && pedido) {
    // O termo é o que sobra depois do alvo; tira as caudas do pedido.
    let termo = String(mSticker[3] || '')
      .replace(/\b(para|pra|pro|por|aqui|agora|pfv|pf|por\s+favor)\b.*$/i, '')
      .replace(/\s{2,}/g, ' ').trim();
    if (termo) return { acao: 'stickerBusca', termo };
    return null;
  }

  // 2) FIGURINHA ALEATÓRIA — "manda uma figurinha" (= `!figualeatoria`).
  //    Sem termo: o alvo já é o pedido inteiro.
  if (ALVO_FIGURINHA.test(t) && pedido && !OUTRO_OBJETO_STICKER.test(t)) {
    return { acao: 'figurinha' };
  }

  // 3) PLAY e PIN — REUSA o reconhecedor do `iapComandos`.
  //
  // Ele ja' cobre "toca X", "me toca X", "baixa a musica X", "quero ouvir X",
  // "procura no pinterest X" e a DESAMBIGUACAO entre eles (o pinterest vem
  // antes do play), com um corpus medido de 40 frases. Escrever um segundo
  // reconhecedor aqui seria a mesma duplicacao que ja' custou caro neste repo.
  // PEDIDO DE ÁUDIO/VOZ não é `play`. "manda um áudio" tem "audio" na lista de
  // palavras de música, então o `identificarComando` o pegaria — e ela
  // perguntaria "qual música?" em vez de mandar a voz. O bloco do áudio no
  // handler vem antes, mas o RECONHECEDOR também não pode classificar assim.
  if (/\b(manda|mandar|me\s+manda|envia|envie|me\s+envia|grava|quero\s+ouvir|manda\s+sua)\b[^]*\b(audio|audios|voz|nota\s+de\s+voz)\b/i.test(t)) {
    return null;
  }

  const doIap = identificarComando(bruto);
  if (doIap && (doIap.comando === 'play' || doIap.comando === 'pin')) {
    // Tira a sobra da moldura do pedido: "manda um pin de flores" -> "flores".
    let termo = String(doIap.args || '').trim();
    if (doIap.comando === 'pin') {
      termo = termo.replace(/^\s*(pin|pinterest)\s+(de|do|da|sobre)?\s*/i, '').trim();
    }
    return { acao: doIap.comando, termo };
  }

  // 5) FOTO DE ALGUMA COISA -> é o `!pin` (o Pinterest busca imagens).
  //
  // Pedido do dono: *"o `!pin` é foto, quando eu pedir foto ela busca lá"*.
  // "foto do GRUPO" fica de fora (é a foto do grupo, tratada no passo 6) — a
  // diferença é o termo: "grupo/gp/aqui" não é um tema de busca.
  const mFoto = /\b(foto|fotografia|imagem|img|pic)s?\s+(de|do|da|dos|das|sobre)\s+(.+)/i.exec(t);
  if (mFoto && pedido) {
    const termo = String(mFoto[3] || '')
      .replace(/\b(para|pra|pro|por|aqui|agora|pfv|pf|por\s+favor)\b.*$/i, '')
      .replace(/\s{2,}/g, ' ').trim();
    const ehDoGrupo = /^(o\s+|a\s+)?(grupo|gp|group|aqui|daqui|desse|deste|nosso)\b/i.test(termo);
    if (termo && !ehDoGrupo) return { acao: 'pin', termo };
  }

  // 6) As ações que já existiam (link/foto do grupo).
  return identificarAcaoDoGrupo(texto);
}

/**
 * Objetos que NÃO são figurinha: com eles, "manda uma figurinha de pizza" é
 * sobre o DESENHO da pizza (o pack), não sobre a figurinha aleatória — a
 * checagem de busca (1) já tratou. Aqui só bloqueia o caminho aleatório.
 */
const OUTRO_OBJETO_STICKER = /\b(de|do|da|sobre|com)\s+\S/i;

/** Os verbos de pedido, para reusar na limpeza do termo. */
const VERBO_PEDIDO_RE = 'manda|mandar|mandas|envia|enviar|envie|me\s+manda|me\s+envia|quero|queria|gostaria|preciso|passa|passar|mostra|mostrar|procura|procurar|busca|buscar|acha|achar|baixa|baixar|toca|tocar|toka|toga|bota|coloca|poe';

/** As frases que descrevem a ação, para o prompt (a Lizzy usa para se oferecer). */
export function frasesDeAjudaDoGrupo() {
  return [
    '- "manda o link do grupo" -> envia o convite do grupo',
    '- "manda a foto do grupo" -> envia a foto do grupo',
    '- "toca a musica X" -> toca a musica X',
    '- "procura no pinterest X" -> pesquisa imagens de X',
    '- "manda uma figurinha" -> manda uma figurinha aleatoria',
    '- "manda uma figurinha de X" -> monta um pack de figurinhas de X',
    '- "chama o X pra mim" -> menciona a pessoa X do grupo',
    '- "me manda uma foto de X" -> pesquisa imagens de X'
  ].join('\n');
}
