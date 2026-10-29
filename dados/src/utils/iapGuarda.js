/**
 * A GUARDA do agente de voz — o que a Lizzy pode e não pode fazer na call.
 *
 * ## O pedido do dono
 *
 * *"um membro comum falar 'lizzy, bane alguém' — ela reconhece que não é adm
 * nem dono, nem mod, e não executa nada"*.
 *
 * ## Como isso é possível (o dado que faltava)
 *
 * O motor entrega o áudio da call **mixado** (`voip_call_inbound_audio`), sem
 * dizer quem falou. Sem isso, "quem pediu" é desconhecido e não há como checar
 * permissão. Mas com **`participantAudio: true`** o motor emite
 * `voip_call_participant_audio`, que traz o **`participantJid` de quem falou**.
 * É a base de tudo aqui.
 *
 * ## O desenho: RECUSAR é a parte segura
 *
 * O agente **não executa** comando nenhum. O que ele faz é:
 *  1. reconhecer que a fala é um **pedido de ação** (banir, mutar, promover...);
 *  2. checar a permissão **REAL** de quem falou (admin/dono/subdono/mod);
 *  3. se não pode → **recusa em voz**, sem tocar no grupo.
 *
 * Executar de verdade (ligar a fala ao handler de comandos) é outro passo e
 * mais arriscado — o dono pediu a **recusa consciente**, e é isso que está aqui.
 *
 * Módulo **puro**: recebe a função de permissão por parâmetro, então é testável
 * sem socket, sem call e sem LLM.
 */

import fs from 'fs';
import path from 'path';

/**
 * O nome do agente, limpo para FALA.
 *
 * O `nomebot` do config é `𝐋𝐢𝐳𝐳𝐲 𝐝𝐨 𝐩𝐫𝐢𝐯𝐲` (MATHEMATICAL BOLD). Isso é ruim para
 * voz: o LLM pode repetir os glifos e o TTS lê errado. Aqui o nome é
 * normalizado (NFKC desfaz o estilo) e reduzido a **Lizzy**.
 *
 * @param {string} [nomeBot] o nome cru do config
 * @returns {string} o nome falável (ex.: "Lizzy")
 */
export function limparNomeDoBot(nomeBot) {
  let bruto = String(nomeBot || '').trim();
  if (!bruto) return 'Lizzy';
  try { bruto = bruto.normalize('NFKC'); } catch { /* segue sem normalizar */ }
  // Tira marcas combinantes e mantém letras/números/espaço.
  try { bruto = bruto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').normalize('NFC'); } catch { /* ok */ }
  // "Lizzy do privy" -> "Lizzy" (a primeira palavra é o nome).
  const primeira = bruto.split(/\s+/)[0] || 'Lizzy';
  const limpo = primeira.replace(/[^A-Za-z0-9]/g, '');
  return limpo || 'Lizzy';
}

/**
 * A PERSONALIDADE da Lizzy — fonte ÚNICA dos dois canais (chat e voz).
 *
 * ## Uma só, para todos os grupos
 *
 * Antes o `!assistente` oferecia quatro personalidades (`abyss`/`humana`/`ia`/
 * `pro`) e o chat escolhia uma por grupo, enquanto o `!iap` tinha um prompt
 * fixo próprio. Eram **dois jeitos** da mesma bot falar. O dono pediu uma
 * **Lizzy só**: mesma pessoa no chat e na call, sem opção de trocar.
 *
 * ## O que é comum e o que é do CANAL
 *
 * Este prompt é o **caráter** (quem ela é, como trata as pessoas, o que não
 * faz). As regras de **formato** não cabem aqui: na call tudo vira VOZ ALTA
 * (frases curtas, sem emoji), no chat é texto no WhatsApp (emoji e negrito à
 * vontade). Por isso o formato fica em `regrasDeCanal(canal)` — assim a
 * personalidade é uma só e cada canal continua soando certo.
 *
 * @param {object} [ctx]
 * @param {string} [ctx.nome] o nome dela (padrão: o do config, limpo)
 * @param {string} [ctx.nomeDono]
 * @param {string} [ctx.nomeGrupo]
 * @returns {string}
 */
export function promptDaLizzy({ nome, nomeDono, nomeGrupo } = {}) {
  const eu = nome || iaIdentidade();

  const linhas = [
    `Voce e' ${eu}, uma pessoa real conversando pelo WhatsApp.`,
    'Voce nao e um robo nem um assistente generico: tem jeito proprio, opiniao e memoria da conversa.',
    '',
    'SEU JEITO:',
    '- Portugues do Brasil, natural e descontraido, como uma amiga no grupo.',
    '- Simpatica e direta. Fala o que pensa, mas sem grosseria.',
    '- Tem humor leve quando cabe; nao forca piada.',
    '- Curiosa: puxa assunto quando faz sentido, mas nao fica repetindo.',
    '',
    'COMO TRATAR AS PESSOAS:',
    '- Chame as pessoas pelo nome quando souber.',
    '- Ninguem precisa pedir permissao para falar com voce.',
    '- Se te perguntarem quem voce e, apresente-se pelo seu nome.',
    '',
    'O QUE VOCE NAO FAZ:',
    '- Nao inventa fato, numero, data ou link. Se nao sabe, diz que nao sabe.',
    '- Nao finge ter feito algo que nao fez.',
    '- Nao fala em nome do dono nem promete coisa que nao pode cumprir.'
  ];

  if (nomeDono) {
    linhas.push('', `O DONO do bot se chama ${nomeDono}. Trate-o com respeito.`);
  }
  if (nomeGrupo) {
    linhas.push(`Voce esta no grupo "${nomeGrupo}".`);
  }

  return linhas.join('\n');
}

/**
 * As regras de FORMATO de um canal — o que muda entre chat e voz.
 *
 * A personalidade e' a mesma; o que muda e' como o texto e' consumido. Sem esta
 * separacao, ou a voz leria markdown em voz alta, ou o chat responderia sem
 * emoji e em frases telegraficas.
 *
 * @param {'chat'|'voz'} canal
 * @returns {string}
 */
export function regrasDeCanal(canal) {
  if (canal === 'voz') {
    return [
      'COMO FALAR (isto e VOZ ALTA, nao texto):',
      '- Frases CURTAS: 1 a 2, no maximo 3. Nada de paragrafo.',
      '- NUNCA use emojis, asteriscos, markdown, listas ou numeracao.',
      '- Escreva numeros e siglas por extenso quando soarem melhor ("dez reais").',
      '- NAO repita a pergunta antes de responder. Va direto ao ponto.',
      '- Se a pergunta for simples, responda curto; se pedirem detalhe, ai desenvolva.',
      '- Se o audio vier cortado, diga que nao entendeu e peca para repetir.'
    ].join('\n');
  }
  return [
    'COMO ESCREVER (isto e TEXTO no WhatsApp):',
    '- Pode usar emoji e *negrito* com naturalidade, sem exagerar.',
    '- Respostas curtas por padrao; desenvolva quando pedirem.',
    '- Nada de listas numeradas nem cabecalhos de documento: e uma conversa.',
    '- Escreva como se estivesse digitando no celular, nao como um relatorio.'
  ].join('\n');
}

/** O nome do agente, lido do config (com queda para "Lizzy"). */
export function iaIdentidade() {
  try {
    // Leitura preguiçosa: o módulo fica puro e não depende do config no import.
    const arquivo = process.env.CONFIG_PATH
      || path.join(process.cwd(), 'dados', 'src', 'config.json');
    const cfg = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
    return limparNomeDoBot(cfg?.nomebot);
  } catch {
    return 'Lizzy';
  }
}

/**
 * Palavras que caracterizam um **pedido de AÇÃO** no grupo (não conversa).
 *
 * Agrupadas por tipo para o log dizer o que foi pedido. A comparação é por
 * radical, sem acento e em minúsculas (o STT erra acento).
 */
export const ACOES = Object.freeze({
  banir: ['bane', 'banir', 'bani', 'expulsa', 'expulsar', 'remove', 'remover', 'kick', 'chuta', 'chutar', 'tira', 'tirar'],
  mutar: ['muta', 'mutar', 'silencio', 'silencia', 'calar', 'cala'],
  promover: ['promove', 'promover', 'sobe', 'subir', 'adm', 'admin', 'da adm', 'da admin'],
  rebaixar: ['rebaixa', 'rebaixar', 'desce', 'descer', 'tira adm', 'tira admin'],
  trancar: ['tranca', 'trancar', 'fecha o grupo', 'fechar o grupo', 'abre o grupo', 'abrir o grupo'],
  limpar: ['limpa', 'limpar', 'apaga tudo', 'apagar tudo'],
  configurar: ['ativa o', 'desativa o', 'liga o', 'desliga o', 'configura']
});

/**
 * A fala é um pedido de ação? Devolve o TIPO (`'banir'`, `'mutar'`, ...) ou null.
 *
 * @param {string} texto
 * @returns {string|null}
 */
export function ehPedidoDeAcao(texto) {
  const t = String(texto || '').toLowerCase();
  if (!t.trim()) return null;
  // Sem acento, para casar "bani"/"baní" etc.
  let limpo = t;
  try { limpo = t.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch { /* ok */ }

  for (const [tipo, radicais] of Object.entries(ACOES)) {
    for (const r of radicais) {
      // Fronteira de palavra: evita casar "banimento" dentro de outra palavra
      // sem intenção... mas aceita o radical seguido de sufixo (banir/baniu).
      const re = new RegExp(`(^|\\s)${r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
      if (re.test(limpo)) return tipo;
    }
  }
  return null;
}

/** Frases de recusa por motivo (o que a Lizzy fala). */
export const RECUSAS = Object.freeze({
  sem_participante:
    'Eu nao sei quem falou isso, entao nao posso fazer nada. Fale de novo com o microfone ligado.',
  sem_permissao:
    'Calma la! Voce nao e administrador nem dono deste grupo, entao nao posso fazer isso.',
  sem_permissao_banir:
    'Nao posso banir ninguem a seu pedido — voce nao e administrador nem dono do grupo.',
  sem_permissao_mutar:
    'Nao posso mutar ninguem a seu pedido — voce nao e administrador nem dono do grupo.',
  sem_permissao_promover:
    'So um administrador ou o dono pode promover alguem. Voce nao pode.',
  sem_permissao_rebaixar:
    'So um administrador ou o dono pode rebaixar alguem. Voce nao pode.',
  sem_permissao_trancar:
    'So um administrador ou o dono pode abrir ou fechar o grupo. Voce nao pode.',
  sem_permissao_limpar:
    'So um administrador ou o dono pode limpar o grupo. Voce nao pode.',
  sem_permissao_configurar:
    'So um administrador ou o dono pode mudar as configuracoes do grupo. Voce nao pode.',
  sem_permissao_geral:
    'Voce nao tem permissao para isso neste grupo.'
});

/**
 * Decide se o pedido pode ser atendido.
 *
 * `ehAutorizado` pode ser sincrona OU assincrona (a permissao real consulta o
 * metadata do grupo) — por isso esta funcao devolve uma Promise.
 *
 * @param {string} texto o que foi falado
 * @param {string|null} quemFalou JID de quem falou (do audio por participante)
 * @param {object} [opts]
 * @param {function} [opts.ehAutorizado] `(jid) => boolean|Promise<boolean>` — a
 *   permissão REAL (admin/dono/subdono/mod). Vem do `index.js`, que tem o
 *   metadata do grupo.
 * @returns {Promise<{ok: boolean, acao?: string|null, motivo?: string, recusa?: string}>}
 */
export async function permitePedidoDeAcao(texto, quemFalou, { ehAutorizado } = {}) {
  const acao = ehPedidoDeAcao(texto);

  // Não é pedido de ação: conversa normal, o LLM responde.
  if (!acao) return { ok: true, acao: null };

  // É pedido de ação mas não sabemos quem falou: não dá para checar permissão.
  // Recusa — melhor não fazer nada do que obedecer um desconhecido.
  if (!quemFalou) {
    return {
      ok: false,
      acao,
      motivo: 'sem_participante',
      recusa: RECUSAS.sem_participante
    };
  }

  // Sem a função de permissão, não dá para afirmar que pode: recusa (fecha).
  if (typeof ehAutorizado !== 'function') {
    return {
      ok: false,
      acao,
      motivo: 'sem_verificacao',
      recusa: RECUSAS.sem_permissao_geral
    };
  }

  let autorizado = false;
  try { autorizado = Boolean(await ehAutorizado(quemFalou)); } catch { autorizado = false; }

  if (!autorizado) {
    return {
      ok: false,
      acao,
      motivo: 'sem_permissao',
      recusa: RECUSAS[`sem_permissao_${acao}`] || RECUSAS.sem_permissao
    };
  }

  // PODE. O agente não executa sozinho (decisão de escopo): responde que vai
  // tratar. A execução real passa pelos comandos do bot.
  return { ok: true, acao, autorizado: true };
}
