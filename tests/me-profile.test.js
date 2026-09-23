/**
 * !me / !getperfil — novo layout de perfil.
 *
 * Roda o HANDLER REAL (index.js) com socket falso e valida o que o comando
 * monta: nome, número, bio, tipo de conta, cargo e atividade (por grupo e
 * global), com alvo por menção, número, resposta e o próprio usuário.
 *
 * Os dados de perfil vêm dos métodos da fork (`fetchStatus`,
 * `getBusinessProfileV2`, `profilePictureUrl`) e do metadata do grupo — é isso
 * que o teste substitui, sem tocar em socket nenhum de verdade.
 *
 * Uso: node tests/me-profile.test.js
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-me-db-'));
process.env.DATABASE_PATH = TMP_DB;
const GRUPOS_DIR = path.join(TMP_DB, 'grupos');
fs.mkdirSync(GRUPOS_DIR, { recursive: true });

const CONFIG_PATH = path.join(TMP_DB, 'config.json');
process.env.CONFIG_PATH = CONFIG_PATH;
const NUMERO_DONO = '5511978819676';
const LID_DONO = '23734744260711@lid';
const NOME_DONO = 'Kannon';
const NOME_BOT = 'Lizzy';

fs.writeFileSync(CONFIG_PATH, JSON.stringify({
  numerodono: NUMERO_DONO,
  nomedono: NOME_DONO,
  nomebot: NOME_BOT,
  prefixo: '!',
  lidowner: LID_DONO,
}, null, 2));

let ok = 0, fail = 0;
const erros = [];
function check(cond, msg) {
  if (cond) { ok += 1; console.log(`✅ ${msg}`); }
  else { fail += 1; erros.push(msg); console.log(`❌ ${msg}`); }
}

const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';

const DONO_LID = LID_DONO;
const ADMIN_LID = '222000000000002@lid';
const ADMIN_PN = '5511911111111@s.whatsapp.net';
const USER_LID = '333000000000003@lid';
const USER_PN = '5511922222222@s.whatsapp.net';

let groupCounter = 0;
function makeGroup(extra = {}) {
  groupCounter += 1;
  const jid = `1203639000000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(
    path.join(GRUPOS_DIR, `${jid}.json`),
    JSON.stringify({ modobrincadeira: true, groupName: 'Grupo ME', ...extra }, null, 2)
  );
  return jid;
}

const PARTICIPANTS = [
  { id: BOT_LID, lid: BOT_LID, phoneNumber: BOT_JID, admin: 'admin' },
  { id: ADMIN_LID, lid: ADMIN_LID, phoneNumber: ADMIN_PN, admin: 'admin' },
  { id: USER_LID, lid: USER_LID, phoneNumber: USER_PN, admin: null },
  { id: DONO_LID, lid: DONO_LID, phoneNumber: `${NUMERO_DONO}@s.whatsapp.net`, admin: 'superadmin' },
];

// O handler tem throttle por REMETENTE (3 comandos/5s). A suíte manda dezenas
// de comandos em sequência, então cada chamada usa um remetente PRÓPRIO —
// senão a partir do 4º comando a resposta é "Calma aí!" e o teste mede a coisa
// errada (armadilha já registrada no !testcall/!antimidia).
let senderSeq = 0;
function nextSender() {
  senderSeq += 1;
  const n = String(senderSeq).padStart(6, '0');
  return { lid: `4440000000${n}@lid`, pn: `55119${n}@s.whatsapp.net` };
}

/**
 * Socket falso. O que importa aqui é o perfil: recado (bio), tipo de conta e
 * contatos nomeados. Tudo configurável por teste.
 */
function makeNazu({ sent, groupJid, opts = {} }) {
  const {
    bio = {},
    business = {},
    throwBio = false,
    throwBiz = false,
    contacts = {},
    onWhatsAppResult,
  } = opts;
  return {
    sendMessage: async (jid, content) => { sent.push({ jid, content }); return { key: { id: 'SENT' } }; },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
    store: { contacts },
    onWhatsApp: async (num) => (onWhatsAppResult !== undefined
      ? onWhatsAppResult
      : [{ jid: `${num}@s.whatsapp.net`, exists: true, lid: `${num}@lid` }]),
    signalRepository: { lidMapping: { getPNForLID: async () => null } },
    groupMetadata: async () => ({ id: groupJid, subject: 'Grupo ME', participants: PARTICIPANTS }),
    groupParticipantsUpdate: async () => ({}),
    groupRequestParticipantsList: async () => [],
    groupRequestParticipantsUpdate: async () => ({}),
    groupSettingUpdate: async () => ({}),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {},
    sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => 'https://pps.whatsapp.net/x.jpg',
    react: async () => ({}),
    fetchStatus: async (jid) => {
      if (throwBio) throw new Error('sem recado');
      const value = bio[String(jid)];
      if (value === undefined) return [];
      // A fork devolve LISTA ({ id, status, setAt }) — é o formato real.
      return [{ id: jid, status: value, setAt: 0 }];
    },
    getBusinessProfileV2: async (jid) => {
      if (throwBiz) throw new Error('sem perfil business');
      return business[String(jid)];
    },
  };
}

/** Executa o comando e devolve o texto enviado (última mensagem de texto). */
async function executar({
  groupJid,
  sender,
  text = '!me',
  mentionedJid,
  replyParticipant,
  opts = {},
}) {
  const sent = [];
  const nazu = makeNazu({ sent, groupJid, opts });
  const contextoAlvo = sender || nextSender().lid;
  const contextInfo = {};
  if (mentionedJid) contextInfo.mentionedJid = [mentionedJid];
  if (replyParticipant) contextInfo.participant = replyParticipant;
  const message = {
    extendedTextMessage: {
      text,
      ...(Object.keys(contextInfo).length ? { contextInfo } : {}),
    },
  };
  await handleMessage(nazu, {
    key: {
      remoteJid: groupJid,
      fromMe: false,
      id: `M-${Math.random().toString(36).slice(2, 9)}`,
      participant: contextoAlvo,
    },
    message,
    messageTimestamp: 1757900000,
    pushName: 'Testador',
  }, null, new Map(), null);
  const textos = sent.map(s => (typeof s.content?.text === 'string' ? s.content.text : '')).filter(Boolean);
  return textos[textos.length - 1] || '';
}

/** Apaga os JSONs de grupo já criados — para medir o total global isolado. */
function limparGrupos() {
  for (const f of fs.readdirSync(GRUPOS_DIR)) {
    if (f.endsWith('.json')) fs.unlinkSync(path.join(GRUPOS_DIR, f));
  }
}

// ============================================================================

console.log('\n── 1. layout pedido pelo dono ──');
{
  const groupJid = makeGroup();
  const out = await executar({ groupJid, sender: nextSender().lid });
  check(out.includes('╭━━━꧁༺ 👤 𝐏𝐄𝐑𝐅𝐈𝐋 ༻꧂━━━╮'), 'cabeçalho PERFIL (layout novo)');
  check(out.includes('╭━━━꧁༺ 📊 𝐀𝐓𝐈𝐕𝐈𝐃𝐀𝐃𝐄 ༻꧂━━━╮'), 'cabeçalho ATIVIDADE (layout novo)');
  check(out.includes('╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯'), 'fechamento no layout novo');
  check(out.includes('📛 Nome:'), 'campo Nome');
  check(out.includes('📱 Número:'), 'campo Número');
  check(out.includes('📝 Bio:'), 'campo Bio');
  check(out.includes('⭐ Status:'), 'campo Status');
  check(out.includes('🏢 Conta:'), 'campo Conta');
  check(out.includes('📌 Neste Grupo'), 'bloco deste grupo');
  check(out.includes('🌐 Todos os Grupos'), 'bloco global');
  check(out.includes('💬 Mensagens:') && out.includes('⚒️ Comandos:') && out.includes('🎨 Figurinhas:'), 'as três métricas');
  check(out.includes(`${NOME_BOT}  By  👑 ${NOME_DONO}`), 'rodapé nomebot By 👑 nomedono');
}

console.log('\n── 2. o alvo — menção, resposta e número ──');
{
  // Menção: perfil do TERCEIRO, não de quem digitou.
  const groupJid = makeGroup();
  const out = await executar({ groupJid, sender: nextSender().lid, mentionedJid: ADMIN_LID });
  check(out.includes('+5511911111111'), 'menção: mostra o número do mencionado');
  check(!out.includes('+5511922222222'), 'menção: NÃO mostra o número de quem digitou');
  check(out.includes('Status: Admin'), 'menção: cargo do mencionado (Admin)');

  // Resposta (citação).
  const groupJid2 = makeGroup();
  const out2 = await executar({ groupJid: groupJid2, sender: nextSender().lid, replyParticipant: ADMIN_LID });
  check(out2.includes('+5511911111111'), 'resposta: mostra o número de quem foi respondido');

  // Número digitado.
  const groupJid3 = makeGroup();
  const out3 = await executar({
    groupJid: groupJid3,
    sender: nextSender().lid,
    text: '!me 5511933333333',
    opts: { onWhatsAppResult: [{ jid: '5511933333333@s.whatsapp.net', exists: true, lid: '5511933333333@lid' }] },
  });
  check(out3.includes('+5511933333333'), 'número digitado aparece formatado');

  // Número inexistente.
  const out4 = await executar({
    groupJid: makeGroup(),
    sender: nextSender().lid,
    text: '!me 5511933333333',
    opts: { onWhatsAppResult: [{ jid: '5511933333333@s.whatsapp.net', exists: false }] },
  });
  check(out4.includes('não existe no WhatsApp'), 'número inexistente → recusa');

  // Número inválido.
  const out5 = await executar({ groupJid: makeGroup(), sender: nextSender().lid, text: '!me 123' });
  check(out5.includes('Número inválido'), 'número curto → recusa');

  // Próprio usuário quando não há menção/resposta.
  const out6 = await executar({ groupJid: makeGroup(), sender: ADMIN_LID });
  check(out6.includes('+5511911111111'), 'sem alvo: cai no próprio usuário');
}

console.log('\n── 3. nome nunca é JID/LID/número cru ──');
{
  // Nome vindo dos contatos da sessão (notify).
  const groupJid = makeGroup();
  const out = await executar({
    groupJid,
    sender: nextSender().lid,
    mentionedJid: ADMIN_LID,
    opts: { contacts: { [ADMIN_PN]: { notify: 'Carlos' } } },
  });
  check(out.includes('Nome: Carlos'), 'nome do contato usado quando disponível');
  check(!out.includes('@lid'), 'não vaza LID no perfil');
  check(!/Nome: \+?\d/.test(out), 'o nome não é um número cru');

  // Sem contato e sem pushname útil: cai no +número (e não em "undefined").
  const out2 = await executar({ groupJid: makeGroup(), sender: nextSender().lid, mentionedJid: ADMIN_LID });
  check(out2.includes('Nome: +5511911111111'), 'fallback do nome é o +número');
  check(!out2.includes('undefined') && !out2.includes('null'), 'sem undefined/null no perfil');
}

console.log('\n── 4. bio (recado), tipo de conta e cargo ──');
{
  const groupJid = makeGroup();
  const out = await executar({
    groupJid,
    sender: nextSender().lid,
    mentionedJid: ADMIN_LID,
    opts: { bio: { [ADMIN_PN]: 'Fale comigo no PV 😎' } },
  });
  check(out.includes('Bio: Fale comigo no PV 😎'), 'bio = recado real do perfil');

  const outSemBio = await executar({ groupJid: makeGroup(), sender: nextSender().lid, mentionedJid: ADMIN_LID });
  check(outSemBio.includes('Bio: Sem bio disponível'), 'sem recado → texto padrão');

  const outErroBio = await executar({
    groupJid: makeGroup(), sender: nextSender().lid, mentionedJid: ADMIN_LID, opts: { throwBio: true },
  });
  check(outErroBio.includes('Bio: Sem bio disponível'), 'fetchStatus lançando → não quebra o comando');

  // Business.
  const outBiz = await executar({
    groupJid: makeGroup(),
    sender: nextSender().lid,
    mentionedJid: ADMIN_LID,
    opts: { business: { [ADMIN_PN]: { description: 'Loja', category: 'Loja' } } },
  });
  check(outBiz.includes('Conta: Business'), 'com perfil w:biz → Business');

  const outPessoal = await executar({ groupJid: makeGroup(), sender: nextSender().lid, mentionedJid: ADMIN_LID });
  check(outPessoal.includes('Conta: Pessoal'), 'sem perfil w:biz → Pessoal');

  const outErroBiz = await executar({
    groupJid: makeGroup(), sender: nextSender().lid, mentionedJid: ADMIN_LID, opts: { throwBiz: true },
  });
  check(outErroBiz.includes('Conta: Pessoal'), 'getBusinessProfileV2 lançando → Pessoal');

  // Cargos.
  const outDono = await executar({ groupJid: makeGroup(), sender: nextSender().lid, mentionedJid: DONO_LID });
  check(outDono.includes('Status: Dono'), 'dono identificado pelo LID do config');
  const outMembro = await executar({ groupJid: makeGroup(), sender: ADMIN_LID, mentionedJid: USER_LID });
  check(outMembro.includes('Status: Membro'), 'membro comum → Membro');
}

console.log('\n── 5. atividade: grupo e global ──');
{
  // A soma global varre TODOS os arquivos de grupo — limpar antes isola a medida.
  limparGrupos();
  const groupJid = makeGroup({
    contador: [
      { id: ADMIN_LID, msg: 7, cmd: 3, figu: 2 },
      { id: USER_LID, msg: 1, cmd: 0, figu: 0 },
    ],
  });
  // Outro grupo com o MESMO usuário (conta no global).
  makeGroup({ contador: [{ id: ADMIN_LID, msg: 10, cmd: 4, figu: 1 }] });

  const out = await executar({ groupJid, sender: nextSender().lid, mentionedJid: ADMIN_LID });
  const blocoGrupo = out.split('📌 Neste Grupo')[1]?.split('🌐 Todos os Grupos')[0] || '';
  const blocoGlobal = out.split('🌐 Todos os Grupos')[1] || '';
  check(blocoGrupo.includes('💬 Mensagens: 7'), 'mensagens deste grupo (7)');
  check(blocoGrupo.includes('⚒️ Comandos: 3'), 'comandos deste grupo (3)');
  check(blocoGrupo.includes('🎨 Figurinhas: 2'), 'figurinhas deste grupo (2)');
  check(blocoGlobal.includes('💬 Mensagens: 17'), 'global soma os dois grupos (7+10)');
  check(blocoGlobal.includes('⚒️ Comandos: 7'), 'global soma comandos (3+4)');
  check(blocoGlobal.includes('🎨 Figurinhas: 3'), 'global soma figurinhas (2+1)');

  // O contador pode estar gravado por JID e o alvo chegar por LID: tem de casar.
  limparGrupos();
  const groupJid3 = makeGroup({ contador: [{ id: ADMIN_PN, msg: 5, cmd: 5, figu: 5 }] });
  const out3 = await executar({ groupJid: groupJid3, sender: nextSender().lid, mentionedJid: ADMIN_LID });
  const bloco3 = out3.split('📌 Neste Grupo')[1]?.split('🌐 Todos os Grupos')[0] || '';
  check(bloco3.includes('💬 Mensagens: 5'), 'contador por JID casando com alvo em LID');

  // Sem atividade nenhuma: zeros, nunca undefined.
  limparGrupos();
  const out4 = await executar({ groupJid: makeGroup(), sender: nextSender().lid, mentionedJid: ADMIN_LID });
  check(out4.includes('💬 Mensagens: 0'), 'sem histórico → 0 (não undefined)');
  check(!out4.includes('NaN'), 'sem NaN nos contadores');
}

console.log('\n── 6. alias !getperfil e robustez ──');
{
  const out = await executar({ groupJid: makeGroup(), sender: nextSender().lid, text: '!getperfil' });
  check(out.includes('👤 𝐏𝐄𝐑𝐅𝐈𝐋'), '!getperfil responde o mesmo layout');

  // Socket sem os métodos de perfil (fork anterior): não pode quebrar.
  const groupJid = makeGroup();
  const sent = [];
  const nazu = makeNazu({ sent, groupJid });
  delete nazu.fetchStatus;
  delete nazu.getBusinessProfileV2;
  await handleMessage(nazu, {
    key: { remoteJid: groupJid, fromMe: false, id: 'X1', participant: nextSender().lid },
    message: { extendedTextMessage: { text: '!me' } },
    messageTimestamp: 1757900000,
    pushName: 'Testador',
  }, null, new Map(), null);
  const textos = sent.map(s => s.content?.text || '').filter(Boolean);
  check(textos.some(t => t.includes('👤 𝐏𝐄𝐑𝐅𝐈𝐋')), 'socket sem métodos de perfil ainda responde');
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
console.log('✅ !me / !getperfil VALIDADOS');
process.exit(0);
