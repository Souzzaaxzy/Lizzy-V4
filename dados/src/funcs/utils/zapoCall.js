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
 * seus testes nao sabem qual backend esta ativo.
 */

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { criarStoreArquivoDoPacote } from './zapoStore.js';
import { instalarBitrate, configuracaoEmUso, caminhoCompanionEsperado } from '../../utils/mlowBitrate.js';
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
/** A conexao esta ABERTA agora? (`connection: {status:'open'}`) */
let conectado = false;
/** Promessa que resolve quando a conexao abre (evita esperar em vao). */
let esperandoAbertura = null;
/** Timer de reconexao (o zapo nao reconecta sozinho). */
let timerReconexao = null;
/** Callbacks de "o audio terminou", por grupo (a fila avanca com isso). */
const aoTerminarPorGrupo = new Map();
/** Callbacks de "a call CAIU sozinha", por grupo (o bot limpa o estado). */
const aoEncerrarPorGrupo = new Map();

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
 * Quantas chamadas simultaneas o motor aceita.
 *
 * A doc: *"Maximum simultaneous non-ended calls (ringing, connecting, or
 * active). Default is 1. Increase to enable parallel multi-call."*
 *
 * Padrao 3 (pedido do dono); `ZAPO_MAX_CALLS` ajusta. Nunca abaixo de 1 --
 * zero travaria toda call.
 */
function maxCalls() {
  const n = Number.parseInt(process.env.ZAPO_MAX_CALLS || '3', 10);
  return Number.isFinite(n) && n > 0 ? n : 3;
}

/**
 * O RED do MLow esta ligado?
 *
 * "each packet carries the low-rate copy of the previous frame... and DTX is
 * off". Reduz o CORTE (concealment 3,1% sob ~18% de perda, medido contra o
 * WA Web). Nao melhora o timbre. Ligado por padrao; `ZAPO_MLOW_RED=0` desliga.
 */
function usarMlowRed() {
  return process.env.ZAPO_MLOW_RED !== '0';
}

/**
 * Caminho do modelo do MLow Companion (o pos-filtro neural do decoder).
 *
 * E' o que melhora o TIMBRE -- o "abafado". A doc avisa que nenhum pacote traz
 * o blob (`mlow_companion_v1.pte`), entao so passamos a opcao se o arquivo
 * existir. Sem ele a call decodifica sem o filtro, sem quebrar.
 *
 * @returns {string|null}
 */
function caminhoCompanion() {
  const caminho = process.env.ZAPO_MLOW_COMPANION
    || path.join(DATABASE_DIR, 'zapo-models', 'mlow_companion_v1.pte');
  try {
    return fs.existsSync(caminho) ? caminho : null;
  } catch {
    return null;
  }
}

/**
 * Espera a conexao ABRIR.
 *
 * O `connect()` resolve quando o client esta pronto, mas o evento
 * `connection: {status:'open'}` e' o sinal de que da' para enviar stanza --
 * e o zapo pode cair DEPOIS do connect. Por isso esperamos o evento.
 *
 * @param {number} [timeoutMs]
 * @returns {Promise<boolean>} true se abriu
 */
function aguardarConexao(timeoutMs = 30000) {
  if (conectado) return Promise.resolve(true);
  if (!client) return Promise.resolve(false);
  if (esperandoAbertura) return esperandoAbertura;

  esperandoAbertura = new Promise((resolve) => {
    let resolvido = false;
    const terminar = (ok) => {
      if (resolvido) return;
      resolvido = true;
      clearTimeout(timer);
      esperandoAbertura = null;
      resolve(ok);
    };
    const timer = setTimeout(() => terminar(conectado), timeoutMs);
    client.once('connection', (ev) => {
      if (ev?.status === 'open') terminar(true);
      else if (ev?.status === 'close') terminar(false);
    });
  });

  return esperandoAbertura;
}

/**
 * Agenda uma reconexao com backoff.
 *
 * O zapo NAO reconecta sozinho (a doc e' explicita). Sem isto, uma queda de
 * rede deixaria a call muda ate' o bot reiniciar.
 */
function agendarReconexao() {
  if (timerReconexao) return;
  timerReconexao = setTimeout(async () => {
    timerReconexao = null;
    if (conectado || !client) return;
    console.log('[ZAPOCALL] reconectando...');
    try {
      await client.connect();
      await aguardarConexao(30000);
    } catch (e) {
      console.warn('[ZAPOCALL] reconexao falhou:', e?.message || e);
      agendarReconexao();
    }
  }, 5000);
  // Nao segura o processo do bot por causa deste timer.
  if (typeof timerReconexao.unref === 'function') timerReconexao.unref();
}

/**
 * O `WaClient` conectado, criado na primeira necessidade.
 *
 * O store e' de ARQUIVO: as credenciais vao para `dados/database/zapo-auth/` e
 * sobrevivem ao reinicio. Foi essa a correcao do "pareia e perde".
 *
 * QUANDO JA ESTA PAREADO, espera a conexao ABRIR antes de devolver. Sem isso o
 * `startCall` saia numa conexao fechada e a call ficava em "conectando" para
 * sempre (era o bug: `void client.connect()` seguido de `return client`).
 *
 * SEM pareamento nao espera: o `connect()` fica pendente de proposito enquanto
 * o usuario digita o codigo, e o comando precisa responder na hora.
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

      // Ajusta o encoder MLow (bitrate 30 kbps + complexidade 10 + FEC).
      // Instalado ANTES de criar o client: o media plane carrega o codec na
      // primeira call, entao o gancho precisa estar no lugar antes disso.
      await instalarBitrate().catch(() => false);

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
              // NAO use `useRawUdpTransport: true`.
              //
              // A doc do pacote marca o flag como EXPERIMENTAL e o deixa
              // `false` por padrao, e o codigo dele ja decide a escolha certa:
              //
              //   rawUdpLegs: useRawUdpTransport ? 'all' : 'required'
              //
              // Com 'all' TODO relay vira UDP cru -- inclusive os que so
              // respondem por WebRTC -- e a leg se fecha sozinha:
              //   "raw udp leg rolled back, no media on the return path"
              //   reason: 'raw_udp_no_return_path'
              //
              // Com o padrao ('required') o pacote usa UDP cru SO onde o relay
              // exige (sem credencial ICE) e WebRTC no resto.
              logLevel: process.env.ZAPO_LOG_LEVEL || 'warn',

              // Chamadas simultaneas (ringing/connecting/active). O padrao do
              // pacote e' 1 -- era o que dava
              // "max concurrent calls reached (1)".
              maxConcurrentCalls: maxCalls(),

              // ---- Qualidade de audio -------------------------------------
              // RED: cada pacote leva a copia de baixa taxa do frame anterior,
              // entao um pacote perdido nao vira silencio. Reduz o CORTE.
              // Custo: desliga o DTX (o RED exige).
              mlowRed: usarMlowRed(),

              // Pos-filtro neural do decoder (melhora o TIMBRE). So vai se o
              // arquivo de pesos existir -- nenhum pacote traz esse blob.
              ...(caminhoCompanion() ? { mlowCompanionModel: caminhoCompanion() } : {})
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
      // Uma linha dizendo o que ficou LIGADO (para nao depender de suposicao).
      {
        const companion = caminhoCompanion();
        const cfg = configuracaoEmUso() || {};
        const kbps = cfg.bitrate ? `${Math.round(cfg.bitrate / 1000)} kbps` : 'padrao (15 kbps)';
        const cx = cfg.complexity !== null && cfg.complexity !== undefined ? cfg.complexity : 'padrao (5)';
        const perda = cfg.packetLossPercent !== null && cfg.packetLossPercent !== undefined
          ? `${cfg.packetLossPercent}%` : '0%';
        console.log(
          `[ZAPOCALL] audio: RED ${usarMlowRed() ? 'ligado' : 'desligado'}` +
          ` | bitrate ${kbps} | complexidade ${cx} | perda esperada ${perda}` +
          ` | pos-filtro neural ${companion ? `ligado (${companion})` : 'INDISPONIVEL'}` +
          (companion ? '' : ` (o pacote nao traz o blob; coloque o peso em ${caminhoCompanionEsperado()})`)
        );
      }

      // ---- Diagnostico da call -------------------------------------------
      // Os eventos abaixo sao os que dizem ONDE a midia esta. Sem eles, um
      // problema de relay aparece so como "a call morreu".
      client.on('voip_call_state', (call) => {
        console.log(`[ZAPOCALL] call ${call.callId} -> ${call.stateData?.state}`);
      });

      // O roster: quem o servidor diz que esta na call. Uma call de grupo so
      // fica 'active' quando OUTRA pessoa aparece conectada.
      client.on('voip_call_participants_changed', ({ call, diff }) => {
        const entrou = (diff?.added || []).map((p) => p.jid).join(', ') || '-';
        const saiu = (diff?.removed || []).map((r) => r.jid).join(', ') || '-';
        console.log(`[ZAPOCALL] roster ${call.callId} | entrou: ${entrou} | saiu: ${saiu}`);
      });

      // A PROVA de que a midia flui: a midia de alguem chegou ate nos.
      client.on('voip_call_participant_media', ({ call, participantJid, receiving }) => {
        console.log(`[ZAPOCALL] midia de ${participantJid} -> ${receiving ? 'CHEGANDO' : 'parou'} (${call.callId})`);
      });

      // O motivo do fim. `relay_lost` = a call tinha caminho de midia e perdeu
      // (o caso do "conectando"); `invisible` = o servidor nos tirou porque os
      // outros pararam de nos receber.
      client.on('voip_call_ended', (call) => {
        const motivo = call.stateData?.endReason || 'sem motivo informado';
        console.warn(`[ZAPOCALL] call ${call.callId} ENCERROU | motivo: ${motivo}`);
        processarCallEncerrada(call.callId, motivo);
      });

      client.on('voip_call_error', (err) => {
        console.warn('[ZAPOCALL] erro na call:', err?.message || err);
      });

      // O AUDIO TERMINOU: e' o que faz a FILA andar sozinha. O motor emite
      // 'voip_call_outbound_audio_finished' quando o arquivo carregado acaba;
      // sem isto a fila ficaria parada na primeira musica.
      client.on('voip_call_outbound_audio_finished', (call) => {
        const callId = call?.callId;
        if (!callId) return;
        for (const [grupo, id] of callsPorGrupo.entries()) {
          if (id !== callId) continue;
          const cb = aoTerminarPorGrupo.get(grupo);
          if (typeof cb === 'function') {
            Promise.resolve(cb(grupo)).catch((e) =>
              console.warn('[ZAPOCALL] aoTerminar:', e?.message || e));
          }
          break;
        }
      });

      // Estado da conexao: e' o sinal que o `startCall` precisa.
      client.on('connection', (ev) => {
        if (ev?.status === 'open') {
          conectado = true;
          console.log('[ZAPOCALL] conexao ABERTA');
        } else if (ev?.status === 'close') {
          conectado = false;
          console.warn(`[ZAPOCALL] conexao FECHOU (${ev?.reason || 'motivo desconhecido'})`);
          // Deslogado (aparelho removido) nao se reconecta: precisa parear.
          if (ev?.isLogout) {
            console.warn('[ZAPOCALL] dispositivo desvinculado -- pareie de novo com !callp parear');
            return;
          }
          agendarReconexao();
        }
      });

      // O `connect()` resolve quando o client esta pronto. Com pareamento ja
      // feito, ESPERAMOS -- e' o que impede o offer de sair numa conexao
      // fechada. Sem pareamento, nao esperamos (o promise fica pendente).
      const jaPareado = estaPareado();
      if (jaPareado) {
        await client.connect().catch((e) => {
          console.warn('[ZAPOCALL] connect:', e?.message || e);
        });
        const abriu = await aguardarConexao(30000);
        if (!abriu) {
          console.warn('[ZAPOCALL] conexao nao abriu em 30s');
        }
      } else {
        void client.connect().catch((e) => {
          console.warn('[ZAPOCALL] connect:', e?.message || e);
        });
      }

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
    // O codigo so pode ser pedido quando o client esta pronto para parear.
    await cli.connect?.().catch(() => {});
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
 * Converte uma lista de jids para **LID**, usando a API do PROPRIO zapo.
 *
 * ## Por que isto existe (a causa do "conectando" infinito)
 *
 * O `startCall` de grupo exige `participants[].jid` em **LID** — a doc do
 * pacote diz, literalmente, *"The account to ring, a LID"*, e o exemplo dela
 * usa `112984198234339@lid`. O `resolvePeerLid` (PN -> LID) **so' roda no
 * 1:1**: o `startGroupCall` usa o jid **cru**.
 *
 * O bot montava a lista com o `part.lid` do metadata do **Baileys**. So' que o
 * Baileys e o zapo sao **sessoes DIFERENTES** (o Baileys e' o bot do WhatsApp;
 * o zapo e' o motor da call, pareado a parte). O LID de uma sessao nao vale
 * para a outra — e quando o metadata nao traz `lid` (grupo PN), a lista ia por
 * **PN** e a call nunca saia de `connecting`.
 *
 * A doc oficial (zapo.to/en/concepts/identities.md) manda resolver pelo
 * **profile coordinator**: `client.profile.getLidsByPhoneNumbers([...])`, que
 * devolve `{ queriedJid, phoneJid, lidJid, exists, invalid }` por entrada.
 *
 * Best-effort: o que nao resolver fica como veio (melhor tentar do que
 * derrubar a chamada). O `queriedJid` e' o que correlaciona o resultado com a
 * entrada — NAO o indice (o servidor pode corrigir o numero).
 *
 * @param {object} cli o cliente do zapo
 * @param {string[]} jids
 * @returns {Promise<string[]>} os jids, com LID onde deu para resolver
 */
async function resolverLids(cli, jids) {
  const lista = [...new Set((jids || []).filter((j) => typeof j === 'string' && j))];
  if (lista.length === 0) return [];
  // So' o que e' PN precisa de conversao; LID ja' esta' pronto.
  const pns = lista.filter((j) => !j.endsWith('@lid'));
  if (pns.length === 0) return lista;

  const porPn = new Map();
  try {
    const numeros = pns.map((j) => j.split('@')[0].split(':')[0]);
    const res = await cli?.profile?.getLidsByPhoneNumbers?.(numeros);
    for (const r of res || []) {
      // `queriedJid` correlaciona por VALOR (o servidor corrige o numero).
      const chave = String(r?.queriedJid || r?.phoneJid || '').split('@')[0].split(':')[0];
      if (chave && r?.lidJid) porPn.set(chave, r.lidJid);
    }
  } catch (e) {
    console.warn('[ZAPOCALL] nao consegui resolver os LIDs:', e?.message || e);
  }

  return lista.map((j) => {
    if (j.endsWith('@lid')) return j;
    const numero = j.split('@')[0].split(':')[0];
    return porPn.get(numero) || j;
  });
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
 * O backend zapo (preferido) nao expoe o flag de chat de voz (`lightweight`):
 * o `CallOfferOptions` dele so aceita `isVideo`/`audioFile`, e o
 * `lightweight_key` e' apenas LIDO de um `<group_info>` recebido, nunca
 * escrito. Entao nao ha o que repassar -- subir sempre como chamada normal.
 *
 * Falha FECHADO quando nao ha pareamento: subir a call sem credencial daria o
 * erro criptico do `call-creator` e o usuario nao saberia o que fazer.
 */
export async function entrarNaCallComMidia({ grupo, callId, callCreator, participantes, sock }) {
  if (dubleEntrar) return dubleEntrar.entrar({ grupo, callId, callCreator, participantes, sock });

  // Checa o pareamento ANTES de tocar no motor (e' o que faltava).
  if (!estaPareado()) {
    return { ok: false, motivo: 'nao_pareado' };
  }

  const cli = await obterCliente();
  if (!cli?.voip) {
    return { ok: false, motivo: 'pacote_de_midia_ausente', detalhe: loadError };
  }

  // CONFIRMA a conexao aberta antes de mandar o offer. Sem isto o startCall
  // saia numa conexao fechada e a call ficava em "conectando" para sempre.
  if (!conectado) {
    const abriu = await aguardarConexao(20000);
    if (!abriu) {
      return { ok: false, motivo: 'sem_conexao' };
    }
  }

  try {
    // O motor exige LID em `participants[].jid` (a doc: *"The account to
    // ring, a LID"*). Resolvemos pelo PROPRIO zapo — o LID do Baileys e' de
    // outra sessao e nao vale aqui.
    const emLid = await resolverLids(cli, participantes);
    const alvos = emLid.map((jid) => ({ jid }));
    console.log(`[ZAPOCALL] convidados: ${alvos.length} | em LID: ${alvos.filter((a) => a.jid.endsWith('@lid')).length}`);

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
      stage: estagios.get(grupo) || 'aguardando_roster'
    };
  } catch (e) {
    return { ok: false, motivo: 'falha_ao_entrar', detalhe: e?.message || String(e) };
  }
}

/** Exportado para o TESTE medir a conversao PN -> LID (a causa do "conectando"). */
export const __resolverLids = resolverLids;

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

/**
 * Para o audio em reproducao, mantendo a call de pe.
 *
 * ## O BUG que isto corrige
 *
 * Antes daqui saia um `setMute(callId, true)` e NADA revertia o mute. O
 * `setMute` silencia a CAPTURA da call inteira (a doc: *"mutes our capture
 * and announces it; the media keeps sending silence"*), entao depois de um
 * `!musicap parar` com a fila vazia a call ficava MUDA para sempre: o bot
 * dizia "tocando agora" mas nao saia som nenhum. Era exatamente o relato.
 *
 * ## Como parar de verdade
 *
 * O motor nao tem "stop": carregar um arquivo SUBSTITUI o que estava
 * tocando (`WaAudioEngine.loadAudioFile` zera o `audioPosition`). Entao
 * carregamos um WAV de SILENCIO -- a saida para sem mexer no mute da call.
 *
 * Best-effort: sem ffmpeg (ou se o silencio falhar) ainda desmutamos, para
 * nunca deixar a call muda.
 */
export async function pararAudioDaCall(grupo) {
  if (duble) return duble.parar(grupo);

  const cli = await obterCliente();
  if (!cli?.voip) return { ok: false, motivo: 'pacote_de_midia_ausente' };

  const callId = callsPorGrupo.get(grupo);
  if (!callId) return { ok: false, motivo: 'sem_call' };

  // Desmuta SEMPRE: se uma versao anterior deixou a call muda, isto a
  // devolve. E' barato e idempotente.
  try { cli.voip.setMute(callId, false); } catch { /* segue */ }

  try {
    const silencio = await silencioWav();
    if (silencio) await cli.voip.loadAudio(callId, silencio);
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
  aoTerminarPorGrupo.clear();
  aoEncerrarPorGrupo.clear();
  conectado = false;
  esperandoAbertura = null;
  if (timerReconexao) {
    clearTimeout(timerReconexao);
    timerReconexao = null;
  }
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

/**
 * Registra o que fazer quando o audio de um grupo termina.
 *
 * O `index.js` usa isto para avancar a fila. E' callback (e nao import) porque
 * o `callPlayer` importa o `callMedia`, que importa este modulo -- importar de
 * volta criaria ciclo.
 *
 * @param {string} grupo
 * @param {Function|null} cb `(grupo) => void` (null remove)
 */
export function aoTerminarAudio(grupo, cb) {
  if (cb === null) aoTerminarPorGrupo.delete(grupo);
  else aoTerminarPorGrupo.set(grupo, cb);
}

/**
 * Registra o que fazer quando a call de um grupo CAI sozinha.
 *
 * O motor derruba a call por conta propria (relay perdido, todos sairam, o
 * servidor nos tirou) e isso NAO passa por nenhum comando. Sem este aviso o
 * registro do bot (`callOffer.callsAtivas`) ficava com uma entrada morta: o
 * `!callp` respondia "ja existe chamada" para sempre e o cache de audio do
 * grupo nunca era limpo. O `index.js` usa isto para reconciliar.
 *
 * Mesmo formato do `aoTerminarAudio`: callback (e nao import) porque o
 * `index.js` importa este modulo -- importar de volta criaria ciclo.
 *
 * @param {string} grupo
 * @param {Function|null} cb `(grupo, motivo) => void` (null remove)
 */
export function aoEncerrarAudio(grupo, cb) {
  if (cb === null) aoEncerrarPorGrupo.delete(grupo);
  else aoEncerrarPorGrupo.set(grupo, cb);
}

/**
 * Caminho de um WAV de SILENCIO (1 s, 16 kHz mono), gerado uma vez.
 *
 * Serve para "parar" a reproducao: o motor troca o arquivo em curso por
 * este. Sem ffmpeg devolve `null` e o chamador so' desmuta.
 *
 * @returns {Promise<string|null>}
 */
let _silencio = null;
async function silencioWav() {
  if (_silencio) return _silencio;
  try {
    const dir = path.join(DATABASE_DIR, 'zapo-models');
    fs.mkdirSync(dir, { recursive: true });
    const destino = path.join(dir, 'silencio-16k.wav');
    if (fs.existsSync(destino)) { _silencio = destino; return destino; }
    const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
    await new Promise((resolve, reject) => {
      const p = spawn(ffmpeg, [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono',
        '-t', '1', '-c:a', 'pcm_s16le', destino
      ], { stdio: ['ignore', 'ignore', 'ignore'] });
      p.on('error', reject);
      p.on('close', (code) => (code === 0 ? resolve() : reject(new Error('ffmpeg ' + code))));
    });
    if (!fs.existsSync(destino)) return null;
    _silencio = destino;
    return destino;
  } catch {
    return null;
  }
}

/** A conexao esta aberta agora? (diagnostico) */
export function conexaoAberta() {
  return conectado;
}

/**
 * Processa o fim de uma call: limpa o registro do motor e avisa o bot.
 *
 * Vive numa funcao (e nao dentro do listener) porque o listener real so existe
 * com um `WaClient` de verdade -- e o teste precisa exercitar ESTE caminho, nao
 * uma copia dele. O `__simularCallEncerrada` chama esta mesma funcao.
 *
 * O BOT tambem tem o proprio registro (`callOffer.callsAtivas`), e ele nao e'
 * sincronizado sozinho. Sem este aviso, uma call que cai sozinha deixava o
 * `!callp` respondendo "ja existe chamada" para sempre, e o cache de audio do
 * grupo (ate 300 MB) no disco.
 *
 * @param {string} callId
 * @param {string} motivo
 */
function processarCallEncerrada(callId, motivo) {
  for (const [grupo, id] of callsPorGrupo.entries()) {
    if (id !== callId) continue;
    callsPorGrupo.delete(grupo);
    estagios.set(grupo, 'parado');
    const cb = aoEncerrarPorGrupo.get(grupo);
    if (typeof cb === 'function') {
      Promise.resolve(cb(grupo, motivo)).catch((e) =>
        console.warn('[ZAPOCALL] aoEncerrar:', e?.message || e));
    }
  }
}

/**
 * Gancho de TESTE: simula o motor encerrando uma call.
 *
 * Chama exatamente o caminho que o evento `voip_call_ended` chama, para o teste
 * medir o comportamento real sem precisar de um `WaClient` conectado.
 *
 * @param {string} callId
 * @param {string} [motivo]
 */
export function __simularCallEncerrada(callId, motivo = 'teste') {
  processarCallEncerrada(callId, motivo);
}

/**
 * Gancho de TESTE: registra grupo -> callId no mapa do motor.
 *
 * Faz o mesmo que o `entrarNaCallComMidia` real faz. Existe porque o dublê de
 * mídia dos testes substitui o `entrarNaCallComMidia` inteiro, entao o mapa
 * ficaria vazio e o `__simularCallEncerrada` nao acharia o grupo.
 *
 * @param {string} grupo
 * @param {string} callId
 */
export function __registrarCallDeTeste(grupo, callId) {
  callsPorGrupo.set(grupo, callId);
  estagios.set(grupo, 'aguardando_roster');
}
