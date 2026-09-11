/* Halaman Riwayat Broadcast: daftar kampanye + detail hasil pengiriman per nomor. */
(function () {
  'use strict';
  const { h, api, fmtTanggal, fmtAngka, fmtNomor, labelStatus } = window.App;

  function hentikanPengulang() {
    App.bersihkanTimer();
  }

  function barisStatistik(s) {
    const item = (judul, nilai, warna) => h('div', { class: 'statistik' },
      h('div', { class: 'judul', text: judul }),
      h('div', { class: 'angka', style: warna ? `color:${warna}` : null, text: fmtAngka(nilai) }));
    return h('div', { class: 'grid-statistik' },
      item('Total', s.total),
      item('Menunggu', s.pending),
      item('Terkirim', s.terkirim, 'var(--biru)'),
      item('Diterima', s.delivered + s.read, 'var(--hijau)'),
      item('Dibaca', s.read, 'var(--hijau)'),
      item('Gagal', s.failed, s.failed ? 'var(--merah)' : null));
  }

  // ------------------------------------------------------------- Daftar
  window.App.views.kampanye = async function kampanyeView(konten) {
    hentikanPengulang();

    async function muatUlang() {
      const data = await api('/api/campaigns');
      gambar(data.campaigns);
    }

    function gambar(campaigns) {
      konten.innerHTML = '';
      konten.appendChild(h('div', { class: 'antara' },
        h('h1', { text: 'Riwayat Broadcast' }),
        h('a', { class: 'tombol', href: '#/broadcast', text: '+ Buat broadcast baru' })));

      if (campaigns.length === 0) {
        konten.appendChild(h('div', { class: 'panel' }, h('div', { class: 'pesan-kosong' },
          h('p', { text: 'Belum ada broadcast yang dibuat.' }),
          h('a', { class: 'tombol', href: '#/broadcast', text: 'Buat broadcast pertama' }))));
        return;
      }

      const tbody = h('tbody');
      for (const c of campaigns) {
        const s = c.stats;
        tbody.appendChild(h('tr', {},
          h('td', {}, h('a', { href: '#/kampanye/' + c.id, text: c.name }),
            h('div', { class: 'kecil', text: `${c.template_name} (${c.template_language})` })),
          h('td', {}, labelStatus(c.status)),
          h('td', { text: fmtAngka(s.total) }),
          h('td', { text: fmtAngka(s.terkirim) }),
          h('td', { text: fmtAngka(s.delivered + s.read) }),
          h('td', {}, s.failed ? h('span', { class: 'label merah', text: fmtAngka(s.failed) }) : h('span', { class: 'kecil', text: '0' })),
          h('td', { class: 'kecil', text: fmtTanggal(c.created_at) }),
          h('td', {}, h('a', { class: 'tombol sekunder kecil-btn', href: '#/kampanye/' + c.id, text: 'Detail' }))));
      }

      konten.appendChild(h('div', { class: 'panel' }, h('div', { class: 'tabel-gulir' },
        h('table', {},
          h('thead', {}, h('tr', {},
            h('th', { text: 'Nama' }), h('th', { text: 'Status' }), h('th', { text: 'Total' }),
            h('th', { text: 'Terkirim' }), h('th', { text: 'Diterima' }), h('th', { text: 'Gagal' }),
            h('th', { text: 'Dibuat' }), h('th', { text: '' }))),
          tbody))));
    }

    App.muat(konten);
    await muatUlang();
    App.pasangTimer(() => { muatUlang().catch(() => {}); }, 10000);
  };

  // ------------------------------------------------------------- Detail
  window.App.views.kampanyeDetail = async function kampanyeDetail(konten, params, id) {
    hentikanPengulang();
    let filterStatus = '';
    let halaman = 1;

    async function muatUlang() {
      const [detail, pesan] = await Promise.all([
        api('/api/campaigns/' + id),
        api(`/api/campaigns/${id}/messages?status=${filterStatus}&page=${halaman}&limit=50`),
      ]);
      gambar(detail.campaign, pesan);
    }

    async function aksi(nama, konfirmasiPesan) {
      if (konfirmasiPesan) {
        const ya = await App.konfirmasi(konfirmasiPesan, 'Konfirmasi', 'Ya, lanjutkan');
        if (!ya) return;
      }
      await api(`/api/campaigns/${id}/${nama}`, { method: 'POST' });
      App.sukses('Perintah dijalankan.');
      if (nama === 'delete') { location.hash = '#/kampanye'; return; }
      muatUlang();
    }

    function gambar(c, pesan) {
      konten.innerHTML = '';
      konten.appendChild(h('div', { class: 'antara' },
        h('div', {}, h('h1', { text: c.name }),
          h('div', { class: 'kecil', text: `Template: ${c.template_name} (${c.template_language}) • Dibuat ${fmtTanggal(c.created_at)} oleh ${c.creator_name || '-'}` })),
        h('a', { class: 'tombol sekunder', href: '#/kampanye', text: '‹ Kembali ke daftar' })));

      if (c.last_error) konten.appendChild(h('div', { class: 'peringatan' }, h('strong', { text: 'Kampanye dijeda: ' }), c.last_error));
      if (c.status === 'scheduled') konten.appendChild(h('div', { class: 'info', text: `Dijadwalkan mulai: ${fmtTanggal(c.scheduled_at)} (waktu server, UTC).` }));

      const tombol = h('div', { class: 'baris', style: 'gap:.5rem;margin-bottom:1rem' }, labelStatus(c.status));
      if (['running'].includes(c.status)) tombol.appendChild(h('button', { type: 'button', class: 'sekunder', text: '⏸ Jeda', onclick: () => aksi('pause') }));
      if (['paused', 'draft', 'scheduled'].includes(c.status)) tombol.appendChild(h('button', { type: 'button', text: '▶ Lanjutkan', onclick: () => aksi('resume') }));
      if (!['done', 'canceled'].includes(c.status)) {
        tombol.appendChild(h('button', {
          type: 'button', class: 'bahaya', text: '✕ Batalkan sisa antrean',
          onclick: () => aksi('cancel', 'Batalkan semua pesan yang belum terkirim? Pesan yang sudah terkirim tidak terpengaruh.'),
        }));
      }
      if (c.stats.failed > 0) {
        tombol.appendChild(h('button', {
          type: 'button', class: 'sekunder', text: `🔁 Ulangi ${c.stats.failed} pesan gagal`,
          onclick: () => aksi('retry-failed', `Kirim ulang ${c.stats.failed} pesan yang gagal?`),
        }));
      }
      tombol.appendChild(h('a', { class: 'tombol sekunder', href: `/api/campaigns/${id}/export`, text: '⬇ Unduh laporan CSV' }));
      if (c.stats.failed > 0) {
        tombol.appendChild(h('button', {
          type: 'button', class: 'sekunder', text: '🧹 Bersihkan nomor tidak aktif',
          onclick: () => dialogBersihkan(id, muatUlang),
        }));
      }
      tombol.appendChild(h('button', {
        type: 'button', class: 'bahaya', text: '🗑 Hapus riwayat',
        onclick: () => aksi('delete', 'Hapus kampanye ini beserta seluruh riwayat pengirimannya?'),
      }));
      konten.appendChild(tombol);

      konten.appendChild(barisStatistik(c.stats));

      // Rincian penyebab kegagalan, supaya jelas apa yang harus diperbaiki.
      if ((c.penyebabGagal || []).length) {
        const tbodyGagal = h('tbody');
        for (const g of c.penyebabGagal) {
          tbodyGagal.appendChild(h('tr', {},
            h('td', {}, h('strong', { text: fmtAngka(g.jumlah) })),
            h('td', {}, h('strong', { text: g.judul }),
              h('div', { class: 'kecil', text: 'Kode ' + g.kode }),
              h('div', { class: 'kecil', style: 'margin-top:.2rem', text: g.saran }))));
        }
        konten.appendChild(h('div', { class: 'panel' },
          h('h3', { text: 'Kenapa pesan gagal' }),
          h('div', { class: 'tabel-gulir' }, h('table', {},
            h('thead', {}, h('tr', {}, h('th', { text: 'Jumlah' }), h('th', { text: 'Penyebab & saran' }))),
            tbodyGagal))));
      }

      const pilih = h('select', {},
        h('option', { value: '', selected: filterStatus === '', text: 'Semua status' }),
        ['pending', 'sent', 'delivered', 'read', 'failed', 'canceled'].map((s) =>
          h('option', { value: s, selected: filterStatus === s, text: App.labelStatus(s).textContent })));
      pilih.addEventListener('change', () => { filterStatus = pilih.value; halaman = 1; muatUlang(); });

      const tbody = h('tbody');
      for (const m of pesan.messages) {
        tbody.appendChild(h('tr', {},
          h('td', {}, h('strong', { text: m.contact_name || '(tanpa nama)' }), h('div', { class: 'kecil', text: fmtNomor(m.phone) })),
          h('td', {}, labelStatus(m.status)),
          h('td', { class: 'kecil', text: fmtTanggal(m.sent_at) }),
          h('td', { class: 'kecil', text: m.read_at ? fmtTanggal(m.read_at) : (m.delivered_at ? fmtTanggal(m.delivered_at) : '-') }),
          h('td', { class: 'kecil' }, m.error_detail
            ? h('span', { style: 'color:var(--merah)', text: `[${m.error_code || '-'}] ${m.error_detail}` })
            : h('span', { text: (m.body_preview || '').slice(0, 90) }))));
      }

      konten.appendChild(h('div', { class: 'panel' },
        h('div', { class: 'antara' }, h('h3', { text: 'Rincian per penerima' }), h('div', { style: 'width:200px' }, pilih)),
        h('div', { class: 'tabel-gulir' }, h('table', {},
          h('thead', {}, h('tr', {},
            h('th', { text: 'Penerima' }), h('th', { text: 'Status' }), h('th', { text: 'Waktu kirim' }),
            h('th', { text: 'Diterima/Dibaca' }), h('th', { text: 'Isi / Kesalahan' }))),
          tbody)),
        h('div', { class: 'antara', style: 'margin-top:.8rem' },
          h('span', { class: 'kecil', text: `Total ${fmtAngka(pesan.total)} pesan - halaman ${pesan.page} dari ${pesan.pages}` }),
          h('div', { class: 'baris', style: 'gap:.4rem' },
            h('button', { type: 'button', class: 'sekunder kecil-btn', disabled: pesan.page <= 1, text: '‹ Sebelumnya', onclick: () => { halaman -= 1; muatUlang(); } }),
            h('button', { type: 'button', class: 'sekunder kecil-btn', disabled: pesan.page >= pesan.pages, text: 'Berikutnya ›', onclick: () => { halaman += 1; muatUlang(); } })))));
    }

    App.muat(konten);
    await muatUlang();
    App.pasangTimer(() => { muatUlang().catch(() => {}); }, 5000);
  };

  /**
   * Menandai nomor yang terbukti tidak aktif supaya tidak ikut dikirimi lagi.
   * Ditampilkan hitungannya dulu sebelum benar-benar diterapkan.
   */
  function dialogBersihkan(idKampanye, muatUlang) {
    const hanyaMati = h('input', { type: 'checkbox', checked: true });
    const hasil = h('div', { style: 'margin-top:.8rem' });

    const isi = h('div', {},
      h('div', { class: 'info' },
        'Nomor yang gagal dengan alasan ', h('strong', { text: 'tidak terdaftar di WhatsApp' }),
        ' hanya membuang kuota harian dan menurunkan kualitas nomor pengirim. ',
        'Nomor seperti ini akan ditandai berhenti berlangganan dan diberi label ',
        h('code', { text: 'nomor-tidak-aktif' }), '. Datanya tidak dihapus, jadi tetap bisa ditinjau kapan saja.'),
      h('label', { class: 'inline' }, hanyaMati, 'Hanya nomor yang tidak terdaftar di WhatsApp (disarankan)'),
      h('div', { class: 'kecil', text: 'Kalau dimatikan, semua kegagalan ikut ditandai termasuk yang sifatnya sementara seperti gangguan jaringan. Biasanya tidak disarankan.' }),
      hasil);

    async function hitung() {
      hasil.innerHTML = '';
      hasil.appendChild(h('div', { class: 'kecil', text: 'Menghitung…' }));
      const r = await api('/api/contacts/bersihkan-gagal', {
        method: 'POST',
        body: { campaignId: idKampanye, hanyaTidakTerdaftar: hanyaMati.checked, terapkan: false },
      });
      hasil.innerHTML = '';
      if (r.jumlah === 0) {
        hasil.appendChild(h('div', { class: 'sukses', text: 'Tidak ada nomor yang perlu dibersihkan dari kampanye ini.' }));
        return;
      }
      hasil.appendChild(h('div', { class: 'peringatan' },
        h('strong', { text: `${fmtAngka(r.jumlah)} nomor akan ditandai tidak aktif.` })));
      const tbody = h('tbody');
      for (const c of r.contoh) {
        tbody.appendChild(h('tr', {},
          h('td', { text: c.name || '(tanpa nama)' }),
          h('td', { text: fmtNomor(c.phone) }),
          h('td', { class: 'kecil', text: c.sebab || '-' })));
      }
      hasil.appendChild(h('div', { class: 'tabel-gulir' }, h('table', {}, tbody)));
      if (r.jumlah > r.contoh.length) {
        hasil.appendChild(h('div', { class: 'kecil', text: `…dan ${fmtAngka(r.jumlah - r.contoh.length)} nomor lainnya.` }));
      }
    }
    hanyaMati.addEventListener('change', () => hitung().catch((e) => App.galat(e.message)));

    App.dialog({
      judul: 'Bersihkan nomor tidak aktif',
      isi,
      lebar: true,
      tombolUtama: 'Tandai tidak aktif',
      onSimpan: async () => {
        const r = await api('/api/contacts/bersihkan-gagal', {
          method: 'POST',
          body: { campaignId: idKampanye, hanyaTidakTerdaftar: hanyaMati.checked, terapkan: true },
        });
        App.sukses(`${r.diubah} nomor ditandai tidak aktif dan tidak akan ikut broadcast berikutnya.`);
        muatUlang();
      },
    });
    hitung().catch((e) => App.galat(e.message));
  }

  window.App.hentikanPengulangKampanye = hentikanPengulang;
})();
