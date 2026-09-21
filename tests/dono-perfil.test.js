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
// O catálogo agora é o card "compartilhado do perfil": imagem + botão "Ver".
const comCatalogo = env1.filter(e => e.content?.nativeFlow);
const comContato = env1.filter(e => e.content?.contacts);
check(comCatalogo.length === 1, 'enviou 1 catálogo');
check(comContato.length === 1, 'enviou 1 card de perfil comercial');
check(
  env1.indexOf(comCatalogo[0]) < env1.indexOf(comContato[0]),
  'ordem correta: catálogo antes do card'
);

console.log('\n── 2. o catálogo usa a FOTO REAL do dono e tem o botão "Ver" ──');
check(comCatalogo[0]?.content?.image?.url === fotoAtual,
  `imagem = foto atual do dono (${fotoAtual})`);
check(comCatalogo[0]?.content?.caption === 'Souzzaaxzy', 'título/caption = nome do dono');
const botoesCat = comCatalogo[0]?.content?.nativeFlow || [];
check(botoesCat.length === 1, 'um botão só, como no card de catálogo compartilhado');
check(botoesCat[0]?.name === 'cta_catalog', 'o botão é do tipo cta_catalog');
let paramsCat = {};
try { paramsCat = JSON.parse(botoesCat[0]?.buttonParamsJson || '{}'); } catch { /* ilegível */ }
check(paramsCat.display_text === 'Ver', 'o botão mostra "Ver"');
check(String(paramsCat.merchant_url || '').includes(NUMERO_DONO), 'o botão aponta para o dono');

console.log('\n── 2b. NENHUMA das mensagens responde a do comando (sem quoted) ──');
check(comCatalogo[0]?.options?.quoted == null, 'catálogo sem quoted');
check(comContato[0]?.options?.quoted == null, 'card sem quoted');

console.log('\n── 2d. o card traz empresa, cargo e bio (ORG/TITLE/NOTE) ──');
const vcardCat = comContato[0]?.content?.contacts?.contacts?.[0]?.vcard || '';
check(vcardCat.includes('ORG:'), 'ORG (empresa) no vCard — habilita "Ver empresa"');
check(vcardCat.includes('TITLE:'), 'TITLE (cargo) no vCard');
check(vcardCat.includes('NOTE:'), 'NOTE (bio) no vCard');
check(vcardCat.includes(`waid=${NUMERO_DONO}`), 'waid presente — habilita "Conversar"');

console.log('\n── 3. trocar a foto do dono troca a foto do catálogo ──');
fotoAtual = 'https://pps.whatsapp.net/foto-2-NOVA.jpg';
const env2 = await rodar();
const cat2 = env2.find(e => e.content?.nativeFlow);
check(cat2?.content?.image?.url === fotoAtual,
  'a URL nova apareceu (sem cache)');

console.log('\n── 4. card de perfil comercial: vCard do número do dono ──');
const vcard = comContato[0]?.content?.contacts?.contacts?.[0]?.vcard || '';
check(vcard.includes('BEGIN:VCARD') && vcard.includes('END:VCARD'), 'vCard bem formado');
check(vcard.includes(`waid=${NUMERO_DONO}`), 'vCard traz o waid do dono');
check(vcard.includes(`+${NUMERO_DONO}`), 'vCard traz o telefone do dono');
check(comContato[0]?.content?.contacts?.displayName === 'Souzzaaxzy', 'displayName = nome do dono');

console.log('\n── 4b. a bio do card vem do RECADO real do dono ──');
// `fetchStatus` devolve uma LISTA ({ id, status, setAt }), como a fork faz.
// Com recado no perfil, o NOTE do vCard deve refletir esse texto.
const envRecado = await (async () => {
  const enviadosRec = [];
  const nazuRec = makeNazu({ enviados: enviadosRec });
  nazuRec.fetchStatus = async (jid) => [{ id: jid, status: 'Fale comigo, é o dono 😎' }];
  await handleMessage(nazuRec, msgDono(), null, new Map(), null);
  return enviadosRec;
})();
const vcardRec = envRecado.filter(e => e.content?.contacts)[0]?.content?.contacts?.contacts?.[0]?.vcard || '';
check(vcardRec.includes('NOTE:Fale comigo, é o dono 😎'), 'o recado real virou a bio (NOTE)');

console.log('\n── 4c. sem recado: a bio cai no texto montado ──');
const envSemRecado = await (async () => {
  const enviadosSR = [];
  const nazuSR = makeNazu({ enviados: enviadosSR });
  nazuSR.fetchStatus = async () => [{ id: 'x', status: '' }];
  await handleMessage(nazuSR, msgDono(), null, new Map(), null);
  return enviadosSR;
})();
const vcardSR = envSemRecado.filter(e => e.content?.contacts)[0]?.content?.contacts?.contacts?.[0]?.vcard || '';
check(vcardSR.includes('NOTE:') && vcardSR.includes('Dono do'), 'bio padrão quando não há recado');

console.log('\n── 5. sem foto do dono: ainda manda o card (e não o texto) ──');
falhaFoto = true;
const env3 = await rodar();
const cat3 = env3.filter(e => e.content?.nativeFlow);
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
    if (content?.nativeFlow || content?.contacts) throw new Error('sem suporte');
    return { key: { id: 'x' } };
  },
};
await handleMessage(nazuQuebrado, msgDono(), null, new Map(), null);
const textoFallback = enviadosFallback.filter(c => typeof c?.text === 'string');
check(textoFallback.length >= 1, 'mandou o texto de fallback (comando não fica mudo)');
check(textoFallback.some(t => t.text.includes('DONO DO BOT')), 'o texto é o de sempre');

console.log('\n── 7. o payload gerado vira mesmo productMessage/contactMessage na FORK ──');
// Este teste é o que faltava: os anteriores usam socket FALSO, então provam
// apenas a forma que o comando MONTA. Eles passavam até com uma fork sem
// suporte a `catalog` — medindo menos do que o problema real. Aqui o payload
// atravessa o `generateWAMessageContent` da fork instalada, que é quem decide
// se vira `productMessage` (catálogo) e `contactMessage` (card).
const { generateWAMessageContent, proto } = await import('@itsliaaa/baileys');

const uploadFalso = async () => ({ url: 'https://mmg.whatsapp.net/fake', directPath: '/v/fake' });
const recriar = async (conteudo) => generateWAMessageContent(conteudo, {
  userJid: DONO_JID, upload: uploadFalso, jid: GRUPO,
});

// A imagem do catálogo é lida pela fork para preparar o upload: troca a URL
// fictícia por um JPEG local só para esta verificação.
const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
  0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9
]);
const payloadCatalogo = {
  ...comCatalogo[0].content,
  image: JPEG,
};

// Se a fork instalada não montar o card, isto lança — vira falha de asserção
// em vez de derrubar a suíte.
let catReal = null;
try {
  catReal = await recriar(payloadCatalogo);
} catch (e) {
  check(false, `a fork instalada monta o catálogo (falhou: ${e?.message}) — falta atualizar a dependência?`);
}
if (catReal) {
  check(Boolean(catReal.interactiveMessage), 'o catálogo do !dono vira interactiveMessage na fork');
  check(Boolean(catReal.interactiveMessage?.header?.imageMessage), 'o header leva a imagem do dono');
  const botoesReais = catReal.interactiveMessage?.nativeFlowMessage?.buttons || [];
  check(botoesReais.length === 1, 'um botão no proto');
  check(botoesReais[0]?.name === 'cta_catalog', 'o botão chega como cta_catalog no proto');
}

const cardReal = await recriar(comContato[0].content);
check(Boolean(cardReal.contactMessage), 'card de perfil vira contactMessage na fork');
check(String(cardReal.contactMessage?.vcard || '').includes('BEGIN:VCARD'), 'o vCard chega ao proto');

// Round-trip: o que sai do generateWAMessageContent sobrevive ao encode/decode.
if (catReal?.interactiveMessage) {
  const decodificado = proto.Message.InteractiveMessage.decode(
    proto.Message.InteractiveMessage.encode(catReal.interactiveMessage).finish()
  );
  check(decodificado.nativeFlowMessage?.buttons?.[0]?.name === 'cta_catalog',
    'o botão do catálogo sobrevive ao encode/decode');
}

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