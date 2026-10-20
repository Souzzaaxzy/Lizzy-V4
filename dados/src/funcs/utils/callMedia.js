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
import { criarLogDaCall } from '../../utils/callLog.js';

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
      return mod;
    }
  } catch (e) {
    loadError = e?.message || String(e);
  }

  // 2) lizzy-call (reserva) — motor WASM do WhatsApp Web.
  try {
    mod = await import('lizzy-call/group-media');
    return mod;
  } catch (e) {
    loadError = loadError || e?.message || String(e);
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

/**
 * O módulo do `lizzy-call`, carregado sob demanda.
 *
 * Existe separado do `carregarMidia` porque ele é o **ÚNICO** backend que sabe
 * declarar um CHAT DE VOZ: o motor WASM do WhatsApp Web tem o caminho
 * `voice_chat.cc` (`is_voice_chat`, `is_lightweight`, `lightweight-key`) e o
 * `GroupCallMedia.entrarNaCall` aceita `isLightWeight`. O `zapo` **não** tem essa
 * opção (`CallOfferOptions` só tem `isVideo`/`audioFile`), então para voice chat
 * não há escolha.
 */
let modLizzy = null;

async function carregarLizzyCall() {
  if (modLizzy) return modLizzy;
  try {
    modLizzy = await import('lizzy-call/group-media');
  } catch (e) {
    loadError = loadError || e?.message || String(e);
    modLizzy = null;
  }
  return modLizzy;
}

/**
 * Qual backend está ativo por padrão ('zapo' | 'lizzy-call' | 'nenhum').
 *
 * Serve para o comando dizer a verdade: o `!callp` roda no zapo, o chat de voz
 * precisa do lizzy-call.
 */
export async function backendAtivo() {
  const m = await carregarMidia();
  if (!m) return 'nenhum';
  return usandoZapo(m) ? 'zapo' : 'lizzy-call';
}

/** O backend ativo suporta CHAT DE VOZ? (só o lizzy-call) */
export async function suportaVoiceChat() {
  return (await carregarLizzyCall()) !== null;
}

/**
 * Backend que está segurando a mídia de cada grupo.
 *
 * O chat de voz vive no `lizzy-call` e a chamada normal no `zapo`; sem registrar
 * quem atendeu cada grupo, um `sair`/`tocar` iria para o backend errado e não
 * faria nada (falha silenciosa).
 */
const backendPorGrupo = new Map();

/** Registra (ou limpa, com null) o backend de um grupo. */
function marcarBackend(grupo, qual) {
  if (qual) backendPorGrupo.set(grupo, qual);
  else backendPorGrupo.delete(grupo);
}

/** A instância do lizzy-call (uma por processo). */
function instanciaLizzy(mod) {
  if (!mediaInstance) mediaInstance = new mod.GroupCallMedia({
    // O log do motor passa pelo FILTRO (callLog.js): o ruido sai e o que decide
    // (subida, midia pronta, roster, queda, erro) fica, com repeticao colapsada.
    log: criarLogDaCall()
  });
  return mediaInstance;
}

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
    mediaInstance = new m.GroupCallMedia({ log: criarLogDaCall() });
  }
  return mediaInstance;
}

/**
 * Entra na call de grupo como participante de MÍDIA.
 *
 * Não há flag de chat de voz: o backend zapo (preferido) não a implementa.
 *
 * Best-effort de propósito: se falhar, devolve o motivo e o `!callp` segue
 * reportando a chamada como aberta (só sem áudio), em vez de dizer que não subiu.
 */
export async function entrarNaCallComMidia({ grupo, callId, callCreator, participantes, sock, voiceChat = false }) {
  if (dubleEntrar) return dubleEntrar.entrar({ grupo, callId, callCreator, participantes, sock, voiceChat });

  // CHAT DE VOZ: só o lizzy-call declara o offer como voice chat. O zapo não tem
  // a opção, então aqui não há escolha de backend.
  if (voiceChat) {
    const lizzy = await carregarLizzyCall();
    if (!lizzy) {
      return { ok: false, motivo: 'voice_chat_indisponivel', detalhe: loadError };
    }
    try {
      const r = await instanciaLizzy(lizzy).entrarNaCall({
        grupo, callId, participantes, sock, groupInfo: null,
        isLightWeight: true // <- é isto que faz o motor declarar o VOICE CHAT
      });
      if (r?.ok) marcarBackend(grupo, 'lizzy-call');
      return r;
    } catch (e) {
      return { ok: false, motivo: 'falha_ao_entrar', detalhe: e?.message || String(e) };
    }
  }

  const media = await obterMedia();
  if (!media) {
    return { ok: false, motivo: 'pacote_de_midia_ausente', detalhe: loadError };
  }
  try {
    if (usandoZapo(media)) {
      const r = await media.entrarNaCallComMidia({ grupo, callId, callCreator, participantes, sock });
      if (r?.ok) marcarBackend(grupo, 'zapo');
      return r;
    }
    const r = await media.entrarNaCall({ grupo, callId, participantes, sock, groupInfo: null });
    if (r?.ok) marcarBackend(grupo, 'lizzy-call');
    return r;
  } catch (e) {
    return { ok: false, motivo: 'falha_ao_entrar', detalhe: e?.message || String(e) };
  }
}

/** Estágio da pilha de mídia para um grupo. */
/**
 * Resumo de UMA linha do que importa de uma sessao de call, para o log.
 *
 * O motor fala muito; o que responde "onde parou" e' curto: tipo, estagio e (se
 * houver) o motivo. Este helper existe para o operador ter o resumo sem ler o
 * fluxo inteiro.
 *
 * @param {object} sessao
 * @returns {string}
 */
export function resumirSessaoDeCall(sessao) {
  if (!sessao) return 'sem sessao';
  const tipo = sessao.voiceChat ? 'chat de voz' : 'chamada';
  const estagio = sessao.stage || 'desconhecido';
  const motivo = sessao.aviso ? ` | motivo: ${sessao.aviso}` : '';
  const ligados = Number.isFinite(sessao.tocados) ? ` | tocados: ${sessao.tocados}` : '';
  return `${tipo} | estagio: ${estagio}${motivo}${ligados}`;
}

/** Estagio da pilha de midia para um grupo. */
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
    // Mesmo roteamento do `sair`: quem atendeu o grupo é quem recebe o áudio.
    if (backendPorGrupo.get(grupo) === 'lizzy-call') {
      const lizzy = await carregarLizzyCall();
      if (lizzy) return await instanciaLizzy(lizzy).tocarAudio(grupo, arquivo);
    }
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
    modLizzy = null;
    backendPorGrupo.clear();
    zapoCall.resetarMidia();
    mod = null;
    carregado = false;
    loadError = null;
  } catch { /* nada a fazer */ }
}

/** Sai da call e libera a pilha de mídia. */
export async function sairDaCallComMidia(grupo) {
  if (dubleEntrar) return dubleEntrar.sair(grupo);

  // Roteia pelo backend que ATENDEU o grupo: um chat de voz vive no lizzy-call,
  // a chamada normal no zapo. Mandar o `sair` para o backend errado não
  // desmontaria nada (falha silenciosa) e o `!callp` diria "encerrado" mentindo.
  const qual = backendPorGrupo.get(grupo);
  try {
    if (qual === 'lizzy-call') {
      const lizzy = await carregarLizzyCall();
      if (lizzy) {
        const r = await instanciaLizzy(lizzy).sairDaCall(grupo);
        marcarBackend(grupo, null);
        return r;
      }
    }
    const media = await obterMedia();
    if (!media) return { ok: false, motivo: 'pacote_de_midia_ausente' };
    const r = usandoZapo(media) ? await media.sairDaCallComMidia(grupo) : await media.sairDaCall(grupo);
    marcarBackend(grupo, null);
    return r;
  } catch (e) {
    return { ok: false, motivo: e?.message || String(e) };
  }
}

/**
 * O backend de mídia exige pareamento PRÓPRIO?
 *
 * Só o zapo: ele é um client separado, com credenciais no formato dele. O
 * `lizzy-call` usa o socket do Baileys (que já está pareado), então devolve
 * `false` e o `!callp` não pede nada.
 *
 * Com DUBLÊ instalado devolve `false`: o teste mede o CONTRATO do bot, não o
 * estado de pareamento do backend real.
 */
export async function precisaPareamento() {
  if (duble || dubleEntrar) return false;
  const m = await carregarMidia();
  if (!m || !usandoZapo(m)) return false;
  return !m.estaPareado();
}

/** Está pareado? (sempre `true` para o backend que não exige pareamento) */
export async function estaPareado() {
  if (duble || dubleEntrar) return true;
  const m = await carregarMidia();
  if (!m) return false;
  if (!usandoZapo(m)) return true;
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
  if (!m || !usandoZapo(m)) return null;
  const cli = await m.obterCliente?.();
  return cli?.voip || null;
}

/** Pede o código de pareamento (só o backend zapo implementa). */
export async function parearMidia(numero) {
  if (duble) return { ok: false, motivo: 'backend_nao_exige_pareamento' };
  const m = await carregarMidia();
  if (!m) return { ok: false, motivo: 'pacote_de_midia_ausente' };
  if (!usandoZapo(m) || typeof m.parear !== 'function') {
    return { ok: false, motivo: 'backend_nao_exige_pareamento' };
  }
  return m.parear(numero);
}
