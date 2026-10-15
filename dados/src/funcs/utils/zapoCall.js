/**
 * Backend de MÍDIA de call de grupo via `zapo` (`zapo-js` + `@zapo-js/voip`).
 *
 * ## Por que existe
 *
 * O backend anterior (`lizzy-call`) embrulha o motor WASM do WhatsApp Web e
 * resolvia a sinalização, mas o **transporte de mídia** sempre discava o relay
 * por `RTCPeerConnection` (`@roamhq/wrtc`). Quando o relay de um call de GRUPO
 * não traz credencial ICE, não há ICE a negociar e a call fica presa em
 * "conectando" para sempre.
 *
 * O `@zapo-js/voip` (v1.4.0) ataca exatamente esse ponto: ele disca o relay
 * **por UDP cru na porta anunciada quando não há credencial ICE**, e só usa o
 * caminho WebRTC quando há. Também implementa o que faltava para grupo:
 * SFrame/keying por época (`WaGroupRekey`), roster transacional, heartbeat e
 * `peer_state`.
 *
 * ## Contrato
 *
 * Este módulo expõe a MESMA interface do `callMedia.js`:
 * `entrarNaCallComMidia`, `estagioMidia`, `tocarAudioNaCall`, `pararAudioDaCall`,
 * `sairDaCallComMidia`, `resetarMidia`. Assim os comandos `!callp` / `!musicap` /
 * `!vozp` e seus testes não precisam saber qual backend está ativo.
 *
 * ## Sessão própria (limite honesto)
 *
 * O zapo é um client completo: ele tem credenciais e store PRÓPRIOS, no formato
 * dele (`WaAuthCredentials`). Ele **não lê** o `creds.json` do Baileys. Então a
 * conta precisa ser pareada também neste client — o que o WhatsApp multi-device
 * permite (vira mais um dispositivo vinculado).
 *
 * ## Carregamento tolerante
 *
 * Se os pacotes não estiverem instalados, nada quebra: as funções devolvem
 * `pacote_de_midia_ausente` e o `!callp` segue reportando a chamada sem áudio,
 * como já fazia.
 */

let mod = null;
let loadError = null;
let carregado = false;

/** Insténcia do `WaClient` (uma por processo). */
let client = null;
/** Store em memória (evita dependência nova; a sessão vive no store). */
let store = null;
/** Inicialização em andamento, para não abrir duas conexées. */
let conectando = null;

/** Mapa grupo -> callId do zapo. */
const callsPorGrupo = new Map();
/** Mapa grupo -> estágio da mídia. */
const estagios = new Map();

/** Dublê para os testes do bot (mesma porta do `callMedia.js`). */
let duble = null;
let dubleEntrar = null;

export function __setDuble(novo) {
  duble = novo;
}

export function __setDubleEntrar(novo) {
  dubleEntrar = novo;
}

/** Carrega os pacotes do zapo uma vez. */
export async function carregarZapo() {
  if (carregado) return mod;
  carregado = true;
  try {
    const [zapo, voip] = await Promise.all([
      import('zapo-js'),
      import('@zapo-js/voip')
    ]);
    mod = { ...zapo, ...voip };
  } catch (e) {
    loadError = e?.message || String(e);
    console.warn('[ZAPOCALL] pacotes indisponíveis:', loadError);
    mod = null;
  }
  return mod;
}

/** Motivo pelo qual os pacotes não carregaram, ou null. */
export function motivoZapo() {
  return loadError;
}

/**
 * O `WaClient` conectado, criado na primeira necessidade.
 *
 * O store é **em memória** de propésito: não adiciona dependência (nada de
 * sqlite/redis) e a credencial do zapo é reusada enquanto o processo vive.
 * Para persistir entre reinícios, troque por um store de arquivo.
 */
export async function obterCliente() {
  const m = await carregarZapo();
  if (!m) return null;
  if (client) return client;
  if (conectando) return conectando;

  // Em teste no se abre conexo de verdade: o zapo emitiria QR e parearia um
  // dispositivo. Quem precisa de mdia nos testes usa o dubl do `callMedia.js`.
  if (process.env.ZAPO_DISABLE_CONNECT === '1' || process.env.NODE_ENV === 'test') {
    loadError = 'conexao desabilitada em teste (ZAPO_DISABLE_CONNECT)';
    return null;
  }

  conectando = (async () => {
    try {
      const { createStore, WaClient, ConsoleLogger, voipPlugin } = m;

      // O `createStore` exige que TODO domnio de persistncia seja atribudo
      // explicitamente. Todos vo para memria (nenhuma dependncia nova de
      // banco); as caixas de mensagens so puladas com 'none', que  o que
      // importa aqui — o zapo só carrega a MÍDIA da call.
      store = createStore({
        backends: { memory: {} },
        providers: {
          auth: 'memory',
          signal: 'memory',
          preKey: 'memory',
          session: 'memory',
          identity: 'memory',
          senderKey: 'memory',
          appState: 'memory',
          privacyToken: 'memory',
          messages: 'none',
          threads: 'none',
          contacts: 'none'
        }
      });

      client = new WaClient(
        {
          store,
          sessionId: process.env.ZAPO_SESSION_ID || 'lizzy-call',
          plugins: [
            voipPlugin({
              // O ponto da migração: UDP cru quando o relay de grupo não traz
              // credencial ICE. Sem isto, o sintoma é o "conectando" infinito.
              useRawUdpTransport: true,
              logLevel: process.env.ZAPO_LOG_LEVEL || 'warn'
            })
          ]
        },
        new ConsoleLogger(process.env.ZAPO_LOG_LEVEL || 'warn')
      );

      // Primeiro pareamento: mostra o QR no terminal (mesmo fluxo do Baileys).
      client.on('auth_qr', ({ qr }) => {
        console.log('[ZAPOCALL] Pareie a conta de call (novo dispositivo):');
        console.log(qr);
      });
      client.on('auth_paired', ({ credentials }) => {
        console.log('[ZAPOCALL] pareado como', credentials?.meJid);
      });
      client.on('voip_call_state', (call) => {
        console.log(`[ZAPOCALL] call ${call.callId} -> ${call.stateData?.state}`);
      });
      client.on('voip_call_error', (err) => {
        console.warn('[ZAPOCALL] erro na call:', err?.message || err);
      });

      await client.connect();
      return client;
    } catch (e) {
      loadError = e?.message || String(e);
      console.warn('[ZAPOCALL] falha ao conectar:', loadError);
      client = null;
      return null;
    } finally {
      conectando = null;
    }
  })();

  return conectando;
}

/**
 * Traduz o estado do zapo para os estágios que o bot já conhece
 * (`aguardando_roster` / `aguardando_relay` / `aguardando_epoch` / `pronta`).
 */
function estagioDoCall(call) {
  if (!call) return 'aguardando_roster';
  const estado = call.stateData?.state;
  if (estado === 'active') return 'pronta';
  if (estado === 'connecting') return 'aguardando_relay';
  if (estado === 'initiating' || estado === 'ringing') return 'aguardando_roster';
  if (estado === 'ended') return 'parado';
  return 'aguardando_epoch';
}

/**
 * Entra na call de grupo como participante de MÍDIA.
 *
 * Mesma assinatura do `callMedia.js`. O `voiceChat` não tem equivalente direto
 * no zapo (o "chat de voz" era um flag do motor WASM), então ele é registrado
 * e reportado  a call sobe normal.
 */
export async function entrarNaCallComMidia({ grupo, callId, callCreator, participantes, sock, voiceChat = false }) {
  if (dubleEntrar) return dubleEntrar.entrar({ grupo, callId, callCreator, participantes, sock, voiceChat });

  const cli = await obterCliente();
  if (!cli || !cli.voip) {
    return { ok: false, motivo: 'pacote_de_midia_ausente', detalhe: loadError };
  }

  try {
    // O zapo recebe a lista de convidados (sem nés mesmos) e resolve os
    // devices de cada um. O bot já monta essa lista em `subirCallDoGrupo`.
    const alvos = (participantes || []).map((jid) => ({ jid }));

    const novoCallId = await cli.voip.startCall({
      groupJid: grupo,
      participants: alvos
    });

    callsPorGrupo.set(grupo, novoCallId);
    estagios.set(grupo, 'aguardando_roster');

    // O estágio é acompanhado em background: esperar aqui prenderia o handler
    // do comando (a lição do `!callp` que travava 46s).
    const acompanhar = async () => {
      const inicio = Date.now();
      while (Date.now() - inicio < 60_000) {
        const call = cli.voip.getCall(novoCallId);
        if (!call) break;
        const est = estagioDoCall(call);
        estagios.set(grupo, est);
        if (est === 'pronta' || est === 'parado') break;
        await new Promise((r) => setTimeout(r, 1000));
      }
    };
    void acompanhar();

    return {
      ok: true,
      callId: novoCallId,
      stage: estagios.get(grupo) || 'aguardando_roster',
      voiceChat: !!voiceChat
    };
  } catch (e) {
    return { ok: false, motivo: 'falha_ao_entrar', detalhe: e?.message || String(e) };
  }
}

/** Estégio da pilha de mídia para um grupo. */
export async function estagioMidia(grupo) {
  if (duble) return duble.estagio(grupo);

  const cli = await obterCliente();
  if (!cli || !cli.voip) return 'indisponivel';

  const callId = callsPorGrupo.get(grupo);
  if (!callId) return estagios.get(grupo) || 'parado';

  const call = cli.voip.getCall(callId);
  const est = estagioDoCall(call);
  estagios.set(grupo, est);
  return est;
}

/** Toca um arquivo de éudio na call do grupo. */
export async function tocarAudioNaCall(grupo, arquivo) {
  if (duble) return duble.tocar(grupo, arquivo);

  const cli = await obterCliente();
  if (!cli || !cli.voip) return { ok: false, motivo: 'pacote_de_midia_ausente' };

  const callId = callsPorGrupo.get(grupo);
  if (!callId) return { ok: false, motivo: 'sem_call' };

  try {
    // O zapo decodifica o arquivo com o ffmpeg do sistema e alimenta o uplink.
    await cli.voip.loadAudio(callId, arquivo);
    return { ok: true, callId };
  } catch (e) {
    return { ok: false, motivo: 'falha_ao_tocar', detalhe: e?.message || String(e) };
  }
}

/** Para o áudio em reprodução, mantendo a call de pé. */
export async function pararAudioDaCall(grupo) {
  if (duble) return duble.parar(grupo);

  const cli = await obterCliente();
  if (!cli || !cli.voip) return { ok: false, motivo: 'pacote_de_midia_ausente' };

  const callId = callsPorGrupo.get(grupo);
  if (!callId) return { ok: false, motivo: 'sem_call' };

  try {
    // Néo há um "parar éudio" dedicado: silenciar o mic local é o que interrompe
    // o que está saindo, sem derrubar a call.
    cli.voip.setMute(callId, true);
    return { ok: true, callId };
  } catch (e) {
    return { ok: false, motivo: 'falha_ao_parar', detalhe: e?.message || String(e) };
  }
}

/** Sai da call e libera a pilha de mídia. */
export async function sairDaCallComMidia(grupo) {
  if (dubleEntrar) return dubleEntrar.sair(grupo);

  const cli = await obterCliente();
  if (!cli || !cli.voip) return { ok: false, motivo: 'pacote_de_midia_ausente' };

  const callId = callsPorGrupo.get(grupo);
  if (!callId) return { ok: true };

  try {
    // Em call de grupo ninguém encerra pelos outros: `leaveCall` tira só este
    // lado. `endCall` faz o mesmo em grupo, mas `leaveCall` é explícito.
    await cli.voip.leaveCall(callId);
  } catch (e) {
    return { ok: false, motivo: e?.message || String(e) };
  } finally {
    callsPorGrupo.delete(grupo);
    estagios.set(grupo, 'parado');
  }
  return { ok: true };
}

/**
 * Descarta a pilha de mídia após um erro nela.
 *
 * Chamado pelo handler de `uncaughtException` do `connect.js`, como no backend
 * anterior: o processo do bot NÃO deve reiniciar, mas a instância precisa ser
 * jogada fora para o préximo `!musicap` não falhar em cima de um estado quebrado.
 */
export function resetarMidia() {
  try {
    if (client?.voip?.dispose) client.voip.dispose();
  } catch { /* nada a fazer */ }
  callsPorGrupo.clear();
  estagios.clear();
  client = null;
  store = null;
  mod = null;
  carregado = false;
  loadError = null;
}

/** Call ativa de um grupo (usado pelo `!callp` para saber o que derrubar). */
export function callIdDoGrupo(grupo) {
  return callsPorGrupo.get(grupo) || null;
}
