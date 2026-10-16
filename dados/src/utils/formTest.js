/**
 * `!testefm` — demonstra os formularios/mensagens interativas que o Baileys
 * REALMENTE consegue enviar, sem confundir os tres formatos.
 *
 * ## Os tres formatos (e por que NAO sao a mesma coisa)
 *
 * | formato | o que e' | precisa de |
 * |---|---|---|
 * | **WhatsApp Flows** (Meta) | formulario oficial, desenhado pelo cliente a partir do Flow JSON publicado na WABA | `flow_id` da API de Flows + conta business |
 * | **Native Flow** | o envelope `interactiveMessage.nativeFlowMessage` com botoes | nada alem do socket |
 * | **mensagens interativas** | botoes/listas/respostas no mesmo envelope | nada alem do socket |
 *
 * ## O que EXISTE no proto (verificado, nao suposto)
 *
 * `flowMessage`, `flowResponseMessage` e um `flowId` de mensagem de usuario
 * **nao existem**. Um Flow e' um botao de Native Flow com `name: 'flow'` e um
 * JSON de parametros. Este modulo nao inventa proto.
 *
 * ## LIMITE HONESTO
 *
 * Enviar `name: 'flow'` por lib nao-oficial e' gateado pelo servidor: o
 * destinatario ve *"mensagem incompativel com sua versao do WhatsApp"* mesmo em
 * iOS/Android atualizados, enquanto o MESMO codigo com `quick_reply`/`cta_url`
 * renderiza (reproduzido no `whatsmeow` #1144). Por isso o comando tem DOIS
 * modos: o de Flow oficial (que so' funciona com `flow_id` real) e o NATIVO, que
 * o cliente desenha hoje.
 *
 * ## Modos do comando
 *
 *   `!testefm`            -> painel: o que da' para fazer e o que falta
 *   `!testefm nativo`     -> envia o formulario NATIVO (renderiza)
 *   `!testefm flow`       -> envia o botao de Flow oficial (precisa do flow_id)
 *   `!testefm <flow_id>`  -> envia o botao de Flow com o id informado
 */

/** Os campos do formulario de exemplo (o dono pediu estes). */
export const CAMPOS_EXEMPLO = Object.freeze([
	{ nome: 'Nome de exibição', chave: 'nome', tipo: 'texto' },
	{ nome: 'Plano desejado', chave: 'plano', tipo: 'seleção' },
	{ nome: 'Período de aluguel', chave: 'periodo', tipo: 'seleção' },
	{ nome: 'Observações', chave: 'observacoes', tipo: 'texto (opcional)' },
	{ nome: 'Confirmação', chave: 'confirmar', tipo: 'checkbox' }
])

/** Planos e períodos do exemplo (usados nas opções do formulário nativo). */
export const PLANOS = Object.freeze(['Básico', 'Pro', 'Premium'])
export const PERIODOS = Object.freeze(['Diário', 'Semanal', 'Mensal'])

/**
 * Monta o formulario NATIVO — o que o cliente desenha hoje.
 *
 * Nao ha um "campo de formulario" no proto: o que existe e' `single_select`,
 * que abre a bottom-sheet nativa (a mesma UI de escolha) e devolve a escolha
 * pelo mesmo canal. Entao o formulario de exemplo vira **uma escolha por
 * campo** — honesto: e' o mais proximo que renderiza sem a Meta.
 *
 * @returns {object} o conteudo pronto para `sendMessage`
 */
export const montarFormularioNativo = () => ({
	text: '📋 *FICHA DE ALUGUEL*\n\nEscolha as opções abaixo para montar o pedido.',
	footer: 'Formulário nativo (Native Flow)',
	nativeFlow: [
		{
			text: '📋 Plano',
			sections: [
				{
					title: 'Plano desejado',
					rows: PLANOS.map((p) => ({ title: p, description: `Aluguel — plano ${p}`, id: `plano:${p.toLowerCase()}` }))
				}
			]
		},
		{
			text: '📅 Período',
			sections: [
				{
					title: 'Período de aluguel',
					rows: PERIODOS.map((p) => ({ title: p, description: `Cobrança ${p.toLowerCase()}`, id: `periodo:${p.toLowerCase()}` }))
				}
			]
		},
		{ text: '✅ Confirmar', id: 'confirmar' },
		{ text: '❌ Cancelar', id: 'cancelar' }
	]
})

/**
 * Monta o botao de Flow OFICIAL (Meta).
 *
 * Precisa de um `flow_id` real (criado na WABA pela API de Flows). Sem ele, o
 * proprio `buildFlowButton` da fork lanca `FLOW_ID_MISSING` — aqui traduzimos
 * isso numa mensagem clara para o grupo.
 *
 * @param {{ flowId?: string, cta?: string, screen?: string, data?: object }} [opts]
 * @returns {object} o conteudo pronto para `sendMessage`
 */
export const montarFormularioFlow = (opts = {}) => ({
	text:
		'📋 *FICHA DE ALUGUEL*\n\n' +
		'Toque no botão para abrir o formulário.\n\n' +
		`_Campos:_ ${CAMPOS_EXEMPLO.map((c) => c.nome).join(' · ')}`,
	footer: 'WhatsApp Flow (oficial)',
	nativeFlow: [
		{
			flowId: opts.flowId,
			cta: opts.cta || 'Abrir formulário',
			action: 'navigate',
			mode: 'published',
			...(opts.screen ? { screen: opts.screen } : {}),
			...(opts.data ? { data: opts.data } : {})
		}
	]
})

/** O texto do painel (o que da' para fazer e o que falta). */
export const textoPainel = (prefix = '!') => [
	'╭━━━꧁༺ 🧾 𝐅𝐎𝐑𝐌𝐔𝐋𝐀𝐑𝐈𝐎𝐒 🧾 ༻꧂━━━╮',
	'┃ 🔎 O que foi verificado no protocolo:',
	'┃',
	'┃ ✅ *Native Flow* — botoes no envelope',
	'┃    `interactiveMessage.nativeFlowMessage`',
	'┃    Renderiza hoje. Nao precisa de nada externo.',
	'┃',
	'┃ ✅ *single_select* — a bottom-sheet nativa',
	'┃    (e\' o mais proximo de um "campo de formulario")',
	'┃',
	'┃ ⚠️ *WhatsApp Flows (Meta)* — formulario oficial',
	'┃    O envelope e\' montado e validado, MAS:',
	'┃    • precisa de um `flow_id` da WABA (API de Flows)',
	'┃    • o cliente so\' desenha com esse id publicado',
	'┃    • sem ele o servidor marca "incompatível"',
	'┃',
	'┃ ❌ `flowMessage` / `flowResponseMessage`',
	'┃    NAO EXISTEM no proto (conferido).',
	'┃    O Flow e\' um botao `name:"flow"` + JSON.',
	'┃',
	'┃ ▶️ *Testar:*',
	`┃    \`${prefix}testefm nativo\` — o que renderiza`,
	`┃    \`${prefix}testefm flow\` — o oficial (precisa do id)`,
	`┃    \`${prefix}testefm <flow_id>\` — com o seu id`,
	'╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯'
].join('\n')

/** A resposta do formulario chegou: formata para o grupo. */
export const formatarResposta = (resposta) => {
	if (!resposta) return null
	const id = resposta.params?.id || resposta.params?.selectedId || null
	const linhas = [`🧾 *RESPOSTA DO FORMULÁRIO*`, '', `┃ 🔘 Botão: ${resposta.name || '—'}`]
	if (id) linhas.push(`┃ ✅ Escolha: *${id}*`)
	if (resposta.text) linhas.push(`┃ 💬 Texto: ${resposta.text}`)
	return linhas.join('\n')
}
