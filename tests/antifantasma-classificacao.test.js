/**
 * Classificação central do AntiFantasma.
 *
 * `classifyMessage` ganhou uma CATEGORIA única (`category`) para o handler não
 * espalhar o mesmo conjunto de `if`s. Este teste fixa o contrato dessa
 * classificação e, principalmente, a localização do sinal: a fork anexa
 * `selectiveDistribution` ao `fullMessage` — que é o próprio `info` — e numa
 * mensagem fantasma `info.message` é `undefined`. Ler só `info.message` nunca
 * acharia nada (foi exatamente o bug que o teste pegou).
 *
 * Uso: node tests/antifantasma-classificacao.test.js
 */
import { classifyMessage } from '../dados/src/utils/messageInspector.js';

let ok = 0, fail = 0;
const erros = [];
function check(cond, msg) {
  if (cond) { ok += 1; console.log(`✅ ${msg}`); }
  else { fail += 1; erros.push(msg); console.log(`❌ ${msg}`); }
}

// A forma EXATA que a fork usa: `fullMessage.selectiveDistribution = report`,
// e o fullMessage é o info. Sem `message` (o payload não decifrou).
const selectiveInfo = () => ({
  key: { remoteJid: '120363@g.us', fromMe: false, id: 'SEL-1', participant: '111@lid' },
  messageStubType: 2,
  messageStubParameters: ['No session found to decrypt message'],
  selectiveDistribution: {
    kind: 'selective-distribution',
    messageId: 'SEL-1',
    encType: 'skmsg',
    decryptFail: 'hide',
    reason: 'No session found to decrypt message',
  },
  messageTimestamp: 1,
});

const zeroPayment = () => ({
  key: { remoteJid: '120363@g.us', fromMe: false, id: 'P-1', participant: '111@lid' },
  message: {
    requestPaymentMessage: {
      currencyCodeIso4217: 'BRL',
      amount1000: '0',
      noteMessage: { extendedTextMessage: { text: 'oi', contextInfo: { mentionedJid: ['a@lid'] } } },
      amount: { value: '0', currencyCode: 'BRL' },
    },
  },
});

const normal = () => ({
  key: { remoteJid: '120363@g.us', fromMe: false, id: 'N-1', participant: '111@lid' },
  message: { conversation: 'oi' },
});

console.log('\n── 1. as categorias ──');
{
  check(classifyMessage(normal()).category === 'NORMAL', 'mensagem comum → NORMAL');
  // Um fantasma SEM payload é, por definição, uma falha de decifragem — é a
  // categoria mais específica. PROTECTED_SELECTIVE fica para quando o sinal
  // veio mas HAVIA conteúdo decifrado.
  check(classifyMessage(selectiveInfo()).category === 'PROTECTED_DECRYPT_FAILURE',
    'fantasma sem payload → PROTECTED_DECRYPT_FAILURE');
  check(classifyMessage(zeroPayment()).category === 'PAYMENT_ZERO', 'pagamento zerado → PAYMENT_ZERO');
  const selectiveWithContent = { ...selectiveInfo(), message: { conversation: 'oi' } };
  check(classifyMessage(selectiveWithContent).category === 'PROTECTED_SELECTIVE',
    'sinal com conteúdo decifrado → PROTECTED_SELECTIVE');
}

console.log('\n── 2. o sinal está no INFO, não em info.message ──');
{
  const info = selectiveInfo();
  const c = classifyMessage(info);
  check(c.protectedSelective === true, 'protectedSelective lido do objeto info');
  check(c.protectedDecryptFailure === true, 'sem payload decifrável → PROTECTED_DECRYPT_FAILURE sinalizado');
  check(c.decryptFail === 'hide', 'o atributo decrypt-fail="hide" é exposto');
  check(classifyMessage(info.message)?.protectedSelective !== true, 'classificar só info.message (undefined) NÃO acharia — o bug original');
}

console.log('\n── 3. forma antiga do sinal (booleano true) continua valendo ──');
{
  const info = { ...selectiveInfo(), selectiveDistribution: true };
  check(classifyMessage(info).protectedSelective === true, 'aceita selectiveDistribution: true');
}

console.log('\n── 4. PAYMENT_ZERO tem precedência sobre o rótulo de transporte ──');
{
  const both = { ...zeroPayment(), selectiveDistribution: { decryptFail: 'hide' } };
  check(classifyMessage(both).category === 'PAYMENT_ZERO', 'pagamento zerado vence (é verificável no payload)');
}

console.log('\n── 5. pagamento LEGÍTIMO nunca vira ataque ──');
{
  const legit = {
    key: { remoteJid: 'g@g.us', fromMe: false, id: 'L-1' },
    message: { requestPaymentMessage: { amount1000: '1500', amount: { value: '1500' } } },
  };
  const c = classifyMessage(legit);
  check(c.paymentAmount.isZero === false, 'amount 1500 → isZero false');
  check(c.category === 'NORMAL', 'pagamento com valor → NORMAL');
}

console.log('\n── 6. robustez: nunca lança, nunca classifica errado por lixo ──');
{
  check(classifyMessage(null).category === 'NORMAL', 'null → NORMAL');
  check(classifyMessage(undefined).category === 'NORMAL', 'undefined → NORMAL');
  check(classifyMessage({}).category === 'NORMAL', '{} → NORMAL');
  check(classifyMessage('texto').category === 'NORMAL', 'string → NORMAL');
  check(classifyMessage({ selectiveDistribution: false }).category === 'NORMAL', 'sinal false → NORMAL');
  check(classifyMessage({ selectiveDistribution: null }).category === 'NORMAL', 'sinal null → NORMAL');
}

console.log('\n════════════════════════════════════════');
console.log(`RESULTADO: ${ok} ok | ${fail} falhas`);
console.log('════════════════════════════════════════');
if (fail) {
  console.log('\nFALHAS:');
  for (const e of erros) console.log(`- ${e}`);
  process.exit(1);
}
console.log('✅ classificação central VALIDADA');
process.exit(0);
