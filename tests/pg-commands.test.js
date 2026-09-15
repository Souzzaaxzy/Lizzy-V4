/**
 * Testes dos comandos !pgpau / !pgpeito / !pgbunda.
 *
 * Executa o handler real (NazuninhaBotExec) com um socket Baileys falso,
 * cobrindo: alvo obrigatorio, mencao real de executor e alvo, as duas frases
 * de cada comando, aleatoriedade, GIF customizado via !setgif, !menubn e a
 * compatibilidade com os comandos de interacao que ja existiam.
 *
 * Uso: node tests/pg-commands.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');

// IMPORTANTE: redireciona o banco do bot para um diretório temporário ANTES de
// importar o index.js (paths.js lê DATABASE_PATH no carregamento). Assim os
// grupos criados pelo teste nunca tocam o dados/database real do bot.
const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-pg-db-'));
process.env.DATABASE_PATH = TMP_DB;
fs.mkdirSync(path.join(TMP_DB, 'grupos'), { recursive: true });

const RESULTS = [];
let CURRENT = null;

function test(name, fn) {
  CURRENT = { name, passed: 0, failed: 0, errors: [] };
  RESULTS.push(CURRENT);
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.then(() => finish(name)).catch((error) => {
        CURRENT.failed += 1;
        CURRENT.errors.push(`EXCEÇÃO: ${error?.stack || error}`);
        finish(name);
      });
    }
    finish(name);
  } catch (error) {
    CURRENT.failed += 1;
    CURRENT.errors.push(`EXCEÇÃO: ${error?.stack || error}`);
    finish(name);
  }
  return Promise.resolve();
}

function finish(name) {
  console.log(`${CURRENT.failed === 0 ? '✅' : '❌'} ${name} (${CURRENT.passed} ok, ${CURRENT.failed} falhas)`);
  for (const err of CURRENT.errors) console.log(`     ${err.split('\n')[0]}`);
}

function ok(condition, message) {
  if (condition) CURRENT.passed += 1;
  else {
    CURRENT.failed += 1;
    CURRENT.errors.push(`ASSERT FALHOU: ${message}`);
  }
}

function includes(haystack, needle, label) {
  ok(typeof haystack === 'string' && haystack.includes(needle), `${label ?? needle} — esperado conter "${needle}"`);
}

function notIncludes(haystack, needle, label) {
  ok(typeof haystack === 'string' && !haystack.includes(needle), `${label ?? needle} — não deveria conter "${needle}"`);
}

// ============================================================================
// HANDLER REAL
// ============================================================================

const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;
if (typeof handleMessage !== 'function') throw new Error('index.js não exporta o handler');

// ============================================================================
// FRASES ESPERADAS (exatamente as fornecidas — copiadas de propósito, para o
// teste falhar se alguém alterar o texto no código)
// ============================================================================

const FRASES_ESPERADAS = {
  pgpau: [
    '@usuario foi l\u00e1 e pegou no pau de @alvo \u{1F60F}',
    '@usuario agarrou o pau de @alvo e apertou \u{1F440}',
  ],
  pgpeito: [
    '@usuario chegou em @alvo e apertou seus peitos \u{1F60F}',
    '@usuario foi sem vergonha e pegou nos peitos de @alvo \u{1F440}',
  ],
  pgbunda: [
    '@usuario chegou por tr\u00e1s e pegou a bunda de @alvo \u{1F60F}',
    '@usuario agarrou a bunda de @alvo e deu aquela apertada \u{1F440}',
  ],
};

// ============================================================================
// FIXTURES
// ============================================================================

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';
const AUTHOR_JID = '5511000000002@s.whatsapp.net';
const AUTHOR_LID = '111000000000002@lid';
const TARGET_JID = '5511000000003@s.whatsapp.net';
const TARGET_LID = '111000000000003@lid';

let groupCounter = 0;
let authorCounter = 0;

const GRUPOS_DIR = path.join(TMP_DB, 'grupos');

/**
 * Cria um grupo de teste com `modobrincadeira` ligado, que é o requisito dos
 * comandos de interação. Usa um JID próprio por execução para não esbarrar no
 * cache de metadados/groupData do bot.
 */
function makeGroup() {
  groupCounter += 1;
  const groupJid = `1203639000000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(
    path.join(GRUPOS_DIR, `${groupJid}.json`),
    JSON.stringify({ modobrincadeira: true, groupName: 'Grupo PG' }, null, 2)
  );
  return groupJid;
}

function makeNazu({ sent, groupJid, authorLid = AUTHOR_LID, authorJid = AUTHOR_JID }) {
  return {
    sendMessage: async (jid, content, options) => {
      sent.push({ jid, content, options });
      return { key: { id: 'SENT' } };
    },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
    onWhatsApp: async (jid) => {
      const map = { [authorJid]: authorLid, [TARGET_JID]: TARGET_LID, [BOT_JID]: BOT_LID };
      const lid = map[jid];
      return lid ? [{ jid, exists: true, lid }] : [{ jid, exists: false }];
    },
    signalRepository: {
      lidMapping: {
        getPNForLID: async (lid) => ({
          [authorLid]: authorJid,
          [TARGET_LID]: TARGET_JID,
          [BOT_LID]: BOT_JID,
        }[lid] || null),
      },
    },
    groupMetadata: async () => ({
      id: groupJid,
      subject: 'Grupo PG',
      participants: [
        { id: authorLid, admin: 'admin', phoneNumber: authorJid },
        { id: TARGET_LID, admin: null, phoneNumber: TARGET_JID },
        { id: BOT_LID, admin: 'admin', phoneNumber: BOT_JID },
      ],
    }),
    groupParticipantsUpdate: async () => ({}),
    groupRequestParticipantsList: async () => [],
    groupRequestParticipantsUpdate: async () => ({}),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {},
    sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => 'https://example.com/pic.jpg',
    react: async () => ({}),
  };
}

/**
 * Executa um comando de interação no grupo.
 * @param {string} command nome do comando sem o prefixo
 * @param {{ withTarget?: boolean, quotedMessage?: object }} [options]
 */
async function runCommand(command, options = {}) {
  const { withTarget = true, quotedMessage = null } = options;
  const sent = [];
  const groupJid = makeGroup();

  // Autor único por execução: o handler aplica throttle de 3 comandos/5s por
  // sender, então reutilizar o mesmo autor mediria o rate limit em vez do comando.
  authorCounter += 1;
  // Prefixo bem diferente do alvo: o LID do autor não pode colidir com o do
  // alvo, senão a normalização das frases no teste mistura os dois nomes.
  const authorLid = `99${String(authorCounter).padStart(6, '0')}888@lid`;
  const authorJid = `5599${String(authorCounter).padStart(6, '0')}777@s.whatsapp.net`;

  const nazu = makeNazu({ sent, groupJid, authorLid, authorJid });

  const contextInfo = { remoteJid: groupJid };
  if (withTarget) {
    contextInfo.mentionedJid = [TARGET_JID];
    contextInfo.participant = TARGET_JID;
  }
  if (quotedMessage) contextInfo.quotedMessage = quotedMessage;

  const info = {
    key: { remoteJid: groupJid, fromMe: false, id: `CMD-${command}-${authorCounter}`, participant: authorLid },
    message: { extendedTextMessage: { text: `!${command}`, contextInfo } },
    messageTimestamp: 1757900000,
    pushName: 'Autor',
  };

  await handleMessage(nazu, info, null, new Map(), null);

  const text = sent.map((s) => s.content?.text ?? s.content?.caption ?? '').filter(Boolean).join('\n');
  const mediaMsg = sent.find((s) => s.content?.video || s.content?.image) || null;
  const allMentions = sent.flatMap((s) => s.content?.mentions || s.options?.mentions || []);

  return {
    sent,
    text,
    mediaMsg,
    allMentions,
    groupJid,
    authorLid,
    authorJid,
    authorName: authorLid.split('@')[0],
    authorJidName: authorJid.split('@')[0],
    targetName: TARGET_LID.split('@')[0],
    targetJidName: TARGET_JID.split('@')[0],
  };
}

/**
 * Devolve a frase enviada com "@<numero>" voltando para "@usuario"/"@alvo",
 * permitindo comparar com o texto originalmente fornecido.
 */
function normalizePhrase(run) {
  return run.text.trim()
    .replaceAll(`@${run.authorName}`, '@usuario')
    .replaceAll(`@${run.authorJidName}`, '@usuario')
    .replaceAll(`@${run.targetName}`, '@alvo')
    .replaceAll(`@${run.targetJidName}`, '@alvo');
}

// ============================================================================
// TESTES
// ============================================================================

for (const command of ['pgpau', 'pgpeito', 'pgbunda']) {
  await test(`${command}: exige alvo marcado (sem alvo não responde nada quebrado)`, async () => {
    const { text } = await runCommand(command, { withTarget: false });
    includes(text, 'Marque alguém', 'mensagem de alvo obrigatório');
    notIncludes(text, 'undefined', 'sem undefined');
    notIncludes(text, 'null', 'sem null');
    notIncludes(text, 'NaN', 'sem NaN');
    notIncludes(text, '@alvo', 'sem placeholder @alvo');
    notIncludes(text, '@usuario', 'sem placeholder @usuario');
  });

  await test(`${command}: menciona executor E alvo de verdade`, async () => {
    const run = await runCommand(command);
    const { sent, allMentions } = run;
    ok(sent.length === 1, `deveria enviar 1 mensagem, enviou ${sent.length}`);

    // As menções precisam ser identificadores reais (JID/LID), nunca texto solto.
    ok(allMentions.includes(run.authorLid) || allMentions.includes(run.authorJid),
      `executor (${run.authorLid}) presente nas mentions: ${JSON.stringify(allMentions)}`);
    ok(allMentions.includes(TARGET_JID) || allMentions.includes(TARGET_LID),
      `alvo presente nas mentions: ${JSON.stringify(allMentions)}`);

    // E o texto traz "@<nome>" para CADA jid em mentions — é assim que o
    // WhatsApp transforma o texto em menção renderizada.
    const first = sent[0].content?.text ?? sent[0].content?.caption ?? '';
    ok(allMentions.length === 2, `duas menções (executor e alvo), obtidas: ${allMentions.length}`);
    for (const jid of allMentions) {
      includes(first, `@${jid.split('@')[0]}`, `texto menciona ${jid}`);
    }
    // O texto não pode ter sobra de placeholder nem valor inválido.
    notIncludes(first, 'undefined', 'sem undefined no texto');
    notIncludes(first, 'null', 'sem null no texto');
    notIncludes(first, 'NaN', 'sem NaN no texto');
    notIncludes(first, '@alvo', 'sem placeholder @alvo');
    notIncludes(first, '@usuario', 'sem placeholder @usuario');
  });

  await test(`${command}: as duas frases são exatamente as fornecidas`, async () => {
    const runs = [];
    for (let i = 0; i < 60; i++) runs.push(await runCommand(command));

    // No envio, "@usuario"/"@alvo" viram "@<numero>". Normaliza para o token
    // original antes de comparar com a frase fornecida.
    const variants = new Set(runs.map((r) => normalizePhrase(r)));

    ok(variants.size === 2, `deveria produzir exatamente 2 frases distintas, produziu ${variants.size}`);
    for (const esperada of FRASES_ESPERADAS[command]) {
      ok(variants.has(esperada), `frase esperada presente: ${esperada}`);
    }
    // Nenhuma frase de outro comando pode aparecer.
    const outras = Object.entries(FRASES_ESPERADAS)
      .filter(([cmd]) => cmd !== command)
      .flatMap(([, frases]) => frases);
    for (const frase of outras) {
      ok(!variants.has(frase), `não misturou frase de outro comando: ${frase}`);
    }
  });

  await test(`${command}: sorteia entre as duas frases (aleatoriedade)`, async () => {
    const contagem = new Map();
    for (let i = 0; i < 80; i++) {
      const frase = normalizePhrase(await runCommand(command));
      contagem.set(frase, (contagem.get(frase) || 0) + 1);
    }
    ok(contagem.size === 2, `ambas as frases devem aparecer em 80 execuções (obtidas: ${contagem.size})`);
    for (const [frase, n] of contagem) {
      ok(n > 0, `frase sorteada ${n}x: ${frase.slice(0, 50)}`);
    }
  });

  await test(`${command}: usa o GIF configurado por !setgif`, async () => {
    // Cria uma mídia no formato exato que o !setgif grava (games.json > games2).
    const gifPath = path.join(PROJECT, 'dados/src/funcs/json/games.json');
    const backup = fs.existsSync(gifPath) ? fs.readFileSync(gifPath, 'utf-8') : null;
    const data = backup ? JSON.parse(backup) : {};
    data.games2 = data.games2 || {};
    data.games2[command] = { video: { url: './database/gifs/teste-pg.mp4' }, isGif: true };
    fs.writeFileSync(gifPath, JSON.stringify(data, null, 2));

    const gifsDir = path.join(PROJECT, 'dados/src/database/gifs');
    const gifFile = path.join(gifsDir, 'teste-pg.mp4');
    const gifExisted = fs.existsSync(gifFile);
    fs.mkdirSync(gifsDir, { recursive: true });
    fs.writeFileSync(gifFile, Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]));

    try {
      const { sent, mediaMsg } = await runCommand(command);
      ok(Boolean(mediaMsg), 'mídia enviada junto com a frase');
      if (mediaMsg) {
        ok(Boolean(mediaMsg.content?.video), 'enviada como vídeo/GIF');
        ok(mediaMsg.content?.gifPlayback === true, 'gifPlayback ativo');
        const caption = mediaMsg.content.caption || '';
        ok(caption.length > 0, 'a frase vai na legenda do GIF');
      }
    } finally {
      // Restaura o games.json e limpa o arquivo de teste.
      if (backup !== null) fs.writeFileSync(gifPath, backup);
      else fs.unlinkSync(gifPath);
      if (!gifExisted) fs.rmSync(gifFile, { force: true });
    }
  });
}

await test('setgif: aceita pgpau, pgpeito e pgbunda como comandos válidos', async () => {
  // A lista de válidos do !setgif deve conter os três, senão retorna "não existe".
  const src = fs.readFileSync(path.join(PROJECT, 'dados/src/index.js'), 'utf-8');
  const match = /const validCommands = \[([^\]]+)\];/.exec(src);
  ok(Boolean(match), 'lista de comandos válidos do setgif encontrada');
  for (const cmd of ['pgpau', 'pgpeito', 'pgbunda']) {
    includes(match[1], `'${cmd}'`, `setgif aceita ${cmd}`);
  }
  // E os comandos antigos continuam lá.
  for (const antigo of ['tapa', 'soco', 'beijo', 'siririca', 'punheta', 'compatibilidade']) {
    includes(match[1], `'${antigo}'`, `setgif continua aceitando ${antigo}`);
  }
});

await test('menubn: os três comandos aparecem em INTERAÇÕES PICANTES', async () => {
  const menus = await import(new URL('../dados/src/menus/menubn.js', import.meta.url).href);
  const menuFn = menus.default;
  ok(typeof menuFn === 'function', 'menubn exporta uma função');

  // Assinatura real: (prefix, botName, userName, isLiteMode).
  // isLiteMode = false, senão a categoria picante é omitida de propósito.
  const text = String(await menuFn('!', 'Lizzy', 'Tester', false));

  const idx = text.indexOf('INTERAÇÕES "PICANTES"');
  ok(idx !== -1, 'categoria INTERAÇÕES "PICANTES" presente');

  const picantes = text.slice(idx, text.indexOf('╰', idx));
  for (const cmd of ['pgpau', 'pgpeito', 'pgbunda']) {
    includes(picantes, `!${cmd}`, `${cmd} na categoria picante`);
  }
  // Categoria não duplicada.
  ok(text.indexOf('INTERAÇÕES "PICANTES"') === text.lastIndexOf('INTERAÇÕES "PICANTES"'), 'categoria picante não duplicada');
});

await test('menubn: comandos registrados na lista de diversão (bloqueio de PV)', async () => {
  const blockPv = await import(new URL('../dados/src/utils/blockPv.js', import.meta.url).href);
  const lista = blockPv.menuCommandsMap?.menubn?.commands || [];
  for (const cmd of ['pgpau', 'pgpeito', 'pgbunda']) {
    ok(lista.includes(cmd), `${cmd} registrado no menubn`);
  }
});

await test('comandos antigos de interação continuam funcionando (regressão)', async () => {
  const { sent, text } = await runCommand('tapa');
  ok(sent.length === 1, 'tapa responde uma mensagem');
  ok(text.length > 0, 'tapa produziu resposta');
  notIncludes(text, 'undefined', 'sem undefined no tapa');

  const beijo = await runCommand('beijo');
  ok(beijo.sent.length === 1, 'beijo responde uma mensagem');

  const soco = await runCommand('socar');
  ok(soco.sent.length === 1, 'socar responde uma mensagem');
});

await test('comando de interação fora de grupo é recusado', async () => {
  const sent = [];
  const nazu = makeNazu({ sent, groupJid: 'x@g.us' });
  const info = {
    key: { remoteJid: AUTHOR_JID, fromMe: false, id: 'PV', participant: AUTHOR_LID },
    message: { extendedTextMessage: { text: '!pgpau', contextInfo: { mentionedJid: [TARGET_JID] } } },
    messageTimestamp: 1757900000,
    pushName: 'Autor',
  };
  await handleMessage(nazu, info, null, new Map(), null);
  const text = sent.map((s) => s.content?.text).filter(Boolean).join('\n');
  ok(text.length > 0, 'respondeu algo no privado');
  notIncludes(text, 'pegou no pau', 'não executou a brincadeira fora de grupo');
});

await test('nomes dos comandos são ASCII puro (sem caracteres estranhos)', () => {
  const src = fs.readFileSync(path.join(PROJECT, 'dados/src/index.js'), 'utf-8');
  const block = src.slice(src.indexOf('const FRASES_PEGAR'), src.indexOf('const antiRouboLock'));

  // Chaves exatamente pgpau/pgpeito/pgbunda, em ASCII.
  for (const cmd of ['pgpau', 'pgpeito', 'pgbunda']) {
    ok(block.includes(`  ${cmd}: [`), `chave ${cmd} presente e em ASCII`);
  }
  ok(!/[\u4e00-\u9fff]/.test(block), 'sem caracteres chineses');
  ok(!/[\u0400-\u04ff]/.test(block), 'sem caracteres cirílicos');
  ok(!/[\u200b-\u200f\u2028-\u202f\u2060\ufeff]/.test(block), 'sem caracteres invisíveis');

  // Cada comando tem exatamente 2 frases.
  for (const cmd of ['pgpau', 'pgpeito', 'pgbunda']) {
    const re = new RegExp(`  ${cmd}: \\[([\\s\\S]*?)\\]`);
    const m = re.exec(block);
    ok(Boolean(m), `bloco de ${cmd} encontrado`);
    const frases = m[1].split('\n').map((l) => l.trim()).filter((l) => l.startsWith("'"));
    ok(frases.length === 2, `${cmd} tem exatamente 2 frases (encontradas: ${frases.length})`);
  }
});

await test('menubn e comandos pg não introduziram caracteres estranhos', () => {
  for (const rel of ['dados/src/menus/menubn.js', 'dados/src/utils/blockPv.js']) {
    const content = fs.readFileSync(path.join(PROJECT, rel), 'utf-8');
    const lines = content.split('\n').filter((l) => /pgpau|pgpeito|pgbunda/.test(l));
    ok(lines.length > 0, `${rel} contém referências aos comandos`);
    for (const line of lines) {
      ok(!/[\u4e00-\u9fff\u0400-\u04ff\u200b-\u200f\u2060\ufeff]/.test(line), `sem caracteres estranhos em "${rel}": ${line.trim().slice(0, 60)}`);
      ok(/\bpg(pau|peito|bunda)\b/.test(line), `identificador ASCII correto em ${rel}`);
    }
  }
});

// ============================================================================
// LIMPEZA E RESULTADO
// ============================================================================

// Remove o banco temporário criado por este teste (o bot nunca tocou o real).
fs.rmSync(TMP_DB, { recursive: true, force: true });

const totalPassed = RESULTS.reduce((acc, r) => acc + r.passed, 0);
const totalFailed = RESULTS.reduce((acc, r) => acc + r.failed, 0);

console.log('\n════════════════════════════════════════');
console.log(`RESULTADO: ${RESULTS.length} testes | ${totalPassed} asserções ok | ${totalFailed} falhas`);
console.log('════════════════════════════════════════');

if (totalFailed > 0) {
  console.log('\nFALHAS:');
  for (const r of RESULTS) {
    if (r.failed) for (const e of r.errors) console.log(`- [${r.name}] ${e}`);
  }
  process.exit(1);
}
console.log('✅ TODOS OS TESTES PASSARAM');
process.exit(0);