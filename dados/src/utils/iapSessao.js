/**
 * Ligação do agente de voz (`!iap`) com as peças reais do bot.
 *
 * O `iapVoice.js` tem o MOTOR do agente (VAD, barge-in, fila) e não conhece
 * ninguém: recebe `falar`/`pensar`/`transcrever`/`sintetizar`. Este módulo faz a
 * única coisa que falta — injetar as dependências REAIS:
 *
 *   transcrever -> iapStt  (Groq Whisper, a chave do `!keygroq`)
 *   pensar      -> groqClient (Groq) + a GUARDA de permissão
 *   sintetizar  -> iapTts (edge-tts; Gemini TTS como reserva)
 *   falar       -> callMedia.falarNaCallDoGrupo (o motor, `feedLiveAudio`)
 *
 * Fica separado do `index.js` para o fluxo poder ser testado sem importar o
 * arquivo de 36k linhas (que abre conexão de verdade no import).
 */

import { groqChat } from './groqClient.js';
import { transcreverPcm, chaveGroq } from './iapStt.js';
import { sintetizarFala, garantirVoz } from './iapTts.js';
import { iap } from './iapVoice.js';
import { iaIdentidade, ehPedidoDeAcao, permitePedidoDeAcao } from './iapGuarda.js';
import { identificarComando, frasesDeAjuda, ehComandoPermitido } from './iapComandos.js';
import {
  aoOuvirAudioDaCall as aoOuvirAudioDaCallReal,
  modoAudioExternoDaCall as modoAudioExternoDaCallReal,
  falarNaCallDoGrupo as falarNaCallDoGrupoReal
} from '../funcs/utils/callMedia.js';

/**
 * Seam do motor de mídia (testes).
 *
 * O dublê do `callMedia` NÃO implementa o áudio do `!iap` (as funções de
 * entrada/saída devolvem `false`), então sem este seam o caminho do `ligarIap`
 * não seria exercitável. Com ele o teste roda o fluxo REAL (`ligarIap` →
 * `iap.ligar` → `pensar`) e mede o que importa: o `ehAutorizado` chega ao agente.
 */
let _media = {
  aoOuvirAudioDaCall: aoOuvirAudioDaCallReal,
  modoAudioExternoDaCall: modoAudioExternoDaCallReal,
  falarNaCallDoGrupo: falarNaCallDoGrupoReal
};
export function setIapMediaForTest(m) {
  _media = m || {
    aoOuvirAudioDaCall: aoOuvirAudioDaCallReal,
    modoAudioExternoDaCall: modoAudioExternoDaCallReal,
    falarNaCallDoGrupo: falarNaCallDoGrupoReal
  };
}

/** Comandos por voz que funcionam SEM argumento. */
const COMANDO_SEM_ARGS = ['figualeatoria'];

/** Log do agente, com o prefixo do sistema de call (filtrável). */
function logIap(msg, extra) {
  const detalhe = extra ? ` | ${JSON.stringify(extra)}` : '';
  console.log(`🎙️ [IAP] ${msg}${detalhe}`);
}

/**
 * O prompt de sistema do agente — **um só, padrão**.
 *
 * ## Decisão do dono: sem personalidade
 *
 * Antes o `!iap` usava a personalidade do grupo (`abyss`/`humana`/`ia`/`pro`).
 * O dono pediu **padrão em tudo**: uma Lizzy só, mesma voz, mesmo jeito. Então
 * aqui há **um** prompt fixo — não há mais dependência do `assistantPersonality`.
 *
 * ## O nome é LIZZY (limpo)
 *
 * O `nomebot` do config é `𝐋𝐢𝐳𝐳𝐲 𝐝𝐨 𝐩𝐫𝐢𝐯𝐲` (MATHEMATICAL BOLD). Isso é um
 * **pesadelo** para voz: o LLM pode repetir os glifos e o TTS lê errado. O nome
 * é normalizado (NFKC) e reduzido a **Lizzy** — é assim que ela se apresenta.
 *
 * @param {object} opts
 * @param {string} [opts.nomeDono]
 * @param {string[]} [opts.participantes]
 * @param {string} [opts.falante] NOME de quem esta' falando agora (resolvido do
 *   JID do audio por participante). E' o que faz a Lizzy chamar a pessoa pelo
 *   nome em vez de tratar todo mundo igual.
 * @param {boolean} [opts.falanteEhDono] o falante e' o dono do bot?
 * @returns {string}
 */
export function montarSistemaDoAgente({ nomeDono, participantes = [], falante, falanteEhDono = false } = {}) {
  const nome = iaIdentidade(); // "Lizzy"

  // A data/hora REAL: sem ela o modelo chuta ("hoje e' ..."). E' o tipo de
  // pergunta que aparece numa call ("que horas sao?").
  let agora = '';
  try {
    agora = new Date().toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short'
    });
  } catch { /* segue sem a data */ }

  const linhas = [
    `Voce e' ${nome}, e esta numa CHAMADA DE VOZ de um grupo do WhatsApp.`,
    'Tudo o que voce diz e lido em VOZ ALTA por um sintetizador.',
    '',
    `Seu nome e' ${nome}. Se perguntarem, responda: "Oi! Eu sou a ${nome}."`,
    `Se alguem chamar "${nome}", e' com voce.`,
    '',
    'COMO FALAR (importante — e voz, nao texto):',
    '- Portugues do Brasil, natural e descontraido, como numa conversa de amigos.',
    '- Frases CURTAS: 1 a 2, no maximo 3. Nada de paragrafo.',
    '- NUNCA use emojis, asteriscos, markdown, listas ou numeracao.',
    '- Escreva numeros e siglas por extenso quando soarem melhor ("dez reais", "vinte e tres").',
    '- NAO repita a pergunta antes de responder. Va direto ao ponto.',
    '- Se a pergunta for simples, responda curto; se pedirem detalhe, ai sim desenvolva.',
    '- Se nao souber algo, diga que nao sabe — nunca invente.',
    '- Se o audio vier cortado/inaudivel, diga que nao entendeu e peca para repetir.'
  ];

  if (agora) linhas.push('', `Agora e' ${agora} (horario de Brasilia).`);

  if (nomeDono) {
    linhas.push('', `O DONO do bot se chama ${nomeDono}. Trate-o com respeito e deferencia.`);
  }
  if (Array.isArray(participantes) && participantes.length) {
    const nomes = participantes.filter(Boolean).slice(0, 20).join(', ');
    if (nomes) linhas.push(`Quem esta na chamada agora: ${nomes}.`);
  }

  // O QUE A LIZZY CONSEGUE EXECUTAR: o dono pede por fala e ela roda o comando
  // do bot. A lista e' a FONTE UNICA (`iapComandos.js`) — se um comando novo
  // entrar la', ele aparece aqui sozinho.
  linhas.push(
    '',
    'VOCE TAMBEM EXECUTA COMANDOS do bot quando alguem pede por fala, por exemplo:',
    frasesDeAjuda(),
    'QUALQUER pessoa na chamada pode pedir esses comandos — nao exija ser o dono.',
    'Quando o pedido casar um desses, diga que ja vai fazer — a execucao acontece sozinha.'
  );

  // QUEM ESTA' FALANDO AGORA. O motor entrega o audio POR PARTICIPANTE, entao
  // sabemos o JID de quem falou; o nome vem do resolvedor de contatos. Com isso
  // a Lizzy chama a pessoa pelo nome ("Fala, Kannon!") em vez de tratar todo
  // mundo igual — e sabe diferenciar o dono.
  if (falante) {
    linhas.push('', `Quem esta falando com voce AGORA e' ${falante}.`);
    if (falanteEhDono) {
      linhas.push(`ATENCAO: ${falante} e' o DONO do bot — trate com deferencia.`);
    }
    linhas.push(`Dirija-se a ele(a) pelo nome (${falante}) quando fizer sentido, sem exagerar.`);
  } else {
    linhas.push('', 'Voce nao sabe quem falou esta frase — se precisar de um nome, pergunte.');
  }

  return linhas.join('\n');
}

/**
 * O LLM do agente: texto -> resposta, COM a guarda de permissão.
 *
 * ## A guarda (o que o dono pediu)
 *
 * "um membro comum falar 'lizzy, bane alguém' — ela reconhece que não é adm nem
 * dono, nem mod e não executa nada".
 *
 * O motor entrega o áudio **por participante** (`participantAudio`), então
 * sabemos **quem falou** (`quemFalou`). Antes de responder, `permitePedidoDeAcao`
 * checa a permissão REAL daquela pessoa (admin do grupo, dono, subdono,
 * moderador). Se o pedido é de AÇÃO e a pessoa não pode, a resposta é uma
 * recusa — o LLM nem é chamado para "decidir" executar.
 *
 * A função de permissão vem por `opts.ehAutorizado` — sem ela a guarda FECHA
 * (recusa), então o caminho nunca fica permissivo por omissão.
 *
 * @param {string} texto
 * @param {Array<{role:string, content:string}>} historico
 * @param {object} [opts]
 * @param {string} [opts.quemFalou] JID de quem falou
 * @param {function} [opts.ehAutorizado] `(jid) => boolean|Promise<boolean>`
 * @param {string} [opts.nomeDono]
 * @param {string[]} [opts.participantes]
 * @param {function} [opts.nomeDeQuemFalou] `(jid) => Promise<string|null>` —
 *   resolve o JID em NOME (agenda > notify > verifiedName). Vem do `index.js`,
 *   que tem o `nazu` e o metadata do grupo.
 * @param {function} [opts.ehDono] `(jid) => boolean` — o falante e' o DONO do
 *   bot? A checagem e' por **JID/numero** (a MESMA do resto do bot), nao por
 *   nome: se o dono trocar o nome do perfil, ele continua sendo reconhecido.
 * @param {function} [opts.executarComando] `(comando, args, quemFalou) =>
 *   Promise<boolean>` — dispara o comando do bot (o `index.js` reemite a
 *   mensagem como se QUEM FALOU tivesse digitado, para as permissoes dele
 *   valerem). Sem ela, o pedido de comando NAO executa.
 * @returns {Promise<string>}
 */
export async function pensarComIa(texto, historico = [], {
  quemFalou, ehAutorizado, nomeDono, participantes = [], nomeDeQuemFalou, ehDono, executarComando
} = {}) {
  // ---- COMANDO POR VOZ (qualquer um na call) -----------------------------
  // O pedido falado ("toca Evidencias") e' reconhecido por PADROES e executado.
  // QUALQUER pessoa na call pode pedir (decisao do dono) — os 4 comandos da
  // allowlist nao exigem admin, entao nao ha' risco. A mensagem e' reemitida
  // como se QUEM FALOU tivesse digitado, entao as permissoes do bot valem para
  // ele normalmente.
  const pedido = identificarComando(texto);
  if (pedido && typeof executarComando === 'function') {
    if (!ehComandoPermitido(pedido.comando)) {
      return 'Esse comando nao esta liberado por voz.';
    }
    // Falta o argumento (ex.: "baixa um video do tiktok" sem dizer qual): em vez
    // de executar as cegas, pergunta — e o dono responde na call.
    if (!pedido.args && !COMANDO_SEM_ARGS.includes(pedido.comando)) {
      logIap('comando por voz sem argumento', { pedido: pedido.comando });
      return `Claro! O que voce quer que eu procure? Fala o nome que eu executo o ${pedido.comando}.`;
    }
    try {
      const ok = await executarComando(pedido.comando, pedido.args, quemFalou);
      logIap(ok ? 'comando por voz executado' : 'comando por voz NAO executou', {
        comando: pedido.comando, args: pedido.args || undefined
      });
      return ok
        ? `Prontinho, ja executei o ${pedido.comando}.`
        : 'Nao consegui executar agora. Tenta de novo?';
    } catch (e) {
      logIap('falha ao executar comando por voz', { erro: e?.message || String(e) });
      return 'Nao consegui executar agora. Tenta de novo?';
    }
  }

  // ---- GUARDA: o pedido é de AÇÃO? a pessoa PODE? ------------------------
  const guarda = await permitePedidoDeAcao(texto, quemFalou, { ehAutorizado });
  if (!guarda.ok) {
    logIap('pedido de acao RECUSADO (sem permissao)', {
      quem: quemFalou || 'desconhecido',
      pedido: guarda.acao || undefined,
      motivo: guarda.motivo
    });
    return guarda.recusa;
  }

  // O NOME de quem falou: resolve o JID do audio por participante. Best-effort
  // — se nao resolver, o prompt segue sem nome (e a Lizzy pergunta, em vez de
  // inventar).
  let falante = null;
  if (quemFalou && typeof nomeDeQuemFalou === 'function') {
    try {
      const n = await nomeDeQuemFalou(quemFalou);
      const limpo = n ? String(n).trim() : '';
      // Guarda: um JID/LID cru NAO e' nome. Se o resolvedor cair nisso (nao
      // devia), e' melhor o prompt nao ter nome do que a Lizzy chamar a pessoa
      // de "@23734744260711".
      if (limpo && !limpo.includes('@')) falante = limpo;
    } catch { /* segue sem nome */ }
  }
  // O DONO e' identificado por JID/NUMERO (a checagem real do bot, injetada
  // pelo `index.js`). O nome e' apenas a ULTIMA reserva: se o dono trocar o nome
  // do perfil, a comparacao por nome falharia e ele deixaria de ser reconhecido.
  let falanteEhDono = false;
  if (quemFalou) {
    if (typeof ehDono === 'function') {
      try { falanteEhDono = Boolean(await ehDono(quemFalou)); } catch { falanteEhDono = false; }
    }
    if (!falanteEhDono && nomeDono && falante) {
      falanteEhDono = falante.toLowerCase() === String(nomeDono).toLowerCase();
    }
  }

  const sistema = montarSistemaDoAgente({ nomeDono, participantes, falante, falanteEhDono });
  const r = await groqChat({
    texto,
    sistema,
    historico: historico.map((h) => ({ role: h.role, content: h.content }))
  });
  if (!r.ok) {
    logIap(`LLM falhou: ${r.motivo}`, {
      detalhe: r.detalhe ? String(r.detalhe).slice(0, 200) : undefined
    });
    return '';
  }
  return r.texto || '';
}

/**
 * Liga o agente de voz no grupo.
 *
 * @param {string} grupo
 * @param {object} [opts]
 * @param {string} [opts.nomeDono]
 * @param {string[]} [opts.participantes]
 * @param {function} [opts.ehAutorizado] `(jid) => boolean` — a permissão REAL
 *   da pessoa (admin/dono/subdono/mod). Vem do `index.js`, que tem o metadata.
 * @param {function} [opts.nomeDeQuemFalou] `(jid) => Promise<string|null>` —
 *   resolve o JID do falante no NOME do contato (o `index.js` injeta o
 *   `resolverNomeContato`). E' o que faz a Lizzy chamar a pessoa pelo nome.
 * @param {function} [opts.ehDono] `(jid) => boolean` — o falante e' o DONO?
 *   Checagem por JID/numero (a mesma do resto do bot).
 * @param {function} [opts.executarComando] `(comando, args, quemFalou) =>
 *   Promise<boolean>` — executa o comando do bot em nome de QUEM FALOU.
 * @returns {Promise<{ ok: boolean, motivo?: string }>}
 */
export async function ligarIap(grupo, { nomeDono, participantes, ehAutorizado, nomeDeQuemFalou, ehDono, executarComando } = {}) {
  // O `!iap` inteiro roda no Groq (ouvir E pensar): sem a chave dele nao ha' o
  // que ligar.
  if (!chaveGroq()) return { ok: false, motivo: 'sem_chave_groq' };

  // A VOZ vem do `msedge-tts` (Node puro — sem python/pip/ffmpeg). Confere
  // ANTES de ligar: sem isso o dono so' descobriria no primeiro "sem audio".
  const voz = await garantirVoz();
  if (!voz.ok) {
    logIap(`voz indisponivel (${voz.motivo})`, { fonte: voz.fonte });
    return { ok: false, motivo: `voz_${voz.motivo || 'indisponivel'}` };
  }
  logIap(`voz pronta (${voz.fonte})`);

  // O modo de audio externo precisa estar ligado, senao o motor ignora o que
  // chega por `feedLiveAudio` e volta a tocar o arquivo pre-carregado.
  const ligouExterno = await _media.modoAudioExternoDaCall(grupo, true);
  if (!ligouExterno) return { ok: false, motivo: 'sem_call' };

  // O agente OUVE pelo callback do motor. O terceiro argumento e' QUEM FALOU
  // (audio por participante) — e' o que permite a guarda de permissao.
  const registrou = await _media.aoOuvirAudioDaCall(grupo, (g, pcm, quemFalou) => iap.receber(g, pcm, quemFalou));
  if (!registrou) {
    await _media.modoAudioExternoDaCall(grupo, false);
    return { ok: false, motivo: 'sem_call' };
  }

  iap.ligar(grupo, {
    log: logIap,
    pensar: (texto, historico, opts = {}) => pensarComIa(texto, historico, {
      quemFalou: opts.quemFalou, ehAutorizado, nomeDono, participantes, nomeDeQuemFalou, ehDono, executarComando
    }),
    transcrever: async (pcm) => {
      // VIES de vocabulario: os NOMES de quem esta' na call + as palavras dos
      // comandos. O Whisper usa isso como contexto e acerta mais o que importa
      // (nome das pessoas e o comando pedido) sem trocar de modelo.
      const vies = [
        nomeDono ? `O dono se chama ${nomeDono}.` : '',
        Array.isArray(participantes) && participantes.length
          ? `Nomes na chamada: ${participantes.filter(Boolean).slice(0, 15).join(', ')}.`
          : ''
      ].filter(Boolean).join(' ');
      const r = await transcreverPcm(pcm, { apiKey: chaveGroq(), prompt: vies || undefined });
      if (!r.ok) {
        logIap(`STT falhou: ${r.motivo}`, {
          grupo,
          detalhe: r.detalhe ? String(r.detalhe).slice(0, 200) : undefined,
          modelo: r.modelo
        });
        return null;
      }
      return r.texto;
    },
    sintetizar: async (texto) => {
      // TTS e' SO' edge-tts (local, sem chave e sem cota). O Gemini saiu.
      const r = await sintetizarFala(texto);
      if (!r.ok) {
        logIap(`TTS falhou: ${r.motivo}`, { grupo });
        return null;
      }
      logIap(`TTS ok (${r.fonte})`, {
        grupo,
        segundos: r.pcm ? +(r.pcm.length / 16000).toFixed(1) : 0
      });
      return r.pcm;
    },
    // O TTS em FLUXO foi DESLIGADO (out/2026): a entrega por blocos fazia a fala
    // sair acelerada e CORTAR o comeco (a fila descarta os frames mais antigos
    // quando estoura). O caminho de BATCH — esperar o audio e entregar frame a
    // frame no ritmo do motor — e' o que funcionava. Sem `sintetizarStream`, o
    // agente usa o `sintetizar` acima automaticamente.
    falar: (pcm) => { void _media.falarNaCallDoGrupo(grupo, pcm); }
  });

  logIap('ligado', { grupo });
  return { ok: true };
}

/**
 * Desliga o agente de voz do grupo e limpa o que ele registrou.
 *
 * @param {string} grupo
 * @returns {Promise<boolean>} `true` se havia um agente ligado
 */
export async function desligarIap(grupo) {
  const havia = iap.desligar(grupo);
  try { await _media.aoOuvirAudioDaCall(grupo, null); } catch { /* ok */ }
  try { await _media.modoAudioExternoDaCall(grupo, false); } catch { /* ok */ }
  if (havia) logIap('desligado', { grupo });
  return havia;
}

/** Estado do agente no grupo (para o comando mostrar). */
export async function estadoIap(grupo) {
  const st = iap.estado(grupo);
  if (!st) return st;
  // O status mostra as TRES pecas do agente: ouvir e pensar (Groq) e falar
  // (msedge-tts / edge-tts). A voz e' assincrona, por isso o await.
  let voz = 'nenhuma';
  try {
    const { garantirVoz } = await import('./iapTts.js');
    const v = await garantirVoz();
    voz = v.ok ? v.fonte : 'nenhuma';
  } catch { voz = 'nenhuma'; }
  return {
    ...st,
    nome: iaIdentidade(),
    stt: chaveGroq() ? 'groq' : 'nenhum',
    voz
  };
}

/** Desliga todos os agentes (a call caiu: o `index.js` chama isto). */
export function desligarTodosIap() {
  iap.desligarTudo();
}
