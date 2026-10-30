/**
 * A VOZ da conversa — "Lizzy, manda um áudio aí" manda NOTA DE VOZ.
 *
 * Pedido do dono: *"vamos pelo áudio, primeiro vamos configurar apenas o
 * 'lizzy, manda um audio ai' só pra testar, depois automatizamos"*.
 *
 * A forma ficou clara depois de 3 rodadas: ele quer a **NOTA DE VOZ** — a bolha
 * com o **desenho da ONDA** (*"aquele áudio que o usuário grava e manda seco no
 * grupo"*). O que decide isso e' o **CONTAINER**: OGG/Opus. MP3 vira a bolha de
 * musica (a "laranja", igual ao `!play`).
 *
 * Uso: node tests/voz-conversa.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-voz-'));
process.env.DATABASE_PATH = TMP_DB;
process.env.CONFIG_PATH = path.join(TMP_DB, 'config.json');
fs.mkdirSync(path.join(TMP_DB, 'grupos'), { recursive: true });
fs.mkdirSync(path.join(TMP_DB, 'dono'), { recursive: true });
fs.writeFileSync(process.env.CONFIG_PATH, JSON.stringify({
  prefixo: '!', nomebot: 'Lizzy do privy', nomedono: 'Kannon',
  numerodono: '5511978819676', debug: false
}, null, 2));

const voz = await import(new URL('../dados/src/utils/vozDaConversa.js', import.meta.url).href);
const { sintetizarFala } = await import(new URL('../dados/src/utils/iapTts.js', import.meta.url).href);
const { pcmParaWav } = await import(new URL('../dados/src/utils/iapAudio.js', import.meta.url).href);
const { toOggOpus } = await import(new URL('../dados/src/utils/oggOpus.js', import.meta.url).href);

/** Ha' ffmpeg no PATH? (so' para CONFERIR o MP3 gerado de verdade) */
function temFfmpeg() {
  const bin = process.env.FFMPEG_PATH || 'ffmpeg';
  try { return spawnSync(bin, ['-version'], { stdio: 'ignore' }).status === 0; } catch { return false; }
}
const FFMPEG = temFfmpeg();

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

const INDEX = fs.readFileSync(new URL('../dados/src/index.js', import.meta.url), 'utf-8');

// ───────────────────────────────────────────────────────────────────────────
// 1) RECONHECER O PEDIDO (o gatilho do dono)
// ───────────────────────────────────────────────────────────────────────────

await test('1. reconhece o pedido "manda um áudio aí" (o do dono)', () => {
  const casos = [
    'manda um áudio ai',
    'Lizzy, manda um áudio aí',
    'manda um audio',
    'me manda audio',
    'me manda um áudio',
    'manda áudio sobre o jogo',
    'grava um audio',
    'quero ouvir sua voz',
    'manda sua voz',
    'envia um áudio',
    'fala isso pra mim',
    'manda um audio do flamengo'
  ];
  for (const c of casos) ok(voz.ehPedidoDeAudio(c) === true, `reconheceu: "${c}"`);
});

await test('2. NAO confunde conversa normal com pedido de áudio', () => {
  const nao = [
    'oi tudo bem',
    'toca uma música',
    'manda a foto do grupo',
    'qual é o seu nome',
    'me manda o link',
    'kkkk',
    '',
    'manda'
  ];
  for (const c of nao) ok(voz.ehPedidoDeAudio(c) === false, `nao reconheceu (correto): "${c}"`);
});

await test('3. o TEMA sai do pedido (a moldura e removida)', () => {
  ok(voz.temaDoAudio('manda um áudio ai') === '', 'sem tema -> vazio');
  ok(voz.temaDoAudio('Lizzy, manda um áudio aí') === '', 'com a mencao -> vazio');
  ok(voz.temaDoAudio('manda áudio sobre o jogo') === 'o jogo', 'sobre o jogo');
  ok(voz.temaDoAudio('manda um audio do flamengo') === 'flamengo', 'do flamengo');
  ok(voz.temaDoAudio('grava um audio') === '', 'grava -> vazio');
  ok(voz.temaDoAudio('manda sua voz') === '', 'sua voz -> vazio');
});

await test('4. a FALA e montada a partir do tema', () => {
  ok(voz.falaDoAudio('').length > 0, 'sem tema tem uma fala padrao');
  ok(voz.falaDoAudio('o jogo').includes('o jogo'), 'com tema, o tema entra na fala');
});

// ───────────────────────────────────────────────────────────────────────────
// 2) GERAR A NOTA DE VOZ (PCM -> WAV -> OGG/Opus)
// ───────────────────────────────────────────────────────────────────────────

/** Dublê de TTS: 1s de senoide (PCM 16 kHz). Nao depende de rede. */
const sintetizarFake = async () => {
  const pcm = new Float32Array(16000);
  for (let i = 0; i < pcm.length; i++) pcm[i] = Math.sin(2 * Math.PI * 440 * i / 16000) * 0.3;
  return { ok: true, pcm, fonte: 'fake' };
};

await test('5. a cadeia gera OGG/Opus de verdade (o container da NOTA DE VOZ)', async () => {
  if (!FFMPEG) { console.log('     (pulado: sem ffmpeg)'); return; }
  const r = await voz.gerarNotaDeVoz({ texto: 'oi', sintetizar: sintetizarFake, pcmParaWav, toOggOpus });
  ok(r.ok === true, `gerou (motivo ${r.motivo || '-'})`);
  ok(Buffer.isBuffer(r.ogg) && r.ogg.length > 0, 'tem bytes');
  // O container e' o que faz a diferenca: MP3 -> bolha de musica (a "laranja");
  // OGG -> nota de voz (a onda). O magic `OggS` prova o container.
  ok(r.ogg.slice(0, 4).toString('ascii') === 'OggS', 'e OGG (nao MP3) — e isso que da a onda');
  ok(r.fonte === 'fake', 'reporta a fonte do TTS');
});

await test('5b. o TTS REAL + ffmpeg geram a nota de voz (ponta a ponta)', async () => {
  if (!FFMPEG) { console.log('     (pulado: sem ffmpeg)'); return; }
  const r = await voz.gerarNotaDeVoz({ texto: 'Oi! Aqui é a Lizzy.', sintetizar: sintetizarFala, pcmParaWav, toOggOpus });
  if (!r.ok) { console.log(`     (pulado: ${r.motivo} — sem msedge-tts neste ambiente)`); return; }
  ok(Buffer.isBuffer(r.ogg) && r.ogg.length > 1000, `gerou ${r.ogg?.length} bytes`);
  ok(r.ogg.slice(0, 4).toString('ascii') === 'OggS', 'e OGG de verdade');
  ok(r.fonte === 'msedge-tts', `fonte msedge-tts (veio ${r.fonte})`);
});

await test('6. a cadeia e FALHA FECHADA (erros controlados, sem lixo)', async () => {
  ok((await voz.gerarNotaDeVoz({ texto: 'oi' })).motivo === 'sem_dependencias', 'sem deps');
  ok((await voz.gerarNotaDeVoz({ texto: '', sintetizar: sintetizarFake, pcmParaWav, toOggOpus })).motivo === 'texto_vazio', 'texto vazio');
  ok((await voz.gerarNotaDeVoz({ texto: 'oi', sintetizar: async () => ({ ok: false, motivo: 'sem_tts' }), pcmParaWav, toOggOpus })).motivo === 'sem_tts', 'TTS falhou -> propaga');
  ok((await voz.gerarNotaDeVoz({ texto: 'oi', sintetizar: async () => { throw new Error('x'); }, pcmParaWav, toOggOpus })).motivo === 'tts_falhou', 'TTS lancou -> controlado');
  ok((await voz.gerarNotaDeVoz({ texto: 'oi', sintetizar: sintetizarFake, pcmParaWav, toOggOpus: async () => { throw new Error('FFmpeg não encontrado'); } })).motivo === 'sem_ffmpeg', 'ffmpeg ausente -> sem_ffmpeg');
});

await test('7. a mensagem de erro diz o que fazer', () => {
  ok(/FFmpeg/i.test(voz.erroDaVoz('sem_ffmpeg')), 'sem_ffmpeg manda instalar o FFmpeg');
  ok(/FFmpeg/i.test(voz.erroDaVoz('ffmpeg_faltando')), 'ffmpeg_faltando tambem (vem do TTS)');
  for (const m of ['tts_falhou', 'sem_dependencias', 'texto_vazio', 'wav_falhou', 'opus_falhou', 'x']) {
    const t = voz.erroDaVoz(m);
    ok(typeof t === 'string' && t.length > 5 && !/undefined|null/.test(t), `motivo ${m} tem texto`);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// 3) A INTEGRACAO NO HANDLER
// ───────────────────────────────────────────────────────────────────────────

await test('8. o handler manda NOTA DE VOZ (OGG/Opus + ptt: true), SEM contextInfo', () => {
  ok(INDEX.includes("from './utils/vozDaConversa.js'"), 'importa o modulo');
  ok(INDEX.includes('ehPedidoDeAudio(textoLimpo)'), 'usa o gatilho explicito');
  ok(INDEX.includes('gerarNotaDeVoz('), 'chama a geracao da NOTA DE VOZ');
  // A ancora e' o HELPER do envio (o unico ponto que monta a nota de voz): o
  // pedido explicito e o espontaneo passam por ele. Ancorar no `gerarNotaDeVoz`
  // pegaria tambem o bloco da VOZ ESPONTANEA (que tem `contextInfo` no texto de
  // outro helper) — falso positivo.
  const i = INDEX.indexOf('async function enviarNotaDeVoz(');
  // Sem os comentarios (o bloco CITA os termos para explicar).
  const bloco = INDEX.slice(i, i + 1200)
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  // O CONTAINER e' o que decide: MP3 -> bolha de musica (a "laranja", igual ao
  // `!play`); OGG/Opus -> NOTA DE VOZ (o desenho da ONDA). O dono quer a onda.
  ok(/audio:\s*voz\.ogg/.test(bloco), 'manda o OGG (nao MP3) — e o container que da a onda');
  ok(/audio\/ogg; codecs=opus/.test(bloco), 'com o mimetype OGG/Opus');
  ok(/ptt:\s*true/.test(bloco), 'com `ptt: true` (marca de nota de voz)');
  ok(!/audio\/mpeg/.test(bloco), 'e NAO audio/mpeg (MP3 vira a bolha de musica)');
  // O `contextInfo` (newsletter) fica FORA — foi o que atrapalhou a renderizacao
  // nas rodadas em que o dono testou.
  ok(!/contextInfo\s*:/.test(bloco), 'NAO manda contextInfo (newsletter)');
  ok(!/gerarContextNewsletter/.test(bloco), 'nem o cabecalho de canal');
  // A cadeia OGG usa o ffmpeg (PCM -> WAV -> Opus) — isso e' esperado.
  ok(/pcmParaWav/.test(bloco) && /toOggOpus/.test(bloco), 'usa a cadeia PCM -> WAV -> OGG/Opus');
});

await test('9. o pedido de audio NAO e tratado como conversa normal (early return)', () => {
  const i = INDEX.indexOf('ehPedidoDeAudio(textoLimpo)');
  const bloco = INDEX.slice(i, i + 1600);
  // Tem de haver um `return` depois do envio (nao segue pro LLM de texto).
  ok(bloco.includes('return;'), 'ha early return (nao cai no fluxo de texto)');
});

console.log('\n============================================================');
const tot = RESULTS.reduce((a, r) => a + r.passed, 0);
const fal = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log(`RESULTADO: ${RESULTS.length} testes | ${tot} asserções ok | ${fal} falhas`);
if (!FFMPEG) console.log('(sem ffmpeg: os testes de conversao foram pulados)');
console.log('============================================================');
process.exit(fal ? 1 : 0);
