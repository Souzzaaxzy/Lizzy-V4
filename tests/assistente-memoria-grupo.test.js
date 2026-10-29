/**
 * A MEMORIA DA LIZZY, POR GRUPO.
 *
 * O dono pediu: *"coloca a memoria da lizzy por grupo, mas mantendo a
 * personalidade"*. A chave era `id_enviou_personalidade` — SEM o grupo — e o
 * proprio comentario do codigo dizia a intencao antiga ("manter contexto entre
 * grupos"). Agora e' `grupo|usuario|personalidade`.
 *
 * Este teste cobre as TRES pontas:
 *   1. o modulo PURO (`memoriaLizzy.js`) — o formato da chave;
 *   2. o FLUXO REAL (handler de verdade, Groq dublado) — o que o modelo recebe
 *      quando a MESMA pessoa fala em dois grupos;
 *   3. a LIMPEZA (`!iaclear`), que estava quebrada.
 *
 * Uso: node tests/assistente-memoria-grupo.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-mem-'));
process.env.DATABASE_PATH = TMP_DB;
process.env.CONFIG_PATH = path.join(TMP_DB, 'config.json');
fs.mkdirSync(path.join(TMP_DB, 'grupos'), { recursive: true });
fs.mkdirSync(path.join(TMP_DB, 'dono'), { recursive: true });
fs.writeFileSync(process.env.CONFIG_PATH, JSON.stringify({
  prefixo: '!', nomebot: 'Lizzy do privy', nomedono: 'Kannon',
  numerodono: '5511915323638', lidowner: '127642753843383', debug: false
}, null, 2));

const ia = await import(new URL('../dados/src/funcs/private/ia.js', import.meta.url).href);
const groq = await import(new URL('../dados/src/utils/groqClient.js', import.meta.url).href);
const mem = await import(new URL('../dados/src/utils/memoriaLizzy.js', import.meta.url).href);
const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;

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

const INDEX = fs.readFileSync(new URL('../dados/src/index.js', import.meta.url), 'utf-8');
const IA_SRC = fs.readFileSync(new URL('../dados/src/funcs/private/ia.js', import.meta.url), 'utf-8');

// ---------------------------------------------------------------------------
// 1) O FORMATO DA CHAVE (puro)
// ---------------------------------------------------------------------------
console.log('\n=== 1) A CHAVE (puro) ===\n');

await test('1. a chave tem o GRUPO, a PESSOA e a PERSONALIDADE', () => {
  const k = mem.chaveDaMemoria({
    idGrupo: '120363425268923269@g.us',
    idUsuario: '5511915323638@s.whatsapp.net',
    personalidade: 'lizzy'
  });
  ok(k === '120363425268923269@g.us|5511915323638@s.whatsapp.net|lizzy', `a forma (veio ${k})`);
  ok(k.split('|').length === 3, 'tres partes');
});

await test('2. a chave nova e a ANTIGA + o escopo (nada mais mudou)', () => {
  const k = mem.chaveDaMemoria({ idGrupo: 'G@g.us', idUsuario: 'U@s.whatsapp.net', personalidade: 'lizzy' });
  const legada = mem.chaveLegada('U@s.whatsapp.net', 'lizzy');
  ok(legada === 'U@s.whatsapp.net_lizzy', `a legada e' id_personalidade (veio ${legada})`);
  // A migracao e' SO' a adicao do escopo: as outras duas dimensoes continuam
  // identicas (mesma pessoa, mesma personalidade).
  ok(k.startsWith('G@g.us|'), 'o escopo vem na frente');
  ok(k.includes('U@s.whatsapp.net'), 'a PESSOA e a mesma da legada');
  ok(k.endsWith('|lizzy'), 'e a PERSONALIDADE tambem');
  // A chave nova tem UMA dimensao a mais que a legada.
  ok(k.split('|').length === 3, 'tres dimensoes (a legada tinha duas)');
});

await test('3. o separador NAO colide com JID/LID (que tem @ . e :)', () => {
  // Com `_` como separador, o id `a_b` e o grupo `a` com pessoa `b` dariam a
  // MESMA chave. Com `|` (que nao existe em JID/LID), nunca colidem.
  const a = mem.chaveDaMemoria({ idGrupo: 'a', idUsuario: 'b_c' });
  const b = mem.chaveDaMemoria({ idGrupo: 'a|b', idUsuario: 'c' });
  ok(a !== b, 'chaves diferentes para entradas diferentes');
  ok(a.split('|').length === 3, 'o `_` DENTRO do id nao vira separador');
  ok(b.split('|').length === 4, 'e um `|` de verdade no id abre uma parte a mais');
  contem(a, '|', 'usa `|` como separador');
});

await test('4. em PV (sem grupo) a memoria cai no escopo da PROPRIA conversa', () => {
  const pv = mem.chaveDaMemoria({ idGrupo: '', idUsuario: '5511915323638@s.whatsapp.net' });
  ok(pv.startsWith('pv|'), `sem grupo -> escopo pv (veio ${pv})`);
  ok(pv.includes('5511915323638@s.whatsapp.net'), 'e continua isolada por pessoa');
  // Duas pessoas em PV NAO compartilham memoria.
  const outra = mem.chaveDaMemoria({ idGrupo: '', idUsuario: '5511999999999@s.whatsapp.net' });
  ok(pv !== outra, 'PV de A != PV de B');
});

await test('5. o MESMO usuario em grupos DIFERENTES tem memorias DIFERENTES', () => {
  const g1 = mem.chaveDaMemoria({ idGrupo: 'G1@g.us', idUsuario: 'U@s.whatsapp.net' });
  const g2 = mem.chaveDaMemoria({ idGrupo: 'G2@g.us', idUsuario: 'U@s.whatsapp.net' });
  ok(g1 !== g2, 'o escopo do grupo separa');
});

await test('6. a PERSONALIDADE continua na chave (uma so, mas explicita)', () => {
  const lizzy = mem.chaveDaMemoria({ idGrupo: 'G@g.us', idUsuario: 'U', personalidade: 'lizzy' });
  const outra = mem.chaveDaMemoria({ idGrupo: 'G@g.us', idUsuario: 'U', personalidade: 'abyss' });
  ok(lizzy.endsWith('|lizzy'), 'a personalidade no fim');
  ok(lizzy !== outra, 'trocar a personalidade troca a memoria');
  ok(mem.chaveDaMemoria({ idGrupo: 'G@g.us', idUsuario: 'U' }).endsWith('|lizzy'),
    'o padrao e a Lizzy (uma so personalidade)');
});

// ---------------------------------------------------------------------------
// 2) O FLUXO REAL (handler de verdade + Groq dublado)
// ---------------------------------------------------------------------------
console.log('\n=== 2) O FLUXO REAL ===\n');

const OWNER_LID = '5511915323638:1@s.whatsapp.net';
const GRUPO_A = '120363425268923269@g.us';
const GRUPO_B = '120363400000000000@g.us';
const BOT_LID = '127642753843383:1@s.whatsapp.net';

function grupoFile(gid, extra = {}) {
  fs.writeFileSync(path.join(TMP_DB, 'grupos', `${gid}.json`), JSON.stringify({
    assistente: true, groupName: `grupo-${gid.slice(0, 6)}`, prefixo: '!', ...extra
  }, null, 2));
}

function fakeSock(sent) {
  return {
    user: { id: BOT_LID, lid: BOT_LID },
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    sendMessage: async (jid, content) => { sent.push({ jid, content }); return { key: { id: 'X' } }; },
    sendPresenceUpdate: async () => {},
    groupMetadata: async () => ({
      subject: 'geralbot', creation: 1742000000, desc: 'grupo de teste',
      owner: OWNER_LID,
      participants: [
        { id: OWNER_LID, admin: 'superadmin', name: 'Kannon' },
        { id: BOT_LID, admin: 'admin' }
      ]
    }),
    contacts: { getName: async (j) => (j.includes('5511915323638') ? 'Kannon' : null) },
    profilePictureUrl: async () => null,
    react: async () => ({}),
    waitForMessage: async () => undefined,
    chatModify: async () => ({}),
  };
}

/** Manda UMA mensagem no grupo `gid` e devolve o historico que chegou ao modelo. */
async function mandarNoGrupo(gid, texto) {
  grupoFile(gid);
  const sent = [];
  const info = {
    key: { remoteJid: gid, fromMe: false, id: `M-${Math.random().toString(36).slice(2, 8)}`, participant: OWNER_LID },
    message: { extendedTextMessage: { text: texto, contextInfo: { remoteJid: gid } } },
    messageTimestamp: Math.floor(Date.now() / 1000), pushName: 'Kannon',
  };
  await handleMessage(fakeSock(sent), info, null, new Map(), null);
  await new Promise((r) => setTimeout(r, 250));
  return sent.map((s) => s.content?.text ?? s.content?.caption ?? '').join('\n');
}

let HISTORICO_VISTO = null;
function dublarGroq(resposta = '{"resp":[{"resp":"ok"}]}') {
  groq.setGroqHttpForTest(async (url, data) => {
    HISTORICO_VISTO = (data?.messages || []).filter((m) => m.role !== 'system');
    return { data: { choices: [{ message: { content: resposta } }] } };
  });
  process.env.GROQ_API_KEY = 'gsk-teste';
}

await test('7. a MESMA pessoa em DOIS grupos NAO ve a conversa do outro', async () => {
  dublarGroq();
  // Fala no grupo A. A entrada fica na memoria DELE (escopo A).
  await mandarNoGrupo(GRUPO_A, 'oi Lizzy, eu amo pizza');
  ok(HISTORICO_VISTO !== null, 'o grupo A chamou o modelo');

  // Agora fala no grupo B: o historico enviado NAO pode ter a fala do A.
  await mandarNoGrupo(GRUPO_B, 'oi Lizzy, aqui e o grupo B');
  const textosB = JSON.stringify(HISTORICO_VISTO || []);
  // O texto chega NORMALIZADO (minusculo) ao modelo — o marcador e' minusculo.
  contem(textosB, 'aqui e o grupo b', 'o grupo B chamou o modelo (a chamada aconteceu)');
  naoContem(textosB, 'eu amo pizza', 'o grupo B NAO recebeu a conversa do grupo A');

  // E o A continua com a sua.
  await mandarNoGrupo(GRUPO_A, 'oi Lizzy de novo');
  const textosA = JSON.stringify(HISTORICO_VISTO || []);
  contem(textosA, 'eu amo pizza', 'o grupo A MANTEVE a sua conversa');
  groq.setGroqHttpForTest(null);
});

await test('8. a memoria sobrevive DENTRO do mesmo grupo (o recurso continua funcionando)', async () => {
  dublarGroq();
  await mandarNoGrupo(GRUPO_A, 'Lizzy, lembra que eu falei de volei');
  await mandarNoGrupo(GRUPO_A, 'Lizzy, e agora?');
  const textos = JSON.stringify(HISTORICO_VISTO || []);
  contem(textos, 'volei', 'a fala anterior do MESMO grupo veio junto');
  groq.setGroqHttpForTest(null);
});

await test('9. o handler passa o GRUPO no extraContext (e a chave o le)', () => {
  // A chave depende do escopo: o handler TEM de mandar `groupId`.
  const i = INDEX.indexOf('const extraContext = {');
  ok(i > 0, 'o bloco do extraContext existe');
  const bloco = INDEX.slice(i, i + 400);
  contem(bloco, 'groupId', 'o handler manda o groupId');
  contem(bloco, 'from', 'e o valor e o `from` (o JID da conversa/grupo)');

  // E o ia.js usa o escopo ao montar a chave.
  contem(IA_SRC, 'chaveDaMemoria', 'o ia.js usa a chave do modulo');
  contem(IA_SRC, 'extraContext.groupId', 'le o grupo do extraContext');
  naoContem(IA_SRC, 'const userId = `${msgValidada.id_enviou}_${personality}`;',
    'a chave SEM grupo (a antiga) nao existe mais');
});

// ---------------------------------------------------------------------------
// 3) A LIMPEZA (estava quebrada)
// ---------------------------------------------------------------------------
console.log('\n=== 3) A LIMPEZA (!iaclear) ===\n');

await test('10. `!iaclear` apaga DE VERDADE (o clear lia um timestamp que nao existia)', async () => {
  dublarGroq();
  await mandarNoGrupo(GRUPO_A, 'mensagem para ter o que limpar');
  const antes = ia.getHistoricoStats();
  ok(antes.totalConversas > 0, `havia conversa para limpar (${antes.totalConversas})`);
  ok(antes.totalMensagens > 0, `e mensagens (${antes.totalMensagens})`);

  ia.clearOldHistorico(0);   // o mesmo que o `!iaclear` chama
  const depois = ia.getHistoricoStats();
  ok(depois.totalConversas === 0, `limpou as conversas (veio ${depois.totalConversas})`);
  ok(depois.totalMensagens === 0, `e as mensagens (veio ${depois.totalMensagens})`);
  groq.setGroqHttpForTest(null);
});

await test('11. a entrada do historico carrega o timestamp (o que faz a limpeza funcionar)', () => {
  contem(IA_SRC, 'timestamp: Date.now()', 'o updateHistorico grava o timestamp');
  // E o clear continua lendo `.timestamp` — os dois tem de casar.
  const i = IA_SRC.indexOf('function clearOldHistorico');
  const bloco = IA_SRC.slice(i, i + 600);
  contem(bloco, 'lastMsg.timestamp', 'a limpeza le o timestamp');
});

// ---------------------------------------------------------------------------
// 4) O BANCO RESPEITA O `DATABASE_PATH` (nao escreve no repositorio)
// ---------------------------------------------------------------------------
console.log('\n=== 4) O BANCO ISOLADO ===\n');

await test('12. o userContext.json fica sob o DATABASE_PATH (nao no repo)', async () => {
  const dbMod = await import(new URL('../dados/src/utils/userContextDB.js', import.meta.url).href);
  const db = dbMod.default;   // o singleton (o modulo so' exporta `default`)
  const paths = await import(new URL('../dados/src/utils/paths.js', import.meta.url).href);

  // 1) O caminho RESOLVIDO e' o do tmp (nao o do repositorio). Isto e' a
  //    asserção de verdade — nao depende do debounce do save.
  ok(paths.USER_CONTEXT_FILE.startsWith(TMP_DB),
    `o caminho vem do DATABASE_PATH (veio ${paths.USER_CONTEXT_FILE})`);
  naoContem(paths.USER_CONTEXT_FILE, path.join('dados', 'database'),
    'nao aponta para o `dados/database` do repositorio');

  // 2) E o banco GRAVA nesse caminho (a prova de ponta a ponta). O `saveDatabase`
  //    tem debounce de 2s e coalesce chamadas (`isSaving`), entao esperamos o
  //    arquivo APARECER em vez de assumir que esta pronto.
  const alvo = path.join(TMP_DB, 'userContext.json');
  try { fs.unlinkSync(alvo); } catch { /* ainda nao existia */ }
  db.data['probe|teste|lizzy'] = db.createNewUserContext('probe|teste|lizzy');
  db.saveDatabase();
  const prazo = Date.now() + 6000;
  while (!fs.existsSync(alvo) && Date.now() < prazo) {
    await new Promise((r) => setTimeout(r, 150));
  }
  ok(fs.existsSync(alvo), 'o arquivo foi criado sob o DATABASE_PATH');

  // 3) O arquivo do REPOSITORIO nao recebeu nada deste teste.
  const repo = new URL('../dados/database/userContext.json', import.meta.url);
  const conteudoRepo = fs.existsSync(repo) ? fs.readFileSync(repo, 'utf-8') : '';
  naoContem(conteudoRepo, 'probe|teste|lizzy', 'o arquivo do repo NAO foi tocado');
  delete db.data['probe|teste|lizzy'];
});

// ---------------------------------------------------------------------------
console.log('\n' + '='.repeat(60));
const tot = RESULTS.reduce((a, r) => a + r.passed, 0);
const fal = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log(`RESULTADO: ${RESULTS.length} testes | ${tot} asserções ok | ${fal} falhas`);
console.log('='.repeat(60));
process.exit(fal ? 1 : 0);
