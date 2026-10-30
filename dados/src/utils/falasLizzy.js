/**
 * FALAS NATURAIS por evento — o que a Lizzy diz quando cumpre um pedido.
 *
 * ## O pedido do dono
 *
 * *"atualmente ela manda link e a foto do grupo, eu quero que ela tenha uma fala
 * de resposta junto desses comandos"* — e, para cada comando novo: *"eu quero uma
 * fala natural para cada evento desse!!!!"*.
 *
 * ## Por que frases aqui (e não na IA)
 *
 * Ao contrário da CONVERSA (onde o dono pediu *"IA pura"*, sem frase pronta), o
 * que existe aqui é uma **confirmação de ação**: ela acompanha uma mídia que já
 * vai sair (o link, a foto, o pack de figurinhas). A fala precisa ser **rápida e
 * certa** — e uma chamada de LLM por evento custaria cota e poderia dizer algo
 * que não corresponde ao que foi enviado.
 *
 * São **várias frases por evento**, sorteadas: repetir a mesma toda vez é o que
 * faz parecer robô (foi uma reclamação do dono no chat: *"fala as mesmas coisas
 * às vezes, repete resposta"*).
 *
 * O módulo é PURO — só sorteia texto. Quem tem o socket envia.
 */

/**
 * As frases, por evento. `{nome}` é quem pediu; `{alvo}` é a pessoa mencionada.
 *
 * Regra de estilo (a mesma do chat): frase curta, minúscula, sem emoji e sem
 * asterisco — é uma pessoa falando, não um card.
 */
export const FALAS = Object.freeze({
  link: [
    'toma o link do grupo, {nome}',
    'aqui está o link, {nome}',
    'pega o convite do grupo',
    'prontinho, o link tá aí'
  ],
  foto: [
    'olha a foto do grupo',
    'essa é a nossa foto',
    'toma, {nome}',
    'aí está ela'
  ],
  play: [
    'toca essa, {nome}',
    'boa escolha',
    'tá na mão',
    'essa é boa'
  ],
  pin: [
    'olha o que eu achei',
    'separei essas pra você',
    'achei umas imagens',
    'dá uma olhada'
  ],
  figurinha: [
    'toma uma figurinha',
    'essa é pra você',
    'aí vai',
    'pega essa'
  ],
  stickerBusca: [
    'montei umas figurinhas de {termo}',
    'olha as figurinhas de {termo}',
    'fiz esse pack de {termo}',
    'separei umas de {termo}'
  ],
  mencao: [
    'ei {alvo}, {nome} quer falar com você',
    '{alvo}, o {nome} tá te chamando',
    '{alvo}, te chamaram aqui',
    'ó {alvo}, {nome} quer falar contigo'
  ],
  mencaoSemNome: [
    'ei {alvo}, te chamaram aqui',
    '{alvo}, tem alguém querendo falar com você',
    'ó {alvo}, te procuraram'
  ],
  mencaoNaoAchou: [
    'não achei ninguém com esse nome aqui',
    'não conheço ninguém com esse nome no grupo',
    'não achei esse nome, {nome}'
  ],
  mencaoAmbiguo: [
    'tem mais de um com esse nome, qual deles?',
    'achei mais de um, me diz qual'
  ]
});

/**
 * Sorteia uma fala do evento e resolve os marcadores.
 *
 * @param {string} evento a chave de `FALAS`
 * @param {object} [dados] `{ nome, alvo, termo }`
 * @param {() => number} [rng] fonte de aleatoriedade (o teste injeta)
 * @returns {string} a fala pronta, ou '' se o evento não existe
 */
export function falaDoEvento(evento, dados = {}, rng = Math.random) {
  const lista = FALAS[String(evento || '')];
  if (!Array.isArray(lista) || !lista.length) return '';
  const r = typeof rng === 'function' ? Number(rng()) : Math.random();
  const i = Math.min(Math.max(Math.floor(r * lista.length), 0), lista.length - 1);
  let frase = lista[i];
  const trocas = {
    '{nome}': String(dados.nome || '').trim(),
    '{alvo}': String(dados.alvo || '').trim(),
    '{termo}': String(dados.termo || '').trim()
  };
  for (const [marca, valor] of Object.entries(trocas)) {
    // Marcador sem valor: tira a marca e limpa a pontuação/espaço que sobra.
    frase = valor
      ? frase.split(marca).join(valor)
      : frase.replace(new RegExp(`\\s*${marca.replace(/[{}]/g, '\\$&')}\\s*`, 'g'), ' ');
  }
  return frase
    .replace(/\s+([,.!?])/g, '$1')
    .replace(/^\s*[,;:]\s*/, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.!?])/g, '$1')
    .trim();
}

/** Os eventos conhecidos (para o teste e para quem quiser listar). */
export function eventosConhecidos() {
  return Object.keys(FALAS);
}
