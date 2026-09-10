'use strict';

const express = require('express');
const { db, logActivity } = require('../db');
const { requireAuth } = require('../auth');
const { normalizePhone } = require('../phone');
const { parseCsv, pick, toCsv } = require('../csv');
const settings = require('../settings');

const router = express.Router();
router.use(requireAuth);

const PHONE_HEADERS = ['phone', 'nomor', 'no hp', 'nohp', 'no_hp', 'nomor hp', 'nomor_hp', 'telepon', 'telp', 'whatsapp', 'wa', 'hp', 'msisdn', 'nomor whatsapp'];
const NAME_HEADERS = ['name', 'nama', 'nama lengkap', 'full name', 'fullname', 'nama pelanggan'];
const EMAIL_HEADERS = ['email', 'e-mail', 'surel'];
const TAG_HEADERS = ['tag', 'tags', 'label', 'grup', 'group', 'kategori'];

function cleanTags(input) {
  if (!input) return '';
  const list = Array.isArray(input) ? input : String(input).split(',');
  return [...new Set(list.map((t) => String(t).trim().toLowerCase()).filter(Boolean))].join(',');
}

router.get('/', (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 50));
  const offset = (page - 1) * limit;

  const where = [];
  const params = [];
  if (req.query.search) {
    where.push('(name LIKE ? OR phone LIKE ? OR email LIKE ? OR tags LIKE ?)');
    const like = `%${String(req.query.search).trim()}%`;
    params.push(like, like, like, like);
  }
  if (req.query.tag) {
    where.push(`(',' || lower(replace(tags,' ','')) || ',') LIKE ?`);
    params.push(`%,${String(req.query.tag).trim().toLowerCase().replace(/\s+/g, '')},%`);
  }
  if (req.query.opt_in === '1') where.push('opt_in = 1');
  if (req.query.opt_in === '0') where.push('opt_in = 0');

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) AS n FROM contacts ${whereSql}`).get(...params).n;
  const rows = db.prepare(`SELECT * FROM contacts ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);

  res.json({ contacts: rows, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) });
});

router.get('/tags', (req, res) => {
  const rows = db.prepare("SELECT tags FROM contacts WHERE tags <> ''").all();
  const counter = new Map();
  for (const row of rows) {
    for (const tag of String(row.tags).split(',')) {
      const t = tag.trim();
      if (!t) continue;
      counter.set(t, (counter.get(t) || 0) + 1);
    }
  }
  res.json({ tags: [...counter.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count) });
});

router.get('/export', (req, res) => {
  const rows = db.prepare('SELECT phone, name, email, tags, opt_in, opt_in_source, created_at FROM contacts ORDER BY id ASC').all();
  const csv = toCsv(rows.map((r) => ({ ...r, opt_in: r.opt_in ? 'ya' : 'tidak' })),
    ['phone', 'name', 'email', 'tags', 'opt_in', 'opt_in_source', 'created_at']);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="kontak-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send('﻿' + csv);
});

router.post('/', (req, res) => {
  const cc = settings.get('default_country_code');
  const phone = normalizePhone(req.body?.phone, cc);
  if (!phone) return res.status(400).json({ error: 'Nomor WhatsApp tidak valid.' });
  if (db.prepare('SELECT id FROM contacts WHERE phone = ?').get(phone)) {
    return res.status(400).json({ error: `Nomor ${phone} sudah ada di daftar kontak.` });
  }
  const optIn = req.body?.opt_in === false || req.body?.opt_in === 0 ? 0 : 1;
  const info = db.prepare(`
    INSERT INTO contacts (phone, name, email, tags, attributes, opt_in, opt_in_source, opt_in_at, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    phone,
    String(req.body?.name || '').trim(),
    String(req.body?.email || '').trim(),
    cleanTags(req.body?.tags),
    JSON.stringify(req.body?.attributes || {}),
    optIn,
    String(req.body?.opt_in_source || 'input_manual'),
    optIn ? new Date().toISOString().replace('T', ' ').slice(0, 19) : null,
    String(req.body?.notes || ''),
  );
  logActivity(req.user.id, 'contact.created', phone);
  res.json({ ok: true, contact: db.prepare('SELECT * FROM contacts WHERE id = ?').get(info.lastInsertRowid) });
});

router.patch('/:id', (req, res) => {
  const id = Number(req.params.id);
  const contact = db.prepare('SELECT * FROM contacts WHERE id = ?').get(id);
  if (!contact) return res.status(404).json({ error: 'Kontak tidak ditemukan.' });

  const b = req.body || {};
  if (b.phone !== undefined) {
    const phone = normalizePhone(b.phone, settings.get('default_country_code'));
    if (!phone) return res.status(400).json({ error: 'Nomor WhatsApp tidak valid.' });
    const dup = db.prepare('SELECT id FROM contacts WHERE phone = ? AND id <> ?').get(phone, id);
    if (dup) return res.status(400).json({ error: 'Nomor tersebut sudah dipakai kontak lain.' });
    db.prepare('UPDATE contacts SET phone = ? WHERE id = ?').run(phone, id);
  }
  if (b.name !== undefined) db.prepare('UPDATE contacts SET name = ? WHERE id = ?').run(String(b.name).trim(), id);
  if (b.email !== undefined) db.prepare('UPDATE contacts SET email = ? WHERE id = ?').run(String(b.email).trim(), id);
  if (b.tags !== undefined) db.prepare('UPDATE contacts SET tags = ? WHERE id = ?').run(cleanTags(b.tags), id);
  if (b.notes !== undefined) db.prepare('UPDATE contacts SET notes = ? WHERE id = ?').run(String(b.notes), id);
  if (b.attributes !== undefined) db.prepare('UPDATE contacts SET attributes = ? WHERE id = ?').run(JSON.stringify(b.attributes || {}), id);
  if (b.opt_in !== undefined) {
    const value = b.opt_in ? 1 : 0;
    db.prepare(`
      UPDATE contacts
      SET opt_in = ?,
          opt_in_at  = CASE WHEN ? = 1 THEN COALESCE(opt_in_at, datetime('now')) ELSE opt_in_at END,
          opt_out_at = CASE WHEN ? = 0 THEN datetime('now') ELSE NULL END
      WHERE id = ?
    `).run(value, value, value, id);
  }
  db.prepare(`UPDATE contacts SET updated_at = datetime('now') WHERE id = ?`).run(id);
  res.json({ ok: true, contact: db.prepare('SELECT * FROM contacts WHERE id = ?').get(id) });
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const contact = db.prepare('SELECT phone FROM contacts WHERE id = ?').get(id);
  if (!contact) return res.status(404).json({ error: 'Kontak tidak ditemukan.' });
  db.prepare('DELETE FROM contacts WHERE id = ?').run(id);
  logActivity(req.user.id, 'contact.deleted', contact.phone);
  res.json({ ok: true });
});

router.post('/bulk', (req, res) => {
  const ids = (req.body?.ids || []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const action = String(req.body?.action || '');
  if (ids.length === 0) return res.status(400).json({ error: 'Belum ada kontak yang dipilih.' });
  const marks = ids.map(() => '?').join(',');

  if (action === 'delete') {
    db.prepare(`DELETE FROM contacts WHERE id IN (${marks})`).run(...ids);
  } else if (action === 'opt_in') {
    db.prepare(`UPDATE contacts SET opt_in = 1, opt_in_at = COALESCE(opt_in_at, datetime('now')), opt_out_at = NULL WHERE id IN (${marks})`).run(...ids);
  } else if (action === 'opt_out') {
    db.prepare(`UPDATE contacts SET opt_in = 0, opt_out_at = datetime('now') WHERE id IN (${marks})`).run(...ids);
  } else if (action === 'add_tag' || action === 'remove_tag') {
    const tag = cleanTags(req.body?.tag);
    if (!tag) return res.status(400).json({ error: 'Nama label belum diisi.' });
    const rows = db.prepare(`SELECT id, tags FROM contacts WHERE id IN (${marks})`).all(...ids);
    const update = db.prepare(`UPDATE contacts SET tags = ?, updated_at = datetime('now') WHERE id = ?`);
    const tx = db.transaction(() => {
      for (const row of rows) {
        const current = new Set(String(row.tags).split(',').map((t) => t.trim()).filter(Boolean));
        for (const t of tag.split(',')) {
          if (action === 'add_tag') current.add(t); else current.delete(t);
        }
        update.run([...current].join(','), row.id);
      }
    });
    tx();
  } else {
    return res.status(400).json({ error: 'Aksi tidak dikenal.' });
  }
  logActivity(req.user.id, `contact.bulk_${action}`, `${ids.length} kontak`);
  res.json({ ok: true, affected: ids.length });
});

/**
 * Impor CSV. Klien mengirim isi file sebagai teks:
 *   { csv: "...", tags: "pelanggan", optIn: true, updateExisting: true }
 */
router.post('/import', (req, res) => {
  const text = String(req.body?.csv || '');
  if (!text.trim()) return res.status(400).json({ error: 'File CSV kosong.' });

  const { headers, records } = parseCsv(text);
  if (records.length === 0) return res.status(400).json({ error: 'Tidak ada baris data di file CSV.' });

  const cc = settings.get('default_country_code');
  const extraTags = cleanTags(req.body?.tags);
  const optIn = req.body?.optIn === false ? 0 : 1;
  const updateExisting = req.body?.updateExisting !== false;

  const summary = { total: records.length, created: 0, updated: 0, skipped: 0, invalid: [], duplicates: 0 };
  const seen = new Set();

  const insert = db.prepare(`
    INSERT INTO contacts (phone, name, email, tags, attributes, opt_in, opt_in_source, opt_in_at)
    VALUES (?, ?, ?, ?, ?, ?, 'impor_csv', CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END)
  `);
  const findByPhone = db.prepare('SELECT * FROM contacts WHERE phone = ?');
  const update = db.prepare(`
    UPDATE contacts SET name = ?, email = ?, tags = ?, attributes = ?, updated_at = datetime('now') WHERE id = ?
  `);

  const tx = db.transaction(() => {
    for (let i = 0; i < records.length; i += 1) {
      const record = records[i];
      const rawPhone = pick(record, PHONE_HEADERS);
      const phone = normalizePhone(rawPhone, cc);
      if (!phone) {
        summary.skipped += 1;
        if (summary.invalid.length < 20) summary.invalid.push({ baris: i + 2, nilai: rawPhone || '(kosong)' });
        continue;
      }
      if (seen.has(phone)) { summary.duplicates += 1; continue; }
      seen.add(phone);

      const name = pick(record, NAME_HEADERS);
      const email = pick(record, EMAIL_HEADERS);
      const rowTags = cleanTags([pick(record, TAG_HEADERS), extraTags].filter(Boolean).join(','));

      // Kolom lain disimpan sebagai atribut supaya bisa dipakai jadi variabel template.
      const used = new Set([...PHONE_HEADERS, ...NAME_HEADERS, ...EMAIL_HEADERS, ...TAG_HEADERS]);
      const attributes = {};
      for (const header of headers) {
        if (used.has(header.toLowerCase().trim())) continue;
        if (String(record[header] ?? '').trim() !== '') attributes[header.trim()] = String(record[header]).trim();
      }

      const existing = findByPhone.get(phone);
      if (existing) {
        if (!updateExisting) { summary.skipped += 1; continue; }
        let mergedAttrs = {};
        try { mergedAttrs = JSON.parse(existing.attributes || '{}'); } catch { mergedAttrs = {}; }
        Object.assign(mergedAttrs, attributes);
        const mergedTags = cleanTags([existing.tags, rowTags].filter(Boolean).join(','));
        update.run(name || existing.name, email || existing.email, mergedTags, JSON.stringify(mergedAttrs), existing.id);
        summary.updated += 1;
      } else {
        insert.run(phone, name, email, rowTags, JSON.stringify(attributes), optIn, optIn);
        summary.created += 1;
      }
    }
  });
  tx();

  logActivity(req.user.id, 'contact.import', `baru ${summary.created}, diperbarui ${summary.updated}, dilewati ${summary.skipped}`);
  res.json({ ok: true, summary, columns: headers });
});

/**
 * Membersihkan nomor yang terbukti tidak aktif berdasarkan hasil broadcast.
 *
 * Kode 131026 dari WhatsApp berarti pesan tidak bisa sampai: nomornya tidak
 * terdaftar di WhatsApp atau tidak dapat menerima pesan. Nomor seperti ini
 * hanya membuang kuota harian dan menurunkan kualitas nomor pengirim, jadi
 * sebaiknya dikeluarkan dari daftar penerima.
 *
 * Body:
 *   { campaignId: 12,            // kosongkan untuk memeriksa seluruh riwayat
 *     hanyaTidakTerdaftar: true, // false = semua yang gagal, apa pun sebabnya
 *     terapkan: false }          // false = hanya menghitung, belum mengubah apa pun
 */
router.post('/bersihkan-gagal', (req, res) => {
  const campaignId = Number(req.body?.campaignId) || 0;
  const hanyaTidakTerdaftar = req.body?.hanyaTidakTerdaftar !== false;
  const terapkan = req.body?.terapkan === true;

  const where = ["m.status = 'failed'", 'm.contact_id IS NOT NULL'];
  const params = [];
  if (campaignId > 0) { where.push('m.campaign_id = ?'); params.push(campaignId); }
  if (hanyaTidakTerdaftar) { where.push("m.error_code = '131026'"); }

  const rows = db.prepare(`
    SELECT DISTINCT c.id, c.phone, c.name, m.error_code, m.error_detail
    FROM outbound_messages m
    JOIN contacts c ON c.id = m.contact_id
    WHERE ${where.join(' AND ')}
      AND c.opt_in = 1
    ORDER BY c.id ASC
  `).all(...params);

  if (!terapkan) {
    return res.json({
      ok: true,
      jumlah: rows.length,
      contoh: rows.slice(0, 10).map((r) => ({ phone: r.phone, name: r.name, sebab: r.error_detail || r.error_code })),
    });
  }

  if (rows.length === 0) return res.json({ ok: true, jumlah: 0, diubah: 0 });

  const ids = rows.map((r) => r.id);
  const update = db.prepare(`
    UPDATE contacts
    SET opt_in = 0, opt_out_at = datetime('now'), updated_at = datetime('now'),
        tags = CASE
          WHEN (',' || lower(replace(tags, ' ', '')) || ',') LIKE '%,nomor-tidak-aktif,%' THEN tags
          WHEN tags = '' THEN 'nomor-tidak-aktif'
          ELSE tags || ',nomor-tidak-aktif'
        END,
        notes = CASE WHEN notes = '' THEN ? ELSE notes || ' | ' || ? END
    WHERE id = ?
  `);
  const catatan = `Ditandai tidak aktif otomatis pada ${new Date().toISOString().slice(0, 10)} karena pesan tidak sampai.`;
  const tx = db.transaction(() => { for (const id of ids) update.run(catatan, catatan, id); });
  tx();

  logActivity(req.user.id, 'contact.bersihkan_gagal',
    `${ids.length} nomor ditandai tidak aktif${campaignId ? ` dari kampanye #${campaignId}` : ''}`);
  res.json({ ok: true, jumlah: rows.length, diubah: ids.length });
});

module.exports = router;
