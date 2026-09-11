'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./config');

fs.mkdirSync(config.DATA_DIR, { recursive: true });

/**
 * Pengaman tambahan untuk hosting shared: kalau folder aplikasi kebetulan
 * berada di dalam public_html, file database bisa terunduh lewat browser.
 * Dua file kecil ini memblokir akses tersebut di Apache/LiteSpeed.
 * (Tetap disarankan menaruh folder aplikasi DI LUAR public_html.)
 */
function lindungiFolderData() {
  const htaccess = path.join(config.DATA_DIR, '.htaccess');
  if (!fs.existsSync(htaccess)) {
    fs.writeFileSync(htaccess, [
      '# Jangan izinkan siapa pun mengunduh isi folder ini lewat browser.',
      '<IfModule mod_authz_core.c>',
      '  Require all denied',
      '</IfModule>',
      '<IfModule !mod_authz_core.c>',
      '  Order allow,deny',
      '  Deny from all',
      '</IfModule>',
      'Options -Indexes',
      '',
    ].join('\n'));
  }
  const indeks = path.join(config.DATA_DIR, 'index.html');
  if (!fs.existsSync(indeks)) fs.writeFileSync(indeks, '');
}

try {
  lindungiFolderData();
} catch (err) {
  console.warn('[db] Tidak bisa membuat berkas pelindung folder data:', err.message);
}

const db = new Database(config.DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'staff',   -- admin | staff
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contacts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  phone          TEXT NOT NULL UNIQUE,          -- format E.164 tanpa '+' (contoh: 6281234567890)
  name           TEXT NOT NULL DEFAULT '',
  email          TEXT NOT NULL DEFAULT '',
  tags           TEXT NOT NULL DEFAULT '',      -- dipisah koma, contoh: "pelanggan,jakarta"
  attributes     TEXT NOT NULL DEFAULT '{}',    -- JSON untuk kolom tambahan dari CSV
  opt_in         INTEGER NOT NULL DEFAULT 1,
  opt_in_source  TEXT NOT NULL DEFAULT '',
  opt_in_at      TEXT,
  opt_out_at     TEXT,
  last_inbound_at TEXT,
  notes          TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_contacts_optin ON contacts(opt_in);

CREATE TABLE IF NOT EXISTS templates (
  name        TEXT NOT NULL,
  language    TEXT NOT NULL,
  template_id TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT '',
  category    TEXT NOT NULL DEFAULT '',
  components  TEXT NOT NULL DEFAULT '[]',
  synced_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (name, language)
);

CREATE TABLE IF NOT EXISTS campaigns (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT NOT NULL,
  template_name     TEXT NOT NULL,
  template_language TEXT NOT NULL,
  mapping           TEXT NOT NULL DEFAULT '{}',  -- JSON: isi variabel template
  audience          TEXT NOT NULL DEFAULT '{}',  -- JSON: kriteria penerima (untuk catatan)
  status            TEXT NOT NULL DEFAULT 'draft', -- draft|running|paused|done|canceled
  rate_per_minute   INTEGER NOT NULL DEFAULT 60,
  scheduled_at      TEXT,
  last_error        TEXT NOT NULL DEFAULT '',
  total             INTEGER NOT NULL DEFAULT 0,
  created_by        INTEGER REFERENCES users(id),
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  started_at        TEXT,
  finished_at       TEXT
);

CREATE TABLE IF NOT EXISTS outbound_messages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id  INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,
  contact_id   INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  phone        TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'template',  -- template | text
  body_preview TEXT NOT NULL DEFAULT '',
  payload      TEXT NOT NULL DEFAULT '{}',
  status       TEXT NOT NULL DEFAULT 'pending',   -- pending|sent|delivered|read|failed|canceled
  wamid        TEXT,
  attempts     INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  error_code   TEXT,
  error_title  TEXT,
  error_detail TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at      TEXT,
  delivered_at TEXT,
  read_at      TEXT,
  failed_at    TEXT,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_out_campaign ON outbound_messages(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_out_wamid    ON outbound_messages(wamid);
CREATE INDEX IF NOT EXISTS idx_out_status   ON outbound_messages(status);
CREATE INDEX IF NOT EXISTS idx_out_sentat   ON outbound_messages(sent_at);

CREATE TABLE IF NOT EXISTS inbound_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  wamid       TEXT UNIQUE,
  contact_id  INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  phone       TEXT NOT NULL,
  profile_name TEXT NOT NULL DEFAULT '',
  type        TEXT NOT NULL DEFAULT 'text',
  body        TEXT NOT NULL DEFAULT '',
  raw         TEXT NOT NULL DEFAULT '{}',
  media_id    TEXT,
  is_read     INTEGER NOT NULL DEFAULT 0,
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_in_phone ON inbound_messages(phone, received_at);

CREATE TABLE IF NOT EXISTS media (
  id           TEXT PRIMARY KEY,          -- nama berkas di folder data/media
  original_name TEXT NOT NULL DEFAULT '',
  mime         TEXT NOT NULL DEFAULT '',
  size         INTEGER NOT NULL DEFAULT 0,
  uploaded_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Mengingat isian variabel terakhir untuk tiap template, supaya pengguna tidak
-- perlu mengetik ulang (termasuk alamat gambar header) setiap kali broadcast.
CREATE TABLE IF NOT EXISTS template_defaults (
  name       TEXT NOT NULL,
  language   TEXT NOT NULL,
  mapping    TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (name, language)
);

CREATE TABLE IF NOT EXISTS webhook_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT NOT NULL DEFAULT 'event',
  ok          INTEGER NOT NULL DEFAULT 1,
  note        TEXT NOT NULL DEFAULT '',
  raw         TEXT NOT NULL DEFAULT '',
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS activity_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER,
  action     TEXT NOT NULL,
  detail     TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

/**
 * Migrasi ringan: menambah kolom baru pada database yang sudah terlanjur dibuat
 * versi sebelumnya. Aman dijalankan berulang kali.
 */
function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

ensureColumn('campaigns', 'scheduled_at', 'TEXT');
ensureColumn('campaigns', 'last_error', "TEXT NOT NULL DEFAULT ''");
ensureColumn('outbound_messages', 'next_attempt_at', 'TEXT');
ensureColumn('inbound_messages', 'media_id', 'TEXT');
ensureColumn('outbound_messages', 'media_id', 'TEXT');

function logActivity(userId, action, detail = '') {
  try {
    db.prepare('INSERT INTO activity_logs (user_id, action, detail) VALUES (?, ?, ?)')
      .run(userId || null, action, typeof detail === 'string' ? detail : JSON.stringify(detail));
  } catch (err) {
    console.error('[db] gagal menulis activity log:', err.message);
  }
}

module.exports = { db, logActivity };
