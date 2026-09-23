/**
 * AntiBot (camada Lizzy) — gerenciador de engines por grupo.
 *
 * Cada grupo tem seu próprio engine (config, thresholds e estado independentes),
 * o que é o requisito de "configuração por grupo". Os engines são criados sob
 * demanda e reciclados quando o grupo é desligado, para não acumular memória.
 *
 * O núcleo (`createAntiBotEngine`) vem da fork; aqui só há ciclo de vida.
 */

import { getGroupAntiBotConfig, isCoreAvailable, core, MODE_LABELS } from './config.js';

/** groupJid -> engine */
const engines = new Map();

/** Teto de grupos com engine viva ao mesmo tempo. */
const MAX_ENGINES = 200;

/** Logger do pino, se o bot tiver um disponível. */
let logger = null;
export const setAntiBotLogger = (l) => { logger = l; };

/**
 * Devolve (criando se preciso) o engine do grupo.
 * Devolve null quando o grupo está desligado ou a fork não tem o núcleo.
 */
export const getEngine = (groupJid, groupData) => {
  if (!isCoreAvailable()) return null;
  const cfg = getGroupAntiBotConfig(groupData);
  if (!cfg.enabled) return null;

  let engine = engines.get(groupJid);
  if (engine && engine.__mode === cfg.mode) return engine;

  // Modo mudou (ou engine nova): recria para aplicar os thresholds do modo.
  if (engine) engines.delete(groupJid);

  engine = core.createAntiBotEngine({
    mode: cfg.mode,
    ...(cfg.thresholds ? { thresholds: cfg.thresholds } : {})
  }, { logger });
  engine.__mode = cfg.mode;
  engines.set(groupJid, engine);

  // Reciclagem simples: o grupo mais antigo sai quando passa do teto.
  if (engines.size > MAX_ENGINES) {
    const oldest = engines.keys().next().value;
    if (oldest !== undefined && oldest !== groupJid) engines.delete(oldest);
  }
  return engine;
};

/** Remove o engine de um grupo (usado ao desligar). */
export const dropEngine = (groupJid) => engines.delete(groupJid);

/** Quantidade de grupos com engine viva (diagnóstico). */
export const engineCount = () => engines.size;

/**
 * Resultado no formato que a Lizzy consome (`AntiBotResult`).
 * Mantém o contrato pedido: jid, status, scores, evidences, firstSeen, lastSeen.
 */
export const toAntiBotResult = (result) => {
  if (!result) return null;
  return {
    jid: result.candidate,
    groupJid: result.groupJid,
    status: result.status,
    automationScore: result.automationScore,
    protocolConfidence: result.protocolConfidence,
    behaviorConfidence: result.behaviorConfidence,
    confidence: result.confidence,
    evidences: (result.evidences || []).map((e) => ({
      type: e.type,
      weight: e.weight,
      category: e.category,
      level: e.level,
      explanation: e.explanation,
      detail: e.detail
    })),
    firstSeen: result.firstSeen,
    lastSeen: result.lastSeen,
    fingerprint: result.fingerprintSummary,
    reasons: result.reasons,
    actionAllowed: result.actionAllowed === true
  };
};

/**
 * Uma linha de log por avaliação relevante. Formato pedido:
 * entende-se "por que" sem despejar dados desnecessários.
 */
export const logEvaluation = (groupJid, result) => {
  if (!result || result.status === 'NORMAL') return;
  const ev = (result.evidences || [])
    .filter((e) => e.weight > 0)
    .map((e) => `${e.type}(${e.weight})`)
    .join(', ');
  console.log(
    `[ANTIBOT] group=${groupJid} jid=${result.candidate} status=${result.status} ` +
    `automation=${result.automationScore} protocol=${result.protocolConfidence} ` +
    `behavior=${result.behaviorConfidence} evidences=[${ev}] action=${result.actionAllowed ? 'ALLOWED' : 'NONE'}`
  );
};

/** Texto do status do grupo, no padrão visual do bot. */
export const buildStatusText = (groupJid, groupData, stats) => {
  const cfg = getGroupAntiBotConfig(groupData);
  const modo = MODE_LABELS[cfg.mode] || cfg.mode;
  const disponivel = isCoreAvailable();
  const linhas = [
    '╭━━━꧁༺ 🤖 𝐀𝐍𝐓𝐈𝐁𝐎𝐓 ༻꧂━━━╮',
    `┃ ⚙️ ${disponivel ? (cfg.enabled ? 'Ativo' : 'Desligado') : 'Indisponível'}`,
    `┃ 🛡️ Modo: ${modo}`,
    '┃',
    `┃ 📊 Participantes analisados: ${stats?.analyzed ?? stats?.total ?? 0}`,
    `┃ 👀 Em observação: ${stats?.OBSERVING ?? 0}`,
    `┃ ⚠️ Suspeitos: ${stats?.SUSPICIOUS ?? 0}`,
    `┃ 🚨 Alto risco: ${stats?.HIGH_RISK ?? 0}`,
    `┃ ✅ Confirmados: ${stats?.CONFIRMED ?? 0}`,
    '┃',
    `┃ 📡 Stanza: ${stats?.observer?.attached ? 'Ativa' : 'Inativa'}`,
    `┃ 🧬 WAProto: ${disponivel ? 'Ativo' : 'Inativo'}`,
    `┃ 🧠 Behavioral Engine: ${disponivel ? 'Ativo' : 'Inativo'}`,
    `┃ 🔗 Correlation Engine: ${disponivel ? 'Ativo' : 'Inativo'}`,
    '╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯'
  ];
  if (!disponivel) {
    linhas.splice(linhas.length - 1, 0, '┃', '┃ ⚠️ A fork instalada não expõe o núcleo do AntiBot.');
  } else if (!cfg.enabled) {
    linhas.splice(linhas.length - 1, 0, '┃', '┃ ℹ️ Use o comando de ativação para começar a analisar.');
  } else if ((stats?.analyzed ?? stats?.total ?? 0) <= 1) {
    // Sem este aviso, "1 analisado" parece defeito quando é o comportamento
    // correto: só conta quem falou DESDE que o AntiBot ligou.
    linhas.splice(linhas.length - 1, 0,
      '┃',
      '┃ ℹ️ Conta quem falou desde que o AntiBot ligou.',
      '┃    Mande mensagem de outra conta no grupo para ela aparecer.');
  }
  return linhas.join('\n');
};

/** Lista os participantes acima de NORMAL, para o comando de detalhe. */
export const buildWatchListText = (groupJid, list) => {
  if (!list || !list.length) {
    return [
      '╭━━━꧁༺ 🔎 𝐀𝐍𝐓𝐈𝐁𝐎𝐓 ༻꧂━━━╮',
      '┃ Nenhum participante acima do normal.',
      '╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯'
    ].join('\n');
  }
  const linhas = ['╭━━━꧁༺ 🔎 𝐀𝐍𝐓𝐈𝐁𝐎𝐓 ༻꧂━━━╮'];
  for (const p of list.slice(0, 10)) {
    linhas.push(`┃ @${String(p.participant).split('@')[0]} — ${p.status} (${p.score})`);
  }
  linhas.push('╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯');
  return linhas.join('\n');
};

export { MODE_LABELS };
