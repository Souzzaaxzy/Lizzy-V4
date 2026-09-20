/**
 * TESTE DO LADO DO USUÁRIO — fluxo real, sem mock da Lizzy.
 *
 * Simula o que a bot do usuário realmente faz:
 *
 *   1. Recebe o arquivo `antifantasma.cjs` (exatamente o que a Lizzy envia).
 *   2. Recebe a KEY gerada pelo servidor.
 *   3. Importa o arquivo como o tutorial ensina.
 *   4. Roda as cases personalizadas.
 *   5. Uma mensagem com sinal de ataque chega → o servidor decide → as ações
 *      rodam no socket do usuário.
 *
 * O único dublê é o SOCKET (o WhatsApp do usuário) e o servidor HTTP local —
 * nada do lado da Lizzy é substituído: usa a API real, o núcleo real e as keys
 * reais.
 *
 * Uso: node tests/antifantasma-usuario.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'node:http';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');
const require = createRequire(import.meta.url);

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-user-e2e-'));
process.env.DATABASE_PATH = TMP;
fs.mkdirSync(path.join(TMP, 'antifantasma'), { recursive: true });

// Servidor da Lizzy: a API real, sem dublê.
const api = await import(new URL('../dados/src/antifantasma/api.js', import.meta.url).href);
const keys = await import(new URL('../dados/src/antifantasma/keys.js', import.meta.url).href);

let ok = 0;
let fail = 0;
const erros = [];

function check(cond, msg) {
  if (cond) { ok += 1; console.log(`✅ ${msg}`); }
  else { fail += 1; erros.push(msg); console.log(`❌ ${msg}`); }
}

// ============================================================================
// 1) A LIZZY CRIA A KEY (o que o !addghostcmd faz)
// ============================================================================

const NUMERO_USUARIO = '5511999999999';
const registro = keys.criarKey({ owner: NUMERO_USUARIO });
check(Boolean(registro.key), `Lizzy gerou a key #${registro.id}`);

// ============================================================================
// 2) A LIZZY ENTREGA O ARQUIVO (montado como o !addghostcmd monta)
// ============================================================================

const server = api.iniciarApi(0);
await new Promise((r) => setTimeout(r, 250));
const portaApi = server.address().port;
const endpoint = `http://127.0.0.1:${portaApi}/api/antifantasma/exec`;

const fonteEntregavel = fs.readFileSync(
  path.join(PROJECT, 'dados', 'src', 'antifantasma-cliente', 'antifantasma.cjs'),
  'utf-8'
);
const arquivoEntregue = fonteEntregavel
  .replace(/const API_URL = '[^']*';/, `const API_URL = '${endpoint}';`)
  .replace(/const KEY = '[^']*';/, `const KEY = '${registro.key}';`)
  .replace(/const BOT_ID = '[^']*';/, `const BOT_ID = '${NUMERO_USUARIO}';`);

// Sanidade do entregável: é o adaptador e não contém o núcleo.
check(arquivoEntregue.includes('executar'), 'o arquivo entregue é o adaptador');
// O adaptador relata o sinal (trabalho dele); o que não pode é a DECISÃO.
check(!arquivoEntregue.includes('normalizeContext') && !arquivoEntregue.includes('decidir('),
  'o arquivo NÃO contém a decisão interna');
check(!/selectiveDistribution\s*&&/.test(arquivoEntregue), 'o arquivo NÃO combina sinais (regra é do servidor)');
check(!arquivoEntregue.includes('core.js'), 'o arquivo NÃO referencia o núcleo');

// ============================================================================
// 3) A BOT DO USUÁRIO INSTALA (como o tutorial manda)
// ============================================================================

// A bot do usuário é CommonJS: `const antiFantasma = require('./antifantasma')`.
const destino = path.join(TMP, 'antifantasma.cjs');
fs.writeFileSync(destino, arquivoEntregue);
const antiFantasma = require(destino);

check(typeof antiFantasma.executar === 'function', 'usuario consegue importar e chamar executar');
check(typeof antiFantasma.ativar === 'function', 'tem ativar');
check(typeof antiFantasma.desativar === 'function', 'tem desativar');
check(typeof antiFantasma.estaAtivo === 'function', 'tem estaAtivo');

// ============================================================================
// 4) SOCKET FALSO (é o WhatsApp do usuário, não a Lizzy)
// ============================================================================

const acoesNoSocket = [];
const sock = {
  groupSettingUpdate: async (grupo, tipo) => { acoesNoSocket.push(`setting:${tipo}`); },
  groupParticipantsUpdate: async (grupo, alvos, acao) => {
    acoesNoSocket.push(`participants:${acao}:${alvos[0]}`);
  },
  sendMessage: async (grupo, conteudo) => { acoesNoSocket.push('aviso'); },
};

const GRUPO = '120363000000000000@g.us';
const ATACANTE = '5511888888888@s.whatsapp.net';

// ============================================================================
// 5) CASES PERSONALIZADAS DO USUÁRIO (nomes livres, como o tutorial permite)
// ============================================================================

const respostas = [];
const reply = async (t) => { respostas.push(t); };

/** Case 'afon' — o usuário escolheu esse nome. */
async function caseAfon() {
  antiFantasma.ativar();
  await reply('🟢 AntiFantasma ativado.');
}

/** Case 'afoff'. */
async function caseAfoff() {
  antiFantasma.desativar();
  await reply('🔴 AntiFantasma desativado.');
}

/** Case 'afstatus'. */
async function caseAfstatus() {
  await reply(antiFantasma.estaAtivo() ? '🟢 Ligado' : '🔴 Desligado');
}

/** Case 'antifantasma' — avaliar uma mensagem (o exemplo do tutorial). */
async function caseAntifantasma(msg) {
  return antiFantasma.executar({
    sock,
    grupo: msg.grupo,
    autor: msg.autor,
    reply,
    contexto: msg.contexto,
  });
}

// ============================================================================
// 6) FLUXO REAL
// ============================================================================

console.log('\n── desativado por padrão ──');
check(antiFantasma.estaAtivo() === false, 'começa desativado');
const antesOff = acoesNoSocket.length;
await caseAntifantasma({ grupo: GRUPO, autor: ATACANTE, contexto: { isGroup: true, botIsAdmin: true, sender: ATACANTE, selectiveDistribution: true, undecryptableGroupMessage: true } });
check(acoesNoSocket.length === antesOff, 'desativado: nenhuma ação no socket (nem chama a API)');

console.log('\n── usuário ativa com a case dele ──');
await caseAfon();
check(antiFantasma.estaAtivo() === true, "case 'afon' ativou");
check(respostas.at(-1).includes('ativado'), 'respondeu o texto que ELE escolheu');

await caseAfstatus();
check(respostas.at(-1).includes('Ligado'), "case 'afstatus' responde o estado");

console.log('\n── mensagem NORMAL: nada acontece ──');
const antesNormal = acoesNoSocket.length;
const rNormal = await caseAntifantasma({
  grupo: GRUPO, autor: ATACANTE,
  contexto: { isGroup: true, botIsAdmin: true, sender: ATACANTE },
});
check(rNormal.ok === true && rNormal.acoes.length === 0, 'mensagem normal não gera ação');
check(acoesNoSocket.length === antesNormal, 'nada aconteceu no grupo');

console.log('\n── ATAQUE: servidor decide e as ações rodam ──');
const rAtaque = await caseAntifantasma({
  grupo: GRUPO, autor: ATACANTE,
  contexto: {
    isGroup: true, botIsAdmin: true, sender: ATACANTE,
    selectiveDistribution: true, undecryptableGroupMessage: true,
  },
});

check(rAtaque.ok === true, 'executou sem erro');
check(rAtaque.acoes.length === 3, `três ações (${rAtaque.acoes})`);
check(acoesNoSocket.includes('setting:announcement'), 'grupo FECHADO');
check(acoesNoSocket.includes(`participants:remove:${ATACANTE}`), 'atacante BANIDO');
check(acoesNoSocket.includes('setting:not_announcement'), 'grupo REABERTO');
check(acoesNoSocket.includes('aviso'), 'aviso publicado');

console.log('\n── ataque do ADMIN: não deve ser punido ──');
const antesAdmin = acoesNoSocket.length;
await caseAntifantasma({
  grupo: GRUPO, autor: ATACANTE,
  contexto: {
    isGroup: true, botIsAdmin: true, sender: ATACANTE,
    senderIsPrivileged: true,
    selectiveDistribution: true, undecryptableGroupMessage: true,
  },
});
check(acoesNoSocket.length === antesAdmin, 'admin não é punido');

console.log('\n── usuário desativa ──');
await caseAfoff();
check(antiFantasma.estaAtivo() === false, "case 'afoff' desativou");

console.log('\n── KEY revogada: recusada mesmo com o arquivo em mãos ──');
antiFantasma.ativar();
keys.revogarPorId(registro.id);
const respostasAntes = respostas.length;
const rRevogada = await caseAntifantasma({
  grupo: GRUPO, autor: ATACANTE,
  contexto: { isGroup: true, botIsAdmin: true, sender: ATACANTE, selectiveDistribution: true, undecryptableGroupMessage: true },
});
check(rRevogada.ok === false, 'key revogada não executa');
check(respostas.slice(respostasAntes).some((t) => t.includes('KEY do AntiFantasma inválida')), 'avisa a key inválida');

console.log('\n── KEY de OUTRO usuário: recusada (1 key = 1 usuário) ──');
const outro = keys.criarKey({ owner: '5511777777777' });
fs.writeFileSync(
  path.join(TMP, 'outro.cjs'),
  fonteEntregavel
    .replace(/const API_URL = '[^']*';/, `const API_URL = '${endpoint}';`)
    .replace(/const KEY = '[^']*';/, `const KEY = '${outro.key}';`)
    // Simula o usuário B usando a key do usuário A: mantém o BOT_ID do A.
    .replace(/const BOT_ID = '[^']*';/, `const BOT_ID = '${NUMERO_USUARIO}';`)
);
const afOutro = require(path.join(TMP, 'outro.cjs'));
afOutro.ativar();
const rOutro = await afOutro.executar({
  sock, grupo: GRUPO, autor: ATACANTE, reply,
  contexto: { isGroup: true, botIsAdmin: true, sender: ATACANTE, selectiveDistribution: true, undecryptableGroupMessage: true },
});
check(rOutro.ok === false, 'key de outro dono é recusada');

console.log('\n── chamada EXATA do tutorial: { sock, msg, args, reply } ──');
// Regressão do bug relatado: o tutorial manda `msg`, mas o adaptador só olhava
// `grupo`/`autor`. Com `msg`, `grupo` ficava undefined e NADA acontecia.
//
// Usa um adaptador com KEY PRÓPRIA: a key do teste anterior foi revogada de
// propósito (para provar a recusa), então ela não serve aqui.
const regTutorial = keys.criarKey({ owner: NUMERO_USUARIO });
const afTutorial = require((() => {
  const p = path.join(TMP, 'tutorial.cjs');
  fs.writeFileSync(p, fonteEntregavel
    .replace(/const API_URL = '[^']*';/, `const API_URL = '${endpoint}';`)
    .replace(/const KEY = '[^']*';/, `const KEY = '${regTutorial.key}';`)
    .replace(/const BOT_ID = '[^']*';/, `const BOT_ID = '${NUMERO_USUARIO}';`));
  return p;
})());

const acoesTutorial = [];
const sockTutorial = {
  user: { id: `${NUMERO_USUARIO}:5@s.whatsapp.net`, lid: '999@lid' },
  groupMetadata: async () => ({
    participants: [
      { id: '999@lid', lid: '999@lid', phoneNumber: `${NUMERO_USUARIO}@s.whatsapp.net`, admin: 'admin' },
      { id: ATACANTE, phoneNumber: ATACANTE, admin: null },
    ],
  }),
  groupSettingUpdate: async (g, t) => { acoesTutorial.push(`setting:${t}`); },
  groupParticipantsUpdate: async (g, a, c) => { acoesTutorial.push(`participants:${c}`); },
  sendMessage: async () => { acoesTutorial.push('aviso'); },
};

// A mensagem como ela chega num ataque real: stub, SEM `message`.
const msgAtaque = {
  key: { remoteJid: GRUPO, fromMe: false, participant: ATACANTE },
  message: undefined,
  messageStubType: 2,
  selectiveDistribution: true,
};

afTutorial.ativar();
const rTutorial = await afTutorial.executar({ sock: sockTutorial, msg: msgAtaque, args: [], reply });

check(rTutorial.ok === true, 'a chamada do tutorial executa (antes retornava erro)');
check(acoesTutorial.includes('setting:announcement'), 'tutorial: fechou o grupo');
check(acoesTutorial.includes('participants:remove'), 'tutorial: baniu o atacante');
check(acoesTutorial.includes('setting:not_announcement'), 'tutorial: reabriu o grupo');
check(rTutorial.acoes.length === 3, `tutorial: três ações (${rTutorial.acoes})`);

console.log('\n── o adaptador descobre sozinho quem é admin ──');
// Sem informar `botIsAdmin`: ele consulta o metadata e conclui.
const acoesAdm = [];
const sockSemAdm = {
  user: { id: '5511000000000:5@s.whatsapp.net' },
  groupMetadata: async () => ({
    participants: [
      { id: '5511000000000@s.whatsapp.net', admin: 'admin' },
      { id: ATACANTE, admin: 'admin' }, // atacante é admin -> não deve ser punido
    ],
  }),
  groupSettingUpdate: async (g, t) => { acoesAdm.push(`setting:${t}`); },
  groupParticipantsUpdate: async (g, a, c) => { acoesAdm.push(`participants:${c}`); },
  sendMessage: async () => { acoesAdm.push('aviso'); },
};
const rAdm = await afTutorial.executar({
  sock: sockSemAdm,
  // Grupo DIFERENTE de propósito: a consulta de administração é cacheada por
  // (grupo, autor), então reusar o mesmo grupo devolveria o resultado anterior
  // e o teste mediria a coisa errada.
  msg: { ...msgAtaque, key: { ...msgAtaque.key, remoteJid: '120363222222222222@g.us' } },
  args: [],
  reply: async () => {},
});
check(rAdm.ok === true, 'executou');
check(acoesAdm.length === 0, 'autor que é ADMIN não é punido (descoberto sozinho)');

console.log('\n── aviso quando falta sock/grupo ──');
const rSemMsg = await afTutorial.executar({ sock: { sendMessage: async () => {} }, reply: async () => {} });
check(rSemMsg.ok === false && rSemMsg.motivo === 'sem_grupo', `sem grupo informa o motivo (${rSemMsg.motivo})`);

console.log('\n── BLINDAGEM: nada pode derrubar o bot do usuário ──');
// O adaptador roda no handler dele. Uma exceção aqui pode quebrar o bot inteiro
// — então `executar` NUNCA pode lançar, por pior que seja a entrada.

const entradasHostis = [
  undefined,
  null,
  0,
  '',
  [],
  'texto',
  { sock: null },
  { sock: {} },
  { sock: {}, grupo: null },
  { sock: { groupMetadata: 'não é função' }, msg: { key: {} } },
  { sock: { groupMetadata: async () => { throw new Error('boom'); } }, msg: { key: { remoteJid: 'g@g.us' } } },
  { sock: { groupMetadata: async () => null }, msg: { key: { remoteJid: 'g@g.us' } } },
  { sock: { groupMetadata: async () => ({ participants: 'não é array' }) }, msg: { key: { remoteJid: 'g@g.us' } } },
  { sock: {}, msg: { key: null } },
  { sock: {}, msg: 'não é objeto' },
  { sock: {}, msg: { key: { remoteJid: 'g@g.us' } }, reply: 'não é função' },
  { sock: { groupSettingUpdate: () => { throw new Error('falha'); } }, msg: { key: { remoteJid: 'g@g.us' } } },
];

let lancou = 0;
for (const entrada of entradasHostis) {
  try {
    const r = await afTutorial.executar(entrada);
    if (!r || typeof r !== 'object' || typeof r.ok !== 'boolean') {
      lancou += 1;
      console.log(`   retorno inválido para ${JSON.stringify(entrada)}`);
    }
  } catch (e) {
    lancou += 1;
    console.log(`   LANÇOU para ${JSON.stringify(entrada)}: ${e.message}`);
  }
}
check(lancou === 0, `nenhuma entrada hostil derruba o bot (${entradasHostis.length} testadas)`);

console.log('\n── cache de metadata (não martela o WhatsApp) ──');
let consultas = 0;
const sockCache = {
  user: { id: `${NUMERO_USUARIO}:5@s.whatsapp.net` },
  groupMetadata: async () => {
    consultas += 1;
    return { participants: [{ id: `${NUMERO_USUARIO}@s.whatsapp.net`, admin: 'admin' }, { id: ATACANTE, admin: null }] };
  },
  groupSettingUpdate: async () => {},
  groupParticipantsUpdate: async () => {},
  sendMessage: async () => {},
};
const grupoCache = '120363111111111111@g.us';
for (let i = 0; i < 5; i++) {
  await afTutorial.executar({ sock: sockCache, msg: { key: { remoteJid: grupoCache, participant: ATACANTE } }, reply: async () => {} });
}
check(consultas === 1, `5 mensagens = 1 consulta de metadata (obtido ${consultas})`);

// ============================================================================
// 7) ERROS DE AMBIENTE
// ============================================================================

console.log('\n── API fora do ar ──');
const afCaiu = require((() => {
  const p = path.join(TMP, 'caiu.cjs');
  fs.writeFileSync(p, fonteEntregavel
    .replace(/const API_URL = '[^']*';/, "const API_URL = 'http://127.0.0.1:1/x';")
    .replace(/const KEY = '[^']*';/, `const KEY = '${registro.key}';`)
    .replace(/const BOT_ID = '[^']*';/, `const BOT_ID = '${NUMERO_USUARIO}';`));
  return p;
})());
afCaiu.ativar();
const rCaiu = await afCaiu.executar({ sock, grupo: GRUPO, autor: ATACANTE, reply, contexto: {} });
check(rCaiu.ok === false, 'falha controlada');
check(respostas.some((t) => t.includes('Serviço AntiFantasma indisponível')), 'avisa indisponível');

console.log('\n── chamada sem sock/grupo ──');
const rSemSock = await antiFantasma.executar({ contexto: {} });
check(rSemSock.ok === false, 'sem sock não quebra');

await new Promise((r) => server.close(r));

console.log('\n════════════════════════════════════════');
console.log(`RESULTADO: ${ok} ok | ${fail} falhas`);
console.log('════════════════════════════════════════');

fs.rmSync(TMP, { recursive: true, force: true });

if (fail) {
  console.log('\nFALHAS:');
  for (const e of erros) console.log(`- ${e}`);
  process.exit(1);
}
console.log('✅ FLUXO DO USUÁRIO VALIDADO SEM ERROS');
process.exit(0);