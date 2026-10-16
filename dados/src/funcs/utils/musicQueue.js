/**
 * Fila de musicas da call, por grupo.
 *
 * ## O que e' (e o que NAO e')
 *
 * Estado puro: quem pediu cada faixa, o que esta tocando, o que vem depois.
 * Nao fala com o motor da call, nao baixa audio, nao grava arquivo -- quem faz
 * isso e' o `callCache.js` (arquivos) e o `index.js` (comandos). Assim a regra
 * pode ser testada sem socket.
 *
 * ## A thumb acompanha a faixa
 *
 * Cada faixa guarda `thumb` (o caminho da capa no cache, ou null). Ela sai
 * junto com o audio em TODAS as saidas (`avancar`, `removerAtual`, `limpar`),
 * para o chamador apagar as duas do disco. E' o pedido do dono: *"musica foi
 * pulada ou acabou a foto e' apagada do cache"*.
 *
 * ## Por grupo
 *
 * A call e' por grupo, entao a fila tambem. Duas calls em grupos diferentes
 * nao se enxergam.
 *
 * ## Dono da faixa
 *
 * Cada faixa guarda `donoId` (quem pediu). So' ele pula/para AQUELA faixa.
 * Num grupo grande, sem isso vira disputa pelo controle.
 *
 * ## Modo "espera a atual acabar"
 *
 * `tocar` com a call ocupada ENFILEIRA (nao interrompe). Quem quer trocar
 * agora usa `pular`/`parar`.
 */

/** Fila por grupo: grupo -> { faixas: [], indice: 0 } */
const filas = new Map();

/** Chave da fila (normaliza o jid do grupo). */
const chave = (grupo) => String(grupo || '').trim();

/** Garante a fila do grupo e devolve. */
function filaDe(grupo) {
  const k = chave(grupo);
  if (!filas.has(k)) filas.set(k, { faixas: [], indice: 0 });
  return filas.get(k);
}

/**
 * Enfileira uma faixa.
 *
 * @param {string} grupo
 * @param {{ caminho: string, titulo: string, donoId: string, thumb?: string, pedidoEm?: number }} faixa
 * @returns {{ ok: boolean, posicao?: number, motivo?: string }}
 */
export function enfileirar(grupo, faixa) {
  if (!grupo) return { ok: false, motivo: 'sem_grupo' };
  if (!faixa?.caminho) return { ok: false, motivo: 'sem_caminho' };

  const f = filaDe(grupo);
  f.faixas.push({
    caminho: faixa.caminho,
    titulo: faixa.titulo || 'Sem titulo',
    donoId: faixa.donoId || null,
    thumb: faixa.thumb || null,
    pedidoEm: faixa.pedidoEm || Date.now()
  });
  return { ok: true, posicao: f.faixas.length };
}

/** A faixa que esta tocando, ou null. */
export function atual(grupo) {
  const f = filas.get(chave(grupo));
  if (!f) return null;
  return f.faixas[f.indice] || null;
}

/** A proxima faixa (sem remover), ou null. */
export function proxima(grupo) {
  const f = filas.get(chave(grupo));
  if (!f) return null;
  return f.faixas[f.indice + 1] || null;
}

/** Todas as faixas da fila (a atual inclusive). */
export function listar(grupo) {
  const f = filas.get(chave(grupo));
  return f ? [...f.faixas] : [];
}

/** Quantas faixas ha na fila. */
export function tamanho(grupo) {
  const f = filas.get(chave(grupo));
  return f ? f.faixas.length : 0;
}

/**
 * Avanca para a proxima e devolve ela.
 *
 * A faixa que ACABOU sai da lista (e o `caminho` dela vai no retorno, para o
 * chamador apagar do cache). Sem isso ela ficava listada para sempre no
 * `!fila`/`!musicap atual`, como se ainda fosse tocar.
 *
 * @param {string} grupo
 * @returns {{ faixa: object|null, saiu: object|null }} `faixa` e a nova atual
 *          (ou null quando a fila acabou); `saiu` e a que concluiu (ou null).
 */
export function avancar(grupo) {
  const f = filas.get(chave(grupo));
  if (!f) return { faixa: null, saiu: null };

  const saiu = f.faixas[f.indice] || null;
  if (saiu) f.faixas.splice(f.indice, 1);

  const faixa = f.faixas[f.indice] || null;
  // Fila terminou: limpa tudo (nao guarda estado morto).
  if (!faixa) {
    filas.delete(chave(grupo));
    return { faixa: null, saiu };
  }
  return { faixa, saiu };
}

/**
 * O usuario pode controlar a faixa atual?
 *
 * Regra: o DONO da faixa. `isDono` (o dono do bot) sempre pode, para nao
 * ficar travado se quem pediu sair do grupo.
 *
 * @param {string} grupo
 * @param {string} quem id de quem esta pedindo o controle
 * @param {{ ehDonoDoBot?: boolean, mesmoId?: (a: string, b: string) => boolean }} [opts]
 */
export function podeControlar(grupo, quem, opts = {}) {
  if (opts.ehDonoDoBot) return { ok: true };
  const f = atual(grupo);
  if (!f) return { ok: false, motivo: 'sem_musica' };
  if (!f.donoId) return { ok: true }; // sem dono registrado: libera

  const igual = opts.mesmoId || ((a, b) => a === b);
  if (igual(f.donoId, quem)) return { ok: true };

  return { ok: false, motivo: 'nao_e_dono', donoId: f.donoId, titulo: f.titulo };
}

/**
 * Remove a faixa atual (para "parar") e devolve a que ficou no lugar.
 *
 * @returns {object|null} a nova atual, ou null se a fila esvaziou
 */
export function removerAtual(grupo) {
  const f = filas.get(chave(grupo));
  if (!f) return null;
  f.faixas.splice(f.indice, 1);
  const faixa = f.faixas[f.indice] || null;
  if (!faixa) {
    filas.delete(chave(grupo));
    return null;
  }
  return faixa;
}

/**
 * Esvazia a fila do grupo.
 *
 * @returns {{ removidas: number, caminhos: string[], thumbs: string[] }} os
 *          arquivos que o chamador deve apagar do cache (audio E capa)
 */
export function limpar(grupo) {
  const k = chave(grupo);
  const f = filas.get(k);
  if (!f) return { removidas: 0, caminhos: [], thumbs: [] };
  const caminhos = f.faixas.map((x) => x.caminho).filter(Boolean);
  const thumbs = f.faixas.map((x) => x.thumb).filter(Boolean);
  filas.delete(k);
  return { removidas: caminhos.length, caminhos, thumbs };
}

/** Remove a fila do grupo sem devolver caminhos (uso interno/limpeza). */
export function esquecer(grupo) {
  filas.delete(chave(grupo));
}

/** Quantos grupos tem fila ativa (diagnostico). */
export function gruposComFila() {
  return filas.size;
}

/** Estado resumido, para o comando de status. */
export function resumo(grupo) {
  const f = filas.get(chave(grupo));
  if (!f || f.faixas.length === 0) {
    return { vazia: true, total: 0, indice: 0, atual: null, proxima: null };
  }
  return {
    vazia: false,
    total: f.faixas.length,
    indice: f.indice,
    atual: f.faixas[f.indice] || null,
    proxima: f.faixas[f.indice + 1] || null
  };
}

/** Limpa tudo (testes). */
export function limparTudo() {
  filas.clear();
}
