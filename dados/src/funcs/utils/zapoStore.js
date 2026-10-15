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
 * Cada dominio tem um contrato especifico -- `signal` tem
 * `getRegistrationInfo`/`setSignedPreKey`, `pre-key` tem
 * `getOrGenPreKeys`/`consumePreKeyById`, e assim por diante. Reimplementar a
 * mao quebrou o motor em `store.setRegistrationInfo is not a function`.
 *
 * Aqui as implementacoes do PROPRIO pacote fazem o trabalho, e nos apenas
 * persistimos o estado delas.
 *
 * ## Os tipos que o JSON NAO preserva (a parte que custou duas rodadas)
 *
 * As classes guardam o estado em `Map`/`Set`:
 *
 *     senderKeys / senderDistributions / signalSessions / preKeys /
 *     remoteIdentities / collections / keys / records  -> Map
 *     uploadedPreKeys                                  -> Set
 *
 * `JSON.stringify(new Map())` produz `{}` -- o campo volta como objeto comum e
 * o motor morre em `this.senderKeys.get is not a function`. Por isso os tres
 * tipos que o JSON nao representa sao MARCADOS e reconstruidos:
 *
 *     Uint8Array -> { __b64: "..." }
 *     Map        -> { __map: [[chave, valor], ...] }
 *     Set        -> { __set: [valor, ...] }
 *
 * Uma chave de Map pode ser `Uint8Array` (o zapo usa isso em `keys`), entao a
 * chave tambem passa pelo conversor.
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

/** Converte de JSON: base64 -> Uint8Array, lista -> Map, lista -> Set. */
function paraBinario(valor) {
  if (valor === null || valor === undefined) return valor;

  if (typeof valor === 'object' && !Array.isArray(valor)) {
    if (typeof valor.__b64 === 'string') {
      return new Uint8Array(Buffer.from(valor.__b64, 'base64'));
    }
    if (Array.isArray(valor.__map)) {
      return new Map(valor.__map.map(([k, v]) => [paraBinario(k), paraBinario(v)]));
    }
    if (Array.isArray(valor.__set)) {
      return new Set(valor.__set.map(paraBinario));
    }
    const saida = {};
    for (const [k, v] of Object.entries(valor)) saida[k] = paraBinario(v);
    return saida;
  }

  if (Array.isArray(valor)) return valor.map(paraBinario);
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

/**
 * Campos internos que NAO sao estado (callbacks e limites de configuracao).
 */
const NAO_PERSISTIR = new Set([
  'onEvict', 'onDistributionEvict', 'onSenderKeyEvict',
  'maxSessions', 'maxPreKeys', 'maxRemoteIdentities',
  'maxSenderKeys', 'maxSenderDistributions',
  'maxCollectionEntries', 'maxSyncKeys', 'maxEntries'
]);

/** Extrai so o estado serializavel da instancia. */
function estadoDe(instancia) {
  const saida = {};
  for (const [k, v] of Object.entries(instancia)) {
    if (NAO_PERSISTIR.has(k)) continue;
    if (typeof v === 'function') continue;
    saida[k] = paraJson(v);
  }
  return saida;
}

/** Devolve o estado do disco para dentro da instancia. */
function restaurarEm(instancia, dados) {
  if (!dados || typeof dados !== 'object') return;
  for (const [k, v] of Object.entries(dados)) {
    if (NAO_PERSISTIR.has(k)) continue;
    instancia[k] = paraBinario(v);
  }
}

/** Nome do arquivo por dominio. */
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
 *
 * @param {object} classes as classes de memory store do pacote
 * @param {string} baseDir diretorio onde gravar
 * @param {Function} [log]
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

  /**
   * Instancia a classe do dominio, restaura o estado do disco e embrulha os
   * metodos que MUTAM para salvar.
   *
   * A lista de metodos que mutam vem do PROPRIO contrato (prefixos
   * set/put/upsert/delete/mark/consume/clear/save/getOrGen), sem lista paralela
   * para envelhecer.
   */
  const criar = (dominio, Classe) => (sessionId) => {
    const inst = new Classe();
    restaurarEm(inst, lerJson(caminhoDe(dominio), null));

    const salvar = () => {
      try {
        escreverJson(caminhoDe(dominio), estadoDe(inst));
      } catch (e) {
        log(`[ZAPO-STORE] falha ao gravar ${dominio}: ${e?.message || e}`);
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

/** Exportados para teste (o round-trip dos tipos e' o ponto critico). */
export const __teste = { paraJson, paraBinario };
