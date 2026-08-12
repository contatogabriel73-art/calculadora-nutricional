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

/* Por padrão o servidor imita o GitHub Pages (`max-age=600` + ETag), para
   que o ambiente local reproduza o cache HTTP da produção — foi essa
   diferença que já escondeu um bug de atualização do service worker.

   `--sem-cache` troca por `no-cache`: o navegador revalida a cada pedido e
   o ETag responde 304 quando nada mudou. Útil enquanto se edita, quando
   esperar dez minutos por cada alteração não faz sentido. */
const SEM_CACHE = process.argv.includes('--sem-cache');
const CACHE_CONTROL = SEM_CACHE ? 'no-cache' : 'max-age=600';

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

    /* ETag a partir de tamanho + data de modificação.

       Sem validador, `max-age=600` vira cache cego: o navegador não tem o
       que comparar e usa a cópia velha pelos dez minutos inteiros, mesmo
       com `cache: 'no-cache'` pedindo revalidação. O GitHub Pages manda
       ETag e Last-Modified; sem eles aqui, o ambiente local deixava de
       espelhar a produção justamente no ponto que interessa. */
    let etag = '';
    try {
      const st = fs.statSync(arquivo);
      etag = '"' + st.size.toString(16) + '-' + st.mtimeMs.toString(16) + '"';
    } catch (e) { /* segue sem ETag */ }

    if (etag && req.headers['if-none-match'] === etag) {
      resp.writeHead(304, { ETag: etag, "Cache-Control": CACHE_CONTROL });
      resp.end();
      return;
    }

    const cabecalhos = {
      'Content-Type': TIPOS[path.extname(arquivo).toLowerCase()] || 'application/octet-stream',
      // Imita o GitHub Pages de propósito. Com 'no-cache' aqui, o ambiente
      // local deixava de reproduzir o cache HTTP da produção e escondia bugs
      // de atualização do service worker que só apareciam depois de publicar.
      "Cache-Control": CACHE_CONTROL
    };
    if (etag) cabecalhos.ETag = etag;

    resp.writeHead(200, cabecalhos);
    resp.end(conteudo);
  });
}).listen(PORTA, () => {
  console.log(`Calculadora Nutricional rodando em http://localhost:${PORTA}`);
  console.log(SEM_CACHE ? 'Modo --sem-cache: o navegador revalida a cada pedido.' : 'Cache como no GitHub Pages. Use --sem-cache enquanto edita.');
  console.log('Ctrl+C para parar.');
});
