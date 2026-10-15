/**
 * Backend de MIDIA de call de grupo via `zapo` (`zapo-js` + `@zapo-js/voip`).
 *
 * ## Por que existe
 *
 * O backend anterior (`lizzy-call`) embrulha o motor WASM do WhatsApp Web e
 * resolvia a sinalizacao, mas o **transporte de midia** sempre discava o relay
 * por `RTCPeerConnection` (`@roamhq/wrtc`). Quando o relay de um call de GRUPO
 * nao traz credencial ICE, nao ha ICE a negociar e a call fica presa em
 * "conectando" para sempre.
 *
 * O `@zapo-js/voip` (v1.4.0) ataca exatamente esse ponto: disca o relay por
 * **UDP cru na porta anunciada quando nao ha credencial ICE**, e so usa WebRTC
 * quando ha. Tambem implementa SFrame/keying por epoca, roster transacional,
 * heartbeat e `peer_state`.
 *
 * ## SESSAO PROPRIA -- e ela PRECISA ser pareada
 *
 * O zapo e' um client COMPLETO: tem credenciais no formato dele
 * (`WaAuthCredentials`) e **nao le** o `creds.json` do Baileys. Sem parear,
 * o offer da call de grupo morre em:
 *
 *     a group call offer has no jid of ours to name as its call-creator
 *
 * Por isso este modulo:
 *   1. PERSISTE as credenciais em `dados/database/zapo-auth/` (store de
 *      arquivo) -- com o store em memoria do pacote, o pareamento se perderia
 *      a cada reinicio do bot;
 *   2. expoe `parear(numero)`, que devolve o CODIGO de 8 digitos para digitar
 *      no WhatsApp (Aparelhos conectados -> Conectar com numero de telefone);
 *   3. devolve `motivo: 'nao_pareado'` em vez de erro criptico.
 *
 * ## Contrato
 *
 * Mesma interface do `callMedia.js`, entao os comandos `!callp` / `!musicap` /
 * `!vozp` e seus testes nao sabem qual backend esta ativo.
 */

import fs from 'fs';
import path from 'path';
import { criarStoreArquivoDoPacote } from './zapoStore.js';
import { DATABASE_DIR } from '../../utils/paths.js';

let mod = null;
let loadError = null;
let carregado = false;

/** Instancia do `WaClient` (uma por processo). */
let client = null;
/** Store PERSISTENTE (as credenciais sobrevivem a reinicio). */
let store = null;
/** Inicializacao em andamento, para nao abrir duas conexoes. */
let conectando = null;
/** Codigo de pareamento pedido nesta sessao (para o comando mostrar). */
let codigoPendente = null;

/** Diretorio onde as credenciais do zapo sao gravadas. */
const AUTH_DIR = path.join(DATABASE_DIR, 'zapo-auth');

/** Mapa grupo -> callId do zapo. */
const callsPorGrupo = new Map();
/** Mapa grupo -> estagio da midia. */
const estagios = new Map();

/** Duble para os testes do bot (mesma porta do `callMedia.js`). */
let duble = null;
let dubleEntrar = null;

export function __setDuble(novo) {
  duble = novo;
}

export function __setDubleEntrar(novo) {
  dubleEntrar = novo;
}

/** Ja existe credencial pareada gravada em disco? */
export function estaPareado() {
  try {
    const arq = path.join(AUTH_DIR, 'auth.json');
    if (!fs.existsSync(arq)) return false;
    const dados = JSON.parse(fs.readFileSync(arq, 'utf8'));
    const c = dados?.credentials;
    return Boolean(c?.meJid || c?.meLid);
  } catch {
    return false;
  }
}

/** O JID/LID deste dispositivo no zapo, ou null. */
export function meuJid() {
  try {
    const arq = path.join(AUTH_DIR, 'auth.json');
    const dados = JSON.parse(fs.readFileSync(arq, 'utf8'));
    const c = dados?.credentials;
    return c?.meLid || c?.meJid || null;
  } catch {
    return null;
  }
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
    console.warn('[ZAPOCALL] pacotes indisponiveis:', loadError);
    mod = null;
  }
  return mod;
}

/** Motivo pelo qual os pacotes nao carregaram, ou null. */
export function motivoZapo() {
  return loadError;
}

/**
 * O `WaClient` conectado, criado na primeira necessidade.
 *
 * O store e' de ARQUIVO: as credenciais vao para `dados/database/zapo-auth/` e
 * sobrevivem ao reinicio. Foi essa a correcao do "pareia e perde".
 */
export async function obterCliente() {
  const m = await carregarZapo();
  if (!m) return null;
  if (client) return client;
  if (conectando) return conectando;

  // Em teste nao se abre conexao de verdade (emitiria QR/pareamento).
  if (process.env.ZAPO_DISABLE_CONNECT === '1' || process.env.NODE_ENV === 'test') {
    loadError = 'conexao desabilitada em teste (ZAPO_DISABLE_CONNECT)';
    return null;
  }

  conectando = (async () => {
    try {
      const { createStore, WaClient, ConsoleLogger, voipPlugin } = m;

      // Backend de ARQUIVO cobrindo os dominios de persistencia. As caixas de
      // mensagens ficam de fora ('none'): o zapo aqui so carrega a MIDIA.
      const backend = await criarStoreArquivoDoPacote(AUTH_DIR, (m) => console.warn(m));

      store = createStore({
        backends: { arquivo: backend },
        providers: {
          auth: 'arquivo',
          signal: 'arquivo',
          preKey: 'arquivo',
          session: 'arquivo',
          identity: 'arquivo',
          senderKey: 'arquivo',
          appState: 'arquivo',
          privacyToken: 'arquivo',
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
              // O ponto da migracao: UDP cru quando o relay de grupo nao traz
              // credencial ICE. Sem isto, o sintoma e' o "conectando" infinito.
              useRawUdpTransport: true,
              logLevel: process.env.ZAPO_LOG_LEVEL || 'warn'
            })
          ]
        },
        new ConsoleLogger(process.env.ZAPO_LOG_LEVEL || 'warn')
      );

      client.on('auth_qr', ({ qr }) => {
        console.log('[ZAPOCALL] QR disponivel. Prefira o codigo: !callp parear <numero>');
        console.log(qr);
      });
      client.on('auth_pairing_required', () => {
        console.log('[ZAPOCALL] pronto para receber o codigo de pareamento');
      });
      client.on('auth_paired', ({ credentials }) => {
        console.log('[ZAPOCALL] PAREADO como', credentials?.meJid || credentials?.meLid);
      });
      client.on('voip_call_state', (call) => {
        console.log(`[ZAPOCALL] call ${call.callId} -> ${call.stateData?.state}`);
      });
      client.on('voip_call_error', (err) => {
        console.warn('[ZAPOCALL] erro na call:', err?.message || err);
      });

      // `connect()` so resolve DEPOIS do pareamento; nao se espera por ele aqui
      // (senao o comando penduraria). Quem espera e' o `parear()`.
      void client.connect().catch((e) => {
        console.warn('[ZAPOCALL] connect:', e?.message || e);
      });

      return client;
    } catch (e) {
      loadError = e?.message || String(e);
      console.warn('[ZAPOCALL] falha ao criar o client:', loadError);
      client = null;
      return null;
    } finally {
      conectando = null;
    }
  })();

  return conectando;
}

/**
 * Pede o CODIGO de pareamento para um numero.
 *
 * O usuario digita o codigo no WhatsApp: Aparelhos conectados -> Conectar com
 * numero de telefone. Depois disso as credenciais ficam gravadas em
 * `dados/database/zapo-auth/` e a call de grupo funciona.
 *
 * @param {string} numero somente digitos, com DDI (ex.: 5511999999999)
 * @returns {Promise<{ok:boolean, codigo?:string, motivo?:string, detalhe?:string}>}
 */
export async function parear(numero) {
  const limpo = String(numero || '').replace(/\D/g, '');
  if (limpo.length < 10) {
    return { ok: false, motivo: 'numero_invalido' };
  }

  const cli = await obterCliente();
  if (!cli?.auth?.requestPairingCode) {
    return { ok: false, motivo: 'pacote_de_midia_ausente', detalhe: loadError };
  }

  try {
    const codigo = await cli.auth.requestPairingCode(limpo);
    codigoPendente = codigo;
    return { ok: true, codigo };
  } catch (e) {
    return { ok: false, motivo: 'falha_ao_parear', detalhe: e?.message || String(e) };
  }
}

/** O codigo de pareamento pedido nesta sessao, ou null. */
export function codigoDePareamento() {
  return codigoPendente;
}

/**
 * Traduz o estado do zapo para os estagios que o bot ja conhece.
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
 * Entra na call de grupo como participante de MIDIA.
 *
 * Falha FECHADO quando nao ha pareamento: subir a call sem credencial daria o
 * erro criptico do `call-creator` e o usuario nao saberia o que fazer.
 */
export async function entrarNaCallComMidia({ grupo, callId, callCreator, participantes, sock, voiceChat = false }) {
  if (dubleEntrar) return dubleEntrar.entrar({ grupo, callId, callCreator, participantes, sock, voiceChat });

  // Checa o pareamento ANTES de tocar no motor (e' o que faltava).
  if (!estaPareado()) {
    return { ok: false, motivo: 'nao_pareado' };
  }

  const cli = await obterCliente();
  if (!cli?.voip) {
    return { ok: false, motivo: 'pacote_de_midia_ausente', detalhe: loadError };
  }

  try {
    const alvos = (participantes || []).map((jid) => ({ jid }));

    const novoCallId = await cli.voip.startCall({
      groupJid: grupo,
      participants: alvos
    });

    callsPorGrupo.set(grupo, novoCallId);
    estagios.set(grupo, 'aguardando_roster');

    // O estagio e' acompanhado em background: esperar aqui prenderia o handler.
    const acompanhar = async () => {
      const inicio = Date.now();
      while (Date.now() - inicio < 60000) {
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

/** Estagio da pilha de midia para um grupo. */
export async function estagioMidia(grupo) {
  if (duble) return duble.estagio(grupo);

  const cli = await obterCliente();
  if (!cli?.voip) return 'indisponivel';

  const callId = callsPorGrupo.get(grupo);
  if (!callId) return estagios.get(grupo) || 'parado';

  const call = cli.voip.getCall(callId);
  const est = estagioDoCall(call);
  estagios.set(grupo, est);
  return est;
}

/** Toca um arquivo de audio na call do grupo. */
export async function tocarAudioNaCall(grupo, arquivo) {
  if (duble) return duble.tocar(grupo, arquivo);

  const cli = await obterCliente();
  if (!cli?.voip) return { ok: false, motivo: 'pacote_de_midia_ausente' };

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

/** Para o audio em reproducao, mantendo a call de pe. */
export async function pararAudioDaCall(grupo) {
  if (duble) return duble.parar(grupo);

  const cli = await obterCliente();
  if (!cli?.voip) return { ok: false, motivo: 'pacote_de_midia_ausente' };

  const callId = callsPorGrupo.get(grupo);
  if (!callId) return { ok: false, motivo: 'sem_call' };

  try {
    // Nao ha "parar audio" dedicado: silenciar o mic local interrompe a saida
    // sem derrubar a call.
    cli.voip.setMute(callId, true);
    return { ok: true, callId };
  } catch (e) {
    return { ok: false, motivo: 'falha_ao_parar', detalhe: e?.message || String(e) };
  }
}

/** Sai da call e libera a pilha de midia. */
export async function sairDaCallComMidia(grupo) {
  if (dubleEntrar) return dubleEntrar.sair(grupo);

  const cli = await obterCliente();
  if (!cli?.voip) return { ok: false, motivo: 'pacote_de_midia_ausente' };

  const callId = callsPorGrupo.get(grupo);
  if (!callId) return { ok: true };

  try {
    // Em call de grupo ninguem encerra pelos outros: `leaveCall` tira so este
    // lado.
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
 * Descarta a pilha de midia apos um erro nela.
 *
 * Chamado pelo handler de `uncaughtException` do `connect.js`. NAO apaga as
 * credenciais: o pareamento e' persistente de proposito.
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
  // `codigoPendente` fica: o usuario ainda pode usar o codigo que recebeu.
}

/** Call ativa de um grupo. */
export function callIdDoGrupo(grupo) {
  return callsPorGrupo.get(grupo) || null;
}

/** Diretorio das credenciais (para log/diagnostico). */
export function diretorioAuth() {
  return AUTH_DIR;
}
