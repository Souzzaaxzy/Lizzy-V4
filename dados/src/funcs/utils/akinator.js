/**
 * AKINATOR -- adivinhacao de pessoa/personagem via `akinator-client`.
 *
 * NAO existe banco de personagens aqui: o conhecimento vem do servico do
 * Akinator. A Lizzy so consome o jogo.
 *
 * Arquitetura (mesma familia do tictactoe.js / connect4.js / hotseat.js):
 *   - um Mapa de sessoes EM MEMORIA, sem banco externo (a partida e efemera);
 *   - _cleanup() periodico para nao deixar sessao orfa;
 *   - respostas por MENSAGEM (botao ou texto) -- o handler central chama
 *     processMessage(...) e quem decide e o modulo.
 *
 * Isolamento (spec 7/31/32): a chave e groupId::userId. Cada jogador tem a
 * SUA propria instancia de AkinatorClient -- nunca uma instancia global.
 *
 * O desenho das mensagens vem de menus/layout.js (fonte unica do layout).
 */

import { bold } from '../../menus/layout.js';
import { normalizar } from '../../utils/helpers.js';

// --- CONFIGURACAO ---
const CONFIG = {
  SESSION_TIMEOUT_MS: 30 * 60 * 1000,
  CLEANUP_INTERVAL_MS: 5 * 60 * 1000,
  RETRIES: 2,
  MAX_DESCRIPTION: 240,
  IDIOMA: 'pt',
  TEMA: 'Character',
};

// --- LAYOUT (mesmo desenho do resto da bot) ---
const TOPO = (titulo, emoji) => {
  const e = emoji === undefined ? '\u{1F52E}' : emoji;
  return `\u256d\u2501\u2501\u2501\ua9c1\u0f3a ${e} ${bold(titulo)} ${e} \u0f3b\ua9c2\u2501\u2501\u2501\u256e`;
};
const RODAPE = (botName) => `\u2570\u2501\u2501\u2501\ua9c1\u0f3a \u2726 ${botName} \u2726 \u0f3b\ua9c2\u2501\u2501\u2501\u256f`;

const sessionKey = (groupId, userId) => `${groupId}::${userId}`;

const EMOJI_RESPOSTA = {
  SIM: '\u2705',
  NAO: '\u274c',
  NAO_SEI: '\u{1F914}',
  PROVAVELMENTE: '\u{1F7E2}',
  PROVAVELMENTE_NAO: '\u{1F534}',
};

const BOTAO_PARA_RESPOSTA = {
  ak_sim: 'SIM',
  ak_nao: 'NAO',
  ak_nao_sei: 'NAO_SEI',
  ak_provavelmente: 'PROVAVELMENTE',
  ak_provavelmente_nao: 'PROVAVELMENTE_NAO',
};

/**
 * Botao no FORMATO DE FIO que o `sendInteractiveMessage` do projeto ja envia
 * (`nativeFlowMessage.buttons` -> `prepareNativeFlowButtons` da fork). O `id` e
 * o MESMO contrato que a biblioteca usa para o quick_reply.
 */
const botaoWired = (sessionId, text, chave) => ({
  name: 'quick_reply',
  buttonParamsJson: JSON.stringify({ display_text: text, id: `${sessionId}:${chave}` }),
});

function buildAnswerButtons(sessionId) {
  return [
    botaoWired(sessionId, 'SIM', 'ak_sim'),
    botaoWired(sessionId, 'N\u00c3O', 'ak_nao'),
    botaoWired(sessionId, 'N\u00c3O SEI', 'ak_nao_sei'),
    botaoWired(sessionId, 'PROVAVELMENTE', 'ak_provavelmente'),
    botaoWired(sessionId, 'PROVAVELMENTE N\u00c3O', 'ak_provavelmente_nao'),
  ];
}

function buildWinButtons(sessionId) {
  return [
    botaoWired(sessionId, 'ACERTOU', 'ak_acertou'),
    botaoWired(sessionId, 'ERROU', 'ak_errou'),
  ];
}

function parseAnswerInput(raw) {
  const t = String(raw === undefined || raw === null ? '' : raw).trim();
  if (!t) return null;

  const m = t.match(/^([A-Za-z0-9_-]+):(ak_[a-z_]+)$/);
  if (m) {
    const chave = m[2];
    if (chave === 'ak_acertou') return { sessionId: m[1], resposta: 'ACERTOU' };
    if (chave === 'ak_errou') return { sessionId: m[1], resposta: 'ERROU' };
    const resposta = BOTAO_PARA_RESPOSTA[chave];
    if (resposta) return { sessionId: m[1], resposta };
    return null;
  }

  const n = normalizar(t).replace(/\s+/g, ' ').trim();
  if (!n || n.length > 30 || /[:\/]/.test(n)) return null;
  if (['sim', 's', 'yes'].includes(n)) return { sessionId: null, resposta: 'SIM' };
  if (['nao', 'n', 'no'].includes(n)) return { sessionId: null, resposta: 'NAO' };
  if (['nao sei', 'naosei', 'idk'].includes(n)) return { sessionId: null, resposta: 'NAO_SEI' };
  if (['provavelmente', 'provavel', 'acho que sim'].includes(n)) return { sessionId: null, resposta: 'PROVAVELMENTE' };
  if (['provavelmente nao', 'acho que nao'].includes(n)) return { sessionId: null, resposta: 'PROVAVELMENTE_NAO' };
  if (['acertou', 'acertei'].includes(n)) return { sessionId: null, resposta: 'ACERTOU' };
  if (['errou', 'errei'].includes(n)) return { sessionId: null, resposta: 'ERROU' };
  return null;
}

function toAnswerEnum(Answers, resposta) {
  switch (resposta) {
    case 'SIM': return Answers.Yes;
    case 'NAO': return Answers.No;
    case 'NAO_SEI': return Answers.IDontKnow;
    case 'PROVAVELMENTE': return Answers.Probably;
    case 'PROVAVELMENTE_NAO': return Answers.ProbablyNot;
    default: return null;
  }
}

function encurtar(texto, max) {
  const limite = max === undefined ? CONFIG.MAX_DESCRIPTION : max;
  const s = String(texto === undefined || texto === null ? '' : texto).replace(/\s+/g, ' ').trim();
  if (s.length <= limite) return s;
  return `${s.slice(0, limite - 1).trimEnd()}\u2026`;
}

function percentual(progression) {
  const n = Number(progression);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

// --- MOTOR ---
class AkinatorGame {
  constructor(opts) {
    const p = opts || {};
    this.groupId = p.groupId;
    this.userId = p.userId;
    this.sessionId = p.sessionId;
    this.botName = p.botName || 'Bot';
    this.enums = p.enums;
    this.createClient = p.createClient;

    this.client = null;
    this.state = 'STARTING';
    this.processing = false;
    this.lastActivity = Date.now();
    this.createdAt = Date.now();
    this.imageUrl = null;
  }

  get podeResponder() {
    return (this.state === 'ANSWERING' || this.state === 'WON') && !this.processing;
  }

  async iniciar() {
    this.processing = true;
    try {
      this.client = this.createClient({
        language: this.enums.Languages.Portuguese,
        theme: this.enums.Themes.Character,
        retries: CONFIG.RETRIES,
      });
      const res = await this.client.start();
      this.state = 'ANSWERING';
      this.lastActivity = Date.now();
      return this._respostaPergunta(res);
    } finally {
      this.processing = false;
    }
  }

  async responder(resposta) {
    if (this.processing) return { ok: false, reason: 'processing' };
    if (this.state === 'FINISHED' || this.state === 'KO') return { ok: false, reason: 'finished' };

    this.processing = true;
    this.lastActivity = Date.now();
    try {
      if (this.state === 'WON') {
        if (resposta === 'ACERTOU') {
          try { await this.client.submitWin(); } catch (e) { console.warn('[AKINATOR] submitWin falhou:', e && e.message); }
          this.state = 'FINISHED';
          return { ok: true, kind: 'confirmou' };
        }
        if (resposta === 'ERROU') {
          try {
            const res = await this.client.continue();
            if (res && res.won) {
              this.state = 'WON';
              return { ok: true, kind: 'palpite', ...this._respostaPalpite(res) };
            }
            this.state = 'ANSWERING';
            return { ok: true, kind: 'pergunta', ...this._respostaPergunta(res) };
          } catch (e) {
            console.warn('[AKINATOR] continue() indisponivel:', e && e.message);
            this.state = 'FINISHED';
            return { ok: true, kind: 'continue_indisponivel' };
          }
        }
        return { ok: false, reason: 'invalid' };
      }

      const enumResposta = toAnswerEnum(this.enums.Answers, resposta);
      if (enumResposta === null) return { ok: false, reason: 'invalid' };

      const res = await this.client.answer(enumResposta);

      if (res && res.won) {
        this.state = 'WON';
        return { ok: true, kind: 'palpite', ...this._respostaPalpite(res) };
      }
      if (res && res.ko) {
        this.state = 'KO';
        return { ok: true, kind: 'derrota' };
      }
      this.lastActivity = Date.now();
      return { ok: true, kind: 'pergunta', ...this._respostaPergunta(res) };
    } finally {
      this.processing = false;
    }
  }

  async voltar() {
    if (this.processing) return { ok: false, reason: 'processing' };
    if (this.state !== 'ANSWERING') return { ok: false, reason: 'invalid' };
    this.processing = true;
    this.lastActivity = Date.now();
    try {
      const res = await this.client.back();
      return { ok: true, kind: 'pergunta', ...this._respostaPergunta(res) };
    } catch (e) {
      return { ok: false, reason: 'back_indisponivel' };
    } finally {
      this.processing = false;
    }
  }

  _respostaPergunta(res) {
    return {
      pergunta: (res && res.question) || '',
      progresso: percentual(res && res.progression),
    };
  }

  _respostaPalpite(res) {
    const win = (this.client && this.client.winResult) || {};
    this.imageUrl = win.pictureUrl || null;
    return {
      nome: win.name || (res && res.name) || '???',
      descricao: encurtar(win.description || ''),
      imageUrl: this.imageUrl,
    };
  }

  _renderPergunta(res) {
    const pergunta = (res && res.pergunta) || '';
    const prog = percentual(res && res.progresso);
    return [
      TOPO('AKINATOR'),
      '',
      `\u2753 ${pergunta}`,
      '',
      `\u{1F4CA} Progresso: ${bold(prog + '%')}`,
      RODAPE(this.botName),
    ].join('\n');
  }

  _renderPalpite(res) {
    const nome = (res && res.nome) || '???';
    const linhas = [
      TOPO('AKINATOR'),
      '',
      `\u{1F3AF} ${bold('ACHO QUE DESCOBRI!')}`,
      '',
      `\u{1F464} ${bold(nome)}`,
    ];
    if (res && res.descricao) linhas.push('', `\u{1F4DD} ${res.descricao}`);
    linhas.push(RODAPE(this.botName));
    return linhas.join('\n');
  }
}

// --- GERENCIADOR ---
class AkinatorManager {
  constructor(deps) {
    const d = deps || {};
    this.createClient = d.createClient;
    this.enums = d.enums;
    this.botName = d.botName || 'Bot';
    this.sessions = new Map();
    this._seq = 0;
    this.cleanupTimer = setInterval(() => this._cleanup(), CONFIG.CLEANUP_INTERVAL_MS);
    if (this.cleanupTimer && typeof this.cleanupTimer.unref === 'function') {
      this.cleanupTimer.unref();
    }
  }

  get disponivel() {
    return typeof this.createClient === 'function' && !!this.enums;
  }

  getSession(groupId, userId) {
    return this.sessions.get(sessionKey(groupId, userId)) || null;
  }

  async iniciar(p) {
    const groupId = p && p.groupId;
    const userId = p && p.userId;
    if (!groupId || !userId) return { success: false, reason: 'bad_args' };
    if (!this.disponivel) return { success: false, reason: 'sem_cliente' };

    const atual = this.getSession(groupId, userId);
    if (atual && atual.state !== 'FINISHED') {
      return { success: false, reason: 'ja_em_partida' };
    }

    this._seq += 1;
    const sessionId = `ak${Date.now().toString(36)}${this._seq.toString(36)}`;
    const game = new AkinatorGame({
      groupId, userId, sessionId,
      createClient: this.createClient,
      enums: this.enums,
      botName: this.botName,
    });
    this.sessions.set(sessionKey(groupId, userId), game);

    try {
      const res = await game.iniciar();
      return {
        success: true,
        sessionId,
        message: game._renderPergunta(res),
        buttons: buildAnswerButtons(sessionId),
      };
    } catch (e) {
      this.sessions.delete(sessionKey(groupId, userId));
      console.warn('[AKINATOR] falha ao iniciar:', e && e.message);
      return { success: false, reason: 'erro_rede' };
    }
  }

  mensagemAbertura() {
    return [
      TOPO('AKINATOR'),
      '',
      `\u{1F9DE} Pense em uma pessoa ou personagem.`,
      '',
      `N\u00e3o me diga quem \u00e9!`,
      '',
      `\u{1F52E} J\u00e1 vou come\u00e7ar a adivinhar...`,
      RODAPE(this.botName),
    ].join('\n');
  }

  async processMessage(p) {
    const groupId = p && p.groupId;
    const userId = p && p.userId;
    const text = p && p.text;
    if (!groupId || !userId || !text) return null;

    const parsed = parseAnswerInput(text);
    if (!parsed) return null;

    const session = this.getSession(groupId, userId);
    if (!session) return null;

    if (Date.now() - session.lastActivity > CONFIG.SESSION_TIMEOUT_MS) {
      this.sessions.delete(sessionKey(groupId, userId));
      return {
        success: true,
        reason: 'timeout',
        message: `${TOPO('AKINATOR')}\n\n\u23f0 Sua partida do Akinator expirou por falta de intera\u00e7\u00e3o.\n\n${RODAPE(this.botName)}`,
      };
    }

    if (parsed.sessionId && parsed.sessionId !== session.sessionId) {
      return { success: true, reason: 'nao_e_sua', message: '\u274c Essa partida n\u00e3o pertence a voc\u00ea.' };
    }

    if (session.state === 'FINISHED' || session.state === 'KO') {
      return { success: true, reason: 'ja_encerrada', message: '\u26a0\ufe0f Essa partida j\u00e1 foi encerrada.' };
    }

    session.lastActivity = Date.now();

    if (session.processing) {
      return { success: true, reason: 'processing', message: '\u23f3 Um instante... ainda estou processando a resposta anterior.' };
    }

    let res;
    try {
      res = await session.responder(parsed.resposta);
    } catch (e) {
      console.warn('[AKINATOR] erro ao responder:', e && e.message);
      return { success: true, reason: 'erro_rede', message: this.mensagemErroRede() };
    }

    if (!res.ok) {
      if (res.reason === 'invalid') {
        return { success: true, reason: 'invalid', message: this.mensagemInvalida() };
      }
      if (res.reason === 'processing') {
        return { success: true, reason: 'processing', message: '\u23f3 Um instante...' };
      }
      return null;
    }

    if (res.kind === 'pergunta') {
      return {
        success: true,
        kind: 'pergunta',
        message: session._renderPergunta(res),
        buttons: buildAnswerButtons(session.sessionId),
      };
    }

    if (res.kind === 'palpite') {
      this.sessions.set(sessionKey(groupId, userId), session);
      return {
        success: true,
        kind: 'palpite',
        message: session._renderPalpite(res),
        buttons: buildWinButtons(session.sessionId),
        imageUrl: res.imageUrl || null,
      };
    }

    if (res.kind === 'confirmou') {
      this.sessions.delete(sessionKey(groupId, userId));
      return {
        success: true,
        kind: 'acertou',
        message: [
          TOPO('AKINATOR'),
          '',
          `\u{1F3AF} ${bold('ACERTEI!')} \u{1F60E}`,
          '',
          `Eu sabia que conseguiria descobrir.`,
          '',
          `\u{1F52E} Akinator encerrado.`,
          RODAPE(this.botName),
        ].join('\n'),
      };
    }

    if (res.kind === 'derrota') {
      this.sessions.delete(sessionKey(groupId, userId));
      return {
        success: true,
        kind: 'derrota',
        message: [
          TOPO('AKINATOR'),
          '',
          `\u{1F602} Dessa vez voc\u00ea ganhou!`,
          '',
          `N\u00e3o consegui descobrir quem`,
          `voc\u00ea estava pensando.`,
          '',
          `\u{1F3C6} ${bold('Voc\u00ea venceu o Akinator!')}`,
          RODAPE(this.botName),
        ].join('\n'),
      };
    }

    if (res.kind === 'continue_indisponivel') {
      this.sessions.delete(sessionKey(groupId, userId));
      return {
        success: true,
        kind: 'continue_indisponivel',
        message: [
          TOPO('AKINATOR'),
          '',
          `\u{1F602} Ent\u00e3o voc\u00ea me venceu!`,
          '',
          `N\u00e3o consegui continuar a partir`,
          `deste ponto. Vamos parar por aqui.`,
          '',
          `\u{1F52E} Akinator encerrado.`,
          RODAPE(this.botName),
        ].join('\n'),
      };
    }

    return null;
  }

  async voltar(p) {
    const groupId = p && p.groupId;
    const userId = p && p.userId;
    const session = this.getSession(groupId, userId);
    if (!session) return { success: false, reason: 'sem_sessao' };
    const res = await session.voltar();
    if (!res.ok) {
      return {
        success: true,
        reason: res.reason,
        message: res.reason === 'back_indisponivel'
          ? '\u21a9\ufe0f N\u00e3o d\u00e1 para voltar agora.'
          : '\u23f3 Um instante...',
      };
    }
    return { success: true, kind: 'pergunta', message: session._renderPergunta(res), buttons: buildAnswerButtons(session.sessionId) };
  }

  cancelar(p) {
    const groupId = p && p.groupId;
    const userId = p && p.userId;
    const ok = this.sessions.delete(sessionKey(groupId, userId));
    return {
      success: true,
      encerrada: ok,
      message: ok
        ? `${TOPO('AKINATOR')}\n\n\u{1F6D1} Partida do Akinator encerrada.\n\n${RODAPE(this.botName)}`
        : `${TOPO('AKINATOR')}\n\n\u{1F937} Voc\u00ea n\u00e3o tem nenhuma partida ativa.\n\n${RODAPE(this.botName)}`,
    };
  }

  mensagemJaEmPartida() {
    return [
      TOPO('AKINATOR'),
      '',
      `\u{1F52E} Voc\u00ea j\u00e1 est\u00e1 em uma partida!`,
      '',
      `Finalize essa partida ou use:`,
      `"${bold('akinator cancelar')}"`,
      RODAPE(this.botName),
    ].join('\n');
  }

  mensagemErroRede() {
    return [
      TOPO('AKINATOR'),
      '',
      `\u26a0\ufe0f N\u00e3o consegui conectar ao Akinator agora.`,
      '',
      `Tente novamente em alguns instantes.`,
      RODAPE(this.botName),
    ].join('\n');
  }

  mensagemInvalida() {
    return [
      TOPO('AKINATOR'),
      '',
      `\u{1F440} Responda com um dos bot\u00f5es:`,
      '',
      `\u2705 SIM`,
      `\u274c N\u00c3O`,
      `\u{1F914} N\u00c3O SEI`,
      `\u{1F7E2} PROVAVELMENTE`,
      `\u{1F534} PROVAVELMENTE N\u00c3O`,
      RODAPE(this.botName),
    ].join('\n');
  }

  get activeCount() {
    return this.sessions.size;
  }

  _cleanup() {
    const now = Date.now();
    for (const entry of Array.from(this.sessions.entries())) {
      const key = entry[0];
      const session = entry[1];
      const encerrada = session.state === 'FINISHED' || session.state === 'KO';
      if (encerrada || now - session.lastActivity > CONFIG.SESSION_TIMEOUT_MS) {
        session.client = null;
        this.sessions.delete(key);
      }
    }
  }
}

export {
  AkinatorManager,
  AkinatorGame,
  buildAnswerButtons,
  buildWinButtons,
  parseAnswerInput,
  toAnswerEnum,
  encurtar,
  percentual,
  sessionKey,
  CONFIG,
  BOTAO_PARA_RESPOSTA,
  EMOJI_RESPOSTA,
};

export default AkinatorManager;
