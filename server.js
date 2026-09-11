'use strict';

/**
 * CRM CINTA DAKWAH - aplikasi web untuk WhatsApp broadcast lewat WhatsApp Cloud API.
 *
 * Jalankan dengan:  npm start
 * Lalu buka:        http://localhost:3000
 */

const path = require('path');
const express = require('express');

const config = require('./src/config');
const { db } = require('./src/db');
const settings = require('./src/settings');
const auth = require('./src/auth');
const webhook = require('./src/webhook');
const queue = require('./src/queue');

const app = express();

// Aplikasi biasanya dipasang di belakang Nginx/Cloudflare -> percayai header proxy
// supaya req.protocol ikut https dan cookie Secure bekerja.
app.set('trust proxy', 1);
app.disable('x-powered-by');

// Simpan body mentah: dibutuhkan untuk memeriksa tanda tangan webhook dari Meta.
app.use(express.json({
  limit: '25mb',
  verify: (req, res, buf) => { req.rawBody = buf; },
}));
app.use(express.urlencoded({ extended: false, limit: '25mb' }));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});

app.use(auth.attachUser);

// ---------------------------------------------------------------------------
// Webhook Meta (tanpa login - diverifikasi lewat verify token & tanda tangan)
// ---------------------------------------------------------------------------
app.get('/webhook', webhook.handleVerification);
app.post('/webhook', webhook.handleEvent);

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/contacts', require('./src/routes/contacts'));
app.use('/api/templates', require('./src/routes/templates'));
app.use('/api/campaigns', require('./src/routes/campaigns'));
app.use('/api/inbox', require('./src/routes/inbox'));
app.use('/api/settings', require('./src/routes/settings'));
app.use('/api/media', require('./src/routes/media'));

// API untuk sistem lain milik lembaga (memakai kunci API, bukan login).
app.use('/api/v1', require('./src/routes/api-publik'));
app.use('/api/stats', require('./src/routes/stats'));

// ---------------------------------------------------------------------------
// Ikon aplikasi dan manifest
//
// Keduanya disusun saat diminta, bukan berupa berkas tetap, supaya ikon yang
// diunggah pemilik aplikasi langsung dipakai sebagai ikon tab browser maupun
// ikon aplikasi di HP.
// ---------------------------------------------------------------------------
const appIcon = require('./src/app-icon');

app.get('/app-icon', (req, res) => {
  const ikon = appIcon.ikonSekarang();
  res.setHeader('Content-Type', ikon.mime);
  // Alamatnya tetap sama setiap saat, jadi penanda versi dipakai agar browser
  // tahu kapan harus mengambil ulang.
  res.setHeader('ETag', `"${ikon.versi}"`);
  res.setHeader('Cache-Control', 'public, max-age=86400, must-revalidate');
  if (req.headers['if-none-match'] === `"${ikon.versi}"`) return res.status(304).end();
  res.sendFile(ikon.jalur);
});

app.get('/manifest.webmanifest', (req, res) => {
  const ikon = appIcon.ikonSekarang();
  const nama = settings.get('app_name') || 'CRM Cinta Dakwah';
  const ukuran = `${ikon.lebar}x${ikon.tinggi}`;
  const alamat = `/app-icon?v=${ikon.versi}`;

  res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.json({
    name: nama,
    short_name: nama.length > 12 ? nama.slice(0, 12).trim() : nama,
    description: 'Kirim broadcast WhatsApp dan layani balasan donatur dari satu tempat.',
    lang: 'id',
    dir: 'ltr',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    background_color: '#3a3a3c',
    theme_color: '#3a3a3c',
    icons: [
      { src: alamat, sizes: ukuran, type: ikon.mime, purpose: 'any' },
      { src: alamat, sizes: ukuran, type: ikon.mime, purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Kotak Masuk', url: '/#/inbox', description: 'Baca dan balas pesan donatur' },
      { name: 'Buat Broadcast', url: '/#/broadcast', description: 'Kirim pesan ke banyak kontak' },
    ],
  });
});

// Nama aplikasi dibutuhkan halaman login, jadi endpoint ini tidak perlu login.
app.get('/api/app-info', (req, res) => {
  res.json({
    app_name: settings.get('app_name') || 'CRM Cinta Dakwah',
    logo_url: settings.get('logo_url') || '',
    icon_versi: appIcon.ikonSekarang().versi,
  });
});

/**
 * Endpoint pemantau. Di hosting shared, aplikasi bisa "ditidurkan" saat tidak ada
 * pengunjung sehingga antrean broadcast ikut berhenti. Panggil alamat ini lewat
 * Cron Job tiap menit supaya aplikasi tetap hidup dan antrean terus berjalan.
 */
app.get('/healthz', (req, res) => {
  let antrean = { menunggu: 0, kampanye_berjalan: 0 };
  try {
    antrean = {
      menunggu: db.prepare("SELECT COUNT(*) AS n FROM outbound_messages WHERE status = 'pending'").get().n,
      kampanye_berjalan: db.prepare("SELECT COUNT(*) AS n FROM campaigns WHERE status IN ('running','scheduled')").get().n,
    };
  } catch { /* abaikan, yang penting endpoint tetap menjawab */ }
  res.json({ ok: true, time: new Date().toISOString(), version: require('./package.json').version, antrean });
});

// ---------------------------------------------------------------------------
// Berkas media
// WhatsApp mengunduh gambar/video/dokumen header langsung dari alamat ini,
// jadi folder ini memang harus bisa diakses publik tanpa login.
// ---------------------------------------------------------------------------
app.use('/media', express.static(require('./src/routes/media').MEDIA_DIR, {
  maxAge: '30d',
  index: false,
  dotfiles: 'deny',
}));

// ---------------------------------------------------------------------------
// Halaman web
// ---------------------------------------------------------------------------
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint tidak ditemukan.' }));

app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Penanganan error terakhir supaya pesan error tetap rapi (bukan halaman putih).
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error('[error]', err);
  if (res.headersSent) return;
  res.status(500).json({ error: 'Terjadi kesalahan di server: ' + err.message });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
settings.seedFromEnv();
auth.seedAdminFromEnv();
auth.cleanupSessions();
setInterval(() => auth.cleanupSessions(), 60 * 60 * 1000).unref();

const server = app.listen(config.PORT, () => {
  const url = config.PUBLIC_URL || `http://localhost:${config.PORT}`;
  console.log('');
  console.log(`  ${settings.get('app_name') || 'CRM Cinta Dakwah'} siap digunakan`);
  console.log(`  Buka di browser : ${url}`);
  console.log(`  URL webhook     : ${url}/webhook`);
  console.log(`  Verify token    : ${settings.get('verify_token')}`);
  if (auth.countUsers() === 0) {
    console.log('  Catatan         : belum ada pengguna, buka halaman di atas untuk membuat admin pertama.');
  }
  console.log('');
  queue.start();
});

function shutdown(signal) {
  console.log(`\n[server] ${signal} diterima, menutup aplikasi...`);
  queue.stop();
  server.close(() => {
    try { db.close(); } catch { /* abaikan */ }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = app;
