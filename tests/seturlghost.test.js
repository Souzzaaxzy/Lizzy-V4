/**
 * Testes do `!seturlghost` (URL do servidor definida à mão) e do log de boot.
 *
 * Cobre o que o dono pediu:
 *   - gravar a URL manualmente e ela VENCER a detecção automática;
 *   - validação (URL inválida não é gravada; http público vira https);
 *   - "ver" e "limpar";
 *   - só o DONO usa;
 *   - persistência em disco (sobrevive a reinício do processo);
 *   - o boot passa a mostrar a URL e a ORIGEM sempre;
 *   - o `!addghostcmd` entrega o arquivo apontando para a URL manual.
 *
 * Uso: node tests/seturlghost.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-urlghost-db-'));
process.env.DATABASE_PATH = TMP_DB;
fs.mkdirSync(path.join(TMP_DB, 'grupos'), { recursive: true });

// ── Mini harness (mesmo estilo do ghost-manager) ──────────────────────────
const RESULTADOS = [];
let ATUAL = null;
function test(name, fn) {
  ATUAL = { name, passed: 0, failed: 0, errors: [] };
  RESULTADOS.push(ATUAL);
  const done = (error) => {
    if (error) { ATUAL.failed += 1; ATUAL.errors.push(`EXCEÇÃO: ${error?.stack || error}`); }
    console.log(`${ATUAL.failed === 0 ? '✅' : '❌'} ${name} (${ATUAL.passed} ok, ${ATUAL.failed} falhas)`);
    for (const e of ATUAL.errors) console.log(`     ${e.split('\n')[0]}`);
  };
  try {
    const r = fn();
    if (r && typeof r.then === 'function') return r.then(() => done()).catch(done);
    done();
  } catch (e) { done(e); }
  return Promise.resolve();
}
function ok(cond, msg) {
  if (cond) ATUAL.passed += 1;
  else { ATUAL.failed += 1; ATUAL.errors.push(`ASSERT FALHOU: ${msg}`); }
}
const includes = (h, n, l) => ok(typeof h === 'string' && h.includes(n), `${l ?? n} — esperado conter "${n}"`);
const notIncludes = (h, n, l) => ok(typeof h === 'string' && !h.includes(n), `${l ?? n} — NÃO deveria conter "${n}"`);

/** Achata um envio em texto (texto + richResponse), como os outros testes. */
function textoDoEnvio(c) {
  if (!c || typeof c !== 'object') return '';
  const partes = [];
  for (const k of ['text', 'caption']) if (typeof c[k] === 'string') partes.push(c[k]);
  if (Array.isArray(c.richResponse)) {
    for (const sub of c.richResponse) {
      if (typeof sub?.text === 'string') partes.push(sub.text);
      if (Array.isArray(sub?.code)) partes.push(sub.code.map((x) => x.codeContent).join('\n'));
    }
  }
  return partes.join('\n');
}

// ── Módulos sob teste ─────────────────────────────────────────────────────
const urlManual = await import(new URL('../dados/src/antifantasma/urlManual.js', import.meta.url).href);
const publicUrl = await import(new URL('../dados/src/utils/publicUrl.js', import.meta.url).href);
const { default: handleMessage } = await import(new URL('../dados/src/index.js', import.meta.url).href);

const DONO = '5511999999999@s.whatsapp.net';
const DONO_LID = '111000000000001@lid';

// ============================================================================
// 1) MÓDULO DE PERSISTÊNCIA — normalização e validação
// ============================================================================

await test('urlManual: normaliza e valida a URL informada', () => {
  // Sem esquema -> https.
  ok(urlManual.normalizarUrl('meuservidor.com') === 'https://meuservidor.com', 'sem esquema vira https');
  // Com esquema https -> mantém.
  ok(urlManual.normalizarUrl('https://meuservidor.com') === 'https://meuservidor.com', 'https mantido');
  // Barra final removida.
  ok(urlManual.normalizarUrl('https://meuservidor.com/') === 'https://meuservidor.com', 'barra final sai');
  // Espaços e <> (o WhatsApp às vezes manda "(" e "<").
  ok(urlManual.normalizarUrl('  <https://meuservidor.com>  ') === 'https://meuservidor.com', 'espaços/< > saem');
  // http em host PÚBLICO vira https (a KEY não pode trafegar em claro).
  ok(urlManual.normalizarUrl('http://meuservidor.com') === 'https://meuservidor.com', 'http público -> https');
  // http em local é aceito.
  ok(urlManual.normalizarUrl('http://localhost:3000') === 'http://localhost:3000', 'localhost mantém http');
  ok(urlManual.normalizarUrl('http://127.0.0.1:8080') === 'http://127.0.0.1:8080', '127.0.0.1 mantém http');
  // Porta explícita é preservada.
  ok(urlManual.normalizarUrl('https://meuservidor.com:8443') === 'https://meuservidor.com:8443', 'porta preservada');

  // Inválidas -> null (nunca gravamos lixo).
  for (const ruim of ['', '   ', 'nao tem espaco', 'http://', 'https://', '.', '://x', null, undefined, 42]) {
    ok(urlManual.normalizarUrl(ruim) === null, `inválida recusada (${JSON.stringify(ruim)})`);
  }
});

await test('urlManual: grava, lê e limpa (persistência em disco)', () => {
  ok(urlManual.temUrlManual() === false, 'começa sem URL');

  const g = urlManual.gravarUrlManual('meuservidor.com');
  ok(g.ok === true, 'gravou');
  ok(g.url === 'https://meuservidor.com', `normalizou (${g.url})`);

  // Relê do DISCO (não de memória): é o que sobrevive ao reinício.
  const arquivo = path.join(TMP_DB, 'antifantasma', 'publicUrl.json');
  ok(fs.existsSync(arquivo), 'arquivo criado no banco');
  ok(urlManual.lerUrlManual() === 'https://meuservidor.com', 'lê de volta do disco');
  ok(urlManual.temUrlManual() === true, 'tem URL');

  // Grava inválida NÃO sobrescreve a boa.
  const ruim = urlManual.gravarUrlManual('isso nao e uma url');
  ok(ruim.ok === false && ruim.motivo === 'url_invalida', 'recusa inválida');
  ok(urlManual.lerUrlManual() === 'https://meuservidor.com', 'a URL boa continua');

  // Limpa.
  const l = urlManual.limparUrlManual();
  ok(l.ok === true && urlManual.temUrlManual() === false, 'limpa');
});

await test('urlManual: entradas reais do WhatsApp (robustez)', () => {
  // O que o dono realmente digita — inclusive o que o cliente do WhatsApp manda
  // junto (colchetes de link, barra no fim, maiúsculas, caminho extra).
  const aceitas = [
    ['https://meu.com', 'https://meu.com'],
    ['meu.com', 'https://meu.com'],
    ['http://meu.com', 'https://meu.com'],
    ['MEU.COM', 'https://meu.com'],
    ['https://meu.com/', 'https://meu.com'],
    ['https://meu.com/path', 'https://meu.com'],
    ['https://meu.com:8443', 'https://meu.com:8443'],
    ['  https://meu.com  ', 'https://meu.com'],
    ['<https://meu.com>', 'https://meu.com'],
    ['https://sub.meu.com.br', 'https://sub.meu.com.br'],
    ['https://1.2.3.4:9000', 'https://1.2.3.4:9000'],
    ['http://localhost:3000', 'http://localhost:3000'],
  ];
  for (const [entrada, esperado] of aceitas) {
    ok(urlManual.normalizarUrl(entrada) === esperado,
      `${JSON.stringify(entrada)} -> ${esperado} (obtido ${urlManual.normalizarUrl(entrada)})`);
  }

  // O que NÃO pode entrar: esquema perigoso, host quebrado, injeção e lixo.
  const recusadas = [
    '', ' ', 'abc', 'http://', 'https://', '.', '..', 'https://.', '://x',
    'https://meu .com', 'ftp://meu.com', 'javascript:alert(1)',
    'https://meu.com\nrm -rf /', 'a'.repeat(500),
  ];
  for (const ruim of recusadas) {
    ok(urlManual.normalizarUrl(ruim) === null,
      `recusa ${JSON.stringify(String(ruim).slice(0, 24))}`);
  }
});

// ============================================================================
// 2) PRECEDÊNCIA — a URL manual vence a detecção automática
// ============================================================================

await test('precedência: URL manual vence env e detecção automática', () => {
  const env = { RUNTIME_URL: 'https://auto.exemplo.com', ANTIFANTASMA_PUBLIC_URL: 'https://env.exemplo.com' };

  // Sem manual: a variável de ambiente ganha da detecção.
  ok(publicUrl.detectarUrlPublica(env) === 'https://env.exemplo.com', 'env ganha sem manual');

  // Com manual: a manual ganha de tudo.
  ok(publicUrl.detectarUrlPublica(env, { urlManual: 'https://manual.exemplo.com' }) === 'https://manual.exemplo.com',
    'manual vence o env');

  // A manual também define o endpoint.
  ok(publicUrl.endpointAntiFantasma(env, { urlManual: 'https://manual.exemplo.com' })
    === 'https://manual.exemplo.com/api/antifantasma/exec', 'endpoint usa a manual');

  // Sem manual (null/vazio): a detecção segue normalmente e nada quebra.
  // (Na prática o valor vem de `lerUrlManual()`, que já valida antes de gravar.)
  ok(publicUrl.detectarUrlPublica(env, { urlManual: null }) === 'https://env.exemplo.com',
    'sem manual cai para o env');
  ok(publicUrl.detectarUrlPublica(env, { urlManual: '' }) === 'https://env.exemplo.com',
    'manual vazia cai para o env');
});

await test('resumoParaLog: mostra URL, origem e sempre aparece no boot', () => {
  // Com manual: origem declarada.
  const comManual = publicUrl.resumoParaLog({}, { porta: 12000, urlManual: 'https://manual.exemplo.com', sempre: true });
  includes(comManual.texto, 'https://manual.exemplo.com', 'mostra a URL');
  includes(comManual.texto, 'gravada com !seturlghost', 'diz a origem manual');
  ok(comManual.origem === 'gravada com !seturlghost', 'origem no objeto');

  // Com env: origem declarada.
  const comEnv = publicUrl.resumoParaLog({ ANTIFANTASMA_PUBLIC_URL: 'https://env.exemplo.com' }, { porta: 12000, sempre: true });
  includes(comEnv.texto, 'variável de ambiente', 'diz a origem env');

  // Automática.
  const auto = publicUrl.resumoParaLog({ RUNTIME_URL: 'https://auto.exemplo.com' }, { porta: 12000, sempre: true });
  includes(auto.texto, 'detectada automaticamente', 'diz a origem automática');

  // SEM nada: ainda aparece (era o buraco — um bot sem URL não dizia nada).
  const nada = publicUrl.resumoParaLog({}, { sempre: true });
  ok(nada !== null, 'sempre aparece no boot (opts.sempre)');
  includes(nada.texto, 'não detectada', 'avisa que não detectou');
  includes(nada.texto, 'seturlghost', 'aponta o comando para resolver');

  // Sem `sempre` e sem nada: continua null (não polui quem chama de outro jeito).
  ok(publicUrl.resumoParaLog({}) === null, 'sem sempre e sem nada continua null');
});

// ============================================================================
// 3) HANDLER REAL — !seturlghost
// ============================================================================

let grupoSeq = 0;
const fazerGrupo = () => {
  grupoSeq += 1;
  const jid = `1203636000000${String(grupoSeq).padStart(5, '0')}@g.us`;
  fs.writeFileSync(path.join(TMP_DB, 'grupos', `${jid}.json`), JSON.stringify({ groupName: 'G' }));
  return jid;
};

function makeNazu({ sent, groupJid }) {
  return {
    sendMessage: async (jid, content, options) => {
      sent.push({ jid, content, options });
      return { key: { id: `SENT-${sent.length}` } };
    },
    user: { id: `${DONO.split('@')[0]}:5@s.whatsapp.net`, lid: DONO_LID, name: 'Lizzy' },
    onWhatsApp: async (jid) => [{ jid, exists: true, lid: jid.replace('@s.whatsapp.net', '@lid') }],
    signalRepository: { lidMapping: { getPNForLID: async () => null } },
    groupMetadata: async () => ({
      id: groupJid, subject: 'G',
      participants: [{ id: DONO_LID, lid: DONO_LID, phoneNumber: DONO, admin: 'admin' }],
    }),
    groupParticipantsUpdate: async () => ({}),
    groupRequestParticipantsList: async () => [],
    groupRequestParticipantsUpdate: async () => ({}),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {},
    sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => 'x',
    react: async () => ({}),
  };
}

/** Roda como o DONO (fromMe) — é o caminho destes comandos. */
async function rodarComoDono(text) {
  const groupJid = fazerGrupo();
  const sent = [];
  const nazu = makeNazu({ sent, groupJid });
  await handleMessage(nazu, {
    key: { remoteJid: groupJid, fromMe: true, id: `M-${Math.random().toString(36).slice(2, 9)}`, participant: DONO },
    message: { extendedTextMessage: { text, contextInfo: { remoteJid: groupJid } } },
    messageTimestamp: 1757900000,
    pushName: 'Dono',
  }, null, new Map(), null);
  const texto = sent.map((s) => textoDoEnvio(s.content)).filter(Boolean).join('\n');
  return { sent, texto };
}

await test('handler: !seturlghost grava a URL e confirma', async () => {
  urlManual.limparUrlManual();
  const r = await rodarComoDono('!seturlghost https://meuserver.com');
  includes(r.texto, 'URL do servidor definida', 'confirma');
  includes(r.texto, 'https://meuserver.com', 'mostra a URL');
  ok(urlManual.lerUrlManual() === 'https://meuserver.com', 'gravou de verdade');
});

await test('handler: !seturlghost sem argumento mostra a atual e a origem', async () => {
  const r = await rodarComoDono('!seturlghost');
  includes(r.texto, 'Endpoint em uso', 'mostra o endpoint');
  ok(/Origem:/.test(r.texto), 'mostra a origem');
  includes(r.texto, 'seturlghost <url>', 'explica como usar');
});

await test('handler: !seturlghost limpar volta à detecção automática', async () => {
  urlManual.gravarUrlManual('https://meuserver.com');
  const r = await rodarComoDono('!seturlghost limpar');
  includes(r.texto, 'removida', 'confirma a remoção');
  ok(urlManual.temUrlManual() === false, 'apagou de verdade');
});

await test('handler: !seturlghost recusa URL inválida sem apagar a boa', async () => {
  urlManual.gravarUrlManual('https://boa.exemplo.com');
  const r = await rodarComoDono('!seturlghost isso-nao-e-url');
  includes(r.texto, 'URL inválida', 'avisa o erro');
  ok(urlManual.lerUrlManual() === 'https://boa.exemplo.com', 'a URL boa continua');
});

await test('handler: NÃO-dono é barrado', async () => {
  // Um participante comum do grupo tenta usar o comando.
  const groupJid = fazerGrupo();
  const sent = [];
  const intruso = '333000000000009@lid';
  const nazu = makeNazu({ sent, groupJid });
  nazu.groupMetadata = async () => ({
    id: groupJid, subject: 'G',
    participants: [
      { id: DONO_LID, lid: DONO_LID, phoneNumber: DONO, admin: 'admin' },
      { id: intruso, lid: intruso, phoneNumber: '5511888888888@s.whatsapp.net', admin: null },
    ],
  });
  await handleMessage(nazu, {
    key: { remoteJid: groupJid, fromMe: false, id: 'M-INTRUSO', participant: intruso },
    message: { extendedTextMessage: { text: '!seturlghost https://hacker.com', contextInfo: { remoteJid: groupJid } } },
    messageTimestamp: 1757900000, pushName: 'Intruso',
  }, null, new Map(), null);

  const texto = sent.map((s) => textoDoEnvio(s.content)).filter(Boolean).join('\n');
  ok(/dono/i.test(texto), 'responde que é só para o dono');
  ok(urlManual.lerUrlManual() !== 'https://hacker.com', 'não gravou nada');
});

// ============================================================================
// 4) !addghostcmd entrega apontando para a URL MANUAL
// ============================================================================

await test('!addghostcmd: arquivo entregue usa a URL manual', async () => {
  // Sobe a API numa porta efêmera para o endpoint existir de verdade.
  const api = await import(new URL('../dados/src/antifantasma/api.js', import.meta.url).href);
  const server = api.iniciarApi(0);
  await new Promise((r) => setTimeout(r, 200));

  urlManual.gravarUrlManual('https://manual-entrega.exemplo.com');

  const groupJid = fazerGrupo();
  const sent = [];
  const nazu = makeNazu({ sent, groupJid });
  await handleMessage(nazu, {
    key: { remoteJid: groupJid, fromMe: true, id: 'M-ADD', participant: DONO },
    message: {
      extendedTextMessage: {
        text: '!addghostcmd',
        contextInfo: {
          remoteJid: groupJid,
          quotedMessage: { extendedTextMessage: { text: 'quero o plugin' } },
          participant: '5511888888888@s.whatsapp.net',
          stanzaId: 'Q1',
        },
      },
    },
    messageTimestamp: 1757900000, pushName: 'Dono',
  }, null, new Map(), null);

  const doc = sent.find((s) => s.content?.document) || null;
  ok(Boolean(doc), 'enviou o arquivo');
  const conteudo = String(doc?.content?.document || '');
  includes(conteudo, 'https://manual-entrega.exemplo.com', 'o arquivo aponta para a URL MANUAL');
  notIncludes(conteudo, 'api.exemplo.com', 'não deixou o placeholder');

  await new Promise((r) => server.close(r));
});

await test('!ghostcmd mostra a URL e a origem', async () => {
  urlManual.gravarUrlManual('https://painel.exemplo.com');
  const r = await rodarComoDono('!ghostcmd');
  includes(r.texto, 'URL DO SERVIDOR', 'tem a seção');
  includes(r.texto, 'https://painel.exemplo.com', 'mostra a URL manual');
  includes(r.texto, 'seturlghost', 'indica o comando');
});

// ============================================================================
// 5) MENU
// ============================================================================

await test('menudono traz o !seturlghost e o blockPv o conhece', () => {
  const menu = fs.readFileSync(path.join(PROJECT, 'dados', 'src', 'menus', 'menudono.js'), 'utf-8');
  includes(menu, 'seturlghost', 'está no menu do dono');

  const blockPv = fs.readFileSync(path.join(PROJECT, 'dados', 'src', 'utils', 'blockPv.js'), 'utf-8');
  includes(blockPv, "'seturlghost'", 'está na lista de comandos do menudono');
});

// ============================================================================
// RESULTADO
// ============================================================================

let totalOk = 0, totalFail = 0;
for (const r of RESULTADOS) { totalOk += r.passed; totalFail += r.failed; }

console.log('\n════════════════════════════════════════');
console.log(`RESULTADO: ${RESULTADOS.length} testes | ${totalOk} asserções ok | ${totalFail} falhas`);
console.log('════════════════════════════════════════');

fs.rmSync(TMP_DB, { recursive: true, force: true });
if (totalFail) process.exit(1);
console.log('✅ SETURLGHOST + LOG DE BOOT VALIDADOS');
// Importar o index.js deixa timers/handles abertos (é o handler do bot inteiro);
// sem isto o processo ficaria pendurado depois dos testes.
process.exit(0);