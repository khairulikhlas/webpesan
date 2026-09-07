'use strict';

/**
 * WEBPESAN - aplikasi web untuk WhatsApp broadcast lewat WhatsApp Cloud API.
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
app.use('/api/stats', require('./src/routes/stats'));

app.get('/healthz', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString(), version: require('./package.json').version });
});

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
  console.log('  WEBPESAN siap digunakan');
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
