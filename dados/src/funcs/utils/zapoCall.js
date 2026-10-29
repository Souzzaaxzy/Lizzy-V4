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
import { instalarBitrate } from '../../utils/mlowBitrate.js';
import { criarLoggerDoMotor, ehStanzaDeChat } from '../../utils/motorLogger.js';
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

/**
 * Callbacks de "chegou audio de ENTRADA na call", por grupo.
 *
 * O motor emite `voip_call_inbound_audio` com PCM 16 kHz mono -- o audio de
 * quem fala, ja' decodificado. E' o que o `!iap` (agente de voz) consome para
 * ouvir a call. Mesmo padrao dos outros callbacks: o `index.js` registra e este
 * modulo so' repassa.
 */
const aoOuvirPorGrupo = new Map();

/** Diretorio onde as credenciais do zapo sao gravadas. */
const AUTH_DIR = path.join(DATABASE_DIR, 'zapo-auth');

/** Valores de `ZAPO_RAW_UDP` que ligam o transporte por UDP cru. */
const VALORES_LIGADOS = new Set(['all', '1', 'true', 'on', 'sim', 'yes']);

/**
 * Le `ZAPO_RAW_UDP` e diz se o transporte por UDP cru esta ligado.
 *
 * <p>O padrao e' DESLIGADO, e isso e' uma decisao MEDIDA: com o UDP cru a leg sobe
 * e nao recebe nada de volta (`raw_udp_no_return_path`) e, ao contrario da leg
 * WebRTC, ela **derruba a call** (`call lost its last relay leg` -> `relay_lost`).
 * Sem ela a call fica de pe' e so' a midia nao flui.
 *
 * <p>A env existe para experimento, nao para producao: quem liga assume que a call
 * pode cair. A escolha e' registrada uma vez (ver {@link avisarTransporte}).
 */
function ligarUdpCru() {
  return VALORES_LIGADOS.has(String(process.env.ZAPO_RAW_UDP ?? '').trim().toLowerCase());
}

/** Ja' avisamos a escolha do transporte? (uma linha por processo, nao por call.) */
let avisouTransporte = false;

/**
 * Diz, no log, qual transporte de relay o motor vai usar.
 *
 * <p>Sem esta linha, "a env nao chegou" e "a env chegou e o caminho nao ajuda" dao
 * o MESMO log (sctp/webrtc falhando). Foi exatamente o que aconteceu: o dono ligou
 * a env e o log continuou identico, sem dizer se o valor tinha sido lido.
 */
function avisarTransporte() {
  if (avisouTransporte) return;
  avisouTransporte = true;
  const bruto = process.env.ZAPO_RAW_UDP;
  const ligado = ligarUdpCru();
  console.log(
    `[MOTOR] transporte do relay: ${ligado ? 'UDP CRU (ZAPO_RAW_UDP ligado)' : 'WebRTC (padrao)'}` +
      ` | ZAPO_RAW_UDP=${bruto === undefined ? '(nao definida)' : JSON.stringify(bruto)}`
  );
}

/** Teto da consulta de LID (best-effort; estourou, seguimos com o numero). */
const LID_LOOKUP_TIMEOUT_MS = 8000;

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
    mod = null;
  }
  return mod;
}

/** Motivo pelo qual os pacotes nao carregaram, ou null. */
export function motivoZapo() {
  return loadError;
}

/** Exportado para o teste medir a escolha da porta do relay. */
export const __usarPortaOriginalDoRelay = usarPortaOriginalDoRelay;

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
 * O motor deve discar o relay na porta ANUNCIADA (`original`) em vez da porta do
 * cliente web (3480)?
 *
 * O padrao do motor NAO e' seguro: `WaCallManager.createMediaLink` usa
 * `useOriginalRelayPort ?? !isMobilePrimary()`, entao **nao** passar a opcao
 * deixa o valor depender da identidade com que a sessao subiu. Quando cai no modo
 * `original`, o relay e' discado na porta anunciada (tipicamente 3478) e a leg
 * NAO fecha: o motor entao encerra a call sozinho —
 *
 *   WaCallMediaSession.onRelayLost -> endCall(EndCallReason.RelayLost)
 *
 * que chega ao bot como `voip_call_ended` e vira a mensagem de "A chamada foi
 * encerrada" logo depois de a call subir.
 *
 * A doc do proprio pacote (`WaVoipCoordinatorOptions.useOriginalRelayPort`) diz
 * que `false` (3480) e' o que o WhatsApp Web faz e que o outro modo "e' a escolha
 * ERRADA" contra os relays da WhatsApp. Por isso aqui o padrao e' **web (3480)**
 * e a opcao e' SEMPRE passada — deixar o motor decidir e' o defeito.
 *
 * `CALL_RELAY_PORT_MODE=original` volta ao modo antigo (documentado no
 * `.env.example` como o que NAO funciona).
 *
 * @returns {boolean} true = disca a porta anunciada (modo antigo)
 */
function usarPortaOriginalDoRelay() {
  const modo = String(process.env.CALL_RELAY_PORT_MODE || 'web').trim().toLowerCase();
  return modo === 'original' || modo === 'anunciada' || modo === 'advertised';
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
 * Roda uma promessa do motor com TETO DURO.
 *
 * ## Por que existe (o travamento do bot)
 *
 * O motor do zapo e' um client PROPRIO, mas roda no MESMO processo do bot. Uma
 * promessa dele que nunca resolve nao trava so' a call: o handler daquela
 * mensagem nunca retorna, e o `messageQueue` do bot so' avanca depois que o
 * LOTE inteiro termina (`await Promise.allSettled(batches...)`). Resultado
 * medido no incidente: **o bot inteiro parou de responder** e so' voltou com
 * restart pela host.
 *
 * As esperas do motor (`startCall`, o usync de devices, o ack do offer) nao
 * tem teto garantido do lado de fora, e `await` sem teto e' exatamente o
 * "esperar por um sinal que nao existe" que ja' derrubou este repo antes
 * (ver o `!callp` travando 46 s no AGENTS.md).
 *
 * Aqui a promessa e' corrida contra um timer. O timer NAO e' `unref`: ele
 * precisa segurar o event loop para poder destravar o chamador (um `unref`
 * aqui anularia a propria protecao).
 *
 * @param {Promise} promessa operacao do motor
 * @param {number} ms teto
 * @param {string} rotulo nome curto para o log
 * @returns {Promise<{ok: boolean, valor?: any, erro?: string, estourou?: boolean}>}
 */
async function comTeto(promessa, ms, rotulo) {
  let timer = null;
  try {
    const teto = new Promise((resolve) => {
      timer = setTimeout(() => resolve(SIMBOLO_TETO), ms);
    });
    const r = await Promise.race([Promise.resolve(promessa), teto]);
    if (r === SIMBOLO_TETO) {
      console.warn(`[CALLP] ${rotulo}: estourou o teto de ${ms}ms — o motor nao respondeu`);
      return { ok: false, estourou: true, erro: `tempo esgotado (${ms}ms)` };
    }
    return { ok: true, valor: r };
  } catch (e) {
    return { ok: false, erro: e?.message || String(e) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Marcador interno do estouro de teto (nunca confundido com um valor real). */
const SIMBOLO_TETO = Symbol('teto');

/**
 * Teto do `startCall`. Abaixo do teto de 20 s da espera de conexao somado ao
 * usync, mas alto o bastante para uma rede lenta: o que ele impede e' o
 * `await` INFINITO, nao a lentidao.
 */
const START_CALL_TIMEOUT_MS = Number(process.env.CALL_START_TIMEOUT_MS) || 25000;

/**
 * Teto do `connect()` do motor. Sem ele o `connect` que nunca resolve deixa a
 * promessa `conectando` pendente para sempre e trava o bot (ver o comentario no
 * `obterCliente`).
 */
const CONNECT_TIMEOUT_MS = Number(process.env.CALL_CONNECT_TIMEOUT_MS) || 30000;

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
    try {
      // TETO na reconexao, pelo mesmo motivo do `obterCliente`: um
      // `client.connect()` que nunca resolve deixa o timer pendurado e a
      // proxima queda nao agenda outra tentativa. Antes isto era um `await`
      // sem teto.
      const r = await comTeto(client.connect(), CONNECT_TIMEOUT_MS, 'reconexao');
      if (r.ok) await aguardarConexao(CONNECT_TIMEOUT_MS);
      else agendarReconexao();
    } catch (e) {
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

  // Em teste nao se abre conexao de verdade (emitiria QR/pareamento) — a menos
  // que o teste tenha injetado um client FALSO (o seam `__setFabricaDeCliente`),
  // que e' o unico jeito de exercitar o caminho do `connect` sem tocar a rede.
  if (!__fabricaDeCliente && (process.env.ZAPO_DISABLE_CONNECT === '1' || process.env.NODE_ENV === 'test')) {
    loadError = 'conexao desabilitada em teste (ZAPO_DISABLE_CONNECT)';
    return null;
  }

  conectando = (async () => {
    try {
      // Seam de teste: injeta SO o client (falso). A LOGICA abaixo — o teto do
      // `connect`, a espera da conexao, o tratamento de falha — e' a MESMA de
      // producao, que e' o que o teste precisa medir.
      const { createStore, WaClient, voipPlugin } = m;

      // Ajusta o encoder MLow (bitrate 30 kbps + complexidade 10 + FEC).
      // Instalado ANTES de criar o client: o media plane carrega o codec na
      // primeira call, entao o gancho precisa estar no lugar antes disso.
      await instalarBitrate().catch(() => false);

      // Diz QUAL transporte de relay vai ser usado, uma vez por processo. Sem
      // esta linha, "a env nao chegou" e "a env chegou e o caminho nao ajuda"
      // dao o mesmo log -- foi o que aconteceu quando o dono ligou a env.
      avisarTransporte();

      // Backend de ARQUIVO cobrindo os dominios de persistencia. As caixas de
      // mensagens ficam de fora ('none'): o zapo aqui so carrega a MIDIA.
      const backend = await criarStoreArquivoDoPacote(AUTH_DIR, () => {});

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

      // ---- Logger do motor: filtra o ruido de CHAT ----------------
      //
      // O motor fala por stanza (retry receipt, offline batch, noise session,
      // addon). Nada disso e' da call e, em volume, alem de poluir o log,
      // escondia o que importa. O filtro NAO desliga o motor: so' nao imprime o
      // que e' consequencia de processar chat. `error` passa sempre.
      const loggerDoMotor = criarLoggerDoMotor({
        nivel: process.env.ZAPO_LOG_LEVEL || 'warn'
      });

      client = __fabricaDeCliente ? await __fabricaDeCliente(m) : new WaClient(
        {
          store,
          sessionId: process.env.ZAPO_SESSION_ID || 'lizzy-call',

          // ---- SO' A CALL: nada de CHAT -------------------------------
          //
          // O `zapo` e' um client COMPLETO do WhatsApp. O bot o usa SO' para a
          // midia da call, mas por padrao ele processa TODO o trafego da sessao
          // — e e' isso que enchia o log e TRAVAVA o bot:
          //
          //   failed to send retry receipt for decrypt failure { ... }
          //   offline batch request failed, giving up { remainingStanzas: 12462 }
          //   noise session is not established
          //   addon parent message secret not found { ... }
          //
          // Nada disso e' da call: e' o motor tentando decifrar conversas que a
          // sessao dele nao tem chave (a sessao do Baileys e' outra). O bot nao
          // persiste mailbox (`messages: 'none'`), entao o download de historico
          // so' queima banda.
          //
          // `history.enabled: false` para o download (a doc de producao do
          // pacote recomenda exatamente isso quando nao se persiste mailbox).
          history: { enabled: false },

          // Addons (reacao/edicao/voto) sao decifrados por padrao e falham em
          // massa aqui — o motor nao usa nada disso na call.
          addons: { autoDecrypt: false },

          plugins: [
            voipPlugin({
              // AUDIO POR PARTICIPANTE: alem do mix (`voip_call_inbound_audio`),
              // o motor emite `voip_call_participant_audio` com o `participantJid`
              // de QUEM FALOU. E' o que permite ao agente saber quem pediu algo —
              // e recusar quando a pessoa nao tem permissao (membro comum pedindo
              // para banir alguem). Desligado por padrao no pacote porque cada
              // frame e' copiado; ligamos porque e' a base da guarda.
              participantAudio: true,

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
              // TRANSPORTE DO RELAY — o UDP cru NAO deve ser ligado.
              //
              // O log do dono, com `ZAPO_RAW_UDP=all`, mostrou a leg UDP cru sendo
              // criada e **nao recebendo nada de volta** -- e, diferente da leg
              // WebRTC, ela DERRUBA a call:
              //
              //   raw udp leg rolled back, no media on the return path | {confirmed:false}
              //   relay has no leg left, open or dialling | {reason:'raw_udp_no_return_path'}
              //   call lost its last relay leg | {reason:'raw_udp_no_return_path'}
              //   a call ... encerrou | motivo: relay_lost
              //
              // Antes disso a call ficava DE PE (offer aceito, relay alocado) e so'
              // a midia nao fluia; com o UDP cru ela passou a MORRER. A doc do
              // proprio pacote diz o mesmo: "A leg that sends and hears nothing back
              // within a few seconds closes itself."
              //
              // O caminho certo e' o padrao do pacote (`rawUdpLegs: 'required'`): UDP
              // cru SO onde o relay exige (sem credencial ICE) e WebRTC no resto.
              // `ZAPO_RAW_UDP=all` continua existindo para experimento, mas o padrao
              // e' DESLIGADO e quem liga assume que a call pode cair.
              useRawUdpTransport: ligarUdpCru(),

              logLevel: process.env.ZAPO_LOG_LEVEL || 'warn',

              // Chamadas simultaneas (ringing/connecting/active). O padrao do
              // pacote e' 1 -- era o que dava
              // "max concurrent calls reached (1)".
              maxConcurrentCalls: maxCalls(),

              // PORTA DO RELAY -- sempre explicita.
              //
              // Sem esta opcao o motor decide por conta propria
              // (`useOriginalRelayPort ?? !isMobilePrimary()`) e pode cair no
              // modo `original` (porta anunciada, 3478), no qual a leg NAO
              // fecha: o motor encerra a call sozinho (onRelayLost ->
              // endCall(RelayLost)) e o grupo ve "a chamada foi encerrada"
              // logo depois de ela subir. `false` = 3480, o que o WhatsApp Web
              // usa e a doc do pacote chama de escolha CERTA.
              useOriginalRelayPort: usarPortaOriginalDoRelay(),

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
        // O logger FILTRADO (ver `criarLoggerDoMotor`): o `ConsoleLogger` cru
        // imprimia todo o ruido de chat que o motor nao precisa processar.
        loggerDoMotor
      );

      // ---- Filtro de STANZAS: o motor so' precisa do que e' da CALL --------
      //
      // Desligar o historico (`history.enabled: false`) tira o download, mas as
      // mensagens de chat CONTINUAM chegando pela fila. Sem chave Signal para
      // elas (a sessao da call e' outra), cada uma vira
      // `failed to send retry receipt for decrypt failure` — centenas por
      // minuto, na MESMA thread do bot.
      //
      // O filtro roda ANTES do processamento e devolve o ack, entao o servidor
      // nao reenvia.
      //
      // ## O que ele dropa (e o que PRESERVA)
      //
      // Usa `registerIncomingStanzaFilter` (recebe o NO cru) e nao o
      // `ignoreKey`, porque o contexto daquele nao expoe o `attrs.type` da
      // notificacao — e e' pelo `type` que se separa conteudo de infra.
      //
      //  - `message` -> DROPADA (e' chat; a call nao usa);
      //  - `notification` -> DROPADA so' quando o `type` e' de CONTEUDO
      //    (`w:gp2` grupo, business, newsletter, picture, mediaretry, encrypt):
      //    e' o que gera o flood. Pareamento (`passkey_prologue_request`,
      //    `companion_reg_refresh`), registro, device, server e account_sync
      //    PASSAM — a infra do motor precisa deles;
      //  - tudo o mais -> passa. `ack`, `iq`, `success`, `failure` e o
      //    info-bulletin (por onde vem `offline_preview`/`offline`) nem entram
      //    na conta, entao o protocolo segue intacto.
      //
      // A sinalizacao da call vem por `<call>` (tag propria) — `offer`,
      // `accept`, `enc_rekey`, `group_update` seguem chegando.
      if (client.lowlevel?.registerIncomingStanzaFilter) {
        client.lowlevel.registerIncomingStanzaFilter(ehStanzaDeChat);
      } else if (typeof client.ignoreKey === 'function') {
        // Reserva: sem o lowlevel (versao antiga), cai no filtro do pacote —
        // mais grosso (so' `message`), mas ainda tira o grosso do flood.
        client.ignoreKey((ctx) => ctx.kind === 'message');
      }

      // ---- Diagnostico da call -------------------------------------------

      // O motivo do fim. `relay_lost` = a call tinha caminho de midia e perdeu
      // (o caso do "conectando"); `invisible` = o servidor nos tirou porque os
      // outros pararam de nos receber.
      // ---- (B) INSTRUMENTACAO do ciclo de vida do motor -------------------
      //
      // Por que existe: no incidente do travamento, o log que precisavamos se
      // perdeu no meio do `sender key id mismatch` e nao deu para saber ONDE o
      // motor parou. Estas linhas marcam os ESTAGIOS, com o tempo de cada um —
      // na proxima rodada da' para dizer em qual deles travou.
      //
      // Prefixo `[MOTOR]` (filtrável) e UMA linha por estagio.
      const t0Motor = Date.now();
      const marcarMotor = (etapa, extra) => {
        const dt = Date.now() - t0Motor;
        console.log(`[MOTOR] ${etapa} | +${dt}ms${extra ? ` | ${extra}` : ''}`);
      };
      marcarMotor('client construido');

      // Eventos de conexao do MOTOR (nao do Baileys): sao a unica fonte de
      // verdade sobre o estado da sessao do zapo.
      client.on('connection', (ev) => {
        marcarMotor(`conexao: ${ev?.status || '?'}`, ev?.isLogout ? 'LOGOUT' : undefined);
      });

      client.on('voip_call_ended', (call) => {
        const motivo = call.stateData?.endReason || 'sem motivo informado';
        // UMA linha por fim de call (e' raro): sem ela o motivo morre aqui e
        // "a call caiu logo depois de subir" fica sem causa. `setup_failed`
        // e' o servidor recusando o offer (tipicamente jid de convidado em
        // forma errada); `relay_lost` e' o caminho de midia que caiu.
        console.warn(`[CALLP] a call ${call.callId} encerrou | motivo: ${motivo}`);
        processarCallEncerrada(call.callId, motivo);
      });

      // O AUDIO DE ENTRADA: o motor entrega o PCM 16 kHz mono de quem fala, ja'
      // decodificado. E' o que o agente de voz (`!iap`) consome para OUVIR a
      // call. Fica subscrito SEMPRE (nao custa nada sem agente: o motor so'
      // copia o PCM enquanto ha' listener, e o callback sai barato sem dono).
      client.on('voip_call_inbound_audio', ({ call, pcm }) => {
        const callId = call?.callId;
        if (!callId || !pcm?.length) return;
        for (const [grupo, id] of callsPorGrupo.entries()) {
          if (id !== callId) continue;
          const cb = aoOuvirPorGrupo.get(grupo);
          if (typeof cb === 'function') {
            try {
              cb(grupo, pcm);
            } catch { /* o agente nunca derruba a call */ }
          }
          break;
        }
      });

      // O AUDIO POR PARTICIPANTE: alem do mix, o motor entrega cada voz
      // SEPARADA, com o `participantJid` de quem falou. E' o que permite ao
      // agente saber QUEM pediu algo — e recusar quando nao tem permissao.
      client.on('voip_call_participant_audio', ({ call, pcm, participantJid }) => {
        const callId = call?.callId;
        if (!callId || !pcm?.length || !participantJid) return;
        for (const [grupo, id] of callsPorGrupo.entries()) {
          if (id !== callId) continue;
          const cb = aoOuvirPorGrupo.get(grupo);
          if (typeof cb === 'function') {
            try {
              cb(grupo, pcm, participantJid);
            } catch { /* o agente nunca derruba a call */ }
          }
          break;
        }
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
            // A chamada e' a FUNCIONALIDADE (faz a fila andar); o log dela e'
            // que foi removido. Sem o `catch` vazio o erro sobe como rejeicao
            // nao tratada, entao ele fica.
            Promise.resolve(cb(grupo)).catch(() => {});
          }
          break;
        }
      });

      // Estado da conexao: e' o sinal que o `startCall` precisa.
      client.on('connection', (ev) => {
        if (ev?.status === 'open') {
          conectado = true;
        } else if (ev?.status === 'close') {
          conectado = false;
          // Deslogado (aparelho removido) nao se reconecta: precisa parear.
          if (ev?.isLogout) {
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
        // TETO DURO no `connect()`. Ele NAO tinha teto, e essa era a via do
        // travamento do bot: se o `connect()` nunca resolve, a promessa
        // `conectando` fica PENDENTE PARA SEMPRE — e toda chamada seguinte de
        // `obterCliente()` recebe essa mesma promessa (o `if (conectando) return
        // conectando`). O `!vozp` entao nunca retorna, o handler prende o lote
        // do `messageQueue` e o BOT INTEIRO para de responder — so' volta com
        // restart pela host. Foi o incidente.
        marcarMotor('connect: chamando');
        const abriu = await comTeto(client.connect(), CONNECT_TIMEOUT_MS, 'connect');
        marcarMotor(`connect: ${abriu.ok ? 'resolvido' : 'FALHOU'}`, abriu.erro);
        if (!abriu.ok) {
          loadError = abriu.estourou
            ? `conexao do motor nao abriu em ${CONNECT_TIMEOUT_MS}ms`
            : abriu.erro;
          // Nao deixa a promessa pendente envenenar as proximas chamadas: sem
          // isto, `conectando` continuaria resolvido para uma promessa que
          // nunca termina.
          conectando = null;
          client = null;
          return null;
        }
        await aguardarConexao(CONNECT_TIMEOUT_MS);
      } else {
        void client.connect().catch(() => {});
      }

      return client;
    } catch (e) {
      loadError = e?.message || String(e);
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
 * Converte NUMERO -> LID usando a API do PROPRIO zapo.
 *
 * O `startCall` de grupo casa o roster pela CONTA e o contrato dele pede LID em
 * `participants[].jid`. O LID do metadata do **Baileys** nao vale aqui: o Baileys
 * e o zapo sao sessoes DIFERENTES (o zapo e o motor da call, pareado a parte).
 * Quem sabe o LID certo e o proprio zapo, por
 * `client.profile.getLidsByPhoneNumbers` (a API documentada).
 *
 * **Best-effort de proposito**: quem ja' vem em LID passa direto; o que nao
 * resolver fica como veio (melhor subir a call com o numero do que nao subir); a
 * consulta tem TETO de tempo, entao uma resposta lenta nao prende o comando.
 *
 * @param {object} cli o cliente do zapo
 * @param {string[]} jids
 * @param {number} [timeoutMs]
 * @returns {Promise<string[]>} os jids, com LID onde deu para resolver
 */
async function resolverLids(cli, jids, timeoutMs = LID_LOOKUP_TIMEOUT_MS) {
  const lista = [...new Set((jids || []).filter((j) => typeof j === 'string' && j))];
  if (lista.length === 0) return [];
  const pns = lista.filter((j) => !j.endsWith('@lid'));
  if (pns.length === 0) return lista;

  const porPn = new Map();
  let timer = null;
  try {
    const numeros = pns.map((j) => j.split('@')[0].split(':')[0]);
    const consulta = Promise.resolve(cli?.profile?.getLidsByPhoneNumbers?.(numeros));
    const teto = new Promise((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
      // Nao segura o processo do bot por causa desta consulta.
      if (typeof timer.unref === 'function') timer.unref();
    });
    const res = await Promise.race([consulta, teto]);
    for (const r of res || []) {
      // `queriedJid` correlaciona por VALOR (o servidor pode corrigir o numero).
      const chave = String(r?.queriedJid || r?.phoneJid || '').split('@')[0].split(':')[0];
      if (chave && r?.lidJid) porPn.set(chave, r.lidJid);
    }
  } catch {
    // Best-effort: sem o LID a call ainda sobe com o numero.
  } finally {
    if (timer) clearTimeout(timer);
  }

  return lista.map((j) => {
    if (j.endsWith('@lid')) return j;
    const numero = j.split('@')[0].split(':')[0];
    return porPn.get(numero) || j;
  });
}

/** Exportado para o teste medir a conversao PN -> LID. */
export const __resolverLids = resolverLids;

/** Exportado para o teste medir a BLINDAGEM (o teto duro). */
export const __comTeto = comTeto;
/**
 * Seam de teste: injeta uma fabrica de client (falso) para exercitar o caminho
 * REAL do `connect` sem abrir conexao. `null` volta ao comportamento normal.
 */
let __fabricaDeCliente = null;
export function __setFabricaDeCliente(fn) { __fabricaDeCliente = fn; }

/** Seam de teste: o leitor de `ZAPO_RAW_UDP` e o aviso da escolha. */
export const __ligarUdpCru = ligarUdpCru;
export const __avisarTransporte = avisarTransporte;
/** Teto efetivo do `startCall` (para o teste conferir que existe). */
export const __tetoDoStartCall = () => START_CALL_TIMEOUT_MS;
/** Teto efetivo do `connect` (para o teste conferir que existe). */
export const __tetoDaConexao = () => CONNECT_TIMEOUT_MS;

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
 * ## CHAMADA vs CHAT DE VOZ (`isLightweight`)
 *
 * `isLightweight: true` sobe a call como **chat de voz**: o offer leva
 * `lightweight='1'` e anuncia `<silence>` em vez de midia, entao o grupo NAO
 * toca -- os membros entram pelo cartao se quiserem. `false` (padrao) e' a
 * chamada que toca. Quem passa o flag e' o comando (`!vozp`), nunca este
 * modulo: o `!callp` sobe sempre como chamada.
 *
 * ## Um pareamento so' para os DOIS comandos
 *
 * O motor e' o MESMO (`zapoCall.js`), com o MESMO store em
 * `dados/database/zapo-auth/` e a MESMA sessao (`obterCliente`). Entao parear
 * uma vez (`!callp parear <numero>`) vale para o `!callp` E para o `!vozp` --
 * nao existe um "pareamento do chat de voz".
 *
 * Falha FECHADO quando nao ha pareamento: subir a call sem credencial daria o
 * erro criptico do `call-creator` e o usuario nao saberia o que fazer.
 */
export async function entrarNaCallComMidia({
  grupo,
  callId,
  callCreator,
  participantes,
  sock,
  isLightweight = false
}) {
  if (dubleEntrar) {
    return dubleEntrar.entrar({ grupo, callId, callCreator, participantes, sock, isLightweight });
  }

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
    // ring, a LID"*). Quem resolve e' o PROPRIO zapo — o LID do Baileys e' de
    // outra sessao e nao vale aqui. Best-effort: o que nao resolver vai como
    // veio.
    const emLid = await resolverLids(cli, participantes);
    const alvos = emLid.map((jid) => ({ jid }));
    const quantosLid = alvos.filter((a) => String(a.jid).endsWith('@lid')).length;
    if (quantosLid < alvos.length) {
      console.warn(`[CALLP] convidados: ${alvos.length} | em LID: ${quantosLid} (o resto vai pelo numero)`);
    }

    // TETO DURO no startCall: ele espera o ack do offer e o usync dos devices,
    // e um `await` sem teto aqui prende o HANDLER — que prende o lote inteiro do
    // `messageQueue` e trava o bot todo (foi o incidente). O timer do `comTeto`
    // destrava o chamador mesmo que o motor nunca responda.
    console.log(`[MOTOR] startCall: enviando (${alvos.length} convidado(s), lightweight=${isLightweight})`);
    const r = await comTeto(
      cli.voip.startCall({
        groupJid: grupo,
        participants: alvos,
        // Chat de voz (nao toca) quando o comando pede; `!callp` manda `false`.
        isLightweight
      }),
      START_CALL_TIMEOUT_MS,
      'startCall'
    );
    if (!r.ok) {
      console.warn(`[MOTOR] startCall: ${r.estourou ? 'ESTOUROU O TETO' : 'falhou'} | ${r.erro}`);
      return {
        ok: false,
        motivo: r.estourou ? 'motor_sem_resposta' : 'falha_ao_entrar',
        detalhe: r.erro
      };
    }
    const novoCallId = r.valor;
    console.log(`[MOTOR] startCall: OK | callId=${String(novoCallId).slice(0, 12)}...`);

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
  aoOuvirPorGrupo.clear();
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
 * Registra o que fazer quando chega AUDIO DE ENTRADA na call do grupo.
 *
 * O motor entrega o PCM 16 kHz mono de quem fala (`voip_call_inbound_audio`).
 * O `index.js` usa isto para alimentar o agente de voz (`!iap`). Sem callback
 * registrado, o frame e' descartado -- nao ha' custo em deixar subscrito.
 *
 * Mesmo formato dos outros: callback (e nao import) para nao criar ciclo.
 *
 * @param {string} grupo
 * @param {Function|null} cb `(grupo, pcm) => void` (null remove)
 */
export function aoOuvirAudio(grupo, cb) {
  if (cb === null) aoOuvirPorGrupo.delete(grupo);
  else aoOuvirPorGrupo.set(grupo, cb);
}

/**
 * Liga o modo de audio EXTERNO na call do grupo.
 *
 * Enquanto ligado, o audio de saida vem de `feedLiveAudio` em vez do arquivo
 * pre-carregado. E' o que permite o agente FALAR (o `!midiap` usa o mesmo
 * caminho para o audio do video). Best-effort: sem call/sessao devolve `false`.
 *
 * @param {string} grupo
 * @param {boolean} ligado
 * @returns {Promise<boolean>}
 */
export async function modoAudioExterno(grupo, ligado) {
  const cli = await obterCliente();
  if (!cli?.voip) return false;
  const callId = callsPorGrupo.get(grupo);
  if (!callId) return false;
  try {
    cli.voip.setExternalAudioMode(callId, Boolean(ligado));
    return true;
  } catch {
    return false;
  }
}

/**
 * Entrega um bloco de PCM (float 16 kHz mono) ao uplink da call do grupo.
 *
 * E' a VOZ do agente. Retorna o nivel do buffer do motor em ms, para quem
 * quiser fazer backpressure -- `0` quando nao ha' sessao.
 *
 * @param {string} grupo
 * @param {Float32Array} pcm
 * @returns {Promise<number>}
 */
export async function falarNaCall(grupo, pcm) {
  const cli = await obterCliente();
  if (!cli?.voip) return 0;
  const callId = callsPorGrupo.get(grupo);
  if (!callId) return 0;
  try {
    const ms = cli.voip.feedLiveAudio(callId, pcm);
    return typeof ms === 'number' ? ms : 0;
  } catch {
    return 0;
  }
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
      // A chamada e' a FUNCIONALIDADE (dispara a reconciliacao do bot); so' o
      // log dela foi removido. O `catch` vazio evita rejeicao nao tratada.
      Promise.resolve(cb(grupo, motivo)).catch(() => {});
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
