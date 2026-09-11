/*
 * Service worker: membuat aplikasi bisa dipasang di HP dan tetap terbuka
 * saat sinyal putus.
 *
 * Strategi sengaja "jaringan dulu, simpanan kemudian" untuk berkas program.
 * Alasannya: aplikasi ini sering diperbarui, dan kalau simpanan didahulukan,
 * petugas bisa memakai versi lama tanpa sadar. Dengan cara ini, selama ada
 * sinyal mereka selalu memakai versi terbaru, dan saat sinyal hilang
 * tampilannya tetap terbuka memakai simpanan terakhir.
 */

const NAMA_SIMPANAN = 'crm-cinta-dakwah-v1';
const BERKAS_INTI = [
  '/',
  '/css/style.css',
  '/js/core.js',
  '/js/main.js',
  '/js/views-dashboard.js',
  '/js/views-contacts.js',
  '/js/views-templates.js',
  '/js/views-broadcast.js',
  '/js/views-campaigns.js',
  '/js/views-inbox.js',
  '/js/views-settings.js',
  '/js/views-guide.js',
  '/icon-192.png',
  '/icon-512.png',
  '/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(NAMA_SIMPANAN)
      .then((simpanan) => simpanan.addAll(BERKAS_INTI))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((nama) => Promise.all(nama.filter((n) => n !== NAMA_SIMPANAN).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Data dan berkas media selalu diambil langsung, tidak pernah disimpan,
  // supaya status pesan dan isi percakapan tidak pernah basi.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/')
      || url.pathname === '/webhook' || url.pathname === '/healthz') {
    return;
  }

  event.respondWith(
    fetch(request)
      .then((jawaban) => {
        if (jawaban && jawaban.status === 200 && jawaban.type === 'basic') {
          const salinan = jawaban.clone();
          caches.open(NAMA_SIMPANAN).then((simpanan) => simpanan.put(request, salinan)).catch(() => {});
        }
        return jawaban;
      })
      .catch(() => caches.match(request).then((tersimpan) => tersimpan || caches.match('/'))),
  );
});
