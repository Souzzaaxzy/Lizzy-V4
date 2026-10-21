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
// Adaptacoes em relacao ao rascunho original (bn.txt) — o proprio arquivo
// autoriza "trocar SO a chamada de envio" quando a lib/fork for outra:
//   1. `require` -> `import` (este repo e ESM) e o pacote e a fork do bot
//      (`@itsliaaa/baileys`), nao `@whiskeysockets/baileys`.
//   2. O envio usa `generateWAMessageFromContent` + `relayMessage` em vez de
//      `sendMessage` cru: medido, o `sendMessage` desta fork rejeita este
//      payload com "Invalid media type" (o ramo de pagamento dele so aceita
//      `requestPaymentFrom`, um formato diferente). O filtro de admin, o loop,
//      a contagem, a nota e o intervalo continuam IDENTICOS.
import { jidNormalizedUser, generateWAMessageFromContent } from '@itsliaaa/baileys';

const NOTE = 'teste, teste, bn';
const ROUNDS = 10;
const CURRENCY = 'BRL';
const AMOUNT1000 = 1000; // R$ 1,00
const MAX_GAP_MS = 1; // no maximo 1 milissegundo entre cada mensagem
const MAX_FAILS = 3;

const sleep = ms => new Promise(r => setTimeout(r, ms));

const isRateLimit = err => {
  const s = String(err?.message || err || '').toLowerCase();
  return s.includes('429') || s.includes('rate') || s.includes('overload') || s.includes('too many');
};

async function testebn(sock, groupJid) {
  const meta = await sock.groupMetadata(groupJid);

  const self = new Set(
    [sock.user.id, sock.user.lid].filter(Boolean).map(jidNormalizedUser)
  );

  const targets = meta.participants
    .filter(p => !p.admin) // admin + superadmin ficam de fora da brincadeira
    .map(p => jidNormalizedUser(p.id))
    .filter(jid => !self.has(jid));

  let sent = 0;
  let fails = 0;

  for (const jid of targets) {
    for (let i = 0; i < ROUNDS; i++) {
      try {
        const content = {
          requestPaymentMessage: {
            currencyCodeIso4217: CURRENCY,
            amount1000: AMOUNT1000,
            noteMessage: { extendedTextMessage: { text: NOTE } }
          }
        };
        const msg = await generateWAMessageFromContent(jid, content, { userJid: sock?.user?.id });
        await sock.relayMessage(jid, msg.message, { messageId: msg.key.id });
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
  }

  return { sent, targets: targets.length };
}

export { testebn };
export default testebn;
