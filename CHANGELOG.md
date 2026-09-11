# Catatan Pembaruan

Daftar perubahan tiap versi, dari yang terbaru.
Setelah memperbarui, tekan **Ctrl + Shift + R** di browser supaya tampilan
lama yang tersimpan ikut disegarkan.

---

## 11 September 2026 — Bisa dipasang di HP & sambungan sistem lain

**Aplikasi bisa dipasang di HP staf**
- Buka di Chrome HP → menu ⋮ → Install app. Di iPhone lewat Safari → Share →
  Add to Home Screen. Muncul sebagai ikon di layar utama, terbuka penuh layar
- Kotak Masuk di layar HP kini menampilkan daftar percakapan **atau** isi
  percakapan secara bergantian, tidak lagi bertumpuk. Ada tombol kembali
- Tetap terbuka saat sinyal putus, memakai tampilan yang tersimpan terakhir

**Sambungan ke sistem lain (API)**
- Halaman Pengaturan punya panel baru untuk membuat kunci API
- Sistem lain milik lembaga, misalnya web pencatatan donatur, bisa mengirim
  data kontaknya langsung ke CRM. Nomor dirapikan otomatis, kontak yang sudah
  ada diperbarui bukan diduplikasi, dan label lama tidak terhapus
- Kontak yang sudah menyatakan berhenti tidak akan dihidupkan kembali oleh
  sistem luar, kecuali diminta secara tegas
- Keterangan lengkap untuk pengembang ada di `BRIEF-INTEGRASI-API.md`

**Perbaikan**
- Kode kegagalan 130472, 131053, dan 131051 ikut diterjemahkan
- Panduan Nginx menyajikan folder media langsung dari disk, mengatasi
  kegagalan 131053 saat broadcast besar

---

## 11 September 2026 — Kuota harian, bukti transfer, kirim gambar

**Hitungan kuota harian diperbaiki (bug)**
- Sebelumnya semua pesan keluar dijumlahkan, termasuk balasan petugas di
  Kotak Masuk, dan satu kontak yang dikirimi dua template terhitung dua kali.
  Akibatnya kampanye terjeda padahal kuota Meta belum tentu tersentuh
- Sekarang mengikuti aturan Meta: hanya **kontak unik** yang dihubungi lebih
  dulu memakai template. Balasan tidak dihitung. Rinciannya tampil di Dashboard

**Berkas dari donatur kini tampil**
- Foto bukti transfer sebelumnya hanya muncul sebagai tulisan `[image]`.
  Sekarang diunduh otomatis dan ditampilkan di percakapan, bisa dibuka besar
- Berlaku juga untuk video, pesan suara, dan dokumen PDF

**Kirim gambar dari Kotak Masuk**
- Tombol 📎 untuk melampirkan gambar QRIS, brosur, atau dokumen dari Galeri

**Penyebab kegagalan dijelaskan**
- Halaman detail broadcast mengelompokkan kegagalan per sebab,
  menerjemahkannya ke bahasa sehari-hari, dan memberi saran perbaikan

---

## 10 September 2026 — Pengiriman bertahap & pembersih nomor

**Pengiriman bertahap untuk database besar**
- Di langkah Pilih penerima ada panel baru: batas jumlah penerima sekali
  kirim, lewati yang sudah pernah menerima template ini, dan lewati yang
  baru dikirimi dalam sekian hari
- Pratinjau melaporkan berapa yang cocok, berapa dikirim sekarang, dan
  berapa sisanya. Besok tinggal ulangi, yang sudah terkirim otomatis dilompati
- Tidak perlu lagi mencatat manual siapa yang sudah dikirimi

**Pembersih nomor tidak aktif**
- Tombol di halaman detail broadcast untuk menandai nomor yang ditolak
  WhatsApp karena tidak terdaftar. Jumlahnya ditampilkan dulu sebelum
  diterapkan, dan datanya tidak dihapus, hanya ditandai

**Lainnya**
- Pemilih emoji di kotak balasan
- Pemeriksa kesiapan webhook di halaman Pengaturan, lengkap dengan tombol
  menghubungkan akun WhatsApp ke aplikasi ini
- Skrip pembaru otomatis `scripts/perbarui.sh`

---

## 10 September 2026 — Galeri media & buat template dari web

**Perbaikan bug: tampilan melompat sendiri**
- Penyegar otomatis halaman Riwayat Broadcast tidak dimatikan saat pindah
  menu, sehingga menimpa halaman lain yang sedang dibuka. Sudah diperbaiki

**Galeri media**
- Unggah gambar sekali, alamatnya dipakai berulang untuk broadcast berikutnya
- Isian variabel tiap template diingat, termasuk alamat gambar header

**Membuat template dari web**
- Tidak perlu lagi membuka WhatsApp Manager. Formulir lengkap dengan header
  teks atau gambar, isi pesan, footer, dan tombol
- Diperiksa dulu sebelum dikirim: format nama, urutan variabel, kecocokan
  jumlah contoh

---

## 9 September 2026 — Halaman kebijakan privasi

- Halaman publik di `/kebijakan-privasi`, syarat Meta untuk mempublikasikan
  aplikasi dari mode Development ke Live

---

## 8 September 2026 — Nama aplikasi & penyesuaian hosting

- Nama aplikasi menjadi CRM Cinta Dakwah, dan bisa diubah dari Pengaturan
- Jalur berkas `.env` dibuat absolut agar pengaturan tidak hilang diam-diam
- Folder data diberi pengaman tambahan
- `/healthz` melaporkan jumlah pesan yang sedang mengantre

---

## Versi pertama — Aplikasi broadcast WhatsApp

Kontak, template, broadcast bertahap, webhook status dan balasan, kotak
masuk, laporan, serta pengaturan multi-pengguna.
