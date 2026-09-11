'use strict';

/**
 * Penyimpanan berkas media bersama, dipakai oleh galeri media (unggahan
 * pengguna) maupun penerima webhook (gambar yang dikirim pelanggan, misalnya
 * bukti transfer).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db } = require('./db');
const config = require('./config');

const MEDIA_DIR = path.join(config.DATA_DIR, 'media');
fs.mkdirSync(MEDIA_DIR, { recursive: true });

// Jenis berkas yang bisa disimpan, beserta batas ukuran dari WhatsApp.
const JENIS = {
  'image/jpeg': { ext: 'jpg', maks: 5 * 1024 * 1024, label: 'Gambar JPG' },
  'image/png': { ext: 'png', maks: 5 * 1024 * 1024, label: 'Gambar PNG' },
  'image/webp': { ext: 'webp', maks: 5 * 1024 * 1024, label: 'Gambar WebP' },
  'video/mp4': { ext: 'mp4', maks: 16 * 1024 * 1024, label: 'Video MP4' },
  'audio/ogg': { ext: 'ogg', maks: 16 * 1024 * 1024, label: 'Pesan suara' },
  'audio/mpeg': { ext: 'mp3', maks: 16 * 1024 * 1024, label: 'Audio MP3' },
  'application/pdf': { ext: 'pdf', maks: 100 * 1024 * 1024, label: 'Dokumen PDF' },
};

function jenisDari(mime) {
  return JENIS[String(mime || '').toLowerCase().split(';')[0].trim()] || null;
}

/** Menyimpan berkas ke folder media dan mencatatnya di database. */
function simpanBerkas({ buffer, mime, originalName = '', userId = null, abaikanBatas = false }) {
  const jenis = jenisDari(mime);
  if (!jenis) throw new Error(`Jenis berkas "${mime || 'tidak dikenal'}" tidak didukung.`);
  if (!buffer || buffer.length === 0) throw new Error('Berkas kosong.');
  if (!abaikanBatas && buffer.length > jenis.maks) {
    throw new Error(`Ukuran berkas ${(buffer.length / 1024 / 1024).toFixed(1)} MB melebihi batas ${jenis.maks / 1024 / 1024} MB untuk ${jenis.label}.`);
  }

  const id = `${crypto.randomBytes(12).toString('hex')}.${jenis.ext}`;
  fs.writeFileSync(path.join(MEDIA_DIR, id), buffer);
  db.prepare(`
    INSERT INTO media (id, original_name, mime, size, uploaded_by) VALUES (?, ?, ?, ?, ?)
  `).run(id, String(originalName).slice(0, 200), mime, buffer.length, userId);
  return { id, size: buffer.length, mime };
}

/** Alamat publik berkas, dipakai WhatsApp untuk mengunduhnya saat mengirim. */
function alamatPublik(id, req = null) {
  const dasar = config.PUBLIC_URL
    || (req ? `${req.protocol}://${req.get('host')}` : 'http://localhost:3000');
  return `${dasar}/media/${id}`;
}

function hapusBerkas(id) {
  try { fs.unlinkSync(path.join(MEDIA_DIR, id)); } catch { /* mungkin sudah hilang */ }
  db.prepare('DELETE FROM media WHERE id = ?').run(id);
}

module.exports = { MEDIA_DIR, JENIS, jenisDari, simpanBerkas, alamatPublik, hapusBerkas };
