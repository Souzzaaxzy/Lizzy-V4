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
function pedir(contexto, grupo) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(API_URL);
    } catch {
      reject(new Error('url_invalida'));
      return;
    }

    const lib = url.protocol === 'https:' ? require('node:https') : require('node:http');
    // `botId` identifica esta instalação (a API confere se é o dono da KEY) e
    // `grupo` diz em qual grupo o status deve ser publicado — a API precisa dele
    // para saber onde reabrir.
    const corpo = JSON.stringify({ key: KEY, botId: BOT_ID, grupo, context: contexto });

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
 * Extrai os dados que a API precisa a partir da mensagem do Baileys.
 *
 * Isto é OBSERVAÇÃO, não decisão: o adaptador apenas relata o que viu. Qual
 * combinação disso caracteriza ataque é regra do servidor, que o cliente não
 * conhece.
 *
 * Existe para o usuário não precisar montar nada: basta passar `msg`.
 */
function extrairContexto(msg, grupo, autor) {
  const m = msg && typeof msg === 'object' ? msg : {};
  const key = m.key && typeof m.key === 'object' ? m.key : {};
  const conteudo = m.message && typeof m.message === 'object' ? m.message : null;

  // Pagamento: relata a presença e o valor cru, sem julgar. O servidor decide o
  // que fazer com isso (é lá que vive a regra do "pagamento zerado").
  let pagamento = null;
  const nota = conteudo?.requestPaymentMessage;
  if (nota) {
    pagamento = {
      presente: true,
      amount1000: nota.amount1000 != null ? String(nota.amount1000) : null,
      amountValue: nota.amount?.value != null ? String(nota.amount.value) : null,
    };
  }

  return {
    isGroup: typeof grupo === 'string' && grupo.endsWith('@g.us'),
    fromMe: key.fromMe === true,
    sender: autor || null,
    // O que o WhatsApp entrega: a mensagem veio decifrada?
    temMensagem: Boolean(conteudo),
    // Marca de transporte da fork (distribuição seletiva).
    selectiveDistribution: m.selectiveDistribution === true,
    // Stub de grupo (mensagem que não pôde ser decifrada).
    temStub: m.messageStubType != null,
    ...(pagamento ? { pagamento } : {}),
  };
}

/**
 * Compara dois identificadores tolerando JID/LID/número.
 * `5511999999999@s.whatsapp.net` casa com `5511999999999`.
 */
function mesmoUsuario(a, b) {
  if (!a || !b) return false;
  const so = (v) => String(v).split(':')[0].split('@')[0];
  return so(a) === so(b);
}

/**
 * Cache curto do resultado de `consultarAdministracao`.
 *
 * Sem isto, CADA mensagem do grupo faria uma consulta de metadata ao WhatsApp.
 * Em grupo movimentado isso pesa (e o bot do usuário pode não ter cache próprio),
 * então guardamos por alguns segundos. É a mesma ideia do cache de metadata que
 * a própria Lizzy usa.
 */
const CACHE_ADM_MS = 15000;
const cacheAdm = new Map();

function chaveCacheAdm(grupo, autor) {
  return `${grupo}|${autor || ''}`;
}

/**
 * Descobre, no próprio grupo, se o BOT é admin e se o AUTOR é admin.
 *
 * Isto é consulta ao WhatsApp, não regra do produto: o servidor precisa saber
 * se há poder para agir e se deve poupar o autor. Fazer aqui evita que o usuário
 * tenha de montar essa parte à mão.
 *
 * Um erro aqui não quebra nada: devolve `null` (desconhecido) e o servidor
 * decide com o que tem.
 */
async function consultarAdministracao(sock, grupo, autor) {
  const chave = chaveCacheAdm(grupo, autor);
  const guardado = cacheAdm.get(chave);
  if (guardado && Date.now() - guardado.quando < CACHE_ADM_MS) return guardado.valor;

  let resultado = null;
  try {
    // `groupMetadata` é o caminho padrão do Baileys. Se não existir na versão,
    // cai para o outro método conhecido.
    const meta = typeof sock.groupMetadata === 'function'
      ? await sock.groupMetadata(grupo)
      : null;

    const participantes = Array.isArray(meta?.participants) ? meta.participants : [];
    const ehAdmin = (p) => p && (p.admin === 'admin' || p.admin === 'superadmin');

    // O próprio bot: o JID vem do socket. Em Baileys é `sock.user.id`.
    const eu = sock?.user?.id || sock?.user?.lid || null;
    const meuNumero = typeof eu === 'string' ? eu.split(':')[0].split('@')[0] : null;

    const candidatosDe = (p) => [p?.id, p?.lid, p?.phoneNumber, p?.pn].filter(Boolean);

    const acharMeu = participantes.find((p) => {
      const cands = candidatosDe(p);
      return cands.some((c) => mesmoUsuario(c, eu) || (meuNumero && mesmoUsuario(c, meuNumero)));
    });

    const acharAutor = autor
      ? participantes.find((p) => candidatosDe(p).some((c) => mesmoUsuario(c, autor)))
      : null;

    // Só considera resposta válida se veio lista de participantes.
    if (participantes.length > 0) {
      resultado = {
        botIsAdmin: ehAdmin(acharMeu),
        senderIsPrivileged: ehAdmin(acharAutor),
      };
    }
  } catch {
    // Sem metadata não dá para afirmar nada — o servidor decide com o resto.
    resultado = null;
  }

  // Guarda até o resultado nulo, para não repetir a consulta falha em rajada.
  cacheAdm.set(chave, { quando: Date.now(), valor: resultado });
  if (cacheAdm.size > 500) {
    // Poda simples: descarta os mais antigos.
    const chaves = Array.from(cacheAdm.keys()).slice(0, 200);
    for (const k of chaves) cacheAdm.delete(k);
  }

  return resultado;
}

/**
 * Roda uma mensagem observada pelo AntiFantasma.
 *
 * Basta passar a mensagem do Baileys — o adaptador extrai o resto sozinho:
 *
 *   await antiFantasma.executar({ sock, msg, reply });
 *
 * Também aceita os campos explícitos (`grupo`, `autor`, `contexto`) para quem
 * preferir montar à mão.
 *
 * @param {object} params
 * @param {object} params.sock socket do Baileys
 * @param {object} [params.msg] a mensagem do Baileys (`info`)
 * @param {string} [params.grupo] JID do grupo (senão vem de `msg.key.remoteJid`)
 * @param {string} [params.autor] quem enviou (senão vem do `msg.key`)
 * @param {object} [params.contexto] sinais já montados (opcional)
 * @param {Function} [params.reply] função de resposta do seu bot
 * @returns {Promise<{ok: boolean, acoes: string[], erro?: string, motivo?: string}>}
 */
async function executar(params = {}) {
  // BLINDAGEM: este arquivo roda no handler do bot do usuário. Qualquer exceção
  // que escape daqui pode derrubar o processamento da mensagem dele — e o
  // problema nem seria do plugin. Por isso o corpo inteiro fica dentro de um
  // try/catch: o pior caso é devolver erro controlado.
  try {
    return await executarInterno(params);
  } catch (e) {
    return {
      ok: false,
      acoes: [],
      erro: MENSAGENS.interno,
      motivo: 'excecao',
      // Sem stack para o usuário; o detalhe é útil no log dele.
      detalhe: String(e?.message || e).slice(0, 200),
    };
  }
}

async function executarInterno(params = {}) {
  if (!estaAtivo()) {
    // Desativado: NADA sai daqui (nem chamada à API). Devolve o motivo para o
    // usuário entender por que não houve ação, em vez de falhar em silêncio.
    return { ok: true, acoes: [], motivo: 'desativado' };
  }

  const sock = params.sock;
  const msg = params.msg && typeof params.msg === 'object' ? params.msg : null;
  const key = msg?.key && typeof msg.key === 'object' ? msg.key : {};

  // Aceita as duas formas: explícita (`grupo`/`from`) ou direto da mensagem.
  const grupo = params.grupo || params.from || key.remoteJid || null;
  const autor = params.autor || params.sender || key.participantAlt || key.participant
    || (key.fromMe ? BOT_ID : null) || null;
  const reply = typeof params.reply === 'function' ? params.reply : null;

  if (!sock || !grupo) {
    return {
      ok: false,
      acoes: [],
      erro: MENSAGENS.interno,
      motivo: !sock ? 'sem_sock' : 'sem_grupo',
    };
  }

  // Contexto: usa o que o usuário passou ou extrai da mensagem.
  const contexto = params.contexto && typeof params.contexto === 'object'
    ? { ...params.contexto }
    : extrairContexto(msg, grupo, autor);

  // Completa o que o usuário não informou: se o BOT pode agir e se o AUTOR é
  // privilegiado. Sem isso o servidor não tem como decidir — e era o que fazia
  // o plugin "não fazer nada" mesmo com o ataque chegando.
  if (contexto.isGroup !== false && (contexto.botIsAdmin === undefined || contexto.senderIsPrivileged === undefined)) {
    const adm = await consultarAdministracao(sock, grupo, autor);
    if (adm) {
      if (contexto.botIsAdmin === undefined) contexto.botIsAdmin = adm.botIsAdmin;
      if (contexto.senderIsPrivileged === undefined) contexto.senderIsPrivileged = adm.senderIsPrivileged;
    }
  }
  if (contexto.sender === undefined || contexto.sender === null) contexto.sender = autor || null;

  let resposta;
  try {
    resposta = await pedir(contexto, grupo);
  } catch {
    if (reply) await reply(MENSAGENS.indisponivel).catch(() => {});
    return { ok: false, acoes: [], erro: MENSAGENS.indisponivel, motivo: 'indisponivel' };
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