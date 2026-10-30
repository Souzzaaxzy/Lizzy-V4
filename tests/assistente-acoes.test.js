/**
 * AÇÕES DO GRUPO da assistente: `link` e `foto`.
 *
 * O dono pediu:
 *   - *"na foto eu quero que ela mande a foto do grupo normalmente no chat"*;
 *   - *"qualquer membro manda 'lizzy manda o link do grupo' aí ela manda"*.
 *
 * O reconhecimento é **determinístico** (`utils/assistenteAcoes.js`), não pelo
 * LLM: são pedidos objetivos, e o modelo **não tem** o convite do grupo — ele
 * inventaria um link. Além disso, uma foto só se MOSTRA enviando imagem; no
 * contexto ela existe apenas como URL em texto.
 *
 * Uso: node tests/assistente-acoes.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-acoes-'));
process.env.DATABASE_PATH = TMP_DB;
process.env.CONFIG_PATH = path.join(TMP_DB, 'config.json');
fs.mkdirSync(path.join(TMP_DB, 'grupos'), { recursive: true });
fs.mkdirSync(path.join(TMP_DB, 'dono'), { recursive: true });
fs.writeFileSync(process.env.CONFIG_PATH, JSON.stringify({
  prefixo: '!', nomebot: 'Lizzy do privy', nomedono: 'Kannon',
  numerodono: '5511915323638', debug: false
}, null, 2));

// A VOZ ESPONTANEA (25%) tornaria estes testes FLAKY: as vezes a resposta sai
// em audio (sem `text`) e as assercoes de TEXTO falham. Aqui o foco e' o texto,
// entao a voz e' desligada pela env — e PRECISA vir ANTES do import: a
// constante e' lida no LOAD do modulo (`vozDaConversa.js`).
process.env.LIZZY_VOZ_ESPONTANEA = '0';

const acoes = await import(new URL('../dados/src/utils/assistenteAcoes.js', import.meta.url).href);
const groq = await import(new URL('../dados/src/utils/groqClient.js', import.meta.url).href);
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

const INDEX = fs.readFileSync(new URL('../dados/src/index.js', import.meta.url), 'utf-8');

// ---------------------------------------------------------------------------
// 1) O RECONHECEDOR (corpus medido)
// ---------------------------------------------------------------------------
console.log('\n=== 1) O RECONHECEDOR ===\n');

// Frases que DEVEM ser reconhecidas (com a ação esperada).
const POSITIVOS = [
  ['manda o link do grupo', 'link'],
  ['Lizzy, manda o link do grupo', 'link'],
  ['me manda o link do grupo', 'link'],
  ['manda o link do gp', 'link'],
  ['qual o link do grupo?', 'link'],
  ['envia o link do grupo', 'link'],
  ['quero o link do grupo', 'link'],
  ['me passa o link do grupo', 'link'],
  ['manda o convite do grupo', 'link'],
  ['manda o link', 'link'],
  ['link do grupo', 'link'],
  ['LIZZY MANDA O LINK DO GRUPO', 'link'],
  ['manda a foto do grupo', 'foto'],
  ['me manda a foto do grupo', 'foto'],
  ['qual a foto do grupo?', 'foto'],
  ['envia a foto do grupo', 'foto'],
  ['mostra a foto do grupo', 'foto'],
  ['manda a imagem do grupo', 'foto'],
  ['manda a foto', 'foto'],
  ['manda a ft do grupo', 'foto'],
  ['foto do grupo', 'foto'],
  ['Lizzy, foto do grupo', 'foto'],
  ['me manda a foto do grupo por favor', 'foto']
];

// Frases que NÃO podem virar ação (falso positivo é o risco real).
const NEGATIVOS = [
  'bom dia pessoal',
  'o link do grupo ta quebrado',
  'gente o link do grupo ta quebrado de novo',
  'esse link do grupo e antigo',
  'manda o link da musica',
  'manda o link do tiktok',
  'manda a foto da minha mae',
  'manda uma figurinha',
  'toca uma musica',
  'qual a letra dessa musica',
  'como esta o tempo hoje',
  'o grupo ta muito bom hoje galera',
  'a foto do grupo ficou bonita ne',
  'alguem tem o link daquele video',
  'manda o pdf do trabalho',
  'me explica como funciona o grupo',
  'que horas sao',
  'lizzy voce e otima'
];

await test('1. reconhece os pedidos de LINK e de FOTO', () => {
  let ruins = [];
  for (const [txt, esperado] of POSITIVOS) {
    const r = acoes.identificarAcaoDoGrupo(txt);
    if (!r || r.acao !== esperado) ruins.push(`"${txt}" -> ${JSON.stringify(r)} (esperado ${esperado})`);
  }
  ok(ruins.length === 0, `todos os ${POSITIVOS.length} reconhecidos — falharam: ${ruins.join(' | ')}`);
});

await test('2. NAO dispara em conversa (zero falso positivo)', () => {
  let ruins = [];
  for (const txt of NEGATIVOS) {
    const r = acoes.identificarAcaoDoGrupo(txt);
    if (r !== null) ruins.push(`"${txt}" -> ${JSON.stringify(r)}`);
  }
  ok(ruins.length === 0, `nenhum falso positivo — dispararam: ${ruins.join(' | ')}`);
});

await test('3. comentario sobre o link NAO e pedido', () => {
  // O risco classico: alguem reclama do link e a Lizzy manda o link.
  ok(acoes.identificarAcaoDoGrupo('o link do grupo ta quebrado') === null, 'reclamacao nao e pedido');
  ok(acoes.identificarAcaoDoGrupo('esse link do grupo e antigo') === null, 'comentario nao e pedido');
  ok(acoes.identificarAcaoDoGrupo('a foto do grupo ficou bonita') === null, 'elogio nao e pedido');
});

await test('4. fala de OUTRO objeto nao vira link/foto do grupo', () => {
  ok(acoes.identificarAcaoDoGrupo('manda o link da musica') === null, 'link de musica');
  ok(acoes.identificarAcaoDoGrupo('manda o link do tiktok') === null, 'link do tiktok');
  ok(acoes.identificarAcaoDoGrupo('manda a foto da minha mae') === null, 'foto de outra pessoa');
  ok(acoes.identificarAcaoDoGrupo('manda o pdf do trabalho') === null, 'documento');
});

await test('5. entrada invalida nao quebra', () => {
  ok(acoes.identificarAcaoDoGrupo('') === null, 'vazio');
  ok(acoes.identificarAcaoDoGrupo(null) === null, 'null');
  ok(acoes.identificarAcaoDoGrupo(undefined) === null, 'undefined');
  ok(acoes.identificarAcaoDoGrupo(12345) === null, 'numero');
  ok(acoes.identificarAcaoDoGrupo('link') === null, 'so a palavra, sem pedido nem grupo');
});

await test('6. as frases de ajuda existem (para o prompt)', () => {
  const ajuda = acoes.frasesDeAjudaDoGrupo();
  ok(typeof ajuda === 'string' && ajuda.includes('link do grupo'), 'fala do link');
  ok(ajuda.includes('foto do grupo'), 'fala da foto');
});

// ---------------------------------------------------------------------------
// 2) O HANDLER (fluxo real)
// ---------------------------------------------------------------------------
console.log('\n=== 2) O HANDLER ===\n');

const GRUPO = '120363425268923269@g.us';
const MEMBRO = '5511988887777:1@s.whatsapp.net';   // membro COMUM (nao admin)
const BOT = '127642753843383:1@s.whatsapp.net';
const CODIGO = 'ABC123XYZ';

let CHAMOU_LLM = false;
function dublarGroq() {
  groq.setGroqHttpForTest(async () => {
    CHAMOU_LLM = true;
    return { data: { choices: [{ message: { content: '{"resp":[{"resp":"ok"}]}' } }] } };
  });
  process.env.GROQ_API_KEY = 'gsk-teste';
}

function fakeSock(sent, { comFoto = true } = {}) {
  return {
    user: { id: BOT, lid: BOT },
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    sendMessage: async (jid, c) => { sent.push(c); return { key: { id: 'X' } }; },
    sendPresenceUpdate: async () => {},
    groupMetadata: async () => ({
      subject: 'geralbot', creation: 1742000000, desc: 'grupo de teste',
      owner: MEMBRO,
      participants: [
        { id: MEMBRO, lid: '111@lid', admin: 'superadmin', notify: 'Fulano' },
        { id: BOT, lid: BOT, admin: 'admin', notify: 'Lizzy' }
      ]
    }),
    groupInviteCode: async () => CODIGO,
    contacts: { getName: async () => undefined },
    profilePictureUrl: async () => {
      if (!comFoto) throw new Error('no picture');
      return 'https://exemplo/foto-grupo.jpg';
    },
    react: async () => ({}), waitForMessage: async () => undefined, chatModify: async () => ({})
  };
}

async function rodar(texto, { grupo = GRUPO, comFoto = true, grupoExtra = {} } = {}) {
  CHAMOU_LLM = false;
  dublarGroq();
  fs.writeFileSync(path.join(TMP_DB, 'grupos', `${GRUPO}.json`), JSON.stringify({
    assistente: true, groupName: 'geralbot', prefixo: '!', ...grupoExtra
  }, null, 2));
  const sent = [];
  const info = {
    key: { remoteJid: grupo, fromMe: false, id: `M-${Math.random().toString(36).slice(2, 8)}`, participant: MEMBRO },
    message: { extendedTextMessage: { text: texto, contextInfo: { remoteJid: grupo } } },
    messageTimestamp: Math.floor(Date.now() / 1000), pushName: 'Fulano'
  };
  await handleMessage(fakeSock(sent, { comFoto }), info, null, new Map(), null);
  await new Promise((r) => setTimeout(r, 300));
  return { enviados: sent, llm: CHAMOU_LLM };
}

await test('7. "manda o link do grupo" -> manda o LINK de verdade (e nao chama o LLM)', async () => {
  const r = await rodar('Lizzy, manda o link do grupo');
  const t = r.enviados.map((c) => c.text || c.caption || '').join('\n');
  ok(t.includes(`https://chat.whatsapp.com/${CODIGO}`), `o link com o codigo real — veio: ${t}`);
  ok(!r.llm, 'o LLM NAO foi chamado (deterministico)');
});

await test('8. "manda a foto do grupo" -> envia a FOTO como IMAGEM', async () => {
  const r = await rodar('Lizzy, manda a foto do grupo');
  const comImagem = r.enviados.find((c) => c.image);
  ok(Boolean(comImagem), 'enviou uma imagem (nao a URL em texto)');
  ok(comImagem?.image?.url === 'https://exemplo/foto-grupo.jpg', `a URL da foto — veio ${comImagem?.image?.url}`);
  ok(typeof comImagem?.caption === 'string' && comImagem.caption.includes('Foto do grupo'), 'com legenda');
  ok(!r.llm, 'o LLM NAO foi chamado');
});

await test('9. QUALQUER membro pode pedir (nao exige admin)', async () => {
  // O `MEMBRO` e `superadmin` no metadata do teste — o ponto aqui e' que o
  // caminho NAO tem checagem de admin (diferente do `!linkgp`).
  const i = INDEX.indexOf('const acaoDoGrupo =');
  ok(i > 0, 'o bloco da acao existe');
  const bloco = INDEX.slice(i, i + 1600);
  ok(!/isGroupAdmin|isBotAdmin|isOwner/.test(bloco), 'nao exige admin/dono');
  // E o comando de admin continua sendo outro (o `!linkgp`).
  ok(INDEX.includes("case 'linkgp':"), 'o `!linkgp` (admin) segue existindo');
});

await test('10. grupo SEM foto -> avisa, nao manda imagem vazia', async () => {
  const r = await rodar('Lizzy, manda a foto do grupo', { comFoto: false });
  ok(!r.enviados.some((c) => c.image), 'nao enviou imagem');
  const t = r.enviados.map((c) => c.text || '').join('\n');
  ok(t.includes('não tem foto') || t.includes('nao tem foto'), `avisou — veio: ${t}`);
});

await test('11. falha do WhatsApp -> mensagem amigavel (sem stack)', async () => {
  const sent = [];
  const sock = fakeSock(sent);
  sock.groupInviteCode = async () => { throw new Error('boom no servidor'); };
  const info = {
    key: { remoteJid: GRUPO, fromMe: false, id: 'MF', participant: MEMBRO },
    message: { extendedTextMessage: { text: 'Lizzy, manda o link do grupo', contextInfo: { remoteJid: GRUPO } } },
    messageTimestamp: Math.floor(Date.now() / 1000), pushName: 'Fulano'
  };
  await handleMessage(sock, info, null, new Map(), null);
  await new Promise((r) => setTimeout(r, 300));
  const t = sent.map((c) => c.text || '').join('\n');
  ok(t.includes('Não consegui') || t.includes('Nao consegui'), `mensagem amigavel — veio: ${t}`);
  ok(!t.includes('boom no servidor'), 'nao vaza o erro interno');
});

await test('12. no PRIVADO nao tenta buscar link/foto de grupo', async () => {
  const r = await rodar('manda o link do grupo', { grupo: '5511915323638@s.whatsapp.net' });
  const t = r.enviados.map((c) => c.text || c.caption || '').join('\n');
  ok(!t.includes('chat.whatsapp.com'), 'nao manda link de grupo no privado');
});

await test('13. conversa normal continua indo para o LLM', async () => {
  const r = await rodar('Lizzy, tudo bem com voce?');
  ok(r.llm, 'o LLM foi chamado para conversa');
  const t = r.enviados.map((c) => c.text || '').join('\n');
  ok(t.includes('ok'), `respondeu pelo LLM — veio: ${t}`);
});

await test('14. o handler usa o reconhecedor compartilhado', () => {
  ok(INDEX.includes("from './utils/assistenteAcoes.js'"), 'importa o modulo');
  ok(INDEX.includes('identificarAcaoDoGrupo('), 'chama o reconhecedor');
  // E roda ANTES de montar o pedido ao LLM (nao gasta cota a toa).
  const iAcao = INDEX.indexOf('const acaoDoGrupo =');
  const iLlm = INDEX.indexOf('ia.makeAssistentRequest({');
  ok(iAcao > 0 && iLlm > iAcao, 'a acao e resolvida ANTES do LLM');
});

// ---------------------------------------------------------------------------
console.log('\n' + '='.repeat(60));
const tot = RESULTS.reduce((a, r) => a + r.passed, 0);
const fal = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log(`RESULTADO: ${RESULTS.length} testes | ${tot} asserções ok | ${fal} falhas`);
console.log('='.repeat(60));
process.exit(fal ? 1 : 0);
