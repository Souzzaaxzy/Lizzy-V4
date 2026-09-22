/**
 * Testes do ANALISADOR FORENSE DE MENSAGEM INVISÍVEL
 * (dados/src/utils/invisibleAnalyzer.js) e da sua integração no `!get`.
 *
 * Cobre a matriz pedida (A–J): mensagem normal, invisível conhecida,
 * parcialmente semelhante, @lid, payment, noteMessage, distribuição seletiva,
 * falha de descriptografia, Sender Key e combinação de indicadores.
 *
 * O ponto mais importante NÃO é o recall: é o FALSO POSITIVO. Um classificador
 * que chama toda mensagem incomum de "invisível" é inútil, então metade dos
 * testes são sósias que precisam sair como NORMAL/ATÍPICA/INCONCLUSIVA.
 *
 * Uso: node tests/invisible-analyzer.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { proto } from '@itsliaaa/baileys';

const RESULTADOS = [];
let ATUAL = null;

function teste(nome, fn) {
  ATUAL = { nome, passed: 0, failed: 0, errors: [] };
  RESULTADOS.push(ATUAL);
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      return r.then(() => fim(nome)).catch((e) => { ATUAL.failed += 1; ATUAL.errors.push(`EXCEÇÃO: ${e?.stack || e}`); fim(nome); });
    }
    fim(nome);
  } catch (e) {
    ATUAL.failed += 1;
    ATUAL.errors.push(`EXCEÇÃO: ${e?.stack || e}`);
    fim(nome);
  }
  return Promise.resolve();
}

function fim(nome) {
  console.log(`${ATUAL.failed === 0 ? '✅' : '❌'} ${nome} (${ATUAL.passed} ok, ${ATUAL.failed} falhas)`);
  for (const e of ATUAL.errors) console.log(`     ${e.split('\n')[0]}`);
}
function ok(cond, msg) {
  if (cond) ATUAL.passed += 1;
  else { ATUAL.failed += 1; ATUAL.errors.push(`ASSERT FALHOU: ${msg}`); }
}
function eq(a, b, msg) {
  ok(a === b, `${msg} — esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);
}
function contem(hay, needle, label) {
  ok(typeof hay === 'string' && hay.includes(needle), `${label || needle} — esperado conter "${needle}"`);
}
function naoContem(hay, needle, label) {
  ok(typeof hay === 'string' && !hay.includes(needle), `${label || needle} — NÃO deveria conter "${needle}"`);
}

// Import estático do motor (puro, sem efeitos colaterais).
const {
  analyzeInvisibleMessage,
  formatInvisibleSection,
  formatInvisibleResumo,
  analisarKey,
  analisarLid,
  analisarDistribuicao,
  analisarDescriptografia,
  analisarSenderKey,
  analisarPagamento,
  analisarContexto,
  analisarCitacao,
  analisarWrappers,
  analisarStub,
  analisarCamposDesconhecidos,
  correlacionar,
  INDICADORES,
  LIMITACOES,
} = await import(new URL('../dados/src/utils/invisibleAnalyzer.js', import.meta.url).href);

// ============================================================================
// FIXTURES (em memória — nada é enviado, nenhum socket aberto)
// ============================================================================

const GRUPO = '120363000000000001@g.us';
const LID_A = '111000000000001@lid';
const PN_A = '5511900000001@s.whatsapp.net';
const ID_OK = '3EB0A9C9AFB76E7451EA1D';

const keyGrupo = (over = {}) => ({
  remoteJid: GRUPO, fromMe: false, id: ID_OK, participant: LID_A, addressingMode: 'lid', participantAlt: PN_A, ...over,
});

/** A. mensagem normal de texto. */
const normal = { key: keyGrupo(), message: { conversation: 'oi, tudo bem?' } };
/** A. mídia normal. */
const normalImagem = { key: keyGrupo(), message: { imageMessage: { mimetype: 'image/jpeg', fileLength: 100, mediaKey: Buffer.alloc(32) } } };
/** A. áudio normal. */
const normalAudio = { key: keyGrupo(), message: { audioMessage: { mimetype: 'audio/ogg; codecs=opus', ptt: true, seconds: 5, mediaKey: Buffer.alloc(32) } } };
/** A. figurinha normal. */
const normalSticker = { key: keyGrupo(), message: { stickerMessage: { mimetype: 'image/webp', isAnimated: false, mediaKey: Buffer.alloc(32) } } };
/** A. texto citando outra mensagem (referência válida). */
const normalCitado = { key: keyGrupo(), message: { extendedTextMessage: { text: 'concordo', contextInfo: { stanzaId: 'ABC', participant: LID_A, quotedMessage: { conversation: 'top' } } } } };
/** A. mensagem com menções normais. */
const normalMencoes = { key: keyGrupo(), message: { extendedTextMessage: { text: 'oi @a @b', contextInfo: { mentionedJid: [LID_A, PN_A] } } } };
/** A. view-once de verdade (foto). */
const normalViewOnce = { key: keyGrupo(), message: { viewOnceMessageV2: { message: { imageMessage: { mimetype: 'image/jpeg', mediaKey: Buffer.alloc(32) } } } } };
/** A. mensagem efêmera (grupo com mensagens temporárias). */
const normalEfêmera = { key: keyGrupo(), message: { ephemeralMessage: { message: { conversation: 'some depois' } } } };
/** A. encaminhada simples. */
const normalEncaminhada = { key: keyGrupo(), message: { extendedTextMessage: { text: 'repasse', contextInfo: { forwardingScore: 5, isForwarded: true } } } };
/** A. edição de mensagem (protocolMessage). */
const normalEdicao = { key: keyGrupo(), fromMe: true, message: { protocolMessage: { type: 14, key: { id: 'X', remoteJid: GRUPO }, editedMessage: { conversation: 'corrigido' } } } };
/** A. SKDM normal de grupo (distribuição de chave). */
const normalSkdm = { key: keyGrupo(), message: { senderKeyDistributionMessage: { groupId: GRUPO, axolotlSenderKeyDistributionMessage: new Uint8Array([1, 2]) } } };

/** E/F. payment LEGÍTIMO (com valor) — não pode ser invisível. */
const paymentLegitimo = { key: keyGrupo(), message: { requestPaymentMessage: { currencyCodeIso4217: 'BRL', amount1000: '1500', amount: { value: '1500', offset: 1000, currencyCode: 'BRL' }, noteMessage: { extendedTextMessage: { text: 'pague o aluguel' } } } } };

/** H. stub CIPHERTEXT sem report = "entrei tarde / perdi a chave". */
const stubEntrouTarde = { key: keyGrupo(), messageStubType: 2, messageStubParameters: ['No session found to decrypt message'] };

/** D. mensagem só-LID (endereçamento atual do WhatsApp). */
const soLid = { key: keyGrupo(), message: { extendedTextMessage: { text: 'bom dia' } } };

/** B. raja: payment zerado + texto na nota (a "invisível" conhecida). */
const raja = {
  key: keyGrupo(),
  message: {
    requestPaymentMessage: {
      currencyCodeIso4217: 'BRL', amount1000: '0', expiryTimestamp: '0',
      amount: { value: '0', offset: 1000, currencyCode: 'BRL' },
      noteMessage: { extendedTextMessage: { text: 'texto escondido na nota', contextInfo: { mentionedJid: [LID_A, PN_A] } } },
    },
  },
};
/** B. raja encapsulado em view-once. */
const rajaViewOnce = { key: keyGrupo(), message: { viewOnceMessageV2: { message: raja.message } } };
/** C. parcialmente semelhante: payment zerado SEM nota. */
const paymentZeroSemNota = { key: keyGrupo(), message: { requestPaymentMessage: { currencyCodeIso4217: 'BRL', amount1000: '0', amount: { value: '0', offset: 1000, currencyCode: 'BRL' } } } };
/** C. parcialmente semelhante: nota com texto mas valor legítimo. */
const notaComValor = { key: keyGrupo(), message: { requestPaymentMessage: { currencyCodeIso4217: 'BRL', amount1000: '999', amount: { value: '999', offset: 1000, currencyCode: 'BRL' }, noteMessage: { extendedTextMessage: { text: 'uma nota qualquer' } } } } };

/** G. distribuição seletiva — report que a fork anexa. */
const reportSeletivo = (over = {}) => ({
  kind: 'selective-distribution', messageId: ID_OK, groupJid: GRUPO, author: PN_A,
  encType: 'skmsg', decryptFail: 'hide', addressedDeviceCount: 3, hasPhash: false,
  groupDeviceCount: 50, density: 0.06, skdmRecentMs: 800, reason: 'No session found to decrypt message', ...over,
});
const seletiva = {
  key: keyGrupo({ participant: PN_A, participantAlt: undefined, addressingMode: 'pn' }),
  messageStubType: 2,
  messageStubParameters: ['No session found to decrypt message'],
  selectiveDistribution: reportSeletivo(),
};
/** Fan-out NORMAL de grupo: skmsg COM phash e densidade cheia (sósia crítico). */
const fanOutNormal = {
  key: keyGrupo(),
  message: { extendedTextMessage: { text: 'bom dia grupo' } },
  selectiveDistribution: reportSeletivo({ hasPhash: true, density: 1, skdmRecentMs: null, decryptFail: null, addressedDeviceCount: 50 }),
};

/** J. combinação: seletiva + LID + wrapper + campos desconhecidos. */
const combinado = {
  key: keyGrupo({ somethingUnknown: 'x' }),
  messageStubType: 2,
  messageStubParameters: ['No session found to decrypt message'],
  selectiveDistribution: reportSeletivo(),
  campoEnvelopeDesconhecido: true,
};

/** Sósia: sistema (criação de grupo). */
const sistemaGrupoCriado = { key: keyGrupo(), messageStubType: 20, messageStubParameters: [] };
/** Sósia: revogação. */
const revogacao = { key: keyGrupo(), messageStubType: 1, messageStubParameters: [LID_A] };
/** Sósia: erro de descriptografia não relacionado (1a1, sem grupo/report). */
const erroDescrNaoRelacionado = { key: { remoteJid: PN_A, fromMe: false, id: ID_OK, addressingMode: 'pn' }, messageStubType: 2, messageStubParameters: ['Invalid PreKey'] };
/** Sósia: catálogo. */
const catalogo = { key: keyGrupo(), message: { productMessage: { product: { productId: '1' } } } };

const todasNormais = [
  ['texto comum', normal], ['imagem', normalImagem], ['áudio', normalAudio], ['figurinha', normalSticker],
  ['citação válida', normalCitado], ['menções normais', normalMencoes], ['view-once real', normalViewOnce],
  ['efêmera', normalEfêmera], ['encaminhada', normalEncaminhada], ['edição', normalEdicao], ['SKDM normal', normalSkdm],
  ['payment legítimo', paymentLegitimo], ['payment zero sem nota', paymentZeroSemNota], ['nota com valor', notaComValor],
  ['só LID', soLid], ['catálogo', catalogo], ['criação de grupo', sistemaGrupoCriado], ['revogação', revogacao],
  ['erro de decifragem 1a1', erroDescrNaoRelacionado], ['fan-out normal (com phash)', fanOutNormal],
];

// ============================================================================
// SEÇÃO 0 — ESTRUTURA DO MOTOR
// ============================================================================

await teste('1. motor é puro e exporta a API esperada', () => {
  for (const fn of [analyzeInvisibleMessage, formatInvisibleSection, formatInvisibleResumo, analisarKey, analisarLid, analisarDistribuicao, analisarDescriptografia, analisarSenderKey, analisarPagamento, analisarContexto, analisarCitacao, analisarWrappers, analisarStub, analisarCamposDesconhecidos, correlacionar]) {
    eq(typeof fn, 'function', 'função exportada');
  }
  ok(Object.keys(INDICADORES).length >= 15, 'catálogo de indicadores preenchido');
  for (const ind of Object.values(INDICADORES)) {
    ok(ind.id && ind.nome && ind.categoria && ind.severidade, `indicador ${ind.id} tem metadados`);
    eq(typeof ind.peso, 'number', `${ind.id} tem peso numérico`);
  }
});

await teste('2. resultado tem a forma estruturada adaptada ao projeto', () => {
  const r = analyzeInvisibleMessage({ info: raja });
  eq(typeof r.detected, 'boolean', 'detected');
  contem(r.classification, r.classification, 'classification');
  eq(typeof r.confidence, 'number', 'confidence');
  ok(Array.isArray(r.indicators), 'indicators');
  ok(Array.isArray(r.anomalies), 'anomalies');
  ok(r.structures && typeof r.structures === 'object', 'structures');
  ok(r.distribution && typeof r.distribution === 'object', 'distribution');
  ok(r.decryption && typeof r.decryption === 'object', 'decryption');
  ok(r.payment && typeof r.payment === 'object', 'payment');
  ok(r.lid && typeof r.lid === 'object', 'lid');
  ok(r.key && typeof r.key === 'object', 'key');
  ok(r.context && typeof r.context === 'object', 'context');
  ok(r.unknownFields && typeof r.unknownFields === 'object', 'unknownFields');
  ok(r.correlation && typeof r.correlation === 'object', 'correlation');
  ok(Array.isArray(r.explanation) && r.explanation.length > 0, 'explanation');
  ok(Array.isArray(LIMITACOES) && LIMITACOES.length > 0, 'limitações declaradas');
});

await teste('3. entrada inválida NUNCA lança e devolve INCONCLUSIVA', () => {
  for (const entrada of [null, undefined, 'texto', 42, [], {}, { info: null }, { info: 'x' }]) {
    const r = analyzeInvisibleMessage(entrada);
    eq(r.classification, 'INCONCLUSIVA', `entrada ${JSON.stringify(entrada)} → INCONCLUSIVA`);
    eq(r.detected, false, 'não detecta em entrada inválida');
  }
});

await teste('4. nenhuma chave privada/segredo é exposta no resultado', () => {
  const comSegredos = {
    key: keyGrupo(),
    message: {
      senderKeyDistributionMessage: { groupId: GRUPO, axolotlSenderKeyDistributionMessage: new Uint8Array([9, 9, 9]) },
      extendedTextMessage: { text: 'x', mediaKey: new Uint8Array([1, 2, 3]) },
    },
  };
  const r = analyzeInvisibleMessage({ info: comSegredos });
  const dump = JSON.stringify(r);
  naoContem(dump, '9,9,9', 'material do SKDM não vaza bytes');
  naoContem(dump, '1,2,3', 'mediaKey não vaza bytes');
  ok(r.senderKey.skdmTemMaterial === true, 'presença do material é reportada como booleano');
});

// ============================================================================
// SEÇÃO 1 — MATRIZ A: NENHUMA MENSAGEM NORMAL VIRA INVISÍVEL
// ============================================================================

await teste('5. MATRIZ A: nenhuma mensagem normal é classificada como suspeita/forte', () => {
  for (const [nome, msg] of todasNormais) {
    const r = analyzeInvisibleMessage({ info: msg });
    ok(r.classification !== 'FORTEMENTE_COMPATIVEL', `${nome}: NÃO deve ser FORTEMENTE_COMPATIVEL (veio ${r.classification})`);
    ok(r.classification !== 'SUSPEITA', `${nome}: NÃO deve ser SUSPEITA (veio ${r.classification})`);
    eq(r.detected, false, `${nome}: detected=false`);
  }
});

await teste('6. MATRIZ A: @lid sozinho é NORMAL e explicitamente não-prova', () => {
  const r = analyzeInvisibleMessage({ info: soLid });
  eq(r.classification, 'NORMAL', 'texto endereçado por LID é normal');
  eq(r.lid.lidDetectado, true, 'LID detectado');
  eq(r.lid.inconsistente, false, 'LID não é inconsistência por si');
  const txt = formatInvisibleSection(r);
  contem(txt, '@lid não é prova de mensagem invisível', 'a seção afirma o limite');
  ok(!r.indicators.some((i) => Number(i.peso) > 0), 'LID não gera indicador com peso');
});

await teste('7. MATRIZ A: payment legítimo tem valor e não é anomalia', () => {
  const r = analyzeInvisibleMessage({ info: paymentLegitimo });
  eq(r.payment.anomaliaZero, false, 'não é anomalia de zero');
  eq(r.payment.amount1000.valor, '1500', 'amount1000 lido');
  ok(!r.indicators.some((i) => i.id === 'INV-007'), 'INV-007 ausente');
  const txt = formatInvisibleSection(r);
  contem(txt, 'Request de pagamento com valor presente', 'justificativa honesta');
});

await teste('8. MATRIZ A: stub de quem entrou tarde é INCONCLUSIVA, nunca ataque', () => {
  const r = analyzeInvisibleMessage({ info: stubEntrouTarde });
  eq(r.classification, 'INCONCLUSIVA', 'stub sem report é inconclusivo');
  eq(r.detected, false, 'não marcado');
  ok(r.indicators.some((i) => i.id === 'INV-010'), 'stub é reportado como ambíguo');
  ok(r.explanation.some((l) => /Informa/i.test(l)), 'explica insuficiência');
});

await teste('9. MATRIZ A: fan-out normal (phash presente, densidade cheia) não é ataque', () => {
  const r = analyzeInvisibleMessage({ info: fanOutNormal });
  ok(r.classification !== 'FORTEMENTE_COMPATIVEL', `não é forte (veio ${r.classification})`);
  ok(r.classification !== 'SUSPEITA', `não é suspeita (veio ${r.classification})`);
  eq(r.distribution.disponivel, true, 'report lido');
  eq(r.distribution.phash, true, 'phash presente');
  eq(r.distribution.seletiva, false, 'sem sinal objetivo → não é tratada como seletiva');
  eq(r.correlation.estrutural, false, 'sem evidência estrutural');
});

// ============================================================================
// SEÇÃO 2 — MATRIZ B/C: O ATAQUE CONHECIDO E OS PARCIALMENTE SEMELHANTES
// ============================================================================

await teste('10. MATRIZ B: raja (payment zerado + nota) é FORTEMENTE COMPATÍVEL', () => {
  const r = analyzeInvisibleMessage({ info: raja });
  eq(r.classification, 'FORTEMENTE_COMPATIVEL', 'classificação');
  eq(r.detected, true, 'detectado');
  eq(r.payment.anomaliaZero, true, 'anomalia de zero');
  eq(r.payment.zeroPath, 'amount1000', 'caminho do zero');
  eq(r.correlation.assinaturaConteudo, true, 'assinatura de conteúdo');
  ok(r.indicators.some((i) => i.id === 'INV-007'), 'pagamento sem valor');
  ok(r.indicators.some((i) => i.id === 'INV-008'), 'nota com texto');
});

await teste('11. MATRIZ B: raja encapsulado em view-once continua detectado', () => {
  const r = analyzeInvisibleMessage({ info: rajaViewOnce });
  eq(r.classification, 'FORTEMENTE_COMPATIVEL', 'detecta através do wrapper');
  ok(r.wrappers.aninhado, 'wrapper reconhecido');
  ok(r.indicators.some((i) => i.id === 'INV-013'), 'aninhamento reportado');
});

await teste('12. MATRIZ C: payment zerado SEM nota é atípico (não é o raja)', () => {
  const r = analyzeInvisibleMessage({ info: paymentZeroSemNota });
  ok(r.classification !== 'FORTEMENTE_COMPATIVEL', `não é forte (veio ${r.classification})`);
  eq(r.correlation.assinaturaConteudo, false, 'sem assinatura de conteúdo (falta a nota)');
  ok(r.indicators.some((i) => i.id === 'INV-019'), 'zero sem nota entra como indicador de peso reduzido');
  ok(!r.indicators.some((i) => i.id === 'INV-007'), 'não é tratado como a rajada (INV-007 exige a nota)');
});

await teste('13. MATRIZ C: nota com texto mas valor legítimo não eleva', () => {
  const r = analyzeInvisibleMessage({ info: notaComValor });
  ok(r.classification !== 'FORTEMENTE_COMPATIVEL', `não é forte (veio ${r.classification})`);
  eq(r.correlation.assinaturaConteudo, false, 'valor presente → sem assinatura');
});

// ============================================================================
// SEÇÃO 3 — MATRIZ G/H/I: DISTRIBUIÇÃO, DESCRIPTOGRAFIA, SENDER KEY
// ============================================================================

await teste('14. MATRIZ G: distribuição seletiva é FORTEMENTE COMPATÍVEL', () => {
  const r = analyzeInvisibleMessage({ info: seletiva });
  eq(r.classification, 'FORTEMENTE_COMPATIVEL', 'classificação');
  eq(r.distribution.disponivel, true, 'report disponível');
  eq(r.distribution.seletiva, true, 'seletiva');
  eq(r.distribution.encType, 'skmsg', 'encType');
  eq(r.distribution.destinatarios, 3, 'destinatários');
  eq(r.distribution.grupoDispositivos, 50, 'dispositivos do grupo');
  eq(r.distribution.exclusoes, 47, 'exclusões calculadas');
  eq(r.distribution.phash, false, 'phash ausente');
  eq(r.correlation.estrutural, true, 'evidência estrutural');
  for (const id of ['INV-001', 'INV-002', 'INV-003', 'INV-004', 'INV-005']) {
    ok(r.indicators.some((i) => i.id === id), `indicador ${id} presente`);
  }
});

await teste('15. MATRIZ G: SEM report, distribuição é declarada indisponível (não inventada)', () => {
  const r = analyzeInvisibleMessage({ info: normal });
  eq(r.distribution.disponivel, false, 'indisponível');
  eq(r.distribution.destinatarios, null, 'nenhum destinatário inventado');
  const txt = formatInvisibleSection(r);
  contem(txt, 'Informação de distribuição seletiva não disponível neste evento', 'declara o limite');
});

await teste('16. MATRIZ H: falha de descriptografia é detalhada, mas não é prova', () => {
  const r = analyzeInvisibleMessage({ info: stubEntrouTarde });
  eq(r.decryption.falha, true, 'falha detectada');
  contem(r.decryption.tipo, 'CIPHERTEXT', 'tipo');
  contem(r.decryption.observacao, 'NÃO é prova', 'observação honesta');
  const txt = formatInvisibleSection(r);
  contem(txt, 'Falha:', 'seção mostra a falha');
  contem(txt, 'mesmo estado de quem entrou tarde', 'mantém a ressalva');
});

await teste('17. MATRIZ H: retryCount da stanza é lido quando presente', () => {
  const comRetry = { ...seletiva, retryCount: 2 };
  const r = analyzeInvisibleMessage({ info: comRetry });
  contem(r.decryption.retry, '2', 'retry lido');
});

await teste('18. MATRIZ I: SKDM normal é informativo (peso 0) e não eleva', () => {
  const r = analyzeInvisibleMessage({ info: normalSkdm });
  eq(r.senderKey.skdmObservado, true, 'SKDM observado');
  eq(r.senderKey.skmsgCruObservavel, false, 'skmsg cru não é observável nesta camada');
  const ind = r.indicators.find((i) => i.id === 'INV-018');
  ok(ind && Number(ind.peso) === 0, 'INV-018 é informativo');
  ok(r.classification !== 'FORTEMENTE_COMPATIVEL', 'não eleva a classificação');
});

await teste('19. MATRIZ I: o skmsg cru é declarado NÃO OBSERVÁVEL (limite honesto)', () => {
  const r = analyzeInvisibleMessage({ info: seletiva });
  eq(r.senderKey.skmsgCruObservavel, false, 'não é observável');
  contem(r.senderKey.skmsgObservacao, 'não observável', 'explica por quê');
  const txt = formatInvisibleSection(r);
  contem(txt, 'NÃO OBSERVÁVEL NESTA CAMADA', 'a seção declara');
});

// ============================================================================
// SEÇÃO 4 — MATRIZ J: COMBINAÇÃO / CORRELAÇÃO
// ============================================================================

await teste('20. MATRIZ J: combinação de indicadores eleva a classificação', () => {
  const r = analyzeInvisibleMessage({ info: combinado });
  eq(r.classification, 'FORTEMENTE_COMPATIVEL', 'combinado é forte');
  ok(r.indicators.length >= 5, `vários indicadores (${r.indicators.length})`);
  ok(r.anomalies.length >= 1, 'anomalias listadas');
  const txt = formatInvisibleSection(r);
  contem(txt, 'Nenhum indicador isolado é considerado suficiente', 'deixa claro o princípio');
});

await teste('21. indicador isolado ≠ invisível; combinação → aumenta compatibilidade', () => {
  const so = analyzeInvisibleMessage({ info: seletiva });
  const menos = analyzeInvisibleMessage({ info: { ...seletiva, selectiveDistribution: reportSeletivo({ phash: true, density: 1, skdmRecentMs: null, decryptFail: null, addressedDeviceCount: 50 }) } });
  ok(so.confidence > menos.confidence, `score com sinais fortes (${so.confidence}) > score com sinais fracos (${menos.confidence})`);
});

await teste('22. score nunca é apresentado como probabilidade', () => {
  const txt = formatInvisibleSection(analyzeInvisibleMessage({ info: raja }));
  contem(txt, 'Índice de compatibilidade', 'rótulo correto');
  contem(txt, 'não é probabilidade', 'ressalva explícita');
  naoContem(txt, '100% invisível', 'nunca afirma certeza');
  naoContem(txt, '% de certeza', 'nunca vende probabilidade');
});

// ============================================================================
// SEÇÃO 5 — REGRAS CONTRA FALSA CERTEZA
// ============================================================================

await teste('23. nenhuma classificação afirma "invisível" como fato absoluto', () => {
  for (const [nome, msg] of [...todasNormais, ['raja', raja], ['seletiva', seletiva]]) {
    const txt = formatInvisibleSection(analyzeInvisibleMessage({ info: msg }));
    naoContem(txt, 'é invisível', `${nome}: não afirma fato`);
    naoContem(txt, '100%', `${nome}: sem percentual de certeza`);
  }
});

await teste('24. campos ausentes são "NÃO DISPONÍVEL", nunca inventados', () => {
  const r = analyzeInvisibleMessage({ info: normal });
  eq(r.distribution.disponivel, false, 'sem report');
  eq(r.payment.disponivel, false, 'sem payment');
  eq(r.quoted.disponivel, false, 'sem citação');
  eq(r.protocol.disponivel, false, 'sem protocolMessage');
  const txt = formatInvisibleSection(r);
  contem(txt, 'NÃO DISPONÍVEL', 'a seção mostra o marcador');
});

await teste('25. anomalias só aparecem quando há contrato violado de verdade', () => {
  // Citando sem stanzaId -> anomalia.
  const citacaoRuim = { key: keyGrupo(), message: { extendedTextMessage: { text: 'x', contextInfo: { quotedMessage: { conversation: 'y' } } } } };
  const r1 = analyzeInvisibleMessage({ info: citacaoRuim });
  ok(r1.anomalies.some((a) => /stanzaId/i.test(a)), 'citação sem stanzaId é anomalia');
  ok(r1.indicators.some((i) => i.id === 'INV-014'), 'INV-014 presente');
  // Citando com stanzaId -> sem essa anomalia.
  const r2 = analyzeInvisibleMessage({ info: normalCitado });
  ok(!r2.indicators.some((i) => i.id === 'INV-014'), 'citação válida não gera INV-014');
});

await teste('26. menção em massa só conta junto de nota de pagamento', () => {
  const muitas = Array.from({ length: 60 }, (_, i) => `55119000${String(i).padStart(5, '0')}@s.whatsapp.net`);
  const mencaoPura = { key: keyGrupo(), message: { extendedTextMessage: { text: 'oi', contextInfo: { mentionedJid: muitas } } } };
  const r = analyzeInvisibleMessage({ info: mencaoPura });
  ok(!r.indicators.some((i) => i.id === 'INV-009'), 'menção em massa sozinha não vira indicador de rajada');
  ok(r.classification !== 'FORTEMENTE_COMPATIVEL', 'não eleva');
  // Com payment zerado + nota, aí sim.
  const rajada = {
    key: keyGrupo(),
    message: { requestPaymentMessage: { amount1000: '0', amount: { value: '0', offset: 1000 }, noteMessage: { extendedTextMessage: { text: 'x', contextInfo: { mentionedJid: muitas } } } } },
  };
  const r2 = analyzeInvisibleMessage({ info: rajada });
  ok(r2.indicators.some((i) => i.id === 'INV-009'), 'com nota zerada, sim');
});

// ============================================================================
// SEÇÃO 6 — MESSAGE KEY E LID
// ============================================================================

await teste('27. análise de key: formato, campos reais e campos ausentes', () => {
  const k = analisarKey(keyGrupo(), {});
  eq(k.id, ID_OK, 'id');
  contem(k.idFormato, 'padrao', 'formato padrão');
  eq(k.fromMe, false, 'fromMe');
  eq(k.remoteJidTipo, 'grupo', 'tipo de chat');
  eq(k.participantTipo, 'lid', 'participant é LID');
  eq(k.participantAlt, PN_A, 'participantAlt presente');
  for (const ausente of ['device', 'agent', 'to', 'from', 'status']) {
    ok(k.ausentes.includes(ausente), `${ausente} declarado ausente nesta versão`);
  }
});

await teste('28. análise de key: ID fora do padrão e reuso são detectados', () => {
  const fora = analisarKey({ id: 'XPTO-1', remoteJid: GRUPO, fromMe: false }, {});
  contem(fora.idFormato, 'fora do padrao', 'formato fora do padrão');
  ok(fora.anomalias.some((a) => /padrao/.test(a)), 'anomalia de formato');
  const vistos = new Set([ID_OK]);
  const reuso = analisarKey({ id: ID_OK, remoteJid: GRUPO, fromMe: false }, { seenIds: vistos });
  eq(reuso.reuso, true, 'reuso detectado');
  ok(reuso.anomalias.some((a) => /reutilizacao/.test(a)), 'anomalia de reuso');
  const semSet = analisarKey({ id: ID_OK, remoteJid: GRUPO, fromMe: false }, {});
  eq(semSet.reuso, null, 'sem conjunto de IDs, reuso é NÃO DISPONÍVEL (null)');
});

await teste('29. análise de LID: contradição entre addressingMode e formato', () => {
  const contraditorio = analisarLid({ remoteJid: GRUPO, participant: PN_A, addressingMode: 'lid' }, null);
  eq(contraditorio.inconsistente, true, 'detecta contradição');
  const coerente = analisarLid(keyGrupo(), null);
  eq(coerente.inconsistente, false, 'coerente não é inconsistente');
});

// ============================================================================
// SEÇÃO 7 — CONTEXTO, CITAÇÃO, WRAPPERS, STUB, PROTOCOLO
// ============================================================================

await teste('30. contexto: campos, citação, efêmera, encaminhamento', () => {
  const ctxMsg = {
    key: keyGrupo(),
    message: { extendedTextMessage: { text: 'x', contextInfo: { stanzaId: 'A', participant: LID_A, quotedMessage: { conversation: 'y' }, expiration: 86400, forwardingScore: 3, isForwarded: true, mentionedJid: [LID_A], utm: {} } } },
  };
  const r = analyzeInvisibleMessage({ info: ctxMsg });
  eq(r.context.disponivel, true, 'contextInfo disponível');
  contem(r.context.caminho, 'extendedTextMessage.contextInfo', 'caminho');
  eq(r.context.mencoes, 1, 'menções');
  ok(r.context.citacao, 'citação presente');
  ok(r.context.efemera, 'efêmera detectada');
  ok(r.context.encaminhamento.isForwarded, 'encaminhamento');
  ok(r.context.utm, 'utm');
  eq(r.quoted.profundidade, 1, 'profundidade da citação');
});

await teste('31. citação aninhada mede profundidade corretamente', () => {
  const aninhada = {
    key: keyGrupo(),
    message: {
      extendedTextMessage: {
        text: 'x',
        contextInfo: {
          stanzaId: 'A', participant: LID_A,
          quotedMessage: { extendedTextMessage: { text: 'meio', contextInfo: { stanzaId: 'B', participant: PN_A, quotedMessage: { conversation: 'fundo' } } } },
        },
      },
    },
  };
  const r = analyzeInvisibleMessage({ info: aninhada });
  eq(r.quoted.profundidade, 2, 'dois níveis');
  eq(r.quoted.tipos.length, 2, 'dois tipos');
});

await teste('32. wrappers: cadeia e profundidade', () => {
  const r = analisarWrappers({ ephemeralMessage: { message: { viewOnceMessageV2: { message: { imageMessage: { mimetype: 'image/jpeg' } } } } } });
  eq(r.profundidade, 3, 'três camadas');
  ok(r.aninhado, 'aninhado');
  contem(r.chain.join('->'), 'viewOnceMessageV2', 'wrapper interno');
  eq(r.tipoFolha, 'imageMessage', 'tipo folha');
});

await teste('33. stub: técnico vs visual', () => {
  const stub = analisarStub({ messageStubType: 2, messageStubParameters: ['No session'] });
  eq(stub.vaziaTecnicamente, true, 'CIPHERTEXT é tecnicamente vazia');
  contem(stub.tipoLabel, 'CIPHERTEXT', 'label');
  const criado = analisarStub({ messageStubType: 20 });
  eq(criado.vaziaTecnicamente, false, 'criação de grupo não é vazia');
  const nenhum = analisarStub({});
  eq(nenhum.disponivel, false, 'sem stub');
});

await teste('34. protocolo: edição detectada, sem virar invisível', () => {
  const r = analyzeInvisibleMessage({ info: normalEdicao });
  eq(r.protocol.disponivel, true, 'detectado');
  eq(r.protocol.edicao, true, 'edição');
  const ind = r.indicators.find((i) => i.id === 'INV-016');
  if (ind) eq(Number(ind.peso), 0, 'INV-016 é informativo');
});

// ============================================================================
// SEÇÃO 8 — CAMPOS DESCONHECIDOS
// ============================================================================

await teste('35. campos desconhecidos na raiz do Message são listados', () => {
  const msg = { key: keyGrupo(), message: { campoIneditoXYZ: 'valor', imageMessage: { mimetype: 'image/jpeg' } } };
  const r = analyzeInvisibleMessage({ info: msg });
  eq(r.unknownFields.disponivel, true, 'detectado');
  ok(r.unknownFields.campos.some((c) => c.campo === 'campoIneditoXYZ'), 'campo listado');
  const c = r.unknownFields.campos.find((x) => x.campo === 'campoIneditoXYZ');
  eq(c.tipo, 'string', 'tipo');
  contem(c.caminho, 'message.campoIneditoXYZ', 'caminho');
});

await teste('36. campos conhecidos de extendedTextMessage NÃO são desconhecidos', () => {
  const r = analyzeInvisibleMessage({ info: normalCitado });
  ok(!r.unknownFields.campos.some((c) => c.campo === 'text'), 'text é conhecido');
  ok(!r.unknownFields.campos.some((c) => c.campo === 'stanzaId'), 'stanzaId é conhecido (via contextInfo)');
});

await teste('37. campos desconhecidos na key e no envelope são listados', () => {
  const r = analisarCamposDesconhecidos({ content: { conversation: 'x' }, key: { remoteJid: GRUPO, novoCampoKey: 1 }, envelope: { mensagemForaDoMapa: true } });
  ok(r.campos.some((c) => c.campo === 'novoCampoKey'), 'key desconhecido');
  ok(r.campos.some((c) => c.campo === 'mensagemForaDoMapa'), 'envelope desconhecido');
  ok(r.porCamada.key.includes('novoCampoKey'), 'por camada');
});

// ============================================================================
// SEÇÃO 9 — FORMATAÇÃO
// ============================================================================

await teste('38. seção completa tem todas as subseções exigidas', () => {
  const txt = formatInvisibleSection(analyzeInvisibleMessage({ info: seletiva }));
  for (const t of ['🕵️ ANÁLISE DE MENSAGEM INVISÍVEL', '🧬 ESTRUTURA', '🔑 MESSAGE KEY', '🪪 LID / ADDRESSING', '📡 DISTRIBUIÇÃO', '🔐 DESCRIPTOGRAFIA', '💰 PAYMENT', '🧩 CONTEXTO', '⚠️ INDICADORES', '🔬 ANOMALIAS', '🧠 CONCLUSÃO TÉCNICA']) {
    contem(txt, t, `subseção ${t}`);
  }
});

await teste('39. modo resumido devolve bloco curto com indicadores', () => {
  const txt = formatInvisibleResumo(analyzeInvisibleMessage({ info: raja }));
  contem(txt, '🕵️ INVISÍVEL', 'cabeçalho');
  contem(txt, 'Classificação:', 'classificação');
  contem(txt, 'Compatibilidade:', 'score');
  contem(txt, '!get full', 'orienta o modo completo');
});

await teste('40. modo debug expõe camadas sem vazar bytes', () => {
  const txt = formatInvisibleSection(analyzeInvisibleMessage({ info: normalSkdm }), { debug: true });
  contem(txt, 'MODO DEBUG', 'seção debug');
  contem(txt, 'contextInfo campos', 'camadas');
  naoContem(txt, '[1,2]', 'não vaza bytes');
});

await teste('41. formatador é resiliente a entrada inválida', () => {
  for (const v of [null, undefined, 'x', 42, []]) {
    eq(formatInvisibleSection(v), '', 'seção vazia');
    eq(formatInvisibleResumo(v), '', 'resumo vazio');
  }
  // Objeto parcial não pode lançar.
  const parcial = formatInvisibleSection({ classification: 'NORMAL', confidence: 0 });
  ok(typeof parcial === 'string' && parcial.length > 0, 'objeto parcial formatado');
});

// ============================================================================
// SEÇÃO 10 — INTEGRAÇÃO COM O HANDLER REAL (!get)
// ============================================================================

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-invis-db-'));
process.env.DATABASE_PATH = TMP_DB;
fs.mkdirSync(path.join(TMP_DB, 'grupos'), { recursive: true });

const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';
const ADMIN_JID = '5511000000001@s.whatsapp.net';
const ADMIN_LID = '111000000000001@lid';

let contador = 0;
async function runGet({ alvo, infoExtra = {}, comandoTexto = '!get' } = {}) {
  const sent = [];
  const messagesCache = new Map();
  contador += 1;
  const suf = String(contador).padStart(3, '0');
  const adminUnico = `5511000000${suf}@s.whatsapp.net`;
  const grupoJid = `12036350000000${suf}@g.us`;

  const participants = [
    { id: ADMIN_LID, admin: 'superadmin', phoneNumber: ADMIN_JID },
    { id: BOT_LID, admin: 'admin', phoneNumber: BOT_JID },
    { id: adminUnico, admin: 'admin', phoneNumber: adminUnico },
  ];
  const nazu = {
    sendMessage: async (jid, content) => { sent.push({ jid, content }); return { key: { id: 'SENT' } }; },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Abyss' },
    onWhatsApp: async (jid) => [{ jid, exists: true, lid: (jid === adminUnico ? `9990000000000${suf}@lid` : ADMIN_LID) }],
    signalRepository: { lidMapping: { getPNForLID: async (lid) => (lid === ADMIN_LID ? ADMIN_JID : (String(lid).startsWith('9990000') ? `5511000000${suf}@s.whatsapp.net` : null)) } },
    groupMetadata: async () => ({ id: grupoJid, subject: 'Grupo Teste', participants }),
    groupParticipantsUpdate: async () => ({}),
    groupRequestParticipantsList: async () => [],
    groupRequestParticipantsUpdate: async () => ({}),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {},
    sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => null,
  };
  const info = {
    key: { remoteJid: grupoJid, fromMe: false, id: 'CMD-INVIS', participant: adminUnico },
    message: { extendedTextMessage: { text: comandoTexto, contextInfo: { stanzaId: 'QUOTED-INVIS', participant: '5511777777777@s.whatsapp.net', remoteJid: grupoJid, quotedMessage: alvo } } },
    messageTimestamp: 1757900000,
    pushName: 'QuemChamou',
    ...infoExtra,
  };
  await handleMessage(nazu, info, null, messagesCache, null);
  const replyText = sent.map((s) => s.content?.text).filter(Boolean).join('\n---\n');
  return { sent, replyText };
}

await teste('42. integração: !get inclui a seção forense no alvo raja', async () => {
  const { replyText } = await runGet({ alvo: raja.message });
  contem(replyText, '🕵️ ANÁLISE DE MENSAGEM INVISÍVEL', 'seção presente');
  contem(replyText, 'FORTEMENTE COMPATÍVEL', 'classificação');
  contem(replyText, 'PAYMENT', 'subseção PAYMENT');
  contem(replyText, 'Nenhum indicador isolado', 'princípio da correlação');
  // O relatório antigo continua inteiro.
  contem(replyText, 'GET MESSAGE', 'cabeçalho original');
  contem(replyText, 'RAW MESSAGE', 'raw message preservado');
  contem(replyText, 'CAMPOS DO PROTO', 'campos do proto preservados');
});

await teste('43. integração: resumo do !get mostra a classificação forense', async () => {
  const { replyText } = await runGet({ alvo: raja.message });
  contem(replyText, 'Invisível:', 'linha no resumo');
});

await teste('44. integração: mensagem normal permanece NORMAL e o !get não quebra', async () => {
  const { replyText } = await runGet({ alvo: { conversation: 'oi' } });
  contem(replyText, '🕵️ ANÁLISE DE MENSAGEM INVISÍVEL', 'seção presente');
  contem(replyText, 'Classificação: NORMAL', 'normal');
  contem(replyText, 'GET MESSAGE', 'cabeçalho original');
});

await teste('45. integração: sem citação o !get mantém a recusa original (não quebra)', async () => {
  const sent = [];
  const messagesCache = new Map();
  contador += 1;
  const suf = String(contador).padStart(3, '0');
  const admin = `5511000000${suf}@s.whatsapp.net`;
  const grupoJid = `12036350000000${suf}@g.us`;
  const nazu = {
    sendMessage: async (jid, content) => { sent.push({ jid, content }); return { key: { id: 'S' } }; },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Abyss' },
    onWhatsApp: async (jid) => [{ jid, exists: true, lid: '9990000000000x@lid' }],
    signalRepository: { lidMapping: { getPNForLID: async () => null } },
    groupMetadata: async () => ({ id: grupoJid, subject: 'g', participants: [{ id: ADMIN_LID, admin: 'superadmin', phoneNumber: ADMIN_JID }, { id: admin, admin: 'admin', phoneNumber: admin }] }),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {}, sendPresenceUpdate: async () => {},
  };
  const info = {
    key: { remoteJid: grupoJid, fromMe: false, id: 'CMD-SELF', participant: admin },
    message: { extendedTextMessage: { text: '!get' } },
    messageTimestamp: 1757900000, pushName: 'X',
  };
  await handleMessage(nazu, info, null, messagesCache, null);
  const txt = sent.map((s) => s.content?.text).filter(Boolean).join('\n');
  contem(txt, 'Marque uma mensagem', 'recusa original preservada');
});

await teste('46. integração: relatório grande continua dividido e íntegro', async () => {
  const grande = {
    imageMessage: {
      mimetype: 'image/jpeg', fileLength: 1, mediaKey: Buffer.alloc(32),
      ...Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`campoExtra${i}`, 'Y'.repeat(400)])),
    },
  };
  const { sent } = await runGet({ alvo: grande });
  ok(sent.length > 1, `deveria dividir (enviou ${sent.length})`);
  for (const [i, s] of sent.entries()) {
    ok(Buffer.byteLength(s.content?.text || '', 'utf8') <= 56000, `parte ${i + 1} dentro do limite`);
  }
  const joined = sent.map((s) => s.content?.text || '').join('\n');
  contem(joined, 'campoExtra0', 'primeiro campo');
  contem(joined, 'campoExtra299', 'último campo');
  contem(joined, '🕵️ ANÁLISE DE MENSAGEM INVISÍVEL', 'seção forense veio junto');
});

await teste('47. integração: !get debug não lança e mantém a seção', async () => {
  const { replyText } = await runGet({ alvo: raja.message, comandoTexto: '!get debug' });
  contem(replyText, '🕵️ ANÁLISE DE MENSAGEM INVISÍVEL', 'seção presente');
  contem(replyText, 'MODO DEBUG', 'modo debug ativo');
});

// ============================================================================
// SEÇÃO 11 — PLACAR DE FALSOS POSITIVOS (o oráculo)
// ============================================================================

await teste('48. PLACAR: nenhum sósia é classificado como suspeito/forte', () => {
  let fp = 0;
  for (const [nome, msg] of todasNormais) {
    const r = analyzeInvisibleMessage({ info: msg });
    if (r.classification === 'SUSPEITA' || r.classification === 'FORTEMENTE_COMPATIVEL') {
      fp += 1;
      console.log(`     ⚠️ FALSO POSITIVO: ${nome} → ${r.classification}`);
    }
    // Sem "detected" em sósia.
    if (r.detected) { fp += 1; console.log(`     ⚠️ detected=true no sósia ${nome}`); }
  }
  eq(fp, 0, 'zero falso positivo');
});

await teste('49. PLACAR: ataques conhecidos são detectados (recall)', () => {
  const ataques = [
    ['raja', raja], ['raja em view-once', rajaViewOnce], ['distribuição seletiva', seletiva], ['combinado', combinado],
  ];
  let fn = 0;
  for (const [nome, msg] of ataques) {
    const r = analyzeInvisibleMessage({ info: msg });
    if (!r.detected) { fn += 1; console.log(`     ⚠️ NÃO DETECTADO: ${nome} → ${r.classification}`); }
    ok(r.classification === 'FORTEMENTE_COMPATIVEL', `${nome} é FORTEMENTE_COMPATIVEL`);
  }
  eq(fn, 0, 'zero falso negativo');
});

await teste('50. sendPaymentMessage (amostra real) e ATIPICA, nunca forte', () => {
  // Reproduz o `sendPaymentMessage` da amostra do dono: id `_L0`, nota com
  // "." + zero-width, 6 menções, transactionData Java.
  const nota = { extendedTextMessage: { text: `.${'\u200b'.repeat(9)}`, contextInfo: { mentionedJid: Array.from({ length: 6 }, (_, i) => `5511900000${i}@s.whatsapp.net`), groupMentions: [], statusAttributions: [], nonJidMentions: 1 } } };
  const msg = { key: { remoteJid: null, id: 'ADBA604E2AA05061E5E6343D4BBB3D4C6_L0', participant: '132161176899607@lid' }, message: { sendPaymentMessage: { noteMessage: nota, transactionData: 'AAAA' } } };
  const r = analyzeInvisibleMessage({ info: msg });
  eq(r.classification, 'ATIPICA', 'atípica, não forte');
  eq(r.detected, false, 'não é detectado como ataque');
  eq(r.payment.disponivel, true, 'payment reconhecido');
  eq(r.payment.requestPayment, false, 'não é request');
  eq(r.payment.anomaliaZero, false, 'sendPaymentMessage não tem amount — zero não é avaliado');
  contem(r.payment.justificativa, 'nao carrega valor', 'explica por que o zero não se aplica');
  eq(r.payment.nota.invisiveis, 9, 'conta os zero-width factuais');
  eq(r.payment.nota.semConteudoVisivel, true, 'nota sem conteúdo visível');
  eq(r.key.sufixoHistorico, '_L0', 'sufixo de histórico detectado');
  ok(r.indicators.some((i) => i.id === 'INV-021'), 'INV-021 presente');
  ok(r.indicators.some((i) => i.id === 'INV-020'), 'INV-020 presente (com outro indicador)');
  ok(!r.indicators.some((i) => i.id === 'INV-019'), 'não é card zerado');
  ok(!r.indicators.some((i) => i.id === 'INV-007'), 'não é a rajada');
  eq(r.context.disponivel, true, 'contextInfo encontrado dentro da nota');
  contem(r.context.caminho, 'noteMessage', 'caminho correto');
  eq(r.context.mencoes, 6, 'menções lidas');
});

await teste('51. nota só com zero-width e SEM outro indicador não pontua', () => {
  const msg = { key: { remoteJid: '123@g.us', fromMe: false, id: '3EB0AABBCCDDEEFF112299', participant: '111@s.whatsapp.net', addressingMode: 'pn' }, message: { extendedTextMessage: { text: '\u200b\u200b\u200b\u200b' } } };
  const r = analyzeInvisibleMessage({ info: msg });
  ok(!r.indicators.some((i) => i.id === 'INV-020'), 'INV-020 exige outro indicador na mesma mensagem');
  eq(r.classification, 'NORMAL', 'sem outro sinal, é normal');
});

await teste('52. ID com sufixo _L0 não é confundido com ID livre', () => {
  const k = analisarKey({ id: 'ADBA604E_L0', remoteJid: 'g@g.us', fromMe: false }, {});
  eq(k.sufixoHistorico, '_L0', 'reconhece _L0');
  ok(k.anomalias.some((a) => /historico/.test(a)), 'anomalia específica');
  const livre = analisarKey({ id: 'ADBA604E2AA0', remoteJid: 'g@g.us', fromMe: false }, {});
  eq(livre.sufixoHistorico, null, 'sem sufixo');
  contem(livre.idFormato, 'fora do padrao', 'formato genérico');
});

await teste('53. transactionData é decodificado (Java serializado), sem vazar "--"', async () => {
  const inspector = await import(new URL('../dados/src/utils/messageInspector.js', import.meta.url).href);
  const buf = Buffer.concat([Buffer.from([0, 0, 0]), Buffer.from([0xac, 0xed, 0x00, 0x05]), Buffer.from('java.math.BigDecimal', 'ascii')]);
  const alvo = { sendPaymentMessage: { transactionData: buf.toString('base64') } };
  const rep = inspector.buildMessageReport({ info: { key: { remoteJid: 'g@g.us', id: 'X' }, message: alvo }, target: alvo, origin: 'contextInfo', extra: {} });
  contem(rep.full, 'transactionData (decodificado)', 'seção presente');
  contem(rep.full, 'objeto Java serializado', 'formato identificado');
  contem(rep.full, 'não é chave privada', 'deixa claro que não é segredo');
});

// ============================================================================
// FINAL
// ============================================================================

try { fs.rmSync(TMP_DB, { recursive: true, force: true }); } catch { /* ignore */ }

const totalOk = RESULTADOS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTADOS.reduce((a, r) => a + r.failed, 0);
console.log('\n════════════════════════════════════════');
console.log(`RESULTADO: ${RESULTADOS.length} testes | ${totalOk} asserções ok | ${totalFail} falhas`);
console.log('════════════════════════════════════════');
if (totalFail > 0) {
  console.log('\nFALHAS:');
  for (const r of RESULTADOS) if (r.failed) for (const e of r.errors) console.log(`- [${r.nome}] ${e}`);
  process.exit(1);
}
console.log('✅ TODOS OS TESTES PASSARAM');
process.exit(0);
