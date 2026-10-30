import axios from 'axios';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Carregar variáveis de ambiente.
//
// O caminho e' o do PROJETO (relativo a este arquivo), NAO o CWD: o `!key`
// grava a chave em `<raiz>/.env` por caminho absoluto, e o painel pode iniciar
// o bot de outro diretorio. Com `dotenv.config()` cru, a chave era gravada e
// depois NAO lida — "a IA parou de funcionar" sem nada apontar para isso.
dotenv.config({ path: fileURLToPath(new URL('../../../../.env', import.meta.url)), quiet: true });
dotenv.config();

import userContextDB from '../../utils/userContextDB.js';
// A PERSONALIDADE e' a MESMA da call (`!iap`): fonte unica em `iapGuarda.js`.
// Antes o chat tinha quatro prompts proprios e a call um fixo — dois jeitos da
// mesma bot falar. Agora ha um so, e cada canal acrescenta o seu FORMATO.
import { promptDaLizzy, regrasDeCanal, iaIdentidade, limparNomeDoBot } from '../../utils/iapGuarda.js';
// O CONTEXTO da conversa (quem fala, o dono, os dados do grupo) tem UMA
// fonte: o mesmo modulo que a call usa. Aqui so' se monta o texto.
import { montarContextoDaConversa } from '../../utils/contextoConversa.js';
// A CHAVE da memoria: por GRUPO, por pessoa, por personalidade (a personalidade
// continua sendo uma so'). Modulo puro — o formato e' testavel sem conexao.
import { chaveDaMemoria } from '../../utils/memoriaLizzy.js';
// A CONVERSA passou a usar o Groq (a mesma API da call). Ver `makeCognimaRequest`.
import { groqChat, situacaoDasChaves } from '../../utils/groqClient.js';

// Chave da API Google Gemini (carregada do .env ou definida em runtime via !key)
let geminiApiKey = process.env.GEMINI_API_KEY || '';

// Define a chave Gemini em runtime (usada pelo comando !key)
function setGeminiApiKey(key) {
  geminiApiKey = (key && typeof key === 'string') ? key.trim() : '';
}

// Retorna a chave Gemini atualmente em uso (mascarada para logs)
function getGeminiApiKey(masked = false) {

  const key = geminiApiKey || process.env.GEMINI_API_KEY || '';
  if (!masked || !key) return key;
  if (key.length <= 8) return '•'.repeat(key.length);
  return `${key.substring(0, 4)}...${key.substring(key.length - 4)}`;
}

// Função para obter data/hora no fuso horário do Brasil (GMT-3)
function getBrazilDateTime() {
  const now = new Date();
  // Converter para horário do Brasil (UTC-3)
  const brazilTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  return brazilTime.toISOString();
}

// Função para obter data/hora formatada em PT-BR
function getFormattedBrazilDateTime() {
  const now = new Date();
  return now.toLocaleString('pt-BR', { 
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'full',
    timeStyle: 'medium'
  });
}

// Estado de API key removido — armazenamento/checagens centralizadas foram removidas.

let historico = {};

/**
 * Os IDs das mensagens do cache JA absorvidas no historico (por memoria).
 * E' o que impede a mesma mensagem entrar duas vezes quando a Lizzy e' chamada
 * varias vezes.
 */
const _vistosHistorico = new Map();

// Sistema de estado da conversa e preferências do usuário
let conversationStates = {};
let userPreferences = {};
let userInteractions = {};

// Funções de compatibilidade (no-op). Atribua/chame `IA_API_KEY` diretamente para requisições.
function updateApiKeyStatus() { return true; }
function getApiKeyStatus() { return { isValid: true }; }

// ========== SISTEMA DE VARIÁVEIS DINÂMICAS ==========

// Cache para informações do bot (atualizado em cada chamada)
let cachedBotInfo = null;
let lastBotInfoLoad = 0;
const BOT_INFO_CACHE_TTL = 5000; // 5 segundos

/**
 * Obtém informações dinâmicas do bot (nome, dono, etc) do arquivo de configuração
 * @returns {Object} Informações do bot
 */
function getDynamicBotInfo() {
  const now = Date.now();
  
  // Usar cache se ainda válido
  if (cachedBotInfo && (now - lastBotInfoLoad) < BOT_INFO_CACHE_TTL) {
    return cachedBotInfo;
  }
  
  try {
    // Tentar carregar do config.json
    // O projeto é ESM ("type": "module"), então `__dirname` NÃO existe: usá-lo
    // lançava "ReferenceError: __dirname is not defined" e o catch abaixo
    // engolia com um warn, fazendo o bot cair sempre nos valores padrão
    // ("Abyss"/"!") em vez de ler o config.json.
    const possiblePaths = [
      path.join(process.cwd(), 'dados', 'src', 'config.json'),
      path.join(process.cwd(), 'src', 'config.json'),
      path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'config.json')
    ];
    
    for (const configPath of possiblePaths) {
      if (fs.existsSync(configPath)) {
        const configData = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        cachedBotInfo = {
          nomeBot: configData.nomebot || 'Abyss',
          nomeDono: configData.nomedono || 'Dono',
          numeroDono: configData.numerodono || '',
          prefixo: configData.prefixo || '!'
        };
        lastBotInfoLoad = now;
        return cachedBotInfo;
      }
    }
  } catch (e) {
    console.warn('[IA] Erro ao carregar info do bot:', e.message);
  }
  
  // Retornar valores padrão se não conseguir carregar
  return {
    nomeBot: 'Abyss',
    nomeDono: 'Dono',
    numeroDono: '',
    prefixo: '!'
  };
}

/**
 * Substitui variáveis dinâmicas no texto
 * @param {string} text - Texto com variáveis
 * @param {Object} context - Contexto adicional (nomegrupo, etc)
 * @returns {string} Texto com variáveis substituídas
 */
function replaceDynamicVariables(text, context = {}) {
  const botInfo = getDynamicBotInfo();
  
  const replacements = {
    '{nomedobot}': botInfo.nomeBot,
    '{nomedodono}': botInfo.nomeDono,
    '{numerododono}': botInfo.numeroDono,
    '{nomedoBot}': botInfo.nomeBot,
    '{nomeDoBot}': botInfo.nomeBot,
    '{prefixo}': botInfo.prefixo,
    '{nomegrupo}': context.nomeGrupo || context.groupName || '',
    '{nomedoGrupo}': context.nomeGrupo || context.groupName || ''
  };
  
  let result = text;
  for (const [variable, value] of Object.entries(replacements)) {
    result = result.replace(new RegExp(variable.replace(/[{}]/g, '\\$&'), 'gi'), value || '');
  }
  
  return result;
}

/**
 * Verifica se uma mensagem menciona o nome do bot
 * @param {string} messageText - Texto da mensagem
 * @param {Object} context - Contexto adicional
 * @returns {Object} { mentioned: boolean, cleanedText: string }
 */
function checkBotNameMention(messageText, context = {}) {
  if (!messageText || typeof messageText !== 'string') {
    return { mentioned: false, cleanedText: messageText || '' };
  }

  const botInfo = getDynamicBotInfo();

  // ## O NOME VEM LIMPO, e nao cru do config
  //
  // O `nomebot` do config e' "Lizzy do privy" escrito em MATHEMATICAL BOLD (os
  // glifos estilizados). Duas coisas davam errado com ele cru:
  //
  //   1. o regex procurava os GLIFOS, e "Lizzy" digitado nunca casa com eles;
  //   2. o nome INTEIRO ("Lizzy do privy") nao casa com quem chama so' "Lizzy".
  //
  // `limparNomeDoBot` (o MESMO normalizador da call) resolve os dois: o NFKC
  // desfaz o estilo e o nome fica so' a primeira palavra -- **Lizzy**.
  const nomeLimpo = limparNomeDoBot(botInfo.nomeBot);
  if (!nomeLimpo) {
    return { mentioned: false, cleanedText: messageText };
  }

  // Compara SEM ACENTO e sem caixa: quem digita "lizzy" ou "Lizzy" esta falando
  // com ela, e o teclado do celular erra acento o tempo todo.
  const semAcento = (t) => {
    try { return t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
    catch { return t.toLowerCase(); }
  };
  const alvo = semAcento(nomeLimpo);

  // O nome pode vir no INICIO ou depois de um espaco, e precisa TERMINAR ali
  // (nao vale "Lizzyanne"). O regex antigo exigia `^nome` ou `\s+nome`, entao
  // "Lizzy," no comeco so' casava pela ancora e "e ai, Lizzy" so' pelo espaco.
  // `@` antes do nome tambem conta ("oi @Lizzy") e sai junto na limpeza.
  const re = new RegExp(`(^|[\\s@])${alvo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[\\s,!.:;?]|$)`, 'i');

  const textoNormalizado = semAcento(messageText);
  const mentioned = re.test(textoNormalizado);

  // Limpa o nome do texto ORIGINAL (preservando os acentos do resto da frase):
  // a posicao vem do texto normalizado, mas o corte e' feito no original.
  let cleanedText = messageText;
  if (mentioned) {
    const m = textoNormalizado.match(re);
    if (m) {
      const inicio = textoNormalizado.indexOf(m[0]);
      cleanedText = (messageText.slice(0, inicio) + messageText.slice(inicio + m[0].length))
        .replace(/^[\s@,!.:;?]+/, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
    }
  }

  return { mentioned, cleanedText };
}

/**
 * Verifica se a mensagem menciona o bot por @menção
 * @param {string} messageText - Texto da mensagem
 * @param {Array} mentionedJids - Lista de JIDs mencionados
 * @param {string} botNumber - Número do bot
 * @returns {boolean}
 */
function hasBotMention(messageText, mentionedJids = [], botNumber = '') {
  // Verificar menção por @
  if (mentionedJids && mentionedJids.length > 0) {
    const botShort = botNumber.split('@')[0].split(':')[0];
    for (const jid of mentionedJids) {
      const jidShort = jid.split('@')[0].split(':')[0];
      if (jidShort === botShort) {
        return true;
      }
    }
  }
  
  // Verificar menção por nome
  const { mentioned } = checkBotNameMention(messageText);
  return mentioned;
}

// ========== PERSONALIDADES DISPONÍVEIS ==========



// ========== FUNÇÃO GOOGLE GEMINI ==========
// Modelo Gemini padrão (estável e disponível na API — verificado em ago/2026)
// Alias ROLANTE: o Google mantém `gemini-flash-latest` apontando para a release
// atual de Flash — o nome NÃO envelhece (ao contrário de `gemini-2.5-flash`,
// que passou a responder 404 "no longer available to new users").
const GEMINI_ROLLING_ALIASES = ['gemini-flash-latest', 'gemini-pro-latest'];
const GEMINI_DEFAULT_MODEL = GEMINI_ROLLING_ALIASES[0];

// Último recurso: nomes conhecidos + os que o próprio Google sugeriu na
// mensagem de erro. A ordem importa (flash primeiro: mais rápido/barato).
const GEMINI_FALLBACK_MODELS = [
  ...GEMINI_ROLLING_ALIASES,
  'gemini-3-flash-preview',
  'gemini-3.1-pro-preview',
  'gemini-3-pro-preview',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.5-pro',
];
const GEMINI_VALID_MODELS = new Set(GEMINI_FALLBACK_MODELS);

// Seam de HTTP: o teste injeta poster/getter falsos para exercitar a cadeia de
// modelos sem abrir rede. Em produção é o axios.
let _httpPost = null;
let _httpGet = null;
function setGeminiHttpForTest(postFn, getFn) {
  _httpPost = typeof postFn === 'function' ? postFn : null;
  _httpGet = typeof getFn === 'function' ? getFn : null;
}
const postGemini = (url, data, config) => (_httpPost ? _httpPost(url, data, config) : axios.post(url, data, config));
const getGemini = (url, config) => (_httpGet ? _httpGet(url, config) : axios.get(url, config));

// Cache da descoberta de modelos (por key). TTL curto: se o Google mudar os
// nomes, o bot se atualiza no máximo em 1h.
const _modelosCache = { key: null, at: 0, modelos: [] };
const MODELOS_TTL_MS = 60 * 60 * 1000;

/**
 * Descobre, na conta do usuário, quais modelos existem e suportam
 * `generateContent`. É o que impede o bot de morrer quando o Google renomeia os
 * modelos. Em qualquer falha devolve `[]` (e a lista estática entra em ação).
 */
async function descobrirModelos(apiKey) {
  const agora = Date.now();
  if (_modelosCache.key === apiKey && (agora - _modelosCache.at) < MODELOS_TTL_MS) {
    return _modelosCache.modelos;
  }
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}&pageSize=1000`;
    const resp = await getGemini(url, { timeout: 20000 });
    const lista = Array.isArray(resp?.data?.models) ? resp.data.models : [];
    const nomes = lista
      .filter((m) => Array.isArray(m?.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
      .map((m) => String(m.name || '').replace(/^models\//, ''))
      .filter((n) => n && !/embedding|aqa|tts|image|audio|live|transcribe|veo|imagen|robotics/i.test(n));
    // Prefere flash/estáveis; evita experimental quando houver alternativa.
    const nota = (n) => {
      let sc = 0;
      if (/flash/i.test(n)) sc += 4;
      if (/pro/i.test(n)) sc += 2;
      if (/latest$/i.test(n)) sc += 3;
      if (/preview|exp|experimental/i.test(n)) sc -= 2;
      const v = n.match(/(\d+)\.(\d+)/);
      if (v) sc += (Number(v[1]) * 10 + Number(v[2])) / 100;
      return sc;
    };
    const ordenados = [...new Set(nomes)].sort((a, b) => nota(b) - nota(a));
    // Só cacheia resultado ÚTIL: cachear lista vazia (falha momentânea da
    // ListModels) travaria a descoberta por 1h e derrubaria os comandos.
    if (ordenados.length) {
      _modelosCache.key = apiKey;
      _modelosCache.at = agora;
      _modelosCache.modelos = ordenados;
    }
    return ordenados;
  } catch (e) {
    console.warn('[Gemini API] Não consegui listar os modelos:', e?.message || e);
    return [];
  }
}

/**
 * Normaliza o id de modelo que chega do chamador.
 *
 * Os comandos da Lizzy foram escritos para uma API compatível com OpenAI
 * (Cognima) e passavam `meta/llama-3.1-405b-instruct` — a Gemini API NÃO
 * conhece esse nome e responde 404. Qualquer id fora de `gemini-*` cai no
 * modelo default (o comportamento é o mesmo para o usuário: é o modelo de IA
 * do bot quem responde).
 */
function normalizeModelId(modelo) {
  const m = String(modelo || '').trim();
  if (!m) return GEMINI_DEFAULT_MODEL;
  if (m.startsWith('gemini-')) return m;
  return GEMINI_DEFAULT_MODEL;
}

// Converte mensagens do formato OpenAI (system/user/assistant) para o formato Gemini (contents + systemInstruction)
function buildGeminiPayload(modelo, texto, systemPrompt, historico) {
  const contents = [];
  let systemInstruction = systemPrompt || null;

  if (historico && Array.isArray(historico)) {
    for (const msg of historico) {
      const role = msg.role;
      const content = (msg.content && typeof msg.content === 'string') ? msg.content.trim() : '';
      if (!content) continue;

      if (role === 'system') {
        // Mesclar instruções de sistema do histórico ao systemInstruction
        systemInstruction = systemInstruction ? `${systemInstruction}\n\n${content}` : content;
        continue;
      }

      const geminiRole = role === 'assistant' ? 'model' : 'user';
      // Evitar dois conteúdos consecutivos do mesmo papel (Gemini exige alternância)
      const prev = contents[contents.length - 1];
      if (prev && prev.role === geminiRole) {
        prev.parts[0].text += '\n\n' + content;
        continue;
      }

      contents.push({ role: geminiRole, parts: [{ text: content }] });
    }
  }

  // Mensagem atual do usuário sempre por último
  const currentText = typeof texto === 'string' ? texto.trim() : String(texto || '');
  if (!currentText) {
    throw new Error('Parâmetros obrigatórios ausentes: texto vazio');
  }

  const last = contents[contents.length - 1];
  if (last && last.role === 'user') {
    last.parts[0].text += '\n\n' + currentText;
  } else {
    contents.push({ role: 'user', parts: [{ text: currentText }] });
  }

  const payload = {
    contents,
    generationConfig: {
      temperature: 0.8,
      maxOutputTokens: 4096
    }
  };
  if (systemInstruction) {
    payload.systemInstruction = { parts: [{ text: systemInstruction }] };
  }
  return payload;
}

// Extrai o texto da resposta do Gemini e normaliza para o formato OpenAI-compatível
function normalizeGeminiResponse(data) {
  const candidate = data?.candidates?.[0];
  const parts = (candidate && Array.isArray(candidate.content?.parts)) ? candidate.content.parts : [];
  const text = parts.map((part) => (part && typeof part.text === 'string') ? part.text : '').join('');

  if (!text || !text.trim()) {
    throw new Error('Resposta da API inválida');
  }
  return {
    id: 'gemini-' + (candidate?.index ?? 0),
    object: 'chat.completion',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: text },
        finish_reason: candidate?.finishReason || 'stop'
      }
    ]
  };
}

async function makeGeminiRequest(modelo, texto, systemPrompt = null, historico = [], retries = 3) {
  if (!texto) {
    throw new Error('Parâmetros obrigatórios ausentes: modelo e texto');
  }

  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error('Chave da IA não configurada.Use !key para configurar.');
  }

  const model = normalizeModelId(modelo);
  const payload = buildGeminiPayload(modelo, texto, systemPrompt, historico);

  // Tenta o modelo pedido e, se ele não existir/estiver indisponível, cai para
  // os modelos válidos — assim uma depreciação futura não derruba os comandos.
  const tentarComModelo = async (modelName) => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent`;
    return postGemini(url, payload, {
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      timeout: 90000,
    });
  };

  // Ordem da cadeia: o modelo pedido (normalmente um alias rolante) e, se ele
  // não existir mais, os que a CONTA realmente tem (descobertos) e por fim a
  // lista estática. Assim um rename do Google não derruba mais nada.
  const descobertos = await descobrirModelos(apiKey);
  const cadeia = [...new Set([model, ...GEMINI_ROLLING_ALIASES, ...descobertos, ...GEMINI_FALLBACK_MODELS])];
  let ultimoErro = null;

  for (const modelName of cadeia) {
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const response = await tentarComModelo(modelName);
        const data = normalizeGeminiResponse(response.data);
        if (modelName !== model) console.warn(`[Gemini API] ⚠️ Modelo "${model}" indisponível; usando "${modelName}".`);
        return { success: true, data };
      } catch (error) {
        const erro = classificarErroGemini(error);
        const apiMessage = erro.detalhe;
        ultimoErro = error;

        // SO' "modelo indisponivel" pula para o proximo nome. Chave/limite/rede
        // NAO — insistir so' enche o log (a chave invalida e' HTTP 400 e era
        // tratada como "modelo nao existe": o bot tentava os 8 modelos).
        if (erro.tipo === 'modelo') {
          console.warn(`[Gemini API] Modelo "${modelName}" indisponível; tentando o próximo.`);
          break;
        }

        // Chave e limite sao definitivos: nao adianta repetir nem trocar de nome.
        if (erro.tipo === 'chave' || erro.tipo === 'limite') {
          throw new Error(`[AI_ERROR] Falha na requisição: ${erro.mensagem}`);
        }

        console.warn(`[Gemini API] Tentativa ${attempt + 1}/${retries} falhou (${modelName}):`, { status: erro.http, message: apiMessage });

        if (attempt === retries - 1) {
          throw new Error(`[AI_ERROR] Falha na requisição: ${erro.mensagem}`);
        }
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      }
    }
  }

  const erroFinal = classificarErroGemini(ultimoErro);
  throw new Error(`[AI_ERROR] Falha na requisição: ${
    erroFinal.tipo === 'modelo' ? 'Nenhum modelo de IA disponível na conta.' : erroFinal.mensagem
  }`);
}

/**
 * Classifica um erro da API do Gemini.
 *
 * ## Por que NAO basta olhar o status HTTP (o bug que isto corrige)
 *
 * Medido contra a API real:
 *
 * | situacao | HTTP | `reason` / mensagem |
 * |---|---|---|
 * | chave invalida | **400** | `API_KEY_INVALID`, "API key not valid" |
 * | payload malformado | **400** | "Invalid JSON payload" |
 * | modelo inexistente | **404** | "is not found for API version" |
 * | modelo aposentado | **404** | "is no longer available to new users" |
 * | limite | **429** | "Resource has been exhausted" |
 * | sem permissao | **403** | "Permission denied" |
 *
 * O codigo antigo tratava **todo 400** como "esse modelo nao existe" — entao
 * uma CHAVE INVALIDA (que e' 400!) fazia o bot tentar os 8 modelos, encher o
 * log e terminar com uma mensagem que nao dizia qual era o problema. Era o
 * sintoma do dono: "nem os comandos normais de IA funcionam".
 *
 * @param {any} erro o erro do axios (ou qualquer coisa)
 * @returns {{tipo: 'chave'|'modelo'|'limite'|'rede'|'payload'|'outro', http?: number, detalhe: string, mensagem: string}}
 */
function classificarErroGemini(erro) {
  const http = erro?.response?.status;
  const dados = erro?.response?.data?.error;
  const reason = String(
    (Array.isArray(dados?.details) ? dados.details.find((d) => d?.reason)?.reason : '') || ''
  );
  const statusGoogle = String(dados?.status || '');
  const apiMessage = String(dados?.message || erro?.message || '').trim();
  const baixo = apiMessage.toLowerCase();

  const detalhe = apiMessage || `HTTP ${http ?? '?'}`;

  // 1) CHAVE — vem como 400/401/403 e o motivo esta' no corpo.
  if (
    reason === 'API_KEY_INVALID' ||
    /api key not valid|api key.*invalid|invalid.*api key|api key expired/i.test(apiMessage) ||
    statusGoogle === 'PERMISSION_DENIED' ||
    http === 401 ||
    http === 403
  ) {
    return {
      tipo: 'chave',
      http,
      detalhe,
      mensagem: 'API key inválida ou sem permissão de acesso à Google Gemini API.'
    };
  }

  // 2) LIMITE.
  if (http === 429 || statusGoogle === 'RESOURCE_EXHAUSTED' || /quota|exhausted|rate limit/i.test(baixo)) {
    return {
      tipo: 'limite',
      http,
      detalhe,
      mensagem: 'Limite de requisições da Google Gemini API atingido. Tente novamente mais tarde.'
    };
  }

  // 3) MODELO — 404, ou 400 cujo TEXTO fala de modelo.
  if (
    http === 404 ||
    /not found for api version|is not found|no longer available|unsupported model|not supported for|model.*not.*(exist|available)/i.test(baixo)
  ) {
    return { tipo: 'modelo', http, detalhe, mensagem: 'Modelo indisponível na conta.' };
  }

  // 4) PAYLOAD — 400 que nao e' chave nem modelo.
  if (http === 400 || statusGoogle === 'INVALID_ARGUMENT') {
    return { tipo: 'payload', http, detalhe, mensagem: `Requisição inválida para a IA: ${detalhe}` };
  }

  // 5) REDE / TEMPO.
  if (
    !http ||
    erro?.code === 'ECONNABORTED' ||
    erro?.code === 'ETIMEDOUT' ||
    erro?.code === 'ENOTFOUND' ||
    erro?.code === 'ECONNREFUSED' ||
    erro?.code === 'EAI_AGAIN' ||
    http === 408
  ) {
    return {
      tipo: 'rede',
      http,
      detalhe,
      mensagem: /tempo|timeout|ECONNABORTED|ETIMEDOUT/i.test(baixo)
        ? 'Tempo esgotado ao chamar a Google Gemini API.'
        : 'Falha de rede ao chamar a Google Gemini API.'
    };
  }

  return { tipo: 'outro', http, detalhe, mensagem: detalhe || 'Erro desconhecido na Google Gemini API.' };
}

/**
 * Requisicao MULTIMODAL (audio/imagem inline) pelo MESMO caminho de modelos do
 * `makeGeminiRequest`: a cadeia [modelo pedido, aliases rolantes, descobertos,
 * fallback estatico], com 404/400 pulando para o proximo e 401/403 falhando na
 * hora.
 *
 * ## Por que existe (o bug que isto corrige)
 *
 * O STT do `!iap` chamava o endpoint DIRETO, com um nome de modelo FIXO
 * (`gemini-2.5-flash`). Quando o Google aposenta o nome para contas novas
 * (aconteceu: *"no longer available to new users"*), TODA transcricao vira 404 —
 * e o agente fica mudo, sem dizer por que. Aqui a requisicao usa a mesma cadeia
 * que os comandos de IA ja usam, entao um rename do Google nao derruba mais.
 *
 * Devolve `{ ok, data }` ou `{ ok: false, motivo, detalhe }` — NUNCA lanca, para
 * o chamador poder reportar o motivo real (era o que faltava no `!iap`).
 *
 * @param {object} p
 * @param {object} p.corpo corpo da requisicao (contents/generationConfig/...)
 * @param {string} [p.modelo] modelo preferido
 * @param {number} [p.timeoutMs]
 * @param {string} [p.apiKey] chave (padrao: a configurada)
 * @returns {Promise<{ok: boolean, data?: object, modeloUsado?: string, motivo?: string, detalhe?: string}>}
 */
async function geminiRequestMultimodal({ corpo, modelo, timeoutMs = 60000, apiKey: keyParam } = {}) {
  const apiKey = keyParam || getGeminiApiKey();
  if (!apiKey) return { ok: false, motivo: 'sem_chave' };

  const pedido = normalizeModelId(modelo);
  const descobertos = await descobrirModelos(apiKey);
  const cadeia = [...new Set([pedido, ...GEMINI_ROLLING_ALIASES, ...descobertos, ...GEMINI_FALLBACK_MODELS])];

  let ultimo = null;
  for (const modelName of cadeia) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent`;
    try {
      const resp = await postGemini(url, corpo, {
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        timeout: timeoutMs
      });
      return { ok: true, data: resp?.data, modeloUsado: modelName };
    } catch (e) {
      const erro = classificarErroGemini(e);
      ultimo = { ...erro, modelo: modelName };

      // SO' "modelo indisponivel" tenta o proximo da cadeia. Chave/limite/rede
      // falham na hora: insistir nos 8 modelos so' enche o log (era o bug — a
      // chave invalida e' HTTP 400 e era tratada como "modelo nao existe").
      if (erro.tipo === 'modelo') {
        console.warn(`[Gemini API] modelo "${modelName}" indisponível; tentando o próximo.`);
        continue;
      }
      return { ok: false, motivo: erro.tipo, detalhe: erro.detalhe, mensagem: erro.mensagem };
    }
  }

  // Esgotou a cadeia: nenhum modelo respondeu.
  return {
    ok: false,
    motivo: 'modelo_indisponivel',
    detalhe: ultimo?.detalhe || 'nenhum modelo da cadeia respondeu',
    mensagem: 'Nenhum modelo de IA disponível na conta.'
  };
}

// ========== FUNÇÃO PRINCIPAL (IA — provider Gemini) ==========
/**
 * A chamada de CONVERSA do bot — agora no **Groq** (a mesma API da call).
 *
 * ## Por que a troca
 *
 * O `!assistente` fala com a mesma Lizzy da call, e o dono pediu a MESMA API
 * tambem. Esta funcao e' o ponto unico por onde passam a assistente do chat e
 * mais 31 comandos (`!gemma`, `!resumir`, `!ideia`, `!translator`, `!debate`...),
 * entao trocar AQUI move todos de uma vez, sem tocar em call site nenhum.
 *
 * ## Por que o formato de retorno nao muda
 *
 * A API do Groq e' **compativel com a da OpenAI**, e o retorno ja vinha nessa
 * forma (`{ data: { choices: [{ message: { content } }] } }`). Os 32 consumidores
 * leem `response.data.choices[0].message.content` — manter a MESMA forma e' o
 * que permite a troca sem mexer em nenhum deles.
 *
 * ## Chave e modelo
 *
 * A chave e' a do `!keygroq` (`GROQ_API_KEY`). O `modelo` continua aceito na
 * assinatura por compatibilidade e e' **ignorado**: o modelo vem do
 * `groqClient` (`IAP_GROQ_LLM_MODEL`). Assim nenhum call site precisa mudar.
 *
 * @param {string} _modelo ignorado (compatibilidade com os call sites)
 * @param {string} texto
 * @param {string|null} [systemPrompt]
 * @param {Array<{role:string,content:string}>} [historico]
 * @returns {Promise<{data:{choices:Array<{message:{content:string}}>}}>}
 */
async function makeCognimaRequest(_modelo, texto, systemPrompt = null, historico = []) {
  if (!texto) {
    throw new Error('Parâmetros obrigatórios ausentes: modelo e texto');
  }
  // A chave pode estar CONFIGURADA e no limite (cota diaria). Dizer "nao
  // configurada" nesse caso faz o dono achar que o `!keygroq` falhou.
  const situacao = situacaoDasChaves();
  if (situacao === 'sem_chave') {
    throw new Error('Chave da IA não configurada. Use !keygroq para configurar.');
  }
  if (situacao === 'todas_esgotadas') {
    throw new Error('Todas as chaves do Groq atingiram o limite de hoje. Elas voltam à meia-noite (ou use !keygroq reset).');
  }

  // O teto do `groqChat` (220) e' de VOZ. Aqui e' TEXTO: 400 cabe uma resposta
  // normal no zap. (Era 900 — resposta de ensaio, e o OUTPUT gasta a mesma cota.)
  const maxTokens = Number.parseInt(process.env.IA_MAX_TOKENS || '400', 10);
  const r = await groqChat({ texto, sistema: systemPrompt || undefined, historico, maxTokens });
  if (!r.ok) {
    // O erro sobe como excecao: os 32 call sites ja' tratam com `.catch` e
    // `mensagemErroIA(e)`, que classifica pelo texto da mensagem.
    throw new Error(r.mensagem || r.detalhe || `Falha no Groq (${r.motivo}).`);
  }
  return { data: { choices: [{ index: 0, message: { role: 'assistant', content: r.texto }, finish_reason: 'stop' }] } };
}
function cleanWhatsAppFormatting(texto) {
  if (!texto || typeof texto !== 'string') return texto;
  return texto
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '*$1*')
    .replace(/\*\*\*([^*]+)\*\*\*/g, '*$1*')
    .replace(/_{2,}([^_]+)_{2,}/g, '_$1_')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '• ')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$2')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/**
 * SALVA o que der de um JSON que veio CORTADO (o `max_tokens` estoura no meio).
 *
 * ## O bug que isto corrige
 *
 * O modelo responde no formato `{ "resp": [ { "resp": "..." } ] }`. Quando a
 * resposta e' longa, o `max_tokens` CORTA o JSON no meio — e o `JSON.parse`
 * falha. O fallback antigo devolvia o **texto cru** (`{`, `"resp": [`, ...) e o
 * cliente recebia o JSON na tela. Foi o bug relatado pelo dono:
 *
 *   lizzy: {
 *    "resp": [
 *    {
 *    "resp": "sou a Lizzy, 21, moro no Acre, jogo volei, sou bissex
 *
 * Aqui a gente **aproveita as mensagens inteiras** e descarta so' a ultima
 * (cortada). Se nem uma mensagem inteira sobrou, devolve `null` — o chamador
 * pede a IA de novo em vez de vazar o JSON.
 *
 * @param {string} texto o conteudo (ja' sem os cercos de markdown)
 * @returns {{resp: Array<{resp: string, react?: string}>}|null}
 */
function salvarJSONTruncado(texto) {
  const t = String(texto || '');
  if (!t) return null;
  if (!/"?resp"?\s*:/.test(t)) return null;
  const itens = [];
  const re = /"resp"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(t)) !== null) {
    let valor = m[1];
    try { valor = JSON.parse(`"${valor}"`); } catch { /* usa o cru */ }
    const limpo = String(valor || '').replace(/\s+/g, ' ').trim();
    if (limpo && !/^[{}\[\],:]+$/.test(limpo)) itens.push({ resp: limpo });
  }
  if (!itens.length) return null;
  return { resp: itens, _truncado: true };
}

function extractJSON(content) {
  if (!content || typeof content !== 'string') {
    console.warn('Conteúdo inválido para extração de JSON, retornando objeto vazio.');
    return { resp: [{ resp: content }] };
  }

  // Remover blocos de código markdown de forma mais robusta
  let cleanContent = content.trim();
  
  // Remover todos os tipos de marcadores de código markdown
  cleanContent = cleanContent.replace(/^```json\s*/gim, '');
  cleanContent = cleanContent.replace(/^```javascript\s*/gim, '');
  cleanContent = cleanContent.replace(/^```\s*/gm, '');
  cleanContent = cleanContent.replace(/```\s*$/gm, '');
  cleanContent = cleanContent.trim();

  // Tentar extrair JSON diretamente
  try {
    const parsed = JSON.parse(cleanContent);
    return parsed;
  } catch (e) {
    // Se falhar, tentar corrigir problemas comuns
  }

  // Tentar encontrar o JSON dentro do texto usando regex mais específico
  const jsonMatch = cleanContent.match(/\{(?:[^{}]|(\{(?:[^{}]|\{[^{}]*\})*\}))*\}/s);
  
  if (jsonMatch) {
    let jsonString = jsonMatch[0];
    
    // Tentar corrigir quebras de linha dentro de strings JSON
    // Isso substitui quebras de linha literais por \n, mas apenas dentro de strings
    try {
      // Primeiro, vamos tentar um parse relaxado usando eval (cuidado!)
      // Substituir quebras de linha literais dentro de strings
      const fixedJson = jsonString.replace(/"([^"]*?)"/gs, (match, content) => {
        // Substituir quebras de linha dentro da string por \\n
        const fixed = content.replace(/\r?\n/g, '\\n');
        return `"${fixed}"`;
      });
      
      const parsed = JSON.parse(fixedJson);
      return parsed;
    } catch (e) {
      console.warn('Falha ao fazer parse do JSON encontrado:', e.message);
    }
  }

  console.error('❌ Não foi possível extrair JSON válido da resposta.');
  console.error('Conteúdo recebido (primeiros 200 chars):', content.substring(0, 200) + '...');

  // O JSON veio CORTADO (max_tokens)? Aproveita as mensagens INTEIRAS — e o
  // que evita o cliente receber `{ "resp": [ ...` na tela.
  const salvo = salvarJSONTruncado(cleanContent);
  if (salvo) {
    console.warn(`⚠️ JSON truncado: aproveitei ${salvo.resp.length} mensagem(ns) inteira(s).`);
    return salvo;
  }

  // O modelo RESPONDEU — so nao veio em JSON. A resposta DELE e melhor que
  // qualquer frase nossa: devolve o texto cru. Sem texto, sinaliza "nao
  // respondeu" (o chamador pede a IA de novo, em vez de frase pronta).
  const cru = String(content || '').trim();
  // NUNCA vaza um JSON quebrado: se o cru PARECE o nosso formato (`{`/`resp`),
  // e' truncamento — melhor pedir de novo do que mostrar `{ "resp": [` ao
  // usuario (o bug relatado pelo dono).
  if (cru && !/^\s*[\[{]/.test(cru) && !/"resp"\s*:/.test(cru)) {
    return { resp: [{ resp: cru }] };
  }
  return { resp: [], _semResposta: true };
}

function validateMessage(msg) {
  if (typeof msg === 'object' && msg !== null) {
    return {
      data_atual: msg.data_atual || getBrazilDateTime(),
      data_mensagem: msg.data_mensagem || getBrazilDateTime(),
      texto: String(msg.texto || '').trim(),
      id_enviou: String(msg.id_enviou || ''),
      nome_enviou: String(msg.nome_enviou || ''),
      id_grupo: String(msg.id_grupo || ''),
      nome_grupo: String(msg.nome_grupo || ''),
      tem_midia: Boolean(msg.tem_midia),
      marcou_mensagem: Boolean(msg.marcou_mensagem),
      marcou_sua_mensagem: Boolean(msg.marcou_sua_mensagem),
      mensagem_marcada: msg.mensagem_marcada || null,
      id_enviou_marcada: msg.id_enviou_marcada || null,
      tem_midia_marcada: Boolean(msg.tem_midia_marcada),
      id_mensagem: msg.id_mensagem || (() => {
        try {
          return crypto.randomBytes(8).toString('hex');
        } catch (error) {
          return Math.random().toString(16).substring(2, 18);
        }
      })()
    };
  }

  if (typeof msg === 'string') {
    const parts = msg.split('|');
    if (parts.length < 7) {
      throw new Error('Formato de mensagem inválido - poucos campos');
    }
    return {
      data_atual: parts[0] || getBrazilDateTime(),
      data_mensagem: parts[1] || getBrazilDateTime(),
      texto: String(parts[2] || '').trim(),
      id_enviou: String(parts[3] || ''),
      nome_enviou: String(parts[4] || ''),
      id_grupo: String(parts[5] || ''),
      nome_grupo: String(parts[6] || ''),
      tem_midia: parts[7] === 'true',
      marcou_mensagem: parts[8] === 'true',
      marcou_sua_mensagem: parts[9] === 'true',
      mensagem_marcada: parts[10] || null,
      id_enviou_marcada: parts[11] || null,
      tem_midia_marcada: parts[12] === 'true',
      id_mensagem: parts[13] || (() => {
        try {
          return crypto.randomBytes(8).toString('hex');
        } catch (error) {
          return Math.random().toString(16).substring(2, 18);
        }
      })()
    };
  }

  throw new Error('Formato de mensagem não suportado');
}

/**
 * Injeta no historico as mensagens que o GRUPO trocou e que NAO passaram pela
 * IA (as sem mencao) — o "olhar tudo" sem custo de token.
 *
 * ## Por que isto e' de graca
 *
 * O bot JA guarda toda mensagem no `messagesCache` (connect.js), antes do
 * handler. O historico, porem, so recebia o que passou pela IA (`updateHistorico`)
 * — entao quando a Lizzy era chamada, ela NAO via o que o grupo falou antes.
 * Era a causa do "ela nao tem contexto".
 *
 * Aqui as mensagens do cache entram no historico **uma unica vez cada** (o
 * `_vistosHistorico` evita duplicar): nenhuma chamada de IA acontece por isso.
 * O custo e' o de sempre — 1 requisicao quando ela RESPONDE.
 *
 * @param {object} p
 * @param {string} p.grupoUserId a chave da memoria
 * @param {Array<{id:string, texto:string, nome:string, fromMe:boolean}>} p.mensagens
 * @returns {number} quantas entraram
 */
function absorverContextoDoGrupo({ grupoUserId, mensagens = [] } = {}) {
  if (!grupoUserId || !Array.isArray(mensagens) || !mensagens.length) return 0;
  if (!historico[grupoUserId]) historico[grupoUserId] = [];
  if (!_vistosHistorico.has(grupoUserId)) _vistosHistorico.set(grupoUserId, new Set());
  const vistos = _vistosHistorico.get(grupoUserId);
  let entraram = 0;
  for (const m of mensagens) {
    const id = String(m?.id || '').trim();
    const texto = String(m?.texto || '').trim();
    if (!id || !texto || vistos.has(id)) continue;
    vistos.add(id);
    // O nome de quem falou vai junto: sem ele, ela ve' um texto solto e nao
    // sabe quem disse (o mesmo problema do nome resolvido).
    const quem = String(m?.nome || '').trim();
    const conteudo = m?.fromMe ? `[voce] ${texto}` : (quem ? `[${quem}] ${texto}` : texto);
    historico[grupoUserId].push({
      role: m?.fromMe ? 'assistant' : 'user',
      content: cleanWhatsAppFormatting(conteudo),
      timestamp: Number(m?.ts) || Date.now()
    });
    entraram += 1;
  }
  if (entraram) {
    // O mesmo teto do historico normal.
    const limite = Math.max(4, Number.parseInt(process.env.IA_HISTORICO || '16', 10) || 16);
    if (historico[grupoUserId].length > limite) {
      historico[grupoUserId] = historico[grupoUserId].slice(-limite);
    }
    // O `vistos` nao pode crescer sem teto.
    if (vistos.size > 400) {
      const sobrando = [...vistos].slice(-200);
      _vistosHistorico.set(grupoUserId, new Set(sobrando));
    }
  }
  return entraram;
}

function updateHistorico(grupoUserId, role, content, nome = null) {
  if (!historico[grupoUserId]) {
    historico[grupoUserId] = [];
  }
  
  // `role`/`content` sao o que o modelo consome (formato Gemini/OpenAI). O
  // `timestamp` NAO vai para o modelo — ele existe para a LIMPEZA saber quando
  // a conversa parou. Sem ele, `clearOldHistorico` lia `undefined` e o
  // `!iaclear` respondia "limpo!" sem apagar NADA.
  const entry = {
    role,
    content: cleanWhatsAppFormatting(content),
    timestamp: Date.now()
  };
  
  historico[grupoUserId].push(entry);
  
  // A MEMORIA da conversa. Era 12 mensagens (6 idas e voltas) — curto demais
  // para ela "lembrar" do que foi dito: era a causa do "nao e inteligente" e da
  // pergunta do sexo repetida (ela esquecia a resposta). Agora sao 40 (~20
  // turnos), configuravel por `IA_HISTORICO`.
  // Era 40 mensagens. O historico ia inteiro em toda chamada e so' crescia;
  // 16 (~8 turnos) e' o suficiente para "lembrar do que foi dito" sem pagar
  // 40 mensagens de input por resposta. Configuravel.
  const limiteHistorico = Math.max(4, Number.parseInt(process.env.IA_HISTORICO || '16', 10) || 16);
  if (historico[grupoUserId].length > limiteHistorico) {
    historico[grupoUserId] = historico[grupoUserId].slice(-limiteHistorico);
  }
}

// Sistema de gerenciamento de estado da conversa
function updateConversationState(grupoUserId, state, data = {}) {
  if (!conversationStates[grupoUserId]) {
    conversationStates[grupoUserId] = {
      currentState: 'idle',
      previousStates: [],
      context: {},
      sessionStart: Date.now(),
      lastActivity: Date.now()
    };
  }
  
  const currentState = conversationStates[grupoUserId];
  currentState.previousStates.push(currentState.currentState);
  currentState.currentState = state;
  currentState.context = { ...currentState.context, ...data };
  currentState.lastActivity = Date.now();
  
  // Man histórico de estados
  if (currentState.previousStates.length > 5) {
    currentState.previousStates = currentState.previousStates.slice(-5);
  }
}

function getConversationState(grupoUserId) {
  return conversationStates[grupoUserId] || {
    currentState: 'idle',
    previousStates: [],
    context: {},
    sessionStart: Date.now(),
    lastActivity: Date.now()
  };
}

function updateUserPreferences(grupoUserId, preference, value) {
  if (!userPreferences[grupoUserId]) {
    userPreferences[grupoUserId] = {
      language: 'pt-BR',
      formality: 'casual',
      emojiUsage: 'high',
      topics: [],
      mood: 'neutral',
      lastInteraction: Date.now()
    };
  }
  
  userPreferences[grupoUserId][preference] = value;
  userPreferences[grupoUserId].lastInteraction = Date.now();
  
  // Atualizar tópicos de interesse
  if (preference === 'topic') {
    if (!userPreferences[grupoUserId].topics.includes(value)) {
      userPreferences[grupoUserId].topics.push(value);
      if (userPreferences[grupoUserId].topics.length > 10) {
        userPreferences[grupoUserId].topics = userPreferences[grupoUserId].topics.slice(-10);
      }
    }
  }
}

function getUserPreferences(grupoUserId) {
  return userPreferences[grupoUserId] || {
    language: 'pt-BR',
    formality: 'casual',
    emojiUsage: 'high',
    topics: [],
    mood: 'neutral',
    lastInteraction: Date.now()
  };
}

function trackUserInteraction(grupoUserId, interactionType, details = {}) {
  if (!userInteractions[grupoUserId]) {
    userInteractions[grupoUserId] = {
      totalInteractions: 0,
      interactionTypes: {},
      favoriteTopics: {},
      lastTopics: [],
      sentiment: 'neutral',
      sessionStats: {
        startTime: Date.now(),
        messagesCount: 0,
        commandsUsed: 0
      }
    };
  }
  
  const interactions = userInteractions[grupoUserId];
  interactions.totalInteractions++;
  interactions.sessionStats.messagesCount++;
  
  if (!interactions.interactionTypes[interactionType]) {
    interactions.interactionTypes[interactionType] = 0;
  }
  interactions.interactionTypes[interactionType]++;
  
  // Atualizar tópicos recentes
  if (details.topic) {
    interactions.lastTopics.push(details.topic);
    if (interactions.lastTopics.length > 5) {
      interactions.lastTopics = interactions.lastTopics.slice(-5);
    }
    
    // Atualizar tópicos favoritos
    if (!interactions.favoriteTopics[details.topic]) {
      interactions.favoriteTopics[details.topic] = 0;
    }
    interactions.favoriteTopics[details.topic]++;
  }
  
  interactions.sessionStats.lastUpdate = Date.now();
}

function getUserInteractionStats(grupoUserId) {
  return userInteractions[grupoUserId] || {
    totalInteractions: 0,
    interactionTypes: {},
    favoriteTopics: {},
    lastTopics: [],
    sentiment: 'neutral',
    sessionStats: {
      startTime: Date.now(),
      messagesCount: 0,
      commandsUsed: 0,
      lastUpdate: Date.now()
    }
  };
}

// Função para limpar dados antigos
function clearConversationData(maxAge = 7 * 24 * 60 * 60 * 1000) {
  const now = Date.now();
  const maxAgeMs = maxAge;
  
  // Limpar histórico de conversas
  Object.keys(historico).forEach(grupoUserId => {
    const conversa = historico[grupoUserId];
    if (conversa.length > 0) {
      const lastMsg = conversa[conversa.length - 1];
      const lastMsgTime = new Date(lastMsg.timestamp).getTime();
      
      if (now - lastMsgTime > maxAgeMs) {
        delete historico[grupoUserId];
      }
    }
  });
  
  // Limpar estados de conversa
  Object.keys(conversationStates).forEach(grupoUserId => {
    const state = conversationStates[grupoUserId];
    if (now - state.lastActivity > maxAgeMs) {
      delete conversationStates[grupoUserId];
    }
  });
  
  // Limpar preferências do usuário
  Object.keys(userPreferences).forEach(grupoUserId => {
    const pref = userPreferences[grupoUserId];
    if (now - pref.lastInteraction > maxAgeMs) {
      delete userPreferences[grupoUserId];
    }
  });
  
  // Limpiar estatísticas de interação
  Object.keys(userInteractions).forEach(grupoUserId => {
    const interaction = userInteractions[grupoUserId];
    if (now - interaction.sessionStats.lastUpdate > maxAgeMs) {
      delete userInteractions[grupoUserId];
    }
  });
}

/**
 * Monta o bloco de CONTEXTO da conversa para o prompt.
 *
 * ## Por que aqui (e nao no handler)
 *
 * Quem tem o socket e o metadata e' o `index.js` — ele **coleta** e passa em
 * `extraContext`. A **montagem do texto** fica aqui, pura, para poder ser
 * testada sem abrir conexao (o `index.js` tem 36k linhas e abre socket no
 * import).
 *
 * O que entra:
 *   - quem esta' falando (nome resolvido do JID/agenda pelo handler);
 *   - quem e' o DONO do bot (e se e' ele falando);
 *   - os DADOS DO GRUPO: nome, dono, admins, quando foi criado, total.
 *
 * Tudo opcional: campo sem dado simplesmente nao aparece — melhor faltar uma
 * linha do que a Lizzy dizer um nome/numero que nao existe.
 *
 * @param {object} [ctx]
 * @returns {string} o bloco, ou '' quando nao ha nada a dizer
 */
/**
 * O prompt de sistema da assistente do chat.
 *
 * **Personalidade única**: `promptDaLizzy()` (o mesmo que a call usa) mais as
 * regras de formato do CHAT. Não há mais escolha por grupo — o dono pediu uma
 * Lizzy só, para todos os grupos.
 *
 * O parâmetro `personalidade` é aceito e **ignorado** de propósito: os grupos
 * que já tinham `assistentePersonality` salvo continuam funcionando, e o campo
 * deixa de ter efeito em vez de quebrar quem o tem.
 *
 * @returns {string}
 */
function promptDaPersonalidade(extraContext = {}) {
  // Aceita string por compatibilidade (chamadas antigas passavam a
  // personalidade) — nesse caso nao ha contexto a montar.
  const ctx = (extraContext && typeof extraContext === 'object') ? extraContext : {};
  const contexto = montarContextoDaConversa(ctx);
  // Os PAIS ADOTIVOS vem resolvidos do handler (o config so' tem o LID).
  return [
    promptDaLizzy({ paisAdotivos: ctx.paisAdotivos }),
    '', regrasDeCanal('chat'),
    contexto ? '\n' + contexto : ''
  ].join('\n');
}

/**
 * A RESPOSTA NATURAL — o fallback SEM frase pronta.
 *
 * ## O pedido do dono
 *
 * *"eu nao quero frases para o sem resposta, quero que a IA faca isso ... quero
 * a IA pura"*. Ou seja: quando o caminho normal nao devolveu nada, a resposta
 * NAO pode ser uma frase nossa de uma lista — tem de sair do MODELO.
 *
 * ## Como
 *
 * Uma segunda chamada, **curta e barata** (system minimo + a fala da pessoa,
 * sem o prompt de personalidade inteiro nem historico), pedindo so' a reacao.
 * O `maxTokens` e' pequeno: e' uma reacao, nao um texto.
 *
 * ## Quando NAO responde nada
 *
 * Se esta chamada tambem falhar (mesma cota/rede), devolve `null`. Ai' o
 * chamador decide — e o bot NAO inventa uma frase: fica em silencio em vez de
 * mentir com texto pre-fabricado.
 *
 * @param {object} p
 * @param {string} p.texto o que a pessoa mandou
 * @param {string} [p.nome] nome de quem falou (para o modelo chamar pelo nome)
 * @param {string} [p.motivo] `'formato'` (o modelo respondeu fora do JSON) ou
 *   `'falha'` (a chamada principal falhou)
 * @param {number} [p.maxTokens]
 * @returns {Promise<string|null>}
 */
async function respostaNatural({ texto, nome, motivo = 'falha', maxTokens = 80 } = {}) {
  const fala = String(texto || '').trim();
  if (!fala) return null;
  const sistema = [
    'Voce e a Lizzy, uma pessoa real conversando no WhatsApp.',
    'A sua resposta anterior nao chegou. Reaja a ultima mensagem da pessoa em',
    'UMA linha curta, no seu jeito (sem emoji, sem asterisco, minusculas).',
    'Nao explique nada, nao peca desculpa por erro tecnico e nao diga que e IA:',
    'so converse, como se nada tivesse acontecido.'
  ].join(' ');
  try {
    const r = await groqChat({
      texto: fala,
      sistema,
      historico: [],
      maxTokens,
      temperatura: 0.9
    });
    if (r?.ok && r.texto && String(r.texto).trim()) return String(r.texto).trim();
    return null;
  } catch {
    return null;
  }
}

async function processUserMessages(data, nazu = null, ownerNumber = null, personality = 'abyss') {
  try {
    const { mensagens, extraContext = {} } = data;
    if (!mensagens || !Array.isArray(mensagens)) {
      throw new Error('Mensagens são obrigatórias e devem ser um array');
    }
    // NOTE: parâmetro `key` é ignorado aqui; `IA_API_KEY` é usado internamente nas requisições.

    const mensagensValidadas = [];
    for (let i = 0; i < mensagens.length; i++) {
      try {
        const msgValidada = validateMessage(mensagens[i]);
        mensagensValidadas.push(msgValidada);
      } catch (msgError) {
        console.warn(`Erro ao processar mensagem ${i}:`, msgError.message);
        continue;
      }
    }

    if (mensagensValidadas.length === 0) {
      return { resp: [], erro: 'Nenhuma mensagem válida para processar' };
    }

    const respostas = [];
    
    // Obter informações dinâmicas do bot
    const botInfo = getDynamicBotInfo();
    
    // Contexto temporal - usando horário do Brasil
    const now = new Date();
    const brazilTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    const hour = brazilTime.getHours();
    const isNightTime = hour >= 18 || hour < 6;
    
    for (const msgValidada of mensagensValidadas) {
      // A MEMORIA e' POR GRUPO (pedido do dono): `grupo|usuario|personalidade`.
      // O grupo vem do `extraContext` (o handler manda `from`) ou da propria
      // mensagem. Em PV nao ha' grupo — cai no JID da conversa (isolado por
      // pessoa, sem memoria compartilhada entre desconhecidos).
      const idGrupo = extraContext.groupId || msgValidada.id_grupo || '';
      const userId = chaveDaMemoria({
        idGrupo,
        idUsuario: msgValidada.id_enviou,
        personalidade: personality
      });
      
      // Registrar interação
      userContextDB.registerInteraction(userId, msgValidada.texto);
      userContextDB.updateUserInfo(userId, msgValidada.nome_enviou);
      
      // Obter contexto do usuário
      const userContext = userContextDB.getUserContextSummary(userId);
      
      // O "OLHAR TUDO" (custo 0 token): as mensagens que o grupo trocou e que
      // NAO passaram pela IA entram no historico antes da resposta. E' o que faz
      // ela saber o que rolou — sem pagar requisicao por mensagem lida.
      try {
        if (Array.isArray(extraContext.contextoDoGrupo) && extraContext.contextoDoGrupo.length) {
          absorverContextoDoGrupo({ grupoUserId: userId, mensagens: extraContext.contextoDoGrupo });
        }
      } catch { /* sem contexto: segue com o historico normal */ }

      updateHistorico(userId, 'user', msgValidada.texto, msgValidada.nome_enviou);
      
      // Selecionar o prompt baseado na personalidade
      let selectedPrompt = promptDaPersonalidade(extraContext);
      
      // Substituir variáveis dinâmicas no prompt
      selectedPrompt = replaceDynamicVariables(selectedPrompt, {
        nomeGrupo: extraContext.groupName || msgValidada.nome_grupo || '',
        groupName: extraContext.groupName || msgValidada.nome_grupo || ''
      });
      
      // Contexto expandido com informações do bot e grupo
      const contextoExpandido = {
        // Informações do bot
        nome_bot: botInfo.nomeBot,
        nome_dono: botInfo.nomeDono,
        numero_dono: botInfo.numeroDono,
        prefixo: botInfo.prefixo,
        // Informações do grupo
        nome_grupo: extraContext.groupName || msgValidada.nome_grupo || '',
        id_grupo: extraContext.groupId || msgValidada.id_grupo || '',
        // Informações do usuário
        nome_usuario: msgValidada.nome_enviou,
        id_usuario: msgValidada.id_enviou,
        // Informações temporais
        horario: hour,
        noite: isNightTime,
        data: brazilTime.toLocaleDateString('pt-BR'),
        dia_semana: brazilTime.toLocaleDateString('pt-BR', { weekday: 'long' }),
        data_hora: getFormattedBrazilDateTime(),
        // Ambiente
        plataforma: 'WhatsApp'
      };
      
      // O caminho `pro` (interpretar e EXECUTAR comando) saiu com as
      // personalidades: so' existia quando a personalidade era `pro`. A
      // execucao por fala continua no `!iap` (`iapComandos.js`).
      // O `historico` NAO entra aqui: ele ja' vai como MENSAGENS no
      // `makeCognimaRequest` (3o argumento). Mandar nos dois lugares pagava o
      // historico DUAS VEZES em tokens — e o TPM gratis do Groq e' 8000/min.
      const userInput = {
        mensagem_atual: msgValidada.texto,
        nome_usuario: msgValidada.nome_enviou,
        userContext: userContext,
        contexto_temporal: {
          horario: hour,
          noite: isNightTime,
          data: brazilTime.toLocaleDateString('pt-BR'),
          diaSemana: brazilTime.toLocaleDateString('pt-BR', { weekday: 'long' })
        },
        contexto_bot: {
          nome: botInfo.nomeBot,
          nome_dono: botInfo.nomeDono,
          numero_dono: botInfo.numeroDono,
          prefixo: botInfo.prefixo
        },
        contexto_grupo: {
          nome: extraContext.groupName || msgValidada.nome_grupo || '',
          id: extraContext.groupId || msgValidada.id_grupo || ''
        }
      };

      let result;
      try {
        // Chamada única para processamento com contexto
        const response = (await makeCognimaRequest(
          GEMINI_DEFAULT_MODEL,
          JSON.stringify(userInput),
          selectedPrompt,
          historico[userId] || []
        )).data;

        if (!response || !response.choices || !response.choices[0]) {
          throw new Error("Resposta da API Cognima foi inválida ou vazia.");
        }

        const content = response.choices[0].message.content;
        result = extractJSON(content);
        


        // Processar aprendizado se houver (suporta objeto único ou array)
        if (result.aprender) {
          if (Array.isArray(result.aprender)) {
            // Múltiplos aprendizados de uma vez
            result.aprender.forEach(aprend => {
              processLearning(userId, aprend, msgValidada.texto);
            });
          } else {
            // Aprendizado único
            processLearning(userId, result.aprender, msgValidada.texto);
          }
        }

        // Processar respostas
        // Verificar se result.resp existe e é um array válido
        if (result && result.resp && Array.isArray(result.resp) && result.resp.length > 0) {
          result.resp.forEach(resposta => {
            // Garantir que a resposta tem a estrutura esperada
            if (resposta && typeof resposta === 'object') {
              // Se resposta.resp existe e é string válida
              if (resposta.resp && typeof resposta.resp === 'string' && resposta.resp.trim().length > 0) {
                resposta.resp = cleanWhatsAppFormatting(resposta.resp);
                updateHistorico(userId, 'assistant', resposta.resp);
                
                // Garantir que tem react
                // O EMOJI DE REACAO SAIU (pedido do dono: "deixam ela com muita
                // cara de IA"). Antes TODA resposta ganhava um emoji aleatorio
                // do `getAbyssReact` -- no WhatsApp isso vira uma carinha em
                // cima de cada mensagem, que e' o comportamento mais robotico
                // possivel. Agora a reacao so' sai se o MODELO pedir (o campo
                // `react` do JSON), e ele foi instruido a quase nunca usar.
                if (resposta.react) {
                  resposta.react = String(resposta.react).replaceAll(' ', '').replaceAll('\n', '');
                  if (!resposta.react) delete resposta.react;
                }
                
                respostas.push(resposta);
              }
              // Se a resposta tem outro formato (ex: só texto direto no objeto)
              else if (resposta.text && typeof resposta.text === 'string' && resposta.text.trim().length > 0) {
                respostas.push({
                  resp: cleanWhatsAppFormatting(resposta.text),
                  react: resposta.react || undefined
                });
              }
            }
            // Se a resposta é uma string diretamente
            else if (typeof resposta === 'string' && resposta.trim().length > 0) {
              respostas.push({
                resp: cleanWhatsAppFormatting(resposta)
              });
            }
          });
        } 
        // Se não tem respostas válidas, tentar criar uma resposta padrão
        else {
          console.warn(`⚠️ [${personality}] Resposta da IA não tem formato esperado:`, JSON.stringify(result).substring(0, 300));
          
          // Tentar diferentes formatos de fallback
          if (result && result.resp && typeof result.resp === 'string' && result.resp.trim().length > 0) {
            respostas.push({
              resp: cleanWhatsAppFormatting(result.resp)
            });
          } else if (result && result.message && typeof result.message === 'string' && result.message.trim().length > 0) {
            respostas.push({
              resp: cleanWhatsAppFormatting(result.message)
            });
          } else if (result && result.text && typeof result.text === 'string' && result.text.trim().length > 0) {
            respostas.push({
              resp: cleanWhatsAppFormatting(result.text)
            });
          } else if (typeof result === 'string' && result.trim().length > 0) {
            respostas.push({
              resp: cleanWhatsAppFormatting(result)
            });
          } else {
            console.error(`❌ [${personality}] Não foi possível extrair resposta válida do resultado`);
          }
        }
      } catch (apiError) {
        console.error('Erro na API Cognima:', apiError.message);
        
        // NAO devolve frase pronta: sinaliza a falha e o chamador PEDE A IA
        // (segunda chamada, mais simples) para ela responder com as palavras dela.
        return { resp: [], erro: 'Erro temporario', _semResposta: true, _falhou: true };
      }
    }

    // Nada aproveitavel? Pede a REACAO ao modelo (sem frase pronta) e devolve
    // como resposta. Sem isso, o handler nao teria o que mandar.
    if (!respostas.length) {
      const ultima = mensagensValidadas[mensagensValidadas.length - 1] || {};
      const natural = await respostaNatural({
        texto: ultima.texto || '',
        nome: ultima.nome_enviou || undefined,
        motivo: 'formato'
      });
      if (natural) respostas.push({ resp: cleanWhatsAppFormatting(natural) });
    }
    return { resp: respostas };

  } catch (error) {
    console.error('Erro fatal ao processar mensagens:', error);
    // Ultima tentativa: a REACAO do modelo (curta e barata). Se nem isso, o
    // chamador decide — e o bot NAO inventa frase pronta.
    try {
      const lista = Array.isArray(data?.mensagens) ? data.mensagens : [];
      const ultima = lista[lista.length - 1] || {};
      const natural = await respostaNatural({ texto: ultima.texto || '', nome: ultima.nome_enviou || undefined });
      if (natural) return { resp: [{ resp: cleanWhatsAppFormatting(natural) }] };
    } catch { /* segue sem resposta */ }
    return { resp: [], erro: 'Erro interno do processamento', _semResposta: true, _falhou: true };
  }
}

/**
 * Processa o aprendizado da IA sobre o usuário
 */
function processLearning(grupoUserId, aprender, mensagemOriginal) {
  try {
    const { tipo, valor, contexto, acao, valor_antigo } = aprender;
    
    if (!tipo || !valor) {
      console.warn('⚠️ Aprendizado inválido (faltam campos):', aprender);
      return;
    }
    
    // Normalizar o tipo para lowercase para evitar problemas de case
    const tipoNormalizado = tipo.toLowerCase().trim();
    
    // Ações suportadas: adicionar (padrão), editar, excluir
    const acaoNormalizada = (acao || 'adicionar').toLowerCase().trim();
    
    // Processar EDIÇÃO de memória
    if (acaoNormalizada === 'editar' || acaoNormalizada === 'atualizar' || acaoNormalizada === 'modificar') {
      if (!valor_antigo) {
        console.warn('⚠️ Ação de edição precisa do campo "valor_antigo"');
        return;
      }
      
      const sucesso = userContextDB.updateMemory(grupoUserId, tipoNormalizado, valor_antigo, valor);
      
      if (!(sucesso)) {
        console.warn(`⚠️ Abyss não encontrou "${valor_antigo}" em ${tipo} para editar`);
      }
      return;
    }
    
    // Processar EXCLUSÃO de memória
    if (acaoNormalizada === 'excluir' || acaoNormalizada === 'remover' || acaoNormalizada === 'deletar') {
      const sucesso = userContextDB.deleteMemory(grupoUserId, tipoNormalizado, valor);
      
      if (!(sucesso)) {
        console.warn(`⚠️ Abyss não encontrou "${valor}" em ${tipo} para excluir`);
      }
      return;
    }
    
    // Processar ADIÇÃO de memória (padrão)
    
    switch (tipoNormalizado) {
      case 'gosto':
      case 'gostos':
        userContextDB.addUserPreference(grupoUserId, 'gostos', valor);
        break;
        
      case 'nao_gosto':
      case 'nao_gostos':
      case 'não_gosto':
      case 'não_gostos':
        userContextDB.addUserPreference(grupoUserId, 'nao_gostos', valor);
        break;
        
      case 'hobby':
      case 'hobbies':
        userContextDB.addUserPreference(grupoUserId, 'hobbies', valor);
        break;
        
      case 'assunto_favorito':
      case 'assuntos_favoritos':
      case 'assunto':
      case 'topico':
      case 'tópico':
        userContextDB.addUserPreference(grupoUserId, 'assuntos_favoritos', valor);
        userContextDB.addRecentTopic(grupoUserId, valor);
        break;
        
      case 'nota_importante':
      case 'nota':
      case 'informacao_importante':
      case 'informação_importante':
      case 'lembrete':
        userContextDB.addImportantNote(grupoUserId, valor);
        break;
        
      case 'memoria_especial':
      case 'memoria':
      case 'memória_especial':
      case 'memória':
      case 'momento_especial':
        userContextDB.addSpecialMemory(grupoUserId, valor);
        break;
        
      case 'nome':
        // Atualizar o nome do usuário
        userContextDB.updateUserInfo(grupoUserId, valor, null);
        break;
        
      case 'apelido':
      case 'apelidos':
      case 'nickname':
        // Adicionar apelido
        userContextDB.updateUserInfo(grupoUserId, null, valor);
        break;
        
      case 'idade':
        userContextDB.updatePersonalInfo(grupoUserId, 'idade', valor);
        break;
        
      case 'localizacao':
      case 'localização':
      case 'local':
      case 'cidade':
      case 'lugar':
        userContextDB.updatePersonalInfo(grupoUserId, 'localizacao', valor);
        break;
        
      case 'profissao':
      case 'profissão':
      case 'trabalho':
      case 'emprego':
      case 'ocupacao':
      case 'ocupação':
        userContextDB.updatePersonalInfo(grupoUserId, 'profissao', valor);
        break;
        
      case 'relacionamento':
      case 'status_relacionamento':
      case 'status':
        userContextDB.updatePersonalInfo(grupoUserId, 'relacionamento', valor);
        break;
        
      case 'familia':
      case 'família':
      case 'parente':
      case 'parentes':
        // Adicionar membro da família
        const contextoAtual = userContextDB.getUserContext(grupoUserId);
        if (!contextoAtual.informacoes_pessoais.familia.includes(valor)) {
          contextoAtual.informacoes_pessoais.familia.push(valor);
          userContextDB.data[grupoUserId] = contextoAtual;
          userContextDB.saveDatabase();
        }
        break;
        
      case 'info_pessoal':
      case 'informacao_pessoal':
      case 'informação_pessoal':
        // Tentar identificar o campo correto baseado no contexto
        const camposValidos = ['idade', 'localizacao', 'profissao', 'relacionamento'];
        const campo = contexto ? contexto.toLowerCase() : null;
        
        if (campo && camposValidos.includes(campo)) {
          userContextDB.updatePersonalInfo(grupoUserId, campo, valor);
        } else {
          // Se não souber o campo, adicionar como nota importante
          userContextDB.addImportantNote(grupoUserId, valor);
        }
        break;
        
      case 'sentimento':
      case 'humor':
      case 'mood':
      case 'estado_emocional':
        // Atualizar humor comum do usuário
        const userContext = userContextDB.getUserContext(grupoUserId);
        userContext.padroes_comportamento.humor_comum = valor;
        userContextDB.data[grupoUserId] = userContext;
        userContextDB.saveDatabase();
        break;
        
      case 'estilo_conversa':
      case 'estilo':
      case 'jeito':
        // Atualizar estilo de conversa
        const userCtx = userContextDB.getUserContext(grupoUserId);
        userCtx.preferencias.estilo_conversa = valor;
        userContextDB.data[grupoUserId] = userCtx;
        userContextDB.saveDatabase();
        break;
        
      // NOVOS TIPOS DE APRENDIZADO
      case 'sonho':
      case 'sonhos':
      case 'objetivo':
      case 'objetivos':
      case 'meta':
      case 'metas':
      case 'aspiracao':
      case 'aspiração':
        userContextDB.addImportantNote(grupoUserId, `[SONHO/OBJETIVO] ${valor}`);
        break;
        
      case 'medo':
      case 'medos':
      case 'fobia':
      case 'fobias':
      case 'receio':
        userContextDB.addImportantNote(grupoUserId, `[MEDO] ${valor}`);
        break;
        
      case 'rotina':
      case 'habito':
      case 'hábito':
      case 'costume':
        userContextDB.addImportantNote(grupoUserId, `[ROTINA] ${valor}`);
        break;
        
      case 'pet':
      case 'animal':
      case 'animal_estimacao':
      case 'animal_de_estimação':
        userContextDB.addImportantNote(grupoUserId, `[PET] ${valor}`);
        break;
        
      case 'musica':
      case 'música':
      case 'musica_favorita':
      case 'banda':
      case 'artista':
        userContextDB.addUserPreference(grupoUserId, 'gostos', `[MÚSICA] ${valor}`);
        break;
        
      case 'filme':
      case 'filmes':
      case 'serie':
      case 'série':
      case 'anime':
        userContextDB.addUserPreference(grupoUserId, 'gostos', `[FILME/SÉRIE] ${valor}`);
        break;
        
      case 'jogo':
      case 'jogos':
      case 'game':
      case 'games':
        userContextDB.addUserPreference(grupoUserId, 'gostos', `[JOGO] ${valor}`);
        break;
        
      case 'comida':
      case 'comida_favorita':
      case 'prato':
      case 'culinaria':
      case 'culinária':
        userContextDB.addUserPreference(grupoUserId, 'gostos', `[COMIDA] ${valor}`);
        break;
        
      case 'bebida':
      case 'bebida_favorita':
      case 'drink':
        userContextDB.addUserPreference(grupoUserId, 'gostos', `[BEBIDA] ${valor}`);
        break;
        
      case 'cor':
      case 'cor_favorita':
      case 'cores':
        userContextDB.addUserPreference(grupoUserId, 'gostos', `[COR] ${valor}`);
        break;
        
      case 'esporte':
      case 'esportes':
      case 'time':
      case 'time_futebol':
      case 'clube':
        userContextDB.addUserPreference(grupoUserId, 'gostos', `[ESPORTE] ${valor}`);
        break;
        
      case 'livro':
      case 'livros':
      case 'autor':
      case 'leitura':
        userContextDB.addUserPreference(grupoUserId, 'gostos', `[LIVRO] ${valor}`);
        break;
        
      case 'viagem':
      case 'viagens':
      case 'lugar_visitado':
      case 'destino':
        userContextDB.addImportantNote(grupoUserId, `[VIAGEM] ${valor}`);
        break;
        
      case 'estudo':
      case 'estudos':
      case 'curso':
      case 'faculdade':
      case 'universidade':
      case 'formacao':
      case 'formação':
        userContextDB.updatePersonalInfo(grupoUserId, 'profissao', `${valor} (estudante)`);
        break;
        
      case 'idioma':
      case 'idiomas':
      case 'lingua':
      case 'língua':
        userContextDB.addImportantNote(grupoUserId, `[IDIOMA] ${valor}`);
        break;
        
      case 'talento':
      case 'habilidade':
      case 'skill':
      case 'dom':
        userContextDB.addImportantNote(grupoUserId, `[TALENTO] ${valor}`);
        break;
        
      case 'problema':
      case 'dificuldade':
      case 'desafio':
      case 'preocupacao':
      case 'preocupação':
        userContextDB.addImportantNote(grupoUserId, `[PROBLEMA] ${valor}`);
        break;
        
      case 'conquista':
      case 'realizacao':
      case 'realização':
      case 'vitoria':
      case 'vitória':
      case 'sucesso':
        userContextDB.addSpecialMemory(grupoUserId, `[CONQUISTA] ${valor}`);
        break;
        
      case 'aniversario':
      case 'aniversário':
      case 'data_nascimento':
      case 'birthday':
        userContextDB.addImportantNote(grupoUserId, `[ANIVERSÁRIO] ${valor}`);
        break;
        
      case 'signo':
      case 'zodiaco':
      case 'zodíaco':
        userContextDB.addImportantNote(grupoUserId, `[SIGNO] ${valor}`);
        break;
        
      case 'personalidade':
      case 'jeito_de_ser':
      case 'caracteristica':
      case 'característica':
        userContextDB.addImportantNote(grupoUserId, `[PERSONALIDADE] ${valor}`);
        break;
        
      case 'saude':
      case 'saúde':
      case 'condicao':
      case 'condição':
      case 'alergia':
        userContextDB.addImportantNote(grupoUserId, `[SAÚDE] ${valor}`);
        break;
        
      case 'plano':
      case 'planos':
      case 'intencao':
      case 'intenção':
      case 'futuro':
        userContextDB.addImportantNote(grupoUserId, `[PLANOS] ${valor}`);
        break;
        
      default:
        // Sistema inteligente para tipos não pré-definidos
        console.warn(`⚠️ Tipo de aprendizado não reconhecido: "${tipo}"`);
        
        // Tentar categorizar automaticamente baseado no tipo
        const tipoLower = tipoNormalizado;
        
        // Tentar identificar se é uma preferência (contém palavras-chave)
        if (tipoLower.includes('gost') || tipoLower.includes('adora') || tipoLower.includes('ama') || 
            tipoLower.includes('prefere') || tipoLower.includes('curte')) {
          userContextDB.addUserPreference(grupoUserId, 'gostos', `[${tipo}] ${valor}`);
        }
        // Tentar identificar se é algo que não gosta
        else if (tipoLower.includes('odeia') || tipoLower.includes('detesta') || 
                 tipoLower.includes('nao_gosta') || tipoLower.includes('desgosto')) {
          userContextDB.addUserPreference(grupoUserId, 'nao_gostos', `[${tipo}] ${valor}`);
        }
        // Tentar identificar se é uma atividade/hobby
        else if (tipoLower.includes('atividade') || tipoLower.includes('faz') || 
                 tipoLower.includes('pratica') || tipoLower.includes('joga')) {
          userContextDB.addUserPreference(grupoUserId, 'hobbies', `[${tipo}] ${valor}`);
        }
        // Tentar identificar se é informação pessoal
        else if (tipoLower.includes('pessoal') || tipoLower.includes('info') || 
                 tipoLower.includes('dado') || tipoLower.includes('caracteristica')) {
          // Criar um campo personalizado nas informações pessoais
          const userCtx = userContextDB.getUserContext(grupoUserId);
          if (!userCtx.informacoes_pessoais.outros) {
            userCtx.informacoes_pessoais.outros = {};
          }
          userCtx.informacoes_pessoais.outros[tipo] = valor;
          userContextDB.data[grupoUserId] = userCtx;
          userContextDB.saveDatabase();
        }
        // Se não conseguir categorizar, salvar como nota importante com o tipo original
        else {
          userContextDB.addImportantNote(grupoUserId, `[${tipo}] ${valor}`);
        }
    }
  } catch (error) {
    console.error('❌ Erro ao processar aprendizado:', error);
    console.error('Dados do aprendizado:', aprender);
  }
}

// (As funcoes de frase pronta da era 'Abyss' foram REMOVIDAS: o dono pediu
//  IA pura, sem frases pre-definidas. A personalidade vive no PROMPT —
//  identidadeLizzy.js / iapGuarda.js — e quem responde e' sempre o modelo.)

function getHistoricoStats() {
  const stats = {
    totalConversas: Object.keys(historico).length,
    conversasAtivas: 0,
    totalMensagens: 0
  };
  
  const now = Date.now();
  const hourAgo = now - (60 * 60 * 1000);
  
  Object.values(historico).forEach(conversa => {
    stats.totalMensagens += conversa.length;
    const lastMsg = conversa[conversa.length - 1];
    if (lastMsg && new Date(lastMsg.timestamp).getTime() > hourAgo) {
      stats.conversasAtivas++;
    }
  });
  
  return stats;
}

function clearOldHistorico(maxAge = 24 * 60 * 60 * 1000) {
  const now = Date.now();
  
  Object.keys(historico).forEach(grupoUserId => {
    const conversa = historico[grupoUserId];
    if (conversa.length > 0) {
      const lastMsg = conversa[conversa.length - 1];
      const lastMsgTime = new Date(lastMsg.timestamp).getTime();
      
      if (now - lastMsgTime > maxAge) {
        delete historico[grupoUserId];
      }
    }
  });
}

// Sistema de logging e análise de conversas
let conversationLogs = {};
let responseAnalytics = {};

function logConversation(grupoUserId, message, response, timestamp, metadata = {}) {
  if (!conversationLogs[grupoUserId]) {
    conversationLogs[grupoUserId] = [];
  }
  
  const logEntry = {
    timestamp,
    message,
    response,
    metadata: {
      ...metadata,
      responseLength: response ? response.length : 0,
      hasEmojis: response ? /[🌸🌙🦇💕😊😳😅😠🌟✨🌺🌷🌹❄️🎂🎄🎊🎃🍂🍁☀️🌅🌊🔥]/.test(response) : false,
      sentiment: analyzeSentiment(response),
      ...metadata
    }
  };
  
  conversationLogs[grupoUserId].push(logEntry);
  
  // Manter apenas os últimos 100 logs por usuário
  if (conversationLogs[grupoUserId].length > 100) {
    conversationLogs[grupoUserId] = conversationLogs[grupoUserId].slice(-100);
  }
  
  // Atualizar analytics
  updateResponseAnalytics(grupoUserId, logEntry);
}

function updateResponseAnalytics(grupoUserId, logEntry) {
  if (!responseAnalytics[grupoUserId]) {
    responseAnalytics[grupoUserId] = {
      totalResponses: 0,
      averageResponseLength: 0,
      emojiUsage: 0,
      sentimentDistribution: {
        positive: 0,
        neutral: 0,
        negative: 0
      },
      responseTypes: {},
      hourlyActivity: {},
      dailyActivity: {},
      favoriteTopics: {}
    };
  }
  
  const analytics = responseAnalytics[grupoUserId];
  analytics.totalResponses++;
  
  // Atualizar comprimento médio
  const currentLength = logEntry.metadata.responseLength;
  analytics.averageResponseLength =
    (analytics.averageResponseLength * (analytics.totalResponses - 1) + currentLength) / analytics.totalResponses;
  
  // Atualizar uso de emojis
  if (logEntry.metadata.hasEmojis) {
    analytics.emojiUsage++;
  }
  
  // Atualizar distribuição de sentimentos
  analytics.sentimentDistribution[logEntry.metadata.sentiment]++;
  
  // Atualizar tipos de resposta
  const responseType = logEntry.metadata.type || 'general';
  analytics.responseTypes[responseType] = (analytics.responseTypes[responseType] || 0) + 1;
  
  // Atualizar atividade horária
  const hour = new Date(logEntry.timestamp).getHours();
  analytics.hourlyActivity[hour] = (analytics.hourlyActivity[hour] || 0) + 1;
  
  // Atualizar atividade diária
  const day = new Date(logEntry.timestamp).toLocaleDateString('pt-BR');
  analytics.dailyActivity[day] = (analytics.dailyActivity[day] || 0) + 1;
  
  // Atualizar tópicos favoritos
  if (logEntry.metadata.topic) {
    analytics.favoriteTopics[logEntry.metadata.topic] = (analytics.favoriteTopics[logEntry.metadata.topic] || 0) + 1;
  }
}

function analyzeSentiment(text) {
  if (!text) return 'neutral';
  
  const positiveWords = ['amor', 'gostar', 'feliz', 'alegre', 'maravilhoso', 'incrível', 'lindo', 'bonito', 'legal', 'massa', 'bacana', 'ótimo', 'excelente', 'perfeito'];
  const negativeWords = ['ódio', 'ódio', 'triste', 'chateado', 'raiva', 'irritado', 'ruim', 'horrível', 'terrível', 'péssimo', 'nojento', 'decepcionado'];
  
  const lowerText = text.toLowerCase();
  let positiveScore = 0;
  let negativeScore = 0;
  
  positiveWords.forEach(word => {
    if (lowerText.includes(word)) positiveScore++;
  });
  
  negativeWords.forEach(word => {
    if (lowerText.includes(word)) negativeScore++;
  });
  
  if (positiveScore > negativeScore) return 'positive';
  if (negativeScore > positiveScore) return 'negative';
  return 'neutral';
}

function getConversationAnalytics(grupoUserId) {
  return responseAnalytics[grupoUserId] || {
    totalResponses: 0,
    averageResponseLength: 0,
    emojiUsage: 0,
    sentimentDistribution: {
      positive: 0,
      neutral: 0,
      negative: 0
    },
    responseTypes: {},
    hourlyActivity: {},
    dailyActivity: {},
    favoriteTopics: {}
  };
}

function getConversationLogs(grupoUserId, limit = 10) {
  if (!conversationLogs[grupoUserId]) {
    return [];
  }
  
  return conversationLogs[grupoUserId].slice(-limit);
}

function clearConversationLogs(grupoUserId) {
  if (conversationLogs[grupoUserId]) {
    delete conversationLogs[grupoUserId];
  }
  
  if (responseAnalytics[grupoUserId]) {
    delete responseAnalytics[grupoUserId];
  }
}

function getSystemAnalytics() {
  const now = Date.now();
  const dayAgo = now - (24 * 60 * 60 * 1000);
  
  const activeUsers = Object.keys(conversationLogs).filter(userId => {
    const logs = conversationLogs[userId];
    return logs && logs.length > 0 && new Date(logs[logs.length - 1].timestamp).getTime() > dayAgo;
  }).length;
  
  const totalLogs = Object.values(conversationLogs).reduce((total, logs) => total + logs.length, 0);
  const totalAnalytics = Object.keys(responseAnalytics).length;
  
  return {
    activeUsers,
    totalLogs,
    totalAnalytics,
    memoryUsage: {
      historico: Object.keys(historico).length,
      conversationStates: Object.keys(conversationStates).length,
      userPreferences: Object.keys(userPreferences).length,
      userInteractions: Object.keys(userInteractions).length,
      conversationLogs: Object.keys(conversationLogs).length,
      responseAnalytics: Object.keys(responseAnalytics).length
    }
  };
}

// Funções para timing personalizado
const responseTimings = {};

function startResponseTimer(grupoUserId) {
  responseTimings[grupoUserId] = {
    startTime: Date.now(),
    phases: {}
  };
}

function markResponsePhase(grupoUserId, phase) {
  if (responseTimings[grupoUserId]) {
    responseTimings[grupoUserId].phases[phase] = Date.now();
  }
}

function endResponseTimer(grupoUserId) {
  if (responseTimings[grupoUserId]) {
    const endTime = Date.now();
    const totalTime = endTime - responseTimings[grupoUserId].startTime;
    
    const timingData = {
      totalTime,
      phases: responseTimings[grupoUserId].phases,
      timestamp: endTime
    };
    
    delete responseTimings[grupoUserId];
    return timingData;
  }
  return null;
}

function getAverageResponseTime(grupoUserId) {
  // Esta função poderia ser expandida para calcular média de tempos
  // Por enquanto, retorna um valor baseado em heurísticas simples
  const preferences = getUserPreferences(grupoUserId);
  const isNightTime = new Date().getHours() >= 18 || new Date().getHours() < 6;
  
  // Abyss é mais rápida à noite
  if (isNightTime) {
    return 800 + Math.random() * 400; // 800-1200ms
  }
  
  // Mais lenta durante o dia (simulando "preguiça" tsundere)
  return 1200 + Math.random() * 600; // 1200-1800ms
}

function getAbyssResponseDelay(grupoUserId) {
  const avgTime = getAverageResponseTime(grupoUserId);
  const preferences = getUserPreferences(grupoUserId);
  const isNightTime = new Date().getHours() >= 18 || new Date().getHours() < 6;
  
  // Ajustar baseado no humor do usuário
  let moodMultiplier = 1.0;
  if (preferences.mood === 'happy') moodMultiplier = 0.8; // Mais rápida quando feliz
  if (preferences.mood === 'sad') moodMultiplier = 1.2; // Mais lenta quando triste
  if (preferences.mood === 'angry') moodMultiplier = 1.5; // Mais lenta quando brava
  
  // Ajustar baseado no horário
  let timeMultiplier = 1.0;
  if (isNightTime) timeMultiplier = 0.9; // Mais rápida à noite
  
  return Math.floor(avgTime * moodMultiplier * timeMultiplier);
}

// ========== FUNÇÃO DE GERAÇÃO DE IMAGEM (POLLINATIONS) ==========
async function generateImage(prompt, retries = 3) {
  if (!prompt || typeof prompt !== 'string') {
    throw new Error('Prompt é obrigatório para geração de imagem');
  }

  // Gerar imagem usando Pollinations.ai
  // Usa modelo turbo + seed para maior fidelidade ao prompt
  const encodedPrompt = encodeURIComponent(prompt);
  // Seed baseado no prompt para consistência (mesmo prompt = mesma imagem)
  const seed = encodeURIComponent(prompt.split('').reduce((a, b) => a + b.charCodeAt(0), 0));
  const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&model=turbo&seed=${seed}&nologo=true`;

  return imageUrl;
}

export {
  processUserMessages as makeAssistentRequest,
  // O "olhar tudo" do grupo (custo 0 token) — exportado para o teste.
  absorverContextoDoGrupo,
  makeCognimaRequest,
  respostaNatural,
  getHistoricoStats,
  clearOldHistorico,
  getApiKeyStatus,
  updateApiKeyStatus,
  // notifyOwnerAboutApiKey removed
  // Sistema de logging e análise
  logConversation,
  getConversationAnalytics,
  getConversationLogs,
  clearConversationLogs,
  getSystemAnalytics,
  // Sistema de timing personalizado
  startResponseTimer,
  markResponsePhase,
  endResponseTimer,
  getAverageResponseTime,
  getAbyssResponseDelay,
  // Sistema de gerenciamento de estado
  updateConversationState,
  getConversationState,
  updateUserPreferences,
  getUserPreferences,
  trackUserInteraction,
  getUserInteractionStats,
  // Sistema de contexto de usuário
  userContextDB,
  processLearning,
  // Sistema de variáveis dinâmicas
  getDynamicBotInfo,
  replaceDynamicVariables,
  checkBotNameMention,
  hasBotMention,
  // Image generation
  generateImage,
  setGeminiApiKey,
  getGeminiApiKey,
  GEMINI_DEFAULT_MODEL,
  GEMINI_FALLBACK_MODELS,
  GEMINI_ROLLING_ALIASES,
  normalizeModelId,
  descobrirModelos,
  setGeminiHttpForTest,
  geminiRequestMultimodal,
  classificarErroGemini,
  promptDaPersonalidade,
  montarContextoDaConversa,
};