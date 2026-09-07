'use strict';

/**
 * Membaca struktur template dari WhatsApp Manager, mendeteksi variabelnya
 * ({{1}} atau {{nama_variabel}}), lalu menyusun payload "components" untuk
 * setiap penerima berdasarkan pemetaan yang dipilih pengguna.
 */

const VAR_PATTERN = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

function findVars(text) {
  const found = [];
  if (!text) return found;
  VAR_PATTERN.lastIndex = 0;
  let m = VAR_PATTERN.exec(text);
  while (m) {
    if (!found.includes(m[1])) found.push(m[1]);
    m = VAR_PATTERN.exec(text);
  }
  return found;
}

/**
 * Menghasilkan daftar "slot" yang perlu diisi pengguna untuk sebuah template.
 * Setiap slot: { key, label, kind, ... }
 *   kind: 'text' (variabel teks) | 'media' (header gambar/video/dokumen)
 */
function analyzeTemplate(components = []) {
  const slots = [];
  let bodyText = '';
  let headerText = '';
  let footerText = '';
  const buttons = [];

  for (const comp of components || []) {
    const type = String(comp.type || '').toUpperCase();

    if (type === 'HEADER') {
      const format = String(comp.format || 'TEXT').toUpperCase();
      if (format === 'TEXT') {
        headerText = comp.text || '';
        for (const v of findVars(headerText)) {
          slots.push({ key: `header.${v}`, label: `Header {{${v}}}`, kind: 'text', section: 'header', name: v });
        }
      } else if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(format)) {
        slots.push({
          key: `header.media`,
          label: `Header ${format === 'IMAGE' ? 'Gambar' : format === 'VIDEO' ? 'Video' : 'Dokumen'} (URL file)`,
          kind: 'media',
          mediaType: format.toLowerCase(),
          section: 'header',
        });
      }
    } else if (type === 'BODY') {
      bodyText = comp.text || '';
      for (const v of findVars(bodyText)) {
        slots.push({ key: `body.${v}`, label: `Isi pesan {{${v}}}`, kind: 'text', section: 'body', name: v });
      }
    } else if (type === 'FOOTER') {
      footerText = comp.text || '';
    } else if (type === 'BUTTONS') {
      (comp.buttons || []).forEach((btn, index) => {
        const btnType = String(btn.type || '').toUpperCase();
        buttons.push({ index, type: btnType, text: btn.text || '', url: btn.url || '' });
        if (btnType === 'URL') {
          for (const v of findVars(btn.url || '')) {
            slots.push({
              key: `button.${index}.${v}`,
              label: `Tombol "${btn.text || index + 1}" - bagian URL {{${v}}}`,
              kind: 'text', section: 'button', buttonIndex: index, buttonSubType: 'url', name: v,
            });
          }
        } else if (btnType === 'COPY_CODE') {
          slots.push({
            key: `button.${index}.1`,
            label: `Tombol "Salin kode" - kode kupon`,
            kind: 'text', section: 'button', buttonIndex: index, buttonSubType: 'copy_code', name: '1',
          });
        }
      });
    }
  }

  return { slots, bodyText, headerText, footerText, buttons };
}

/** Nilai variabel tidak boleh mengandung baris baru / tab / spasi berlebih. */
function sanitizeParam(value) {
  return String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/ {4,}/g, '   ')
    .trim();
}

function contactValue(contact, field) {
  if (!contact) return '';
  switch (field) {
    case 'name': return contact.name || '';
    case 'phone': return contact.phone || '';
    case 'email': return contact.email || '';
    case 'tags': return contact.tags || '';
    default: {
      let attrs = {};
      try { attrs = JSON.parse(contact.attributes || '{}'); } catch { attrs = {}; }
      // pencarian tanpa peduli besar-kecil huruf
      if (attrs[field] !== undefined) return attrs[field];
      const key = Object.keys(attrs).find((k) => k.toLowerCase() === String(field).toLowerCase());
      return key ? attrs[key] : '';
    }
  }
}

/** Menghitung nilai akhir sebuah slot untuk satu kontak. */
function resolveSlot(mappingEntry, contact) {
  if (!mappingEntry) return '';
  const { source = 'static', value = '', fallback = '' } = mappingEntry;
  let out = '';
  if (source === 'field') {
    out = contactValue(contact, value);
    if (!String(out).trim()) out = fallback;
  } else {
    out = value;
  }
  return sanitizeParam(out);
}

/**
 * Menyusun array "components" untuk API /messages.
 * mapping: objek { "body.1": {source,value,fallback}, "header.media": {source:'static', value:'https://...'} , ... }
 */
function buildComponents(templateComponents, mapping = {}, contact = null, { namedParams = null } = {}) {
  const analysis = analyzeTemplate(templateComponents);
  const components = [];
  const missing = [];

  const headerTextSlots = analysis.slots.filter((s) => s.section === 'header' && s.kind === 'text');
  const headerMediaSlot = analysis.slots.find((s) => s.section === 'header' && s.kind === 'media');
  const bodySlots = analysis.slots.filter((s) => s.section === 'body');
  const buttonSlots = analysis.slots.filter((s) => s.section === 'button');

  // Template dengan variabel bernama harus memakai "parameter_name".
  const useNamed = namedParams === null
    ? [...headerTextSlots, ...bodySlots].some((s) => !/^\d+$/.test(s.name))
    : Boolean(namedParams);

  const makeParam = (slot) => {
    const val = resolveSlot(mapping[slot.key], contact);
    if (!val) missing.push(slot.label);
    const param = { type: 'text', text: val };
    if (useNamed && !/^\d+$/.test(slot.name)) param.parameter_name = slot.name;
    return param;
  };

  if (headerMediaSlot) {
    const link = resolveSlot(mapping[headerMediaSlot.key], contact);
    if (!link) missing.push(headerMediaSlot.label);
    const mediaType = headerMediaSlot.mediaType; // image | video | document
    const media = { link };
    if (mediaType === 'document') {
      const filename = resolveSlot(mapping['header.filename'], contact);
      if (filename) media.filename = filename;
    }
    components.push({ type: 'header', parameters: [{ type: mediaType, [mediaType]: media }] });
  } else if (headerTextSlots.length) {
    components.push({ type: 'header', parameters: headerTextSlots.map(makeParam) });
  }

  if (bodySlots.length) {
    components.push({ type: 'body', parameters: bodySlots.map(makeParam) });
  }

  // Kelompokkan parameter tombol per index tombol.
  const byButton = new Map();
  for (const slot of buttonSlots) {
    if (!byButton.has(slot.buttonIndex)) byButton.set(slot.buttonIndex, { subType: slot.buttonSubType, slots: [] });
    byButton.get(slot.buttonIndex).slots.push(slot);
  }
  for (const [index, info] of [...byButton.entries()].sort((a, b) => a[0] - b[0])) {
    components.push({
      type: 'button',
      sub_type: info.subType,
      index: String(index),
      parameters: info.slots.map((slot) => {
        const val = resolveSlot(mapping[slot.key], contact);
        if (!val) missing.push(slot.label);
        return info.subType === 'copy_code'
          ? { type: 'coupon_code', coupon_code: val }
          : { type: 'text', text: val };
      }),
    });
  }

  return { components, missing, analysis };
}

/** Teks pratinjau untuk ditampilkan di layar (bukan dikirim ke API). */
function renderPreview(templateComponents, mapping = {}, contact = null) {
  const analysis = analyzeTemplate(templateComponents);
  const fill = (text, section) => String(text || '').replace(VAR_PATTERN, (whole, name) => {
    const val = resolveSlot(mapping[`${section}.${name}`], contact);
    return val || whole;
  });
  return {
    header: fill(analysis.headerText, 'header'),
    body: fill(analysis.bodyText, 'body'),
    footer: analysis.footerText,
    buttons: analysis.buttons,
  };
}

module.exports = { analyzeTemplate, buildComponents, renderPreview, findVars, sanitizeParam, contactValue };
