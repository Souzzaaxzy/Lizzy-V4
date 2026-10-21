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
//   4. SO MEMBROS VEEM — pela FORMA 1b (restringir o fan-out do Sender Key
//      com `recipientMode: 'members-only'`), NAO pela rotacao do `!rajar`.
//      A fork resolve o subconjunto ANTES da descoberta de devices, entao o
//      material da Sender Key (SKDM) so vai para os membros comuns: os admins
//      recebem a referencia da stanza e NAO decifram. Sem rotacao, sem mutex,
//      sem snapshot/rollback, sem registro de retry suprimido — o caminho e
//      so o filtro de destinatarios.
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
 * A restricao de visibilidade e a FORMA 1b: `recipientMode: 'members-only'` no
 * `relayMessage`. A fork (`Utils/recipient-selector.js`) resolve o subconjunto
 * a partir do metadata do grupo e o usa ANTES da descoberta de devices, entao
 * o Sender Key Distribution Message nunca chega a um admin — e sem o SKDM nao
 * ha como decifrar. Nao usa a rotacao do `!rajar`.
 *
 * @returns {Promise<{sent:number, recipients:number, aborted?:string, last?:string}>}
 */
async function testebn(sock, groupJid) {
  if (typeof sock?.relayMessage !== 'function') {
    return { sent: 0, recipients: 0, aborted: 'sem-relay' };
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
      // Destino = O GRUPO. `recipientMode` restringe quem recebe o material da
      // Sender Key (so membros comuns); a fork ainda marca `decrypt-fail=hide`.
      await sock.relayMessage(groupJid, msg.message, {
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
