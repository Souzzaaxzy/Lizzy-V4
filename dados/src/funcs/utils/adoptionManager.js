import { loadEconomy, saveEconomy } from '../../utils/database.js';

const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

class AdoptionManager {
  constructor() {
    this.pendingAdoptions = new Map();
    const timer = setInterval(() => this._cleanup(), 60 * 1000);
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
  }

  _normalizeId(id) {
    return typeof id === 'string' ? id.trim().toLowerCase() : '';
  }

  createAdoptionRequest(groupId, requesterId, targetId) {
    const requester = this._normalizeId(requesterId);
    const target = this._normalizeId(targetId);
    
    if (!requester || !target) {
      return { success: false, message: 'Participantes inválidos.' };
    }
    
    if (requester === target) {
      return { success: false, message: 'Você não pode adotar a si mesmo.' };
    }
    
    // Verificar se já existe uma solicitação pendente para este alvo no grupo
    const existingRequest = this._getPendingRequestForTarget(groupId, target);
    if (existingRequest) {
      return { 
        success: false, 
        message: '⚠️ Este usuário já possui um pedido de adoção pendente. Aguarde a resposta.' 
      };
    }
    
    const now = Date.now();
    const request = {
      id: `${groupId}:${now}`,
      type: 'adocao',
      groupId,
      requester,
      target,
      requesterRaw: requesterId,
      targetRaw: targetId,
      createdAt: now,
      expiresAt: now + REQUEST_TIMEOUT_MS
    };
    
    this.pendingAdoptions.set(groupId, request);
    
    return {
      success: true,
      message: this._buildInvitationMessage(request),
      mentions: [requesterId, targetId],
      request
    };
  }

  _getPendingRequestForTarget(groupId, targetId) {
    const request = this.pendingAdoptions.get(groupId);
    if (!request) return null;
    if (this._normalizeId(request.target) === this._normalizeId(targetId)) {
      return request;
    }
    return null;
  }

  hasPendingRequest(groupId) {
    return this.pendingAdoptions.has(groupId);
  }

  _buildInvitationMessage(request) {
    const requesterName = request.requesterRaw.split('@')[0];
    const targetName = request.targetRaw.split('@')[0];
    
    return `╭━━━⊱ 📩 *SOLICITAÇÃO DE ADOÇÃO* ⊱━━━╮
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯

📨 Você solicitou a adoção de @${targetName}.

👤 O usuário possui ${REQUEST_TIMEOUT_MS / 1000 / 60} minutos para responder.

📝 Responda com:
✅ *sim*
❌ *não*`;
  }

  _buildExpirationMessage(request) {
    const requesterName = request.requesterRaw.split('@')[0];
    const targetName = request.targetRaw.split('@')[0];
    
    return `╭━━━⊱ ⏰ *ADOÇÃO EXPIRADA* ⊱━━━╮
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯

⏰ O pedido de adoção expirou.

👤 ${targetName} não respondeu a tempo.

💡 ${requesterName}, você pode tentar novamente mais tarde.`;
  }

  _normalizeDecision(rawResponse) {
    const normalized = (rawResponse || '').trim().toLowerCase();
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

  processResponse(groupId, responderId, rawResponse) {
    const pending = this.pendingAdoptions.get(groupId);
    if (!pending) {
      return { success: false, reason: 'no_pending' };
    }
    
    const responder = this._normalizeId(responderId);
    
    // Somente o alvo pode responder - se não for o alvo, retorna null para ignorar
    if (responder !== pending.target) {
      return null; // IGNORAR completamente - não responde nada
    }
    
    const decision = this._normalizeDecision(rawResponse);
    if (!decision) {
      return {
        success: false,
        reason: 'invalid',
        message: '❌ Resposta inválida. Use "sim" para aceitar ou "não" para recusar.'
      };
    }
    
    this.pendingAdoptions.delete(groupId);
    
    if (decision === 'reject') {
      return {
        success: true,
        reason: 'rejected',
        message: `╭━━━⊱ ❌ *ADOÇÃO RECUSADA* ⊱━━━╮
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯

❌ Pedido de adoção recusado.

👤 O usuário não aceitou ser adotado.`
      };
    }
    
    return this._applyAdoption(pending);
  }

  async _applyAdoption(request) {
    const econ = loadEconomy();
    const adopterData = econ.users[request.requester];
    const childData = econ.users[request.target];
    
    if (!adopterData || !childData) {
      return { success: false, message: '❌ Erro ao processar adoção. Dados não encontrados.' };
    }
    
    // Verificar saldo novamente (pode ter mudado)
    const adoptCost = 10000;
    if ((adopterData.wallet || 0) < adoptCost) {
      return {
        success: false,
        message: `❌ Você não possui saldo suficiente para adotar. Precisa de ${adoptCost.toLocaleString()} moedas.`
      };
    }
    
    // Cobrar coins
    adopterData.wallet -= adoptCost;
    
    // Inicializar estruturas de família se necessário
    if (!adopterData.family) adopterData.family = { spouse: null, children: [], parents: [], siblings: [] };
    if (!childData.family) childData.family = { spouse: null, children: [], parents: [], siblings: [] };
    
    // Adicionar aos filhos do adotante
    if (!adopterData.family.children) adopterData.family.children = [];
    if (!adopterData.family.children.includes(request.targetRaw)) {
      adopterData.family.children.push(request.targetRaw);
    }
    
    // Adicionar aos pais do adotado
    if (!childData.family.parents) childData.family.parents = [];
    if (!childData.family.parents.includes(request.requesterRaw)) {
      childData.family.parents.push(request.requesterRaw);
    }
    
    saveEconomy(econ);
    
    const adopterName = request.requesterRaw.split('@')[0];
    const childName = request.targetRaw.split('@')[0];
    
    return {
      success: true,
      reason: 'accepted',
      message: `╭━━━⊱ 🎉 *ADOÇÃO REALIZADA* ⊱━━━╮
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯

🎉 A adoção foi aceita com sucesso!

👨‍👩‍👧 Agora @${adopterName} e @${childName} fazem parte da mesma família!

💰 Custo: ${adoptCost.toLocaleString()} moedas

👨‍👩‍👧‍👦 O adotante agora tem ${adopterData.family.children.length} filho(s)!`,
      mentions: [request.requesterRaw, request.targetRaw]
    };
  }

  checkExpiration(groupId) {
    const request = this.pendingAdoptions.get(groupId);
    if (!request) return null;
    
    if (Date.now() > request.expiresAt) {
      this.pendingAdoptions.delete(groupId);
      return {
        expired: true,
        message: this._buildExpirationMessage(request),
        mentions: [request.requesterRaw]
      };
    }
    
    return null;
  }

  resetAdoption(groupId, targetId) {
    const request = this.pendingAdoptions.get(groupId);
    if (request && this._normalizeId(request.target) === this._normalizeId(targetId)) {
      this.pendingAdoptions.delete(groupId);
    }
    return true;
  }

  _cleanup() {
    const now = Date.now();
    for (const [groupId, request] of this.pendingAdoptions.entries()) {
      if (now > request.expiresAt) {
        this.pendingAdoptions.delete(groupId);
      }
    }
  }
}

const adoptionManager = new AdoptionManager();

export default adoptionManager;
