/**
 * `!callp` — sobe uma chamada de VOZ no grupo pelo protocolo de sinalizacao de
 * call do WhatsApp Web.
 *
 * ## O que este modulo faz (e o que NAO faz)
 *
 * Ele monta e envia a stanza `<call><offer>`, que e' o sinal de "estou ligando":
 * a chamada passa a existir no grupo. **Nao ha audio.** A midia de uma call do
 * WhatsApp viaja por SRTP/UDP com a chave negociada por Signal, e o Baileys nao
 * carrega essa stack (nem a fork) — entao o comando e' exatamente o que o dono
 * pediu: *"sobe a call no grupo, mas apenas isso"*.
 *
 * ## De onde vem o formato (pesquisa)
 *
 * - **WhatsApp Calls Research Group (wacrg)** — spec publica das stanzas de call
 *   (`docs/signaling/stanza-reference.md`): envelope, ordem obrigatoria dos
 *   filhos do `<offer>` e o papel do `group_info`.
 * - **`meowcaller` (Go, purpshell)** — implementa call de GRUPO de verdade.
 *   `signaling/group.go` -> `BuildInitialGroupOffer` e' a fonte direta da forma
 *   usada aqui; `engine_group_api.go` -> `placeGroupCall` mostra a sequencia
 *   (roster de devices -> offer -> transmitir).
 * - **`offerCall` (fork do Baileys, `messages-recv`)** — a versao 1:1, que
 *   confirma o envelope, o `call-id`, o `call-creator` e o `query(stanza)`.
 *
 * ## Diferenca entre o offer 1:1 e o de GRUPO
 *
 * | | 1:1 (`offerCall`) | grupo (`BuildInitialGroupOffer`) |
 * |---|---|---|
 * | `to` do wrapper | JID do contato | **`<call-id>@call`** (objeto da call) |
 * | chave de midia | `<destination>` com `<enc>` por device | **nao vai no offer** (vem por `enc_rekey`, o epoch do grupo) |
 * | roster | -- | **`<group_info>`** com `<user>`/`<device>` |
 * | `group-jid` | -- | presente quando a call e' amarrada ao grupo |
 *
 * O pedido e' subir a call NO GRUPO, entao o caminho e' o segundo. A ORDEM dos
 * filhos e' obrigatoria (o servidor rejeita fora dela com erro 439):
 * `audio(8000)` -> `audio(16000)` -> `[video]` -> `net(medium=3)` -> `group_info`.
 *
 * O modulo e' PURO: nao abre conexao nem le disco. O socket entra injetado e o
 * modulo usa os primitivos que a lib JA expoe (`getUSyncDevices`, `assertSessions`,
 * `query`). Assim a montagem da stanza e' exercitavel em teste, sem WhatsApp.
 */

import { randomBytes } from 'crypto';

/** Blob de capability do device de quem cria a call (ver=1). */
export const CAPABILITY_OFFER = Object.freeze([0x01, 0x05, 0xf7, 0x09, 0xe0, 0xbb, 0x13]);

/** Timeout do ack do servidor para a stanza de call. Sem isso, um ack que nao
 * vem seguraria o handler pelo `defaultQueryTimeoutMs` da lib (60s). */
const CALL_QUERY_TIMEOUT_MS = 20000;

/** Sufixo de JID de grupo. */
const GROUP_JID_SUFFIX = '@g.us';

/**
 * Calls ativas, por grupo — **em memoria do processo**.
 *
 * De proposito NAO vai para o JSON do grupo: a call vive na sessao do socket.
 * Se o bot reiniciar, ela morre junto (o servidor derruba a perna da call), e um
 * `callpCall` persistido faria o `!callp` recusar para sempre por achar que
 * ainda ha chamada. O registro em memoria tambem evita a corrida com a escrita
 * assincrona do `groupData` (o cache clona o objeto, entao mutar `groupData` nao
 * se propaga na hora).
 */
const callsAtivas = new Map();

/** Registra a call ativa de um grupo. */
export function registrarCall(grupo, dados) {
  callsAtivas.set(grupo, dados);
}

/** Call ativa de um grupo, ou null. */
export function obterCall(grupo) {
  return callsAtivas.get(grupo) || null;
}

/** Remove a call ativa de um grupo. */
export function limparCall(grupo) {
  callsAtivas.delete(grupo);
}

/** Gera o `call-id`: 16 bytes em hex maiusculo (mesmo formato do `offerCall`). */
export function gerarCallId() {
  return randomBytes(16).toString('hex').toUpperCase();
}

/** Extrai o `user` de um JID/LID (sem device e sem servidor). */
function userDe(jid) {
  return typeof jid === 'string' ? jid.split('@')[0].split(':')[0] : null;
}

/**
 * Separa os membros do grupo entre "nos" e os outros.
 *
 * O metadata do grupo (formato atual) traz o participante como LID em `id` e,
 * as vezes, o PN em `phoneNumber`. Sao a MESMA pessoa: usar os dois colocaria o
 * membro duas vezes no roster. Por isso a deduplicacao e' por `user`.
 *
 * @param {object} metadata metadata do grupo (`sock.groupMetadata`)
 * @param {string} meId     JID/LID do bot
 * @returns {{self: string|null, outros: string[]}}
 */
export function separarParticipantes(metadata, meId) {
  const self = meId || null;
  const selfUser = userDe(self);
  const outros = [];
  const vistos = new Set();
  for (const p of (metadata?.participants || [])) {
    const jid = p?.id || p?.phoneNumber;
    if (typeof jid !== 'string' || !jid) continue;
    const user = userDe(jid);
    if (!user) continue;
    if (selfUser && user === selfUser) continue;
    if (vistos.has(user)) continue;
    vistos.add(user);
    outros.push(jid);
  }
  return { self, outros };
}

/**
 * Monta o `<group_info>`: um `<user>` por participante, com um `<device>` por
 * aparelho. O device de quem CRIA a call carrega o blob de capability.
 *
 * @param {Array<{jid: string, devices: string[], self?: boolean}>} roster
 * @returns {Array<object>} filhos do `<group_info>`
 */
export function montarGroupInfo(roster) {
  return roster.map(({ jid, devices, self }) => ({
    tag: 'user',
    attrs: { jid },
    content: devices.map((d) => ({
      tag: 'device',
      attrs: { jid: d },
      content: self
        ? [{ tag: 'capability', attrs: { ver: '1' }, content: new Uint8Array(CAPABILITY_OFFER) }]
        : []
    }))
  }));
}

/**
 * Monta a stanza `<call><offer>` de GRUPO — o "iniciar chamada no grupo".
 *
 * @param {object} p
 * @param {string} p.callId      id logico da call
 * @param {string} p.callCreator JID/LID de quem criou (o bot)
 * @param {string} p.groupJid    JID do grupo
 * @param {Array}  p.roster      `[{ jid, devices, self }]`
 * @param {string} [p.stanzaId]  id do wrapper (correlaciona o ack)
 * @param {boolean} [p.video]    false = audio (padrao)
 * @returns {object} node `<call>`
 */
export function montarOfferGrupo({ callId, callCreator, groupJid, roster, stanzaId, video = false }) {
  const children = [
    { tag: 'audio', attrs: { enc: 'opus', rate: '8000' }, content: undefined },
    { tag: 'audio', attrs: { enc: 'opus', rate: '16000' }, content: undefined }
  ];
  if (video) {
    children.push({
      tag: 'video',
      attrs: {
        enc: 'vp8', dec: 'vp8', orientation: '0',
        screen_width: '1920', screen_height: '1080', device_orientation: '0'
      },
      content: undefined
    });
  }
  children.push({ tag: 'net', attrs: { medium: '3' }, content: undefined });
  children.push({ tag: 'group_info', attrs: {}, content: montarGroupInfo(roster) });

  const attrs = { 'call-id': callId, 'call-creator': callCreator };
  if (groupJid) attrs['group-jid'] = groupJid;

  const wrapperAttrs = { to: `${callId}@call` };
  if (stanzaId) wrapperAttrs.id = stanzaId;

  return {
    tag: 'call',
    attrs: wrapperAttrs,
    content: [{ tag: 'offer', attrs, content: children }]
  };
}

/**
 * Monta a stanza `<call><terminate>` (encerra a chamada).
 *
 * @param {object} p
 * @param {string} p.callId
 * @param {string} p.callCreator
 * @param {string} [p.peer]   destino (padrao: o objeto da call)
 * @param {string} [p.reason]
 * @returns {object} node `<call>`
 */
export function montarTerminate({ callId, callCreator, peer, reason }) {
  const attrs = { 'call-id': callId, 'call-creator': callCreator };
  if (reason) attrs.reason = reason;
  return {
    tag: 'call',
    attrs: { to: peer || `${callId}@call` },
    content: [{ tag: 'terminate', attrs, content: undefined }]
  };
}

/**
 * Descobre os devices de cada membro (o roster precisa de um `<device>` por
 * aparelho). Reusa o `getUSyncDevices` da propria lib — a mesma descoberta
 * multi-device que as mensagens usam.
 *
 * @param {object} sock   socket do Baileys
 * @param {string[]} jids membros (sem o bot)
 * @returns {Promise<Array<{jid: string, devices: string[]}>>}
 */
export async function descobrirRoster(sock, jids) {
  const { jidEncode } = await import('@itsliaaa/baileys');
  const devices = await sock.getUSyncDevices(jids, true, false);
  const porUsuario = new Map();
  for (const d of devices) {
    const user = d?.user;
    if (!user) continue;
    const server = d.server || 's.whatsapp.net';
    const full = jidEncode(user, server, d.device);
    if (!porUsuario.has(user)) porUsuario.set(user, { jid: `${user}@${server}`, devices: [] });
    porUsuario.get(user).devices.push(full);
  }
  return [...porUsuario.values()];
}

/**
 * Sobe a chamada de voz no grupo.
 *
 * Sequencia: monta o roster (nos + membros) -> descobre devices -> garante as
 * sessoes Signal -> monta o `<offer>` de grupo -> envia pela `query` (que
 * espera o ack do servidor).
 *
 * @param {object} p
 * @param {object} p.sock      socket do Baileys
 * @param {string} p.groupJid  JID do grupo
 * @param {string} p.meId      JID/LID do bot
 * @param {object} p.metadata  metadata do grupo (para o roster)
 * @returns {Promise<{ok: boolean, callId?: string, motivo?: string, roster?: number, detalhe?: string}>}
 */
export async function subirCallNoGrupo({ sock, groupJid, meId, metadata }) {
  if (typeof groupJid !== 'string' || !groupJid.endsWith(GROUP_JID_SUFFIX)) {
    return { ok: false, motivo: 'jid_invalido' };
  }
  const { self, outros } = separarParticipantes(metadata, meId);
  if (!self) return { ok: false, motivo: 'sem_identidade' };
  // O `BuildInitialGroupOffer` do meowcaller (a unica implementacao publica que
  // poe call de grupo de pe') exige nos + PELO MENOS 2 outros participantes: o
  // servidor recusa a call de grupo abaixo disso. Melhor avisar aqui do que
  // mandar uma stanza que o servidor vai descartar.
  if (outros.length < 2) return { ok: false, motivo: 'poucos_membros' };

  const callId = gerarCallId();

  let outrosRoster = [];
  try {
    outrosRoster = await descobrirRoster(sock, outros);
  } catch (e) {
    return { ok: false, motivo: 'devices_indisponiveis', detalhe: e?.message };
  }
  if (!outrosRoster.length) return { ok: false, motivo: 'sem_devices' };

  // O proprio device entra sozinho (o WhatsApp usa o LID do criador).
  const roster = [
    { jid: self, devices: [self], self: true },
    ...outrosRoster
  ];

  // Garante sessao Signal com todos os devices antes de sinalizar. Best-effort:
  // se falhar, o offer ainda e' enviado (o grupo resolve o epoch da chave).
  try {
    const todos = outrosRoster.flatMap((r) => r.devices);
    if (todos.length) await sock.assertSessions(todos, true);
  } catch (e) {
    console.warn('[CALLP] assertSessions falhou (seguindo):', e?.message);
  }

  const stanzaId = typeof sock.generateMessageTag === 'function' ? sock.generateMessageTag() : undefined;
  const node = montarOfferGrupo({ callId, callCreator: self, groupJid, roster, stanzaId });

  try {
    await sock.query(node, CALL_QUERY_TIMEOUT_MS);
  } catch (e) {
    return { ok: false, motivo: 'envio_falhou', detalhe: e?.message };
  }

  return { ok: true, callId, roster: roster.length };
}

/**
 * Encerra uma call subida por este modulo.
 *
 * @param {object} p
 * @param {object} p.sock
 * @param {string} p.callId
 * @param {string} p.callCreator
 * @returns {Promise<{ok: boolean, motivo?: string}>}
 */
export async function encerrarCall({ sock, callId, callCreator }) {
  if (!callId) return { ok: false, motivo: 'sem_call' };
  try {
    await sock.query(montarTerminate({ callId, callCreator }), CALL_QUERY_TIMEOUT_MS);
    return { ok: true };
  } catch (e) {
    return { ok: false, motivo: e?.message };
  }
}
