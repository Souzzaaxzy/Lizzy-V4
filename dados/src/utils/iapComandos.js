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
 *
 * Os padroes sao SEM ACENTO (o texto chega normalizado pelo `paraPadroes`).
 */
const POR_PLATAFORMA = [
  ['figualeatoria', [
    /\bfig(urinha|ura)?s?\s*(aleatori[ao]|random)\b/i,
    /\b(sticker|figurinha|figura)s?\s*(aleatori[ao]|random)\b/i,
    // "manda um sticker" / "manda uma figurinha" (sem dizer "aleatoria"):
    // so' vale com verbo de PEDIDO, senao "aquela figurinha e' boa" viraria.
    /\b(manda|mandar|manda\s+um|envia|envie|me\s+manda|quero|queria)\b[^]*\b(figurinha|figura|sticker)s?\b/i,
    /\bmanda\s+(uma?|o|a)?\s*(figurinha|figura|sticker)s?\b/i
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
 * Verbos FORTES de "tocar" — so' se pede para TOCAR algo com eles.
 * Inclui as confusoes comuns do STT (`toga`/`toka` por "toca").
 */
const VERBO_TOCAR = 'toca|tocar|toque|toka|toga|bota|botar|coloca|colocar|poe|poem|play|escuta|escutar|ouve|ouvir';

/** Verbos de PEDIDO genericos (procura/baixa/manda...). */
const VERBO_PEDIDO = 'procura|procurar|busca|buscar|acha|achar|baixa|baixar|manda|mandar|traz|quero|queria|gostaria|pode|poderia|vou|vamos';

/** Palavras que indicam MUSICA/AUDIO (dispensam o termo explicito). */
const PALAVRA_MUSICA = /\b(musicas?|som|sons|faixa|faixas|audio|audios|cancao|cancoes|clipe|clipes|playlist|album|banda|cantor|cantora|mc|dj|funk|sertanejo|pagode|samba|rock|mpb|forro|axe|gospel|melodia)\b/i;

/**
 * Objetos que NAO sao musica: com eles, "toca" e' verbo comum ("toca o
 * telefone", "toca a campainha", "toca piano"). Bloqueia o falso positivo.
 */
const OBJETO_NAO_MUSICAL = /\b(telefone|celular|campainha|sirene|alarme|buzina|interfone|sino|porta|violao|guitarra|piano|bateria|teclado|flauta|saxofone|violino|trompete|cavaquinho|sanfona|harpa|tambor|acordeon)\b/i;

/** Palavras que NUNCA devem disparar comando (a pessoa esta' falando DE algo). */
const NAO_E_PEDIDO = /\b(como\s+(toca|baixa|faz)|que\s+musica|qual\s+(e\s+)?(a\s+)?musica|essa\s+musica\s+(e|é)\s+boa|nao\s+(toca|baixa|procura)|não\s+(toca|baixa|procura)|toca\s+o\s+telefone)\b/i;

/** Uma URL no texto (link de musica/video). Ela NUNCA deve ser alterada. */
const URL_RE = /https?:\/\/[^\s]+|\b(?:www\.)?[a-z0-9-]+\.(?:com|net|org|br|tv|me|io|xyz)(?:\/[^\s]*)?/i;

/** Prefixos de pedido que aparecem ANTES do verbo ("me toca X", "pode tocar X"). */
const PREFIXO = /^\s*(me|pode|poderia|por\s+favor|pfv|pf|da|faz|faz\s+um|da\s+um|quero|queria|gostaria|vou|vamos|em)\s+/i;

/**
 * Normaliza o texto para os TESTES de padrao: sem o nome do agente, sem
 * pontuacao que atrapalha os `^` e SEM ACENTO.
 *
 * ## Por que sem acento
 *
 * O STT erra acento o tempo todo — "Tóca evidencias" chega com acento na palavra
 * ERRADA, e o padrao `toca` nao casaria (era o bug do "diz que vai tocar e nao
 * toca"). O `iapGuarda` ja' fazia o mesmo.
 *
 * @param {string} texto
 * @returns {string}
 */
function paraPadroes(texto) {
  let t = String(texto || '')
    .replace(/[,.!?;:]+/g, ' ')
    .replace(/\b(lizzy|abyss)\b/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  try { t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch { /* ok */ }
  return t;
}

/** O texto (normalizado) e' um pedido de tocar musica? */
function ehPedidoDePlay(t) {
  const temMusica = PALAVRA_MUSICA.test(t);
  // Objeto que nao e' musica e nenhuma palavra de musica: NAO e' play.
  if (OBJETO_NAO_MUSICAL.test(t) && !temMusica) return false;
  // 1) Verbo de tocar + palavra de musica ("toca uma musica", "bota um som").
  if (new RegExp(`\\b(${VERBO_TOCAR})\\b`, 'i').test(t) && temMusica) return true;
  // 2) Pedido de OUVIR/ESCUTAR ("quero ouvir Djavan", "queria escutar X").
  if (new RegExp(`\\b(${VERBO_PEDIDO})\\b[^]*\\b(ouvir|escutar|tocar)\\b`, 'i').test(t)) return true;
  // 2b) Verbo de PEDIDO + palavra de MUSICA ("baixa a musica X", "procura a
  //     musica Y", "manda a musica Z") — o pedido esta' no verbo, e "musica"
  //     confirma o tipo.
  if (temMusica && new RegExp(`\\b(${VERBO_PEDIDO}|manda|mandar)\\b`, 'i').test(t)) return true;
  // 3) Verbo FORTE de tocar no comeco (com prefixos) + um termo qualquer.
  if (new RegExp(`^(me\\s+|pode\\s+|poderia\\s+|por\\s+favor\\s+|pfv\\s+|da\\s+um\\s+|faz\\s+um\\s+|faz\\s+|quero\\s+)?(${VERBO_TOCAR})\\s+\\S`, 'i').test(t)) return true;
  // 4) "da um play em X" / "play X".
  if (/\bplay\b\s+(em\s+)?\S/.test(t)) return true;
  return false;
}

/**
 * Limpa o argumento: tira o verbo/pedido, os prefixos e as palavras que so'
 * descrevem o tipo ("musica", "video").
 *
 * Ex.: "me toca a musica Evidencias" -> "Evidencias"
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

  // SEM ACENTO (o STT erra acento): a limpeza casa os verbos; o ACENTO do termo
  // buscado e' recuperado no fim (a busca e' sensivel a acento).
  let t = String(texto || '').trim();
  try { t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch { /* ok */ }

  t = t.replace(/[,.!?;:]+/g, ' ');
  t = t.replace(/^\s*(oi|ola|ei|hey)\s+/i, ' ');
  t = t.replace(/\blizzy\b/gi, ' ');
  t = t.replace(/\b(para|pra|pro)\s+mim\b/gi, ' ');
  t = t.replace(/\b(por\s+favor|pfv|pf)\b/gi, ' ');
  if (comando === 'tiktok') {
    t = t.replace(/\btik\s*tok\b/gi, ' ');
    t = t.replace(/\b(esse|essa|este|esta|o|a|um|uma)\s+(video|clipe)\b/gi, ' ');
    t = t.replace(/^\s*(video|clipe|do|da|de)\s+/i, ' ');
  }
  if (comando === 'pin') t = t.replace(/\b(no\s+)?pinterest\b/gi, ' ');
  if (comando === 'figualeatoria') return '';

  // Tira prefixo + verbo/pedido + artigo + a palavra do tipo, REPETIDAMENTE.
  const VERBO = new RegExp(`^\\s*(${VERBO_TOCAR}|${VERBO_PEDIDO}|pesquisa|pesquisar)\\b`, 'i');
  for (let i = 0; i < 5; i++) {
    const antes = t;
    t = t.replace(PREFIXO, ' ');
    t = t.replace(VERBO, ' ');
    t = t.replace(/^\s*(a|o|as|os|uma|um|esse|essa|este|esta|meu|minha|aquela|aquele|em)\s+/i, ' ');
    t = t.replace(/^\s*(musica|musicas|som|sons|faixa|audio|video|clipe|playlist|album|do|da|de)\s+/i, ' ');
    // "toca essa musica" sem nome: sobra so' o tipo -> vazio (ela pergunta).
    if (/^\s*(musica|musicas|som|sons|faixa|audio|video|clipe|playlist|album)\s*$/i.test(t)) { t = ''; break; }
    if (t === antes) break;
  }
  t = t.replace(/\s{2,}/g, ' ').trim();
  t = t.replace(/^[.,;:!?\-\s]+|[.,;:!?\-\s]+$/g, '').trim();
  if (!t) return '';

  // PRESERVA O ACENTO do termo buscado (recupera a forma original palavra a
  // palavra) — "Evidencias" e "Evidências" nao sao a mesma consulta.
  const originais = String(texto || '')
    .replace(/[,.!?;:]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const semAcento = (v) => { try { return v.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch { return v; } };
  return t.split(' ').map((palavra) => {
    const achado = originais.find((o) => semAcento(o).toLowerCase() === palavra.toLowerCase());
    return achado || palavra;
  }).join(' ');
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
    if (new RegExp(`\\b(${VERBO_PEDIDO}|manda|mandar|baixa|baixar)\\b`).test(t)) return { comando, args: '' };
    return null;
  }

  // 2) PLAY -- so' quando e' PEDIDO de tocar/ouvir (nunca "amo essa musica").
  if (ehPedidoDePlay(t)) {
    const args = extrairArgs(bruto, 'play');
    // Sem termo ("toca essa musica"): devolve vazio -> quem chama PERGUNTA.
    return { comando: 'play', args };
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
