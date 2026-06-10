// ═══════════════════════════════════════════════════════════════
// 🤖 SISTEMA DE NPCs - GERENCIADOR PRINCIPAL
// ═══════════════════════════════════════════════════════════════
import { NPC_PERSONALITIES, DEFAULT_ACTIVE_NPC } from './npcPersonalities.js';
import * as ia from '../funcs/private/ia.js';
import fs from 'fs';
import path from 'path';

const DATABASE_DIR = './dados';
const NPC_CONFIG_FILE = `${DATABASE_DIR}/npc_config.json`;
const NPC_MEMORY_FILE = `${DATABASE_DIR}/npc_memory.json`;

// ═══════════════════════════════════════════════════════════════
// 📊 CONFIGURAÇÕES DOS NPCs
// ═══════════════════════════════════════════════════════════════
const DEFAULT_CONFIG = {
  enabled: false,
  cooldown: 30000, // 30 segundos entre falas
  jornalEnabled: false,
  jornalHour: 20, // 8 da noite
  activeNPCs: [DEFAULT_ACTIVE_NPC], // NPCs que podem falar
  lastMessageTime: 0,
  eventsLog: [] // Log de eventos recentes
};

// ═══════════════════════════════════════════════════════════════
// 🧠 MEMÓRIA DOS NPCs
// ═══════════════════════════════════════════════════════════════
const DEFAULT_MEMORY = {
  rememberedPhrases: {}, // userId -> array de frases ditas
  contradictions: [], // contradições detectadas
  recentEvents: [], // eventos recentes { tipo, userId, data, desc }
  dailyStats: {
    date: null,
    messagesCount: {},
    topActive: []
  }
};

// ═══════════════════════════════════════════════════════════════
// 💾 FUNÇÕES DE PERSISTÊNCIA
// ═══════════════════════════════════════════════════════════════
const loadConfig = () => {
  try {
    if (fs.existsSync(NPC_CONFIG_FILE)) {
      const data = fs.readFileSync(NPC_CONFIG_FILE, 'utf-8');
      return { ...DEFAULT_CONFIG, ...JSON.parse(data) };
    }
  } catch (e) {
    console.error('[NPC] Erro ao carregar config:', e.message);
  }
  return { ...DEFAULT_CONFIG };
};

const saveConfig = (config) => {
  try {
    fs.writeFileSync(NPC_CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (e) {
    console.error('[NPC] Erro ao salvar config:', e.message);
  }
};

const loadMemory = () => {
  try {
    if (fs.existsSync(NPC_MEMORY_FILE)) {
      const data = fs.readFileSync(NPC_MEMORY_FILE, 'utf-8');
      return { ...DEFAULT_MEMORY, ...JSON.parse(data) };
    }
  } catch (e) {
    console.error('[NPC] Erro ao carregar memória:', e.message);
  }
  return { ...DEFAULT_MEMORY };
};

const saveMemory = (memory) => {
  try {
    fs.writeFileSync(NPC_MEMORY_FILE, JSON.stringify(memory, null, 2));
  } catch (e) {
    console.error('[NPC] Erro ao salvar memória:', e.message);
  }
};

// ═══════════════════════════════════════════════════════════════
// 🎭 GERENCIADOR DE NPCs
// ═══════════════════════════════════════════════════════════════
class NPCManager {
  constructor() {
    this.config = loadConfig();
    this.memory = loadMemory();
    this.cooldowns = new Map(); // npcId -> lastMessageTime
    this.globalCooldown = false;
    
    // Inicializa cooldowns
    Object.keys(NPC_PERSONALITIES).forEach(id => {
      this.cooldowns.set(id, 0);
    });
  }

  // Verifica se o sistema está ativo
  isEnabled() {
    return this.config.enabled;
  }

  // Verifica se pode falar (cooldown)
  canSpeak(npcId) {
    const now = Date.now();
    const lastTime = this.cooldowns.get(npcId) || 0;
    return (now - lastTime) >= this.config.cooldown && !this.globalCooldown;
  }

  // Marca que o NPC falou
  markSpoken(npcId) {
    this.cooldowns.set(npcId, Date.now());
    this.config.lastMessageTime = Date.now();
    saveConfig(this.config);
  }

  // Bloqueio global temporário
  setGlobalCooldown(ms = 5000) {
    this.globalCooldown = true;
    setTimeout(() => {
      this.globalCooldown = false;
    }, ms);
  }

  // ═══════════════════════════════════════════════════════════════
  // 📝 GERAÇÃO DE RESPOSTA COM IA
  // ═══════════════════════════════════════════════════════════════
  async generateResponse(npcId, event, context = {}) {
    if (!this.isEnabled()) return null;
    
    const npc = NPC_PERSONALITIES[npcId];
    if (!npc) return null;

    // Verifica se o NPC tem interesse no evento
    const eventType = event.type?.toLowerCase() || '';
    const hasInterest = npc.interesses.some(i => eventType.includes(i)) || Math.random() < 0.3;
    
    if (!hasInterest) return null;

    // Prepara contexto
    const contextInfo = this.buildContext(npcId, event, context);
    
    // Prepara prompt para IA
    const systemPrompt = npc.personalidade;
    const userPrompt = `
EVENTO ACONTECENDO:
${event.description}

${contextInfo}

gere uma resposta curta e natural como ${npc.nome} reagiria a isso.`;

    try {
      const response = await ia.makeCognimaRequest(
        'meta/llama-3.1-nemotron-70b-instruct',
        userPrompt,
        systemPrompt,
        [],
        2 // menos retries para não travar
      );

      const content = response?.data?.choices?.[0]?.message?.content;
      if (content) {
        return `${npc.emoji} ${content.trim()}`;
      }
    } catch (e) {
      console.error(`[NPC] Erro ao gerar resposta para ${npcId}:`, e.message);
    }

    return null;
  }

  // Constrói contexto para a IA
  buildContext(npcId, event, context) {
    let contextStr = '';

    // Memórias recentes
    if (this.memory.recentEvents.length > 0) {
      const recentEvents = this.memory.recentEvents.slice(-5);
      contextStr += '\nEVENTOS RECENTES DO GRUPO:\n';
      recentEvents.forEach(e => {
        contextStr += `- ${e.desc} (${this.timeAgo(e.data)})\n`;
      });
    }

    // Contradições
    if (this.memory.contradictions.length > 0) {
      const recentContra = this.memory.contradictions.slice(-3);
      if (recentContra.some(c => c.userId === event.userId)) {
        contextStr += '\n⚠️ LEMBRETE: Este usuário pode estar se contradizendo!\n';
      }
    }

    // Frases lembradas
    if (event.userId && this.memory.rememberedPhrases[event.userId]) {
      const phrases = this.memory.rememberedPhrases[event.userId].slice(-3);
      if (phrases.length > 0) {
        contextStr += '\nFRASES ANTERIORES DESTE USUÁRIO:\n';
        phrases.forEach(p => {
          contextStr += `- "${p.text}" (${this.timeAgo(p.date)})\n`;
        });
      }
    }

    return contextStr;
  }

  // Formata tempo relativo
  timeAgo(date) {
    const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
    if (seconds < 60) return 'agora';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}min`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
    return `${Math.floor(seconds / 86400)}d`;
  }

  // ═══════════════════════════════════════════════════════════════
  // 📰 GERAR JORNAL DIÁRIO
  // ═══════════════════════════════════════════════════════════════
  async generateDailyNews() {
    if (!this.config.jornalEnabled) return null;

    const today = new Date().toDateString();
    if (this.memory.dailyStats.date === today) return null;

    // Pega eventos do dia
    const todayEvents = this.memory.recentEvents.filter(e => {
      const eventDate = new Date(e.data).toDateString();
      return eventDate === today;
    });

    if (todayEvents.length === 0) return null;

    const npc = NPC_PERSONALITIES.journalist;
    
    // Prepara resumo dos eventos
    const eventsSummary = todayEvents.map(e => `- ${e.desc}`).join('\n');

    const systemPrompt = npc.personalidade;
    const userPrompt = `
CRIE O KAISER NEWS DIÁRIO com os seguintes eventos de HOJE:

${eventsSummary}

Crie uma edição resumida e divertida do jornal. Use formato:
📰 *KAISER NEWS - [data de hoje]*

[Manchete principal]

[Resumo dos principais eventos em 3-4 linhas]

Use tom jornalístico mas descontraído.`;

    try {
      const response = await ia.makeCognimaRequest(
        'meta/llama-3.1-nemotron-70b-instruct',
        userPrompt,
        systemPrompt,
        [],
        2
      );

      const content = response?.data?.choices?.[0]?.message?.content;
      if (content) {
        return content.trim();
      }
    } catch (e) {
      console.error('[NPC] Erro ao gerar jornal:', e.message);
    }

    return null;
  }

  // ═══════════════════════════════════════════════════════════════
  // 📝 REGISTRAR EVENTO
  // ═══════════════════════════════════════════════════════════════
  recordEvent(type, userId, description, metadata = {}) {
    const event = {
      id: Date.now(),
      type,
      userId,
      desc: description,
      data: new Date().toISOString(),
      metadata
    };

    this.memory.recentEvents.push(event);
    
    // Mantém só últimos 100 eventos
    if (this.memory.recentEvents.length > 100) {
      this.memory.recentEvents = this.memory.recentEvents.slice(-100);
    }

    saveMemory(this.memory);
    return event;
  }

  // ═══════════════════════════════════════════════════════════════
  // 🧠 LEMBRAR FRASE
  // ═══════════════════════════════════════════════════════════════
  rememberPhrase(userId, text, messageType = 'text') {
    if (!this.memory.rememberedPhrases[userId]) {
      this.memory.rememberedPhrases[userId] = [];
    }

    this.memory.rememberedPhrases[userId].push({
      text,
      date: new Date().toISOString(),
      type: messageType
    });

    // Mantém só últimas 10 frases por usuário
    if (this.memory.rememberedPhrases[userId].length > 10) {
      this.memory.rememberedPhrases[userId] = this.memory.rememberedPhrases[userId].slice(-10);
    }

    saveMemory(this.memory);
  }

  // ═══════════════════════════════════════════════════════════════
  // 🔍 DETECTAR CONTRADIÇÃO
  // ═══════════════════════════════════════════════════════════════
  checkContradiction(userId, newText) {
    const phrases = this.memory.rememberedPhrases[userId] || [];
    
    // Verifica contradições simples
    const contradictions = [
      { positivo: /nunca\s+vou/i, negativo: /agora\s+vou|irei|resolvedor/i },
      { positivo: /sempre\s+/i, negativo: /nunca\s+/i },
      { positivo: /não\s+gosto/i, negativo: /gosto\s+disso|adorei|amo/i },
      { positivo: /não\s+vou\s+casar/i, negativo: /casar|vou\s+casar|me\s+cas/i },
    ];

    for (const contra of contradictions) {
      const hasPositive = phrases.some(p => contra.positivo.test(p.text));
      const hasNegative = contra.negativo.test(newText);
      
      if (hasPositive && hasNegative) {
        const existing = this.memory.contradictions.find(
          c => c.userId === userId && c.type === 'contradição'
        );
        
        if (!existing) {
          this.memory.contradictions.push({
            userId,
            type: 'contradição',
            data: new Date().toISOString(),
            desc: `Usuário mudou de ideia sobre: "${newText}"`
          });
          saveMemory(this.memory);
          return true;
        }
      }
    }

    return false;
  }

  // ═══════════════════════════════════════════════════════════════
  // 🎯 TRIGGER NPC - Gera e envia resposta do NPC para o grupo
  // ═══════════════════════════════════════════════════════════════
  async triggerNPC(nazu, from, event, context = {}) {
    if (!this.isEnabled()) return null;
    
    // Seleciona NPC aleatório dos ativos
    const activeNPCs = this.config.activeNPCs;
    if (activeNPCs.length === 0) return null;
    
    const npcId = activeNPCs[Math.floor(Math.random() * activeNPCs.length)];
    
    // Verifica cooldown
    if (!this.canSpeak(npcId)) return null;

    // Gera resposta
    const response = await this.generateResponse(npcId, event, context);
    
    if (response) {
      // Marca que o NPC falou
      this.markSpoken(npcId);
      
      // Envia resposta
      try {
        await nazu.sendMessage(from, { text: response });
        return response;
      } catch (e) {
        console.error('[NPC] Erro ao enviar mensagem:', e.message);
      }
    }
    
    return null;
  }

  // ═══════════════════════════════════════════════════════════════
  // 🧠 HOOK PARA INTEGRAR COM QUALQUER SISTEMA
  // ═══════════════════════════════════════════════════════════════
  // Uso: npcManager.triggerFromSystem(nazu, from, 'novo_evento', userId, 'descrição', {extra: data})
  async triggerFromSystem(nazu, from, eventType, userId, description, metadata = {}) {
    if (!this.isEnabled()) return null;
    
    const event = {
      type: eventType,
      userId,
      description,
      metadata
    };
    
    // Registra o evento
    this.recordEvent(eventType, userId, description, metadata);
    
    // Trigger o NPC
    return await this.triggerNPC(nazu, from, event, metadata);
  }

  // ═══════════════════════════════════════════════════════════════
  // ⚙️ COMANDOS ADMINISTRATIVOS
  // ═══════════════════════════════════════════════════════════════
  toggle(enabled) {
    this.config.enabled = enabled;
    saveConfig(this.config);
    return enabled ? 'NPCs ativados!' : 'NPCs desativados!';
  }

  setCooldown(seconds) {
    this.config.cooldown = seconds * 1000;
    saveConfig(this.config);
    return `Cooldown definido para ${seconds} segundos!`;
  }

  toggleJornal(enabled) {
    this.config.jornalEnabled = enabled;
    saveConfig(this.config);
    return enabled ? 'Jornal diário ativado!' : 'Jornal diário desativado!';
  }

  getStatus() {
    return {
      ativo: this.config.enabled,
      cooldown: `${this.config.cooldown / 1000}s`,
      jornal: this.config.jornalEnabled ? 'Ativo' : 'Inativo',
      eventosRegistrados: this.memory.recentEvents.length
    };
  }
}

// Instância única
const npcManager = new NPCManager();

export default npcManager;
export { NPCManager, NPC_PERSONALITIES };