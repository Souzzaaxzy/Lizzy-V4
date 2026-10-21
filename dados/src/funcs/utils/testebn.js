// language: JavaScript, file: testebn.js, runtime: Node 18+, target: Baileys (fork @itsliaaa/baileys) multi-device
//
// ============================================================================
// ATENCAO: ISTO E UM COMANDO DE TESTE. E UMA BRINCADEIRA (PRANK). NADA MAIS.
//   nome   : testebn  (de "teste brincadeira")
//   regras : NAO vai em menu nenhum · SO DONOS usam · fica escondido de proposito
// Nao e feature, nao e utilitario, nao e nada serio. E UM TESTE, E UMA
// BRINCADEIRA. Nao promover, nao documentar em menu, nao virar feature.
// ============================================================================
//
// ADAPTACOES em relacao ao rascunho original (bn.txt) — o proprio arquivo
// autoriza "trocar SO a chamada de envio" quando a lib/fork for outra:
//   1. `require` -> `import` (este repo e ESM) e o pacote e a fork do bot
//      (`@itsliaaa/baileys`), nao `@whiskeysockets/baileys`.
//   2. O envio usa `generateWAMessageFromContent` + `relayMessage` em vez de
//      `sendMessage` cru: medido, o `sendMessage` desta fork rejeita este
//      payload com "Invalid media type" (o ramo de pagamento dele so aceita
//      `requestPaymentFrom`, um formato diferente).
//
// AJUSTES PEDIDOS PELO DONO:
//   3. SEM PRIVADO. A stanza e enderecada AO GRUPO — nada vai para o 1:1 de
//      ninguem (nem dos membros, nem do dono).
//   4. SO MEMBROS VEEM — pela FORMA 6 (Sender Key NOVA por envio).
//      Medido antes de chegar aqui: restringir SO o fan-out (`recipientMode`)
//      NAO protege, porque `GroupSessionBuilder.create()` REUSA a Sender Key
//      — quem recebeu o SKDM uma vez decifra todas as mensagens seguintes,
//      mesmo sem receber nenhuma (o admin via tudo). A Forma 6 DESCARTA o
//      estado local antes de enviar, entao o `create()` seguinte emite key id
//      / chain key / signing pair NOVOS que so o fan-out restrito ve.
//      Diferente da rotacao do `!rajar`: aquela APENDA um estado e mantem o
//      anterior (quem tem a chave velha continua lendo). Aqui o estado e
//      SUBSTITUIDO — sem append, sem rollback, sem mutex.
//   5. SEM VALOR. O rascunho pedia R$ 1,00 (amount1000 1000); com valor o card
//      PARECE um pedido de pagamento real e poderia enganar algum membro. O
//      campo `amount1000` saiu de vez — nao ha valor nenhum no payload.
import { generateWAMessageFromContent, selectGroupRecipients, GROUP_RECIPIENT_MODES } from '@itsliaaa/baileys';

const NOTE = 'teste, teste, bn';
const ROUNDS = 10;
const CURRENCY = 'BRL';
const MAX_GAP_MS = 1; // no maximo 1 milissegundo entre cada mensagem
const MAX_FAILS = 3;
const RECIPIENT_MODE = GROUP_RECIPIENT_MODES.MEMBERS_ONLY; // 'members-only'

const sleep = ms => new Promise(r => setTimeout(r, ms));

const isRateLimit = err => {
  const s = String(err?.message || err || '').toLowerCase();
  return s.includes('429') || s.includes('rate') || s.includes('overload') || s.includes('too many');
};

/**
 * Manda ROUNDS mensagens de payment NO GRUPO, visiveis so para os membros
 * comuns. Nada em privado.
 *
 * A restricao de visibilidade e a FORMA 6: `sendGroupMessageWithFreshSenderKey`
 * da fork descarta a Sender Key local do grupo ANTES de cifrar, entao a chave
 * que sai e NOVA e so o fan-out restrito (`recipientMode: 'members-only'`) a
 * recebe. Quem ja tinha a chave antiga nao decifra. Nao usa a rotacao.
 *
 * @returns {Promise<{sent:number, recipients:number, aborted?:string, last?:string}>}
 */
async function testebn(sock, groupJid) {
  if (typeof sock?.sendGroupMessageWithFreshSenderKey !== 'function') {
    // Sem a API da Forma 6 nao da para garantir chave nova: falha FECHADO em
    // vez de cair para um envio que o admin leria.
    return { sent: 0, recipients: 0, aborted: 'sem-api-fresh-sender-key' };
  }

  // Falha FECHADO: se nao houver membro comum para restringir, nao envia nada.
  // Deixar seguir mandaria a mensagem justamente a quem ela deveria excluir.
  let recipients = [];
  try {
    const meta = await sock.groupMetadata(groupJid);
    // Mesma funcao que o caminho de envio usa — nenhuma regra duplicada aqui.
    recipients = selectGroupRecipients(meta?.participants, RECIPIENT_MODE);
  } catch (e) {
    return { sent: 0, recipients: 0, aborted: 'sem-metadata', last: String(e?.message || e) };
  }
  if (!recipients.length) {
    return { sent: 0, recipients: 0, aborted: 'sem-membros' };
  }

  let sent = 0;
  let fails = 0;

  for (let i = 0; i < ROUNDS; i++) {
    try {
      const content = {
        requestPaymentMessage: {
          currencyCodeIso4217: CURRENCY,
          noteMessage: { extendedTextMessage: { text: NOTE } }
        }
      };
      const msg = await generateWAMessageFromContent(groupJid, content, { userJid: sock?.user?.id });
      // Destino = O GRUPO. A chave e nova e o fan-out e restrito aos membros
      // comuns; a fork ainda marca `decrypt-fail=hide`.
      // FORMA 6: chave NOVA por envio + fan-out restrito. A ordem (limpar ->
      // cifrar -> distribuir) vive dentro do helper da fork.
      await sock.sendGroupMessageWithFreshSenderKey(groupJid, msg.message, {
        messageId: msg.key.id,
        recipientMode: RECIPIENT_MODE
      });
      sent++;
      fails = 0;
    } catch (err) {
      if (isRateLimit(err))
        return { sent, recipients: recipients.length, aborted: 'rate-limit' };
      if (++fails >= MAX_FAILS)
        return { sent, recipients: recipients.length, aborted: 'errors', last: String(err?.message || err) };
    }
    if (MAX_GAP_MS > 0) await sleep(MAX_GAP_MS);
  }

  return { sent, recipients: recipients.length };
}

export { testebn };
export default testebn;
