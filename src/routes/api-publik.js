'use strict';

/**
 * API untuk sistem lain milik lembaga.
 *
 * Dibuat supaya web pencatatan donatur bisa mengirimkan datanya ke sini
 * secara otomatis, sehingga tim tidak perlu memasukkan data dua kali.
 * Endpoint ini tidak memakai login, melainkan kunci API yang dikirim pada
 * header X-API-Key dan bisa dibuat di halaman Pengaturan.
 */

const crypto = require('crypto');
const express = require('express');
const { db, logActivity } = require('../db');
const settings = require('../settings');
const { normalizePhone } = require('../phone');

const router = express.Router();

function bandingkanAman(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  if (x.length !== y.length || x.length === 0) return false;
  return crypto.timingSafeEqual(x, y);
}

router.use((req, res, next) => {
  const kunci = settings.get('api_key');
  if (!kunci) {
    return res.status(503).json({
      error: 'API belum diaktifkan. Buat kunci API lebih dulu di halaman Pengaturan.',
    });
  }
  const dikirim = req.get('X-API-Key') || String(req.query.api_key || '');
  if (!bandingkanAman(dikirim, kunci)) {
    return res.status(401).json({ error: 'Kunci API tidak sah.' });
  }
  next();
});

router.get('/ping', (req, res) => {
  res.json({ ok: true, aplikasi: settings.get('app_name'), waktu: new Date().toISOString() });
});

function bersihkanLabel(input) {
  if (!input) return [];
  const daftar = Array.isArray(input) ? input : String(input).split(',');
  return [...new Set(daftar.map((t) => String(t).trim().toLowerCase()).filter(Boolean))];
}

/**
 * Menyimpan satu kontak. Kalau nomornya sudah ada, datanya digabung:
 * nama dan email hanya ditimpa bila dikirim, label ditambahkan tanpa
 * menghapus label lama, dan keterangan tambahan digabung.
 */
function simpanKontak(data, kodeNegara) {
  const phone = normalizePhone(data.phone ?? data.nomor, kodeNegara);
  if (!phone) return { ok: false, phone: String(data.phone ?? data.nomor ?? ''), alasan: 'Nomor tidak valid' };

  const nama = String(data.name ?? data.nama ?? '').trim();
  const email = String(data.email ?? '').trim();
  const label = bersihkanLabel(data.tags ?? data.label);
  const tambahan = (data.attributes && typeof data.attributes === 'object') ? data.attributes : {};

  const lama = db.prepare('SELECT * FROM contacts WHERE phone = ?').get(phone);

  if (lama) {
    let atributGabungan = {};
    try { atributGabungan = JSON.parse(lama.attributes || '{}'); } catch { atributGabungan = {}; }
    Object.assign(atributGabungan, tambahan);

    const labelGabungan = [...new Set([
      ...String(lama.tags || '').split(',').map((t) => t.trim()).filter(Boolean),
      ...label,
    ])].join(',');

    db.prepare(`
      UPDATE contacts SET name = ?, email = ?, tags = ?, attributes = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(nama || lama.name, email || lama.email, labelGabungan, JSON.stringify(atributGabungan), lama.id);

    // Status opt-in hanya diubah bila memang dikirim, supaya sistem lain
    // tidak tanpa sengaja menghidupkan kembali kontak yang minta berhenti.
    if (data.opt_in !== undefined) {
      const nilai = data.opt_in ? 1 : 0;
      db.prepare(`
        UPDATE contacts
        SET opt_in = ?,
            opt_in_at = CASE WHEN ? = 1 THEN COALESCE(opt_in_at, datetime('now')) ELSE opt_in_at END,
            opt_out_at = CASE WHEN ? = 0 THEN datetime('now') ELSE NULL END
        WHERE id = ?
      `).run(nilai, nilai, nilai, lama.id);
    }
    return { ok: true, phone, tindakan: 'diperbarui', id: lama.id };
  }

  const optIn = data.opt_in === undefined ? 1 : (data.opt_in ? 1 : 0);
  const info = db.prepare(`
    INSERT INTO contacts (phone, name, email, tags, attributes, opt_in, opt_in_source, opt_in_at)
    VALUES (?, ?, ?, ?, ?, ?, 'api', CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END)
  `).run(phone, nama, email, label.join(','), JSON.stringify(tambahan), optIn, optIn);
  return { ok: true, phone, tindakan: 'dibuat', id: Number(info.lastInsertRowid) };
}

router.post('/kontak', (req, res) => {
  const kodeNegara = settings.get('default_country_code');
  const hasil = simpanKontak(req.body || {}, kodeNegara);
  if (!hasil.ok) return res.status(400).json({ error: hasil.alasan, phone: hasil.phone });
  logActivity(null, 'api.kontak', `${hasil.phone} ${hasil.tindakan}`);
  res.json({ ok: true, ...hasil });
});

router.post('/kontak/batch', (req, res) => {
  const daftar = Array.isArray(req.body?.kontak) ? req.body.kontak
    : (Array.isArray(req.body) ? req.body : null);
  if (!daftar) return res.status(400).json({ error: 'Kirim daftar kontak pada kolom "kontak" berupa array.' });
  if (daftar.length === 0) return res.status(400).json({ error: 'Daftar kontak kosong.' });
  if (daftar.length > 500) return res.status(400).json({ error: 'Maksimal 500 kontak sekali kirim.' });

  const kodeNegara = settings.get('default_country_code');
  const ringkasan = { dibuat: 0, diperbarui: 0, gagal: 0, rincian_gagal: [] };

  const tx = db.transaction(() => {
    for (const data of daftar) {
      const hasil = simpanKontak(data || {}, kodeNegara);
      if (!hasil.ok) {
        ringkasan.gagal += 1;
        if (ringkasan.rincian_gagal.length < 20) ringkasan.rincian_gagal.push({ phone: hasil.phone, alasan: hasil.alasan });
      } else if (hasil.tindakan === 'dibuat') ringkasan.dibuat += 1;
      else ringkasan.diperbarui += 1;
    }
  });
  tx();

  logActivity(null, 'api.kontak_batch', `baru ${ringkasan.dibuat}, diperbarui ${ringkasan.diperbarui}, gagal ${ringkasan.gagal}`);
  res.json({ ok: true, ...ringkasan });
});

router.get('/kontak/:phone', (req, res) => {
  const phone = normalizePhone(req.params.phone, settings.get('default_country_code'));
  if (!phone) return res.status(400).json({ error: 'Nomor tidak valid.' });
  const row = db.prepare('SELECT * FROM contacts WHERE phone = ?').get(phone);
  if (!row) return res.status(404).json({ error: 'Kontak tidak ditemukan.' });

  let atribut = {};
  try { atribut = JSON.parse(row.attributes || '{}'); } catch { atribut = {}; }
  res.json({
    ok: true,
    kontak: {
      phone: row.phone, name: row.name, email: row.email,
      tags: row.tags ? row.tags.split(',') : [],
      attributes: atribut,
      opt_in: Boolean(row.opt_in),
      last_inbound_at: row.last_inbound_at,
      created_at: row.created_at,
    },
  });
});

module.exports = router;
