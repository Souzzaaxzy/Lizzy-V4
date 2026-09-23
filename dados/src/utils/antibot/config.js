/**
 * AntiBot (camada Lizzy) — configuração por grupo.
 *
 * O NÚCLEO vive na fork (`@itsliaaa/baileys` -> lib/AntiBot). Aqui fica apenas o
 * que é específico do bot: onde a configuração do grupo é guardada, como ela é
 * lida e os textos. Nada de reimplementar detecção.
 *
 * Persistência: `groupData.antibot` no MESMO JSON de grupo que o resto dos
 * antis usa (`persistGroupData`). Nenhum banco novo, nenhum arquivo novo.
 *
 * O estado padrão é o mais seguro possível: **desligado** e, quando ligado,
 * `observe` — que nunca age.
 */

import { createRequire } from 'module';

/**
 * O núcleo vem da fork instalada. `createRequire` é usado de propósito: a
 * importação de um pacote CommonJS/ESM opcional não deve derrubar o boot do bot
 * se a fork instalada for anterior ao AntiBot.
 */
const require = createRequire(import.meta.url);
let core = null;
let coreError = null;
try {
  // Resolve pelo caminho do pacote para não depender do resolvedor ESM em runtime.
  const pkgPath = require.resolve('@itsliaaa/baileys/package.json');
  const base = pkgPath.replace(/package\.json$/, '');
  core = await import(`${base}lib/AntiBot/index.js`);
} catch (e) {
  coreError = e?.message || String(e);
}

/** O núcleo só existe se a fork instalada trouxer o AntiBot. */
export const isCoreAvailable = () => Boolean(core?.createAntiBotEngine);
export const getCoreError = () => coreError;

export const ANTI_BOT_MODES = Object.freeze(['log', 'observe', 'quarantine', 'active']);

/**
 * Modo efetivo do grupo. Sem configuração, o mais seguro: `observe`.
 * `off` é representado por `enabled: false`, não por um modo.
 */
export const DEFAULT_GROUP_CONFIG = Object.freeze({
  enabled: false,
  mode: 'observe',
  thresholds: null
});

/** Aliases aceitos no comando (PT-BR incluído). */
const MODE_ALIASES = {
  log: 'log',
  observe: 'observe',
  observ: 'observe',
  observar: 'observe',
  quarantine: 'quarantine',
  quarentena: 'quarantine',
  active: 'active',
  ativo: 'active',
  ativa: 'active'
};

/** Normaliza o que está salvo no grupo, tolerando lixo. */
export const getGroupAntiBotConfig = (groupData) => {
  const raw = groupData?.antibot;
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_GROUP_CONFIG };
  const mode = MODE_ALIASES[String(raw.mode || '').toLowerCase()] || DEFAULT_GROUP_CONFIG.mode;
  return {
    enabled: raw.enabled === true,
    mode,
    thresholds: (raw.thresholds && typeof raw.thresholds === 'object') ? { ...raw.thresholds } : null
  };
};

/** Grava a configuração de volta no groupData (o chamador persiste). */
export const setGroupAntiBotConfig = (groupData, patch = {}) => {
  if (!groupData || typeof groupData !== 'object') return null;
  const current = getGroupAntiBotConfig(groupData);
  const next = { ...current, ...patch };
  if (next.mode) {
    next.mode = MODE_ALIASES[String(next.mode).toLowerCase()] || current.mode;
  }
  groupData.antibot = next;
  return next;
};

/** Tradução do modo para exibição. */
export const MODE_LABELS = Object.freeze({
  log: 'Log',
  observe: 'Observar',
  quarantine: 'Quarentena',
  active: 'Ativo'
});

/**
 * Decide se o AntiBot deve ser aplicado a uma mensagem deste grupo.
 * Note que isto NÃO decide punição — só se vale analisar.
 */
export const shouldAnalyze = (groupData) => getGroupAntiBotConfig(groupData).enabled;

/** O modo permite agir? Só `active` permite, e apenas com confirmação. */
export const modeAllowsAction = (mode) => mode === 'active';

export { core };
export default { getGroupAntiBotConfig, setGroupAntiBotConfig, modeAllowsAction, shouldAnalyze };
