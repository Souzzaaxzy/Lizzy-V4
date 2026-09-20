/**
 * Testes do sistema de gerenciamento do Plugin Fantasma.
 *
 * Cobre as regras que o dono pediu, e que são as que mais facilmente quebram:
 *   - só o DONO usa os três comandos;
 *   - cada key é vinculada a UM dono (1 key = 1 usuário) e a API recusa quem
 *     não for ele, mesmo sabendo a key;
 *   - o id numérico NUNCA é reutilizado (revogar não libera o número);
 *   - a key nunca aparece inteira no painel nem em log (só mascarada);
 *   - o arquivo entregue é o ADAPTADOR, nunca o núcleo.
 *
 * Uso: node tests/ghost-manager.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-ghost-db-'));
process.env.DATABASE_PATH = TMP_DB;
fs.mkdirSync(path.join(TMP_DB, 'grupos'), { recursive: true });

const RESULTS = [];
let CURRENT = null;

function test(name, fn) {
  CURRENT = { name, passed: 0, failed: 0, errors: [] };
  RESULTS.push(CURRENT);
  const done = (error) => {
    if (error) {
      CURRENT.failed += 1;
      CURRENT.errors.push(`EXCEÇÃO: ${error?.stack || error}`);
    }
    console.log(`${CURRENT.failed === 0 ? '✅' : '❌'} ${name} (${CURRENT.passed} ok, ${CURRENT.failed} falhas)`);
    for (const err of CURRENT.errors) console.log(`     ${err.split('\n')[0]}`);
  };
  try {
    const result = fn();
    if (result && typeof result.then === 'function') return result.then(() => done()).catch(done);
    done();
  } catch (error) {
    done(error);
  }
  return Promise.resolve();
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

/** Achata um envio em texto puro, juntando `text`, legenda, code block e
 *  os trechos do richResponse (que tem texto E codigo dentro). */
function textoDoEnvio(c) {
  if (!c || typeof c !== 'object') return '';
  const partes = [];
  for (const k of ['text', 'caption', 'code', 'footerText', 'headerText', 'disclaimerText']) {
    if (typeof c[k] === 'string') partes.push(c[k]);
  }
  if (Array.isArray(c.richResponse)) {
    for (const sub of c.richResponse) {
      if (typeof sub?.text === 'string') partes.push(sub.text);
      if (Array.isArray(sub?.code)) partes.push(sub.code.map((x) => x.codeContent).join('\n'));
    }
  }
  return partes.join('\n');
}

function notIncludes(haystack, needle, label) {
  ok(typeof haystack === 'string' && !haystack.includes(needle), `${label ?? needle} — não deveria conter "${needle}"`);
}

// ============================================================================
// IMPORTS
// ============================================================================

const keys = await import(new URL('../dados/src/antifantasma/keys.js', import.meta.url).href);
const health = await import(new URL('../dados/src/antifantasma/health.js', import.meta.url).href);
const api = await import(new URL('../dados/src/antifantasma/api.js', import.meta.url).href);

const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;

const DONO = '5599999999999@s.whatsapp.net';
const DONO_LID = '111111111111111@lid';
const COMUM = '5511888888888@s.whatsapp.net';

// ============================================================================
// 1) REGISTRO DE KEYS — ids, vínculo e revogação
// ============================================================================

await test('keys: id numérico sequencial e vinculado ao dono', () => {
  keys.listarKeys().forEach(() => {});
  const a = keys.criarKey({ owner: '5511111111111' });
  const b = keys.criarKey({ owner: '5522222222222' });

  ok(a.id === 1, `primeira key tem id 1 (${a.id})`);
  ok(b.id === 2, `segunda key tem id 2 (${b.id})`);
  ok(a.owner === '5511111111111', 'dono da #1 correto');
  ok(b.owner === '5522222222222', 'dono da #2 correto');
  ok(a.status === 'active' && b.status === 'active', 'ambas ativas');
  ok(/^MTX-GHOST-[0-9A-F]{8}$/.test(a.key), `formato da key (${a.key})`);
  ok(a.key !== b.key, 'keys diferentes');
  ok(Boolean(a.createdAt), 'registra data de criação');
});

await test('keys: revogar NÃO apaga e NÃO libera o número', () => {
  const r = keys.revogarPorId(1);
  ok(r.ok === true, 'revogou a #1');
  ok(r.registro.status === 'revoked', 'status revoked');
  ok(Boolean(r.registro.revokedAt), 'registra quando revogou');

  const aindaExiste = keys.buscarPorId(1);
  ok(Boolean(aindaExiste), 'o registro #1 continua existindo (histórico preservado)');
  ok(aindaExiste.key === r.registro.key, 'a key não mudou');

  // O próximo id continua de onde parou — nunca volta para #1.
  const c = keys.criarKey({ owner: '5533333333333' });
  ok(c.id === 3, `nova key recebe #3, não #1 (${c.id})`);
});

await test('keys: revogar duas vezes avisa que já estava revogada', () => {
  const r1 = keys.revogarPorId(1);
  ok(r1.ok === false && r1.motivo === 'ja_revogada', 'detecta já revogada');
});

await test('keys: id inexistente é reportado', () => {
  const r = keys.revogarPorId(999);
  ok(r.ok === false && r.motivo === 'nao_encontrada', 'não encontrada');
  ok(keys.buscarPorId(999) === null, 'busca devolve null');
  ok(keys.revogarPorId('abc').motivo === 'id_invalido', 'id não numérico é inválido');
});

await test('keys: estatísticas contam certo', () => {
  const s = keys.estatisticas();
  ok(s.total === 3, `total 3 (${s.total})`);
  ok(s.ativas === 2, `ativas 2 (${s.ativas})`);
  ok(s.revogadas === 1, `revogadas 1 (${s.revogadas})`);
  ok(s.proximoId === 4, `próximo id 4 (${s.proximoId})`);
});

await test('keys: exige dono ao criar', () => {
  let erro = null;
  try { keys.criarKey({}); } catch (e) { erro = e; }
  ok(Boolean(erro), 'criar sem dono lança');
  let erro2 = null;
  try { keys.criarKey({ owner: '   ' }); } catch (e) { erro2 = e; }
  ok(Boolean(erro2), 'dono em branco lança');
});

await test('keys: mascaramento esconde o segredo', () => {
  const m = keys.mascararKey('MTX-GHOST-A1B2C3D4');
  ok(m.includes('••••'), `usa máscara (${m})`);
  ok(m.endsWith('C3D4'), 'mantém os 4 últimos para conferência');
  ok(!m.includes('A1B2C3'), 'não expõe o miolo');
  ok(keys.mascararKey('').includes('••••'), 'entrada vazia não quebra');
});

await test('keys: numeração sem buraco (o bug relatado)', () => {
  // Relato: "apaguei a key 1 e gero uma nova ela fica como 2". A numeração é a
  // POSIÇÃO na lista, então nunca sobra buraco.
  keys.apagarTodas();
  const a = keys.criarKey({ owner: 'A' });
  const b = keys.criarKey({ owner: 'B' });
  const c = keys.criarKey({ owner: 'C' });
  ok(a.id === 1 && b.id === 2 && c.id === 3, `sequência 1,2,3 (${a.id},${b.id},${c.id})`);

  // "Apagar" pelo comando = revogar (o registro fica). A numeração segue 1..N.
  keys.revogarPorId(1);
  const lista = keys.listarKeys();
  ok(lista.map((r) => r.id).join(',') === '1,2,3', `ids continuam 1,2,3 (${lista.map((r) => r.id)})`);
  ok(lista[0].status === 'revoked', 'a #1 fica REVOGADA no lugar, sem buraco');

  // Removendo de verdade (alt) e criando de novo: volta para #1.
  keys.apagarTodas();
  const nova = keys.criarKey({ owner: 'D' });
  ok(nova.id === 1, `depois do alt, a nova é #1 (${nova.id})`);
});

await test('keys: arquivo antigo com ids altos é renumerado sozinho', () => {
  // Um arquivo que ficou com ids 5,6 (do contador antigo) passa a ser 1,2 na
  // próxima leitura — conserta instalações que já existiam.
  keys.apagarTodas();
  const antigo = {
    version: 2,
    nextId: 99,
    keys: [
      { id: 5, key: 'MTX-GHOST-AAAABBBB', owner: 'X', status: 'active', createdAt: '2026-01-01' },
      { id: 9, key: 'MTX-GHOST-CCCCDDDD', owner: 'Y', status: 'revoked', createdAt: '2026-01-02' },
    ],
  };
  fs.writeFileSync(keys.KEYS_FILE, JSON.stringify(antigo));

  const lista = keys.listarKeys();
  ok(lista.map((r) => r.id).join(',') === '1,2', `renumerado para 1,2 (${lista.map((r) => r.id)})`);
  ok(lista[0].key === 'MTX-GHOST-AAAABBBB', 'preserva a key do primeiro');
  ok(lista[1].status === 'revoked', 'preserva o status');
  ok(keys.estatisticas().proximoId === 3, `próximo id = 3 (${keys.estatisticas().proximoId})`);
});

// ============================================================================
// 2) PERSISTÊNCIA
// ============================================================================

await test('persistência: sobrevive a releitura do arquivo', () => {
  // Simula um "reinício": o módulo relê do disco a cada chamada, então basta
  // conferir que os dados estão no arquivo com o formato esperado.
  const bruto = JSON.parse(fs.readFileSync(keys.KEYS_FILE, 'utf-8'));
  ok(bruto.version === 2, 'arquivo versionado');
  ok(Array.isArray(bruto.keys), 'keys é array');

  // `nextId` persistido e coerente: sempre à frente do maior id existente.
  const maiorId = bruto.keys.reduce((m, k) => Math.max(m, k.id || 0), 0);
  ok(typeof bruto.nextId === 'number' && bruto.nextId > maiorId,
     `nextId à frente dos ids existentes (${bruto.nextId} > ${maiorId})`);

  // Uma key nova é gravada em disco e relida (prova de persistência real).
  const nova = keys.criarKey({ owner: '5511977777777' });
  const relido = JSON.parse(fs.readFileSync(keys.KEYS_FILE, 'utf-8'));
  ok(relido.keys.some((k) => k.id === nova.id && k.key === nova.key), 'a key nova está no arquivo');
  ok(relido.nextId === nova.id + 1, 'o contador avançou e foi persistido');
});

// ============================================================================
// 3) 1 KEY = 1 USUÁRIO (a validação é no servidor)
// ============================================================================

await test('1 key = 1 usuário: o dono passa, outro é recusado', () => {
  const reg = keys.criarKey({ owner: '5511999999999' });

  const dono = keys.validarKey(reg.key, { botId: '5511999999999' });
  ok(dono.ok === true, 'o dono registrado é autorizado');

  // Mesmo sabendo a KEY, outro usuário é recusado.
  const outro = keys.validarKey(reg.key, { botId: '5511888888888' });
  ok(outro.ok === false && outro.motivo === 'dono_diferente', `outro usuário recusado (${outro.motivo})`);

  // Formas equivalentes de identidade (JID vs número) casam.
  const jid = keys.validarKey(reg.key, { botId: '5511999999999@s.whatsapp.net' });
  ok(jid.ok === true, 'JID do dono também é aceito');
});

await test('key revogada é recusada por validarKey', () => {
  const reg = keys.criarKey({ owner: '5511999999999' });
  keys.revogarPorId(reg.id);

  const r = keys.validarKey(reg.key, { botId: '5511999999999' });
  ok(r.ok === false && r.motivo === 'revogada', `recusada (${r.motivo})`);
});

await test('key inexistente/ausente é recusada', () => {
  ok(keys.validarKey('MTX-GHOST-00000000').motivo === 'inexistente', 'inexistente');
  ok(keys.validarKey('').motivo === 'ausente', 'vazia');
  ok(keys.validarKey(null).motivo === 'ausente', 'null');
});

await test('API recusa execução com key de outro dono (defesa no servidor)', () => {
  const reg = keys.criarKey({ owner: '5511999999999' });
  const contexto = { isGroup: true, botIsAdmin: true, sender: 'x@s.whatsapp.net', selectiveDistribution: true, undecryptableGroupMessage: true };

  const okDono = api.processarRequisicao({ key: reg.key, botId: '5511999999999', context: contexto });
  ok(okDono.status === 200 && okDono.body.actions.includes('ban_user'), 'dono executa');

  const outro = api.processarRequisicao({ key: reg.key, botId: '5511888888888', context: contexto });
  ok(outro.status === 403, `outro dono recebe 403 (${outro.status})`);
  ok(outro.body.actions === undefined, 'não devolve ações');
});

// ============================================================================
// 4) HEALTH CHECK (sem disparar ação real)
// ============================================================================

await test('health: online quando a API responde corretamente', async () => {
  const server = api.iniciarApi(0);
  await new Promise((r) => setTimeout(r, 120));
  const porta = server.address().port;

  const r = await health.verificarSaude(`http://127.0.0.1:${porta}`);
  ok(r.ok === true, `online (${r.tipo})`);
  ok(r.tipo === 'online', 'tipo online');
  ok(Boolean(r.versao), 'traz a versão da API');

  // O health NÃO expõe dado administrativo.
  const res = await fetch(`http://127.0.0.1:${porta}/api/antifantasma/health`);
  const corpo = await res.json();
  const texto = JSON.stringify(corpo);
  ok(!texto.includes('key'), 'health não menciona keys');
  ok(!texto.includes('owner'), 'health não menciona donos');
  ok(!texto.includes('total'), 'health não expõe contagem');

  await new Promise((r2) => server.close(r2));
});

await test('health: offline quando ninguém responde', async () => {
  const r = await health.verificarSaude('http://127.0.0.1:1');
  ok(r.ok === false, 'não ok');
  ok(r.tipo === 'offline', `tipo offline (${r.tipo})`);
});

await test('health: erro quando responde outra coisa', async () => {
  const http = await import('node:http');
  const server = http.createServer((req, res) => { res.writeHead(500).end('x'); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const porta = server.address().port;

  const r = await health.verificarSaude(`http://127.0.0.1:${porta}`);
  ok(r.ok === false && r.tipo === 'erro', `tipo erro (${r.tipo})`);

  await new Promise((r2) => server.close(r2));
});

await test('health: não confunde outro serviço com o nosso', async () => {
  const http = await import('node:http');
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, plugin: 'outro' }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const porta = server.address().port;

  const r = await health.verificarSaude(`http://127.0.0.1:${porta}`);
  ok(r.ok === false && r.detalhe === 'servico_diferente', `detecta outro serviço (${r.detalhe})`);

  await new Promise((r2) => server.close(r2));
});

await test('health: não dispara ação real do anti-fantasma', async () => {
  // A prova: o health é GET e não recebe contexto nem key — não há como o
  // núcleo ser chamado. Confirmamos que a rota não aceita POST com contexto.
  const server = api.iniciarApi(0);
  await new Promise((r) => setTimeout(r, 120));
  const porta = server.address().port;

  const res = await fetch(`http://127.0.0.1:${porta}/api/antifantasma/health`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: 'x', context: { isGroup: true, selectiveDistribution: true, undecryptableGroupMessage: true } }),
  });
  ok(res.status === 404, `health não aceita POST (${res.status})`);

  await new Promise((r2) => server.close(r2));
});

// ============================================================================
// 5) ARQUIVO ENTREGUE
// ============================================================================

await test('o arquivo entregue é o ADAPTADOR e não contém o núcleo', () => {
  const adaptador = fs.readFileSync(
    path.join(PROJECT, 'dados', 'src', 'antifantasma-cliente', 'antifantasma.js'),
    'utf-8'
  );

  // É o adaptador (tem a interface pública).
  ok(adaptador.includes('executar'), 'tem executar');
  ok(adaptador.includes('ativar'), 'tem ativar');
  ok(adaptador.includes('desativar'), 'tem desativar');
  ok(adaptador.includes('estaAtivo'), 'tem estaAtivo');

  // Não é o núcleo.
  // Ele relata sinais (trabalho dele) e conhece os NOMES das ações; o que não
  // pode conter é a DECISÃO: combinações, limiares ou o texto das decisões.
  const proibido = ['normalizeContext', 'decidir(', 'ataqueSeletivo', 'ja_punido', 'sem_ataque'];
  for (const p of proibido) ok(!adaptador.includes(p), `não contém "${p}"`);

  // O core existe separado e NÃO é enviado.
  const core = fs.readFileSync(path.join(PROJECT, 'dados', 'src', 'antifantasma', 'core.js'), 'utf-8');
  ok(core.includes('selectiveDistribution'), 'o núcleo (privado) tem a regra');
  ok(!adaptador.includes('core.js'), 'o adaptador não referencia o núcleo');
});

// ============================================================================
// 6) HANDLER REAL — autorização e fluxo
// ============================================================================

let grupoSeq = 0;
const fazerGrupo = (flags = {}) => {
  grupoSeq += 1;
  const jid = `1203635000000${String(grupoSeq).padStart(5, '0')}@g.us`;
  fs.writeFileSync(path.join(TMP_DB, 'grupos', `${jid}.json`), JSON.stringify({ groupName: 'G', ...flags }));
  return jid;
};

function makeNazu({ sent, groupJid, sender, comoAdmin = false, dono = false }) {
  return {
    sendMessage: async (jid, content, options) => {
      sent.push({ jid, content, options });
      return { key: { id: `SENT-${sent.length}` } };
    },
    user: { id: `${DONO.split('@')[0]}:5@s.whatsapp.net`, lid: DONO_LID, name: 'Lizzy' },
    onWhatsApp: async (jid) => [{ jid, exists: true, lid: jid.replace('@s.whatsapp.net', '@lid') }],
    signalRepository: { lidMapping: { getPNForLID: async () => null } },
    groupMetadata: async () => ({
      id: groupJid,
      subject: 'G',
      participants: [
        { id: DONO_LID, lid: DONO_LID, phoneNumber: DONO, admin: 'admin' },
        { id: sender, lid: sender, phoneNumber: '5511888888888@s.whatsapp.net', admin: comoAdmin ? 'admin' : null },
      ],
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

let senderSeq = 0;
async function rodar({ text, sender = null, adm = false, quoted = null, autorQuoted = null }) {
  senderSeq += 1;
  const groupJid = fazerGrupo();
  const quem = sender || (adm ? `22200000${String(senderSeq).padStart(5, '0')}@lid` : `33300000${String(senderSeq).padStart(5, '0')}@lid`);
  const sent = [];
  const nazu = makeNazu({ sent, groupJid, sender: quem, comoAdmin: adm });
  const contextInfo = { remoteJid: groupJid };
  if (quoted) {
    contextInfo.quotedMessage = quoted;
    contextInfo.participant = autorQuoted || '5511888888888@s.whatsapp.net';
    contextInfo.stanzaId = 'QUOTED-ID';
  }
  await handleMessage(nazu, {
    key: { remoteJid: groupJid, fromMe: false, id: `M-${Math.random().toString(36).slice(2, 9)}`, participant: quem },
    message: { extendedTextMessage: { text, contextInfo } },
    messageTimestamp: 1757900000,
    pushName: 'Tester',
  }, null, new Map(), null);

  const texto = sent.map((s) => textoDoEnvio(s.content)).filter(Boolean).join('\n');
  const doc = sent.find((s) => s.content?.document) || null;
  return { sent, texto, doc, nazu };
}

/** Executa como o DONO de verdade (fromMe), que é o caminho do painel. */
async function rodarComoDono(params) {
  const groupJid = fazerGrupo();
  const sent = [];
  const nazu = makeNazu({ sent, groupJid, sender: DONO_LID, comoAdmin: true });
  const contextInfo = { remoteJid: groupJid };
  if (params.quoted) {
    contextInfo.quotedMessage = params.quoted;
    contextInfo.participant = params.autorQuoted || '5511888888888@s.whatsapp.net';
    contextInfo.stanzaId = 'QUOTED-ID';
  }
  await handleMessage(nazu, {
    key: { remoteJid: groupJid, fromMe: true, id: `M-${Math.random().toString(36).slice(2, 9)}`, participant: DONO },
    message: { extendedTextMessage: { text: params.text, contextInfo } },
    messageTimestamp: 1757900000,
    pushName: 'Dono',
  }, null, new Map(), null);

  const texto = sent.map((s) => textoDoEnvio(s.content)).filter(Boolean).join('\n');
  const doc = sent.find((s) => s.content?.document) || null;
  return { sent, texto, doc };
}

await test('handler: usuário comum é BLOQUEADO nos três comandos', async () => {
  const a = await rodar({ text: '!ghostcmd' });
  includes(a.texto, 'apenas para o dono', 'ghostcmd bloqueado');

  const b = await rodar({ text: '!addghostcmd', quoted: { conversation: 'oi' } });
  includes(b.texto, 'apenas para o dono', 'addghostcmd bloqueado');
  ok(!b.doc, 'não entrega o arquivo');

  const c = await rodar({ text: '!delghostcmd 1' });
  includes(c.texto, 'apenas para o dono', 'delghostcmd bloqueado');
});

await test('handler: !ghostcmd mostra status, keys e contagem (como dono)', async () => {
  const r = await rodarComoDono({ text: '!ghostcmd' });

  includes(r.texto, 'PLUGIN FANTASMA', 'título');
  includes(r.texto, 'Servidor:', 'estado do servidor');
  includes(r.texto, 'API:', 'estado da API');
  includes(r.texto, 'CHAVES', 'lista de chaves');
  includes(r.texto, 'Total geradas:', 'total');
  includes(r.texto, 'Ativas:', 'ativas');
  includes(r.texto, 'Revogadas:', 'revogadas');
  includes(r.texto, 'ATIVA', 'mostra status ativa');
  includes(r.texto, 'REVOGADA', 'mostra status revogada');
});

await test('handler: !ghostcmd NÃO mostra a key inteira', async () => {
  const registros = keys.listarKeys();
  const r = await rodarComoDono({ text: '!ghostcmd' });

  for (const reg of registros) {
    notIncludes(r.texto, reg.key, `key #${reg.id} não pode aparecer inteira`);
  }
});

await test('handler: !addghostcmd sem alvo pede para responder alguém', async () => {
  const r = await rodarComoDono({ text: '!addghostcmd' });
  includes(r.texto, 'Responda', 'explica o que fazer');
  ok(!r.doc, 'não entrega arquivo sem alvo');
});

await test('handler: !addghostcmd gera key, vincula e envia tutorial + arquivo', async () => {
  const antes = keys.estatisticas();
  const alvo = '5511999999999@s.whatsapp.net';

  const r = await rodarComoDono({
    text: '!addghostcmd',
    quoted: { extendedTextMessage: { text: 'quero o plugin' } },
    autorQuoted: alvo,
  });

  const depois = keys.estatisticas();
  ok(depois.total === antes.total + 1, `criou exatamente 1 key (${antes.total} -> ${depois.total})`);

  // O comando cria exatamente um registro, com o id = proximoId anterior.
  const nova = keys.buscarPorId(antes.proximoId);
  ok(Boolean(nova), `a key nova é a #${antes.proximoId}`);
  ok(nova.id === antes.proximoId, `id sequencial sem pular (${nova.id})`);

  // O handler normaliza o alvo para LID; comparamos pelo NUMERO, que é o
  // que identifica a pessoa de verdade.
  const numero = alvo.split('@')[0];
  ok(String(nova.owner).split('@')[0] === numero, `vinculada ao usuário respondido (${nova.owner})`);

  includes(r.texto, 'PLUGIN FANTASMA', 'tutorial tem título');
  includes(r.texto, String(nova.key), 'entrega a key ao dono');
  includes(r.texto, 'antifantasma.js', 'explica onde colocar o arquivo');
  includes(r.texto, "require('./antifantasma')", 'explica o import');
  includes(r.texto, "case 'antifantasma'", 'dá o exemplo de case');
  includes(r.texto, 'antiFantasma.ativar()', 'explica ativar');
  includes(r.texto, 'antiFantasma.desativar()', 'explica desativar');
  includes(r.texto, 'EXEMPLO', 'deixa claro que o nome da case é livre');

  // O bloco final tem de ser AUTOSSUFICIENTE: require + case juntos, para o
  // usuário só colar (era o pedido: "só precise colocar a pasta no src e
  // adicionar o código da case no index").
  const fimTutorial = r.texto.slice(r.texto.indexOf('100% feita e funcional'));
  includes(fimTutorial, "require('./antifantasma')", 'bloco final traz o require');
  includes(fimTutorial, "case 'antifantasma'", 'bloco final traz a case');
  includes(fimTutorial, 'antiFantasma.ativar()', 'bloco final alterna o estado');
  includes(fimTutorial, 'antiFantasma.desativar()', 'bloco final alterna o estado');
  notIncludes(fimTutorial, 'groupData.antiinvi =', 'não escreve mais no estado antigo do grupo');

  ok(Boolean(r.doc), 'enviou o arquivo');
  ok(r.doc.content.fileName === 'antifantasma.js', `arquivo correto (${r.doc.content.fileName})`);
});

await test('handler: o arquivo enviado vem configurado e sem o núcleo', async () => {
  const alvo = '5511988888888@s.whatsapp.net';
  const r = await rodarComoDono({
    text: '!addghostcmd',
    quoted: { extendedTextMessage: { text: 'quero' } },
    autorQuoted: alvo,
  });

  const conteudo = String(r.doc.content.document);
  ok(conteudo.includes('executar'), 'é o adaptador');
  ok(!conteudo.includes('normalizeContext') && !conteudo.includes('decidir('),
     'não tem a decisão interna');
  ok(!/selectiveDistribution\s*&&/.test(conteudo), 'não combina sinais (a regra é do servidor)');
  ok(!conteudo.includes('core.js'), 'não referencia o núcleo');

  // Veio configurado: a key do registro tem de estar no arquivo.
  // O handler normaliza o alvo para LID; comparamos pelo NUMERO, que e o
  // que identifica a pessoa de verdade.
  const numero = alvo.split('@')[0];
  const nova = keys.listarKeys().find((k) => String(k.owner).split('@')[0] === numero && k.status === 'active');
  ok(conteudo.includes(nova.key), 'a key foi configurada no arquivo');
  ok(conteudo.includes(numero), 'o botId foi configurado no arquivo');
  ok(!/const API_URL = 'https:\/\/api\.exemplo\.com/.test(conteudo), 'a URL placeholder foi substituída');
});

await test('handler: duas keys, dois usuários — sem compartilhamento', async () => {
  const a = await rodarComoDono({ text: '!addghostcmd', quoted: { conversation: 'x' }, autorQuoted: '5511911111111@s.whatsapp.net' });
  const b = await rodarComoDono({ text: '!addghostcmd', quoted: { conversation: 'x' }, autorQuoted: '5511922222222@s.whatsapp.net' });

  const ka = keys.listarKeys().find((k) => String(k.owner).split('@')[0] === '5511911111111' && k.status === 'active');
  const kb = keys.listarKeys().find((k) => String(k.owner).split('@')[0] === '5511922222222' && k.status === 'active');

  ok(ka.id !== kb.id, 'ids diferentes');
  ok(ka.key !== kb.key, 'keys diferentes');

  // A key do A não autoriza o B.
  const cruzado = keys.validarKey(ka.key, { botId: '5511922222222@s.whatsapp.net' });
  ok(cruzado.ok === false && cruzado.motivo === 'dono_diferente', 'key do A recusada para o B');
});

await test('handler: !delghostcmd revoga e avisa', async () => {
  // Cria o próprio estado: os testes de renumeração zeram a lista, então a #2
  // pode não existir mais quando este roda.
  keys.apagarTodas();
  keys.criarKey({ owner: '5511911111111' });
  keys.criarKey({ owner: '5511922222222' });

  const r = await rodarComoDono({ text: '!delghostcmd 2' });
  includes(r.texto, 'revogada com sucesso', 'confirma a revogação');
  includes(r.texto, 'REVOGADA', 'mostra o status');
  ok(keys.buscarPorId(2).status === 'revoked', 'persistiu como revogada');
});

await test('handler: !delghostcmd em key já revogada avisa', async () => {
  // A #2 já foi revogada no teste anterior; garante o estado de qualquer forma.
  if (keys.buscarPorId(2)?.status !== 'revoked') keys.revogarPorId(2);
  const r = await rodarComoDono({ text: '!delghostcmd 2' });
  includes(r.texto, 'já está revogada', 'avisa que já estava revogada');
});

await test('handler: !delghostcmd com número inexistente avisa', async () => {
  const r = await rodarComoDono({ text: '!delghostcmd 999' });
  includes(r.texto, 'não encontrada', 'avisa que não existe');
});

await test('handler: !delghostcmd sem número explica o uso', async () => {
  const r = await rodarComoDono({ text: '!delghostcmd' });
  includes(r.texto, 'delghostcmd', 'mostra o uso');
});

await test('handler: !delghostcmd alt apaga TODAS as keys', async () => {
  // Cria as próprias keys (ativas e revogadas) — independente da ordem.
  keys.apagarTodas();
  const k1 = keys.criarKey({ owner: '5511911111111' });
  keys.criarKey({ owner: '5511922222222' });
  keys.revogarPorId(k1.id);

  const antes = keys.estatisticas();
  ok(antes.total >= 2, `há keys ativas e revogadas (${antes.total})`);
  ok(antes.ativas >= 1 && antes.revogadas >= 1, 'mistura de ativas e revogadas');

  const r = await rodarComoDono({ text: '!delghostcmd alt' });

  includes(r.texto, 'Todas as keys foram apagadas', 'confirma a limpeza total');
  includes(r.texto, 'Removidas:', 'informa quantas');
  ok(keys.listarKeys().length === 0, 'nenhuma key restante');
  ok(keys.estatisticas().total === 0, 'contagem zerada');
});

await test('handler: !delghostcmd alt reinicia a numeração em #1', async () => {
  keys.criarKey({ owner: '5511944444444' });
  keys.criarKey({ owner: '5511955555555' });
  await rodarComoDono({ text: '!delghostcmd alt' });

  const nova = keys.criarKey({ owner: '5511933333333' });
  ok(nova.id === 1, `a nova key volta a ser #1 (${nova.id})`);
});

await test('handler: !delghostcmd alt avisa quando não há nada', async () => {
  // Garante registro vazio: este teste não pode depender do que veio antes.
  keys.apagarTodas();
  const r = await rodarComoDono({ text: '!delghostcmd alt' });
  includes(r.texto, 'Removidas: 0', 'informa que removeu zero');
});

await test('menudono: categoria PLUGIN FANTASMA com os três comandos', async () => {
  const src = fs.readFileSync(path.join(PROJECT, 'dados/src/menus/menudono.js'), 'utf-8');
  includes(src, 'PLUGIN FANTASMA', 'categoria existe');

  const mod = await import(new URL('../dados/src/menus/menudono.js', import.meta.url).href);
  const t = String(await (mod.default ?? mod)('!', 'Lizzy', 'Teste'));
  includes(t, 'PLUGIN FANTASMA', 'renderiza a categoria');
  includes(t, '!ghostcmd', 'lista ghostcmd');
  includes(t, '!addghostcmd', 'lista addghostcmd');
  includes(t, '!delghostcmd', 'lista delghostcmd');
  ok((t.match(/PLUGIN FANTASMA/g) || []).length === 1, 'não duplica a categoria');
});

// ============================================================================
// APAGAR TUDO (por último: zera o registro e não deve afetar outros testes)
// ============================================================================

await test('keys: apagarTodas limpa tudo e a numeração VOLTA para #1', () => {
  // Cria o próprio estado — não depende do que veio antes.
  keys.apagarTodas();
  keys.criarKey({ owner: '5511955555555' });
  const k = keys.criarKey({ owner: '5511966666666' });
  keys.revogarPorId(k.id);

  const antes = keys.estatisticas();
  ok(antes.total === 2, `há keys para apagar (${antes.total})`);
  ok(antes.ativas === 1 && antes.revogadas === 1, 'uma ativa e uma revogada');

  const r = keys.apagarTodas();
  ok(r.removidas === antes.total, `removeu todas (${r.removidas})`);
  ok(keys.listarKeys().length === 0, 'lista ficou vazia');
  ok(keys.estatisticas().total === 0, 'contagem zerada');
  ok(r.proximoId === 1, `próximoId volta a 1 (${r.proximoId})`);

  // Depois do alt, a próxima key é #1 de novo.
  const nova = keys.criarKey({ owner: '5511999999999' });
  ok(nova.id === 1, `a nova key volta a ser #1 (${nova.id})`);
});

await test('keys: apagarTodas em registro já vazio não quebra', () => {
  keys.apagarTodas();
  const r = keys.apagarTodas();
  ok(r.removidas === 0, 'zero removidas');
  ok(r.proximoId === 1, `proximoId 1 (${r.proximoId})`);
});

// ============================================================================

const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log('\n════════════════════════════════════════');
console.log(`RESULTADO: ${RESULTS.length} testes | ${totalOk} asserções ok | ${totalFail} falhas`);
console.log('════════════════════════════════════════');

fs.rmSync(TMP_DB, { recursive: true, force: true });

if (totalFail > 0) {
  console.log('\nFALHAS:');
  for (const r of RESULTS) if (r.failed) for (const e of r.errors) console.log(`- [${r.name}] ${e}`);
  process.exit(1);
}
console.log('✅ TODOS OS TESTES PASSARAM');
process.exit(0);