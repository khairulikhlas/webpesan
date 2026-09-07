'use strict';

const express = require('express');
const auth = require('../auth');
const { db, logActivity } = require('../db');

const router = express.Router();

/**
 * Pembatas percobaan masuk sederhana: menahan serangan tebak kata sandi.
 * Maksimal 8 percobaan gagal per 15 menit untuk tiap kombinasi IP + email.
 */
const percobaan = new Map();
const MAKS_PERCOBAAN = 8;
const JENDELA_MS = 15 * 60 * 1000;

function kunciPercobaan(req, email) {
  return `${req.ip}|${String(email || '').toLowerCase()}`;
}

function terlaluSering(kunci) {
  const data = percobaan.get(kunci);
  if (!data) return false;
  if (Date.now() - data.mulai > JENDELA_MS) { percobaan.delete(kunci); return false; }
  return data.jumlah >= MAKS_PERCOBAAN;
}

function catatGagal(kunci) {
  const data = percobaan.get(kunci);
  if (!data || Date.now() - data.mulai > JENDELA_MS) percobaan.set(kunci, { jumlah: 1, mulai: Date.now() });
  else data.jumlah += 1;
}

// Bersihkan catatan lama tiap 30 menit supaya tidak menumpuk di memori.
setInterval(() => {
  const sekarang = Date.now();
  for (const [kunci, data] of percobaan) if (sekarang - data.mulai > JENDELA_MS) percobaan.delete(kunci);
}, 30 * 60 * 1000).unref();

router.get('/state', (req, res) => {
  res.json({
    needsSetup: auth.countUsers() === 0,
    user: auth.publicUser(req.user),
  });
});

router.post('/setup', (req, res) => {
  if (auth.countUsers() > 0) {
    return res.status(400).json({ error: 'Admin sudah pernah dibuat. Silakan masuk.' });
  }
  const { email, password, name } = req.body || {};
  try {
    const user = auth.createUser({ email, password, name, role: 'admin' });
    const token = auth.createSession(user.id);
    auth.setSessionCookie(res, token);
    logActivity(user.id, 'user.setup', 'Admin pertama dibuat lewat halaman awal');
    res.json({ ok: true, user: auth.publicUser(user) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  const kunci = kunciPercobaan(req, email);
  if (terlaluSering(kunci)) {
    return res.status(429).json({ error: 'Terlalu banyak percobaan masuk yang gagal. Coba lagi 15 menit lagi.' });
  }

  const user = auth.login(email, password);
  if (!user) {
    catatGagal(kunci);
    logActivity(null, 'user.login_failed', String(email || '').slice(0, 120));
    return res.status(401).json({ error: 'Email atau kata sandi salah.' });
  }
  percobaan.delete(kunci);
  const token = auth.createSession(user.id);
  auth.setSessionCookie(res, token);
  logActivity(user.id, 'user.login', user.email);
  res.json({ ok: true, user: auth.publicUser(user) });
});

router.post('/logout', (req, res) => {
  auth.destroySession(req.sessionToken);
  auth.clearSessionCookie(res);
  res.json({ ok: true });
});

router.post('/password', auth.requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const user = auth.login(req.user.email, currentPassword);
  if (!user) return res.status(400).json({ error: 'Kata sandi saat ini salah.' });
  if (String(newPassword || '').length < 8) return res.status(400).json({ error: 'Kata sandi baru minimal 8 karakter.' });
  const { hashPassword } = require('../crypto');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), user.id);
  logActivity(user.id, 'user.password_changed', user.email);
  res.json({ ok: true });
});

// ---- Manajemen anggota tim (khusus admin) ----

router.get('/users', auth.requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT id, email, name, role, is_active, created_at FROM users ORDER BY id ASC').all();
  res.json({ users: rows });
});

router.post('/users', auth.requireAdmin, (req, res) => {
  const { email, password, name, role } = req.body || {};
  try {
    const user = auth.createUser({ email, password, name, role });
    logActivity(req.user.id, 'user.created', user.email);
    res.json({ ok: true, user: auth.publicUser(user) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/users/:id', auth.requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });

  const { name, role, is_active, password } = req.body || {};
  if (target.id === req.user.id && (role === 'staff' || is_active === 0 || is_active === false)) {
    return res.status(400).json({ error: 'Kamu tidak bisa menurunkan atau menonaktifkan akunmu sendiri.' });
  }
  if (name !== undefined) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(String(name), id);
  if (role !== undefined) db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role === 'admin' ? 'admin' : 'staff', id);
  if (is_active !== undefined) db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(is_active ? 1 : 0, id);
  if (password) {
    if (String(password).length < 8) return res.status(400).json({ error: 'Kata sandi minimal 8 karakter.' });
    const { hashPassword } = require('../crypto');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  }
  logActivity(req.user.id, 'user.updated', target.email);
  res.json({ ok: true });
});

router.delete('/users/:id', auth.requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'Kamu tidak bisa menghapus akunmu sendiri.' });
  const target = db.prepare('SELECT email FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  logActivity(req.user.id, 'user.deleted', target.email);
  res.json({ ok: true });
});

module.exports = router;
