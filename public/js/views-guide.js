/* Halaman Panduan: langkah demi langkah menghubungkan aplikasi ini ke WhatsApp Cloud API. */
(function () {
  'use strict';
  const { h, api } = window.App;

  const ERROR_UMUM = [
    ['131026', 'Pesan tidak bisa dikirim', 'Nomor tujuan tidak terdaftar di WhatsApp, atau nomor salah ketik. Periksa formatnya (62xxx, bukan 08xxx).'],
    ['131047', 'Perlu template baru', 'Sudah lewat 24 jam sejak pelanggan terakhir membalas. Kirim pakai template, bukan teks bebas.'],
    ['131049', 'Dibatasi demi kesehatan ekosistem', 'Meta membatasi jumlah pesan marketing ke pengguna tersebut hari ini. Kurangi frekuensi promosi.'],
    ['130429', 'Terlalu cepat (rate limit)', 'Turunkan "kecepatan kirim" di halaman broadcast. Aplikasi ini otomatis mencoba ulang.'],
    ['132000', 'Jumlah variabel tidak cocok', 'Jumlah variabel yang diisi tidak sama dengan yang ada di template. Sinkronkan ulang template lalu isi ulang variabelnya.'],
    ['132001', 'Template tidak ditemukan', 'Nama atau kode bahasa template salah. Tekan "Sinkronkan template" di menu Template.'],
    ['132015', 'Template dijeda Meta', 'Kualitas template rendah karena banyak yang memblokir. Perbaiki isi template di WhatsApp Manager.'],
    ['190', 'Token kadaluarsa', 'Access Token tidak berlaku lagi. Buat System User Access Token permanen (langkah 3 di panduan ini).'],
    ['100', 'Parameter salah', 'Biasanya Phone Number ID salah, atau versi Graph API tidak didukung. Periksa halaman Pengaturan.'],
    ['80007', 'Melebihi batas kirim', 'Batas pesan (messaging limit) nomor kamu tercapai. Tunggu 24 jam atau naikkan tier dengan menjaga kualitas nomor.'],
  ];

  window.App.views.panduan = async function panduanView(konten) {
    let webhookUrl = location.origin + '/webhook';
    let verifyToken = '(lihat halaman Pengaturan)';
    try {
      const data = await api('/api/settings');
      webhookUrl = data.settings.webhook_url;
      verifyToken = data.settings.verify_token;
    } catch { /* biarkan nilai bawaan */ }

    konten.innerHTML = '';
    konten.appendChild(h('h1', { text: 'Panduan Lengkap' }));
    konten.appendChild(h('p', { class: 'kecil', text: 'Ikuti urut dari atas ke bawah. Sekali selesai, tidak perlu diulang lagi.' }));

    const bagian = (judul, isi) => h('div', { class: 'panel panduan' }, h('h3', { text: judul }), isi);

    konten.appendChild(bagian('Langkah 0 — Yang harus sudah kamu punya', h('div', {},
      h('ul', {},
        h('li', { text: 'Akun Meta Business + WhatsApp Business Account (sudah kamu punya).' }),
        h('li', { text: 'Nomor WhatsApp yang sudah terdaftar dan aktif di WhatsApp Manager (sudah).' }),
        h('li', { text: 'Metode pembayaran sudah diatur (sudah).' }),
        h('li', {}, h('strong', { text: 'Sebuah domain/subdomain dengan HTTPS' }), ' untuk memasang aplikasi ini, contoh: pesan.namadomainmu.com. Ini wajib karena Meta hanya mengirim webhook ke alamat HTTPS.')))));

    konten.appendChild(bagian('Langkah 1 — Buat aplikasi di Meta for Developers', h('div', {},
      h('ol', {},
        h('li', {}, 'Buka ', h('a', { href: 'https://developers.facebook.com/apps', target: '_blank', rel: 'noopener', text: 'developers.facebook.com/apps' }), ' lalu tekan ', h('strong', { text: 'Create App' }), '.'),
        h('li', {}, 'Pilih tipe ', h('strong', { text: 'Business' }), ', beri nama bebas (contoh: "Broadcast Internal"), lalu hubungkan ke Business Portfolio kamu.'),
        h('li', {}, 'Di dalam aplikasi, tekan ', h('strong', { text: 'Add Product → WhatsApp → Set up' }), '.'),
        h('li', {}, 'Kamu akan sampai di halaman ', h('strong', { text: 'API Setup' }), '. Di sana ada tiga hal yang kita butuhkan: Phone Number ID, WhatsApp Business Account ID, dan token sementara.')))));

    konten.appendChild(bagian('Langkah 2 — Salin Phone Number ID & WABA ID', h('div', {},
      h('ol', {},
        h('li', {}, 'Masih di halaman ', h('strong', { text: 'API Setup' }), ', pilih nomor bisnis kamu di bagian "From".'),
        h('li', {}, 'Di bawah nomor itu tertulis ', h('strong', { text: 'Phone number ID' }), ' (deretan angka panjang). Salin.'),
        h('li', {}, 'Di sebelahnya ada ', h('strong', { text: 'WhatsApp Business Account ID' }), '. Salin juga.'),
        h('li', {}, 'Tempel keduanya di menu ', h('a', { href: '#/pengaturan', text: 'Pengaturan' }), ' aplikasi ini.')),
      h('div', { class: 'peringatan', text: 'Catatan: Phone Number ID BUKAN nomor telepon. Kalau kamu menempel "628123..." di kolom itu, pengiriman pasti gagal dengan kode 100.' }))));

    konten.appendChild(bagian('Langkah 3 — Buat Access Token permanen (System User)', h('div', {},
      h('p', { text: 'Token sementara di halaman API Setup hanya hidup 24 jam. Untuk aplikasi yang jalan terus, buat System User Token seperti ini:' }),
      h('ol', {},
        h('li', {}, 'Buka ', h('a', { href: 'https://business.facebook.com/settings', target: '_blank', rel: 'noopener', text: 'business.facebook.com/settings' }), ' → menu ', h('strong', { text: 'Users → System Users' }), '.'),
        h('li', {}, 'Tekan ', h('strong', { text: 'Add' }), ', beri nama (contoh: "Integrasi Broadcast"), pilih peran ', h('strong', { text: 'Admin' }), '.'),
        h('li', {}, 'Pilih system user tadi → ', h('strong', { text: 'Add Assets' }), ' → tab ', h('strong', { text: 'Apps' }), ' → pilih aplikasi dari Langkah 1 → aktifkan ', h('strong', { text: 'Full control (Manage app)' }), '.'),
        h('li', {}, 'Masih di Add Assets → tab ', h('strong', { text: 'WhatsApp Accounts' }), ' → pilih WABA kamu → aktifkan ', h('strong', { text: 'Full control' }), '.'),
        h('li', {}, 'Tekan ', h('strong', { text: 'Generate New Token' }), ' → pilih aplikasi kamu → centang izin ', h('code', { text: 'whatsapp_business_messaging' }), ' dan ', h('code', { text: 'whatsapp_business_management' }), ' → pilih masa berlaku ', h('strong', { text: 'Never' }), '.'),
        h('li', {}, 'Salin token yang muncul (hanya ditampilkan sekali!) dan tempel di menu ', h('a', { href: '#/pengaturan', text: 'Pengaturan' }), '.'),
        h('li', {}, 'Terakhir, tekan tombol ', h('strong', { text: 'Uji koneksi ke WhatsApp' }), ' di halaman Pengaturan. Kalau muncul nama & nomor bisnismu, berarti sudah benar.')))));

    konten.appendChild(bagian('Langkah 4 — Pasang webhook (supaya status & balasan masuk)', h('div', {},
      h('p', {}, 'Inilah bagian yang tadi disebut Meta "belum berlangganan". Aplikasi ini sudah menyediakan endpoint-nya, kamu tinggal mendaftarkannya.'),
      h('div', { class: 'salin-baris', style: 'margin-bottom:.5rem' },
        h('input', { type: 'text', readonly: true, value: webhookUrl }),
        h('button', { type: 'button', class: 'sekunder', text: 'Salin URL', onclick: () => App.salinTeks(webhookUrl) })),
      h('div', { class: 'salin-baris', style: 'margin-bottom:.8rem' },
        h('input', { type: 'text', readonly: true, value: verifyToken }),
        h('button', { type: 'button', class: 'sekunder', text: 'Salin token', onclick: () => App.salinTeks(verifyToken) })),
      h('ol', {},
        h('li', {}, 'Di App Dashboard Meta, buka ', h('strong', { text: 'WhatsApp → Configuration' }), '.'),
        h('li', {}, 'Di bagian Webhook tekan ', h('strong', { text: 'Edit' }), '.'),
        h('li', {}, 'Isi ', h('strong', { text: 'Callback URL' }), ' dengan URL di atas, dan ', h('strong', { text: 'Verify token' }), ' dengan token di atas.'),
        h('li', {}, 'Tekan ', h('strong', { text: 'Verify and save' }), '. Kalau gagal, berarti aplikasi ini belum bisa diakses dari internet lewat HTTPS.'),
        h('li', {}, 'Setelah tersimpan, tekan ', h('strong', { text: 'Manage' }), ' lalu centang (Subscribe) field ', h('strong', { text: 'messages' }), '. Field ini mencakup pesan masuk sekaligus status terkirim/dibaca.'),
        h('li', {}, 'Opsional: centang juga ', h('code', { text: 'message_template_status_update' }), ' supaya status persetujuan template ikut terpantau.')),
      h('div', { class: 'info' }, 'Cek hasilnya di bagian ', h('strong', { text: 'Catatan webhook terakhir' }), ' pada halaman Pengaturan. Kalau ada baris bertanda "Valid", webhook sudah jalan.'))));

    konten.appendChild(bagian('Langkah 5 — Buat template pesan', h('div', {},
      h('ol', {},
        h('li', {}, 'Buka ', h('a', { href: 'https://business.facebook.com/wa/manage/message-templates/', target: '_blank', rel: 'noopener', text: 'WhatsApp Manager → Manage templates' }), ' → ', h('strong', { text: 'Create template' }), '.'),
        h('li', {}, 'Pilih kategori: ', h('strong', { text: 'Marketing' }), ' untuk promosi, ', h('strong', { text: 'Utility' }), ' untuk notifikasi transaksi (lebih murah & jarang ditolak).'),
        h('li', {}, 'Tulis isi pesan. Untuk bagian yang berbeda tiap orang, pakai variabel ', h('code', { text: '{{1}}' }), ', ', h('code', { text: '{{2}}' }), ' dan seterusnya. Contoh: ', h('em', { text: 'Halo {{1}}, pesanan {{2}} sudah dikirim.' })),
        h('li', { text: 'Tunggu status berubah menjadi Approved (biasanya beberapa menit sampai 24 jam).' }),
        h('li', {}, 'Kembali ke menu ', h('a', { href: '#/template', text: 'Template' }), ' di aplikasi ini, tekan ', h('strong', { text: 'Sinkronkan' }), '.')),
      h('div', { class: 'peringatan', text: 'Template yang isinya terlalu "jualan keras", mengandung janji berlebihan, atau menyalin merek lain berisiko ditolak. Tulis sewajarnya dan selalu sediakan cara berhenti (contoh: "Balas STOP untuk berhenti").' }))));

    konten.appendChild(bagian('Langkah 6 — Masukkan kontak (dan pastikan opt-in)', h('div', {},
      h('ol', {},
        h('li', {}, 'Buka menu ', h('a', { href: '#/kontak', text: 'Kontak' }), ' → ', h('strong', { text: 'Impor CSV' }), '.'),
        h('li', {}, 'Format file: baris pertama nama kolom. Contoh:'),
        h('pre', { class: 'kode', text: 'nama,nomor,kota\nBudi Santoso,081234567890,Jakarta\nSiti Aminah,+6285712345678,Bandung' }),
        h('li', { text: 'Kolom di luar nama/nomor/email/label (contoh "kota") otomatis tersimpan dan bisa dipakai sebagai isi variabel template.' }),
        h('li', {}, h('strong', { text: 'Penting: ' }), 'hanya masukkan nomor yang benar-benar pernah memberi izin dihubungi. Nomor yang tidak opt-in akan banyak memblokir, dan kualitas nomor bisnismu turun sampai diblokir Meta.')))));

    konten.appendChild(bagian('Langkah 7 — Kirim broadcast', h('div', {},
      h('ol', {},
        h('li', {}, 'Buka menu ', h('a', { href: '#/broadcast', text: 'Buat Broadcast' }), '.'),
        h('li', { text: 'Pilih template → isi variabel → pilih penerima → periksa hasil akhirnya.' }),
        h('li', {}, h('strong', { text: 'Selalu kirim uji coba dulu' }), ' ke nomor sendiri sebelum kirim massal.'),
        h('li', { text: 'Tekan Kirim. Progresnya bisa dipantau di menu Riwayat Broadcast, dan laporannya bisa diunduh sebagai CSV.' })))));

    const tbody = h('tbody');
    for (const [kode, judul, solusi] of ERROR_UMUM) {
      tbody.appendChild(h('tr', {},
        h('td', {}, h('code', { text: kode })),
        h('td', {}, h('strong', { text: judul })),
        h('td', { text: solusi })));
    }
    konten.appendChild(bagian('Kalau ada error — arti kode dari WhatsApp', h('div', { class: 'tabel-gulir' },
      h('table', {}, h('thead', {}, h('tr', {}, h('th', { text: 'Kode' }), h('th', { text: 'Arti' }), h('th', { text: 'Solusi' }))), tbody))));

    konten.appendChild(bagian('Aturan penting yang wajib diingat', h('ul', {},
      h('li', {}, h('strong', { text: 'Template wajib untuk broadcast. ' }), 'Pesan teks bebas hanya boleh dikirim dalam 24 jam setelah pelanggan mengirim pesan ke kamu.'),
      h('li', {}, h('strong', { text: 'Messaging limit. ' }), 'Nomor baru biasanya mulai dari 250 pelanggan unik per 24 jam, lalu naik bertahap (1.000 → 10.000 → 100.000) kalau kualitas nomor terjaga.'),
      h('li', {}, h('strong', { text: 'Kualitas nomor. ' }), 'Kalau banyak yang memblokir atau melaporkan, kualitas turun dan batas kirim ikut turun. Pantau di WhatsApp Manager → Insights.'),
      h('li', {}, h('strong', { text: 'Biaya. ' }), 'Meta menagih per pesan template terkirim, tarifnya berbeda per kategori (Marketing paling mahal) dan per negara. Cek tagihan di Business Settings.'),
      h('li', {}, h('strong', { text: 'Opt-out. ' }), 'Aplikasi ini otomatis menandai kontak berhenti kalau mereka membalas "STOP" atau "BERHENTI".'))));
  };
})();
