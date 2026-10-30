/**
 * AS CHAVES DO GROQ — ate' 10, com troca automatica quando uma acaba.
 *
 * ## O pedido do dono
 *
 * *"o plano e' gratis e acaba, entao quero adicionar mais de uma chave para que
 * quando uma acabar usar a proxima imediatamente"* — com os comandos
 * `!keygroq1` ate' `!keygroq10` (o `1` e' a chave de sempre).
 *
 * ## Por que o failover e' por CHAVE (e nao por "tentar de novo")
 *
 * O Groq responde **401/403** quando a chave e' invalida e **429** quando a cota
 * acabou. Nos dois casos tentar a MESMA chave de novo nao adianta — o que
 * resolve e' a PROXIMA. Por isso a rotacao so' acontece nesses dois motivos: um
 * erro de rede nao deve queimar a cota de outra chave a toa.
 *
 * ## Os nomes no `.env`
 *
 *   slot 1  -> GROQ_API_KEY      (a de sempre: `!keygroq`)
 *   slot 2  -> GROQ_API_KEY_2    (`!keygroq2`)
 *   ...
 *   slot 10 -> GROQ_API_KEY_10   (`!keygroq10`)
 *
 * O slot 1 mantem o nome antigo de proposito: quem ja' configurou nao perde
 * nada, e o `.env` continua legivel.
 *
 * Modulo PURO: recebe o `env` por parametro e nao abre socket.
 */

import fs from 'fs';
import path from 'path';
import { DONO_DIR } from './paths.js';

/** Quantas chaves cabem (o dono pediu 10). */
export const MAX_SLOTS = 10;

/** O nome da variavel de um slot. */
export function nomeDaVar(slot) {
  const n = Number.parseInt(slot, 10);
  if (!Number.isFinite(n) || n <= 1) return 'GROQ_API_KEY';
  return `GROQ_API_KEY_${n}`;
}

/**
 * Le' as chaves configuradas, NA ORDEM dos slots.
 *
 * Slot sem valor simplesmente nao entra — entao uma lista com "buracos"
 * (1, 3, 5) funciona: a rotacao passa de uma para a outra.
 *
 * @param {object} [env] padrao: `process.env`
 * @returns {Array<{slot: number, var: string, chave: string}>}
 */
export function lerChaves(env = process.env) {
  const saida = [];
  for (let slot = 1; slot <= MAX_SLOTS; slot++) {
    const valor = String((env || {})[nomeDaVar(slot)] || '').trim();
    if (valor) saida.push({ slot, var: nomeDaVar(slot), chave: valor });
  }
  return saida;
}

/** Mostra so' o comeco e o fim (nunca a chave inteira em log/mensagem). */
export function mascarar(chave) {
  const s = String(chave || '');
  if (!s) return 'nao configurada';
  if (s.length <= 8) return '*'.repeat(s.length);
  return `${s.slice(0, 4)}...${s.slice(-4)}`;
}

/** O nome de comando de um slot (`!keygroq`, `!keygroq2`, ...). */
export function comandoDoSlot(slot) {
  const n = Number.parseInt(slot, 10);
  return (!Number.isFinite(n) || n <= 1) ? 'keygroq' : `keygroq${n}`;
}

/**
 * Le' o slot a partir do NOME DO COMANDO **ou dos ARGUMENTOS**.
 *
 * ## O bug que isto corrige
 *
 * O dono usava `!keygroq off 2` para apagar a SEGUNDA chave. Mas o comando era
 * `keygroq` (slot 1) e o `2` ia nos argumentos — entao ele apagava o **slot 1**
 * de novo, e o segundo comando respondia "o slot 1 ja esta vazio". O numero
 * tem que ser lido de ONDE ELE ESTIVER:
 *
 *   `!keygroq2 off`   -> slot 2 (numero no comando)
 *   `!keygroq off 2`  -> slot 2 (numero no argumento)  <- o que o dono usa
 *   `!keygroq 2 off`  -> slot 2 (numero antes do off)
 *
 * Sem numero em lugar nenhum, vale o slot do comando (`keygroq` = 1).
 *
 * @param {string} comando
 * @param {string} [args] o que veio depois do comando
 * @returns {number|null}
 */
export function slotDoComando(comando, args = '') {
  // 1) O numero no NOME do comando tem prioridade (`keygroq7`).
  const doComando = slotDoNome(comando);
  const temNoNome = /^(?:keygroq|groqkey)\d{1,2}$/.test(String(comando || '').toLowerCase().trim());
  if (temNoNome) return doComando;

  // 2) O numero nos ARGUMENTOS (o caso `!keygroq off 2`).
  const palavras = String(args || '').trim().split(/\s+/).filter(Boolean);
  for (const p of palavras) {
    const n = Number.parseInt(p, 10);
    if (Number.isFinite(n) && String(n) === p && n >= 1 && n <= MAX_SLOTS) return n;
  }

  // 3) Sem numero: o slot do comando (`keygroq` = 1).
  return doComando;
}

/** O slot APENAS pelo nome do comando (a regra antiga). */
function slotDoNome(comando) {
  const c = String(comando || '').toLowerCase().trim();
  if (c === 'keygroq' || c === 'groqkey') return 1;
  const m = c.match(/^(?:keygroq|groqkey)(\d{1,2})$/);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return (n >= 1 && n <= MAX_SLOTS) ? n : null;
}

/**
 * Atualiza (ou cria/remove) a linha de UM slot no conteudo do `.env`.
 *
 * Puro: devolve o conteudo novo, nao escreve arquivo. Assim da' para testar a
 * manipulacao de texto sem tocar no `.env` de verdade.
 *
 * @param {string} conteudo o `.env` inteiro
 * @param {number} slot
 * @param {string|null} valor `null`/vazio REMOVE a linha
 * @returns {string}
 */
export function atualizarEnv(conteudo, slot, valor) {
  const nome = nomeDaVar(slot);
  const linhas = String(conteudo || '').split('\n');
  const re = new RegExp(`^${nome}=`);
  const novo = valor == null ? '' : String(valor).trim();

  let achou = false;
  const saida = [];
  for (const linha of linhas) {
    if (re.test(linha)) {
      achou = true;
      // Remover = apaga a linha; definir = troca pelo valor novo.
      if (novo) saida.push(`${nome}=${novo}`);
      continue;
    }
    saida.push(linha);
  }

  if (!achou && novo) {
    // Acrescenta no fim, respeitando se o arquivo termina com \n.
    const texto = saida.join('\n');
    return texto.endsWith('\n') || texto === ''
      ? `${texto}${nome}=${novo}\n`
      : `${texto}\n${nome}=${novo}\n`;
  }

  return saida.join('\n');
}


// ───────────────────────────────────────────────────────────────────────────
// O ESTADO DAS CHAVES (esgotadas hoje) — com RESET DIARIO
// ───────────────────────────────────────────────────────────────────────────
//
// ## Por que um arquivo (e nao so' memoria)
//
// A cota do Groq e' DIARIA. Se o bot reiniciar no meio do dia, ele tem que
// LEMBRAR quais chaves ja' estouraram — senao volta a tentar a primeira (que
// esta morta) em cada mensagem, que era exatamente o conflito relatado.
//
// ## O reset e' por DIA (00:00)
//
// `resetarEsgotadas()` zera a lista, e o `carregarEstado()` chama isso sozinho
// quando percebe que o dia mudou. Assim, virou o dia, tudo volta ao primeiro.

/** O arquivo onde o estado vive (junto dos outros dados do dono). */
function arquivoDeEstado() {
  return process.env.GROQ_KEYS_STATE_FILE
    || path.join(DONO_DIR, 'groqKeysState.json');
}

/** Quantos dias no futuro, no maximo, aceitamos como "reset da cota". */
const MAX_DIAS_DE_RESET = 2;

/**
 * O dia de hoje, no fuso do Brasil (o mesmo do resto do bot).
 *
 * Ele NAO decide mais quando uma chave volta: quem decide e' `esgotadasAte`
 * (o instante que o Groq informou). O dia serve para o estado nao crescer
 * indefinidamente e para o reset automatico de um dia para o outro.
 */
function hoje() {
  try {
    return new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/**
 * O estado em memoria (evita ler o disco a cada chamada).
 *
 * ## Duas marcas DIFERENTES (era o bug da rotacao)
 *
 *   - `esgotadasAte`: a cota do DIA acabou. A chave volta no instante que o
 *     Groq informou (`x-ratelimit-reset-requests`), nao na meia-noite local —
 *     a cota e' contada por ORGANIZACAO.
 *   - `cooldowns`: limite por MINUTO/HORA (`retry-after`). A chave esta' VIVA
 *     e volta sozinha em segundos.
 *
 * Os dois sao um INSTANTE de expiracao (`slot -> epoch ms`). `esgotadas` (a
 * lista, para o painel) e' DERIVADA: nunca ha' dois lugares para desencontrar.
 *
 * Antes so' existia `esgotadas`, e TODO 429 caia nela: um limite de minuto
 * queimava a chave ate' a meia-noite (e o dono precisava do `!keygroq reset`).
 */
let _estado = null;

/** O agora em ms. */
function agoraMs() {
  return Date.now();
}

/** Tira do estado os cooldowns que ja' venceram. */
function podarCooldowns(e) {
  const agora = agoraMs();
  const saida = {};
  for (const [slot, fim] of Object.entries(e.cooldowns || {})) {
    if (Number(fim) > agora) saida[slot] = Number(fim);
  }
  e.cooldowns = saida;
  return e;
}

/**
 * Tira do estado as chaves cuja COTA DO DIA ja' voltou.
 *
 * O estado e' por DIA (string), mas a cota do Groq e' contada por organizacao —
 * entao o reset pode nao cair na meia-noite do relogio local. Com
 * `esgotadasAte` (o instante que o Groq informou), a chave volta NA HORA CERTA:
 * nem antes (tomar outro 429) nem so' na virada do dia do bot.
 *
 * A lista `esgotadas` e as duas visoes do mesmo fato: uma pro painel ("X chaves
 * esgotadas hoje"), outra pro relogio.
 */
function podarEsgotadas(e) {
  const agora = agoraMs();
  const saida = {};
  for (const [slot, fim] of Object.entries(e.esgotadasAte || {})) {
    if (Number(fim) > agora) saida[slot] = Number(fim);
  }
  e.esgotadasAte = saida;
  // `esgotadas` e' DERIVADA de `esgotadasAte`: uma fonte so', impossivel
  // desencontrar as duas no disco.
  e.esgotadas = Object.keys(saida).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  return e;
}

/** Le' do disco, resetando se o dia virou. Nunca lanca. */
function carregarEstado() {
  const dia = hoje();
  if (_estado && _estado.dia === dia) return podarEsgotadas(podarCooldowns(_estado));
  let lido = null;
  try {
    lido = JSON.parse(fs.readFileSync(arquivoDeEstado(), 'utf8'));
  } catch { /* sem arquivo (ou corrompido): comeca limpo */ }
  // Dia diferente = reset. O `esgotadasAte` de HOJE ainda manda (a cota e' por
  // organizacao e pode voltar depois da nossa meia-noite), mas a lista de um
  // dia anterior nao vale mais.
  const mesmoDia = lido && lido.dia === dia;
  const eu = (lido && typeof lido === 'object') ? lido : {};
  _estado = {
    dia,
    esgotadasAte: mesmoDia && eu.esgotadasAte && typeof eu.esgotadasAte === 'object'
      ? { ...eu.esgotadasAte }
      : {},
    // O castigo de minuto vale mesmo entre reinicios: sao SEGUNDOS, nao o dia.
    cooldowns: mesmoDia && eu.cooldowns && typeof eu.cooldowns === 'object' ? { ...eu.cooldowns } : {}
  };
  podarEsgotadas(_estado);
  podarCooldowns(_estado);
  if (!mesmoDia && eu.esgotadas) gravarEstadoNormalizado();   // grava o reset
  return _estado;
}

/**
 * Grava o estado (best-effort: nao pode derrubar uma chamada de IA).
 *
 * Normaliza ANTES de escrever: o disco carrega os formatos antigos (sem
 * `esgotadasAte`), e um estado mesclado seria pior que um so'.
 */
function gravarEstadoNormalizado() {
  const e = _estado || { dia: hoje() };
  const normalizado = {
    dia: e.dia || hoje(),
    esgotadasAte: { ...(e.esgotadasAte || {}) },
    cooldowns: { ...(e.cooldowns || {}) }
  };
  podarEsgotadas(normalizado);
  podarCooldowns(normalizado);
  _estado = normalizado;
  gravarEstado();
}

/** Grava o estado (best-effort: nao pode derrubar uma chamada de IA). */
function gravarEstado() {
  try {
    fs.mkdirSync(path.dirname(arquivoDeEstado()), { recursive: true });
    // SO' a forma canonica vai para o disco. `esgotadas` e' DERIVADA de
    // `esgotadasAte` — gravar as duas abriria a porta para elas se
    // desencontrarem num restart.
    const e = _estado || {};
    fs.writeFileSync(arquivoDeEstado(), JSON.stringify({
      dia: e.dia || hoje(),
      esgotadasAte: e.esgotadasAte || {},
      cooldowns: e.cooldowns || {}
    }, null, 2));
  } catch { /* segue so' na memoria */ }
}

/** O slot ja' estourou a cota do DIA? */
export function estaEsgotada(slot) {
  return carregarEstado().esgotadas.includes(Number(slot));
}

/**
 * Quantos segundos faltam para a cota do DIA voltar (0 = nao esta esgotada).
 * @param {number} slot
 * @returns {number}
 */
export function segundosParaReset(slot) {
  const e = carregarEstado();
  const fim = Number(e.esgotadasAte?.[Number(slot)] || 0);
  return Math.max(0, Math.ceil((fim - agoraMs()) / 1000));
}

/**
 * Marca o slot como COM A COTA DO DIA ESGOTADA.
 *
 * @param {number} slot
 * @param {number} [resetEm] instante (epoch ms) em que a cota volta, se o Groq
 *   informou (`x-ratelimit-reset-requests`). Sem isso, vale a virada do dia.
 */
export function marcarEsgotada(slot, resetEm = null) {
  const n = Number(slot);
  if (!Number.isFinite(n)) return;
  const e = carregarEstado();
  // O teto evita um header maluco (ou um relogio errado) prender a chave para
  // sempre. Sem o instante informado, vale a virada do dia.
  const limite = agoraMs() + (MAX_DIAS_DE_RESET * 24 * 60 * 60 * 1000);
  const fim = Number(resetEm);
  e.esgotadasAte[n] = Number.isFinite(fim) && fim > agoraMs() ? Math.min(fim, limite) : limite;
  gravarEstadoNormalizado();   // deriva a lista e normaliza o disco
}

/**
 * A chave esta' so' de CASTIGO (limite por minuto), nao esgotada?
 * @param {number} slot
 * @returns {boolean}
 */
export function emCooldown(slot) {
  const e = carregarEstado();
  const fim = Number(e.cooldowns?.[Number(slot)] || 0);
  return fim > agoraMs();
}

/** Quantos segundos faltam do castigo (0 = livre). */
export function segundosDeCooldown(slot) {
  const e = carregarEstado();
  const fim = Number(e.cooldowns?.[Number(slot)] || 0);
  return Math.max(0, Math.ceil((fim - agoraMs()) / 1000));
}

/**
 * Poe a chave de CASTIGO por `segundos` — para o limite por MINUTO/HORA.
 *
 * NAO e' "esgotada": a cota dela volta sozinha. Serve para nao bater na mesma
 * chave (e tomar outro 429) enquanto o limite nao passa.
 *
 * @param {number} slot
 * @param {number} [segundos]
 */
export function marcarCooldown(slot, segundos = 60) {
  const n = Number(slot);
  if (!Number.isFinite(n)) return;
  const seg = Math.max(1, Math.ceil(Number(segundos) || 0));
  const e = carregarEstado();
  e.cooldowns[n] = agoraMs() + (seg * 1000);
  gravarEstadoNormalizado();
}

/**
 * Poe TODAS as chaves de castigo por `segundos`.
 *
 * ## Por que TODAS (e nao so' a que falhou)
 *
 * A doc do Groq diz: *"Rate limits apply at the ORGANIZATION level, not
 * individual users"*. As chaves da MESMA conta dividem a MESMA cota — entao,
 * quando o limite e' por MINUTO/TOKENS, a conta inteira esta' estrangulada e
 * **nenhuma** chave dela vai passar.
 *
 * Sem isto, a proxima mensagem pulava para a chave 2 (ainda estrangulada),
 * depois a 3, e assim por diante: uma mensagem gastava N requisicoes da cota
 * COMPARTILHADA para, no fim, nao responder nada. Medido: com 5 chaves, uma
 * mensagem consumia 5 requisicoes. Era isso que fazia o dono esgotar em minutos
 * o que UMA chave aguentava por horas.
 *
 * E' opt-out: `GROQ_KEYS_MULTI_ORG=1` volta ao comportamento por chave, para
 * quem tem chaves de CONTAS DIFERENTES (ai' cada uma tem cota propria).
 *
 * @param {number} [segundos]
 */
export function marcarCooldownTodas(segundos = 60) {
  if (chavesSaoDeContasDiferentes()) return;
  const seg = Math.max(1, Math.ceil(Number(segundos) || 0));
  const e = carregarEstado();
  const fim = agoraMs() + (seg * 1000);
  for (const c of lerChaves()) e.cooldowns[Number(c.slot)] = fim;
  gravarEstadoNormalizado();
}

/**
 * As chaves sao de CONTAS DIFERENTES? (opt-in explicito)
 *
 * So' nesse caso rotacionar ajuda num limite de minuto: cada conta tem cota
 * propria. Por padrao `false` — o caso comum (varias chaves da mesma conta) e'
 * cota COMPARTILHADA, e ai' rotacionar so' queima mais rapido.
 *
 * @param {object} [env]
 * @returns {boolean}
 */
export function chavesSaoDeContasDiferentes(env = process.env) {
  const v = String((env || {}).GROQ_KEYS_MULTI_ORG || '').trim().toLowerCase();
  return ['1', 'true', 'sim', 'yes', 'on'].includes(v);
}

/** Limpa os castigos (o `!keygroq reset` e os testes usam). */
export function limparCooldowns() {
  const e = carregarEstado();
  e.cooldowns = {};
  gravarEstadoNormalizado();
}

/**
 * O INDICE da primeira chave usavel a partir de `de`, ou -1.
 *
 * "Usavel" = nao estourou a cota do DIA e nao esta' de castigo de minuto. E' o
 * coracao da rotacao: a "chave atual" e' sempre esta — nao existe ponteiro
 * separado que possa ficar apontando para uma chave morta.
 *
 * Devolver o INDICE (e nao a chave) e' o que permite ao laco do failover
 * AVANCAR sempre depois de tentar uma — sem repetir a mesma chave.
 *
 * @param {Array<{slot:number, chave:string}>} [lista] padrao: `lerChaves()`
 * @param {number} [de] indice inicial (padrao 0)
 * @returns {number}
 */
export function indiceDisponivel(lista = lerChaves(), de = 0) {
  const e = carregarEstado();
  for (let i = Math.max(0, de); i < lista.length; i++) {
    const slot = Number(lista[i].slot);
    if (e.esgotadas.includes(slot)) continue;
    if (emCooldown(slot)) continue;
    return i;
  }
  return -1;
}

/**
 * A PRIMEIRA chave usavel (esgotada e castigo respeitados), ou `null`.
 * @param {Array<{slot:number, chave:string}>} [lista]
 * @param {number} [de]
 * @returns {{slot:number, chave:string}|null}
 */
export function primeiraDisponivel(lista = lerChaves(), de = 0) {
  const i = indiceDisponivel(lista, de);
  return i < 0 ? null : lista[i];
}

/**
 * A primeira chave que ainda NAO estourou a cota do DIA (IGNORA o castigo).
 *
 * E' o que responde "ainda tenho chave para hoje?". Um castigo de minuto NAO
 * significa que a chave morreu — por isso `situacaoDasChaves` usa esta e nao a
 * `primeiraDisponivel`.
 *
 * @param {Array<{slot:number, chave:string}>} [lista]
 * @returns {{slot:number, chave:string}|null}
 */
export function primeiraNaoEsgotada(lista = lerChaves()) {
  const esgotadas = carregarEstado().esgotadas;
  for (const c of lista) {
    if (!esgotadas.includes(Number(c.slot))) return c;
  }
  return null;
}

/**
 * Reseta o estado. Chamado quando o dia vira e pelo comando do dono.
 * @param {boolean} [apagarArquivo] `true` remove o arquivo (reset manual)
 */
export function resetarEsgotadas(apagarArquivo = false) {
  // O reset limpa TUDO: a cota do dia E os castigos de minuto. Era o que o dono
  // fazia na mao com o `!keygroq reset` para destravar a rotacao.
  _estado = { dia: hoje(), esgotadas: [], cooldowns: {}, esgotadasAte: {} };
  if (apagarArquivo) {
    try { fs.unlinkSync(arquivoDeEstado()); } catch { /* ja' nao existia */ }
  } else {
    gravarEstadoNormalizado();
  }
}

/**
 * Um retrato do estado, para o painel do dono.
 *
 * @param {Array<{slot:number, chave:string}>} [lista]
 * @returns {{dia: string, esgotadas: number[], chaves: Array<{slot:number, chave:string, esgotada:boolean, ativa:boolean}>}}
 */
export function estadoDasChaves(lista = lerChaves()) {
  const e = carregarEstado();
  const ativa = primeiraDisponivel(lista);
  return {
    dia: e.dia,
    esgotadas: [...e.esgotadas].sort((a, b) => a - b),
    emCooldown: Object.keys(e.cooldowns || {}).map(Number).sort((a, b) => a - b),
    chaves: lista.map((c) => ({
      slot: c.slot,
      chave: c.chave,
      esgotada: e.esgotadas.includes(Number(c.slot)),
      emCooldown: emCooldown(c.slot),
      cooldownRestante: segundosDeCooldown(c.slot),
      resetEmSegundos: segundosParaReset(c.slot),
      ativa: Boolean(ativa && ativa.slot === c.slot)
    }))
  };
}

/**
 * POR QUE nao ha chave disponivel agora.
 *
 * A distincao que faltava: `chaveGroq()` devolve `''` nos DOIS casos, e o
 * codigo tratava os dois como "nao configurada" — dizendo ao dono que a chave
 * nao estava definida **quando ela estava** (so' no limite).
 *
 * @param {Array<{slot:number, chave:string}>} [lista]
 * @returns {'ok'|'sem_chave'|'todas_esgotadas'} `ok` = tem chave para usar
 */
export function situacaoDasChaves(lista = lerChaves()) {
  if (!lista.length) return 'sem_chave';
  // IGNORA o castigo de minuto: uma chave em cooldown nao esta' "esgotada" —
  // ela volta em segundos. `todas_esgotadas` significa que a cota do DIA
  // acabou (so' volta no reset).
  return primeiraNaoEsgotada(lista) ? 'ok' : 'todas_esgotadas';
}

/** Quando foi o ultimo reset (o dia atual). Diagnostico. */
export function diaDoEstado() {
  return carregarEstado().dia;
}

/** Limpa o cache em memoria (teste). */
export function _limparCacheDeEstado() {
  _estado = null;
}
