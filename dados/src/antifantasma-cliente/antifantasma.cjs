/**
 * AntiInvisível / AntiFantasma — ADAPTADOR (arquivo entregue ao usuário).
 *
 * Este é o ÚNICO arquivo do plugin que o usuário recebe. Ele funciona como um
 * cliente mínimo: guarda o estado local de ativação, observa as mensagens do
 * grupo, manda o contexto para a API e executa as ações que a API autorizar,
 * através do `sock`.
 *
 * Ele NÃO contém o algoritmo, as regras, os critérios de detecção nem a lógica
 * de decisão — tudo isso permanece no servidor.
 *
 * ─── Como usar ────────────────────────────────────────────────────────────
 *
 * O usuário NÃO precisa editar nada aqui, nem registrar listener à mão. Basta
 * colar a CASE entregue no tutorial: ela chama `iniciar(sock)` uma vez e o
 * plugin passa a observar as mensagens sozinho.
 *
 *   case 'antifantasma':
 *     const antiFantasma = require('./antifantasma');
 *     antiFantasma.iniciar(sock);   // liga a observação contínua
 *     antiFantasma.ativar(from);    // liga a proteção NESTE grupo
 *     ...
 *
 * A KEY e a URL da API ficam na configuração abaixo (já preenchidas).
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

/**
 * Estado liga/desliga.
 *
 * O estado é POR GRUPO: ativar no Grupo A não liga no Grupo B. Sem informar o
 * grupo, o valor é o global (usado como padrão de quem não separa por grupo).
 */
let ativoGlobal = false;
const ativoPorGrupo = new Map();

/** Ativa a proteção (naquele grupo, ou globalmente quando sem grupo). */
function ativar(grupo) {
  if (grupo) ativoPorGrupo.set(String(grupo), true);
  else ativoGlobal = true;
  return estaAtivo(grupo);
}

/** Desativa a proteção (naquele grupo, ou globalmente quando sem grupo). */
function desativar(grupo) {
  if (grupo) ativoPorGrupo.set(String(grupo), false);
  else ativoGlobal = false;
  return estaAtivo(grupo);
}

/** A proteção está ativa? Sem grupo, responde o global; com grupo, o do grupo. */
function estaAtivo(grupo) {
  if (grupo && ativoPorGrupo.has(String(grupo))) return ativoPorGrupo.get(String(grupo)) === true;
  return ativoGlobal === true;
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

/**
 * Explicações por motivo de recusa da KEY.
 *
 * A API devolve o motivo junto do 403. Sem ele, "KEY inválida" cobriria quatro
 * causas bem diferentes (arquivo de keys resetado, key colada errada, bot
 * diferente, key revogada) e não haveria como saber o que arrumar. O texto
 * abaixo é o que aparece no log do bot do usuário; ao usuário final mantemos a
 * mensagem genérica, porque o grupo não precisa saber disso.
 */
const MOTIVOS_KEY = {
  ausente: 'a KEY não chegou à API (arquivo entregue sem a KEY preenchida?)',
  inexistente: 'esta KEY não existe no servidor (foi gerada em OUTRA Lizzy, ou o registro de keys foi apagado/reiniciado)',
  revogada: 'esta KEY foi revogada pelo dono',
  dono_diferente: 'esta KEY pertence a OUTRO usuário (o BOT_ID não confere)',
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
 * Desembrulha os invólucros de "ver uma vez"/edição até chegar no conteúdo
 * real. O raja pode vir encapsulado num view once; sem desembrulhar, o
 * adaptador não enxergaria a nota de pagamento.
 */
function desembrulharConteudo(conteudo) {
  let atual = conteudo && typeof conteudo === 'object' ? conteudo : null;
  // Teto de 4 saltos: mais que isso é estrutura inesperada, não vale insistir.
  for (let i = 0; i < 4 && atual; i += 1) {
    const proximo =
      atual.viewOnceMessage?.message ||
      atual.viewOnceMessageV2?.message ||
      atual.viewOnceMessageV2Extension?.message ||
      atual.documentWithCaptionMessage?.message ||
      atual.editedMessage?.message?.protocolMessage?.editedMessage ||
      null;
    if (!proximo || proximo === atual) break;
    atual = proximo;
  }
  return atual;
}

/**
 * Relata a presença e o valor CRU do pagamento, sem julgar. O servidor decide o
 * que fazer com isso (é lá que vive a regra do "pagamento zerado").
 */
function extrairPagamento(conteudo) {
  const nota = desembrulharConteudo(conteudo)?.requestPaymentMessage;
  if (!nota || typeof nota !== 'object') return null;
  return {
    presente: true,
    amount1000: nota.amount1000 != null ? String(nota.amount1000) : null,
    amountValue: nota.amount?.value != null ? String(nota.amount.value) : null,
  };
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
function extrairContexto(msg, grupo, autor, jaPunido = false) {
  const m = msg && typeof msg === 'object' ? msg : {};
  const key = m.key && typeof m.key === 'object' ? m.key : {};
  const conteudo = m.message && typeof m.message === 'object' ? m.message : null;

  const pagamento = extrairPagamento(conteudo);

  // A fork reporta a distribuição seletiva como um RELATÓRIO (objeto), não como
  // o booleano `true`: `fullMessage.selectiveDistribution = report` (ver
  // decode-wa-message.js). Testar `=== true` daria sempre `false` e o ataque
  // nunca seria classificado — era a causa de "ativo o !antifantasma mas não
  // bane". Aqui basta a PRESENÇA da marca (aceita também `true`, de
  // implementações que só sinalizam).
  const marcaSeletiva = m.selectiveDistribution;
  const temMarcaSeletiva = marcaSeletiva != null && marcaSeletiva !== false;

  // O autor nunca deve ser o próprio bot: se a lib não trouxer o participante,
  // relata nulo (o núcleo trata como "autor_desconhecido") em vez de inventar.
  const autorSeguro = autor || key.participantAlt || key.participant || null;

  return {
    isGroup: typeof grupo === 'string' && grupo.endsWith('@g.us'),
    fromMe: key.fromMe === true,
    sender: autorSeguro,
    // O que o WhatsApp entrega: a mensagem veio decifrada?
    temMensagem: Boolean(conteudo),
    // Marca de transporte da fork (distribuição seletiva).
    selectiveDistribution: temMarcaSeletiva,
    // Stub de grupo (mensagem que não pôde ser decifrada).
    temStub: m.messageStubType != null,
    // O adaptador apenas INFORMA que já puniu este autor nesta rajada; quem
    // decide se isso encerra o caso continua sendo o núcleo.
    alreadyPunished: jaPunido === true,
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

/**
 * Janela de supressão por grupo+autor, espelhando a da Lizzy (`wasGhostPunished`).
 *
 * Sem ela, cada mensagem fantasma da mesma rajada é enviada à API como um caso
 * novo e o cliente executa o ciclo fechar/banir/reabrir N vezes — medido: uma
 * rajada de 3 mensagens produzia 3 ciclos. O servidor também tem a guarda
 * (`alreadyPunished`), mas só consegue aplicá-la se o adaptador informar o
 * estado; aqui ele apenas informa.
 *
 * 8s cobre uma rajada de ~80 mensagens a 100ms (a cadência do `!raja`) e libera
 * rápido para o próximo ataque ser punido de novo.
 */
const PUNISH_WINDOW_MS = 8 * 1000;
const punished = new Map();
const PUNISH_KEY_SEP = '\u0000';

/**
 * Aviso de "não achei o bot no grupo" já emitido?
 *
 * É um erro de configuração do grupo (o bot não é admin, ou o metadata não usa a
 * identidade que o socket expõe), não um evento por mensagem: repetir a cada
 * mensagem poluiria o terminal do usuário. Uma vez por processo basta.
 */
let avisoBotNaoEncontrado = false;

/** Este autor já foi punido neste grupo há pouco? */
function wasPunished(grupo, autor) {
  if (!grupo || !autor) return false;
  const chave = `${grupo}${PUNISH_KEY_SEP}${autor}`;
  const ate = punished.get(chave);
  if (ate === undefined) return false;
  if (Date.now() > ate) {
    punished.delete(chave);
    return false;
  }
  return true;
}

/** Marca o autor como punido, podando entradas vencidas para não crescer sem limite. */
function markPunished(grupo, autor) {
  if (!grupo || !autor) return;
  const agora = Date.now();
  if (punished.size > 256) {
    for (const [k, ate] of punished) {
      if (agora > ate) punished.delete(k);
    }
  }
  punished.set(`${grupo}${PUNISH_KEY_SEP}${autor}`, agora + PUNISH_WINDOW_MS);
}

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
    const ehAdmin = (p) => Boolean(p) && (p.admin === 'admin' || p.admin === 'superadmin');

    // O próprio bot: as duas formas de identidade que o socket oferece (PN e
    // LID) viram um conjunto. Sem isso, um metadata que lista o bot só por LID
    // enquanto `sock.user.id` é o PN não casava — `botIsAdmin` saía `undefined`,
    // o núcleo recusava com `bot_sem_poder` e a proteção não fazia NADA, em
    // silêncio. Era um "não funciona" invisível.
    const bases = new Set();
    for (const v of [sock?.user?.id, sock?.user?.lid]) {
      if (typeof v === 'string' && v) bases.add(String(v).split(':')[0].split('@')[0]);
    }

    const candidatosDe = (p) => [p?.id, p?.lid, p?.phoneNumber, p?.pn].filter(Boolean);

    const acharMeu = participantes.find((p) =>
      candidatosDe(p).some((c) => bases.has(String(c).split(':')[0].split('@')[0])));

    const acharAutor = autor
      ? participantes.find((p) => candidatosDe(p).some((c) => mesmoUsuario(c, autor)))
      : null;

    // Só considera resposta válida se veio lista de participantes.
    if (participantes.length > 0) {
      // Booleano DEFINIDO, nunca `undefined`: `undefined` não atravessa o JSON
      // e o servidor receberia um contexto sem o campo, sem saber por quê.
      resultado = {
        botIsAdmin: ehAdmin(acharMeu),
        senderIsPrivileged: ehAdmin(acharAutor),
      };
      if (!acharMeu && !avisoBotNaoEncontrado) {
        // Diagnóstico honesto: sem achar o bot na lista, `botIsAdmin` é falso e
        // o anti não age. Isto explica "ativei mas não bane" no terminal do
        // usuário, em vez de deixar o silêncio.
        avisoBotNaoEncontrado = true;
        console.error(
          '[AntiFantasma] não encontrei o bot na lista de participantes deste grupo; '
          + 'sem admin o anti não age. Identidades tentadas:',
          [...bases].join(', ')
        );
      }
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
  const sock = params.sock;
  const msg = params.msg && typeof params.msg === 'object' ? params.msg : null;
  const key = msg?.key && typeof msg.key === 'object' ? msg.key : {};

  // Aceita as duas formas: explícita (`grupo`/`from`) ou direto da mensagem.
  const grupo = params.grupo || params.from || key.remoteJid || null;

  // O estado é POR GRUPO: só age no grupo onde a proteção foi ligada.
  if (!estaAtivo(grupo)) {
    // Desativado: NADA sai daqui (nem chamada à API). Devolve o motivo para o
    // usuário entender por que não houve ação, em vez de falhar em silêncio.
    return { ok: true, acoes: [], motivo: 'desativado' };
  }

  // Nunca usa o próprio BOT_ID como autor: se o participante não vier, relata
  // nulo (o núcleo responde `autor_desconhecido`) em vez de apontar o bot.
  const autor = params.autor || params.sender || key.participantAlt || key.participant || null;
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
  const jaPunido = wasPunished(grupo, autor);
  const contexto = params.contexto && typeof params.contexto === 'object'
    ? { ...params.contexto }
    : extrairContexto(msg, grupo, autor, jaPunido);

  // Completa o que o usuário não informou: se o BOT pode agir e se o AUTOR é
  // privilegiado. Sem isso o servidor não tem como decidir.
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

  // KEY recusada pela API (ausente, inexistente, revogada ou de outro dono).
  // Aqui é onde o dono do bot descobre o que está errado: logamos o MOTIVO que
  // a API mandou, porque só "KEY inválida" não diz o que arrumar.
  if (resposta.status === 401 || resposta.status === 403) {
    const motivo = resposta.body?.reason || 'desconhecido';
    const explicacao = MOTIVOS_KEY[motivo] || 'motivo não reconhecido';
    console.error(`[AntiFantasma] KEY recusada (motivo: ${motivo}) — ${explicacao}`);
    if (reply) await reply(MENSAGENS.key).catch(() => {});
    return { ok: false, acoes: [], erro: MENSAGENS.key, motivoKey: motivo };
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
    } catch (e) {
      // A sequência continua (não deixar o grupo fechado por um erro no meio),
      // mas a falha vai para o log: engolir em silêncio escondia o motivo de
      // "não baniu", o mesmo tipo de cegueira que atrasou o diagnóstico antes.
      console.error(`[AntiFantasma] ação "${acao}" falhou:`, e?.message || e);
    }
  }

  // Só marca quando uma punição REALMENTE saiu: se a API mandou banir e o socket
  // recusou, o próximo evento ainda deve tentar de novo.
  if (executadas.includes('ban_user')) markPunished(grupo, autor);

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

// ───────────────────────────────────────────────────────────────────────────
// PROTEÇÃO CONTÍNUA — observa as mensagens sozinho (sem editar o handler)
// ───────────────────────────────────────────────────────────────────────────

/** Socket em que já estamos escutando (evita listener duplicado). */
let socketEscutado = null;
/** Guarda a função anexada, para o caso de ser preciso removê-la depois. */
let listenerAtual = null;
/** Ids de mensagens já avaliadas — evita processar a mesma duas vezes. */
const vistos = new Set();

/**
 * Auto-liga a observação quando o módulo traz um socket reconhecível.
 *
 * Serve para o caso do ESM: o `require()` da CASE não existe lá, então ela
 * falharia antes de chamar `iniciar(sock)`. Aqui, na PRIMEIRA mensagem que
 * chega, o módulo detecta o socket pelo evento e liga a escuta sozinho — assim
 * a proteção contínua não depende de o bot expor o socket com um nome fixo.
 *
 * Não decide nada: só garante que `iniciar` roda. Sem socket reconhecível,
 * desiste e espera a chamada explícita.
 */
function autoIniciar(evento) {
  if (estaEscutando()) return;
  // Em variantes da lib o socket aparece como `sock`, `socket` ou `nazu`.
  const dono = evento?.sock || evento?.socket || evento?.nazu || null;
  if (dono) iniciar(dono);
}

function podarVistos() {
  if (vistos.size <= 1000) return;
  const chaves = Array.from(vistos).slice(0, 500);
  for (const k of chaves) vistos.delete(k);
}

/**
 * Processa um evento `messages.upsert` do Baileys.
 *
 * Filtro estrutural (não é decisão de ataque, é o mesmo que o núcleo aplica
 * antes de classificar): só mensagens de grupo e que não são do próprio bot.
 * Qualquer julgamento sobre ser ou não ataque continua no servidor.
 */
async function aoReceberMensagens(evento) {
  try {
    // Garante a escuta mesmo quando a CASE não pôde chamar `iniciar` (ESM).
    autoIniciar(evento);

    const lista = Array.isArray(evento?.messages)
      ? evento.messages
      : (evento?.key ? [evento] : []);

    for (const msg of lista) {
      const grupo = msg?.key?.remoteJid;
      if (!grupo || !String(grupo).endsWith('@g.us')) continue;
      if (msg?.key?.fromMe) continue;
      if (!estaAtivo(grupo)) continue;

      const id = msg?.key?.id;
      if (id) {
        if (vistos.has(id)) continue;
        vistos.add(id);
        podarVistos();
      }

      // Sem `reply`: o plugin não responde nada por conta própria. Se a API
      // estiver fora do ar, o grupo não recebe erro a cada mensagem.
      await executar({ sock: socketEscutado, msg, grupo });
    }
  } catch {
    // A observação nunca pode derrubar o handler do usuário.
  }
}

/**
 * Liga a observação contínua no socket informado.
 *
 * Chamado UMA vez pela CASE entregue. Anexa um listener próprio de
 * `messages.upsert` ao lado do que o bot do usuário já tem — sem substituir nem
 * interferir no handler dele. Como o listener é registrado no próprio socket do
 * Baileys, não é preciso editar nada no `index.js` além da CASE.
 *
 * É idempotente: chamar de novo (o usuário alternando liga/desliga) não duplica
 * o listener. Se o socket for outro (reconexão), troca a escuta para ele.
 *
 * @param {object} sock socket do Baileys
 * @returns {{ok: boolean, escutando: boolean, motivo?: string}}
 */
function iniciar(sock) {
  if (!sock || typeof sock !== 'object') {
    return { ok: false, escutando: false, motivo: 'sem_sock' };
  }
  // O emitter das mensagens: no Baileys é `sock.ev`. Alguns bots expõem o
  // próprio socket como emitter (`sock.on`), então aceitamos os dois.
  const emitter = (sock.ev && typeof sock.ev.on === 'function')
    ? sock.ev
    : (typeof sock.on === 'function' ? sock : null);

  if (!emitter) {
    return { ok: false, escutando: false, motivo: 'socket_sem_ev' };
  }

  if (socketEscutado === sock && listenerAtual) {
    return { ok: true, escutando: true };
  }

  // Socket novo (ou primeira vez): se já escutávamos outro, saímos dele antes.
  if (socketEscutado && listenerAtual) {
    const anterior = (socketEscutado.ev && typeof socketEscutado.ev.off === 'function')
      ? socketEscutado.ev
      : (typeof socketEscutado.off === 'function' ? socketEscutado : null);
    if (anterior) { try { anterior.off('messages.upsert', listenerAtual); } catch { /* ignora */ } }
  }

  emitter.on('messages.upsert', aoReceberMensagens);
  socketEscutado = sock;
  listenerAtual = aoReceberMensagens;

  return { ok: true, escutando: true };
}

/** Para de observar as mensagens (a proteção deixa de rodar até novo `iniciar`). */
function parar() {
  if (socketEscutado && listenerAtual) {
    const emitter = (socketEscutado.ev && typeof socketEscutado.ev.off === 'function')
      ? socketEscutado.ev
      : (typeof socketEscutado.off === 'function' ? socketEscutado : null);
    if (emitter) { try { emitter.off('messages.upsert', listenerAtual); } catch { /* ignora */ } }
  }
  socketEscutado = null;
  listenerAtual = null;
  return { ok: true, escutando: false };
}

/** Está observando as mensagens? */
function estaEscutando() {
  return Boolean(socketEscutado && listenerAtual);
}

/**
 * Exportação.
 *
 * O arquivo termina em `.cjs` de propósito: assim um bot ESM consegue carregá-lo
 * (com `import('./antifantasma.cjs')` ou via `require` num CJS) e um bot
 * CommonJS também. O caso que NÃO funciona é um `.js` com conteúdo CommonJS
 * dentro de um bot ESM — o Node recusa com "module is not defined in ES module
 * scope". Por isso a extensão importa e a CASE já carrega do jeito certo.
 */
module.exports = {
  // Estado local (livre para o usuário usar em qualquer case)
  ativar,
  desativar,
  estaAtivo,
  // Processamento
  executar,
  // Proteção contínua (a CASE chama isto uma vez e pronto)
  iniciar,
  parar,
  estaEscutando,
};