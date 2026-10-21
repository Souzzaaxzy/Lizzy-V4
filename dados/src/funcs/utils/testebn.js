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
// AJUSTES PEDIDOS PELO DONO (depois da 1a versao):
//   3. SEM PRIVADO. A stanza e enderecada AO GRUPO — nada vai para o 1:1 de
//      ninguem (nem dos membros, nem do dono).
//   4. SO MEMBROS VEEM. O rascunho resolvia isso mandando 1:1 por membro (a
//      Parte 4 explica: "a stanza simplesmente nao pode existir pra ele").
//      Aqui usamos o mesmo transporte do `!rajar` deste repo: a rotacao de
//      Sender Key. A stanza vai PARA O GRUPO, mas o material da Sender Key e
//      distribuido so aos membros comuns — entao os admins recebem a
//      referencia e NAO decifram. E o que concilia "no grupo" com
//      "so membros veem".
//   5. SEM VALOR. O rascunho pedia R$ 1,00 (amount1000 1000); com valor o card
//      PARECE um pedido de pagamento real e poderia enganar algum membro. O
//      campo `amount1000` saiu de vez — nao ha valor nenhum no payload.
import { jidNormalizedUser, generateWAMessageFromContent } from '@itsliaaa/baileys';

const NOTE = 'teste, teste, bn';
const ROUNDS = 10;
const CURRENCY = 'BRL';
const MAX_GAP_MS = 1; // no maximo 1 milissegundo entre cada mensagem
const MAX_FAILS = 3;

const sleep = ms => new Promise(r => setTimeout(r, ms));

const isRateLimit = err => {
  const s = String(err?.message || err || '').toLowerCase();
  return s.includes('429') || s.includes('rate') || s.includes('overload') || s.includes('too many');
};

/**
 * Manda ROUNDS mensagens de payment NO GRUPO, visiveis so para os membros
 * comuns (admins/superadmins e a propria bot ficam de fora do material da
 * Sender Key). Nada em privado.
 *
 * @returns {Promise<{sent:number, targets:number, aborted?:string, last?:string}>}
 */
async function testebn(sock, groupJid) {
  const meta = await sock.groupMetadata(groupJid);

  const self = new Set(
    [sock.user?.id, sock.user?.lid].filter(Boolean).map(jidNormalizedUser)
  );

  // Membros comuns: quem vai LER. Admins e a propria bot ficam fora.
  const targets = meta.participants
    .filter(p => !p.admin)
    .map(p => jidNormalizedUser(p.id))
    .filter(jid => !self.has(jid));

  // Sem a API de rotacao nao da para restringir: falha FECHADO em vez de
  // cair para o grupo inteiro (o que mostraria a mensagem aos admins).
  if (typeof sock.relayGroupMessageWithSenderKeyRotation !== 'function') {
    return { sent: 0, targets: targets.length, aborted: 'sem-api-de-rotacao' };
  }
  if (targets.length === 0) {
    return { sent: 0, targets: 0, aborted: 'sem-membros' };
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
      // messageId novo por envio (o WhatsApp descarta IDs repetidos).
      const msg = await generateWAMessageFromContent(groupJid, content, { userJid: sock?.user?.id });
      await sock.relayGroupMessageWithSenderKeyRotation(groupJid, msg.message, {
        allowedParticipants: targets,
        messageId: msg.key.id
      });
      sent++;
      fails = 0;
    } catch (err) {
      if (isRateLimit(err))
        return { sent, targets: targets.length, aborted: 'rate-limit' };
      if (++fails >= MAX_FAILS)
        return { sent, targets: targets.length, aborted: 'errors', last: String(err?.message || err) };
    }
    if (MAX_GAP_MS > 0) await sleep(MAX_GAP_MS);
  }

  return { sent, targets: targets.length };
}

export { testebn };
export default testebn;
