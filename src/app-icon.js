'use strict';

/**
 * Menentukan ikon aplikasi yang sedang dipakai.
 *
 * Ikon dipakai di tiga tempat: ikon tab browser, ikon aplikasi saat dipasang
 * di HP, dan ikon pintasan di layar utama. Semuanya menunjuk ke satu alamat
 * `/app-icon`, sehingga ketika pemilik aplikasi mengganti ikonnya, ketiganya
 * ikut berubah tanpa perlu menyentuh berkas program.
 */

const fs = require('fs');
const path = require('path');
const { db } = require('./db');
const settings = require('./settings');
const config = require('./config');

const IKON_BAWAAN = path.join(config.ROOT, 'public', 'icon-512.png');

/** Membaca ukuran gambar dari kepala berkas PNG. */
function ukuranPng(jalur) {
  try {
    const fd = fs.openSync(jalur, 'r');
    const kepala = Buffer.alloc(24);
    fs.readSync(fd, kepala, 0, 24, 0);
    fs.closeSync(fd);
    if (kepala.slice(1, 4).toString() !== 'PNG') return null;
    return { lebar: kepala.readUInt32BE(16), tinggi: kepala.readUInt32BE(20) };
  } catch {
    return null;
  }
}

/**
 * Mengembalikan keterangan ikon yang berlaku saat ini.
 * Kalau ikon pilihan pengguna hilang atau rusak, otomatis kembali ke bawaan
 * supaya aplikasi tidak pernah tampil tanpa ikon.
 */
function ikonSekarang() {
  const mediaId = settings.get('icon_media_id');
  if (mediaId) {
    const berkas = db.prepare('SELECT * FROM media WHERE id = ?').get(mediaId);
    if (berkas) {
      const jalur = path.join(config.DATA_DIR, 'media', berkas.id);
      if (fs.existsSync(jalur)) {
        const ukuran = ukuranPng(jalur) || { lebar: 512, tinggi: 512 };
        return {
          jalur,
          mime: berkas.mime || 'image/png',
          lebar: ukuran.lebar,
          tinggi: ukuran.tinggi,
          versi: berkas.id.slice(0, 12),
          bawaan: false,
        };
      }
    }
  }
  const ukuran = ukuranPng(IKON_BAWAAN) || { lebar: 512, tinggi: 512 };
  return {
    jalur: IKON_BAWAAN,
    mime: 'image/png',
    lebar: ukuran.lebar,
    tinggi: ukuran.tinggi,
    versi: 'bawaan',
    bawaan: true,
  };
}

module.exports = { ikonSekarang, ukuranPng, IKON_BAWAAN };
