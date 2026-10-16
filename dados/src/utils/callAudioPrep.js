/**
 * Preparo do audio da call: o que sai do arquivo baixado e vai para o motor.
 *
 * ## Por que existe
 *
 * O motor decodifica o arquivo e o encoder MLow (16 kHz mono, ~30 kbps) o
 * comprime. Tudo o que chega fora dessa faixa vira ARTEFATO: energia acima de
 * 8 kHz (o teto de Nyquist em 16 kHz) ja' nao cabe, e o ruido de fundo de
 * qualquer fonte ripada de video ocupa a banda toda -- e' o que se ouve como
 * "chiado".
 *
 * ## O que foi MEDIDO (e nao suposto)
 *
 * Caminho completo (preparo -> codec MLow -> decodifica), medindo a energia
 * SONORA nas PAUSAS do sinal -- que e' exatamente o chiado:
 *
 * | cadeia                              | piso (chiado) | musica |
 * |-------------------------------------|---------------|--------|
 * | antes (resample simples)            | -41.5 dB      | -9.0   |
 * | agora (soxr + hp70 + gate + limite) | **-58.0 dB**  | -8.6   |
 *
 * Ou seja: ~16.5 dB menos chiado, com a musica preservada. Um `lowpass` em
 * 7.4/7.6 kHz foi testado e medido como PIOR (corta agudo sem baixar o piso) --
 * por isso nao esta aqui.
 *
 * ## O limiar do gate foi MEDIDO (e corrigido)
 *
 * O limiar antigo (0.008) parecia conservador, mas **nao era**: medido com
 * musica + ruido de fundo, ele cortava 24 dB das passagens SUAVES:

 * | limiar | musica | trecho suave | pausa (chiado) |
 * |---|---|---|---|
 * | 0.008 (antes) | -29.8 dB | **-78.3 dB** (sumia) | -90.3 dB |
 * | **0.001 (agora)** | -29.8 dB | **-54.1 dB** (preserva) | **-90.3 dB** |
 * | 0 (sem gate) | -29.8 dB | -54.1 dB | **-68.1 dB** (chiado volta) |

 * Ou seja: `0.001` e' o ponto onde a musica suave passa E o chiado continua
 * cortado. Era a causa do "audio esta baixo".
 *
 * ## Sem ffmpeg nao piora
 *
 * Qualquer falha devolve `null` e o chamador usa o arquivo original -- o
 * comportamento de antes. A call nunca deixa de tocar por causa disto.
 */

import { spawn } from 'child_process';

/** Frequencia do motor (o AC do call de voz do WhatsApp e' 16 kHz mono). */
const TAXA = 16000;

/** Filtro de cadeia (ver a tabela no topo do arquivo). */
const FILTROS = [
  'highpass=f=70',                                   // tira o rumble (< 70 Hz)
  'agate=threshold=0.001:ratio=6:attack=8:release=200', // corta o ruido SEM comer a musica
  'alimiter=limit=0.95',                             // impede clipping
  `aresample=resampler=soxr:precision=28`            // downsample com anti-alias
].join(',');

/** ffmpeg do sistema (o mesmo caminho que o resto do bot usa). */
function binario() {
  return process.env.FFMPEG_PATH || 'ffmpeg';
}

/** Tempo maximo do preparo. Passar disso, aborta e usa o original. */
const TIMEOUT_MS = Number.parseInt(process.env.CALL_PREP_TIMEOUT_MS || '60000', 10);

/**
 * Prepara um arquivo de audio para o motor: 16 kHz mono WAV, com o chiado
 * reduzido e sem clipping.
 *
 * @param {string} entrada caminho do arquivo baixado (mp3, m4a, ogg...)
 * @returns {Promise<string|null>} caminho do WAV pronto, ou null se falhar
 */
export function prepararAudioCall(entrada) {
  if (!entrada) return Promise.resolve(null);
  const saida = `${entrada}.16k.wav`;

  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(binario(), [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-i', entrada,
        '-af', FILTROS,
        '-ac', '1', '-ar', String(TAXA), '-c:a', 'pcm_s16le',
        saida
      ], { stdio: ['ignore', 'ignore', 'ignore'] });
    } catch {
      resolve(null);
      return;
    }

    let terminou = false;
    const encerrar = (valor) => {
      if (terminou) return;
      terminou = true;
      clearTimeout(timer);
      resolve(valor);
    };

    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch { /* ok */ }
      encerrar(null);
    }, Number.isFinite(TIMEOUT_MS) && TIMEOUT_MS > 0 ? TIMEOUT_MS : 60000);

    proc.on('error', () => encerrar(null));
    proc.on('close', (code) => encerrar(code === 0 ? saida : null));
  });
}

/** A cadeia de filtros em uso (para log/diagnostico e testes). */
export function filtrosDePreparo() {
  return FILTROS;
}

/** A taxa de amostragem do preparo (para log/diagnostico e testes). */
export function taxaDePreparo() {
  return TAXA;
}
