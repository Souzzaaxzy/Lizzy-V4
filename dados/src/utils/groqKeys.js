/**
 * AS CHAVES DO GROQ — ate' 10, com troca automatica quando uma acaba.
 *
 * ## O pedido do dono
 *
 * *"o plano e' gratis e acaba, entao quero adicionar mais de uma chave para que
 * quando uma acabar usar a proxima imediatamente"* — com os comandos
 * `!keygroq1` ate' `!keygroq10` (o `1` e' a chave de sempre).
 *
 * ## Por que o failover e' por CHAVE (e nao por "tentar de novo")
 *
 * O Groq responde **401/403** quando a chave e' invalida e **429** quando a cota
 * acabou. Nos dois casos tentar a MESMA chave de novo nao adianta — o que
 * resolve e' a PROXIMA. Por isso a rotacao so' acontece nesses dois motivos: um
 * erro de rede nao deve queimar a cota de outra chave a toa.
 *
 * ## Os nomes no `.env`
 *
 *   slot 1  -> GROQ_API_KEY      (a de sempre: `!keygroq`)
 *   slot 2  -> GROQ_API_KEY_2    (`!keygroq2`)
 *   ...
 *   slot 10 -> GROQ_API_KEY_10   (`!keygroq10`)
 *
 * O slot 1 mantem o nome antigo de proposito: quem ja' configurou nao perde
 * nada, e o `.env` continua legivel.
 *
 * Modulo PURO: recebe o `env` por parametro e nao abre socket.
 */

import fs from 'fs';
import path from 'path';
import { DONO_DIR } from './paths.js';

/** Quantas chaves cabem (o dono pediu 10). */
export const MAX_SLOTS = 10;

/** O nome da variavel de um slot. */
export function nomeDaVar(slot) {
  const n = Number.parseInt(slot, 10);
  if (!Number.isFinite(n) || n <= 1) return 'GROQ_API_KEY';
  return `GROQ_API_KEY_${n}`;
}

/**
 * Le' as chaves configuradas, NA ORDEM dos slots.
 *
 * Slot sem valor simplesmente nao entra — entao uma lista com "buracos"
 * (1, 3, 5) funciona: a rotacao passa de uma para a outra.
 *
 * @param {object} [env] padrao: `process.env`
 * @returns {Array<{slot: number, var: string, chave: string}>}
 */
export function lerChaves(env = process.env) {
  const saida = [];
  for (let slot = 1; slot <= MAX_SLOTS; slot++) {
    const valor = String((env || {})[nomeDaVar(slot)] || '').trim();
    if (valor) saida.push({ slot, var: nomeDaVar(slot), chave: valor });
  }
  return saida;
}

/** Mostra so' o comeco e o fim (nunca a chave inteira em log/mensagem). */
export function mascarar(chave) {
  const s = String(chave || '');
  if (!s) return 'nao configurada';
  if (s.length <= 8) return '*'.repeat(s.length);
  return `${s.slice(0, 4)}...${s.slice(-4)}`;
}

/**
 * O proximo indice, dando a volta no fim.
 *
 * Dar a volta e' proposital: uma chave que estourou o limite agora pode ter
 * voltado (as cotas do Groq sao por minuto/dia).
 */
export function proximoIndice(indice, total) {
  if (!total || total < 1) return 0;
  return (Number(indice) + 1) % total;
}

/** O nome de comando de um slot (`!keygroq`, `!keygroq2`, ...). */
export function comandoDoSlot(slot) {
  const n = Number.parseInt(slot, 10);
  return (!Number.isFinite(n) || n <= 1) ? 'keygroq' : `keygroq${n}`;
}

/**
 * Le' o slot a partir do NOME DO COMANDO.
 *
 * `keygroq` -> 1, `keygroq7` -> 7. Devolve `null` quando nao e' um comando de
 * chave (ou o numero esta fora da faixa).
 *
 * @param {string} comando
 * @returns {number|null}
 */
export function slotDoComando(comando) {
  const c = String(comando || '').toLowerCase().trim();
  if (c === 'keygroq' || c === 'groqkey') return 1;
  const m = c.match(/^(?:keygroq|groqkey)(\d{1,2})$/);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return (n >= 1 && n <= MAX_SLOTS) ? n : null;
}

/**
 * Atualiza (ou cria/remove) a linha de UM slot no conteudo do `.env`.
 *
 * Puro: devolve o conteudo novo, nao escreve arquivo. Assim da' para testar a
 * manipulacao de texto sem tocar no `.env` de verdade.
 *
 * @param {string} conteudo o `.env` inteiro
 * @param {number} slot
 * @param {string|null} valor `null`/vazio REMOVE a linha
 * @returns {string}
 */
export function atualizarEnv(conteudo, slot, valor) {
  const nome = nomeDaVar(slot);
  const linhas = String(conteudo || '').split('\n');
  const re = new RegExp(`^${nome}=`);
  const novo = valor == null ? '' : String(valor).trim();

  let achou = false;
  const saida = [];
  for (const linha of linhas) {
    if (re.test(linha)) {
      achou = true;
      // Remover = apaga a linha; definir = troca pelo valor novo.
      if (novo) saida.push(`${nome}=${novo}`);
      continue;
    }
    saida.push(linha);
  }

  if (!achou && novo) {
    // Acrescenta no fim, respeitando se o arquivo termina com \n.
    const texto = saida.join('\n');
    return texto.endsWith('\n') || texto === ''
      ? `${texto}${nome}=${novo}\n`
      : `${texto}\n${nome}=${novo}\n`;
  }

  return saida.join('\n');
}


// ───────────────────────────────────────────────────────────────────────────
// O ESTADO DAS CHAVES (esgotadas hoje) — com RESET DIARIO
// ───────────────────────────────────────────────────────────────────────────
//
// ## Por que um arquivo (e nao so' memoria)
//
// A cota do Groq e' DIARIA. Se o bot reiniciar no meio do dia, ele tem que
// LEMBRAR quais chaves ja' estouraram — senao volta a tentar a primeira (que
// esta morta) em cada mensagem, que era exatamente o conflito relatado.
//
// ## O reset e' por DIA (00:00)
//
// `resetarEsgotadas()` zera a lista, e o `carregarEstado()` chama isso sozinho
// quando percebe que o dia mudou. Assim, virou o dia, tudo volta ao primeiro.

/** O arquivo onde o estado vive (junto dos outros dados do dono). */
function arquivoDeEstado() {
  return process.env.GROQ_KEYS_STATE_FILE
    || path.join(DONO_DIR, 'groqKeysState.json');
}

/** O dia de hoje, no fuso do Brasil (o mesmo do resto do bot). */
function hoje() {
  try {
    return new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/** O estado em memoria (evita ler o disco a cada chamada). */
let _estado = null;

/** Le' do disco, resetando se o dia virou. Nunca lanca. */
function carregarEstado() {
  const dia = hoje();
  if (_estado && _estado.dia === dia) return _estado;
  let lido = null;
  try {
    lido = JSON.parse(fs.readFileSync(arquivoDeEstado(), 'utf8'));
  } catch { /* sem arquivo (ou corrompido): comeca limpo */ }
  // Dia diferente = reset. E' o que faz a cota diaria voltar as 00:00.
  const mesmoDia = lido && lido.dia === dia;
  _estado = {
    dia,
    esgotadas: mesmoDia && Array.isArray(lido.esgotadas) ? lido.esgotadas.map(Number).filter(Number.isFinite) : []
  };
  if (!mesmoDia && lido) gravarEstado();   // grava o reset
  return _estado;
}

/** Grava o estado (best-effort: nao pode derrubar uma chamada de IA). */
function gravarEstado() {
  try {
    fs.mkdirSync(path.dirname(arquivoDeEstado()), { recursive: true });
    fs.writeFileSync(arquivoDeEstado(), JSON.stringify(_estado, null, 2));
  } catch { /* segue so' na memoria */ }
}

/** O slot ja' estourou a cota hoje? */
export function estaEsgotada(slot) {
  return carregarEstado().esgotadas.includes(Number(slot));
}

/** Marca o slot como esgotado (cota estourada ou chave invalida). */
export function marcarEsgotada(slot) {
  const n = Number(slot);
  if (!Number.isFinite(n)) return;
  const e = carregarEstado();
  if (!e.esgotadas.includes(n)) {
    e.esgotadas.push(n);
    gravarEstado();
  }
}

/**
 * A PRIMEIRA chave que ainda nao estourou, a partir de um indice.
 *
 * E' o coracao da rotacao: a "chave atual" e' sempre esta — nao existe ponteiro
 * separado que possa ficar apontando para uma chave morta.
 *
 * @param {Array<{slot:number, chave:string}>} [lista] padrao: `lerChaves()`
 * @param {number} [de] indice inicial (padrao 0)
 * @returns {{slot:number, chave:string}|null}
 */
export function primeiraDisponivel(lista = lerChaves(), de = 0) {
  const esgotadas = carregarEstado().esgotadas;
  for (let i = Math.max(0, de); i < lista.length; i++) {
    if (!esgotadas.includes(Number(lista[i].slot))) return lista[i];
  }
  return null;
}

/**
 * Reseta o estado. Chamado quando o dia vira e pelo comando do dono.
 * @param {boolean} [apagarArquivo] `true` remove o arquivo (reset manual)
 */
export function resetarEsgotadas(apagarArquivo = false) {
  _estado = { dia: hoje(), esgotadas: [] };
  if (apagarArquivo) {
    try { fs.unlinkSync(arquivoDeEstado()); } catch { /* ja' nao existia */ }
  } else {
    gravarEstado();
  }
}

/**
 * Um retrato do estado, para o painel do dono.
 *
 * @param {Array<{slot:number, chave:string}>} [lista]
 * @returns {{dia: string, esgotadas: number[], chaves: Array<{slot:number, chave:string, esgotada:boolean, ativa:boolean}>}}
 */
export function estadoDasChaves(lista = lerChaves()) {
  const e = carregarEstado();
  const ativa = primeiraDisponivel(lista);
  return {
    dia: e.dia,
    esgotadas: [...e.esgotadas].sort((a, b) => a - b),
    chaves: lista.map((c) => ({
      slot: c.slot,
      chave: c.chave,
      esgotada: e.esgotadas.includes(Number(c.slot)),
      ativa: Boolean(ativa && ativa.slot === c.slot)
    }))
  };
}

/** Quando foi o ultimo reset (o dia atual). Diagnostico. */
export function diaDoEstado() {
  return carregarEstado().dia;
}

/** Limpa o cache em memoria (teste). */
export function _limparCacheDeEstado() {
  _estado = null;
}
