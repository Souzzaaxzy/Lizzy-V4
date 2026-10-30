/**
 * A "CONVERSA EM ANDAMENTO" — quando a Lizzy continua respondendo sem ser chamada.
 *
 * ## O pedido do dono (out/2026)
 *
 * *"eu seu marquei/citei/falei o nome dela chamando ela, comecei a conversar e
 * respondi ela sem marcar ela ou responder, ela entende que ainda estou
 * conversando com ela e me responde, mas isso tem que ser MUITO bem
 * calibrado."*
 *
 * ## O desenho: JANELA POR PESSOA (não por grupo)
 *
 * A conversa continua é **entre a Lizzy e UMA pessoa**. Se o grupo inteiro
 * ganhasse a janela, qualquer mensagem de qualquer membro faria ela responder —
 * e o grupo viraria um monólogo dela. Então a janela é aberta para **quem
 * chamou** e só as mensagens **daquela pessoa** a mantêm viva.
 *
 * ## Calibração (o "MUITO bem calibrado")
 *
 * Três travas, todas configuráveis:
 *
 * | trava | padrão | por quê |
 * |---|---|---|
 * | janela de TEMPO | 3 min | conversa parada morre; evita responder 1h depois |
 * | máximo de TROCAS seguidas | 4 | sem isto, ela conversa "para sempre" |
 * | pausa mínima entre respostas | 2 s | evita responder 2 mensagens seguidas rápido demais |
 *
 * Além disso, a continuação **só vale se a mensagem PARECER conversa**:
 * pergunta, resposta curta, ou algo que continua o assunto. Um "kkkkk" solto
 * **não** puxa resposta (senão ela responde risada).
 *
 * Módulo PURO: só decide. Quem tem o socket é o handler.
 */

/** Configurações (todas por ambiente, com padrão conservador). */
function num(v, padrao) {
  const n = Number.parseInt(String(v ?? '').trim(), 10);
  return Number.isFinite(n) && n >= 0 ? n : padrao;
}

/** A janela (ms) em que a conversa continua vale. Padrão: 3 minutos. */
export function janelaMs(env = process.env) {
  return num(env.LIZZY_CONVERSA_JANELA_MS, 3 * 60 * 1000);
}

/**
 * Quantas TROCAS seguidas sem menção ela aceita antes de parar. Padrão: 20.
 *
 * ## Por que 20, e nao 4 (o bug do "so' continuou 1 vez")
 *
 * O teto era 4 — e numa conversa real a pessoa manda 4 mensagens em menos de um
 * minuto. O teto existe para ela nao responder uma RAJADA infinita, nao para
 * limitar a conversa. A janela de TEMPO e a PAUSA ja cuidam do caso normal;
 * este numero e' a rede de seguranca.
 */
export function maxTrocas(env = process.env) {
  return num(env.LIZZY_CONVERSA_MAX_TROCAS, 20);
}

/** A pausa mínima (ms) entre duas respostas dela. Padrão: 2s. */
export function pausaMs(env = process.env) {
  return num(env.LIZZY_CONVERSA_PAUSA_MS, 2000);
}

/**
 * As frases que **não** puxam continuação.
 *
 * Uma conversa continua precisa de CONTEÚDO. Risada, "sim", "ok" e figurinha
 * são reações — respondê-las faz a Lizzy parecer que responde tudo (e é o que
 * enche o grupo de mensagem dela).
 */
const SEM_CONTEUDO = /^(k{3,}|(ha){2,}|rs+|hu{3,}|kk+|sim|nao|não|ok|okay|blz|beleza|vlw|valeu|top|show|boa|eae|opa|flw|falou|fui|ate|até|bom dia|boa tarde|boa noite|boa madrugada|👍|😂|🤣|❤️|kkkkk+)[.!?\s]*$/i;

/**
 * A mensagem tem CONTEÚDO de conversa (não é só reação)?
 *
 * @param {string} texto
 * @returns {boolean}
 */
export function temConteudoDeConversa(texto) {
  const t = String(texto || '').trim();
  if (!t) return false;
  if (t.length < 2) return false;
  if (SEM_CONTEUDO.test(t)) return false;
  // Só emoji/símbolo também não é conversa.
  if (!/[\p{L}\p{N}]/u.test(t)) return false;
  return true;
}

/**
 * O estado da conversa em andamento, por GRUPO + PESSOA.
 *
 * Guarda o essencial: quem abriu a janela, quando, quantas trocas já foram e
 * quando ela respondeu por último.
 */
export class ConversasEmAndamento {
  constructor(env = process.env) {
    this.env = env;
    this.mapa = new Map();
  }

  static _chave(grupo, pessoa) {
    return `${String(grupo || '')}|${String(pessoa || '')}`;
  }

  /**
   * A PESSOA abriu (ou reabriu) a conversa — chamou a Lizzy.
   *
   * Zerar as trocas ao ser chamada de novo é o certo: uma chamada explícita é
   * um pedido novo, não continuação.
   */
  abrir(grupo, pessoa, agora = Date.now()) {
    this.mapa.set(ConversasEmAndamento._chave(grupo, pessoa), {
      desde: agora, trocas: 0, ultimaResposta: 0
    });
  }

  /** A conversa desta pessoa está aberta e dentro da janela? */
  ativa(grupo, pessoa, agora = Date.now()) {
    const c = this.mapa.get(ConversasEmAndamento._chave(grupo, pessoa));
    if (!c) return false;
    if (agora - c.desde > janelaMs(this.env)) { this.mapa.delete(ConversasEmAndamento._chave(grupo, pessoa)); return false; }
    return true;
  }

  /** Fechou a conversa (ela pediu para parar, ou estourou o limite). */
  fechar(grupo, pessoa) {
    this.mapa.delete(ConversasEmAndamento._chave(grupo, pessoa));
  }

  /**
   * Decide se a Lizzy deve responder esta mensagem SEM ser chamada.
   *
   * @param {object} p
   * @param {string} p.grupo
   * @param {string} p.pessoa quem falou
   * @param {string} p.texto a mensagem
   * @param {number} [p.agora]
   * @returns {{ responder: boolean, motivo: string }}
   */
  deveContinuar({ grupo, pessoa, texto, agora = Date.now() }) {
    const c = this.mapa.get(ConversasEmAndamento._chave(grupo, pessoa));
    if (!c) return { responder: false, motivo: 'sem_janela' };
    if (agora - c.desde > janelaMs(this.env)) {
      this.mapa.delete(ConversasEmAndamento._chave(grupo, pessoa));
      return { responder: false, motivo: 'janela_expirada' };
    }
    if (c.trocas >= maxTrocas(this.env)) {
      this.mapa.delete(ConversasEmAndamento._chave(grupo, pessoa));
      return { responder: false, motivo: 'limite_de_trocas' };
    }
    if (c.ultimaResposta && (agora - c.ultimaResposta) < pausaMs(this.env)) {
      return { responder: false, motivo: 'pausa_curta' };
    }
    if (!temConteudoDeConversa(texto)) return { responder: false, motivo: 'sem_conteudo' };
    return { responder: true, motivo: 'continuacao' };
  }

  /**
   * Marca que ela RESPONDEU: conta a troca e reinicia a janela.
   *
   * Reiniciar `desde` é deliberado: a conversa continua enquanto houver troca —
   * o limite é de TROCAS, não de tempo desde a primeira chamada.
   */
  registrouResposta(grupo, pessoa, agora = Date.now()) {
    const k = ConversasEmAndamento._chave(grupo, pessoa);
    const c = this.mapa.get(k);
    if (!c) return;
    c.trocas += 1;
    c.ultimaResposta = agora;
    c.desde = agora;
  }

  /**
   * A PESSOA mandou uma mensagem com conteudo: a janela se RENOVA.
   *
   * ## O "deixa no ciclo, para funcionar de verdade" (pedido do dono)
   *
   * Sem isto, a janela contava a partir da ULTIMA RESPOSTA dela: se a pessoa
   * demorasse 3 minutos para escrever de novo (normal numa conversa), a janela
   * expirava e ela parava no meio. Renovando a cada mensagem da pessoa, o que
   * conta e' o tempo desde a ultima vez que ALGUEM falou — que e' como uma
   * conversa de verdade funciona.
   */
  renovarJanela(grupo, pessoa, agora = Date.now()) {
    const k = ConversasEmAndamento._chave(grupo, pessoa);
    const c = this.mapa.get(k);
    if (!c) return;
    c.desde = agora;
  }

  /** Quantas trocas estão abertas (para o teste e para o painel). */
  trocas(grupo, pessoa) {
    return this.mapa.get(ConversasEmAndamento._chave(grupo, pessoa))?.trocas ?? 0;
  }
}

/**
 * As frases que FECHAM a conversa (o dono pede para ela parar).
 *
 * Sem isto, "chega", "para" e "cala a boca" seriam respondidos — e ela
 * continuaria falando justamente quando pediram para parar.
 */
const PEDIDO_DE_PARADA = /\b(chega|para|pare|parar|cala\s*(a\s*)?boca|fica\s+quieta|silencio|silêncio|nao\s+fala\s+mais|não\s+fala\s+mais|deixa\s+(ele|ela|a\s+gente)\s+em\s+paz)\b/i;

/**
 * Os verbos que, SOZINHOS no comeco, sao uma ordem de parada.
 *
 * `para`/`pare` sao palavras comuns ("voce PARA e pensa", "o que PARA a
 * fabrica") — por isso so' valem como ordem quando estao no INICIO da frase e
 * ela e' CURTA. Sem esta trava, "voce para e pensa" fecharia a conversa.
 */
const PARADA_NO_INICIO = /^\s*(chega|para|pare|parar|cala\s*(a\s*)?boca|fica\s+quieta|silencio|silêncio)\b/i;

/**
 * O que pode vir DEPOIS do verbo para ele continuar sendo ORDEM.
 *
 * ## O bug medido (a conversa parava na 1a repeticao)
 *
 * O `PARADA_NO_INICIO` casava "para" no comeco de QUALQUER frase — e
 * *"para mim tambem foi assim"* fechava a conversa. Era exatamente o "funcionou
 * so' 1 vez" relatado pelo dono.
 *
 * `para`/`pare` so' sao ORDEM quando a frase ACABA neles ("para") ou quando vem
 * um complemento de ordem ("para com isso", "para de falar"). Em "para mim...",
 * "para voce..." e "para todos...", `para` e' PREPOSICAO — conversa normal.
 */
const COMPLEMENTO_DE_ORDEM = /^\s*[.!?,]*\s*$|^\s+(com\s+isso|de\s+(falar|me\s+chamar|encher)|ai|aí|ja|já|agora|logo|por\s+favor|pfv)\b/i;

/**
 * `para`/`pare` no comeco: e' ordem mesmo?
 * @param {string} t
 * @returns {boolean}
 */
function ordemDeParaNoInicio(t) {
  const m = /^\s*(para|pare|parar)\b(.*)$/i.exec(t);
  if (!m) return false;
  const resto = String(m[2] || '');
  // Sem nada depois: e' ordem ("para").
  if (!resto.trim()) return true;
  // Com complemento de ordem: e' ordem.
  if (COMPLEMENTO_DE_ORDEM.test(resto)) return true;
  // Qualquer outra coisa depois ("para mim tambem...") e' PREPOSICAO.
  return false;
}

/**
 * A mensagem é um PEDIDO DE PARADA?
 * @param {string} texto
 * @returns {boolean}
 */
export function ehPedidoDeParada(texto) {
  const t = String(texto || '').trim();
  if (!t) return false;
  const palavras = t.split(/\s+/).filter(Boolean).length;
  // Frase longa costuma ser conversa ("para de ser boba comigo ta bom"), nao ordem.
  if (palavras > 5) return false;
  // "chega"/"cala a boca"/"silencio" sao inequivocos em qualquer posicao curta.
  // ATENCAO: o `chega` NAO entra nesta lista — ele tem uso de conversa
  // ("chega pra mim", "chega de historia") e e' tratado logo abaixo, com a
  // mesma logica do `para`. Sem esta separacao, a lista acima casava "chega"
  // em QUALQUER frase e a conversa morria (o bug medido).
  if (/\b(cala\s*(a\s*)?boca|fica\s+quieta|silencio|silêncio|nao\s+fala\s+mais|não\s+fala\s+mais)\b/i.test(t)) return true;
  // "para"/"pare" SO' como ordem no INICIO ("para", "para com isso") — em
  // "voce para e pensa" a palavra e' um verbo comum.
  // "para"/"pare" SO' como ordem de verdade (nao como preposicao).
  if (ordemDeParaNoInicio(t)) return true;
  // As frases INEQUIVOCAS ("deixa ela em paz") valem em qualquer posicao curta.
  if (/\b(deixa\s+(ele|ela|a\s+gente)\s+em\s+paz|nao\s+fala\s+mais|não\s+fala\s+mais)\b/i.test(t)) return true;
  // "cala a boca"/"silencio"/"fica quieta" sao inequivocos.
  if (/\b(cala\s*(a\s*)?boca|fica\s+quieta|silencio|silêncio)\b/i.test(t)) return true;
  // "chega" tambem tem uso de CONVERSA ("chega pra mim", "chega de historia") —
  // entao so' e' ordem sozinho ("chega", "chega!") ou com complemento de ordem.
  if (/^\s*chega\b(.*)$/i.test(t)) {
    const resto = /^\s*chega\b(.*)$/i.exec(t)[1];
    if (!resto.trim()) return true;
    if (/^\s*[.!?,]*\s*$/.test(resto)) return true;
    if (/^\s+(com\s+isso|de\s+(falar|me\s+chamar|encher)|ai|aí|ja|já|agora|logo|por\s+favor|pfv)\b/i.test(resto)) return true;
    return false;
  }
  return false;
}
