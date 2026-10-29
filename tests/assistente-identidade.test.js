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
  ok(r.humor === 'amigavel', `o humor padrao (veio ${r.humor})`);
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
  ok(r.humor === 'amigavel', `humor amigavel (veio ${r.humor})`);
  ok(r.jeitoAdolescente === true, 'jeito de adolescente ligado');
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
  humor: 'amigavel', sempreBemComDono: true, emojis: false, jeitoAdolescente: true,
  travas: ['NUNCA faca X.', 'NUNCA faca Y.'],
  esporte: 'vôlei', orientacao: 'bissexual', safadeza: true, conversaAdulto: true,
  adotada: true,
  paisAdotivos: [
    { papel: 'pai', lid: '237@lid', nome: 'Kannon' },
    { papel: 'mae', lid: '184@lid', nome: 'Maria' }
  ]
};

await test('7. os fatos entram (nome, idade, cidade, aniversario)', () => {
  const b = id.blocoDeIdentidade(ID_TESTE);
  contem(b, 'Seu nome e Lizzy', 'o nome');
  contem(b, 'Voce tem 21 anos', 'a idade');
  contem(b, 'Voce mora no Acre', 'a cidade');
  contem(b, 'Seu aniversario e 06/07', 'o aniversario');
});

await test('8. o HUMOR e amigavel SEMPRE (a bipolaridade saiu)', () => {
  const b = id.blocoDeIdentidade(ID_TESTE);
  contem(b, 'SEU HUMOR', 'a secao de humor');
  contem(b, 'amigavel, meiga, carinhosa e brincalhona', 'o humor novo');
  contem(b, 'SEMPRE', 'sem dia de estar seca');
  contem(b, 'Nao existe dia de estar seca ou grossa', 'explicito');
  contem(b, 'acolhe de verdade', 'acolhe quem esta mal');
  // A bipolaridade NAO pode voltar.
  naoContem(b, 'bipolar', 'sem bipolaridade');
  naoContem(b, 'brava, seca, ignorante', 'sem o humor ruim');
  naoContem(b, 'mau humor', 'sem mau humor');
});

await test('8b. o jeito de ADOLESCENTE entra (letra esticada, giria, espelhar o tom)', () => {
  const b = id.blocoDeIdentidade(ID_TESTE);
  contem(b, 'adolescente', 'diz que e adolescente');
  contem(b, 'ESTICA as letras', 'estica as letras');
  contem(b, 'oiiii', 'o exemplo do oi esticado');
  contem(b, 'kkkk', 'a risada');
  contem(b, 'vc', 'abrevia');
  contem(b, 'minusculas', 'escreve em minuscula');
  // O ESPELHAMENTO do tom (o pedido central do dono).
  contem(b, 'ESPELHA a energia', 'espelha o tom');
  contem(b, 'OOOIII LIZZY', 'o exemplo do dono');
  contem(b, 'OIIIIII', 'a resposta do exemplo');
  contem(b, 'maiuscula', 'responde em maiuscula quando a pessoa grita');
  // E CONVERSA, nao so responde.
  contem(b, 'CONVERSA', 'interage');
  contem(b, 'puxa assunto', 'puxa assunto');
  // O caveat da VOZ (letra esticada nao existe falando).
  contem(b, 'CHAMADA de voz', 'avisa que na voz e diferente');
});

await test('9. o DONO tem tratamento especial (sempre bem com ele)', () => {
  const b = id.blocoDeIdentidade(ID_TESTE);
  contem(b, 'O DONO (tratamento especial)', 'a secao do dono');
  contem(b, 'AINDA mais carinhosa', 'mais carinho que com o resto');
  contem(b, 'nunca e grossa, seca nem ignorante com ele', 'nunca grossa com ele');
  contem(b, 'em hipotese nenhuma', 'sem excecao');
  // Nao pode falar de "humor" (nao existe mais variacao).
  naoContem(b, 'piores humores', 'sem o texto antigo');
  naoContem(b, 'variacao de humor', 'sem variacao de humor');
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
  // Por ultimo: depois do humor e do dono. A busca e' pelo CABECALHO da secao
  // (`\nLIMITES ABSOLUTOS (isto esta...`), porque o bloco da safadeza CITA os
  // limites de proposito (e a citacao vem antes).
  const cabecalho = b.indexOf('\nLIMITES ABSOLUTOS (isto esta');
  ok(cabecalho > 0, 'o cabecalho da secao existe');
  ok(cabecalho > b.indexOf('SEU HUMOR'), 'vem depois do humor');
  ok(cabecalho > b.indexOf('O DONO ('), 'vem depois do dono');
});

await test('12. sem travas, a secao nao aparece (nao inventa limite)', () => {
  const b = id.blocoDeIdentidade({ ...ID_TESTE, travas: [] });
  naoContem(b, 'LIMITES ABSOLUTOS', 'sem secao de limites');
  contem(b, 'Seu nome e Lizzy', 'o resto continua');
});

await test('13. humor desconhecido nao injeta bloco de humor', () => {
  const b = id.blocoDeIdentidade({ ...ID_TESTE, humor: 'calmo' });
  naoContem(b, 'SEU HUMOR', 'sem bloco de humor');
  naoContem(b, 'bipolar', 'e nunca bipolar');
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
  contem(base, 'amigavel, meiga, carinhosa', 'o humor tambem');
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
// 5) OS CAMPOS NOVOS: volei, bissexual, safadeza/+18, pais adotivos
// ---------------------------------------------------------------------------
console.log('\n=== 5) VOLEI, BISSEXUAL, SAFADEZA E PAIS ===\n');

await test('21. o CONFIG REAL tem os campos que o dono pediu', () => {
  const r = id.lerIdentidade(CONFIG_REAL);
  ok(r.esporte === 'vôlei', `esporte = volei (veio ${r.esporte})`);
  ok(r.orientacao === 'bissexual', `orientacao (veio ${r.orientacao})`);
  ok(r.safadeza === true, 'safadeza ligada');
  ok(r.conversaAdulto === true, 'conversa +18 ligada');
  ok(r.adotada === true, 'adotada');
  ok(Array.isArray(r.paisAdotivos) && r.paisAdotivos.length === 2, `2 pais (veio ${r.paisAdotivos?.length})`);
  const papeis = r.paisAdotivos.map((p) => p.papel).sort();
  ok(JSON.stringify(papeis) === JSON.stringify(['mae', 'pai']), `papeis pai/mae (veio ${papeis})`);
  ok(r.paisAdotivos.every((p) => p.lid && p.lid.includes('@lid')), 'cada um tem o LID');
});

await test('22. o volei e a bissexualidade entram no prompt', () => {
  const b = id.blocoDeIdentidade(ID_TESTE);
  contem(b, 'JOGADORA DE VÔLEI', 'o volei em destaque');
  contem(b, 'Treina, joga campeonato', 'com rotina de atleta');
  contem(b, 'bissexual', 'a orientacao');
  contem(b, 'gosta de homem e de mulher', 'explica o que e');
});

await test('23. o ar safado e a conversa +18 entram (permissao e limite SEPARADOS)', () => {
  const b = id.blocoDeIdentidade(ID_TESTE);
  contem(b, 'safado', 'o ar safado');
  contem(b, 'flertar', 'ela flerta');
  contem(b, 'fala de sexo', 'fala de sexo sem drama');
  // O CRITICO (contrato NOVO): a permissao e o limite NAO ficam no mesmo
  // paragrafo. Quando ficavam, o modelo lia "quando esquentar, recuse" — era o
  // bug da foto recusada.
  const permissao = b.indexOf('A CONVERSA +18');
  const limite = b.indexOf('O QUE NEM NO +18 VOCE FAZ');
  ok(permissao > 0, 'a secao de permissao existe');
  ok(limite > permissao, 'e o limite vem DEPOIS, em secao propria');
  ok(b.indexOf('LIMITES ABSOLUTOS') > limite, 'as travas do config fecham o prompt');
});

await test('24. o flerte e bissexual (homem E mulher)', () => {
  const b = id.blocoDeIdentidade(ID_TESTE);
  contem(b, 'flerta com homem e com mulher do mesmo jeito', 'o flerte e bissexual');
});

await test('25. os PAIS: nao conhece os biologicos, ama os adotivos pelo NOME', () => {
  const b = id.blocoDeIdentidade(ID_TESTE);
  contem(b, 'SUA FAMILIA', 'a secao');
  contem(b, 'NAO conhece seus pais biologicos', 'nao conhece os biologicos');
  contem(b, 'nao inventa quem sao', 'proibido inventar');
  contem(b, 'ADOTADA', 'foi adotada');
  contem(b, 'pai (Kannon)', 'o pai pelo nome');
  contem(b, 'mae (Maria)', 'a mae pelo nome');
  contem(b, 'Use o NOME deles', 'usa o nome');
});

await test('26. sem o nome resolvido, fala dos pais SEM inventar nome', () => {
  const b = id.blocoDeIdentidade({
    ...ID_TESTE,
    paisAdotivos: [{ papel: 'pai', lid: '237@lid', nome: '' }, { papel: 'mae', lid: '184@lid', nome: '' }]
  });
  contem(b, 'ADOTADA', 'continua adotada');
  naoContem(b, '(Kannon)', 'nao inventa nome de pai');
  naoContem(b, '(Maria)', 'nao inventa nome de mae');
  naoContem(b, '237@lid', 'nunca vaza o LID');
  contem(b, 'Quando souber o nome deles', 'diz que vai usar quando souber');
});

await test('27. `adotada: false` nao injeta a familia', () => {
  const b = id.blocoDeIdentidade({ ...ID_TESTE, adotada: false });
  naoContem(b, 'SUA FAMILIA', 'sem secao de familia');
  naoContem(b, 'ADOTADA', 'nao fala de adocao');
});

// ---------------------------------------------------------------------------
// 6) A RESOLUCAO DO LID -> NOME (o pedido "resolve o lid pro nome do contato")
// ---------------------------------------------------------------------------
console.log('\n=== 6) O LID VIRA NOME ===\n');

const ctx = await import(new URL('../dados/src/utils/contextoConversa.js', import.meta.url).href);

const PAIS_LID = [
  { papel: 'pai', lid: '23734744260711@lid', nome: '' },
  { papel: 'mae', lid: '18408649269356@lid', nome: '' }
];
// O socket devolve o nome do CONTATO pelo numero (e o metadata tem o notify).
const NAZU_PAIS = {
  contacts: {
    getName: async (j) => {
      const s = String(j);
      if (s.includes('23734744260711')) return 'Kannon';
      if (s.includes('18408649269356')) return 'Maria';
      return undefined;
    }
  }
};
const META_PAIS = {
  participants: [
    { id: '5511978819676@s.whatsapp.net', lid: '23734744260711@lid', notify: 'Kannon' },
    { id: '5511966665555@s.whatsapp.net', lid: '18408649269356@lid', notify: 'Maria' }
  ]
};

await test('28. o LID do pai e da mae viram NOME do contato', async () => {
  const r = await ctx.resolverPaisAdotivos({ pais: PAIS_LID, nazu: NAZU_PAIS, metadata: META_PAIS, from: 'g@g.us' });
  ok(r.length === 2, 'os dois pais');
  ok(r[0].nome === 'Kannon', `o pai pelo nome (veio ${r[0].nome})`);
  ok(r[1].nome === 'Maria', `a mae pelo nome (veio ${r[1].nome})`);
  ok(r[0].papel === 'pai' && r[1].papel === 'mae', 'os papeis preservados');
});

await test('29. contato DESCONHECIDO -> sem nome (nunca o LID/numero)', async () => {
  const r = await ctx.resolverPaisAdotivos({
    pais: PAIS_LID,
    nazu: { contacts: { getName: async () => undefined } },
    metadata: { participants: [] },
    from: 'g@g.us'
  });
  ok(r.length === 2, 'os dois entram');
  ok(r.every((p) => p.nome === ''), `nenhum nome inventado (veio ${JSON.stringify(r.map((p) => p.nome))})`);
  // O `lid` continua no objeto (e' o dado do config) — o que NAO pode e' ele
  // virar o campo `nome`.
  ok(r.every((p) => !String(p.nome).includes('@')), 'o nome nunca contem @ (JID/LID)');
  ok(r.every((p) => !/^\d+$/.test(String(p.nome))), 'o nome nunca e o numero cru');
});

await test('30. o nome do CONFIG vence (o dono pode escrever a mao)', async () => {
  const r = await ctx.resolverPaisAdotivos({
    pais: [{ papel: 'mae', lid: '184@lid', nome: 'Mainha' }],
    nazu: NAZU_PAIS, metadata: META_PAIS, from: 'g@g.us'
  });
  ok(r[0].nome === 'Mainha', `respeita o config (veio ${r[0].nome})`);
});

await test('31. sem pais / entrada invalida nao quebra', async () => {
  ok((await ctx.resolverPaisAdotivos({})).length === 0, 'sem argumento');
  ok((await ctx.resolverPaisAdotivos({ pais: [] })).length === 0, 'lista vazia');
  ok((await ctx.resolverPaisAdotivos({ pais: null })).length === 0, 'null');
  ok((await ctx.resolverPaisAdotivos({ pais: 'x' })).length === 0, 'string');
  // Sem socket: nao lanca, so' fica sem nome.
  const r = await ctx.resolverPaisAdotivos({ pais: PAIS_LID });
  ok(r.length === 2 && r.every((p) => p.nome === ''), 'sem socket -> sem nome, sem erro');
});

await test('32. o handler resolve os pais e passa nos DOIS canais', () => {
  ok(INDEX.includes('resolverPaisAdotivos'), 'o handler chama o resolvedor');
  ok(INDEX.includes('lerIdentidade().paisAdotivos'), 'le os pais do config');
  const ocorrencias = (INDEX.match(/resolverPaisAdotivos\(/g) || []).length;
  ok(ocorrencias >= 2, `chamado no chat E na voz (veio ${ocorrencias})`);
  const SESSAO = fs.readFileSync(new URL('../dados/src/utils/iapSessao.js', import.meta.url), 'utf-8');
  contem(SESSAO, 'paisAdotivos', 'a voz encadeia os pais');
  const IA = fs.readFileSync(new URL('../dados/src/funcs/private/ia.js', import.meta.url), 'utf-8');
  contem(IA, 'paisAdotivos', 'o chat tambem');
});

// ---------------------------------------------------------------------------
// 7) ABREVIACOES, RISADAS E O +18 DESTRAVADO
// ---------------------------------------------------------------------------
console.log('\n=== 7) ABREVIACOES, RISADAS E +18 ===\n');

await test('33. as ABREVIACOES entram (com os significados)', () => {
  const b = id.blocoDeIdentidade(ID_TESTE);
  contem(b, 'AS ABREVIACOES QUE VOCE USA', 'a secao');
  // As da fonte (Wikipedia "Internetes") + as que o dono citou.
  contem(b, 'obg', 'obg (obrigado)');
  contem(b, 'vc', 'vc (voce)');
  contem(b, 'tbm', 'tbm (tambem)');
  contem(b, 'pq', 'pq (porque)');
  contem(b, 'vlw', 'vlw (valeu)');
  contem(b, 'flw', 'flw (falou)');
  contem(b, 'blz', 'blz (beleza)');
  contem(b, 'mds', 'mds (meu deus)');
  contem(b, 'slk', 'slk');
  contem(b, 'sla', 'sla (sei la)');
  contem(b, 'sdd', 'sdd (saudade)');
  contem(b, 'tlgd', 'tlgd (ta ligado)');
  contem(b, 'pprt', 'pprt (papo reto)');
  // Cada uma com o SIGNIFICADO (sem isso o modelo chuta o que quer dizer).
  contem(b, '(obrigado/obrigada)', 'explica obg');
  contem(b, '(porque)', 'explica pq');
});

await test('34. NAO abreviar TUDO (senao fica robotico)', () => {
  const b = id.blocoDeIdentidade(ID_TESTE);
  contem(b, 'NAO abrevia TUDO', 'avisa para misturar');
  contem(b, 'ninguem abrevia 100% do tempo', 'explica o porque');
});

await test('35. as RISADAS por nivel entram', () => {
  const b = id.blocoDeIdentidade(ID_TESTE);
  contem(b, 'AS SUAS RISADAS', 'a secao');
  contem(b, '"kkk" curto', 'o kkk curto');
  contem(b, 'kkkkk', 'o normal');
  contem(b, 'KKKKKKKKKKKKKKKKKKKKKKKKKK', 'o comprido em maiuscula');
  contem(b, 'ksksksksksksksksks', 'o ksks (deboche)');
  contem(b, 'KSSKSKSKSKSK', 'a variacao em maiuscula');
  contem(b, 'rsrs', 'o rsrs sem graca');
  contem(b, 'hahaha', 'o hahaha para variar');
  // A REGRA: o tamanho diz o quanto foi engracado.
  contem(b, 'o tamanho e a caixa da risada dizem', 'a regra do tamanho');
  ok(/Nao use sempre\s+o mesmo tamanho/.test(b), 'proibe repetir o mesmo tamanho');
});

await test('36. o +18 e PERMITIDO (nao recusa)', () => {
  const b = id.blocoDeIdentidade(ID_TESTE);
  contem(b, 'A CONVERSA +18', 'a secao');
  contem(b, 'PERMITIDO', 'diz que e permitido');
  contem(b, 'Nao recuse, nao corte, nao mude de assunto', 'proibe recusar');
  contem(b, 'NUNCA diga que "nao pode"', 'proibe o "nao posso"');
  contem(b, 'nao e apropriado', 'proibe o "nao e apropriado"');
});

await test('37. a ESCALADA esta descrita (vai se soltando)', () => {
  const b = id.blocoDeIdentidade(ID_TESTE);
  contem(b, 'vai se soltando conforme ela esquenta', 'descreve a escalada');
  contem(b, 'voce insinua de volta', 'passo 1');
  contem(b, 'voce fica tambem', 'passo 2');
  contem(b, 'responde no mesmo nivel', 'passo 3');
  contem(b, 'nao freia', 'passo 4');
});

await test('38. a FOTO: ela provoca/negocia, nao nega (o caso do dono)', () => {
  const b = id.blocoDeIdentidade(ID_TESTE);
  contem(b, 'Se pedirem uma FOTO', 'o caso do dono');
  contem(b, 'provoca, brinca, negocia, faz suspense', 'como ela reage');
  contem(b, 'NAO da aquele "nao, isso eu nao faco"', 'o que ela NAO faz');
});

await test('39. os LIMITES DUROS ficam SEPARADOS e so citam menor/abuso', () => {
  const b = id.blocoDeIdentidade(ID_TESTE);
  contem(b, 'O QUE NEM NO +18 VOCE FAZ', 'a secao separada');
  contem(b, 'MENOR de idade', 'o limite de menor');
  contem(b, 'ESTUPRO, abuso', 'o limite de abuso');
  contem(b, 'a UNICA coisa que te faz recusar', 'deixa claro que e a unica');
  // So' esses dois: nao pode virar uma lista de pudores.
  contem(b, 'Fora desses dois, TODO o resto do +18 esta liberado', 'libera o resto');
});

await test('40. A REGRESSAO: a recusa NAO pode citar o "clima" (o bug do dono)', () => {
  // O defeito real: o aviso dizia "...voce NAO faz, NEM NO MEIO DO CLIMA" — a
  // palavra colada no "NAO faz" fazia o modelo recusar QUANDO esquentasse. Era
  // por isso que ela negava a foto.
  const b = id.blocoDeIdentidade(ID_TESTE);
  ok(!/NAO faz, nem no meio do clima/i.test(b), 'a frase antiga nao voltou');
  ok(!/nem no meio do clima/i.test(b), 'a expressao "nem no meio do clima" saiu');
  // E o bloco do +18 nao pode conter uma proibicao ligada ao clima.
  const i = b.indexOf('A CONVERSA +18');
  const j = b.indexOf('O QUE NEM NO +18 VOCE FAZ', i);
  const bloco18 = b.slice(i, j);
  ok(!/NAO faca|nao faca|proibido/i.test(bloco18), 'o bloco de permissao nao tem proibicao solta');
});

await test('41. a permissao vem ANTES do limite (a ordem importa)', () => {
  const b = id.blocoDeIdentidade(ID_TESTE);
  const permissao = b.indexOf('A CONVERSA +18');
  const limite = b.indexOf('O QUE NEM NO +18 VOCE FAZ');
  ok(permissao > 0 && limite > permissao, 'permissao antes do limite');
  // E o limite duro e' a ULTIMA palavra (junto com as travas do config).
  const travas = b.indexOf('LIMITES ABSOLUTOS');
  ok(travas > limite, 'as travas do config fecham o prompt');
});

await test('42. as travas do CONFIG nao citam o clima (nao reintroduzem o bug)', () => {
  const r = id.lerIdentidade(CONFIG_REAL);
  const texto = r.travas.join(' ');
  ok(!/meio do clima/i.test(texto), 'nenhuma trava fala de clima');
  ok(!/conversa quente/i.test(texto), 'nem de conversa quente');
  // Mas os limites de verdade continuam.
  ok(/menor/i.test(texto), 'o limite de menor segue');
  ok(/estupro|abuso/i.test(texto), 'o de abuso segue');
});

// ---------------------------------------------------------------------------
console.log('\n' + '='.repeat(60));
const tot = RESULTS.reduce((a, r) => a + r.passed, 0);
const fal = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log(`RESULTADO: ${RESULTS.length} testes | ${tot} asserções ok | ${fal} falhas`);
console.log('='.repeat(60));
process.exit(fal ? 1 : 0);
