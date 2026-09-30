/**
 * Anomalias de CONTEUDO — tamanho e forma dos campos de texto.
 *
 * POR QUE ESTE MODULO EXISTE
 * --------------------------
 * O detector anterior olhava o TIPO da mensagem (pagamento sem valor, nota
 * invisivel, etc). Isso deixava passar uma categoria inteira: mensagem cujo
 * campo de texto e ABSURDAMENTE grande. Nao e o tipo que denuncia — e o TAMANHO.
 *
 * O caso medido e o "travazap" (payload que trava o aparelho do alvo): um
 * `locationMessage` com `name`/`address` de centenas de KB, ou um
 * `extendedTextMessage` com `text` de mais de 1 MB. O cliente tenta processar
 * aquilo e nao consegue.
 *
 * O criterio aqui e OBJETIVO: nenhum humano escreve um nome de lugar com 300 KB.
 * Nao ha heuristica, nao ha adivinhacao — e contagem de caracteres.
 *
 * Este modulo e PURO: recebe o conteudo (o `message` do proto) e devolve as
 * anomalias. Nao abre socket, nao envia nada.
 */

/**
 * Limite a partir do qual um campo de TEXTO deixa de ser plausivel.
 *
 * Calibrado com folga: uma legenda de WhatsApp aceita ~65k caracteres, e um
 * texto legitimo longo (artigo colado, por exemplo) fica na casa dos milhares.
 * 2.000 e conservador de proposito — o que se quer pegar e a ordem de grandeza
 * (centenas de KB a MB), nao o texto longo de alguem.
 */
export const LIMITE_TEXTO_PLAUSIVEL = 2000;

/**
 * Limite para o campo virar anomalia GRAVE (peso alto). E a faixa do travazap:
 * payload na casa das centenas de KB, que existe so para sobrecarregar o
 * cliente.
 */
export const LIMITE_TEXTO_ABSURDO = 100000;

/** Campos que carregam TEXTO exibivel, por tipo de mensagem. */
const CAMPOS_TEXTO = Object.freeze({
  conversation: ['conversation'],
  extendedTextMessage: ['text', 'matchedText', 'description', 'title', 'canonicalUrl'],
  locationMessage: ['name', 'address', 'url', 'comment'],
  liveLocationMessage: ['caption'],
  imageMessage: ['caption'],
  videoMessage: ['caption'],
  documentMessage: ['title', 'fileName', 'caption'],
  audioMessage: ['caption'],
  stickerMessage: ['caption'],
  contactMessage: ['displayName'],
  contactsArrayMessage: ['displayName'],
  orderMessage: ['message', 'orderTitle', 'itemName', 'footerText'],
  productMessage: ['title', 'description', 'footerText'],
  pollCreationMessage: ['name', 'optionName'],
  pollCreationMessageV2: ['name', 'optionName'],
  pollCreationMessageV3: ['name', 'optionName'],
  invoiceMessage: ['note'],
  paymentInviteMessage: ['referralId'],
  splitPaymentMessage: ['description'],
  paymentReminderMessage: ['description'],
  protocolMessage: ['memberLabel'],
  eventMessage: ['name', 'description'],
  groupInviteMessage: ['caption', 'groupName'],
  documentWithCaptionMessage: ['caption'],
});

/** Tipos que carregam TEXTO dentro de outro campo (recursivo). */
const TIPOS_RECURSIVOS = Object.freeze([
  'extendedTextMessage', 'noteMessage', 'quotedMessage', 'message',
  'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension',
  'ephemeralMessage', 'documentWithCaptionMessage', 'editedMessage',
  'deviceSentMessage', 'associatedChildMessage', 'groupStatusMessageV2',
  'groupStatusMessage',
]);

/** Listas cujos itens podem carregar texto (ex.: opções de enquete). */
const LISTAS_COM_TEXTO = Object.freeze(['options', 'sections', 'rows', 'buttons', 'participants', 'contacts']);

const isObj = (v) => v !== null && typeof v === 'object';
const str = (v) => (typeof v === 'string' ? v : '');

/**
 * Percorre o conteudo e devolve todos os campos de texto com o tamanho.
 *
 * A varredura e LIMITADA em profundidade e em numero de campos: o objetivo e
 * medir, nao percorrer um payload hostil ate o fim.
 *
 * @param {object} content
 * @returns {Array<{caminho:string, tamanho:number}>}
 */
export function medirCamposDeTexto(content, { maxDepth = 8, maxCampos = 200 } = {}) {
  const achados = [];
  const vistos = new Set();

  /**
   * `tipoAtual` e o nome do TIPO da mensagem que estamos lendo (ex.:
   * `locationMessage`). E ele que diz quais campos sao de texto — o nome do
   * campo sozinho nao basta (`text` existe em varios tipos, e `name` num
   * locationMessage e texto enquanto noutro tipo pode nao ser).
   */
  const visitar = (node, caminho, profundidade, tipoAtual) => {
    if (achados.length >= maxCampos || profundidade > maxDepth) return;
    if (!isObj(node) || vistos.has(node)) return;
    vistos.add(node);

    for (const [chave, valor] of Object.entries(node)) {
      const novoCaminho = caminho ? `${caminho}.${chave}` : chave;

      if (typeof valor === 'string') {
        // A propria CHAVE pode ser o tipo: `conversation` e um tipo de mensagem
        // cujo campo tem o mesmo nome. Sem isto, `{ conversation: '...' }` no
        // topo nao era medido (tipoAtual ainda e null na raiz).
        const tipoDaChave = CAMPOS_TEXTO[chave] ? chave : tipoAtual;
        const camposDoTipo = tipoDaChave ? CAMPOS_TEXTO[tipoDaChave] : null;
        if (camposDoTipo && camposDoTipo.includes(chave) && valor.length > 0) {
          achados.push({ caminho: novoCaminho, tamanho: valor.length, tipo: tipoDaChave });
        }
        continue;
      }

      if (Array.isArray(valor)) {
        if (!LISTAS_COM_TEXTO.includes(chave)) continue;
        for (let i = 0; i < valor.length && achados.length < maxCampos; i++) {
          const item = valor[i];
          if (typeof item === 'string') {
            if (item.length > 0) achados.push({ caminho: `${novoCaminho}[${i}]`, tamanho: item.length, tipo: tipoAtual });
          } else if (isObj(item)) {
            // O item da lista e lido no contexto do tipo pai (ex.: uma opcao de
            // enquete tem `optionName`, que e texto de `pollCreationMessage`).
            visitar(item, `${novoCaminho}[${i}]`, profundidade + 1, tipoAtual);
          }
        }
        continue;
      }

      if (isObj(valor)) {
        // Se a chave e um tipo conhecido, ela passa a ser o `tipoAtual`; senao
        // (ex.: `message`, `noteMessage`) o tipo do pai continua valendo.
        const proximoTipo = CAMPOS_TEXTO[chave] ? chave : tipoAtual;
        visitar(valor, novoCaminho, profundidade + 1, proximoTipo);
      }
    }
  };

  visitar(content, '', 0, null);
  return achados;
}

/**
 * Analisa os campos de texto e classifica as anomalias.
 *
 * Devolve:
 *   - `campos`: todos os campos medidos (para o relatorio);
 *   - `suspeitos`: campos acima do plausivel;
 *   - `absurdos`: campos na faixa do travazap;
 *   - `maior`: o maior campo encontrado (para o resumo).
 *
 * @param {object} content
 * @returns {{disponivel:boolean, campos:Array, suspeitos:Array, absurdos:Array, maior:object|null, totalCaracteres:number}}
 */
export function analisarTamanhoDeConteudo(content = {}) {
  const campos = medirCamposDeTexto(content);

  const suspeitos = campos.filter((c) => c.tamanho > LIMITE_TEXTO_PLAUSIVEL);
  const absurdos = campos.filter((c) => c.tamanho > LIMITE_TEXTO_ABSURDO);

  const maior = campos.reduce((acc, c) => (!acc || c.tamanho > acc.tamanho ? c : acc), null);
  const totalCaracteres = campos.reduce((soma, c) => soma + c.tamanho, 0);

  return {
    disponivel: campos.length > 0,
    campos,
    suspeitos,
    absurdos,
    maior,
    totalCaracteres,
  };
}
