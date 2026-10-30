/**
 * Cliente do GROQ — o provedor de IA do `!iap` e do `!transcrever`.
 *
 * ## Por que o Groq (e nao o Gemini) nestes dois comandos
 *
 * Medido: o `!iap` faz DUAS chamadas por turno (ouvir e pensar). No Gemini as
 * duas saiam na MESMA cota, e era o STT que estourava o tempo (o modelo e' um
 * generativo fazendo trabalho de transcricao). O Groq resolve os dois lados:
 *
 *   - **ouvir**: `whisper-large-v3-turbo` — modelo DEDICADO a transcricao,
 *     ~200x o tempo real (o dono confirmou: "com o groq funcionou");
 *   - **pensar**: `openai/gpt-oss-120b` — conversa natural, e a API e'
 *     compativel com a da OpenAI.
 *
 * A API e' **OpenAI-compativel** (`https://api.groq.com/openai/v1`), entao o
 * mesmo formato de mensagens dos outros comandos serve.
 *
 * ## Os outros comandos de IA NAO mudam
 *
 * `!gemma`, `!phi`, `!qwen` e companhia continuam no Gemini (a chave do `!key`).
 * So' o `!iap` e o `!transcrever` usam este modulo.
 */

import axios from 'axios';
import { spawn } from 'child_process';
import {
  lerChaves, marcarEsgotada, marcarCooldownTodas, chavesSaoDeContasDiferentes,
  primeiraDisponivel, indiceDisponivel, emCooldown, segundosDeCooldown
} from './groqKeys.js';

/** Base da API (compativel com OpenAI). */
const BASE = 'https://api.groq.com/openai/v1';

/** Modelo de transcricao (dedicado, rapido). */
const MODELO_STT = process.env.IAP_GROQ_STT_MODEL || 'whisper-large-v3-turbo';

/**
 * VIES de vocabulario para o Whisper (o campo `prompt`).
 *
 * ## Por que isto melhora o "entendimento"
 *
 * O Whisper trata o `prompt` como o TEXTO ANTERIOR da conversa, entao ele
 * enviesa a decodificacao para esse vocabulario. Colocando aqui os nomes dos
 * comandos e as palavras que ele costuma errar ("toca", "baixa", "figurinha",
 * "pinterest"), o reconhecimento acerta o que INTERESSA — sem trocar de modelo e
 * sem custo extra. Configuravel por `IAP_STT_PROMPT`.
 */
const PROMPT_STT = process.env.IAP_STT_PROMPT
  || 'Comandos: toca, tocar, baixa, baixar, procura, procurar, pesquisa, manda, '
   + 'figurinha, figurinha aleatoria, sticker, musica, video, tiktok, pinterest. '
   + 'Exemplos: "toca Evidencias", "baixa a musica X", "procura no pinterest gatos", '
   + '"manda uma figurinha aleatoria".';

/** Modelo de conversa (o agente de voz). */
const MODELO_LLM = process.env.IAP_GROQ_LLM_MODEL || 'openai/gpt-oss-120b';

/**
 * A partir de quantos segundos um 429 SEM pista de escopo conta como cota do DIA.
 *
 * E' so' o ULTIMO recurso: a decisao boa vem dos headers do Groq. A doc oficial
 * e' explicita — `x-ratelimit-remaining-requests` refere-se SEMPRE a Requests
 * Per Day (RPD). Quando `remaining-requests` chega a 0, a cota do DIA acabou;
 * nos demais casos e' o limite por minuto/tokens.
 */
const LIMITE_DIARIO_SEGUNDOS = 300;

/** Quanto tempo (ms) esperamos, no maximo, por um castigo de minuto. */
const ESPERA_MAX_MS = 12000;

/** A espera em ms. Injetavel nos testes (nao quero 11s de suite). */
let _esperar = (ms) => new Promise((r) => setTimeout(r, ms));
export function _setEsperaForTest(fn) { _esperar = typeof fn === 'function' ? fn : ((ms) => new Promise((r) => setTimeout(r, ms))); }

/** Tetos de tempo. */
const TIMEOUT_STT_MS = Number.parseInt(process.env.IAP_GROQ_TIMEOUT_MS || '45000', 10);
const TIMEOUT_LLM_MS = Number.parseInt(process.env.IAP_GROQ_LLM_TIMEOUT_MS || '45000', 10);

/** Injetavel para os testes (sem rede). */
let _httpPost = null;
export function setGroqHttpForTest(fn) { _httpPost = typeof fn === 'function' ? fn : null; }
const post = (url, data, config) => (_httpPost ? _httpPost(url, data, config) : axios.post(url, data, config));

/**
 * A chave do Groq (do `!keygroq` ou do `.env`).
 * @returns {string}
 */
export function chaveGroq() {
  // A chave "de agora" e' a PRIMEIRA que ainda nao estourou a cota. Uma chave
  // esgotada nao e' mais tentada ate' o reset (a cota do Groq e' diaria).
  const lista = lerChaves();
  if (!lista.length) return '';
  const disp = primeiraDisponivel(lista);
  return disp ? disp.chave : '';
}

/**
 * Executa `fn(chave)` com a chave ATUAL e, se ela falhar por CHAVE ou por COTA,
 * tenta a PROXIMA — ate' acabar as chaves.
 *
 * ## Os DOIS 429 (era o bug da rotacao)
 *
 * O Groq devolve **429** tanto para a cota do **DIA** (RPD/TPD) quanto para o
 * limite por **MINUTO/HORA** (RPM/TPM/TPH). Os dois eram tratados igual: a chave
 * era marcada como esgotada ate' a meia-noite. Um limite que voltaria em
 * SEGUNDOS queimava uma chave VIVA — e o dono tinha que dar `!keygroq reset`
 * (que so' limpava a marcacao errada) para ela voltar.
 *
 * Agora o escopo decide:
 *
 *   - **dia** (ou chave invalida 401/403): `marcarEsgotada` — so' volta no reset.
 *   - **minuto/hora**: `marcarCooldown` — a chave esta' VIVA; fica de castigo
 *     por alguns segundos e nao e' tentada nesse meio-tempo.
 *
 * ## NAO AMPLIFICAR o limite TEMPORARIO (o bug do "varias chaves pioram")
 *
 * A doc do Groq diz, literalmente: *"Rate limits apply at the ORGANIZATION
 * level, not individual users"*. Ou seja: as chaves da MESMA conta dividem a
 * MESMA cota. Quando o limite e' por MINUTO/TOKENS, a organizacao inteira esta'
 * estrangulada — **trocar de chave nao da' cota nova e ainda queima a cota
 * compartilhada UMA VEZ POR CHAVE**.
 *
 * Medido: com 5 chaves, UMA mensagem consumia 5 requisicoes antes de desistir.
 * Era isso que fazia o dono, com varias chaves, esgotar em minutos o que UMA
 * chave aguentava por horas.
 *
 * Por isso: num limite TEMPORARIO, a rotacao PARA. A espera curta (abaixo)
 * continua valendo; o que sai e' a rotacao cega. A rotacao segue valendo para
 * a cota do DIA e para chave invalida — ai' uma chave de OUTRA conta tem cota
 * propria e ajuda de verdade.
 *
 * ## O laco AVANCA sempre (o outro bug)
 *
 * A versao antiga chamava `primeiraDisponivel(lista, i)`: se a chave que falhou
 * NAO ficasse marcada, a proxima iteracao devolvia o MESMO indice e a chave era
 * tentada DUAS vezes na mesma chamada. Agora o laco usa o INDICE
 * (`indiceDisponivel(lista, i + 1)`), entao ele sempre caminha para frente.
 *
 * Um erro de REDE (timeout, DNS) nao diz nada sobre a chave — e sobe na hora,
 * sem rotacionar (rotacionar ali queimaria a cota das outras a toa).
 *
 * @template T
 * @param {(chave: string) => Promise<T>} fn
 * @returns {Promise<T>} o resultado do primeiro que der certo
 * @throws o ultimo erro, quando todas falharem
 */
export async function comFailoverDeChave(fn) {
  const lista = lerChaves();
  if (!lista.length) throw new Error('sem_chave_groq');

  let ultimoErro = null;
  let jaEsperou = false;   // so' esperamos UMA vez (nunca fica preso num loop)

  // ## As duas passadas
  //
  // A 1a tenta as chaves. Se no fim o UNICO impedimento for um castigo de
  // MINUTO (a chave volta em segundos), espera o menor prazo e tenta de novo —
  // uma vez. Sem isso, TODAS as chaves estarem de castigo por 5s derrubava a
  // mensagem, mesmo com cota de sobra.
  for (;;) {
    let i = indiceDisponivel(lista, 0);

    // Nenhuma usavel ja' de cara: castigo (temporario) ou cota do dia (definitivo).
    if (i < 0) {
      const motivo = motivoDaIndisponibilidade(lista);
      const falta = menorCooldownSegundos(lista);
      if (motivo === 'castigo' && !jaEsperou && falta > 0 && falta * 1000 <= ESPERA_MAX_MS) {
        jaEsperou = true;
        await _esperar((falta * 1000) + 250);   // passa um tiquinho do prazo
        continue;
      }
      if (motivo === 'castigo') throw erroDeLimiteTemporario(falta);
      throw (motivo === 'esgotadas' && ultimoErro) ? ultimoErro : new Error('sem_chave_groq');
    }

    let parouPorTemporario = false;
    while (i >= 0 && i < lista.length) {
      const { chave, slot } = lista[i];
      try {
        return await fn(chave);              // deu certo: essa e' a chave ativa
      } catch (e) {
        const info = classificarErroGroq(e);
        // So' CHAVE e COTA mexem no estado. Rede/payload nao dizem nada sobre a
        // chave — trocar ali queimaria a cota das outras.
        if (info.tipo !== 'chave' && info.tipo !== 'limite') throw e;

        if (info.tipo === 'chave' || info.escopo === 'dia') {
          // Morreu: chave invalida, ou a cota do DIA acabou. AQUI rotacionar
          // faz sentido: uma chave de OUTRA conta tem cota propria. O instante
          // do reset vem do proprio Groq, quando ele informa.
          marcarEsgotada(slot, info.resetEm);
        } else {
          // Limite por MINUTO/HORA: a chave esta' VIVA, mas a ORGANIZACAO
          // inteira esta' estrangulada (o Groq conta por organizacao). Esfria
          // TODAS as chaves e PARA — nao tenta as outras, que gastariam a
          // MESMA cota compartilhada N vezes mais rapido.
          marcarCooldownTodas(info.retryAfter || 60);
          ultimoErro = e;
          // So' PARA quando as chaves sao da MESMA conta (o caso comum): ai' a
          // cota e' compartilhada e tentar a proxima so' queima mais rapido.
          // Com `GROQ_KEYS_MULTI_ORG=1` (contas DIFERENTES), segue rotacionando
          // — cada conta tem cota propria e a proxima pode responder.
          if (!chavesSaoDeContasDiferentes()) {
            parouPorTemporario = true;
            break;
          }
        }
        ultimoErro = e;
      }
      // AVANCA: nunca repete a chave que acabou de falhar nesta mesma passada.
      i = indiceDisponivel(lista, i + 1);
    }

    if (parouPorTemporario) {
      // A chave volta em segundos? Vale esperar UMA vez — assim a mensagem nao
      // fica sem resposta por um castigo curto.
      const falta = menorCooldownSegundos(lista);
      if (!jaEsperou && falta > 0 && falta * 1000 <= ESPERA_MAX_MS) {
        jaEsperou = true;
        await _esperar((falta * 1000) + 250);
        continue;
      }
      throw erroDeLimiteTemporario(falta);
    }

    // Chegou aqui: TODAS falharam por COTA DO DIA / chave invalida nesta
    // passada. Se alguma ficou so' de castigo e ainda nao esperamos, vale
    // esperar — ela volta em segundos.
    const falta = menorCooldownSegundos(lista);
    if (!jaEsperou && falta > 0 && falta * 1000 <= ESPERA_MAX_MS) {
      jaEsperou = true;
      await _esperar((falta * 1000) + 250);
      continue;
    }
    break;
  }

  // A falha e' TEMPORARIA (castigo), nao "a cota do dia acabou".
  const faltaFinal = menorCooldownSegundos(lista);
  if (faltaFinal > 0) throw erroDeLimiteTemporario(faltaFinal);
  throw ultimoErro || new Error('sem_chave_groq');
}


/**
 * POR QUE nao ha chave usavel AGORA (ou `null`, se ha').
 *
 * A distincao importa: "todas com a cota do DIA esgotada" e' definitivo ate' o
 * reset; "todas de castigo" e' TEMPORARIO (elas voltam em segundos). Sem isto,
 * um castigo de minuto era reportado como "sem chave configurada" — o mesmo
 * diagnostico errado que o dono vinha vendo.
 *
 * @param {Array<{slot:number, chave:string}>} [lista]
 * @returns {'sem_chave'|'esgotadas'|'castigo'|null}
 */
function motivoDaIndisponibilidade(lista = lerChaves()) {
  if (!lista.length) return 'sem_chave';
  if (indiceDisponivel(lista, 0) >= 0) return null;   // ha' chave usavel agora
  return lista.some((c) => emCooldown(c.slot)) ? 'castigo' : 'esgotadas';
}

/**
 * Os headers de limite do Groq.
 *
 * A doc e' explicita sobre o SIGNIFICADO (e e' o que resolve o bug):
 *
 *   - `x-ratelimit-remaining-requests` -> SEMPRE a cota do DIA (RPD);
 *   - `x-ratelimit-remaining-tokens`   -> SEMPRE o limite por MINUTO (TPM);
 *   - `x-ratelimit-reset-requests`     -> quando a cota do DIA (RPD) volta;
 *   - `x-ratelimit-reset-tokens`       -> quando o limite de tokens (TPM) volta;
 *   - `retry-after`                    -> quantos segundos esperar.
 *
 * ## Por que o header de TOKENS entrou
 *
 * O `remaining-requests` responde sobre REQUISICOES por dia. Quando o que
 * estourou foram os TOKENS do dia (TPD), esse header continua ALTO — e olhar so'
 * ele fazia o TPD parecer "limite por minuto". Era o rotulo errado
 * ("limite por minuto — volta em 4000s"). O `remaining-tokens` e' o par que
 * faltava.
 *
 * @param {any} e
 * @returns {{restantes: number|null, tokensRestantes: number|null, resetSegundos: number, resetTokensSegundos: number, retryAfter: number}}
 */
function lerHeadersDeLimite(e) {
  const h = e?.response?.headers || {};
  const pega = (nome) => h[nome] ?? h[nome.toLowerCase()] ?? h[nome.toUpperCase()];
  const num = (v) => {
    if (v == null || v === '') return null;
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  };
  return {
    restantes: num(pega('x-ratelimit-remaining-requests')),
    tokensRestantes: num(pega('x-ratelimit-remaining-tokens')),
    resetSegundos: duracaoEmSegundos(pega('x-ratelimit-reset-requests')),
    resetTokensSegundos: duracaoEmSegundos(pega('x-ratelimit-reset-tokens')),
    retryAfter: duracaoEmSegundos(pega('retry-after'))
  };
}

/**
 * Converte uma duracao do header em SEGUNDOS.
 *
 * O Groq manda em varios formatos: `2` (segundos puros), `7.66s`, `2m59.56s`.
 *
 * @param {any} bruto
 * @returns {number} segundos (0 = nao veio/nao entendi)
 */
function duracaoEmSegundos(bruto) {
  if (bruto == null || bruto === '') return 0;
  const texto = String(bruto).trim();
  if (/^\d+(?:\.\d+)?$/.test(texto)) return Number.parseFloat(texto);
  const re = /(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)/gi;
  let total = 0; let achou = false; let m;
  while ((m = re.exec(texto)) !== null) {
    achou = true;
    const n = Number.parseFloat(m[1]);
    const u = m[2].toLowerCase();
    total += n * (u === 'ms' ? 0.001 : u === 's' ? 1 : u === 'm' ? 60 : u === 'h' ? 3600 : 86400);
  }
  return achou ? total : 0;
}

/**
 * Le' o `retry-after` da resposta (compatibilidade: usa o parser novo).
 * @param {any} e
 * @returns {number} segundos (0 = nao veio)
 */
function lerRetryAfter(e) {
  return Math.min(3600, lerHeadersDeLimite(e).retryAfter);
}

/**
 * O erro de "todas as chaves estao so' de castigo por alguns segundos".
 *
 * Ele NAO veio do HTTP — por isso carrega a classificacao (`groqTipo`) para o
 * `classificarErroGroq` respeitar em vez de chutar 'rede'.
 */
function erroDeLimiteTemporario(segundos = 0) {
  const espera = Number(segundos) > 0 ? ` em ~${Math.ceil(Number(segundos))}s` : '';
  const e = new Error(
    `Limite de requisições do Groq: as chaves estão em espera${espera} (temporário — tente de novo em instantes).`
  );
  e.groqTipo = 'limite';
  e.groqEscopo = 'minuto';
  e.groqRetryAfter = Number(segundos) || 0;
  return e;
}

/**
 * Quantos segundos ate' a chave MAIS PROXIMA sair do castigo (0 = nenhuma).
 * @param {Array<{slot:number}>} [lista]
 * @returns {number}
 */
function menorCooldownSegundos(lista = lerChaves()) {
  let menor = Infinity;
  for (const c of lista) {
    const seg = segundosDeCooldown(c.slot);
    if (seg > 0 && seg < menor) menor = seg;
  }
  return Number.isFinite(menor) ? menor : 0;
}

/** Ha' chave configurada? */
export function temGroq() {
  return Boolean(chaveGroq());
}

/**
 * Classifica um erro da API do Groq (compativel com OpenAI).
 *
 * A forma e' `{ error: { message, type, code } }` — diferente da do Gemini, que
 * usa `details[].reason`. Olhar o CORPO (e nao so' o HTTP) e' o que evita o
 * erro de diagnostico que ja' aconteceu do outro lado.
 *
 * @param {any} e
 * @returns {{tipo: 'chave'|'limite'|'rede'|'payload'|'outro', http?: number, detalhe: string, mensagem: string}}
 */
export function classificarErroGroq(e) {
  // Erro JA' classificado pela propria rotacao (ex.: "todas em castigo"): ele
  // nao veio do HTTP, entao sem isto cairia em 'rede' por engano.
  if (e?.groqTipo) {
    return {
      tipo: e.groqTipo,
      escopo: e.groqEscopo,
      retryAfter: e.groqRetryAfter || 0,
      http: undefined,
      detalhe: e.message,
      mensagem: e.message
    };
  }

  const http = e?.response?.status;
  const dados = e?.response?.data?.error;
  const msg = String(dados?.message || e?.message || '').trim();
  const baixo = msg.toLowerCase();
  const detalhe = msg || `HTTP ${http ?? '?'}`;

  if (
    http === 401 || http === 403 ||
    /invalid api key|unauthorized|api key.*(invalid|expired)/i.test(msg)
  ) {
    return { tipo: 'chave', http, detalhe, mensagem: 'Chave do Groq inválida ou sem permissão.' };
  }
  if (http === 429 || /rate limit|too many requests|quota/i.test(baixo)) {
    // ## O BUG: os DOIS 429 eram tratados como "cota do dia"
    //
    // O Groq responde 429 quando a cota do DIA acabou (RPD/TPD) **e** quando o
    // limite por MINUTO/HORA estourou (RPM/TPM/TPH). O segundo volta em
    // segundos; o primeiro, so' no reset. Marcar a chave como esgotada nos dois
    // casos queimava uma chave VIVA — e o dono precisava do `!keygroq reset`
    // (que so' limpava a marcacao errada) para ela voltar.
    // 1) O HEADER MANDA. A doc do Groq e' explicita:
    //    `x-ratelimit-remaining-requests` refere-se SEMPRE a cota do DIA (RPD).
    //    Zero = o dia acabou; qualquer outro valor = o limite e' de minuto/tokens
    //    (a chave esta' VIVA). E' a fonte autoritativa — melhor que adivinhar
    //    pelo texto, que muda sem aviso.
    const h = lerHeadersDeLimite(e);

    // ## QUAL dimensao estourou (e' o que decide dia x minuto)
    //
    // O `remaining-requests` so' fala de REQUISICOES/DIA. Quando o que estoura
    // sao os TOKENS do dia (TPD), ele continua ALTO — e olhar so' ele fazia o
    // TPD parecer "limite por minuto" (o rotulo errado, "volta em 4000s").
    //
    // Entao primeiro perguntamos: o erro fala de TOKENS ou de REQUISICOES?
    //   - TOKENS: quem manda e' o `remaining-tokens` (TPM). Zero = o minuto de
    //     tokens acabou; > 0 = os TOKENS DO DIA acabaram (TPD) -> 'dia'.
    //   - REQUISICOES: quem manda e' o `remaining-requests` (RPD). Zero = o dia
    //     acabou; > 0 = o minuto (RPM) -> 'minuto'.
    const falaDeTokens = /token/i.test(msg);
    let escopo;
    if (falaDeTokens) {
      // O `remaining-tokens` e' do TPM. Com ele em 0 e a espera curta, e' o
      // MINUTO; com ele > 0 (ou sem o header), o que acabou foi o DIA.
      if (h.tokensRestantes !== null && h.tokensRestantes <= 0 && h.retryAfter > 0 && h.retryAfter < LIMITE_DIARIO_SEGUNDOS) {
        escopo = 'minuto';
      } else if (h.tokensRestantes !== null && h.tokensRestantes > 0) {
        escopo = 'dia';
      } else {
        escopo = h.retryAfter === 0 || h.retryAfter >= LIMITE_DIARIO_SEGUNDOS ? 'dia' : 'minuto';
      }
    } else if (h.restantes !== null && Number.isFinite(h.restantes)) {
      escopo = h.restantes <= 0 ? 'dia' : 'minuto';
    } else {
      // Sem o header: o TEXTO do erro (o Groq diz "per day (RPD)" ou
      // "per minute (RPM)").
      const diario = /per\s*day|\(rpd\)|\(tpd\)|daily|requests per day|tokens per day|por\s*dia/i.test(msg);
      const porMinuto = /per\s*minute|\(rpm\)|\(tpm\)|per\s*hour|\(tph\)|por\s*minuto|por\s*hora/i.test(msg);
      // Sem nem isso: uma espera LONGA (ou desconhecida) inclina para o dia.
      escopo = (diario || (!porMinuto && (h.retryAfter === 0 || h.retryAfter >= LIMITE_DIARIO_SEGUNDOS)))
        ? 'dia'
        : 'minuto';
    }

    // O QUE estourou, para o rotulo ser honesto (era sempre "por minuto").
    // `dia` + tokens = TPD; `dia` + requisicoes = RPD; o resto e' minuto/hora.
    const limite = escopo === 'dia'
      ? (falaDeTokens ? 'tpd' : 'rpd')
      : (falaDeTokens ? 'tpm' : 'rpm');

    // QUANDO a cota do dia volta, segundo o proprio Groq. E' uma JANELA MOVEL:
    // o valor vem em SEGUNDOS a partir de agora (a doc mostra `2m59.56s` para o
    // reset do RPD) — NAO e' "meia-noite". Por isso a espera pode ser 4000s.
    const resetSeg = escopo === 'dia'
      ? (falaDeTokens ? (h.resetTokensSegundos || h.resetSegundos) : h.resetSegundos)
      : 0;
    const resetEm = (escopo === 'dia' && resetSeg > 0)
      ? Date.now() + (resetSeg * 1000)
      : null;

    const ROTULOS = {
      rpd: 'a cota DIÁRIA de REQUISIÇÕES desta chave acabou',
      tpd: 'a cota DIÁRIA de TOKENS desta chave acabou',
      rpm: 'o limite por MINUTO de requisições foi atingido',
      tpm: 'o limite por MINUTO de tokens foi atingido'
    };
    return {
      tipo: 'limite',
      escopo,
      limite,
      retryAfter: h.retryAfter || (escopo === 'dia' ? 0 : 60),
      resetEm,
      resetSegundos: resetSeg,
      http,
      detalhe,
      // As mensagens carregam "Limite de requisições" de proposito: o
      // `mensagemErroIA` (index.js) classifica o erro pelo TEXTO da mensagem.
      mensagem: escopo === 'dia'
        ? `Limite de requisições do Groq: ${ROTULOS[limite]} (ela volta sozinha — e' uma janela movel, nao a meia-noite).`
        : `Limite de requisições do Groq: ${ROTULOS[limite]} (temporário — volta em instantes).`
    };
  }
  if (
    !http || e?.code === 'ECONNABORTED' || e?.code === 'ETIMEDOUT' ||
    e?.code === 'ENOTFOUND' || e?.code === 'ECONNREFUSED' || e?.code === 'EAI_AGAIN' || http === 408
  ) {
    return {
      tipo: 'rede',
      http,
      detalhe,
      mensagem: /timeout|tempo|ECONNABORTED|ETIMEDOUT/i.test(baixo) || e?.code === 'ECONNABORTED' || e?.code === 'ETIMEDOUT'
        ? 'Tempo esgotado ao chamar o Groq.'
        : 'Falha de rede ao chamar o Groq.'
    };
  }
  if (http === 400 || http === 404 || http === 413 || http === 422) {
    return { tipo: 'payload', http, detalhe, mensagem: `Requisição recusada pelo Groq: ${detalhe}` };
  }
  return { tipo: 'outro', http, detalhe, mensagem: detalhe || 'Erro desconhecido no Groq.' };
}

/**
 * Conversa (LLM): texto -> resposta.
 *
 * ## `maxTokens`: o teto de 220 e' de VOZ
 *
 * A conversa de voz quer resposta curta (3 frases faladas). Mas este mesmo
 * cliente atende os comandos de TEXTO (`!resumir`, `!gerarhistoria`, `!ideia`),
 * onde 220 tokens truncariam a resposta no meio. Por isso o teto e' por chamada:
 * quem quer texto longo passa o seu.
 *
 * @param {object} p
 * @param {string} p.texto
 * @param {string} [p.sistema] prompt do sistema
 * @param {Array<{role:string, content:string}>} [p.historico]
 * @param {string} [p.modelo]
 * @param {number} [p.maxTokens] teto de tokens da resposta (padrao: 220, de voz)
 * @param {number} [p.temperatura]
 * @returns {Promise<{ ok: boolean, texto?: string, motivo?: string, detalhe?: string, modelo?: string }>}
 */
export async function groqChat({ texto, sistema, historico = [], modelo = MODELO_LLM, maxTokens, temperatura } = {}) {
  // `chaveGroq()` devolve '' tambem quando todas estao so' de castigo (a chave
  // existe e esta' viva). Dizer "sem_chave_groq" ali mandaria o dono procurar
  // um problema de configuracao que nao existe.
  const indisponivel = motivoDaIndisponibilidade();
  if (indisponivel) {
    if (indisponivel === 'castigo') {
      // A MESMA mensagem do caminho do failover — o `mensagemErroIA` (index.js)
      // classifica o erro pelo TEXTO, entao os dois caminhos tem de casar.
      const info = classificarErroGroq(erroDeLimiteTemporario());
      return { ok: false, motivo: 'limite', detalhe: info.detalhe, mensagem: info.mensagem };
    }
    return { ok: false, motivo: 'sem_chave_groq' };
  }
  if (!texto) return { ok: false, motivo: 'texto_vazio' };

  const mensagens = [];
  if (sistema) mensagens.push({ role: 'system', content: sistema });
  for (const h of historico) {
    if (!h?.content) continue;
    mensagens.push({ role: h.role === 'assistant' ? 'assistant' : 'user', content: String(h.content) });
  }
  mensagens.push({ role: 'user', content: String(texto) });

  try {
    // O FAILOVER de chave: se esta estourou a cota (429) ou e' invalida
    // (401/403), a proxima assume na hora — e' o que faz o plano gratis durar.
    const resp = await comFailoverDeChave((apiKey) => post(`${BASE}/chat/completions`, {
      model: modelo,
      messages: mensagens,
      // Conversa de VOZ: resposta curta e' mais natural E mais rapida de
      // sintetizar. 400 tokens davam paragrafos; 220 cabe 3 frases faladas.
      temperature: Number.isFinite(temperatura)
        ? temperatura
        : Number.parseFloat(process.env.IAP_LLM_TEMP || '0.8'),
      max_tokens: Number.isFinite(maxTokens) && maxTokens > 0
        ? maxTokens
        : Number.parseInt(process.env.IAP_LLM_MAX_TOKENS || '220', 10)
    }, {
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      timeout: TIMEOUT_LLM_MS
    }));
    const resposta = resp?.data?.choices?.[0]?.message?.content;
    const limpo = typeof resposta === 'string' ? resposta.trim() : '';
    if (!limpo) return { ok: false, motivo: 'resposta_vazia' };
    return { ok: true, texto: limpo, modelo };
  } catch (e) {
    const r = classificarErroGroq(e);
    return { ok: false, motivo: r.tipo, detalhe: r.detalhe, mensagem: r.mensagem };
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Transcricao (Whisper)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Extensao de arquivo a partir do mimetype.
 *
 * ## O BUG que isto corrige
 *
 * O Groq decide o formato pela **EXTENSAO do nome do arquivo**, nao pelo
 * mimetype. Mandar o arquivo como `'audio'` (sem extensao) faz a API recusar:
 *
 *     file must be one of the following types: [flac mp3 mp4 mpeg mpga m4a
 *     ogg opus wav webm]
 *
 * Uma nota de voz do WhatsApp e' OGG/Opus, entao o nome certo e' `audio.ogg`.
 *
 * @param {string} mimeType
 * @returns {string} extensao SEM ponto (ex.: 'ogg')
 */
export function extensaoDoAudio(mimeType) {
  const m = String(mimeType || '').toLowerCase().split(';')[0].trim();
  const mapa = {
    'audio/ogg': 'ogg',
    'audio/opus': 'opus',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/mp4': 'm4a',
    'audio/m4a': 'm4a',
    'audio/x-m4a': 'm4a',
    'audio/wav': 'wav',
    'audio/wave': 'wav',
    'audio/x-wav': 'wav',
    'audio/webm': 'webm',
    'audio/flac': 'flac',
    'audio/x-flac': 'flac',
    'video/mp4': 'mp4',
    'video/mpeg': 'mpeg',
    'video/webm': 'webm'
  };
  return mapa[m] || 'ogg';
}

/** Formatos que o Whisper aceita (a extensao decide). */
const EXTENSOES_OK = new Set(['flac', 'mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'ogg', 'opus', 'wav', 'webm']);

/**
 * Detecta o formato pelos BYTES INICIAIS (magic bytes).
 *
 * O mimetype que o WhatsApp manda **pode divergir** do arquivo. Ler o magic
 * byte faz a extensao descrever o que o arquivo **e'**, nao o que ele **diz**.
 *
 * @param {Buffer} b
 * @returns {string|null}
 */
export function extensaoPorConteudo(b) {
  if (!Buffer.isBuffer(b) || b.length < 4) return null;
  const h = b.toString('hex', 0, 4).toLowerCase();
  if (h.startsWith('4f676753')) return 'ogg';   // "OggS"
  if (h.startsWith('52494646')) return 'wav';   // "RIFF"
  if (h.startsWith('494433') || h.startsWith('fffb') || h.startsWith('fff3')) return 'mp3';
  if (h === '1a45dfa3') return 'webm';          // EBML
  if (h.startsWith('664c6143')) return 'flac';  // "fLaC"
  if (b.length >= 8 && b.toString('ascii', 4, 8) === 'ftyp') return 'm4a';
  return null;
}

/**
 * Garante um audio em formato aceito pelo Whisper.
 *
 * O CONTEUDO manda sobre o mimetype; se nao reconhecer (ex.: `amr`, `3gp`),
 * converte para **OGG/Opus** com o ffmpeg do sistema.
 *
 * @param {Buffer} arquivo
 * @param {string} extensaoDoMime
 * @returns {Promise<{ bytes: Buffer, extensao: string, convertido: boolean }>}
 */
export function normalizarParaGroq(arquivo, extensaoDoMime) {
  const porConteudo = extensaoPorConteudo(arquivo);
  if (porConteudo && EXTENSOES_OK.has(porConteudo)) {
    return Promise.resolve({ bytes: arquivo, extensao: porConteudo, convertido: false });
  }
  // Conteudo DESCONHECIDO: nao da' para confiar no mimetype (ele vira 'ogg' por
  // padrao e "passaria", mas o arquivo pode ser amr/3gp). Converter e' seguro.
  const ext = porConteudo || extensaoDoMime || 'desconhecido';
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(process.env.FFMPEG_PATH || 'ffmpeg', [
        '-hide_banner', '-loglevel', 'error',
        '-i', 'pipe:0',
        '-vn', '-c:a', 'libopus', '-b:a', '64k', '-ar', '48000', '-ac', '1',
        '-f', 'ogg', 'pipe:1'
      ], { stdio: ['pipe', 'pipe', 'ignore'] });
    } catch {
      resolve({ bytes: arquivo, extensao: ext, convertido: false });
      return;
    }
    const pedacos = [];
    let terminou = false;
    const encerrar = (v) => { if (!terminou) { terminou = true; clearTimeout(t); resolve(v); } };
    const t = setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* ok */ } encerrar({ bytes: arquivo, extensao: ext, convertido: false }); }, 60000);
    proc.on('error', () => encerrar({ bytes: arquivo, extensao: ext, convertido: false }));
    proc.stdout.on('data', (d) => pedacos.push(d));
    proc.stdout.on('end', () => {
      const b = Buffer.concat(pedacos);
      if (b.length > 100) encerrar({ bytes: b, extensao: 'ogg', convertido: true });
      else encerrar({ bytes: arquivo, extensao: ext, convertido: false });
    });
    try {
      proc.stdin.on('error', () => { /* EPIPE */ });
      proc.stdin.end(arquivo);
    } catch { encerrar({ bytes: arquivo, extensao: ext, convertido: false }); }
  });
}

/**
 * Transcreve um ARQUIVO de audio (ou um WAV gerado do PCM).
 *
 * @param {Buffer} arquivo
 * @param {string} [mimeType]
 * @returns {Promise<{ ok: boolean, texto?: string, motivo?: string, detalhe?: string, modelo?: string }>}
 */
export async function groqTranscrever(arquivo, mimeType = 'audio/ogg', { prompt } = {}) {
  if (!arquivo || !arquivo.length) return { ok: false, motivo: 'audio_vazio' };
  // `chaveGroq()` devolve '' tambem quando todas estao so' de castigo (a chave
  // existe e esta' viva). Dizer "sem_chave_groq" ali mandaria o dono procurar
  // um problema de configuracao que nao existe.
  const indisponivel = motivoDaIndisponibilidade();
  if (indisponivel) {
    if (indisponivel === 'castigo') {
      // A MESMA mensagem do caminho do failover — o `mensagemErroIA` (index.js)
      // classifica o erro pelo TEXTO, entao os dois caminhos tem de casar.
      const info = classificarErroGroq(erroDeLimiteTemporario());
      return { ok: false, motivo: 'limite', detalhe: info.detalhe, mensagem: info.mensagem };
    }
    return { ok: false, motivo: 'sem_chave_groq' };
  }

  const ext = extensaoDoAudio(mimeType);
  const pronto = await normalizarParaGroq(arquivo, ext);

  try {
    const form = new FormData();
    form.append('file', new Blob([pronto.bytes], { type: mimeType }), `audio.${pronto.extensao}`);
    form.append('model', MODELO_STT);
    form.append('language', 'pt');
    form.append('response_format', 'text');
    // TEMPERATURA 0: transcricao e' tarefa deterministica — sem isso o Whisper
    // "inventa" em audio ruim (alucinacao), e um comando vira frase aleatoria.
    form.append('temperature', '0');
    // PROMPT DE CONTEXTO: o Whisper usa o texto anterior como VIÉS do vocabulario.
    // Com os nomes dos comandos e as palavras que ele costuma errar (toca, baixa,
    // figurinha...), o reconhecimento acerta o que interessa. E' a melhoria de
    // "entendimento" sem trocar de modelo.
    const vies = prompt || PROMPT_STT;
    if (vies) form.append('prompt', vies);

    // Mesmo failover do chat: a chave que estourou sai, a proxima assume.
    const resp = await comFailoverDeChave((apiKey) => post(`${BASE}/audio/transcriptions`, form, {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: TIMEOUT_STT_MS
    }));
    const bruto = typeof resp?.data === 'string' ? resp.data : (resp?.data?.text || '');
    const texto = String(bruto).trim();
    if (!texto) return { ok: false, motivo: 'sem_fala', modelo: MODELO_STT };
    return { ok: true, texto, modelo: MODELO_STT };
  } catch (e) {
    const r = classificarErroGroq(e);
    return { ok: false, motivo: r.tipo, detalhe: r.detalhe, mensagem: r.mensagem };
  }
}

/**
 * Reseta o estado das chaves (volta tudo para a primeira).
 *
 * E' o mesmo reset do dia (00:00) — usado pelo comando do dono e pelos testes.
 * @param {boolean} [apagarArquivo] `true` remove o arquivo do estado
 */
export {
  resetarEsgotadas, estaEsgotada, estadoDasChaves, diaDoEstado, situacaoDasChaves,
  // O castigo de MINUTO (a chave esta' viva, so' esperando) — separado do
  // `esgotada` (cota do dia). O painel do dono usa os dois.
  emCooldown, marcarCooldown, limparCooldowns, segundosDeCooldown,
  // O congelamento da CONTA inteira (cota por organizacao) e o opt-in de
  // varias contas — o painel do dono e o `!keygroq` usam os dois.
  marcarCooldownTodas, chavesSaoDeContasDiferentes
} from './groqKeys.js';

/** @deprecated Use `resetarEsgotadas`. Mantido para os testes antigos. */
export { resetarEsgotadas as resetarChaveGroq } from './groqKeys.js';

/** Modelos em uso (diagnostico/testes). */
export function configGroq() {
  return { stt: MODELO_STT, llm: MODELO_LLM, base: BASE };
}
