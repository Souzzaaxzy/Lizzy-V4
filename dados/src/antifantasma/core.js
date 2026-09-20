/**
 * AntiFantasma — NÚCLEO PRIVADO.
 *
 * Este arquivo é o CÓDIGO REAL do AntiFantasma. Ele NUNCA é entregue ao
 * cliente, nunca é servido por nenhum endpoint e não é importado pelo adaptador
 * que roda na bot do usuário.
 *
 * Fluxo: o adaptador do cliente manda apenas o CONTEXTO (o que ele observou) e
 * este núcleo decide. A decisão volta como uma AÇÃO ABSTRATA
 * (`close_group` / `ban_user` / `open_group`), nunca como código.
 *
 * O núcleo é puro: não faz I/O, não fala com socket, não lê arquivo. Isso
 * permite testá-lo diretamente e mantém toda a regra num lugar só.
 */

/**
 * Ações que o núcleo pode autorizar. O adaptador do cliente só conhece estes
 * nomes — não sabe quando nem por quê cada um é escolhido.
 */
export const ACTIONS = Object.freeze({
  CLOSE_GROUP: 'close_group',
  BAN_USER: 'ban_user',
  OPEN_GROUP: 'open_group',
});

/**
 * Sinais que o núcleo considera para decidir.
 *
 * O núcleo NÃO confia cegamente no cliente (o usuário tem o próprio adaptador e
 * poderia mandar qualquer coisa), então cada sinal é validado por tipo e
 * normalizado antes de influenciar a decisão. A autoridade final (KEY válida)
 * fica na API, antes de chegar aqui.
 *
 * Os nomes aceitam as duas formas: a que o adaptador observa (`temMensagem`,
 * `pagamento`) e a forma canônica usada aqui.
 */
function normalizeContext(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};

  // Pagamento: o adaptador relata presença e valor crus. A leitura de qual
  // combinação é ataque acontece AQUI, não no cliente.
  const pag = c.pagamento && typeof c.pagamento === 'object' ? c.pagamento : null;
  const valorPagamento = pag?.amount1000 ?? pag?.amountValue ?? null;
  const pagamentoZerado = pag
    ? (valorPagamento === null || String(valorPagamento) === '0')
    : false;

  return {
    // É grupo? Sem isso o AntiFantasma não age.
    isGroup: c.isGroup === true,
    // O bot tem poder de administrador no grupo? Sem isso não dá para agir.
    botIsAdmin: c.botIsAdmin === true,
    // Quem enviou (identificador já normalizado pelo adaptador). String vazia
    // quando desconhecido.
    sender: typeof c.sender === 'string' ? c.sender.trim() : '',
    // O autor é admin/dono/moderador? Nunca punir quem manda no grupo.
    senderIsPrivileged: c.senderIsPrivileged === true,
    // O autor está na whitelist de antis?
    senderIsWhitelisted: c.senderIsWhitelisted === true,
    // O autor já foi punido nesta rajada? Uma punição por autor basta.
    alreadyPunished: c.alreadyPunished === true,
    // Sinais de ataque. O adaptador só reporta o que observou; a leitura de
    // qual conjunto de sinais caracteriza ataque é decisão daqui.
    selectiveDistribution: c.selectiveDistribution === true,
    // Mensagem NÃO decifrável: o adaptador relata `temMensagem: false` (ou a
    // forma canônica `undecryptableGroupMessage`).
    undecryptableGroupMessage: c.undecryptableGroupMessage === true
      || (c.temMensagem === false && c.temStub === true),
    zeroValuePayment: c.zeroValuePayment === true || pagamentoZerado,
    // Mensagem do próprio bot não é ataque.
    fromMe: c.fromMe === true,
  };
}

/**
 * Decide a sequência de ações para o contexto recebido.
 *
 * @param {object} rawContext contexto enviado pelo adaptador
 * @returns {{actions: string[], reason: string}} ações autorizadas (vazio = nada a fazer)
 */
export function decidir(rawContext) {
  const ctx = normalizeContext(rawContext);

  // ── Guardas: qualquer uma delas zera a decisão ──────────────────────────
  if (!ctx.isGroup) return { actions: [], reason: 'nao_e_grupo' };
  if (ctx.fromMe) return { actions: [], reason: 'mensagem_propria' };
  if (!ctx.botIsAdmin) return { actions: [], reason: 'bot_sem_poder' };
  if (!ctx.sender) return { actions: [], reason: 'autor_desconhecido' };

  // Nunca punir administração, dono, moderador ou quem está na whitelist.
  if (ctx.senderIsPrivileged) return { actions: [], reason: 'autor_privilegiado' };
  if (ctx.senderIsWhitelisted) return { actions: [], reason: 'autor_whitelisted' };

  // Uma punição por autor basta: repetir multiplicaria operações de grupo.
  if (ctx.alreadyPunished) return { actions: [], reason: 'ja_punido' };

  // ── Classificação do ataque ──────────────────────────────────────────────
  // Os sinais são exigidos em conjunto de propósito. Um `skmsg` que não decifra
  // sozinho pode ser só "entrei tarde no grupo" (perdi a Sender Key), então a
  // marca de distribuição seletiva precisa vir junto. Isso reduz falso positivo
  // e é a parte que o cliente NÃO conhece.
  const ataqueSeletivo = ctx.selectiveDistribution && ctx.undecryptableGroupMessage;
  const ataquePagamentoZero = ctx.zeroValuePayment;

  if (!ataqueSeletivo && !ataquePagamentoZero) {
    return { actions: [], reason: 'sem_ataque' };
  }

  // A sequência fecha o grupo, remove o autor e reabre. A ordem importa: sem
  // fechar primeiro, o autor poderia tentar agir de novo entre a remoção e a
  // reabertura.
  const reason = ataqueSeletivo ? 'distribuicao_seletiva' : 'pagamento_zerado';
  return {
    actions: [ACTIONS.CLOSE_GROUP, ACTIONS.BAN_USER, ACTIONS.OPEN_GROUP],
    reason,
  };
}

/**
 * Mensagem que o adaptador deve publicar no grupo, quando houver.
 * Separada da decisão para que o texto não fique no cliente.
 *
 * @param {string} reason motivo devolvido por `decidir`
 * @returns {string|null}
 */
export function mensagemDoMotivo(reason) {
  switch (reason) {
    case 'distribuicao_seletiva':
      return '❌ tentou atacar com mensagem fantasma e foi banido';
    case 'pagamento_zerado':
      return '❌ tentou atacar com pagamento zerado e foi banido';
    default:
      return null;
  }
}