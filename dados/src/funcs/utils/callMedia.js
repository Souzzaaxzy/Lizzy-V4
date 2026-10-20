/**
 * Ponte para a pilha de MÍDIA da call de grupo.
 *
 * ## Dois backends, um contrato
 *
 * Este módulo é a fachada que os comandos (`!callp` / `!musicap`) e os
 * testes consomem. Atrás dele há DOIS backends de mídia, escolhidos nesta ordem:
 *
 * 1. **`zapoCall.js`** (`zapo-js` + `@zapo-js/voip`) — **preferido**. É o único
 *    que ataca o ponto onde a call de GRUPO travava: ele disca o relay por
 *    **UDP cru na porta anunciada quando não há credencial ICE**, e só usa
 *    WebRTC quando há. Também implementa SFrame/keying por época, roster
 *    transacional, heartbeat e `peer_state`.
 * 2. **`lizzy-call`** (motor WASM do WhatsApp Web) — **reserva**, para o caso de
 *    os pacotes do zapo não estarem instalados. Continua funcionando como antes.
 *
 * O contrato é idêntico nos dois, então trocar de backend não muda nenhum
 * comando nem nenhum teste.
 *
 * O carregamento é **preguiçoso e tolerante**: sem os pacotes, o `!callp` segue
 * reportando a chamada (só sem áudio) e o `!musicap` avisa que a mídia não está
 * disponível. Nada quebra.
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
 * Carrega o backend de mídia da CHAMADA (o zapo) uma vez.
 *
 * ## Só o zapo — o lizzy-call saiu daqui
 *
 * O `lizzy-call` era a "reserva" deste módulo, mas ele é o motor do **chat de
 * voz** (`vozpMedia.js`). Manter os dois no mesmo processo não é só acoplamento:
 * a doc do próprio pacote diz que um segundo motor na mesma instância *"briga"*
 * pelo estado da call. Cada comando carrega o seu.
 *
 * @returns o backend, ou null quando o zapo não está disponível.
 */
export async function carregarMidia() {
  if (carregado) return mod;
  carregado = true;
  try {
    const zapo = await zapoCall.carregarZapo();
    if (zapo) mod = zapoCall;
  } catch (e) {
    loadError = e?.message || String(e);
  }
  return mod;
}

/** Motivo pelo qual a mídia não carregou, ou null. */
export function motivoMidia() {
  return loadError;
}

/**
 * O backend da chamada, ou null.
 *
 * Só o zapo: o `lizzy-call` é o motor do **chat de voz** (`vozpMedia.js`) e não
 * vive neste processo junto com ele.
 */
export async function obterMedia() {
  return carregarMidia();
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
 * O zapo é um client separado, com credenciais no formato dele — por isso exige
 * um pareamento próprio.
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

/** Está pareado? (sempre `true` para o backend que não exige pareamento) */
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
 * share, feedLiveVideo). So' o backend zapo expoe isso; sem ele devolve
 * `null` e o comando avisa que a midia nao esta disponivel.
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
