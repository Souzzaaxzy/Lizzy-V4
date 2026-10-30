/**
 * A VOZ da conversa — "Lizzy, manda um áudio aí" vira NOTA DE VOZ.
 *
 * Pedido do dono: *"vamos pelo áudio, primeiro vamos configurar apenas o
 * 'lizzy, manda um audio ai' só pra testar, depois automatizamos"*.
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
const { pcmParaWav } = await import(new URL('../dados/src/utils/iapAudio.js', import.meta.url).href);
const { toOggOpus } = await import(new URL('../dados/src/utils/oggOpus.js', import.meta.url).href);

/** Ha' ffmpeg no PATH (ou em FFMPEG_PATH)? Sem ele a conversao nao roda. */
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

/** Dublê de TTS: 1s de senoide. Nao depende de rede nem do msedge. */
const sintetizarFake = async () => {
  const pcm = new Float32Array(16000);
  for (let i = 0; i < pcm.length; i++) pcm[i] = Math.sin(2 * Math.PI * 440 * i / 16000) * 0.3;
  return { ok: true, pcm, fonte: 'fake' };
};

await test('5. a cadeia gera OGG de verdade (magic `OggS`)', async () => {
  if (!FFMPEG) { console.log('     (pulado: sem ffmpeg)'); return; }
  const r = await voz.gerarNotaDeVoz({ texto: 'oi', sintetizar: sintetizarFake, pcmParaWav, toOggOpus });
  ok(r.ok === true, `gerou (motivo ${r.motivo || '-'})`);
  ok(Buffer.isBuffer(r.ogg) && r.ogg.length > 0, 'tem bytes');
  ok(r.ogg.slice(0, 4).toString('ascii') === 'OggS', 'e o magic e OggS (nota de voz)');
  ok(r.fonte === 'fake', 'reporta a fonte do TTS');
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
  for (const m of ['tts_falhou', 'sem_dependencias', 'texto_vazio', 'wav_falhou', 'opus_falhou', 'x']) {
    const t = voz.erroDaVoz(m);
    ok(typeof t === 'string' && t.length > 5 && !/undefined|null/.test(t), `motivo ${m} tem texto`);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// 3) A INTEGRACAO NO HANDLER
// ───────────────────────────────────────────────────────────────────────────

await test('8. o handler usa o gatilho e manda como NOTA DE VOZ (ptt)', () => {
  ok(INDEX.includes("from './utils/vozDaConversa.js'"), 'importa o modulo');
  ok(INDEX.includes('ehPedidoDeAudio(textoLimpo)'), 'usa o gatilho explicito');
  ok(INDEX.includes('gerarNotaDeVoz('), 'chama a geracao');
  // O envio tem de ser `ptt: true` + OGG/Opus (senao vira arquivo comum).
  const i = INDEX.indexOf('gerarNotaDeVoz(');
  const bloco = INDEX.slice(i, i + 1400);
  ok(/audio:\s*voz\.ogg/.test(bloco), 'manda o buffer como audio');
  ok(/ptt:\s*true/.test(bloco), 'com ptt: true (nota de voz)');
  ok(/audio\/ogg; codecs=opus/.test(bloco), 'com o mimetype OGG/Opus');
  // E o gatilho roda ANTES do LLM de texto (senao ela responderia texto).
  const iPedido = INDEX.indexOf('ehPedidoDeAudio(textoLimpo)');
  const iIA = INDEX.indexOf('ia.makeAssistentRequest(', iPedido);
  ok(iPedido > 0 && iIA > iPedido, 'o pedido de audio e tratado antes do LLM de texto');
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
