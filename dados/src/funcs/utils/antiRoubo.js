/**
 * ANTI-ROUBO de administração — fonte única (refatorado do modelo RAVENA-BOT).
 *
 * O que o sistema protege: promoção (`promote`) e rebaixamento (`demote`) de
 * administradores. Com o anti ligado, só quem é **autorizado** pode promover ou
 * rebaixar — e quem tentar sem permissão é **revertido na hora** (o executor
 * perde o admin e a vítima é restaurada).
 *
 * O modelo do bot de referência (Kimori/RAVENA-BOT, `arquivos/funcoes/AntiRoubo.js`)
 * guarda a permissão em **duas listas**: o telefone (`ar_permitidos`) e o LID
 * (`ar_permitidos_lid`). A Lizzy faz o mesmo — é o que faz a pessoa autorizada
 * ser reconhecida mesmo quando o WhatsApp entrega a mensagem como LID e o alvo
 * foi cadastrado pelo número (ou vice-versa).
 *
 * Este módulo é PURO: não abre socket, não lê arquivo, não formata mensagem.
 * Recebe o estado de `/permitidos` do grupo, os JIDs e o metadata, e devolve
 * resultado estruturado. Testável sem handler.
 */

// ─── Normalização ───────────────────────────────────────────────────────────

/**
 * Só os dígitos do número (aceita JID, LID, `:device`, número cru ou formatado).
 * O `:device` é descartado — senão `x:14@s.whatsapp.net` viraria `x14`.
 */
export function toNum(v) {
  return String(v ?? '').split('@')[0].split(':')[0].replace(/\D/g, '');
}

/** Base do JID/LID normalizada (`:device` removido) — string vazia se inválido. */
export function baseJid(v) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  if (s.includes('@')) return `${s.split('@')[0].split(':')[0]}@${s.split('@')[1]}`;
  const num = s.replace(/\D/g, '');
  return num ? `${num}@s.whatsapp.net` : '';
}

/** `true` se a string é um LID. */
export function isLid(v) {
  return String(v ?? '').includes('@lid');
}

// ─── Estado (default / leitura) ─────────────────────────────────────────────

/** Estado inicial do anti-roubo para um grupo. */
export function estadoVazio() {
  return { enabled: false, ar_permitidos: [], ar_permitidos_lid: [] };
}

/** Normaliza o estado vindo do disco (tolera ausência, tipo errado, strings). */
export function normalizarEstado(antiRoubo) {
  const src = antiRoubo && typeof antiRoubo === 'object' ? antiRoubo : {};
  const perfis = [...(Array.isArray(src.ar_permitidos) ? src.ar_permitidos : [])];
  const lids = [...(Array.isArray(src.ar_permitidos_lid) ? src.ar_permitidos_lid : [])];
  // Migração retroativa: o formato antigo guardava só `authorizedUsers` (JIDs).
  if (Array.isArray(src.authorizedUsers)) {
    for (const u of src.authorizedUsers) {
      const b = baseJid(u);
      if (!b) continue;
      if (isLid(b)) { if (!lids.includes(b)) lids.push(b); }
      else { if (!perfis.includes(b)) perfis.push(b); }
    }
  }
  return {
    enabled: !!src.enabled,
    ar_permitidos: perfis,
    ar_permitidos_lid: lids,
  };
}

/** `true` se o anti-roubo está ligado. */
export function estaAtivo(antiRoubo) {
  return !!antiRoubo?.enabled;
}

// ─── Mapa de identidades (LID <-> telefone) a partir do metadata ─────────────

/**
 * Constrói os mapas `lidBase -> telefone` e `telefone -> lidBase` a partir dos
 * participantes do grupo. Aceita os nomes modernos da Lizzy (`lid`, `phoneNumber`,
 * `pn`) e o par clássico (`id` = telefone, `lid` = LID).
 */
export function mapaIdentidades(participants) {
  const lidToPhone = new Map();
  const phoneToLid = new Map();
  for (const p of participants || []) {
    if (!p || typeof p === 'string') continue;
    const lid = [p.lid, p.pn].find(isLid) || (isLid(p.id) ? p.id : '');
    const phone = [p.phoneNumber, p.jid, (!isLid(p.id) ? p.id : '')].find((x) => x && !isLid(x)) || '';
    const lidNum = toNum(lid);
    const phoneNum = toNum(phone);
    if (lidNum && phoneNum) {
      lidToPhone.set(lidNum, phoneNum);
      phoneToLid.set(phoneNum, lidNum);
    }
  }
  return { lidToPhone, phoneToLid };
}

// ─── Resolução do alvo ──────────────────────────────────────────────────────

/**
 * Extrai o alvo (telefone + LID) de uma mensagem, do mesmo jeito que o bot de
 * referência: citação > menção > `@numero` digitado > primeiro número do texto.
 * Depois cruza com o metadata para completar o par telefone/LID que faltar.
 *
 * @returns {{ telNum: string, lidNum: string, telJid: string, lidJid: string }}
 */
export function resolverAlvo({ alvoRaw, texto = '', participants = [] } = {}) {
  const { lidToPhone, phoneToLid } = mapaIdentidades(participants);

  let bruto = alvoRaw ? String(alvoRaw) : '';
  if (!bruto) {
    const typed = String(texto).match(/@\s*(\d{8,15})/);
    if (typed) bruto = typed[1];
  }
  if (!bruto) {
    const any = String(texto).match(/\d{8,15}/g) || [];
    if (any[0]) bruto = any[0];
  }
  if (!bruto) return { telNum: '', lidNum: '', telJid: '', lidJid: '' };

  let telNum = '';
  let lidNum = '';
  if (isLid(bruto)) {
    lidNum = toNum(bruto);
    telNum = lidToPhone.get(lidNum) || '';
  } else {
    telNum = toNum(bruto);
    lidNum = phoneToLid.get(telNum) || '';
  }

  return {
    telNum,
    lidNum,
    telJid: telNum ? `${telNum}@s.whatsapp.net` : '',
    lidJid: lidNum ? `${lidNum}@lid` : '',
  };
}

// ─── Autorização ────────────────────────────────────────────────────────────

/**
 * Todas as formas que representam o alvo (para casar com a lista): o telefone e
 * o LID, aceitando também um par fornecido pelo chamador (ex.: `participantAlt`).
 */
export function formasDoAlvo({ telNum = '', lidNum = '', formas = [] } = {}) {
  const out = new Set();
  for (const f of [telNum, lidNum, ...formas]) {
    const n = toNum(f);
    if (n) out.add(n);
  }
  return [...out];
}

/**
 * `true` se QUALQUER forma do usuário está autorizada (telefone em
 * `ar_permitidos` OU LID em `ar_permitidos_lid`).
 */
export function estaAutorizado(antiRoubo, formas) {
  const { ar_permitidos, ar_permitidos_lid } = normalizarEstado(antiRoubo);
  const nums = new Set((Array.isArray(formas) ? formas : [formas]).map(toNum).filter(Boolean));
  if (!nums.size) return false;
  if (ar_permitidos.some((u) => nums.has(toNum(u)))) return true;
  if (ar_permitidos_lid.some((u) => nums.has(toNum(u)))) return true;
  return false;
}

// ─── Resolução / listagem (telefones legíveis) ──────────────────────────────

/**
 * Lista os telefones autorizados (LIDs resolvidos para telefone quando o
 * metadata permite), ordenados e únicos — igual ao `getResolvedPhoneList` de
 * referência. É o que o `!listperm` exibe.
 */
export function listarTelefonesAutorizados(antiRoubo, participants = []) {
  const { ar_permitidos, ar_permitidos_lid } = normalizarEstado(antiRoubo);
  const { lidToPhone } = mapaIdentidades(participants);
  const set = new Set();
  for (const tel of ar_permitidos) {
    const n = toNum(tel);
    if (n) set.add(n);
  }
  for (const lid of ar_permitidos_lid) {
    const n = toNum(lid);
    if (!n) continue;
    set.add(lidToPhone.get(n) || n);
  }
  return [...set]
    .filter((n) => n && n.length >= 8 && n.length <= 15)
    .sort((a, b) => a.localeCompare(b));
}

/** Contagem bruta (telefones + LIDs) para exibição rápida. */
export function contarAutorizados(antiRoubo) {
  const { ar_permitidos, ar_permitidos_lid } = normalizarEstado(antiRoubo);
  return { telefones: ar_permitidos.length, lids: ar_permitidos_lid.length };
}

// ─── Mutação (devolve estado novo; o chamador persiste) ─────────────────────

/** Limpa TODAS as permissões. */
export function limparPermissoes(antiRoubo) {
  const estado = normalizarEstado(antiRoubo);
  estado.ar_permitidos = [];
  estado.ar_permitidos_lid = [];
  delete estado.authorizedUsers;
  return estado;
}

/**
 * Adiciona a permissão do alvo (telefone e/ou LID).
 * @returns {{ estado, addedTel, addedLid, jaExistia }}
 */
export function adicionarPermissao(antiRoubo, { telNum = '', lidNum = '' } = {}) {
  const estado = normalizarEstado(antiRoubo);
  const tel = toNum(telNum);
  const lid = toNum(lidNum);
  const jaTel = !!tel && estado.ar_permitidos.some((u) => toNum(u) === tel);
  const jaLid = !!lid && estado.ar_permitidos_lid.some((u) => toNum(u) === lid);

  let addedTel = false;
  let addedLid = false;
  if (tel && !jaTel) { estado.ar_permitidos.push(`${tel}@s.whatsapp.net`); addedTel = true; }
  if (lid && !jaLid) { estado.ar_permitidos_lid.push(`${lid}@lid`); addedLid = true; }

  return { estado, addedTel, addedLid, jaExistia: !!(tel || lid) && !addedTel && !addedLid };
}

/**
 * Remove a permissão do alvo (telefone e/ou LID).
 * @returns {{ estado, removedTel, removedLid, encontrado }}
 */
export function removerPermissao(antiRoubo, { telNum = '', lidNum = '' } = {}) {
  const estado = normalizarEstado(antiRoubo);
  const tel = toNum(telNum);
  const lid = toNum(lidNum);

  const tinhaTel = !!tel && estado.ar_permitidos.some((u) => toNum(u) === tel);
  const tinhaLid = !!lid && estado.ar_permitidos_lid.some((u) => toNum(u) === lid);
  if (!tinhaTel && !tinhaLid) return { estado, removedTel: false, removedLid: false, encontrado: false };

  if (tel) estado.ar_permitidos = estado.ar_permitidos.filter((u) => toNum(u) !== tel);
  if (lid) estado.ar_permitidos_lid = estado.ar_permitidos_lid.filter((u) => toNum(u) !== lid);

  return { estado, removedTel: tinhaTel, removedLid: tinhaLid, encontrado: true };
}

/** Liga/desliga o anti-roubo (preserva as permissões). */
export function definirAtivo(antiRoubo, ativo) {
  const estado = normalizarEstado(antiRoubo);
  estado.enabled = !!ativo;
  return estado;
}

// ─── Decisão de enforcement ─────────────────────────────────────────────────

/**
 * Decide o que fazer quando alguém promove/rebaixa com o anti ligado.
 *
 * @param {object} p
 * @param {object} p.antiRoubo      estado do grupo
 * @param {string} p.acao           'promote' | 'demote'
 * @param {string[]} p.formasAutor  formas (telefone/LID) de quem executou
 * @param {boolean} [p.isDonoGrupo] o executor é o criador do grupo
 * @param {boolean} [p.isDonoBot]   o executador é o dono do bot/subdono
 * @param {boolean} [p.eBot]        o executador é o próprio bot
 * @returns {{ acao: 'permitir'|'punir', motivo: string }}
 */
export function decidirEnforcement({
  antiRoubo, acao, formasAutor = [], isDonoGrupo = false, isDonoBot = false, eBot = false,
} = {}) {
  if (!estaAtivo(antiRoubo)) return { acao: 'permitir', motivo: 'anti_desligado' };
  if (eBot) return { acao: 'permitir', motivo: 'bot' };
  if (isDonoBot) return { acao: 'permitir', motivo: 'dono_do_bot' };
  if (isDonoGrupo) return { acao: 'permitir', motivo: 'dono_do_grupo' };
  if (estaAutorizado(antiRoubo, formasAutor)) return { acao: 'permitir', motivo: 'autorizado' };
  return { acao: 'punir', motivo: acao === 'demote' ? 'rebaixamento_nao_autorizado' : 'promocao_nao_autorizada' };
}

/**
 * O inverso da ação: promoção não autorizada vira rebaixamento do executor e
 * rebaixamento das vítimas promovidas; rebaixamento não autorizado vira
 * rebaixamento do executor e RE-promoção das vítimas.
 */
export function acoesDeReversao(acao) {
  if (acao === 'demote') return { executor: 'demote', vitimas: 'promote' };
  return { executor: 'demote', vitimas: 'demote' };
}
