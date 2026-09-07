'use strict';

/**
 * Normalisasi nomor telepon ke format yang diminta WhatsApp Cloud API:
 * kode negara + nomor, tanpa tanda '+', spasi, atau strip.
 * Contoh: "0812-3456-7890" -> "6281234567890"
 */

function normalizePhone(input, defaultCountryCode = '62') {
  if (input === null || input === undefined) return null;

  let raw = String(input).trim();
  if (!raw) return null;

  const hasPlus = raw.startsWith('+');
  // Buang semua karakter selain angka.
  let digits = raw.replace(/\D/g, '');
  if (!digits) return null;

  const cc = String(defaultCountryCode || '').replace(/\D/g, '');

  if (!hasPlus) {
    if (digits.startsWith('00')) {
      digits = digits.slice(2);                       // 0062... -> 62...
    } else if (digits.startsWith('0')) {
      digits = cc + digits.replace(/^0+/, '');        // 0812... -> 62812...
    } else if (cc && !digits.startsWith(cc) && digits.length <= 11) {
      // Nomor lokal tanpa 0 di depan, contoh "81234567890"
      digits = cc + digits;
    }
  }

  // Panjang wajar nomor internasional: 8-15 digit (rekomendasi E.164 maksimum 15).
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}

function prettyPhone(phone) {
  if (!phone) return '';
  return `+${phone}`;
}

module.exports = { normalizePhone, prettyPhone };
