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
 * `getRegistrationInfo`/`setSignedPreKey`/`getSignedPreKeyRotationTs`,
 * `pre-key` tem `getOrGenPreKeys`/`consumePreKeyById`/`markKeyAsUploaded`, e
 * assim por diante. Reimplementar a mao (primeira versao) quebrou o motor em
 * `store.setRegistrationInfo is not a function`.
 *
 * Aqui as implementacoes do PROPRIO pacote fazem o trabalho, e nos so
 * persistimos o estado delas: as classes guardam tudo em propriedades PLANAS
 * (`this.registrationInfo`, `this.preKeys`, ...), entao serializar o objeto e'
 * suficiente.
 *
 * ## O que e' gravado
 *
 * `dados/database/zapo-auth/<dominio>.json`, com escrita ATOMICA (tmp unico +
 * rename). `Uint8Array` vira `{ __b64: "..." }` e volta a `Uint8Array` na
 * leitura -- sem isso o `JSON.stringify` o transformaria em
 * `{0: 12, 1: 34, ...}` e o buffer nao seria reconstruido.
 */

import fs from 'fs';
import path from 'path';

/** Converte para JSON (Uint8Array -> base64). */
function paraJson(valor) {
  if (valor === null || valor === undefined) return valor;
  if (valor instanceof Uint8Array || Buffer.isBuffer(valor)) {
    return { __b64: Buffer.from(valor).toString('base64') };
  }
  if (Array.isArray(valor)) return valor.map(paraJson);
  if (typeof valor === 'object') {
    const saida = {};
    for (const [k, v] of Object.entries(valor)) saida[k] = paraJson(v);
    return saida;
  }
  return valor;
}

/** Converte de JSON (base64 -> Uint8Array). */
function paraBinario(valor) {
  if (valor === null || valor === undefined) return valor;
  if (typeof valor === 'object' && typeof valor.__b64 === 'string') {
    return new Uint8Array(Buffer.from(valor.__b64, 'base64'));
  }
  if (Array.isArray(valor)) return valor.map(paraBinario);
  if (typeof valor === 'object') {
    const saida = {};
    for (const [k, v] of Object.entries(valor)) saida[k] = paraBinario(v);
    return saida;
  }
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
 * Campos internos das classes do pacote que NAO devem ir para o disco
 * (callbacks e limites de configuracao -- nao sao estado).
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
 *        (`{ WaAuthMemoryStore, WaSignalMemoryStore, ... }`)
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
   * Instancia a classe do dominio e restaura o estado do disco.
   *
   * Depois embrulha cada metodo que MUTA para salvar o estado. A lista de
   * metodos que mutam e' obtida dos PROPRIOS contratos (quem comeca com `set`,
   * `put`, `upsert`, `delete`, `mark`, `consume`, `clear`, `save` ou
   * `getOrGen`), entao nao ha lista paralela para envelhecer.
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

    // Embrulha os metodos que mutam. `save` (auth) e `clear` sempre salvam.
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

/**
 * Atalho: carrega as classes do pacote e cria o backend.
 *
 * @param {string} baseDir
 * @param {Function} [log]
 */
export async function criarStoreArquivoDoPacote(baseDir, log = () => {}) {
  const mod = await import('zapo-js/store');
  return criarStoreArquivo(mod, baseDir, log);
}
