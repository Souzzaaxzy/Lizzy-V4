/**
 * COMANDOS POR TEXTO da assistente + FALAS NATURAIS + MENÇÕES.
 *
 * Pedido do dono: *"agora vamos dar comandos a ela, e resposta aos comandos
 * também... eu quero que ela tenha uma fala de resposta junto desses comandos.
 * aí você adiciona os comandos: play, pin, figurinha aleatória, e o `!s` em modo
 * busca, exemplo 'lizzy me manda uma figurinha do <busca>'... e eu quero uma
 * fala natural para cada evento desse!!!! eu também quero que ela seja capaz de
 * mencionar usuários do grupo... 'lizzy, chama o usuário para mim'"*.
 *
 * O que este teste trava:
 *   1. o RECONHECIMENTO (`identificarAcaoDoBot`) — incluindo os NEGATIVOS
 *      (comentário não vira comando);
 *   2. a FALA por evento (`falaDoEvento`) — variedade e marcadores;
 *   3. a MENÇÃO por nome (`acharUsuarioPorNome`) — match, ambiguidade e número;
 *   4. o FLUXO REAL (handler de verdade): a fala sai junto da ação e a menção
 *      sai com o `@` na BASE (sem `:device`, senão não renderiza).
 *
 * Uso: node tests/assistente-comandos.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

// A voz espontânea (25%) tornaria o teste FLAKY. Precisa vir ANTES do import:
// a constante é lida no LOAD do módulo.
process.env.LIZZY_VOZ_ESPONTANEA = '0';

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-cmd-'));
process.env.DATABASE_PATH = TMP_DB;
process.env.CONFIG_PATH = path.join(TMP_DB, 'config.json');
fs.mkdirSync(path.join(TMP_DB, 'grupos'), { recursive: true });
fs.mkdirSync(path.join(TMP_DB, 'dono'), { recursive: true });
fs.writeFileSync(process.env.CONFIG_PATH, JSON.stringify({
  prefixo: '!', nomebot: 'Lizzy do privy', nomedono: 'Kannon',
  numerodono: '5511915323638', debug: false
}, null, 2));

const acoes = await import(new URL('../dados/src/utils/assistenteAcoes.js', import.meta.url).href);
const mencao = await import(new URL('../dados/src/utils/mencaoUsuario.js', import.meta.url).href);
const falas = await import(new URL('../dados/src/utils/falasLizzy.js', import.meta.url).href);
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
// 1) O RECONHECIMENTO
// ============================================================================
console.log('\n=== 1) O RECONHECIMENTO ===\n');

await test('1. reconhece os pedidos dos comandos (o corpus do dono)', () => {
  const casos = [
    ['manda o link do grupo', 'link'],
    ['lizzy me manda a foto do grupo', 'foto'],
    ['toca a musica Evidencias', 'play'],
    ['me toca Evidencias', 'play'],
    ['baixa a musica X', 'play'],
    ['quero ouvir Djavan', 'play'],
    ['procura no pinterest gatinhos', 'pin'],
    ['manda uma figurinha', 'figurinha'],
    ['me manda uma figurinha aleatoria', 'figurinha'],
    ['lizzy me manda uma figurinha de gato', 'stickerBusca'],
    ['manda um sticker de pizza', 'stickerBusca'],
    ['lizzy manda uma figurinha do naruto', 'stickerBusca'],
    // FOTO de algo = `!pin` (pedido do dono): "o `!pin` e' foto".
    ['me manda uma foto de gato', 'pin'],
    ['lizzy me manda uma foto do naruto', 'pin'],
    ['manda uma imagem de cachorro', 'pin'],
    // ...mas a foto DO GRUPO continua sendo a foto do grupo.
    ['manda a foto do grupo', 'foto'],
    ['lizzy me manda a foto do grupo', 'foto']
  ];
  for (const [texto, esperado] of casos) {
    const r = acoes.identificarAcaoDoBot(texto);
    ok(r?.acao === esperado, `"${texto}" -> ${esperado} (veio ${r?.acao || 'null'})`);
  }
});

await test('2. o TERMO sai limpo (sem a moldura do pedido)', () => {
  const casos = [
    ['toca a musica Evidencias', 'Evidencias'],
    ['lizzy me manda uma figurinha de gato', 'gato'],
    ['manda um sticker de pizza', 'pizza'],
    ['procura no pinterest gatinhos', 'gatinhos'],
    ['manda um pin de flores', 'flores'],
    ['me manda uma foto de gato', 'gato'],
    ['lizzy me manda uma foto do naruto', 'naruto']
  ];
  for (const [texto, termo] of casos) {
    const r = acoes.identificarAcaoDoBot(texto);
    ok(r?.termo === termo, `"${texto}" -> termo "${termo}" (veio "${r?.termo}")`);
  }
});

await test('3. COMENTARIO nao vira comando (os negativos)', () => {
  const casos = [
    'o link do grupo ta quebrado',
    'essa figurinha de gato e boa',
    'amo essa musica',
    'vi no tiktok',
    'oi tudo bem',
    'que horas sao',
    'ele falou comigo ontem'
  ];
  for (const texto of casos) {
    const r = acoes.identificarAcaoDoBot(texto);
    ok(r === null, `"${texto}" NAO e comando (veio ${JSON.stringify(r)})`);
  }
});

await test('4. a FIGURINHA POR BUSCA vem antes da aleatoria', () => {
  // Se a ordem invertesse, "figurinha de gato" cairia na aleatoria.
  ok(acoes.identificarAcaoDoBot('manda uma figurinha de gato')?.acao === 'stickerBusca', 'com termo -> busca');
  ok(acoes.identificarAcaoDoBot('manda uma figurinha')?.acao === 'figurinha', 'sem termo -> aleatoria');
});

// ============================================================================
// 2) AS FALAS
// ============================================================================
console.log('\n=== 2) AS FALAS ===\n');

await test('5. cada evento tem fala e elas VARIAM', () => {
  for (const evento of falas.eventosConhecidos()) {
    const dados = { nome: 'Kannon', alvo: '@Joao', termo: 'gato' };
    const vistas = new Set();
    for (let i = 0; i < 40; i++) vistas.add(falas.falaDoEvento(evento, dados));
    ok(vistas.size >= 2, `${evento}: variou (${vistas.size} frases)`);
    for (const f of vistas) {
      ok(f.length > 5 && !/undefined|null|\{|\}/.test(f), `${evento}: fala limpa ("${f}")`);
    }
  }
});

await test('6. os marcadores sao resolvidos (e nao sobram chaves)', () => {
  const f = falas.falaDoEvento('mencao', { nome: 'Kannon', alvo: '@Joao' }, () => 0);
  ok(f.includes('@Joao'), `a mencao entrou ("${f}")`);
  ok(f.includes('Kannon'), `o nome entrou ("${f}")`);
  // Sem o nome, a marca sai e a frase continua legivel.
  const semNome = falas.falaDoEvento('mencao', { alvo: '@Joao' }, () => 0);
  ok(!semNome.includes('{nome}') && !/\s{2,}/.test(semNome), `sem o nome, sem buraco ("${semNome}")`);
});

await test('7. evento desconhecido devolve vazio (nao quebra)', () => {
  ok(falas.falaDoEvento('inexistente') === '', 'evento invalido -> vazio');
  ok(falas.falaDoEvento(null) === '', 'null -> vazio');
});

// ============================================================================
// 3) A MENCAO
// ============================================================================
console.log('\n=== 3) A MENCAO ===\n');

await test('8. reconhece o pedido de mencao (e nao a conversa)', () => {
  const pedidos = [
    'lizzy chama o fulano pra mim',
    'chama o joao',
    'lizzy menciona o Silva',
    'marca o joao que eu quero falar com ele',
    'chama o usuario pra mim'
  ];
  for (const p of pedidos) ok(mencao.identificarPedidoDeMencao(p) !== null, `pedido: "${p}"`);
  const naoPedidos = ['o fulano falou comigo', 'oi tudo bem', 'que horas sao'];
  for (const p of naoPedidos) ok(mencao.identificarPedidoDeMencao(p) === null, `nao-pedido: "${p}"`);
});

await test('9. acha por nome, pedaco do nome e apelido', () => {
  const usuarios = [
    { id: '1@lid', nome: 'Kannon' },
    { id: '2@lid', nome: 'Fulano da Silva', apelido: 'Fulaninho' },
    { id: '3@lid', nome: 'João Pedro' }
  ];
  ok(mencao.acharUsuarioPorNome('kannon', usuarios).usuario?.id === '1@lid', 'nome exato');
  ok(mencao.acharUsuarioPorNome('silva', usuarios).usuario?.id === '2@lid', 'pedaco do nome');
  ok(mencao.acharUsuarioPorNome('fulaninho', usuarios).usuario?.id === '2@lid', 'pelo APELIDO (a memoria)');
  ok(mencao.acharUsuarioPorNome('joao', usuarios).usuario?.id === '3@lid', 'primeiro nome');
  ok(mencao.acharUsuarioPorNome('zezinho', usuarios).achou === false, 'nome inexistente -> nao achou');
});

await test('10. nome AMBIGUO nao escolhe no chute', () => {
  const usuarios = [
    { id: '1@lid', nome: 'João Pedro' },
    { id: '2@lid', nome: 'João Carlos' }
  ];
  const r = mencao.acharUsuarioPorNome('joao', usuarios);
  ok(r.achou === false && r.ambiguo === true, 'dois "joao" -> ambiguo');
  ok(Array.isArray(r.candidatos) && r.candidatos.length === 2, 'devolve os candidatos');
  // Com o nome completo, resolve.
  ok(mencao.acharUsuarioPorNome('joao pedro', usuarios).usuario?.id === '1@lid', 'nome completo resolve');
});

await test('11. numero digitado casa direto (sem ambiguidade)', () => {
  const usuarios = [
    { id: '5511915323638@s.whatsapp.net', nome: 'Kannon', numeros: ['5511915323638'] },
    { id: '5511999999999@s.whatsapp.net', nome: 'Maria', numeros: ['5511999999999'] }
  ];
  ok(mencao.acharUsuarioPorNome('5511999999999', usuarios).usuario?.id.includes('999999999'), 'casa pelo numero');
});

await test('12. cargo/palavra vazia nao vira alvo', () => {
  const usuarios = [{ id: '1@lid', nome: 'Kannon' }];
  for (const t of ['usuario', 'alguem', 'todos', 'admin', 'dono']) {
    ok(mencao.acharUsuarioPorNome(t, usuarios).achou === false, `"${t}" nao e alvo`);
  }
});

// ============================================================================
// 4) O FLUXO REAL
// ============================================================================
console.log('\n=== 4) O FLUXO REAL ===\n');

const GRUPO = '120363999000000001@g.us';
const BOT_LID = '111111111111111@lid';
const KANNON = { lid: '5511915323638:1@s.whatsapp.net', jid: '5511915323638@s.whatsapp.net' };
const MARIA = { lid: '5511999999999:1@s.whatsapp.net', jid: '5511999999999@s.whatsapp.net' };
const JOAO = { lid: '5511988888888:1@s.whatsapp.net', jid: '5511988888888@s.whatsapp.net' };

function grupoFile() {
  fs.writeFileSync(path.join(TMP_DB, 'grupos', `${GRUPO}.json`), JSON.stringify({
    assistente: true, groupName: 'geralbot', prefixo: '!',
    // O apelido do CONTADOR (a "memoria" que o dono citou).
    contador: [{ id: MARIA.lid, pushname: 'Mariazinha' }]
  }, null, 2));
}

function fakeSock(sent) {
  const ev = { _h: {}, on(t, f) { (this._h[t] = this._h[t] || []).push(f); }, emit(t, p) { (this._h[t] || []).forEach((f) => f(p)); }, removeAllListeners() {} };
  return {
    user: { id: BOT_LID, lid: BOT_LID },
    ev,
    sendMessage: async (jid, content) => { sent.push(content); return { key: { id: 'S' + sent.length } }; },
    sendPresenceUpdate: async () => {}, react: async () => ({}),
    groupInviteCode: async () => 'ABC123XYZ',
    profilePictureUrl: async () => 'https://exemplo/foto.jpg',
    groupMetadata: async () => ({
      id: GRUPO, subject: 'geralbot', creation: 1742000000, desc: 'teste', owner: KANNON.jid,
      participants: [
        { id: KANNON.lid, admin: 'superadmin', phoneNumber: KANNON.jid, notify: 'Kannon' },
        { id: MARIA.lid, admin: null, phoneNumber: MARIA.jid, notify: 'Maria' },
        { id: JOAO.lid, admin: 'admin', phoneNumber: JOAO.jid, notify: 'João Pedro' },
        { id: BOT_LID, admin: 'admin' }
      ]
    }),
    contacts: {
      getName: async (j) => (j.includes('5511915323638') ? 'Kannon'
        : (j.includes('5511999999999') ? 'Maria' : (j.includes('5511988888888') ? 'João Pedro' : null)))
    },
    waitForMessage: async () => undefined, chatModify: async () => ({}),
  };
}

async function run(texto) {
  grupoFile();
  const sent = [];
  const sock = fakeSock(sent);
  const info = {
    key: { remoteJid: GRUPO, fromMe: false, id: `M-${Math.random().toString(36).slice(2, 8)}`, participant: KANNON.lid },
    message: { extendedTextMessage: { text: texto, contextInfo: { remoteJid: GRUPO } } },
    messageTimestamp: Math.floor(Date.now() / 1000), pushName: 'Kannon',
  };
  await handleMessage(sock, info, null, new Map(), null);
  await new Promise((r) => setTimeout(r, 900));
  return sent;
}

const textos = (sent) => sent.filter((c) => c.text).map((c) => c.text);

await test('13. o LINK sai com a FALA natural junto', async () => {
  const sent = await run('lizzy me manda o link do grupo');
  const t = textos(sent);
  ok(t.some((x) => x.includes('chat.whatsapp.com')), 'mandou o link');
  ok(t.some((x) => !x.includes('chat.whatsapp.com') && !x.includes('Link do grupo')), 'e mandou uma FALA separada');
});

await test('14. a FOTO sai com a FALA e a imagem de verdade', async () => {
  const sent = await run('lizzy me manda a foto do grupo');
  ok(sent.some((c) => c.image), 'mandou a IMAGEM (nao a URL em texto)');
  ok(textos(sent).some((x) => x.length > 5), 'e mandou uma fala junto');
});

await test('15. FIGURINHA POR BUSCA vira o comando `!s <termo>`', async () => {
  const sent = await run('lizzy me manda uma figurinha de gato');
  // A fala sai e o comando e' reemitido (o proprio handler do `!s` responde).
  ok(textos(sent).some((x) => x.includes('gato')), 'a fala cita o termo');
  ok(INDEX.includes("acaoDoBot.acao === 'stickerBusca' ? 's' : acaoDoBot.acao"), 'reemite o `!s` (mesmo caminho do comando)');
});

await test('16. PLAY e PIN reemitem o COMANDO do bot', async () => {
  const sent = await run('lizzy toca Evidencias');
  ok(textos(sent).length > 0, 'mandou a fala do play');
  // O corpo reemitido e' o comando real (o `!play Evidencias`).
  ok(INDEX.includes('const corpo = `${groupPrefix}${comando}${acaoDoBot.termo ?'), 'monta o comando com o termo');
  ok(INDEX.includes('nazu.ev.emit(\'messages.upsert\''), 'reemite por messages.upsert (o caminho do `!iap`)');
});

await test('16b. as respostas dela saem SEM o contextInfo (newsletter)', async () => {
  // O dono pediu: *"tira o contextInfo newsletter nas falas dela"*.
  for (const pedido of ['lizzy me manda o link do grupo', 'lizzy me manda a foto do grupo', 'lizzy manda uma figurinha']) {
    const sent = await run(pedido);
    ok(sent.length > 0, `"${pedido}" respondeu`);
    for (const c of sent) {
      ok(!c.contextInfo, `"${pedido}": sem contextInfo (veio ${c.contextInfo ? 'SIM' : 'nao'})`);
    }
  }
  // E na mencao tambem.
  const sent = await run('lizzy chama o joao pra mim');
  for (const c of sent) ok(!c.contextInfo, 'mencao sem contextInfo');
});

await test('16c. "me manda uma foto de X" busca no Pinterest (o `!pin` e foto)', async () => {
  const sent = await run('lizzy me manda uma foto de gato');
  ok(textos(sent).length > 0, 'mandou a fala');
  // O comando reemitido e' o `!pin` (nao a foto do grupo).
  ok(INDEX.includes("acaoDoBot.acao === 'stickerBusca' ? 's' : acaoDoBot.acao"), 'reemite o comando da acao');
  const r = acoes.identificarAcaoDoBot('lizzy me manda uma foto de gato');
  ok(r?.acao === 'pin' && r?.termo === 'gato', 'foto de algo -> pin com o termo');
});

await test('17. a MENCAO sai com o @ na BASE e o `mentions` casando', async () => {
  const sent = await run('lizzy chama o joao pra mim');
  const comMencao = sent.find((c) => Array.isArray(c.mentions) && c.mentions.length);
  ok(comMencao, 'mandou com `mentions`');
  ok(comMencao.mentions[0] === JOAO.jid, `o mention e' a BASE (veio ${comMencao.mentions[0]})`);
  ok(!comMencao.mentions[0].includes(':'), 'sem o `:device`');
  ok(comMencao.text.includes(`@${JOAO.jid.split('@')[0]}`), 'o texto traz o mesmo @');
  ok(!comMencao.text.includes(':1@'), 'o texto NAO traz o device');
});

await test('18. a mencao acha pela MEMORIA (apelido do contador)', async () => {
  const sent = await run('lizzy chama a mariazinha');
  const comMencao = sent.find((c) => Array.isArray(c.mentions) && c.mentions.length);
  ok(comMencao, 'achou pelo apelido "Mariazinha"');
  ok(comMencao.mentions[0] === MARIA.jid, 'mencionou a pessoa certa');
});

await test('19. nome inexistente avisa sem mencionar ninguem', async () => {
  const sent = await run('lizzy chama o zezinho');
  ok(!sent.some((c) => Array.isArray(c.mentions) && c.mentions.length), 'NAO mencionou ninguem');
  ok(textos(sent).some((x) => /nao|não/i.test(x) && /nome/i.test(x)), 'avisou que nao achou');
});

await test('20. a acao NAO cai no LLM (early return)', () => {
  const i = INDEX.indexOf('const acaoDoBot = isGroup');
  ok(i > 0, 'o bloco existe');
  const bloco = INDEX.slice(i, i + 4200);
  ok(bloco.includes('return;'), 'ha early return (nao gasta LLM)');
  // A mencao e' tratada ANTES do bloco de acoes (`if (acaoDoBot)`), e nao
  // depois — assim "chama o joao" nao cai no caminho de link/foto.
  const iMencao = INDEX.indexOf('if (pedidoDeMencao) {');
  const iAcao = INDEX.indexOf('if (acaoDoBot) {');
  ok(iMencao > 0 && iAcao > 0 && iMencao < iAcao, 'a mencao e tratada ANTES do bloco de acoes');
  // E os dois antes do LLM de texto.
  const iLLM = INDEX.indexOf('ia.makeAssistentRequest({', i);
  ok(iLLM > i, 'a acao vem antes do LLM de texto');
});

await test('20b. o AUDIO vem ANTES das acoes (senao "manda um audio" viraria play)', () => {
  // "audio" esta na lista de palavras de musica, entao o reconhecedor de `play`
  // pegaria "manda um audio" e ela perguntaria "qual musica?" em vez de mandar a
  // voz. A ordem dos blocos e' o que evita isso.
  const iAudio = INDEX.indexOf('if (ehPedidoDeAudio(textoLimpo))');
  const iAcao = INDEX.indexOf('const acaoDoBot = isGroup');
  ok(iAudio > 0 && iAcao > 0 && iAudio < iAcao, 'o bloco do audio vem antes do das acoes');
  // E "manda um audio" NAO e' reconhecido como acao.
  const r = acoes.identificarAcaoDoBot('lizzy manda um audio ai');
  ok(r === null || r.acao !== 'play', `"manda um audio" nao vira play (veio ${JSON.stringify(r)})`);
});

await test('21. nao ha um SEGUNDO reconhecedor de play/pin (reusa o iapComandos)', () => {
  const SRC = fs.readFileSync(new URL('../dados/src/utils/assistenteAcoes.js', import.meta.url), 'utf-8');
  ok(SRC.includes("import { identificarComando } from './iapComandos.js'"), 'importa o reconhecedor do iapComandos');
  ok(!SRC.includes('const ALVO_PLAY'), 'NAO tem um ALVO_PLAY proprio (seria duplicacao)');
  ok(!SRC.includes('const ALVO_PIN'), 'NAO tem um ALVO_PIN proprio');
});

// ============================================================================
console.log('\n' + '='.repeat(60));
const tot = RESULTS.reduce((a, r) => a + r.passed, 0);
const fal = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log(`RESULTADO: ${RESULTS.length} testes | ${tot} asserções ok | ${fal} falhas`);
console.log('='.repeat(60));
process.exit(fal ? 1 : 0);
