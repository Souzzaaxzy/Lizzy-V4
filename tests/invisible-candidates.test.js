/**
 * Banco de candidatas a "mensagem invisivel" — teste OFFLINE.
 *
 * Nao envia nada e nao abre socket: monta cada payload com a fork instalada e
 * confere duas coisas objetivas:
 *
 *   1. o payload E PRODUZIVEL (sai o tipo esperado no proto);
 *   2. como o PROPRIO analisador do bot (`analyzeInvisibleMessage`) classifica.
 *
 * Serve de base para decidir o que vale virar um `!rajar2` — sem depender de
 * sessao pareada. O efeito visual (a mensagem aparece ou nao no aparelho) so se
 * confirma num grupo real; isso aqui prova o proto e a deteccao.
 *
 * Uso: node tests/invisible-candidates.test.js
 */

import { generateWAMessage, generateWAMessageFromContent, proto } from '@itsliaaa/baileys';
import { analyzeInvisibleMessage } from '../dados/src/utils/invisibleAnalyzer.js';

const RESULTADOS = [];
let falhas = 0;

function ok(cond, msg) {
  if (cond) return true;
  falhas += 1;
  console.log(`     ❌ ${msg}`);
  return false;
}

const GRUPO = '120363700000000001@g.us';
const USER_JID = '5599999999999@s.whatsapp.net';
const ALVO = '5511888888888@s.whatsapp.net';

/**
 * Cada candidata declara:
 *   - `nome`: rotulo
 *   - `tipoEsperado`: o tipo que deve sair no proto
 *   - `build`: monta a mensagem (pode ser sync ou async)
 *   - `analise`: o que o analisador DEVE dizer hoje (documenta o estado)
 */
const CANDIDATAS = [
  {
    nome: 'reaction vazia',
    tipoEsperado: 'reactionMessage',
    build: () => generateWAMessage(GRUPO, {
      react: { text: '', key: { remoteJid: GRUPO, id: 'ABC', fromMe: false, participant: ALVO } },
    }, { userJid: USER_JID }),
    // Reacao vazia e invisivel de verdade (arXiv 2411.11194) e NAO e detectada.
    analise: 'NORMAL',
  },
  {
    nome: 'paymentInvite',
    tipoEsperado: 'paymentInviteMessage',
    build: () => generateWAMessage(GRUPO, { paymentInviteServiceType: 3 }, { userJid: USER_JID }),
    analise: 'NORMAL',
  },
  {
    nome: 'texto U+3164',
    tipoEsperado: 'extendedTextMessage',
    build: () => generateWAMessage(GRUPO, { text: '\u3164' }, { userJid: USER_JID }),
    analise: 'NORMAL',
  },
  {
    nome: 'keepInChat',
    tipoEsperado: 'keepInChatMessage',
    build: () => generateWAMessage(GRUPO, {
      keep: { remoteJid: GRUPO, id: 'ABC', fromMe: false }, type: 1,
    }, { userJid: USER_JID }),
    analise: 'NORMAL',
  },
  {
    nome: 'declinePaymentRequest',
    tipoEsperado: 'declinePaymentRequestMessage',
    build: () => generateWAMessageFromContent(GRUPO, {
      declinePaymentRequestMessage: { key: { id: 'X', remoteJid: GRUPO, fromMe: false } },
    }, { userJid: USER_JID }),
    analise: 'NORMAL',
  },
  {
    nome: 'cancelPaymentRequest',
    tipoEsperado: 'cancelPaymentRequestMessage',
    build: () => generateWAMessageFromContent(GRUPO, {
      cancelPaymentRequestMessage: { key: { id: 'X', remoteJid: GRUPO, fromMe: false } },
    }, { userJid: USER_JID }),
    analise: 'NORMAL',
  },
  {
    nome: 'placeholderMessage',
    tipoEsperado: 'placeholderMessage',
    build: () => generateWAMessageFromContent(GRUPO, { placeholderMessage: {} }, { userJid: USER_JID }),
    analise: 'NORMAL',
  },
  {
    nome: 'protocolMessage type 25',
    tipoEsperado: 'protocolMessage',
    build: () => generateWAMessageFromContent(GRUPO, { protocolMessage: { type: 25 } }, { userJid: USER_JID }),
    // INV-016 e informativo (peso 0) -> nao pontua.
    analise: 'NORMAL',
  },
  {
    nome: 'raja atual (sendPaymentMessage)',
    tipoEsperado: 'sendPaymentMessage',
    build: () => generateWAMessageFromContent(GRUPO, {
      sendPaymentMessage: {
        noteMessage: { extendedTextMessage: { text: '. \u200b\u200b\u200b' } },
        transactionData: 'x',
      },
    }, { userJid: USER_JID }),
    // O raja JA e detectado (INV-022 + INV-023).
    analise: 'FORTEMENTE_COMPATIVEL',
  },
  {
    nome: 'requestPaymentMessage amount 0',
    tipoEsperado: 'requestPaymentMessage',
    build: () => generateWAMessageFromContent(GRUPO, {
      requestPaymentMessage: {
        currencyCodeIso4217: 'BRL', amount1000: '0', expiryTimestamp: '0',
        amount: { value: '0', offset: 1000, currencyCode: 'BRL' },
        noteMessage: { extendedTextMessage: { text: 'x' } },
      },
    }, { userJid: USER_JID }),
    analise: 'FORTEMENTE_COMPATIVEL',
  },
];

/** Tipo de conteudo do proto (mesma heuristica do getContentType). */
function tipoDe(message) {
  const chaves = Object.keys(message || {});
  return chaves.find((k) => k === 'conversation' || k.includes('Message')) || null;
}

console.log('\n' + '='.repeat(104));
console.log('CANDIDATA'.padEnd(34) + 'TIPO'.padEnd(30) + 'BYTES'.padStart(7) + '  ' + 'DETECCAO'.padEnd(22));
console.log('='.repeat(104));

for (const c of CANDIDATAS) {
  let linha = { nome: c.nome, tipo: '-', bytes: '-', deteccao: '-' };
  try {
    const msg = await c.build();
    const tipo = tipoDe(msg.message);
    const bytes = proto.Message.encode(msg.message).finish().length;

    // O analisador exige `content` explicito: sem ele le vazio e diz NORMAL.
    const info = {
      key: { remoteJid: GRUPO, fromMe: false, id: 'MSG-1', participant: ALVO },
      message: msg.message,
      messageTimestamp: Math.floor(Date.now() / 1000),
      content: msg.message,
    };

    const analise = analyzeInvisibleMessage(info);
    const deteccao = analise.classification;
    const indicadores = (analise.indicators || []).map((i) => i.id).join(',');

    linha = { nome: c.nome, tipo, bytes, deteccao: indicadores ? `${deteccao} (${indicadores})` : deteccao };

    ok(tipo === c.tipoEsperado, `${c.nome}: tipo ${tipo} (esperado ${c.tipoEsperado})`);
    ok(deteccao === c.analise, `${c.nome}: deteccao ${deteccao} (esperado ${c.analise})`);
  } catch (e) {
    linha.deteccao = 'NAO PRODUZ';
    falhas += 1;
    console.log(`     ❌ ${c.nome}: ${e.message}`);
  }
  RESULTADOS.push(linha);
}

for (const l of RESULTADOS) {
  console.log(
    l.nome.padEnd(34) + String(l.tipo).padEnd(30) + String(l.bytes).padStart(7) + '  ' + String(l.deteccao).padEnd(22)
  );
}
console.log('='.repeat(104));

// ---------------------------------------------------------------------------
// Sintese: quais passam LIMPAS hoje (invisiveis E indetectaveis)
// ---------------------------------------------------------------------------

const limpas = RESULTADOS.filter((l) => l.deteccao === 'NORMAL').map((l) => l.nome);
const detectadas = RESULTADOS.filter((l) => l.deteccao.includes('COMPATIVEL')).map((l) => l.nome);

console.log('\n--- SINTESE ---');
console.log(`Passam LIMPAS hoje (${limpas.length}): ${limpas.join(', ')}`);
console.log(`Ja detectadas (${detectadas.length}): ${detectadas.join(', ')}`);

// O raja tem de continuar sendo detectado (regressao do analisador).
ok(
  detectadas.some((n) => n.includes('raja atual')),
  'o raja atual continua FORTEMENTE_COMPATIVEL'
);
ok(
  limpas.length >= 6,
  `ha candidatas limpas suficientes para escolher um !rajar2 (${limpas.length})`
);

// Todas produzem um tipo de conteudo valido (nenhuma saiu vazia).
for (const l of RESULTADOS) {
  ok(typeof l.tipo === 'string' && l.tipo.length > 0, `${l.nome}: produziu um tipo de conteudo`);
}

console.log('\n' + '='.repeat(60));
console.log(falhas === 0 ? `✅ ${RESULTADOS.length} candidatas verificadas, 0 falhas` : `❌ ${falhas} falhas`);
console.log('='.repeat(60));
process.exit(falhas > 0 ? 1 : 0);
