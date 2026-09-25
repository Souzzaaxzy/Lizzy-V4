#!/usr/bin/env node
/**
 * PROXY HTTP MINIMO (zero dependencias) -- feito para rodar no TERMUX.
 *
 * Por que existe: o bot precisa SAIR pelo IP do seu celular (que a Cloudflare
 * trata bem) em vez do IP do VPS (que ela bloqueia). Um IP sozinho nao basta:
 * IP nao e' "encaminhamento" -- o celular precisa de um servico escutando que
 * aceite a conexao e a repasse. Este arquivo e' esse servico.
 *
 * Como o bot usa: o bot roda no VPS e nao alcanca o celular (operadora usa
 * CGNAT). Entao a ligacao e' invertida: o CELULAR abre um tunel SSH para o VPS
 * (`ssh -R`) e o VPS passa a ter `127.0.0.1:PORTA` apontando para este proxy.
 * No `.env` do bot:
 *
 *     AKINATOR_PROXY=http://127.0.0.1:8888
 *
 * Suporta GET/POST normais e HTTPS via CONNECT (o Akinator usa os dois).
 *
 * Uso no Termux:
 *     node proxy-termux.js            # escuta em 127.0.0.1:8888
 *     PORT=9000 node proxy-termux.js
 */

import http from 'http';
import net from 'net';

const PORT = Number(process.env.PORT || 8888);
const HOST = process.env.HOST || '127.0.0.1';

let reqCount = 0;

/** Log curto por requisicao: e' assim que o dono confirma que o bot esta'
 *  passando pelo celular (e nao saindo direto pelo VPS). */
function logar(metodo, alvo) {
  reqCount++;
  const hora = new Date().toISOString().slice(11, 19);
  console.log(`[proxy] ${hora} ${metodo} ${String(alvo).slice(0, 70)} (#${reqCount})`);
}

const server = http.createServer((req, res) => {
  // Proxy HTTP simples (http://). Encaminha a requisicao inteira.
  let alvo;
  try {
    alvo = new URL(req.url);
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    return res.end('URL invalida');
  }
  logar(req.method, alvo.host + alvo.pathname);
  const opcoes = {
    hostname: alvo.hostname,
    port: alvo.port || 80,
    path: alvo.pathname + alvo.search,
    method: req.method,
    headers: { ...req.headers, host: alvo.host },
  };
  const up = http.request(opcoes, (upRes) => {
    res.writeHead(upRes.statusCode, upRes.headers);
    upRes.pipe(res);
  });
  up.on('error', (e) => {
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('erro no proxy: ' + e.message);
  });
  req.pipe(up);
});

// HTTPS via CONNECT (o caso do Akinator).
server.on('connect', (req, clientSocket, head) => {
  const [host, porta] = req.url.split(':');
  logar('CONNECT', req.url);
  const serverSocket = net.connect(Number(porta) || 443, host, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head && head.length) serverSocket.write(head);
    serverSocket.pipe(clientSocket);
    clientSocket.pipe(serverSocket);
  });
  serverSocket.on('error', (e) => {
    console.error(`[proxy] erro ao conectar em ${host}:${porta}: ${e.message}`);
    clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
  });
  clientSocket.on('error', () => serverSocket.destroy());
});

server.listen(PORT, HOST, () => {
  console.log(`[proxy] escutando em http://${HOST}:${PORT}`);
  console.log('[proxy] no .env do bot: AKINATOR_PROXY=http://127.0.0.1:' + PORT);
});
