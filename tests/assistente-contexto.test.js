/**
 * CONTEXTO da assistente: quem falou, quem e' o DONO, e os DADOS DO GRUPO.
 *
 * O dono pediu: *"coloca para ela reconhecer o dono do bot, nome dos usuarios
 * calculando o jid pra contato e vendo o nome do contato, ver tambem os dados do
 * proprio grupo, tipo, dono do grupo, adms, quando foi criado e etcc"*.
 *
 * A divisao e' de proposito:
 *   - o HANDLER (`index.js`) **coleta** — e' quem tem o socket e o metadata;
 *   - o `ia.js` **formata** (`montarContextoDaConversa`) — puro, testavel sem
 *     abrir conexao.
 *
 * Este teste cobre as duas pontas: a funcao pura e o **fluxo real** (handler de
 * verdade, com o Groq dublado — o que chega ao modelo e' inspecionado).
 *
 * Uso: node tests/assistente-contexto.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-ctx-'));
process.env.DATABASE_PATH = TMP_DB;
process.env.CONFIG_PATH = path.join(TMP_DB, 'config.json');
fs.mkdirSync(path.join(TMP_DB, 'grupos'), { recursive: true });
fs.mkdirSync(path.join(TMP_DB, 'dono'), { recursive: true });
// O nome REAL do dono: em MATHEMATICAL BOLD, como no config dele.
const NOME_BOLD = '\u{1D5D9}\u{1D5E2}\u{1D5DB}\u{1D5DB}\u{1D606} \u{1D5D9}\u{1D5FC} \u{1D5FD}\u{1D5FF}\u{1D5F2}\u{1D603}\u{1D606}';
fs.writeFileSync(process.env.CONFIG_PATH, JSON.stringify({
  prefixo: '!', nomebot: NOME_BOLD, nomedono: 'Kannon',
  numerodono: '5511915323638', lidowner: '127642753843383', debug: false
}, null, 2));

// A VOZ ESPONTANEA (25%) tornaria estes testes FLAKY: as vezes a resposta sai
// em audio (sem `text`) e as assercoes de TEXTO falham. Aqui o foco e' o texto,
// entao a voz e' desligada pela env — e PRECISA vir ANTES do import: a
// constante e' lida no LOAD do modulo (`vozDaConversa.js`).
process.env.LIZZY_VOZ_ESPONTANEA = '0';

const ia = await import(new URL('../dados/src/funcs/private/ia.js', import.meta.url).href);
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
function contem(h, n, l) { ok(typeof h === 'string' && h.includes(n), `${l ?? n} — esperado conter "${n}"`); }
function naoContem(h, n, l) { ok(typeof h === 'string' && !h.includes(n), `${l ?? n} — NAO deveria conter "${n}"`); }

const INDEX = fs.readFileSync(new URL('../dados/src/index.js', import.meta.url), 'utf-8');

// ---------------------------------------------------------------------------
// 1) A FUNCAO PURA (o formato)
// ---------------------------------------------------------------------------
console.log('\n=== 1) O FORMATO DO CONTEXTO (puro) ===\n');

await test('1. monta quem fala, o dono, e os dados do grupo', () => {
  const bloco = ia.montarContextoDaConversa({
    nomeDeQuemFalou: 'Kannon',
    dadosDoGrupo: {
      donoDoBot: { nome: 'Kannon', numeros: ['5511915323638'], falanteEhDono: true },
      grupo: {
        nome: 'geralbot', criadoEm: '15/03/2025', totalMembros: 42,
        dono: { nome: 'Kannon', numero: '5511915323638' },
        admins: ['Kannon', 'Lizzy'], totalAdmins: 2, descricao: 'grupo de teste'
      }
    }
  });
  contem(bloco, "O DONO do bot e' Kannon", 'o dono do bot');
  contem(bloco, "Quem esta' falando com voce agora e' Kannon", 'quem fala');
  contem(bloco, "ATENCAO: Kannon e' o DONO", 'reconhece o dono falando');
  contem(bloco, 'DADOS DO GRUPO', 'a secao do grupo');
  contem(bloco, '- Nome: geralbot', 'o nome do grupo');
  contem(bloco, '- Dono do grupo: Kannon', 'o dono do grupo');
  contem(bloco, '- Admins (2): Kannon, Lizzy', 'os admins');
  contem(bloco, '- Criado em: 15/03/2025', 'a criacao');
  contem(bloco, '- Total de membros: 42', 'o total');
  contem(bloco, '- Descricao: grupo de teste', 'a descricao');
});

await test('2. NAO inventa: campo sem dado simplesmente nao aparece', () => {
  const bloco = ia.montarContextoDaConversa({
    nomeDeQuemFalou: 'Fulano',
    dadosDoGrupo: { grupo: { nome: 'x' } } // sem dono/admins/criacao/descricao
  });
  contem(bloco, "Quem esta' falando com voce agora e' Fulano", 'o nome de quem fala');
  naoContem(bloco, 'DONO do bot', 'nao afirma dono sem saber');
  naoContem(bloco, 'ATENCAO', 'nao marca dono sem saber');
  naoContem(bloco, 'Dono do grupo', 'nao inventa dono do grupo');
  naoContem(bloco, 'Admins', 'nao inventa admins');
  naoContem(bloco, 'Criado em', 'nao inventa criacao');
  naoContem(bloco, 'Total de membros', 'nao inventa total');
});

await test('3. sem nada -> string vazia (nao suja o prompt)', () => {
  ok(ia.montarContextoDaConversa() === '', 'sem argumento');
  ok(ia.montarContextoDaConversa({}) === '', 'objeto vazio');
  ok(ia.montarContextoDaConversa(null) === '', 'null');
  ok(ia.montarContextoDaConversa('lixo') === '', 'string (nao quebra)');
});

await test('4. nao-dono nao e marcado como dono', () => {
  const bloco = ia.montarContextoDaConversa({
    nomeDeQuemFalou: 'Fulano',
    dadosDoGrupo: { donoDoBot: { nome: 'Kannon', numeros: ['5511'], falanteEhDono: false } }
  });
  contem(bloco, "O DONO do bot e' Kannon", 'o dono existe');
  naoContem(bloco, 'ATENCAO', 'mas quem fala NAO e o dono');
  contem(bloco, 'Chame essa pessoa pelo nome (Fulano)', 'chama pelo nome');
});

await test('5. a lista de admins e cortada em 20 com o resto contado', () => {
  const admins = Array.from({ length: 25 }, (_, i) => `Admin${i}`);
  const bloco = ia.montarContextoDaConversa({
    dadosDoGrupo: { grupo: { nome: 'g', admins, totalAdmins: 25 } }
  });
  contem(bloco, '- Admins (25): Admin0', 'o total real aparece');
  contem(bloco, '(+5)', 'o que sobrou e contado');
  naoContem(bloco, 'Admin24', 'a lista e cortada em 20');
});

// ---------------------------------------------------------------------------
// 2) O HANDLER COLETA (guarda estrutural)
// ---------------------------------------------------------------------------
console.log('\n=== 2) O HANDLER COLETA ===\n');

await test('6. o handler resolve o nome e monta os dados do grupo', () => {
  const i = INDEX.indexOf('coletarDadosDoGrupo({');
  ok(i > 0, 'o bloco de coleta existe');
  const bloco = INDEX.slice(i - 900, i + 700);
  contem(bloco, 'resolverNomeContato(sender', 'resolve o nome de quem fala (JID -> contato)');
  contem(bloco, 'coletarDadosDoGrupo', 'usa a COLETA compartilhada (mesma da call)');
  contem(bloco, 'numerosDono', 'passa numero + LID do dono');
  contem(bloco, 'matchId: idsMatch', 'usa a MESMA checagem de identidade do resto');
  contem(bloco, 'nomeDeQuemFalou', 'passa quem falou para o contexto');
});

await test('7. o handler passa o contexto rico para a IA', () => {
  const i = INDEX.indexOf('ia.makeAssistentRequest({');
  ok(i > 0, 'a chamada existe');
  // O `extraContext` montado logo acima e' o que carrega o contexto.
  const bloco = INDEX.slice(i - 400, i + 200);
  contem(bloco, 'nomeDeQuemFalou', 'o contexto rico vai junto');
  contem(bloco, 'dadosDoGrupo', 'os dados do grupo tambem');
  contem(bloco, 'extraContext', 'vai no extraContext (o canal que o ia.js le)');
});

// ---------------------------------------------------------------------------
// 3) O FLUXO REAL (handler de verdade + Groq dublado)
// ---------------------------------------------------------------------------
console.log('\n=== 3) O FLUXO REAL ===\n');

const OWNER_LID = '5511915323638:1@s.whatsapp.net';
const OUTRO_LID = '5511999999999:1@s.whatsapp.net';
const GRUPO = '120363425268923269@g.us';
const BOT_LID = '127642753843383:1@s.whatsapp.net';

function grupoFile(extra = {}) {
  fs.writeFileSync(path.join(TMP_DB, 'grupos', `${GRUPO}.json`), JSON.stringify({
    assistente: true, groupName: 'geralbot', prefixo: '!', ...extra
  }, null, 2));
}

function fakeSock(sent) {
  return {
    user: { id: BOT_LID, lid: BOT_LID },
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    sendMessage: async (jid, content) => { sent.push({ jid, content }); return { key: { id: 'X' } }; },
    sendPresenceUpdate: async () => {},
    groupMetadata: async () => ({
      subject: 'geralbot',
      creation: 1742000000,
      desc: 'grupo de teste',
      owner: OWNER_LID,
      participants: [
        { id: OWNER_LID, admin: 'superadmin', name: 'Kannon' },
        { id: OUTRO_LID, admin: 'admin', name: 'Fulano' },
        { id: BOT_LID, admin: 'admin' }
      ]
    }),
    // O NOME DO CONTATO (agenda) — e' a fonte preferida do resolvedor.
    contacts: { getName: async (j) => (j.includes('5511915323638') ? 'Kannon' : (j.includes('5511999999999') ? 'Fulano' : null)) },
    profilePictureUrl: async () => null,
    react: async () => ({}),
    waitForMessage: async () => undefined,
    chatModify: async () => ({}),
  };
}

async function run(text, { participant = OWNER_LID, pushName = 'Kannon' } = {}) {
  grupoFile();
  const sent = [];
  const sock = fakeSock(sent);
  const info = {
    key: { remoteJid: GRUPO, fromMe: false, id: `M-${Math.random().toString(36).slice(2, 8)}`, participant },
    message: { extendedTextMessage: { text, contextInfo: { remoteJid: GRUPO } } },
    messageTimestamp: Math.floor(Date.now() / 1000), pushName,
  };
  await handleMessage(sock, info, null, new Map(), null);
  await new Promise((r) => setTimeout(r, 300));
  return sent.map((s) => s.content?.text ?? s.content?.caption ?? '').join('\n');
}

// Captura o SYSTEM enviado ao Groq (e' o prompt do modelo).
let SYSTEM_VISTO = null;
function dublarGroq() {
  groq.setGroqHttpForTest(async (url, data) => {
    SYSTEM_VISTO = data?.messages?.find?.((m) => m.role === 'system')?.content ?? null;
    return { data: { choices: [{ message: { content: '{"resp":[{"resp":"Oi! Tudo bem? 😊"}]}' } }] } };
  });
  process.env.GROQ_API_KEY = 'gsk-teste';
}

await test('8. o SYSTEM que chega ao modelo tem o dono, quem fala e o grupo', async () => {
  dublarGroq();
  const t = await run('oi Lizzy');
  contem(t, 'Oi! Tudo bem?', 'ela respondeu');
  ok(SYSTEM_VISTO, 'o prompt do sistema foi montado');
  contem(SYSTEM_VISTO, "O DONO do bot e' Kannon", 'o dono do bot');
  contem(SYSTEM_VISTO, "Quem esta' falando com voce agora e' Kannon", 'quem fala (nome resolvido)');
  contem(SYSTEM_VISTO, "ATENCAO: Kannon e' o DONO", 'reconheceu o dono');
  contem(SYSTEM_VISTO, '- Nome: geralbot', 'o nome do grupo');
  contem(SYSTEM_VISTO, '- Dono do grupo: Kannon', 'o dono do grupo');
  contem(SYSTEM_VISTO, '- Criado em: 15/03/2025', 'a data de criacao');
  contem(SYSTEM_VISTO, '- Total de membros: 3', 'o total de membros');
  contem(SYSTEM_VISTO, 'Kannon', 'os admins com nome resolvido');
  groq.setGroqHttpForTest(null);
});

await test('9. o nome vem do CONTATO — nunca o JID/LID cru', async () => {
  dublarGroq();
  await run('oi Lizzy');
  ok(SYSTEM_VISTO, 'prompt montado');
  naoContem(SYSTEM_VISTO, OWNER_LID, 'o JID de quem fala NAO aparece');
  naoContem(SYSTEM_VISTO, '5511915323638:1', 'o LID cru NAO aparece');
  contem(SYSTEM_VISTO, 'Kannon', 'aparece o NOME do contato');
  groq.setGroqHttpForTest(null);
});

await test('10. quem NAO e o dono nao e marcado como dono', async () => {
  dublarGroq();
  await run('oi Lizzy', { participant: OUTRO_LID, pushName: 'Fulano' });
  ok(SYSTEM_VISTO, 'prompt montado');
  contem(SYSTEM_VISTO, "O DONO do bot e' Kannon", 'o dono do bot continua dito');
  contem(SYSTEM_VISTO, "Quem esta' falando com voce agora e' Fulano", 'quem fala e o Fulano');
  naoContem(SYSTEM_VISTO, "ATENCAO: Fulano", 'mas NAO e marcado como dono');
  groq.setGroqHttpForTest(null);
});

await test('11. o prompt continua pedindo JSON (o parser depende)', async () => {
  dublarGroq();
  await run('oi Lizzy');
  contem(SYSTEM_VISTO, 'FORMATO DA SUA RESPOSTA', 'a instrucao de JSON continua');
  contem(SYSTEM_VISTO, 'COMO ESCREVER', 'as regras de chat continuam');
  groq.setGroqHttpForTest(null);
});

// ---------------------------------------------------------------------------
// 4) A COLETA COMPARTILHADA (o que o chat E a call usam)
// ---------------------------------------------------------------------------
console.log('\n=== 4) A COLETA COMPARTILHADA ===\n');

const ctx = await import(new URL('../dados/src/utils/contextoConversa.js', import.meta.url).href);

const METADATA_FAKE = {
  subject: 'geralbot',
  creation: 1742000000,
  desc: 'grupo de teste',
  owner: '5511915323638@s.whatsapp.net',
  participants: [
    { id: '5511915323638@s.whatsapp.net', lid: '23734744260711@lid', admin: 'superadmin', notify: 'Kannon' },
    { id: '5511999999999@s.whatsapp.net', lid: '111000000000001@lid', admin: 'admin', notify: 'Fulano' },
    { id: '5511966665555@s.whatsapp.net', lid: '111000000000003@lid', notify: 'Moderador Ze' },
    { id: '5511955554444@s.whatsapp.net', lid: '111000000000004@lid', notify: 'Alpha Maria' }
  ]
};
const NAZU_FAKE = {
  contacts: { getName: async (j) => (j.includes('5511915323638') ? 'Kannon' : (j.includes('5511999999999') ? 'Fulano' : null)) },
  profilePictureUrl: async () => 'https://exemplo/foto-grupo.jpg'
};
const MATCH_FAKE = (a, b) => String(a).split('@')[0].split(':')[0] === String(b).split('@')[0].split(':')[0];

await test('12. coletarDadosDoGrupo devolve dono do bot, grupo, admins e criacao', async () => {
  const d = await ctx.coletarDadosDoGrupo({
    nazu: NAZU_FAKE, metadata: METADATA_FAKE, from: 'x@g.us', groupName: 'geralbot',
    numerosDono: ['5511915323638', '127642753843383'], nomeDonoBot: 'Kannon',
    sender: '5511915323638:1@s.whatsapp.net', matchId: MATCH_FAKE, isGroup: true
  });
  ok(d.donoDoBot?.nome === 'Kannon', 'o nome do dono do bot');
  ok(d.donoDoBot?.falanteEhDono === true, 'reconhece o dono por numero (mesmo com :device)');
  ok(d.grupo?.nome === 'geralbot', 'o nome do grupo');
  ok(d.grupo?.totalMembros === 4, 'o total de membros');
  ok(d.grupo?.totalAdmins === 2, 'o total de admins');
  ok(d.grupo?.criadoEm === '15/03/2025', 'a data de criacao (segundos -> pt-BR)');
  ok(d.grupo?.dono?.nome === 'Kannon', 'o dono do grupo com nome resolvido');
  // O ponto do pedido: os admins vem com NOME (do `notify`), nao com numero.
  ok(JSON.stringify(d.grupo?.admins) === JSON.stringify(['Kannon', 'Fulano']),
    `os admins com NOME — veio ${JSON.stringify(d.grupo?.admins)}`);
  ok(!JSON.stringify(d.grupo?.admins || []).includes('@'), 'nenhum JID/LID na lista de admins');
});

await test('12b. admins sem `notify` caem no numero (nunca em branco)', async () => {
  const d = await ctx.coletarDadosDoGrupo({
    nazu: { contacts: { getName: async () => undefined } },
    metadata: { subject: 'g', participants: [{ id: '5511900000000@s.whatsapp.net', admin: 'admin' }] },
    from: 'x@g.us', numerosDono: [], matchId: MATCH_FAKE, isGroup: true
  });
  ok(Array.isArray(d.grupo?.admins) && d.grupo.admins.length === 1, 'o admin aparece');
  ok(typeof d.grupo.admins[0] === 'string' && d.grupo.admins[0].length > 0, 'com algum nome/numero');
});

await test('12c. MODERADORES e ALPHAS entram (cargos do BOT, nao do WhatsApp)', async () => {
  const d = await ctx.coletarDadosDoGrupo({
    nazu: NAZU_FAKE, metadata: METADATA_FAKE, from: 'x@g.us', groupName: 'geralbot',
    numerosDono: [], matchId: MATCH_FAKE, isGroup: true,
    moderadores: ['5511966665555@s.whatsapp.net'],
    alphas: ['5511955554444@s.whatsapp.net']
  });
  ok(JSON.stringify(d.grupo?.moderadores) === JSON.stringify(['Moderador Ze']),
    `o mod com nome — veio ${JSON.stringify(d.grupo?.moderadores)}`);
  ok(JSON.stringify(d.grupo?.alphas) === JSON.stringify(['Alpha Maria']),
    `o alpha com nome — veio ${JSON.stringify(d.grupo?.alphas)}`);
  ok(d.grupo?.totalModeradores === 1, 'a contagem de mods');
  ok(d.grupo?.totalAlphas === 1, 'a contagem de alphas');
});

await test('12d. sem mods/alphas, os campos NAO aparecem (nao inventa cargo)', async () => {
  const d = await ctx.coletarDadosDoGrupo({
    nazu: NAZU_FAKE, metadata: METADATA_FAKE, from: 'x@g.us',
    numerosDono: [], matchId: MATCH_FAKE, isGroup: true
  });
  ok(d.grupo?.moderadores === undefined, 'sem moderadores');
  ok(d.grupo?.alphas === undefined, 'sem alphas');
});

await test('12e. a FOTO do grupo entra quando pedida (e some sem foto)', async () => {
  const com = await ctx.coletarDadosDoGrupo({
    nazu: NAZU_FAKE, metadata: METADATA_FAKE, from: 'x@g.us',
    numerosDono: [], matchId: MATCH_FAKE, isGroup: true, comFoto: true
  });
  ok(com.grupo?.foto === 'https://exemplo/foto-grupo.jpg', 'a foto veio');

  const sem = await ctx.coletarDadosDoGrupo({
    nazu: NAZU_FAKE, metadata: METADATA_FAKE, from: 'x@g.us',
    numerosDono: [], matchId: MATCH_FAKE, isGroup: true, comFoto: false
  });
  ok(sem.grupo?.foto === undefined, 'sem pedir, nao busca (economia)');

  // Grupo sem foto: `profilePictureUrl` LANCA — a coleta nao pode quebrar.
  const semFoto = await ctx.coletarDadosDoGrupo({
    nazu: { contacts: {}, profilePictureUrl: async () => { throw new Error('no picture'); } },
    metadata: METADATA_FAKE, from: 'x@g.us',
    numerosDono: [], matchId: MATCH_FAKE, isGroup: true, comFoto: true
  });
  ok(semFoto.grupo && semFoto.grupo.foto === undefined, 'grupo sem foto nao derruba a coleta');
});

await test('13. quem NAO e o dono nao vira dono (e o matchId manda)', async () => {
  const d = await ctx.coletarDadosDoGrupo({
    nazu: NAZU_FAKE, metadata: METADATA_FAKE, from: 'x@g.us',
    numerosDono: ['5511915323638'], nomeDonoBot: 'Kannon',
    sender: '5511999999999:1@s.whatsapp.net', matchId: MATCH_FAKE, isGroup: true
  });
  ok(d.donoDoBot?.falanteEhDono === false, 'o Fulano NAO e o dono');
});

await test('14. nao-grupo / sem metadata -> so o dono do bot (sem inventar grupo)', async () => {
  const d = await ctx.coletarDadosDoGrupo({
    numerosDono: ['5511'], nomeDonoBot: 'Kannon', sender: '5511@s.whatsapp.net',
    matchId: MATCH_FAKE, isGroup: false
  });
  ok(d.donoDoBot?.nome === 'Kannon', 'o dono do bot continua');
  ok(d.grupo === undefined, 'NAO inventa dados de grupo no privado');
});

await test('15. a coleta nunca lanca (metadata hostil)', async () => {
  const d = await ctx.coletarDadosDoGrupo({
    metadata: { participants: 'nao-e-array', get creation() { throw new Error('boom'); } },
    numerosDono: ['5511'], matchId: MATCH_FAKE, isGroup: true
  });
  ok(d && typeof d === 'object', 'devolveu objeto');
  ok(!d.grupo || typeof d.grupo === 'object', 'sem grupo ou grupo valido — nunca explode');
});

await test('16. o BLOCO DA VOZ e enxuto e responde o que se pergunta numa call', () => {
  const bloco = ctx.montarBlocoDoGrupo({
    grupo: {
      nome: 'geralbot', criadoEm: '15/03/2025', totalMembros: 5, totalAdmins: 2,
      admins: ['Kannon', 'Fulano'], moderadores: ['Moderador Ze'], alphas: ['Alpha Maria'],
      descricao: 'grupo de teste', dono: { nome: 'Kannon' }
    }
  });
  contem(bloco, 'Voce esta no grupo "geralbot"', 'o nome');
  contem(bloco, "O dono do grupo e' Kannon", 'o dono');
  contem(bloco, '5 membro(s)', 'quantos somos');
  contem(bloco, '2 administrador(es)', 'quantos admins');
  contem(bloco, 'criado em 15/03/2025', 'a criacao');
  contem(bloco, 'Kannon, Fulano', 'os admins');
  contem(bloco, 'Moderadores: Moderador Ze', 'os mods');
  contem(bloco, 'Alphas: Alpha Maria', 'os alphas');
  contem(bloco, 'grupo de teste', 'a descricao');
  ok(!bloco.includes('\n'), 'e uma frase so (lida em voz alta)');
});

await test('16b. o CHAT lista admins, mods e alphas com nome', () => {
  const bloco = ctx.montarContextoDaConversa({
    dadosDoGrupo: {
      grupo: {
        nome: 'geralbot', admins: ['Kannon', 'Fulano'], totalAdmins: 2,
        moderadores: ['Moderador Ze'], totalModeradores: 1,
        alphas: ['Alpha Maria'], totalAlphas: 1
      }
    }
  });
  contem(bloco, '- Admins (2): Kannon, Fulano', 'os admins com nome');
  contem(bloco, '- Moderadores (1): Moderador Ze', 'os mods com nome');
  contem(bloco, '- Alphas (1): Alpha Maria', 'os alphas com nome');
  ok(!bloco.includes('@'), 'nenhum JID/LID no texto');
});

await test('16c. sem mods/alphas as linhas nao aparecem (nao inventa cargo)', () => {
  const bloco = ctx.montarContextoDaConversa({
    dadosDoGrupo: { grupo: { nome: 'g', admins: ['A'], totalAdmins: 1 } }
  });
  naoContem(bloco, 'Moderadores', 'sem linha de mods');
  naoContem(bloco, 'Alphas', 'sem linha de alphas');
});

await test('17. o bloco da voz NAO inventa e nao vaza JID', () => {
  ok(ctx.montarBlocoDoGrupo({}) === '', 'sem grupo -> vazio');
  ok(ctx.montarBlocoDoGrupo() === '', 'sem argumento -> vazio');
  const bloco = ctx.montarBlocoDoGrupo({ grupo: { nome: 'g', totalMembros: 5, dono: { numero: '5511' } } });
  ok(!bloco.includes('@'), 'nunca vaza JID/LID');
  ok(!bloco.includes('undefined'), 'nunca escreve undefined');
});

await test('18. o !iap usa a MESMA coleta e o MESMO bloco do chat', () => {
  // Guard estrutural: a call nao pode ter uma coleta propria.
  const i = INDEX.indexOf("case 'iap':");
  ok(i > 0, 'o comando existe');
  const bloco = INDEX.slice(i, i + 9000);
  contem(bloco, 'coletarDadosDoGrupo', 'a call usa a coleta compartilhada');
  contem(bloco, 'dadosDoGrupo', 'e passa os dados para o agente');
  // E o modulo do agente usa o formatador compartilhado.
  const SESSAO = fs.readFileSync(new URL('../dados/src/utils/iapSessao.js', import.meta.url), 'utf-8');
  contem(SESSAO, 'montarBlocoDoGrupo', 'a voz usa o bloco compartilhado');
  contem(SESSAO, 'dadosDoGrupo', 'e o encadeia ate o prompt');
});

await test('19. o chat e a call compartilham UMA fonte (sem coleta duplicada)', () => {
  // Nenhum dos dois pode voltar a montar `dadosDoGrupo.grupo` na mao.
  ok(!INDEX.includes('dadosDoGrupo.grupo = {'), 'o handler nao monta o grupo na mao');
  ok(!INDEX.includes('nomesAdmins = '), 'nem resolve admins na mao');
  const IA = fs.readFileSync(new URL('../dados/src/funcs/private/ia.js', import.meta.url), 'utf-8');
  ok(!IA.includes('function montarContextoDaConversa'), 'o ia.js nao tem copia do formatador');
  contem(IA, "from '../../utils/contextoConversa.js'", 'ele importa o compartilhado');
});

// ---------------------------------------------------------------------------
console.log('\n' + '='.repeat(60));
const tot = RESULTS.reduce((a, r) => a + r.passed, 0);
const fal = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log(`RESULTADO: ${RESULTS.length} testes | ${tot} asserções ok | ${fal} falhas`);
console.log('='.repeat(60));
process.exit(fal ? 1 : 0);
