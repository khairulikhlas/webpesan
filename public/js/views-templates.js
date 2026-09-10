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

  /* ---------------------------------------------------------------------
     Formulir membuat template baru langsung dari web
     --------------------------------------------------------------------- */
  function dialogBuatTemplate(muatUlang) {
    let mediaTerpilih = null;

    const nama = h('input', { type: 'text', placeholder: 'contoh: info_kajian_pekanan' });
    const bahasa = h('select', {},
      h('option', { value: 'id', text: 'Indonesia (id)' }),
      h('option', { value: 'en_US', text: 'Inggris (en_US)' }));
    const kategori = h('select', {},
      h('option', { value: 'MARKETING', text: 'Marketing — promosi, ajakan, info kegiatan' }),
      h('option', { value: 'UTILITY', text: 'Utility — konfirmasi, notifikasi transaksi (lebih murah)' }),
      h('option', { value: 'AUTHENTICATION', text: 'Authentication — kode verifikasi' }));

    const jenisHeader = h('select', {},
      h('option', { value: 'none', text: 'Tanpa header' }),
      h('option', { value: 'text', text: 'Judul teks' }),
      h('option', { value: 'image', text: 'Gambar' }));
    const headerTeks = h('input', { type: 'text', placeholder: 'contoh: Kajian Pekanan {{1}}', maxlength: '60' });
    const headerContoh = h('input', { type: 'text', placeholder: 'contoh isi variabel header, misal: Ahad Pagi' });
    const headerGambarInfo = h('div', { class: 'kecil', text: 'Belum ada gambar contoh dipilih.' });
    const tombolGambar = h('button', {
      type: 'button', class: 'sekunder', text: '🖼️ Pilih gambar contoh',
      onclick: () => App.galeriMedia((url, m) => {
        mediaTerpilih = m;
        headerGambarInfo.innerHTML = '';
        headerGambarInfo.appendChild(h('div', {},
          h('img', { src: url, alt: 'Contoh header', style: 'max-width:180px;border-radius:8px;border:1px solid var(--garis);margin-top:.4rem' }),
          h('div', { class: 'kecil', text: m.original_name || m.id })));
      }),
    });

    const bungkusHeaderTeks = h('div', { hidden: true },
      h('label', { text: 'Judul header (maks 60 karakter)' }), headerTeks,
      h('label', { text: 'Contoh isi variabel header (kalau ada {{1}})' }), headerContoh);
    const bungkusHeaderGambar = h('div', { hidden: true },
      h('div', { class: 'kecil', style: 'margin-bottom:.4rem' },
        'Meta butuh satu gambar contoh untuk meninjau template. Gambar asli saat broadcast tetap bisa diganti-ganti nanti.'),
      tombolGambar, headerGambarInfo);

    const isiPesan = h('textarea', {
      placeholder: 'Assalamualaikum {{1}}, kajian pekan ini insyaAllah dilaksanakan {{2}}. Barakallahu fiikum.',
      style: 'min-height:120px',
    });
    const wadahContoh = h('div');
    const footer = h('input', { type: 'text', placeholder: 'contoh: Balas STOP untuk berhenti menerima pesan', maxlength: '60' });

    const wadahTombol = h('div');
    const daftarTombol = [];

    function gambarTombol() {
      wadahTombol.innerHTML = '';
      daftarTombol.forEach((t, i) => {
        const jenis = h('select', {},
          h('option', { value: 'QUICK_REPLY', selected: t.type === 'QUICK_REPLY', text: 'Balasan cepat' }),
          h('option', { value: 'URL', selected: t.type === 'URL', text: 'Buka tautan' }));
        const teks = h('input', { type: 'text', value: t.text, placeholder: 'Tulisan tombol', maxlength: '25' });
        const url = h('input', { type: 'text', value: t.url || '', placeholder: 'https://cintadakwah.or.id/...', hidden: t.type !== 'URL' });
        const sinkron = () => {
          t.type = jenis.value; t.text = teks.value; t.url = url.value;
          url.hidden = jenis.value !== 'URL';
        };
        [jenis, teks, url].forEach((el) => { el.addEventListener('input', sinkron); el.addEventListener('change', sinkron); });
        wadahTombol.appendChild(h('div', { class: 'baris', style: 'gap:.4rem;margin-bottom:.4rem;align-items:flex-start' },
          h('div', { style: 'flex:0 0 140px' }, jenis),
          h('div', { class: 'kolom' }, teks, url),
          h('button', { type: 'button', class: 'sekunder kecil-btn', text: '✕', onclick: () => { daftarTombol.splice(i, 1); gambarTombol(); } })));
      });
    }

    /** Menyesuaikan jumlah kolom contoh dengan jumlah variabel di isi pesan. */
    function segarkanContoh() {
      const ditemukan = [...new Set((isiPesan.value.match(/\{\{\s*\d+\s*\}\}/g) || [])
        .map((v) => Number(v.replace(/\D/g, ''))))].sort((a, b) => a - b);
      const lama = {};
      wadahContoh.querySelectorAll('input[data-var]').forEach((el) => { lama[el.dataset.var] = el.value; });
      wadahContoh.innerHTML = '';
      if (ditemukan.length === 0) return;
      wadahContoh.appendChild(h('label', { text: 'Contoh isi tiap variabel (wajib, dipakai Meta untuk meninjau)' }));
      for (const n of ditemukan) {
        wadahContoh.appendChild(h('input', {
          type: 'text', 'data-var': String(n), value: lama[n] || '',
          placeholder: `Contoh untuk {{${n}}}`, style: 'margin-bottom:.35rem',
        }));
      }
    }
    isiPesan.addEventListener('input', segarkanContoh);

    jenisHeader.addEventListener('change', () => {
      bungkusHeaderTeks.hidden = jenisHeader.value !== 'text';
      bungkusHeaderGambar.hidden = jenisHeader.value !== 'image';
    });

    const isi = h('div', {},
      h('div', { class: 'info' },
        'Template yang dibuat di sini langsung dikirim ke Meta untuk ditinjau. ',
        'Statusnya mulai dari ', h('strong', { text: 'Menunggu review' }),
        ', dan baru bisa dipakai broadcast setelah berubah menjadi ', h('strong', { text: 'Disetujui' }), '.'),
      h('label', { text: 'Nama template *' }), nama,
      h('div', { class: 'kecil', text: 'Huruf kecil, angka, dan garis bawah saja. Tidak boleh spasi atau huruf besar.' }),
      h('div', { class: 'baris' },
        h('div', { class: 'kolom' }, h('label', { text: 'Bahasa' }), bahasa),
        h('div', { class: 'kolom' }, h('label', { text: 'Kategori' }), kategori)),
      h('label', { text: 'Header' }), jenisHeader, bungkusHeaderTeks, bungkusHeaderGambar,
      h('label', { text: 'Isi pesan *' }), isiPesan,
      h('div', { class: 'kecil' },
        'Untuk bagian yang berbeda tiap orang, tulis ', h('code', { text: '{{1}}' }), ', ', h('code', { text: '{{2}}' }),
        ' dan seterusnya, berurutan tanpa lompat.'),
      wadahContoh,
      h('label', { text: 'Footer (opsional, maks 60 karakter)' }), footer,
      h('label', { text: 'Tombol (opsional)' }),
      wadahTombol,
      h('button', {
        type: 'button', class: 'sekunder kecil-btn', text: '+ Tambah tombol',
        onclick: () => { if (daftarTombol.length < 10) { daftarTombol.push({ type: 'QUICK_REPLY', text: '', url: '' }); gambarTombol(); } },
      }),
      h('div', { class: 'peringatan', style: 'margin-top:1rem' },
        h('strong', { text: 'Tips agar tidak ditolak Meta: ' }),
        'tulis sewajarnya, hindari janji berlebihan dan huruf kapital semua, ',
        'jangan menyalin merek pihak lain, dan sertakan cara berhenti di footer.'));

    App.dialog({
      judul: 'Buat Template Baru',
      isi,
      lebar: true,
      tombolUtama: 'Kirim ke Meta',
      onSimpan: async (kotak) => {
        const contoh = [...kotak.querySelectorAll('input[data-var]')].map((el) => el.value.trim());
        const badan = {
          name: nama.value.trim().toLowerCase(),
          language: bahasa.value,
          category: kategori.value,
          bodyText: isiPesan.value.trim(),
          bodyExamples: contoh,
          footerText: footer.value.trim(),
          buttons: daftarTombol.filter((t) => t.text.trim()),
          header: { type: jenisHeader.value },
        };
        if (jenisHeader.value === 'text') {
          badan.header.text = headerTeks.value.trim();
          badan.header.example = headerContoh.value.trim();
        } else if (jenisHeader.value === 'image') {
          if (!mediaTerpilih) { App.galat('Pilih dulu gambar contoh untuk header.'); return false; }
          badan.header.mediaId = mediaTerpilih.id;
        }

        const hasil = await App.api('/api/templates', { method: 'POST', body: badan });
        App.sukses(hasil.pesan || 'Template terkirim ke Meta.');
        muatUlang();
      },
    });
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
        h('div', { class: 'baris', style: 'gap:.5rem' },
        h('button', { type: 'button', text: '+ Buat template baru', onclick: () => dialogBuatTemplate(() => muatUlang(true)) }),
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
        }))));

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

        const aksi = h('div', { class: 'baris', style: 'gap:.4rem;margin-top:.5rem' });
        if (String(t.status).toUpperCase() === 'APPROVED') {
          aksi.appendChild(h('button', {
            type: 'button', class: 'kecil-btn',
            text: '📢 Pakai untuk broadcast',
            onclick: () => { location.hash = `#/broadcast?template=${encodeURIComponent(t.name)}&bahasa=${encodeURIComponent(t.language)}`; },
          }));
        }
        aksi.appendChild(h('button', {
          type: 'button', class: 'bahaya kecil-btn', text: 'Hapus',
          onclick: async () => {
            const ya = await App.konfirmasi(
              `Hapus template "${t.name}" dari WhatsApp Manager? Broadcast baru dengan template ini tidak bisa lagi dikirim.`,
              'Hapus template', 'Ya, hapus');
            if (!ya) return;
            try {
              await api(`/api/templates/${encodeURIComponent(t.name)}/${encodeURIComponent(t.language)}`, { method: 'DELETE' });
              App.sukses('Template dihapus.');
              muatUlang(false);
            } catch (err) { App.galat(err.message); }
          },
        }));
        kartu.appendChild(aksi);
        grid.appendChild(kartu);
      }
      konten.appendChild(grid);
    }

    App.muat(konten);
    await muatUlang(false);
  };
})();
