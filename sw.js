/* ============================================================
   Service Worker — Calculadora Nutricional

   Estratégia:
   • App shell (HTML/CSS/JS/ícones/manifest) → stale-while-revalidate.
     A página abre instantânea (e offline) a partir do cache, enquanto
     uma cópia nova é baixada em segundo plano e guardada. A versão
     atualizada entra na abertura seguinte.

     Isso é deliberado: com cache-first puro, publicar uma correção
     não chegava em quem já tinha aberto o app, a menos que a constante
     CACHE fosse incrementada a cada deploy — um passo fácil de esquecer.

   • data/taco.json → network-first com fallback para cache.
     Ao expandir a base TACO o usuário recebe a versão nova já na
     primeira abertura com internet.

   CACHE só precisa mudar para descartar caches antigos de uma vez.
   ============================================================ */

const CACHE = 'nutri-taco-v2';

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
      fetch(req)
        .then((resp) => {
          const copia = resp.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', copia));
          return resp;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Demais assets do shell: stale-while-revalidate.
  evento.respondWith(
    caches.match(req).then((emCache) => {
      const daRede = fetch(req)
        .then((resp) => {
          if (resp && resp.ok) {
            const copia = resp.clone();
            caches.open(CACHE).then((c) => c.put(req, copia));
          }
          return resp;
        })
        .catch(() => emCache);   // offline: fica com o que já tinha

      // Responde na hora com o cache, mas revalida em segundo plano.
      return emCache || daRede;
    })
  );
});
