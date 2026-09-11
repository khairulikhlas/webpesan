/* Halaman Dashboard: ringkasan angka, grafik 7 hari, dan pengingat konfigurasi. */
(function () {
  'use strict';
  const { h, api, fmtAngka, fmtTanggal } = window.App;

  window.App.views.dashboard = async function dashboard(konten) {
    App.muat(konten);
    const data = await api('/api/stats/dashboard');
    konten.innerHTML = '';

    konten.appendChild(h('h1', { text: 'Dashboard' }));

    if (!data.readiness.ready) {
      konten.appendChild(h('div', { class: 'peringatan' },
        h('strong', { text: 'Aplikasi belum terhubung ke WhatsApp. ' }),
        'Isi Phone Number ID dan Access Token di menu ',
        h('a', { href: '#/pengaturan', text: 'Pengaturan' }),
        '. Bingung caranya? Buka ',
        h('a', { href: '#/panduan', text: 'Panduan langkah demi langkah' }), '.'));
    }

    if (data.daily.limit > 0 && data.daily.used >= data.daily.limit * 0.8) {
      const r = data.daily.rincian || {};
      konten.appendChild(h('div', { class: 'peringatan' },
        h('div', {}, h('strong', {
          text: `Pemakaian 24 jam terakhir: ${fmtAngka(data.daily.used)} kontak dari batas ${fmtAngka(data.daily.limit)}.`,
        })),
        h('div', { class: 'kecil', style: 'margin-top:.3rem' },
          `Dihitung dari kontak unik yang dikirimi template (${fmtAngka(r.pesan_template || 0)} pesan template ke `
          + `${fmtAngka(r.kontak_template || 0)} kontak). Balasan kamu di Kotak Masuk sebanyak `
          + `${fmtAngka(r.balasan || 0)} pesan tidak ikut dihitung, sesuai aturan Meta.`),
        h('div', { class: 'kecil', style: 'margin-top:.3rem' },
          'Kalau batas nomormu di Meta memang lebih tinggi, naikkan "Batas harian" di Pengaturan.')));
    }

    const kartu = (judul, angka, catatan, warna) => h('div', { class: 'statistik' },
      h('div', { class: 'judul', text: judul }),
      h('div', { class: 'angka', style: warna ? `color:${warna}` : null, text: fmtAngka(angka) }),
      catatan ? h('div', { class: 'kecil', text: catatan }) : null);

    const persen = (a, b) => (b > 0 ? Math.round((a / b) * 100) + '%' : '0%');

    konten.appendChild(h('div', { class: 'grid-statistik' },
      kartu('Kontak aktif', data.contacts.opt_in, `dari total ${fmtAngka(data.contacts.total)} kontak`),
      kartu('Pesan terkirim', data.messages.terkirim, `${persen(data.messages.terkirim, data.messages.total)} dari semua pesan`),
      kartu('Diterima HP', data.messages.diterima, persen(data.messages.diterima, data.messages.terkirim) + ' dari terkirim'),
      kartu('Dibaca', data.messages.dibaca, persen(data.messages.dibaca, data.messages.terkirim) + ' dari terkirim'),
      kartu('Gagal', data.messages.gagal, 'perlu diperiksa', data.messages.gagal ? 'var(--merah)' : null),
      kartu('Dalam antrean', data.messages.menunggu, `${data.campaigns.running} broadcast berjalan`)));

    // Grafik batang 7 hari terakhir
    const grafik = h('div', { class: 'panel' }, h('h3', { text: 'Aktivitas 7 hari terakhir' }));
    if (data.chart.length === 0) {
      grafik.appendChild(h('div', { class: 'pesan-kosong', text: 'Belum ada pesan yang dikirim.' }));
    } else {
      const maks = Math.max(...data.chart.map((d) => d.total), 1);
      grafik.appendChild(h('div', { class: 'grafik' },
        data.chart.map((d) => h('div', { class: 'batang', title: `${d.tanggal}: ${d.total} pesan, ${d.gagal} gagal` },
          h('div', { class: 'kecil', text: fmtAngka(d.total) }),
          h('div', { class: 'isi', style: `height:${Math.max(2, (d.total / maks) * 100)}%` }),
          h('div', { class: 'tanggal', text: String(d.tanggal).slice(5) })))));
    }
    konten.appendChild(grafik);

    const kiri = h('div', { class: 'kolom' });
    kiri.appendChild((() => {
      const p = h('div', { class: 'panel' }, h('h3', { text: 'Status koneksi' }));
      const baris = (nama, ok, catatan) => h('div', { class: 'antara', style: 'padding:.3rem 0;border-bottom:1px solid var(--garis)' },
        h('span', { text: nama }),
        h('span', {}, h('span', { class: 'label ' + (ok ? 'hijau' : 'merah'), text: ok ? 'Siap' : 'Belum diisi' }),
          catatan ? h('span', { class: 'kecil', text: ' ' + catatan }) : null));
      p.appendChild(baris('Phone Number ID', data.readiness.phone_number_id));
      p.appendChild(baris('Access Token', data.readiness.access_token));
      p.appendChild(baris('WhatsApp Business Account ID', data.readiness.business_account_id));
      p.appendChild(baris('App Secret (keamanan webhook)', data.readiness.app_secret));
      p.appendChild(h('div', { class: 'kecil', style: 'margin-top:.6rem' },
        data.lastWebhook
          ? `Webhook terakhir diterima: ${fmtTanggal(data.lastWebhook.received_at)} (${data.lastWebhook.ok ? 'valid' : 'ditolak: ' + data.lastWebhook.note})`
          : 'Belum pernah menerima webhook dari Meta. Status "diterima" dan "dibaca" baru muncul setelah webhook aktif.'));
      return p;
    })());

    const kanan = h('div', { class: 'kolom' });
    const panelGagal = h('div', { class: 'panel' }, h('h3', { text: 'Penyebab kegagalan terbanyak' }));
    if (data.topErrors.length === 0) {
      panelGagal.appendChild(h('div', { class: 'pesan-kosong', text: 'Belum ada pesan gagal. Bagus!' }));
    } else {
      const tabel = h('table', {}, h('thead', {}, h('tr', {}, h('th', { text: 'Kode' }), h('th', { text: 'Keterangan' }), h('th', { text: 'Jumlah' }))));
      const tbody = h('tbody');
      for (const e of data.topErrors) {
        tbody.appendChild(h('tr', {}, h('td', { text: e.kode }), h('td', { text: e.pesan || '-' }), h('td', { text: fmtAngka(e.jumlah) })));
      }
      tabel.appendChild(tbody);
      panelGagal.appendChild(h('div', { class: 'tabel-gulir' }, tabel));
    }
    kanan.appendChild(panelGagal);

    konten.appendChild(h('div', { class: 'baris' }, kiri, kanan));
    App.state.unread = data.unread;
    App.perbaruiLencana(data.unread);
  };
})();
