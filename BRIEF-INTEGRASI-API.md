# Brief Integrasi: Mengirim Data Donatur ke CRM Cinta Dakwah

Dokumen ini untuk **pengembang/pengelola web pencatatan donatur**.
Tujuannya: setiap donatur yang dicatat di web tersebut otomatis masuk ke
CRM WhatsApp, supaya tim tidak memasukkan data dua kali.

---

## Ringkasan

| Hal | Keterangan |
|---|---|
| Alamat dasar | `https://crm.cintadakwah.or.id` |
| Cara masuk | Header `X-API-Key` berisi kunci dari halaman Pengaturan CRM |
| Format | JSON |
| Arah data | Web donatur **mengirim** ke CRM (CRM tidak menarik data) |

Kunci API diambil dari: CRM → **Pengaturan** → panel **"Sambungan ke sistem lain (API)"**.

> Kunci ini memberi izin menambah dan mengubah kontak. Simpan di berkas
> konfigurasi server, jangan ditulis di kode yang bisa dilihat publik, dan
> jangan dikirim lewat grup chat.

---

## 1. Menguji sambungan

```
GET /api/v1/ping
X-API-Key: <kunci>
```

Jawaban:
```json
{ "ok": true, "aplikasi": "CRM Cinta Dakwah", "waktu": "2026-09-11T08:00:00.000Z" }
```

Jalankan ini lebih dulu sebelum menulis kode lain.

---

## 2. Mengirim satu donatur

Panggil ini setiap kali ada donasi baru tercatat.

```
POST /api/v1/kontak
X-API-Key: <kunci>
Content-Type: application/json
```

```json
{
  "nomor": "081234567890",
  "nama": "Budi Santoso",
  "email": "budi@contoh.id",
  "label": ["donatur", "kurban-2026"],
  "attributes": {
    "kota": "Bandung",
    "donasi_terakhir": "2026-09-11",
    "program": "Kurban",
    "total_donasi": "1500000"
  }
}
```

Jawaban:
```json
{ "ok": true, "phone": "6281234567890", "tindakan": "dibuat", "id": 42 }
```

`tindakan` berisi `dibuat` untuk nomor baru, atau `diperbarui` untuk nomor
yang sudah ada.

### Penjelasan kolom

| Kolom | Wajib | Keterangan |
|---|---|---|
| `nomor` | ya | Boleh `08xx`, `62xx`, atau `+62xx`. Dirapikan otomatis |
| `nama` | tidak | Dipakai menyapa di isi pesan broadcast |
| `email` | tidak | |
| `label` | tidak | Array atau teks dipisah koma. Dipakai memilih penerima broadcast |
| `attributes` | tidak | Objek bebas. Nilainya bisa dipakai sebagai isi variabel template |
| `opt_in` | tidak | **Jangan dikirim** kecuali benar-benar perlu. Lihat catatan penting di bawah |

---

## 3. Mengirim banyak sekaligus

Untuk sinkronisasi berkala atau migrasi data awal. Maksimal **500 per panggilan**.

```
POST /api/v1/kontak/batch
```

```json
{
  "kontak": [
    { "nomor": "081111111111", "nama": "Donatur A", "label": "donatur" },
    { "nomor": "081222222222", "nama": "Donatur B", "label": "donatur" }
  ]
}
```

Jawaban:
```json
{
  "ok": true,
  "dibuat": 1,
  "diperbarui": 1,
  "gagal": 0,
  "rincian_gagal": []
}
```

Nomor yang tidak valid tidak menggagalkan seluruh kiriman, hanya dilaporkan
di `rincian_gagal`.

---

## 4. Memeriksa satu nomor

```
GET /api/v1/kontak/081234567890
```

```json
{
  "ok": true,
  "kontak": {
    "phone": "6281234567890",
    "name": "Budi Santoso",
    "tags": ["donatur", "kurban-2026"],
    "attributes": { "kota": "Bandung" },
    "opt_in": true,
    "last_inbound_at": "2026-09-10 07:28:00"
  }
}
```

---

## ⚠️ Catatan penting soal opt-in

CRM ini menandai kontak **berhenti berlangganan** ketika donatur membalas
"STOP" atau "BERHENTI" di WhatsApp. Itu bagian dari kepatuhan terhadap
aturan Meta, dan mengabaikannya membuat kualitas nomor WhatsApp lembaga turun
sampai berisiko diblokir.

Karena itu:

- **Jangan mengirim kolom `opt_in`** pada pemanggilan biasa. Kalau kolom itu
  tidak disertakan, status berhenti milik kontak lama tetap dihormati.
- Kontak baru otomatis dianggap opt-in, karena mereka memang baru berdonasi.
- Kirim `"opt_in": true` **hanya** bila donatur secara tegas meminta menerima
  kembali informasi dari lembaga.

---

## Kode contoh

### PHP

```php
function kirimDonaturKeCRM(array $donatur): array {
    $kunci = getenv('CRM_API_KEY');
    $ch = curl_init('https://crm.cintadakwah.or.id/api/v1/kontak');
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 15,
        CURLOPT_HTTPHEADER     => [
            'Content-Type: application/json',
            'X-API-Key: ' . $kunci,
        ],
        CURLOPT_POSTFIELDS => json_encode([
            'nomor'      => $donatur['no_hp'],
            'nama'       => $donatur['nama'],
            'label'      => ['donatur', $donatur['program']],
            'attributes' => [
                'kota'            => $donatur['kota'],
                'donasi_terakhir' => date('Y-m-d'),
                'program'         => $donatur['program'],
            ],
        ]),
    ]);
    $jawaban = curl_exec($ch);
    $kode    = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($kode !== 200) {
        error_log("Gagal kirim ke CRM (HTTP $kode): $jawaban");
        return ['ok' => false];
    }
    return json_decode($jawaban, true);
}
```

### JavaScript (Node.js)

```js
async function kirimDonaturKeCRM(donatur) {
  const res = await fetch('https://crm.cintadakwah.or.id/api/v1/kontak', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': process.env.CRM_API_KEY,
    },
    body: JSON.stringify({
      nomor: donatur.noHp,
      nama: donatur.nama,
      label: ['donatur', donatur.program],
      attributes: {
        kota: donatur.kota,
        donasi_terakhir: new Date().toISOString().slice(0, 10),
        program: donatur.program,
      },
    }),
  });
  if (!res.ok) throw new Error(`CRM menolak: ${res.status} ${await res.text()}`);
  return res.json();
}
```

### Python

```python
import os, requests

def kirim_donatur_ke_crm(donatur):
    res = requests.post(
        'https://crm.cintadakwah.or.id/api/v1/kontak',
        headers={'X-API-Key': os.environ['CRM_API_KEY']},
        json={
            'nomor': donatur['no_hp'],
            'nama': donatur['nama'],
            'label': ['donatur', donatur['program']],
            'attributes': {
                'kota': donatur.get('kota'),
                'donasi_terakhir': donatur['tanggal'],
                'program': donatur['program'],
            },
        },
        timeout=15,
    )
    res.raise_for_status()
    return res.json()
```

---

## Kode jawaban

| Kode | Arti | Tindakan |
|---|---|---|
| 200 | Berhasil | — |
| 400 | Data tidak sah, misalnya nomor tidak valid | Perbaiki data, jangan diulang apa adanya |
| 401 | Kunci API salah | Periksa nilai `X-API-Key` |
| 404 | Nomor tidak ditemukan (khusus GET) | — |
| 503 | API belum diaktifkan di CRM | Minta admin membuat kunci di halaman Pengaturan |
| 5xx | Gangguan sementara | Coba ulang beberapa saat lagi |

---

## Saran penerapan

1. **Jangan menggagalkan proses donasi** kalau pengiriman ke CRM bermasalah.
   Catat di log, lalu coba lagi belakangan. Donasi tetap yang utama.
2. **Panggil setelah donasi tersimpan**, bukan sebelumnya.
3. **Untuk data lama**, pakai endpoint batch. Kirim bertahap 500-an, dan
   sertakan label yang jelas seperti `donatur-lama` agar mudah dibedakan.
4. **Isi `attributes` seperlunya saja** — cukup yang akan dipakai di isi
   pesan broadcast, misalnya kota, program, atau tanggal donasi terakhir.
