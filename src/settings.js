'use strict';

const { db } = require('./db');
const { encrypt, decrypt, randomToken } = require('./crypto');
const config = require('./config');

// Nilai yang disimpan terenkripsi di database.
const SECRET_KEYS = new Set(['access_token', 'app_secret']);

const DEFAULTS = {
  phone_number_id: '',
  business_account_id: '',
  app_id: '',
  display_phone_number: '',
  access_token: '',
  app_secret: '',
  verify_token: '',
  graph_version: 'v23.0',
  default_country_code: '62',       // Indonesia
  rate_per_minute: '60',            // kecepatan kirim default (pesan per menit)
  daily_limit: '1000',              // pengaman: maksimal pesan per 24 jam
  require_opt_in: '1',              // hanya kirim ke kontak yang opt-in
  api_key: '',
  app_name: 'CRM Cinta Dakwah',
  logo_url: '',
  business_name: 'Cinta Dakwah',
};

function getAll() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = { ...DEFAULTS };
  for (const row of rows) {
    out[row.key] = SECRET_KEYS.has(row.key) ? decrypt(row.value) : row.value;
  }
  return out;
}

function get(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row) return DEFAULTS[key] !== undefined ? DEFAULTS[key] : '';
  return SECRET_KEYS.has(key) ? decrypt(row.value) : row.value;
}

function set(key, value) {
  const stored = SECRET_KEYS.has(key) ? encrypt(value) : String(value ?? '');
  db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).run(key, stored);
}

function setMany(obj) {
  const tx = db.transaction((entries) => {
    for (const [key, value] of entries) {
      // Field rahasia yang dikirim kosong dari form = "jangan diubah".
      if (SECRET_KEYS.has(key) && (value === '' || value === null || value === undefined)) continue;
      set(key, value);
    }
  });
  tx(Object.entries(obj));
}

/** Menyalin nilai dari .env ke database saat pertama kali dijalankan (kalau ada). */
function seedFromEnv() {
  for (const [key, value] of Object.entries(config.ENV_SETTINGS)) {
    if (!value) continue;
    const existing = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    if (!existing) set(key, value);
  }
  // Verify token wajib ada isinya; kalau kosong dibuatkan otomatis.
  if (!get('verify_token')) set('verify_token', randomToken(16));
}

/** Cek kelengkapan konfigurasi untuk ditampilkan di dashboard. */
function readiness() {
  const s = getAll();
  return {
    phone_number_id: Boolean(s.phone_number_id),
    business_account_id: Boolean(s.business_account_id),
    access_token: Boolean(s.access_token),
    app_secret: Boolean(s.app_secret),
    verify_token: Boolean(s.verify_token),
    ready: Boolean(s.phone_number_id && s.access_token),
  };
}

module.exports = { getAll, get, set, setMany, seedFromEnv, readiness, DEFAULTS, SECRET_KEYS };
