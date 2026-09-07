/* Halaman Template: menampilkan template dari WhatsApp Manager dan status persetujuannya. */
(function () {
  'use strict';
  const { h, api, fmtTanggal, labelStatus } = window.App;

  function kartuPratinjau(t) {
    const isi = h('div', { class: 'gelembung' });
    if (t.preview.header) isi.appendChild(h('div', { class: 'judul-pesan', text: t.preview.header }));
    isi.appendChild(h('div', { text: t.preview.body || '(tanpa isi)' }));
    if (t.preview.footer) isi.appendChild(h('div', { class: 'kaki-pesan', text: t.preview.footer }));
    for (const b of t.preview.buttons || []) {
      isi.appendChild(h('div', { class: 'tombol-pesan', text: b.text || '(tombol)' }));
    }
    return h('div', { class: 'pratinjau-wa' }, isi);
  }

  window.App.views.template = async function templateView(konten) {
    async function muatUlang(sinkron = false) {
      App.muat(konten, sinkron ? 'Mengambil template dari WhatsApp Manager…' : 'Memuat…');
      const data = sinkron
        ? await api('/api/templates/sync', { method: 'POST' })
        : await api('/api/templates');
      gambar(data.templates);
      if (sinkron) App.sukses(`${data.count} template berhasil disinkronkan.`);
    }

    function gambar(templates) {
      konten.innerHTML = '';
      konten.appendChild(h('div', { class: 'antara' },
        h('h1', { text: 'Template Pesan' }),
        h('button', {
          type: 'button',
          text: '🔄 Sinkronkan dari WhatsApp Manager',
          onclick: async () => {
            try { await muatUlang(true); } catch (err) {
              konten.innerHTML = '';
              gambar([]);
              App.galat(err.message);
              if (err.data?.hint) App.toast(err.data.hint);
            }
          },
        })));

      konten.appendChild(h('div', { class: 'info' },
        'Template dibuat di ', h('strong', { text: 'WhatsApp Manager → Manage templates' }),
        ' milik Meta, lalu ditinjau 1-24 jam. Setelah statusnya ',
        h('strong', { text: 'Disetujui (APPROVED)' }), ', tekan tombol Sinkronkan di atas supaya muncul di sini dan bisa dipakai broadcast.'));

      if (templates.length === 0) {
        konten.appendChild(h('div', { class: 'panel' }, h('div', { class: 'pesan-kosong' },
          h('p', { text: 'Belum ada template tersimpan.' }),
          h('p', { class: 'kecil', text: 'Tekan "Sinkronkan dari WhatsApp Manager" untuk mengambil daftarnya.' }))));
        return;
      }

      const grid = h('div', { class: 'baris' });
      for (const t of templates) {
        const kartu = h('div', { class: 'panel kolom', style: 'flex:1 1 340px' },
          h('div', { class: 'antara' },
            h('h3', { text: t.name }),
            labelStatus(String(t.status).toUpperCase())),
          h('div', { class: 'kecil', text: `Bahasa: ${t.language} • Kategori: ${t.category || '-'} • Variabel: ${t.slots.length}` }),
          kartuPratinjau(t),
          h('div', { class: 'kecil', style: 'margin-top:.5rem', text: 'Disinkronkan: ' + fmtTanggal(t.synced_at) }));

        if (String(t.status).toUpperCase() === 'APPROVED') {
          kartu.appendChild(h('button', {
            type: 'button', class: 'sekunder kecil-btn', style: 'margin-top:.5rem',
            text: '📢 Pakai untuk broadcast',
            onclick: () => { location.hash = `#/broadcast?template=${encodeURIComponent(t.name)}&bahasa=${encodeURIComponent(t.language)}`; },
          }));
        }
        grid.appendChild(kartu);
      }
      konten.appendChild(grid);
    }

    App.muat(konten);
    await muatUlang(false);
  };
})();
