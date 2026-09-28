/**
 * Sistema de SUBDONOS — fonte única.
 *
 * Antes disso o subdono vivia em três lugares que discordavam entre si:
 *   - `subdonos.json` (a lista);
 *   - `subOwnerCommands.json` (uma "lista base" global aplicada a TODOS);
 *   - `subowner_perms.json` (permissões por subdono — código morto: nada lia).
 * As leituras/escritas eram espalhadas por `index.js` e `database.js`, quase
 * sempre com `fs.writeFileSync` cru e comparação por "base do número" (frágil
 * entre JID e LID).
 *
 * O desenho agora segue o modelo do bot de referência (RAVENA-BOT/Kimori):
 *   - **papéis, não listas paralelas**: dono > subdono com permissões;
 *   - **permissões POR SUBDONO**, granulares, e um comando novo liberado só
 *     para quem recebeu — não um "saco de comandos" que abre para todo mundo;
 *   - **identidade resolvida por conjunto de formas** (LID, JID, número), que é
 *     como o bot de referência compara donos (`numerodono` como lista);
 *   - **persistência atômica**, com os dois formatos possíveis migrados.
 *
 * Formato em disco (`dono/subdonos.json`):
 * ```json
 * {
 *   "version": 2,
 *   "subdonos": [
 *     { "id": "123@lid", "aliases": ["5511...@s.whatsapp.net"], "perms": ["menu", "ping"], "addedAt": 1699999999999 }
 *   ],
 *   "basePerms": ["perfil", "daily"]
 * }
 * ```
 * `basePerms` é o conjunto mínimo que **todo** subdono pode usar (o que antes
 * era a "lista base"). Cada subdono ainda pode receber comandos extras.
 *
 * Compatibilidade: uma lista antiga (`{ subdonos: ["123@lid"] }`) e o mapa de
 * comandos antigos (`subOwnerCommands.json`) são migrados na primeira leitura,
 * sem perder ninguém nem permissão.
 */

import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { SUBDONOS_FILE, DONO_DIR, DATABASE_DIR } from './paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SUBCOMMANDS_FILE_LEGACY = `${DATABASE_DIR}/subOwnerCommands.json`;

/** Teto de subdonos. O `!donos` lista exatamente esses (até o máximo). */
export const MAX_SUBDONOS = 5;

/**
 * Permissão TOTAL (`!sub.permitir @user all`).
 *
 * Um subdono com esta permissão usa **qualquer** comando do bot, como o dono.
 * Fica representada pelo literal `all` na lista `perms` do registro (não é um
 * comando, é um coringa). A hierarquia é preservada fora daqui: os comandos de
 * GESTÃO de subdonos continuam exigindo o Dono principal (ver `index.js`).
 */
export const ALL_PERM = 'all';

/** Normaliza um token de permissão; `all`/`todos`/`tudo`/`*` viram `all`. */
function normalizarPerm(p) {
  const raw = String(p ?? '').toLowerCase().replace(/^[!/.]/, '').trim();
  if (!raw) return '';
  if (raw === '*' || raw === 'all' || raw === 'todos' || raw === 'tudo') return ALL_PERM;
  return raw;
}

/** `true` quando a lista de permissões cobre o comando (ou tem `all`). */
function permsIncluem(perms, cmd) {
  return perms.includes(ALL_PERM) || perms.includes(cmd);
}

/**
 * Comandos que a permissão TOTAL (`all`) NÃO cobre — são o que sustenta a
 * HIERARQUIA (dono principal > subdono). Sem esta lista, um subdono com `all`
 * poderia se promover (é a origem da própria permissão) ou redefinir a
 * identidade do dono, deixando de ser subdono.
 */
export const HIERARQUIA_COMMANDS = new Set([
  'addsubdono', 'delsubdono', 'remsubdono', 'rmsubdono',
  'sub.permitir', 'subpermitir', 'sub.revogar', 'subrevogar',
  'numero-dono', 'nomedono', 'nome-bot',
]);

/** `true` se o comando é sensível à hierarquia (só o Dono principal). */
export function ehComandoDeHierarquia(cmd) {
  return HIERARQUIA_COMMANDS.has(String(cmd || '').replace(/^[!/.]/, '').toLowerCase().trim());
}

/**
 * O que um subdono pode fazer além dos comandos liberados.
 * São PORTAS (funcionalidades), não comandos individuais — é assim que o
 * modelo de "papéis" do bot de referência é expressado aqui.
 */
export const SUBDONO_CAPABILITIES = {
  gerenciar_antis: 'Ligar/desligar proteções (antilink, antifake, antiflood…)',
  gerenciar_grupo: 'Comandos de administração do grupo (trancar, abrir, ban…)',
  gerenciar_aluguel: 'Gerir aluguel de grupos',
  gerenciar_bot: 'Ligar/desligar o bot (so_dono, ligar/desligar)',
  gerenciar_subdonos: 'Adicionar/remover subdonos e liberar comandos',
};

// ─── Identidade (conjunto de formas) ────────────────────────────────────────

/** `<numero>@servidor` normalizado, sem `:device`. */
export function normalizarJid(id) {
  const s = String(id ?? '').trim();
  if (!s) return '';
  if (s.includes('@')) {
    const [user, server] = s.split('@');
    return `${user.split(':')[0]}@${server}`;
  }
  const digitos = s.replace(/\D/g, '');
  return digitos ? `${digitos}@s.whatsapp.net` : '';
}

/** Só os dígitos (base do número), seja JID, LID ou número cru. */
export function baseNumero(id) {
  return String(id ?? '').split('@')[0].split(':')[0].replace(/\D/g, '');
}

/** Todas as formas que identificam o mesmo usuário. */
export function formasDeId(id) {
  const out = new Set();
  const s = String(id ?? '').trim();
  if (!s) return out;
  const num = baseNumero(s);
  if (num) {
    out.add(`${num}@s.whatsapp.net`);
    out.add(`${num}@lid`);
    out.add(num);
  }
  const jid = normalizarJid(s);
  if (jid) out.add(jid);
  if (s.includes('@')) out.add(`${s.split('@')[0].split(':')[0]}@${s.split('@')[1]}`);
  return out;
}

/** `true` quando os dois ids são o MESMO usuário (JID ↔ LID ↔ número). */
export function mesmoUsuario(a, b) {
  const numA = baseNumero(a);
  const numB = baseNumero(b);
  if (!numA || !numB) return false;
  if (numA === numB) return true;
  // Um pode estar em LID e o outro em JID do mesmo telefone; a base difere.
  // Nesse caso, comparamos também as formas declaradas no registro.
  const fa = formasDeId(a);
  for (const f of formasDeId(b)) if (fa.has(f)) return true;
  return false;
}

// ─── Persistência ───────────────────────────────────────────────────────────

const EMPTY = { version: 2, subdonos: [], basePerms: [] };

function ensureDir() {
  try {
    fs.mkdirSync(DONO_DIR, { recursive: true });
  } catch { /* já existe */ }
}

/** Escrita atômica (temp único + rename) — mesmo padrão do resto do projeto. */
function escrever(dados) {
  ensureDir();
  const tmp = `${SUBDONOS_FILE}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(dados, null, 2) + '\n', 'utf-8');
    fs.renameSync(tmp, SUBDONOS_FILE);
    return true;
  } catch (error) {
    console.error('❌ Erro ao salvar subdonos:', error?.message || error);
    try { fs.rmSync(tmp, { force: true }); } catch { /* já foi */ }
    return false;
  }
}

/**
 * Normaliza o que veio do disco (v1 lista simples, v2 objeto, ou lixo) para o
 * formato v2. Nunca lança: dado corrompido vira `EMPTY`.
 */
export function normalizarBanco(raw) {
  const out = { version: 2, subdonos: [], basePerms: [] };
  if (!raw || typeof raw !== 'object') return out;

  // v1: { subdonos: ["id", ...] }
  const lista = Array.isArray(raw.subdonos) ? raw.subdonos : [];
  for (const item of lista) {
    if (!item) continue;
    if (typeof item === 'string') {
      out.subdonos.push({ id: normalizarJid(item), aliases: [], perms: [], addedAt: 0 });
      continue;
    }
    if (typeof item === 'object') {
      const id = normalizarJid(item.id || item.jid || item.lid);
      if (!id) continue;
      out.subdonos.push({
        id,
        aliases: Array.isArray(item.aliases) ? item.aliases.map(normalizarJid).filter(Boolean) : [],
        perms: Array.isArray(item.perms) ? [...new Set(item.perms.map(normalizarPerm).filter(Boolean))] : [],
        addedAt: Number(item.addedAt) || 0,
      });
    }
  }
  // dedup por identidade
  const vistos = new Set();
  out.subdonos = out.subdonos.filter((s) => {
    if (!s.id) return false;
    const chave = baseNumero(s.id) || s.id;
    if (vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });

  if (Array.isArray(raw.basePerms)) {
    out.basePerms = [...new Set(raw.basePerms.map(normalizarPerm).filter(Boolean))];
  }
  return out;
}

/** Migra a "lista base" antiga (`subOwnerCommands.json`) uma única vez. */
function migrarBaseLegada(banco) {
  if (banco.basePerms.length) return banco;
  try {
    if (!fs.existsSync(SUBCOMMANDS_FILE_LEGACY)) return banco;
    const legado = JSON.parse(fs.readFileSync(SUBCOMMANDS_FILE_LEGACY, 'utf-8'));
    if (Array.isArray(legado) && legado.length) {
      banco.basePerms = [...new Set(legado.map((c) => String(c).toLowerCase().trim()).filter(Boolean))];
      escrever(banco);
    }
  } catch (error) {
    console.warn('⚠️ Não foi possível migrar a lista base de subcomandos:', error?.message || error);
  }
  return banco;
}

/** Lê o banco normalizado (e migra o formato antigo na primeira vez). */
export function carregar() {
  let bruto = null;
  try {
    if (fs.existsSync(SUBDONOS_FILE)) {
      bruto = JSON.parse(fs.readFileSync(SUBDONOS_FILE, 'utf-8'));
    }
  } catch (error) {
    console.error('❌ subdonos.json inválido, começando vazio:', error?.message || error);
  }
  const banco = normalizarBanco(bruto);
  const migrado = migrarBaseLegada(banco);
  // Se veio no formato v1, grava já normalizado (migração persistida).
  if (bruto && Array.isArray(bruto.subdonos) && (bruto.version !== 2 || bruto.subdonos.some((s) => typeof s === 'string'))) {
    escrever(migrado);
  }
  return migrado;
}

function salvar(banco) {
  return escrever(normalizarBanco(banco));
}

/** Grava um banco já normalizado (usado pelos adaptadores de compatibilidade). */
export function salvarBanco(banco) {
  return salvar(banco);
}

// ─── Consultas ──────────────────────────────────────────────────────────────

/** Acha o registro do subdono por qualquer forma de identidade. */
export function acharSubdono(id, banco = carregar()) {
  if (!id) return null;
  const alvo = formasDeId(id);
  const num = baseNumero(id);
  return banco.subdonos.find((s) => {
    if (num && baseNumero(s.id) === num) return true;
    for (const f of [s.id, ...(s.aliases || [])]) {
      for (const forma of formasDeId(f)) if (alvo.has(forma)) return true;
    }
    return false;
  }) || null;
}

/** `true` se o id é subdono. */
export function isSubdono(id) {
  return !!acharSubdono(id);
}

export function listar() {
  return carregar().subdonos.slice();
}

/** Permissões efetivas (base + específicas do subdono). */
export function permissoesDe(id) {
  const banco = carregar();
  const sub = acharSubdono(id, banco);
  if (!sub) return [];
  return [...new Set([...banco.basePerms, ...(sub.perms || [])])];
}

/**
 * `true` se o subdono pode usar o comando.
 * Cobre o coringa `all` (`!sub.permitir @user all`).
 */
export function podeUsar(id, comando) {
  const cmd = String(comando || '').replace(/^[!/.]/, '').toLowerCase().trim();
  if (!cmd) return false;
  if (!isSubdono(id)) return false;
  return permsIncluem(permissoesDe(id), cmd);
}

export function listarBasePerms() {
  return carregar().basePerms.slice();
}

// ─── Mutação ────────────────────────────────────────────────────────────────

/** Dono que deve ser recusado como subdono (não faz sentido duplicar). */
function ehDono(id, numerodono, config = {}) {
  const base = baseNumero(id);
  const donos = [numerodono, config.lidowner]
    .filter(Boolean)
    .map(baseNumero);
  return donos.includes(base);
}

/**
 * Adiciona um subdono.
 * @returns {{ success: boolean, message: string, criado?: boolean }}
 */
export function adicionar(id, { numerodono = null, config = {}, perms = [], aliases = [] } = {}) {
  const jid = normalizarJid(id);
  if (!jid) {
    return { success: false, message: '❌ ID de usuário inválido. Marque o usuário ou informe o número.' };
  }
  const banco = carregar();
  const existente = acharSubdono(jid, banco);
  if (existente) {
    // Reaproveita para apenas somar permissões novas.
    const novas = perms.map(normalizarPerm).filter((p) => p && !existente.perms.includes(p));
    if (novas.length) {
      existente.perms.push(...novas);
      salvar(banco);
      return { success: true, criado: false, message: `✅ Permissões adicionadas: ${novas.join(', ')}` };
    }
    return { success: false, message: '✨ Este usuário já é um subdono!' };
  }
  if (numerodono && ehDono(jid, numerodono, config)) {
    return { success: false, message: '🤔 O Dono principal já tem todos os superpoderes! Não dá pra adicionar como subdono. 😉' };
  }
  if (banco.subdonos.length >= MAX_SUBDONOS) {
    return {
      success: false,
      message: `🚫 Limite de ${MAX_SUBDONOS} subdonos atingido. Remova um antes de adicionar outro.`,
    };
  }
  banco.subdonos.push({
    id: jid,
    aliases: [...new Set((Array.isArray(aliases) ? aliases : []).map(normalizarJid).filter((a) => a && a !== jid))],
    perms: [...new Set(perms.map(normalizarPerm).filter(Boolean))],
    addedAt: Date.now(),
  });
  if (!salvar(banco)) {
    return { success: false, message: '❌ Erro ao salvar a lista de subdonos. Tente novamente.' };
  }
  return { success: true, criado: true, message: '🎉 Pronto! Novo subdono adicionado com sucesso! ✨' };
}

/** Remove um subdono. Aceita id OU índice (1-based) da lista. */
export function remover(idOuIndice) {
  const banco = carregar();
  let alvo = null;

  if (typeof idOuIndice === 'number' || /^\d+$/.test(String(idOuIndice))) {
    const idx = Number(idOuIndice) - 1;
    if (idx >= 0 && idx < banco.subdonos.length) alvo = banco.subdonos[idx];
  }
  if (!alvo) alvo = acharSubdono(idOuIndice, banco);
  if (!alvo) {
    return { success: false, message: '🤔 Este usuário não está na lista de subdonos.' };
  }
  const chave = baseNumero(alvo.id) || alvo.id;
  banco.subdonos = banco.subdonos.filter((s) => (baseNumero(s.id) || s.id) !== chave);
  if (!salvar(banco)) {
    return { success: false, message: '❌ Erro ao salvar a lista após remover o subdono. Tente novamente.' };
  }
  return { success: true, message: '👋 Pronto! Subdono removido com sucesso! ✨' };
}

/**
 * Libera um comando para UM subdono.
 *
 * `!sub.permitir @user <comando>` libera um comando; `!sub.permitir @user all`
 * libera o coringa que dá acesso a **todo** comando do bot (como o dono).
 */
export function liberarComando(id, comando) {
  const cmd = normalizarPerm(comando);
  if (!cmd) return { success: false, message: '❌ Informe o comando.' };
  const banco = carregar();
  const sub = acharSubdono(id, banco);
  if (!sub) return { success: false, message: '🤔 Este usuário não é subdono.' };
  if (sub.perms.includes(cmd)) {
    const rotulo = cmd === ALL_PERM ? 'ACESSO TOTAL' : cmd;
    return { success: false, message: `⚠️ ${rotulo} já está liberado para este subdono.` };
  }
  // `all` torna redundante qualquer permissão individual: limpa as avulsas.
  if (cmd === ALL_PERM) sub.perms = [ALL_PERM];
  else sub.perms.push(cmd);
  if (!salvar(banco)) return { success: false, message: '❌ Erro ao salvar as permissões.' };
  if (cmd === ALL_PERM) {
    return { success: true, message: '✅ ACESSO TOTAL liberado para este subdono — ele já pode usar todos os comandos do bot.' };
  }
  return { success: true, message: `✅ ${cmd} liberado para este subdono.` };
}

/** Remove um comando de UM subdono (aceita `all` para revogar o acesso total). */
export function revogarComando(id, comando) {
  const cmd = normalizarPerm(comando);
  if (!cmd) return { success: false, message: '❌ Informe o comando.' };
  const banco = carregar();
  const sub = acharSubdono(id, banco);
  if (!sub) return { success: false, message: '🤔 Este usuário não é subdono.' };
  if (!sub.perms.includes(cmd)) {
    const rotulo = cmd === ALL_PERM ? 'ACESSO TOTAL' : cmd;
    return { success: false, message: `⚠️ ${rotulo} não está liberado para este subdono.` };
  }
  sub.perms = sub.perms.filter((c) => c !== cmd);
  if (!salvar(banco)) return { success: false, message: '❌ Erro ao salvar as permissões.' };
  if (cmd === ALL_PERM) {
    return { success: true, message: '✅ ACESSO TOTAL revogado deste subdono.' };
  }
  return { success: true, message: `✅ ${cmd} revogado deste subdono.` };
}

/** Adiciona comando(s) à lista BASE (todo subdono pode usar). */
export function addBasePerm(comando) {
  const cmd = normalizarPerm(String(comando || '').split(/\s+/)[0]);
  if (!cmd) return { success: false, message: '❌ Informe o comando.' };
  const banco = carregar();
  if (banco.basePerms.includes(cmd)) return { success: false, message: `⚠️ ${cmd} já está na lista base.` };
  banco.basePerms.push(cmd);
  if (!salvar(banco)) return { success: false, message: '❌ Erro ao salvar a lista base.' };
  return { success: true, message: `✅ ${cmd} adicionado à lista base (todos os subdonos).` };
}

/** Remove da lista BASE. */
export function removeBasePerm(comando) {
  const cmd = normalizarPerm(String(comando || '').split(/\s+/)[0]);
  if (!cmd) return { success: false, message: '❌ Informe o comando.' };
  const banco = carregar();
  if (!banco.basePerms.includes(cmd)) return { success: false, message: `⚠️ ${cmd} não está na lista base.` };
  banco.basePerms = banco.basePerms.filter((c) => c !== cmd);
  if (!salvar(banco)) return { success: false, message: '❌ Erro ao salvar a lista base.' };
  return { success: true, message: `✅ ${cmd} removido da lista base.` };
}

/**
 * `true` se QUALQUER uma das formas dadas pertence a um subdono.
 *
 * Necessário porque em grupo o mesmo usuário chega como LID numa mensagem e o
 * telefone real vive em `phoneNumber`/`pn` — as BASES são diferentes, então
 * comparar só o `sender` falharia. O chamador passa todas as formas que
 * conhece (sender + participantAlt + phoneNumber do metadata).
 */
export function isSubdonoEntre(ids) {
  const banco = carregar();
  return (Array.isArray(ids) ? ids : [ids]).some((id) => !!acharSubdono(id, banco));
}

/** Permissão efetiva considerando QUALQUER uma das formas do usuário. */
export function permissoesEntre(ids) {
  const banco = carregar();
  const listas = (Array.isArray(ids) ? ids : [ids]).map((id) => {
    const sub = acharSubdono(id, banco);
    return sub ? [...banco.basePerms, ...(sub.perms || [])] : [];
  });
  return [...new Set(listas.flat())];
}

/**
 * `true` se QUALQUER forma do usuário pode usar o comando.
 * Cobre o coringa `all` (`!sub.permitir @user all`).
 */
export function podeUsarEntre(ids, comando) {
  const cmd = String(comando || '').replace(/^[!/.]/, '').toLowerCase().trim();
  if (!cmd) return false;
  return permsIncluem(permissoesEntre(ids), cmd);
}

/** `true` se qualquer forma do usuário tem ACESSO TOTAL (`all`). */
export function temAcessoTotalEntre(ids) {
  return permissoesEntre(ids).includes(ALL_PERM);
}

/** `true` se o id tem ACESSO TOTAL (`all`). */
export function temAcessoTotal(id) {
  return permissoesDe(id).includes(ALL_PERM);
}

/** Acha o registro considerando QUALQUER uma das formas dadas. */
function acharSubdonoEntre(ids, banco = carregar()) {
  for (const id of (Array.isArray(ids) ? ids : [ids])) {
    const sub = acharSubdono(id, banco);
    if (sub) return sub;
  }
  return null;
}

/**
 * Libera comando para um subdono identificado por QUALQUER forma conhecida
 * (LID, PN, número). É o caminho do handler: em grupo a menção chega como LID,
 * mas o subdono pode ter sido cadastrado pelo telefone — as bases diferem.
 */
export function liberarComandoEntre(ids, comando) {
  const alvo = acharSubdonoEntre(ids);
  if (!alvo) return { success: false, message: '🤔 Este usuário não é subdono.' };
  return liberarComando(alvo.id, comando);
}

/** Revoga comando de um subdono identificado por QUALQUER forma conhecida. */
export function revogarComandoEntre(ids, comando) {
  const alvo = acharSubdonoEntre(ids);
  if (!alvo) return { success: false, message: '🤔 Este usuário não é subdono.' };
  return revogarComando(alvo.id, comando);
}

/**
 * Todas as formas conhecidas de um alvo (ex.: a menção) para casar com um
 * registro de subdono. A menção em grupo costuma chegar como LID; o telefone
 * real vive no `phoneNumber`/`pn` (ou `jid`/`lid`) do participante do metadata.
 * Puro: recebe o metadata por parâmetro.
 */
export function formasParaAlvo(id, metadata = null) {
  const alvo = String(id ?? '').trim();
  if (!alvo) return [];
  const out = new Set([alvo, ...formasDeId(alvo)]);
  const base = baseNumero(alvo);
  try {
    const p = (metadata?.participants || []).find((part) =>
      [part?.id, part?.lid, part?.phoneNumber, part?.pn]
        .filter(Boolean)
        .some((x) => baseNumero(x) === base));
    for (const v of [p?.id, p?.lid, p?.phoneNumber, p?.pn]) if (v) out.add(v);
  } catch { /* metadata opcional */ }
  return [...out];
}

/** Registra uma forma extra (ex.: o PN quando o subdono foi salvo por LID). */
export function addAlias(id, alias) {
  const banco = carregar();
  const sub = acharSubdono(id, banco);
  const alvo = normalizarJid(alias);
  if (!sub || !alvo || alvo === sub.id || (sub.aliases || []).includes(alvo)) {
    return { success: false };
  }
  sub.aliases = [...(sub.aliases || []), alvo];
  salvar(banco);
  return { success: true };
}

/** Apaga TODOS os subdonos e a lista base (usado em testes/admin). */
export function limparTudo() {
  return escrever({ version: 2, subdonos: [], basePerms: [] });
}
/** Permissões extras de um subdono (sem a base), para exibição. */
export function permsProprias(id) {
  const sub = acharSubdono(id);
  return sub ? (sub.perms || []).slice() : [];
}
