'use strict';

/**
 * Klien WhatsApp Cloud API (Meta Graph API).
 *
 * Dokumentasi resmi:
 *   https://developers.facebook.com/docs/whatsapp/cloud-api
 *
 * Catatan versi API: nomor versi (contoh v23.0) bisa diganti dari halaman
 * Pengaturan tanpa mengubah kode, karena Meta merilis versi baru berkala.
 */

const settings = require('./settings');

// Alamat Graph API. Bisa diarahkan ke server lain lewat variabel WA_GRAPH_HOST
// (dipakai untuk pengujian otomatis; dalam pemakaian normal biarkan apa adanya).
const GRAPH_HOST = (process.env.WA_GRAPH_HOST || 'https://graph.facebook.com').replace(/\/+$/, '');

function cfg() {
  const s = settings.getAll();
  return {
    token: s.access_token,
    phoneNumberId: s.phone_number_id,
    wabaId: s.business_account_id,
    version: s.graph_version || 'v23.0',
  };
}

function graphUrl(pathname, version) {
  const v = version || cfg().version;
  return `${GRAPH_HOST}/${v}/${String(pathname).replace(/^\/+/, '')}`;
}

/** Error yang membawa detail dari Graph API supaya bisa ditampilkan ke pengguna. */
class WhatsAppError extends Error {
  constructor(message, { httpStatus = 0, code = '', subcode = '', title = '', detail = '', retryable = false, fatal = false, raw = null } = {}) {
    super(message);
    this.name = 'WhatsAppError';
    this.httpStatus = httpStatus;
    this.code = String(code || '');
    this.subcode = String(subcode || '');
    this.title = title || '';
    this.detail = detail || '';
    this.retryable = retryable;
    this.fatal = fatal; // fatal = kredensial/konfigurasi salah, jangan lanjut kirim
    this.raw = raw;
  }
}

// Kode error yang layak dicoba ulang (masalah sementara / rate limit).
const RETRYABLE_CODES = new Set(['1', '2', '4', '80007', '130429', '131056', '133016', '131000']);
// Kode error yang berarti konfigurasi/kredensial bermasalah -> hentikan kampanye.
const FATAL_CODES = new Set(['0', '190', '200', '10', '3', '104', '33']);

function classifyError(httpStatus, json) {
  const err = (json && json.error) || {};
  const code = String(err.code ?? '');
  const subcode = String(err.error_subcode ?? '');
  const title = err.error_data?.messaging_product ? '' : (err.error_user_title || err.type || '');
  const detail = err.error_data?.details || err.error_user_msg || err.message || 'Terjadi kesalahan pada WhatsApp API';

  const retryable = httpStatus === 429 || httpStatus >= 500 || RETRYABLE_CODES.has(code);
  const fatal = FATAL_CODES.has(code) && !retryable;

  return new WhatsAppError(detail, {
    httpStatus, code, subcode, title, detail, retryable, fatal, raw: json,
  });
}

async function graphRequest(pathname, { method = 'GET', body = null, query = null, timeoutMs = 30000, version = null } = {}) {
  const { token } = cfg();
  if (!token) {
    throw new WhatsAppError('Access Token belum diisi. Buka menu Pengaturan untuk mengisinya.', { fatal: true });
  }

  let url = graphUrl(pathname, version);
  if (query) {
    const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== ''));
    const s = qs.toString();
    if (s) url += (url.includes('?') ? '&' : '?') + s;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    // Gangguan jaringan: layak dicoba ulang.
    throw new WhatsAppError(`Gagal menghubungi server WhatsApp: ${err.message}`, { retryable: true });
  }
  clearTimeout(timer);

  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { rawText: text }; }

  if (!response.ok) throw classifyError(response.status, json);
  return json;
}

/** Kirim pesan template (satu-satunya cara broadcast ke pelanggan di luar jendela 24 jam). */
async function sendTemplate({ to, templateName, language, components = [] }) {
  const { phoneNumberId } = cfg();
  if (!phoneNumberId) throw new WhatsAppError('Phone Number ID belum diisi di Pengaturan.', { fatal: true });

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: String(to),
    type: 'template',
    template: {
      name: templateName,
      language: { code: language },
    },
  };
  if (components && components.length) payload.template.components = components;

  const res = await graphRequest(`${phoneNumberId}/messages`, { method: 'POST', body: payload });
  return { wamid: res?.messages?.[0]?.id || null, response: res, payload };
}

/** Kirim pesan teks bebas. Hanya boleh dalam 24 jam setelah pelanggan membalas. */
async function sendText({ to, body, previewUrl = false }) {
  const { phoneNumberId } = cfg();
  if (!phoneNumberId) throw new WhatsAppError('Phone Number ID belum diisi di Pengaturan.', { fatal: true });

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: String(to),
    type: 'text',
    text: { preview_url: Boolean(previewUrl), body: String(body) },
  };
  const res = await graphRequest(`${phoneNumberId}/messages`, { method: 'POST', body: payload });
  return { wamid: res?.messages?.[0]?.id || null, response: res, payload };
}

/** Tandai pesan masuk sebagai sudah dibaca (centang biru di sisi pelanggan). */
async function markAsRead(wamid) {
  const { phoneNumberId } = cfg();
  if (!phoneNumberId || !wamid) return null;
  return graphRequest(`${phoneNumberId}/messages`, {
    method: 'POST',
    body: { messaging_product: 'whatsapp', status: 'read', message_id: wamid },
  });
}

/** Ambil daftar template dari WhatsApp Manager (butuh WhatsApp Business Account ID). */
async function listTemplates({ limit = 100 } = {}) {
  const { wabaId } = cfg();
  if (!wabaId) throw new WhatsAppError('WhatsApp Business Account ID belum diisi di Pengaturan.', { fatal: true });

  const all = [];
  let after = '';
  for (let page = 0; page < 20; page += 1) { // pengaman maksimal 20 halaman
    const res = await graphRequest(`${wabaId}/message_templates`, {
      query: {
        fields: 'id,name,status,category,language,components,quality_score,rejected_reason',
        limit,
        after: after || undefined,
      },
    });
    if (Array.isArray(res?.data)) all.push(...res.data);
    after = res?.paging?.cursors?.after || '';
    if (!after || !res?.paging?.next) break;
  }
  return all;
}

/** Cek kredensial: ambil info nomor pengirim. */
async function getPhoneNumberInfo() {
  const { phoneNumberId } = cfg();
  if (!phoneNumberId) throw new WhatsAppError('Phone Number ID belum diisi di Pengaturan.', { fatal: true });
  return graphRequest(String(phoneNumberId), {
    query: { fields: 'id,display_phone_number,verified_name,quality_rating,messaging_limit_tier,platform_type,throughput' },
  });
}

module.exports = {
  WhatsAppError,
  graphRequest,
  graphUrl,
  sendTemplate,
  sendText,
  markAsRead,
  listTemplates,
  getPhoneNumberInfo,
};
