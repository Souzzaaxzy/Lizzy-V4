/**
 * COMANDOS POR VOZ do `!iap` -- a Lizzy entende o pedido falado e executa.
 *
 * ## O pedido do dono
 *
 * *"oi Lizzy, procura a musica <busca> para mim"* -> ela executa o `!play <busca>`.
 * Comecamos com QUATRO comandos, os que fazem sentido por fala (so' precisam de
 * TEXTO como argumento): `play`, `tiktok`, `pin` e `figualeatoria`.
 *
 * ## Por que a identificacao e' DETERMINISTICA (e nao pelo LLM)
 *
 * Um LLM acertaria a maioria -- e erraria o resto. Aqui a acao tem CONSEQUENCIA
 * (baixa midia, posta no grupo), entao o certo e' casar por PADROES conhecidos:
 * *"toca X"*, *"procura no pinterest X"*, *"manda uma figurinha"*. Se a fala nao
 * casar nenhum padrao, NAO e' comando -- vira conversa normal.
 *
 * ## Desambiguacao (a ordem importa)
 *
 * *"procura a musica X"* e *"procura no pinterest X"* comecam igual. A regra
 * olha primeiro a PLATAFORMA (tiktok/pinterest/figurinha) e so' depois a acao
 * generica (tocar/procurar) -- assim "procura no pinterest gatinhos" nunca vira
 * `play`.
 *
 * ## Quem pode
 *
 * **Só o dono.** O agente executa o comando EM NOME DELE (a mensagem e' reemitida
 * como se ele tivesse digitado), entao liberar para todos seria dar o bot inteiro
 * a qualquer um que fale perto do microfone. A checagem fica em quem chama
 * (`pensarComIa` recebe `ehDono`), e aqui so' se reconhece a INTENCAO.
 *
 * Modulo PURO: nao conhece socket, LLM nem audio -- e' so' texto -> intencao.
 */

/**
 * Os comandos que a voz pode disparar, com as frases que os descrevem.
 *
 * `exemplo` e' o que vai para o prompt (a Lizzy usa para se oferecer) e
 * `semArgs` diz se o comando funciona sozinho (ex.: figurinha aleatoria).
 */
export const COMANDOS_VOZ = Object.freeze({
  // A CHAVE e' o nome REAL do comando do bot (e' o que se executa). `exemplo`
  // vai para o prompt e `semArgs` diz se funciona sozinho.
  play: {
    descricao: 'toca/baixa uma musica do YouTube',
    exemplo: 'toca a musica Evidencias',
    semArgs: false
  },
  tiktok: {
    descricao: 'baixa um video do TikTok',
    exemplo: 'baixa esse video do tiktok',
    semArgs: false
  },
  pin: {
    descricao: 'pesquisa imagens no Pinterest',
    exemplo: 'procura no pinterest gatinhos',
    semArgs: false
  },
  figualeatoria: {
    descricao: 'manda uma figurinha aleatoria',
    exemplo: 'manda uma figurinha aleatoria',
    semArgs: true
  }
});

/**
 * Palavras que apontam para uma PLATAFORMA (checadas ANTES da acao generica).
 * Cada entrada e' `[comando, padroes]` -- o primeiro que casar vence.
 */
const POR_PLATAFORMA = [
  ['figualeatoria', [
    /\bfig(urinha|ura)?\s*(aleat[oó]ri[ao]|random)\b/i,
    /\b(sticker|figurinha)\s*(aleat[oó]ri[ao]|random)\b/i,
    /\bmanda\s+(uma\s+)?(figurinha|figura|sticker)\b/i,
    /\bfigurinha\s+aleat[oó]ria\b/i
  ]],
  ['tiktok', [
    /\btik\s*tok\b/i,
    /\btiktok\b/i
  ]],
  ['pin', [
    /\bpinterest\b/i,
    /\bno\s+pin\b/i,
    /\bpin\s+(do|de)\b/i
  ]]
];

/**
 * Padroes de ACAO generica (tocar/procurar musica). Só valem quando nenhuma
 * plataforma foi citada -- senao "procura no pinterest X" viraria `play`.
 */
const POR_ACAO = [
  ['play', [
    // Com a palavra "musica/som/faixa" o verbo de pedido ja' basta.
    /\b(toca|tocar|toque|bota|botar|coloca|colocar|poe|poem|po[õe]e)\b.*\b(m[uú]sica|som|faixa|[aá]udio|can[çc][aã]o)\b/i,
    /\b(procura|procurar|busca|buscar|acha|achar|baixa|baixar|quero\s+ouvir|manda)\b.*\b(m[uú]sica|som|faixa|[aá]udio|can[çc][aã]o)\b/i,
    /\b(m[uú]sica|som|faixa|[aá]udio|can[çc][aã]o)\b.*\b(toca|tocar|coloca|colocar|bota|botar)\b/i,
    // Verbo de tocar + um TERMO qualquer (o nome da musica). Exige um verbo
    // FORTE no comeco para nao casar "como toca violao" / "toca piano".
    /^\s*(toca|toque|bota|coloca|poe|play)\s+(?!violao|viol[ãa]o|guitarra|piano|bateria|um\s+instrumento)(\S.*)$/i
  ]]
];

/**
 * Palavras que, sozinhas, indicam que a pessoa esta' PEDINDO para executar algo
 * (e nao so' conversando). Ajuda a evitar casar "eu amo essa musica" como play.
 */
const VERBOS_DE_PEDIDO = /\b(toca|tocar|toque|bota|botar|coloca|colocar|poe|poem|po[õe]e|procura|procurar|busca|buscar|acha|achar|baixa|baixar|manda|mandar|quero|queria|pode|poderia|me\s+traz|traz)\b/i;

/** Palavras que NUNCA devem disparar comando (a pessoa esta' falando DE algo). */
const NAO_E_PEDIDO = /\b(como\s+(toca|baixa)|que\s+musica|qual\s+musica|essa\s+musica\s+(e|é)\s+boa|nao\s+(toca|baixa|procura)|não\s+(toca|baixa|procura))\b/i;

/** Uma URL no texto (link de musica/video). Ela NUNCA deve ser alterada. */
const URL_RE = /https?:\/\/[^\s]+|\b(?:www\.)?[a-z0-9-]+\.(?:com|net|org|br|tv|me|io|xyz)(?:\/[^\s]*)?/i;

/**
 * Normaliza o texto para os TESTES de padrao: sem o nome do agente e sem
 * pontuacao que atrapalha os `^`. Ex.: "Lizzy, coloca X" -> "coloca X".
 * @param {string} texto
 * @returns {string}
 */
function paraPadroes(texto) {
  let t = String(texto || '')
    .replace(/[,.!?;:]+/g, ' ')
    .replace(/\b(lizzy|abyss)\b/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  // SEM ACENTO: o STT erra acento o tempo todo — "Tóca evidencias" chega com
  // acento na palavra errada, e o padrao `toca` nao casaria. O `iapGuarda` ja'
  // faz o mesmo pelo mesmo motivo. Os padroes abaixo sao todos sem acento.
  try { t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch { /* ok */ }
  return t;
}

/**
 * Limpa o argumento: tira o verbo/pedido e as palavras da plataforma.
 *
 * Ex.: "procura a musica Evidencias pra mim" -> "Evidencias"
 *      "procura no pinterest gatinhos fofos" -> "gatinhos fofos"
 *
 * @param {string} texto
 * @param {string} comando
 * @returns {string}
 */
function extrairArgs(texto, comando) {
  // URL: se veio um link, ele E' o argumento (nao se mexe nele).
  const url = String(texto || '').match(URL_RE);
  if (url && /^https?:/i.test(url[0])) return url[0];

  // SEM ACENTO (o STT erra acento): "Toca evidencias" e "Toca evidencias" (com
  // acento em qualquer letra) tem de dar o MESMO argumento. Por isso os padroes
  // abaixo sao todos sem acento.
  let t = String(texto || '').trim();
  try { t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch { /* ok */ }

  // A virgula/pontuacao atrapalha os `^` abaixo: normaliza ANTES.
  t = t.replace(/[,.!?;:]+/g, ' ');
  t = t.replace(/^\s*(oi|ola|ei|hey)\s+/i, ' ');
  t = t.replace(/\blizzy\b/gi, ' ');
  t = t.replace(/\b(para|pra|pro)\s+mim\b/gi, ' ');
  t = t.replace(/\b(por\s+favor|pfv|pf)\b/gi, ' ');
  if (comando === 'tiktok') {
    t = t.replace(/\btik\s*tok\b/gi, ' ');
    // "baixa esse video do tiktok" -> o termo e' o que descreve o video; sem
    // termo util, devolve '' (o comando real pede link OU nome).
    t = t.replace(/\b(esse|essa|este|esta|o|a|um|uma)\s+(video|clipe)\b/gi, ' ');
    t = t.replace(/^\s*(video|clipe|do|da|de)\s+/i, ' ');
  }
  if (comando === 'pin') t = t.replace(/\b(no\s+)?pinterest\b/gi, ' ');
  // Tira o verbo/pedido do comeco, REPETIDAMENTE ("procura a musica X" -> "X").
  const VERBO = /^\s*(toca|tocar|toque|bota|botar|coloca|colocar|poe|poem|poe|procura|procurar|busca|buscar|acha|achar|baixa|baixar|manda|mandar|me\s+traz|traz|quero\s+ouvir|queria\s+ouvir|play|pesquisa|pesquisar)\b/i;
  for (let i = 0; i < 4; i++) {
    const antes = t;
    t = t.replace(VERBO, ' ');
    // Tira artigo/pronome e as palavras "musica/video" que so' descrevem o tipo.
    t = t.replace(/^\s*(a|o|as|os|uma|um|esse|essa|este|esta|meu|minha|aquela|aquele)\s+/i, ' ');
    t = t.replace(/^\s*(musica|som|faixa|audio|audio|musica|video|clipe|do|da|de)\s+/i, ' ');
    if (t === antes) break;
  }
  t = t.replace(/\s{2,}/g, ' ').trim();
  t = t.replace(/^[.,;:!?\-\s]+|[.,;:!?\-\s]+$/g, '').trim();
  if (!t) return '';
  // PRESERVA O ACENTO do termo buscado: a limpeza acima foi feita SEM acento
  // (para casar os verbos), mas o argumento vai para a BUSCA — "Evidencias" e
  // "Evidências" nao sao a mesma consulta. Recuperamos a forma original das
  // palavras que sobreviveram, comparando sem acento.
  const originais = String(texto || '')
    .replace(/[,.!?;:]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const semAcento = (v) => { try { return v.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch { return v; } };
  const saida = t.split(' ').map((palavra) => {
    const achado = originais.find((o) => semAcento(o).toLowerCase() === palavra.toLowerCase());
    return achado || palavra;
  }).join(' ');
  return saida;
}

/**
 * Identifica o comando pedido na fala.
 *
 * @param {string} texto a fala transcrita
 * @returns {{ comando: string, args: string }|null} `null` quando nao e' um pedido
 *   de comando conhecido (vira conversa normal).
 */
export function identificarComando(texto) {
  const bruto = String(texto || '').trim();
  if (!bruto) return null;
  // Testa sobre o texto NORMALIZADO (sem "Lizzy," na frente nem pontuacao):
  // assim "Lizzy, coloca Back to Black" casa o verbo no comeco.
  const t = paraPadroes(bruto);
  // Fala que apenas COMENTA sobre algo nunca vira comando.
  if (NAO_E_PEDIDO.test(t)) return null;

  // 1) Plataforma explicita (desambigua "procura ... pinterest" x "procura ... musica").
  for (const [comando, padroes] of POR_PLATAFORMA) {
    if (!padroes.some((re) => re.test(t))) continue;
    // Figurinha aleatoria funciona sozinha (o termo e' so' a descricao do
    // pedido: "manda uma figurinha aleatoria").
    if (COMANDOS_VOZ[comando]?.semArgs) return { comando, args: '' };
    const args = extrairArgs(bruto, comando);
    if (args) return { comando, args };
    // Citou a plataforma mas NAO deu o termo. Se foi um PEDIDO ("baixa um video
    // do tiktok"), devolve o comando sem args — quem chama PERGUNTA o termo em
    // vez de executar as cegas. Se foi so' um comentario ("vi no tiktok"), nao
    // e' comando.
    if (VERBOS_DE_PEDIDO.test(t)) return { comando, args: '' };
    return null;
  }

  // 2) Acao generica -- SO' com verbo de pedido (senao "amo essa musica" viraria play).
  if (VERBOS_DE_PEDIDO.test(t)) {
    for (const [comando, padroes] of POR_ACAO) {
      if (!padroes.some((re) => re.test(t))) continue;
      const args = extrairArgs(bruto, comando);
      if (args) return { comando, args };
    }
  }

  return null;
}

/**
 * Lista de frases para o prompt: a Lizzy usa para se OFERECER e para entender
 * que esses pedidos sao dela.
 * @returns {string}
 */
export function frasesDeAjuda() {
  return Object.entries(COMANDOS_VOZ)
    .map(([nome, c]) => `- "${c.exemplo}" -> ${nome}`)
    .join('\n');
}

/** Os nomes permitidos (allowlist) — usado para validar antes de executar. */
export function ehComandoPermitido(nome) {
  return Boolean(COMANDOS_VOZ[String(nome || '').toLowerCase()]);
}
