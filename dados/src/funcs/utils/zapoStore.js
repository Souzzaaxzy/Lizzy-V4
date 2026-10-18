/**
 * Persistencia em ARQUIVO para o client de call do zapo.
 *
 * ## Por que existe
 *
 * O zapo e' um client PROPRIO (credenciais no formato dele), separado do
 * Baileys. Sem persistir, o pareamento se perde a cada reinicio: o
 * `WaAuthMemoryStore` do pacote guarda tudo numa propriedade de instancia.
 *
 * ## Por que NAO reimplementamos os contratos
 *
 * Cada dominio tem um contrato especifico (`signal` tem
 * `getRegistrationInfo`/`setSignedPreKey`; `pre-key` tem
 * `getOrGenPreKeys`/`consumePreKeyById`...). Reimplementar a mao quebrou o
 * motor em `store.setRegistrationInfo is not a function`.
 *
 * Aqui as implementacoes do PROPRIO pacote fazem o trabalho, e nos apenas
 * persistimos o estado delas.
 *
 * ## O tipo do campo vem do CONSTRUTOR (e isso conserta estado corrompido)
 *
 * As classes guardam o estado em `Map`/`Set`, e `JSON.stringify(new Map())`
 * produz `{}`. Um `{}` restaurado vira objeto comum e o motor morre em
 * `this.senderKeys.get is not a function`.
 *
 * Marcar o tipo no JSON (`{__map: [...]}`) resolve o que NOS gravamos -- mas
 * NAO conserta o que uma versao anterior ja gravou como `{}`. Por isso a
 * restauracao compara com o valor que o CONSTRUTOR criou:
 *
 *     new SenderKeyMemoryStore() -> { senderKeys: Map, ... }
 *
 * e coage o valor lido para o tipo esperado. Assim o estado ja corrompido se
 * conserta sozinho, sem apagar arquivos.
 */

import fs from 'fs';
import path from 'path';

/** Converte para JSON: Uint8Array -> base64, Map -> lista, Set -> lista. */
function paraJson(valor) {
  if (valor === null || valor === undefined) return valor;

  if (valor instanceof Uint8Array || Buffer.isBuffer(valor)) {
    return { __b64: Buffer.from(valor).toString('base64') };
  }
  if (valor instanceof Map) {
    return { __map: [...valor.entries()].map(([k, v]) => [paraJson(k), paraJson(v)]) };
  }
  if (valor instanceof Set) {
    return { __set: [...valor.values()].map(paraJson) };
  }
  if (Array.isArray(valor)) return valor.map(paraJson);
  if (typeof valor === 'object') {
    const saida = {};
    for (const [k, v] of Object.entries(valor)) saida[k] = paraJson(v);
    return saida;
  }
  return valor;
}

/**
 * Converte de JSON, COAGINDO para o tipo que o campo deve ter.
 *
 * @param {*} valor o que veio do disco
 * @param {*} esperado o que o construtor criou (Map/Set/Uint8Array/...)
 */
function paraBinario(valor, esperado) {
  if (valor === null || valor === undefined) return valor;

  // O tipo esperado manda: e' o que conserta o estado ja corrompido.
  if (esperado instanceof Map) {
    // Formato novo: { __map: [[k, v], ...] }. Formato antigo (corrompido):
    // objeto comum -- a chave vira string e o valor e' o proprio valor.
    if (valor && typeof valor === 'object' && Array.isArray(valor.__map)) {
      return new Map(valor.__map.map(([k, v]) => [paraBinario(k, undefined), paraBinario(v, undefined)]));
    }
    if (valor && typeof valor === 'object' && !Array.isArray(valor)) {
      const saida = new Map();
      for (const [k, v] of Object.entries(valor)) saida.set(k, paraBinario(v, undefined));
      return saida;
    }
    return new Map();
  }

  if (esperado instanceof Set) {
    if (valor && typeof valor === 'object' && Array.isArray(valor.__set)) {
      return new Set(valor.__set.map((x) => paraBinario(x, undefined)));
    }
    if (Array.isArray(valor)) return new Set(valor.map((x) => paraBinario(x, undefined)));
    if (valor && typeof valor === 'object') {
      return new Set(Object.values(valor).map((x) => paraBinario(x, undefined)));
    }
    return new Set();
  }

  if (esperado instanceof Uint8Array) {
    if (valor && typeof valor === 'object' && typeof valor.__b64 === 'string') {
      return new Uint8Array(Buffer.from(valor.__b64, 'base64'));
    }
    if (valor instanceof Uint8Array) return valor;
    if (Array.isArray(valor)) return new Uint8Array(valor);
    return valor;
  }

  // Sem tipo esperado: usa os marcadores, se houver.
  if (typeof valor === 'object' && !Array.isArray(valor)) {
    if (typeof valor.__b64 === 'string') return new Uint8Array(Buffer.from(valor.__b64, 'base64'));
    if (Array.isArray(valor.__map)) {
      return new Map(valor.__map.map(([k, v]) => [paraBinario(k, undefined), paraBinario(v, undefined)]));
    }
    if (Array.isArray(valor.__set)) return new Set(valor.__set.map((x) => paraBinario(x, undefined)));
    const saida = {};
    for (const [k, v] of Object.entries(valor)) saida[k] = paraBinario(v, undefined);
    return saida;
  }

  if (Array.isArray(valor)) return valor.map((x) => paraBinario(x, undefined));
  return valor;
}

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

/** Campos internos que NAO sao estado (callbacks e limites). */
const NAO_PERSISTIR = new Set([
  'onEvict', 'onDistributionEvict', 'onSenderKeyEvict',
  'maxSessions', 'maxPreKeys', 'maxRemoteIdentities',
  'maxSenderKeys', 'maxSenderDistributions',
  'maxCollectionEntries', 'maxSyncKeys', 'maxEntries'
]);

/** Extrai so o estado serializavel. */
function estadoDe(instancia) {
  const saida = {};
  for (const [k, v] of Object.entries(instancia)) {
    if (NAO_PERSISTIR.has(k)) continue;
    if (typeof v === 'function') continue;
    saida[k] = paraJson(v);
  }
  return saida;
}

/**
 * Devolve o estado do disco para dentro da instancia, COAGINDO pelo tipo que
 * o construtor criou para cada campo.
 *
 * E' isto que conserta um `senderKeys: {}` gravado por uma versao anterior.
 */
function restaurarEm(instancia, dados) {
  if (!dados || typeof dados !== 'object') return;
  for (const [k, v] of Object.entries(dados)) {
    if (NAO_PERSISTIR.has(k)) continue;
    const esperado = instancia[k];
    instancia[k] = paraBinario(v, esperado);
  }
}

const ARQUIVO = {
  auth: 'auth.json',
  signal: 'signal.json',
  preKey: 'preKey.json',
  session: 'session.json',
  identity: 'identity.json',
  senderKey: 'senderKey.json',
  appState: 'appState.json',
  privacyToken: 'privacyToken.json'
};

/**
 * Cria um backend de ARQUIVO no formato que o `createStore` do zapo espera.
 */
export function criarStoreArquivo(classes, baseDir, log = () => {}) {
  const {
    WaAuthMemoryStore,
    WaSignalMemoryStore,
    WaPreKeyMemoryStore,
    WaSessionMemoryStore,
    WaIdentityMemoryStore,
    SenderKeyMemoryStore,
    WaAppStateMemoryStore,
    WaPrivacyTokenMemoryStore
  } = classes;

  const caminhoDe = (dominio) => path.join(baseDir, ARQUIVO[dominio] || `${dominio}.json`);

  const criar = (dominio, Classe) => (sessionId) => {
    const inst = new Classe();
    restaurarEm(inst, lerJson(caminhoDe(dominio), null));

    const salvar = () => {
      try {
        escreverJson(caminhoDe(dominio), estadoDe(inst));
      } catch (e) {
      }
    };

    const MUTA = /^(set|put|upsert|delete|mark|consume|clear|save|getOrGen|remove|reset)/;
    for (const nome of Object.getOwnPropertyNames(Object.getPrototypeOf(inst))) {
      if (nome === 'constructor' || typeof inst[nome] !== 'function') continue;
      if (!MUTA.test(nome)) continue;
      const original = inst[nome].bind(inst);
      inst[nome] = async (...args) => {
        const r = await original(...args);
        salvar();
        return r;
      };
    }

    return inst;
  };

  return {
    stores: {
      auth: criar('auth', WaAuthMemoryStore),
      signal: criar('signal', WaSignalMemoryStore),
      preKey: criar('preKey', WaPreKeyMemoryStore),
      session: criar('session', WaSessionMemoryStore),
      identity: criar('identity', WaIdentityMemoryStore),
      senderKey: criar('senderKey', SenderKeyMemoryStore),
      appState: criar('appState', WaAppStateMemoryStore),
      privacyToken: criar('privacyToken', WaPrivacyTokenMemoryStore)
    }
  };
}

/** Atalho: carrega as classes do pacote e cria o backend. */
export async function criarStoreArquivoDoPacote(baseDir, log = () => {}) {
  const mod = await import('zapo-js/store');
  return criarStoreArquivo(mod, baseDir, log);
}

/** Exportados para teste. */
export const __teste = { paraJson, paraBinario, estadoDe, restaurarEm };
