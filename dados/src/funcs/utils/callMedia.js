/**
 * Ponte para a pilha de MÍDIA da call de grupo.
 *
 * ## Dois backends, um contrato
 *
 * Este módulo é a fachada que os comandos (`!callp` / `!musicap` / `!vozp`) e os
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
 * Carrega o backend de mídia uma vez.
 *
 * O zapo tem prioridade; o `lizzy-call` é a reserva. `mod` recebe um objeto com
 * a interface usada abaixo, então o resto do arquivo não sabe qual está ativo.
 *
 * @returns o backend, ou null quando nenhum está disponível.
 */
export async function carregarMidia() {
  if (carregado) return mod;
  carregado = true;

  // 1) zapo (preferido) — UDP cru no relay sem ICE é o que destrava o grupo.
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

  // 2) lizzy-call (reserva) — motor WASM do WhatsApp Web.
  try {
    mod = await import('lizzy-call/group-media');
    console.log('[CALLP] backend de mídia: lizzy-call (WASM)');
    return mod;
  } catch (e) {
    loadError = loadError || e?.message || String(e);
    console.warn('[CALLP] mídia indisponível:', loadError);
    mod = null;
  }
  return mod;
}

/** Motivo pelo qual a mídia não carregou, ou null. */
export function motivoMidia() {
  return loadError;
}

/**
 * Sessões de mídia por grupo (uma instância compartilhada de `GroupCallMedia`).
 *
 * Só o backend `lizzy-call` usa isto: o `zapoCall` tem estado próprio (o
 * `WaClient` guarda as calls) e expõe as funções direto.
 */
let mediaInstance = null;

/** O backend ativo é o zapo? (ele expõe `carregarZapo`, o lizzy-call não.) */
function usandoZapo(m) {
  return typeof m?.carregarZapo === 'function';
}

/**
 * A instância de mídia, criada na primeira necessidade.
 *
 * Com o zapo devolve o próprio módulo (a fachada dele já tem as funções);
 * com o `lizzy-call` devolve o `GroupCallMedia`.
 *
 * @returns a instância, ou null quando nenhum backend está disponível.
 */
export async function obterMedia() {
  const m = await carregarMidia();
  if (!m) return null;
  if (usandoZapo(m)) return m;
  if (!mediaInstance) {
    mediaInstance = new m.GroupCallMedia({
      log: (msg) => console.log(msg)
    });
  }
  return mediaInstance;
}

/**
 * Entra na call de grupo como participante de MÍDIA.
 *
 * `voiceChat: true` pede ao motor o CHAT DE VOZ (offer "lightweight": entra sem
 * tocar para todos), em vez da chamada que toca. O bot que decide é o comando;
 * aqui só repassamos.
 *
 * Best-effort de propósito: se falhar, devolve o motivo e o `!callp` segue
 * reportando a chamada como aberta (só sem áudio), em vez de dizer que não subiu.
 */
export async function entrarNaCallComMidia({ grupo, callId, callCreator, participantes, sock, voiceChat = false }) {
  if (dubleEntrar) return dubleEntrar.entrar({ grupo, callId, callCreator, participantes, sock, voiceChat });
  const media = await obterMedia();
  if (!media) {
    return { ok: false, motivo: 'pacote_de_midia_ausente', detalhe: loadError };
  }
  try {
    if (usandoZapo(media)) {
      return await media.entrarNaCallComMidia({ grupo, callId, callCreator, participantes, sock, voiceChat });
    }
    const r = await media.entrarNaCall({ grupo, callId, participantes, sock, groupInfo: null, isLightWeight: !!voiceChat });
    return r;
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
    if (usandoZapo(media)) return await media.tocarAudioNaCall(grupo, arquivo);
    return await media.tocarAudio(grupo, arquivo);
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
    mediaInstance = null;
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
    if (usandoZapo(media)) return await media.sairDaCallComMidia(grupo);
    return await media.sairDaCall(grupo);
  } catch (e) {
    return { ok: false, motivo: e?.message || String(e) };
  }
}
