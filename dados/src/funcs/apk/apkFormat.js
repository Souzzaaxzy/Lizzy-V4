/**
 * Formatação e captions do `!apk` — puro, testável sem socket.
 */

/** Converte bytes em texto legível (pt-BR usa vírgula decimal). */
export function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return 'tamanho desconhecido';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = n / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  const rounded = value >= 100 ? value.toFixed(0) : value.toFixed(1);
  return `${rounded.replace('.', ',')} ${units[i]}`;
}

/** Nome do arquivo enviado: `<Nome>-<versão>.apk` (sem espaços/caracteres ruins). */
export function buildApkFileName(name, versionName, fallback = 'app') {
  const base = String(name || fallback)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || fallback;
  const ver = versionName ? `-${String(versionName).replace(/[^\w.-]+/g, '')}` : '';
  return `${base}${ver}.apk`;
}

/**
 * Legenda do documento. Segue o padrão do bot (título em negrito, linhas
 * "rótulo: valor", fonte ao final). NÃO afirma que o APK é "seguro": diz que foi
 * verificado conforme os metadados da fonte.
 */
export function buildApkCaption(record, extra = {}) {
  const sourceLabel = record.sourceLabel || 'fonte';
  const checked = Boolean(record.sha256 || record.md5 || record.signerSha256 || record.signerSha1 || extra.sha256);
  const lines = [
    `📦 *${record.name}*`,
    `📱 Versão: ${record.versionName || 'não informada'}`,
  ];
  if (record.versionCode != null) lines.push(`🔢 Código: ${record.versionCode}`);
  if (record.summary) lines.push(`📝 ${record.summary}`);
  const size = extra.size ?? record.size;
  if (size) lines.push(`📦 Tamanho: ${formatBytes(size)}`);
  const algos = [];
  if (record.sha256 || extra.sha256) algos.push('SHA-256');
  if (record.md5) algos.push('MD5');
  lines.push(`🔐 Integridade: ${checked ? `verificada${algos.length ? ` (${algos.join(' + ')})` : ''}` : 'não disponível na fonte'}`);
  lines.push(`🌐 Fonte: ${sourceLabel}`);
  lines.push('');
  lines.push(`_APK verificado conforme os metadados do ${sourceLabel}._`);
  return lines.join('\n');
}

/** Texto do `/apk` sem argumento. */
export function apkUsage(prefix = '!') {
  return `❌ Informe o nome do aplicativo.\n\n📝 *Uso:* ${prefix}apk <nome>\n\n💡 *Exemplos:*\n${prefix}apk firefox\n${prefix}apk vlc\n${prefix}apk newpipe\n\n_Busca em múltiplas fontes (F-Droid, Aptoide...)._`;
}

export default { formatBytes, buildApkFileName, buildApkCaption, apkUsage };
