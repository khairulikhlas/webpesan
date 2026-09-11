'use strict';

const express = require('express');
const { db } = require('../db');
const { requireAuth } = require('../auth');
const settings = require('../settings');
const queue = require('../queue');

const router = express.Router();
router.use(requireAuth);

router.get('/dashboard', (req, res) => {
  const one = (sql, ...params) => db.prepare(sql).get(...params);

  const contacts = one('SELECT COUNT(*) AS total, SUM(CASE WHEN opt_in = 1 THEN 1 ELSE 0 END) AS opt_in FROM contacts');
  const campaigns = one(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running,
           SUM(CASE WHEN status = 'scheduled' THEN 1 ELSE 0 END) AS scheduled
    FROM campaigns
  `);
  const messages7d = db.prepare(`
    SELECT date(COALESCE(sent_at, created_at)) AS tanggal,
           COUNT(*) AS total,
           SUM(CASE WHEN status IN ('sent','delivered','read') THEN 1 ELSE 0 END) AS terkirim,
           SUM(CASE WHEN status = 'delivered' OR status = 'read' THEN 1 ELSE 0 END) AS diterima,
           SUM(CASE WHEN status = 'read' THEN 1 ELSE 0 END) AS dibaca,
           SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS gagal
    FROM outbound_messages
    WHERE COALESCE(sent_at, created_at) >= datetime('now', '-7 days')
    GROUP BY tanggal ORDER BY tanggal ASC
  `).all();
  const totals = one(`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN status IN ('sent','delivered','read') THEN 1 ELSE 0 END) AS terkirim,
           SUM(CASE WHEN status IN ('delivered','read') THEN 1 ELSE 0 END) AS diterima,
           SUM(CASE WHEN status = 'read' THEN 1 ELSE 0 END) AS dibaca,
           SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS gagal,
           SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS menunggu
    FROM outbound_messages
  `);
  const unread = one('SELECT COUNT(*) AS n FROM inbound_messages WHERE is_read = 0').n;
  const topErrors = db.prepare(`
    SELECT COALESCE(error_code, '-') AS kode, COALESCE(error_detail, '') AS pesan, COUNT(*) AS jumlah
    FROM outbound_messages WHERE status = 'failed'
    GROUP BY kode, pesan ORDER BY jumlah DESC LIMIT 5
  `).all();
  const lastWebhook = one('SELECT received_at, ok, note FROM webhook_logs ORDER BY id DESC LIMIT 1');

  res.json({
    contacts: { total: contacts.total || 0, opt_in: contacts.opt_in || 0 },
    campaigns: { total: campaigns.total || 0, running: campaigns.running || 0, scheduled: campaigns.scheduled || 0 },
    messages: {
      total: totals.total || 0,
      terkirim: totals.terkirim || 0,
      diterima: totals.diterima || 0,
      dibaca: totals.dibaca || 0,
      gagal: totals.gagal || 0,
      menunggu: totals.menunggu || 0,
    },
    unread,
    daily: {
      limit: Number(settings.get('daily_limit') || 0),
      used: queue.sentLast24h(),
      rincian: queue.pemakaian24Jam(),
    },
    chart: messages7d,
    topErrors,
    readiness: settings.readiness(),
    lastWebhook: lastWebhook || null,
  });
});

module.exports = router;
