/**
 * Recalcula os bônus de ataque/defesa/vida do jogador com base nos equipamentos.
 * Usa os dados da loja (econ.shop) para somar os bônus de cada slot equipado.
 */
export function recalcEquipmentBonuses(user, shop = {}) {
  if (!user || typeof user !== 'object') return;
  
  // O bot original usa user.equipment, mas nossas modificações usaram user.equipments.
  // Vamos sincronizar os dois para garantir compatibilidade total.
  if (!user.equipments) {
    user.equipments = user.equipment || { weapon: null, armor: null, helmet: null, boots: null, shield: null, accessory: null };
  }
  user.equipment = user.equipments;

  let attack = 0;
  let defense = 0;
  let hp = 0;

  const slots = ['weapon', 'armor', 'helmet', 'boots', 'shield', 'accessory'];
  for (const slot of slots) {
    const itemId = user.equipments[slot];
    if (!itemId) continue;
    
    const item = shop[itemId];
    if (!item) continue;
    
    // Suporte para múltiplos formatos de bônus (KaiserBot e Kaiser)
    const eff = item.effect || {};
    
    // Ataque
    attack += (eff.attack || item.attackBonus || item.atk || item.attack || 0);
    // Defesa
    defense += (eff.defense || item.defenseBonus || item.def || item.defense || 0);
    // Vida
    hp += (eff.hp || item.hpBonus || item.life || item.hp || 0);
    
    // Bônus especiais (ex: Relicário do Vazio)
    if (eff.all_stats) {
      attack += eff.all_stats;
      defense += eff.all_stats;
      hp += eff.all_stats;
    }
    if (item.all_stats) {
      attack += item.all_stats;
      defense += item.all_stats;
      hp += item.all_stats;
    }
    if (eff.strength) attack += eff.strength;
    if (item.strength) attack += item.strength;
  }

  user.attackBonus = attack;
  user.defenseBonus = defense;
  user.hpBonus = hp;
  
  // Atualiza o poder base do usuário para refletir os bônus
  const level = user.level || 1;
  user.power = 100 + (level * 10) + attack;
  
  // Atualiza o HP máximo
  const baseHp = 200 + (level * 20);
  user.maxHp = baseHp + hp;
  
  // Garante que o HP atual não ultrapasse o máximo
  if (user.hp > user.maxHp) user.hp = user.maxHp;
}
