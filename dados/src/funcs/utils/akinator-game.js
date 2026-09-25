/**
 * CAMADA DE JOGO do !akinator -- sessoes, correcoes e persistencia.
 *
 * Este arquivo NAO tem matematica: ele orquestra o `Engine` (akinator-engine.js)
 * e cuida de:
 *   - sessoes independentes por `chatId::userId` (FASE 11);
 *   - expiracao por inatividade (FASE 12);
 *   - cancelamento (FASE 13);
 *   - correcoes em FILA, com votos, sem entrar direto na base (FASE 15/16);
 *   - persistencia SEPARADA: base (repo) / aprendido (database) / pendentes
 *     (database) -- tres arquivos, tres responsabilidades (FASE 22);
 *   - a interface (layout) no padrao da Lizzy (FASE 10).
 *
 * Nao cria listener: o handler central ja chama `processMessage` (FASE 20).
 */

import fs from 'fs';
import path from 'path';
import { bold } from '../../menus/layout.js';
import { normalizar } from '../../utils/helpers.js';
import { Engine, KnowledgeBase, ANSWER_VALUE, CONFIG as ENGINE_CONFIG } from './akinator-engine.js';
import {
  carregarClient,
  iniciarRemoto,
  responderRemoto,
  palpiteRemoto,
  testarRemoto,
  mapaRespostas,
} from './akinator-remote.js';

const CONFIG = {
  SESSION_TIMEOUT_MS: 30 * 60 * 1000,
  CLEANUP_INTERVAL_MS: 5 * 60 * 1000,
  // --- base remota ---
  // A base GRANDE nao fica no repositorio do bot (pesaria no pull). O comando
  // baixa de uma URL e guarda num CACHE local: o download acontece uma vez por
  // TTL, nao a cada partida.
  CACHE_TTL_MS: 24 * 60 * 60 * 1000,   // 1 dia
  FETCH_TIMEOUT_MS: 30 * 1000,
  MAX_BYTES: 12 * 1024 * 1024,          // teto de seguranca do arquivo
  // --- modo remoto (akinator-client) ---
  // O dono pediu para o bot usar o REMOTO EXCLUSIVAMENTE: nao existe mais
  // fallback silencioso pro engine proprio. Se o Akinator.com nao responder
  // (rede, Cloudflare, etc.), o comando AVISA e nao joga -- em vez de trocar de
  // motor sem o usuario saber.
  MODO_REMOTO_PADRAO: 'remoto',         // 'remoto' | 'local'
  REMOTO_EXCLUSIVO: true,               // true = sem fallback pro engine local
  REMOTO_TIMEOUT_MS: 25 * 1000,
};


// --- LAYOUT (mesmo desenho do resto da bot) ---
const TOPO = (titulo, emoji) => {
  const e = emoji === undefined ? '\u{1F52E}' : emoji;
  return `\u256d\u2501\u2501\u2501\ua9c1\u0f3a ${e} ${bold(titulo)} ${e} \u0f3b\ua9c2\u2501\u2501\u2501\u256e`;
};
const RODAPE = (botName) => `\u2570\u2501\u2501\u2501\ua9c1\u0f3a \u2726 ${botName} \u2726 \u0f3b\ua9c2\u2501\u2501\u2501\u256f`;

const sessionKey = (chatId, userId) => `${chatId}::${userId}`;

/** Rotulos das 5 respostas (FASE 9). */
const ROTULO = {
  SIM: { emoji: '\u2705', texto: 'SIM' },
  NAO: { emoji: '\u274c', texto: 'N\u00c3O' },
  NAO_SEI: { emoji: '\u{1F937}', texto: 'N\u00c3O SEI' },
  PROVAVELMENTE: { emoji: '\u{1F7E1}', texto: 'PROVAVELMENTE' },
  PROVAVELMENTE_NAO: { emoji: '\u{1F535}', texto: 'PROVAVELMENTE N\u00c3O' },
};

/** id do botao -> chave da resposta. O id carrega a sessao (posse no callback). */
const BOTAO_PARA_RESPOSTA = {
  ak_sim: 'SIM',
  ak_nao: 'NAO',
  ak_nao_sei: 'NAO_SEI',
  ak_provavelmente: 'PROVAVELMENTE',
  ak_provavelmente_nao: 'PROVAVELMENTE_NAO',
};

/**
 * Botao no formato de fio que o `sendInteractiveMessage` do projeto ja envia.
 * O `id` traz o `sessionId`, entao a POSSE e validada sem mapa global.
 */
const botaoWired = (sessionId, chave) => {
  const r = ROTULO[chave];
  return {
    name: 'quick_reply',
    buttonParamsJson: JSON.stringify({ display_text: `${r.emoji} ${r.texto}`, id: `${sessionId}:ak_${chave.toLowerCase()}` }),
  };
};

function buildAnswerButtons(sessionId) {
  return ['SIM', 'NAO', 'NAO_SEI', 'PROVAVELMENTE', 'PROVAVELMENTE_NAO'].map((k) => botaoWired(sessionId, k));
}

const botaoWiredTexto = (sessionId, texto, chave) => ({
  name: 'quick_reply',
  buttonParamsJson: JSON.stringify({ display_text: texto, id: `${sessionId}:${chave}` }),
});

function buildGuessButtons(sessionId) {
  return [
    botaoWiredTexto(sessionId, '\u2705 ACERTOU', 'ak_acertou'),
    botaoWiredTexto(sessionId, '\u274c ERREI', 'ak_errou'),
  ];
}

/**
 * Interpreta a entrada do usuario: id de botao OU texto digitado.
 * Reusa o `normalizar` do projeto (nada de segundo normalizador).
 */
function parseInput(raw) {
  const t = String(raw === undefined || raw === null ? '' : raw).trim();
  if (!t) return null;

  const m = t.match(/^([A-Za-z0-9_-]+):(ak_[a-z_]+)$/);
  if (m) {
    const chave = m[2];
    if (chave === 'ak_acertou') return { sessionId: m[1], resposta: 'ACERTOU' };
    if (chave === 'ak_errou') return { sessionId: m[1], resposta: 'ERROU' };
    const r = BOTAO_PARA_RESPOSTA[chave];
    if (r) return { sessionId: m[1], resposta: r };
    return null;
  }

  const n = normalizar(t).replace(/\s+/g, ' ').trim();
  if (!n || n.length > 30 || /[:\/]/.test(n)) return null;
  if (['sim', 's', 'yes'].includes(n)) return { sessionId: null, resposta: 'SIM' };
  if (['nao', 'n', 'no'].includes(n)) return { sessionId: null, resposta: 'NAO' };
  if (['nao sei', 'naosei', 'idk'].includes(n)) return { sessionId: null, resposta: 'NAO_SEI' };
  if (['provavelmente', 'provavel'].includes(n)) return { sessionId: null, resposta: 'PROVAVELMENTE' };
  if (['provavelmente nao'].includes(n)) return { sessionId: null, resposta: 'PROVAVELMENTE_NAO' };
  if (['acertou', 'acertei'].includes(n)) return { sessionId: null, resposta: 'ACERTOU' };
  if (['errei', 'errou'].includes(n)) return { sessionId: null, resposta: 'ERROU' };
  return null;
}

/** Le/grava JSON de forma tolerante (nunca derruba o jogo por arquivo ruim). */
function lerJson(file, padrao) {
  try {
    if (!fs.existsSync(file)) return padrao;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (e) {
    console.warn('[AKINATOR] arquivo invalido, usando padrao:', file, e && e.message);
    return padrao;
  }
}
function gravarJson(file, dados) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(dados, null, 2));
    fs.renameSync(tmp, file);
    return true;
  } catch (e) {
    console.warn('[AKINATOR] falha ao gravar:', file, e && e.message);
    return false;
  }
}

/**
 * Baixa uma base de personagens por URL, com cache em disco.
 *
 * Por que existe: a base grande (milhares de personagens) nao deve ficar no
 * repositorio do bot -- ela engorda o clone e o `git pull` de todos. Aqui o
 * comando busca de uma URL (ex.: um branch de dados no GitHub) e guarda um
 * cache local; so baixa de novo quando o cache vence (CACHE_TTL_MS).
 *
 * Resiliencia: se a rede falhar e houver cache, usa o cache; se nao houver
 * cache, cai na base local do repo. Nunca derruba o comando.
 *
 * @param {object} p
 * @param {string}  p.url        URL da base remota
 * @param {string}  p.cacheFile  caminho do cache local
 * @param {string[]} p.locais    arquivos locais de fallback (na ordem)
 * @param {number} [p.ttlMs]     validade do cache
 * @param {Function} [p.fetchImpl] fetch injetavel (testes)
 * @param {boolean} [p.forcar]   ignora o TTL e baixa agora
 * @returns {Promise<{characters:Array, origem:string, erro:string|null}>}
 */
async function carregarBase({ url, urls, cacheFile, locais = [], ttlMs, fetchImpl, forcar = false } = {}) {
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  const ttl = ttlMs === undefined ? CONFIG.CACHE_TTL_MS : ttlMs;
  // Aceita UMA url ou uma LISTA (`urls`). Com varias fontes, o dono pode ter o
  // repositorio dele E o padrao ao mesmo tempo -- as bases somam.
  const listaUrls = (Array.isArray(urls) ? urls : (url ? [url] : []))
    .map((u) => String(u || '').trim())
    .filter(Boolean);

  const lerArquivo = (f) => {
    try {
      if (!f || !fs.existsSync(f)) return null;
      const d = JSON.parse(fs.readFileSync(f, 'utf-8'));
      const lista = Array.isArray(d) ? d : d.characters;
      return Array.isArray(lista) && lista.length ? lista : null;
    } catch (e) {
      console.warn('[AKINATOR] arquivo de base invalido:', f, e && e.message);
      return null;
    }
  };

  // 1) cache valido?
  const meta = (() => {
    try { return cacheFile && fs.existsSync(cacheFile) ? fs.statSync(cacheFile).mtimeMs : 0; } catch (e) { return 0; }
  })();
  // A idade precisa ser ">= 0" para valer, mas com TOLERANCIA: o `mtime` pode
  // ficar alguns ms ADIANTADO em relacao ao relogio (resolucao do FS / skew),
  // e um cache recem-escrito parecia "vencido" (idade negativa). Antes isso dava
  // "cache valido" mesmo com TTL 0 (o bug antigo); agora exigimos `>= 0` mas
  // tratamos uma folga pequena de skew como "recem escrito" = valido.
  const SKEW_TOLERANCIA_MS = 60 * 1000;
  const idade = meta ? Date.now() - meta : -1;
  const idadeValida = meta > 0 && idade >= -SKEW_TOLERANCIA_MS;
  const idadeParaTtl = Math.max(0, idade);
  const ttlEfetivo = Number.isFinite(ttl) && ttl > 0 ? ttl : 0;
  if (!forcar && idadeValida && idadeParaTtl < ttlEfetivo) {
    const emCache = lerArquivo(cacheFile);
    if (emCache) return { characters: emCache, origem: 'cache', erro: null };
  }

  // 2) tenta baixar (de UMA OU MAIS fontes; as bases somam)
  let erro = null;
  if (listaUrls.length && doFetch) {
    const todas = [];
    const usadas = [];
    const ids = new Set();
    for (const u of listaUrls) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), CONFIG.FETCH_TIMEOUT_MS);
        try {
          const r = await doFetch(u, { signal: ctrl.signal, headers: { 'User-Agent': 'LizzyAkinator/1.0' } });
          if (!r || !r.ok) throw new Error(`HTTP ${r && r.status}`);
          const texto = await r.text();
          if (texto.length > CONFIG.MAX_BYTES) throw new Error('arquivo acima do teto');
          const d = JSON.parse(texto);
          const lista = Array.isArray(d) ? d : d.characters;
          if (!Array.isArray(lista) || !lista.length) throw new Error('base vazia');
          let novos = 0;
          for (const c of lista) {
            if (!c || !c.id || ids.has(c.id)) continue;
            ids.add(c.id);
            todas.push(c);
            novos++;
          }
          usadas.push({ url: u, personagens: novos });
        } finally {
          clearTimeout(timer);
        }
      } catch (e) {
        // uma fonte ruim nao derruba as outras
        const msg = e && e.message ? e.message : String(e);
        erro = erro ? `${erro}; ${msg}` : msg;
        console.warn(`[AKINATOR] falha ao baixar ${u}:`, msg);
      }
    }
    if (todas.length) {
      if (cacheFile) {
        try {
          gravarJson(cacheFile, { meta: { descricao: 'cache da base remota do akinator', sources: usadas }, characters: todas });
        } catch (e) { console.warn('[AKINATOR] nao consegui gravar o cache:', e && e.message); }
      }
      return { characters: todas, origem: 'remoto', fontes: usadas, erro };
    }
  }

  // 3) cache vencido mas existente (rede caiu)
  const emCache = lerArquivo(cacheFile);
  if (emCache) return { characters: emCache, origem: 'cache-expirado', erro };

  // 4) fallback local (repo)
  for (const f of locais) {
    const l = lerArquivo(f);
    if (l) return { characters: l, origem: 'local', erro };
  }
  return { characters: [], origem: 'indisponivel', erro };
}

// --- GERENCIADOR ---
class AkinatorGameManager {
  /**
   * @param {object} deps
   * @param {Array}  deps.questions   banco de perguntas (repo)
   * @param {Array}  deps.characters  base de personagens (repo)
   * @param {string} deps.learnedFile caminho do arquivo de aprendizado
   * @param {string} deps.pendingFile caminho do arquivo de correcoes pendentes
   * @param {string} [deps.botName]
   */
  constructor(deps = {}) {
    this.questions = Array.isArray(deps.questions) ? deps.questions : [];
    this.baseCharacters = Array.isArray(deps.characters) ? deps.characters : [];
    this.learnedFile = deps.learnedFile || null;
    this.pendingFile = deps.pendingFile || null;
    this.botName = deps.botName || 'Bot';

    // Aprendido e pendentes ficam FORA da base autoral (FASE 22).
    this.learned = this.learnedFile ? lerJson(this.learnedFile, {}) : {};
    this.pending = this.pendingFile ? lerJson(this.pendingFile, []) : [];

    // Modo de jogo: 'remoto' (padrao, akinator-client) ou 'local' (engine
    // proprio). O remoto e' EXCLUSIVO por padrao: nada de fallback silencioso.
    // `remotoExclusivo` pode ser desligado por deps/env, mas o padrao e' ligado.
    this.modoPedido = String(deps.modo || CONFIG.MODO_REMOTO_PADRAO).toLowerCase() === 'local'
      ? 'local'
      : 'remoto';
    this.remotoExclusivo = deps.remotoExclusivo === undefined
      ? CONFIG.REMOTO_EXCLUSIVO
      : !!deps.remotoExclusivo;
    if (String(process.env.AKINATOR_REMOTO_FALLBACK || '').toLowerCase() === 'local') {
      this.remotoExclusivo = false;
    }
    this.modoEfetivo = this.modoPedido;
    this.remotoMod = null;
    this.remotoValores = null;
    this.remotoMotivo = null;
    this.remotoOpcoes = deps.remotoOpcoes || {
      proxy: process.env.AKINATOR_PROXY || undefined,
      scraperApiKey: process.env.SCRAPERAPI_KEY || undefined,
      retries: Number.isFinite(Number(process.env.AKINATOR_RETRIES))
        ? Number(process.env.AKINATOR_RETRIES)
        : 2,
    };

    this.sessions = new Map();
    this._seq = 0;
    this.cleanupTimer = setInterval(() => this._cleanup(), CONFIG.CLEANUP_INTERVAL_MS);
    if (this.cleanupTimer && typeof this.cleanupTimer.unref === 'function') this.cleanupTimer.unref();
  }

  /**
   * Prepara o modo remoto. Faz um START de teste: se o Akinator responder, liga
   * o remoto; se nao, guarda o motivo.
   *
   * No modo EXCLUSIVO (padrao) uma falha NAO troca para o engine proprio: o
   * comando passa a avisar que o Akinator esta indisponivel. Assim ninguem
   * recebe um jogo diferente do que foi pedido sem perceber.
   */
  async prepararModo() {
    if (this.modoPedido !== 'remoto') {
      this.modoEfetivo = 'local';
      this.remotoMotivo = 'modo local (AKINATOR_MODE=local)';
      return { modo: this.modoEfetivo, motivo: this.remotoMotivo };
    }
    const teste = await testarRemoto({
      options: this.remotoOpcoes,
      timeoutMs: CONFIG.REMOTO_TIMEOUT_MS,
    });
    if (teste.ok) {
      this.remotoMod = teste.mod;
      this.remotoValores = mapaRespostas(teste.mod);
      this.modoEfetivo = 'remoto';
      this.remotoMotivo = null;
      console.log('[AKINATOR] modo REMOTO ativo (akinator-client)');
    } else {
      // Sem fallback: continua em 'remoto', so' que indisponivel.
      this.modoEfetivo = 'remoto';
      this.remotoMotivo = teste.motivo;
      if (this.remotoExclusivo) {
        console.warn(`[AKINATOR] modo remoto INDISPONIVEL (sem fallback): ${teste.motivo}`);
      } else {
        this.modoEfetivo = 'local';
        console.warn(`[AKINATOR] modo remoto indisponivel -> usando o LOCAL: ${teste.motivo}`);
      }
    }
    return { modo: this.modoEfetivo, motivo: this.remotoMotivo, exclusivo: this.remotoExclusivo };
  }

  /** O remoto esta' realmente pronto para atender? */
  get remotoAtivo() {
    return this.modoEfetivo === 'remoto' && !!this.remotoMod && !!this.remotoValores;
  }


  /** A base esta utilizavel? (FASE 29: KNOWLEDGE_INVALID) */
  get disponivel() {
    return this.questions.length > 0 && this.baseCharacters.length > 0;
  }

  get activeCount() {
    return this.sessions.size;
  }

  /** Personagens = base autoral + o que foi aprovado (correcoes promovidas). */
  get characters() {
    return this.baseCharacters.concat(this.promovidos || []);
  }

  /** Cria uma KB nova por partida (isolamento: ninguem compartilha estado). */
  _novaKb() {
    const kb = new KnowledgeBase({
      questions: this.questions,
      characters: this.characters,
      learned: this.learned,
    });
    return kb;
  }

  getSession(chatId, userId) {
    return this.sessions.get(sessionKey(chatId, userId)) || null;
  }

  /**
   * Acrescenta personagens vindos de fora (ex.: base remota) sem apagar o que
   * ja existe. Usado na subida do bot e depois de um donwload em runtime.
   * Ignora id repetido (a base local tem prioridade).
   */
  adicionarPersonagens(lista) {
    if (!Array.isArray(lista) || !lista.length) return 0;
    const ids = new Set(this.baseCharacters.map((c) => c.id));
    let n = 0;
    for (const c of lista) {
      if (!c || !c.id || ids.has(c.id)) continue;
      ids.add(c.id);
      this.baseCharacters.push(c);
      n++;
    }
    if (n > 0) this.promovidos = this.promovidos || [];
    return n;
  }

  /**
   * Inicia uma partida. Nao cria duas para o mesmo usuario no mesmo chat
   * (FASE 11) e nunca interfere em partidas de outros.
   *
   * No modo LOCAL devolve o resultado na hora (sincrono). No modo REMOTO o
   * START e' uma chamada de rede, entao devolve uma Promise -- o handler do
   * comando faz `await` nos dois casos, entao a interface nao muda.
   */
  iniciar({ chatId, userId }) {
    if (!chatId || !userId) return { success: false, reason: 'bad_args' };

    const atual = this.getSession(chatId, userId);
    if (atual && atual.estado !== 'FIM') return { success: false, reason: 'ja_em_partida' };

    if (this.modoEfetivo === 'remoto') return this._iniciarRemoto({ chatId, userId });

    if (!this.disponivel) return { success: false, reason: 'knowledge_invalid' };
    return this._iniciarLocal({ chatId, userId });
  }

  /** Partida com o engine proprio (sincrono). */
  _iniciarLocal({ chatId, userId }) {
    this._seq += 1;
    const sessionId = `ak${Date.now().toString(36)}${this._seq.toString(36)}`;
    const engine = new Engine(this._novaKb());
    const sessao = {
      sessionId,
      chatId,
      userId,
      modo: 'local',
      engine,
      estado: 'PERGUNTANDO',   // PERGUNTANDO | PALPITE | INFORMAR | FIM
      perguntaIdx: -1,
      ultimoPalpite: null,
      criadaEm: Date.now(),
      ultimaAtividade: Date.now(),
      perguntas: 0,
    };
    this.sessions.set(sessionKey(chatId, userId), sessao);

    const proxima = this._proximaPergunta(sessao);
    return { success: true, sessionId, ...proxima };
  }

  /** Partida com o Akinator.com (assincrono). */
  async _iniciarRemoto({ chatId, userId }) {
    // Sem o modulo pronto (o START de teste falhou) o remoto nao tem como jogar:
    // avisa em vez de trocar de motor nas escondidas.
    if (!this.remotoAtivo && this.remotoExclusivo) {
      return { success: false, reason: 'remoto_indisponivel', motivo: this.remotoMotivo };
    }
    this._seq += 1;
    const sessionId = `akr${Date.now().toString(36)}${this._seq.toString(36)}`;
    try {
      const { client, resultado } = await iniciarRemoto({
        mod: this.remotoMod,
        options: this.remotoOpcoes,
      });
      const sessao = {
        sessionId,
        chatId,
        userId,
        modo: 'remoto',
        client,
        estado: 'PERGUNTANDO',
        perguntaAtual: null,
        ultimoPalpite: null,
        criadaEm: Date.now(),
        ultimaAtividade: Date.now(),
        perguntas: 0,
      };
      this.sessions.set(sessionKey(chatId, userId), sessao);
      return { success: true, sessionId, ...this._proximaRemota(sessao, resultado) };
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      this.remotoMotivo = msg;
      // EXCLUSIVO: nao cai pro engine proprio. AVISA e nao inicia a partida.
      if (this.remotoExclusivo) {
        console.warn(`[AKINATOR] START remoto falhou (sem fallback): ${msg}`);
        return { success: false, reason: 'remoto_indisponivel', motivo: msg };
      }
      // Nao-exclusivo: cai pro local (comportamento antigo, opt-in).
      console.warn(`[AKINATOR] START remoto falhou, caindo pro local: ${msg}`);
      this.modoEfetivo = 'local';
      return this._iniciarLocal({ chatId, userId });
    }
  }


  /** Monta a mensagem da pergunta (comum aos dois modos). */
  _renderPerguntaTexto(texto, numero) {
    return [
      TOPO('AKINATOR'),
      '',
      `\u2753 ${bold('Pergunta ' + numero + ':')}`,
      ``,
      texto,
      RODAPE(this.botName),
    ].join('\n');
  }

  /**
   * Traduz o estado devolvido pelo Akinator (pergunta ou palpite) para o
   * formato da interface. `resultado.kind`:
   *   'pergunta'      -> proxima pergunta
   *   'palpite'       -> acertou (won)
   *   'sem_candidato' -> ko
   *   'erro'          -> falha de rede
   */
  _proximaRemota(sessao, resultado) {
    if (!resultado || resultado.kind === 'erro') {
      // Falha no meio do jogo: encerra a sessao sem quebrar o comando.
      this.sessions.delete(sessionKey(sessao.chatId, sessao.userId));
      return {
        kind: 'erro_remoto',
        message: `${TOPO('AKINATOR')}\n\n\u26a0\ufe0f O Akinator n\u00e3o respondeu agora.\nTente de novo em instantes.\n\n${RODAPE(this.botName)}`,
      };
    }

    if (resultado.kind === 'palpite') {
      const char = palpiteRemoto(sessao.client) || {
        name: '?', category: 'akinator', description: '', imageUrl: null,
      };
      sessao.estado = 'PALPITE';
      sessao.ultimoPalpite = char;
      return {
        kind: 'palpite',
        message: this._renderPalpite(char, resultado.percentual || 0),
        buttons: buildGuessButtons(sessao.sessionId),
        imageUrl: char.imageUrl || undefined,
      };
    }

    if (resultado.kind === 'sem_candidato') {
      this.sessions.delete(sessionKey(sessao.chatId, sessao.userId));
      return {
        kind: 'sem_candidato',
        message: [
          TOPO('AKINATOR'),
          '',
          `\u{1F914} N\u00e3o consegui chegar a nenhum personagem.`,
          '',
          `Tente de novo com outro personagem.`,
          RODAPE(this.botName),
        ].join('\n'),
      };
    }

    sessao.estado = 'PERGUNTANDO';
    sessao.perguntaAtual = resultado.pergunta;
    sessao.perguntas += 1;
    return {
      kind: 'pergunta',
      message: this._renderPerguntaTexto(resultado.pergunta, sessao.perguntas),
      buttons: buildAnswerButtons(sessao.sessionId),
    };
  }

  /** Escolhe a proxima pergunta (ou o palpite, se ja for hora). */
  _proximaPergunta(sessao) {
    const e = sessao.engine;

    if (e.semPerguntas || e.atingiuTeto || e.podePalpitar) {
      return this._montarPalpite(sessao);
    }
    const j = e.selectNextQuestion();
    if (j < 0) return this._montarPalpite(sessao);

    sessao.perguntaIdx = j;
    sessao.perguntas = e.askedCount + 1;
    e.kb.usage[j] = (e.kb.usage[j] || 0) + 1;
    const q = this.questions[j];
    return {
      kind: 'pergunta',
      message: this._renderPergunta(q, sessao.perguntas),
      buttons: buildAnswerButtons(sessao.sessionId),
    };
  }

  _montarPalpite(sessao) {
    const { char, p } = sessao.engine.bestGuess();
    if (!char) {
      sessao.estado = 'FIM';
      this.sessions.delete(sessionKey(sessao.chatId, sessao.userId));
      return {
        kind: 'sem_candidato',
        message: [
          TOPO('AKINATOR'),
          '',
          `\u{1F914} N\u00e3o consegui chegar a nenhum personagem.`,
          '',
          `Tente de novo com outro personagem.`,
          RODAPE(this.botName),
        ].join('\n'),
      };
    }
    sessao.estado = 'PALPITE';
    sessao.ultimoPalpite = char;
    return {
      kind: 'palpite',
      message: this._renderPalpite(char, Math.round(p * 100)),
      buttons: buildGuessButtons(sessao.sessionId),
    };
  }

  /**
   * Processa uma mensagem. Devolve `null` quando NAO e para o Akinator (segue o
   * fluxo normal do bot) -- mesma convencao do hotseat/akinator antigo.
   */
  processMessage({ chatId, userId, text }) {
    if (!chatId || !userId || !text) return null;

    // A SESSAO vem antes do parse: no estado INFORMAR o usuario manda o NOME do
    // personagem (texto livre), que nao e resposta de botao. Se parseassemos
    // primeiro, esse texto cairia em `null` e a correcao nunca seria registrada.
    const sessao = this.getSession(chatId, userId);
    if (!sessao) return null;

    const parsed = parseInput(text);
    if (!parsed && sessao.estado !== 'INFORMAR') return null;
    const entrada = parsed || { sessionId: null, resposta: null };

    // Expiracao (FASE 12).
    if (Date.now() - sessao.ultimaAtividade > CONFIG.SESSION_TIMEOUT_MS) {
      this.sessions.delete(sessionKey(chatId, userId));
      return {
        success: true,
        reason: 'expired',
        message: `${TOPO('AKINATOR')}\n\n\u{1F52E} A partida foi encerrada por inatividade.\n\n${RODAPE(this.botName)}`,
      };
    }

    // O id do botao aponta para uma partida; se nao for a DESTA sessao, recusa.
    if (entrada.sessionId && entrada.sessionId !== sessao.sessionId) {
      return { success: true, reason: 'nao_e_sua', message: '\u274c Essa partida n\u00e3o pertence a voc\u00ea.' };
    }

    if (sessao.estado === 'FIM') {
      return { success: true, reason: 'ja_encerrada', message: '\u26a0\ufe0f Essa partida j\u00e1 foi encerrada.' };
    }

    sessao.ultimaAtividade = Date.now();

    // --- Sessao REMOTA: pergunta/palpite vivem no Akinator.com ---
    if (sessao.modo === 'remoto') return this._processarRemoto(sessao, entrada, text);

    // --- Etapa de INFORMAR o personagem (depois de errar) ---
    if (sessao.estado === 'INFORMAR') {
      const nome = String(text).trim().slice(0, 60);
      // Texto que e resposta de botao nao vale como nome.
      if (entrada.sessionId || /^[A-Za-z0-9_-]+:ak_/.test(nome)) return null;
      const r = this._registrarCorrecao(sessao, nome);
      return { success: true, kind: 'correcao', message: r };
    }

    // --- Palpite: ACERTOU / ERREI ---
    if (sessao.estado === 'PALPITE') {
      if (entrada.resposta === 'ACERTOU') return { success: true, ...this._confirmarAcerto(sessao) };
      if (entrada.resposta === 'ERROU') {
        sessao.estado = 'INFORMAR';
        return {
          success: true,
          kind: 'informar',
          message: [
            TOPO('AKINATOR'),
            '',
            `\u274c Errei, foi mal!`,
            '',
            `Voc\u00ea pode me dizer quem era o personagem.`,
            `Assim eu aprendo para a pr\u00f3xima.`,
            '',
            `_Envie o nome, ou escreva ${bold('pular')} para encerrar._`,
            RODAPE(this.botName),
          ].join('\n'),
        };
      }
      return { success: true, kind: 'invalido', message: this._mensagemInvalidaPalpite() };
    }

    // --- Pergunta: resposta do usuario ---
    if (!entrada.resposta || !ANSWER_VALUE.hasOwnProperty(entrada.resposta)) {
      return { success: true, kind: 'invalido', message: this._mensagemInvalida() };
    }
    const valor = ANSWER_VALUE[entrada.resposta];
    const j = sessao.perguntaIdx;
    if (j < 0) return null;
    sessao.engine.applyAnswer(j, valor);
    return { success: true, ...this._proximaPergunta(sessao) };
  }

  /**
   * Processa uma mensagem de uma sessao REMOTA. Assincrono: cada resposta e'
   * uma chamada de rede. Em falha, encerra a sessao com aviso (sem quebrar).
   */
  async _processarRemoto(sessao, entrada, text) {
    // Palpite remoto: ACERTOU / ERREI.
    if (sessao.estado === 'PALPITE') {
      if (entrada.resposta === 'ACERTOU') {
        const char = sessao.ultimoPalpite;
        this.sessions.delete(sessionKey(sessao.chatId, sessao.userId));
        console.log(`[AKINATOR] sessao remota finalizada | acerto=${char ? char.name : '?'} | perguntas=${sessao.perguntas}`);
        return {
          success: true,
          kind: 'acertou',
          message: [
            TOPO('AKINATOR'),
            '',
            `\u{1F3AF} ${bold('Acertei!')} \u{1F60E}`,
            ``,
            `Era ${bold(char ? char.name : '?')}.`,
            char && char.description ? `\u{1F4DD} ${char.description}` : '',
            ``,
            `\u{1F52E} Partida encerrada.`,
            RODAPE(this.botName),
          ].filter((l) => l !== '').join('\n'),
        };
      }
      if (entrada.resposta === 'ERROU') {
        // No remoto nao ha "ensinar em texto": o Akinator trabalha com a base
        // dele, e as perguntas dele nao sao as nossas -- nao da' para virar
        // atributo do motor local. So agradece e encerra.
        this.sessions.delete(sessionKey(sessao.chatId, sessao.userId));
        return {
          success: true,
          kind: 'errou',
          message: `${TOPO('AKINATOR')}\n\n\u{1F64F} Errei mesmo. Obrigado por jogar!\n\n${RODAPE(this.botName)}`,
        };
      }
      return { success: true, kind: 'invalido', message: this._mensagemInvalidaPalpite() };
    }

    // Pergunta remota: precisa de uma resposta valida (enum do pacote).
    if (!entrada.resposta || !Object.prototype.hasOwnProperty.call(this.remotoValores, entrada.resposta)) {
      return { success: true, kind: 'invalido', message: this._mensagemInvalida() };
    }
    try {
      const valorPacote = this.remotoValores[entrada.resposta];
      const resultado = await responderRemoto(sessao.client, valorPacote);
      return { success: true, ...this._proximaRemota(sessao, resultado) };
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      console.warn(`[AKINATOR] remoto falhou no meio da partida: ${msg}`);
      this.remotoMotivo = msg;
      this.sessions.delete(sessionKey(sessao.chatId, sessao.userId));
      return {
        success: true,
        kind: 'erro_remoto',
        message: `${TOPO('AKINATOR')}\n\n\u26a0\ufe0f Perdi a conex\u00e3o com o Akinator.\nA partida foi encerrada. Tente de novo em instantes.\n\n${RODAPE(this.botName)}`,
      };
    }
  }

  _confirmarAcerto(sessao) {
    const idx = sessao.engine.bestGuess().idx;
    const char = this.characters[idx];
    const adversarial = sessao.engine.flaggedAdversarial;

    // Anti-troll (FASE 16): sessao marcada como adversarial nao treina a base.
    let aprendido = 0;
    if (char && !adversarial) {
      aprendido = sessao.engine.learnCorrect(idx);
      if (aprendido > 0 && this.learnedFile) gravarJson(this.learnedFile, this.learned);
    }

    this.sessions.delete(sessionKey(sessao.chatId, sessao.userId));
    console.log(`[AKINATOR] sessao finalizada | acerto=${char ? char.name : '?'} | perguntas=${sessao.engine.askedCount} | ajustes=${aprendido}${adversarial ? ' | ADVERSARIAL (nao treinou)' : ''}`);

    return {
      kind: 'acertou',
      message: [
        TOPO('AKINATOR'),
        '',
        `\u{1F3AF} ${bold('Acertei!')} \u{1F60E}`,
        ``,
        `Era ${bold(char ? char.name : '?')}.`,
        char && char.category ? `\u{1F3F7}\ufe0f Categoria: ${char.category}` : '',
        ``,
        `\u{1F52E} Partida encerrada.`,
        RODAPE(this.botName),
      ].filter((l) => l !== '').join('\n'),
    };
  }

  /**
   * Registra a correcao. NAO entra na base: vai para a FILA e precisa de votos
   * (FASE 15/16) -- qualquer usuario nao injeta dado ruim direto.
   */
  _registrarCorrecao(sessao, nome) {
    if (normalizar(nome) === 'pular' || !nome) {
      this.sessions.delete(sessionKey(sessao.chatId, sessao.userId));
      return `${TOPO('AKINATOR')}\n\n\u{1F44B} Tudo bem, encerrando a partida.\n\n${RODAPE(this.botName)}`;
    }
    // Sessao adversarial nao gera correcao.
    if (sessao.engine.flaggedAdversarial) {
      this.sessions.delete(sessionKey(sessao.chatId, sessao.userId));
      console.log('[AKINATOR] correcao descartada (sessao adversarial)');
      return `${TOPO('AKINATOR')}\n\n\u{1F6AB} As respostas desta partida foram inconsistentes,\nent\u00e3o n\u00e3o vou usar isso para aprender.\n\n${RODAPE(this.botName)}`;
    }

    // Observacoes = o que o usuario respondeu (vira o atributo do personagem).
    const observacoes = sessao.engine.history.map((h) => ({
      qid: this.questions[h.qIdx].id,
      value: h.value,
    }));

    const existente = this.pending.find((p) => normalizar(p.name) === normalizar(nome));
    if (existente) {
      existente.votes += 1;
      existente.updatedAt = Date.now();
    } else {
      this.pending.push({
        name: nome,
        isNew: !this.baseCharacters.some((c) => normalizar(c.name) === normalizar(nome)),
        observations: observacoes,
        votes: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
    if (this.pendingFile) gravarJson(this.pendingFile, this.pending);

    const item = this.pending.find((p) => normalizar(p.name) === normalizar(nome));
    const votos = item ? item.votes : 1;
    const faltam = Math.max(0, ENGINE_CONFIG.MIN_VOTES_TO_PROMOTE - votos);

    this.sessions.delete(sessionKey(sessao.chatId, sessao.userId));
    console.log(`[AKINATOR] correcao registrada | nome=${nome} | votos=${votos} | obs=${observacoes.length}`);

    return [
      TOPO('AKINATOR'),
      '',
      `\u{1F4DD} Anotei: ${bold(nome)}.`,
      '',
      `Isso vai para a fila de corre\u00e7\u00f5es e s\u00f3 entra na`,
      `base depois de ${bold(String(ENGINE_CONFIG.MIN_VOTES_TO_PROMOTE))} confirma\u00e7\u00f5es.`,
      faltam > 0 ? `Faltam ${bold(String(faltam))}.` : `J\u00e1 pode ser aprovada!`,
      ``,
      `\u{1F64F} Obrigado por ensinar!`,
      RODAPE(this.botName),
    ].join('\n');
  }

  /** Cancela a partida do usuario (FASE 13). Nao afeta as dos outros. */
  cancelar({ chatId, userId }) {
    const ok = this.sessions.delete(sessionKey(chatId, userId));
    return {
      success: true,
      encerrada: ok,
      message: ok
        ? `${TOPO('AKINATOR')}\n\n\u{1F6D1} Partida encerrada.\n\n${RODAPE(this.botName)}`
        : `${TOPO('AKINATOR')}\n\n\u{1F937} Voc\u00ea n\u00e3o tem nenhuma partida ativa.\n\n${RODAPE(this.botName)}`,
    };
  }

  /**
   * Promove as correcoes que atingiram os votos minimos para a base aprendida.
   * Devolve quantas foram promovidas.
   */
  promoverCorrecoes() {
    const prontas = this.pending.filter((p) => p.votes >= ENGINE_CONFIG.MIN_VOTES_TO_PROMOTE);
    if (!prontas.length) return 0;

    this.promovidos = this.promovidos || [];
    for (const item of prontas) {
      const answers = {};
      for (const o of item.observations || []) answers[o.qid] = o.value;
      const jaExiste = this.characters.findIndex((c) => normalizar(c.name) === normalizar(item.name));
      if (jaExiste >= 0) {
        // Personagem ja existe: reforca os atributos observados.
        const alvo = this.characters[jaExiste];
        for (const o of item.observations || []) {
          this.learned[alvo.id] = this.learned[alvo.id] || {};
          this.learned[alvo.id][o.qid] = { w: o.value, n: ENGINE_CONFIG.MIN_VOTES_TO_PROMOTE };
        }
      } else {
        const id = `custom-${item.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
        this.promovidos.push({
          id,
          name: item.name,
          category: 'comunidade',
          description: 'Personagem adicionado pela comunidade.',
          priorWeight: 1,
          answers,
        });
      }
    }

    this.pending = this.pending.filter((p) => p.votes < ENGINE_CONFIG.MIN_VOTES_TO_PROMOTE);
    if (this.pendingFile) gravarJson(this.pendingFile, this.pending);
    if (this.learnedFile) gravarJson(this.learnedFile, this.learned);
    console.log(`[AKINATOR] correcoes promovidas: ${prontas.length}`);
    return prontas.length;
  }

  get pendingCount() {
    return this.pending.length;
  }

  // --- RENDERIZACAO (layout da Lizzy) ---

  _renderPergunta(q, numero) {
    return [
      TOPO('AKINATOR'),
      '',
      `\u2753 ${bold('Pergunta ' + numero + ':')}`,
      ``,
      q.text,
      RODAPE(this.botName),
    ].join('\n');
  }

  _renderPalpite(char, percent) {
    const linhas = [
      TOPO('AKINATOR'),
      '',
      `\u{1F3AF} ${bold('Acho que seu personagem e:')}`,
      '',
      `\u{1F464} ${bold(char.name)}`,
    ];
    if (char.category) linhas.push(`\u{1F3F7}\ufe0f Categoria: ${char.category}`);
    if (char.description) linhas.push(`\u{1F4DD} ${char.description}`);
    linhas.push(`\u{1F4CA} Confian\u00e7a: ${bold(percent + '%')}`);
    linhas.push('', `\u2753 Acertei?`, RODAPE(this.botName));
    return linhas.join('\n');
  }

  _mensagemInvalida() {
    return [
      TOPO('AKINATOR'),
      '',
      `\u{1F440} Responda com um dos bot\u00f5es:`,
      '',
      `\u2705 SIM`,
      `\u274c N\u00c3O`,
      `\u{1F937} N\u00c3O SEI`,
      `\u{1F7E1} PROVAVELMENTE`,
      `\u{1F535} PROVAVELMENTE N\u00c3O`,
      RODAPE(this.botName),
    ].join('\n');
  }

  _mensagemInvalidaPalpite() {
    return `${TOPO('AKINATOR')}\n\n\u{1F440} Use \u2705 ACERTOU ou \u274c ERREI.\n\n${RODAPE(this.botName)}`;
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

  mensagemIndisponivel() {
    return `${TOPO('AKINATOR')}\n\n\u26a0\ufe0f A base de personagens n\u00e3o est\u00e1 dispon\u00edvel agora.\n\n${RODAPE(this.botName)}`;
  }

  /**
   * Mensagem quando o modo e' o Akinator.com (remoto) e ele nao respondeu.
   * Explica o motivo mais provavel em vez de um "erro" generico.
   */
  mensagemRemotoIndisponivel() {
    const motivo = this.remotoMotivo || '';
    const cf = /403|cloudflare|challenge|session\/signature|timeout/i.test(motivo);
    return [
      TOPO('AKINATOR'),
      '',
      `\u26a0\ufe0f O ${bold('Akinator.com')} n\u00e3o respondeu agora.`,
      '',
      cf
        ? `A prote\u00e7\u00e3o dele (Cloudflare) est\u00e1 bloqueando o IP deste servidor.`
        : `Pode ser instabilidade da rede ou do servi\u00e7o.`,
      ``,
      `O comando est\u00e1 configurado para usar S\u00d3 o Akinator,`,
      `ent\u00e3o n\u00e3o vou jogar com outro motor.`,
      ``,
      `_Se for bloqueio de IP, configure um proxy em AKINATOR_PROXY._`,
      RODAPE(this.botName),
    ].join('\n');
  }

  /** Diagnostico: qual motor esta' atendendo e por que. */
  mensagemStatus() {
    const modo = this.modoEfetivo === 'remoto' ? 'REMOTO (Akinator.com)' : 'LOCAL (engine proprio)';
    const linhas = [
      TOPO('AKINATOR'),
      '',
      `\u{1F9E0} Motor: ${bold(modo)}`,
    ];
    if (this.modoEfetivo === 'remoto') {
      if (this.remotoAtivo) {
        linhas.push(`\u2705 Akinator respondendo${this.remotoExclusivo ? ' (exclusivo)' : ''}.`);
      } else {
        linhas.push(`\u26a0\ufe0f Akinator indispon\u00edvel: ${this.remotoMotivo || 'sem resposta'}`);
        if (this.remotoExclusivo) linhas.push(`Sem fallback: o comando n\u00e3o joga at\u00e9 voltar.`);
      }
    } else {
      linhas.push(`\u{1F4DA} Personagens na base: ${bold(String(this.baseCharacters.length))}`);
    }
    linhas.push(RODAPE(this.botName));
    return linhas.join('\n');
  }

  _cleanup() {
    const now = Date.now();
    for (const [key, s] of Array.from(this.sessions.entries())) {
      if (now - s.ultimaAtividade > CONFIG.SESSION_TIMEOUT_MS) {
        this.sessions.delete(key);
        console.log(`[AKINATOR] sessao expirada removida (${key})`);
      }
    }
  }
}

export {
  AkinatorGameManager,
  carregarBase,
  parseInput,
  buildAnswerButtons,
  buildGuessButtons,
  sessionKey,
  CONFIG,
  ROTULO,
  BOTAO_PARA_RESPOSTA,
};

export {
  carregarClient,
  testarRemoto,
  iniciarRemoto,
  responderRemoto,
  palpiteRemoto,
  mapaRespostas,
} from './akinator-remote.js';

export default AkinatorGameManager;
