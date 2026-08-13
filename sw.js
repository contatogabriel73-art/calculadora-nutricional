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

/* Manter em sincronia com VERSAO_APP em app.js. */
const CACHE = 'nutri-taco-v3.2';

/* Busca que ignora o cache HTTP do navegador e revalida com o servidor.

   Sem isto o stale-while-revalidate não funciona em produção: o GitHub Pages
   serve os assets com `Cache-Control: max-age=600`, então o fetch de
   revalidação era atendido pelo próprio cache do navegador e o service worker
   regravava exatamente os mesmos bytes velhos por 10 minutos.
   Com 'no-cache' o navegador manda o If-None-Match e devolve 304 quando nada
   mudou, então o custo é baixo. */
function buscarDaRede(url) {
  return fetch(new Request(url, { cache: 'no-cache', credentials: 'same-origin' }));
}

const SHELL = [
  './',
  './index.html',
  './painel.html',
  './login.html',
  './cadastro.html',
  './area-paciente.html',
  './pacientes.html',
  './paciente.html',
  './ficha.html',
  './plano.html',
  './agenda.html',
  './financeiro.html',
  './recibo.html',
  './styles.css',
  './plataforma.css',
  './app.js',
  // A biblioteca do Supabase vem de CDN e não entra aqui: o service
  // worker só intercepta a própria origem. Sem internet, o cliente do
  // banco não sobe e as telas internas avisam em vez de quebrar.
  './js/supabase-config.js',
  './js/supabase-client.js',
  './js/auth.js',
  './js/pacientes-storage.js',
  './js/fichas-storage.js',
  './js/shell.js',
  './js/ficha-paciente.js',
  './js/prontuario-storage.js',
  './js/antropometria.js',
  './js/paciente-prontuario.js',
  './js/taco.js',
  './js/planos-storage.js',
  './js/plano.js',
  './js/agenda-storage.js',
  './js/agenda.js',
  './js/financeiro-storage.js',
  './js/financeiro.js',
  './js/perfil-storage.js',
  './js/extenso.js',
  './js/recibo.js',
  './js/painel.js',
  './js/graficos.js',
  './js/vinculo-storage.js',
  './js/area-paciente.js',
  './js/cpf.js',
  './js/cep.js',
  './admin.html',
  './js/admin-storage.js',
  './cadastro-em-analise.html',
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
      // cache.add() usaria o cache HTTP; buscarDaRede garante a versão do servidor.
      .then((cache) => Promise.all(
        SHELL.map((url) => buscarDaRede(url)
          .then((resp) => (resp && resp.ok ? cache.put(url, resp) : null))
          .catch(() => null))
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
      buscarDaRede(req.url)
        .then((resp) => {
          if (resp && resp.ok) {
            const copia = resp.clone();
            caches.open(CACHE).then((c) => c.put(req, copia));
          }
          return resp;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  /* Navegação: rede primeiro, cache como reserva para funcionar offline.

     Cada página é guardada sob a própria URL. Antes tudo era gravado como
     './index.html', o que fazia a última página visitada sobrescrever a
     inicial no cache — inofensivo quando o app tinha uma página só, mas
     agora bagunçaria todas. */
  if (req.mode === 'navigate') {
    evento.respondWith(
      buscarDaRede(req.url)
        .then((resp) => {
          if (resp && resp.ok) {
            const copia = resp.clone();
            caches.open(CACHE).then((c) => c.put(req.url, copia));
          }
          return resp;
        })
        .catch(async () =>
          (await caches.match(req.url)) ||
          (await caches.match('./index.html')) ||
          Response.error()
        )
    );
    return;
  }

  // Demais assets do shell: stale-while-revalidate.
  evento.respondWith(
    caches.match(req).then((emCache) => {
      const daRede = buscarDaRede(req.url)
        .then((resp) => {
          if (resp && resp.ok) {
            const copia = resp.clone();
            caches.open(CACHE).then((c) => c.put(req, copia));
          }
          return resp;
        })
        .catch(() => emCache);   // offline: fica com o que já tinha

      // Responde na hora com o cache, mas revalida em segundo plano.
      // evento.waitUntil mantém o worker vivo até a revalidação terminar,
      // senão ela pode ser abortada logo depois da resposta sair.
      evento.waitUntil(daRede.catch(() => null));
      return emCache || daRede;
    })
  );
});
