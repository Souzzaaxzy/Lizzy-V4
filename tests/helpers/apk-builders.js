/**
 * Construtores de APK PARA TESTE — monta um APK mínimo real (ZIP + AXML) em
 * memória, sem depender de nenhum binário versionado.
 *
 * Por que existe: testar `!apk` sem baixar nada exige um APK que o validador
 * aceite. Um APK é ZIP + `AndroidManifest.xml` binário; ambos são construídos
 * aqui. Assim o teste roda offline e nada binário entra no repositório.
 *
 * Também monta um "APK assinado" com bloco de assinatura v2, para exercitar a
 * leitura de fingerprint do signer.
 */

import crypto from 'crypto';

/** AndroidManifest.xml binário (AXML) com os atributos pedidos. */
export function buildAxml({ packageName, versionName, versionCode, utf8 = true }) {
  // índices: 0 manifest, 1 package, 2 versionName, 3 versionCode,
  //          4 ANDROID_NS, 5 packageName(valor), 6 versionName(valor)
  const ANDROID_NS = 'http://schemas.android.com/apk/res/android';
  const all = ['manifest', 'package', 'versionName', 'versionCode', ANDROID_NS, packageName, versionName];

  const encodeStr = (s) => {
    if (utf8) {
      const bytes = Buffer.from(s, 'utf8');
      const len = bytes.length;
      const out = [];
      // u16 length (comprimento em "caracteres" utf16; para ASCII é o mesmo)
      if (len > 127) out.push((len >> 8) | 0x80);
      out.push(len & 0xff);
      // u8 length (comprimento em bytes utf8)
      if (len > 127) out.push((len >> 8) | 0x80);
      out.push(len & 0xff);
      return Buffer.concat([Buffer.from(out), bytes, Buffer.from([0])]);
    }
    const len = s.length;
    const out = Buffer.alloc(2 + len * 2 + 2);
    out.writeUInt16LE(len, 0);
    for (let i = 0; i < len; i++) out.writeUInt16LE(s.charCodeAt(i), 2 + i * 2);
    return out;
  };

  const chunks = [];
  const offsets = [];
  let cursor = 0;
  const headerSize = 28;
  const stringsStart = headerSize + all.length * 4;
  for (const s of all) {
    offsets.push(cursor);
    const enc = encodeStr(s);
    chunks.push(enc);
    cursor += enc.length;
  }
  const poolData = Buffer.concat(chunks);
  const poolSize = stringsStart + poolData.length;
  const pool = Buffer.alloc(poolSize);
  pool.writeUInt16LE(0x0001, 0);
  pool.writeUInt16LE(headerSize, 2);
  pool.writeUInt32LE(poolSize, 4);
  pool.writeUInt32LE(all.length, 8);
  pool.writeUInt32LE(0, 12);
  pool.writeUInt32LE(utf8 ? 0x100 : 0, 16);
  pool.writeUInt32LE(stringsStart, 20);
  pool.writeUInt32LE(0, 24);
  offsets.forEach((o, i) => pool.writeUInt32LE(o, headerSize + i * 4));
  poolData.copy(pool, stringsStart);

  // resource map (presente em APKs reais)
  const resMap = Buffer.alloc(8 + 3 * 4);
  resMap.writeUInt16LE(0x0180, 0);
  resMap.writeUInt16LE(8, 2);
  resMap.writeUInt32LE(resMap.length, 4);
  resMap.writeUInt32LE(16843292, 8);
  resMap.writeUInt32LE(16843291, 12);
  resMap.writeUInt32LE(0x01010000, 16);

  // start tag <manifest>
  const attrCount = 3;
  const attrSize = 20;
  const attributeStart = 20;
  const attrsOffset = 16 + attributeStart;
  const startTagSize = attrsOffset + attrSize * attrCount;
  const startTag = Buffer.alloc(startTagSize);
  startTag.writeUInt16LE(0x0102, 0);
  startTag.writeUInt16LE(16, 2);
  startTag.writeUInt32LE(startTagSize, 4);
  startTag.writeUInt32LE(0xffffffff, 8);
  startTag.writeUInt32LE(0xffffffff, 12);
  startTag.writeInt32LE(-1, 16);
  startTag.writeInt32LE(0, 20);
  startTag.writeUInt16LE(attributeStart, 24);
  startTag.writeUInt16LE(attrSize, 26);
  startTag.writeUInt16LE(attrCount, 28);
  const writeAttr = (idx, nsIdx, nameIdx, rawIdx, type, data) => {
    const a = attrsOffset + idx * attrSize;
    startTag.writeInt32LE(nsIdx, a);
    startTag.writeInt32LE(nameIdx, a + 4);
    startTag.writeInt32LE(rawIdx, a + 8);
    startTag.writeUInt16LE(8, a + 12);
    startTag.writeUInt8(0, a + 14);
    startTag.writeUInt8(type, a + 15);
    startTag.writeUInt32LE(data, a + 16);
  };
  // versionCode: inteiro, com namespace android (como o AOSP emite)
  writeAttr(0, 4, 3, -1, 0x10, versionCode);
  // versionName: string, com raw apontando para o VALOR (índice 6)
  writeAttr(1, 4, 2, 6, 0x03, 6);
  // package: string sem namespace, raw para o VALOR (índice 5)
  writeAttr(2, -1, 1, 5, 0x03, 5);

  const body = Buffer.concat([pool, resMap, startTag]);
  const totalSize = 8 + body.length;
  const header = Buffer.alloc(8);
  header.writeUInt16LE(0x0003, 0);
  header.writeUInt16LE(8, 2);
  header.writeUInt32LE(totalSize, 4);
  return Buffer.concat([header, body]);
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** ZIP em modo "store" (sem compressão) com as entradas dadas. */
export function buildZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const body = Buffer.concat(locals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(body.length, 16);
  return Buffer.concat([body, cd, eocd]);
}

/** APK sintético válido (ZIP + manifesto AXML). */
export function buildApk({ packageName = 'com.example.app', versionName = '1.0', versionCode = 1 } = {}) {
  const manifest = buildAxml({ packageName, versionName, versionCode });
  const dex = Buffer.from('dex\n035\0' + '\0'.repeat(20), 'latin1');
  return buildZip([
    { name: 'AndroidManifest.xml', data: manifest },
    { name: 'classes.dex', data: dex },
    { name: 'resources.arsc', data: Buffer.from([0x02, 0, 0x0c, 0, 0, 0, 0, 0]) },
  ]);
}

/**
 * APK sintético COM bloco de assinatura v2. O "certificado" é um DER bem
 * formado (SEQUENCE de OCTET STRING); o teste compara só o fingerprint.
 */
/** Constrói um bloco de signer v2/v3 (mesma estrutura) com o certificado dado. */
function buildSignerBlock(id, cert) {
  const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
  const digests = Buffer.concat([u32(4), u32(0), u32(8)]);
  const certsBlob = Buffer.concat([u32(cert.length), cert]);
  const signedData = Buffer.concat([u32(digests.length), digests, u32(certsBlob.length), certsBlob]);
  const signer = Buffer.concat([u32(signedData.length), signedData]);
  const signers = Buffer.concat([u32(signer.length), signer]);
  const schemeValue = Buffer.concat([u32(signers.length), signers]);
  const pair = Buffer.concat([Big64(4 + schemeValue.length), u32(id), schemeValue]);
  return pair;
}

/** Certificado DER sintético determinístico. */
function syntheticCert(seed) {
  const payload = Buffer.alloc(64, seed);
  return Buffer.concat([
    Buffer.from([0x30, 0x82, 0x00, payload.length + 4]),
    Buffer.from([0x04, 0x82, 0x00, payload.length]),
    payload,
  ]);
}

/** Insere um APK Signing Block entre o conteúdo e o diretório central. */
function insertSigningBlock(base, pairs, { extraTopPair = null } = {}) {
  const magic = Buffer.from('APK Sig Block 42');
  const allPairs = extraTopPair ? [extraTopPair, ...pairs] : pairs;
  const body = Buffer.concat(allPairs);
  const blockSize = 8 + body.length + 16;
  const block = Buffer.concat([Big64(blockSize), body, Big64(blockSize), magic]);

  const eocdOff = base.length - 22;
  const cdOffset = base.readUInt32LE(eocdOff + 16);
  const head = base.subarray(0, cdOffset);
  const cd = base.subarray(cdOffset, eocdOff);
  const eocd = Buffer.from(base.subarray(eocdOff));
  eocd.writeUInt32LE(cdOffset + block.length, 16);
  return Buffer.concat([head, block, cd, eocd]);
}

/**
 * APK sintético com assinatura v2/v3 (opcionalmente v3.1 com certificado
 * diferente, para exercitar a rotação de chave).
 */
export function buildSignedApk({ packageName = 'com.signed.app', versionName = '1.0', versionCode = 1, certSeed = 7, v31Seed = null } = {}) {
  const base = buildApk({ packageName, versionName, versionCode });
  const cert = syntheticCert(certSeed);
  const pairs = [buildSignerBlock(0x7109871a, cert), buildSignerBlock(0xf05368c0, cert)];
  const v31Cert = v31Seed != null ? syntheticCert(v31Seed) : null;
  if (v31Cert) pairs.push(buildSignerBlock(0x1b93ad61, v31Cert));

  const apk = insertSigningBlock(base, pairs);
  return {
    apk,
    expectedSignerSha256: crypto.createHash('sha256').update(cert).digest('hex'),
    expectedSignerSha1: crypto.createHash('sha1').update(cert).digest('hex').toUpperCase(),
    v31SignerSha1: v31Cert ? crypto.createHash('sha1').update(v31Cert).digest('hex').toUpperCase() : null,
  };
}

/**
 * APK assinado SOMENTE no esquema v1 (JAR): `META-INF/CERT.RSA` com um PKCS#7
 * real (ContentInfo → SignedData → certificates). Antes, esses APKs eram
 * recusados por "sem certificado".
 */
export function buildV1SignedApk({ packageName = 'com.v1.app', versionName = '1.0', versionCode = 1, certSeed = 3 } = {}) {
  const cert = syntheticCert(certSeed);
  const signedData = derWrap(0x30, Buffer.concat([
    derWrap(0x02, Buffer.from([0x01])),                       // version
    derWrap(0x31, Buffer.alloc(0)),                           // digestAlgorithms
    derWrap(0x30, Buffer.from([0x06, 0x01, 0x00])),           // contentInfo
    derWrap(0x31, Buffer.alloc(0)),                           // signerInfos
    // certificates [0] IMPLICIT SET OF Certificate: os certificados entram
    // DIRETO dentro do [0], como no PKCS#7 real.
    derWrap(0xa0, cert),
  ]));
  const pkcs7 = derWrap(0x30, Buffer.concat([
    derWrap(0x06, Buffer.from([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02])), // signedData OID
    derWrap(0xa0, signedData),
  ]));

  const base = buildApk({ packageName, versionName, versionCode });
  const apk = buildZip([
    { name: 'AndroidManifest.xml', data: extractManifest(base) },
    { name: 'classes.dex', data: Buffer.from('dex\n035\0', 'latin1') },
    { name: 'META-INF/MANIFEST.MF', data: Buffer.from('Manifest-Version: 1.0\n\n') },
    { name: 'META-INF/CERT.SF', data: Buffer.from('Signature-Version: 1.0\n\n') },
    { name: 'META-INF/CERT.RSA', data: pkcs7 },
  ]);
  return { apk, expectedSignerSha1: crypto.createHash('sha1').update(cert).digest('hex').toUpperCase() };
}

/** Extrai o AndroidManifest.xml de um APK construído (para reempacotar). */
import zlib from 'node:zlib';
function extractManifest(apk) {
  const eocd = apk.length - 22;
  const cdOffset = apk.readUInt32LE(eocd + 16);
  const cdSize = apk.readUInt32LE(eocd + 12);
  let p = cdOffset;
  while (p < cdOffset + cdSize && apk.readUInt32LE(p) === 0x02014b50) {
    const method = apk.readUInt16LE(p + 10);
    const csize = apk.readUInt32LE(p + 20);
    const nameLen = apk.readUInt16LE(p + 28);
    const extraLen = apk.readUInt16LE(p + 30);
    const cmtLen = apk.readUInt16LE(p + 32);
    const lho = apk.readUInt32LE(p + 42);
    const name = apk.toString('utf8', p + 46, p + 46 + nameLen);
    if (name === 'AndroidManifest.xml') {
      const nl = apk.readUInt16LE(lho + 26);
      const el = apk.readUInt16LE(lho + 28);
      const start = lho + 30 + nl + el;
      const raw = apk.subarray(start, start + csize);
      if (method === 8) return zlib.inflateRawSync(raw);
      return raw;
    }
    p += 46 + nameLen + extraLen + cmtLen;
  }
  throw new Error('manifest não encontrado no APK de teste');
}

/** Envolve um conteúdo em um TLV DER (tag + length). */
function derWrap(tag, content) {
  const len = content.length;
  if (len < 0x80) return Buffer.concat([Buffer.from([tag, len]), content]);
  if (len < 0x100) return Buffer.concat([Buffer.from([tag, 0x81, len]), content]);
  return Buffer.concat([Buffer.from([tag, 0x82, (len >> 8) & 0xff, len & 0xff]), content]);
}

function Big64(n) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
}

/** SHA-256 em hex de um buffer. */
export function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}
