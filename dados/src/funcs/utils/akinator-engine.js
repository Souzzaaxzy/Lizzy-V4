/**
 * ENGINE PROPRIO DO !akinator -- implementacao da Lizzy, sem dependencia externa.
 *
 * ## De onde vem a ideia (e o que NAO foi feito)
 *
 * A referencia arquitetural e o projeto "Sensei Knows" (Aaklon/akinator), um
 * engine de 20 perguntas em Go, sob **AGPL-3.0**:
 *   https://github.com/Aaklon/akinator
 *
 * **Nenhuma linha de codigo foi copiada ou traduzida.** O AGPL-3.0 e copyleft
 * forte (com clausula de rede): incorporar/traduzir aquele codigo obrigaria a
 * relicenciar o bot inteiro e oferecer o fonte aos usuarios da rede. Para evitar
 * essa obrigacao, aqui foi feita uma implementacao INDEPENDENTE, em JavaScript,
 * usando apenas as **tecnicas publicas** que o projeto descreve:
 *
 *   - classificacao probabilistica (posterior Bayesiana / Naive Bayes);
 *   - entropia de Shannon + ganho de informacao esperado para escolher a
 *     proxima pergunta;
 *   - suavizacao por prior Beta (evita "probabilidade zero" e permite recuperar
 *     de resposta contraditoria);
 *   - deteccao de resposta adversarial (colapso da massa de probabilidade);
 *   - correcoes em fila (staging) com votos antes de irem para a base.
 *
 * O projeto de referencia esta creditado na documentacao (ver
 * `dados/src/funcs/json/akinator/README.md`). Nao ha dataset copiado: a base
 * de personagens e autoral e o `data/` do projeto original esta vazio.
 *
 * ## Modelo de dados (proprio)
 *
 * Cada personagem guarda `answers: { idDaPergunta: 0..1 }`. A escala e:
 *   1.0 = sim | 0.75 = provavelmente | 0.5 = nao sei | 0.25 = provavelmente nao | 0 = nao
 *
 * A base AUTORAL fica em `json/akinator/characters.json` (versionada). O que o
 * jogo APRENDE vai para um arquivo separado no database (nunca sobrescreve a
 * base), e as correcoes ficam em fila ate serem aprovadas. Tres arquivos, tres
 * responsabilidades -- nada misturado.
 */

// --- ESCALA DE RESPOSTAS (FASE 9) ---
const ANSWER_VALUE = {
  SIM: 1.0,
  PROVAVELMENTE: 0.75,
  NAO_SEI: 0.5,
  PROVAVELMENTE_NAO: 0.25,
  NAO: 0.0,
};

const VALUE_TO_ANSWER = [
  { v: 1.0, k: 'SIM' },
  { v: 0.75, k: 'PROVAVELMENTE' },
  { v: 0.5, k: 'NAO_SEI' },
  { v: 0.25, k: 'PROVAVELMENTE_NAO' },
  { v: 0.0, k: 'NAO' },
];

/** Arredonda um valor continuo para o nivel de resposta mais proximo. */
function bucketValue(a) {
  let melhor = 0.5;
  let dist = Infinity;
  for (const lvl of [1.0, 0.75, 0.5, 0.25, 0.0]) {
    const d = Math.abs(a - lvl);
    if (d < dist) { dist = d; melhor = lvl; }
  }
  return melhor;
}

// --- CONFIGURACAO ---
const CONFIG = {
  MAX_QUESTIONS: 20,          // teto de perguntas por partida
  MIN_QUESTIONS_BEFORE_GUESS: 5,
  GUESS_THRESHOLD: 0.85,      // confianca "absoluta" para palpitar
  // Alem da confianca absoluta, palpita quando a LIDERANCA e clara. Numa base
  // com muitos atributos "nao sei" (0.5), a probabilidade do melhor candidato
  // raramente chega a 0.85 mesmo quando ele ja esta muito a frente dos outros
  // -- exigir so o limiar absoluto faria a partida gastar as 20 perguntas.
  LEAD_MIN_P: 0.30,           // probabilidade minima do lider
  LEAD_FACTOR: 2.0,           // lider precisa ser >= 2x o segundo colocado
  FEW_CANDIDATES: 3,          // ou restarem poucos candidatos...
  FEW_MIN_ASKED: 8,           // ...depois de um minimo de perguntas
  EPSILON_BASE: 0.05,         // piso de compatibilidade (resposta normal)
  EPSILON_IMPRECISE: 0.15,    // piso maior quando a pergunta e "imprecisa"
  BETA_PRIOR: 1.0,            // suavizacao Beta
  // Amostra assumida para um atributo CURADO da base (sem dado aprendido).
  // Sem isso o prior Beta(1,1) domina e o piso de compatibilidade fica em 0.40
  // (o maximo) para todo mundo -- o que impede o engine de discriminar.
  BASE_SAMPLE: 50,
  UCB_EXPLORATION: 0.10,      // bonus para perguntas pouco usadas
  ADVERSARIAL_Z: 1e-4,        // limiar de colapso da massa
  ADVERSARIAL_FRACTION: 0.40, // fracao de colapsos que marca troll
  MIN_VOTES_TO_PROMOTE: 2,    // votos para uma correcao entrar na base
};

// --- MATEMATICA ---

/** Entropia de Shannon (base 2) de uma distribuicao. */
function entropy(p) {
  let h = 0;
  for (const x of p) {
    if (x > 1e-12) h -= x * Math.log2(x);
  }
  return h;
}

/**
 * Compatibilidade calibrada entre a resposta do usuario e o valor guardado.
 *
 * Base: 1 - |resposta - guardado|. Com suavizacao Beta, o piso cresce quando a
 * amostra do personagem naquela pergunta e pequena/ambigua -- assim uma unica
 * resposta ruim NAO zera o candidato (ele pode se recuperar nas proximas).
 */
function calibratedMatch(answer, storedW, storedN, imprecise) {
  const baseEps = imprecise ? CONFIG.EPSILON_IMPRECISE : CONFIG.EPSILON_BASE;
  const n = Number(storedN) || 0;
  const w = Number.isFinite(storedW) ? storedW : 0.5;
  const alpha = w * n + CONFIG.BETA_PRIOR;
  const beta = (1 - w) * n + CONFIG.BETA_PRIOR;
  const total = alpha + beta;
  const variance = (alpha * beta) / (total * total * (total + 1));
  let eps = 2 * Math.sqrt(variance);
  if (eps < baseEps) eps = baseEps;
  if (eps > 0.40) eps = 0.40;
  const score = 1 - Math.abs(answer - w);
  return score < eps ? eps : score;
}

// --- BASE DE CONHECIMENTO ---
class KnowledgeBase {
  /**
   * @param {object} p
   * @param {Array}  p.questions  [{ id, text, imprecise? }]
   * @param {Array}  p.characters [{ id, name, category, description, priorWeight, answers }]
   * @param {object} p.learned    deltas aprendidos { [charId]: { [qid]: { w, n } } }
   */
  constructor({ questions = [], characters = [], learned = {} } = {}) {
    this.questions = questions;
    this.characters = characters;
    this.learned = learned;
    this.qIndex = new Map(questions.map((q, i) => [q.id, i]));
    this.usage = new Array(questions.length).fill(0);   // quantas vezes foi escolhida
    this.helpedCorrect = new Array(questions.length).fill(0);
    this.helpedWrong = new Array(questions.length).fill(0);
    this._index();
  }

  /**
   * Materializa a matriz [personagem][pergunta] com peso e amostra.
   *
   * Consultar peso era `personagem.answers[qid]` + `learned[charId][qid]` com
   * chave STRING, dentro do laco mais quente (por pergunta, por resposta, por
   * personagem). Com a matriz, cada acesso vira leitura de array -- o que faz
   * a selecao de pergunta aguentar milhares de personagens.
   */
  _index() {
    const Q = this.questions.length;
    this.W = new Array(this.characters.length);
    this.N = new Array(this.characters.length);
    for (let i = 0; i < this.characters.length; i++) {
      const ch = this.characters[i];
      const w = new Float64Array(Q);
      const n = new Float64Array(Q);
      for (let j = 0; j < Q; j++) {
        const qid = this.questions[j].id;
        const base = ch.answers ? ch.answers[qid] : undefined;
        const lrn = this.learned && this.learned[ch.id] ? this.learned[ch.id][qid] : undefined;
        const valor = lrn && Number.isFinite(lrn.w) ? lrn.w : base;
        w[j] = Number.isFinite(valor) ? valor : 0.5;
        n[j] = lrn && Number.isFinite(lrn.n) ? lrn.n : CONFIG.BASE_SAMPLE;
      }
      this.W[i] = w;
      this.N[i] = n;
    }
  }

  get valido() {
    return this.questions.length > 0 && this.characters.length > 0;
  }

  get tamanho() {
    return this.characters.length;
  }

  /** Valor da pergunta para o personagem (leitura direta na matriz). */
  weight(charIdx, qIdx) {
    const linha = this.W[charIdx];
    if (!linha || qIdx < 0 || qIdx >= linha.length) return 0.5;
    const v = linha[qIdx];
    return Number.isFinite(v) ? v : 0.5;
  }

  /**
   * Amostra (n) daquela pergunta naquele personagem.
   *
   * Sem dado aprendido devolve a amostra base: um atributo curado na base vale
   * como observacao confiavel, senao a suavizacao Beta deixaria todo mundo com
   * o piso maximo e o engine nao conseguiria separar os candidatos.
   */
  sample(charIdx, qIdx) {
    const linha = this.N[charIdx];
    if (!linha || qIdx < 0 || qIdx >= linha.length) return 0;
    return linha[qIdx];
  }

  /** Aplica um delta aprendido (mantido em memoria; persistido fora). */
  applyLearned(charId, qid, w, n) {
    if (!this.learned[charId]) this.learned[charId] = {};
    this.learned[charId][qid] = { w, n };
    // Mantem a matriz coerente (proxima partida ja usa o valor aprendido).
    const idx = this.characters.findIndex((c) => c.id === charId);
    const j = this.qIndex.get(qid);
    if (idx >= 0 && j !== undefined && this.W[idx]) {
      this.W[idx][j] = w;
      this.N[idx][j] = n;
    }
  }
}

// --- MOTOR DE UMA PARTIDA ---
class Engine {
  constructor(kb) {
    this.kb = kb;
    this.reset();
  }

  reset() {
    const N = this.kb.characters.length;
    this.posterior = new Array(N).fill(0);
    let total = 0;
    for (const c of this.kb.characters) total += Number(c.priorWeight) > 0 ? Number(c.priorWeight) : 1;
    for (let i = 0; i < N; i++) {
      const pw = Number(this.kb.characters[i].priorWeight);
      this.posterior[i] = (pw > 0 ? pw : 1) / total;
    }
    const Q = this.kb.questions.length;
    this.asked = new Array(Q).fill(false);
    this.answers = new Array(Q).fill(0.5);
    this.history = [];                 // [{ qIdx, value }]
    this.askedCount = 0;
    this.zCollapses = 0;
    this.flaggedAdversarial = false;
    this.finished = false;
    this.guess = null;
  }

  /** Candidatos ainda plausiveis (limiar relativo ao lider). */
  get restantes() {
    let max = 0;
    for (const p of this.posterior) if (p > max) max = p;
    if (max <= 0) return 0;
    const corte = max * 1e-3;
    let n = 0;
    for (const p of this.posterior) if (p >= corte) n++;
    return n;
  }

  /**
   * Quando palpitar.
   *
   * Regra 1 (absoluta): confianca >= 0.85.
   * Regra 2 (lideranca): o lider tem probabilidade razoavel E esta bem a frente
   *   do segundo colocado.
   * Regra 3 (poucos restantes): sobraram poucos candidatos e ja perguntamos o
   *   suficiente.
   *
   * As tres exigem o minimo de perguntas, para nao palpitar cedo demais.
   */
  get podePalpitar() {
    if (this.askedCount < CONFIG.MIN_QUESTIONS_BEFORE_GUESS) return false;
    const ordem = this.posterior.slice().sort((a, b) => b - a);
    const p = ordem[0] || 0;
    const segundo = ordem[1] || 0;
    if (p >= CONFIG.GUESS_THRESHOLD) return true;
    if (p >= CONFIG.LEAD_MIN_P && p >= CONFIG.LEAD_FACTOR * Math.max(segundo, 1e-9)) return true;
    if (this.restantes <= CONFIG.FEW_CANDIDATES && this.askedCount >= CONFIG.FEW_MIN_ASKED && p >= 0.5) return true;
    return false;
  }

  get semPerguntas() {
    for (let j = 0; j < this.kb.questions.length; j++) if (this.eligible(j)) return false;
    return true;
  }

  get atingiuTeto() {
    return this.askedCount >= CONFIG.MAX_QUESTIONS;
  }

  /** Pergunta ainda pode ser feita? */
  eligible(j) {
    if (this.asked[j]) return false;
    const q = this.kb.questions[j];
    if (q.hidden) return false;
    return true;
  }

  /** Melhor candidato e sua probabilidade. */
  bestGuess() {
    let idx = -1;
    let p = -1;
    for (let i = 0; i < this.posterior.length; i++) {
      if (this.posterior[i] > p) { p = this.posterior[i]; idx = i; }
    }
    return { idx, p: p < 0 ? 0 : p, char: idx >= 0 ? this.kb.characters[idx] : null };
  }

  /** Top-N candidatos com percentual (para diagnostico/teste). */
  candidates(topN = 5) {
    return this.posterior
      .map((p, i) => ({ char: this.kb.characters[i], p }))
      .sort((a, b) => b.p - a.p)
      .slice(0, topN)
      .map((c) => ({ name: c.char.name, percent: Math.round(c.p * 100) }));
  }

  /**
   * Escolhe a proxima pergunta por GANHO DE INFORMACAO ESPERADO.
   *
   * Para cada pergunta elegivel, simula as 5 respostas possiveis, calcula a
   * entropia esperada depois de cada uma e escolhe a que mais reduz a entropia
   * (com um pequeno bonus para perguntas pouco usadas, evitando vicios).
   */
  selectNextQuestion() {
    const Q = this.kb.questions.length;
    const vivos = this._vivos();
    const H0 = this._entropiaVivos(vivos);
    let best = -1;
    let bestScore = -1;
    const totalUsos = this.kb.usage.reduce((a, b) => a + b, 0) + 1;

    for (let j = 0; j < Q; j++) {
      if (!this.eligible(j)) continue;
      const eig = this.expectedInformationGain(j, H0, vivos);
      const usos = this.kb.usage[j] || 0;
      const ucb = CONFIG.UCB_EXPLORATION * Math.sqrt(Math.log(totalUsos + 1) / (usos + 1));
      const score = eig + ucb;
      if (score > bestScore) { bestScore = score; best = j; }
    }
    return best;
  }

  /**
   * Lista de candidatos VIVOS (posterior relevante). Reaproveitada na selecao
   * da pergunta: quem tem probabilidade ~0 nao influencia o calculo.
   */
  _vivos(corte) {
    const lim = corte === undefined ? 1e-6 : corte;
    const out = [];
    for (let i = 0; i < this.posterior.length; i++) {
      if (this.posterior[i] > lim) out.push(i);
    }
    return out;
  }

  /** Entropia considerando apenas os vivos (os demais somam ~0). */
  _entropiaVivos(vivos) {
    let h = 0;
    for (const i of vivos) {
      const p = this.posterior[i];
      if (p > 1e-12) h -= p * Math.log2(p);
    }
    return h;
  }

  /**
   * Ganho de informacao esperado de uma pergunta.
   *
   * Percorre apenas os candidatos VIVOS (`vivos`) e sai cedo quando a pergunta
   * nao separa ninguem (peso igual para todos), que e o caso mais comum nas
   * perguntas ja' irrelevantes. E o que mantem a selecao viavel com base grande.
   */
  expectedInformationGain(j, H0, vivos) {
    const lista = vivos || this._vivos();
    const n = lista.length;
    if (n <= 1) return 0;
    const imprecise = !!this.kb.questions[j].imprecise;
    const levels = [1.0, 0.75, 0.5, 0.25, 0.0];

    // Pre-peneira barata: se todos os vivos tem o MESMO peso nesta pergunta,
    // ela nao divide nada -> ganho 0. Evita o calculo completo.
    const primeiro = this.kb.weight(lista[0], j);
    let todosIguais = true;
    for (let a = 1; a < n; a++) {
      if (this.kb.weight(lista[a], j) !== primeiro) { todosIguais = false; break; }
    }
    if (todosIguais) return 0;

    const mass = [];
    const matchByLevel = [];
    let massTotal = 0;
    for (let li = 0; li < levels.length; li++) {
      const a = levels[li];
      const m = new Array(n);
      let r = 0;
      for (let k = 0; k < n; k++) {
        const i = lista[k];
        const mm = calibratedMatch(a, this.kb.weight(i, j), this.kb.sample(i, j), imprecise);
        m[k] = mm;
        r += mm * this.posterior[i];
      }
      mass.push(r);
      matchByLevel.push(m);
      massTotal += r;
    }
    if (massTotal < 1e-12) return 0;

    let expectedH = 0;
    for (let k = 0; k < levels.length; k++) {
      const pa = mass[k] / massTotal;
      if (pa < 1e-12) continue;
      const Z = mass[k];
      let h = 0;
      for (let idx = 0; idx < n; idx++) {
        const i = lista[idx];
        const p = (matchByLevel[k][idx] * this.posterior[i]) / Z;
        if (p > 1e-12) h -= p * Math.log2(p);
      }
      expectedH += pa * h;
    }
    return H0 - expectedH;
  }

  /** Aplica uma resposta (valor 0..1) e recalcula os candidatos. */
  applyAnswer(qIdx, value) {
    const N = this.posterior.length;
    const imprecise = !!this.kb.questions[qIdx].imprecise;
    const updated = new Array(N);
    let Z = 0;
    for (let i = 0; i < N; i++) {
      const m = calibratedMatch(value, this.kb.weight(i, qIdx), this.kb.sample(i, qIdx), imprecise);
      updated[i] = m * this.posterior[i];
      Z += updated[i];
    }

    // Anti-troll: se a massa colapsa, as respostas sao inconsistentes.
    if (Z < CONFIG.ADVERSARIAL_Z) this.zCollapses++;
    this.askedCount++;
    if (this.askedCount >= CONFIG.MIN_QUESTIONS_BEFORE_GUESS) {
      this.flaggedAdversarial = (this.zCollapses / this.askedCount) > CONFIG.ADVERSARIAL_FRACTION;
    }

    if (Z < 1e-12) Z = 1e-12;
    for (let i = 0; i < N; i++) this.posterior[i] = updated[i] / Z;

    this.asked[qIdx] = true;
    this.answers[qIdx] = value;
    this.history.push({ qIdx, value });
    return { z: Z, restantes: this.restantes };
  }

  /**
   * Aprende com um acerto: ajusta os pesos dos personagens que passaram pelas
   * perguntas respondidas, ponderando pela massa de dados ja existente (uma
   * resposta sozinha nao muda um fato bem estabelecido).
   */
  learnCorrect(charIdx) {
    const ch = this.kb.characters[charIdx];
    if (!ch) return 0;
    let ajustes = 0;
    for (const h of this.history) {
      const qid = this.kb.questions[h.qIdx]?.id;
      if (!qid) continue;
      const storedW = this.kb.weight(charIdx, h.qIdx);
      const storedN = this.kb.sample(charIdx, h.qIdx);
      const consistencia = 1 - Math.abs(h.value - storedW);
      const massa = Math.min(1, storedN / 20);
      let obs = 1 - massa * (1 - consistencia);
      if (obs < 0.05) obs = 0.05;
      const novoN = storedN + obs;
      const novoW = (storedW * storedN + obs * h.value) / novoN;
      this.kb.applyLearned(ch.id, qid, novoW, Math.round(novoN));
      ajustes++;
    }
    return ajustes;
  }
}

export {
  Engine,
  KnowledgeBase,
  ANSWER_VALUE,
  VALUE_TO_ANSWER,
  bucketValue,
  entropy,
  calibratedMatch,
  CONFIG,
};

export default Engine;
