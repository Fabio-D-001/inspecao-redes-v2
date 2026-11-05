// Service worker: guarda o aplicativo para uso offline, as áreas do mapa já visitadas e a rede
// dos alimentadores já abertos. Os nomes dos caches começam com "v2-" porque a versão 1.0 usa o
// mesmo endereço (github.io) e o mesmo armazenamento de caches.
const VERSAO = '2.3.1';
const APP = `v2-app-${VERSAO}`;
const MAPA = 'v2-mapa-tiles';
const DADOS = 'v2-dados-2025';
const MAX_TILES = 3000;
const MAX_ALIMENTADORES = 400;

const ARQUIVOS = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css', 'dados/distribuidoras.json',
  'js/dialogo.js', 'js/db.js', 'js/pastas.js', 'js/relatorio.js', 'js/rede.js', 'js/kmz.js', 'js/app.js',
  'vendor/jszip.min.js', 'vendor/jspdf.umd.min.js',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css',
  'vendor/leaflet/images/marker-icon.png', 'vendor/leaflet/images/marker-icon-2x.png',
  'vendor/leaflet/images/marker-shadow.png', 'vendor/leaflet/images/layers.png', 'vendor/leaflet/images/layers-2x.png',
  'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', e => {
  // cache: 'reload' busca no servidor, sem a cópia do cache HTTP: a versão nova não fica com arquivos antigos.
  e.waitUntil(caches.open(APP).then(c => c.addAll(ARQUIVOS.map(u => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(nomes => Promise.all(nomes.filter(n => n.startsWith('v2-') && n !== APP && n !== MAPA && n !== DADOS)
      .map(n => caches.delete(n))))
    .then(() => self.clients.claim()));
});

const ehTile = url => url.hostname === 'tile.openstreetmap.org' || url.hostname === 'server.arcgisonline.com';

async function limitar(nome, max) {
  const cache = await caches.open(nome);
  const chaves = await cache.keys();
  for (let i = 0; i < chaves.length - max; i++) await cache.delete(chaves[i]);
}

// Guardado primeiro: responde com a cópia e só busca na rede o que ainda não tem.
function guardado(e, nome, max) {
  e.respondWith(caches.open(nome).then(async cache => {
    const salvo = await cache.match(e.request);
    if (salvo) return salvo;
    try {
      const resp = await fetch(e.request);
      if (resp.ok || resp.type === 'opaque') { cache.put(e.request, resp.clone()); limitar(nome, max); }
      return resp;
    } catch (err) {
      return new Response('', { status: 504 });
    }
  }));
}

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  if (ehTile(url)) return guardado(e, MAPA, MAX_TILES);

  if (url.origin !== self.location.origin) return;

  // Rede dos alimentadores (BDGD de um ano): não muda, então fica guardada depois do primeiro acesso.
  const escopo = new URL(self.registration.scope).pathname;
  if (url.pathname.startsWith(`${escopo}dados/2025/`)) return guardado(e, DADOS, MAX_ALIMENTADORES);

  // Arquivos do app: responde com a cópia guardada (funciona offline) e, se houver
  // internet, atualiza a cópia em segundo plano para a próxima abertura.
  if (url.pathname.startsWith(escopo)) {
    e.respondWith(caches.open(APP).then(async cache => {
      const salvo = await cache.match(e.request, { ignoreSearch: true });
      const rede = fetch(e.request).then(resp => {
        if (resp.ok) cache.put(e.request, resp.clone());
        return resp;
      }).catch(() => null);
      if (salvo) { e.waitUntil(rede); return salvo; }
      return (await rede) || new Response('Sem conexão', { status: 503 });
    }));
  }
});
