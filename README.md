# CRM Cinta Dakwah — Broadcast WhatsApp untuk Tim

Aplikasi web siap pakai untuk mengirim pesan **WhatsApp broadcast** lewat
**WhatsApp Cloud API resmi dari Meta**. Dibuat untuk dipakai tim internal:
tinggal pasang di server sendiri, isi kredensial dari Meta, lalu kirim.

Tidak perlu bisa coding untuk memakainya. Semua pengaturan dilakukan lewat
halaman web, dan di dalam aplikasi ada menu **Panduan** berisi langkah demi
langkah menghubungkan ke Meta.

---

## Apa saja yang bisa dilakukan

| Fitur | Keterangan |
|---|---|
| **Kirim broadcast** | Proses 4 langkah: pilih template → isi variabel → pilih penerima → periksa & kirim |
| **Personalisasi** | Isi variabel bisa diambil otomatis dari data kontak (nama, kota, atau kolom apa pun dari file CSV) |
| **Manajemen kontak** | Impor CSV, label/grup, pencarian, status opt-in, ekspor CSV |
| **Template** | Menarik daftar template dari WhatsApp Manager berikut status persetujuannya; hanya template `APPROVED` yang bisa dikirim |
| **Antrean & kecepatan** | Pengiriman diatur per menit, otomatis mencoba ulang saat kena rate limit, bisa dijeda/dilanjutkan |
| **Pengaman** | Batas pesan per 24 jam, wajib opt-in, uji coba ke satu nomor sebelum kirim massal |
| **Webhook** | Menerima status `sent`/`delivered`/`read`/`failed` dan balasan pelanggan, dengan verifikasi tanda tangan Meta |
| **Kotak masuk** | Membaca balasan pelanggan dan membalas teks bebas selama jendela 24 jam masih terbuka |
| **Opt-out otomatis** | Balasan "STOP" / "BERHENTI" langsung menandai kontak berhenti berlangganan |
| **Laporan** | Statistik per kampanye, rincian per nomor, penyebab kegagalan, unduh CSV |
| **Multi-pengguna** | Peran Admin (semua akses) dan Staf (kirim & kelola kontak, tanpa ubah pengaturan) |
| **Penjadwalan** | Broadcast bisa dijadwalkan untuk waktu tertentu |

---

## Cara menjalankan di komputer sendiri (untuk mencoba)

Syarat: **Node.js versi 20 atau lebih baru** ([unduh di sini](https://nodejs.org)).

```bash
# 1. Masuk ke folder aplikasi
cd webpesan

# 2. Pasang komponen yang dibutuhkan (sekali saja)
npm install

# 3. Siapkan file konfigurasi
cp .env.example .env

# 4. Jalankan
npm start
```

Buka `http://localhost:3000` di browser. Halaman pertama akan meminta kamu
membuat **akun admin pertama**. Setelah itu buka menu **Panduan** di dalam
aplikasi dan ikuti langkah 1 sampai 7.

> Catatan: di komputer lokal, **webhook belum bisa aktif** karena Meta hanya
> mengirim data ke alamat HTTPS publik. Broadcast tetap bisa dikirim, hanya saja
> status "diterima"/"dibaca" dan balasan pelanggan belum masuk. Untuk itu
> aplikasi perlu dipasang di server (lihat bagian berikutnya).

---

## Cara memasang di server (supaya webhook jalan)

> **Memakai hosting Hostinger (hPanel)?** Ikuti panduan khusus di
> [`DEPLOY-HOSTINGER.md`](DEPLOY-HOSTINGER.md) — caranya lewat panel, tanpa SSH.
> Bagian di bawah ini untuk VPS atau server dengan akses SSH.

Yang dibutuhkan: satu VPS kecil (RAM 1 GB sudah cukup) dan satu subdomain,
contoh `crm.cintadakwah.or.id`, yang sudah diarahkan ke IP server.

### 1. Siapkan server

```bash
# Login ke server lewat SSH, lalu:
sudo apt update && sudo apt install -y nodejs npm nginx git
node -v      # pastikan v20 atau lebih baru
```

Kalau versi Node terlalu lama:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

### 2. Pasang aplikasi

```bash
cd /var/www
sudo git clone <URL-REPOSITORI-INI> webpesan
cd webpesan
sudo npm install --omit=dev
sudo cp .env.example .env
```

Buka `.env` (`sudo nano .env`) dan isi minimal:

```ini
PORT=3000
PUBLIC_URL=https://crm.cintadakwah.or.id
ENCRYPTION_KEY=<hasil perintah di bawah>
```

Buat kunci enkripsi:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. Jalankan otomatis (systemd)

```bash
sudo tee /etc/systemd/system/webpesan.service > /dev/null <<'EOF'
[Unit]
Description=CRM Cinta Dakwah - WhatsApp Broadcast
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/webpesan
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

sudo chown -R www-data:www-data /var/www/webpesan
sudo systemctl daemon-reload
sudo systemctl enable --now webpesan
sudo systemctl status webpesan     # pastikan "active (running)"
```

### 4. Pasang Nginx + HTTPS

```bash
sudo tee /etc/nginx/sites-available/webpesan > /dev/null <<'EOF'
server {
    listen 80;
    server_name crm.cintadakwah.or.id;

    client_max_body_size 25M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF

sudo ln -s /etc/nginx/sites-available/webpesan /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# Pasang sertifikat HTTPS gratis
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d crm.cintadakwah.or.id
```

Setelah ini `https://crm.cintadakwah.or.id` sudah bisa dibuka, dan URL webhook
`https://crm.cintadakwah.or.id/webhook` siap didaftarkan ke Meta (caranya ada
di menu **Panduan** langkah 4 di dalam aplikasi).

---

## Isi file `.env`

| Nama | Wajib | Keterangan |
|---|---|---|
| `PORT` | tidak | Port aplikasi, default `3000` |
| `PUBLIC_URL` | ya (di server) | Alamat publik aplikasi, dipakai untuk menampilkan URL webhook dan mengaktifkan cookie `Secure` |
| `ENCRYPTION_KEY` | ya (di server) | Kunci untuk mengenkripsi Access Token di database. Kalau kosong, dibuat otomatis di `data/keyfile` |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | tidak | Kalau diisi, akun admin dibuat otomatis saat pertama jalan |
| `DATA_DIR` | tidak | Lokasi database, default folder `data/` |
| `WA_*` | tidak | Nilai awal kredensial WhatsApp. Lebih mudah diisi lewat halaman Pengaturan |

Kredensial WhatsApp **tidak harus** ditulis di `.env` — semuanya bisa diisi dari
halaman **Pengaturan** dan disimpan terenkripsi di database.

---

## Perawatan

**Cadangkan database** (berisi kontak, riwayat, dan pengaturan):

```bash
sudo systemctl stop webpesan
sudo tar czf ~/crm-cinta-dakwah-backup-$(date +%F).tar.gz -C /var/www/webpesan data
sudo systemctl start webpesan
```

> Simpan juga `ENCRYPTION_KEY` dari `.env` bersama cadangan. Tanpa kunci itu,
> Access Token di database tidak bisa dibaca lagi (tinggal isi ulang lewat
> halaman Pengaturan).

**Memperbarui aplikasi:** kirim berkas ZIP versi baru ke server, lalu jalankan
skrip pembaru. Skrip ini mencadangkan data lebih dulu, memasang versi baru,
menghidupkan ulang aplikasi, dan memastikan aplikasi menjawab dengan benar.

```bash
# dari komputer sendiri
scp versi-baru.zip root@IP_SERVER:/root/

# lalu di dalam server
bash /var/www/crm-app/scripts/perbarui.sh /root/versi-baru.zip
```

Folder `data/` dan berkas `.env` tidak pernah disentuh oleh skrip ini.
Kalau aplikasi gagal hidup, skrip menampilkan lokasi cadangan dan perintah
untuk melihat penyebabnya.

**Lupa kata sandi admin:**

```bash
cd /var/www/webpesan
sudo -u www-data node scripts/reset-admin.js admin@perusahaan.id KataSandiBaru123
```

**Melihat catatan aplikasi:**

```bash
sudo journalctl -u webpesan -f
```

---

## Struktur folder

```
webpesan/
├── server.js                 # titik masuk aplikasi
├── src/
│   ├── config.js             # membaca .env
│   ├── db.js                 # struktur database SQLite
│   ├── crypto.js             # enkripsi token & hashing kata sandi
│   ├── settings.js           # pengaturan aplikasi
│   ├── auth.js               # login, sesi, peran pengguna
│   ├── phone.js              # normalisasi nomor (08xx -> 62xx)
│   ├── csv.js                # baca/tulis CSV
│   ├── whatsapp.js           # klien WhatsApp Cloud API
│   ├── template-engine.js    # deteksi & pengisian variabel template
│   ├── audience.js           # pemilihan penerima
│   ├── queue.js              # mesin antrean pengiriman
│   ├── webhook.js            # penerima webhook Meta
│   └── routes/               # endpoint API
├── public/                   # tampilan web (HTML, CSS, JavaScript)
├── scripts/reset-admin.js    # atur ulang kata sandi admin
├── contoh-kontak.csv         # contoh format impor kontak
└── data/                     # database SQLite (dibuat otomatis)
```

---

## Catatan teknis penting

- **Versi Graph API** default `v23.0` dan bisa diganti dari halaman Pengaturan
  tanpa mengubah kode. Meta merilis versi baru secara berkala dan menonaktifkan
  versi lama setelah ± 2 tahun; kalau muncul error "unsupported version",
  ganti angkanya sesuai versi terbaru di dashboard Meta.
- **Webhook field** yang perlu dicentang di Meta adalah `messages` — field ini
  mencakup pesan masuk sekaligus perubahan status pengiriman. Tambahan opsional:
  `message_template_status_update` untuk memantau persetujuan template.
- **Keamanan webhook** diperiksa dengan tanda tangan `X-Hub-Signature-256`
  memakai App Secret. Selama App Secret belum diisi, webhook tetap diterima
  tetapi ditandai "tidak terverifikasi" pada catatan di halaman Pengaturan.
- **Jendela 24 jam**: pesan teks bebas hanya boleh dikirim dalam 24 jam sejak
  pesan terakhir dari pelanggan. Di luar itu wajib memakai template. Aturan ini
  sudah diberlakukan otomatis oleh aplikasi.
- **Batas pengiriman** mengikuti messaging limit nomor kamu di Meta. Isi angkanya
  di halaman Pengaturan supaya aplikasi menjeda kampanye sebelum batas terlampaui.

---

## Lisensi

Bebas dipakai dan dimodifikasi untuk kebutuhan internal.
