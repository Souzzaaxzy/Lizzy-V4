/**
 * AntiFantasma — API PRIVADA (servidor).
 *
 * Recebe o contexto do adaptador que roda na bot do usuário, valida a KEY,
 * chama o núcleo privado (`core.js`) e devolve SOMENTE a ação abstrata a
 * executar. Nunca devolve código, algoritmo, regra ou o conteúdo do núcleo.
 *
 * Não existe endpoint que sirva o `core.js` — nem `/core.js`, nem `/source`,
 * nem `/code`. A única rota é o processamento, e ela responde apenas JSON com
 * o resultado.
 *
 * Dependência: apenas `node:http` nativo (sem framework, sem pacote novo).
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { DATABASE_DIR } from '../utils/paths.js';
import { decidir, mensagemDoMotivo, ACTIONS } from './core.js';

const KEYS_FILE = path.join(DATABASE_DIR, 'antifantasma', 'keys.json');
const PLUGIN_ID = 'antifantasma';

// Tamanho máximo do corpo aceito. O contexto é pequeno; um limite evita que
// uma requisição enorme consuma memória.
const MAX_BODY_BYTES = 8 * 1024;

// ───────────────────────────────────────────────────────────────────────────
// KEYS — persistência mínima (JSON), sem sistema de permissões genérico.
// ───────────────────────────────────────────────────────────────────────────

function lerKeys() {
  try {
    const bruto = fs.readFileSync(KEYS_FILE, 'utf-8');
    const dados = JSON.parse(bruto);
    return dados && typeof dados === 'object' ? dados : {};
  } catch {
    return {};
  }
}

function gravarKeys(keys) {
  fs.mkdirSync(path.dirname(KEYS_FILE), { recursive: true });
  // Escrita atômica: um tmp único por chamada evita que duas gravações
  // concorrentes pisem uma na outra (mesmo cuidado do writeJsonFile do bot).
  const tmp = `${KEYS_FILE}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(keys, null, 2));
  fs.renameSync(tmp, KEYS_FILE);
}

/**
 * Valida uma KEY e devolve o motivo quando negada.
 *
 * A verificação é feita AQUI, no servidor — nunca no cliente. Um
 * `if (authorized)` local seria burlável, já que o usuário tem o próprio
 * adaptador.
 *
 * @param {string} key
 * @returns {{ok: boolean, motivo?: string, registro?: object}}
 */
export function validarKey(key) {
  if (typeof key !== 'string' || !key.trim()) return { ok: false, motivo: 'ausente' };
  const keys = lerKeys();
  const registro = keys[key.trim()];
  if (!registro) return { ok: false, motivo: 'inexistente' };
  if (registro.plugin !== PLUGIN_ID) return { ok: false, motivo: 'plugin_errado' };
  if (registro.active !== true) return { ok: false, motivo: 'revogada' };
  return { ok: true, registro };
}

/** Cria uma KEY individual para uma instalação. */
export function criarKey(descricao = '') {
  const key = `MTX-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const keys = lerKeys();
  keys[key] = {
    plugin: PLUGIN_ID,
    active: true,
    criadaEm: new Date().toISOString(),
    descricao: String(descricao).slice(0, 120),
  };
  gravarKeys(keys);
  return key;
}

/** Revoga uma KEY. A API passa a recusar as execuções dela. */
export function revogarKey(key) {
  const keys = lerKeys();
  if (!keys[key]) return false;
  keys[key].active = false;
  keys[key].revogadaEm = new Date().toISOString();
  gravarKeys(keys);
  return true;
}

// ───────────────────────────────────────────────────────────────────────────
// HTTP
// ───────────────────────────────────────────────────────────────────────────

function responder(res, status, corpo) {
  const payload = JSON.stringify(corpo);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    // Nada aqui deve ser cacheado.
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const partes = [];
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error('corpo_grande'));
        req.destroy();
        return;
      }
      partes.push(chunk);
    });
    req.on('end', () => {
      try {
        const texto = Buffer.concat(partes).toString('utf-8');
        resolve(texto ? JSON.parse(texto) : {});
      } catch {
        reject(new Error('json_invalido'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Processa uma requisição de execução.
 *
 * Separado do servidor HTTP para poder ser testado sem abrir porta.
 *
 * @param {{key?: string, context?: object}} entrada
 * @returns {{status: number, body: object}}
 */
export function processarRequisicao(entrada) {
  const { key, context } = entrada && typeof entrada === 'object' ? entrada : {};

  const validacao = validarKey(key);
  if (!validacao.ok) {
    // Nunca executar o núcleo com KEY inválida.
    return { status: 403, body: { success: false, error: 'key_invalida' } };
  }

  let decisao;
  try {
    decisao = decidir(context);
  } catch (e) {
    // Erro interno: o detalhe fica no log do servidor, nunca na resposta.
    console.error('[ANTIFANTASMA] erro no núcleo:', e?.message || e);
    return { status: 500, body: { success: false, error: 'interno' } };
  }

  if (!decisao.actions.length) {
    // Nada a fazer: resposta de sucesso sem ação. Não revela o motivo.
    return { status: 200, body: { success: true, action: null, actions: [] } };
  }

  // O importante: a resposta carrega apenas NOMES de ação (e o motivo, para o
  // adaptador montar o aviso). Nenhum código, nenhuma regra, nenhum caminho.
  return {
    status: 200,
    body: {
      success: true,
      action: decisao.actions[0],
      actions: decisao.actions,
      notice: mensagemDoMotivo(decisao.reason),
    },
  };
}

/**
 * Inicia o servidor da API.
 *
 * Só deve ser chamado quando o administrador quiser expor a API (ex.: quando
 * `ANTIFANTASMA_PORT` está definida). Em caso de falha, não derruba o bot.
 *
 * @param {number} [port]
 * @returns {import('node:http').Server|null}
 */
export function iniciarApi(port) {
  // Sem argumento: só sobe quando `ANTIFANTASMA_PORT` está definida e válida.
  // Assim o boot padrão do bot não abre porta nenhuma.
  if (port === undefined) {
    const doEnv = Number(process.env.ANTIFANTASMA_PORT);
    if (!process.env.ANTIFANTASMA_PORT || Number.isNaN(doEnv) || doEnv <= 0) return null;
    port = doEnv;
  }

  // Com argumento, `0` é válido de propósito (porta efêmera, usada nos testes).
  const n = Number(port);
  if (Number.isNaN(n) || n < 0) return null;
  port = n;

  const server = http.createServer(async (req, res) => {
    // Qualquer caminho que não seja o de processamento responde 404 — inclusive
    // tentativas de buscar o código-fonte do núcleo.
    const rota = (req.url || '').split('?')[0];
    if (req.method === 'POST' && rota === '/api/antifantasma/exec') {
      let entrada;
      try {
        entrada = await lerCorpo(req);
      } catch (e) {
        responder(res, 400, { success: false, error: 'requisicao_invalida' });
        return;
      }
      const { status, body } = processarRequisicao(entrada);
      responder(res, status, body);
      return;
    }

    responder(res, 404, { success: false, error: 'nao_encontrado' });
  });

  server.on('error', (e) => {
    console.error('[ANTIFANTASMA] falha ao iniciar a API:', e?.message || e);
  });

  server.listen(port, () => {
    console.log(`[ANTIFANTASMA] API ouvindo na porta ${port}`);
  });

  return server;
}

export { ACTIONS, PLUGIN_ID, KEYS_FILE };