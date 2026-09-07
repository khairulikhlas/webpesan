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
    display_phone_number: s.display_phone_number,
    graph_version: s.graph_version,
    verify_token: s.verify_token,
    default_country_code: s.default_country_code,
    rate_per_minute: s.rate_per_minute,
    daily_limit: s.daily_limit,
    require_opt_in: s.require_opt_in,
    business_name: s.business_name,
    // Nilai rahasia tidak pernah dikirim utuh ke browser.
    has_access_token: Boolean(s.access_token),
    access_token_hint: s.access_token ? `••••••${String(s.access_token).slice(-4)}` : '',
    has_app_secret: Boolean(s.app_secret),
    webhook_url: `${publicUrl}/webhook`,
    public_url: publicUrl,
  };
}

router.get('/', (req, res) => res.json({ settings: maskedSettings(req) }));

router.put('/', requireAdmin, (req, res) => {
  const allowed = [
    'phone_number_id', 'business_account_id', 'display_phone_number', 'access_token', 'app_secret',
    'verify_token', 'graph_version', 'default_country_code', 'rate_per_minute', 'daily_limit',
    'require_opt_in', 'business_name',
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
