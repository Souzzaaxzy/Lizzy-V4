/**
 * Leitura do arquivo APK — validação LOCAL, sem rede e sem dependência nova.
 *
 * Um APK é um ZIP. Deste arquivo tiramos tudo que o `!apk` precisa para não
 * enviar lixo:
 *
 *   - estrutura ZIP válida (End Of Central Directory + `AndroidManifest.xml`);
 *   - `package`, `versionName` e `versionCode`, lidos do `AndroidManifest.xml`
 *     em formato BINÁRIO (AXML) — não existe XML em texto num APK lançado;
 *   - o SHA-256 do certificado de assinatura, extraído do APK Signing Block
 *     (esquemas v2/v3) — o MESMO valor que o F-Droid publica em
 *     `manifest.signer.sha256` / `metadata.preferredSigner`, então dá para
 *     comparar contra uma fonte confiável.
 *
 * POR QUE LEITURA POR POSIÇÃO (e não `readFileSync`):
 * um APK como o do Firefox tem ~127 MB. Carregar isso na RAM para validar
 * derrubaria um bot que já vive com ~300 MB. Então este módulo trabalha sobre
 * uma "fonte" com acesso aleatório (`read(offset, length)` + `size`): as partes
 * necessárias do ZIP (EOCD, diretório central, manifesto, signing block) são
 * lidas em fatias pequenas, e o SHA-256 do arquivo inteiro é calculado em
 * blocos. Nada do APK inteiro vai para a memória.
 *
 * Escolha por AXML + ZIP próprios em vez de biblioteca: um `apk-parser` de
 * terceiros traria dependência (e superfície) maior do que a tarefa justifica.
 * O formato é documentado pelo AOSP e o parser é pequeno.
 *
 * Módulo PURO: não abre socket, não importa Baileys. Testável com fixtures.
 */

import crypto from 'crypto';
import fsSync from 'fs';
import zlib from 'zlib';

const EOCD_SIG = 0x06054b50;
const CDH_SIG = 0x02014b50;
const AXML_STRING_POOL = 0x0001;
const AXML_RESOURCE_MAP = 0x0180;
const AXML_START_TAG = 0x0102;
const SIG_BLOCK_MAGIC = 'APK Sig Block 42';
const SIG_BLOCK_ID_V2 = 0x7109871a;
const SIG_BLOCK_ID_V3 = 0xf05368c0;
const ANDROID_NS = 'http://schemas.android.com/apk/res/android';

/** Teto da janela lida para achar o diretório central (comentário ZIP + folga). */
const EOCD_TAIL = 65557;
/** Teto do diretório central lido de uma vez (metadados do ZIP). */
const MAX_CD_BYTES = 16 * 1024 * 1024;
/** Teto do APK Signing Block lido de uma vez. */
const MAX_SIG_BLOCK_BYTES = 16 * 1024 * 1024;

/** Códigos de erro estáveis — o comando e o log usam estes, nunca string solta. */
export const APK_ERROR = Object.freeze({
  INVALID_ZIP: 'APK_INVALID_FILE',
  NO_MANIFEST: 'APK_INVALID_FILE',
  BAD_MANIFEST: 'APK_METADATA_ERROR',
  METADATA_MISSING: 'APK_METADATA_ERROR',
  PACKAGE_MISMATCH: 'APK_PACKAGE_MISMATCH',
  VERSION_MISMATCH: 'APK_VERSION_MISMATCH',
  HASH_MISMATCH: 'APK_HASH_MISMATCH',
  SIGNATURE_ERROR: 'APK_SIGNATURE_ERROR',
});

/** Erro com código estável (para log) e mensagem curta (para o usuário). */
export class ApkValidationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ApkValidationError';
    this.code = code;
    this.details = details;
  }
}

/** Fonte com acesso aleatório sobre um Buffer em memória. */
export class BufferSource {
  constructor(buf) {
    this.buf = buf;
    this.size = buf.length;
  }
  read(offset, length) {
    const start = Math.max(0, offset);
    return this.buf.subarray(start, Math.min(start + length, this.size));
  }
  close() {}
}

/** Fonte com acesso aleatório sobre um arquivo (não carrega o arquivo inteiro). */
export class FileSource {
  constructor(filePath) {
    this.path = filePath;
    this.fd = fsSync.openSync(filePath, 'r');
    this.size = fsSync.fstatSync(this.fd).size;
  }
  read(offset, length) {
    const start = Math.max(0, offset);
    const len = Math.max(0, Math.min(length, this.size - start));
    const buffer = Buffer.alloc(len);
    if (len > 0) fsSync.readSync(this.fd, buffer, 0, len, start);
    return buffer;
  }
  close() {
    if (this.fd != null) {
      fsSync.closeSync(this.fd);
      this.fd = null;
    }
  }
}

/** Aceita Buffer, source ou caminho de arquivo. */
export function toSource(input) {
  if (input instanceof BufferSource || input instanceof FileSource) return input;
  if (Buffer.isBuffer(input)) return new BufferSource(input);
  return new FileSource(input);
}

/** Localiza o End Of Central Directory (lendo só a cauda). */
export function findEocd(source) {
  const tailLen = Math.min(source.size, EOCD_TAIL);
  const tailStart = source.size - tailLen;
  const tail = source.read(tailStart, tailLen);
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === EOCD_SIG) {
      return {
        eocdOffset: tailStart + i,
        cdOffset: tail.readUInt32LE(i + 16),
        cdSize: tail.readUInt32LE(i + 12),
        cdCount: tail.readUInt16LE(i + 10),
      };
    }
  }
  return null;
}

/**
 * Percorre o Central Directory e devolve o mapa nome -> entrada.
 * Lança `APK_INVALID_FILE` quando a estrutura não fecha.
 */
export function readZipEntries(source) {
  const eocd = findEocd(source);
  if (!eocd) throw new ApkValidationError(APK_ERROR.INVALID_ZIP, 'APK inválido (não é um ZIP).');
  const { cdOffset, cdSize, cdCount } = eocd;
  if (cdOffset <= 0 || cdOffset >= source.size || cdSize <= 0 || cdSize > MAX_CD_BYTES) {
    throw new ApkValidationError(APK_ERROR.INVALID_ZIP, 'APK inválido (diretório central corrompido).');
  }

  const cd = source.read(cdOffset, cdSize);
  const entries = new Map();
  let p = 0;
  let seen = 0;
  while (p + 46 <= cd.length && cd.readUInt32LE(p) === CDH_SIG) {
    const method = cd.readUInt16LE(p + 10);
    const csize = cd.readUInt32LE(p + 20);
    const usize = cd.readUInt32LE(p + 24);
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    const localOffset = cd.readUInt32LE(p + 42);
    const name = cd.toString('utf8', p + 46, Math.min(p + 46 + nameLen, cd.length));
    entries.set(name, { name, method, csize, usize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
    seen++;
    if (seen > cdCount + 8) break; // guarda contra laço em arquivo corrompido
  }

  if (entries.size === 0) {
    throw new ApkValidationError(APK_ERROR.INVALID_ZIP, 'APK inválido (ZIP sem entradas).');
  }
  return entries;
}

/** Extrai (e infla, se preciso) o conteúdo de uma entrada do ZIP. */
export function readZipEntry(source, entry) {
  if (!entry) return null;
  const header = source.read(entry.localOffset, 30);
  if (header.length < 30) {
    throw new ApkValidationError(APK_ERROR.INVALID_ZIP, 'APK inválido (cabeçalho local ausente).');
  }
  const nameLen = header.readUInt16LE(26);
  const extraLen = header.readUInt16LE(28);
  const dataStart = entry.localOffset + 30 + nameLen + extraLen;
  const raw = source.read(dataStart, entry.csize);
  if (entry.method === 0) return raw;
  if (entry.method === 8) {
    try {
      return zlib.inflateRawSync(raw);
    } catch {
      throw new ApkValidationError(APK_ERROR.INVALID_ZIP, 'APK inválido (entrada corrompida).');
    }
  }
  throw new ApkValidationError(APK_ERROR.INVALID_ZIP, `APK inválido (compressão ${entry.method}).`);
}

/**
 * Parser do AndroidManifest.xml binário (AXML) — suficiente para o `!apk`.
 *
 * Lê o string pool (UTF-8 ou UTF-16), o resource map e a primeira start tag
 * (`<manifest>`), devolvendo os atributos como objeto. Valores de string vêm do
 * `rawValue`; inteiros vêm do `data` tipado.
 */
export function parseBinaryManifest(buf) {
  if (!buf || buf.length < 8) {
    throw new ApkValidationError(APK_ERROR.BAD_MANIFEST, 'AndroidManifest.xml vazio.');
  }
  if (buf.readUInt16LE(0) !== 0x0003) {
    throw new ApkValidationError(APK_ERROR.BAD_MANIFEST, 'AndroidManifest.xml não é binário (AXML).');
  }
  if (buf.readUInt16LE(8) !== AXML_STRING_POOL) {
    throw new ApkValidationError(APK_ERROR.BAD_MANIFEST, 'AndroidManifest.xml sem string pool.');
  }

  const spHeaderSize = buf.readUInt16LE(10);
  const spSize = buf.readUInt32LE(12);
  const stringCount = buf.readUInt32LE(16);
  const flags = buf.readUInt32LE(24);
  const stringsStart = buf.readUInt32LE(28);
  const isUtf8 = (flags & 0x100) !== 0;
  if (stringCount < 0 || stringCount > 200000) {
    throw new ApkValidationError(APK_ERROR.BAD_MANIFEST, 'AndroidManifest.xml com string pool inválido.');
  }

  const offsets = [];
  for (let i = 0; i < stringCount; i++) offsets.push(buf.readUInt32LE(8 + spHeaderSize + i * 4));
  const poolBase = 8 + stringsStart;

  const getString = (i) => {
    if (i == null || i < 0 || i >= stringCount) return null;
    const at = poolBase + offsets[i];
    if (at < 0 || at >= buf.length) return null;
    if (isUtf8) {
      let lenA = buf[at];
      let idx = at + 1;
      if (lenA & 0x80) { lenA = ((lenA & 0x7f) << 8) | buf[idx]; idx += 1; }
      let lenB = buf[idx];
      idx += 1;
      if (lenB & 0x80) { lenB = ((lenB & 0x7f) << 8) | buf[idx]; idx += 1; }
      return buf.toString('utf8', idx, Math.min(idx + lenB, buf.length));
    }
    const len = buf.readUInt16LE(at);
    return buf.toString('utf16le', at + 2, Math.min(at + 2 + len * 2, buf.length));
  };

  let off = 8 + spSize;
  let resourceMap = null;
  while (off + 8 <= buf.length) {
    const type = buf.readUInt16LE(off);
    const headerSize = buf.readUInt16LE(off + 2);
    const size = buf.readUInt32LE(off + 4);
    if (size <= 0 || off + size > buf.length) break;

    if (type === AXML_RESOURCE_MAP) {
      const count = Math.floor((size - headerSize) / 4);
      resourceMap = [];
      for (let i = 0; i < count; i++) resourceMap.push(buf.readUInt32LE(off + headerSize + i * 4));
    } else if (type === AXML_START_TAG) {
      const nameIdx = buf.readInt32LE(off + 20);
      const attrStart = buf.readUInt16LE(off + 24);
      const attrSize = buf.readUInt16LE(off + 26);
      const attrCount = buf.readUInt16LE(off + 28);
      const tagName = getString(nameIdx);
      const attrs = {};
      for (let i = 0; i < attrCount; i++) {
        const a = off + 16 + attrStart + i * attrSize;
        if (a + 20 > buf.length) break;
        const nsIdx = buf.readInt32LE(a);
        const nameStrIdx = buf.readInt32LE(a + 4);
        const rawIdx = buf.readInt32LE(a + 8);
        const valueType = buf.readUInt8(a + 15);
        const valueData = buf.readUInt32LE(a + 16);
        const ns = getString(nsIdx);
        const attrName = getString(nameStrIdx);
        if (!attrName) continue;
        // Preferimos o valor cru quando é string (tipo 0x03).
        const value = valueType === 0x03 ? getString(rawIdx) : valueData;
        attrs[ns === ANDROID_NS ? `android:${attrName}` : attrName] = value;
      }
      return { tag: tagName, attrs, resourceMap };
    }
    off += size;
  }

  throw new ApkValidationError(APK_ERROR.BAD_MANIFEST, 'AndroidManifest.xml sem tag <manifest>.');
}

/** Lê `package`, `versionName`, `versionCode` do manifesto binário. */
export function readApkIdentity(input) {
  const own = !(input instanceof BufferSource) && !(input instanceof FileSource);
  const source = toSource(input);
  try {
    const entries = readZipEntries(source);
    const manifestEntry = entries.get('AndroidManifest.xml');
    if (!manifestEntry) {
      throw new ApkValidationError(APK_ERROR.NO_MANIFEST, 'APK sem AndroidManifest.xml.');
    }
    const { attrs } = parseBinaryManifest(readZipEntry(source, manifestEntry));

    const packageName = attrs.package || null;
    const versionName = attrs['android:versionName'] != null ? String(attrs['android:versionName']) : null;
    const versionCode = attrs['android:versionCode'] != null ? Number(attrs['android:versionCode']) : null;

    if (!packageName) {
      throw new ApkValidationError(APK_ERROR.METADATA_MISSING, 'APK sem package name no manifesto.');
    }
    return { packageName, versionName, versionCode };
  } finally {
    if (own) source.close();
  }
}

/**
 * Certificados de assinatura do APK, com fingerprint SHA-256.
 *
 * v2/v3: blocos do "APK Signing Block" (ids 0x7109871a / 0xf05368c0) — o bloco
 * termina exatamente onde começa o diretório central, então é lido de trás para
 * frente a partir daí.
 * v1 (JAR): `META-INF/*.RSA|DSA|EC` com PKCS#7; o primeiro certificado é
 * localizado por varredura DER.
 *
 * @returns {{scheme: string, sha256: string}[]}
 */
export function readSignerFingerprints(input) {
  const own = !(input instanceof BufferSource) && !(input instanceof FileSource);
  const source = toSource(input);
  try {
    const out = [];
    const eocd = findEocd(source);
    if (!eocd) return out;

    const pairs = readSigningBlockPairs(source, eocd.cdOffset);
    for (const [id, value] of pairs) {
      if (id !== SIG_BLOCK_ID_V2 && id !== SIG_BLOCK_ID_V3) continue;
      for (const der of readSchemeCertificates(value)) {
        out.push({ scheme: id === SIG_BLOCK_ID_V2 ? 'v2' : 'v3', sha256: sha256Hex(der) });
      }
    }

    if (out.length === 0) {
      for (const der of readV1Certificates(source)) {
        out.push({ scheme: 'v1', sha256: sha256Hex(der) });
      }
    }
    return out;
  } finally {
    if (own) source.close();
  }
}

/** Lê os pares (id, value) do APK Signing Block. Vazio quando não existe. */
function readSigningBlockPairs(source, cdOffset) {
  if (cdOffset < 32) return [];
  const trailer = source.read(cdOffset - 24, 24);
  if (trailer.length < 24) return [];
  if (trailer.toString('latin1', 8, 24) !== SIG_BLOCK_MAGIC) return [];

  const blockSize = Number(trailer.readBigUInt64LE(0));
  if (!Number.isFinite(blockSize) || blockSize <= 8 || blockSize > MAX_SIG_BLOCK_BYTES) return [];
  // The block ends with [size (8)][magic (16)] right before the central
  // directory, and `size` excludes only the leading size field.
  const blockStart = cdOffset - 8 - blockSize;
  if (blockStart < 0) return [];

  const block = source.read(blockStart, blockSize);
  if (block.length < blockSize) return [];
  if (Number(block.readBigUInt64LE(0)) !== blockSize) return [];

  const pairs = [];
  let p = 8;
  while (p + 8 <= block.length) {
    const pairLen = Number(block.readBigUInt64LE(p));
    if (pairLen <= 4 || p + 8 + pairLen > block.length) break;
    pairs.push([block.readUInt32LE(p + 8), block.subarray(p + 12, p + 8 + pairLen)]);
    p += 8 + pairLen;
  }
  return pairs;
}

/** Percorre o bloco de um esquema v2/v3 e devolve os certificados DER. */
function readSchemeCertificates(value) {
  const certs = [];
  try {
    let off = 0;
    const readLen = () => {
      const n = value.readUInt32LE(off);
      off += 4;
      if (n < 0 || n > value.length) throw new Error('overflow');
      return n;
    };
    // Cada bloco tem seu comprimento LIDO ANTES de somar ao offset — escrever
    // `off + readLen()` leria `off` antes da mutação e desalinharia tudo.
    const signersLen = readLen();
    const signersEnd = off + signersLen;
    while (off < signersEnd && off + 4 <= value.length) {
      const signerLen = readLen();
      const signerEnd = off + signerLen;
      const signedDataLen = readLen();
      const signedDataEnd = off + signedDataLen;
      const digestsLen = readLen();
      off += digestsLen; // blob de digests (ALGORITHM -> digest)
      const certsLen = readLen();
      const certsEnd = off + certsLen;
      while (off < certsEnd && off + 4 <= value.length) {
        const certLen = readLen();
        certs.push(value.subarray(off, off + certLen));
        off += certLen;
      }
      off = Math.max(signedDataEnd, signerEnd);
    }
  } catch {
    // estrutura inesperada: devolve o que já achou (a comparação decidirá)
  }
  return certs;
}

/** Extrai os certificados do esquema v1 (META-INF/*.RSA) via varredura DER. */
function readV1Certificates(source) {
  const out = [];
  let entries;
  try {
    entries = readZipEntries(source);
  } catch {
    return out;
  }
  for (const [name, entry] of entries) {
    if (!/^META-INF\/.*\.(RSA|DSA|EC)$/i.test(name)) continue;
    try {
      const pkcs7 = readZipEntry(source, entry);
      const der = firstCertificateFromPkcs7(pkcs7);
      if (der) out.push(der);
    } catch {
      continue;
    }
  }
  return out;
}

/**
 * Primeiro certificado X.509 dentro de um SignedData PKCS#7.
 *
 * Sem biblioteca ASN.1: um `Certificate` é um SEQUENCE que começa com
 * `30 82 .. .. 30 82 .. ..` (tbsCertificate + AlgorithmIdentifier). Aceitamos a
 * primeira ocorrência plausível; a comparação de fingerprint é o juiz final.
 */
function firstCertificateFromPkcs7(der) {
  for (let i = 0; i + 8 < der.length; i++) {
    if (der[i] !== 0x30 || (der[i + 1] & 0x80) !== 0x80) continue;
    const lenBytes = der[i + 1] & 0x7f;
    if (lenBytes !== 2 && lenBytes !== 3) continue;
    const total = lenBytes === 2 ? der.readUInt16BE(i + 2) : der.readUIntBE(i + 2, 3);
    const contentStart = i + 1 + lenBytes;
    if (contentStart + 6 > der.length) continue;
    if (der[contentStart] !== 0x30) continue;
    if (contentStart + total > der.length) continue;
    return der.subarray(i, contentStart + total);
  }
  return null;
}

export function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** SHA-256 de uma fonte lida em blocos (não carrega o arquivo inteiro na RAM). */
export function sha256Source(input) {
  const own = !(input instanceof BufferSource) && !(input instanceof FileSource);
  const source = toSource(input);
  try {
    const hash = crypto.createHash('sha256');
    const CHUNK = 1 << 20;
    for (let off = 0; off < source.size; off += CHUNK) {
      hash.update(source.read(off, Math.min(CHUNK, source.size - off)));
    }
    return hash.digest('hex');
  } finally {
    if (own) source.close();
  }
}

/**
 * Valida um APK contra os metadados do F-Droid.
 *
 * @param {Buffer|FileSource|string} input Buffer, source ou caminho
 * @param {object} expected metadados do F-Droid
 * @returns {{ok: boolean, code?: string, message?: string, identity?: object, signers?: Array, actualSha256?: string}}
 */
export function validateApk(input, expected = {}) {
  const ownSource = !(input instanceof BufferSource) && !(input instanceof FileSource);
  const source = toSource(input);
  try {
    if (!source.size) {
      return { ok: false, code: APK_ERROR.INVALID_ZIP, message: 'Arquivo vazio.' };
    }

    let identity;
    try {
      identity = readApkIdentity(source);
    } catch (e) {
      if (e instanceof ApkValidationError) return { ok: false, code: e.code, message: e.message };
      return { ok: false, code: APK_ERROR.INVALID_ZIP, message: 'APK inválido.' };
    }

    // package name: obrigatório conferir (é o que evita enviar o app errado).
    if (expected.packageName && identity.packageName !== expected.packageName) {
      return {
        ok: false,
        code: APK_ERROR.PACKAGE_MISMATCH,
        message: `Package diferente do esperado (${identity.packageName}).`,
        identity,
      };
    }

    // versionCode: compara quando o F-Droid informa.
    if (expected.versionCode != null && identity.versionCode != null
      && Number(expected.versionCode) !== Number(identity.versionCode)) {
      return {
        ok: false,
        code: APK_ERROR.VERSION_MISMATCH,
        message: `versionCode diferente do esperado (${identity.versionCode}).`,
        identity,
      };
    }

    // SHA-256 do arquivo: a validação mais forte disponível. Só é pulada quando
    // o índice não informa o hash.
    if (expected.sha256) {
      const actual = sha256Source(source);
      if (actual.toLowerCase() !== String(expected.sha256).toLowerCase()) {
        return {
          ok: false,
          code: APK_ERROR.HASH_MISMATCH,
          message: 'SHA-256 do arquivo não confere.',
          identity,
          actualSha256: actual,
        };
      }
    }

    // Assinatura: quando o F-Droid publica o fingerprint do signer, ele TEM de
    // constar entre os certificados do APK — é a prova de que o binário foi
    // assinado pelo signer que o F-Droid conhece. Não é verificação
    // criptográfica da assinatura (exigiria apksigner/Java); é a checagem de
    // identidade do certificado, que é o que dá para fazer com segurança e sem
    // dependência nova.
    let signers = [];
    if (expected.signerSha256) {
      signers = readSignerFingerprints(source);
      if (signers.length === 0) {
        return { ok: false, code: APK_ERROR.SIGNATURE_ERROR, message: 'APK sem certificado de assinatura.', identity };
      }
      const wanted = String(expected.signerSha256).toLowerCase();
      if (!signers.some((s) => s.sha256.toLowerCase() === wanted)) {
        return {
          ok: false,
          code: APK_ERROR.SIGNATURE_ERROR,
          message: 'Certificado de assinatura não é o do F-Droid.',
          identity,
          signers,
        };
      }
    }

    return { ok: true, identity, signers };
  } finally {
    if (ownSource) source.close();
  }
}

export default {
  APK_ERROR,
  ApkValidationError,
  BufferSource,
  FileSource,
  toSource,
  findEocd,
  readZipEntries,
  readZipEntry,
  parseBinaryManifest,
  readApkIdentity,
  readSignerFingerprints,
  sha256Hex,
  sha256Source,
  validateApk,
};
