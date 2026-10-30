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
 */

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
  const a = normalizar(dito).toLowerCase();
  const b = normalizar(real).toLowerCase();
  if (!a || !b) return 0;
  if (a === b) return 100;
  // O nome real é só o número (não casou nome nenhum): vale pouco.
  if (/^\d+$/.test(b)) return 0;
  const palavras = b.split(/\s+/).filter(Boolean);
  // Nome real começa com o dito (palavra inteira): "jo" NÃO casa "joão" por
  // aqui (é prefixo de palavra, não de token) — cai no caso 4.
  if (palavras[0] === a) return 90;
  if (palavras.includes(a)) return 80;
  // Prefixo de alguma palavra do nome real ("sil" -> "silva").
  if (palavras.some((p) => p.startsWith(a) && a.length >= 3)) return 60;
  // O nome real INTEIRO contém o dito como pedaço (nome composto falado junto).
  if (b.includes(a) && a.length >= 3) return 50;
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
  const chave = normalizar(dito).toLowerCase();
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
