/**
 * HOT SEAT (+18) — brincadeira de 5 perguntas SIM / NAO / PULAR.
 *
 * Arquitetura (mesma familia do `tictactoe.js` / `connect4.js`):
 *   - um Mapa de sessoes EM MEMORIA, sem banco externo (a sessao e efemera);
 *   - `_cleanup()` periodico para nao deixar sessao orfa;
 *   - respostas por MENSAGEM NORMAL (nao existe "!responder"): o handler
 *     central do `index.js` chama `processMessage(...)` em toda mensagem e quem
 *     decide e o modulo.
 *
 * Isolamento: a chave da sessao e `groupId::participantId`. So o PARTICIPANTE
 * altera o estado — mensagem de qualquer outra pessoa e ignorada aqui (nao
 * consome a mensagem, so nao faz nada).
 *
 * O desenho das mensagens vem do `menus/layout.js` (fonte unica do layout da
 * bot): `bold`/`boldItalic`, caixas `꧁༺ ✦ ༻꧂` e o mesmo rodape dos menus.
 */

import { bold, boldItalic } from '../../menus/layout.js';
import { normalizar, getUserName } from '../../utils/helpers.js';

// --- CONFIGURACAO ---
const CONFIG = {
  QUESTIONS_PER_SESSION: 5,   // exatamente 5, mesmo com 100 no banco
  MAX_SKIPS: 2,               // teto de pulos por sessao
  SESSION_TIMEOUT_MS: 30 * 60 * 1000,   // 30 min sem atividade = expira
  CLEANUP_INTERVAL_MS: 5 * 60 * 1000,
};

// Estados da maquina (a sessao vive em WAITING_START e depois alterna
// WAITING_ANSWER / FINISHED; o numero da pergunta vem de `currentQuestion`).
const STATE = {
  WAITING_START: 'WAITING_START',
  WAITING_ANSWER: 'WAITING_ANSWER',
  FINISHED: 'FINISHED',
};

// --- LAYOUT (mesmo desenho do resto da bot) ---
const TOPO = (emoji, titulo) => `╭━━━꧁༺ ${emoji} ${bold(titulo)} ${emoji} ༻꧂━━━╮`;
const RODAPE = (botName) => `╰━━━꧁༺ ✦ ${botName} ✦ ༻꧂━━━╯`;
const BLOCO = (titulo, emoji = '') => `╭━━━꧁༺ ㅤ${emoji ? `${emoji} ` : ''}${boldItalic(titulo)}${emoji ? ` ${emoji}` : ''}ㅤ ༻꧂━━━╮`;

const EMOJI_NUM = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];

/** Chave da sessao: isola por grupo E por participante. */
const sessionKey = (groupId, participantId) => `${groupId}::${participantId}`;

/**
 * Normaliza a resposta para SIM / NAO / PULAR.
 *
 * Usa o `normalizar` do projeto (remove acentos + lowercase) — NAO cria um
 * segundo sistema de normalizacao. Devolve `null` quando nao e uma resposta
 * valida (o chamador decide o que fazer; aqui nao se "adivinha" intencao).
 */
function classifyAnswer(raw) {
  const t = normalizar(String(raw ?? '')).trim();
  if (!t) return null;
  // SIM
  if (['sim', 's', 'yes', 'y', 'claro', 'com certeza'].includes(t)) return 'SIM';
  // NAO (o normalizar ja tira o acento: "não" -> "nao")
  if (['nao', 'n', 'no', 'nunca', 'jamais'].includes(t)) return 'NAO';
  // PULAR
  if (['pular', 'pulo', 'passo', 'skip', 'pula', 'passar'].includes(t)) return 'PULAR';
  return null;
}

/** Confirmacao de inicio ("pronto para comecar"). */
function isStartConfirmation(raw) {
  const t = normalizar(String(raw ?? '')).trim().replace(/\s+/g, ' ');
  return [
    'pronto', 'pronta', 'pronto para comecar', 'pronta para comecar',
    'vamos', 'pode comecar', 'pode ir', 'bora', 'comecar', 'iniciar',
    'estou pronto', 'estou pronta', 'to pronto', 'to pronta',
  ].includes(t);
}

/** Sorteia N perguntas SEM repeticao a partir do banco. */
function pickQuestions(bank, count) {
  const pool = bank.map((q) => q.id);
  const picked = [];
  while (picked.length < count && pool.length > 0) {
    const idx = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(idx, 1)[0]);
  }
  return picked;
}

/**
 * Indice Hot: SIM / respostas validas * 100 (deterministico).
 * Respostas validas = SIM + NAO (pulo nao conta). Tudo pulado -> N/A (nunca
 * divide por zero).
 */
function computeHotIndex(responses) {
  const sim = responses.filter((r) => r.answer === 'SIM').length;
  const nao = responses.filter((r) => r.answer === 'NAO').length;
  const validas = sim + nao;
  if (validas === 0) return { sim, nao, validas, percent: null };
  return { sim, nao, validas, percent: Math.round((sim / validas) * 100) };
}

// --- MOTOR ---
class HotSeat {
  constructor({ groupId, participantId, initiatorId, questionIds }) {
    this.groupId = groupId;
    this.participantId = participantId;
    this.initiatorId = initiatorId;
    this.questions = questionIds;      // ids sorteados (5)
    this.currentQuestion = 0;          // indice da pergunta atual
    this.responses = [];               // { questionId, answer }
    this.skipsUsed = 0;
    this.maxSkips = CONFIG.MAX_SKIPS;
    this.state = STATE.WAITING_START;
    this.startedAt = Date.now();
    this.lastActivity = Date.now();
    this.finishedAt = null;
  }

  get total() {
    return this.questions.length;
  }

  /** Registra a resposta e avanca. Devolve o que o chamador deve enviar. */
  answer(raw) {
    this.lastActivity = Date.now();

    if (this.state === STATE.FINISHED) return { ok: false, reason: 'finished' };
    if (this.state === STATE.WAITING_START) return { ok: false, reason: 'not_started' };

    const kind = classifyAnswer(raw);
    if (!kind) return { ok: false, reason: 'invalid' };

    if (kind === 'PULAR') {
      if (this.skipsUsed >= this.maxSkips) {
        return { ok: false, reason: 'no_skips_left', skipsUsed: this.skipsUsed };
      }
      this.skipsUsed += 1;
      this.responses.push({ questionId: this.questions[this.currentQuestion], answer: 'PULAR' });
      this.currentQuestion += 1;
      const terminou = this.currentQuestion >= this.total;
      if (terminou) this._finish();
      return {
        ok: true,
        kind: 'PULAR',
        skipsUsed: this.skipsUsed,
        maxSkips: this.maxSkips,
        finished: terminou,
      };
    }

    this.responses.push({ questionId: this.questions[this.currentQuestion], answer: kind });
    this.currentQuestion += 1;
    const terminou = this.currentQuestion >= this.total;
    if (terminou) this._finish();
    return { ok: true, kind, finished: terminou };
  }

  _finish() {
    this.state = STATE.FINISHED;
    this.finishedAt = Date.now();
  }
}

// --- GERENCIADOR ---
class HotSeatManager {
  constructor(bank = []) {
    this.bank = bank;
    this.sessions = new Map();   // chave -> HotSeat
    this.cleanupTimer = setInterval(() => this._cleanup(), CONFIG.CLEANUP_INTERVAL_MS);
    // Nao segura o processo vivo por causa do timer (importante para os testes).
    if (this.cleanupTimer && typeof this.cleanupTimer.unref === 'function') {
      this.cleanupTimer.unref();
    }
  }

  /** Banco atual (permite recarregar depois, ex.: nos testes). */
  setBank(bank) {
    this.bank = Array.isArray(bank) ? bank : [];
  }

  get isAvailable() {
    return Array.isArray(this.bank) && this.bank.length >= CONFIG.QUESTIONS_PER_SESSION;
  }

  getSession(groupId, participantId) {
    return this.sessions.get(sessionKey(groupId, participantId)) || null;
  }

  /**
   * Cria a sessao e devolve a mensagem de abertura.
   * Recusa se o PARTICIPANTE ja estiver numa sessao ativa.
   */
  start({ groupId, participantId, initiatorId, botName = 'Bot' }) {
    if (!groupId || !participantId) return { success: false, reason: 'bad_args' };
    if (!this.isAvailable) return { success: false, reason: 'no_bank' };

    const atual = this.getSession(groupId, participantId);
    if (atual && atual.state !== STATE.FINISHED) {
      return { success: false, reason: 'already_in_session' };
    }

    const questionIds = pickQuestions(this.bank, CONFIG.QUESTIONS_PER_SESSION);
    const session = new HotSeat({ groupId, participantId, initiatorId, questionIds });
    this.sessions.set(sessionKey(groupId, participantId), session);

    const euMesmo = initiatorId === participantId;
    const verbo = euMesmo ? 'você acabou de sentar na' : 'você foi colocado(a) na';
    const quem = `@${getUserName(participantId)}`;

    const msg = [
      TOPO('🔥', 'HOT SEAT'),
      ``,
      `${quem}, ${verbo}`,
      `🪑 ${bold('CADEIRA QUENTE')}.`,
      ``,
      `Você terá ${bold(String(CONFIG.QUESTIONS_PER_SESSION))} perguntas escolhidas`,
      `aleatoriamente entre ${bold(String(this.bank.length))} disponíveis.`,
      ``,
      `Você poderá responder:`,
      `✅ ${bold('SIM')}`,
      `❌ ${bold('NÃO')}`,
      ``,
      `E terá direito a no máximo:`,
      `⏭️ ${bold(String(CONFIG.MAX_SKIPS) + ' PULOS')}`,
      ``,
      `Quando estiver preparado, envie:`,
      `"${bold('pronto para começar')}"`,
      ``,
      `👀 Depois disso, começa de verdade.`,
      RODAPE(botName),
    ].join('\n');

    return { success: true, message: msg, mentions: [participantId], session };
  }

  /**
   * Processa uma mensagem NORMAL do chat. Retorna:
   *   null                     -> nao era para o Hot Seat (segue o fluxo normal)
   *   { success, message, ... } -> o chamador deve enviar `message`
   *
   * IMPORTANTE: so o PARTICIPANTE da sessao tem efeito. Mensagem de qualquer
   * outra pessoa devolve `null` (e ignorada, sem responder nada).
   */
  processMessage({ groupId, participantId, text, botName = 'Bot' }) {
    if (!groupId || !participantId || !text) return null;
    const session = this.getSession(groupId, participantId);
    if (!session) return null;

    if (Date.now() - session.lastActivity > CONFIG.SESSION_TIMEOUT_MS) {
      this.sessions.delete(sessionKey(groupId, participantId));
      return {
        success: true,
        reason: 'timeout',
        message: `${TOPO('⏰', 'HOT SEAT')}\n\nO Hot Seat foi encerrado por inatividade.\n\n${RODAPE(botName)}`,
        mentions: [participantId],
      };
    }

    session.lastActivity = Date.now();

    // 1) Etapa obrigatoria: confirmacao de inicio.
    if (session.state === STATE.WAITING_START) {
      if (!isStartConfirmation(text)) {
        // Mensagem qualquer antes de comecar: nao consome, nao responde.
        return null;
      }
      session.state = STATE.WAITING_ANSWER;
      const msg = [
        TOPO('🔥', 'VALENDO!'),
        ``,
        `@${getUserName(participantId)}, agora não tem mais volta. 👀`,
        ``,
        this._renderQuestion(session),
      ].join('\n');
      return { success: true, kind: 'started', message: msg, mentions: [participantId] };
    }

    if (session.state === STATE.FINISHED) return null;

    // 2) Respostas da sessao ativa.
    const res = session.answer(text);

    if (!res.ok) {
      if (res.reason === 'invalid') {
        return {
          success: true,
          kind: 'invalid',
          message: `${TOPO('👀', 'HOT SEAT')}\n\nEssa cadeira só aceita:\n\n✅ ${bold('SIM')}\n❌ ${bold('NÃO')}\n⏭️ ${bold('PULAR')}\n\nTente novamente.\n\n${RODAPE(botName)}`,
          mentions: [participantId],
        };
      }
      if (res.reason === 'no_skips_left') {
        return {
          success: true,
          kind: 'no_skips_left',
          message: `${TOPO('🚫', 'SEM PULOS')}\n\nVocê já utilizou seus ${bold(String(session.maxSkips))} pulos.\n\nEssa pergunta precisa ser respondida com ${bold('SIM')} ou ${bold('NÃO')}.\n\n${RODAPE(botName)}`,
          mentions: [participantId],
        };
      }
      return null;
    }

    // 3) Pulo.
    if (res.kind === 'PULAR') {
      const restantes = res.maxSkips - res.skipsUsed;
      let cabeca;
      if (restantes > 0) {
        cabeca = `${TOPO('⏭️', 'PULADA')}\n\nVocê ainda possui:\n${bold(`${res.skipsUsed}/${res.maxSkips}`)} pulos utilizados.`;
      } else {
        cabeca = `${TOPO('⏭️', 'ÚLTIMO PULO')}\n\nVocê não possui mais pulos\nnesta sessão.`;
      }
      if (res.finished) {
        return {
          success: true,
          kind: 'skip_finished',
          message: `${cabeca}\n\n${this._renderResult(session, botName)}`,
          mentions: [participantId],
        };
      }
      return {
        success: true,
        kind: 'skipped',
        message: `${cabeca}\n\n🔥 Próxima pergunta...\n\n${this._renderQuestion(session)}`,
        mentions: [participantId],
      };
    }

    // 4) SIM / NAO.
    if (res.finished) {
      return {
        success: true,
        kind: 'finished',
        message: this._renderResult(session, botName),
        mentions: [participantId],
      };
    }
    return {
      success: true,
      kind: 'next',
      message: this._renderQuestion(session),
      mentions: [participantId],
    };
  }

  /** Cabecalho da pergunta atual no layout da bot. */
  _renderQuestion(session) {
    const q = this.bank.find((x) => x.id === session.questions[session.currentQuestion]);
    const texto = q ? q.text : '(pergunta indisponível)';
    return [
      `${TOPO('🪑', `PERGUNTA ${session.currentQuestion + 1}/${session.total}`)}`,
      ``,
      texto,
      ``,
      `Responda:`,
      `✅ ${bold('SIM')}`,
      `❌ ${bold('NÃO')}`,
      `⏭️ ${bold('PULAR')}`,
    ].join('\n');
  }

  /** Resultado final: contagem, Indice Hot e a lista das 5 respostas. */
  _renderResult(session, botName = 'Bot') {
    const { sim, nao, validas, percent } = computeHotIndex(session.responses);
    const pulos = session.responses.filter((r) => r.answer === 'PULAR').length;

    const linhasRespostas = session.responses.map((r, i) => {
      const q = this.bank.find((x) => x.id === r.questionId);
      const marca = r.answer === 'SIM' ? '✅ SIM' : r.answer === 'NAO' ? '❌ NÃO' : '⏭️ PULADA';
      return `${EMOJI_NUM[i] ?? `${i + 1}.`} ${q ? q.text : '(pergunta)'}\n   ${marca}`;
    });

    return [
      TOPO('🔥', 'HOT SEAT FINALIZADO'),
      ``,
      `@${getUserName(session.participantId)}, você sobreviveu à`,
      `🪑 ${bold('CADEIRA QUENTE')}.`,
      ``,
      BLOCO('RESULTADO', '📊'),
      `✅ ${bold('SIM')}: ${sim}`,
      `❌ ${bold('NÃO')}: ${nao}`,
      `⏭️ ${bold('PULOS')}: ${pulos}`,
      ``,
      `🔥 ${bold('ÍNDICE HOT')}: ${percent === null ? 'N/A' : `${percent}%`}`,
      RODAPE(botName),
      ``,
      BLOCO('SUAS RESPOSTAS', '📋'),
      ...linhasRespostas,
      RODAPE(botName),
      ``,
      fraseFinal(),
    ].join('\n');
  }

  endSession(groupId, participantId) {
    return this.sessions.delete(sessionKey(groupId, participantId));
  }

  /** Quantas sessoes ativas existem (diagnostico/testes). */
  get activeCount() {
    return this.sessions.size;
  }

  _cleanup() {
    const now = Date.now();
    for (const [key, session] of this.sessions.entries()) {
      if (session.state === STATE.FINISHED) {
        // Sessao encerrada: pode sair do mapa. O participante pode comecar outra.
        this.sessions.delete(key);
        continue;
      }
      if (now - session.lastActivity > CONFIG.SESSION_TIMEOUT_MS) {
        this.sessions.delete(key);
        console.log(`[HOTSEAT Cleanup] Sessão expirada removida (${key})`);
      }
    }
  }
}

// Frases finais — varias para nao repetir sempre a mesma.
const FRASES_FINAIS = [
  '🔥 A cadeira esfriou... mas algumas respostas ficaram quentes.',
  '👀 Você entrou voluntariamente nessa cadeira.',
  '🪑 A sessão acabou. As respostas, porém, ficaram registradas.',
  '🔥 Cinco perguntas depois, agora já sabemos algumas coisas sobre você.',
  '👀 Você sobreviveu. Mas será que responderia tudo de novo?',
  '🌶️ A cadeira ficou quente hoje.',
  '😂 Você poderia ter escolhido "pular"... mas escolheu responder.',
  '😏 Respondeu com coragem. Pelo menos é o que dizem.',
  '🫣 Algumas dessas respostas ninguém vai esquecer.',
  '🍿 Foi divertido. Vamos ver se você repete na próxima.',
];
function fraseFinal() {
  return FRASES_FINAIS[Math.floor(Math.random() * FRASES_FINAIS.length)];
}

export {
  HotSeatManager,
  HotSeat,
  classifyAnswer,
  isStartConfirmation,
  pickQuestions,
  computeHotIndex,
  fraseFinal,
  sessionKey,
  STATE,
  CONFIG,
  FRASES_FINAIS,
};

export default { HotSeatManager, HotSeat, classifyAnswer, isStartConfirmation, pickQuestions, computeHotIndex };
