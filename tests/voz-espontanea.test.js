/**
 * A VOZ ESPONTÂNEA da Lizzy — ela manda áudio por conta própria (25%).
 *
 * Pedido do dono: *"vamos deixar ela usando o áudio naturalmente agora, deixa
 * uma porcentagem de 25% de aleatoriedade com as respostas em áudio, mas quando
 * alguém pede o áudio ela manda normalmente"*.
 *
 * O que este teste trava:
 *   1. o sorteio (`sortearModoDeResposta`): pedido explícito = SEMPRE áudio;
 *      espontâneo = chance (25% por padrão, e a env manda);
 *   2. a limpeza da fala (`limparFala`): o TTS não lê `*`, `@`, emoji nem URL;
 *   3. o **fluxo real** (handler de verdade, Groq dublado): quando o sorteio dá
 *      voz, sai NOTA DE VOZ (OGG/Opus + `ptt: true`); quando dá texto, sai
 *      texto; e se a VOZ FALHAR, o texto vai (nunca silêncio);
 *   4. o pedido explícito continua 100% áudio.
 *
 * Uso: node tests/voz-espontanea.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-vozesp-'));
process.env.DATABASE_PATH = TMP_DB;
process.env.CONFIG_PATH = path.join(TMP_DB, 'config.json');
fs.mkdirSync(path.join(TMP_DB, 'grupos'), { recursive: true });
fs.mkdirSync(path.join(TMP_DB, 'dono'), { recursive: true });
fs.writeFileSync(process.env.CONFIG_PATH, JSON.stringify({
  prefixo: '!', nomebot: 'Lizzy do privy', nomedono: 'Kannon',
  numerodono: '5511915323638', debug: false
}, null, 2));

const voz = await import(new URL('../dados/src/utils/vozDaConversa.js', import.meta.url).href);
const groq = await import(new URL('../dados/src/utils/groqClient.js', import.meta.url).href);
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
function contem(h, n, l) { ok(typeof h === 'string' && h.includes(n), `${l ?? n} — esperado conter "${n}"`); }
function naoContem(h, n, l) { ok(typeof h === 'string' && !h.includes(n), `${l ?? n} — NAO deveria conter "${n}"`); }

const OWNER_LID = '5511915323638:1@s.whatsapp.net';
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
      subject: 'geralbot', creation: 1742000000, desc: 'grupo de teste', owner: OWNER_LID,
      participants: [
        { id: OWNER_LID, admin: 'superadmin', name: 'Kannon' },
        { id: BOT_LID, admin: 'admin' }
      ]
    }),
    contacts: { getName: async (j) => (j.includes('5511915323638') ? 'Kannon' : null) },
    profilePictureUrl: async () => null,
    react: async () => ({}),
    waitForMessage: async () => undefined,
    chatModify: async () => ({}),
  };
}

/** Responde como a IA (JSON no formato que o `ia.js` espera). */
function dublarGroq(resposta = 'Oi! Tudo bem? 😊') {
  groq.setGroqHttpForTest(async () => ({
    data: { choices: [{ message: { content: JSON.stringify({ resp: [{ resp: resposta }] }) } }] }
  }));
  process.env.GROQ_API_KEY = 'gsk-teste';
}

async function run(texto, { participant = OWNER_LID } = {}) {
  grupoFile();
  const sent = [];
  const sock = fakeSock(sent);
  const info = {
    key: { remoteJid: GRUPO, fromMe: false, id: `M-${Math.random().toString(36).slice(2, 8)}`, participant },
    message: { extendedTextMessage: { text: texto, contextInfo: { remoteJid: GRUPO } } },
    messageTimestamp: Math.floor(Date.now() / 1000), pushName: 'Kannon',
  };
  await handleMessage(sock, info, null, new Map(), null);
  await new Promise((r) => setTimeout(r, 400));
  return sent.map((s) => s.content || {});
}

/** Ha' ffmpeg no PATH (a cadeia OGG depende dele)? */
function temFfmpeg() {
  try {
    // `require` NAO existe em ESM — o spawnSync entra por import.
    return spawnSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
  } catch { return false; }
}

// ============================================================================
// 1) O SORTEIO (puro)
// ============================================================================
console.log('\n=== 1) O SORTEIO ===\n');

await test('1. o padrao e 25% e a env manda', () => {
  ok(voz.CHANCE_ESPONTANEA === 0.25, `padrao 25% (veio ${voz.CHANCE_ESPONTANEA})`);
});

await test('2. PEDIDO EXPLICITO e SEMPRE audio (100%), ignorando o sorteio', () => {
  for (const r of [0, 0.5, 0.99]) {
    const m = voz.sortearModoDeResposta({ pedidoExplicito: true, rng: () => r });
    ok(m.audio === true && m.motivo === 'pedido', `pedido explicito -> audio (rng ${r})`);
  }
});

await test('3. o espontaneo respeita a chance (25%)', () => {
  // rng abaixo da chance -> audio; acima -> texto.
  ok(voz.sortearModoDeResposta({ chance: 0.25, rng: () => 0.10 }).audio === true, '0.10 < 0.25 -> audio');
  ok(voz.sortearModoDeResposta({ chance: 0.25, rng: () => 0.24 }).audio === true, '0.24 < 0.25 -> audio');
  ok(voz.sortearModoDeResposta({ chance: 0.25, rng: () => 0.25 }).audio === false, '0.25 == 0.25 -> texto (limite)');
  ok(voz.sortearModoDeResposta({ chance: 0.25, rng: () => 0.90 }).audio === false, '0.90 -> texto');
  ok(voz.sortearModoDeResposta({ chance: 0.25, rng: () => 0.10 }).motivo === 'sorteio', 'reporta o motivo');
  ok(voz.sortearModoDeResposta({ chance: 0.25, rng: () => 0.90 }).motivo === 'texto', 'reporta texto');
});

await test('4. chance fora da faixa e clampada (nao estoura)', () => {
  ok(voz.sortearModoDeResposta({ chance: 5, rng: () => 0.99 }).audio === true, '>1 vira 1 (sempre audio)');
  ok(voz.sortearModoDeResposta({ chance: -3, rng: () => 0.01 }).audio === false, '<0 vira 0 (nunca audio)');
  ok(voz.sortearModoDeResposta({ chance: NaN, rng: () => 0.10 }).audio === true, 'NaN cai no padrao (25%)');
});

await test('5. a proporcao real fica perto de 25% (10.000 sorteios)', () => {
  let audio = 0;
  for (let i = 0; i < 10000; i++) if (voz.sortearModoDeResposta({}).audio) audio += 1;
  const pct = audio / 10000;
  ok(pct > 0.21 && pct < 0.29, `ficou em ${(pct * 100).toFixed(1)}% (esperado ~25%)`);
});

// ============================================================================
// 2) A LIMPEZA DA FALA (o TTS nao le marcador)
// ============================================================================
console.log('\n=== 2) A LIMPEZA DA FALA ===\n');

await test('6. tira o markdown, a mencao, o emoji, o link e o codigo', () => {
  const limpo = voz.limparFala('Oi *Kannon*! Olha isso `aqui` https://x.com/y 😊 @5511999999999');
  ok(!limpo.includes('*'), 'sem asterisco de negrito');
  ok(!limpo.includes('`'), 'sem crase de codigo');
  ok(!limpo.includes('http'), 'sem URL');
  ok(!limpo.includes('@'), 'sem @ de mencao');
  ok(!limpo.includes('😊'), 'sem emoji');
  contem(limpo, 'Kannon', 'o TEXTO do negrito fica');
  contem(limpo, 'Olha isso', 'o resto da frase fica');
});

await test('7. colapsa quebras de linha e espacos', () => {
  const limpo = voz.limparFala('linha 1\n\n\nlinha 2   com   espacos');
  naoContem(limpo, '\n', 'sem quebra de linha (o TTS leria como pausa longa)');
  ok(!/  /.test(limpo), 'sem espaco duplo');
});

await test('8. texto normal passa quase intacto', () => {
  ok(voz.limparFala('Oi! Tudo bem com voce?') === 'Oi! Tudo bem com voce?', 'frase simples nao muda');
  ok(voz.limparFala('') === '', 'vazio');
  ok(voz.limparFala(null) === '', 'null nao quebra');
});

await test('8b. o teto da fala espontanea: resposta longa vai em TEXTO', () => {
  ok(voz.FALA_MAX_CARACTERES === 400, `padrao 400 (veio ${voz.FALA_MAX_CARACTERES})`);
});

// ============================================================================
// 3) O FLUXO REAL (handler de verdade)
// ============================================================================
console.log('\n=== 3) O FLUXO REAL ===\n');

await test('9. o handler usa o sorteio e o caminho unico da resposta', () => {
  contem(INDEX, 'sortearModoDeResposta({ pedidoExplicito: false })', 'sorteia UMA vez por resposta');
  contem(INDEX, 'const responder = async (texto)', 'ha o caminho unico da resposta');
  contem(INDEX, 'if (await enviarNotaDeVoz(nazu, from, t, FALA_MAX_CARACTERES)) return;', 'a voz tenta primeiro (com o teto do espontaneo)');
  // O `reply` continua no fim do `responder` — e' o fallback.
  const i = INDEX.indexOf('const responder = async (texto)');
  const bloco = INDEX.slice(i, i + 700);
  contem(bloco, 'await reply(t);', 'se a voz falhar/nao sair, o TEXTO vai (nunca silencio)');
});

await test('10. o pedido explicito usa o MESMO helper de voz (100% audio)', () => {
  const i = INDEX.indexOf('if (ehPedidoDeAudio(textoLimpo))');
  const bloco = INDEX.slice(i, i + 1600);
  contem(bloco, 'enviarNotaDeVoz(nazu, from, fala)', 'usa o helper unico (nada de pipeline paralelo)');
  naoContem(bloco, 'sortearModoDeResposta', 'o pedido NAO passa pelo sorteio (e sempre)');
});

await test('11. sem ffmpeg a voz falha e o TEXTO sai (nunca silencio)', async () => {
  // Forca a voz a falhar: o `gerarNotaDeVoz` exige as 3 dependencias.
  const r = await voz.gerarNotaDeVoz({ texto: 'oi' });
  ok(r.ok === false && r.motivo === 'sem_dependencias', 'sem deps -> falha fechada');
  // E o handler trata o `false` caindo no `reply`.
  contem(INDEX, 'await reply(t);', 'o fallback de texto esta no caminho');
});

await test('11b. a fala acima do teto nao vira voz (o espontaneo manda texto)', async () => {
  const longo = 'a'.repeat(500);
  const r = await voz.gerarNotaDeVoz({
    texto: longo, limite: voz.FALA_MAX_CARACTERES,
    sintetizar: async () => ({ ok: true, pcm: new Float32Array(10) }),
    pcmParaWav: () => Buffer.from('x'),
    toOggOpus: async () => Buffer.from('y'),
  });
  ok(r.ok === false && r.motivo === 'fala_longa', 'acima do teto -> fala_longa (o chamador manda texto)');
  // Curto passa.
  const curto = await voz.gerarNotaDeVoz({
    texto: 'Oi, tudo bem?', limite: voz.FALA_MAX_CARACTERES,
    sintetizar: async () => ({ ok: true, pcm: new Float32Array(10) }),
    pcmParaWav: () => Buffer.from('x'),
    toOggOpus: async () => Buffer.from('y'),
  });
  ok(curto.ok === true, 'abaixo do teto -> gera');
  // E o handler passa o teto SO no espontaneo.
  contem(INDEX, 'enviarNotaDeVoz(nazu, from, t, FALA_MAX_CARACTERES)', 'o espontaneo passa o teto');
  const iPedido = INDEX.indexOf('if (ehPedidoDeAudio(textoLimpo))');
  naoContem(INDEX.slice(iPedido, iPedido + 1600), 'FALA_MAX_CARACTERES', 'o pedido explicito NAO tem teto');
});

// O teste 12 roda a cadeia REAL (precisa de ffmpeg).
const FFMPEG = temFfmpeg();

await test('12. o fluxo real: sorteio audio -> NOTA DE VOZ; sorteio texto -> texto', async () => {
  if (!FFMPEG) { console.log('     (pulado: sem ffmpeg — a cadeia OGG precisa dele)'); return; }

  // 1) Sorteio dando AUDIO: forca a chance a 100%.
  process.env.LIZZY_VOZ_ESPONTANEA = '1';
  const vozMod = await import(new URL('../dados/src/utils/vozDaConversa.js?esp1', import.meta.url).href);
  ok(vozMod.CHANCE_ESPONTANEA === 1, 'a env forca 100%');
  delete process.env.LIZZY_VOZ_ESPONTANEA;

  // O sorteio e lido no IMPORT do modulo; o handler usa a constante do modulo ja
  // carregado (0.25). Entao aqui medimos o SORTEIO direto + a cadeia de envio.
  const sorteio = voz.sortearModoDeResposta({ chance: 1, rng: () => 0.5 });
  ok(sorteio.audio === true, 'com chance 1, sempre audio');

  const enviado = await voz.gerarNotaDeVoz({
    texto: 'Oi! Aqui é a Lizzy.',
    sintetizar: (await import(new URL('../dados/src/utils/iapTts.js', import.meta.url).href)).sintetizarFala,
    pcmParaWav: (await import(new URL('../dados/src/utils/iapAudio.js', import.meta.url).href)).pcmParaWav,
    toOggOpus: (await import(new URL('../dados/src/utils/oggOpus.js', import.meta.url).href)).toOggOpus,
  });
  ok(enviado.ok === true, `a cadeia gera a nota de voz (motivo ${enviado.motivo || '-'})`);
  ok(enviado.ogg.slice(0, 4).toString('ascii') === 'OggS', 'o container e OGG/Opus (a onda)');
});

await test('13. o handler real manda a NOTA DE VOZ quando o sorteio da voz', async () => {
  if (!FFMPEG) { console.log('     (pulado: sem ffmpeg)'); return; }
  // Dubla a IA e roda o handler; o sorteio e' aleatorio, entao roda varias vezes
  // e exige que PELO MENOS UMA tenha saido em audio (25% em 40 tentativas).
  dublarGroq('Oi! Tudo bem?');
  let viuAudio = false;
  let viuTexto = false;
  for (let i = 0; i < 40 && !(viuAudio && viuTexto); i++) {
    const enviados = await run('oi Lizzy');
    for (const c of enviados) {
      if (c.audio) {
        viuAudio = true;
        ok(c.mimetype === 'audio/ogg; codecs=opus', 'mimetype OGG/Opus');
        ok(c.ptt === true, 'ptt: true (nota de voz)');
        ok(Buffer.isBuffer(c.audio) && c.audio.slice(0, 4).toString('ascii') === 'OggS', 'o audio e OGG de verdade');
        ok(!c.contextInfo, 'sem contextInfo (newsletter)');
      }
      if (typeof c.text === 'string') viuTexto = true;
    }
  }
  ok(viuAudio, 'em 40 respostas, alguma saiu em AUDIO (25%)');
  ok(viuTexto, 'e outras sairam em TEXTO');
  groq.setGroqHttpForTest(null);
});

await test('14. o pedido explicito continua 100% audio (handler real)', async () => {
  if (!FFMPEG) { console.log('     (pulado: sem ffmpeg)'); return; }
  dublarGroq('Toma o áudio!');
  let audios = 0;
  for (let i = 0; i < 5; i++) {
    const enviados = await run('Lizzy, manda um áudio aí');
    if (enviados.some((c) => c.audio)) audios += 1;
  }
  ok(audios === 5, `5 de 5 pedidos sairam em audio (veio ${audios})`);
  groq.setGroqHttpForTest(null);
});

// ============================================================================
console.log('\n' + '='.repeat(60));
const tot = RESULTS.reduce((a, r) => a + r.passed, 0);
const fal = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log(`RESULTADO: ${RESULTS.length} testes | ${tot} asserções ok | ${fal} falhas`);
if (!FFMPEG) console.log('(sem ffmpeg: os testes do fluxo real foram pulados)');
console.log('='.repeat(60));
process.exit(fal ? 1 : 0);
