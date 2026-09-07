'use strict';

/**
 * Membuat ulang / mengatur ulang akun admin dari terminal.
 * Contoh: node scripts/reset-admin.js admin@perusahaan.id KataSandiBaru123
 */

const { db } = require('../src/db');
const { hashPassword } = require('../src/crypto');
const auth = require('../src/auth');

const [, , email, password, name] = process.argv;
if (!email || !password) {
  console.log('Cara pakai: node scripts/reset-admin.js <email> <kata-sandi> [nama]');
  process.exit(1);
}
if (password.length < 8) {
  console.log('Kata sandi minimal 8 karakter.');
  process.exit(1);
}

const existing = auth.findUserByEmail(email);
if (existing) {
  db.prepare("UPDATE users SET password_hash = ?, role = 'admin', is_active = 1 WHERE id = ?")
    .run(hashPassword(password), existing.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(existing.id);
  console.log(`Kata sandi untuk ${email} berhasil diatur ulang, dan akun dijadikan admin.`);
} else {
  auth.createUser({ email, password, name: name || 'Administrator', role: 'admin' });
  console.log(`Admin baru dibuat: ${email}`);
}
