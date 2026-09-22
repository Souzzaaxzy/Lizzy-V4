/**
 * !testverify — experimento de MarkAsVerifiedAction.
 *
 * O comando e um INSTRUMENTO: ele constroi o envelope correto (ProtocolMessage
 * type 36) e o envia pelo caminho real. Este teste fixa o contrato:
 *
 *   - so o dono usa (permissao do sistema existente, sem bypass);
 *   - `debug` mostra o diagnostico SEM enviar nada;
 *   - alvo por mencao; sem mencao, o proprio remetente;
 *   - NAO fabrica `verifiedIdentityKey` nem inventa `verified`/`actionSeq`;
 *   - a resposta SEPARA "envio" de "efeito" (nao promete selo);
 *   - fork sem schema/helper falha com mensagem clara;
 *   - erro de envio nao derruba o bot.
 *
 * Uso: node tests/testverify.test.js
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-testverify-db-'));
process.env.DATABASE_PATH = TMP_DB;
const GRUPOS_DIR = path.join(TMP_DB, 'grupos');
fs.mkdirSync(GRUPOS_DIR, { recursive: true });

const CONFIG_PATH = path.join(TMP_DB, 'config.json');
process.env.CONFIG_PATH = CONFIG_PATH;
const NUMERO_DONO = '5511978819676';
fs.writeFileSync(CONFIG_PATH, JSON.stringify({
  numerodono: NUMERO_DONO,
  nomedono: 'Dono',
  nomebot: 'Lizzy',
  prefixo: '!',
  lidowner: null,
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
// O dono e reconhecido pelo NUMERO (numerodono) ou pelo fromMe. O teste usa o
// PN do dono como `participant`, que casa com `senderBase === ownerBase`.
const DONO_LID = '222000000000001@lid';
const DONO_PN = `${NUMERO_DONO}@s.whatsapp.net`;
const OUTRO_LID = '333000000000003@lid';
const OUTRO_PN = '5511911111111@s.whatsapp.net';

let groupCounter = 0;
function makeGroup() {
  groupCounter += 1;
  const jid = `1203637000000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(path.join(GRUPOS_DIR, `${jid}.json`),
    JSON.stringify({ modobrincadeira: true, groupName: 'G' }, null, 2));
  return jid;
}

const PARTICIPANTS = [
  { id: BOT_LID, lid: BOT_LID, phoneNumber: BOT_JID, admin: 'admin' },
  { id: DONO_LID, lid: DONO_LID, phoneNumber: DONO_PN, admin: 'superadmin' },
  { id: OUTRO_LID, lid: OUTRO_LID, phoneNumber: OUTRO_PN, admin: null },
];

function makeNazu({ sent, temSchema = true, temHelper = true, falhaEnvio = false }) {
  return {
    sendMessage: async (jid, content) => { sent.push({ jid, content }); return { key: { id: `S${sent.length}` } }; },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
    onWhatsApp: async (j) => [{ jid: j, exists: true }],
    signalRepository: { lidMapping: { getPNForLID: async () => null } },
    groupMetadata: async () => ({ subject: 'G', participants: PARTICIPANTS }),
    groupParticipantsUpdate: async () => ({}),
    groupRequestParticipantsList: async () => [],
    groupRequestParticipantsUpdate: async () => ({}),
    groupSettingUpdate: async () => ({}),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {},
    sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => 'x',
    react: async () => ({}),
    // O helper da fork. Registra o que o comando pediu.
    ...(temHelper ? {
      _mvaCalls: [],
      sendMarkAsVerifiedAction: async function (opts) {
        this._mvaCalls.push(opts);
        if (falhaEnvio) return { ok: false, built: null, error: 'transporte caiu', reason: 'transporte' };
        return { ok: true, built: { type: 36 }, messageId: opts.messageId };
      },
    } : {}),
  };
}

let senderSeq = 0;
/**
 * Executa o comando como o DONO.
 *
 * O handler tem throttle por REMETENTE (3 comandos / 5s): se o mesmo remetente
 * mandasse todos os comandos da suíte, do 4º em diante a resposta seria
 * "Calma aí!" e o teste mediria a coisa errada (armadilha já documentada em
 * !testcall / !antimidia). Trocar o remetente NÃO serve aqui, porque a
 * permissão de dono vem de `senderBase === ownerBase`.
 *
 * O throttle é então contornado pelo caminho que o próprio handler já prevê:
 * `info.key.fromMe === true` (comando enviado pelo bot) pula o throttle E
 * também conta como dono. Os casos de PERMISSÃO usam `fromMe: false` com um
 * remetente que não é o dono, para medir a recusa de verdade.
 */
async function rodar({ texto, sender = DONO_PN, mentioned, temSchema = true, temHelper = true, falhaEnvio = false, fromMe = true }) {
  const sent = [];
  const nazu = makeNazu({ sent, temSchema, temHelper, falhaEnvio });
  const ctx = {};
  if (mentioned) ctx.mentionedJid = [mentioned];
  await handleMessage(nazu, {
    key: { remoteJid: makeGroup(), fromMe, id: `M-${++senderSeq}`, participant: sender },
    message: { extendedTextMessage: { text: texto, ...(mentionField(ctx)) } },
    messageTimestamp: 1757900000,
    pushName: 'Tester',
  }, null, new Map(), null);
  const textos = sent.map(s => s.content?.text).filter(t => typeof t === 'string');
  return { sent, texto: textos.join('\n'), nazu, last: textos[textos.length - 1] || '' };
}

function mentionField(ctx) {
  return Object.keys(ctx).length ? { contextInfo: ctx } : {};
}

// ============================================================================

console.log('\n── 1. o schema existe na dependencia instalada ──');
{
  const { proto } = await import('@itsliaaa/baileys');
  check(proto.Message.ProtocolMessage.Type.MARK_AS_VERIFIED_ACTION === 36,
    'MARK_AS_VERIFIED_ACTION = 36 no WAProto instalado');
  check(Boolean(proto.Message.MarkAsVerifiedAction), 'a message MarkAsVerifiedAction existe');
}

console.log('\n── 2. permissao: so o dono ──');
{
  // `fromMe: false` de propósito: mede a recusa REAL de um terceiro.
  const r = await rodar({ texto: '!testverify', sender: OUTRO_PN, fromMe: false });
  check(/apenas para o dono/i.test(r.texto), 'nao-dono e recusado');
  check(r.nazu._mvaCalls.length === 0, 'nada foi enviado pelo nao-dono');
}

console.log('\n── 3. debug: diagnostico SEM enviar ──');
{
  const r = await rodar({ texto: '!testverify debug' });
  check(/TESTVERIFY — DEBUG/.test(r.texto), 'mostra o cabecalho de debug');
  check(/TYPE: MARK_AS_VERIFIED_ACTION \(36\)/.test(r.texto), 'mostra o type number');
  check(/CAMPO PAI: ProtocolMessage\.markAsVerifiedAction = 32/.test(r.texto), 'mostra o campo pai');
  check(/APP STATE: NÃO utilizado/.test(r.texto), 'deixa explicito que NAO usa App State');
  check(/identityKey: \[AUSENTE — não fabricada\]/.test(r.texto), 'deixa explicito que a identity key nao foi fabricada');
  check(r.nazu._mvaCalls.length === 0, 'debug NAO envia a action');
}

console.log('\n── 4. envio: usa o helper com o alvo correto ──');
{
  const r = await rodar({ texto: '!testverify' });
  check(r.nazu._mvaCalls.length === 1, 'enviou exatamente uma action');
  const call = r.nazu._mvaCalls[0];
  check(String(call.userJidString).split('@')[0] === String(DONO_PN).split('@')[0],
    `sem mencao, o alvo e o proprio remetente (obtido: ${call.userJidString})`);
  check(!('verified' in call), 'NAO inventa `verified`');
  check(!('actionSeq' in call), 'NAO inventa `actionSeq`');
  check(!('verifiedIdentityKey' in call), 'NAO fabrica `verifiedIdentityKey`');
  check(typeof call.messageId === 'string' && call.messageId.length > 0, 'envia um messageId');
}

console.log('\n── 5. mencao: o alvo passa a ser o mencionado ──');
{
  const r = await rodar({ texto: '!testverify @alguem', mentioned: OUTRO_LID });
  check(r.nazu._mvaCalls[0]?.userJidString === OUTRO_LID, 'o alvo e o mencionado');
  check(r.nazu._mvaCalls[0]?.userJidString !== DONO_LID, 'nao usa o remetente quando ha mencao');
}

console.log('\n── 6. a resposta separa ENVIO de EFEITO ──');
{
  const r = await rodar({ texto: '!testverify' });
  check(/ENVIO: OK/.test(r.texto), 'reporta o envio como OK');
  check(/Resultado funcional: NÃO CONFIRMADO/.test(r.texto), 'diz explicitamente que o efeito NAO foi confirmado');
  check(/não significa que o/.test(r.texto), 'explica que ACK != efeito visual');
  check(!/selo azul|verificado com sucesso|agora você é verificado/i.test(r.texto),
    'NAO promete selo em nenhum momento');
}

console.log('\n── 7. fork sem schema / sem helper ──');
{
  // Simula helper ausente (schema antigo sem a funcao na fachada).
  const r = await rodar({ texto: '!testverify', temHelper: false });
  check(/não expõe `sendMarkAsVerifiedAction`/.test(r.texto), 'avisa que o helper nao existe');
  check(/atualize a dependência/i.test(r.texto), 'diz o que fazer');
}

console.log('\n── 8. erro de envio nao derruba o bot ──');
{
  const r = await rodar({ texto: '!testverify', falhaEnvio: true });
  check(/ENVIO: FALHA/.test(r.texto), 'reporta a falha');
  check(/Detalhe: transporte caiu/.test(r.texto), 'mostra o detalhe do erro');
  check(!/Ocorreu um erro 💔/.test(r.texto), 'nao cai no catch generico');
}

console.log('\n── 9. menus ──');
{
  const menu = await (await import('../dados/src/menus/menudono.js')).default('!', 'Lizzy', 'Teste');
  check(menu.includes('testverify'), 'o comando aparece no menudono');
  check(menu.includes('Teste experimental de MarkAsVerifiedAction'), 'com a descricao experimental');
  check(/não garante selo/.test(menu), 'o menu deixa claro que nao garante selo');
  check(!/dar selo|selo azul|Meta Verified/i.test(menu), 'o menu NAO promete selo');
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
console.log('✅ !testverify VALIDADO');
process.exit(0);
