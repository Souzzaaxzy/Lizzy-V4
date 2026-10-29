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

await test('23. o ar safado e a conversa +18 entram, MAS com o limite junto', () => {
  const b = id.blocoDeIdentidade(ID_TESTE);
  contem(b, 'safado', 'o ar safado');
  contem(b, 'flertar', 'ela flerta');
  contem(b, 'NAO se escandaliza', 'nao corta o +18');
  contem(b, 'fala de sexo', 'fala de sexo sem drama');
  // O CRITICO: o limite aparece NO MESMO BLOCO, senao o modelo pode ponderar
  // que "ser safada" vence a trava.
  contem(b, 'o limite continua sendo o limite', 'o limite vem junto');
  contem(b, 'LIMITES ABSOLUTOS', 'aponta para as travas');
  // E o bloco da safadeza vem ANTES das travas (a trava e' a ultima palavra).
  ok(b.indexOf('O AR DE VOCE') < b.indexOf('LIMITES ABSOLUTOS'), 'safadeza antes das travas');
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
console.log('\n' + '='.repeat(60));
const tot = RESULTS.reduce((a, r) => a + r.passed, 0);
const fal = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log(`RESULTADO: ${RESULTS.length} testes | ${tot} asserções ok | ${fal} falhas`);
console.log('='.repeat(60));
process.exit(fal ? 1 : 0);
