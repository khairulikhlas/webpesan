'use strict';

const express = require('express');
const { db, logActivity } = require('../db');
const { requireAuth } = require('../auth');
const settings = require('../settings');
const wa = require('../whatsapp');
const { buildComponents, renderPreview } = require('../template-engine');
const { resolveAudience, describeAudience } = require('../audience');
const { normalizePhone } = require('../phone');
const { toCsv } = require('../csv');
const queue = require('../queue');

const router = express.Router();
router.use(requireAuth);

function getTemplateOrThrow(name, language) {
  const row = db.prepare('SELECT * FROM templates WHERE name = ? AND language = ?').get(name, language);
  if (!row) {
    const err = new Error('Template tidak ditemukan. Tekan "Sinkronkan template" di menu Template.');
    err.status = 400;
    throw err;
  }
  let components = [];
  try { components = JSON.parse(row.components || '[]'); } catch { components = []; }
  return { row, components };
}

function campaignStats(campaignId) {
  const rows = db.prepare(`
    SELECT status, COUNT(*) AS n FROM outbound_messages WHERE campaign_id = ? GROUP BY status
  `).all(campaignId);
  const stats = { pending: 0, sent: 0, delivered: 0, read: 0, failed: 0, canceled: 0, total: 0 };
  for (const row of rows) {
    stats[row.status] = row.n;
    stats.total += row.n;
  }
  // "terkirim" mencakup pesan yang sudah lanjut ke delivered/read
  stats.terkirim = stats.sent + stats.delivered + stats.read;
  return stats;
}

router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT c.*, u.name AS creator_name
    FROM campaigns c LEFT JOIN users u ON u.id = c.created_by
    ORDER BY c.id DESC LIMIT 200
  `).all();
  res.json({ campaigns: rows.map((c) => ({ ...c, stats: campaignStats(c.id) })) });
});

router.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare(`
    SELECT c.*, u.name AS creator_name FROM campaigns c
    LEFT JOIN users u ON u.id = c.created_by WHERE c.id = ?
  `).get(id);
  if (!row) return res.status(404).json({ error: 'Kampanye tidak ditemukan.' });
  res.json({ campaign: { ...row, stats: campaignStats(id) } });
});

router.get('/:id/messages', (req, res) => {
  const id = Number(req.params.id);
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 50));
  const where = ['m.campaign_id = ?'];
  const params = [id];
  if (req.query.status) { where.push('m.status = ?'); params.push(String(req.query.status)); }

  const whereSql = 'WHERE ' + where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) AS n FROM outbound_messages m ${whereSql}`).get(...params).n;
  const rows = db.prepare(`
    SELECT m.*, c.name AS contact_name FROM outbound_messages m
    LEFT JOIN contacts c ON c.id = m.contact_id
    ${whereSql} ORDER BY m.id ASC LIMIT ? OFFSET ?
  `).all(...params, limit, (page - 1) * limit);

  res.json({ messages: rows, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) });
});

router.get('/:id/export', (req, res) => {
  const id = Number(req.params.id);
  const rows = db.prepare(`
    SELECT m.phone, c.name AS nama, m.status, m.sent_at, m.delivered_at, m.read_at,
           m.error_code, m.error_detail, m.body_preview
    FROM outbound_messages m LEFT JOIN contacts c ON c.id = m.contact_id
    WHERE m.campaign_id = ? ORDER BY m.id ASC
  `).all(id);
  const csv = toCsv(rows, ['phone', 'nama', 'status', 'sent_at', 'delivered_at', 'read_at', 'error_code', 'error_detail', 'body_preview']);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="laporan-kampanye-${id}.csv"`);
  res.send('﻿' + csv);
});

/** Hitung penerima + tampilkan contoh hasil akhir pesan sebelum benar-benar dikirim. */
router.post('/preview', (req, res) => {
  try {
    const { templateName, language, mapping = {}, audience = {} } = req.body || {};
    const { row, components } = getTemplateOrThrow(templateName, language);
    const contacts = resolveAudience(audience);

    const samples = contacts.slice(0, 3).map((contact) => ({
      phone: contact.phone,
      name: contact.name,
      preview: renderPreview(components, mapping, contact),
      missing: buildComponents(components, mapping, contact).missing,
    }));

    // Cek variabel yang kosong di seluruh penerima (maksimal 500 baris pertama, biar cepat).
    const missingCounter = new Map();
    for (const contact of contacts.slice(0, 500)) {
      for (const label of buildComponents(components, mapping, contact).missing) {
        missingCounter.set(label, (missingCounter.get(label) || 0) + 1);
      }
    }

    res.json({
      ok: true,
      templateStatus: row.status,
      recipients: contacts.length,
      audienceLabel: describeAudience(audience),
      samples,
      warnings: [...missingCounter.entries()].map(([label, count]) => ({ label, count })),
      dailyLimit: Number(settings.get('daily_limit') || 0),
      sentLast24h: queue.sentLast24h(),
    });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

/** Kirim satu pesan uji coba ke nomor sendiri sebelum broadcast massal. */
router.post('/test-send', async (req, res) => {
  try {
    const { templateName, language, mapping = {}, phone } = req.body || {};
    const to = normalizePhone(phone, settings.get('default_country_code'));
    if (!to) return res.status(400).json({ error: 'Nomor tujuan uji coba tidak valid.' });

    const { row, components } = getTemplateOrThrow(templateName, language);
    if (String(row.status).toUpperCase() !== 'APPROVED') {
      return res.status(400).json({ error: `Template berstatus ${row.status}. Hanya template APPROVED yang bisa dikirim.` });
    }

    const contact = db.prepare('SELECT * FROM contacts WHERE phone = ?').get(to)
      || { name: 'Uji Coba', phone: to, email: '', tags: '', attributes: '{}' };
    const built = buildComponents(components, mapping, contact);
    const result = await wa.sendTemplate({ to, templateName, language, components: built.components });

    const preview = renderPreview(components, mapping, contact);
    db.prepare(`
      INSERT INTO outbound_messages (campaign_id, contact_id, phone, kind, body_preview, payload, status, wamid, attempts, sent_at)
      VALUES (NULL, ?, ?, 'template', ?, ?, 'sent', ?, 1, datetime('now'))
    `).run(contact.id || null, to, String(preview.body || '').slice(0, 500),
      JSON.stringify({ templateName, language, components: built.components }), result.wamid);

    logActivity(req.user.id, 'campaign.test_send', `${to} (${templateName})`);
    res.json({ ok: true, wamid: result.wamid, missing: built.missing });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.detail || err.message, code: err.code || '' });
  }
});

/** Buat kampanye baru dan siapkan antrean pesannya. */
router.post('/', (req, res) => {
  try {
    const {
      name, templateName, language, mapping = {}, audience = {},
      rate_per_minute, scheduled_at, start = true,
    } = req.body || {};

    if (!String(name || '').trim()) return res.status(400).json({ error: 'Nama kampanye belum diisi.' });
    const { row, components } = getTemplateOrThrow(templateName, language);
    if (String(row.status).toUpperCase() !== 'APPROVED') {
      return res.status(400).json({ error: `Template "${templateName}" berstatus ${row.status}. Hanya template APPROVED yang bisa dikirim.` });
    }

    const contacts = resolveAudience(audience);
    if (contacts.length === 0) return res.status(400).json({ error: 'Tidak ada penerima yang cocok dengan pilihan kamu.' });

    const rate = Math.min(6000, Math.max(1, Number(rate_per_minute) || Number(settings.get('rate_per_minute')) || 60));
    let status = 'draft';
    if (scheduled_at) status = 'scheduled';
    else if (start) status = 'running';

    const result = db.transaction(() => {
      const info = db.prepare(`
        INSERT INTO campaigns (name, template_name, template_language, mapping, audience, status, rate_per_minute, scheduled_at, total, created_by, started_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        String(name).trim(), templateName, language,
        JSON.stringify(mapping), JSON.stringify(audience),
        status, rate, scheduled_at || null, contacts.length, req.user.id,
        status === 'running' ? new Date().toISOString().replace('T', ' ').slice(0, 19) : null,
      );
      const campaignId = Number(info.lastInsertRowid);

      const insert = db.prepare(`
        INSERT INTO outbound_messages (campaign_id, contact_id, phone, kind, body_preview, payload, status)
        VALUES (?, ?, ?, 'template', ?, ?, 'pending')
      `);
      for (const contact of contacts) {
        const built = buildComponents(components, mapping, contact);
        const preview = renderPreview(components, mapping, contact);
        insert.run(
          campaignId, contact.id, contact.phone,
          String(preview.body || '').slice(0, 500),
          JSON.stringify({ templateName, language, components: built.components }),
        );
      }
      return campaignId;
    })();

    logActivity(req.user.id, 'campaign.created', `#${result} "${name}" -> ${contacts.length} penerima (${status})`);
    res.json({ ok: true, id: result, status, recipients: contacts.length });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

function setStatus(id, status, extra = {}) {
  const sets = ['status = ?'];
  const params = [status];
  if (extra.started_at) { sets.push("started_at = COALESCE(started_at, datetime('now'))"); }
  if (extra.finished_at) { sets.push("finished_at = datetime('now')"); }
  if (extra.clearError) { sets.push("last_error = ''"); }
  if (extra.scheduled_at !== undefined) { sets.push('scheduled_at = ?'); params.push(extra.scheduled_at); }
  db.prepare(`UPDATE campaigns SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
}

router.post('/:id/:action', (req, res) => {
  const id = Number(req.params.id);
  const action = req.params.action;
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id);
  if (!campaign) return res.status(404).json({ error: 'Kampanye tidak ditemukan.' });

  if (action === 'start' || action === 'resume') {
    if (['done', 'canceled'].includes(campaign.status)) {
      return res.status(400).json({ error: 'Kampanye ini sudah selesai atau dibatalkan.' });
    }
    setStatus(id, 'running', { started_at: true, clearError: true, scheduled_at: null });
  } else if (action === 'pause') {
    setStatus(id, 'paused');
  } else if (action === 'cancel') {
    db.transaction(() => {
      db.prepare(`UPDATE outbound_messages SET status = 'canceled', updated_at = datetime('now') WHERE campaign_id = ? AND status = 'pending'`).run(id);
      setStatus(id, 'canceled', { finished_at: true });
    })();
  } else if (action === 'retry-failed') {
    const info = db.prepare(`
      UPDATE outbound_messages
      SET status = 'pending', attempts = 0, next_attempt_at = NULL, error_code = NULL,
          error_title = NULL, error_detail = NULL, failed_at = NULL, updated_at = datetime('now')
      WHERE campaign_id = ? AND status = 'failed'
    `).run(id);
    setStatus(id, 'running', { started_at: true, clearError: true });
    logActivity(req.user.id, 'campaign.retry', `#${id}: ${info.changes} pesan diulang`);
    return res.json({ ok: true, retried: info.changes });
  } else if (action === 'delete') {
    db.prepare('DELETE FROM campaigns WHERE id = ?').run(id);
    logActivity(req.user.id, 'campaign.deleted', `#${id} ${campaign.name}`);
    return res.json({ ok: true });
  } else {
    return res.status(400).json({ error: 'Aksi tidak dikenal.' });
  }

  logActivity(req.user.id, `campaign.${action}`, `#${id} ${campaign.name}`);
  res.json({ ok: true, status: db.prepare('SELECT status FROM campaigns WHERE id = ?').get(id).status });
});

module.exports = router;
