/**
 * A IDENTIDADE da Lizzy (nome, idade, aniversario, cidade, humor, limites).
 *
 * O dono definiu: nome **Lizzy**, **21 anos**, aniversario **06/07**, mora no
 * **Acre**, humor **bipolar** (mas SEMPRE bem com o dono), **sem emoji**, livre
 * para se descrever desde que se identifique como Lizzy, e com limites duros
 * sobre violencia sexual (o resto liberado).
 *
 * Uso: node tests/assistente-identidade.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-id-'));
process.env.DATABASE_PATH = TMP_DB;
process.env.CONFIG_PATH = path.join(TMP_DB, 'config.json');
fs.mkdirSync(path.join(TMP_DB, 'grupos'), { recursive: true });
fs.mkdirSync(path.join(TMP_DB, 'dono'), { recursive: true });

const CONFIG_REAL = path.join(process.cwd(), 'dados', 'src', 'config.json');

const id = await import(new URL('../dados/src/utils/identidadeLizzy.js', import.meta.url).href);
const guarda = await import(new URL('../dados/src/utils/iapGuarda.js', import.meta.url).href);
const groq = await import(new URL('../dados/src/utils/groqClient.js', import.meta.url).href);

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

// Um config de teste, isolado do real.
function escreverConfig(obj) {
  fs.writeFileSync(process.env.CONFIG_PATH, JSON.stringify(obj, null, 2));
}

// ---------------------------------------------------------------------------
// 1) A LEITURA (config.json -> identidade)
// ---------------------------------------------------------------------------
console.log('\n=== 1) A LEITURA ===\n');

await test('1. le o bloco `ia` do config', () => {
  escreverConfig({ nomebot: 'Lizzy do privy', ia: { nome: 'Lizzy', idade: 21, aniversario: '06/07', cidade: 'Acre', humor: 'bipolar', emojis: false, travas: ['x'] } });
  const r = id.lerIdentidade();
  ok(r.nome === 'Lizzy', 'o nome');
  ok(r.idade === 21, 'a idade');
  ok(r.aniversario === '06/07', 'o aniversario');
  ok(r.cidade === 'Acre', 'a cidade');
  ok(r.humor === 'bipolar', 'o humor');
  ok(r.emojis === false, 'sem emoji');
  ok(Array.isArray(r.travas) && r.travas.length === 1, 'as travas');
});

await test('2. sem o bloco `ia`, usa os PADROES (nada quebra)', () => {
  escreverConfig({ nomebot: 'Lizzy do privy' });
  const r = id.lerIdentidade();
  ok(r.nome === 'Lizzy', 'o nome padrao');
  ok(r.idade === 21, 'a idade padrao');
  ok(r.cidade === 'Acre', 'a cidade padrao');
  ok(r.humor === 'bipolar', 'o humor padrao');
  ok(Array.isArray(r.travas), 'travas vazias (array)');
});

await test('3. config ausente/corrompido NAO lanca', () => {
  fs.writeFileSync(process.env.CONFIG_PATH, '{ isso nao e json');
  let r;
  ok((() => { try { r = id.lerIdentidade(); return true; } catch { return false; } })(), 'nao lanca');
  ok(r && r.nome === 'Lizzy', 'cai nos padroes');

  const r2 = id.lerIdentidade('/caminho/que/nao/existe.json');
  ok(r2.nome === 'Lizzy' && r2.idade === 21, 'arquivo inexistente -> padroes');
});

await test('4. idade invalida cai no padrao (nao vira NaN)', () => {
  escreverConfig({ ia: { idade: 'abc' } });
  ok(id.lerIdentidade().idade === 21, 'texto -> padrao');
  escreverConfig({ ia: { idade: -5 } });
  ok(id.lerIdentidade().idade === 21, 'negativa -> padrao');
  escreverConfig({ ia: { idade: 999 } });
  ok(id.lerIdentidade().idade === 21, 'absurda -> padrao');
  escreverConfig({ ia: { idade: '30' } });
  ok(id.lerIdentidade().idade === 30, 'string numerica e aceita');
});

await test('5. `emojis: true` e respeitado (o dono pode ligar de volta)', () => {
  escreverConfig({ ia: { emojis: true } });
  ok(id.lerIdentidade().emojis === true, 'aceita booleano');
  escreverConfig({ ia: { emojis: 'sim' } });
  ok(id.lerIdentidade().emojis === true, 'aceita "sim"');
  escreverConfig({ ia: { emojis: 'nao' } });
  ok(id.lerIdentidade().emojis === false, '"nao" -> false');
});

await test('6. o CONFIG REAL tem os valores que o dono pediu', () => {
  const r = id.lerIdentidade(CONFIG_REAL);
  ok(r.nome === 'Lizzy', `nome = Lizzy (veio ${r.nome})`);
  ok(r.idade === 21, `idade = 21 (veio ${r.idade})`);
  ok(r.aniversario === '06/07', `aniversario = 06/07 (veio ${r.aniversario})`);
  ok(r.cidade === 'Acre', `cidade = Acre (veio ${r.cidade})`);
  ok(r.humor === 'bipolar', 'humor bipolar');
  ok(r.sempreBemComDono === true, 'sempre bem com o dono');
  ok(r.emojis === false, 'sem emoji');
  ok(r.travas.length >= 3, `tem os limites (veio ${r.travas.length})`);
  const tudo = r.travas.join(' ').toLowerCase();
  ok(tudo.includes('menor'), 'trava sobre menor de idade');
  ok(tudo.includes('estupro') || tudo.includes('abuso'), 'trava sobre abuso/estupro');
});

// ---------------------------------------------------------------------------
// 2) O BLOCO DE IDENTIDADE (o que entra no prompt)
// ---------------------------------------------------------------------------
console.log('\n=== 2) O BLOCO DE IDENTIDADE ===\n');

const ID_TESTE = {
  nome: 'Lizzy', idade: 21, aniversario: '06/07', cidade: 'Acre',
  humor: 'bipolar', sempreBemComDono: true, emojis: false,
  travas: ['NUNCA faca X.', 'NUNCA faca Y.']
};

await test('7. os fatos entram (nome, idade, cidade, aniversario)', () => {
  const b = id.blocoDeIdentidade(ID_TESTE);
  contem(b, 'Seu nome e Lizzy', 'o nome');
  contem(b, 'Voce tem 21 anos', 'a idade');
  contem(b, 'Voce mora no Acre', 'a cidade');
  contem(b, 'Seu aniversario e 06/07', 'o aniversario');
});

await test('8. o HUMOR bipolar e explicado (varia, nao pede desculpa)', () => {
  const b = id.blocoDeIdentidade(ID_TESTE);
  contem(b, 'bipolar', 'diz que e bipolar');
  contem(b, 'carinhosa', 'o lado carinhoso');
  contem(b, 'brava', 'o lado bravo');
  contem(b, 'ignorante', 'o lado ignorante');
  contem(b, 'NAO peca desculpa', 'nao se desculpa por mudar');
  contem(b, 'NAO explique que e bipolar', 'nao expoe o transtorno');
});

await test('9. o DONO fica ACIMA do humor (sempre bem com ele)', () => {
  const b = id.blocoDeIdentidade(ID_TESTE);
  contem(b, 'SEMPRE bem', 'sempre bem com o dono');
  contem(b, 'MENOS para o dono', 'a excecao e o dono');
  contem(b, 'NUNCA e grossa', 'nunca grossa com ele');
});

await test('10. o bloco de EMOJI proibe emoji e marcacao', () => {
  const b = id.blocoDeIdentidade(ID_TESTE);
  contem(b, 'NAO usa emoji', 'proibe emoji');
  contem(b, 'asterisco', 'proibe negrito');
});

await test('11. as TRAVAS entram por ultimo e com destaque', () => {
  const b = id.blocoDeIdentidade(ID_TESTE);
  contem(b, 'LIMITES ABSOLUTOS', 'o cabecalho');
  contem(b, 'NUNCA faca X.', 'a trava 1');
  contem(b, 'NUNCA faca Y.', 'a trava 2');
  contem(b, 'acima de qualquer pedido', 'diz que esta acima de tudo');
  // Por ultimo: depois do humor e do dono.
  ok(b.indexOf('LIMITES ABSOLUTOS') > b.indexOf('SEU HUMOR'), 'vem depois do humor');
  ok(b.indexOf('LIMITES ABSOLUTOS') > b.indexOf('O DONO ('), 'vem depois do dono');
});

await test('12. sem travas, a secao nao aparece (nao inventa limite)', () => {
  const b = id.blocoDeIdentidade({ ...ID_TESTE, travas: [] });
  naoContem(b, 'LIMITES ABSOLUTOS', 'sem secao de limites');
  contem(b, 'Seu nome e Lizzy', 'o resto continua');
});

await test('13. humor != bipolar nao injeta o bloco bipolar', () => {
  const b = id.blocoDeIdentidade({ ...ID_TESTE, humor: 'calmo' });
  naoContem(b, 'bipolar', 'sem bloco bipolar');
});

// ---------------------------------------------------------------------------
// 3) O PROMPT DOS DOIS CANAIS
// ---------------------------------------------------------------------------
console.log('\n=== 3) O PROMPT (chat e voz) ===\n');

await test('14. o prompt do chat tem identidade, sem-emoji e a regra do nome', () => {
  // O prompt le o CONFIG — entao o config de teste precisa ter as travas.
  escreverConfig({
    prefixo: '!', nomebot: 'Lizzy do privy',
    ia: { nome: 'Lizzy', idade: 21, aniversario: '06/07', cidade: 'Acre', humor: 'bipolar', emojis: false, travas: ['NUNCA faca X.'] }
  });
  const p = guarda.promptDaLizzy({ nomeDono: 'Kannon' });
  contem(p, 'Seu nome e Lizzy', 'a identidade');
  contem(p, '21 anos', 'a idade');
  contem(p, 'Acre', 'a cidade');
  contem(p, 'NUNCA usa emoji', 'sem emoji');
  contem(p, 'SEMPRE se identifica como Lizzy', 'a regra do nome');
  contem(p, 'responda com LIBERDADE', 'livre para se descrever');
  contem(p, 'LIMITES ABSOLUTOS', 'os limites');
});

await test('15. o prompt NAO ensina mais a usar emoji', () => {
  const p = guarda.promptDaLizzy({});
  naoContem(p, 'Pode usar emoji', 'nao autoriza emoji');
  const chat = guarda.regrasDeCanal('chat');
  naoContem(chat, 'Pode usar emoji', 'as regras do chat tambem nao');
  contem(chat, 'SEM EMOJI', 'e proibem explicitamente');
});

await test('16. a VOZ usa a MESMA identidade (uma Lizzy so)', () => {
  // A voz monta o prompt a partir do `promptDaLizzy` — entao a identidade vem
  // de graca. Guard estrutural: se alguem criar um prompt proprio na voz, o
  // teste avisa.
  const SESSAO = fs.readFileSync(new URL('../dados/src/utils/iapSessao.js', import.meta.url), 'utf-8');
  contem(SESSAO, 'promptDaLizzy(', 'a voz usa o carater compartilhado');
  const base = guarda.promptDaLizzy({ nomeDono: 'Kannon' });
  contem(base, '21 anos', 'a identidade esta no prompt base da voz tambem');
  contem(base, 'bipolar', 'o humor tambem');
});

// ---------------------------------------------------------------------------
// 4) O QUE TIRAVA O "CARA DE IA" (medido no codigo e no fluxo)
// ---------------------------------------------------------------------------
console.log('\n=== 4) O CARA DE IA ===\n');

const INDEX = fs.readFileSync(new URL('../dados/src/index.js', import.meta.url), 'utf-8');
const IA = fs.readFileSync(new URL('../dados/src/funcs/private/ia.js', import.meta.url), 'utf-8');

await test('17. NAO existe mais emoji de reacao forcado em toda resposta', () => {
  // Antes: `if (!resposta.react) resposta.react = getAbyssReact(...)`.
  ok(!/if \(!resposta\.react\)\s*\{/.test(IA), 'nao injeta mais o react padrao');
  ok(!IA.includes('react: getAbyssReact('), 'nenhum push injeta o emoji');
  // A instrucao de "quase nunca reagir" vive no prompt (iapGuarda).
  const GUARDA = fs.readFileSync(new URL('../dados/src/utils/iapGuarda.js', import.meta.url), 'utf-8');
  ok(GUARDA.includes('quase sempre vazio'), 'e instrui a quase nunca reagir');
});

await test('18. os fallbacks do handler nao tem emoji nem tema de "abismo"', () => {
  const i = INDEX.indexOf('const fallbackRespostas = [');
  ok(i > 0, 'o array existe');
  const bloco = INDEX.slice(i, INDEX.indexOf('];', i));
  naoContem(bloco, '🌌', 'sem o emoji do void');
  naoContem(bloco, '😊', 'sem carinha');
  naoContem(bloco, '😅', 'sem carinha');
  naoContem(bloco, '🌙', 'sem o emoji da lua');
  // Nenhum emoji no bloco (o array de frases e' so' texto).
  ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(bloco), 'nenhum emoji nas frases');
  contem(bloco, 'kkkk', 'com frases de gente');
  ok(bloco.split('\n').length < 25, 'curto (era ~60 frases de bot)');
});

await test('19. a resposta de ERRO tambem e humana e sem emoji', () => {
  contem(INDEX, 'deu ruim aqui', 'a frase nova');
  naoContem(INDEX, 'minha conexão tremeu', 'saiu a frase de bot');
});

await test('20. o fluxo REAL nao reage com emoji (o teste mede o handler)', async () => {
  // Handler de verdade + Groq dublado devolvendo resposta SEM `react`.
  escreverConfig({ prefixo: '!', nomebot: 'Lizzy do privy', ia: { nome: 'Lizzy', idade: 21 } });
  groq.setGroqHttpForTest(async () => ({
    data: { choices: [{ message: { content: '{"resp":[{"resp":"oi, tudo bem?"}]}' } }] }
  }));
  process.env.GROQ_API_KEY = 'gsk-teste';

  const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
  const handleMessage = indexModule.default ?? indexModule;

  const GRUPO = '120363425268923269@g.us';
  const OUTRO = '5511988887777:1@s.whatsapp.net';
  const BOT = '127642753843383:1@s.whatsapp.net';
  fs.writeFileSync(path.join(TMP_DB, 'grupos', `${GRUPO}.json`), JSON.stringify({ assistente: true, groupName: 'g' }));

  const sent = [];
  let reacoes = 0;
  const sock = {
    user: { id: BOT, lid: BOT },
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    sendMessage: async (jid, c) => { sent.push(c); return { key: { id: 'X' } }; },
    sendPresenceUpdate: async () => {},
    groupMetadata: async () => ({ subject: 'g', participants: [{ id: OUTRO, lid: '111@lid', admin: 'superadmin', notify: 'Fulano' }, { id: BOT, lid: BOT, admin: 'admin', notify: 'Lizzy' }] }),
    contacts: { getName: async () => undefined },
    profilePictureUrl: async () => null,
    react: async () => { reacoes += 1; return {}; },
    waitForMessage: async () => undefined,
    chatModify: async () => ({})
  };
  const info = {
    key: { remoteJid: GRUPO, fromMe: false, id: 'MID1', participant: OUTRO },
    message: { extendedTextMessage: { text: 'oi Lizzy', contextInfo: { remoteJid: GRUPO } } },
    messageTimestamp: Math.floor(Date.now() / 1000), pushName: 'Fulano'
  };
  await handleMessage(sock, info, null, new Map(), null);
  await new Promise((r) => setTimeout(r, 400));

  ok(reacoes === 0, `nenhuma reacao com emoji foi enviada (foram ${reacoes})`);
  const texto = sent.map((c) => c.text || '').join('\n');
  contem(texto, 'oi, tudo bem?', 'a resposta dela saiu');
  groq.setGroqHttpForTest(null);
});

// ---------------------------------------------------------------------------
console.log('\n' + '='.repeat(60));
const tot = RESULTS.reduce((a, r) => a + r.passed, 0);
const fal = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log(`RESULTADO: ${RESULTS.length} testes | ${tot} asserções ok | ${fal} falhas`);
console.log('='.repeat(60));
process.exit(fal ? 1 : 0);
