'use strict';

const express = require('express');
const { db, logActivity } = require('../db');
const { requireAuth, requireAdmin } = require('../auth');
const settings = require('../settings');
const config = require('../config');
const wa = require('../whatsapp');
const { randomToken } = require('../crypto');

const router = express.Router();
router.use(requireAuth);

function maskedSettings(req) {
  const s = settings.getAll();
  const base = req.protocol + '://' + req.get('host');
  const publicUrl = config.PUBLIC_URL || base;
  return {
    phone_number_id: s.phone_number_id,
    business_account_id: s.business_account_id,
    app_id: s.app_id,
    display_phone_number: s.display_phone_number,
    graph_version: s.graph_version,
    verify_token: s.verify_token,
    default_country_code: s.default_country_code,
    rate_per_minute: s.rate_per_minute,
    daily_limit: s.daily_limit,
    require_opt_in: s.require_opt_in,
    app_name: s.app_name,
    logo_url: s.logo_url,
    business_name: s.business_name,
    // Nilai rahasia tidak pernah dikirim utuh ke browser.
    has_access_token: Boolean(s.access_token),
    access_token_hint: s.access_token ? `••••••${String(s.access_token).slice(-4)}` : '',
    has_app_secret: Boolean(s.app_secret),
    has_api_key: Boolean(s.api_key),
    webhook_url: `${publicUrl}/webhook`,
    public_url: publicUrl,
  };
}

router.get('/', (req, res) => res.json({ settings: maskedSettings(req) }));

router.put('/', requireAdmin, (req, res) => {
  const allowed = [
    'phone_number_id', 'business_account_id', 'app_id', 'display_phone_number', 'access_token', 'app_secret',
    'verify_token', 'graph_version', 'default_country_code', 'rate_per_minute', 'daily_limit',
    'require_opt_in', 'business_name', 'app_name', 'logo_url',
  ];
  const payload = {};
  for (const key of allowed) {
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, key)) {
      payload[key] = typeof req.body[key] === 'boolean' ? (req.body[key] ? '1' : '0') : String(req.body[key] ?? '').trim();
    }
  }
  if (payload.graph_version && !/^v\d+\.\d+$/.test(payload.graph_version)) {
    return res.status(400).json({ error: 'Format versi API harus seperti "v23.0".' });
  }
  settings.setMany(payload);
  logActivity(req.user.id, 'settings.updated', Object.keys(payload).join(', '));
  res.json({ ok: true, settings: maskedSettings(req) });
});

/** Membuat kunci API untuk sistem lain milik lembaga. */
router.post('/api-key', requireAdmin, (req, res) => {
  const kunci = 'ccd_' + randomToken(24);
  settings.set('api_key', kunci);
  logActivity(req.user.id, 'settings.api_key', 'Kunci API dibuat ulang');
  res.json({ ok: true, api_key: kunci });
});

router.delete('/api-key', requireAdmin, (req, res) => {
  settings.set('api_key', '');
  logActivity(req.user.id, 'settings.api_key', 'Kunci API dinonaktifkan');
  res.json({ ok: true });
});

/** Kunci hanya boleh dilihat admin, karena siapa pun yang punya bisa menulis kontak. */
router.get('/api-key', requireAdmin, (req, res) => {
  res.json({ api_key: settings.get('api_key') || '' });
});

router.post('/regenerate-verify-token', requireAdmin, (req, res) => {
  const token = randomToken(16);
  settings.set('verify_token', token);
  logActivity(req.user.id, 'settings.verify_token', 'Verify token dibuat ulang');
  res.json({ ok: true, verify_token: token });
});

/** Uji kredensial: mengambil informasi nomor pengirim dari Meta. */
router.post('/test', async (req, res) => {
  try {
    const info = await wa.getPhoneNumberInfo();
    if (info?.display_phone_number) settings.set('display_phone_number', info.display_phone_number);
    res.json({
      ok: true,
      info: {
        id: info.id,
        nomor: info.display_phone_number,
        nama_terverifikasi: info.verified_name,
        kualitas: info.quality_rating,
        batas_pesan: info.messaging_limit_tier,
        throughput: info.throughput?.level || '',
      },
    });
  } catch (err) {
    const hints = {
      190: 'Access Token salah atau kadaluarsa. Buat System User Access Token permanen di Meta Business Settings.',
      100: 'Phone Number ID kemungkinan salah. Salin ulang dari WhatsApp Manager > API Setup.',
      200: 'Token tidak punya izin yang dibutuhkan (whatsapp_business_messaging & whatsapp_business_management).',
    };
    res.status(400).json({
      error: err.detail || err.message,
      code: err.code || '',
      hint: hints[err.code] || 'Periksa kembali Phone Number ID dan Access Token di halaman Pengaturan.',
    });
  }
});

/**
 * Memeriksa kesiapan webhook secara menyeluruh, lalu memberi saran langkah
 * perbaikan yang spesifik. Dipakai tombol "Periksa webhook" di halaman ini.
 */
router.post('/webhook-check', async (req, res) => {
  const hasil = { langkah: [], siap: false };
  const s = settings.getAll();

  const tambah = (nama, ok, catatan, saran = '') => hasil.langkah.push({ nama, ok, catatan, saran });

  // 1. Alamat webhook harus HTTPS publik
  const base = config.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  const https = base.startsWith('https://');
  tambah('Alamat webhook memakai HTTPS', https, `${base}/webhook`,
    https ? '' : 'Meta hanya mengirim data ke alamat HTTPS. Pastikan SSL aktif dan PUBLIC_URL sudah https.');

  // 2. Verifikasi URL pernah berhasil
  const verifikasi = db.prepare("SELECT received_at FROM webhook_logs WHERE kind = 'verify' AND ok = 1 ORDER BY id DESC LIMIT 1").get();
  tambah('URL webhook sudah diverifikasi Meta', Boolean(verifikasi),
    verifikasi ? `Terakhir berhasil ${verifikasi.received_at}` : 'Belum pernah berhasil',
    verifikasi ? '' : 'Daftarkan Callback URL dan Verify token di App Dashboard Meta, lalu tekan Verify and save.');

  // 3. Akun WhatsApp harus berlangganan ke APLIKASI INI, bukan sekadar ke
  //    aplikasi mana pun. Satu akun WhatsApp bisa terhubung ke beberapa
  //    aplikasi sekaligus, dan webhook hanya sampai ke aplikasi yang terdaftar.
  try {
    const langganan = await wa.cekLanggananWebhook();
    const daftar = langganan.aplikasi;
    const namaDaftar = daftar.map((a) => a.nama || a.id).join(', ');
    hasil.aplikasiTerhubung = daftar;

    if (!s.app_id) {
      tambah('Aplikasi ini terhubung ke akun WhatsApp', false,
        daftar.length ? `Akun terhubung ke: ${namaDaftar}` : 'Belum ada aplikasi yang terhubung',
        'Isi kolom App ID di bagian atas halaman ini dulu, supaya bisa dipastikan aplikasi mana yang menerima webhook.');
      hasil.bisaDihubungkan = true;
    } else if (daftar.some((a) => String(a.id) === String(s.app_id))) {
      tambah('Aplikasi ini terhubung ke akun WhatsApp', true, `Terhubung ke: ${namaDaftar}`);
      hasil.bisaDihubungkan = false;
    } else {
      tambah('Aplikasi ini terhubung ke akun WhatsApp', false,
        daftar.length
          ? `Akun WhatsApp terhubung ke ${namaDaftar} — tetapi aplikasi ini (App ID ${s.app_id}) tidak termasuk.`
          : 'Belum ada aplikasi yang terhubung',
        'Tekan tombol "Hubungkan sekarang" di bawah. Selama aplikasi ini belum terdaftar, seluruh status pesan dan balasan pelanggan dikirim Meta ke aplikasi lain, bukan ke sini.');
      hasil.bisaDihubungkan = true;
    }
  } catch (err) {
    tambah('Aplikasi ini terhubung ke akun WhatsApp', false, err.detail || err.message,
      'Periksa kembali WhatsApp Business Account ID dan Access Token di halaman ini.');
  }

  // 4. Sudah pernah menerima data sungguhan (bukan sekadar verifikasi)
  const peristiwa = db.prepare("SELECT received_at FROM webhook_logs WHERE kind = 'event' AND ok = 1 ORDER BY id DESC LIMIT 1").get();
  tambah('Sudah pernah menerima data dari Meta', Boolean(peristiwa),
    peristiwa ? `Terakhir ${peristiwa.received_at}` : 'Belum pernah menerima satu pun',
    peristiwa ? '' : 'Setelah tiga langkah di atas hijau, centang field "messages" di App Dashboard Meta pada bagian Webhook fields.');

  // 5. App Secret untuk memverifikasi keaslian data
  tambah('App Secret terisi', Boolean(s.app_secret), s.app_secret ? 'Terisi' : 'Belum diisi',
    s.app_secret ? '' : 'Tanpa App Secret, data webhook tetap diterima tetapi keasliannya tidak diperiksa.');

  hasil.siap = hasil.langkah.slice(0, 4).every((l) => l.ok);
  res.json(hasil);
});

/** Mengaitkan akun WhatsApp ke aplikasi (langkah yang paling sering terlewat). */
router.post('/webhook-subscribe', requireAdmin, async (req, res) => {
  try {
    await wa.aktifkanLanggananWebhook();
    const langganan = await wa.cekLanggananWebhook();
    logActivity(req.user.id, 'settings.webhook_subscribe', 'Akun WhatsApp dihubungkan ke aplikasi');
    res.json({ ok: true, berlangganan: langganan.berlangganan, aplikasi: langganan.aplikasi });
  } catch (err) {
    res.status(400).json({
      error: err.detail || err.message,
      code: err.code || '',
      hint: 'Access Token perlu izin whatsapp_business_management. Pastikan System User punya Full control atas WhatsApp Account kamu.',
    });
  }
});

router.get('/webhook-logs', (req, res) => {
  const rows = db.prepare('SELECT id, kind, ok, note, substr(raw, 1, 1500) AS raw, received_at FROM webhook_logs ORDER BY id DESC LIMIT 50').all();
  res.json({ logs: rows });
});

router.get('/activity-logs', requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT a.*, u.name AS user_name, u.email AS user_email
    FROM activity_logs a LEFT JOIN users u ON u.id = a.user_id
    ORDER BY a.id DESC LIMIT 200
  `).all();
  res.json({ logs: rows });
});

module.exports = router;
