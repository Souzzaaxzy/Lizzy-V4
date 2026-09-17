#!/usr/bin/env node
/**
 * ffmpeg FALSO para testes: finge ser um ffmpeg capaz de gerar WebP.
 *
 * Por que existe: o ambiente de teste não tem ffmpeg, e sem ele o fluxo de
 * conversão do `!s` morre ANTES de chegar no `return` — escondendo bugs que só
 * aparecem no caminho de sucesso. Foi assim que um
 * `ReferenceError: outBuffer is not defined` passou batido: o erro real ficava
 * atrás da falha do ffmpeg, capturada pelo catch genérico do comando.
 *
 * Responde às sondagens que o fluent-ffmpeg faz antes de converter:
 *   -formats  -> precisa listar "webp" (senão: "Output format webp is not available")
 *   -version  -> precisa sair com 0
 * e, na conversão de verdade, escreve um WebP válido no arquivo de saída.
 *
 * Uso: FFMPEG_PATH=/caminho/para/este/script ao rodar o teste.
 */
import fs from 'fs';

const args = process.argv.slice(2);

// Sondagem de formatos: o parser do fluent-ffmpeg usa
// /^\s*([D ])([E ])\s+([^ ]+)\s+(.*)$/, com os DOIS marcadores ocupando as
// primeiras colunas. No ffmpeg real a linha é " DE webp   WebP" (D e E
// adjacentes; um espaço quando o marcador não se aplica).
if (args.includes('-formats')) {
  process.stdout.write(
    [
      'File formats:',
      ' DE webp             WebP',
      ' DE image2           image2 sequence',
      ' DE mp4              MP4 (MPEG-4 Part 14)',
      ' DE mp3              MP3 (MPEG audio layer 3)',
    ].join('\n') + '\n'
  );
  process.exit(0);
}

// Sondagem de versão.
if (args.includes('-version')) {
  process.stdout.write('ffmpeg version fake-para-testes\n');
  process.exit(0);
}

// Sondagem de codecs.
if (args.includes('-codecs') || args.includes('-encoders')) {
  process.stdout.write(' V..... libwebp   libwebp WebP\n');
  process.exit(0);
}

// Conversão de verdade: o último argumento é o arquivo de saída.
const saida = args[args.length - 1];
if (!saida) {
  process.stderr.write('sem arquivo de saida\n');
  process.exit(1);
}

// WebP 1x1 real (RIFF/WEBP).
const WEBP_1PX = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64');

try {
  fs.writeFileSync(saida, WEBP_1PX);
  process.exit(0);
} catch (e) {
  process.stderr.write(String(e.message) + '\n');
  process.exit(1);
}