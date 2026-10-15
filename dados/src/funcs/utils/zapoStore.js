/**
 * Store PERSISTENTE em arquivo para o client de call do zapo.
 *
 * ## Por que existe
 *
 * O zapo e' um client PROPRIO (tem credenciais no formato dele), separado do
 * Baileys. Sem persistir, o pareamento se perde a cada reinicio do bot -- o
 * `WaAuthMemoryStore` do proprio pacote guarda as credenciais numa variavel de
 * instancia:
 *
 *     class WaAuthMemoryStore {
 *       constructor() { this.credentials = null; }   // zera a cada boot
 *
 * Ou seja: parear com store em memoria significa parear de novo toda vez.
 *
 * ## O que ele guarda
 *
 * Os dominios de PERSISTENCIA do zapo. O mais critico e' `auth` (as
 * credenciais: chaves, `meJid`/`meLid`, identidade) -- e' o que o offer da
 * call de grupo precisa para assinar o `call-creator`.
 *
 * Grava em `dados/database/zapo-auth/<dominio>.json`, com escrita ATOMICA
 * (tmp unico + rename), como o resto do projeto.
 *
 * ## Formato
 *
 * Cada dominio e' um mapa `chave -> valor`. Os valores tem `Uint8Array` (as
 * chaves), entao a serializacao converte para base64 e volta. Sem isso o
 * `JSON.stringify` transformaria os bytes num objeto `{0: 12, 1: 34, ...}` e o
 * `Buffer.from` nao os reconstruiria.
 */

import fs from 'fs';
import path from 'path';

const B64 = {
  paraJson(valor) {
    if (valor === null || valor === undefined) return valor;
    if (valor instanceof Uint8Array || Buffer.isBuffer(valor)) {
      return { __b64: Buffer.from(valor).toString('base64') };
    }
    if (Array.isArray(valor)) return valor.map(B64.paraJson);
    if (typeof valor === 'object') {
      const saida = {};
      for (const [k, v] of Object.entries(valor)) saida[k] = B64.paraJson(v);
      return saida;
    }
    return valor;
  },
  paraBinario(valor) {
    if (valor === null || valor === undefined) return valor;
    if (typeof valor === 'object' && typeof valor.__b64 === 'string') {
      return new Uint8Array(Buffer.from(valor.__b64, 'base64'));
    }
    if (Array.isArray(valor)) return valor.map(B64.paraBinario);
    if (typeof valor === 'object') {
      const saida = {};
      for (const [k, v] of Object.entries(valor)) saida[k] = B64.paraBinario(v);
      return saida;
    }
    return valor;
  }
};

/** Le um JSON com seguranca (arquivo ausente/corrompido -> padrao). */
function lerJson(caminho, padrao) {
  try {
    if (!fs.existsSync(caminho)) return padrao;
    return JSON.parse(fs.readFileSync(caminho, 'utf8'));
  } catch {
    return padrao;
  }
}

/** Escrita atomica: tmp unico + rename (rename e' atomico no mesmo FS). */
function escreverJson(caminho, dados) {
  const dir = path.dirname(caminho);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  fs.writeFileSync(tmp, JSON.stringify(dados), 'utf8');
  fs.renameSync(tmp, caminho);
}

/**
 * Cria um store de ARQUIVO no formato que o `createStore` do zapo espera.
 *
 * Devolve `{ stores: { <dominio>: (sessionId) => contrato } }`, com cada
 * contrato implementando os metodos que o zapo chama. Todos os metodos sao
 * tolerantes: falha de disco nunca derruba o bot (devolve vazio/ignora).
 *
 * @param {string} baseDir diretorio raiz (ex.: dados/database/zapo-auth)
 */
export function criarStoreArquivo(baseDir) {
  /** Mapa de dominio -> { chave: valor } em memoria, sincronizado com o disco. */
  const cache = new Map();

  const caminhoDe = (dominio) => path.join(baseDir, `${dominio}.json`);

  const carregar = (dominio) => {
    if (!cache.has(dominio)) {
      cache.set(dominio, lerJson(caminhoDe(dominio), {}));
    }
    return cache.get(dominio);
  };

  const gravar = (dominio) => {
    try {
      escreverJson(caminhoDe(dominio), cache.get(dominio) || {});
    } catch (e) {
      console.warn(`[ZAPO-STORE] falha ao gravar ${dominio}:`, e?.message || e);
    }
  };

  /**
   * Contrato generico de mapa chave->valor.
   *
   * Cobre a maioria dos dominios do zapo (preKey, session, identity,
   * senderKey, privacyToken, retry, groupMetadata, deviceList, messageSecret),
   * cujo formato e' sempre `get/set/delete/list`.
   */
  const contratoMapa = (dominio) => ({
    async get(chave) {
      const dados = carregar(dominio);
      const v = dados[chave];
      return v === undefined ? null : B64.paraBinario(v);
    },
    async set(chave, valor) {
      const dados = carregar(dominio);
      dados[chave] = B64.paraJson(valor);
      gravar(dominio);
    },
    async delete(chave) {
      const dados = carregar(dominio);
      delete dados[chave];
      gravar(dominio);
    },
    async list() {
      return Object.keys(carregar(dominio));
    },
    async clear() {
      cache.set(dominio, {});
      gravar(dominio);
    }
  });

  /** Contrato de `auth`: um unico registro (`credentials`). */
  const contratoAuth = () => ({
    async load() {
      const dados = lerJson(caminhoDe('auth'), null);
      if (!dados || !dados.credentials) return null;
      return B64.paraBinario(dados.credentials);
    },
    async save(credentials) {
      escreverJson(caminhoDe('auth'), { credentials: B64.paraJson(credentials) });
    },
    async clear() {
      try { fs.rmSync(caminhoDe('auth'), { force: true }); } catch { /* ok */ }
    }
  });

  /**
   * Contrato de `appState`: guarda um estado por colecao.
   *
   * O zapo chama com o nome da colecao e espera um `{ state, version }`.
   */
  const contratoAppState = () => ({
    async get(colecao) {
      const dados = lerJson(caminhoDe('appState'), {});
      const v = dados[colecao];
      return v === undefined ? null : B64.paraBinario(v);
    },
    async set(colecao, valor) {
      const dados = lerJson(caminhoDe('appState'), {});
      dados[colecao] = B64.paraJson(valor);
      escreverJson(caminhoDe('appState'), dados);
    },
    async delete(colecao) {
      const dados = lerJson(caminhoDe('appState'), {});
      delete dados[colecao];
      escreverJson(caminhoDe('appState'), dados);
    },
    async list() {
      return Object.keys(lerJson(caminhoDe('appState'), {}));
    },
    async clear() {
      try { fs.rmSync(caminhoDe('appState'), { force: true }); } catch { /* ok */ }
    }
  });

  return {
    stores: {
      auth: () => contratoAuth(),
      signal: () => contratoMapa('signal'),
      preKey: () => contratoMapa('preKey'),
      session: () => contratoMapa('session'),
      identity: () => contratoMapa('identity'),
      senderKey: () => contratoMapa('senderKey'),
      appState: () => contratoAppState(),
      privacyToken: () => contratoMapa('privacyToken')
    }
  };
}
