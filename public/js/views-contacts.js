/* Halaman Kontak: daftar, cari, tambah, ubah, impor CSV, label, opt-in. */
(function () {
  'use strict';
  const { h, api, fmtTanggal, fmtNomor, fmtAngka } = window.App;

  const filter = { search: '', tag: '', opt_in: '', page: 1, limit: 50 };
  let terpilih = new Set();

  function formKontak(kontak = {}) {
    return h('div', {},
      h('label', { for: 'k-nomor', text: 'Nomor WhatsApp *' }),
      h('input', { id: 'k-nomor', type: 'text', value: kontak.phone || '', placeholder: 'Contoh: 0812 3456 7890 atau +62812...' }),
      h('div', { class: 'kecil', text: 'Nomor 08xx otomatis diubah menjadi 62xx.' }),
      h('label', { for: 'k-nama', text: 'Nama' }),
      h('input', { id: 'k-nama', type: 'text', value: kontak.name || '', placeholder: 'Nama pelanggan' }),
      h('label', { for: 'k-email', text: 'Email (opsional)' }),
      h('input', { id: 'k-email', type: 'email', value: kontak.email || '' }),
      h('label', { for: 'k-tag', text: 'Label (pisahkan dengan koma)' }),
      h('input', { id: 'k-tag', type: 'text', value: kontak.tags || '', placeholder: 'pelanggan, jakarta' }),
      h('label', { for: 'k-catatan', text: 'Catatan' }),
      h('textarea', { id: 'k-catatan', style: 'min-height:60px' }, kontak.notes || ''),
      h('label', { class: 'inline', style: 'margin-top:.8rem' },
        h('input', { id: 'k-optin', type: 'checkbox', checked: kontak.opt_in === undefined ? true : !!kontak.opt_in }),
        'Sudah memberi izin (opt-in) menerima pesan'));
  }

  function ambilForm(kotak) {
    const v = (id) => kotak.querySelector('#' + id).value.trim();
    return {
      phone: v('k-nomor'),
      name: v('k-nama'),
      email: v('k-email'),
      tags: v('k-tag'),
      notes: v('k-catatan'),
      opt_in: kotak.querySelector('#k-optin').checked,
    };
  }

  function dialogTambah(muatUlang) {
    App.dialog({
      judul: 'Tambah kontak',
      isi: formKontak(),
      tombolUtama: 'Simpan kontak',
      onSimpan: async (kotak) => {
        await api('/api/contacts', { method: 'POST', body: ambilForm(kotak) });
        App.sukses('Kontak ditambahkan.');
        muatUlang();
      },
    });
  }

  function dialogUbah(kontak, muatUlang) {
    App.dialog({
      judul: 'Ubah kontak',
      isi: formKontak(kontak),
      tombolUtama: 'Simpan perubahan',
      onSimpan: async (kotak) => {
        await api('/api/contacts/' + kontak.id, { method: 'PATCH', body: ambilForm(kotak) });
        App.sukses('Kontak diperbarui.');
        muatUlang();
      },
    });
  }

  function dialogImpor(muatUlang) {
    const isi = h('div', {},
      h('div', { class: 'info' },
        h('strong', { text: 'Format file: ' }),
        'CSV dengan baris pertama berisi nama kolom. Kolom nomor boleh diberi nama ',
        h('code', { text: 'phone' }), ', ', h('code', { text: 'nomor' }), ', ', h('code', { text: 'no hp' }),
        ', atau ', h('code', { text: 'whatsapp' }), '. Kolom lain (misal ',
        h('code', { text: 'kota' }), ') otomatis tersimpan dan bisa dipakai sebagai isi variabel template.'),
      h('label', { for: 'i-file', text: 'Pilih file CSV' }),
      h('input', { id: 'i-file', type: 'file', accept: '.csv,text/csv,text/plain' }),
      h('div', { class: 'kecil', style: 'margin:.4rem 0' }, 'atau tempel isinya di bawah ini:'),
      h('textarea', { id: 'i-teks', placeholder: 'nama,nomor,kota\nBudi,08123456789,Jakarta' }),
      h('label', { for: 'i-tag', text: 'Tambahkan label untuk semua kontak dari file ini' }),
      h('input', { id: 'i-tag', type: 'text', placeholder: 'contoh: pelanggan-2026' }),
      h('label', { class: 'inline' }, h('input', { id: 'i-optin', type: 'checkbox', checked: true }),
        'Tandai semua sebagai sudah opt-in'),
      h('label', { class: 'inline' }, h('input', { id: 'i-update', type: 'checkbox', checked: true }),
        'Perbarui data kalau nomornya sudah ada'),
      h('div', { id: 'i-hasil' }));

    const { kotak } = App.dialog({
      judul: 'Impor kontak dari file CSV',
      isi,
      lebar: true,
      tombolUtama: 'Impor sekarang',
      onSimpan: async () => {
        const teks = kotak.querySelector('#i-teks').value.trim();
        if (!teks) { App.galat('Pilih file CSV dulu, atau tempel isinya.'); return false; }
        const hasil = await api('/api/contacts/import', {
          method: 'POST',
          body: {
            csv: teks,
            tags: kotak.querySelector('#i-tag').value,
            optIn: kotak.querySelector('#i-optin').checked,
            updateExisting: kotak.querySelector('#i-update').checked,
          },
        });
        const s = hasil.summary;
        App.sukses(`Impor selesai: ${s.created} baru, ${s.updated} diperbarui, ${s.skipped} dilewati.`);
        if (s.invalid.length) {
          App.toast(`Ada ${s.skipped} nomor tidak valid, contoh baris ${s.invalid.map((i) => i.baris).slice(0, 5).join(', ')}.`);
        }
        muatUlang();
      },
    });

    kotak.querySelector('#i-file').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        kotak.querySelector('#i-teks').value = String(reader.result || '');
        kotak.querySelector('#i-hasil').innerHTML = '';
        kotak.querySelector('#i-hasil').appendChild(h('div', { class: 'sukses', text: `File "${file.name}" terbaca. Tekan "Impor sekarang".` }));
      };
      reader.readAsText(file, 'utf-8');
    });
  }

  window.App.views.kontak = async function kontakView(konten) {
    async function muatUlang() {
      const params = new URLSearchParams({
        search: filter.search, tag: filter.tag, opt_in: filter.opt_in,
        page: String(filter.page), limit: String(filter.limit),
      });
      const [data, tagData] = await Promise.all([
        api('/api/contacts?' + params.toString()),
        api('/api/contacts/tags'),
      ]);
      gambar(data, tagData.tags);
    }

    function gambar(data, tags) {
      konten.innerHTML = '';
      konten.appendChild(h('div', { class: 'antara' },
        h('h1', { text: 'Kontak' }),
        h('div', { class: 'baris', style: 'gap:.5rem' },
          h('a', { class: 'tombol sekunder', href: '/api/contacts/export', text: '⬇ Unduh CSV' }),
          h('button', { type: 'button', class: 'sekunder', text: '⬆ Impor CSV', onclick: () => dialogImpor(muatUlang) }),
          h('button', { type: 'button', text: '+ Tambah kontak', onclick: () => dialogTambah(muatUlang) }))));

      // Penyaring
      const cari = h('input', { type: 'search', placeholder: 'Cari nama, nomor, email…', value: filter.search });
      cari.addEventListener('keydown', (e) => { if (e.key === 'Enter') { filter.search = cari.value; filter.page = 1; muatUlang(); } });
      const pilihTag = h('select', {}, h('option', { value: '', text: 'Semua label' }),
        tags.map((t) => h('option', { value: t.tag, selected: filter.tag === t.tag, text: `${t.tag} (${t.count})` })));
      pilihTag.addEventListener('change', () => { filter.tag = pilihTag.value; filter.page = 1; muatUlang(); });
      const pilihOpt = h('select', {},
        h('option', { value: '', text: 'Semua status izin' }),
        h('option', { value: '1', selected: filter.opt_in === '1', text: 'Hanya yang opt-in' }),
        h('option', { value: '0', selected: filter.opt_in === '0', text: 'Hanya yang berhenti' }));
      pilihOpt.addEventListener('change', () => { filter.opt_in = pilihOpt.value; filter.page = 1; muatUlang(); });

      konten.appendChild(h('div', { class: 'panel' },
        h('div', { class: 'baris' },
          h('div', { class: 'kolom' }, cari),
          h('div', { style: 'flex:0 0 200px' }, pilihTag),
          h('div', { style: 'flex:0 0 190px' }, pilihOpt),
          h('button', { type: 'button', class: 'sekunder', text: 'Cari', onclick: () => { filter.search = cari.value; filter.page = 1; muatUlang(); } }))));

      // Aksi massal
      const kotakAksi = h('div', { class: 'panel', hidden: terpilih.size === 0, id: 'aksi-massal' });
      function perbaruiAksi() {
        kotakAksi.hidden = terpilih.size === 0;
        kotakAksi.innerHTML = '';
        if (terpilih.size === 0) return;
        kotakAksi.appendChild(h('div', { class: 'antara' },
          h('strong', { text: `${terpilih.size} kontak dipilih` }),
          h('div', { class: 'baris', style: 'gap:.4rem' },
            h('button', { type: 'button', class: 'sekunder kecil-btn', text: 'Tandai opt-in', onclick: () => aksiMassal('opt_in') }),
            h('button', { type: 'button', class: 'sekunder kecil-btn', text: 'Tandai berhenti', onclick: () => aksiMassal('opt_out') }),
            h('button', { type: 'button', class: 'sekunder kecil-btn', text: 'Beri label', onclick: () => dialogLabel('add_tag') }),
            h('button', { type: 'button', class: 'sekunder kecil-btn', text: 'Hapus label', onclick: () => dialogLabel('remove_tag') }),
            h('button', { type: 'button', class: 'bahaya kecil-btn', text: 'Hapus kontak', onclick: () => aksiMassal('delete') }))));
      }
      async function aksiMassal(action) {
        if (action === 'delete') {
          const ya = await App.konfirmasi(`Hapus ${terpilih.size} kontak? Tindakan ini tidak bisa dibatalkan.`, 'Hapus kontak', 'Ya, hapus');
          if (!ya) return;
        }
        await api('/api/contacts/bulk', { method: 'POST', body: { action, ids: [...terpilih] } });
        App.sukses('Perubahan tersimpan.');
        terpilih = new Set();
        muatUlang();
      }
      function dialogLabel(action) {
        App.dialog({
          judul: action === 'add_tag' ? 'Beri label' : 'Hapus label',
          isi: h('div', {}, h('label', { for: 'l-tag', text: 'Nama label (boleh lebih dari satu, pisahkan koma)' }),
            h('input', { id: 'l-tag', type: 'text', placeholder: 'promo-natal' })),
          tombolUtama: 'Terapkan',
          onSimpan: async (kotak) => {
            const tag = kotak.querySelector('#l-tag').value.trim();
            if (!tag) { App.galat('Nama label belum diisi.'); return false; }
            await api('/api/contacts/bulk', { method: 'POST', body: { action, ids: [...terpilih], tag } });
            App.sukses('Label diperbarui.');
            terpilih = new Set();
            muatUlang();
          },
        });
      }
      perbaruiAksi();
      konten.appendChild(kotakAksi);

      // Tabel
      const panel = h('div', { class: 'panel' });
      if (data.contacts.length === 0) {
        panel.appendChild(h('div', { class: 'pesan-kosong' },
          h('p', { text: 'Belum ada kontak yang cocok.' }),
          h('button', { type: 'button', text: 'Impor dari CSV', onclick: () => dialogImpor(muatUlang) })));
      } else {
        const pilihSemua = h('input', { type: 'checkbox' });
        pilihSemua.addEventListener('change', () => {
          if (pilihSemua.checked) data.contacts.forEach((c) => terpilih.add(c.id));
          else data.contacts.forEach((c) => terpilih.delete(c.id));
          panel.querySelectorAll('input.pilih-kontak').forEach((cb) => { cb.checked = pilihSemua.checked; });
          perbaruiAksi();
        });

        const tbody = h('tbody');
        for (const c of data.contacts) {
          const cb = h('input', { type: 'checkbox', class: 'pilih-kontak', checked: terpilih.has(c.id) });
          cb.addEventListener('change', () => {
            if (cb.checked) terpilih.add(c.id); else terpilih.delete(c.id);
            perbaruiAksi();
          });
          tbody.appendChild(h('tr', {},
            h('td', {}, cb),
            h('td', {}, h('strong', { text: c.name || '(tanpa nama)' }),
              c.tags ? h('div', {}, String(c.tags).split(',').filter(Boolean).map((t) => h('span', { class: 'label', style: 'margin-right:.2rem', text: t }))) : null),
            h('td', { text: fmtNomor(c.phone) }),
            h('td', {}, h('span', { class: 'label ' + (c.opt_in ? 'hijau' : 'merah'), text: c.opt_in ? 'Opt-in' : 'Berhenti' })),
            h('td', { class: 'kecil', text: c.last_inbound_at ? fmtTanggal(c.last_inbound_at) : '-' }),
            h('td', {}, h('div', { class: 'baris', style: 'gap:.3rem' },
              h('button', { type: 'button', class: 'sekunder kecil-btn', text: 'Ubah', onclick: () => dialogUbah(c, muatUlang) }),
              h('button', {
                type: 'button', class: 'bahaya kecil-btn', text: 'Hapus',
                onclick: async () => {
                  const ya = await App.konfirmasi(`Hapus kontak ${c.name || c.phone}?`, 'Hapus kontak', 'Ya, hapus');
                  if (!ya) return;
                  await api('/api/contacts/' + c.id, { method: 'DELETE' });
                  App.sukses('Kontak dihapus.');
                  muatUlang();
                },
              })))));
        }

        panel.appendChild(h('div', { class: 'tabel-gulir' },
          h('table', {},
            h('thead', {}, h('tr', {},
              h('th', {}, pilihSemua), h('th', { text: 'Nama & label' }), h('th', { text: 'Nomor' }),
              h('th', { text: 'Izin' }), h('th', { text: 'Balasan terakhir' }), h('th', { text: 'Aksi' }))),
            tbody)));

        // Navigasi halaman
        panel.appendChild(h('div', { class: 'antara', style: 'margin-top:.8rem' },
          h('span', { class: 'kecil', text: `Total ${fmtAngka(data.total)} kontak - halaman ${data.page} dari ${data.pages}` }),
          h('div', { class: 'baris', style: 'gap:.4rem' },
            h('button', { type: 'button', class: 'sekunder kecil-btn', disabled: data.page <= 1, text: '‹ Sebelumnya', onclick: () => { filter.page -= 1; muatUlang(); } }),
            h('button', { type: 'button', class: 'sekunder kecil-btn', disabled: data.page >= data.pages, text: 'Berikutnya ›', onclick: () => { filter.page += 1; muatUlang(); } }))));
      }
      konten.appendChild(panel);
    }

    App.muat(konten);
    await muatUlang();
  };
})();
