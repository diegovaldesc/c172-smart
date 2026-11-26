const CACHE = 'c172smart-v11';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'modelos.js', 'aerodromos.js', 'data/aerodromos.json', 'manifest.webmanifest', 'icon.svg'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))));
// Red primero (para recibir actualizaciones); si no hay conexión, usa la copia guardada.
self.addEventListener('fetch', e => e.respondWith(
  fetch(e.request).then(r => {
    const copy = r.clone();
    caches.open(CACHE).then(c => c.put(e.request, copy));
    return r;
  }).catch(() => caches.match(e.request))));
