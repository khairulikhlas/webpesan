'use strict';

const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// Jalur .env sengaja ditulis absolut. Di hosting shared (Passenger/cPanel),
// aplikasi kadang dijalankan dari folder kerja yang berbeda, dan jalur relatif
// membuat file .env tidak terbaca sehingga pengaturan hilang diam-diam.
require('dotenv').config({ path: path.join(ROOT, '.env'), quiet: true });
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(ROOT, 'data');

module.exports = {
  ROOT,
  DATA_DIR,
  DB_FILE: path.join(DATA_DIR, 'webpesan.sqlite'),
  KEY_FILE: path.join(DATA_DIR, 'keyfile'),
  PORT: Number(process.env.PORT || 3000),
  PUBLIC_URL: (process.env.PUBLIC_URL || '').replace(/\/+$/, ''),
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || '',
  NODE_ENV: process.env.NODE_ENV || 'development',
  ADMIN_EMAIL: process.env.ADMIN_EMAIL || '',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || '',
  ADMIN_NAME: process.env.ADMIN_NAME || 'Administrator',
  // Nilai awal kredensial WhatsApp (boleh kosong, bisa diisi lewat UI Pengaturan)
  ENV_SETTINGS: {
    phone_number_id: process.env.WA_PHONE_NUMBER_ID || '',
    business_account_id: process.env.WA_BUSINESS_ACCOUNT_ID || '',
    access_token: process.env.WA_ACCESS_TOKEN || '',
    app_secret: process.env.WA_APP_SECRET || '',
    verify_token: process.env.WA_VERIFY_TOKEN || '',
    graph_version: process.env.WA_GRAPH_VERSION || '',
  },
};
