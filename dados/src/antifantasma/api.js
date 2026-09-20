/**
 * AntiFantasma — API PRIVADA (servidor).
 *
 * Recebe o contexto do adaptador que roda na bot do usuário, valida a KEY,
 * chama o núcleo privado (`core.js`) e devolve SOMENTE a ação abstrata a
 * executar. Nunca devolve código, algoritmo, regra ou o conteúdo do núcleo.
 *
 * Não existe endpoint que sirva o `core.js` — nem `/core.js`, nem `/source`,
 * nem `/code`. Além do processamento, existe um `/health` proposital: é o que o
 * `!ghostcmd` usa para saber se a API está de pé **sem** disparar nenhuma ação
 * real do anti-fantasma.
 *
 * Dependência: apenas `node:http` nativo (sem framework, sem pacote novo).
 */

import http from 'node:http';

import { resumoParaLog, endpointAntiFantasma } from '../utils/publicUrl.js';
import { decidir, mensagemDoMotivo, ACTIONS } from './core.js';
import { validarKey, PLUGIN_ID, KEYS_FILE } from './keys.js';

// Tamanho máximo do corpo aceito. O contexto é pequeno; um limite evita que
// uma requisição enorme consuma memória.
const MAX_BODY_BYTES = 8 * 1024;
const VERSAO_API = '1';


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
 * @param {{key?: string, botId?: string, context?: object}} entrada
 * @returns {{status: number, body: object}}
 */
export function processarRequisicao(entrada) {
  const { key, botId, context } = entrada && typeof entrada === 'object' ? entrada : {};

  // `botId` viaja junto para a regra "1 key = 1 usuário": quem tem a key mas não
  // é o dono registrado é recusado aqui, no servidor.
  const validacao = validarKey(key, { botId });
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
    const rota = (req.url || '').split('?')[0];

    // Health check do `!ghostcmd`. Não recebe key, não toca no núcleo e não
    // executa ação nenhuma — serve só para dizer que a API está de pé.
    // Não expõe contagem de keys, donos nem qualquer dado administrativo.
    if (req.method === 'GET' && (rota === '/api/antifantasma/health' || rota === '/health')) {
      responder(res, 200, {
        success: true,
        plugin: PLUGIN_ID,
        version: VERSAO_API,
        uptime: Math.floor(process.uptime()),
      });
      return;
    }

    // Qualquer outro caminho responde 404 — inclusive tentativas de buscar o
    // código-fonte do núcleo.
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
    // Loga a URL pública detectada automaticamente — é ela que vai no adaptador
    // do usuário. Se a detecção falhar, aponta a variável para definir à mão.
    const resumo = resumoParaLog();
    console.log(`[ANTIFANTASMA] API ouvindo na porta ${port}`);
    if (resumo) console.log(resumo.texto);
    else console.log('   (defina ANTIFANTASMA_PUBLIC_URL para registrar a URL pública)');
  });

  return server;
}

/** Endpoint público sugerido para colocar no adaptador do usuário. */
export function endpointPublico(env = process.env) {
  return endpointAntiFantasma(env);
}

export { ACTIONS, PLUGIN_ID, KEYS_FILE };