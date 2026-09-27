/**
 * Providers APKMirror / APKCombo / APKPure.
 *
 * ESTADO ATUAL: **indisponíveis por bloqueio do lado da fonte** — e a tarefa
 * proíbe contornar isso. O que foi verificado (set/2026), com requisição normal
 * (sem técnicas evasivas):
 *
 *   - APKMirror: `www.apkmirror.com` responde **403 com o desafio Cloudflare**
 *     ("Just a moment...") para qualquer caminho, inclusive `/robots.txt`. Os
 *     hosts de download (`download.apkmirror.com`, `api.apkmirror.com`) não
 *     resolvem. Não há API pública oficial.
 *   - APKPure: `apkpure.com`/`m.apkpure.com` também dão **403 Cloudflare**; o
 *     host de download `d.apkpure.com` publica **`Disallow: /`** no robots.txt;
 *     a API interna (`api.pureapk.com`) exige protocolo próprio e devolve
 *     `INVALID_COMMAND`. Os termos do APKPure proíbem automação com carga acima
 *     de uso humano.
 *   - APKCombo: o HTML responde, MAS o link real de download passa por `/r2?u=`
 *     (e caminhos com token), e ambos estao em Disallow do robots.txt
 *     (Disallow de /r2 e de /dl com token). Sem o /r2 nao ha como
 *     obter o arquivo; usar o `data.winudf.com`/storage por fora seria contornar
 *     a fonte.
 *
 * Por isso cada um faz UMA requisição normal e devolve `unavailable` com o
 * motivo, em vez de inventar bypass. Se a fonte voltar a ser acessível sem
 * challenge (ex.: APKMirror publicar API), a implementação é reativada aqui sem
 * mudar o resto do sistema.
 */

import { providerRequest, PROVIDER_LABELS, providerError } from './providerUtils.js';
import { isBlockedResponse } from './blockedDetect.js';

/** Fábrica de provider "não suportado": nunca baixa, só reporta o motivo. */
function makeUnavailableProvider(id, { hosts, probeUrl, reason, robotsNote }) {
  return {
    ID: id,
    LABEL: PROVIDER_LABELS[id] || id,
    ALLOWED_HOSTS: Object.freeze(hosts),
    /** Motivo humano documentado (aparece no log; não vai para o usuário). */
    reason,
    robotsNote,
    /** Um provider indisponível nunca é consultado em paralelo (economia). */
    enabled: false,
    /**
     * Sonda opcional: confirma o estado atual da fonte sem contornar nada.
     * Devolve `{ available: false, blocked }`.
     */
    async probe(opts = {}) {
      if (!probeUrl) return { available: false, blocked: true };
      try {
        const res = await providerRequest(probeUrl, { html: true, timeoutMs: opts.timeoutMs });
        const blocked = isBlockedResponse(res);
        return { available: !blocked, blocked };
      } catch (error) {
        return { available: false, blocked: true, error: error?.message };
      }
    },
    /** Sempre indisponível: o manager pula este provider. */
    async search() {
      throw providerError(id, 'UNAVAILABLE', { reason, robotsNote });
    },
  };
}

export const apkmirrorProvider = makeUnavailableProvider('apkmirror', {
  hosts: ['www.apkmirror.com', 'download.apkmirror.com'],
  probeUrl: 'https://www.apkmirror.com/',
  reason: 'Cloudflare challenge (HTTP 403 "Just a moment...") e sem API pública oficial.',
  robotsNote: 'Desafio JS na borda; contornar é proibido pela tarefa.',
});

export const apkcomboProvider = makeUnavailableProvider('apkcombo', {
  hosts: ['apkcombo.com'],
  probeUrl: 'https://apkcombo.com/',
  reason: 'Download real passa por /r2?u= e */dl?token=*, ambos Disallow no robots.txt.',
  robotsNote: 'robots.txt: Disallow: /r2?u=* e Disallow: */dl?token=*',
});

export const apkpureProvider = makeUnavailableProvider('apkpure', {
  hosts: ['apkpure.com', 'd.apkpure.com'],
  probeUrl: 'https://apkpure.com/',
  reason: 'Cloudflare challenge (403) e robots.txt do host de download é Disallow: /; termos proíbem automação.',
  robotsNote: 'd.apkpure.com robots.txt: Disallow: /',
});

export default { apkmirrorProvider, apkcomboProvider, apkpureProvider };
