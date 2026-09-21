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

import { resumoParaLog, endpointAntiFantasma, escolherPorta } from '../utils/publicUrl.js';
import { decidir, mensagemDoMotivo, ACTIONS } from './core.js';
import { validarKey, PLUGIN_ID, KEYS_FILE } from './keys.js';
import { lerUrlManual } from './urlManual.js';

// Tamanho máximo do corpo aceito. O contexto é pequeno; um limite evita que
// uma requisição enorme consuma memória.
const MAX_BODY_BYTES = 8 * 1024;
const VERSAO_API = '1';

/**
 * Porta em que ESTA API está ouvindo, quando está no ar.
 *
 * Guardada em módulo porque a URL pública depende dela: neste runtime cada porta
 * publicada tem o seu subdomínio (`work-1`, `work-2`), então quem for montar o
 * endereço precisa usar a porta REAL — não a que está na variável de ambiente.
 */
let portaAtual = 0;

/** Porta em uso pela API. `0` quando ela não subiu. */
export function portaEmUso() {
  return portaAtual;
}

/** Define a porta em uso. Usado internamente pelo `iniciarApi`. */
export function definirPortaEmUso(porta) {
  const n = Number(porta);
  portaAtual = Number.isFinite(n) && n > 0 ? n : 0;
  return portaAtual;
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
    //
    // A resposta leva o MOTIVO da recusa (ausente/inexistente/revogada/
    // dono_diferente). Sem ele, "KEY inválida" cobre quatro causas diferentes e
    // o problema fica indiagnosticável no bot do usuário — foi exatamente o que
    // aconteceu no campo. O motivo é um rótulo curto, não a key, nem o dono,
    // nem nada do núcleo.
    return {
      status: 403,
      body: {
        success: false,
        error: 'key_invalida',
        reason: validacao.motivo || 'desconhecido',
      },
    };
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
  // Sem argumento: a porta é ESCOLHIDA automaticamente — `ANTIFANTASMA_PORT` se
  // definida, senão a primeira porta publicada do runtime (WORKER_1/WORKER_2,
  // que têm subdomínio HTTPS próprio). Sem nenhuma, a API não sobe.
  if (port === undefined) {
    port = escolherPorta();
    if (!port) return null;
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
    // A porta REAL em uso (quando passamos 0, o SO escolhe) é a que determina o
    // subdomínio. Registramos ela no módulo para que o `!ghostcmd` e o
    // `!addghostcmd` montem a URL certa — senão anunciariam a porta errada e o
    // adaptador do usuário falaria com outro serviço.
    const portaReal = server.address()?.port ?? port;
    definirPortaEmUso(portaReal);

    // A URL gravada à mão (`!seturlghost`) vence a detecção automática — por
    // isso é passada explicitamente, e não deixada para o ambiente.
    const resumo = resumoParaLog(process.env, { porta: portaReal, urlManual: lerUrlManual() });
    console.log(`[ANTIFANTASMA] API ouvindo na porta ${portaReal}`);
    if (resumo) console.log(resumo.texto);
    else console.log('   (defina ANTIFANTASMA_PUBLIC_URL ou use !seturlghost para registrar a URL pública)');
  });

  server.on('close', () => {
    definirPortaEmUso(0);
  });

  return server;
}

/** Endpoint público sugerido para colocar no adaptador do usuário. */
export function endpointPublico(env = process.env, opts = {}) {
  return endpointAntiFantasma(env, opts);
}

export { ACTIONS, PLUGIN_ID, KEYS_FILE };