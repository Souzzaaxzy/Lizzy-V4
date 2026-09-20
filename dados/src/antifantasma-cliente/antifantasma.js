/**
 * AntiFantasma — ADAPTADOR (arquivo entregue ao usuário).
 *
 * Este é o ÚNICO arquivo do plugin que o usuário recebe. Ele funciona como um
 * cliente mínimo: guarda o estado local de ativação, manda o contexto para a API
 * e executa as ações que a API autorizar, através do `sock`.
 *
 * Ele NÃO contém o algoritmo, as regras, os critérios de detecção nem a lógica
 * de decisão — tudo isso permanece no servidor.
 *
 * ─── Como usar (o usuário escolhe os nomes) ────────────────────────────────
 *
 *   const antiFantasma = require('./antifantasma');
 *
 *   // Ligue uma vez, no início (é o que mantém a proteção ativa por mensagem):
 *   antiFantasma.iniciar(sock);
 *
 *   // Cases livres — os nomes são escolha sua:
 *   case 'afon':    antiFantasma.ativar();    await reply('🟢 Ativado'); break;
 *   case 'afoff':   antiFantasma.desativar(); await reply('🔴 Desativado'); break;
 *   case 'afstatus':await reply(antiFantasma.estaAtivo() ? 'Ligado' : 'Desligado'); break;
 *
 * A KEY e a URL da API ficam na configuração abaixo.
 */

'use strict';

// ───────────────────────────────────────────────────────────────────────────
// CONFIGURAÇÃO DA INSTALAÇÃO
// ───────────────────────────────────────────────────────────────────────────

/** URL da API do AntiFantasma. Em produção, use HTTPS. */
const API_URL = 'https://api.exemplo.com/api/antifantasma/exec';

/** KEY individual desta instalação. */
const KEY = 'MTX-000000';

/**
 * Identificador desta instalação (o número da sua bot).
 *
 * A API vincula cada KEY a UM dono e recusa quem não for ele — mesmo que a KEY
 * vaze. Este valor é o que a Lizzy usou quando gerou a sua KEY.
 */
const BOT_ID = '5500000000000';

// ───────────────────────────────────────────────────────────────────────────
// ESTADO LOCAL (ativar/desativar) — controlado só pelo usuário
// ───────────────────────────────────────────────────────────────────────────

let ativo = false;

/** Ativa o AntiFantasma nesta bot. */
function ativar() {
  ativo = true;
  return ativo;
}

/** Desativa o AntiFantasma nesta bot. */
function desativar() {
  ativo = false;
  return ativo;
}

/** O AntiFantasma está ativo nesta bot? */
function estaAtivo() {
  return ativo === true;
}

// ───────────────────────────────────────────────────────────────────────────
// COMUNICAÇÃO COM A API
// ───────────────────────────────────────────────────────────────────────────

/**
 * Envia o contexto para a API e devolve a resposta.
 *
 * Usa `node:https`/`node:http` nativos de propósito: este arquivo roda na bot do
 * usuário, que não deve precisar instalar nada.
 */
function pedir(contexto) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(API_URL);
    } catch {
      reject(new Error('url_invalida'));
      return;
    }

    const lib = url.protocol === 'https:' ? require('node:https') : require('node:http');
    // `botId` identifica esta instalação. A API confere se ele é o dono
    // registrado da KEY — é o que impede alguém usar a KEY de outra pessoa.
    const corpo = JSON.stringify({ key: KEY, botId: BOT_ID, context: contexto });

    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(corpo),
        },
        timeout: 8000,
      },
      (res) => {
        let texto = '';
        res.setEncoding('utf-8');
        res.on('data', (d) => { texto += d; });
        res.on('end', () => {
          let json = {};
          try { json = texto ? JSON.parse(texto) : {}; } catch { /* resposta ilegível */ }
          resolve({ status: res.statusCode || 0, body: json });
        });
      }
    );

    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
    req.end(corpo);
  });
}

/** Erros que o usuário pode entender (sem stack trace nem detalhe interno). */
const MENSAGENS = {
  indisponivel: '⚠️ Serviço AntiFantasma indisponível.',
  key: '❌ KEY do AntiFantasma inválida ou revogada.',
  interno: '❌ Não foi possível processar o AntiFantasma.',
};

// ───────────────────────────────────────────────────────────────────────────
// EXECUÇÃO DAS AÇÕES (o adaptador só sabe EXECUTAR; o critério fica no servidor)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Executa uma ação autorizada pela API, através do `sock`.
 *
 * O adaptador conhece apenas o vocabulário de ações. Ele não sabe, e não
 * precisa saber, quando cada uma é escolhida.
 */
async function executarAcao(acao, ctx) {
  const { sock, grupo, autor } = ctx;

  switch (acao) {
    case 'close_group':
      await sock.groupSettingUpdate(grupo, 'announcement');
      return true;
    case 'ban_user':
      await sock.groupParticipantsUpdate(grupo, [autor], 'remove');
      return true;
    case 'open_group':
      await sock.groupSettingUpdate(grupo, 'not_announcement');
      return true;
    default:
      return false;
  }
}

/**
 * Roda uma mensagem observada pelo AntiFantasma.
 *
 * Chame isto para cada mensagem que você quer que o AntiFantasma avalie. Se
 * estiver desativado, NADA é enviado à API.
 *
 * @param {object} params
 * @param {object} params.sock socket do Baileys
 * @param {string} params.grupo JID do grupo
 * @param {string} [params.autor] quem enviou a mensagem observada
 * @param {object} [params.contexto] sinais observados (o servidor decide o que fazer)
 * @param {Function} [params.reply] função de resposta do seu bot
 * @returns {Promise<{ok: boolean, acoes: string[], erro?: string}>}
 */
async function executar(params = {}) {
  if (!estaAtivo()) {
    return { ok: true, acoes: [] };
  }

  const sock = params.sock;
  const grupo = params.grupo || params.from;
  const autor = params.autor || params.sender;
  const reply = typeof params.reply === 'function' ? params.reply : null;

  if (!sock || !grupo) {
    return { ok: false, acoes: [], erro: MENSAGENS.interno };
  }

  let resposta;
  try {
    resposta = await pedir(params.contexto || {});
  } catch {
    if (reply) await reply(MENSAGENS.indisponivel).catch(() => {});
    return { ok: false, acoes: [], erro: MENSAGENS.indisponivel };
  }

  // KEY recusada pela API (ausente, inexistente, revogada ou de outro plugin).
  if (resposta.status === 401 || resposta.status === 403) {
    if (reply) await reply(MENSAGENS.key).catch(() => {});
    return { ok: false, acoes: [], erro: MENSAGENS.key };
  }

  if (resposta.status !== 200 || !resposta.body || resposta.body.success !== true) {
    if (reply) await reply(MENSAGENS.interno).catch(() => {});
    return { ok: false, acoes: [], erro: MENSAGENS.interno };
  }

  // A API manda uma sequência (ex.: fechar -> banir -> reabrir). Executamos em
  // ordem; se uma falhar, tentamos as seguintes de qualquer forma para não
  // deixar o grupo fechado por causa de um erro no meio.
  const acoes = Array.isArray(resposta.body.actions)
    ? resposta.body.actions.filter((a) => typeof a === 'string')
    : (typeof resposta.body.action === 'string' ? [resposta.body.action] : []);

  const executadas = [];
  for (const acao of acoes) {
    try {
      const fez = await executarAcao(acao, { sock, grupo, autor });
      if (fez) executadas.push(acao);
    } catch { /* segue para a próxima */ }
  }

  // Aviso público, quando a API pediu. O texto vem do servidor.
  if (typeof resposta.body.notice === 'string' && resposta.body.notice && executadas.includes('ban_user')) {
    try {
      await sock.sendMessage(grupo, {
        text: `❌ @${String(autor || '').split('@')[0]} ${resposta.body.notice.replace(/^❌\s*/, '')}`,
        mentions: autor ? [autor] : [],
      });
    } catch { /* aviso é best-effort */ }
  }

  return { ok: true, acoes: executadas };
}

/**
 * Exportação.
 *
 * Este arquivo é CommonJS (é o que o `require('./antifantasma')` espera). Isso
 * cobre as duas formas de uso sem o usuário mexer em nada:
 *
 *   - bot CommonJS:  const antiFantasma = require('./antifantasma');
 *   - bot ESM:       import antiFantasma from './antifantasma.js';  (o Node
 *                    entrega este `module.exports` como export default)
 *
 * Exceção: se o `package.json` do bot tiver `"type": "module"`, o Node trata
 * arquivos `.js` como ESM e este arquivo precisa ser renomeado para
 * `antifantasma.cjs`. Nada mais muda — o `require`/`import` continuam iguais.
 */
module.exports = {
  // Estado local (livre para o usuário usar em qualquer case)
  ativar,
  desativar,
  estaAtivo,
  // Processamento
  executar,
  // Conveniência: liga a proteção e devolve o mesmo objeto
  iniciar(sock) {
    ativar();
    return { ok: true, sock: Boolean(sock) };
  },
};