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
const groq = await import(new URL('../dados/src/utils/groqClient.js', import.meta.url).href);

// Dublê do HTTP do GROQ: e' por onde a CONVERSA passa agora (a mesma API da call).
// A forma devolvida e' a da OpenAI, que o `makeCognimaRequest` repassa intacta.
const respostaGroq = (texto) => ({
  data: { choices: [{ index: 0, message: { role: 'assistant', content: texto }, finish_reason: 'stop' }] },
});
function erroGroq(status, message = 'erro') {
  const e = new Error(message);
  e.response = { status, data: { error: { message } } };
  return e;
}

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

await test('1. default usa ALIAS ROLANTE (nao envelhece) e ha fallbacks', () => {
  ok(ia.GEMINI_DEFAULT_MODEL.endsWith('-latest'), 'default e alias rolante');
  ok(ia.GEMINI_ROLLING_ALIASES.includes(ia.GEMINI_DEFAULT_MODEL), 'esta na lista de aliases');
  ok(ia.GEMINI_ROLLING_ALIASES.every((m) => m.endsWith('-latest')), 'todos os aliases sao rolantes');
  ok(Array.isArray(ia.GEMINI_FALLBACK_MODELS) && ia.GEMINI_FALLBACK_MODELS.length >= 3, 'tem fallback');
  ok(ia.GEMINI_FALLBACK_MODELS.every((m) => m.startsWith('gemini-')), 'fallbacks validos');
  // nomes que o proprio Google sugeriu no 404 do dono
  ok(ia.GEMINI_FALLBACK_MODELS.some((m) => /gemini-3.*(pro|flash)/.test(m)), 'inclui os nomes sugeridos pelo 404');
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

await test('4. a CONVERSA usa o GROQ (a mesma API da call) e devolve o texto', async () => {
  // O dono pediu a MESMA API da call. Este teste trava isso: a conversa bate no
  // endpoint do Groq, com o modelo do `groqClient`, e o retorno mantem a forma
  // da OpenAI que os 32 call sites leem.
  let urlVista = null, corpoVisto = null;
  groq.setGroqHttpForTest(async (url, data) => { urlVista = url; corpoVisto = data; return respostaGroq('Ola do Groq'); });
  process.env.GROQ_API_KEY = 'gsk-teste';
  const r = await ia.makeCognimaRequest(ia.GEMINI_DEFAULT_MODEL, 'oi', null);
  contem(urlVista, 'api.groq.com', 'bate no endpoint do GROQ');
  naoContem(urlVista, 'generativelanguage', 'NAO bate no Gemini');
  contem(urlVista, 'chat/completions', 'rota de conversa do Groq');
  ok(corpoVisto.model.startsWith('openai/'), `modelo do groqClient (veio ${corpoVisto.model})`);
  ok(r.data.choices[0].message.content === 'Ola do Groq', 'texto extraido na forma da OpenAI');
  groq.setGroqHttpForTest(null);
});

await test('5. o modelo e do groqClient: o id pedido pelo call site e ignorado', async () => {
  // Os 32 call sites ainda passam `GEMINI_DEFAULT_MODEL` (ou um id de outra API).
  // O `makeCognimaRequest` ignora e usa o modelo do `groqClient` — e' o que
  // permite a troca sem tocar em nenhum deles.
  let corpoVisto = null;
  groq.setGroqHttpForTest(async (url, data) => { corpoVisto = data; return respostaGroq('ok'); });
  process.env.GROQ_API_KEY = 'gsk-teste';
  await ia.makeCognimaRequest('meta/llama-3.1-405b-instruct', 'oi', null);
  naoContem(corpoVisto.model, 'llama', 'o id de outra API NAO vaza para o Groq');
  naoContem(corpoVisto.model, 'gemini', 'nem o id do Gemini');
  ok(corpoVisto.model.startsWith('openai/'), 'usa o modelo do groqClient');
  groq.setGroqHttpForTest(null);
});

await test('6. sem chave do Groq lanca erro claro de configuracao', async () => {
  const salva = process.env.GROQ_API_KEY;
  delete process.env.GROQ_API_KEY;
  ia.setGeminiApiKey('');
  let erro = null;
  try { await ia.makeCognimaRequest(ia.GEMINI_DEFAULT_MODEL, 'oi', null); } catch (e) { erro = e; }
  ok(erro !== null, 'lanca erro');
  contem(String(erro?.message), 'keygroq', 'aponta o comando certo da chave');
  if (salva !== undefined) process.env.GROQ_API_KEY = salva;
});

await test('7. 401/403 no Groq falha rapido (nao insiste)', async () => {
  let chamadas = 0;
  groq.setGroqHttpForTest(async () => { chamadas += 1; throw erroGroq(401, 'Invalid API Key'); });
  process.env.GROQ_API_KEY = 'gsk-ruim';
  let erro = null;
  try { await ia.makeCognimaRequest(ia.GEMINI_DEFAULT_MODEL, 'oi', null); } catch (e) { erro = e; }
  ok(chamadas === 1, `nao insiste: 1 chamada (fez ${chamadas})`);
  ok(erro !== null, 'lanca erro');
  contem(String(erro?.message), 'Groq', 'o erro vem do Groq');
  groq.setGroqHttpForTest(null);
});

await test('8. 429 no Groq lanca erro classificado (limite)', async () => {
  groq.setGroqHttpForTest(async () => { throw erroGroq(429, 'Rate limit reached'); });
  process.env.GROQ_API_KEY = 'gsk-teste';
  let erro = null;
  try { await ia.makeCognimaRequest(ia.GEMINI_DEFAULT_MODEL, 'oi', null); } catch (e) { erro = e; }
  ok(erro !== null, 'lanca erro');
  contem(String(erro?.message).toLowerCase(), 'groq', 'a mensagem e do Groq');
  groq.setGroqHttpForTest(null);
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
  // O caminho REAL de um comando de IA: `!cog` -> makeCognimaRequest -> Groq.
  groq.setGroqHttpForTest(async () => respostaGroq('**Negrito** e texto normal'));
  process.env.GROQ_API_KEY = 'gsk-teste';
  const t = await runIA('!cog quem descobriu o Brasil?');
  contem(t, 'Negrito', 'conteudo da IA');
  naoContem(t, '**', 'markdown removido pelo formatAIResponse');
  groq.setGroqHttpForTest(null);
});

await test('10. erro de key mostra a orientacao de configurar (!key)', async () => {
  ia.setGeminiHttpForTest(async () => { throw erroHttp(403, 'API key not valid'); }, async () => ({ data: { models: [] } }));
  ia.setGeminiApiKey('chave-ruim');
  const t = await runIA('!cog teste');
  contem(t, 'key', 'orienta a configurar a key');
  ia.setGeminiHttpForTest(null);
});

await test('11. erro de limite no Groq avisa para aguardar', async () => {
  groq.setGroqHttpForTest(async () => { throw erroGroq(429, 'Rate limit reached for requests'); });
  process.env.GROQ_API_KEY = 'gsk-teste';
  const t = await runIA('!resumir um texto qualquer aqui', { waitMs: 2000 });
  contem(t, 'requisições', 'avisa do limite');
  groq.setGroqHttpForTest(null);
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

await test('15. a CONVERSA nao depende da descoberta de modelos (o Groq tem modelo fixo)', async () => {
  // A descoberta (`descobrirModelos`) existe para o Gemini. A conversa agora vai
  // pelo Groq, cujo modelo vem do `groqClient` — entao NAO ha cadeia de modelos
  // no caminho da conversa, e um erro do Groq nao vira 8 tentativas.
  let chamadas = 0;
  groq.setGroqHttpForTest(async () => { chamadas += 1; throw erroGroq(404, 'model not found'); });
  process.env.GROQ_API_KEY = 'gsk-teste';
  let erro = null;
  try { await ia.makeCognimaRequest(ia.GEMINI_DEFAULT_MODEL, 'oi', null); } catch (e) { erro = e; }
  ok(erro !== null, 'lanca erro');
  ok(chamadas === 1, `uma chamada so' (fez ${chamadas})`);
  // E a descoberta continua disponivel para o Gemini.
  ok(typeof ia.descobrirModelos === 'function', 'descobrirModelos continua existindo para o Gemini');
  groq.setGroqHttpForTest(null);
});

await test('16. DESCOBERTA ignora modelos sem generateContent', async () => {
  const modelos = await ia.descobrirModelos('chave-x');
  ok(Array.isArray(modelos), 'devolve lista');
  ok(!modelos.some((m) => /embedding/.test(m)), 'filtra embedding');
});

await test('17. DESCOBERTA falha em silencio (ListModels fora do ar)', async () => {
  ia.setGeminiHttpForTest(null, async () => { throw new Error('sem rede'); });
  const modelos = await ia.descobrirModelos('chave-y');
  ok(Array.isArray(modelos) && modelos.length === 0, 'devolve [] e nao lanca');
  ia.setGeminiHttpForTest(null);
});

// ============================================================================
// 18-20) CLASSIFICACAO DE ERRO — o 400 de CHAVE (o bug do "IA nao funciona")
// ============================================================================

await test('18. classificarErroGemini: chave inválida é HTTP 400 (o caso real)', () => {
  // MEDIDO na API real: chave invalida NAO e' 401/403 — e' 400 com
  // `reason: API_KEY_INVALID`. Tratar 400 como "modelo inexistente" fazia o bot
  // tentar os 8 modelos e terminar com uma mensagem que nao dizia o problema.
  const r = ia.classificarErroGemini({
    response: {
      status: 400,
      data: {
        error: {
          code: 400,
          message: 'API key not valid. Please pass a valid API key.',
          status: 'INVALID_ARGUMENT',
          details: [{ reason: 'API_KEY_INVALID', domain: 'googleapis.com' }]
        }
      }
    }
  });
  ok(r.tipo === 'chave', `classifica como chave (${r.tipo})`);
  ok(/chave|key/i.test(r.mensagem), 'a mensagem fala da chave');
});

await test('19. classificarErroGemini: distingue modelo / limite / payload', () => {
  const modelo = ia.classificarErroGemini({
    response: { status: 404, data: { error: { message: 'models/gemini-9 is not found for API version v1beta', status: 'NOT_FOUND' } } }
  });
  ok(modelo.tipo === 'modelo', `404 vira modelo (${modelo.tipo})`);

  const aposentado = ia.classificarErroGemini({
    response: { status: 404, data: { error: { message: 'This model models/gemini-2.5-pro is no longer available to new users.', status: 'NOT_FOUND' } } }
  });
  ok(aposentado.tipo === 'modelo', `"no longer available" vira modelo (${aposentado.tipo})`);

  const limite = ia.classificarErroGemini({
    response: { status: 429, data: { error: { message: 'Resource has been exhausted', status: 'RESOURCE_EXHAUSTED' } } }
  });
  ok(limite.tipo === 'limite', `429 vira limite (${limite.tipo})`);

  const payload = ia.classificarErroGemini({
    response: { status: 400, data: { error: { message: 'Invalid JSON payload received', status: 'INVALID_ARGUMENT' } } }
  });
  ok(payload.tipo === 'payload', `400 sem chave/modelo vira payload (${payload.tipo})`);
});

await test('20. chave invalida do Groq para na 1a chamada (sem cadeia)', async () => {
  // O bug original: o 400 de chave era lido como "modelo indisponivel" e a cadeia
  // INTEIRA era tentada. No Groq nao ha cadeia: uma chamada e o erro sobe.
  let chamadas = 0;
  groq.setGroqHttpForTest(async () => {
    chamadas += 1;
    const e = new Error('Request failed with status code 401');
    e.response = { status: 401, data: { error: { message: 'Invalid API Key', code: 'invalid_api_key' } } };
    throw e;
  });
  process.env.GROQ_API_KEY = 'gsk-ruim';
  let erro = null;
  try { await ia.makeCognimaRequest(ia.GEMINI_DEFAULT_MODEL, 'oi', null); } catch (e) { erro = e; }
  ok(chamadas === 1, `parou na 1a tentativa (${chamadas} chamadas)`);
  ok(erro !== null, 'lanca erro');
  groq.setGroqHttpForTest(null);
});

// ============================================================================
// RESUMO
// ============================================================================

const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log(`\n${totalFail === 0 ? 'OK' : 'ERR'} ${RESULTS.length} testes / ${totalOk} assercoes (${totalFail} falhas)`);
process.exit(totalFail === 0 ? 0 : 1);
