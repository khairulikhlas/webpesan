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

const express = require('express');
const { db, logActivity } = require('../db');
const { requireAuth } = require('../auth');
const store = require('../media-store');

const router = express.Router();
router.use(requireAuth);

const alamatPublik = (req, id) => store.alamatPublik(id, req);

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
  if (!data) return res.status(400).json({ error: 'Isi berkas kosong.' });

  let buffer;
  try {
    buffer = Buffer.from(String(data).replace(/^data:[^;]+;base64,/, ''), 'base64');
  } catch {
    return res.status(400).json({ error: 'Berkas gagal dibaca.' });
  }

  try {
    const hasil = store.simpanBerkas({
      buffer, mime: contentType, originalName: filename, userId: req.user.id,
    });
    logActivity(req.user.id, 'media.upload', `${filename} (${(hasil.size / 1024).toFixed(0)} KB)`);
    res.json({ ok: true, id: hasil.id, url: alamatPublik(req, hasil.id), size: hasil.size });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  const id = String(req.params.id);
  if (!/^[0-9a-f]{24}\.(jpg|png|webp|mp4|ogg|mp3|pdf)$/.test(id)) {
    return res.status(400).json({ error: 'Nama berkas tidak sah.' });
  }
  const row = db.prepare('SELECT * FROM media WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Berkas tidak ditemukan.' });

  store.hapusBerkas(id);
  logActivity(req.user.id, 'media.delete', row.original_name || id);
  res.json({ ok: true });
});

module.exports = router;
module.exports.MEDIA_DIR = store.MEDIA_DIR;
