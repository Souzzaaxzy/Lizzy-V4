/**
 * AntiFantasma — registro de KEYS da distribuição.
 *
 * Cada instalação recebe UMA key, vinculada a UMA pessoa. O registro guarda o
 * suficiente para: autorizar, revogar e auditar — sem virar um sistema genérico
 * de plugins.
 *
 * Regras que este módulo garante:
 *   - `id` numérico sequencial, ÚNICO e nunca reutilizado (o contador é
 *     persistido; revogar não libera o número);
 *   - uma key pertence a um dono (`owner`) e só ele pode usá-la;
 *   - revogar NÃO apaga o registro (preserva histórico e o número);
 *   - a key nunca é exposta inteira em log/relatório — só mascarada.
 *
 * Persistência: JSON no diretório de dados do bot, com escrita atômica (o
 * mesmo cuidado usado no resto do projeto: tmp único por chamada, depois
 * rename).
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { DATABASE_DIR } from '../utils/paths.js';

const KEYS_FILE = path.join(DATABASE_DIR, 'antifantasma', 'keys.json');
const PLUGIN_ID = 'antifantasma';

/** Formato atual do arquivo. Guardado junto para permitir migração futura. */
const VERSAO = 2;

/**
 * Estrutura em disco:
 * {
 *   version: 2,
 *   nextId: 4,
 *   keys: [ { id, key, owner, status, createdAt, ... } ]
 * }
 *
 * `nextId` é persistido de propósito: mesmo que um registro seja removido à
 * mão, o próximo número continua de onde parou — nunca volta para #1.
 */
function vazio() {
  return { version: VERSAO, nextId: 1, keys: [] };
}

/**
 * Lê o arquivo, migrando o formato antigo (mapa key→registro, sem id) quando
 * necessário. Assim uma instalação que já tinha keys não perde nada.
 */
function lerBruto() {
  let dados;
  try {
    dados = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf-8'));
  } catch {
    return vazio();
  }

  if (!dados || typeof dados !== 'object') return vazio();

  // Formato atual.
  if (Array.isArray(dados.keys)) {
    const maiorId = dados.keys.reduce((m, r) => Math.max(m, Number(r?.id) || 0), 0);
    return {
      version: VERSAO,
      // Nunca deixa o contador ficar atrás dos ids existentes.
      nextId: Math.max(Number(dados.nextId) || 1, maiorId + 1),
      keys: dados.keys,
    };
  }

  // Formato antigo (mapa). Migra atribuindo ids na ordem de leitura.
  const migrado = vazio();
  for (const [key, reg] of Object.entries(dados)) {
    migrado.keys.push({
      id: migrado.nextId++,
      key,
      owner: reg?.owner || null,
      status: reg?.active === false ? 'revoked' : 'active',
      createdAt: reg?.criadaEm || new Date().toISOString(),
      ...(reg?.revogadaEm ? { revokedAt: reg.revogadaEm } : {}),
      ...(reg?.descricao ? { descricao: reg.descricao } : {}),
    });
  }
  return migrado;
}

function gravar(estado) {
  fs.mkdirSync(path.dirname(KEYS_FILE), { recursive: true });
  const tmp = `${KEYS_FILE}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(estado, null, 2));
  fs.renameSync(tmp, KEYS_FILE);
}

// ───────────────────────────────────────────────────────────────────────────
// LEITURA
// ───────────────────────────────────────────────────────────────────────────

/** Todas as keys registradas, em ordem de id. */
export function listarKeys() {
  return lerBruto().keys.slice().sort((a, b) => a.id - b.id);
}

/** Busca pelo id numérico. */
export function buscarPorId(id) {
  const n = Number(id);
  if (!Number.isInteger(n)) return null;
  return lerBruto().keys.find((r) => r.id === n) || null;
}

/** Estatísticas para o painel do dono. */
export function estatisticas() {
  const { keys, nextId } = lerBruto();
  const ativas = keys.filter((k) => k.status === 'active').length;
  return {
    total: keys.length,
    ativas,
    revogadas: keys.filter((k) => k.status === 'revoked').length,
    proximoId: nextId,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// ESCRITA
// ───────────────────────────────────────────────────────────────────────────

/**
 * Cria uma key individual para um dono.
 *
 * @param {object} opts
 * @param {string} opts.owner identificador (JID/número) de quem recebe
 * @param {string} [opts.descricao]
 * @returns {{id: number, key: string, owner: string, status: string, createdAt: string}}
 */
export function criarKey({ owner, descricao = '' } = {}) {
  if (!owner || typeof owner !== 'string' || !owner.trim()) {
    throw new Error('owner_obrigatorio');
  }

  const estado = lerBruto();
  const id = estado.nextId;

  // Aleatoriedade criptográfica; formato legível para o dono copiar.
  const key = `MTX-GHOST-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

  const registro = {
    id,
    key,
    owner: owner.trim(),
    status: 'active',
    createdAt: new Date().toISOString(),
    ...(descricao ? { descricao: String(descricao).slice(0, 120) } : {}),
  };

  estado.keys.push(registro);
  estado.nextId = id + 1; // nunca reutiliza o número
  gravar(estado);

  return registro;
}

/**
 * Revoga pelo id. NÃO apaga: muda o status, preservando o histórico e o número.
 *
 * @returns {{ok: boolean, motivo?: string, registro?: object}}
 */
export function revogarPorId(id) {
  const n = Number(id);
  if (!Number.isInteger(n)) return { ok: false, motivo: 'id_invalido' };

  const estado = lerBruto();
  const registro = estado.keys.find((r) => r.id === n);
  if (!registro) return { ok: false, motivo: 'nao_encontrada' };
  if (registro.status === 'revoked') return { ok: false, motivo: 'ja_revogada', registro };

  registro.status = 'revoked';
  registro.revokedAt = new Date().toISOString();
  gravar(estado);

  return { ok: true, registro };
}

// ───────────────────────────────────────────────────────────────────────────
// AUTORIZAÇÃO
// ───────────────────────────────────────────────────────────────────────────

/**
 * Valida uma key para uma execução.
 *
 * A checagem roda SEMPRE aqui, no servidor — o cliente tem o próprio adaptador
 * e não pode ser a autoridade.
 *
 * Quando `botId` é informado, confere também que o dono da key é quem está
 * chamando. É isso que impede que o usuário B use a key do usuário A mesmo
 * tendo acesso ao arquivo.
 *
 * @param {string} key
 * @param {{botId?: string}} [opts]
 * @returns {{ok: boolean, motivo?: string, registro?: object}}
 */
export function validarKey(key, opts = {}) {
  if (typeof key !== 'string' || !key.trim()) return { ok: false, motivo: 'ausente' };

  const registro = lerBruto().keys.find((r) => r.key === key.trim());
  if (!registro) return { ok: false, motivo: 'inexistente' };
  if (registro.status !== 'active') return { ok: false, motivo: 'revogada' };

  // 1 key = 1 usuário. Sem dono registrado (key antiga), não dá para conferir;
  // aí a key continua valendo pelo status.
  const botId = typeof opts.botId === 'string' ? opts.botId.trim() : '';
  if (registro.owner && botId) {
    if (mesmoUsuario(registro.owner, botId)) return { ok: true, registro };
    return { ok: false, motivo: 'dono_diferente', registro };
  }

  return { ok: true, registro };
}

/**
 * Compara dois identificadores tolerando as formas JID/LID/número.
 * `5511999999999@s.whatsapp.net` casa com `5511999999999`.
 */
function mesmoUsuario(a, b) {
  if (a === b) return true;
  const so = (v) => String(v).split(':')[0].split('@')[0];
  return so(a) === so(b);
}

// ───────────────────────────────────────────────────────────────────────────
// APRESENTAÇÃO (nunca expõe a key inteira)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Mascara uma key para exibição/log: mantém o prefixo e os 4 últimos.
 * `MTX-GHOST-A1B2C3D4` -> `MTX-GH••••C3D4`
 */
export function mascararKey(key) {
  if (typeof key !== 'string' || !key) return '••••';
  const partes = key.split('-');
  const ultimos = key.slice(-4);
  const prefixo = partes[0] ? `${partes[0].slice(0, 3)}-` : '';
  const meio = partes[1] ? `${partes[1].slice(0, 2)}` : '';
  return `${prefixo}${meio}••••${ultimos}`;
}

export { KEYS_FILE, PLUGIN_ID, VERSAO };