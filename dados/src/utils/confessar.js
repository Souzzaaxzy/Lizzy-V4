import fs from 'fs';
import path from 'path';

const CONFESSAR_COOLDOWN_FILE = path.join(process.cwd(), 'dados', 'database', 'confessarCooldown.json');

// Tempo mínimo entre envios (em milissegundos) - 30 segundos
const CONFESSAR_COOLDOWN_MS = 30000;

// Limite de caracteres
const MAX_MESSAGE_LENGTH = 1000;

let cooldownData = null;

function loadCooldownData() {
  if (cooldownData !== null) return cooldownData;
  
  try {
    if (fs.existsSync(CONFESSAR_COOLDOWN_FILE)) {
      const data = fs.readFileSync(CONFESSAR_COOLDOWN_FILE, 'utf-8');
      cooldownData = JSON.parse(data);
    } else {
      cooldownData = {};
    }
  } catch (error) {
    console.error('❌ Erro ao carregar confessarCooldown.json:', error);
    cooldownData = {};
  }
  
  return cooldownData;
}

function saveCooldownData() {
  try {
    const dir = path.dirname(CONFESSAR_COOLDOWN_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(CONFESSAR_COOLDOWN_FILE, JSON.stringify(cooldownData, null, 2));
  } catch (error) {
    console.error('❌ Erro ao salvar confessarCooldown.json:', error);
  }
}

// Verifica se o usuário está em cooldown
function isOnCooldown(sender) {
  const data = loadCooldownData();
  const now = Date.now();
  
  if (data[sender]) {
    const lastSend = data[sender].lastSend;
    if (now - lastSend < CONFESSAR_COOLDOWN_MS) {
      const remaining = Math.ceil((CONFESSAR_COOLDOWN_MS - (now - lastSend)) / 1000);
      return {
        onCooldown: true,
        remaining: remaining
      };
    }
  }
  
  return { onCooldown: false };
}

// Define o último envio do usuário
function setCooldown(sender) {
  const data = loadCooldownData();
  data[sender] = {
    lastSend: Date.now()
  };
  cooldownData = data;
  saveCooldownData();
}

// Valida número no formato internacional
function isValidPhoneNumber(number) {
  // Remove caracteres não numéricos
  const cleaned = number.replace(/\D/g, '');
  
  // Deve ter entre 10 e 15 dígitos (código do país + número)
  if (cleaned.length < 10 || cleaned.length > 15) {
    return false;
  }
  
  // Deve começar com código do país (geralmente 1-3 dígitos seguido de 9 para celular)
  // Exemplo: 55 (Brasil) 11 (DDD) 999999999 (número)
  return true;
}

// Extrai o número do final da mensagem (preserva quebras de linha na mensagem)
function extractNumberFromMessage(fullText) {
  // Quebra por linhas primeiro
  const lines = fullText.split('\n');
  
  // Procura o número na última linha ou última palavra
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    // Se a linha contém apenas o número
    if (/^\d+$/.test(line)) {
      const message = lines.slice(0, i).join('\n').trim();
      return { message, number: line };
    }
  }
  
  // Se não encontrou número na última linha, procura a última palavra
  const lastLine = lines[lines.length - 1];
  const words = lastLine.trim().split(/\s+/);
  
  for (let i = words.length - 1; i >= 0; i--) {
    if (/^\d+$/.test(words[i])) {
      const number = words[i];
      const messagePart = words.slice(0, i).join(' ');
      const otherLines = lines.slice(0, -1).join('\n');
      const fullMessage = otherLines 
        ? (otherLines + '\n' + messagePart).trim() 
        : messagePart;
      return { message: fullMessage, number };
    }
  }
  
  return null;
}

// Formata número para JID do WhatsApp
function formatToJid(phoneNumber) {
  const cleaned = phoneNumber.replace(/\D/g, '');
  return cleaned + '@s.whatsapp.net';
}

// Verifica se o número existe no WhatsApp
async function checkNumberExists(nazu, jid) {
  try {
    const result = await nazu.onWhatsApp(jid);
    return result && result.length > 0;
  } catch (error) {
    console.error('❌ Erro ao verificar número:', error);
    return false;
  }
}

// Envia confissão identificada
async function sendIdentifiedConfession(nazu, senderName, recipientJid, message) {
  const confessionMessage = `╭━━━꧁༺ 💌 𝐍𝐎𝐕𝐀 𝐌𝐄𝐍𝐒𝐀𝐆𝐄𝐌 ༻꧂━━━╮
┃ 👤 Você recebeu uma mensagem!
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯

👤 Remetente:
${senderName}

💬 Mensagem:

${message}

━━━━━━━━━━━━━━━━━━━━

ℹ️ Esta mensagem foi enviada através do bot.`;

  await nazu.sendMessage(recipientJid, { text: confessionMessage });
}

// Envia confissão anônima
async function sendAnonymousConfession(nazu, recipientJid, message) {
  const anonymousMessage = `╭━━━꧁༺ 💌 𝐂𝐎𝐍𝐅𝐈𝐒𝐒Ã𝐎 𝐀𝐍Ô𝐍𝐈𝐌𝐀 ༻꧂━━━╮
┃ 🤫 Você recebeu uma confissão anônima!
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯

💬 Mensagem:

${message}

━━━━━━━━━━━━━━━━━━━━

ℹ️ Esta mensagem foi enviada anonimamente através do bot.`;

  await nazu.sendMessage(recipientJid, { text: anonymousMessage });
}

export {
  isOnCooldown,
  setCooldown,
  isValidPhoneNumber,
  extractNumberFromMessage,
  formatToJid,
  checkNumberExists,
  sendIdentifiedConfession,
  sendAnonymousConfession,
  MAX_MESSAGE_LENGTH,
  CONFESSAR_COOLDOWN_MS
};
