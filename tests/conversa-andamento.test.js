/**
 * CONVERSA EM ANDAMENTO + o "olhar tudo" de graca.
 *
 * ## Os dois pedidos do dono (out/2026)
 *
 * 1. *"quero que tipo, eu seu marquei/citei/falei o nome dela chamando ela,
 *    comecei a conversar e respondi ela sem marcar ela ou responder, ela entende
 *    que ainda estou conversando com ela e me responde, mas isso tem que ser
 *    MUITO bem calibrado."*
 * 2. O "olhar tudo" do grupo **sem gastar token por mensagem**.
 *
 * Uso: node tests/conversa-andamento.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

process.env.LIZZY_VOZ_ESPONTANEA = '0';
process.env.LIZZY_CONVERSA_PAUSA_MS = '0';   // o teste controla o tempo

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-conv-'));
process.env.DATABASE_PATH = TMP_DB;
process.env.CONFIG_PATH = path.join(TMP_DB, 'config.json');
fs.mkdirSync(path.join(TMP_DB, 'grupos'), { recursive: true });
fs.mkdirSync(path.join(TMP_DB, 'dono'), { recursive: true });
fs.writeFileSync(process.env.CONFIG_PATH, JSON.stringify({
  prefixo: '!', nomebot: 'Lizzy', nomedono: 'Kannon', numerodono: '5511915323638'
}, null, 2));

const conv = await import(new URL('../dados/src/utils/conversaEmAndamento.js', import.meta.url).href);
const groq = await import(new URL('../dados/src/utils/groqClient.js', import.meta.url).href);
const ia = await import(new URL('../dados/src/funcs/private/ia.js', import.meta.url).href);
const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;
const INDEX = fs.readFileSync(new URL('../dados/src/index.js', import.meta.url), 'utf-8');

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

// ============================================================================
console.log('\n=== 1) AS TRAVAS DA CONVERSA (puro) ===\n');

await test('1. a JANELA: sem ter chamado, nao continua', () => {
  const c = new conv.ConversasEmAndamento({});
  const r = c.deveContinuar({ grupo: 'g', pessoa: 'p', texto: 'e ai, tudo bem?', agora: 1000 });
  ok(r.responder === false && r.motivo === 'sem_janela', 'sem janela -> nao responde');
});

await test('2. depois de CHAMAR, a conversa continua', () => {
  const c = new conv.ConversasEmAndamento({});
  c.abrir('g', 'p', 1000);
  const r = c.deveContinuar({ grupo: 'g', pessoa: 'p', texto: 'e voce, como ta?', agora: 2000 });
  ok(r.responder === true && r.motivo === 'continuacao', 'continua a conversa');
});

await test('3. a JANELA expira (nao responde 1h depois)', () => {
  const env = { LIZZY_CONVERSA_JANELA_MS: '60000' };   // 1 min
  const c = new conv.ConversasEmAndamento(env);
  c.abrir('g', 'p', 1000);
  ok(c.deveContinuar({ grupo: 'g', pessoa: 'p', texto: 'oi de novo', agora: 30000 }).responder === true, 'dentro da janela');
  ok(c.deveContinuar({ grupo: 'g', pessoa: 'p', texto: 'oi de novo', agora: 120000 }).responder === false, 'fora da janela');
  ok(c.deveContinuar({ grupo: 'g', pessoa: 'p', texto: 'oi', agora: 130000 }).motivo === 'sem_janela', 'a janela foi fechada');
});

await test('4. o LIMITE de trocas: ela para depois de N', () => {
  const env = { LIZZY_CONVERSA_MAX_TROCAS: '3' };
  const c = new conv.ConversasEmAndamento(env);
  c.abrir('g', 'p', 1000);
  let t = 1000;
  let respondeu = 0;
  for (let i = 0; i < 6; i++) {
    t += 5000;
    const r = c.deveContinuar({ grupo: 'g', pessoa: 'p', texto: `pergunta ${i}`, agora: t });
    if (r.responder) { respondeu += 1; c.registrouResposta('g', 'p', t); }
  }
  ok(respondeu === 3, `respondeu exatamente 3 trocas (veio ${respondeu})`);
});

await test('5. SEM CONTEUDO nao puxa resposta (o "kkkkk")', () => {
  const c = new conv.ConversasEmAndamento({});
  c.abrir('g', 'p', 1000);
  let t = 1000;
  for (const texto of ['kkkkk', 'sim', 'nao', 'ok', 'vlw', 'boa', '😂', '👍', 'blz', 'eae']) {
    t += 5000;
    const r = c.deveContinuar({ grupo: 'g', pessoa: 'p', texto, agora: t });
    ok(r.responder === false && r.motivo === 'sem_conteudo', `"${texto}" nao puxa resposta`);
  }
  // E as com conteudo puxam.
  t += 5000;
  ok(c.deveContinuar({ grupo: 'g', pessoa: 'p', texto: 'voce gosta de musica?', agora: t }).responder === true, 'com conteudo, responde');
});

await test('6. a PAUSA: nao responde 2 mensagens em 1 segundo', () => {
  const env = { LIZZY_CONVERSA_PAUSA_MS: '2000' };
  const c = new conv.ConversasEmAndamento(env);
  c.abrir('g', 'p', 1000);
  ok(c.deveContinuar({ grupo: 'g', pessoa: 'p', texto: 'primeira pergunta', agora: 1000 }).responder === true, 'a 1a responde');
  c.registrouResposta('g', 'p', 1000);
  ok(c.deveContinuar({ grupo: 'g', pessoa: 'p', texto: 'segunda pergunta', agora: 2000 }).motivo === 'pausa_curta', 'a 2a (1s) espera');
  ok(c.deveContinuar({ grupo: 'g', pessoa: 'p', texto: 'segunda pergunta', agora: 4000 }).responder === true, 'a 2a (3s) responde');
});

await test('7. OUTRA PESSOA nao herda a conversa (a janela e por pessoa)', () => {
  const c = new conv.ConversasEmAndamento({});
  c.abrir('g', 'p1', 1000);
  ok(c.deveContinuar({ grupo: 'g', pessoa: 'p1', texto: 'continuando', agora: 2000 }).responder === true, 'a mesma pessoa continua');
  ok(c.deveContinuar({ grupo: 'g', pessoa: 'p2', texto: 'oi lizzy', agora: 2000 }).responder === false, 'outra pessoa NAO herda');
  // E outro grupo tambem nao.
  ok(c.deveContinuar({ grupo: 'outro', pessoa: 'p1', texto: 'oi', agora: 2000 }).responder === false, 'outro grupo NAO herda');
});

await test('8. chamar de novo REABRE (e zera as trocas)', () => {
  const c = new conv.ConversasEmAndamento({});
  c.abrir('g', 'p', 1000);
  c.registrouResposta('g', 'p', 1000);
  c.registrouResposta('g', 'p', 2000);
  ok(c.trocas('g', 'p') === 2, 'contou as trocas');
  c.abrir('g', 'p', 3000);
  ok(c.trocas('g', 'p') === 0, 'chamar de novo zera as trocas');
});

await test('9. o PEDIDO DE PARADA e reconhecido', () => {
  for (const t of ['chega', 'para', 'cala a boca', 'fica quieta', 'silencio', 'deixa ela em paz']) {
    ok(conv.ehPedidoDeParada(t) === true, `"${t}" e pedido de parada`);
  }
  for (const t of ['para de ser boba comigo ta bom', 'voce para e pensa', 'oi tudo bem']) {
    ok(conv.ehPedidoDeParada(t) === false, `"${t}" NAO e pedido de parada`);
  }
});

await test('10. fechar encerra a conversa na hora', () => {
  const c = new conv.ConversasEmAndamento({});
  c.abrir('g', 'p', 1000);
  c.fechar('g', 'p');
  ok(c.deveContinuar({ grupo: 'g', pessoa: 'p', texto: 'oi de novo', agora: 2000 }).motivo === 'sem_janela', 'fechada');
});

// ============================================================================
console.log('\n=== 2) O "OLHAR TUDO" (0 token) ===\n');

await test('11. as mensagens do grupo entram no historico SEM chamar a IA', () => {
  const chave = 'g@g.us|p@s.whatsapp.net|lizzy';
  const n = ia.absorverContextoDoGrupo({ grupoUserId: chave, mensagens: [
    { id: 'x1', texto: 'alguem viu o jogo ontem?', nome: 'Joao', fromMe: false },
    { id: 'x2', texto: 'foi bom demais', nome: 'Maria', fromMe: false }
  ]});
  ok(n === 2, `absorveu 2 (veio ${n})`);
});

await test('12. a MESMA mensagem nao entra duas vezes', () => {
  const chave = 'g2@g.us|p@s.whatsapp.net|lizzy';
  const msgs = [{ id: 'y1', texto: 'primeira', nome: 'A', fromMe: false }];
  ok(ia.absorverContextoDoGrupo({ grupoUserId: chave, mensagens: msgs }) === 1, 'entrou 1');
  ok(ia.absorverContextoDoGrupo({ grupoUserId: chave, mensagens: msgs }) === 0, 'nao duplicou');
  ok(ia.absorverContextoDoGrupo({ grupoUserId: chave, mensagens: [...msgs, { id: 'y2', texto: 'segunda', nome: 'B', fromMe: false }] }) === 1, 'só a nova entrou');
});

await test('13. entrada invalida nao quebra', () => {
  ok(ia.absorverContextoDoGrupo({}) === 0, 'sem argumento');
  ok(ia.absorverContextoDoGrupo({ grupoUserId: 'k', mensagens: null }) === 0, 'mensagens null');
  ok(ia.absorverContextoDoGrupo({ grupoUserId: 'k', mensagens: [{ id: '', texto: '' }] }) === 0, 'vazio');
});

// ============================================================================
console.log('\n=== 3) O FLUXO REAL (handler + Groq dublado) ===\n');

const GRUPO = '120363999000000001@g.us';
const BOT_LID = '111111111111111@lid';
const KANNON = { lid: '5511915323638:1@s.whatsapp.net', jid: '5511915323638@s.whatsapp.net' };
const OUTRO = { lid: '5511999999999:1@s.whatsapp.net', jid: '5511999999999@s.whatsapp.net' };

let chamadas = 0;
function dublarGroq() {
  chamadas = 0;
  groq.setGroqHttpForTest(async () => {
    chamadas += 1;
    return { data: { choices: [{ message: { content: JSON.stringify({ resp: [{ resp: 'oi, tudo bem sim!' }] }) } }] } };
  });
  process.env.GROQ_API_KEY = 'gsk-teste';
}

function grupoFile() {
  fs.writeFileSync(path.join(TMP_DB, 'grupos', `${GRUPO}.json`), JSON.stringify({
    assistente: true, groupName: 'G', prefixo: '!'
  }, null, 2));
}

const CACHE = new Map();
async function run(texto, autor = KANNON) {
  grupoFile();
  const sent = [];
  const ev = { _h: {}, on(t, f) { (this._h[t] = this._h[t] || []).push(f); }, emit(t, p) { (this._h[t] || []).forEach((f) => f(p)); }, removeAllListeners() {} };
  const nazu = {
    user: { id: BOT_LID, lid: BOT_LID }, ev,
    sendMessage: async (jid, c) => { sent.push(c); return { key: { id: 'S' + sent.length } }; },
    sendPresenceUpdate: async () => {}, react: async () => ({}),
    groupMetadata: async () => ({
      id: GRUPO, subject: 'G', owner: KANNON.jid,
      participants: [
        { id: KANNON.lid, admin: 'superadmin', phoneNumber: KANNON.jid, notify: 'Kannon' },
        { id: OUTRO.lid, admin: null, phoneNumber: OUTRO.jid, notify: 'Fulano' },
        { id: BOT_LID, admin: 'admin' }
      ]
    }),
    contacts: { getName: async (j) => (j.includes('5511915323638') ? 'Kannon' : (j.includes('5511999999999') ? 'Fulano' : null)) },
    waitForMessage: async () => undefined, chatModify: async () => ({}), profilePictureUrl: async () => null,
  };
  const id = 'M' + Math.random().toString(36).slice(2, 8);
  const info = {
    key: { remoteJid: GRUPO, fromMe: false, id, participant: autor.lid },
    message: { extendedTextMessage: { text: texto, contextInfo: { remoteJid: GRUPO } } },
    messageTimestamp: Math.floor(Date.now() / 1000), pushName: 'Kannon',
  };
  CACHE.set(`${GRUPO}_${id}`, info);
  await handleMessage(nazu, info, null, CACHE, null);
  await new Promise((r) => setTimeout(r, 700));
  return sent.filter((c) => c.text).map((c) => c.text);
}

await test('14. a conversa continua SEM marcar (o pedido do dono)', async () => {
  dublarGroq();
  const a = await run('lizzy, oi tudo bem?');       // chamada explicita: abre a janela
  ok(a.length > 0, 'ela respondeu a chamada');
  const b = await run('e voce, como ta?');          // sem marcar: continua
  ok(b.length > 0, 'continuou a conversa SEM marcar');
  const c = await run('ta fazendo o que?');         // sem marcar: continua
  ok(c.length > 0, 'continuou de novo');
  groq.setGroqHttpForTest(null);
});

await test('15. ela NAO responde "kkkkk" (a trava do sem-conteudo)', async () => {
  dublarGroq();
  await run('lizzy, oi!');
  const antes = chamadas;
  const r = await run('kkkkk');
  ok(r.length === 0, 'ficou quieta no "kkkkk"');
  ok(chamadas === antes, 'e NAO gastou chamada de IA');
  groq.setGroqHttpForTest(null);
});

await test('16. ela PARA no limite de trocas (nao conversa "para sempre")', async () => {
  dublarGroq();
  await run('lizzy, oi!');                          // abre
  const respostas = [];
  for (let i = 0; i < 8; i++) {
    const r = await run(`me conta uma historia numero ${i}`);
    respostas.push(r.length > 0);
  }
  const quantas = respostas.filter(Boolean).length;
  // O teto padrao e' 4 trocas.
  ok(quantas === 4, `respondeu exatamente 4 trocas (veio ${quantas})`);
  groq.setGroqHttpForTest(null);
});

await test('17. OUTRA pessoa falando nao puxa a conversa do dono', async () => {
  dublarGroq();
  await run('lizzy, oi!', KANNON);                  // abre a janela do KANNON
  const antes = chamadas;
  const r = await run('alguem viu o jogo?', OUTRO); // outra pessoa, sem marcar
  ok(r.length === 0, 'ela NAO respondeu a outra pessoa');
  ok(chamadas === antes, 'e nao gastou chamada');
  groq.setGroqHttpForTest(null);
});

await test('18. o "chega" fecha a conversa na hora', async () => {
  dublarGroq();
  await run('lizzy, oi!');
  await run('chega');
  const r = await run('e ai, tudo bem?');
  ok(r.length === 0, 'depois do "chega" ela nao continua');
  groq.setGroqHttpForTest(null);
});

await test('19. o CONTEXTO do grupo vai para a IA (o "olhar tudo")', () => {
  // O handler monta o contexto do CACHE e passa no extraContext.
  ok(INDEX.includes('contextoDoGrupoDoCache('), 'monta o contexto do cache');
  ok(INDEX.includes('contextoDoGrupo,'), 'passa no extraContext');
  const i = INDEX.indexOf('contextoDoGrupoDoCache(messagesCache');
  ok(i > 0, 'usa o messagesCache (o mesmo store do bot)');
  // E o ia.js absorve.
  ok(INDEX.includes('contextoDoGrupo'), 'o extraContext carrega o contexto');
});

await test('20. uma mensagem = no MAXIMO uma chamada de IA (nunca "ler tudo")', () => {
  // O `deveContinuar` e' LOCAL (custo 0) e a IA so entra quando ela responde.
  const i = INDEX.indexOf('conversas.deveContinuar(');
  const j = INDEX.indexOf('ia.makeAssistentRequest({', i);
  ok(i > 0 && j > i, 'a decisao e LOCAL e vem ANTES da chamada de IA');
  ok(INDEX.includes('conversas.registrouResposta('), 'conta a troca quando responde');
});

// ============================================================================
console.log('\n' + '='.repeat(60));
const tot = RESULTS.reduce((a, r) => a + r.passed, 0);
const fal = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log(`RESULTADO: ${RESULTS.length} testes | ${tot} asserções ok | ${fal} falhas`);
console.log('='.repeat(60));
process.exit(fal ? 1 : 0);
