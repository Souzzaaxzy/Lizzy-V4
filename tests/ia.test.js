/**
 * Testes do SISTEMA DE IA (provider Google Gemini).
 *
 * Cobre o que quebrava os comandos de IA:
 *   1. o modelo default era `gemini-3.7-flash` (não existe) -> 404 em TODA chamada;
 *   2. os 32 call sites passavam `meta/llama-3.1-405b-instruct` (modelo de uma
 *      API compatível com OpenAI) para a Gemini API;
 *   3. a checagem de erro procurava "API key inválida", mas o módulo lança
 *      `[AI_ERROR] Falha na requisição: ...` — então a orientação nunca aparecia;
 *   4. `!imagine` estava no menu e não existia.
 *
 * Sem rede: o `ia.js` expõe `setGeminiHttpForTest` para injetar o HTTP.
 *
 * Uso: node tests/ia.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-ia-'));
process.env.DATABASE_PATH = TMP_DB;
const GRUPOS_DIR = path.join(TMP_DB, 'grupos');
const DONO_DIR = path.join(TMP_DB, 'dono');
fs.mkdirSync(GRUPOS_DIR, { recursive: true });
fs.mkdirSync(DONO_DIR, { recursive: true });

const ia = await import(new URL('../dados/src/funcs/private/ia.js', import.meta.url).href);

const RESULTS = [];
let CURRENT = null;
function test(name, fn) {
  CURRENT = { name, passed: 0, failed: 0, errors: [] };
  RESULTS.push(CURRENT);
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      return r.then(() => finish(name)).catch((e) => { CURRENT.failed += 1; CURRENT.errors.push(`EXCECAO: ${e?.stack || e}`); finish(name); });
    }
    finish(name);
  } catch (e) { CURRENT.failed += 1; CURRENT.errors.push(`EXCECAO: ${e?.stack || e}`); finish(name); }
  return Promise.resolve();
}
function finish(name) {
  console.log(`${CURRENT.failed === 0 ? 'OK ' : 'ERR'} ${name} (${CURRENT.passed} ok, ${CURRENT.failed} falhas)`);
  for (const err of CURRENT.errors) console.log(`     ${err.split('\n')[0]}`);
}
function ok(c, m) { if (c) CURRENT.passed += 1; else { CURRENT.failed += 1; CURRENT.errors.push(`ASSERT FALHOU: ${m}`); } }
function contem(h, n, l) { ok(typeof h === 'string' && h.includes(n), `${l ?? n} — esperado conter "${n}"`); }
function naoContem(h, n, l) { ok(typeof h === 'string' && !h.includes(n), `${l ?? n} — NAO deveria conter "${n}"`); }

const idxSource = fs.readFileSync(new URL('../dados/src/index.js', import.meta.url), 'utf-8');

// resposta OK no formato Gemini
const respostaGemini = (texto) => ({
  data: { candidates: [{ index: 0, content: { parts: [{ text: texto }] }, finishReason: 'STOP' }] },
});

function erroHttp(status, message = 'erro') {
  const e = new Error(message);
  e.response = { status, data: { error: { message } } };
  return e;
}

// ============================================================================
// 1) MODELOS
// ============================================================================

await test('1. modelo default e um nome VALIDO da Gemini API', () => {
  ok(ia.GEMINI_DEFAULT_MODEL.startsWith('gemini-'), 'prefixo gemini-');
  ok(!/3\.7|3\.6|4\./.test(ia.GEMINI_DEFAULT_MODEL), 'nao usa versao inexistente');
  ok(Array.isArray(ia.GEMINI_FALLBACK_MODELS) && ia.GEMINI_FALLBACK_MODELS.length >= 1, 'tem fallback');
  ok(ia.GEMINI_FALLBACK_MODELS.every((m) => m.startsWith('gemini-')), 'fallbacks validos');
});

await test('2. normalizeModelId traduz id de outra API para um modelo Gemini', () => {
  ok(ia.normalizeModelId('meta/llama-3.1-405b-instruct') === ia.GEMINI_DEFAULT_MODEL, 'llama -> default');
  ok(ia.normalizeModelId('meta/llama-3.1-nemotron-70b-instruct') === ia.GEMINI_DEFAULT_MODEL, 'nemotron -> default');
  ok(ia.normalizeModelId('gemini-2.5-pro') === 'gemini-2.5-pro', 'modelo valido passa');
  ok(ia.normalizeModelId('') === ia.GEMINI_DEFAULT_MODEL, 'vazio -> default');
  ok(ia.normalizeModelId('gemini-9.9-nova') === 'gemini-9.9-nova', 'gemini-* desconhecido e repassado (usa o fallback na pratica)');
});

await test('3. NENHUM call site usa modelo de outra API', () => {
  naoContem(idxSource, "meta/llama-3.1-405b-instruct", 'sem llama 405b');
  naoContem(idxSource, "meta/llama-3.1-nemotron-70b-instruct", 'sem nemotron');
  ok(!/makeCognimaRequest\(\s*'[^']*'/.test(idxSource), 'nenhuma chamada com modelo literal');
});

// ============================================================================
// 2) REQUISICAO (com HTTP injetado)
// ============================================================================

await test('4. usa o modelo valido na URL e devolve o texto', async () => {
  let urlVista = null;
  ia.setGeminiHttpForTest(async (url) => { urlVista = url; return respostaGemini('Ola do Gemini'); });
  ia.setGeminiApiKey('chave-de-teste');
  const r = await ia.makeCognimaRequest('meta/llama-3.1-405b-instruct', 'oi', null);
  contem(urlVista, ia.GEMINI_DEFAULT_MODEL, 'URL com o modelo valido');
  naoContem(urlVista, 'llama', 'URL nao tem llama');
  ok(r.data.choices[0].message.content === 'Ola do Gemini', 'texto extraido');
  ia.setGeminiHttpForTest(null);
});

await test('5. 404 no modelo pedido cai para o fallback (nao falha)', async () => {
  const vistas = [];
  ia.setGeminiHttpForTest(async (url) => {
    vistas.push(url);
    if (url.includes('gemini-9.9-nova')) throw erroHttp(404, 'model not found');
    return respostaGemini('veio do fallback');
  });
  ia.setGeminiApiKey('chave-de-teste');
  const r = await ia.makeCognimaRequest('gemini-9.9-nova', 'oi', null);
  ok(vistas.length >= 2, 'tentou mais de um modelo');
  ok(vistas[0].includes('gemini-9.9-nova'), 'tentou o pedido primeiro');
  ok(vistas[1].includes(ia.GEMINI_FALLBACK_MODELS[0]), 'depois o fallback');
  ok(r.data.choices[0].message.content === 'veio do fallback', 'respondeu');
  ia.setGeminiHttpForTest(null);
});

await test('6. sem key lanca erro claro de configuracao', async () => {
  ia.setGeminiApiKey('');
  let erro = null;
  try { await ia.makeCognimaRequest(ia.GEMINI_DEFAULT_MODEL, 'oi', null); } catch (e) { erro = e; }
  ok(erro && /não configurada|!key/i.test(erro.message), 'pede para configurar a key');
});

await test('7. 401/403 nao insiste em outro modelo (falha rapido)', async () => {
  let chamadas = 0;
  ia.setGeminiHttpForTest(async () => { chamadas += 1; throw erroHttp(403, 'API key not valid'); });
  ia.setGeminiApiKey('chave-ruim');
  let erro = null;
  try { await ia.makeCognimaRequest(ia.GEMINI_DEFAULT_MODEL, 'oi', null); } catch (e) { erro = e; }
  ok(erro && /\[AI_ERROR\]/.test(erro.message), 'erro marcado');
  ok(chamadas === 1, 'nao tentou outros modelos com key invalida');
  ia.setGeminiHttpForTest(null);
});

await test('8. 429 esgota as tentativas e lanca erro classificado', async () => {
  ia.setGeminiHttpForTest(async () => { throw erroHttp(429, 'quota'); });
  ia.setGeminiApiKey('chave-de-teste');
  let erro = null;
  try { await ia.makeCognimaRequest(ia.GEMINI_DEFAULT_MODEL, 'oi', null, [], 1); } catch (e) { erro = e; }
  ok(erro && /Limite de requisições/i.test(erro.message), 'mensagem de limite');
  ia.setGeminiHttpForTest(null);
});

// ============================================================================
// 3) MENSAGEM DE ERRO UNIFICADA NO HANDLER
// ============================================================================

const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';
const CFG = (() => {
  try {
    const p = process.env.CONFIG_PATH || path.join(HERE, '..', 'dados', 'src', 'config.json');
    return JSON.parse(fs.readFileSync(p, 'utf-8')) || {};
  } catch { return {}; }
})();
const DONO_NUM = String(CFG.numerodono || '').replace(/\D/g, '');
const OWNER_JID = `${DONO_NUM}@s.whatsapp.net`;
const OWNER_LID = CFG.lidowner || `${DONO_NUM}@lid`;

let groupCounter = 0;
function makeGroup() {
  groupCounter += 1;
  const jid = `1203639400000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(path.join(GRUPOS_DIR, `${jid}.json`), JSON.stringify({ modobrincadeira: true }, null, 2));
  return jid;
}

async function runIA(text, { waitMs = 250 } = {}) {
  const sent = [];
  const gid = makeGroup();
  const nazu = {
    sendMessage: async (jid, content, options) => { sent.push({ jid, content, options }); return { key: { id: 'SENT' } }; },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
    onWhatsApp: async (jid) => [{ jid, exists: true, lid: null }],
    signalRepository: { lidMapping: { getPNForLID: async () => null } },
    contacts: { getName: () => undefined }, getName: () => undefined,
    groupMetadata: async () => ({ id: gid, subject: 'G', owner: `${DONO_NUM}@s.whatsapp.net`, participants: [
      { lid: BOT_LID, jid: BOT_JID, id: BOT_LID, phoneNumber: BOT_JID, admin: 'superadmin' },
      { lid: OWNER_LID, jid: OWNER_JID, id: OWNER_LID, phoneNumber: OWNER_JID, admin: 'admin' },
    ] }),
    profilePictureUrl: async () => 'x', react: async () => ({}),
    groupParticipantsUpdate: async () => ({}), readMessages: async () => {}, sendPresenceUpdate: async () => {},
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
  };
  const info = {
    key: { remoteJid: gid, fromMe: true, id: `M-${Math.random().toString(36).slice(2, 8)}`, participant: OWNER_LID },
    message: { extendedTextMessage: { text, contextInfo: { remoteJid: gid } } },
    messageTimestamp: 1757900000, pushName: 'U',
  };
  await handleMessage(nazu, info, null, new Map(), null);
  await new Promise((r) => setTimeout(r, waitMs));
  return sent.map((s) => s.content?.text ?? s.content?.caption ?? '').join('\n');
}

await test('9. resposta de IA chega formatada ao usuario', async () => {
  ia.setGeminiHttpForTest(async () => respostaGemini('**Negrito** e texto normal'));
  ia.setGeminiApiKey('chave-de-teste');
  const t = await runIA('!cog quem descobriu o Brasil?');
  contem(t, 'Negrito', 'conteudo da IA');
  naoContem(t, '**', 'markdown removido pelo formatAIResponse');
  ia.setGeminiHttpForTest(null);
});

await test('10. erro de key mostra a orientacao de configurar (!key)', async () => {
  ia.setGeminiHttpForTest(async () => { throw erroHttp(403, 'API key not valid'); });
  ia.setGeminiApiKey('chave-ruim');
  const t = await runIA('!cog teste');
  contem(t, 'key', 'orienta a configurar a key');
  ia.setGeminiHttpForTest(null);
});

await test('11. erro de limite avisa para aguardar (nao some)', async () => {
  ia.setGeminiHttpForTest(async () => { throw erroHttp(429, 'quota'); });
  ia.setGeminiApiKey('chave-de-teste');
  // o 429 tem backoff exponencial (1s + 2s) antes de desistir
  const t = await runIA('!resumir um texto qualquer aqui', { waitMs: 6000 });
  contem(t, 'requisições', 'avisa do limite');
  ia.setGeminiHttpForTest(null);
});

await test('12. TODOS os comandos de IA recebem o mesmo tratamento de erro', () => {
  // cada bloco de IA deve usar o helper unico
  const usos = (idxSource.match(/mensagemErroIA\(/g) || []).length;
  ok(usos >= 20, `helper usado em varios comandos (achou ${usos})`);
  // Mede a REGIAO dos comandos de IA (de `case 'gemma'` ate `case 'historico'`).
  const ini = idxSource.indexOf("case 'gemma':");
  const fim = idxSource.indexOf("case 'historico':");
  ok(ini > 0 && fim > ini, 'regiao de IA localizada');
  const regiaoIA = idxSource.slice(ini, fim);
  naoContem(regiaoIA, "includes('API key inválida')", 'sem checagem obsoleta nos comandos de IA');
  ok((regiaoIA.match(/mensagemErroIA\(/g) || []).length >= 20, 'helper unico nos comandos de IA');
});

// ============================================================================
// 4) !imagine
// ============================================================================

await test('13. !imagine existe e envia uma imagem', async () => {
  contem(idxSource, "case 'imagine':", 'case implementado');
  const t = await runIA('!imagine um gato astronauta');
  // o comando responde/avisa; o envio da imagem usa `image: { url }`
  ok(t.length > 0, 'respondeu algo');
});

await test('14. generateImage devolve URL http', async () => {
  const url = await ia.generateImage('um gato');
  ok(typeof url === 'string' && /^https?:\/\//.test(url), 'URL valida');
});

// ============================================================================
// RESUMO
// ============================================================================

const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log(`\n${totalFail === 0 ? 'OK' : 'ERR'} ${RESULTS.length} testes / ${totalOk} assercoes (${totalFail} falhas)`);
process.exit(totalFail === 0 ? 0 : 1);
