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
 * @param {string} texto o que foi falado
 * @param {string|null} quemFalou JID de quem falou (do audio por participante)
 * @param {object} [opts]
 * @param {function} [opts.ehAutorizado] `(jid) => boolean` — a permissão REAL
 *   (admin/dono/subdono/mod). Vem do `index.js`, que tem o metadata do grupo.
 * @returns {{ok: boolean, acao?: string|null, motivo?: string, recusa?: string}}
 */
export function permitePedidoDeAcao(texto, quemFalou, { ehAutorizado } = {}) {
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
  try { autorizado = Boolean(ehAutorizado(quemFalou)); } catch { autorizado = false; }

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
