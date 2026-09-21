/**
 * !dono — catálogo (foto real do dono) + card de perfil comercial.
 *
 * Roda o HANDLER REAL (index.js) com socket falso e verifica a ORDEM pedida:
 * o catálogo sai primeiro e o card de perfil comercial logo abaixo. Também
 * confirma que a foto é lida do dono na hora (troca de foto => nova URL) e que
 * o comando nunca fica mudo (fallback de texto).
 *
 * Uso: node tests/dono-perfil.test.js
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-dono-db-'));
process.env.DATABASE_PATH = TMP_DB;
const GRUPOS_DIR = path.join(TMP_DB, 'grupos');
fs.mkdirSync(GRUPOS_DIR, { recursive: true });

let ok = 0, fail = 0;
const erros = [];
function check(cond, msg) {
  if (cond) { ok += 1; console.log(`✅ ${msg}`); }
  else { fail += 1; erros.push(msg); console.log(`❌ ${msg}`); }
}

const CONFIG_PATH = path.join(TMP_DB, 'config.json');
// O handler lê a config de CONFIG_FILE, que respeita CONFIG_PATH (utils/paths.js).
process.env.CONFIG_PATH = CONFIG_PATH;
const NUMERO_DONO = '5511999999999';
const DONO_JID = `${NUMERO_DONO}@s.whatsapp.net`;

fs.writeFileSync(CONFIG_PATH, JSON.stringify({
  numerodono: NUMERO_DONO,
  nomedono: 'Souzzaaxzy',
  nomebot: 'Lizzy',
  prefixo: '!',
  lidowner: null,
}, null, 2));

const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';

function makeGroup(name = 'Grupo Dono') {
  const jid = '120363700000000001@g.us';
  fs.writeFileSync(
    path.join(GRUPOS_DIR, `${jid}.json`),
    JSON.stringify({ modobrincadeira: true, groupName: name }, null, 2)
  );
  return jid;
}

const GRUPO = makeGroup();

const PARTICIPANTS = [
  { id: BOT_LID, lid: BOT_LID, phoneNumber: BOT_JID, admin: 'admin' },
  { id: '222000000000001@lid', lid: '222000000000001@lid', phoneNumber: `${NUMERO_DONO}@s.whatsapp.net`, admin: 'superadmin' },
];

/** Foto "atual" do dono — muda entre chamadas para provar que não há cache. */
let fotoAtual = 'https://pps.whatsapp.net/foto-1.jpg';
let falhaFoto = false;
let consultasFoto = 0;

function makeNazu({ enviados }) {
  return {
    sendMessage: async (jid, content, options) => {
      enviados.push({ jid, content, options });
      return { key: { id: `SENT-${enviados.length}` } };
    },
    groupParticipantsUpdate: async () => ({}),
    groupSettingUpdate: async () => ({}),
    groupMetadata: async () => ({ id: GRUPO, subject: 'Grupo Dono', participants: PARTICIPANTS }),
    groupRequestParticipantsList: async () => [],
    groupRequestParticipantsUpdate: async () => ({}),
    profilePictureUrl: async (jid, type) => {
      consultasFoto += 1;
      if (falhaFoto) throw new Error('no profile picture');
      // Só o dono tem foto neste teste.
      if (String(jid).split('@')[0] !== NUMERO_DONO) throw new Error('no profile picture');
      return fotoAtual;
    },
    onWhatsApp: async (jid) => [{ jid, exists: true }],
    getName: async () => 'Souzzaaxzy',
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {},
    sendPresenceUpdate: async () => {},
    react: async () => ({}),
    signalRepository: { lidMapping: { getPNForLID: async () => null, getLIDForPN: async () => null } },
  };
}

/**
 * Um remetente diferente por cenário.
 *
 * O handler tem throttle de comandos por REMETENTE (3 por 5s). Reusar o mesmo
 * autor faria as execuções seguintes caírem no anti-flood e o teste mediria a
 * mensagem de "calma aí" em vez do `!dono` — foi exatamente o que aconteceu na
 * primeira versão. `!dono` não exige cargo, então variar o autor é seguro.
 */
let cenario = 0;
function msgDono(texto = '!dono') {
  cenario += 1;
  const lid = `2220000000000${String(cenario).padStart(2, '0')}@lid`;
  const pn = `551190000000${String(cenario).padStart(2, '0')}@s.whatsapp.net`;
  return {
    key: {
      remoteJid: GRUPO,
      fromMe: false,
      id: `DONO-${cenario}-${Date.now()}`,
      participant: lid,
      participantAlt: pn,
    },
    message: { conversation: texto },
    messageTimestamp: Math.floor(Date.now() / 1000),
    pushName: 'Dono',
  };
}

async function rodar(texto = '!dono') {
  const enviados = [];
  const nazu = makeNazu({ enviados });
  await handleMessage(nazu, msgDono(texto), null, new Map(), null);
  return enviados;
}

// ============================================================================

console.log('\n── 1. o catálogo sai PRIMEIRO e o card logo abaixo ──');
const env1 = await rodar();
const comCatalogo = env1.filter(e => e.content?.catalog);
const comContato = env1.filter(e => e.content?.contacts);
check(comCatalogo.length === 1, 'enviou 1 catálogo');
check(comContato.length === 1, 'enviou 1 card de perfil comercial');
check(
  env1.indexOf(comCatalogo[0]) < env1.indexOf(comContato[0]),
  'ordem correta: catálogo antes do card'
);

console.log('\n── 2. o catálogo usa a FOTO REAL do dono ──');
check(comCatalogo[0]?.content?.catalog?.catalogImage?.url === fotoAtual,
  `catalogImage = foto atual do dono (${fotoAtual})`);
check(comCatalogo[0]?.content?.businessOwnerJid === DONO_JID,
  `businessOwnerJid = ${DONO_JID}`);
check(comCatalogo[0]?.content?.catalog?.title === 'Souzzaaxzy', 'título = nome do dono');

console.log('\n── 3. trocar a foto do dono troca a foto do catálogo ──');
fotoAtual = 'https://pps.whatsapp.net/foto-2-NOVA.jpg';
const env2 = await rodar();
const cat2 = env2.find(e => e.content?.catalog);
check(cat2?.content?.catalog?.catalogImage?.url === fotoAtual,
  'a URL nova apareceu (sem cache)');

console.log('\n── 4. card de perfil comercial: vCard do número do dono ──');
const vcard = comContato[0]?.content?.contacts?.contacts?.[0]?.vcard || '';
check(vcard.includes('BEGIN:VCARD') && vcard.includes('END:VCARD'), 'vCard bem formado');
check(vcard.includes(`waid=${NUMERO_DONO}`), 'vCard traz o waid do dono');
check(vcard.includes(`+${NUMERO_DONO}`), 'vCard traz o telefone do dono');
check(comContato[0]?.content?.contacts?.displayName === 'Souzzaaxzy', 'displayName = nome do dono');

console.log('\n── 5. sem foto do dono: ainda manda o card (e não o texto) ──');
falhaFoto = true;
const env3 = await rodar();
const cat3 = env3.filter(e => e.content?.catalog);
const cont3 = env3.filter(e => e.content?.contacts);
const texto3 = env3.filter(e => typeof e.content?.text === 'string');
check(cat3.length === 0, 'não mandou catálogo sem foto');
check(cont3.length === 1, 'mandou o card mesmo sem foto');
check(texto3.length === 0, 'não caiu no fallback de texto');
falhaFoto = false;

console.log('\n── 6. comando nunca fica mudo (fallback quando nada sai) ──');
// Aqui catálogo e card falham no socket, então o comando deve cair no texto de
// sempre — em vez de ficar mudo.
const enviadosFallback = [];
const nazuQuebrado = {
  ...makeNazu({ enviados: enviadosFallback }),
  profilePictureUrl: async () => { throw new Error('sem foto'); },
  sendMessage: async (jid, content) => {
    enviadosFallback.push(content);
    if (content?.catalog || content?.contacts) throw new Error('sem suporte');
    return { key: { id: 'x' } };
  },
};
await handleMessage(nazuQuebrado, msgDono(), null, new Map(), null);
const textoFallback = enviadosFallback.filter(c => typeof c?.text === 'string');
check(textoFallback.length >= 1, 'mandou o texto de fallback (comando não fica mudo)');
check(textoFallback.some(t => t.text.includes('DONO DO BOT')), 'o texto é o de sempre');

console.log('\n════════════════════════════════════════');
console.log(`RESULTADO: ${ok} ok | ${fail} falhas`);
console.log('════════════════════════════════════════');
fs.rmSync(TMP_DB, { recursive: true, force: true });
if (fail) {
  console.log('\nFALHAS:');
  for (const e of erros) console.log(`- ${e}`);
  process.exit(1);
}
console.log('✅ !dono VALIDADO');
process.exit(0);