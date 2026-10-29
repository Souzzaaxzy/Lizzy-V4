/**
 * Ponte para a pilha de MÍDIA da call de grupo.
 *
 * ## Um backend: o `zapo`
 *
 * Este módulo é a fachada que os comandos (`!callp` / `!musicap`) e os
 * testes consomem. Atrás dele está o **`zapoCall.js`** (`zapo-js` +
 * `@zapo-js/voip`): ele disca o relay por **UDP cru na porta anunciada quando
 * não há credencial ICE**, e só usa WebRTC quando há. Também implementa
 * SFrame/keying por época, roster transacional, heartbeat e `peer_state`.
 *
 * O **chat de voz** (`!vozp`) usa o MESMO motor, por uma ponte própria
 * (`vozpMedia.js`): o que muda é o `isLightweight`.
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
 * ## Um motor só
 *
 * Este módulo é a ponte da **chamada** (`!callp`). O **chat de voz** (`!vozp`)
 * tem a ponte própria (`vozpMedia.js`) sobre o MESMO motor — cada comando com a
 * sua ponte e o seu registro; o que se compartilha é o código do motor.
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
 * O backend da chamada: o `zapo`. O chat de voz usa o mesmo motor, pela ponte
 * própria dele (`vozpMedia.js`).
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

// ───────────────────────────────────────────────────────────────────────────
// AGENTE DE VOZ (`!iap`) — ouvir a call e falar nela.
//
// Estas três portas são o que o `!iap` precisa do motor: registrar quem recebe
// o áudio de ENTRADA, ligar o modo de áudio externo (saída por `feedLiveAudio`)
// e entregar a VOZ. Nenhuma delas existe no caminho de música: o `!musicap`
// carrega ARQUIVO, o `!iap` fala ao vivo.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Registra o receptor do áudio de entrada da call do grupo.
 * @param {string} grupo
 * @param {Function|null} cb `(grupo, pcm) => void` (null remove)
 */
export async function aoOuvirAudioDaCall(grupo, cb) {
  if (duble || dubleEntrar) return false;
  const m = await carregarMidia();
  if (!m || typeof m.aoOuvirAudio !== 'function') return false;
  m.aoOuvirAudio(grupo, cb);
  return true;
}

/** Liga/desliga o modo de áudio externo (a saída passa a vir de `falarNaCall`). */
export async function modoAudioExternoDaCall(grupo, ligado) {
  if (duble || dubleEntrar) return false;
  const m = await carregarMidia();
  if (!m || typeof m.modoAudioExterno !== 'function') return false;
  return m.modoAudioExterno(grupo, ligado);
}

/**
 * Entrega a VOZ do agente ao uplink da call.
 * @returns {Promise<number>} nível do buffer do motor em ms (0 se indisponível)
 */
export async function falarNaCallDoGrupo(grupo, pcm) {
  if (duble || dubleEntrar) return 0;
  const m = await carregarMidia();
  if (!m || typeof m.falarNaCall !== 'function') return 0;
  return m.falarNaCall(grupo, pcm);
}
