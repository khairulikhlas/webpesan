'use strict';

const express = require('express');
const { db, logActivity } = require('../db');
const { requireAuth } = require('../auth');
const wa = require('../whatsapp');
const { analyzeTemplate } = require('../template-engine');

const router = express.Router();
router.use(requireAuth);

function isianTersimpan(name, language) {
  const row = db.prepare('SELECT mapping FROM template_defaults WHERE name = ? AND language = ?').get(name, language);
  if (!row) return {};
  try { return JSON.parse(row.mapping || '{}'); } catch { return {}; }
}

function rowToTemplate(row) {
  let components = [];
  try { components = JSON.parse(row.components || '[]'); } catch { components = []; }
  const analysis = analyzeTemplate(components);
  return {
    name: row.name,
    language: row.language,
    status: row.status,
    category: row.category,
    template_id: row.template_id,
    synced_at: row.synced_at,
    defaults: isianTersimpan(row.name, row.language),
    components,
    slots: analysis.slots,
    preview: {
      header: analysis.headerText,
      body: analysis.bodyText,
      footer: analysis.footerText,
      buttons: analysis.buttons,
    },
  };
}

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM templates ORDER BY name ASC, language ASC').all();
  res.json({ templates: rows.map(rowToTemplate) });
});

router.get('/:name/:language', (req, res) => {
  const row = db.prepare('SELECT * FROM templates WHERE name = ? AND language = ?')
    .get(req.params.name, req.params.language);
  if (!row) return res.status(404).json({ error: 'Template tidak ditemukan. Coba tekan "Sinkronkan template".' });
  res.json({ template: rowToTemplate(row) });
});

router.post('/sync', async (req, res) => {
  try {
    const list = await wa.listTemplates({ limit: 100 });
    const stmt = db.prepare(`
      INSERT INTO templates (name, language, template_id, status, category, components, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(name, language) DO UPDATE SET
        template_id = excluded.template_id,
        status      = excluded.status,
        category    = excluded.category,
        components  = excluded.components,
        synced_at   = datetime('now')
    `);
    const keep = new Set();
    const tx = db.transaction(() => {
      for (const t of list) {
        if (!t.name || !t.language) continue;
        keep.add(`${t.name}::${t.language}`);
        stmt.run(t.name, t.language, String(t.id || ''), String(t.status || ''), String(t.category || ''), JSON.stringify(t.components || []));
      }
      // Hapus template lokal yang sudah tidak ada lagi di WhatsApp Manager.
      for (const row of db.prepare('SELECT name, language FROM templates').all()) {
        if (!keep.has(`${row.name}::${row.language}`)) {
          db.prepare('DELETE FROM templates WHERE name = ? AND language = ?').run(row.name, row.language);
        }
      }
    });
    tx();

    logActivity(req.user.id, 'template.sync', `${list.length} template disinkronkan`);
    const rows = db.prepare('SELECT * FROM templates ORDER BY name ASC, language ASC').all();
    res.json({ ok: true, count: list.length, templates: rows.map(rowToTemplate) });
  } catch (err) {
    res.status(400).json({
      error: err.detail || err.message,
      code: err.code || '',
      hint: err.code === '190'
        ? 'Access Token tidak valid atau sudah kadaluarsa. Buat System User Access Token permanen di Business Settings.'
        : 'Pastikan WhatsApp Business Account ID benar dan token punya izin whatsapp_business_management.',
    });
  }
});

/* =========================================================================
   Membuat template baru langsung dari web, lalu dikirim ke Meta untuk ditinjau
   ========================================================================= */

const fs = require('fs');
const path = require('path');
const config = require('../config');
const { findVars } = require('../template-engine');

const KATEGORI = ['MARKETING', 'UTILITY', 'AUTHENTICATION'];

/** Variabel harus berurutan {{1}}, {{2}}, ... tanpa lompat. */
function periksaUrutanVariabel(teks, label) {
  const daftar = findVars(teks);
  if (daftar.length === 0) return [];
  const angka = daftar.map(Number);
  if (angka.some((n) => !Number.isInteger(n) || n < 1)) {
    throw Object.assign(new Error(`${label}: variabel harus berupa angka seperti {{1}}, {{2}}.`), { status: 400 });
  }
  const urut = [...angka].sort((a, b) => a - b);
  for (let i = 0; i < urut.length; i += 1) {
    if (urut[i] !== i + 1) {
      throw Object.assign(
        new Error(`${label}: penomoran variabel harus berurutan mulai {{1}} tanpa lompat. Ditemukan {{${urut[i]}}}.`),
        { status: 400 },
      );
    }
  }
  return urut;
}

router.post('/', async (req, res) => {
  try {
    const b = req.body || {};
    const name = String(b.name || '').trim().toLowerCase();
    const language = String(b.language || 'id').trim();
    const category = String(b.category || 'MARKETING').toUpperCase();

    if (!/^[a-z0-9_]{1,512}$/.test(name)) {
      return res.status(400).json({
        error: 'Nama template hanya boleh huruf kecil, angka, dan garis bawah. Contoh: info_kajian_pekanan',
      });
    }
    if (!KATEGORI.includes(category)) {
      return res.status(400).json({ error: `Kategori harus salah satu dari: ${KATEGORI.join(', ')}.` });
    }
    if (db.prepare('SELECT name FROM templates WHERE name = ? AND language = ?').get(name, language)) {
      return res.status(400).json({ error: `Template "${name}" dengan bahasa ${language} sudah ada.` });
    }

    const bodyText = String(b.bodyText || '').trim();
    if (!bodyText) return res.status(400).json({ error: 'Isi pesan belum diisi.' });
    if (bodyText.length > 1024) return res.status(400).json({ error: 'Isi pesan maksimal 1024 karakter.' });

    const components = [];

    // ---- Header ----
    const header = b.header || {};
    const jenisHeader = String(header.type || 'none').toLowerCase();

    if (jenisHeader === 'text') {
      const teks = String(header.text || '').trim();
      if (!teks) return res.status(400).json({ error: 'Judul header belum diisi.' });
      if (teks.length > 60) return res.status(400).json({ error: 'Judul header maksimal 60 karakter.' });
      const varHeader = periksaUrutanVariabel(teks, 'Header');
      if (varHeader.length > 1) return res.status(400).json({ error: 'Header hanya boleh memiliki satu variabel.' });
      const comp = { type: 'HEADER', format: 'TEXT', text: teks };
      if (varHeader.length === 1) {
        const contoh = String(header.example || '').trim();
        if (!contoh) return res.status(400).json({ error: 'Contoh isi variabel header wajib diisi agar Meta bisa meninjau.' });
        comp.example = { header_text: [contoh] };
      }
      components.push(comp);
    } else if (['image', 'video', 'document'].includes(jenisHeader)) {
      const mediaId = String(header.mediaId || '').trim();
      if (!mediaId) return res.status(400).json({ error: 'Pilih dulu berkas contoh untuk header dari galeri media.' });
      const berkas = db.prepare('SELECT * FROM media WHERE id = ?').get(mediaId);
      if (!berkas) return res.status(400).json({ error: 'Berkas contoh tidak ditemukan di galeri media.' });

      const jalur = path.join(config.DATA_DIR, 'media', berkas.id);
      if (!fs.existsSync(jalur)) return res.status(400).json({ error: 'Berkas contoh sudah tidak ada di server.' });

      const handle = await wa.unggahBerkasContoh({
        buffer: fs.readFileSync(jalur),
        mimeType: berkas.mime,
        fileName: berkas.original_name || berkas.id,
      });
      components.push({
        type: 'HEADER',
        format: jenisHeader.toUpperCase(),
        example: { header_handle: [handle] },
      });
    }

    // ---- Body ----
    const varBody = periksaUrutanVariabel(bodyText, 'Isi pesan');
    const compBody = { type: 'BODY', text: bodyText };
    if (varBody.length > 0) {
      const contoh = (b.bodyExamples || []).map((v) => String(v || '').trim());
      if (contoh.length !== varBody.length || contoh.some((v) => !v)) {
        return res.status(400).json({
          error: `Isi pesan punya ${varBody.length} variabel, jadi contoh isinya juga harus ${varBody.length} dan tidak boleh kosong.`,
        });
      }
      compBody.example = { body_text: [contoh] };
    }
    components.push(compBody);

    // ---- Footer ----
    const footer = String(b.footerText || '').trim();
    if (footer) {
      if (footer.length > 60) return res.status(400).json({ error: 'Teks footer maksimal 60 karakter.' });
      if (findVars(footer).length) return res.status(400).json({ error: 'Footer tidak boleh mengandung variabel.' });
      components.push({ type: 'FOOTER', text: footer });
    }

    // ---- Tombol ----
    const tombol = Array.isArray(b.buttons) ? b.buttons.filter((t) => String(t?.text || '').trim()) : [];
    if (tombol.length > 10) return res.status(400).json({ error: 'Jumlah tombol maksimal 10.' });
    if (tombol.length) {
      const daftar = [];
      for (const t of tombol) {
        const teks = String(t.text).trim();
        if (teks.length > 25) return res.status(400).json({ error: `Tulisan tombol "${teks}" melebihi 25 karakter.` });
        if (String(t.type).toUpperCase() === 'URL') {
          const url = String(t.url || '').trim();
          if (!/^https?:\/\//i.test(url)) {
            return res.status(400).json({ error: `Tombol "${teks}" perlu alamat yang diawali https://` });
          }
          daftar.push({ type: 'URL', text: teks, url });
        } else if (String(t.type).toUpperCase() === 'PHONE_NUMBER') {
          const nomor = String(t.phone || '').trim();
          if (!nomor) return res.status(400).json({ error: `Tombol "${teks}" perlu nomor telepon.` });
          daftar.push({ type: 'PHONE_NUMBER', text: teks, phone_number: nomor });
        } else {
          daftar.push({ type: 'QUICK_REPLY', text: teks });
        }
      }
      components.push({ type: 'BUTTONS', buttons: daftar });
    }

    // ---- Kirim ke Meta ----
    const hasil = await wa.buatTemplate({ name, language, category, components });

    db.prepare(`
      INSERT INTO templates (name, language, template_id, status, category, components, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(name, language) DO UPDATE SET
        template_id = excluded.template_id, status = excluded.status,
        category = excluded.category, components = excluded.components, synced_at = datetime('now')
    `).run(name, language, String(hasil?.id || ''), String(hasil?.status || 'PENDING'),
      String(hasil?.category || category), JSON.stringify(components));

    logActivity(req.user.id, 'template.created', `${name} (${language}) -> ${hasil?.status || 'PENDING'}`);
    res.json({
      ok: true,
      id: hasil?.id || '',
      status: hasil?.status || 'PENDING',
      pesan: 'Template terkirim ke Meta dan sedang ditinjau. Biasanya selesai dalam beberapa menit sampai 24 jam.',
    });
  } catch (err) {
    res.status(err.status || 400).json({
      error: err.detail || err.message,
      code: err.code || '',
      hint: err.code === '100'
        ? 'Periksa kembali penulisan isi template. Meta menolak nama yang sudah dipakai, variabel yang tidak berurutan, atau contoh isi yang kosong.'
        : '',
    });
  }
});

router.delete('/:name/:language', async (req, res) => {
  const { name, language } = req.params;
  try {
    await wa.hapusTemplate(name);
    db.prepare('DELETE FROM templates WHERE name = ?').run(name);
    db.prepare('DELETE FROM template_defaults WHERE name = ?').run(name);
    logActivity(req.user.id, 'template.deleted', `${name} (${language})`);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.detail || err.message, code: err.code || '' });
  }
});

module.exports = router;
