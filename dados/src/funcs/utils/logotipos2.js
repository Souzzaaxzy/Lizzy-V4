/*
 * Logotipos 2 textos via API Nodz — NAO USADO PELO BOT.
 *
 * O `!pornhub`, `!avengers` e companhia chamavam esta classe, que dependia da API
 * externa `apisnodz.com.br/api/logotipos`: o comando travava e devolvia um link
 * de API em vez da imagem. Agora quem gera os 2 textos e o motor LOCAL
 * (`funcs/logos/index.js`, tabela `STYLES2`), sem rede.
 *
 * Este arquivo fica como referencia; pode ser removido quando ninguem mais
 * importar (hoje so `funcs/exports.js` o registra).
 */

import axios from 'axios';

const CONFIG = {
  API_URL: 'https://apisnodz.com.br/api/logotipos',
  TIMEOUT: 30000
}

class Logos2 {
  constructor(texto1, texto2, modelo) {
    this.texto1 = texto1;
    this.texto2 = texto2;
    this.modelo = modelo;
  }
  
  async gerarLogotipo() {
    try {
      if (!this.texto1) {
        throw new Error('Texto1 não fornecido');
      }
      
      if (!this.texto2) {
        throw new Error('Texto2 não fornecido');
      }
      
      if (!this.modelo) {
        throw new Error('Modelo não fornecido');
      }
      
      // Codificar os textos para URL
      const texto1Codificado = encodeURIComponent(this.texto1);
      const texto2Codificado = encodeURIComponent(this.texto2);
      
      // Fazer requisição para a API com text1 e text2
      const response = await axios({
        url: `${CONFIG.API_URL}/ephoto/${this.modelo}?text1=${texto1Codificado}&text2=${texto2Codificado}`,
        method: 'GET',
        responseType: 'json',
        timeout: CONFIG.TIMEOUT,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
      // Verificar se a resposta foi bem sucedida
      if (response.data && response.data.success) {
        return {
          success: true,
          imageUrl: response.data.resultado.imagem,
          message: response.data.message || 'Logotipo gerado com sucesso'
        };
      } else {
        throw new Error(response.data?.message || 'Resposta inválida da API');
      }
      
    } catch (error) {
      console.error('Erro na API de logotipos:', error.message);
      
      // Tratamento específico para erro de timeout
      if (error.code === 'ECONNABORTED') {
        return {
          success: false,
          error: 'Tempo limite excedido ao gerar logotipo'
        };
      }
      
      return {
        success: false,
        error: error.message || 'Erro ao gerar logotipo'
      };
    }
  }
}

export default Logos2;
export { Logos2 };