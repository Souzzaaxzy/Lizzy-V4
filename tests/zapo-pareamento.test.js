/**
 * Pareamento do motor de MIDIA (backend `zapo`) + store persistente.
 *
 * ## O que este teste protege
 *
 * O backend `zapo` e' um client PROPRIO: nao usa a sessao do Baileys. Sem
 * parear, o offer da call de grupo morre em:
 *
 *     a group call offer has no jid of ours to name as its call-creator
 *
 * E o store do pacote (`WaAuthMemoryStore`) guarda as credenciais numa variavel
 * de instancia -- o pareamento se perderia a cada reinicio. Este teste cobre:
 *
 *   - o store de ARQUIVO (round-trip com Uint8Array, persistencia real);
 *   - `estaPareado()` lendo o disco;
 *   - o `!callp` pedindo o pareamento em vez de mostrar o erro criptico;
 *   - o subcomando `!callp parear <numero>` (validacao + codigo);
 *   - que o DUBLE desliga a exigencia (os testes de contrato seguem valendo).
 *
 * Uso: node tests/zapo-pareamento.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-zapo-'));
process.env.DATABASE_PATH = TMP_DB;
process.env.ZAPO_DISABLE_CONNECT = '1';

const RESULTS = [];
let CURRENT = null;

function test(name, fn) {
  CURRENT = { name, passed: 0, failed: 0, errors: [] };
  RESULTS.push(CURRENT);
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      return r.then(() => finish(name)).catch((e) => {
        CURRENT.failed += 1; CURRENT.errors.push(`EXCEÇÃO: ${e?.stack || e}`); finish(name);
      });
    }
    finish(name);
  } catch (e) {
    CURRENT.failed += 1; CURRENT.errors.push(`EXCEÇÃO: ${e?.stack || e}`); finish(name);
  }
  return Promise.resolve();
}
function finish(name) {
  console.log(`${CURRENT.failed === 0 ? '✅' : '❌'} ${name} (${CURRENT.passed} ok, ${CURRENT.failed} falhas)`);
  for (const err of CURRENT.errors) console.log(`     ${err.split('\n')[0]}`);
}
function ok(cond, msg) {
  if (cond) CURRENT.passed += 1;
  else { CURRENT.failed += 1; CURRENT.errors.push(`ASSERT FALHOU: ${msg}`); }
}
function includes(hay, needle, label) {
  ok(typeof hay === 'string' && hay.includes(needle),
    `${label ?? needle} — esperado conter "${needle}"`);
}

const zapoStore = await import(new URL('../dados/src/funcs/utils/zapoStore.js', import.meta.url).href);
const zapoCall = await import(new URL('../dados/src/funcs/utils/zapoCall.js', import.meta.url).href);
const callMedia = await import(new URL('../dados/src/funcs/utils/callMedia.js', import.meta.url).href);

console.log('\n=== 1) STORE DE ARQUIVO (o que faz o pareamento sobreviver) ===\n');

await test('grava e le as credenciais (round-trip)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'store-'));
  const b = await zapoStore.criarStoreArquivoDoPacote(dir);
  const auth = b.stores.auth('s');

  ok(await auth.load() === null, 'começa vazio');

  await auth.save({ meJid: '5511@s.whatsapp.net', meLid: '123@lid' });
  const lido = await auth.load();
  ok(lido?.meJid === '5511@s.whatsapp.net', 'meJid preservado');
  ok(lido?.meLid === '123@lid', 'meLid preservado');
});

await test('Uint8Array sobrevive ao JSON (sem virar objeto de bytes)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'store-'));
  const b = await zapoStore.criarStoreArquivoDoPacote(dir);
  const auth = b.stores.auth('s');

  const chave = new Uint8Array([0, 1, 127, 128, 255]);
  await auth.save({ meJid: 'x@s.whatsapp.net', noiseKeyPair: { public: chave } });
  const lido = await auth.load();

  ok(lido.noiseKeyPair.public instanceof Uint8Array,
    'volta como Uint8Array (não objeto {0:..,1:..})');
  ok(Array.from(lido.noiseKeyPair.public).join(',') === '0,1,127,128,255',
    'bytes idênticos aos gravados');
});

await test('PERSISTE em disco (nova instância lê o que a anterior gravou)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'store-'));
  const b1 = await zapoStore.criarStoreArquivoDoPacote(dir);
  await b1.stores.auth('s').save({ meJid: 'persistido@s.whatsapp.net' });

  // Instância NOVA, como se o bot tivesse reiniciado.
  const b2 = await zapoStore.criarStoreArquivoDoPacote(dir);
  const lido = await b2.stores.auth('s').load();
  ok(lido?.meJid === 'persistido@s.whatsapp.net', 'sobreviveu ao "reinício"');
});

await test('contrato REAL do preKey (os métodos que o motor chama)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'store-'));
  const b = await zapoStore.criarStoreArquivoDoPacote(dir);
  const pk = b.stores.preKey('s');

  // Os nomes vêm do CONTRATO do pacote (é o que o motor chama), não de um
  // `get/set` genérico — foi a reimplementação "por adivinhação" que quebrou
  // antes com `store.setRegistrationInfo is not a function`.
  ok(typeof pk.putPreKey === 'function', 'putPreKey existe');
  ok(typeof pk.getPreKeyById === 'function', 'getPreKeyById existe');
  ok(typeof pk.getOrGenPreKeys === 'function', 'getOrGenPreKeys existe');
  ok(typeof pk.consumePreKeyById === 'function', 'consumePreKeyById existe');
  ok(typeof pk.markKeyAsUploaded === 'function', 'markKeyAsUploaded existe');
  ok(typeof pk.getServerHasPreKeys === 'function', 'getServerHasPreKeys existe');
});

await test('contrato REAL do signal (o que quebrou antes)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'store-'));
  const b = await zapoStore.criarStoreArquivoDoPacote(dir);
  const sig = b.stores.signal('s');

  ok(typeof sig.setRegistrationInfo === 'function',
    'setRegistrationInfo EXISTE (era o erro "is not a function")');
  ok(typeof sig.getRegistrationInfo === 'function', 'getRegistrationInfo existe');
  ok(typeof sig.setSignedPreKey === 'function', 'setSignedPreKey existe');
  ok(typeof sig.getSignedPreKeyRotationTs === 'function', 'getSignedPreKeyRotationTs existe');
});

await test('o estado do signal PERSISTE (grava, reinstancia, lê)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'store-'));

  const b1 = await zapoStore.criarStoreArquivoDoPacote(dir);
  const sig1 = b1.stores.signal('s');
  await sig1.setRegistrationInfo({
    registrationId: 4242,
    identityKeyPair: { pub: new Uint8Array([1, 2, 3]) }
  });
  await sig1.setSignedPreKeyRotationTs(999);

  // Instância NOVA: como se o bot tivesse reiniciado.
  const b2 = await zapoStore.criarStoreArquivoDoPacote(dir);
  const sig2 = b2.stores.signal('s');

  const info = await sig2.getRegistrationInfo();
  ok(info?.registrationId === 4242, 'registrationId sobreviveu');
  ok(info?.identityKeyPair?.pub instanceof Uint8Array, 'bytes voltam como Uint8Array');
  ok(Array.from(info?.identityKeyPair?.pub || []).join(',') === '1,2,3', 'bytes idênticos');
  ok(await sig2.getSignedPreKeyRotationTs() === 999, 'rotationTs sobreviveu');
});

await test('clear remove tudo', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'store-'));
  const b = await zapoStore.criarStoreArquivoDoPacote(dir);
  await b.stores.auth('s').save({ meJid: 'a@b' });
  await b.stores.auth('s').clear();
  ok(await b.stores.auth('s').load() === null, 'auth limpo');
});

console.log('\n=== 2) estaPareado / meuJid (leitura do disco) ===\n');

await test('sem credencial, estaPareado() é false', () => {
  // O diretório do teste (DATABASE_PATH) não tem zapo-auth/.
  ok(zapoCall.estaPareado() === false, 'não pareado');
  ok(zapoCall.meuJid() === null, 'sem jid');
});

await test('com credencial no disco, estaPareado() é true', async () => {
  const dir = zapoCall.diretorioAuth();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'auth.json'), JSON.stringify({
    credentials: { meJid: '5511999999999@s.whatsapp.net', meLid: '999@lid' }
  }));

  ok(zapoCall.estaPareado() === true, 'reconhece o pareamento');
  ok(zapoCall.meuJid() === '999@lid', 'prefere o LID (o que o offer usa)');

  fs.rmSync(path.join(dir, 'auth.json'), { force: true });
});

await test('arquivo corrompido não derruba (devolve false)', () => {
  const dir = zapoCall.diretorioAuth();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'auth.json'), '{ isso nao e json');

  ok(zapoCall.estaPareado() === false, 'não quebra com JSON inválido');

  fs.rmSync(path.join(dir, 'auth.json'), { force: true });
});

console.log('\n=== 3) A FACHADA (callMedia) respeita o DUBLÊ ===\n');

await test('com dublê, precisaPareamento() é false', async () => {
  callMedia.__setDuble({ estagio: () => 'pronta', tocar: () => ({ ok: true }), parar: () => ({ ok: true }) });
  ok(await callMedia.precisaPareamento() === false,
    'o teste de contrato não pode ser bloqueado pelo pareamento');
  ok(await callMedia.estaPareado() === true, 'considerado pareado');
  callMedia.__setDuble(null);
});

await test('parearMidia com dublê devolve motivo próprio', async () => {
  callMedia.__setDuble({ estagio: () => 'pronta', tocar: () => ({ ok: true }), parar: () => ({ ok: true }) });
  const r = await callMedia.parearMidia('5511999999999');
  ok(r.ok === false && r.motivo === 'backend_nao_exige_pareamento',
    'não tenta parear o backend real em teste');
  callMedia.__setDuble(null);
});

await test('sem dublê e sem pareamento, precisaPareamento() é true', async () => {
  // ZAPO_DISABLE_CONNECT impede a conexão; o backend carrega e reporta
  // que não está pareado.
  const precisa = await callMedia.precisaPareamento();
  ok(precisa === true, 'pede pareamento quando o backend é o zapo e não há credencial');
});

console.log('\n=== 4) O COMANDO `!callp parear` ===\n');

const INDEX = fs.readFileSync(new URL('../dados/src/index.js', import.meta.url), 'utf8');

await test('o subcomando existe e valida o número', () => {
  ok(INDEX.includes("subCallp === 'parear'"), 'tem o subcomando parear');
  includes(INDEX, 'DDI', 'explica o formato do número');
  includes(INDEX, '5511999999999', 'dá exemplo');
});

await test('o fluxo de pareamento usa o backend e formata o código', () => {
  includes(INDEX, 'parearMidia(numero)', 'chama a fachada');
  includes(INDEX, "match(/.{1,4}/g)", 'formata o código em grupos de 4');
  includes(INDEX, 'Aparelhos conectados', 'ensina onde digitar');
});

await test('o `!callp` checa o pareamento ANTES de subir a call', () => {
  includes(INDEX, 'await precisaPareamento()', 'checa antes');
  includes(INDEX, 'precisa ser pareado uma vez', 'explica em vez do erro criptico');
});

await test('o motivo `nao_pareado` tem mensagem própria', () => {
  includes(INDEX, 'nao_pareado', 'motivo tratado');
});

await test('o erro criptico do motor NÃO é o que o usuário vê', () => {
  // O termo aparece em COMENTÁRIO (documentando a causa). O que importa é que
  // ele não esteja numa mensagem ENVIADA ao usuário. Comparar com o trecho do
  // `reply(` é o critério certo: é por ali que o texto sai.
  const trechoPareamento = INDEX.slice(
    INDEX.indexOf("subCallp === 'parear'"),
    INDEX.indexOf('// Encerra a call que ESTE comando subiu')
  );
  ok(trechoPareamento.length > 0, 'achou o bloco do subcomando');
  ok(!trechoPareamento.includes('call-creator'),
    'o bloco do pareamento não menciona o erro do motor');
  // E a orientação que o usuário recebe é a ação correta:
  includes(trechoPareamento, 'Codigo de pareamento', 'entrega o código');
  includes(trechoPareamento, 'Aparelhos conectados', 'diz onde digitar');
});

console.log('\n=== 5) O store em memória NÃO é mais usado ===\n');

await test('zapoCall usa store de ARQUIVO', () => {
  const src = fs.readFileSync(new URL('../dados/src/funcs/utils/zapoCall.js', import.meta.url), 'utf8');
  includes(src, 'criarStoreArquivo', 'usa o backend de arquivo');
  ok(!src.includes('WaAuthMemoryStore'),
    'não usa mais o store em memória (que perdia o pareamento)');
  includes(src, 'zapo-auth', 'grava em dados/database/zapo-auth');
});

console.log('\n=== 6) Teste de INTEGRAÇÃO do store com o zapo ===\n');

await test('o createStore do zapo aceita o nosso backend', async () => {
  const { createStore } = await import('zapo-js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'int-'));
  const store = createStore({
    backends: { arquivo: zapoStore.criarStoreArquivo(dir) },
    providers: {
      auth: 'arquivo', signal: 'arquivo', preKey: 'arquivo', session: 'arquivo',
      identity: 'arquivo', senderKey: 'arquivo', appState: 'arquivo',
      privacyToken: 'arquivo', messages: 'none', threads: 'none', contacts: 'none'
    }
  });
  ok(store && typeof store.session === 'function', 'store criado sem erro');
});

// ============================================================================

await test('Map sobrevive ao JSON (era "senderKeys.get is not a function")', async () => {
  const { paraJson, paraBinario } = zapoStore.__teste;
  const original = {
    senderKeys: new Map([['a', new Uint8Array([1, 2])]]),
    uploadedPreKeys: new Set([1, 2, 3])
  };
  const volta = paraBinario(JSON.parse(JSON.stringify(paraJson(original))));

  ok(volta.senderKeys instanceof Map, 'senderKeys volta como Map');
  ok(typeof volta.senderKeys.get === 'function', '.get EXISTE (era o erro do log)');
  ok(Array.from(volta.senderKeys.get('a')).join(',') === '1,2', 'valor preservado');
  ok(volta.uploadedPreKeys instanceof Set, 'uploadedPreKeys volta como Set');
  ok([...volta.uploadedPreKeys].join(',') === '1,2,3', 'valores do Set preservados');
});

await test('chave de Map em Uint8Array e preservada', async () => {
  const { paraJson, paraBinario } = zapoStore.__teste;
  const original = { keys: new Map([[new Uint8Array([9]), { v: new Uint8Array([7]) }]]) };
  const volta = paraBinario(JSON.parse(JSON.stringify(paraJson(original))));

  const chave = [...volta.keys.keys()][0];
  ok(chave instanceof Uint8Array, 'a chave voltou como Uint8Array');
  ok(Array.from(chave)[0] === 9, 'byte da chave preservado');
});

await test('os stores reais voltam com Map/Set funcionais apos reinicio', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'store-'));

  const b1 = await zapoStore.criarStoreArquivoDoPacote(dir);
  await b1.stores.senderKey('s').upsertSenderKey({ groupId: 'g', sender: { user: 'u', device: 1 }, key: new Uint8Array([1]) });
  await b1.stores.session('s').setSession({ user: 'u', device: 0 }, { record: new Uint8Array([2]) });
  await b1.stores.preKey('s').putPreKey({ keyId: 7, keyPair: { pub: new Uint8Array([3]) } });

  // Nova instancia = bot reiniciado.
  const b2 = await zapoStore.criarStoreArquivoDoPacote(dir);
  const sk = b2.stores.senderKey('s');
  const sess = b2.stores.session('s');
  const pk = b2.stores.preKey('s');

  ok(sk.senderKeys instanceof Map && typeof sk.senderKeys.get === 'function',
    'senderKey.senderKeys e Map com .get');
  ok(sess.signalSessions instanceof Map && typeof sess.signalSessions.get === 'function',
    'session.signalSessions e Map com .get');
  ok(pk.preKeys instanceof Map && typeof pk.preKeys.keys === 'function',
    'preKey.preKeys e Map com .keys');
  ok(pk.uploadedPreKeys instanceof Set, 'preKey.uploadedPreKeys e Set');
  ok(sk.senderKeys.size === 1 && sess.signalSessions.size === 1 && pk.preKeys.size === 1,
    'os tres preservaram conteudo');
});

await test('CONSERTA estado ja corrompido (Map virou {} na versao antiga)', async () => {
  // Reproduz o que a versao anterior gravou: Map -> {} no JSON.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corromp-'));
  fs.writeFileSync(path.join(dir, 'senderKey.json'), JSON.stringify({ senderKeys: {}, senderDistributions: {} }));
  fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify({ signalSessions: {} }));
  fs.writeFileSync(path.join(dir, 'preKey.json'), JSON.stringify({ preKeys: {}, uploadedPreKeys: {} }));

  const b = await zapoStore.criarStoreArquivoDoPacote(dir);
  const sk = b.stores.senderKey('s');
  const sess = b.stores.session('s');
  const pk = b.stores.preKey('s');

  // O construtor declara o tipo esperado; a restauracao coage por ele.
  ok(sk.senderKeys instanceof Map && typeof sk.senderKeys.get === 'function',
    'senderKeys consertado (era o erro do log)');
  ok(sess.signalSessions instanceof Map && typeof sess.signalSessions.get === 'function',
    'signalSessions consertado');
  ok(pk.preKeys instanceof Map && typeof pk.preKeys.keys === 'function',
    'preKeys consertado');
  ok(pk.uploadedPreKeys instanceof Set, 'uploadedPreKeys consertado como Set');
});

const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log('\n' + '='.repeat(40));
console.log(`RESULTADO: ${RESULTS.length} testes | ${totalOk} asserções ok | ${totalFail} falhas`);
console.log('='.repeat(40));
if (totalFail > 0) process.exit(1);
