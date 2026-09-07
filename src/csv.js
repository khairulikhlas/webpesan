'use strict';

/**
 * Parser CSV sederhana namun benar: mendukung tanda kutip ganda, koma di dalam
 * kutip, baris baru di dalam kutip, pemisah koma/titik-koma/tab, dan BOM Excel.
 */

function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim().length > 0) || '';
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let inQuotes = false;
  for (let i = 0; i < firstLine.length; i += 1) {
    const ch = firstLine[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && counts[ch] !== undefined) counts[ch] += 1;
  }
  let best = ',';
  for (const key of Object.keys(counts)) if (counts[key] > counts[best]) best = key;
  return best;
}

function parseCsv(input) {
  let text = String(input || '');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // buang BOM
  const delimiter = detectDelimiter(text);

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; }
        else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === delimiter) { row.push(field); field = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += ch;
  }
  row.push(field);
  rows.push(row);

  // Buang baris kosong
  const cleaned = rows.filter((r) => r.some((c) => String(c).trim() !== ''));
  if (cleaned.length === 0) return { headers: [], records: [] };

  const headers = cleaned[0].map((h) => String(h).trim());
  const records = cleaned.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = (r[idx] !== undefined ? String(r[idx]).trim() : ''); });
    return obj;
  });
  return { headers, records };
}

/** Mencari nilai kolom tanpa peduli huruf besar/kecil dan variasi nama umum. */
function pick(record, candidates) {
  const lowerMap = {};
  for (const key of Object.keys(record)) lowerMap[key.toLowerCase().trim()] = record[key];
  for (const cand of candidates) {
    const val = lowerMap[cand.toLowerCase()];
    if (val !== undefined && String(val).trim() !== '') return String(val).trim();
  }
  return '';
}

function toCsv(rows, headers) {
  const cols = headers || (rows.length ? Object.keys(rows[0]) : []);
  const escape = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.map(escape).join(',')];
  for (const r of rows) lines.push(cols.map((c) => escape(r[c])).join(','));
  return lines.join('\r\n');
}

module.exports = { parseCsv, pick, toCsv };
