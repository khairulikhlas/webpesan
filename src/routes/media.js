'use strict';

/**
 * Galeri media.
 *
 * WhatsApp mengharuskan gambar/video/dokumen header template dikirim sebagai
 * alamat URL publik pada setiap pengiriman. Contoh gambar yang dipasang saat
 * membuat template di WhatsApp Manager hanya dipakai untuk proses peninjauan
 * Meta, dan tidak bisa dipakai ulang saat mengirim pesan.
 *
 * Karena itu berkas diunggah sekali ke server ini, lalu alamatnya bisa dipakai
 * berkali-kali untuk broadcast berikutnya.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { db, logActivity } = require('../db');
const { requireAuth } = require('../auth');
const config = require('../config');

const router = express.Router();
router.use(requireAuth);

const MEDIA_DIR = path.join(config.DATA_DIR, 'media');
fs.mkdirSync(MEDIA_DIR, { recursive: true });

// Jenis berkas yang diizinkan WhatsApp untuk header template.
const JENIS = {
  'image/jpeg': { ext: 'jpg', maks: 5 * 1024 * 1024, label: 'Gambar JPG' },
  'image/png': { ext: 'png', maks: 5 * 1024 * 1024, label: 'Gambar PNG' },
  'video/mp4': { ext: 'mp4', maks: 16 * 1024 * 1024, label: 'Video MP4' },
  'application/pdf': { ext: 'pdf', maks: 100 * 1024 * 1024, label: 'Dokumen PDF' },
};

function alamatPublik(req, id) {
  const dasar = config.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  return `${dasar}/media/${id}`;
}

router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT m.*, u.name AS pengunggah FROM media m
    LEFT JOIN users u ON u.id = m.uploaded_by
    ORDER BY m.created_at DESC LIMIT 200
  `).all();
  res.json({ media: rows.map((r) => ({ ...r, url: alamatPublik(req, r.id) })) });
});

/**
 * Unggah berkas. Klien mengirim isinya dalam bentuk base64 supaya tidak perlu
 * pustaka tambahan di sisi server:
 *   { filename: "promo.jpg", contentType: "image/jpeg", data: "<base64>" }
 */
router.post('/', (req, res) => {
  const { filename = '', contentType = '', data = '' } = req.body || {};
  const jenis = JENIS[String(contentType).toLowerCase()];
  if (!jenis) {
    return res.status(400).json({
      error: `Jenis berkas "${contentType || 'tidak dikenal'}" tidak didukung. Gunakan JPG, PNG, MP4, atau PDF.`,
    });
  }
  if (!data) return res.status(400).json({ error: 'Isi berkas kosong.' });

  let buffer;
  try {
    buffer = Buffer.from(String(data).replace(/^data:[^;]+;base64,/, ''), 'base64');
  } catch {
    return res.status(400).json({ error: 'Berkas gagal dibaca.' });
  }
  if (buffer.length === 0) return res.status(400).json({ error: 'Berkas kosong.' });
  if (buffer.length > jenis.maks) {
    return res.status(400).json({
      error: `Ukuran berkas ${(buffer.length / 1024 / 1024).toFixed(1)} MB melebihi batas ${jenis.maks / 1024 / 1024} MB untuk ${jenis.label}.`,
    });
  }

  const id = `${crypto.randomBytes(12).toString('hex')}.${jenis.ext}`;
  fs.writeFileSync(path.join(MEDIA_DIR, id), buffer);
  db.prepare(`
    INSERT INTO media (id, original_name, mime, size, uploaded_by) VALUES (?, ?, ?, ?, ?)
  `).run(id, String(filename).slice(0, 200), contentType, buffer.length, req.user.id);

  logActivity(req.user.id, 'media.upload', `${filename} (${(buffer.length / 1024).toFixed(0)} KB)`);
  res.json({ ok: true, id, url: alamatPublik(req, id), size: buffer.length });
});

router.delete('/:id', (req, res) => {
  const id = String(req.params.id);
  if (!/^[0-9a-f]{24}\.(jpg|png|mp4|pdf)$/.test(id)) {
    return res.status(400).json({ error: 'Nama berkas tidak sah.' });
  }
  const row = db.prepare('SELECT * FROM media WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Berkas tidak ditemukan.' });

  try { fs.unlinkSync(path.join(MEDIA_DIR, id)); } catch { /* berkas mungkin sudah hilang */ }
  db.prepare('DELETE FROM media WHERE id = ?').run(id);
  logActivity(req.user.id, 'media.delete', row.original_name || id);
  res.json({ ok: true });
});

module.exports = router;
module.exports.MEDIA_DIR = MEDIA_DIR;
