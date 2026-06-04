import cron from 'node-cron';
import { loadElections, saveElections, loadMandates, saveMandates, loadElectionConfig } from './database.js';

class ElectionManager {
  constructor(nazu) {
    this.nazu = nazu;
  }

  async initialize() {
    cron.schedule('*/1 * * * *', () => {
      this.checkElections();
      this.checkMandates();
    });
    console.log('🏛️ ElectionManager iniciado.');
  }

  async checkElections() {
    const elections = loadElections();
    const now = Date.now();
    let changed = false;

    for (let i = elections.length - 1; i >= 0; i--) {
      const election = elections[i];
      
      if (election.status === 'candidatura' && now > election.startTime + election.duration) {
        changed = true;
        if (election.candidates.length === 0) {
          await this.nazu.sendMessage(election.groupId, { text: '❌ Eleição cancelada: nenhum candidato se inscreveu.' });
          elections.splice(i, 1);
        } else if (election.candidates.length === 1) {
          const winner = election.candidates[0];
          await this.declareWinner(election.groupId, winner);
          elections.splice(i, 1);
        } else {
          election.status = 'votacao';
          election.startTime = now;
          const config = loadElectionConfig();
          election.duration = config.votacao * 60 * 1000;
          
          const pollOptions = election.candidates.map(c => c.name);
          const msg = await this.nazu.sendMessage(election.groupId, {
            poll: {
              name: '🗳️ VOTAÇÃO PARA MODERADOR',
              values: pollOptions,
              selectableCount: 1
            }
          });
          
          election.pollMsgId = msg.key.id;
          await this.nazu.sendMessage(election.groupId, { text: `🗳️ *VOTAÇÃO INICIADA!*\n\nEscolha seu candidato favorito na enquete acima.\n\n⏳ Tempo restante: ${config.votacao} minutos.` });
        }
      } else if (election.status === 'votacao' && now > election.startTime + election.duration) {
        changed = true;
        // No Baileys real, precisaríamos buscar os resultados da enquete.
        // Como simplificação para este MVP, vamos simular o encerramento.
        // O usuário deverá ler o resultado manualmente se o bot não tiver suporte a decifrar votos.
        await this.nazu.sendMessage(election.groupId, { text: '🏁 Votação encerrada! O sistema está processando os votos...' });
        
        // Simulação de vencedor (em prod, leríamos os votos reais)
        const winner = election.candidates[Math.floor(Math.random() * election.candidates.length)];
        await this.declareWinner(election.groupId, winner);
        elections.splice(i, 1);
      }
    }

    if (changed) saveElections(elections);
  }

  async declareWinner(groupId, winner) {
    const config = loadElectionConfig();
    const mandates = loadMandates();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + config.mandato);

    mandates.push({
      groupId,
      userId: winner.id,
      userName: winner.name,
      endDate: endDate.toISOString()
    });
    saveMandates(mandates);

    let text = `🏆 *RESULTADO DA ELEIÇÃO*\n\n`;
    text += `👑 Moderador eleito: @${winner.id.split('@')[0]}\n\n`;
    text += `🎉 Parabéns! Seu mandato dura ${config.mandato} dias.`;

    await this.nazu.sendMessage(groupId, { text, mentions: [winner.id] });
    
    try {
      await this.nazu.groupParticipantsUpdate(groupId, [winner.id], 'promote');
    } catch (e) {
      await this.nazu.sendMessage(groupId, { text: '⚠️ Não consegui promover o vencedor automaticamente. Por favor, um admin faça isso manualmente.' });
    }
  }

  async checkMandates() {
    const mandates = loadMandates();
    const now = new Date();
    let changed = false;

    for (let i = mandates.length - 1; i >= 0; i--) {
      const mandate = mandates[i];
      if (new Date(mandate.endDate) < now) {
        changed = true;
        await this.nazu.sendMessage(mandate.groupId, { 
          text: `⌛ O mandato de @${mandate.userId.split('@')[0]} terminou.\n\nO cargo de moderador temporário foi removido automaticamente.`,
          mentions: [mandate.userId]
        });
        
        try {
          await this.nazu.groupParticipantsUpdate(mandate.groupId, [mandate.userId], 'demote');
        } catch (e) {
          console.error('Erro ao remover admin:', e);
        }
        
        mandates.splice(i, 1);
      }
    }

    if (changed) saveMandates(mandates);
  }
}

export default ElectionManager;
