/**
 * Gera a FICHA DE ALUGUEL em PDF, para o bot enviar como documento no chat.
 *
 * ## Por que existe
 *
 * O card rico (`richResponseMessage`) e' so' APRESENTACAO: verificado no proto,
 * `AIRichResponseSubMessage` nao tem nenhum campo de acao/botao (os campos sao
 * `messageType`, `gridImageMetadata`, `messageText`, `imageMetadata`,
 * `codeMetadata`, `tableMetadata`, `dynamicMetadata`, `latexMetadata`,
 * `mapMetadata`, `contentItemsMetadata`). Ou seja: **nao da' para clicar dentro
 * do card**. O clique acontece nos BOTOES (Native Flow), e o resultado visual
 * pode ser o card — ou, aqui, um PDF.
 *
 * ## Sem binario nativo
 *
 * Usa `pdfkit` (JavaScript puro): nenhum Chromium, nenhum `lib` de sistema. Isso
 * importa porque o bot roda em VPS/Pterodactyl apertado, e um Puppeteer custaria
 * centenas de MB.
 *
 * @returns {Promise<Buffer>} o PDF pronto para enviar como documento
 */

/** Escapa o que o PDF nao desenha (evita lixo visual no arquivo). */
const limpar = (v) => {
	if (v === null || v === undefined) return '—'
	const s = String(v).trim()
	return s || '—'
}

/** Data/hora legivel, em pt-BR (o fuso do servidor). */
const agora = () => {
	try {
		return new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
	} catch {
		return new Date().toISOString()
	}
}

/**
 * Monta o PDF da ficha.
 *
 * @param {{
 *   nome?: string, plano?: string, periodo?: string, observacoes?: string,
 *   grupo?: string, pedidoPor?: string, titulo?: string
 * }} dados
 * @returns {Promise<Buffer>}
 */
export const gerarFichaPdf = async (dados = {}) => {
	// `pdfkit` e' CommonJS: num bot ESM o `require` nao existe, entao o import
	// dinamico e' o caminho (e o default e' a classe).
	let PDFDocument
	try {
		const mod = await import('pdfkit')
		PDFDocument = mod?.default ?? mod
	} catch {
		throw new Error('pdfkit nao instalado')
	}

	return new Promise((resolve, reject) => {
	const doc = new PDFDocument({ size: 'A4', margin: 50 })
	const partes = []
	doc.on('data', (c) => partes.push(c))
	doc.on('end', () => resolve(Buffer.concat(partes)))
	doc.on('error', reject)

	const titulo = limpar(dados.titulo) === '—' ? 'FICHA DE ALUGUEL' : String(dados.titulo)

	// Cabecalho
	doc.fontSize(20).fillColor('#111111').text(titulo, { align: 'center' })
	doc.moveDown(0.3)
	doc.fontSize(9).fillColor('#666666')
		.text(`Emitido em ${agora()}`, { align: 'center' })
	doc.moveDown(1.2)

	// Linhas da ficha
	const linhas = [
		['Nome de exibição', dados.nome],
		['Plano desejado', dados.plano],
		['Período de aluguel', dados.periodo],
		['Observações', dados.observacoes],
		['Grupo', dados.grupo],
		['Pedido por', dados.pedidoPor]
	]

	const x = doc.page.margins.left
	const largura = doc.page.width - doc.page.margins.left - doc.page.margins.right
	const alturaLinha = 26
	let y = doc.y

	// Cabecalho da tabela
	doc.rect(x, y, largura, alturaLinha).fill('#1f2937')
	doc.fillColor('#ffffff').fontSize(11)
		.text('Campo', x + 10, y + 8, { width: largura * 0.38 })
		.text('Valor', x + largura * 0.40, y + 8, { width: largura * 0.58 })
	y += alturaLinha

	// Linhas (zebra para leitura)
	linhas.forEach(([campo, valor], i) => {
		const fundo = i % 2 === 0 ? '#f3f4f6' : '#ffffff'
		doc.rect(x, y, largura, alturaLinha).fill(fundo)
		doc.fillColor('#111827').fontSize(11)
			.text(campo, x + 10, y + 8, { width: largura * 0.38 })
			.text(limpar(valor), x + largura * 0.40, y + 8, { width: largura * 0.58 })
		y += alturaLinha
	})

	// Borda
	doc.rect(x, doc.y, largura, y - doc.y).strokeColor('#d1d5db').stroke()

	// Rodape
	doc.y = y + 24
	doc.fontSize(9).fillColor('#6b7280')
		.text('Documento gerado automaticamente pelo bot.', x, doc.y, { width: largura, align: 'center' })

	doc.end()
	})
}
