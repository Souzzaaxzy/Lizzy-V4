import { loadRelationships, saveRelationships } from '../../utils/database.js';
import { getUserName, normalizar, loadJsonFile } from '../../utils/helpers.js';
import { CONFIG_FILE } from '../../utils/paths.js';
import { bold } from '../../menus/layout.js';

const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
const MARRIAGE_REQUIRED_MS = 48 * 60 * 60 * 1000;

/**
 * Caixas do layout `꧁༺ ✦ ༻꧂` usadas pelas mensagens de relacionamento.
 *
 * O desenho é o mesmo dos menus: título e rótulos em MATHEMATICAL BOLD
 * (`bold()`), cabeçalho com o emoji do tipo e rodapé com o nome do bot.
 */
const TOPO_REL = (emoji, titulo) => `╭━━━꧁༺ ${emoji} ${bold(titulo)} ༻꧂━━━╮`;
const FECHO_REL = (botName) => `╰━━━꧁༺ ✦ ${botName} ✦ ༻꧂━━━╯`;

/** Nome do bot lido do config (o rodapé é sempre o mesmo nos três layouts). */
function nomeDoBot() {
  try {
    const config = loadJsonFile(CONFIG_FILE, {});
    return config?.nomebot || 'Bot';
  } catch {
    return 'Bot';
  }
}

const STATUS_ORDER = {
  ficante: 1,
  namoro: 2,
  trisal: 3,
  quadrisal: 4,
  casamento: 5
};

const TYPE_CONFIG = {
  ficante: {
    label: 'Ficante',
    emoji: '🎈',
    inviteLabel: 'uma ficada',
    successHeadline: '🎈 Pedido aceito!',
    successText: 'agora estão ficando!'
  },
  namoro: {
    label: 'Namoro',
    emoji: '💞',
    inviteLabel: 'um namoro',
    successHeadline: '💞 Pedido aceito!',
    successText: 'agora estão namorando!'
  },
  casamento: {
    label: 'Casamento',
    emoji: '💍',
    inviteLabel: 'um casamento',
    successHeadline: '💍 Pedido aceito!',
    successText: 'agora estão oficialmente casados!'
  },
  trisal: {
    label: 'Trisal',
    emoji: '💞',
    inviteLabel: 'um trisal',
    successHeadline: '💞 Pedido aceito!',
    successText: 'formaram um trisal!',
    multipleParticipants: true,
    minParticipants: 3
  },
  quadrisal: {
    label: 'Quadrisal',
    emoji: '💞',
    inviteLabel: 'um quadrisal',
    successHeadline: '💞 Pedido aceito!',
    successText: 'formaram um quadrisal!',
    multipleParticipants: true,
    minParticipants: 4
  }
};

class RelationshipManager {
  constructor() {
    this.pendingRequests = new Map();
    this.pendingGroupRequests = new Map(); // Para pedidos de trisal/quadrisal
    this.pendingBetrayals = new Map(); // Nova estrutura para pedidos de traição
    const timer = setInterval(() => this._cleanup(), 60 * 1000);
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
  }

  _normalizeId(id) {
    return typeof id === 'string' ? id.trim().toLowerCase() : '';
  }

  _normalizeType(type) {
    const normalized = normalizar(type || '');
    return ['ficante', 'namoro', 'casamento', 'trisal', 'quadrisal'].includes(normalized) ? normalized : null;
  }

  _getPairKey(a, b) {
    const first = this._normalizeId(a);
    const second = this._normalizeId(b);
    if (!first || !second || first === second) return null;
    return [first, second].sort().join('::');
  }

  _loadData() {
    const data = loadRelationships();
    if (!data || typeof data !== 'object') {
      return { pairs: {}, archived: [] };
    }
    if (!data.pairs || typeof data.pairs !== 'object') {
      data.pairs = {};
    }
    if (!Array.isArray(data.archived)) {
      data.archived = [];
    }
    return data;
  }

  _saveData(data) {
    return saveRelationships(data);
  }

  _formatDuration(milliseconds) {
    if (!milliseconds || milliseconds <= 0) return '0s';
    const totalSeconds = Math.floor(milliseconds / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const parts = [];
    if (days) parts.push(`${days}d`);
    if (hours) parts.push(`${hours}h`);
    if (minutes) parts.push(`${minutes}m`);
    if (!parts.length) parts.push(`${seconds}s`);
    return parts.join(' ');
  }

  _formatDate(dateValue) {
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  }

  hasPendingRequest(groupId) {
    return this.pendingRequests.has(groupId);
  }

  createRequest(type, groupId, requesterId, targetId, context = {}) {
    const normalizedType = this._normalizeType(type);
    if (!normalizedType) {
      return { success: false, message: 'Tipo de pedido inválido.' };
    }

    const requester = this._normalizeId(requesterId);
    const target = this._normalizeId(targetId);
    if (!requester || !target) {
      return { success: false, message: 'Participantes inválidos.' };
    }
    if (requester === target) {
      return { success: false, message: 'Você não pode enviar um pedido para você mesmo.' };
    }

    if (this.pendingRequests.has(groupId)) {
      const pending = this.pendingRequests.get(groupId);
      const config = TYPE_CONFIG[pending.type];
      return {
        success: false,
        message: `Já existe um pedido de ${config?.label?.toLowerCase() || 'relacionamento'} aguardando resposta neste grupo.`
      };
    }

    // ===== CORREÇÃO: Verifica se o solicitante já está em outro relacionamento =====
    const requesterActivePair = this.getActivePairForUser(requesterId);
    if (requesterActivePair && this._normalizeId(requesterActivePair.partnerId) !== target) {
      const partnerName = getUserName(requesterActivePair.partnerId);
      const currentConfig = TYPE_CONFIG[requesterActivePair.pair.status];
      return {
        success: false,
        message: `❌ Você já está em ${currentConfig.inviteLabel} com @${partnerName}. Termine esse relacionamento primeiro!`,
        mentions: [requesterActivePair.partnerId]
      };
    }

    // ===== CORREÇÃO: Verifica se o alvo já está em outro relacionamento =====
    const targetActivePair = this.getActivePairForUser(targetId);
    if (targetActivePair && this._normalizeId(targetActivePair.partnerId) !== requester) {
      const partnerName = getUserName(targetActivePair.partnerId);
      const targetName = getUserName(targetId);
      const currentConfig = TYPE_CONFIG[targetActivePair.pair.status];
      return {
        success: false,
        message: `❌ @${targetName} já está em ${currentConfig.inviteLabel} com @${partnerName}!`,
        mentions: [targetId, targetActivePair.partnerId]
      };
    }

    const pairKey = this._getPairKey(requesterId, targetId);
    if (!pairKey) {
      return { success: false, message: 'Não foi possível registrar o pedido.' };
    }

    const data = this._loadData();
    const existingPair = data.pairs[pairKey];
    const validation = this._validateNewRequest(normalizedType, existingPair);
    if (!validation.allowed) {
      return { success: false, message: validation.message };
    }

    const now = Date.now();
    const request = {
      id: `${groupId}:${now}`,
      type: normalizedType,
      groupId,
      requester,
      target,
      requesterRaw: requesterId,
      targetRaw: targetId,
      createdAt: now,
      expiresAt: now + REQUEST_TIMEOUT_MS,
      context
    };

    this.pendingRequests.set(groupId, request);

    return {
      success: true,
      message: this._buildInvitationMessage(request),
      mentions: [requesterId, targetId],
      request
    };
  }

  _validateNewRequest(type, pair) {
    if (!pair) {
      if (type === 'casamento') {
        return {
          allowed: false,
          message: 'Vocês precisam estar namorando para casar.'
        };
      }
      return { allowed: true };
    }

    const currentStatus = pair.status;

    if (type === 'ficante') {
      if (currentStatus === 'ficante') {
        const since = pair.stages?.ficante?.since;
        const dateText = since ? this._formatDate(since) : 'recentemente';
        return {
          allowed: false,
          message: `Vocês já estão ficando desde ${dateText}.`
        };
      }
      if (currentStatus === 'namoro') {
        return {
          allowed: false,
          message: 'Vocês já estão namorando. Use o comando de terminar primeiro se quiser começar de novo.'
        };
      }
      if (currentStatus === 'casamento') {
        return {
          allowed: false,
          message: 'Vocês já são casados. Use o comando de terminar primeiro se quiser começar de novo.'
        };
      }
      return { allowed: true };
    }

    if (type === 'namoro') {
      if (currentStatus === 'namoro') {
        const since = pair.stages?.namoro?.since;
        const dateText = since ? this._formatDate(since) : 'recentemente';
        return {
          allowed: false,
          message: `Vocês já estão namorando desde ${dateText}.`
        };
      }
      if (currentStatus === 'casamento') {
        return {
          allowed: false,
          message: 'Vocês já são casados!'
        };
      }
      // Permite evoluir de ficante para namoro
      return { allowed: true };
    }

    if (type === 'casamento') {
      if (currentStatus === 'casamento') {
        const since = pair.stages?.casamento?.since;
        const dateText = since ? this._formatDate(since) : 'recentemente';
        return {
          allowed: false,
          message: `Vocês já são casados desde ${dateText}.`
        };
      }
      
      if (currentStatus !== 'namoro') {
        return {
          allowed: false,
          message: 'Vocês precisam estar namorando para casar.'
        };
      }
      
      const since = pair.stages?.namoro?.since;
      if (!since) {
        return {
          allowed: false,
          message: 'Vocês precisam estar namorando para casar. O registro do namoro não foi encontrado.'
        };
      }
      
      const sinceTime = Date.parse(since);
      if (Number.isNaN(sinceTime)) {
        return {
          allowed: false,
          message: 'Não foi possível validar a data do namoro. Reinicie o namoro antes de casar.'
        };
      }
      
      const elapsed = Date.now() - sinceTime;
      if (elapsed < MARRIAGE_REQUIRED_MS) {
        return {
          allowed: false,
          message: `Vocês precisam namorar por mais ${this._formatDuration(MARRIAGE_REQUIRED_MS - elapsed)} antes de casar.`
        };
      }
      
      return { allowed: true };
    }

    return {
      allowed: false,
      message: 'Tipo de pedido inválido.'
    };
  }

  _buildInvitationMessage(request) {
    const config = TYPE_CONFIG[request.type];
    const requesterName = getUserName(request.requesterRaw);
    const targetName = getUserName(request.targetRaw);
    const botName = nomeDoBot();
    return [
      TOPO_REL(config.emoji, `PEDIDO DE ${config.label.toUpperCase()}`),
      `┃ ${config.emoji} @${requesterName} ${bold('convidou')} @${targetName}`,
      `┃    ${bold(`para ${config.inviteLabel}!`)}`,
      '┃',
      `┃ ✅ ${bold('Aceitar')}: "sim"`,
      `┃ ❌ ${bold('Recusar')}: "não"`,
      `┃ ⏳ ${bold(`Expira em ${this._formatDuration(REQUEST_TIMEOUT_MS)}.`)}`,
      FECHO_REL(botName),
    ].join('\n');
  }

  async processResponse(groupId, responderId, rawResponse) {
    const pending = this.pendingRequests.get(groupId);
    if (!pending) return null;

    const responder = this._normalizeId(responderId);
    if (responder !== pending.target) {
      return { success: false, reason: 'not_target' };
    }

    const decision = this._normalizeDecision(rawResponse);
    if (!decision) {
      return {
        success: false,
        reason: 'invalid_response',
        message: '❌ Resposta inválida. Use "sim" para aceitar ou "não" para recusar.'
      };
    }

    this.pendingRequests.delete(groupId);

    if (decision === 'reject') {
      const config = TYPE_CONFIG[pending.type];
      const requesterName = getUserName(pending.requesterRaw);
      const targetName = getUserName(pending.targetRaw);
      return {
        success: true,
        message: [
          TOPO_REL(config.emoji, 'PEDIDO RECUSADO'),
          `┃ ${config.emoji} @${targetName} ${bold('recusou')}`,
          `┃    ${bold('o pedido de')} @${requesterName}`,
          FECHO_REL(nomeDoBot()),
        ].join('\n'),
        mentions: [pending.requesterRaw, pending.targetRaw]
      };
    }

    return await this._applyRequest(pending);
  }

  _normalizeDecision(rawResponse) {
    const normalized = normalizar((rawResponse || '').trim());
    if (!normalized) return null;
    const firstWord = normalized.split(/\s+/)[0];
    if (['s', 'sim', 'aceito', 'aceitar', 'yes', 'y', 'claro'].includes(firstWord)) {
      return 'accept';
    }
    if (['n', 'nao', 'não', 'no', 'recuso', 'recusar', 'rejeito', 'rejeitar'].includes(firstWord)) {
      return 'reject';
    }
    return null;
  }

  async _applyRequest(request) {
    const data = this._loadData();
    const key = this._getPairKey(request.requesterRaw, request.targetRaw);
    if (!key) {
      return {
        success: false,
        message: '❌ Não consegui registrar o relacionamento. Tente novamente.'
      };
    }

    const now = Date.now();
    let pair = data.pairs[key];
    if (!pair || typeof pair !== 'object') {
      pair = {
        users: [this._normalizeId(request.requesterRaw), this._normalizeId(request.targetRaw)],
        status: null,
        stages: {},
        history: [],
        createdAt: new Date(now).toISOString(),
        groupId: request.groupId
      };
    }

    if (!Array.isArray(pair.history)) {
      pair.history = [];
    }

    if (!pair.stages || typeof pair.stages !== 'object') {
      pair.stages = {};
    }

    const stageEntry = {
      since: new Date(now).toISOString(),
      requestedBy: request.requesterRaw,
      acceptedBy: request.targetRaw,
      groupId: request.groupId,
      requestedAt: new Date(request.createdAt).toISOString(),
      acceptedAt: new Date(now).toISOString()
    };

    pair.history.push({
      type: request.type,
      requestedBy: request.requesterRaw,
      acceptedBy: request.targetRaw,
      requestedAt: stageEntry.requestedAt,
      acceptedAt: stageEntry.acceptedAt
    });

    // Lógica de atualização de status
    if (request.type === 'ficante') {
      pair.status = 'ficante';
      // Só cria ficante se não existir
      if (!pair.stages.ficante) {
        pair.stages.ficante = stageEntry;
      }
      if (!pair.createdAt) {
        pair.createdAt = stageEntry.since;
      }
    } else if (request.type === 'namoro') {
      pair.status = 'namoro';
      // Sempre atualiza o namoro com a nova data
      pair.stages.namoro = stageEntry;
      // Preserva ficante anterior se existir, senão cria
      if (!pair.stages.ficante) {
        pair.stages.ficante = { ...stageEntry };
      }
    } else if (request.type === 'casamento') {
      pair.status = 'casamento';
      // Sempre atualiza o casamento com a nova data
      pair.stages.casamento = stageEntry;
      // Preserva namoro e ficante anteriores
      if (!pair.stages.namoro) {
        pair.stages.namoro = { ...stageEntry };
      }
      if (!pair.stages.ficante) {
        pair.stages.ficante = { ...stageEntry };
      }
      // ═══════════════════════════════════════════════════════════════
      // 🤖 EVENTO NPC - CASAMENTO
      // ═══════════════════════════════════════════════════════════════
      try {
        const npcMod = await import('../utils/npcManager.js');
        npcMod.default?.recordEvent('casamento', request.requesterRaw, 
          `${request.requesterRaw.split('@')[0]} casou com ${request.targetRaw.split('@')[0]}! 💍`);
      } catch (e) { /* NPC não disponível */ }
    }

    pair.users = [this._normalizeId(request.requesterRaw), this._normalizeId(request.targetRaw)];
    pair.updatedAt = stageEntry.since;
    pair.terminatedAt = null;
    pair.terminatedBy = null;
    pair.lastStatus = pair.status;

    data.pairs[key] = pair;
    this._saveData(data);

    return {
      success: true,
      message: this._buildAcceptanceMessage(request, pair),
      mentions: [request.requesterRaw, request.targetRaw],
      pair
    };
  }

  _buildAcceptanceMessage(request, pair) {
    const config = TYPE_CONFIG[request.type];
    const requesterName = getUserName(request.requesterRaw);
    const targetName = getUserName(request.targetRaw);
    const stageInfo = pair.stages?.[request.type];
    const sinceText = stageInfo?.since ? this._formatDate(stageInfo.since) : null;
    const botName = nomeDoBot();

    const lines = [
      TOPO_REL(config.emoji, 'PEDIDO ACEITO'),
      `┃ ${config.emoji} @${requesterName} ${bold('e')} @${targetName}`,
      `┃    ${bold(config.successText)}`,
    ];

    // Para casamento, mostra quanto tempo namoraram
    if (request.type === 'casamento' && pair.stages?.namoro?.since) {
      const namoroSince = Date.parse(pair.stages.namoro.since);
      const casamentoSince = Date.parse(stageInfo.since);
      if (!Number.isNaN(namoroSince) && !Number.isNaN(casamentoSince)) {
        const namoroDuration = casamentoSince - namoroSince;
        lines.push(`┃ 🗓️ ${bold('Namoro')}: ${this._formatDuration(namoroDuration)}`);
      }
    }

    // Para namoro, mostra quanto tempo de ficante (se houver)
    if (request.type === 'namoro' && pair.stages?.ficante?.since) {
      const ficanteSince = Date.parse(pair.stages.ficante.since);
      const namoroSince = Date.parse(stageInfo.since);
      if (!Number.isNaN(ficanteSince) && !Number.isNaN(namoroSince) && ficanteSince !== namoroSince) {
        const ficanteDuration = namoroSince - ficanteSince;
        lines.push(`┃ 🎈 ${bold('Ficante')}: ${this._formatDuration(ficanteDuration)}`);
      }
    }

    if (sinceText) {
      lines.push(`┃ 🗓️ ${bold('Início')}: ${sinceText}`);
    }

    lines.push(FECHO_REL(botName));
    return lines.join('\n');
  }

  /**
   * Resumo do relacionamento entre duas pessoas.
   *
   * `groupId` restringe a busca ao grupo: as mesmas pessoas podem ter um
   * trisal em um grupo e outro em outro, e sem o escopo a consulta podia
   * devolver o relacionamento do grupo errado.
   */
  getRelationshipSummary(userA, userB, groupId = null) {
    const found = this._findRelationshipBetween(userA, userB, groupId);
    if (!found) {
      return {
        success: false,
        message: 'Nenhum relacionamento ativo registrado entre essas pessoas.'
      };
    }

    return this._buildSummaryMessage(found.pair, [userA, userB]);
  }

  /**
   * Resumo do relacionamento de UM usuario, sem precisar de par informado.
   *
   * E o caminho de `!relacionamento` sem mencao. Antes o handler pegava
   * `activePair.partnerId` e passava como "a outra pessoa", mas em
   * trisal/quadrisal o `partnerId` era a lista inteira separada por virgula
   * ("b@lid,c@lid") -- que nao e um JID e nunca casa com nenhum par, entao o
   * comando respondia "Nenhum relacionamento ativo registrado".
   */
  getRelationshipSummaryForUser(userId, groupId = null) {
    const activePair = this.getActivePairForUser(userId, groupId);
    if (!activePair) {
      return {
        success: false,
        message: '❌ Você não marcou ninguém e não possui relacionamento ativo no momento.'
      };
    }

    const pair = activePair.pair;
    const users = Array.isArray(pair.users) ? pair.users : [];

    // Ordena com o autor primeiro, para a mensagem abrir com quem consultou.
    const normalizedSelf = this._normalizeId(userId);
    const ordered = users.slice().sort((x, y) => {
      const xSelf = this._normalizeId(x) === normalizedSelf ? 0 : 1;
      const ySelf = this._normalizeId(y) === normalizedSelf ? 0 : 1;
      return xSelf - ySelf;
    });

    return this._buildSummaryMessage(pair, ordered);
  }

  _buildSummaryMessage(pair, people) {
    const config = TYPE_CONFIG[pair.status];
    const isMultiple = Boolean(config?.multipleParticipants);
    const users = Array.isArray(pair.users) && pair.users.length ? pair.users : people;

    // Em trisal/quadrisal TODOS os participantes são parceiros entre si, então
    // a lista mostra o grupo inteiro (quem consultou incluído). Nos 1-1, mostra
    // o par consultado.
    const listed = isMultiple ? users : people;

    const nameList = listed
      .map(u => `@${getUserName(u)}`)
      .join(isMultiple ? ', ' : ' & ');

    const botName = nomeDoBot();
    const emoji = config?.emoji || '💞';
    const lines = [
      TOPO_REL(emoji, 'RELACIONAMENTO'),
      `┃ 👥 ${bold(isMultiple ? 'Participantes' : 'Parceiros')}: ${nameList}`
    ];

    if (config) {
      lines.push(`┃ ${config.emoji} ${bold('Status')}: ${bold(config.label)}`);

      const statusSince = pair.stages?.[pair.status]?.since;
      if (statusSince) {
        const formatted = this._formatDate(statusSince);
        const sinceTimestamp = Date.parse(statusSince);
        const duration = Number.isNaN(sinceTimestamp) ? null : this._formatDuration(Date.now() - sinceTimestamp);
        lines.push(`┃ 🗓️ ${bold('Desde')}: ${formatted || 'data desconhecida'}${duration ? ` (${duration})` : ''}`);
      }
    } else {
      lines.push(`┃ ⚠️ ${bold('Status')}: sem registro válido.`);
    }

    // Historico de estagios: so os 1-1 evoluem por ficante/namoro/casamento.
    // O estagio atual ja aparece acima, entao ele sai daqui para nao repetir.
    const historicalStages = ['ficante', 'namoro', 'casamento']
      .filter(stage => stage !== pair.status && pair.stages?.[stage]?.since)
      .map(stage => {
        const stageConfig = TYPE_CONFIG[stage];
        const since = pair.stages[stage].since;
        const formatted = this._formatDate(since);
        const sinceTimestamp = Date.parse(since);
        const duration = Number.isNaN(sinceTimestamp) ? null : this._formatDuration(Date.now() - sinceTimestamp);
        return `┃ ${stageConfig.emoji} ${bold(stageConfig.label)}: ${formatted || 'data desconhecida'}${duration ? ` (${duration})` : ''}`;
      });

    if (historicalStages.length > 0) {
      lines.push('┃', `┃ 📚 ${bold('Histórico')}:`, ...historicalStages);
    }

    // Se esta namorando mas nao casado, mostra tempo restante para casar.
    if (pair.status === 'namoro' && pair.stages?.namoro?.since) {
      const namoroSince = Date.parse(pair.stages.namoro.since);
      if (!Number.isNaN(namoroSince)) {
        const elapsed = Date.now() - namoroSince;
        if (elapsed < MARRIAGE_REQUIRED_MS) {
          const remaining = MARRIAGE_REQUIRED_MS - elapsed;
          lines.push('┃', `┃ ⏳ ${bold('Casamento')}: ${this._formatDuration(remaining)}`);
        } else {
          lines.push('┃', `┃ ✅ ${bold('Casamento')}: liberado (${this._formatDuration(elapsed)})`);
        }
      }
    }

    lines.push(FECHO_REL(botName));

    return {
      success: true,
      message: lines.join('\n'),
      mentions: (users.length ? users : people).slice()
    };
  }
  _findRelationshipBetween(userA, userB, groupId = null) {
    const a = this._normalizeId(userA);
    const b = this._normalizeId(userB);
    if (!a || !b || a === b) return null;

    const data = this._loadData();

    // 1) Par 1-1: a chave canonica "a::b" identifica o relacionamento.
    const directKey = this._getPairKey(a, b);
    const direct = data.pairs[directKey];
    if (direct && direct.status && TYPE_CONFIG[direct.status]) {
      return { key: directKey, pair: direct };
    }

    // 2) Relacionamento de grupo (trisal/quadrisal): a chave e
    // "groupId::a::b::c", entao _getPairKey nunca casa. Aqui procura o par
    // MULTIPLO que contenha as duas pessoas.
    const found = [];
    for (const [key, pair] of Object.entries(data.pairs)) {
      if (!pair || !pair.status || !TYPE_CONFIG[pair.status]) continue;
      if (!TYPE_CONFIG[pair.status].multipleParticipants) continue;
      if (!Array.isArray(pair.users)) continue;

      const users = pair.users.map(u => this._normalizeId(u));
      if (users.includes(a) && users.includes(b)) {
        found.push({ key, pair });
      }
    }
    if (found.length === 0) return null;

    // Duas pessoas podem dividir varios grupos e ter um trisal em cada um. Com
    // groupId, o relacionamento DAQUELE grupo vence; sem ele, mantem o primeiro
    // (comportamento antigo, para chamadas que nao tem contexto de grupo).
    if (groupId) {
      const scoped = found.find(f => f.pair.groupId === groupId);
      if (scoped) return scoped;
    }

    return found[0];
  }

  endRelationship(userA, userB, triggeredBy) {
    const found = this._findRelationshipBetween(userA, userB);
    if (!found) {
      return {
        success: false,
        message: '❌ Não existe um relacionamento ativo entre essas pessoas.'
      };
    }

    const { key } = found;
    const data = this._loadData();
    const pair = data.pairs[key];

    const status = pair.status;
    const config = TYPE_CONFIG[status];
    const stageInfo = pair.stages?.[status];
    const since = stageInfo?.since ? Date.parse(stageInfo.since) : null;
    const duration = since && !Number.isNaN(since) ? this._formatDuration(Date.now() - since) : null;
    const sinceFormatted = stageInfo?.since ? this._formatDate(stageInfo.since) : null;
    const endedAt = new Date().toISOString();

    if (!Array.isArray(pair.history)) {
      pair.history = [];
    }
    pair.history.push({
      type: 'termino',
      previousStatus: status,
      triggeredBy,
      endedAt
    });

    const archivedPair = JSON.parse(JSON.stringify(pair));
    archivedPair.terminatedAt = endedAt;
    archivedPair.terminatedBy = triggeredBy;
    archivedPair.finalStatus = status;
    archivedPair.status = 'terminado';
    if (!Array.isArray(data.archived)) {
      data.archived = [];
    }
    data.archived.push(archivedPair);

    delete data.pairs[key];
    this._saveData(data);

    const triggerName = getUserName(triggeredBy);
    const userOneName = getUserName(userA);
    const userTwoName = getUserName(userB);
    const lines = [
      '💔 *Relacionamento encerrado!*',
      '',
      `${config.emoji} Status encerrado: ${config.label}`
    ];

    if (sinceFormatted && duration) {
      lines.push(`📆 Duração total: ${duration}`);
      lines.push(`🗓️ Início: ${sinceFormatted}`);
    } else if (sinceFormatted) {
      lines.push(`🗓️ Iniciado em: ${sinceFormatted}`);
    }

    lines.push('', `👤 Quem encerrou: @${triggerName}`);
    lines.push(`👥 Ex-casal: @${userOneName} & @${userTwoName}`);

    return {
      success: true,
      message: lines.join('\n'),
      mentions: Array.from(new Set([userA, userB, triggeredBy].filter(Boolean)))
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // SISTEMA DE RELACIONAMENTOS MÚLTIPLOS (TRISAL E QUADRISAL)
  // ═══════════════════════════════════════════════════════════════

  // Verifica se há pedido de grupo pendente
  hasPendingGroupRequest(groupId) {
    return this.pendingGroupRequests.has(groupId);
  }

  // Cria pedido de trisal ou quadrisal
  createGroupRequest(type, groupId, requesterId, targetIds) {
    const normalizedType = this._normalizeType(type);
    if (!normalizedType || !TYPE_CONFIG[normalizedType]?.multipleParticipants) {
      return { success: false, message: 'Tipo de relacionamento inválido para múltiplos participantes.' };
    }

    const requester = this._normalizeId(requesterId);
    if (!requester) {
      return { success: false, message: 'Solicitante inválido.' };
    }

    const targets = targetIds.map(t => this._normalizeId(t)).filter(Boolean);
    if (targets.length === 0) {
      return { success: false, message: 'Nenhum participante válido.' };
    }

    const requiredParticipants = TYPE_CONFIG[normalizedType].minParticipants;
    const expectedTargets = requiredParticipants - 1; // -1 porque o requester já conta

    if (targets.length !== expectedTargets) {
      return { 
        success: false, 
        message: `❌ ${TYPE_CONFIG[normalizedType].label} precisa de ${requiredParticipants} participantes (você + ${expectedTargets} pessoas).` 
      };
    }

    // Verifica se algum dos participantes é o próprio solicitante
    if (targets.includes(requester)) {
      return { success: false, message: '❌ Você não pode incluir a si mesmo no pedido.' };
    }

    // Verifica duplicatas
    const uniqueTargets = [...new Set(targets)];
    if (uniqueTargets.length !== targets.length) {
      return { success: false, message: '❌ Não pode mencionar o mesmo usuário mais de uma vez.' };
    }

    if (this.pendingGroupRequests.has(groupId)) {
      return { success: false, message: '❌ Já existe um pedido de grupo pendente neste grupo.' };
    }

    // Verifica se o solicitante já está em outro relacionamento NESTE GRUPO
    const requesterActivePair = this.getActivePairForUser(requesterId, groupId);
    if (requesterActivePair) {
      const partnerName = getUserName(requesterActivePair.partnerId);
      const currentConfig = TYPE_CONFIG[requesterActivePair.pair.status];
      return {
        success: false,
        message: `❌ Você já está em ${currentConfig.inviteLabel} com @${partnerName} neste grupo. Termine esse relacionamento primeiro!`,
        mentions: [requesterActivePair.partnerId]
      };
    }

    // Verifica se algum dos alvos já está em relacionamento NESTE GRUPO
    for (const targetId of targetIds) {
      const targetActivePair = this.getActivePairForUser(targetId, groupId);
      if (targetActivePair) {
        const partnerName = getUserName(targetActivePair.partnerId);
        const targetName = getUserName(targetId);
        const currentConfig = TYPE_CONFIG[targetActivePair.pair.status];
        return {
          success: false,
          message: `❌ @${targetName} já está em ${currentConfig.inviteLabel} com @${partnerName} neste grupo!`,
          mentions: [targetId, targetActivePair.partnerId]
        };
      }
    }

    const now = Date.now();
    const allParticipants = [requesterId, ...targetIds];
    
    const request = {
      id: `${groupId}:${now}`,
      type: normalizedType,
      groupId,
      requester: requester,
      requesterRaw: requesterId,
      targets: targetIds.map(t => ({ id: this._normalizeId(t), raw: t })),
      acceptedTargets: [], // IDs normalizados que já aceitaram
      createdAt: now,
      expiresAt: now + REQUEST_TIMEOUT_MS
    };

    this.pendingGroupRequests.set(groupId, request);

    // Construir mensagem
    const config = TYPE_CONFIG[normalizedType];
    const requesterName = getUserName(requesterId);
    const targetNames = targetIds.map(t => `@${getUserName(t)}`).join(', ');
    const botName = nomeDoBot();

    return {
      success: true,
      message: [
        TOPO_REL(config.emoji, `PEDIDO DE ${config.label.toUpperCase()}`),
        `┃ ${config.emoji} ${targetNames}`,
        `┃    ${bold('convidados por')} @${requesterName}`,
        '┃',
        `┃ ✅ ${bold('Aceitar')}: "sim"`,
        `┃ ❌ ${bold('Recusar')}: "não"`,
        `┃ ⏳ ${bold(`Expira em ${this._formatDuration(REQUEST_TIMEOUT_MS)}.`)}`,
        FECHO_REL(botName),
      ].join('\n'),
      mentions: allParticipants,
      request
    };
  }

  // Processa resposta de participante para pedido de grupo
  processGroupResponse(groupId, responderId, rawResponse) {
    const pending = this.pendingGroupRequests.get(groupId);
    if (!pending) return null;

    const normalizedResponder = this._normalizeId(responderId);
    
    // Verifica se é o requester original (não pode responder ao próprio pedido)
    if (normalizedResponder === pending.requester) {
      // Ignora completamente - o criador não deve responder ao próprio pedido
      return null;
    }

    // Verifica se o respondente está na lista de alvos
    const targetIndex = pending.targets.findIndex(t => t.id === normalizedResponder);
    if (targetIndex === -1) {
      // Ignora completamente - pessoa que não foi convidada
      return null;
    }

    // Verifica se já respondeu
    if (pending.acceptedTargets.includes(normalizedResponder)) {
      // Ignora completamente - já confirmou
      return null;
    }

    const decision = this._normalizeDecision(rawResponse);
    if (!decision) {
      // Se não é uma resposta válida, ignora silenciosamente
      return null;
    }

    const config = TYPE_CONFIG[pending.type];
    const requesterName = getUserName(pending.requesterRaw);

    if (decision === 'reject') {
      // Recusa - cancela o pedido inteiro
      this.pendingGroupRequests.delete(groupId);
      
      const rejecterName = getUserName(responderId);
      return {
        success: true,
        cancelled: true,
        message: [
          TOPO_REL(config.emoji, `${config.label.toUpperCase()} CANCELADO`),
          `┃ ${config.emoji} @${rejecterName} ${bold('recusou')}`,
          `┃    ${bold('o pedido de')} @${requesterName}`,
          '┃',
          `┃ 💔 ${bold(`O ${config.label.toLowerCase()} não foi formado.`)}`,
          FECHO_REL(nomeDoBot()),
        ].join('\n'),
        mentions: [pending.requesterRaw, responderId]
      };
    }

    // Aceitar - adiciona aos aceitos
    pending.acceptedTargets.push(normalizedResponder);

    // Verifica se todos aceitaram
    const allTargets = pending.targets.map(t => t.id);
    const allAccepted = allTargets.every(t => pending.acceptedTargets.includes(t));

    if (allAccepted) {
      // Todos aceitaram - formar o relacionamento
      const result = this._createGroupRelationship(pending);
      this.pendingGroupRequests.delete(groupId);
      return result;
    }

    // Ainda faltam aceitar
    const remaining = allTargets.filter(t => !pending.acceptedTargets.includes(t));
    const accepted = pending.acceptedTargets.length;
    const total = allTargets.length;

    return {
      success: true,
      message: [
        TOPO_REL(config.emoji, 'PEDIDO ACEITO'),
        `┃ ✅ @${getUserName(responderId)} ${bold('aceitou')}`,
        '┃',
        `┃ ⏳ ${bold('Ainda aguardando')}:`,
        ...remaining.map(t => `┃    @${getUserName(t)}`),
        '┃',
        `┃ 📊 ${bold(`Progresso: ${accepted}/${total}`)}`,
        FECHO_REL(nomeDoBot()),
      ].join('\n'),
      mentions: [responderId, pending.requesterRaw, ...remaining]
    };
  }

  // Cria o relacionamento de grupo (trisal ou quadrisal)
  _createGroupRelationship(pending) {
    const data = this._loadData();
    const config = TYPE_CONFIG[pending.type];
    const now = Date.now();

    // Todos os participantes
    const allUsers = [pending.requesterRaw, ...pending.targets.map(t => t.raw)];
    const normalizedUsers = allUsers.map(u => this._normalizeId(u));

    // Criar chave única incluindo o groupId (relacionamento por grupo)
    const groupKey = `${pending.groupId}::${normalizedUsers.sort().join('::')}`;

    const pair = {
      users: allUsers, // Mantém a ordem original com JIDs
      status: pending.type,
      type: pending.type, // trisal ou quadrisal
      // groupId no proprio par: e o que getActivePairForUser(user, groupId) usa
      // para nao devolver um trisal de OUTRO grupo (antes so existia dentro de
      // stages, entao a checagem passava direto e vazava entre grupos).
      groupId: pending.groupId,
      stages: {
        [pending.type]: {
          since: new Date(now).toISOString(),
          requestedBy: pending.requesterRaw,
          targets: pending.targets.map(t => t.raw),
          groupId: pending.groupId,
          createdAt: new Date(pending.createdAt).toISOString()
        }
      },
      history: [{
        type: pending.type,
        requestedBy: pending.requesterRaw,
        targets: pending.targets.map(t => t.raw),
        createdAt: new Date(pending.createdAt).toISOString(),
        acceptedAt: new Date(now).toISOString()
      }],
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString()
    };

    data.pairs[groupKey] = pair;
    this._saveData(data);

    // Construir mensagem de sucesso
    const participantNames = allUsers.map(u => `@${getUserName(u)}`).join(', ');

    return {
      success: true,
      created: true,
      message: [
        TOPO_REL(config.emoji, `${config.label.toUpperCase()} FORMADO!`),
        `┃ ${config.emoji} ${participantNames}`,
        '┃',
        `┃ 🎉 ${bold(config.successText)}`,
        FECHO_REL(nomeDoBot()),
      ].join('\n'),
      mentions: allUsers,
      pair
    };
  }

  /**
   * Encontra o relacionamento ativo de um usuario.
   *
   * `partnerId` continua sendo um JID unico em todos os casos: em
   * trisal/quadrisal ele e o primeiro dos demais parceiros e a lista completa
   * fica em `allPartners`. Antes, o multi devolvia todos os parceiros juntos
   * numa string separada por virgula ("b@lid,c@lid"), que NÃO e um JID --
   * qualquer consumidor que fizesse `.split('@')[0]` ou buscasse esse id no
   * banco recebia lixo (era a causa de `!relacionamento` responder
   * "Nenhum relacionamento ativo registrado" depois do trisal formado).
   *
   * Se `groupId` for informado, so considera relacionamentos daquele grupo.
   */
  getActivePairForUser(userId, groupId = null) {
    const normalized = this._normalizeId(userId);
    if (!normalized) return null;

    const data = this._loadData();

    for (const [key, pair] of Object.entries(data.pairs)) {
      if (!pair || !Array.isArray(pair.users) || !pair.status || !TYPE_CONFIG[pair.status]) continue;

      // Escopo por grupo: usa pair.groupId (gravado no stageEntry e no proprio
      // pair). Sem isso, um trisal de outro grupo "vazava" para este.
      if (groupId && pair.groupId && pair.groupId !== groupId) continue;

      const usersNormalized = pair.users.map(u => this._normalizeId(u));
      const index = usersNormalized.indexOf(normalized);
      if (index === -1) continue;

      const otherUsers = pair.users.filter((u, i) => i !== index);

      // Relacionamento multiplo: todos sao parceiros entre si.
      if (TYPE_CONFIG[pair.status]?.multipleParticipants) {
        if (otherUsers.length === 0) continue;
        return {
          key,
          pair,
          partnerId: otherUsers[0], // primeiro parceiro, sempre um JID valido
          allPartners: otherUsers,  // lista completa (compatibilidade)
          userId: pair.users[index],
          groupId: pair.groupId ?? groupId
        };
      }

      // Relacionamento 1-1 (ficante, namoro, casamento).
      const partnerId = otherUsers[0];
      if (!partnerId) continue;
      return {
        key,
        pair,
        partnerId,
        userId: pair.users[index],
        groupId: pair.groupId ?? groupId
      };
    }

    return null;
  }
  // Termina relacionamento de grupo (trisal ou quadrisal)
  disbandGroupRelationship(userId, triggeredBy, groupId = null) {
    const userActivePair = this.getActivePairForUser(userId, groupId);
    if (!userActivePair) {
      return { success: false, message: '❌ Você não está em nenhum relacionamento múltiplo (trisal ou quadrisal) neste grupo.' };
    }

    const pair = userActivePair.pair;
    if (!TYPE_CONFIG[pair.status]?.multipleParticipants) {
      return { success: false, message: '❌ Use o comando de término específico para este tipo de relacionamento.' };
    }

    const config = TYPE_CONFIG[pair.status];
    const allUsers = pair.users;
    const key = userActivePair.key;

    // Verificar timeout para casamento
    if (pair.status === 'casamento') {
      const since = pair.stages?.casamento?.since;
      if (since) {
        const msSinceCreation = Date.now() - new Date(since).getTime();
        if (msSinceCreation < MARRIAGE_REQUIRED_MS) {
          const remaining = MARRIAGE_REQUIRED_MS - msSinceCreation;
          return {
            success: false,
            message: `❌ O casamento só pode ser desfeito após ${this._formatDuration(MARRIAGE_REQUIRED_MS)} juntos.\n\n⏳ Falta: ${this._formatDuration(remaining)}`
          };
        }
      }
    }

    const stageInfo = pair.stages?.[pair.status];
    const since = stageInfo?.since ? Date.parse(stageInfo.since) : null;
    const duration = since && !Number.isNaN(since) ? this._formatDuration(Date.now() - since) : null;

    const endedAt = new Date().toISOString();
    
    // Arquivar
    if (!Array.isArray(pair.history)) {
      pair.history = [];
    }
    pair.history.push({
      type: 'termino',
      previousStatus: pair.status,
      triggeredBy,
      endedAt
    });

    const archivedPair = JSON.parse(JSON.stringify(pair));
    archivedPair.terminatedAt = endedAt;
    archivedPair.terminatedBy = triggeredBy;
    archivedPair.finalStatus = pair.status;
    archivedPair.status = 'terminado';

    const data = this._loadData();
    if (!Array.isArray(data.archived)) {
      data.archived = [];
    }
    data.archived.push(archivedPair);
    delete data.pairs[key];

    this._saveData(data);

    const participantNames = allUsers.map(u => `@${getUserName(u)}`).join(', ');

    return {
      success: true,
      message: [
        TOPO_REL(config.emoji, `${config.label.toUpperCase()} ENCERRADO`),
        `┃ 💔 ${participantNames}`,
        '┃',
        `┃ ${bold('encerrado por')} @${getUserName(triggeredBy)}`,
        ...(duration ? ['┃', `┃ ⏱️ ${bold('Duração')}: ${duration}`] : []),
        FECHO_REL(nomeDoBot()),
      ].join('\n'),
      mentions: allUsers
    };
  }

  _cleanup() {
    const now = Date.now();
    for (const [groupId, request] of this.pendingRequests.entries()) {
      if (request.expiresAt && request.expiresAt <= now) {
        this.pendingRequests.delete(groupId);
      }
    }
    // Limpa pedidos de grupo expirados (trisal/quadrisal)
    const expiredEvents = [];
    for (const [groupId, request] of this.pendingGroupRequests.entries()) {
      if (request.expiresAt && request.expiresAt <= now) {
        // Prepara evento de expiração antes de deletar
        const config = TYPE_CONFIG[request.type];
        const accepted = request.acceptedTargets || [];
        const allTargets = request.targets.map(t => t.id);
        const notResponded = allTargets.filter(t => !accepted.includes(t));
        
        if (notResponded.length > 0) {
          expiredEvents.push({
            groupId,
            type: 'group_expired',
            message: [
              TOPO_REL(config.emoji, 'PEDIDO EXPIRADO'),
              `┃ ⌛ ${bold(`O pedido de ${config.label.toLowerCase()} expirou.`)}`,
              '┃',
              `┃ ❌ ${bold('Não aceitaram')}:`,
              ...notResponded.map(t => `┃    @${getUserName(t)}`),
              FECHO_REL(nomeDoBot()),
            ].join('\n'),
            mentions: [request.requesterRaw, ...notResponded]
          });
        }
        
        this.pendingGroupRequests.delete(groupId);
      }
    }
    // Emite eventos de expiração para serem processados
    if (expiredEvents.length > 0 && this.onExpirationEvents) {
      for (const event of expiredEvents) {
        this.onExpirationEvents(event);
      }
    }
    // Limpa pedidos de traição expirados
    for (const [key, betrayal] of this.pendingBetrayals.entries()) {
      if (betrayal.expiresAt && betrayal.expiresAt <= now) {
        this.pendingBetrayals.delete(key);
      }
    }
  }

  // Define callback para eventos de expiração
  onExpirationEvents(event) {
    // Será sobrescrito pelo index.js
  }

  // Verifica se há pedido de traição pendente
  hasPendingBetrayal(groupId) {
    for (const [key, betrayal] of this.pendingBetrayals.entries()) {
      if (betrayal.groupId === groupId) {
        return true;
      }
    }
    return false;
  }

  // Processa resposta de traição
  processBetrayalResponse(groupId, responderId, rawResponse, prefix = '/') {
    let betrayalToProcess = null;
    let betrayalKey = null;

    // Encontra o pedido de traição para este grupo e respondente
    for (const [key, betrayal] of this.pendingBetrayals.entries()) {
      if (betrayal.groupId === groupId && this._normalizeId(betrayal.targetId) === this._normalizeId(responderId)) {
        betrayalToProcess = betrayal;
        betrayalKey = key;
        break;
      }
    }

    if (!betrayalToProcess) return null;

    const decision = this._normalizeDecision(rawResponse);
    if (!decision) {
      return {
        success: false,
        reason: 'invalid_response',
        message: '❌ Resposta inválida. Use "sim" para aceitar ou "não" para recusar.'
      };
    }

    this.pendingBetrayals.delete(betrayalKey);

    const traitorName = getUserName(betrayalToProcess.userId);
    const targetName = getUserName(betrayalToProcess.targetId);
    const victimName = getUserName(betrayalToProcess.partnerId);

    if (decision === 'reject') {
      return {
        success: true,
        message: `😇 *CONSCIÊNCIA LIMPA*\n\n@${targetName} recusou a proposta de traição de @${traitorName}!\n\n💚 @${victimName} pode dormir tranquilo(a)!`,
        mentions: [betrayalToProcess.targetId, betrayalToProcess.userId, betrayalToProcess.partnerId]
      };
    }

    // Aceita a traição - executa o processo completo
    return this._executeBetrayalAccepted(betrayalToProcess, prefix);
  }

  // Cria pedido de traição
  createBetrayalRequest(userId, targetId, groupId, prefix = '/') {
    const userActivePair = this.getActivePairForUser(userId, groupId);

    if (!userActivePair) {
      return {
        success: false,
        message: '❌ Você não está em um relacionamento ativo!',
        mentions: []
      };
    }

    const partnerId = userActivePair.partnerId;

    // Em trisal/quadrisal TODOS os membros sao parceiros, entao "trair" com
    // qualquer um deles nao e traicao. Compara com a lista inteira.
    const allPartners = Array.isArray(userActivePair.allPartners) && userActivePair.allPartners.length
      ? userActivePair.allPartners
      : [partnerId];
    const targetNormalized = this._normalizeId(targetId);
    const betrayedPartner = allPartners.find(p => this._normalizeId(p) === targetNormalized);

    // Verifica se está tentando trair com o próprio parceiro
    if (betrayedPartner) {
      return {
        success: false,
        message: '❌ Você não pode trair seu parceiro com ele mesmo!',
        mentions: [betrayedPartner]
      };
    }

    // Verifica se está tentando trair consigo mesmo
    if (this._normalizeId(targetId) === this._normalizeId(userId)) {
      return {
        success: false,
        message: '❌ Você não pode trair a si mesmo!',
        mentions: []
      };
    }

    // Verifica se já existe pedido de traição pendente neste grupo
    for (const betrayal of this.pendingBetrayals.values()) {
      if (betrayal.groupId === groupId) {
        return {
          success: false,
          message: '⏳ Já existe um pedido de traição aguardando resposta neste grupo.',
          mentions: []
        };
      }
    }

    const now = Date.now();
    const betrayalKey = `${groupId}:${userId}:${targetId}:${now}`;
    
    const betrayalRequest = {
      userId,
      targetId,
      partnerId,
      groupId,
      userKey: userActivePair.key,
      createdAt: now,
      expiresAt: now + REQUEST_TIMEOUT_MS
    };

    this.pendingBetrayals.set(betrayalKey, betrayalRequest);

    const traitorName = getUserName(userId);
    const targetName = getUserName(targetId);
    const victimName = getUserName(partnerId);

    return {
      success: true,
      message: `😈 *PROPOSTA DE TRAIÇÃO*\n\n@${traitorName} quer trair @${victimName} com você, @${targetName}!\n\n✅ Aceitar: "sim"\n❌ Recusar: "não"\n\n⏳ Expira em ${this._formatDuration(REQUEST_TIMEOUT_MS)}.`,
      mentions: [userId, targetId, partnerId]
    };
  }

  // Executa traição após aceitação
  _executeBetrayalAccepted(betrayalRequest, prefix = '/') {
    const { userId, targetId, partnerId, groupId, userKey } = betrayalRequest;

    const data = this._loadData();
    const currentPair = data.pairs[userKey];
    
    if (!currentPair || !currentPair.status) {
      return {
        success: false,
        message: '❌ Não foi possível encontrar seu relacionamento ativo!',
        mentions: []
      };
    }

    // Verifica se o alvo também está em um relacionamento
    const targetActivePair = this.getActivePairForUser(targetId);
    
    let targetInRelationship = false;
    let targetPartner = null;
    
    if (targetActivePair) {
      targetInRelationship = true;
      targetPartner = targetActivePair.partnerId;
    }

    const now = new Date().toISOString();
    const config = TYPE_CONFIG[currentPair.status];

    // Registra a traição no histórico
    if (!Array.isArray(currentPair.history)) {
      currentPair.history = [];
    }

    currentPair.history.push({
      type: 'traicao',
      traitor: userId,
      victim: partnerId,
      accomplice: targetId,
      date: now,
      groupId: groupId,
      previousStatus: currentPair.status
    });

    // Incrementa contador de traições
    if (!currentPair.betrayals) {
      currentPair.betrayals = { [userId]: 0, [partnerId]: 0 };
    }
    currentPair.betrayals[userId] = (currentPair.betrayals[userId] || 0) + 1;

    // Marca como relacionamento traído
    currentPair.lastBetrayal = {
      date: now,
      traitor: userId,
      victim: partnerId,
      accomplice: targetId
    };

    this._saveData(data);

    const traitorName = getUserName(userId);
    const victimName = getUserName(partnerId);
    const accompliceName = getUserName(targetId);

    const lines = [
      '😈 *TRAIÇÃO CONFIRMADA!*',
      '',
      `💔 @${traitorName} traiu @${victimName}!`,
      `👤 Cúmplice: @${accompliceName} aceitou participar!`,
      ''
    ];

    const mentions = [userId, partnerId, targetId];

    if (targetInRelationship && targetPartner) {
      lines.push(`⚠️ @${accompliceName} também está em um relacionamento!`);
      lines.push(`💔 @${getUserName(targetPartner)} também foi traído(a)!`);
      lines.push('');
      mentions.push(targetPartner);
    }

    lines.push(`${config.emoji} Status atual: ${config.label}`);
    lines.push(`⚠️ Traições registradas: ${currentPair.betrayals[userId]}`);
    lines.push('');
    lines.push('💡 O relacionamento continua, mas a confiança foi abalada...');
    lines.push(`Use ${prefix}terminar para encerrar o relacionamento.`);

    return {
      success: true,
      message: lines.join('\n'),
      mentions: Array.from(new Set(mentions.filter(Boolean))),
      betrayalCount: currentPair.betrayals[userId]
    };
  }

  getBetrayalHistory(userA, userB) {
    const found = this._findRelationshipBetween(userA, userB);
    if (!found) {
      return {
        success: false,
        message: 'Nenhum relacionamento ativo encontrado entre essas pessoas.'
      };
    }

    const pair = found.pair;

    const betrayals = (pair.history || []).filter(h => h.type === 'traicao');
    
    if (betrayals.length === 0) {
      return {
        success: true,
        message: '✨ Este relacionamento não possui histórico de traições!',
        mentions: [userA, userB],
        betrayalCount: 0
      };
    }

    const partnerA = getUserName(userA);
    const partnerB = getUserName(userB);
    
    const lines = [
      '📜 *HISTÓRICO DE TRAIÇÕES*',
      '',
      `👥 Casal: @${partnerA} & @${partnerB}`,
      `💔 Total de traições: ${betrayals.length}`,
      ''
    ];

    betrayals.slice(-5).forEach((betrayal, index) => {
      const traitorName = getUserName(betrayal.traitor);
      const victimName = getUserName(betrayal.victim);
      const accompliceName = getUserName(betrayal.accomplice);
      const date = this._formatDate(betrayal.date);
      
      lines.push(`${index + 1}. 😈 @${traitorName} traiu @${victimName}`);
      lines.push(`   👤 Com: @${accompliceName}`);
      lines.push(`   📅 Data: ${date || 'N/A'}`);
      lines.push('');
    });

    if (betrayals.length > 5) {
      lines.push(`... e mais ${betrayals.length - 5} traições anteriores.`);
    }

    return {
      success: true,
      message: lines.join('\n'),
      mentions: Array.from(new Set([userA, userB, ...betrayals.map(b => b.traitor), ...betrayals.map(b => b.accomplice)].filter(Boolean))),
      betrayalCount: betrayals.length
    };
  }

  getGroupRelationships(groupMembers = []) {
    const data = this._loadData();
    const relationships = [];
    const seen = new Set();
    
    for (const [key, pair] of Object.entries(data.pairs)) {
      if (!pair || !pair.status || !TYPE_CONFIG[pair.status]) continue;
      if (pair.terminatedAt) continue; // Ignora relacionamentos terminados
      
      const config = TYPE_CONFIG[pair.status];
      
      // Se tem participantes múltiplos (trisal/quadrisal), adiciona como grupo
      if (config.multipleParticipants) {
        if (!pair.users || pair.users.length < config.minParticipants) continue;
        
        // Verificar se todos os membros estão no grupo
        const allInGroup = pair.users.every(user => 
          groupMembers.length === 0 || groupMembers.includes(user)
        );
        
        if (allInGroup) {
          const since = pair.stages?.[pair.status]?.since;
          const days = since ? Math.floor((Date.now() - new Date(since).getTime()) / (1000 * 60 * 60 * 24)) : 0;
          
          relationships.push({
            type: pair.status,
            label: config.label,
            emoji: config.emoji,
            users: pair.users,
            since: since,
            days: days
          });
        }
        continue;
      }
      
      // Relacionamentos de 2 pessoas
      if (!pair.users || pair.users.length !== 2) continue;
      
      const [user1, user2] = pair.users;
      const pairKey = [user1, user2].sort().join('::');
      
      // Evitar duplicatas
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);
      
      // Verificar se ambos estão no grupo
      const user1InGroup = groupMembers.length === 0 || groupMembers.includes(user1);
      const user2InGroup = groupMembers.length === 0 || groupMembers.includes(user2);
      
      if (user1InGroup && user2InGroup) {
        const since = pair.stages?.[pair.status]?.since;
        const days = since ? Math.floor((Date.now() - new Date(since).getTime()) / (1000 * 60 * 60 * 24)) : 0;
        
        relationships.push({
          type: pair.status,
          label: config.label,
          emoji: config.emoji,
          users: [user1, user2],
          since: since,
          days: days
        });
      }
    }
    
    // Ordenar por dias (maior para menor)
    relationships.sort((a, b) => b.days - a.days);
    
    return relationships;
  }
}

export default new RelationshipManager();
