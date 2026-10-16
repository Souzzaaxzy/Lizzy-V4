/**
 * Eleva o bitrate do encoder MLow acima do padrao de 15 kbps.
 *
 * ## Por que existe
 *
 * O encoder abre com `DEFAULT_BITRATE = 15000` porque nem o plugin nem o media
 * plane repassam `bitrate` ao `MLowCodec.create`. Aqui o `create` e'
 * interceptado para injetar o valor -- sem editar `node_modules`, que a
 * proxima atualizacao sobrescreveria.
 *
 * ## O teto e' do protocolo
 *
 * A doc descreve o REMB, negociado com quem recebe: a qualidade fica em
 * "15 kbps probing state" ate' o REMB chegar, e o teto "sits just over its
 * 24 kbps managed band". Pedir 64 kbps nao ajuda -- o receptor manda o REMB
 * pedindo para baixar e o encoder obedece.
 *
 * Por isso o padrao e' 24000 e o valor e' limitado a {@link MAX_BPS}.
 *
 * ## Como desligar
 *
 * `ZAPO_MLOW_BITRATE=0` (ou `off`) deixa o padrao do pacote (15000).
 */

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

/** Teto pratico: a banda "managed" do REMB e' 24 kbps. */
const MAX_BPS = 30000;
/** Piso: a doc diz "never under 16 kbps"; 8 kbps da' margem sem ser absurdo. */
const MIN_BPS = 8000;
const PADRAO_BPS = 24000;

let instalado = false;
let bitrateAtivo = null;

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
    console.warn(`[MLOW-BITRATE] ${n} bps acima do teto do REMB (~${MAX_BPS}); usando ${MAX_BPS}`);
    return MAX_BPS;
  }
  if (n < MIN_BPS) {
    console.warn(`[MLOW-BITRATE] ${n} bps abaixo do piso; usando ${MIN_BPS}`);
    return MIN_BPS;
  }
  return n;
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
 * Intercepta o `MLowCodec.create` para injetar o bitrate. Idempotente.
 *
 * @param {number|null} [bps] o bitrate (null = nao mexe)
 * @returns {Promise<boolean>} true se o gancho ficou ativo
 */
export async function instalarBitrate(bps = bitrateConfigurado()) {
  if (instalado) return bitrateAtivo !== null;
  if (bps === null) return false;

  const alvo = caminhoDoCodec();
  if (!alvo) {
    console.warn('[MLOW-BITRATE] nao achei o mlow-codec.js no pacote');
    return false;
  }

  try {
    const exigir = createRequire(import.meta.url);
    // O require CJS devolve o MESMO objeto que o media plane ja' carregou
    // (cache por caminho resolvido) -- por isso a troca tem efeito.
    const mod = exigir(alvo);
    const Classe = mod?.MLowCodec;
    if (!Classe || typeof Classe.create !== 'function') {
      console.warn('[MLOW-BITRATE] MLowCodec.create nao encontrado');
      return false;
    }

    const original = Classe.create.bind(Classe);
    Classe.create = async (opts = {}) => {
      // So injeta quando o chamador NAO pediu bitrate: respeita quem sabe o
      // que quer (um teste que passe o proprio valor, por exemplo).
      const comBitrate = (opts && opts.bitrate === undefined)
        ? { ...opts, bitrate: bps }
        : opts;
      return original(comBitrate);
    };

    instalado = true;
    bitrateAtivo = bps;
    return true;
  } catch (e) {
    console.warn('[MLOW-BITRATE] nao consegui instalar:', e?.message || e);
    return false;
  }
}

/** O bitrate que ficou ativo, ou null. */
export function bitrateEmUso() {
  return bitrateAtivo;
}
