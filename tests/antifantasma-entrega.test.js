/**
 * TESTE INTEGRADO — o usuário recebe o arquivo DA LIZZY e usa.
 *
 * Diferente do `antifantasma-usuario.test.js` (que monta o arquivo com os
 * mesmos replaces do comando), aqui o arquivo sai do `!addghostcmd` rodando de
 * verdade no handler. Assim o teste cobre a cadeia inteira:
 *
 *   !addghostcmd (handler real) -> arquivo enviado -> bot do usuário -> API
 *
 * Se o comando montar o arquivo errado (URL, key ou botId), este teste falha —
 * é a diferença entre "o adaptador funciona" e "a ENTREGA funciona".
 *
 * Uso: node tests/antifantasma-entrega.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');
const require = createRequire(import.meta.url);

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-entrega-'));
process.env.DATABASE_PATH = TMP;
fs.mkdirSync(path.join(TMP, 'grupos'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'antifantasma'), { recursive: true });

let ok = 0;
let fail = 0;
const erros = [];

function check(cond, msg) {
  if (cond) { ok += 1; console.log(`✅ ${msg}`); }
  else { fail += 1; erros.push(msg); console.log(`❌ ${msg}`); }
}

// API real no ar: o arquivo entregue precisa apontar para um servidor de verdade.
const api = await import(new URL('../dados/src/antifantasma/api.js', import.meta.url).href);
const server = api.iniciarApi(0);
await new Promise((r) => setTimeout(r, 250));
const portaApi = server.address().port;

const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;

const DONO = '5599999999999@s.whatsapp.net';
const DONO_LID = '111111111111111@lid';
const USUARIO = '5511999999999@s.whatsapp.net';
const GRUPO = '120363900000000001@g.us';
fs.writeFileSync(path.join(TMP, 'grupos', `${GRUPO}.json`), JSON.stringify({ groupName: 'G' }));

const sent = [];
const nazu = {
  sendMessage: async (jid, c) => { sent.push({ jid, c }); return { key: { id: 'S' + sent.length } }; },
  user: { id: `${DONO.split('@')[0]}:5@s.whatsapp.net`, lid: DONO_LID, name: 'Lizzy' },
  onWhatsApp: async (jid) => [{ jid, exists: true, lid: jid.replace('@s.whatsapp.net', '@lid') }],
  signalRepository: { lidMapping: { getPNForLID: async () => null } },
  groupMetadata: async () => ({
    id: GRUPO, subject: 'G',
    participants: [
      { id: DONO_LID, lid: DONO_LID, phoneNumber: DONO, admin: 'admin' },
      { id: '222@lid', lid: '222@lid', phoneNumber: USUARIO, admin: 'admin' },
    ],
  }),
  groupParticipantsUpdate: async () => ({}),
  groupRequestParticipantsList: async () => [],
  groupRequestParticipantsUpdate: async () => ({}),
  ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
  readMessages: async () => {}, sendPresenceUpdate: async () => {},
  profilePictureUrl: async () => 'x', react: async () => ({}),
};

// ── 1) O DONO USA O COMANDO ────────────────────────────────────────────────
console.log('── !addghostcmd (handler real) ──');
await handleMessage(nazu, {
  key: { remoteJid: GRUPO, fromMe: true, id: 'CMD', participant: DONO },
  message: {
    extendedTextMessage: {
      text: '!addghostcmd',
      contextInfo: { remoteJid: GRUPO, quotedMessage: { conversation: 'quero' }, participant: USUARIO, stanzaId: 'Q1' },
    },
  },
  messageTimestamp: 1757900000,
  pushName: 'Dono',
}, null, new Map(), null);

const doc = sent.find((s) => s.c?.document);
check(Boolean(doc), 'o comando enviou o arquivo');
check(doc?.c?.fileName === 'antifantasma.js', `nome do arquivo (${doc?.c?.fileName})`);

const conteudoEntregue = String(doc?.c?.document || '');
check(conteudoEntregue.includes('executar'), 'o conteúdo é o adaptador');

// ── 2) O ARQUIVO ENTREGUE ESTÁ CONFIGURADO? ───────────────────────────────
console.log('\n── o arquivo vem pronto para uso ──');
const urlNoArquivo = /const API_URL = '([^']*)';/.exec(conteudoEntregue)?.[1];
const keyNoArquivo = /const KEY = '([^']*)';/.exec(conteudoEntregue)?.[1];
const botIdNoArquivo = /const BOT_ID = '([^']*)';/.exec(conteudoEntregue)?.[1];

check(!conteudoEntregue.includes('api.exemplo.com'), 'o placeholder da URL foi substituído');
check(Boolean(urlNoArquivo) && urlNoArquivo.includes('/api/antifantasma/exec'), `API_URL aponta para o endpoint (${urlNoArquivo})`);
check(/^MTX-GHOST-[0-9A-F]{8}$/.test(keyNoArquivo || ''), `KEY preenchida (${keyNoArquivo})`);
check(botIdNoArquivo === USUARIO.split('@')[0], `BOT_ID é o usuário (${botIdNoArquivo})`);

// ── 3) O USUÁRIO INSTALA ESSE ARQUIVO ─────────────────────────────────────
console.log('\n── o usuário instala e roda ──');
// A URL entregue aponta para a porta pública detectada; redirecionamos só o
// host/porta para o servidor local do teste (o resto do arquivo é intacto).
const arquivoParaRodar = conteudoEntregue.replace(
  /const API_URL = '[^']*';/,
  `const API_URL = 'http://127.0.0.1:${portaApi}/api/antifantasma/exec';`
);
const destino = path.join(TMP, 'antifantasma.cjs');
fs.writeFileSync(destino, arquivoParaRodar);
const antiFantasma = require(destino);

const acoes = [];
const sock = {
  groupSettingUpdate: async (g, t) => { acoes.push(`setting:${t}`); },
  groupParticipantsUpdate: async (g, a, ac) => { acoes.push(`participants:${ac}`); },
  sendMessage: async () => { acoes.push('aviso'); },
};

antiFantasma.ativar();
const r = await antiFantasma.executar({
  sock,
  grupo: GRUPO,
  autor: '5511888888888@s.whatsapp.net',
  contexto: { isGroup: true, botIsAdmin: true, sender: '5511888888888@s.whatsapp.net', selectiveDistribution: true, undecryptableGroupMessage: true },
});

check(r.ok === true, 'executou sem erro');
check(acoes.includes('setting:announcement'), 'fechou o grupo');
check(acoes.includes('participants:remove'), 'baniu o atacante');
check(acoes.includes('setting:not_announcement'), 'reabriu o grupo');

// ── 4) O TUTORIAL ENVIADO ESTÁ CORRETO? ───────────────────────────────────
console.log('\n── o tutorial enviado ──');
// O tutorial vem em texto + code block (campo `code`).
const tutorial = sent.map((s) => [s.c?.text, s.c?.code, s.c?.footerText, s.c?.headerText]
  .filter((v) => typeof v === 'string').join('\n')).join('\n');
check(tutorial.includes('antifantasma.js'), 'diz onde colocar o arquivo');
check(tutorial.includes("require('./antifantasma')"), 'mostra o import correto');
check(tutorial.includes('case'), 'mostra exemplo de case');
check(tutorial.includes('ativar') && tutorial.includes('desativar'), 'explica ativar/desativar');
check(tutorial.includes(String(keyNoArquivo)) || tutorial.includes('Key:'), 'apresenta a key ao usuário');
check(tutorial.includes('EXEMPLO'), 'deixa claro que o nome da case é livre');

await new Promise((r2) => server.close(r2));

console.log('\n════════════════════════════════════════');
console.log(`RESULTADO: ${ok} ok | ${fail} falhas`);
console.log('════════════════════════════════════════');

fs.rmSync(TMP, { recursive: true, force: true });

if (fail) {
  console.log('\nFALHAS:');
  for (const e of erros) console.log(`- ${e}`);
  process.exit(1);
}
console.log('✅ ENTREGA + USO VALIDADOS DE PONTA A PONTA');
process.exit(0);