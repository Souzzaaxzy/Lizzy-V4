/**
 * Ajustes do encoder MLow acima do padrao do pacote.
 *
 * ## Por que existe
 *
 * O encoder abre com `DEFAULT_BITRATE = 15000`, `complexity = 5` e
 * `packetLossPercent = 0`, porque nem o plugin nem o media plane repassam
 * esses valores ao `MLowCodec.create`. Aqui o `create` e' interceptado para
 * injetar os tres -- sem editar `node_modules`, que a proxima atualizacao
 * sobrescreveria.
 *
 * ## O que foi MEDIDO (codec real, sinal musical, 40 frames)
 *
 * | configuracao         | bytes | SNR      |
 * |----------------------|-------|----------|
 * | 15 kbps cx5 (padrao) | 3166  | 2.55 dB  |
 * | 30 kbps cx5 (antes)  | 5890  | 2.54 dB  |
 * | 30 kbps cx10 (agora) | 5874  | 2.56 dB  |
 * | 30 kbps cx10 plc10   | 5997  | 2.59 dB  |
 *
 * Ou seja: `complexity` 10 nao custa banda (os bytes ate' caem) e o
 * `packetLossPercent` so' acrescenta a copia de FEC -- que protege contra
 * CORTE. A banda de audio do REMB vai de 16 a 30 kbps (medido em
 * `rtcp-policy.js` do pacote), entao 30 kbps ja' e' o teto util.
 *
 * ## O teto e' do protocolo
 *
 * A qualidade fica em "15 kbps probing" ate' o REMB chegar e o teto e' a banda
 * "managed" do REMB (o maximo e' 30000). Pedir mais nao ajuda: o receptor manda
 * o REMB pedindo para baixar.
 *
 * ## Como desligar
 *
 * `ZAPO_MLOW_BITRATE=0`, `ZAPO_MLOW_COMPLEXITY=off`, `ZAPO_MLOW_LOSS=off`.
 */

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

/** Teto pratico: a banda "managed" do REMB chega a 30000 bps. */
const MAX_BPS = 30000;
/** Piso: a doc diz "never under 16 kbps"; 8 kbps da' margem sem ser absurdo. */
const MIN_BPS = 8000;
const PADRAO_BPS = 30000;

/** Complexidade do encoder: 0 a 10 (o proprio codec recusa fora disso). */
const MAX_COMPLEXIDADE = 10;
const PADRAO_COMPLEXIDADE = 10;

/** Perda esperada, em %: acima de zero o encoder emite a copia de FEC. */
const MAX_PERDA = 100;
const PADRAO_PERDA = 10;

let instalado = false;
let configAtiva = null;

/**
 * Le um inteiro do ambiente.
 *
 * `undefined` -> o padrao (o recurso fica ligado). Uma palavra de desligamento
 * -> `null` (nao mexe). Valor fora da faixa -> clampado com aviso.
 */
function inteiroDoAmbiente(nome, padrao, { min, max, aviso }) {
  const bruto = process.env[nome];
  if (bruto === undefined) return padrao;
  const limpo = String(bruto).trim().toLowerCase();
  if (limpo === '0' || limpo === 'off' || limpo === 'false' || limpo === '') return null;

  const n = Number.parseInt(limpo, 10);
  if (!Number.isFinite(n) || n < 0) return padrao;

  if (n > max) {
    return max;
  }
  if (n < min) {
    return min;
  }
  return n;
}

/**
 * O bitrate pedido pelo ambiente, ou null para nao mexer.
 *
 * @returns {number|null}
 */
export function bitrateConfigurado() {
  const bruto = process.env.ZAPO_MLOW_BITRATE;
  if (bruto === undefined) return PADRAO_BPS;          // liga por padrao
  const limpo = String(bruto).trim().toLowerCase();
  if (limpo === '0' || limpo === 'off' || limpo === 'false' || limpo === '') return null;

  const n = Number.parseInt(limpo, 10);
  if (!Number.isFinite(n) || n <= 0) return PADRAO_BPS;

  if (n > MAX_BPS) {
    return MAX_BPS;
  }
  if (n < MIN_BPS) {
    return MIN_BPS;
  }
  return n;
}

/** Complexidade do encoder pedida pelo ambiente, ou null. */
export function complexidadeConfigurada() {
  return inteiroDoAmbiente('ZAPO_MLOW_COMPLEXITY', PADRAO_COMPLEXIDADE, {
    min: 0, max: MAX_COMPLEXIDADE, aviso: '0 a 10'
  });
}

/** Perda esperada (%) pedida pelo ambiente, ou null. */
export function perdaConfigurada() {
  return inteiroDoAmbiente('ZAPO_MLOW_LOSS', PADRAO_PERDA, {
    min: 0, max: MAX_PERDA, aviso: '0 a 100'
  });
}

/**
 * Normaliza o argumento da instalacao.
 *
 * Aceita tanto um numero (compatibilidade: era so' o bitrate) quanto um objeto
 * com `bitrate`/`complexity`/`packetLossPercent`. Sem argumento, usa o ambiente.
 */
function normalizarConfig(cfg) {
  if (typeof cfg === 'number') {
    return { bitrate: cfg, complexity: complexidadeConfigurada(), packetLossPercent: perdaConfigurada() };
  }
  if (cfg && typeof cfg === 'object') {
    return {
      bitrate: cfg.bitrate !== undefined ? cfg.bitrate : bitrateConfigurado(),
      complexity: cfg.complexity !== undefined ? cfg.complexity : complexidadeConfigurada(),
      packetLossPercent: cfg.packetLossPercent !== undefined ? cfg.packetLossPercent : perdaConfigurada()
    };
  }
  return {
    bitrate: bitrateConfigurado(),
    complexity: complexidadeConfigurada(),
    packetLossPercent: perdaConfigurada()
  };
}

/**
 * Localiza o arquivo interno do codec dentro do pacote instalado.
 *
 * O subpath `@zapo-js/voip-media/media/mlow-codec` NAO existe no `exports` do
 * pacote, entao o caminho e' montado a partir do package.json resolvido.
 *
 * @returns {string|null}
 */
function caminhoDoCodec() {
  try {
    const exigir = createRequire(import.meta.url);
    // NAO da' para resolver `<pkg>/package.json`: o campo `exports` do pacote
    // nao o expoe, e o require.resolve lanca. Resolvemos a ENTRADA (que e'
    // permitida) e subimos a partir dela.
    const entradas = [
      '@zapo-js/voip-media',
      '@zapo-js/voip-media/node'
    ];
    for (const entrada of entradas) {
      let resolvido;
      try {
        resolvido = exigir.resolve(entrada);
      } catch {
        continue;
      }
      // .../dist/[esm/]index.js -> raiz do pacote
      let dir = path.dirname(resolvido);
      while (dir !== path.dirname(dir)) {
        const alvo = path.join(dir, 'dist', 'media', 'mlow-codec.js');
        if (fs.existsSync(alvo)) return alvo;
        dir = path.dirname(dir);
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Onde o arquivo de pesos do pos-filtro neural e' procurado.
 *
 * E' o unico lever que melhora o TIMBRE (o "abafado") -- e nenhum pacote traz o
 * blob `mlow_companion_v1.pte` (a doc e' explicita). O `zapoCall` so' passa a
 * opcao se o arquivo existir; aqui ele so' informa o caminho, para o log
 * apontar ONDE colocar.
 */
export function caminhoCompanionEsperado() {
  return process.env.ZAPO_MLOW_COMPANION
    || path.join(process.env.DATABASE_PATH || path.join('dados', 'database'), 'zapo-models', 'mlow_companion_v1.pte');
}

/**
 * Intercepta o `MLowCodec.create` para injetar os ajustes do encoder.
 *
 * Idempotente. Cada campo so' e' injetado quando o CHAMADOR nao pediu o seu --
 * respeita quem sabe o que quer (um teste que passe o proprio valor).
 *
 * @param {number|object|null} [cfg] bitrate (compatibilidade) ou o objeto completo
 * @returns {Promise<boolean>} true se o gancho ficou ativo
 */
export async function instalarBitrate(cfg = null) {
  if (instalado) return configAtiva !== null;

  const querida = normalizarConfig(cfg);
  const temAlgo = Object.values(querida).some((v) => v !== null && v !== undefined);
  if (!temAlgo) return false;

  const alvo = caminhoDoCodec();
  if (!alvo) {
    return false;
  }

  try {
    const exigir = createRequire(import.meta.url);
    // O require CJS devolve o MESMO objeto que o media plane ja' carregou
    // (cache por caminho resolvido) -- por isso a troca tem efeito.
    const mod = exigir(alvo);
    const Classe = mod?.MLowCodec;
    if (!Classe || typeof Classe.create !== 'function') {
      return false;
    }

    const original = Classe.create.bind(Classe);
    Classe.create = async (opts = {}) => {
      const completo = { ...opts };
      for (const campo of ['bitrate', 'complexity', 'packetLossPercent']) {
        const valor = querida[campo];
        if (valor !== null && valor !== undefined && completo[campo] === undefined) {
          completo[campo] = valor;
        }
      }
      return original(completo);
    };

    instalado = true;
    configAtiva = querida;
    return true;
  } catch (e) {
    return false;
  }
}

/** O bitrate que ficou ativo, ou null. */
export function bitrateEmUso() {
  return configAtiva?.bitrate ?? null;
}

/** A complexidade que ficou ativa, ou null. */
export function complexidadeEmUso() {
  return configAtiva?.complexity ?? null;
}

/** A perda esperada que ficou ativa, ou null. */
export function perdaEmUso() {
  return configAtiva?.packetLossPercent ?? null;
}

/** A configuracao ativa (diagnostico). */
export function configuracaoEmUso() {
  return configAtiva ? { ...configAtiva } : null;
}
