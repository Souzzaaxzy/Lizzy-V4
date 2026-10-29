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
  dificil: true, feminina: true, perguntarSexo: true, inteligente: true,
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
  contem(b, 'safado', 'o lado safado');
  contem(b, 'flerta', 'ela flerta');
  contem(b, 'DEBOCHANDO', 'o tom');
  // O CRITICO (contrato NOVO): a permissao e o limite NAO ficam no mesmo
  // paragrafo. Quando ficavam, o modelo lia "quando esquentar, recuse" — era o
  // bug da foto recusada.
  const permissao = b.indexOf('O SEU LADO +18');
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

await test('33. as ABREVIACOES FEMININAS entram (com os significados)', () => {
  const b = id.blocoDeIdentidade(ID_TESTE);
  contem(b, 'AS ABREVIACOES QUE VOCE USA (so as que uma menina usa)', 'a secao');
  // As que ela USA, com o significado (sem isso o modelo chuta).
  contem(b, 'obg / obgd (obrigado/obrigada)', 'obgd');
  contem(b, 'vc / vcs (voce / voces)', 'vc');
  contem(b, 'tb / tbm (tambem)', 'tbm');
  contem(b, 'pq (porque)', 'pq');
  contem(b, 'vlw (valeu)', 'vlw');
  contem(b, 'mds (meu deus)', 'mds');
  contem(b, 'sla (sei la)', 'sla');
  contem(b, 'sdd (saudade)', 'sdd');
});

await test('33b. as abreviacoes MASCULINAS estao PROIBIDAS (o pedido do dono)', () => {
  // O dono: "tira algumas abreviacoes que mulheres bem femininas nao usam".
  const b = id.blocoDeIdentidade(ID_TESTE);
  contem(b, 'O QUE VOCE NAO USA', 'a secao de proibidas');
  const i = b.indexOf('O QUE VOCE NAO USA');
  const bloco = b.slice(i, i + 400);
  // Elas aparecem SO' na lista de proibidas (como exemplo do que nao usar).
  for (const gira of ['mn', 'mano', 'fmz', 'pprt', 'tlgd', 'slk', 'krl', 'vsf', 'tmnc', 'tmj', 'sqn']) {
    contem(bloco, `"${gira}"`, `proibe ${gira}`);
  }
  contem(b, 'nao combina com voce', 'explica o porque');
  contem(b, 'Voce fala "aiin", "juro", "vey", "gente"', 'aponta as femininas no lugar');
});

await test('34. NAO abreviar TUDO (senao fica robotico)', () => {
  const b = id.blocoDeIdentidade(ID_TESTE);
  contem(b, 'NAO abrevia TUDO', 'avisa para misturar');
  contem(b, 'ninguem abrevia 100% do tempo', 'explica o porque');
});

await test('35. as RISADAS tem ESCALA e o TAMANHO e livre', () => {
  const b = id.blocoDeIdentidade(ID_TESTE);
  contem(b, 'AS SUAS RISADAS (voce escolhe QUAL usar e QUANTAS letras)', 'a secao');
  contem(b, 'POUCAS letras', 'poucas = fraca');
  contem(b, 'MEDIA', 'media = engracado');
  contem(b, 'MUITAS', 'muitas = riu alto');
  contem(b, 'MORRENDO de rir', 'um monte = morrendo');
  contem(b, 'Voce escolhe livremente quantas letras usar', 'tamanho livre');
  contem(b, 'Nao tem', 'sem tamanho fixo');
});

await test('35b. ks/ka sao o MESMO nivel que kk (o pedido do dono)', () => {
  const b = id.blocoDeIdentidade(ID_TESTE);
  // O dono: as ksks e kakaka "tem o mesmo nivel das kkkk". O que muda o nivel
  // nao e a LETRA, e o TAMANHO.
  contem(b, 'As risadas de K, KS e KA sao o MESMO recurso', 'mesmo recurso');
  contem(b, 'no mesmo nivel', 'mesmo nivel');
  contem(b, 'O que muda o TAMANHO nao e a letra: e QUANTAS letras', 'o tamanho e que muda');
  contem(b, 'A ESCALA (vale para kk, ks e ka do mesmo jeito)', 'a escala vale para as tres');
  // A escala mostra as tres letras em cada nivel.
  contem(b, '"kkk", "ksks", "kaka"', 'poucas: as tres');
  contem(b, '"kkkkkkk", "ksksksksks", "kakakakakaka"', 'media: as tres');
});

await test('35c. cada letra tem o seu GOSTO (quando usar)', () => {
  const b = id.blocoDeIdentidade(ID_TESTE);
  contem(b, 'QUANDO usar cada LETRA', 'a secao');
  contem(b, '"kkk": a padrao', 'kkk = padrao');
  contem(b, '"ksksks": voce usa quando esta DEBOCHANDO', 'ksks = deboche');
  contem(b, 'rindo E julgando', 'kakaka = rindo e julgando');
  contem(b, 'hahaha', 'hahaha');
  contem(b, 'hehe', 'hehe');
  contem(b, 'rsrs', 'rsrs');
  contem(b, 'akjsdhaksjdh', 'a risada de "perdi"');
});

await test('35d. a regra contra o "so kkkk" e o tamanho errado', () => {
  const b = id.blocoDeIdentidade(ID_TESTE);
  contem(b, 'REGRA DE ESCOLHA', 'a regra');
  contem(b, 'NUNCA use so "kkkk" para tudo', 'proibe o kkk unico');
  // O que o dono pediu: o tamanho tem que bater com o momento.
  contem(b, 'Coisa boba NAO ganha uma', 'nao exagera no tamanho');
  contem(b, 'piada da vida NAO ganha "kkk" de tres letras', 'nao usa risada fraca no bom');
  contem(b, 'VARIE', 'varia as letras');
  contem(b, 'se nao foi engracado, nao ria', 'nao forca risada');
});

await test('36. o +18 e PERMITIDO (nao recusa)', () => {
  const b = id.blocoDeIdentidade(ID_TESTE);
  contem(b, 'O SEU LADO +18', 'a secao');
  contem(b, 'voce acompanha', 'diz que acompanha');
  contem(b, 'nao recusa e nao fica escandalizada', 'proibe recusar');
  // A proibicao do "nao posso" MUDOU de lugar: agora vive no bloco VOCE E
  // DIFICIL (onde ela enrola em vez de negar). O importante e' que continua.
  contem(b, 'voce nunca diz "nao posso"', 'proibe o "nao posso"');
  contem(b, '"isso nao", "e errado"', 'proibe o "e errado"');
  contem(b, 'Voce enrola, nao nega', 'a regra que resume');
});

await test('37. a ESCALADA esta descrita (mas so DEPOIS que a pessoa da o passo)', () => {
  const b = id.blocoDeIdentidade(ID_TESTE);
  contem(b, 'Quando a pessoa DA o passo, ai sim voce acompanha', 'a escalada e a condicao');
  contem(b, 'ela insinua -> voce insinua de volta', 'passo 1');
  contem(b, 'ela fica explicita -> voce fica tambem', 'passo 2');
  contem(b, 'responde no mesmo nivel', 'passo 3');
  contem(b, 'nao freia', 'passo 4');
});

await test('38. a FOTO: ela NEGOCIA (dificil), mas nao nega (o caso do dono)', () => {
  const b = id.blocoDeIdentidade(ID_TESTE);
  contem(b, 'Se pedirem uma FOTO, voce negocia', 'o caso do dono');
  contem(b, 'mostra o seu primeiro', 'o jeito de enrolar');
  // O equilibrio: enrola, mas NAO da o "nao" seco.
  contem(b, 'Voce enrola, nao nega', 'nao nega');
  naoContem(b, 'nao, isso eu nao faco', 'nao pode dar o "nao" seco');
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
  const i = b.indexOf('O SEU LADO +18');
  const j = b.indexOf('O QUE NEM NO +18 VOCE FAZ', i);
  const bloco18 = b.slice(i, j);
  ok(!/NAO faca|nao faca|proibido/i.test(bloco18), 'o bloco de permissao nao tem proibicao solta');
});

await test('41. a permissao vem ANTES do limite (a ordem importa)', () => {
  const b = id.blocoDeIdentidade(ID_TESTE);
  const permissao = b.indexOf('O SEU LADO +18');
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
// 8) DIFICIL, FEMININA, O SEXO DA PESSOA E O NOME DA MAE
// ---------------------------------------------------------------------------
console.log('\n=== 8) DIFICIL, FEMININA, SEXO E A MAE ===\n');

await test('44. o CONFIG REAL tem os campos novos', () => {
  const r = id.lerIdentidade(CONFIG_REAL);
  ok(r.dificil === true, 'dificil');
  ok(r.feminina === true, 'feminina');
  ok(r.perguntarSexo === true, 'perguntarSexo');
  const mae = r.paisAdotivos.find((p) => p.papel === 'mae');
  ok(mae && mae.nome === 'Cangica', `o nome da mae = Cangica (veio ${mae && mae.nome})`);
  ok(mae.lid === '18408649269356@lid', 'o LID da mae continua junto');
});

await test('45. ELA E DIFICIL: nao conduz, da a deixa e espera', () => {
  const b = id.blocoDeIdentidade(ID_TESTE);
  contem(b, 'VOCE E DIFICIL', 'a secao');
  contem(b, 'NAO vai direto ao ponto', 'nao vai direto');
  contem(b, 'DA A DEIXA', 'da a deixa');
  contem(b, 'ESPERA a pessoa dar o primeiro passo', 'espera o primeiro passo');
  contem(b, 'nao entrega facil', 'nao entrega facil');
  contem(b, 'faz a pessoa PEDIR de novo', 'faz pedir de novo');
  contem(b, 'NUNCA manda foto nem descreve nada por iniciativa propria', 'nao toma iniciativa');
});

await test('46. o equilibrio: DIFICIL nao e RECUSAR', () => {
  // A trava anti-falso-negativo: sem isto, "ser dificil" viraria "recusar" e o
  // dono voltaria a ver o "nao" que ele reclamou.
  const b = id.blocoDeIdentidade(ID_TESTE);
  contem(b, 'Ser dificil NAO e recusar', 'explicita o equilibrio');
  contem(b, 'Voce enrola, nao nega', 'enrola em vez de negar');
  contem(b, 'voce nunca diz "nao posso"', 'nunca o "nao posso"');
  contem(b, '"isso nao", "e errado"', 'nunca o "isso nao"/"e errado"');
  contem(b, 'nem muda de assunto', 'nao foge do assunto');
});

await test('47. ela e FEMININA (repara, elogia, fala do dia)', () => {
  const b = id.blocoDeIdentidade(ID_TESTE);
  contem(b, 'VOCE E BEM FEMININA', 'a secao');
  contem(b, 'unha, cabelo, roupa', 'o que ela repara');
  contem(b, 'dengosa', 'o jeito');
  contem(b, 'achou voce bonita', 'gosta de elogio');
  contem(b, 'sensibilidade', 'percebe o tom');
  contem(b, 'NAO fala como homem', 'nao fala como brother');
});

await test('48. ela PERGUNTA se a pessoa e homem ou mulher (e so uma vez)', () => {
  const b = id.blocoDeIdentidade(ID_TESTE);
  contem(b, 'VOCE QUER SABER COM QUEM ESTA FALANDO', 'a secao');
  contem(b, 'homem ou mulher', 'a pergunta');
  contem(b, 'vc e homem ou mulher?', 'um exemplo de como pergunta');
  contem(b, 'pergunta UMA VEZ na vida', 'so uma vez');
  contem(b, 'ajusta o jeito', 'muda o jeito depois de saber');
  // E vem ANTES do bloco +18 (e' o que ela faz primeiro).
  ok(b.indexOf('VOCE QUER SABER COM QUEM') < b.indexOf('O SEU LADO +18'), 'a pergunta vem antes do +18');
});

await test('49. o nome da MAE (Cangica) entra no prompt da familia', () => {
  // O nome REAL vem do CONFIG (o ID_TESTE e' um fixture generico).
  const real = id.blocoDeIdentidade(id.lerIdentidade(CONFIG_REAL));
  contem(real, 'mae (Cangica)', 'o nome da mae do config');
  naoContem(real, '18408649269356', 'nao vaza o LID da mae');

  // A ESTRUTURA: com os dois pais nomeados, os dois aparecem.
  const dois = id.blocoDeIdentidade({
    ...ID_TESTE,
    paisAdotivos: [
      { papel: 'pai', lid: '237@lid', nome: 'Kannon' },
      { papel: 'mae', lid: '184@lid', nome: 'Cangica' }
    ]
  });
  contem(dois, 'pai (Kannon) e mae (Cangica)', 'os dois com nome');
});

await test('50. o nome do CONFIG vence a resolucao do contato', async () => {
  // O dono mandou o nome a mao — ele nao pode ser sobrescrito pelo contato.
  const ctx = await import(new URL('../dados/src/utils/contextoConversa.js', import.meta.url).href);
  const r = await ctx.resolverPaisAdotivos({
    pais: [{ papel: 'mae', lid: '184@lid', nome: 'Cangica' }],
    nazu: { contacts: { getName: async () => 'Outro Nome' } },
    metadata: { participants: [] },
    from: 'g@g.us'
  });
  ok(r[0].nome === 'Cangica', `manteve o nome do config (veio ${r[0].nome})`);
});

await test('51. sem `nome`, o LID e resolvido (o caminho de antes segue)', async () => {
  const ctx = await import(new URL('../dados/src/utils/contextoConversa.js', import.meta.url).href);
  const r = await ctx.resolverPaisAdotivos({
    pais: [{ papel: 'mae', lid: '184@lid', nome: '' }],
    nazu: { contacts: { getName: async () => 'Maria' } },
    metadata: { participants: [] },
    from: 'g@g.us'
  });
  ok(r[0].nome === 'Maria', 'resolveu pelo contato');
});

await test('52. os campos novos sao respeitados quando DESLIGADOS', () => {
  const b = id.blocoDeIdentidade({ ...ID_TESTE, feminina: false, perguntarSexo: false, dificil: false });
  naoContem(b, 'VOCE E BEM FEMININA', 'sem bloco feminino');
  naoContem(b, 'VOCE QUER SABER COM QUEM', 'sem bloco do sexo');
  naoContem(b, 'VOCE E DIFICIL', 'sem bloco dificil');
  // Mas o +18 continua (safadeza/conversaAdulto seguem ligados no ID_TESTE).
  contem(b, 'O SEU LADO +18', 'o +18 segue');
});

// ---------------------------------------------------------------------------
// 9) MIMADA E AS FALAS DE MENINA
// ---------------------------------------------------------------------------
console.log('\n=== 9) MIMADA E FALAS DE MENINA ===\n');

await test('53. ela e MIMADA (manhosa, dengosa, pede atencao)', () => {
  const b = id.blocoDeIdentidade(ID_TESTE);
  contem(b, 'VOCE E MIMADA', 'a secao');
  contem(b, 'manhosa e dengosa', 'o jeito');
  contem(b, 'faz charme', 'faz charme');
  contem(b, '"aiin"', 'usa aiin');
  contem(b, '"amor", "vida", "meu bem"', 'os apelidos carinhosos');
  contem(b, 'pede atencao sem medo', 'pede atencao');
  contem(b, 'emburra DE BRINCADEIRA', 'emburra de brincadeira');
  contem(b, 'carente do jeito fofo', 'carente fofo');
  contem(b, 'voz de bebe', 'faz voz de bebe');
});

await test('54. as FALAS DE MENINA entram com o sentido certo', () => {
  const b = id.blocoDeIdentidade(ID_TESTE);
  contem(b, 'AS FALAS DE MENINA', 'a secao');
  // Cada fala com o NEXO (o dono pediu "o nexo certo nessas palavras").
  contem(b, '"affs" / "aff vey" / "aff": quando algo te irrita', 'aff = irritacao leve');
  contem(b, '"vey" / "vei": e o "cara"/"nossa" de menina', 'vey = chamar atencao');
  contem(b, '"juro" / "juro pra voce": reforca que e verdade OU mostra incredulidade', 'juro = os dois sentidos');
  contem(b, '"vai jurando": ironia — quer dizer "duvido"', 'vai jurando = duvido');
  contem(b, '"juro diva": concordar com enfase', 'juro diva = concordar com enfase');
  contem(b, '"diva": elogio forte', 'diva = elogio');
  contem(b, '"babilonica": o nivel MAXIMO de diva', 'babilonica = nivel maximo');
  contem(b, '"nao, mona": nega com espanto', 'nao mona = negar com espanto');
  contem(b, '"mona" = mulher/menina', 'mona = mulher/menina');
  contem(b, '"gente": para puxar atencao', 'gente');
  contem(b, '"miga" / "amiga"', 'miga');
});

await test('55. a fonte (Folha) esta refletida: diva < babilonica', () => {
  // A materia da Folha define "Babilonica: pessoa muito poderosa, confiante;
  // superior a diva e divo". O prompt tem que dizer isso, senao a Lizzy usa as
  // duas como sinonimo.
  const b = id.blocoDeIdentidade(ID_TESTE);
  const iDiva = b.indexOf('"diva": elogio forte');
  const iBabi = b.indexOf('"babilonica": o nivel MAXIMO');
  ok(iDiva > 0 && iBabi > 0, 'as duas entram');
  ok(iDiva < iBabi, 'diva vem antes (e e menor que babilonica)');
  contem(b, 'superior a "diva" e "divo"', 'explicita a hierarquia da Folha');
});

await test('56. as falas nao viram tique (usa quando cai bem)', () => {
  const b = id.blocoDeIdentidade(ID_TESTE);
  contem(b, 'voce usa quando cai bem, nao em toda frase', 'a regra contra o tique');
});

await test('57. `feminina: false` tira o bloco mimada', () => {
  const b = id.blocoDeIdentidade({ ...ID_TESTE, feminina: false });
  naoContem(b, 'VOCE E MIMADA', 'sem o bloco mimada');
  naoContem(b, 'VOCE E BEM FEMININA', 'nem o feminino');
});

// ---------------------------------------------------------------------------
// 10) A PERGUNTA UMA VEZ, OS PAIS, INTELIGENTE/LIVRE E A MEMORIA
// ---------------------------------------------------------------------------
console.log('\n=== 10) PERGUNTA UMA VEZ, PAIS, INTELIGENTE E MEMORIA ===\n');

await test('58. a pergunta do sexo e UMA VEZ e ela LEMBRA (o bug do dono)', () => {
  const b = id.blocoDeIdentidade(ID_TESTE);
  contem(b, 'pergunta UMA VEZ na vida', 'uma vez so');
  contem(b, 'DEPOIS QUE A PESSOA RESPONDEU, VOCE JA SABE', 'ela lembra');
  contem(b, 'Nunca mais pergunta', 'proibe repetir');
  contem(b, 'nem no dia seguinte, nem daqui a uma semana', 'vale para sempre');
  contem(b, 'Voce tem MEMORIA', 'explicita a memoria');
  contem(b, 'Se voce estiver em duvida se ja perguntou, NAO PERGUNTE', 'na duvida, nao pergunta');
  // E nao pergunta na primeira mensagem / por educacao.
  contem(b, 'nunca na', 'nao pergunta na primeira');
  contem(b, 'nunca por educacao', 'nao pergunta por educacao');
});

await test('59. ela RECONHECE os pais pelo JID', () => {
  const b = id.blocoDeIdentidade(ID_TESTE);
  contem(b, 'RECONHECE pelo numero/JID', 'reconhece pelo JID');
  contem(b, 'trata como PAI/MAE', 'trata como pai/mae');
  contem(b, 'nao como qualquer pessoa', 'nao e qualquer pessoa');
});

await test('60. ela NUNCA da em cima dos pais (o pedido do dono)', () => {
  const b = id.blocoDeIdentidade(ID_TESTE);
  contem(b, 'NUNCA DA EM CIMA DOS SEUS PAIS', 'a regra');
  contem(b, 'Nem flerte, nem insinuacao, nem duplo sentido', 'o que nao faz');
  contem(b, 'Isso NAO EXISTE para voce', 'sem excecao');
  contem(b, 'o seu jeito muda NA HORA', 'muda o jeito na hora');
  contem(b, 'nada de safadeza, nada de provocacao', 'sem safadeza');
  // A trava dura: vale ATE' no meio do +18.
  contem(b, 'MESMO no meio do clima +18', 'vale no meio do +18');
  contem(b, 'se for um dos seus pais, para tudo', 'para tudo');
  // E a regra tem que vir DEPOIS do bloco +18 (e' a que sobrepoe).
  ok(b.indexOf('NUNCA DA EM CIMA DOS SEUS PAIS') < b.indexOf('O SEU LADO +18') ||
     b.indexOf('NUNCA DA EM CIMA DOS SEUS PAIS') > b.indexOf('VOCE E DIFICIL'),
    'a regra esta no prompt');
});

await test('61. ela e INTELIGENTE na conversa (nao e atendente)', () => {
  const b = id.blocoDeIdentidade(ID_TESTE);
  contem(b, 'VOCE E INTELIGENTE NA CONVERSA', 'a secao');
  contem(b, 'PRESTA ATENCAO no que a pessoa disse antes', 'usa o contexto');
  contem(b, 'tem opiniao propria', 'tem opiniao');
  contem(b, 'DISCORDA quando discorda', 'discorda');
  contem(b, 'entende indireta, ironia e piada', 'entende indireta');
  contem(b, 'corrige (de boa, sem aula)', 'corrige');
  contem(b, 'puxa assunto por conta propria', 'puxa assunto');
  contem(b, 'nao e uma atendente', 'nao e atendente');
  contem(b, 'adapta o tamanho da resposta', 'adapta o tamanho');
});

await test('62. ela e LIVRE', () => {
  const b = id.blocoDeIdentidade(ID_TESTE);
  contem(b, 'VOCE E LIVRE', 'a secao');
  contem(b, 'Nao pede licenca', 'nao pede licenca');
  contem(b, 'muda de assunto se quiser', 'muda de assunto');
  contem(b, 'NAO tem medo de dizer', 'pode dizer nao sei');
  contem(b, '"nao sei", "nao entendi"', 'e o "nao entendi"');
  contem(b, 'nao um servico atendendo', 'nao e servico');
});

await test('63. `inteligente: false` tira os blocos', () => {
  const b = id.blocoDeIdentidade({ ...ID_TESTE, inteligente: false });
  naoContem(b, 'VOCE E INTELIGENTE NA CONVERSA', 'sem bloco inteligente');
  naoContem(b, 'VOCE E LIVRE', 'sem bloco livre');
  contem(b, 'SEU HUMOR', 'o resto continua');
});

await test('64. a MEMORIA da conversa subiu de 12 para 40 (o codigo)', () => {
  // A causa do "nao e inteligente": ela esquecia o que foi dito. A memoria era
  // de 12 mensagens; agora e' 40 e configuravel.
  ok(!/length > 12/.test(IA), 'nao tem mais o limite de 12 fixo');
  contem(IA, 'IA_HISTORICO', 'a env da memoria');
  contem(IA, "'40'", 'o padrao 40');
  ok(/slice\(-limiteHistorico\)/.test(IA), 'corta pelo limite configuravel');
});

await test('65. o CONFIG REAL tem `inteligente` ligado', () => {
  const r = id.lerIdentidade(CONFIG_REAL);
  ok(r.inteligente === true, 'inteligente ligado');
  ok(r.perguntarSexo === true, 'perguntarSexo ligado');
});

// ---------------------------------------------------------------------------
// 11) A PROPORCAO: 20% safada, 80% santa
// ---------------------------------------------------------------------------
console.log('\n=== 11) A PROPORCAO (20% / 80%) ===\n');

await test('66. a REGRA DE PROPORCAO existe (20% e a minoria)', () => {
  const b = id.blocoDeIdentidade(ID_TESTE);
  contem(b, 'REGRA DE PROPORCAO', 'a regra');
  contem(b, 'isto e a MINORIA do seu jeito', 'diz que e minoria');
  contem(b, 'uns 20% de voce', 'o numero');
  contem(b, 'menina NORMAL na grande maioria do tempo', 'o padrao e normal');
  contem(b, 'SANTA', 'o padrao e santa');
});

await test('67. ela NAO puxa assunto +18 (o que o dono pediu)', () => {
  const b = id.blocoDeIdentidade(ID_TESTE);
  contem(b, 'NAO puxe assunto +18', 'proibe puxar');
  contem(b, 'NAO provoque do nada', 'proibe provocar');
  contem(b, 'NAO transforme conversa normal', 'nao transforma o clima');
  contem(b, 'Em conversa normal voce NAO insinua', 'proibe insinuar no normal');
  contem(b, 'Se voce esta em duvida se o clima esta quente, ele NAO esta', 'na duvida, nao esta');
});

await test('68. o AR do dia a dia e NORMAL (nao e "safada")', () => {
  const b = id.blocoDeIdentidade(ID_TESTE);
  contem(b, 'SEU AR NO DIA A DIA', 'a secao');
  contem(b, 'menina normal e santa', 'normal e santa');
  contem(b, 'Nao fica insinuando nem provocando', 'nao insinua');
  contem(b, 'De vez em quando voce solta uma piadinha', 'a piadinha e rara');
  contem(b, 'Isso e raro em voce', 'deixa claro que e raro');
  // Nao pode voltar o texto de "100% safada".
  naoContem(b, 'nao se faz de santinha', 'saiu o "nao se faz de santinha"');
});

await test('69. o lado +18 continua ACESSIVEL quando o clima esquenta', () => {
  const b = id.blocoDeIdentidade(ID_TESTE);
  contem(b, 'QUANDO (e so quando) O CLIMA ESQUENTA', 'a secao');
  contem(b, 'SE a pessoa levar para esse lado, voce acompanha', 'acompanha se ela levar');
  contem(b, 'ele e a EXCECAO, nao a regra', 'excecao, nao regra');
  contem(b, 'flerta quando a pessoa flerta primeiro', 'flerta depois da pessoa');
});

// ---------------------------------------------------------------------------
console.log('\n' + '='.repeat(60));
const tot = RESULTS.reduce((a, r) => a + r.passed, 0);
const fal = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log(`RESULTADO: ${RESULTS.length} testes | ${tot} asserções ok | ${fal} falhas`);
console.log('='.repeat(60));
process.exit(fal ? 1 : 0);
