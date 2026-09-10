'use strict';

const { db } = require('./db');
const settings = require('./settings');

/**
 * Menerjemahkan pilihan penerima dari layar Broadcast menjadi daftar kontak.
 *
 * audience = {
 *   type: 'all' | 'tags' | 'ids',
 *   tags: ['donatur', 'jakarta'],
 *   tagMode: 'any' | 'all',
 *   ids: [1, 2, 3],
 *   search: 'budi',
 *   onlyOptIn: true,
 *
 *   // Pengiriman bertahap untuk database besar:
 *   batas: 1000,              // kirim maksimal sekian orang kali ini
 *   lewatiTemplateIni: true,  // lewati yang sudah pernah menerima template yang sama
 *   lewatiHariTerakhir: 7,    // lewati yang sudah menerima broadcast apa pun N hari terakhir
 * }
 *
 * Pengiriman bertahap dibutuhkan karena Meta membatasi jumlah kontak unik per
 * 24 jam. Dengan menyimpan riwayat pengiriman, sisa penerima hari berikutnya
 * bisa dihitung otomatis tanpa perlu mencatat manual siapa yang sudah dikirimi.
 */
function bangunKueri(audience = {}, templateName = '') {
  const onlyOptIn = audience.onlyOptIn !== undefined
    ? Boolean(audience.onlyOptIn)
    : settings.get('require_opt_in') === '1';

  const where = [];
  const params = [];

  if (onlyOptIn) where.push('c.opt_in = 1');

  if (audience.type === 'ids') {
    const ids = (audience.ids || []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
    if (ids.length === 0) return null;
    where.push(`c.id IN (${ids.map(() => '?').join(',')})`);
    params.push(...ids);
  } else if (audience.type === 'tags') {
    const tags = (audience.tags || []).map((t) => String(t).trim().toLowerCase()).filter(Boolean);
    if (tags.length === 0) return null;
    const clauses = tags.map(() => `(',' || lower(replace(c.tags, ' ', '')) || ',') LIKE ?`);
    const joiner = audience.tagMode === 'all' ? ' AND ' : ' OR ';
    where.push(`(${clauses.join(joiner)})`);
    params.push(...tags.map((t) => `%,${t.replace(/\s+/g, '')},%`));
  }

  if (audience.search) {
    where.push('(c.name LIKE ? OR c.phone LIKE ? OR c.email LIKE ?)');
    const like = `%${String(audience.search).trim()}%`;
    params.push(like, like, like);
  }

  // Lewati kontak yang sudah pernah menerima template yang sama.
  if (audience.lewatiTemplateIni && templateName) {
    where.push(`NOT EXISTS (
      SELECT 1 FROM outbound_messages m
      JOIN campaigns k ON k.id = m.campaign_id
      WHERE m.contact_id = c.id
        AND k.template_name = ?
        AND m.status IN ('sent', 'delivered', 'read')
    )`);
    params.push(templateName);
  }

  // Lewati kontak yang baru saja menerima broadcast apa pun.
  const hari = Number(audience.lewatiHariTerakhir) || 0;
  if (hari > 0) {
    where.push(`NOT EXISTS (
      SELECT 1 FROM outbound_messages m2
      WHERE m2.contact_id = c.id
        AND m2.sent_at IS NOT NULL
        AND m2.sent_at >= datetime('now', ?)
    )`);
    params.push(`-${hari} days`);
  }

  return { whereSql: where.length ? 'WHERE ' + where.join(' AND ') : '', params };
}

/** Daftar kontak yang benar-benar akan dikirimi kali ini (sudah dipotong batas). */
function resolveAudience(audience = {}, templateName = '') {
  const kueri = bangunKueri(audience, templateName);
  if (!kueri) return [];

  const batas = Number(audience.batas) || 0;
  const limitSql = batas > 0 ? ' LIMIT ?' : '';
  const params = batas > 0 ? [...kueri.params, batas] : kueri.params;

  return db.prepare(`SELECT c.* FROM contacts c ${kueri.whereSql} ORDER BY c.id ASC${limitSql}`).all(...params);
}

/**
 * Ringkasan jumlah untuk ditampilkan sebelum mengirim:
 *  - cocok   : semua kontak yang memenuhi kriteria
 *  - dikirim : yang akan dikirimi kali ini (setelah dipotong batas)
 *  - sisa    : yang tertunda untuk pengiriman berikutnya
 */
function hitungAudience(audience = {}, templateName = '') {
  const kueri = bangunKueri(audience, templateName);
  if (!kueri) return { cocok: 0, dikirim: 0, sisa: 0 };

  const cocok = db.prepare(`SELECT COUNT(*) AS n FROM contacts c ${kueri.whereSql}`).get(...kueri.params).n;
  const batas = Number(audience.batas) || 0;
  const dikirim = batas > 0 ? Math.min(cocok, batas) : cocok;
  return { cocok, dikirim, sisa: cocok - dikirim };
}

function describeAudience(audience = {}) {
  const bagian = [];
  if (audience.type === 'ids') bagian.push(`${(audience.ids || []).length} kontak dipilih manual`);
  else if (audience.type === 'tags') bagian.push(`Label: ${(audience.tags || []).join(', ') || '-'}`);
  else bagian.push('Semua kontak');

  if (audience.lewatiTemplateIni) bagian.push('belum pernah menerima template ini');
  if (Number(audience.lewatiHariTerakhir) > 0) bagian.push(`tidak dikirimi ${audience.lewatiHariTerakhir} hari terakhir`);
  if (Number(audience.batas) > 0) bagian.push(`maksimal ${audience.batas} penerima`);
  return bagian.join(' • ');
}

module.exports = { resolveAudience, hitungAudience, describeAudience };
