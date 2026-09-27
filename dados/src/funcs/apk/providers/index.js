/**
 * Registro de providers do `!apk`.
 *
 * Providers habilitados por padrão são apenas os que funcionam hoje de forma
 * compatível com as regras das fontes:
 *   - `fdroid`  — índice oficial assinado (metadados estruturados, hash+signer)
 *   - `aptoide` — API pública oficial (package/versão/tamanho/md5/assinatura)
 *
 * `apkmirror`, `apkcombo` e `apkpure` estão listados mas DESABILITADOS: a fonte
 * bloqueia acesso automatizado (Cloudflare) ou o robots.txt proíbe o caminho de
 * download. Contornar é proibido pela tarefa — ver o motivo em cada provider.
 *
 * Configuração por ambiente:
 *   APK_PROVIDERS=fdroid,aptoide      (habilita só estes)
 *   APK_PROVIDERS_ENABLE=apkcombo     (força habilitar, se a fonte permitir)
 */

import fdroidProvider from './fdroidProvider.js';
import aptoideProvider from './aptoideProvider.js';
import { apkmirrorProvider, apkcomboProvider, apkpureProvider } from './legacySourcesProvider.js';

/**
 * Ordem = prioridade de DESEMPATE (não bloqueia busca paralela). O APKMirror
 * vem primeiro por ser a prioridade pedida, mas como está indisponível o
 * desempate efetivo começa no próximo habilitado.
 */
export const PROVIDER_ORDER = Object.freeze(['apkmirror', 'apkcombo', 'apkpure', 'aptoide', 'fdroid']);

/** Catálogo interno de providers (todos, disponíveis ou não). */
const ALL = {
  ['apkmirror']: apkmirrorProvider,
  ['apkcombo']: apkcomboProvider,
  ['apkpure']: apkpureProvider,
  ['aptoide']: aptoideProvider,
  ['fdroid']: fdroidProvider,
};

/** Habilitados por padrão: só os que funcionam hoje sem violar regra da fonte. */
const DEFAULT_ENABLED = ['fdroid', 'aptoide'];

function parseList(value) {
  return String(value || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Lista os providers habilitados, na ordem de prioridade.
 * @returns {Array<object>}
 */
export function getEnabledProviders() {
  if (TEST_OVERRIDE) return TEST_OVERRIDE;
  const only = parseList(process.env.APK_PROVIDERS);
  const force = parseList(process.env.APK_PROVIDERS_ENABLE);
  const enabled = new Set(only.length ? only : DEFAULT_ENABLED);
  for (const id of force) enabled.add(id);

  return PROVIDER_ORDER
    .filter((id) => enabled.has(id) && ALL[id] && ALL[id].enabled !== false)
    .map((id) => ALL[id]);
}

/** Exclusivo para testes: força uma lista de providers (ou desliga com null). */
let TEST_OVERRIDE = null;
export function setProvidersForTest(list) {
  TEST_OVERRIDE = list;
}

/** Todos os providers, inclusive os indisponíveis (para diagnóstico/teste). */
export function getAllProviders() {
  return PROVIDER_ORDER.map((id) => ALL[id]);
}

/** Configuração efetiva (para log/teste). */
export function getProviderConfig() {
  return {
    order: [...PROVIDER_ORDER],
    enabled: getEnabledProviders().map((p) => p.ID),
    unavailable: getEnabledProviders().length === 0
      ? PROVIDER_ORDER.slice()
      : PROVIDER_ORDER.filter((id) => !getEnabledProviders().some((p) => p.ID === id)),
    notes: PROVIDER_ORDER.reduce((acc, id) => {
      if (ALL[id]?.reason) acc[id] = ALL[id].reason;
      return acc;
    }, {}),
  };
}

export default {
  PROVIDER_ORDER,
  getEnabledProviders,
  getAllProviders,
  getProviderConfig,
  setProvidersForTest,
};
