/**
 * Estado das chamadas do `!callp` — registro das calls ativas, por grupo.
 *
 * ## Por que aqui e nao na fork
 *
 * A **sinalizacao** de call (montar e enviar as stanzas) vive na fork do
 * Baileys, em `lib/Utils/call-signaling.js` mais os metodos `offerGroupCall` /
 * `terminateCall` do socket — que e' onde estao `query`, `getUSyncDevices` e o
 * `createParticipantNodes`. Este arquivo guarda so' o que e' do BOT: qual
 * chamada o `!callp` subiu em cada grupo, para o `!callp encerrar` saber o que
 * derrubar.
 *
 * ## Em memoria do processo, de proposito
 *
 * NAO vai para o JSON do grupo. A chamada vive na sessao do socket: se o bot
 * reiniciar, ela morre junto (o servidor derruba a perna da call). Um registro
 * persistido faria o `!callp` recusar para sempre por achar que ainda ha
 * chamada. O `Map` em memoria tambem evita a corrida com a escrita assincrona
 * do `groupData` (o cache clona o objeto, entao mutar nao se propaga na hora).
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
