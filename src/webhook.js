'use strict';

/**
 * Penerima webhook dari Meta.
 *
 * Dua hal yang dikirim Meta ke endpoint ini:
 *  1. "statuses"  -> perubahan status pesan: sent / delivered / read / failed
 *  2. "messages"  -> pesan masuk dari pelanggan (balasan)
 *
 * Endpoint yang didaftarkan di Meta: {PUBLIC_URL}/webhook
 */

const crypto = require('crypto');
const { db, logActivity } = require('./db');
const wa = require('./whatsapp');
const store = require('./media-store');
const settings = require('./settings');
const { normalizePhone } = require('./phone');

// Kata kunci yang otomatis membuat kontak berhenti berlangganan.
const OPT_OUT_KEYWORDS = ['stop', 'berhenti', 'unsubscribe', 'keluar', 'batal langganan'];
const OPT_IN_KEYWORDS = ['mulai', 'start', 'daftar', 'langganan'];

function verifySignature(rawBody, signatureHeader, appSecret) {
  if (!appSecret) return { ok: true, note: 'App Secret belum diisi - verifikasi tanda tangan dilewati' };
  if (!signatureHeader) return { ok: false, note: 'Header X-Hub-Signature-256 tidak ada' };

  const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signatureHeader));
  if (a.length !== b.length) return { ok: false, note: 'Tanda tangan tidak cocok' };
  return crypto.timingSafeEqual(a, b)
    ? { ok: true, note: 'Tanda tangan valid' }
    : { ok: false, note: 'Tanda tangan tidak cocok' };
}

/** GET /webhook - dipakai Meta sekali saat kamu mendaftarkan URL webhook. */
function handleVerification(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const expected = settings.get('verify_token');

  if (mode === 'subscribe' && token && expected && token === expected) {
    db.prepare("INSERT INTO webhook_logs (kind, ok, note, raw) VALUES ('verify', 1, ?, '')")
      .run('Verifikasi webhook berhasil');
    res.status(200).type('text/plain').send(String(challenge ?? ''));
    return;
  }
  db.prepare("INSERT INTO webhook_logs (kind, ok, note, raw) VALUES ('verify', 0, ?, '')")
    .run(`Verifikasi gagal (token dikirim: ${token ? 'ada' : 'kosong'})`);
  res.status(403).type('text/plain').send('Verify token tidak cocok');
}

function findOrCreateContact(phone, profileName) {
  const existing = db.prepare('SELECT * FROM contacts WHERE phone = ?').get(phone);
  if (existing) return existing;
  const info = db.prepare(`
    INSERT INTO contacts (phone, name, opt_in, opt_in_source, opt_in_at)
    VALUES (?, ?, 1, 'balasan_whatsapp', datetime('now'))
  `).run(phone, profileName || '');
  return db.prepare('SELECT * FROM contacts WHERE id = ?').get(info.lastInsertRowid);
}

function extractBody(message) {
  const type = message.type || 'text';
  switch (type) {
    case 'text': return message.text?.body || '';
    case 'button': return message.button?.text || '';
    case 'interactive':
      return message.interactive?.button_reply?.title
        || message.interactive?.list_reply?.title
        || '';
    case 'image': return message.image?.caption || '[Gambar]';
    case 'video': return message.video?.caption || '[Video]';
    case 'document': return message.document?.caption || message.document?.filename || '[Dokumen]';
    case 'audio': case 'voice': return '[Pesan suara]';
    case 'sticker': return '[Stiker]';
    case 'location': return `[lokasi] ${message.location?.latitude}, ${message.location?.longitude}`;
    case 'contacts': return '[kartu kontak]';
    case 'reaction': return `[reaksi ${message.reaction?.emoji || ''}]`;
    default: return `[${type}]`;
  }
}

function applyStatus(status) {
  const wamid = status.id;
  if (!wamid) return;
  const state = String(status.status || '').toLowerCase();

  const row = db.prepare('SELECT id, status FROM outbound_messages WHERE wamid = ?').get(wamid);
  if (!row) return; // pesan dikirim dari perangkat lain / bukan dari aplikasi ini

  // Jangan menurunkan status (read tidak boleh kembali jadi delivered).
  const rank = { pending: 0, sent: 1, delivered: 2, read: 3 };
  if (state === 'failed') {
    const err = (status.errors && status.errors[0]) || {};
    db.prepare(`
      UPDATE outbound_messages
      SET status = 'failed', failed_at = datetime('now'), updated_at = datetime('now'),
          error_code = ?, error_title = ?, error_detail = ?
      WHERE id = ?
    `).run(String(err.code || ''), String(err.title || '').slice(0, 200),
      String(err.error_data?.details || err.message || '').slice(0, 800), row.id);
    return;
  }

  if (!['sent', 'delivered', 'read'].includes(state)) return;
  if ((rank[state] ?? 0) <= (rank[row.status] ?? 0)) return;

  const column = state === 'sent' ? 'sent_at' : state === 'delivered' ? 'delivered_at' : 'read_at';
  db.prepare(`
    UPDATE outbound_messages
    SET status = ?, ${column} = COALESCE(${column}, datetime('now')), updated_at = datetime('now')
    WHERE id = ?
  `).run(state, row.id);
}

const JENIS_BERMEDIA = ['image', 'video', 'document', 'audio', 'sticker', 'voice'];

/**
 * Mengunduh berkas yang dikirim pelanggan lalu menyimpannya di server sendiri,
 * supaya bisa ditampilkan di Kotak Masuk. Alamat berkas dari Meta hanya berlaku
 * sebentar, jadi harus disalin selagi masih berlaku.
 *
 * Dijalankan di latar belakang: webhook harus dijawab cepat, sedangkan
 * mengunduh berkas bisa memakan waktu.
 */
async function unduhBerkasPesan(idPesanMasuk, message) {
  const jenis = message.type;
  const mediaId = message?.[jenis]?.id;
  if (!mediaId) return;

  try {
    const { buffer, mime } = await wa.unduhMediaMasuk(mediaId);
    const namaAsli = message?.[jenis]?.filename || `${jenis}-dari-pelanggan`;
    const hasil = store.simpanBerkas({ buffer, mime, originalName: namaAsli, abaikanBatas: true });
    db.prepare('UPDATE inbound_messages SET media_id = ? WHERE id = ?').run(hasil.id, idPesanMasuk);
  } catch (err) {
    console.error(`[webhook] gagal mengunduh berkas ${jenis} dari pelanggan:`, err.message);
    db.prepare('INSERT INTO webhook_logs (kind, ok, note, raw) VALUES (?, ?, ?, ?)')
      .run('media', 0, `Gagal mengunduh berkas ${jenis}: ${err.message}`, String(mediaId));
  }
}

function applyInbound(message, profileByWaId) {
  const phone = normalizePhone(message.from, settings.get('default_country_code')) || String(message.from || '');
  if (!phone) return;

  const profileName = profileByWaId[message.from] || '';
  const contact = findOrCreateContact(phone, profileName);
  const body = extractBody(message);

  const existing = message.id ? db.prepare('SELECT id FROM inbound_messages WHERE wamid = ?').get(message.id) : null;
  if (existing) return; // hindari duplikat kalau Meta mengirim ulang

  const info = db.prepare(`
    INSERT INTO inbound_messages (wamid, contact_id, phone, profile_name, type, body, raw)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(message.id || null, contact.id, phone, profileName, message.type || 'text', body, JSON.stringify(message));

  // Gambar bukti transfer dan berkas lain diunduh di latar belakang.
  if (JENIS_BERMEDIA.includes(message.type)) {
    unduhBerkasPesan(Number(info.lastInsertRowid), message)
      .catch((err) => console.error('[webhook] unduh berkas gagal:', err.message));
  }

  db.prepare(`UPDATE contacts SET last_inbound_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(contact.id);
  if (profileName && !contact.name) {
    db.prepare('UPDATE contacts SET name = ? WHERE id = ?').run(profileName, contact.id);
  }

  const normalized = String(body).trim().toLowerCase();
  if (OPT_OUT_KEYWORDS.includes(normalized)) {
    db.prepare(`UPDATE contacts SET opt_in = 0, opt_out_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(contact.id);
    logActivity(null, 'contact.opt_out', `${phone} berhenti berlangganan lewat kata "${normalized}"`);
  } else if (OPT_IN_KEYWORDS.includes(normalized)) {
    db.prepare(`
      UPDATE contacts SET opt_in = 1, opt_in_at = datetime('now'), opt_out_at = NULL,
                          opt_in_source = 'balasan_whatsapp', updated_at = datetime('now')
      WHERE id = ?
    `).run(contact.id);
  }
}

function applyTemplateStatusUpdate(value) {
  const name = value.message_template_name;
  const language = value.message_template_language;
  const event = value.event; // APPROVED | REJECTED | PAUSED | ...
  if (!name || !language) return;
  const exists = db.prepare('SELECT name FROM templates WHERE name = ? AND language = ?').get(name, language);
  if (exists) {
    db.prepare(`UPDATE templates SET status = ?, synced_at = datetime('now') WHERE name = ? AND language = ?`)
      .run(String(event || ''), name, language);
  }
  logActivity(null, 'template.status', `Template ${name} (${language}) -> ${event}`);
}

/** POST /webhook - menerima event dari Meta. */
function handleEvent(req, res) {
  const rawBody = req.rawBody || Buffer.from('');
  const appSecret = settings.get('app_secret');
  const check = verifySignature(rawBody, req.headers['x-hub-signature-256'], appSecret);

  // Meta harus selalu menerima 200 secepatnya, kalau tidak event akan dikirim ulang.
  res.status(200).send('EVENT_RECEIVED');

  try {
    db.prepare('INSERT INTO webhook_logs (kind, ok, note, raw) VALUES (?, ?, ?, ?)')
      .run('event', check.ok ? 1 : 0, check.note, rawBody.toString('utf8').slice(0, 8000));
    db.prepare(`DELETE FROM webhook_logs WHERE id NOT IN (SELECT id FROM webhook_logs ORDER BY id DESC LIMIT 200)`).run();

    if (!check.ok) {
      console.warn('[webhook] Event ditolak:', check.note);
      return;
    }

    const payload = req.body || {};
    if (payload.object !== 'whatsapp_business_account') return;

    for (const entry of payload.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value || {};

        if (change.field === 'message_template_status_update') {
          applyTemplateStatusUpdate(value);
          continue;
        }

        for (const status of value.statuses || []) applyStatus(status);

        if ((value.messages || []).length) {
          const profileByWaId = {};
          for (const c of value.contacts || []) profileByWaId[c.wa_id] = c.profile?.name || '';
          for (const message of value.messages) applyInbound(message, profileByWaId);
        }
      }
    }
  } catch (err) {
    console.error('[webhook] gagal memproses event:', err);
  }
}

module.exports = { handleVerification, handleEvent, verifySignature };
