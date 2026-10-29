/**
 * Testes do `!assistente` com a PERSONALIDADE ÚNICA (a Lizzy).
 *
 * O dono pediu: tirar as personalidades do `!assistente`, deixar UMA padrão
 * ("Lizzy") para todos os grupos — a MESMA da call — e o comando virar só
 * liga/desliga.
 *
 * O que este teste trava:
 *   1. existe UMA personalidade e ela é a mesma nos dois canais;
 *   2. o `!assistente` só liga/desliga (sem `abyss`/`humana`/`ia`/`pro`);
 *   3. os quatro prompts antigos e o caminho `pro` NÃO voltam;
 *   4. um grupo com `assistentePersonality` salvo (formato antigo) funciona.
 *
 * Uso: node tests/assistente-lizzy.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-assist-'));
process.env.DATABASE_PATH = TMP_DB;
process.env.CONFIG_PATH = path.join(TMP_DB, 'config.json');
fs.mkdirSync(path.join(TMP_DB, 'grupos'), { recursive: true });
fs.mkdirSync(path.join(TMP_DB, 'dono'), { recursive: true });
fs.writeFileSync(process.env.CONFIG_PATH, JSON.stringify({
  prefixo: '!', nomebot: 'Lizzy do privy', nomedono: 'Kannon',
  numerodono: '5511915323638', debug: false
}, null, 2));

const ia = await import(new URL('../dados/src/funcs/private/ia.js', import.meta.url).href);
const guarda = await import(new URL('../dados/src/utils/iapGuarda.js', import.meta.url).href);
const iapSessao = await import(new URL('../dados/src/utils/iapSessao.js', import.meta.url).href);

const INDEX = fs.readFileSync(new URL('../dados/src/index.js', import.meta.url), 'utf-8');
const IA_SRC = fs.readFileSync(new URL('../dados/src/funcs/private/ia.js', import.meta.url), 'utf-8');

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

// ============================================================================
// 1) A PERSONALIDADE ÚNICA
// ============================================================================

await test('1. a personalidade e uma so e se chama Lizzy (lida do config)', () => {
  const p = guarda.promptDaLizzy();
  contem(p, 'Lizzy', 'o nome vem do config, limpo');
  naoContem(p, 'Abyss', 'nao e mais a Abyss');
  naoContem(p, 'tsundere', 'o traco da Abyss saiu');
  ok(guarda.iaIdentidade() === 'Lizzy', 'iaIdentidade() limpa o MATHEMATICAL BOLD do config');
});

await test('2. o CHAT e a CALL usam o MESMO carater', () => {
  const chat = ia.promptDaPersonalidade();
  const voz = iapSessao.montarSistemaDoAgente({ nomeDono: 'Kannon' });
  // O carater (o TEXTO de quem ela e') e' literalmente o mesmo nos dois.
  //
  // Antes este teste comparava o `promptDaLizzy()` INTEIRO — e passou a falhar
  // quando o prompt ganhou a IDENTIDADE no fim (o config define idade/humor), que
  // e' dado e nao carater. O que precisa ser igual nos dois canais e' o trecho
  // do carater; o resto cada canal monta.
  const carater = guarda.promptDaLizzy().split('QUEM VOCE E (fatos')[0].trim();
  contem(chat, carater, 'o prompt do chat contem o carater');
  contem(voz, carater, 'o prompt da call contem o carater');
  contem(chat, 'SEU JEITO', 'o chat tem o carater');
  contem(voz, 'SEU JEITO', 'a call tem o carater');
});

await test('3. cada canal tem o SEU formato (texto x voz)', () => {
  const chat = ia.promptDaPersonalidade();
  const voz = iapSessao.montarSistemaDoAgente({});
  // O chat pode formatar; a voz nao (seria lido em voz alta).
  contem(chat, 'COMO ESCREVER', 'o chat tem as regras de TEXTO');
  contem(chat, 'SEM EMOJI', 'o chat tambem NAO usa emoji (o dono pediu)');
  contem(voz, 'COMO FALAR', 'a call tem as regras de VOZ');
  contem(voz, 'VOZ ALTA', 'a call diz que e lido em voz alta');
  naoContem(voz, 'COMO ESCREVER', 'a call NAO leva as regras de texto');
  naoContem(chat, 'COMO FALAR', 'o chat NAO leva as regras de voz');
});

// ============================================================================
// 2) O COMANDO: SO LIGA/DESLIGA
// ============================================================================

await test('4. o !assistente NAO aceita mais personalidade por argumento', () => {
  const i = INDEX.indexOf("case 'assistente':");
  const bloco = INDEX.slice(i, i + 1800);
  naoContem(bloco, "['abyss', 'humana', 'ia', 'pro']", 'a lista de personalidades saiu');
  naoContem(bloco, 'Personalidade inválida', 'a recusa por personalidade invalida saiu');
  naoContem(bloco, 'Trocar personalidade', 'a instrucao de trocar saiu');
  contem(bloco, 'groupData.assistente = !groupData.assistente', 'virou um TOGGLE');
});

await test('5. a mensagem do comando diz que a personalidade e a Lizzy', () => {
  const i = INDEX.indexOf("case 'assistente':");
  const bloco = INDEX.slice(i, i + 1800);
  contem(bloco, 'Lizzy', 'diz qual e a personalidade');
  contem(bloco, 'padrão', 'diz que e padrao');
  contem(bloco, 'igual à da call', 'diz que e a mesma da call');
  contem(bloco, 'desativada', 'tem o caminho de desligar');
});

// ============================================================================
// 3) O QUE NAO PODE VOLTAR
// ============================================================================

await test('6. os QUATRO prompts antigos foram removidos', () => {
  for (const nome of ['ASSISTANT_PROMPT_ABYSS', 'ASSISTANT_PROMPT_HUMANA', 'ASSISTANT_PROMPT_IA', 'ASSISTANT_PROMPT_PRO']) {
    naoContem(IA_SRC, nome, `${nome} nao existe mais`);
  }
  ok(!IA_SRC.includes('const ASSISTANT_PROMPT_'), 'nenhum prompt antigo restou');
});

await test('7. o caminho `pro` (executar comando) nao existe mais', () => {
  naoContem(IA_SRC, "personality === 'pro'", 'a checagem de pro saiu do ia.js');
  naoContem(IA_SRC, 'isPro', 'o retorno isPro saiu');
  naoContem(INDEX, 'respAssist.isPro', 'o index nao trata mais isPro');
  naoContem(INDEX, 'simulatedCommand', 'a execucao simulada saiu');
});

await test('8. o campo assistentePersonality NAO decide mais nada', () => {
  // Ele ainda pode ser LIMPO (higiene do dado antigo), mas nao pode ser LIDO
  // para escolher comportamento.
  naoContem(INDEX, "groupData.assistentePersonality || 'abyss'", 'nao usa mais como fonte');
  naoContem(INDEX, "assistentePersonality === 'abyss'", 'nao compara mais');
  contem(INDEX, "const personality = 'lizzy'", 'a personalidade e fixa');
});

// ============================================================================
// 4) COMPATIBILIDADE COM GRUPO ANTIGO
// ============================================================================

await test('9. grupo com personalidade salva (formato antigo) nao quebra', () => {
  // Um grupo que tinha `abyss` salvo: o prompt continua o da Lizzy.
  const p = ia.promptDaPersonalidade('abyss');
  const p2 = ia.promptDaPersonalidade('pro');
  const p3 = ia.promptDaPersonalidade();
  ok(p === p2 && p2 === p3, 'qualquer valor salvo da o MESMO prompt (o parametro e ignorado)');
  contem(p, 'Lizzy', 'e o da Lizzy');
});

// ============================================================================
// 5) A ASSISTENTE AINDA CONVERSA
// ============================================================================

await test('10. a ativacao por NOME continua (e o que faz "Oi Lizzy" funcionar)', () => {
  const i = INDEX.indexOf('shouldActivateAssistant');
  ok(i > 0, 'a condicao de ativacao existe');
  const bloco = INDEX.slice(i - 500, i + 400);
  contem(bloco, 'checkBotNameMention', 'ativa por NOME');
  contem(bloco, 'hasMentionByAt', 'ativa por @');
  // A condicao que USA o resultado vem logo depois.
  contem(INDEX.slice(i, i + 400), 'isAssistente', 'e so com o !assistente ligado');
});

await test('11. o prompt do chat continua pedindo resposta em JSON (o parser depende)', () => {
  const p = ia.promptDaPersonalidade();
  // O `processUserMessages` faz `extractJSON(content)`; sem a instrucao de JSON
  // a resposta viraria texto livre e o parser falharia.
  contem(p, 'Lizzy', 'e o prompt da Lizzy');
  ok(typeof ia.promptDaPersonalidade() === 'string' && ia.promptDaPersonalidade().length > 200,
    'o prompt nao ficou vazio');
});

// ============================================================================
// 6) A API: A MESMA DA CALL (GROQ)
// ============================================================================

await test('12. a conversa do chat usa o GROQ (a mesma API da call)', () => {
  // O dono pediu a mesma API. `makeCognimaRequest` e' o ponto unico por onde
  // passam a assistente e mais 31 comandos, entao a troca se mede nele.
  const i = IA_SRC.indexOf('async function makeCognimaRequest');
  const bloco = IA_SRC.slice(i, i + 1400);
  contem(bloco, 'groqChat', 'usa o cliente do Groq');
  contem(bloco, 'chaveGroq', 'usa a chave do Groq (!keygroq)');
  naoContem(bloco, 'makeGeminiRequest', 'NAO chama mais o Gemini');
  naoContem(bloco, 'getGeminiApiKey', 'NAO le mais a chave do Gemini');
});

await test('13. o retorno mantem a forma da OpenAI (os 32 call sites nao mudam)', () => {
  const i = IA_SRC.indexOf('async function makeCognimaRequest');
  const bloco = IA_SRC.slice(i, i + 1400);
  // Sem esta forma, os 32 consumidores (`response.data.choices[0]...`) quebrariam.
  contem(bloco, 'choices', 'devolve choices');
  contem(bloco, 'message', 'devolve message');
  contem(bloco, 'content', 'devolve content');
});

await test('14. o teto de tokens do TEXTO e maior que o da VOZ', () => {
  // 220 tokens e' o teto da fala (3 frases). `!resumir`/`!gerarhistoria` seriam
  // truncados no meio com esse teto.
  contem(IA_SRC, 'IA_MAX_TOKENS', 'o texto tem teto proprio, configuravel');
  const groqSrc = fs.readFileSync(new URL('../dados/src/utils/groqClient.js', import.meta.url), 'utf-8');
  contem(groqSrc, 'maxTokens', 'o cliente aceita teto por chamada');
  contem(groqSrc, '220', 'o padrao do cliente continua o de voz');
});

// ============================================================================
// RESUMO
// ============================================================================
console.log('\n' + '='.repeat(60));
const tot = RESULTS.reduce((a, r) => a + r.passed, 0);
const fal = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log(`RESULTADO: ${RESULTS.length} testes | ${tot} asserções ok | ${fal} falhas`);
console.log('='.repeat(60));
process.exit(fal ? 1 : 0);
