'use strict';

const express = require('express');
const { db, logActivity } = require('../db');
const { requireAuth } = require('../auth');
const wa = require('../whatsapp');
const { analyzeTemplate } = require('../template-engine');

const router = express.Router();
router.use(requireAuth);

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

module.exports = router;
