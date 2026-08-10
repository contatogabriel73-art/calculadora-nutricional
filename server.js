/* ============================================================
   Servidor estático mínimo para desenvolvimento.

     node server.js            → http://localhost:8080
     node server.js 3000       → http://localhost:3000

   Existe porque o app precisa de HTTP: abrir index.html por
   file:// bloqueia o fetch de data/taco.json e o service worker.
   Qualquer outro servidor estático serve igualmente bem
   (npx serve, python -m http.server, Live Server do VS Code…).
   ============================================================ */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORTA = Number(process.argv[2]) || 8080;
const RAIZ = __dirname;

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

http.createServer((req, resp) => {
  let caminho = decodeURIComponent(url.parse(req.url).pathname);
  if (caminho === '/') caminho = '/index.html';

  const arquivo = path.join(RAIZ, caminho);

  // Impede sair da raiz do projeto via "../".
  if (!arquivo.startsWith(RAIZ)) {
    resp.writeHead(403).end('403 Proibido');
    return;
  }

  fs.readFile(arquivo, (erro, conteudo) => {
    if (erro) {
      resp.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      resp.end('404 — não encontrado: ' + caminho);
      return;
    }
    resp.writeHead(200, {
      'Content-Type': TIPOS[path.extname(arquivo).toLowerCase()] || 'application/octet-stream',
      // Imita o GitHub Pages de propósito. Com 'no-cache' aqui, o ambiente
      // local deixava de reproduzir o cache HTTP da produção e escondia bugs
      // de atualização do service worker que só apareciam depois de publicar.
      'Cache-Control': 'max-age=600'
    });
    resp.end(conteudo);
  });
}).listen(PORTA, () => {
  console.log(`Calculadora Nutricional rodando em http://localhost:${PORTA}`);
  console.log('Ctrl+C para parar.');
});
