'use strict';

const express = require('express');
const { db, logActivity } = require('../db');
const { requireAuth } = require('../auth');
const wa = require('../whatsapp');
const settings = require('../settings');
const store = require('../media-store');
const { normalizePhone } = require('../phone');

const router = express.Router();
router.use(requireAuth);

/** Daftar percakapan: satu baris per nomor, diurutkan dari yang terbaru. */
router.get('/threads', (req, res) => {
  const rows = db.prepare(`
    SELECT i.phone,
           MAX(i.received_at) AS last_received_at,
           SUM(CASE WHEN i.is_read = 0 THEN 1 ELSE 0 END) AS unread,
           COUNT(*) AS total,
           (SELECT body FROM inbound_messages x WHERE x.phone = i.phone ORDER BY x.id DESC LIMIT 1) AS last_body,
           (SELECT name FROM contacts c WHERE c.phone = i.phone) AS contact_name,
           (SELECT id FROM contacts c WHERE c.phone = i.phone) AS contact_id
    FROM inbound_messages i
    GROUP BY i.phone
    ORDER BY last_received_at DESC
    LIMIT 200
  `).all();

  const now = Date.now();
  res.json({
    threads: rows.map((r) => ({
      ...r,
      window_open: now - new Date(`${String(r.last_received_at).replace(' ', 'T')}Z`).getTime() < 24 * 60 * 60 * 1000,
    })),
  });
});

/** Riwayat satu percakapan: pesan masuk + pesan keluar digabung berurutan. */
router.get('/thread/:phone', (req, res) => {
  const phone = normalizePhone(req.params.phone, settings.get('default_country_code')) || req.params.phone;

  const inbound = db.prepare(`
    SELECT i.id, 'in' AS direction, i.body, i.type, i.received_at AS at, '' AS status,
           '' AS error_detail, i.media_id, m.mime AS media_mime
    FROM inbound_messages i LEFT JOIN media m ON m.id = i.media_id
    WHERE i.phone = ? ORDER BY i.id ASC LIMIT 300
  `).all(phone);

  const outbound = db.prepare(`
    SELECT o.id, 'out' AS direction, o.body_preview AS body, o.kind AS type,
           COALESCE(o.sent_at, o.created_at) AS at, o.status,
           COALESCE(o.error_detail, '') AS error_detail, o.media_id, m.mime AS media_mime
    FROM outbound_messages o LEFT JOIN media m ON m.id = o.media_id
    WHERE o.phone = ? ORDER BY o.id ASC LIMIT 300
  `).all(phone);

  const messages = [...inbound, ...outbound]
    .sort((a, b) => String(a.at).localeCompare(String(b.at)))
    .map((m) => ({ ...m, media_url: m.media_id ? store.alamatPublik(m.media_id, req) : null }));
  db.prepare('UPDATE inbound_messages SET is_read = 1 WHERE phone = ?').run(phone);

  const last = db.prepare('SELECT received_at FROM inbound_messages WHERE phone = ? ORDER BY id DESC LIMIT 1').get(phone);
  const windowOpen = last
    ? Date.now() - new Date(`${String(last.received_at).replace(' ', 'T')}Z`).getTime() < 24 * 60 * 60 * 1000
    : false;

  res.json({
    phone,
    contact: db.prepare('SELECT * FROM contacts WHERE phone = ?').get(phone) || null,
    messages,
    window_open: windowOpen,
  });
});

/**
 * Balas pesan pelanggan dengan teks bebas.
 * Aturan WhatsApp: hanya boleh dalam 24 jam sejak pesan terakhir dari pelanggan.
 */
router.post('/reply', async (req, res) => {
  const phone = normalizePhone(req.body?.phone, settings.get('default_country_code'));
  const body = String(req.body?.body || '').trim();
  const mediaId = String(req.body?.mediaId || '').trim();

  if (!phone) return res.status(400).json({ error: 'Nomor tujuan tidak valid.' });
  if (!body && !mediaId) return res.status(400).json({ error: 'Isi pesan masih kosong.' });
  if (body.length > 4096) return res.status(400).json({ error: 'Pesan terlalu panjang (maksimal 4096 karakter).' });

  let berkas = null;
  if (mediaId) {
    berkas = db.prepare('SELECT * FROM media WHERE id = ?').get(mediaId);
    if (!berkas) return res.status(400).json({ error: 'Berkas tidak ditemukan di galeri media.' });
    if (body.length > 1024) {
      return res.status(400).json({ error: 'Keterangan gambar maksimal 1024 karakter.' });
    }
  }

  const last = db.prepare('SELECT received_at FROM inbound_messages WHERE phone = ? ORDER BY id DESC LIMIT 1').get(phone);
  const windowOpen = last
    ? Date.now() - new Date(`${String(last.received_at).replace(' ', 'T')}Z`).getTime() < 24 * 60 * 60 * 1000
    : false;
  if (!windowOpen) {
    return res.status(400).json({
      error: 'Jendela 24 jam sudah tertutup. Pesan teks bebas hanya bisa dikirim dalam 24 jam setelah pelanggan mengirim pesan. Gunakan template untuk menghubungi kembali.',
    });
  }

  const contact = db.prepare('SELECT id FROM contacts WHERE phone = ?').get(phone);
  try {
    let result;
    let jenisPesan = 'text';
    let pratinjau = body;

    if (berkas) {
      const mime = String(berkas.mime || '');
      const jenis = mime.startsWith('image/') ? 'image'
        : mime.startsWith('video/') ? 'video'
          : mime.startsWith('audio/') ? 'audio' : 'document';
      result = await wa.sendMedia({
        to: phone,
        type: jenis,
        link: store.alamatPublik(berkas.id, req),
        caption: body,
        filename: berkas.original_name || berkas.id,
      });
      jenisPesan = jenis;
      pratinjau = body || `[${jenis === 'image' ? 'Gambar' : jenis === 'video' ? 'Video' : 'Berkas'}]`;
    } else {
      result = await wa.sendText({ to: phone, body });
    }

    db.prepare(`
      INSERT INTO outbound_messages (campaign_id, contact_id, phone, kind, body_preview, payload, status, wamid, attempts, sent_at, media_id)
      VALUES (NULL, ?, ?, ?, ?, ?, 'sent', ?, 1, datetime('now'), ?)
    `).run(contact?.id || null, phone, jenisPesan, pratinjau.slice(0, 500),
      JSON.stringify({ body, mediaId: berkas?.id || null }), result.wamid, berkas?.id || null);

    logActivity(req.user.id, 'inbox.reply', `${phone}${berkas ? ' (dengan berkas)' : ''}`);
    res.json({ ok: true, wamid: result.wamid });
  } catch (err) {
    res.status(400).json({ error: err.detail || err.message, code: err.code || '' });
  }
});

module.exports = router;
