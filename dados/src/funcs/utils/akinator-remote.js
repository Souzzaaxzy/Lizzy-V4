/**
 * CLIENTE REMOTO do Akinator.com para o !akinator (OPCIONAL).
 *
 * Envolve o pacote `akinator-client` num adaptador com a MISSMA interface do
 * engine local, para que o `AkinatorGameManager` nao precise saber qual dos
 * dois esta por baixo.
 *
 * IMPORTANTE (medido, nao suposto): o Akinator.com fica atras do Cloudflare e
 * responde 403 "Just a moment..." para IP de VPS/datacenter. O pacote diz que
 * "bypassa Cloudflare", mas isso vale para a maioria dos IPs residenciais, NAO
 * para datacenter. Por isso:
 *   - o modo remoto e' OPT-IN (`AKINATOR_MODE=remoto`);
 *   - `disponivel()` faz um START de teste e o manager cai pro local se falhar;
 *   - `AKINATOR_PROXY` / `SCRAPERAPI_KEY` sao repassados para quem tiver proxy
 *     residencial ou ScraperAPI.
 *
 * A importacao do pacote e' DINAMICA e tolerante: se nao estiver instalado, o
 * modulo simplesmente reporta indisponivel (o bot nao quebra).
 */

let _mod = null;
let _erroImport = null;

/** Carrega o `akinator-client` uma vez. Nunca lanca. */
export async function carregarClient() {
  if (_mod) return _mod;
  if (_erroImport) return null;
  try {
    _mod = await import('akinator-client');
    return _mod;
  } catch (e) {
    _erroImport = e && e.message ? e.message : String(e);
    console.warn('[AKINATOR] akinator-client nao disponivel:', _erroImport);
    return null;
  }
}

/** Rotulo -> valor do enum `Answers` do pacote. */
export function mapaRespostas(mod) {
  const A = (mod && mod.Answers) || {};
  return {
    SIM: A.Yes,
    NAO: A.No,
    NAO_SEI: A.IDontKnow,
    PROVAVELMENTE: A.Probably,
    PROVAVELMENTE_NAO: A.ProbablyNot,
  };
}

/**
 * Cria uma sessao remota. Devolve a mesma forma do engine local:
 *   { pergunta, kind: 'pergunta'|'palpite', char, percentual }
 *
 * @param {object} p
 * @param {object} p.mod       modulo `akinator-client` ja carregado
 * @param {object} [p.options] opcoes (language/theme/proxy/retries)
 */
export async function iniciarRemoto({ mod, options = {} } = {}) {
  const { AkinatorClient, Languages, Themes } = mod;
  const client = new AkinatorClient({
    language: options.language || Languages.Portuguese,
    theme: options.theme || Themes.Character,
    retries: Number.isFinite(options.retries) ? options.retries : 2,
    ...(options.proxy ? { proxy: options.proxy } : {}),
    ...(options.scraperApiKey ? { scraperApiKey: options.scraperApiKey } : {}),
  });
  const r = await client.start();
  return { client, resultado: normalizarResultado(r) };
}

/**
 * Traduz a resposta do pacote para o formato do jogo.
 *
 * `AnswerResult`: { won, ko, step, progression, question, answers }
 * `WinResult` (em `client.winResult`): { name, pictureUrl, description, ... }
 */
export function normalizarResultado(r) {
  if (!r) return { kind: 'erro' };
  if (r.won) return { kind: 'palpite', percentual: Math.round((r.progression || 0) * 100), bruto: r };
  if (r.ko) return { kind: 'sem_candidato', bruto: r };
  return { kind: 'pergunta', pergunta: r.question, respostas: r.answers, bruto: r };
}

/** Chuta o personagem final (nome/imagem/descricao). */
export function palpiteRemoto(client) {
  try {
    const w = client.winResult || {};
    return {
      id: `ak-remote-${w.propositionId || w.basePropositionId || 'x'}`,
      name: w.name || '?',
      category: 'akinator',
      description: w.description || '',
      imageUrl: w.pictureUrl || null,
      priorWeight: 1,
      answers: {},
    };
  } catch (e) {
    return null;
  }
}

/**
 * Testa se o modo remoto realmente funciona NESTE ambiente (rede + Cloudflare).
 * Faz um START real; se falhar, quem chamou deve cair pro modo local.
 */
export async function testarRemoto({ options = {}, timeoutMs = 25000 } = {}) {
  const mod = await carregarClient();
  if (!mod) return { ok: false, motivo: _erroImport || 'pacote nao instalado' };
  try {
    const r = await Promise.race([
      iniciarRemoto({ mod, options }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs)),
    ]);
    const pergunta = r && r.resultado && r.resultado.pergunta;
    if (!pergunta) throw new Error('sem pergunta no START');
    return { ok: true, mod };
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    const cf = /403|cloudflare|session\/signature|challenge|timeout/i.test(msg);
    return {
      ok: false,
      motivo: cf
        ? `bloqueio do Cloudflare/protecao do Akinator neste IP (${msg})`
        : msg,
      cloudflare: cf,
    };
  }
}

/** Envia uma resposta e devolve o proximo estado (pergunta ou palpite). */
export async function responderRemoto(cliente, valor) {
  const r = await cliente.answer(valor);
  return normalizarResultado(r);
}
