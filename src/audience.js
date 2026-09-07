'use strict';

const { db } = require('./db');
const settings = require('./settings');

/**
 * Menerjemahkan pilihan penerima dari layar Broadcast menjadi daftar kontak.
 *
 * audience = {
 *   type: 'all' | 'tags' | 'ids',
 *   tags: ['pelanggan', 'jakarta'],
 *   tagMode: 'any' | 'all',
 *   ids: [1,2,3],
 *   search: 'budi',
 *   onlyOptIn: true
 * }
 */
function resolveAudience(audience = {}) {
  const onlyOptIn = audience.onlyOptIn !== undefined
    ? Boolean(audience.onlyOptIn)
    : settings.get('require_opt_in') === '1';

  const where = [];
  const params = [];

  if (onlyOptIn) where.push('opt_in = 1');

  if (audience.type === 'ids') {
    const ids = (audience.ids || []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
    if (ids.length === 0) return [];
    where.push(`id IN (${ids.map(() => '?').join(',')})`);
    params.push(...ids);
  } else if (audience.type === 'tags') {
    const tags = (audience.tags || []).map((t) => String(t).trim().toLowerCase()).filter(Boolean);
    if (tags.length === 0) return [];
    const clauses = tags.map(() => `(',' || lower(replace(tags, ' ', '')) || ',') LIKE ?`);
    const joiner = audience.tagMode === 'all' ? ' AND ' : ' OR ';
    where.push(`(${clauses.join(joiner)})`);
    params.push(...tags.map((t) => `%,${t.replace(/\s+/g, '')},%`));
  }

  if (audience.search) {
    where.push('(name LIKE ? OR phone LIKE ? OR email LIKE ?)');
    const like = `%${String(audience.search).trim()}%`;
    params.push(like, like, like);
  }

  const sql = `SELECT * FROM contacts ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id ASC`;
  return db.prepare(sql).all(...params);
}

function describeAudience(audience = {}) {
  if (audience.type === 'ids') return `${(audience.ids || []).length} kontak dipilih manual`;
  if (audience.type === 'tags') return `Label: ${(audience.tags || []).join(', ') || '-'}`;
  return 'Semua kontak';
}

module.exports = { resolveAudience, describeAudience };
