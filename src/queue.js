'use strict';

/**
 * Mesin antrean pengiriman broadcast.
 *
 * Cara kerja:
 *  - Berjalan otomatis setiap 1 detik selama aplikasi hidup.
 *  - Mengambil kampanye berstatus "running" (atau "scheduled" yang waktunya tiba).
 *  - Mengirim pesan sesuai kecepatan yang dipilih (pesan per menit) supaya
 *    tidak melebihi batas WhatsApp dan tidak merusak kualitas nomor.
 *  - Gagal sementara (rate limit / gangguan jaringan) dicoba ulang otomatis
 *    sampai 5 kali dengan jeda bertambah.
 *  - Gagal fatal (token salah/kadaluarsa) menghentikan kampanye agar tidak
 *    membakar kuota.
 */

const { db, logActivity } = require('./db');
const settings = require('./settings');
const wa = require('./whatsapp');

const TICK_MS = 1000;
const MAX_ATTEMPTS = 5;
const MAX_PER_TICK = 20;

const credits = new Map();   // campaignId -> sisa jatah kirim (pecahan)
let timer = null;
let running = false;

function nowIso() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function sentLast24h() {
  const row = db.prepare(`
    SELECT COUNT(*) AS n FROM outbound_messages
    WHERE sent_at IS NOT NULL AND sent_at >= datetime('now', '-1 day')
  `).get();
  return row ? row.n : 0;
}

function activateScheduled() {
  db.prepare(`
    UPDATE campaigns SET status = 'running', started_at = COALESCE(started_at, datetime('now'))
    WHERE status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= datetime('now')
  `).run();
}

function finishEmptyCampaigns() {
  const rows = db.prepare(`
    SELECT c.id FROM campaigns c
    WHERE c.status = 'running'
      AND NOT EXISTS (
        SELECT 1 FROM outbound_messages m
        WHERE m.campaign_id = c.id AND m.status = 'pending'
      )
  `).all();
  for (const row of rows) {
    db.prepare(`UPDATE campaigns SET status = 'done', finished_at = datetime('now') WHERE id = ?`).run(row.id);
    credits.delete(row.id);
    logActivity(null, 'campaign.done', `Kampanye #${row.id} selesai`);
  }
}

function pauseCampaign(campaignId, reason) {
  db.prepare(`UPDATE campaigns SET status = 'paused', last_error = ? WHERE id = ?`).run(String(reason).slice(0, 500), campaignId);
  credits.delete(campaignId);
  logActivity(null, 'campaign.paused', `Kampanye #${campaignId} dijeda: ${reason}`);
}

function markSent(messageId, wamid) {
  db.prepare(`
    UPDATE outbound_messages
    SET status = 'sent', wamid = ?, sent_at = datetime('now'), updated_at = datetime('now'),
        error_code = NULL, error_title = NULL, error_detail = NULL, next_attempt_at = NULL
    WHERE id = ?
  `).run(wamid, messageId);
}

function markFailed(messageId, err) {
  db.prepare(`
    UPDATE outbound_messages
    SET status = 'failed', failed_at = datetime('now'), updated_at = datetime('now'),
        error_code = ?, error_title = ?, error_detail = ?
    WHERE id = ?
  `).run(String(err.code || ''), String(err.title || '').slice(0, 200), String(err.detail || err.message || '').slice(0, 800), messageId);
}

function scheduleRetry(messageId, attempts, err) {
  const delaySeconds = Math.min(300, 10 * 2 ** Math.max(0, attempts - 1)); // 10s, 20s, 40s, 80s, 160s
  db.prepare(`
    UPDATE outbound_messages
    SET attempts = ?, next_attempt_at = datetime('now', ?), updated_at = datetime('now'),
        error_code = ?, error_title = ?, error_detail = ?
    WHERE id = ?
  `).run(attempts, `+${delaySeconds} seconds`, String(err.code || ''), String(err.title || '').slice(0, 200), String(err.detail || err.message || '').slice(0, 800), messageId);
}

async function sendOne(message) {
  const payload = JSON.parse(message.payload || '{}');
  const attempts = (message.attempts || 0) + 1;

  try {
    let result;
    if (message.kind === 'text') {
      result = await wa.sendText({ to: message.phone, body: payload.body || '' });
    } else {
      result = await wa.sendTemplate({
        to: message.phone,
        templateName: payload.templateName,
        language: payload.language,
        components: payload.components || [],
      });
    }
    db.prepare('UPDATE outbound_messages SET attempts = ? WHERE id = ?').run(attempts, message.id);
    markSent(message.id, result.wamid);
    return { ok: true };
  } catch (err) {
    if (err.fatal) {
      db.prepare('UPDATE outbound_messages SET attempts = ? WHERE id = ?').run(attempts, message.id);
      markFailed(message.id, err);
      return { ok: false, fatal: true, error: err };
    }
    if (err.retryable && attempts < MAX_ATTEMPTS) {
      scheduleRetry(message.id, attempts, err);
      return { ok: false, retry: true, error: err };
    }
    db.prepare('UPDATE outbound_messages SET attempts = ? WHERE id = ?').run(attempts, message.id);
    markFailed(message.id, err);
    return { ok: false, error: err };
  }
}

async function tick() {
  if (running) return;
  running = true;
  try {
    activateScheduled();

    const campaigns = db.prepare(`
      SELECT id, name, rate_per_minute FROM campaigns WHERE status = 'running' ORDER BY id ASC
    `).all();

    if (campaigns.length === 0) {
      credits.clear();
      return;
    }

    const dailyLimit = Number(settings.get('daily_limit') || 0);
    let remainingToday = dailyLimit > 0 ? dailyLimit - sentLast24h() : Infinity;
    if (remainingToday <= 0) {
      for (const c of campaigns) pauseCampaign(c.id, `Batas harian ${dailyLimit} pesan/24 jam tercapai. Kampanye dijeda otomatis.`);
      return;
    }

    for (const campaign of campaigns) {
      const rate = Math.max(1, Number(campaign.rate_per_minute) || 60);
      const perTick = rate / (60000 / TICK_MS);
      const available = (credits.get(campaign.id) || 0) + perTick;
      let quota = Math.floor(available);
      credits.set(campaign.id, available - quota);
      if (quota <= 0) continue;

      quota = Math.min(quota, MAX_PER_TICK, remainingToday);
      if (quota <= 0) break;

      const batch = db.prepare(`
        SELECT * FROM outbound_messages
        WHERE campaign_id = ? AND status = 'pending'
          AND (next_attempt_at IS NULL OR next_attempt_at <= datetime('now'))
        ORDER BY id ASC LIMIT ?
      `).all(campaign.id, quota);

      if (batch.length === 0) continue;

      const results = await Promise.all(batch.map((m) => sendOne(m)));
      remainingToday -= results.filter((r) => r.ok).length;

      const fatal = results.find((r) => r && r.fatal);
      if (fatal) {
        pauseCampaign(campaign.id, `${fatal.error.detail || fatal.error.message} (kode ${fatal.error.code || '-'})`);
      }
      if (remainingToday <= 0) break;
    }

    finishEmptyCampaigns();
  } catch (err) {
    console.error('[queue] kesalahan tak terduga:', err);
  } finally {
    running = false;
  }
}

function start() {
  if (timer) return;
  timer = setInterval(() => { tick().catch((e) => console.error('[queue]', e)); }, TICK_MS);
  if (timer.unref) timer.unref();
  console.log('[queue] mesin pengiriman aktif (cek setiap 1 detik)');
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, tick, sentLast24h };
