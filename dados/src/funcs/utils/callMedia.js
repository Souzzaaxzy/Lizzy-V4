/**
 * Ponte para a pilha de MÍDIA da call de grupo.
 *
 * ## UM backend: `zapoCall.js` (`zapo-js` + `@zapo-js/voip`)
 *
 * Este módulo é a fachada que os comandos (`!callp` / `!musicap` / `!midiap`)
 * e os testes consomem. O backend é o **zapo**: é o único que ataca o ponto
 * onde a call de GRUPO travava — disca o relay por **UDP cru na porta
 * anunciada quando não há credencial ICE**, e só usa WebRTC quando há.
 * Também implementa SFrame/keying por época, roster transacional, heartbeat
 * e `peer_state`.
 *
 * O `lizzy-call` (motor WASM do WhatsApp Web) foi **removido**: ele era a
 * reserva, e a reserva criava dois caminhos de mídia com o mesmo sintoma
 * ("conectando...") sem ninguém saber qual estava ativo. Com um backend só,
 * o comportamento é previsível e o diagnóstico tem um lugar.
 *
 * O carregamento é **preguiçoso e tolerante**: sem os pacotes do zapo, o
 * `!callp` segue reportando a chamada (só sem áudio) e o `!musicap` avisa que
 * a mídia não está disponível. Nada quebra.
 */

import * as zapoCall from './zapoCall.js';

let mod = null;
let loadError = null;
let carregado = false;

/**
 * Dublê para os testes do bot (ver `__setDuble`).
 */
let duble = null;

/** Instala (ou remove, com null) o dublê de mídia. */
export function __setDuble(novo) {
  duble = novo;
}

/** Dublê do caminho de ENTRAR/SAIR da call (usado pelos testes do !callp). */
let dubleEntrar = null;

/** Instala (ou remove, com null) o dublê de entrar/sair. */
export function __setDubleEntrar(novo) {
  dubleEntrar = novo;
}

/**
 * Carrega o backend de mídia uma vez (o zapo).
 *
 * @returns o backend, ou null quando os pacotes não estão disponíveis.
 */
export async function carregarMidia() {
  if (carregado) return mod;
  carregado = true;

  // O unico backend. UDP cru no relay sem ICE e' o que destrava o grupo.
  try {
    const zapo = await zapoCall.carregarZapo();
    if (zapo) {
      mod = zapoCall;
      console.log('[CALLP] backend de mídia: zapo (@zapo-js/voip)');
      return mod;
    }
  } catch (e) {
    loadError = e?.message || String(e);
  }
  console.warn('[CALLP] mídia indisponível:', loadError || 'pacotes do zapo ausentes');
  mod = null;
  return mod;
}

/** Motivo pelo qual a mídia não carregou, ou null. */
export function motivoMidia() {
  return loadError;
}

/**
 * A instância de mídia (o próprio `zapoCall`).
 *
 * O `zapoCall` tem estado próprio (o `WaClient` guarda as calls) e expõe as
 * funções direto — não há instância de classe a criar.
 *
 * @returns a instância, ou null quando os pacotes não estão disponíveis.
 */
export async function obterMedia() {
  const m = await carregarMidia();
  if (!m) return null;
  return m;
}

/**
 * Entra na call de grupo como participante de MÍDIA.
 *
 * Não há flag de chat de voz: o backend zapo (preferido) não a implementa.
 *
 * Best-effort de propósito: se falhar, devolve o motivo e o `!callp` segue
 * reportando a chamada como aberta (só sem áudio), em vez de dizer que não subiu.
 */
export async function entrarNaCallComMidia({ grupo, callId, callCreator, participantes, sock }) {
  if (dubleEntrar) return dubleEntrar.entrar({ grupo, callId, callCreator, participantes, sock });
  const media = await obterMedia();
  if (!media) {
    return { ok: false, motivo: 'pacote_de_midia_ausente', detalhe: loadError };
  }
  try {
    return await media.entrarNaCallComMidia({ grupo, callId, callCreator, participantes, sock });
  } catch (e) {
    return { ok: false, motivo: 'falha_ao_entrar', detalhe: e?.message || String(e) };
  }
}

/** Estágio da pilha de mídia para um grupo. */
export async function estagioMidia(grupo) {
  if (duble) return duble.estagio(grupo);
  const media = await obterMedia();
  if (!media) return 'indisponivel';
  return media.estagioMidia(grupo);
}

/** Toca um arquivo de áudio na call do grupo. */
export async function tocarAudioNaCall(grupo, arquivo) {
  if (duble) return duble.tocar(grupo, arquivo);
  const media = await obterMedia();
  if (!media) return { ok: false, motivo: 'pacote_de_midia_ausente' };
  try {
    return await media.tocarAudioNaCall(grupo, arquivo);
  } catch (e) {
    return { ok: false, motivo: 'falha_ao_tocar', detalhe: e?.message || String(e) };
  }
}

/** Para o áudio em reprodução, mantendo a call de pé. */
export async function pararAudioDaCall(grupo) {
  if (duble) return duble.parar(grupo);
  const media = await obterMedia();
  if (!media) return { ok: false, motivo: 'pacote_de_midia_ausente' };
  return media.pararAudioDaCall(grupo);
}

/**
 * Descarta a pilha de mídia após um erro nela.
 *
 * O motor roda em pthreads e pode falhar de formas que escapam do try/catch (um
 * throw dentro do worker, por exemplo). Quando isso acontece o processo do bot
 * NÃO deve reiniciar — o registro das calls é em memória e se perderia — mas a
 * instância de mídia precisa ser jogada fora, senão fica num estado quebrado e
 * todo `!musicap` seguinte falha em cima dela.
 *
 * Chamado pelo handler de `uncaughtException` do connect.js.
 */
export function resetarMidia() {
  try {
    zapoCall.resetarMidia();
    mod = null;
    carregado = false;
    loadError = null;
  } catch { /* nada a fazer */ }
}

/** Sai da call e libera a pilha de mídia. */
export async function sairDaCallComMidia(grupo) {
  if (dubleEntrar) return dubleEntrar.sair(grupo);
  const media = await obterMedia();
  if (!media) return { ok: false, motivo: 'pacote_de_midia_ausente' };
  try {
    return await media.sairDaCallComMidia(grupo);
  } catch (e) {
    return { ok: false, motivo: e?.message || String(e) };
  }
}

/**
 * O backend de mídia exige pareamento PRÓPRIO?
 *
 * Sim: o zapo é um client separado, com credenciais no formato dele.
 *
 * Com DUBLÊ instalado devolve `false`: o teste mede o CONTRATO do bot, não o
 * estado de pareamento do backend real.
 */
export async function precisaPareamento() {
  if (duble || dubleEntrar) return false;
  const m = await carregarMidia();
  if (!m) return false;
  return !m.estaPareado();
}

/** Está pareado? */
export async function estaPareado() {
  if (duble || dubleEntrar) return true;
  const m = await carregarMidia();
  if (!m) return false;
  return m.estaPareado();
}

/**
 * O cliente do backend de midia (para o video / transmissao de tela).
 *
 * O `!midiap` precisa falar direto com o `voip` (upgrade de video, screen
 * share, feedLiveVideo). Sem os pacotes do zapo devolve `null` e o comando
 * avisa que a midia nao esta disponivel.
 *
 * @returns {Promise<object|null>}
 */
export async function obterVoip() {
  if (duble || dubleEntrar) return null;
  const m = await carregarMidia();
  if (!m) return null;
  const cli = await m.obterCliente?.();
  return cli?.voip || null;
}

/** Pede o código de pareamento (só o backend zapo implementa). */
export async function parearMidia(numero) {
  if (duble) return { ok: false, motivo: 'backend_nao_exige_pareamento' };
  const m = await carregarMidia();
  if (!m) return { ok: false, motivo: 'pacote_de_midia_ausente' };
  if (typeof m.parear !== 'function') {
    return { ok: false, motivo: 'backend_nao_exige_pareamento' };
  }
  return m.parear(numero);
}
