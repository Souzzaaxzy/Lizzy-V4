/**
 * MENÇÃO de um usuário do grupo por NOME — "Lizzy, chama o Fulano pra mim".
 *
 * ## O pedido do dono
 *
 * *"eu também quero que ela seja capaz de mencionar usuários do grupo, seja
 * admins, dono dela, dono do grupo, mods/alphas, ou até usuários: 'lizzy, chama
 * o usuário para mim' — ela procura o @user com o nome semelhante ou puxa na
 * memória dela e menciona o usuário dizendo que certa pessoa quer falar com
 * ele."*
 *
 * ## Duas responsabilidades, separadas de propósito
 *
 * 1. **RECONHECER** o pedido (aqui, `identificarPedidoDeMencao`) — é padrão
 *    conhecido, não palpite: um LLM inventaria um nome e mencionaria a pessoa
 *    errada.
 * 2. **RESOLVER** o nome para um JID (`acharUsuarioPorNome`) — a busca roda
 *    sobre os participantes do grupo, com o NOME já resolvido pelo resolvedor
 *    único (`utils/contactName.js`) e o apelido do contador como reserva.
 *
 * O módulo é **PURO**: não conhece socket. Quem tem o socket (o handler)
 * resolve os nomes e passa a lista pronta.
 *
 * ## Ambiguidade
 *
 * "chama o João" num grupo com dois Joões **não** escolhe um no chute: devolve
 * `{ ambiguo: true, candidatos }` e o chamador pergunta qual. Escolher errado
 * aqui significaria mencionar a pessoa errada em público.
 *
 * ## MENÇÃO por PAPEL (pedido do dono, out/2026)
 *
 * *"ela tem que saber diversificar a menção a tal usuário também, tipo o dono do
 * grupo e tal"*. Então o alvo pode ser um CARGO, não só um nome:
 *
 * | o que se pede | papel |
 * |---|---|
 * | "chama o dono do grupo" | `dono_grupo` |
 * | "chama o dono do bot" / "o dono dela" | `dono_bot` |
 * | "chama um admin" / "chama o adm" | `admin` |
 * | "chama um mod" / "um moderador" | `mod` |
 * | "chama um alpha" | `alpha` |
 *
 * Papel de UMA pessoa (dono do grupo/bot) vai direto nela. Papel de VÁRIAS
 * ("um admin") escolhe **uma** — é o que a palavra "um" quer dizer. Papel sem
 * ninguém avisa (não inventa alvo).
 */

/**
 * Os separadores/ENFEITES que saem do nome antes de comparar.
 *
 * O nome do dono e' `𝐊𝐚𝐧𝐧𝐨𝐧ᰔ𝐠𝐢 𖤐 𝐬𝐞ɪ𝐭𝐚 𝐦𝐭𝐱` — depois do NFKC fica
 * `Kannonᰔgi ...`. Ninguem fala "kannon-simbolo-gi": o dono fala **"kannongi"**.
 * Entao os simbolos/enfeites viram NADA (juntam as partes) e so' o que sobra e'
 * comparado. E' o que faz "kannongi" casar o nome real.
 */
const ENFEITE_RE = new RegExp([
  '[\\u2000-\\u206F]', // espacos/pontuacao de largura zero e afins
  '[\\u2190-\\u2BFF]', // setas, formas, dingbats (o ✦ 𖤐)
  '[\\u2E00-\\u2E7F]',
  '[\\u3000-\\u303F]', // CJK (inclui o ㅤ U+3164 do filler)
  '[\\u3164]',
  '[\\uA700-\\uA71F]', // modificadores de tom
  '[\\u1C00-\\u1C4F]', // o ᰔ (LEPCHA) que o dono usa no nome
  '[\\uFE00-\\uFE0F]',
  '[\\uFE30-\\uFE4F]',
  '[\\uFF00-\\uFF0F\\uFF1A-\\uFF20\\uFF3B-\\uFF40\\uFF5B-\\uFF65]', // pontuacao de largura total
  '[\\u{1F000}-\\u{1FAFF}]', // emoji
  '[\\u{1D400}-\\u{1D7FF}]' // MATHEMATICAL (o nome "bonito", caso o NFKC falhe)
].join('|'), 'gu');

/**
 * As letras que SÃO parecidas com uma letra latina mas não são (IPA/fonética).
 *
 * O nome do dono tem `ɪ` (U+026A, LETRA PEQUENA LATINA IOTA) em "s**ɪ**ta" — o
 * NFKC **não** troca isso por "i", porque é uma letra de verdade em outro
 * alfabeto. Sem este mapa, "seita" nunca casaria "sɪta".
 */
const LETRAS_PARECIDAS = {
  '\u026A': 'i', '\u0269': 'i', '\u0268': 'i', '\u0131': 'i', '\u1D62': 'i',
  '\u0261': 'g', '\u0262': 'g',
  '\u1D00': 'a', '\u0251': 'a', '\u0250': 'a',
  '\u03B1': 'a', '\u03B5': 'e', '\u03B9': 'i', '\u03BF': 'o', '\u03C5': 'u',
  '\u03C1': 'p', '\u03BA': 'k', '\u03C4': 't', '\u03BD': 'v',
  '\u0274': 'n', '\u0271': 'm', '\u0280': 'r', '\u0281': 'r',
  '\u029F': 'l', '\u0299': 'b', '\u1D04': 'c', '\u1D05': 'd'
};

/**
 * Reduz o nome a letras+digitos, para comparar: NFKC (o nome bonito), tira
 * acento, remove enfeites/simbolos/emoji e colapsa espaco.
 *
 * @param {string} texto
 * @returns {string}
 */
function chaveNome(texto) {
  let t = String(texto || '');
  try { t = t.normalize('NFKC'); } catch { /* ok */ }
  try { t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch { /* ok */ }
  t = t.replace(ENFEITE_RE, '');
  // Tira o que nao e' letra/numero/espaco (pontuacao solta, underline...).
  t = t.replace(/[^\p{L}\p{N}\s]/gu, ' ');
  t = t.toLowerCase();
  // Letras parecidas (IPA) viram a latina equivalente.
  t = t.replace(/[\u026A\u0269\u0268\u0131\u1D62\u0261\u0262\u1D00\u0251\u0250\u03B1\u03B5\u03B9\u03BF\u03C5\u03C1\u03BA\u03C4\u03BD\u0274\u0271\u0280\u0281\u029F\u0299\u1D04\u1D05]/g,
    (c) => LETRAS_PARECIDAS[c] || c);
  return t.replace(/\s+/g, ' ').trim();
}

/**
 * Reduz o nome a uma forma TOLERANTE às trocas do STT.
 *
 * O STT erra as letras de som parecido: **C↔K**, **G↔K**, **S↔C**, **PH↔F**,
 * **Y↔I**, **W↔V**. O dono pediu *"marca a cangica"* e o nome real é
 * **"Cangica"** — com `kangica` não casaria.
 *
 * O que NÃO entra aqui: vogal→vogal (transformaria "maria" em "meria" e
 * qualquer nome casaria qualquer um). Só as consoantes de som ambíguo.
 *
 * @param {string} chave o resultado de `chaveNome`
 * @returns {string}
 */
function chaveSonora(chave) {
  return String(chave || '')
    .replace(/c(?=[ei])/g, 's')  // ce/ci = "se"/"si"
    .replace(/c/g, 'k')          // ca/co/cu = "ka/ko/ku"
    .replace(/q/g, 'k')
    .replace(/g(?=[ei])/g, 'j')  // ge/gi = "je/ji"
    .replace(/ph/g, 'f')
    .replace(/y/g, 'i')
    .replace(/w/g, 'v')
    .replace(/z/g, 's')
    .replace(/ll/g, 'l')
    .replace(/(.)\1+/g, '$1');   // letra dobrada vale uma ("kann" -> "kan")
}

/**
 * Os PRONOMES que podem substituir o nome ("menciona ele", "chama ela").
 *
 * E' o caso real do dono: ela disse o nome do dono do grupo, ele respondeu
 * *"menciona ele ai"* — e sem isto o pronome virava um "nome" que nao existe.
 * Quem chama resolve o pronome pelo ULTIMO alvo da conversa (o handler guarda).
 */
const PRONOMES = new Set(['ele', 'ela', 'eles', 'elas', 'esse', 'essa', 'este', 'esta', 'aquele', 'aquela']);

/** Palavras que não são nome de ninguém (cargos, artigos, o próprio bot). */
const PALAVRAS_VAZIAS = new Set([
  'lizzy', 'abyss', 'bot', 'eu', 'mim', 'me', 'ele', 'ela', 'eles', 'elas',
  'o', 'a', 'os', 'as', 'um', 'uma', 'do', 'da', 'dos', 'das', 'de', 'no', 'na',
  'para', 'pra', 'pro', 'por', 'favor', 'pfv', 'ai', 'aqui', 'agora', 'ja',
  'usuario', 'pessoa', 'membro', 'membros', 'alguem', 'todos', 'geral', 'grupo',
  'adm', 'admin', 'adms', 'admins', 'administrador', 'administradores',
  'dono', 'dona', 'chefe', 'criador', 'mod', 'mods', 'moderador', 'moderadores',
  'alpha', 'alphas', 'sub', 'subdono', 'subdonos', 'vip', 'vips', 'membro'
]);

/**
 * Os PAPÉIS que podem ser pedidos no lugar de um nome.
 *
 * A ordem importa: "dono do grupo" tem de ser testado antes de "dono" solto, e
 * "dono do bot" antes de "dono" — senão o mais genérico venceria.
 */
const PAPEIS = [
  // O DONO DO GRUPO (quem criou). "dono do grupo", "dono daqui", "criador".
  ['dono_grupo', /\b(dono|dona|criador|criadora)\s+(do|da|deste|desse|do\s+mesmo)?\s*(grupo|gp|group|aqui|daqui|chat)\b/i],
  ['dono_grupo', /\b(dono|dona)\s+(do|da)\s+(grupo|gp|group)\b/i],
  // O DONO DO BOT (o dono dela). "dono do bot", "dono dela", "meu dono".
  ['dono_bot', /\b(dono|dona|criador|criadora)\s+(do|da|de)?\s*(bot|robo|robô|lizzy|abyss|assistente)\b/i],
  ['dono_bot', /\b(meu|teu|seu)\s+dono\b/i],
  ['dono_bot', /\bdono\s+dela\b/i],
  // ADMIN. "admin", "adm", "administrador", "admins".
  ['admin', /\b(admin|adms|admins|administrador|administradores|adm)\b/i],
  // MOD / ALPHA (cargos do BOT, nao do WhatsApp).
  ['mod', /\b(mod|mods|moderador|moderadora|moderadores)\b/i],
  ['alpha', /\b(alpha|alphas)\b/i]
];

/**
 * O papel pedido, se houver um.
 * @param {string} t texto ja' normalizado
 * @returns {string|null}
 */
function papelPedido(t) {
  for (const [papel, re] of PAPEIS) if (re.test(t)) return papel;
  return null;
}

/** Verbos que transformam a menção em um PEDIDO. */
const VERBO_PEDIDO = 'chama|chamar|chame|menciona|mencionar|mencione|marca|marcar|marque|avisa|avisar|avise|cutuca|cutucar|cutuque|acorda|acordar|acorde|puxa|puxar|puxe|traz|trazer|toca\\s+em|fala\\s+com|falar\\s+com';

/** Alvos que indicam "quer falar com ele" (a mensagem é sobre falar). */
const QUER_FALAR = /\b(quer|queria|querem|precisa|precisam|ta|esta|estao)\s+(falar|conversar|falar\s+com|conversar\s+com)\b/i;

/**
 * Normaliza: sem acento, minúsculo, sem pontuação e sem o nome do agente.
 * (O STT erra acento — a mesma lição do `iapComandos`.)
 */
function normalizar(texto) {
  let t = String(texto || '')
    .replace(/[,.!?;:]+/g, ' ')
    .replace(/\b(lizzy|abyss)\b/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  try {
    // NFKC PRIMEIRO: e' o que desfaz o "nome bonito" do WhatsApp. O
    // `𝐊𝐚𝐧𝐧𝐨𝐧` (MATHEMATICAL BOLD) NAO tem decomposicao NFD — sem o NFKC ele
    // continuava sendo os code points de matematica, e "kannongi" nunca casava
    // com o nome real (o erro relatado pelo dono).
    t = t.normalize('NFKC');
  } catch { /* ok */ }
  try { t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch { /* ok */ }
  return t;
}

/**
 * O texto é um PEDIDO DE MENÇÃO?
 *
 * @param {string} texto a mensagem (já sem o nome do agente)
 * @returns {{ nome: string, querFalar: boolean }|null} `null` quando não é
 */
export function identificarPedidoDeMencao(texto) {
  const bruto = String(texto || '').trim();
  if (!bruto) return null;
  const t = normalizar(bruto);
  if (!t) return null;

  // Exige um verbo de pedido de menção. Sem ele, "o Fulano falou comigo" é
  // conversa — e viraria uma menção indesejada.
  const re = new RegExp(`\\b(${VERBO_PEDIDO})\\b\\s*(o\\s+|a\\s+|os\\s+|as\\s+|um\\s+|uma\\s+)?(.+)$`, 'i');
  const m = re.exec(t);
  if (!m) return null;

  // PAPEL antes de nome: "chama o dono do grupo" não tem nome nenhum — o alvo
  // é o CARGO.
  const papel = papelPedido(t);
  if (papel) {
    const querFalar0 = QUER_FALAR.test(t)
      || /\b(quer\w*|precisa\w*|gostaria)\b[^]*\b(falar|conversar)\b/i.test(t)
      || /\b(pra|para)\s+mim\b/i.test(t);
    return { nome: '', papel, querFalar: querFalar0 };
  }

  // O que sobra depois do verbo é o nome (o artigo já saiu no grupo acima).
  let nome = String(m[3] || '').trim();
  // Tira as caudas comuns do pedido.
  nome = nome
    .replace(/\b(para|pra|pro|por|aqui|agora|pfv|pf|por\s+favor)\b.*$/i, '')
    .replace(/\b(que|quem)\b.*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!nome) return null;
  // Um nome de uma letra só não é nome.
  if (nome.replace(/\s/g, '').length < 2) return null;
  // PRONOME ("menciona ele"): o alvo e' o ULTIMO da conversa — quem chama
  // resolve (o handler guarda o ultimo alvo por grupo).
  // O pronome pode vir com particula ("ele ai", "ele aqui", "ela mesmo").
  const chaveNome0 = chaveNome(nome).replace(/\s+(ai|aqui|mesmo|la|agora)$/i, '').trim();
  if (PRONOMES.has(chaveNome0)) {
    const querFalarP = QUER_FALAR.test(t)
      || /\b(quer\w*|precisa\w*|gostaria)\b[^]*\b(falar|conversar)\b/i.test(t)
      || /\b(pra|para)\s+mim\b/i.test(t);
    return { nome: '', pronome: chaveNome0, querFalar: querFalarP };
  }
  // "chama o usuario" (sem nome) é pedido, mas sem alvo: o chamador pergunta.
  // `quer\w*` cobre "quer/quero/queriam/precisa" — o `\bquer\b` nao casaria
  // "quero falar com ele". E "chama X PRA MIM" tambem e' "eu quero falar com X"
  // (e' como o dono pediu: *"menciona o usuario dizendo que certa pessoa quer
  // falar com ele"*).
  const querFalar = QUER_FALAR.test(t)
    || /\b(quer\w*|precisa\w*|gostaria)\b[^]*\b(falar|conversar)\b/i.test(t)
    || /\b(pra|para)\s+mim\b/i.test(t);
  return { nome, querFalar };
}

/**
 * Compara um nome dito com o nome real de alguém.
 *
 * A regra é **conservadora** de propósito: casar demais significa mencionar a
 * pessoa errada. Ordem:
 *   1. igual (sem acento/caixa);
 *   2. o nome real COMEÇA com o dito ("jo" -> "João Silva");
 *   3. o dito é um PEDAÇO inteiro do nome real ("silva" -> "João Silva");
 *   4. o dito é um pedaço de uma das PALAVRAS do nome real ("sil" -> "Silva").
 *
 * @param {string} dito
 * @param {string} real
 * @returns {number} 0 = não casa; maior = casamento melhor
 */
export function pontuarNome(dito, real) {
  const a = chaveNome(dito);
  const b = chaveNome(real);
  if (!a || !b) return 0;
  if (a === b) return 100;
  // O nome real é só o número (não casou nome nenhum): vale pouco.
  if (/^\d+$/.test(b)) return 0;
  // O nome sem os ESPACOS: "kannongi" == "kannon gi". E' o caso do dono.
  const bJunto = b.replace(/\s/g, '');
  const aJunto = a.replace(/\s/g, '');
  if (aJunto && aJunto === bJunto) return 98;
  const palavras = b.split(/\s+/).filter(Boolean);
  // Nome real começa com o dito (palavra inteira): "jo" NÃO casa "joão" por
  // aqui (é prefixo de palavra, não de token) — cai no caso do prefixo.
  if (palavras[0] === a) return 90;
  if (palavras.includes(a)) return 80;
  // Prefixo de alguma palavra do nome real ("sil" -> "silva").
  if (palavras.some((p) => p.startsWith(a) && a.length >= 3)) return 60;
  // Prefixo do nome JUNTO ("kannong" -> "kannongi").
  if (aJunto.length >= 4 && bJunto.startsWith(aJunto)) return 55;
  // O CONTRARIO: o dito COMECA com o nome real ("kannongi" comeca com "kannon").
  // E' o caso do dono: o nome e' "Kannon ..." e ele fala o apelido composto
  // "kannongi". Exige 5+ letras para nao casar "ana" dentro de "anabella".
  if (bJunto.length >= 5 && aJunto.startsWith(bJunto)) return 52;
  // O dito comeca com a PRIMEIRA PALAVRA do nome (com o resto colado): o mesmo
  // caso, quando o nome tem mais partes ("kannongi" x "kannon gi").
  if (palavras[0] && palavras[0].length >= 5 && aJunto.startsWith(palavras[0])) return 51;
  // O nome real INTEIRO contém o dito como pedaço (nome composto falado junto).
  if (bJunto.includes(aJunto) && aJunto.length >= 3) return 50;
  // SONORA (o STT troca C/K, G/J, S/Z...): "kangica" casa "cangica". Exige
  // tamanho minimo para nao casar qualquer coisa.
  const aSom = chaveSonora(aJunto);
  const bSom = chaveSonora(bJunto);
  if (aSom.length >= 4 && bSom.length >= 4) {
    if (aSom === bSom) return 88;
    if (bSom.startsWith(aSom)) return 54;
    if (bSom.includes(aSom)) return 48;
  }
  return 0;
}

/**
 * Acha o usuário pelo nome dito.
 *
 * @param {string} dito o nome que a pessoa falou
 * @param {Array<{id: string, nome: string, apelido?: string, numeros?: string[]}>} usuarios
 *   os candidatos, com o NOME já resolvido (o handler monta com o resolvedor único)
 * @param {object} [opts]
 * @param {string} [opts.numero] um número digitado (casa direto, sem ambiguidade)
 * @returns {{ achou: boolean, ambiguo?: boolean, usuario?: object, candidatos?: object[] }}
 */
export function acharUsuarioPorNome(dito, usuarios = [], opts = {}) {
  const lista = Array.isArray(usuarios) ? usuarios.filter((u) => u && u.id) : [];
  if (!lista.length) return { achou: false };

  // NÚMERO digitado/falado: casa direto (não é ambíguo).
  const numero = String(opts.numero || dito || '').replace(/\D/g, '');
  if (numero.length >= 8) {
    const porNumero = lista.find((u) => (u.numeros || []).some((n) => String(n).replace(/\D/g, '').endsWith(numero))
      || String(u.id).replace(/\D/g, '').endsWith(numero));
    if (porNumero) return { achou: true, usuario: porNumero };
  }

  // A palavra dita não pode ser um cargo/palavra vazia.
  const chave = chaveNome(dito);
  if (!chave || PALAVRAS_VAZIAS.has(chave)) return { achou: false };

  // Pontua contra o NOME e o APELIDO (o apelido do contador é a reserva).
  const pontuados = lista
    .map((u) => ({ u, p: Math.max(pontuarNome(chave, u.nome), pontuarNome(chave, u.apelido)) }))
    .filter((x) => x.p > 0)
    .sort((a, b) => b.p - a.p || String(a.u.nome).localeCompare(String(b.u.nome)));

  if (!pontuados.length) return { achou: false };

  const melhor = pontuados[0].p;
  const empatados = pontuados.filter((x) => x.p === melhor);
  // Mais de um com a MESMA pontuação: não escolhe no chute.
  if (empatados.length > 1) {
    return { achou: false, ambiguo: true, candidatos: empatados.map((x) => x.u) };
  }
  return { achou: true, usuario: pontuados[0].u };
}

/**
 * Acha o usuário pelo NOME usando a lista de participantes do grupo.
 *
 * @param {string} dito
 * @param {Array} usuarios candidatos já com o nome resolvido
 * @param {object} [opts]
 * @returns {{ achou: boolean, ambiguo?: boolean, usuario?: object, candidatos?: object[] }}
 */
export function resolverMencao(dito, usuarios, opts = {}) {
  return acharUsuarioPorNome(dito, usuarios, opts);
}

/**
 * Acha o alvo de um PAPEL ("dono do grupo", "um admin", "um mod").
 *
 * Cada candidato carrega as marcas do papel (`ehDonoGrupo`, `ehDonoBot`,
 * `ehAdmin`, `ehMod`, `ehAlpha`) — quem monta a lista é o handler, que tem o
 * metadata. Aqui só se escolhe.
 *
 * Papel de UMA pessoa (dono do grupo/bot) devolve ela. Papel de VÁRIAS escolhe
 * **uma** (é o que "um admin" quer dizer). Papel vazio devolve `{achou:false}` —
 * nunca inventa alvo.
 *
 * @param {string} papel
 * @param {Array<object>} usuarios
 * @param {() => number} [rng] fonte de aleatoriedade (o teste injeta)
 * @returns {{ achou: boolean, usuario?: object, papel: string, vazio?: boolean }}
 */
export function acharUsuarioPorPapel(papel, usuarios = [], rng = Math.random) {
  const marca = {
    dono_grupo: 'ehDonoGrupo',
    dono_bot: 'ehDonoBot',
    admin: 'ehAdmin',
    mod: 'ehMod',
    alpha: 'ehAlpha'
  }[String(papel || '')];
  const lista = Array.isArray(usuarios) ? usuarios.filter((u) => u && u.id) : [];
  if (!marca) return { achou: false, papel, vazio: true };
  const candidatos = lista.filter((u) => u[marca]);
  if (!candidatos.length) return { achou: false, papel, vazio: true };
  // Papel de varias pessoas: escolhe UMA ("um admin" = qualquer admin).
  const r = typeof rng === 'function' ? Number(rng()) : Math.random();
  const i = Math.min(Math.max(Math.floor(r * candidatos.length), 0), candidatos.length - 1);
  return { achou: true, usuario: candidatos[i], papel };
}
