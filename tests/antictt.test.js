/**
 * Testes do `!antictt` (AntiContato) e da entrada no `!antis`.
 *
 * Roda o handler REAL (NazuninhaBotExec) com socket Baileys falso:
 *   - `!antictt` sem argumento mostra o uso;
 *   - `!antictt on/off` liga/desliga (só admin; exige bot admin para ligar);
 *   - `!antictt` consulta o status;
 *   - contato/listas enviados por membro comum são apagados e o remetente é
 *     removido, com AVISO de banimento que diz o MOTIVO;
 *   - admin, dono e subdono ficam isentos;
 *   - com o anti desligado, nada acontece;
 *   - o painel `!antis` mostra o AntiContato.
 *
 * Uso: node tests/antictt.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');

// Banco temporário ANTES de importar o index (paths.js lê DATABASE_PATH no load).
const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-ctt-db-'));
process.env.DATABASE_PATH = TMP_DB;
// Reforço: o antiCtt grava em DATABASE_DIR; fixar o arquivo no temporário
// garante que o teste NUNCA toque o banco real do repositório.
process.env.ANTICTT_FILE = path.join(TMP_DB, 'antictt.json');
fs.mkdirSync(path.join(TMP_DB, 'grupos'), { recursive: true });

const RESULTS = [];
let CURRENT = null;

function test(name, fn) {
  CURRENT = { name, passed: 0, failed: 0, errors: [] };
  RESULTS.push(CURRENT);
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      return r.then(() => finish(name)).catch((e) => { CURRENT.failed++; CURRENT.errors.push(`EXCEÇÃO: ${e?.stack || e}`); finish(name); });
    }
    finish(name);
  } catch (e) {
    CURRENT.failed++; CURRENT.errors.push(`EXCEÇÃO: ${e?.stack || e}`); finish(name);
  }
  return Promise.resolve();
}
function finish(name) {
  console.log(`${CURRENT.failed === 0 ? '✅' : '❌'} ${name} (${CURRENT.passed} ok, ${CURRENT.failed} falhas)`);
  for (const e of CURRENT.errors) console.log(`     ${e.split('\n')[0]}`);
}
function ok(c, m) { if (c) CURRENT.passed++; else { CURRENT.failed++; CURRENT.errors.push(`ASSERT FALHOU: ${m}`); } }
function eq(a, b, m) { ok(a === b, `${m} — esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`); }

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';
const OUTRO_JID = '5511000000003@s.whatsapp.net';
const OUTRO_LID = '111000000000003@lid';

let groupCounter = 0;
let authorCounter = 0;
const GRUPOS = path.join(TMP_DB, 'grupos');

/** Autor ÚNICO por execução: o handler aplica throttle de 3 comandos/5s por
 * REMETENTE, então reutilizar o mesmo remetente mediria o rate limit. */
function nextAuthor() {
  authorCounter++;
  return {
    lid: `99${String(authorCounter).padStart(6, '0')}888@lid`,
    jid: `5599${String(authorCounter).padStart(6, '0')}777@s.whatsapp.net`,
  };
}

function makeGroup() {
  groupCounter++;
  const jid = `1203639500000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(path.join(GRUPOS, `${jid}.json`), JSON.stringify({ groupName: 'G' }, null, 2));
  return jid;
}

function makeNazu({ sent, groupJid, authorIsAdmin = false, botIsAdmin = true, removals, author }) {
  return {
    sendMessage: async (jid, content, options) => { sent.push({ jid, content, options }); return { key: { id: `S-${sent.length}` } }; },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
    onWhatsApp: async (jid) => [{ jid, exists: true, lid: jid === author.jid ? author.lid : jid }],
    signalRepository: { lidMapping: { getPNForLID: async () => author.jid } },
    groupMetadata: async () => ({
      id: groupJid, subject: 'G',
      participants: [
        { id: author.lid, admin: authorIsAdmin ? 'admin' : null, phoneNumber: author.jid },
        { id: OUTRO_LID, admin: null, phoneNumber: OUTRO_JID },
        { id: BOT_LID, admin: botIsAdmin ? 'admin' : null, phoneNumber: BOT_JID },
      ],
    }),
    groupParticipantsUpdate: async (jid, jids, action) => { removals.push({ jid, jids, action }); return [{ status: '200' }]; },
    groupRequestParticipantsList: async () => [],
    groupRequestParticipantsUpdate: async () => ({}),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {},
    sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => 'x',
    react: async () => ({}),
  };
}

const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;
if (typeof handleMessage !== 'function') throw new Error('index.js não exporta o handler');
const antiCttMod = await import(new URL('../dados/src/utils/antiCtt.js', import.meta.url).href);

/** Executa um comando de texto (ex.: "!antictt on").
 *
 * IMPORTANTE: dentro do MESMO grupo, use o MESMO `author`. O handler cacheia o
 * metadata do grupo (por id), então trocar o autor no mesmo grupo faria o teste
 * medir um metadata velho — foi o que mascarou o admin na primeira versão. */
async function runCmd(text, opts = {}) {
  const sent = [];
  const removals = [];
  const author = opts.author || nextAuthor();
  const groupJid = opts.groupJid || makeGroup();
  const nazu = makeNazu({ sent, groupJid, removals, author, ...opts });
  const info = {
    key: { remoteJid: groupJid, fromMe: false, id: `CMD-${groupCounter}-${Math.random().toString(36).slice(2, 7)}`, participant: author.lid },
    message: { extendedTextMessage: { text, contextInfo: { remoteJid: groupJid } } },
    messageTimestamp: 1757900000, pushName: 'Autor',
  };
  await handleMessage(nazu, info, null, new Map(), null);
  const out = sent.map((s) => s.content?.text ?? '').filter(Boolean).join('\n');
  return { sent, out, removals, groupJid, author };
}

/** Envia um CONTATO (sem prefixo) e devolve o que aconteceu. */
async function sendContact(payload, opts = {}) {
  const sent = [];
  const removals = [];
  const author = opts.author || nextAuthor();
  const groupJid = opts.groupJid || makeGroup();
  const nazu = makeNazu({ sent, groupJid, removals, author, ...opts });
  const info = {
    key: { remoteJid: groupJid, fromMe: false, id: `MSG-${groupCounter}-${Math.random().toString(36).slice(2, 7)}`, participant: author.lid },
    message: payload,
    messageTimestamp: 1757900000, pushName: 'Autor',
  };
  await handleMessage(nazu, info, null, new Map(), null);
  // A fiscalização roda em segundo plano (void ... .then): dá um tick.
  await new Promise((r) => setTimeout(r, 80));
  const out = sent.map((s) => s.content?.text ?? '').filter(Boolean).join('\n');
  const deleted = sent.filter((s) => s.content?.delete).length;
  return { sent, out, removals, deleted, groupJid, author };
}

const CONTATO = { contactMessage: { displayName: 'Fulano', vcard: 'BEGIN:VCARD\nFN:Fulano\nEND:VCARD' } };
const LISTA = { contactsArrayMessage: { displayName: 'Contatos', contacts: [{ displayName: 'A', vcard: 'BEGIN:VCARD\nEND:VCARD' }] } };

function enableAnti(groupJid) { antiCttMod.antiCtt.setEnabled(groupJid, true); }

// ============================================================================
// COMANDO
// ============================================================================

await test('!antictt sem argumento consulta o status (uso quando inválido)', async () => {
  // Sem argumento = STATUS (padrão do comando). O "como usar" sai para um
  // argumento inválido.
  const status = await runCmd('!antictt', { authorIsAdmin: true });
  // O título usa caracteres estilizados (𝐀𝐍𝐓𝐈…), então a checagem é pelo
  // conteúdo do bloco — não pela string "ANTICONTATO" em ASCII.
  ok(/Status:/.test(status.out) && status.out.includes('꧁'), 'mostra o bloco do AntiContato');
  ok(/DESATIVADO|ATIVADO/.test(status.out), 'mostra o status');
  ok(!status.out.includes('undefined'), 'sem undefined');

  const uso = await runCmd('!antictt xyz', { authorIsAdmin: true });
  ok(/Uso/i.test(uso.out) && /antictt on/.test(uso.out) && /antictt off/.test(uso.out), 'argumento inválido mostra o uso');
});

await test('!antictt on/status/off (admin, bot admin)', async () => {
  // Mesmo grupo = MESMO autor (o metadata é cacheado por grupo).
  const author = nextAuthor();
  const groupJid = makeGroup();
  const base = { author, groupJid, authorIsAdmin: true };

  const on = await runCmd('!antictt on', base);
  ok(/ativado/i.test(on.out), 'responde ativado');
  eq(antiCttMod.antiCtt.isEnabled(groupJid), true, 'ligou');

  const st = await runCmd('!antictt', base);
  ok(/ATIVADO/i.test(st.out), 'status mostra ativado');

  const off = await runCmd('!antictt off', base);
  ok(/desativado/i.test(off.out), 'responde desativado');
  eq(antiCttMod.antiCtt.isEnabled(groupJid), false, 'desligou');
});

await test('!antictt: membro comum é recusado', async () => {
  const { out } = await runCmd('!antictt on', { authorIsAdmin: false });
  ok(/administrador|adm/i.test(out), `recusa não-admin (${out.slice(0, 60)})`);
});

await test('!antictt: fora de grupo é recusado', async () => {
  const sent = []; const removals = [];
  const author = nextAuthor();
  const nazu = makeNazu({ sent, groupJid: 'x@g.us', removals, author });
  const info = {
    key: { remoteJid: author.jid, fromMe: false, id: 'PV1', participant: author.lid },
    message: { extendedTextMessage: { text: '!antictt on', contextInfo: { remoteJid: author.jid } } },
    messageTimestamp: 1757900000, pushName: 'A',
  };
  await handleMessage(nazu, info, null, new Map(), null);
  const out = sent.map((s) => s.content?.text || '').join('\n');
  ok(/grupo/i.test(out), 'exige grupo');
});

await test('!antictt on sem o bot admin avisa que precisa ser admin', async () => {
  const { out } = await runCmd('!antictt on', { authorIsAdmin: true, botIsAdmin: false });
  ok(/administrador|adm/i.test(out), `avisa (${out.slice(0, 80)})`);
});

// ============================================================================
// FISCALIZAÇÃO
// ============================================================================

await test('contato de membro comum: apaga, remove e avisa o MOTIVO', async () => {
  const groupJid = makeGroup();
  enableAnti(groupJid);
  const r = await sendContact(CONTATO, { groupJid });
  eq(r.deleted >= 1, true, 'mensagem do contato apagada');
  ok(r.removals.some((x) => x.action === 'remove' && x.jids.includes(r.author.lid)), 'remetente removido');
  ok(r.out.includes('banido'), `avisou banimento (${r.out.slice(0, 90)})`);
  ok(/Motivo/i.test(r.out) && /contato/i.test(r.out), 'aviso diz o motivo');
  ok(r.out.includes(r.author.lid.split('@')[0]), 'menciona o banido');
});

await test('LISTA de contatos também é apagada e diz "lista de contatos"', async () => {
  const groupJid = makeGroup();
  enableAnti(groupJid);
  const r = await sendContact(LISTA, { groupJid });
  eq(r.deleted >= 1, true, 'apagada');
  ok(r.removals.some((x) => x.action === 'remove'), 'removido');
  ok(/lista de contatos/i.test(r.out), `motivo correto (${r.out.slice(0, 110)})`);
});

await test('anti DESLIGADO: contato passa sem ser apagado', async () => {
  const groupJid = makeGroup(); // sem enableAnti
  const r = await sendContact(CONTATO, { groupJid });
  eq(r.deleted, 0, 'nada apagado');
  eq(r.removals.length, 0, 'ninguém removido');
});

await test('ADMIN do grupo fica isento', async () => {
  const groupJid = makeGroup();
  enableAnti(groupJid);
  const r = await sendContact(CONTATO, { groupJid, authorIsAdmin: true });
  eq(r.deleted, 0, 'nada apagado para admin');
  eq(r.removals.length, 0, 'admin não removido');
});

await test('mensagem normal (texto) NÃO é afetada pelo anti', async () => {
  const groupJid = makeGroup();
  enableAnti(groupJid);
  const r = await sendContact({ conversation: 'oi, tudo bem?' }, { groupJid });
  eq(r.deleted, 0, 'texto não é apagado');
  eq(r.removals.length, 0, 'ninguém removido');
});

await test('sem o bot admin: não remove (mas não quebra)', async () => {
  const groupJid = makeGroup();
  enableAnti(groupJid);
  const r = await sendContact(CONTATO, { groupJid, botIsAdmin: false });
  eq(r.removals.length, 0, 'não tenta remover sem ser admin');
  eq(r.deleted, 0, 'não apaga sem ser admin');
  ok(!/banido/.test(r.out), 'não anuncia banimento sem remover');
});

await test('a mensagem de contato NÃO segue para outros handlers (return)', async () => {
  const groupJid = makeGroup();
  enableAnti(groupJid);
  // Um corpo que dispararia auto-resposta/NPC se seguisse adiante.
  const r = await sendContact({ contactMessage: { displayName: 'X', vcard: 'BEGIN:VCARD\nEND:VCARD' } }, { groupJid });
  // Só o aviso de banimento pode ter saído; nenhuma resposta automática.
  const extras = r.sent.filter((s) => s.content?.text && !s.content.text.includes('banido') && !s.content.delete);
  eq(extras.length, 0, `nenhuma resposta extra (${extras.map((e) => e.content.text).join('|').slice(0, 80)})`);
});

// ============================================================================
// MENU
// ============================================================================

await test('menuadm: antictt e antifantasma na categoria de SEGURANÇA (antis)', async () => {
  const menu = await import(new URL('../dados/src/menus/menuadm.js', import.meta.url).href);
  const t = await menu.default('!', 'Lizzy', 'Teste');
  ok(t.includes('!antictt'), 'menuadm mostra !antictt');
  ok(t.includes('!antifantasma'), 'menuadm mostra !antifantasma');
  // Ambos ficam no MESMO bloco dos outros antis (entre antistatus e antitoxic).
  const inicio = t.indexOf('!antistatus');
  const fim = t.indexOf('!antitoxic');
  ok(inicio > -1 && fim > inicio, 'âncora dos antis encontrada');
  const blocoAntis = t.slice(inicio, fim);
  ok(blocoAntis.includes('!antictt') && blocoAntis.includes('!antifantasma'), 'estão na categoria de antis');
});

await test('mini menu !antis inclui o AntiContato e o AntiFantasma', () => {
  const src = fs.readFileSync(path.join(PROJECT, 'dados/src/index.js'), 'utf-8');
  const block = src.slice(src.indexOf('const antiSystems = ['), src.indexOf('const antiSystems = [') + 3000);
  ok(block.includes("'antictt'") && block.includes('AntiContato'), 'painel lista AntiContato');
  ok(block.includes("'antiinvi'") && block.includes('AntiFantasma'), 'painel lista AntiFantasma');
});

await test('menuCommandsMap e o gitignore não ficaram pendentes', () => {
  const bp = fs.readFileSync(path.join(PROJECT, 'dados/src/utils/blockPv.js'), 'utf-8');
  ok(bp.includes("'antictt'"), 'blockPv registra antictt');
  ok(bp.includes("'antifantasma'"), 'blockPv registra antifantasma');
});

// ============================================================================
// LIMPEZA E RESULTADO
// ============================================================================

fs.rmSync(TMP_DB, { recursive: true, force: true });

const totalPassed = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFailed = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log('\n════════════════════════════════════════');
console.log(`RESULTADO: ${RESULTS.length} testes | ${totalPassed} asserções ok | ${totalFailed} falhas`);
console.log('════════════════════════════════════════');
if (totalFailed > 0) {
  console.log('\nFALHAS:');
  for (const r of RESULTS) if (r.failed) for (const e of r.errors) console.log(`- [${r.name}] ${e}`);
  process.exit(1);
}
console.log('✅ TODOS OS TESTES PASSARAM');
process.exit(0);
