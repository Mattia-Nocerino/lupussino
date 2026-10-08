// Service worker: rende Lupussino utilizzabile senza campo.
// - file del sito: prima la rete (così prendi sempre l'ultima versione), la copia salvata se sei offline
//   o se la rete non risponde entro qualche secondo (campo debole)
// - SDK Firebase (indirizzi con la versione, non cambiano mai): prima la copia salvata
const CACHE = 'lupussino-v7';
const SDK = '12.19.0';
const FILE = [
  './', 'index.html', 'css/style.css', 'js/app.js', 'js/game.js', 'js/offline.js', 'js/firebase-config.js',
  'js/p2p.js', 'js/rete.js', 'js/dati.js', 'prova-rete.html', 'vendor/qrcode.js', 'vendor/jsQR.js',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
  ...['app', 'auth', 'database'].map((m) => `https://www.gstatic.com/firebasejs/${SDK}/firebase-${m}.js`),
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((chiavi) => Promise.all(chiavi.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === location.origin) {
    e.respondWith(primaLaRete(request));
  } else if (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) {
    e.respondWith(caches.match(request).then((r) => r ?? fetch(request).then((risposta) => {
      if (risposta.ok) caches.open(CACHE).then((c) => c.put(request, risposta.clone()));
      return risposta;
    })));
  }
  // tutto il resto (database, login) passa direttamente
});

const ATTESA_RETE_MS = 3000;

function dallaCache(request) {
  return caches.match(request, { ignoreSearch: true })
    .then((r) => r ?? (request.mode === 'navigate' ? caches.match('index.html') : undefined));
}

async function primaLaRete(request) {
  const rete = fetch(request).then((risposta) => {
    if (risposta.ok) caches.open(CACHE).then((c) => c.put(request, risposta.clone()));
    return risposta;
  });
  rete.catch(() => {}); // se vince la copia salvata, l'errore della rete non interessa
  try {
    const lenta = new Promise((ok) => { setTimeout(ok, ATTESA_RETE_MS); });
    const risposta = await Promise.race([rete, lenta]);
    if (risposta) return risposta;
    return (await dallaCache(request)) ?? (await rete); // rete lenta: meglio la copia salvata, se c'è
  } catch {
    return (await dallaCache(request)) ?? Response.error();
  }
}
