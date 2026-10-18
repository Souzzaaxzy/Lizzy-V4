import fs from 'fs';
import path from 'path';
import { DATABASE_DIR } from './paths.js';

/**
 * Registro das MENCOES por grupo e por dia.
 *
 * Pedido do dono: *"veja quem te marcou hoje e quantas vezes"* e *"consulte as
 * mencoes usando o numero da lista"*, com um `marcar <n>` que responde a
 * mensagem original com um ponto para o usuario voltar na conversa.
 *
 * O que e' guardado (por grupo):
 *
 *   {
 *     "<grupo>": {
 *       "<dia YYYY-MM-DD>": {
 *         "<quem foi marcado (JID/LID)>": [
 *           { de: "<quem marcou>", deNome: "...", id: "<id da mensagem>",
 *             em: <timestamp ms>, texto: "<trecho>" }
 *         ]
 *       }
 *     }
 *   }
 *
 * O `id` e' o que permite o `marcar` citar a mensagem ORIGINAL.
 *
 * Limites deliberados: por grupo, guardamos no maximo `MAX_POR_ALVO` registros
 * por alvo/dia (o suficiente para a lista) e `MAX_DIAS` dias. O arquivo nao
 * pode crescer sem fim num grupo movimentado.
 */

const MENCOES_FILE = path.join(DATABASE_DIR, 'mencoes.json');

/** Registros guardados por alvo, por dia. */
const MAX_POR_ALVO = 100;
/** Dias mantidos por grupo (o comando olha "hoje", mas guardar a semana ajuda). */
const MAX_DIAS = 7;

/** O dia no fuso de Sao Paulo (o mesmo dos agendamentos do bot). */
export function diaDeHoje(agora = new Date()) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return f.format(agora);   // YYYY-MM-DD
}

/** A base do JID: tira o `:device`. */
export function baseId(id) {
  if (!id || typeof id !== 'string') return '';
  return id.split(':')[0];
}

function ler() {
  try {
    const bruto = fs.readFileSync(MENCOES_FILE, 'utf-8');
    const d = JSON.parse(bruto);
    return d && typeof d === 'object' ? d : {};
  } catch {
    return {};
  }
}

function gravar(dados) {
  try {
    fs.mkdirSync(path.dirname(MENCOES_FILE), { recursive: true });
    // Escrita atomica (tmp unico + rename), como o resto do projeto.
    const tmp = `${MENCOES_FILE}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(dados, null, 2));
    fs.renameSync(tmp, MENCOES_FILE);
    return true;
  } catch {
    return false;
  }
}

/**
 * Registra UMA mencao.
 *
 * @param {object} p
 * @param {string} p.grupo    JID do grupo
 * @param {string} p.alvo     quem FOI marcado
 * @param {string} p.de       quem marcou
 * @param {string} [p.deNome] nome de quem marcou (para exibir)
 * @param {string} p.id       id da mensagem que marcou (para o `marcar`)
 * @param {string} [p.texto]  trecho do texto (contexto na lista)
 * @param {number} [p.em]     timestamp (ms)
 */
export function registrarMencao({ grupo, alvo, de, deNome, id, texto, em }) {
  if (!grupo || !alvo || !de || !id) return false;
  const alvoBase = baseId(alvo);
  const deBase = baseId(de);
  const dia = diaDeHoje(em ? new Date(em) : new Date());

  const dados = ler();
  dados[grupo] ||= {};
  dados[grupo][dia] ||= {};
  const lista = (dados[grupo][dia][alvoBase] ||= []);

  // Nao duplicar: a mesma mensagem registrada duas vezes (reconexao/retry).
  if (lista.some((r) => r.id === id && baseId(r.de) === deBase)) return false;

  lista.push({
    de: deBase,
    deNome: deNome || null,
    id,
    em: em || Date.now(),
    texto: texto ? String(texto).slice(0, 120) : null,
  });
  // Corta o excedente pelo MAIS ANTIGO.
  while (lista.length > MAX_POR_ALVO) lista.shift();

  // Poda dos dias antigos deste grupo.
  const dias = Object.keys(dados[grupo]).sort();
  while (dias.length > MAX_DIAS) {
    delete dados[grupo][dias.shift()];
  }

  return gravar(dados);
}

/**
 * As mencoes de HOJE para um alvo.
 *
 * @returns {Array<{de,deNome,id,em,texto}>} em ordem cronologica
 */
export function mencoesDeHoje(grupo, alvo, dia = diaDeHoje()) {
  const dados = ler();
  const lista = dados?.[grupo]?.[dia]?.[baseId(alvo)];
  return Array.isArray(lista) ? lista : [];
}

/**
 * Agrupa as mencoes de hoje por QUEM MARCOU (o que o comando mostra).
 *
 * @returns {Array<{de, deNome, total, primeira, ultima, registros}>}
 *          ordenado por total (desc) e depois pelo mais recente
 */
export function resumoDeHoje(grupo, alvo, dia = diaDeHoje()) {
  const lista = mencoesDeHoje(grupo, alvo, dia);
  const mapa = new Map();
  for (const r of lista) {
    const k = baseId(r.de);
    const atual = mapa.get(k) || {
      de: k, deNome: r.deNome, total: 0, primeira: r.em, ultima: r.em, registros: [],
    };
    atual.total += 1;
    if (r.em < atual.primeira) atual.primeira = r.em;
    if (r.em > atual.ultima) atual.ultima = r.em;
    if (r.deNome) atual.deNome = r.deNome;
    atual.registros.push(r);
    mapa.set(k, atual);
  }
  return [...mapa.values()].sort((a, b) => (b.total - a.total) || (b.ultima - a.ultima));
}

/**
 * Acha o registro de UM alvo pelo nome/numero digitado.
 *
 * Aceita o nome (comparacao sem acento/caixa, por conter) e o numero.
 *
 * ## O numero precisa de ajuda (MEDIDO)
 *
 * Em grupo o `de` e' um **LID** (`111000000000002@lid`), e o LID **nao contem
 * o numero de telefone** — sao namespaces diferentes. Entao "procurar pelos
 * digitos dentro do id" NAO funciona para LID.
 *
 * Por isso o chamador pode passar `telefonesDe(id)`: uma funcao que resolve os
 * telefones daquela entrada pelo metadata do grupo. O modulo continua PURO
 * (nao fala com o socket); quem sabe resolver e' quem chama.
 *
 * @param {Array} resumo
 * @param {string} termo
 * @param {(id: string) => string[]} [telefonesDe]
 * @returns {{de,deNome,total,ultima,registros}|null}
 */
export function acharNoResumo(resumo, termo, telefonesDe = null) {
  if (!termo) return null;
  const norm = (t) => String(t || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim();
  const alvo = norm(termo);
  const soDigitos = alvo.replace(/\D/g, '');

  // 1) numero: os digitos no proprio id (funciona para JID/PN) OU nos
  //    telefones resolvidos pelo chamador (necessario para LID).
  if (soDigitos.length >= 8) {
    const porNumero = resumo.find((r) => {
      if (baseId(r.de).includes(soDigitos)) return true;
      if (!telefonesDe) return false;
      try {
        return (telefonesDe(r.de) || []).some((t) => String(t).includes(soDigitos));
      } catch { return false; }
    });
    if (porNumero) return porNumero;
  }
  // 2) nome exato
  const exato = resumo.find((r) => norm(r.deNome) === alvo);
  if (exato) return exato;
  // 3) nome que contem
  return resumo.find((r) => norm(r.deNome).includes(alvo)) || null;
}

/** O registro de indice `n` (1-based) da lista de HOJE, em ordem cronologica. */
export function registroPorIndice(grupo, alvo, n, dia = diaDeHoje()) {
  const lista = mencoesDeHoje(grupo, alvo, dia);
  const i = Number.parseInt(n, 10);
  if (!Number.isInteger(i) || i < 1 || i > lista.length) return null;
  return lista[i - 1];
}

export const __mencoesFile = MENCOES_FILE;
