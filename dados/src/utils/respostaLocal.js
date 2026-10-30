/**
 * A RESPOSTA LOCAL da Lizzy — o que ela diz quando a API nao respondeu.
 *
 * ## O pedido do dono
 *
 * *"eu quero que ela NUNCA fique sem resposta, ela tem que ter resposta pra
 * literalmente TUDO"*.
 *
 * Uma API gratis tem cota (RPM/RPD) e cai. Quando ela cai, o bot NAO pode ficar
 * mudo — mas tambem nao pode mandar sempre a mesma frase ("ih, deu ruim"), que
 * e' justamente o que faz parecer um robo.
 *
 * ## Por que LOCAL (sem API)
 *
 * Este modulo NAO chama API nenhuma: e' o que garante a resposta quando a cota
 * acabou (nenhum token gasto) e quando a rede caiu. Ele responde rapido e de
 * graca.
 *
 * ## Por que nao e' "sempre a mesma frase"
 *
 * A escolha leva em conta:
 *   - o que a pessoa mandou (pergunta, saudacao, xingamento, figurinha, nada);
 *   - o que a Lizzy JA respondeu neste chat (nao repete a mesma frase seguida).
 *
 * Modulo PURO: sem socket, sem disco, sem rede. O `aleatorio` entra por
 * parametro para o teste ser deterministico.
 */

/** Sem acento e minusculo — o mesmo corte do resto do bot. */
function normalizar(texto) {
  let s = String(texto || '');
  try { s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch { /* ok */ }
  return s.toLowerCase().trim();
}

/** A saudacao casa? (`oi`, `ola`, `bom dia`, `eai`...) */
function ehSaudacao(t) {
  return /^(oi+|ola+|opa|eai|e ai|salve|bom dia|boa tarde|boa noite|td bem|tudo bem|blz|beleza)\b/.test(t);
}

/** A mensagem PERGUNTA algo? (tem `?` ou comeca com palavra de pergunta) */
function ehPergunta(t) {
  if (t.includes('?')) return true;
  return /^(oq|o que|que|quem|quando|onde|como|qual|por que|pq|porque|quanto|sera)\b/.test(t);
}

/** A mensagem tem cara de despedida? */
function ehDespedida(t) {
  return /^(tchau|flw|falou|ate mais|ate logo|fui|vou dormir|boa noite|ate amanha)\b/.test(t);
}

/** A mensagem e' um xingamento? (responde sem se abalar) */
function ehXingamento(t) {
  return /(vai se|vsf|vtnc|fdp|filho da|idiota|burra|otaria|otaria|imbecil|arrombad|cuzao|cuzao|pnc)/.test(t);
}

/**
 * A mensagem nao tem TEXTO (figurinha, foto, audio, reacao...)?
 * @param {string} texto o texto ja' extraido (vazio = sem texto)
 */
function semTexto(texto) {
  return !String(texto || '').trim();
}

/**
 * Frases por SITUACAO. Varias por situacao de proposito: a escolha evita
 * repetir a ultima, entao a mesma situacao nunca sai igual duas vezes seguidas.
 *
 * Sem emoji e sem asterisco: e' o que o prompt proibe e o que mais entrega IA.
 */
const FRASES = Object.freeze({
  saudacao: [
    'oi',
    'oii',
    'eai',
    'oiee',
    'oi, tudo bem?',
    'oii, chegou'
  ],
  pergunta: [
    'ih, travei aqui, pergunta de novo?',
    'nao peguei, fala de outro jeito',
    'pera, nao entendi essa',
    'como assim? explica melhor',
    'ih, buguei. repete ai'
  ],
  xingamento: [
    'kkkk ta bom',
    'nossa, ta nervoso?',
    'oxi, que isso',
    'kkkk relaxa',
    'ta, entendi'
  ],
  despedida: [
    'flw',
    'tchau, ate mais',
    'falou',
    'ate logo',
    'vai com deus'
  ],
  semTexto: [
    'kkkk',
    'nossa',
    'que isso',
    'oxi',
    'eita'
  ],
  generico: [
    'kkkk',
    'oxi',
    'que isso',
    'serio?',
    'ih, agora buguei',
    'pera, nao entendi',
    'como assim?',
    'fala mais',
    'ata',
    'nossa',
    'affs',
    'manda de novo que eu nao peguei',
    'eita',
    'kkkkk que foi'
  ]
});

/**
 * Escolhe uma frase para a mensagem, evitando repetir a ULTIMA.
 *
 * @param {object} p
 * @param {string} [p.texto] o que a pessoa mandou
 * @param {string} [p.ultima] a ultima frase local que a Lizzy mandou neste chat
 * @param {function} [p.aleatorio] `() => number` em [0,1) (padrao: Math.random)
 * @returns {string}
 */
export function respostaLocal({ texto, ultima = null, aleatorio = Math.random } = {}) {
  const t = normalizar(texto);
  let balde = FRASES.generico;
  if (semTexto(t)) balde = FRASES.semTexto;
  else if (ehXingamento(t)) balde = FRASES.xingamento;
  else if (ehDespedida(t)) balde = FRASES.despedida;
  else if (ehSaudacao(t)) balde = FRASES.saudacao;
  else if (ehPergunta(t)) balde = FRASES.pergunta;

  const rnd = typeof aleatorio === 'function' ? aleatorio : Math.random;
  const idx = Math.min(balde.length - 1, Math.max(0, Math.floor(rnd() * balde.length)));
  let escolhida = balde[idx];
  // Nao repete a ultima: anda uma casa (o balde tem 5+ frases, entao nunca
  // fica presa em ciclo de uma).
  if (balde.length > 1 && escolhida === ultima) {
    escolhida = balde[(idx + 1) % balde.length];
  }
  return escolhida;
}

/** As frases de uma situacao (diagnostico/teste). */
export function frasesLocais(situacao) {
  return [...(FRASES[situacao] || FRASES.generico)];
}

/** Quantas frases existem ao todo (diagnostico). */
export function totalDeFrases() {
  return Object.values(FRASES).reduce((s, l) => s + l.length, 0);
}
