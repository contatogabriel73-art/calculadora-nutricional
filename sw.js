/* ============================================================
   Service Worker — Calculadora Nutricional

   Estratégia:
   • App shell (HTML/CSS/JS/ícones/manifest) → cache-first.
     São arquivos versionados por CACHE; servem instantâneos e offline.
   • data/taco.json → network-first com fallback para cache.
     Assim, ao expandir a base TACO o usuário recebe a versão nova
     na primeira vez que abrir com internet, sem precisar limpar cache.

   Ao alterar qualquer arquivo do shell, incremente CACHE.
   ============================================================ */

const CACHE = 'nutri-taco-v1';

const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(CACHE)
      // addAll é tudo-ou-nada: um 404 aborta a instalação inteira.
      // Cada item vai individualmente para tolerar um arquivo ausente.
      .then((cache) => Promise.all(
        SHELL.map((url) => cache.add(url).catch(() => null))
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(
        nomes.filter((n) => n !== CACHE).map((n) => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (evento) => {
  const req = evento.request;

  // Só interceptamos GET de mesma origem.
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  // Base de dados: rede primeiro, cache como reserva (offline).
  if (req.url.includes('/data/')) {
    evento.respondWith(
      fetch(req)
        .then((resp) => {
          const copia = resp.clone();
          caches.open(CACHE).then((c) => c.put(req, copia));
          return resp;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Navegação: cache do index como reserva, para abrir offline em qualquer rota.
  if (req.mode === 'navigate') {
    evento.respondWith(
      fetch(req).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Demais assets do shell: cache primeiro.
  evento.respondWith(
    caches.match(req).then((emCache) => emCache || fetch(req).then((resp) => {
      const copia = resp.clone();
      caches.open(CACHE).then((c) => c.put(req, copia));
      return resp;
    }))
  );
});
