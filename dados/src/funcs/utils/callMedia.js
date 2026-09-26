/**
 * Ponte para a pilha de MÍDIA da call de grupo (`lizzy-call`).
 *
 * ## Por que existe
 *
 * O `!callp` sobe a chamada por **sinalização** (a stanza `<call><offer>`): ela
 * passa a existir e aparece no grupo. Isso não carrega som — a mídia de uma call
 * vai por RTP/SRTP sobre UDP até um relay, cifrada com uma chave negociada à
 * parte. Quem implementa essa parte é o motor WASM do próprio WhatsApp Web, e é
 * ele que este módulo carrega.
 *
 * O carregamento é **preguiçoso e tolerante**: se o pacote não estiver instalado
 * (ou o motor não subir neste servidor), o `!callp` continua funcionando como
 * sinalização e o `!musicap` avisa que a mídia não está disponível. Nada quebra.
 *
 * ## Uma sessão por grupo
 *
 * A pilha de mídia tem estado por chamada, então há um `GroupCallMedia` por
 * grupo. Ele roda em cima do socket que o bot JÁ tem — nenhum dispositivo extra
 * é vinculado à conta.
 */

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
 * Carrega o pacote de mídia uma vez.
 *
 * @returns o módulo, ou null quando indisponível (com o motivo em `motivoMidia()`).
 */
export async function carregarMidia() {
  if (carregado) return mod;
  carregado = true;
  try {
    mod = await import('lizzy-call/group-media');
  } catch (e) {
    loadError = e?.message || String(e);
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
 */
let mediaInstance = null;

/**
 * A instância de mídia, criada na primeira necessidade.
 *
 * @returns a instância, ou null quando o pacote não está disponível.
 */
export async function obterMedia() {
  const m = await carregarMidia();
  if (!m) return null;
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
    const r = await media.entrarNaCall({ grupo, callId, participantes, sock, groupInfo: null });
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
  return media.estagio(grupo);
}

/** Toca um arquivo de áudio na call do grupo. */
export async function tocarAudioNaCall(grupo, arquivo) {
  if (duble) return duble.tocar(grupo, arquivo);
  const media = await obterMedia();
  if (!media) return { ok: false, motivo: 'pacote_de_midia_ausente' };
  try {
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
  return media.pararAudio(grupo);
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
    return await media.sairDaCall(grupo);
  } catch (e) {
    return { ok: false, motivo: e?.message || String(e) };
  }
}
