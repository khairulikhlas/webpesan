# Panduan Pasang di Hostinger (hPanel — paket Web Hosting / Premium / Business)

Panduan ini untuk memasang **CRM Cinta Dakwah** di paket hosting Hostinger yang
sudah mendukung Node.js lewat hPanel, dengan domain `crm.cintadakwah.or.id`.

> Kalau kamu memakai **VPS Hostinger**, jangan pakai panduan ini — pakai bagian
> "Cara memasang di server" di `README.md`, karena caranya berbeda (lewat SSH).

---

## Ringkasan alurnya

```
1. Buat subdomain crm.cintadakwah.or.id
2. Unggah kode aplikasi ke server
3. Buat aplikasi Node.js di hPanel (tunjuk server.js sebagai file utama)
4. Isi variabel lingkungan (PUBLIC_URL & ENCRYPTION_KEY)
5. Jalankan NPM Install
6. Aktifkan HTTPS (SSL)
7. Pasang Cron Job penjaga antrean
8. Daftarkan webhook ke Meta
```

---

## Langkah 1 — Buat subdomain

1. Masuk ke hPanel → pilih hosting kamu → menu **Domains → Subdomains**.
2. Buat subdomain: isi `crm` untuk domain `cintadakwah.or.id`.
3. Catat **folder tujuannya**, biasanya `public_html/crm` atau `domains/crm.cintadakwah.or.id/public_html`.

> Kalau domain `.or.id`-nya masih menunggu persetujuan PANDI, langkah ini
> ditunda dulu. Sisanya (unggah kode, install) tetap bisa dikerjakan.

---

## Penting: aplikasi ini TIDAK punya `npm run build` dan TIDAK ada folder `dist`

Kalau kamu terbiasa memasang web React/Vue/Vite, alurnya biasanya:
`npm run build` → muncul folder `dist` → unggah isi `dist` ke `public_html` → selesai.

**Aplikasi ini berbeda.** Ini aplikasi server, bukan web statis. Yang diunggah
adalah **seluruh isi folder aplikasi**, lalu server yang menjalankannya
lewat `server.js`.

| | Web statis (React/Vue) | CRM Cinta Dakwah |
|---|---|---|
| Perlu `npm run build`? | Ya | **Tidak** |
| Yang diunggah | Isi folder `dist` saja | **Seluruh folder aplikasi** |
| Yang dijalankan server | Tidak ada, hanya file HTML | **`server.js`** (Node.js) |
| Butuh menu Node.js di hPanel? | Tidak | **Ya** |

Alasannya: tampilannya sengaja saya tulis dengan HTML, CSS, dan JavaScript biasa
sehingga tidak perlu dikompilasi. Sementara bagian servernya wajib berjalan,
karena dialah yang menghubungi WhatsApp API, menyimpan database, dan menerima
webhook dari Meta.

> Kalau kamu hanya mengunggah folder `public/` ke `public_html`, halaman login
> memang akan muncul, tapi tidak bisa dipakai sama sekali — semua tombolnya akan
> gagal karena tidak ada server yang melayani.

---

## Langkah 2 — Unggah kode aplikasi

**Penting soal lokasi folder.** Sebisa mungkin taruh kode aplikasi
**di luar `public_html`**, misalnya di `/home/uXXXXXX/crm-app`. Alasannya: folder
`data/` berisi database (kontak, riwayat, token). Kalau folder aplikasi berada di
dalam `public_html`, isinya berpotensi bisa diunduh lewat browser.

> Aplikasi ini sudah otomatis menaruh berkas `.htaccess` penolak akses di dalam
> folder `data/` sebagai pengaman tambahan. Tapi menaruhnya di luar `public_html`
> tetap cara yang paling aman.

Caranya:

1. hPanel → **Files → File Manager**.
2. Naik ke folder utama akun (yang isinya `public_html`, `domains`, dan lain-lain).
3. Buat folder baru bernama `crm-app`.
4. Masuk ke folder itu → tombol **Upload** → pilih `crm-cinta-dakwah.zip`.
5. Klik kanan file ZIP → **Extract**.
6. Kalau hasil ekstraknya jadi `crm-app/crm-cinta-dakwah/...`, pindahkan isinya
   naik satu tingkat supaya `server.js` berada langsung di dalam `crm-app`.

Struktur akhir yang benar:

```
crm-app/
├── server.js          <- harus ada di sini
├── package.json
├── public/
├── src/
└── scripts/
```

---

## Langkah 3 — Buat aplikasi Node.js di hPanel

1. hPanel → cari menu **Node.js** (biasanya di bagian **Advanced** atau **Website**).
2. Tekan **Create Application**, lalu isi:

| Kolom | Isi |
|---|---|
| **Node.js version** | Pilih yang paling baru, minimal **20**. Kalau ada 22, pilih 22 |
| **Application mode** | `Production` |
| **Application root** | `crm-app` (folder dari Langkah 2) |
| **Application URL** | `crm.cintadakwah.or.id` |
| **Application startup file** | `server.js` |

3. Tekan **Create**.

> Aplikasi ini tidak perlu kamu tentukan portnya. Panel Hostinger yang mengatur
> port, dan kode sudah dibuat mengikuti port dari panel secara otomatis.

---

## Langkah 4 — Isi variabel lingkungan

Masih di halaman aplikasi Node.js, cari bagian **Environment variables**, lalu
tambahkan dua ini:

| Nama | Nilai |
|---|---|
| `PUBLIC_URL` | `https://crm.cintadakwah.or.id` |
| `ENCRYPTION_KEY` | Isi dengan 64 karakter acak (cara membuatnya di bawah) |

**Cara membuat ENCRYPTION_KEY** — jalankan di komputermu sendiri (terminal yang
sama seperti waktu `npm start`):

```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Salin hasilnya (deretan huruf dan angka panjang), tempel sebagai nilai
`ENCRYPTION_KEY`. **Simpan juga di tempat aman** — kunci ini yang dipakai
mengenkripsi Access Token WhatsApp di database.

> Kalau di panel tidak ada fitur Environment variables, buat saja file bernama
> `.env` di dalam folder `crm-app` lewat File Manager, isinya:
> ```
> PUBLIC_URL=https://crm.cintadakwah.or.id
> ENCRYPTION_KEY=hasil-acak-tadi
> ```

---

## Langkah 5 — Jalankan NPM Install

Di halaman aplikasi Node.js, tekan tombol **Run NPM Install** (atau **NPM Install**).
Tunggu sampai selesai, biasanya 1–3 menit.

Setelah selesai, tekan **Restart** aplikasinya.

### Kalau NPM Install gagal

Penyebab tersering adalah komponen database `better-sqlite3` yang butuh file
khusus sesuai versi Node. Coba urutan ini:

1. **Ganti versi Node** ke 20 atau 22 (versi genap, yang LTS), lalu Run NPM Install lagi.
2. Kalau ada **Terminal** di hPanel, masuk ke folder aplikasi lalu jalankan:
   ```
   npm install --omit=dev --build-from-source=false
   ```
3. Kalau tetap gagal, salin **seluruh pesan errornya** dan kirim ke saya —
   ada beberapa cara lain yang bisa saya siapkan (termasuk mengganti komponen
   databasenya dengan versi yang tidak butuh kompilasi).

---

## Langkah 6 — Aktifkan HTTPS

hPanel → **Security → SSL** → pilih `crm.cintadakwah.or.id` → **Install SSL**
(gratis, Let's Encrypt). Tunggu sampai statusnya **Active**.

Ini **wajib**, bukan opsional: Meta hanya mau mengirim webhook ke alamat HTTPS.

Cek berhasil dengan membuka:
```
https://crm.cintadakwah.or.id/healthz
```
Harus muncul tulisan seperti `{"ok":true,"time":"...","antrean":{...}}`.

---

## Langkah 7 — Pasang Cron Job penjaga antrean (PENTING)

Di hosting shared, aplikasi biasanya **ditidurkan** kalau tidak ada pengunjung.
Kalau itu terjadi di tengah broadcast, sisa pesan berhenti terkirim sampai ada
yang membuka webnya.

Solusinya: panggil aplikasi tiap menit supaya tetap bangun.

1. hPanel → **Advanced → Cron Jobs**.
2. Buat cron job baru dengan jadwal **setiap menit** (`* * * * *`).
3. Perintahnya:
   ```
   curl -s https://crm.cintadakwah.or.id/healthz > /dev/null
   ```

Kalau pilihan "setiap menit" tidak tersedia di paketmu, pakai setiap 5 menit —
efeknya broadcast bisa tertunda maksimal 5 menit, masih wajar.

**Alternatif gratis:** daftar di layanan pemantau seperti UptimeRobot, arahkan ke
`https://crm.cintadakwah.or.id/healthz` dengan interval 5 menit. Selain menjaga
aplikasi tetap hidup, kamu juga dapat pemberitahuan kalau webnya mati.

---

## Langkah 8 — Buka web dan hubungkan ke Meta

1. Buka `https://crm.cintadakwah.or.id` → buat akun admin pertama.
2. Masuk ke menu **Panduan** di dalam aplikasi, ikuti Langkah 1–7 di sana
   (ambil Phone Number ID, WABA ID, buat System User Token, daftarkan webhook).
3. URL webhook yang didaftarkan ke Meta:
   ```
   https://crm.cintadakwah.or.id/webhook
   ```
   Verify token-nya sudah disediakan otomatis di halaman **Pengaturan**.

---

## Perawatan

**Memperbarui aplikasi:** unggah ZIP versi baru, ekstrak menimpa file lama
(**jangan hapus folder `data/`**), lalu tekan **Restart** di halaman Node.js.

**Mencadangkan data:** File Manager → klik kanan folder `data` → **Compress** →
unduh hasilnya. Lakukan rutin, misalnya seminggu sekali. Simpan juga
`ENCRYPTION_KEY` bersama cadangan itu.

**Lupa kata sandi admin:** kalau hPanel punya Terminal, masuk ke folder aplikasi
lalu jalankan:
```
node scripts/reset-admin.js admin@cintadakwah.or.id KataSandiBaru123
```

**Melihat catatan error:** di halaman aplikasi Node.js biasanya ada tombol
**Logs** atau file `stderr.log` di folder aplikasi.

---

## Kalau ada masalah

| Gejala | Kemungkinan penyebab |
|---|---|
| Web tidak terbuka sama sekali | Aplikasi belum di-Restart, atau **Application startup file** bukan `server.js` |
| Muncul "503" atau "Passenger error" | NPM Install belum berhasil, atau versi Node terlalu lama. Cek Logs |
| Web terbuka tapi minta buat admin lagi | Folder `data/` terhapus saat memperbarui aplikasi |
| Meta menolak URL webhook | SSL belum aktif, atau alamatnya masih `http://` bukan `https://` |
| Broadcast berhenti di tengah jalan | Cron Job penjaga (Langkah 7) belum dipasang |
| Status "diterima"/"dibaca" tidak muncul | Field `messages` belum dicentang (subscribe) di konfigurasi webhook Meta |
