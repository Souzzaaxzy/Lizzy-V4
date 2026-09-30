/**
 * Testes das lacunas de CONTEUDO — `INV-025`, `INV-026`, `INV-027`.
 *
 * O QUE ESTE TESTE FECHA
 * ----------------------
 * O detector anterior olhava o TIPO da mensagem. Isso deixava passar uma
 * categoria inteira: mensagem cujo CAMPO DE TEXTO e absurdo (o "travazap", que
 * trava o aparelho do alvo) e texto escondido em campo que nao e de conteudo.
 *
 * Tres lacunas medidas com o banco de candidatas:
 *
 *   INV-026  campo de texto gigante      -> travazap (locationMessage.name 300KB,
 *                                           extendedTextMessage.text 1.2MB)
 *   INV-025  texto em campo de ID        -> declinePaymentRequest.key.id,
 *                                           cancelPaymentRequest.key.id
 *   INV-027  tipo de controle com payload -> keepInChatMessage, placeholderMessage
 *
 * O criterio e OBJETIVO em todos: contagem de caracteres e formato de ID.
 * Nenhuma heuristica. E o falso positivo e barrado por teste — mensagem normal,
 * legenda longa e enquete NAO podem pontuar.
 *
 * Uso: node tests/conteudo-anomalias.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateWAMessageFromContent } from '@itsliaaa/baileys';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-anom-db-'));
process.env.DATABASE_PATH = TMP_DB;

const RESULTS = [];
let CURRENT = null;

function test(name, fn) {
  CURRENT = { name, passed: 0, failed: 0, errors: [] };
  RESULTS.push(CURRENT);
  const done = (error) => {
    if (error) {
      CURRENT.failed += 1;
      CURRENT.errors.push(`EXCEÇÃO: ${error?.stack || error}`);
    }
    console.log(`${CURRENT.failed === 0 ? '✅' : '❌'} ${name} (${CURRENT.passed} ok, ${CURRENT.failed} falhas)`);
    for (const err of CURRENT.errors) console.log(`     ${err.split('\n')[0]}`);
  };
  try {
    const r = fn();
    if (r && typeof r.then === 'function') return r.then(() => done()).catch(done);
    done();
  } catch (e) {
    done(e);
  }
  return Promise.resolve();
}

function ok(cond, msg) {
  if (cond) CURRENT.passed += 1;
  else {
    CURRENT.failed += 1;
    CURRENT.errors.push(`ASSERT FALHOU: ${msg}`);
  }
}

const {
  analisarTamanhoDeConteudo,
  medirCamposDeTexto,
  LIMITE_TEXTO_PLAUSIVEL,
  LIMITE_TEXTO_ABSURDO,
} = await import(new URL('../dados/src/utils/contentAnomalies.js', import.meta.url).href);
const { analyzeInvisibleMessage, analisarAnomaliasDeConteudo, INDICADORES } = await import(new URL('../dados/src/utils/invisibleAnalyzer.js', import.meta.url).href);
const ghost = await import(new URL('../dados/src/utils/ghostDetection.js', import.meta.url).href);

const GRUPO = '120363900000000002@g.us';
const USER = '5599999999999@s.whatsapp.net';
const ALVO = '5511888888888@s.whatsapp.net';

/** O caractere do travazap medido (bloco Sharada — 20 bytes por repeticao). */
const SHARADA = '\u{111C2}\u{111B5}\u{111B4}\u{111BF}\u{111BF}';

function montar(content) {
  return generateWAMessageFromContent(GRUPO, content, { userJid: USER });
}

function infoDe(message) {
  return {
    key: { remoteJid: GRUPO, fromMe: false, id: 'M1', participant: ALVO },
    message,
    messageTimestamp: Math.floor(Date.now() / 1000),
    content: message,
  };
}

function analisar(content) {
  const m = montar(content);
  return analyzeInvisibleMessage(infoDe(m.message));
}

const ids = (a) => (a.indicators || []).map((i) => i.id);

// ============================================================================
// 1) O DETECTOR DE TAMANHO (modulo puro)
// ============================================================================

await test('analisarTamanhoDeConteudo: mede os campos de texto do tipo', () => {
  const r = analisarTamanhoDeConteudo({
    locationMessage: { name: 'x'.repeat(5000), address: 'y'.repeat(3000) },
  });
  ok(r.disponivel === true, 'disponivel');
  ok(r.campos.length === 2, `2 campos medidos (${r.campos.length})`);
  ok(r.maior?.tamanho === 5000, `maior = ${r.maior?.tamanho}`);
  ok(r.suspeitos.length === 2, 'os dois acima do plausivel');
});

await test('analisarTamanhoDeConteudo: distingue plausivel de absurdo', () => {
  const limite = analisarTamanhoDeConteudo({ conversation: 'a'.repeat(LIMITE_TEXTO_PLAUSIVEL) });
  ok(limite.suspeitos.length === 0, 'no limite ainda e plausivel');

  const acima = analisarTamanhoDeConteudo({ conversation: 'a'.repeat(LIMITE_TEXTO_PLAUSIVEL + 1) });
  ok(acima.suspeitos.length === 1, 'acima do limite e suspeito');
  ok(acima.absurdos.length === 0, 'mas ainda nao e absurdo');

  const absurdo = analisarTamanhoDeConteudo({ conversation: 'a'.repeat(LIMITE_TEXTO_ABSURDO + 1) });
  ok(absurdo.absurdos.length === 1, 'acima do absurdo');
});

await test('medirCamposDeTexto: desce wrappers e listas', () => {
  const campos = medirCamposDeTexto({
    viewOnceMessage: { message: { locationMessage: { name: 'z'.repeat(4000) } } },
  });
  ok(campos.length === 1, `achou dentro do viewOnce (${campos.length})`);
  ok(campos[0].caminho.includes('locationMessage'), `caminho: ${campos[0].caminho}`);

  const comLista = medirCamposDeTexto({
    pollCreationMessageV3: { name: 'pergunta?', options: [{ optionName: 'a'.repeat(3000) }] },
  });
  ok(comLista.some((c) => c.tamanho === 3000), 'mede item de lista (opcao de enquete)');
});

// ============================================================================
// 2) INV-026 — O TRAVAZAP (o mais importante)
// ============================================================================

await test('INV-026: travazap por locationMessage (nome/endereco gigantes)', () => {
  const a = analisar({
    viewOnceMessage: {
      message: {
        locationMessage: {
          name: '\u0000' + SHARADA.repeat(3000),
          address: '\u0000' + SHARADA.repeat(2000),
        },
      },
    },
  });
  ok(ids(a).includes('INV-026'), `dispara INV-026 (tem: ${ids(a).join(',') || 'nenhum'})`);
  ok(a.detected === true, 'detected = true');
  ok(INDICADORES.INV_026.peso >= 5, `peso alto (${INDICADORES.INV_026.peso})`);
});

await test('INV-026: travazap por extendedTextMessage (texto de 1.2MB)', () => {
  const a = analisar({
    viewOnceMessage: { message: { extendedTextMessage: { text: '. ' + SHARADA.repeat(30000) } } },
  });
  ok(ids(a).includes('INV-026'), `dispara INV-026 (tem: ${ids(a).join(',')})`);
  ok(a.detected === true, 'detected = true');
});

// ============================================================================
// 3) INV-025 — TEXTO EM CAMPO DE ID
// ============================================================================

await test('INV-025: texto em key.id (decline / cancel)', () => {
  for (const tipo of ['declinePaymentRequestMessage', 'cancelPaymentRequestMessage']) {
    const a = analisar({ [tipo]: { key: { id: 'TEXTO ESCONDIDO AQUI', remoteJid: '', fromMe: false } } });
    ok(ids(a).includes('INV-025'), `${tipo}: dispara INV-025 (tem: ${ids(a).join(',') || 'nenhum'})`);
    ok(a.detected === true, `${tipo}: detected = true`);
  }
});

await test('INV-025: id normal NAO dispara', () => {
  const a = analisar({
    extendedTextMessage: { text: 'oi', contextInfo: { stanzaId: '3EB0A9C9AFB76E7451EA1D' } },
  });
  ok(!ids(a).includes('INV-025'), `id hex de 22 chars nao e suspeito (tem: ${ids(a).join(',') || 'nenhum'})`);
});

// ============================================================================
// 4) INV-027 — TIPO DE CONTROLE COM PAYLOAD
// ============================================================================

await test('INV-027: keepInChat e placeholder carregando conteudo', () => {
  const a1 = analisar({ keepInChatMessage: { key: { id: 'ABC' }, keepType: 1, timestampMs: 1 } });
  ok(ids(a1).includes('INV-027'), `keepInChat (tem: ${ids(a1).join(',') || 'nenhum'})`);

  const a2 = analisar({ placeholderMessage: {} });
  ok(ids(a2).includes('INV-027'), `placeholder (tem: ${ids(a2).join(',') || 'nenhum'})`);
});

// ============================================================================
// 5) FALSO POSITIVO — o risco real
// ============================================================================

await test('NENHUM dos novos indicadores dispara em mensagem normal', () => {
  const normais = {
    'texto curto': { conversation: 'oi, tudo bem?' },
    'legenda de imagem 300': { imageMessage: { caption: 'a'.repeat(300), mimetype: 'image/jpeg' } },
    'texto longo mas plausivel (1500)': { extendedTextMessage: { text: 'a'.repeat(1500) } },
    'legenda de video 2000': { videoMessage: { caption: 'b'.repeat(2000), mimetype: 'video/mp4' } },
    'enquete normal': {
      pollCreationMessageV3: { name: 'Qual prefere?', options: [{ optionName: 'a' }, { optionName: 'b' }], selectableOptionsCount: 1 },
    },
    'localizacao normal': { locationMessage: { name: 'Padaria do Zé', address: 'Rua das Flores, 123' } },
    'contato normal': { contactMessage: { displayName: 'Fulano de Tal' } },
  };

  for (const [nome, content] of Object.entries(normais)) {
    const a = analisar(content);
    const novos = ids(a).filter((i) => ['INV-025', 'INV-026', 'INV-027'].includes(i));
    ok(novos.length === 0, `${nome}: nenhum indicador novo (tem: ${novos.join(',') || 'nenhum'})`);
    ok(a.detected === false, `${nome}: detected = false`);
  }
});

await test('legenda no limite NAO e tratada como anomalia', () => {
  const a = analisar({ imageMessage: { caption: 'a'.repeat(LIMITE_TEXTO_PLAUSIVEL), mimetype: 'image/jpeg' } });
  ok(!ids(a).includes('INV-026'), 'no limite ainda e plausivel');
});

// ============================================================================
// 6) O PONTUADOR
// ============================================================================

await test('ghostDetection: travazap pontua alto; normal nao pontua', () => {
  const travazap = ghost.avaliar({ textoTamanhoAbsurdo: true });
  ok(travazap.score >= 5, `travazap: score ${travazap.score}`);
  ok(travazap.decisao !== 'ignorar', `travazap: ${travazap.decisao}`);

  const idTexto = ghost.avaliar({ textoEmCampoDeId: true });
  ok(idTexto.score === 3, `texto em id: score ${idTexto.score}`);
  ok(idTexto.decisao === 'observar', `texto em id: ${idTexto.decisao}`);

  const normal = ghost.avaliar({ maiorCampoDeTexto: 300 });
  ok(normal.score === 0, `normal: score ${normal.score}`);
  ok(normal.decisao === 'ignorar', `normal: ${normal.decisao}`);
});

await test('ghostDetection: o limiar de tamanho tambem vale pelo campo cru', () => {
  const grande = ghost.avaliar({ maiorCampoDeTexto: LIMITE_TEXTO_ABSURDO + 1 });
  ok(grande.contribuicoes.textoTamanhoAbsurdo === 5, 'campo cru acima do limite soma');

  const pequeno = ghost.avaliar({ maiorCampoDeTexto: LIMITE_TEXTO_ABSURDO - 1 });
  ok(pequeno.contribuicoes.textoTamanhoAbsurdo === undefined, 'abaixo do limite nao soma');
});

// ============================================================================
// 7) REGRESSÃO — o que já era detectado continua
// ============================================================================

await test('regressao: o raja continua detectado', () => {
  const a = analisar({
    sendPaymentMessage: {
      noteMessage: { extendedTextMessage: { text: '. \u200b\u200b\u200b' } },
      transactionData: 'x',
    },
  });
  ok(ids(a).includes('INV-023'), `mantem INV-023 (tem: ${ids(a).join(',')})`);
  ok(a.detected === true, 'continua detectado');
});

await test('regressao: pagamento legitimo continua limpo', () => {
  const a = analisar({
    requestPaymentMessage: {
      currencyCodeIso4217: 'BRL', amount1000: '1500', expiryStamp: '0', expiryTimestamp: '0',
      amount: { value: '1500', offset: 1000, currencyCode: 'BRL' },
      noteMessage: { extendedTextMessage: { text: 'Pagar o aluguel' } },
    },
  });
  ok(a.detected === false, 'nao detectado');
});

// ============================================================================

const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log('\n════════════════════════════════════════');
console.log(`RESULTADO: ${RESULTS.length} testes | ${totalOk} asserções ok | ${totalFail} falhas`);
console.log('════════════════════════════════════════');

fs.rmSync(TMP_DB, { recursive: true, force: true });

if (totalFail > 0) {
  console.log('\nFALHAS:');
  for (const r of RESULTS) if (r.failed) for (const e of r.errors) console.log(`- [${r.name}] ${e}`);
  process.exit(1);
}
console.log('✅ TODOS OS TESTES PASSARAM');
process.exit(0);
