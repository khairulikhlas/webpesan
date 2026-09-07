'use strict';

/**
 * Enkripsi nilai sensitif (Access Token, App Secret) sebelum disimpan ke database,
 * plus hashing password pengguna.
 *
 * - Enkripsi  : AES-256-GCM (kunci dari ENCRYPTION_KEY atau file data/keyfile)
 * - Password  : scrypt + salt acak (bawaan Node, tanpa dependensi tambahan)
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('./config');

let cachedKey = null;

function getKey() {
  if (cachedKey) return cachedKey;

  const fromEnv = (config.ENCRYPTION_KEY || '').trim();
  if (fromEnv) {
    // Terima hex 64 karakter, atau string bebas (di-hash jadi 32 byte).
    cachedKey = /^[0-9a-fA-F]{64}$/.test(fromEnv)
      ? Buffer.from(fromEnv, 'hex')
      : crypto.createHash('sha256').update(fromEnv).digest();
    return cachedKey;
  }

  // Tidak ada ENCRYPTION_KEY: pakai/buat file kunci lokal.
  fs.mkdirSync(path.dirname(config.KEY_FILE), { recursive: true });
  if (fs.existsSync(config.KEY_FILE)) {
    cachedKey = Buffer.from(fs.readFileSync(config.KEY_FILE, 'utf8').trim(), 'hex');
  } else {
    const key = crypto.randomBytes(32);
    fs.writeFileSync(config.KEY_FILE, key.toString('hex'), { mode: 0o600 });
    cachedKey = key;
  }
  return cachedKey;
}

function encrypt(plainText) {
  if (plainText === null || plainText === undefined || plainText === '') return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

function decrypt(payload) {
  if (!payload) return '';
  const parts = String(payload).split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') return String(payload); // nilai lama/plain
  try {
    const iv = Buffer.from(parts[1], 'base64');
    const tag = Buffer.from(parts[2], 'base64');
    const data = Buffer.from(parts[3], 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch (err) {
    console.error('[crypto] Gagal mendekripsi nilai (kunci enkripsi berubah?):', err.message);
    return '';
  }
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 64);
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  if (!stored) return false;
  const parts = String(stored).split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  const actual = crypto.scryptSync(String(password), salt, expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

module.exports = { encrypt, decrypt, hashPassword, verifyPassword, randomToken };
