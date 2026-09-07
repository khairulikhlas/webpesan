'use strict';

const { db, logActivity } = require('./db');
const { hashPassword, verifyPassword, randomToken } = require('./crypto');
const config = require('./config');

const COOKIE_NAME = 'webpesan_session';
const SESSION_DAYS = 14;

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  }
  return out;
}

function countUsers() {
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
}

function findUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE lower(email) = lower(?)').get(String(email || '').trim());
}

function createUser({ email, password, name = '', role = 'staff' }) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!cleanEmail || !cleanEmail.includes('@')) throw new Error('Alamat email tidak valid.');
  if (String(password || '').length < 8) throw new Error('Kata sandi minimal 8 karakter.');
  if (findUserByEmail(cleanEmail)) throw new Error('Email tersebut sudah terdaftar.');

  const info = db.prepare(`
    INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, ?)
  `).run(cleanEmail, String(name || '').trim(), hashPassword(password), role === 'admin' ? 'admin' : 'staff');
  return db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
}

function login(email, password) {
  const user = findUserByEmail(email);
  if (!user || !user.is_active) return null;
  if (!verifyPassword(password, user.password_hash)) return null;
  return user;
}

function createSession(userId) {
  const token = randomToken(32);
  db.prepare(`
    INSERT INTO sessions (token, user_id, expires_at)
    VALUES (?, ?, datetime('now', ?))
  `).run(token, userId, `+${SESSION_DAYS} days`);
  return token;
}

function destroySession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function cleanupSessions() {
  db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();
}

function getUserFromRequest(req) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.* FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > datetime('now') AND u.is_active = 1
  `).get(token);
  if (!row) return null;
  req.sessionToken = token;
  return row;
}

function setSessionCookie(res, token) {
  const secure = config.PUBLIC_URL.startsWith('https://');
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_DAYS * 24 * 60 * 60}`,
  ];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function attachUser(req, res, next) {
  req.user = getUserFromRequest(req);
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Silakan masuk terlebih dahulu.' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Silakan masuk terlebih dahulu.' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Hanya admin yang boleh melakukan ini.' });
  next();
}

function publicUser(user) {
  if (!user) return null;
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

/** Membuat admin pertama dari .env kalau belum ada pengguna sama sekali. */
function seedAdminFromEnv() {
  if (countUsers() > 0) return;
  if (!config.ADMIN_EMAIL || !config.ADMIN_PASSWORD) return;
  try {
    const user = createUser({
      email: config.ADMIN_EMAIL,
      password: config.ADMIN_PASSWORD,
      name: config.ADMIN_NAME,
      role: 'admin',
    });
    logActivity(user.id, 'user.seed', 'Admin pertama dibuat dari file .env');
    console.log(`[auth] Admin pertama dibuat: ${user.email}`);
  } catch (err) {
    console.error('[auth] Gagal membuat admin dari .env:', err.message);
  }
}

module.exports = {
  COOKIE_NAME, countUsers, createUser, login, createSession, destroySession, cleanupSessions,
  getUserFromRequest, setSessionCookie, clearSessionCookie, attachUser, requireAuth, requireAdmin,
  publicUser, seedAdminFromEnv, findUserByEmail,
};
