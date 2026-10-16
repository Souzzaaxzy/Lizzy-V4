/**
 * Player da fila de musicas na call.
 *
 * ## A ponte entre a fila e o motor
 *
 * A `musicQueue` guarda o estado; o motor toca UM arquivo por vez. Este modulo
 * liga os dois e faz a fila ANDAR: quando o motor avisa que o arquivo
 * terminou (`voip_call_outbound_audio_finished`), chama o proximo.
 *
 * ## Pular e' carregar outro arquivo
 *
 * Medido no motor (`WaAudioEngine.loadAudioFile`): carregar um arquivo
 * SUBSTITUI o que estava tocando (`audioPosition = 0`). Entao pular/parar e'
 * so' carregar o proximo -- nao existe (nem e' preciso) um `stopAudio`.
 *
 * ## Um callback por grupo
 *
 * O listener do motor e' registrado uma vez e despacha por grupo, para nao
 * empilhar listener a cada musica (o que vazaria memoria).
 */

import * as fila from './musicQueue.js';
import { tocarAudioNaCall, pararAudioDaCall } from './callMedia.js';
import { apagar } from '../../utils/callCache.js';

/** Grupos que o player ja' esta' seguindo (nao registra listener duas vezes). */
const seguindo = new Set();

/** Evita duas chamadas concorrentes de `tocarProxima` no mesmo grupo. */
const ocupado = new Set();

/**
 * Toca a faixa ATUAL da fila (nao avanca).
 *
 * @param {string} grupo
 * @returns {Promise<{ok: boolean, faixa?: object, motivo?: string, detalhe?: string}>}
 */
export async function tocarAtual(grupo) {
  const faixa = fila.atual(grupo);
  if (!faixa) return { ok: false, motivo: 'fila_vazia' };

  const r = await tocarAudioNaCall(grupo, faixa.caminho);
  if (!r?.ok) {
    // A faixa falhou (arquivo sumiu, motor fora): sai da fila e tenta a proxima.
    apagar(faixa.caminho);
    const proxima = fila.removerAtual(grupo);
    return { ok: false, motivo: r?.motivo || 'falha_ao_tocar', detalhe: r?.detalhe, proxima };
  }
  return { ok: true, faixa };
}

/**
 * Avanca a fila e toca a nova atual.
 *
 * @param {string} grupo
 * @returns {Promise<{ok: boolean, faixa?: object, acabou?: boolean, motivo?: string}>}
 */
export async function tocarProxima(grupo) {
  if (ocupado.has(grupo)) return { ok: false, motivo: 'ocupado' };
  ocupado.add(grupo);
  try {
    const anterior = fila.atual(grupo);
    const nova = fila.avancar(grupo);

    // A que saiu ja' foi tocada: o arquivo dela pode ir.
    if (anterior?.caminho) apagar(anterior.caminho);

    if (!nova) return { ok: false, acabou: true, motivo: 'fila_vazia' };

    const r = await tocarAudioNaCall(grupo, nova.caminho);
    if (!r?.ok) {
      apagar(nova.caminho);
      fila.removerAtual(grupo);
      return { ok: false, motivo: r?.motivo || 'falha_ao_tocar' };
    }
    return { ok: true, faixa: nova };
  } finally {
    ocupado.delete(grupo);
  }
}

/**
 * Pula a faixa atual (respeitando o dono).
 *
 * @param {string} grupo
 * @param {string} quem id de quem pediu o pulo
 * @param {object} [opts] `{ ehDonoDoBot, mesmoId }`
 */
export async function pular(grupo, quem, opts = {}) {
  const permissao = fila.podeControlar(grupo, quem, opts);
  if (!permissao.ok) return { ok: false, ...permissao };

  const atual = fila.atual(grupo);
  const r = await tocarProxima(grupo);
  if (r.acabou) return { ok: true, acabou: true, pulada: atual?.titulo || null };
  if (!r.ok) return r;
  return { ok: true, pulada: atual?.titulo || null, faixa: r.faixa };
}

/**
 * Para a musica atual e toca a proxima (respeitando o dono).
 *
 * Diferente de pular: aqui a intencao e' "para essa", entao a faixa SAI da
 * fila e o arquivo e' apagado.
 *
 * @param {string} grupo
 * @param {string} quem
 * @param {object} [opts]
 */
export async function parar(grupo, quem, opts = {}) {
  const permissao = fila.podeControlar(grupo, quem, opts);
  if (!permissao.ok) return { ok: false, ...permissao };

  const atual = fila.atual(grupo);
  if (atual?.caminho) apagar(atual.caminho);

  // Sai a atual e a que ficou no lugar passa a ser a atual.
  const nova = fila.removerAtual(grupo);
  if (!nova) {
    // Fila vazia: silencia a call (sem derrubar).
    await pararAudioDaCall(grupo).catch(() => {});
    return { ok: true, parada: atual?.titulo || null, acabou: true };
  }

  const r = await tocarAudioNaCall(grupo, nova.caminho);
  if (!r?.ok) {
    apagar(nova.caminho);
    fila.removerAtual(grupo);
    return { ok: false, motivo: r?.motivo || 'falha_ao_tocar' };
  }
  return { ok: true, parada: atual?.titulo || null, faixa: nova };
}

/**
 * Chamado quando o motor avisa que o arquivo terminou: avanca a fila.
 *
 * @param {string} grupo
 * @param {Function} [avisar] callback opcional (texto) para avisar no grupo
 */
export async function aoTerminar(grupo, avisar = null) {
  const r = await tocarProxima(grupo);
  if (r.acabou) {
    if (avisar) await avisar('🎵 A fila terminou.').catch(() => {});
    return { ok: true, acabou: true };
  }
  if (r.ok && avisar) {
    await avisar(`🎵 Tocando agora: *${r.faixa.titulo}*`).catch(() => {});
  }
  return r;
}

/** Marca o grupo como seguido (para o listener saber onde despachar). */
export function seguir(grupo) {
  seguindo.add(String(grupo));
}

/** Para de seguir o grupo. */
export function pararDeSeguir(grupo) {
  seguindo.delete(String(grupo));
}

/** O player esta seguindo este grupo? */
export function estaSeguindo(grupo) {
  return seguindo.has(String(grupo));
}

/** Grupos seguidos (diagnostico). */
export function gruposSeguidos() {
  return [...seguindo];
}

/** Limpa o estado (testes). */
export function limparTudo() {
  seguindo.clear();
  ocupado.clear();
}
