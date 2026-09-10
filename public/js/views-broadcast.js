/* Halaman Buat Broadcast: proses 4 langkah dari pilih template sampai kirim. */
(function () {
  'use strict';
  const { h, api, fmtAngka } = window.App;

  const draf = {
    langkah: 1,
    template: null,
    mapping: {},
    audience: {
      type: 'all', tags: [], tagMode: 'any', ids: [], onlyOptIn: true,
      batas: 0, lewatiTemplateIni: true, lewatiHariTerakhir: 0,
    },
    nama: '',
    rate: 60,
    jadwal: '',
    pratinjau: null,
  };

  const FIELD_KONTAK = [
    { nilai: 'name', label: 'Nama kontak' },
    { nilai: 'phone', label: 'Nomor WhatsApp' },
    { nilai: 'email', label: 'Email' },
  ];

  function penunjukLangkah() {
    const judul = ['1. Pilih template', '2. Isi variabel', '3. Pilih penerima', '4. Periksa & kirim'];
    return h('div', { class: 'langkah' }, judul.map((t, i) => h('div', {
      class: draf.langkah === i + 1 ? 'aktif' : (draf.langkah > i + 1 ? 'selesai' : ''),
      text: t,
    })));
  }

  function gelembungPratinjau(contoh) {
    const isi = h('div', { class: 'gelembung' });
    if (contoh.header) isi.appendChild(h('div', { class: 'judul-pesan', text: contoh.header }));
    isi.appendChild(h('div', { text: contoh.body || '' }));
    if (contoh.footer) isi.appendChild(h('div', { class: 'kaki-pesan', text: contoh.footer }));
    for (const b of contoh.buttons || []) isi.appendChild(h('div', { class: 'tombol-pesan', text: b.text }));
    return h('div', { class: 'pratinjau-wa' }, isi);
  }

  // ---------------------------------------------------------------- Langkah 1
  async function langkah1(konten, gambar) {
    const data = await api('/api/templates');
    const disetujui = data.templates.filter((t) => String(t.status).toUpperCase() === 'APPROVED');

    const panel = h('div', { class: 'panel' }, h('h3', { text: 'Pilih template yang akan dikirim' }));
    if (disetujui.length === 0) {
      panel.appendChild(h('div', { class: 'peringatan' },
        'Belum ada template berstatus Disetujui. Buat template di WhatsApp Manager, tunggu disetujui Meta, lalu buka menu ',
        h('a', { href: '#/template', text: 'Template' }), ' dan tekan Sinkronkan.'));
      konten.appendChild(panel);
      return;
    }

    const daftar = h('div', { class: 'baris' });
    for (const t of disetujui) {
      const kartu = h('div', { class: 'panel kolom', style: 'flex:1 1 320px;cursor:pointer' },
        h('div', { class: 'antara' }, h('h3', { text: t.name }), h('span', { class: 'label hijau', text: 'Disetujui' })),
        h('div', { class: 'kecil', text: `${t.language} • ${t.category || '-'} • ${t.slots.length} variabel` }),
        gelembungPratinjau(t.preview));
      kartu.addEventListener('click', () => {
        draf.template = t;
        // Pakai isian terakhir yang pernah dipakai untuk template ini, supaya
        // alamat gambar dan teks tetap tidak perlu diketik ulang.
        draf.mapping = JSON.parse(JSON.stringify(t.defaults || {}));
        draf.nama = draf.nama || `${t.name} - ${new Date().toLocaleDateString('id-ID')}`;
        draf.langkah = 2;
        gambar();
      });
      daftar.appendChild(kartu);
    }
    panel.appendChild(daftar);
    konten.appendChild(panel);
  }

  // ---------------------------------------------------------------- Langkah 2
  function langkah2(konten, gambar) {
    const t = draf.template;
    const panel = h('div', { class: 'panel' },
      h('h3', { text: `Isi variabel untuk template "${t.name}"` }));

    // Tampilkan bentuk asli template supaya jelas {{1}} itu bagian yang mana.
    panel.appendChild(h('div', { class: 'kecil', text: 'Bentuk asli template:' }));
    panel.appendChild(gelembungPratinjau(t.preview));

    if (t.slots.length === 0) {
      panel.appendChild(h('div', { class: 'sukses', style: 'margin-top:.8rem', text: 'Template ini tidak punya variabel. Langsung lanjut ke pemilihan penerima.' }));
    } else {
      panel.appendChild(h('div', { class: 'info', style: 'margin-top:.8rem' },
        'Pilih ', h('strong', { text: '"Teks tetap"' }), ' kalau isinya sama untuk semua orang, atau ',
        h('strong', { text: '"Ambil dari data kontak"' }), ' supaya tiap orang menerima isi berbeda (contoh: namanya sendiri).'));
    }

    for (const slot of t.slots) {
      const nilaiAwal = draf.mapping[slot.key] || { source: 'static', value: '', fallback: '' };
      const kotak = h('div', { style: 'border:1px solid var(--garis);border-radius:10px;padding:.8rem;margin-bottom:.7rem' });
      kotak.appendChild(h('strong', { text: slot.label }));

      if (slot.kind === 'media') {
        kotak.appendChild(h('label', { text: 'Berkas untuk header' }));
        const input = h('input', { type: 'text', value: nilaiAwal.value, placeholder: 'https://crm.cintadakwah.or.id/media/…' });
        const simpan = () => { draf.mapping[slot.key] = { source: 'static', value: input.value.trim() }; };
        input.addEventListener('input', simpan);

        const pratinjauMedia = h('div', { style: 'margin-top:.5rem' });
        const segarkanPratinjau = () => {
          pratinjauMedia.innerHTML = '';
          const url = input.value.trim();
          if (url && /\.(jpg|jpeg|png)$/i.test(url)) {
            pratinjauMedia.appendChild(h('img', {
              src: url, alt: 'Pratinjau gambar header',
              style: 'max-width:220px;border-radius:10px;border:1px solid var(--garis)',
            }));
          }
        };
        input.addEventListener('input', segarkanPratinjau);

        kotak.appendChild(h('div', { class: 'baris', style: 'gap:.5rem' },
          h('div', { class: 'kolom' }, input),
          h('button', {
            type: 'button', class: 'sekunder', text: '🖼️ Galeri',
            onclick: () => App.galeriMedia((url) => {
              input.value = url;
              simpan();
              segarkanPratinjau();
              App.sukses('Berkas dipilih.');
            }),
          })));
        kotak.appendChild(h('div', { class: 'kecil' },
          'Tekan ', h('strong', { text: 'Galeri' }), ' untuk mengunggah gambar sekali saja. ',
          'Alamatnya otomatis diingat untuk broadcast berikutnya dengan template yang sama.'));
        kotak.appendChild(pratinjauMedia);
        segarkanPratinjau();
      } else {
        const pilihSumber = h('select', {},
          h('option', { value: 'static', selected: nilaiAwal.source === 'static', text: 'Teks tetap (sama untuk semua)' }),
          h('option', { value: 'field', selected: nilaiAwal.source === 'field', text: 'Ambil dari data kontak' }));

        const isiStatis = h('input', { type: 'text', value: nilaiAwal.source === 'static' ? nilaiAwal.value : '', placeholder: 'Contoh: Diskon 30%' });
        const pilihField = h('select', {}, FIELD_KONTAK.map((f) => h('option', { value: f.nilai, selected: nilaiAwal.value === f.nilai, text: f.label })),
          h('option', { value: '__lain', text: 'Kolom lain dari file CSV…' }));
        const fieldLain = h('input', { type: 'text', placeholder: 'Nama kolom persis seperti di file CSV, contoh: kota' });
        const cadangan = h('input', { type: 'text', value: nilaiAwal.fallback || '', placeholder: 'Contoh: Pelanggan' });

        const bungkusStatis = h('div', {}, h('label', { text: 'Isi teks' }), isiStatis);
        const bungkusField = h('div', {},
          h('label', { text: 'Ambil dari kolom' }), pilihField, fieldLain,
          h('label', { text: 'Kalau kolomnya kosong, pakai teks ini (wajib diisi)' }), cadangan);

        const sinkron = () => {
          const source = pilihSumber.value;
          bungkusStatis.hidden = source !== 'static';
          bungkusField.hidden = source !== 'field';
          const pakaiLain = pilihField.value === '__lain';
          fieldLain.hidden = !pakaiLain;
          draf.mapping[slot.key] = source === 'static'
            ? { source: 'static', value: isiStatis.value }
            : { source: 'field', value: pakaiLain ? fieldLain.value.trim() : pilihField.value, fallback: cadangan.value };
        };

        if (nilaiAwal.source === 'field' && !FIELD_KONTAK.some((f) => f.nilai === nilaiAwal.value)) {
          pilihField.value = '__lain';
          fieldLain.value = nilaiAwal.value;
        }

        [pilihSumber, isiStatis, pilihField, fieldLain, cadangan].forEach((el) => {
          el.addEventListener('input', sinkron);
          el.addEventListener('change', sinkron);
        });

        kotak.appendChild(h('label', { text: 'Sumber isi' }));
        kotak.appendChild(pilihSumber);
        kotak.appendChild(bungkusStatis);
        kotak.appendChild(bungkusField);
        sinkron();
      }
      panel.appendChild(kotak);
    }

    panel.appendChild(h('div', { class: 'baris', style: 'margin-top:1rem' },
      h('button', { type: 'button', class: 'sekunder', text: '‹ Kembali', onclick: () => { draf.langkah = 1; gambar(); } }),
      h('button', { type: 'button', text: 'Lanjut pilih penerima ›', onclick: () => { draf.langkah = 3; gambar(); } })));

    konten.appendChild(panel);
  }

  // ---------------------------------------------------------------- Langkah 3
  async function langkah3(konten, gambar) {
    const tagData = await api('/api/contacts/tags');
    const panel = h('div', { class: 'panel' }, h('h3', { text: 'Siapa yang menerima pesan ini?' }));

    const pilihJenis = h('select', {},
      h('option', { value: 'all', selected: draf.audience.type === 'all', text: 'Semua kontak' }),
      h('option', { value: 'tags', selected: draf.audience.type === 'tags', text: 'Kontak dengan label tertentu' }));

    const daftarTag = h('div', { style: 'display:flex;flex-wrap:wrap;gap:.5rem;margin-top:.4rem' });
    for (const t of tagData.tags) {
      const cb = h('input', { type: 'checkbox', checked: draf.audience.tags.includes(t.tag) });
      cb.addEventListener('change', () => {
        const set = new Set(draf.audience.tags);
        if (cb.checked) set.add(t.tag); else set.delete(t.tag);
        draf.audience.tags = [...set];
        hitung();
      });
      daftarTag.appendChild(h('label', { class: 'inline', style: 'font-weight:400' }, cb, `${t.tag} (${t.count})`));
    }
    if (tagData.tags.length === 0) {
      daftarTag.appendChild(h('span', { class: 'kecil', text: 'Belum ada label. Beri label di menu Kontak supaya bisa memilih kelompok penerima.' }));
    }

    const bungkusTag = h('div', {}, h('label', { text: 'Pilih label' }), daftarTag);
    const optIn = h('input', { type: 'checkbox', checked: draf.audience.onlyOptIn });
    optIn.addEventListener('change', () => { draf.audience.onlyOptIn = optIn.checked; hitung(); });

    // ---- Pengiriman bertahap untuk database besar ----
    const batas = h('input', { type: 'number', min: '0', value: String(draf.audience.batas || 0), placeholder: '0 = tanpa batas' });
    const lewatiTemplate = h('input', { type: 'checkbox', checked: draf.audience.lewatiTemplateIni !== false });
    const lewatiHari = h('input', { type: 'number', min: '0', value: String(draf.audience.lewatiHariTerakhir || 0) });
    [batas, lewatiHari].forEach((el) => el.addEventListener('change', () => hitung()));
    lewatiTemplate.addEventListener('change', () => hitung());

    const bertahap = h('div', { style: 'border:1px solid var(--garis);border-radius:10px;padding:.8rem;margin-top:1rem' },
      h('strong', { text: 'Pengiriman bertahap' }),
      h('div', { class: 'kecil', style: 'margin-bottom:.5rem' },
        'Berguna kalau jumlah kontak melebihi batas harian dari Meta. Sisa penerima otomatis terhitung untuk pengiriman berikutnya.'),
      h('label', { text: 'Kirim maksimal berapa orang kali ini' }), batas,
      h('div', { class: 'kecil', text: 'Isi 0 kalau ingin mengirim ke semua yang cocok. Isi 1000 kalau batas harianmu 1000.' }),
      h('label', { class: 'inline', style: 'margin-top:.7rem' }, lewatiTemplate,
        'Lewati kontak yang sudah pernah menerima template ini'),
      h('div', { class: 'kecil', text: 'Inilah yang membuat kamu tidak perlu mencatat manual siapa yang sudah dikirimi. Besok tinggal ulangi, yang sudah terkirim otomatis dilompati.' }),
      h('label', { text: 'Lewati yang sudah menerima broadcast apa pun dalam (hari)' }), lewatiHari,
      h('div', { class: 'kecil', text: 'Isi 0 untuk mematikan. Isi 7 supaya satu orang tidak menerima lebih dari sekali seminggu.' }));

    const jumlah = h('div', { class: 'info', text: 'Menghitung penerima…' });

    async function hitung() {
      bungkusTag.hidden = pilihJenis.value !== 'tags';
      draf.audience.type = pilihJenis.value;
      draf.audience.batas = Number(batas.value) || 0;
      draf.audience.lewatiTemplateIni = lewatiTemplate.checked;
      draf.audience.lewatiHariTerakhir = Number(lewatiHari.value) || 0;
      try {
        const hasil = await api('/api/campaigns/preview', {
          method: 'POST',
          body: {
            templateName: draf.template.name,
            language: draf.template.language,
            mapping: draf.mapping,
            audience: draf.audience,
          },
        });
        draf.pratinjau = hasil;
        const r = hasil.ringkasan || { cocok: hasil.recipients, dikirim: hasil.recipients, sisa: 0 };
        jumlah.innerHTML = '';
        jumlah.className = hasil.recipients > 0 ? 'sukses' : 'peringatan';
        if (hasil.recipients === 0) {
          jumlah.textContent = 'Tidak ada kontak yang cocok. Kemungkinan semuanya sudah pernah menerima template ini, atau baru saja dikirimi broadcast lain.';
        } else {
          jumlah.appendChild(h('div', {}, h('strong', { text: `${fmtAngka(r.dikirim)} kontak akan menerima pesan ini sekarang.` })));
          if (r.sisa > 0) {
            jumlah.appendChild(h('div', { class: 'kecil', style: 'margin-top:.3rem' },
              `Dari ${fmtAngka(r.cocok)} kontak yang cocok, sisa ${fmtAngka(r.sisa)} orang tertunda. `
              + 'Besok tinggal ulangi broadcast ini dengan pengaturan yang sama, dan yang sudah terkirim otomatis dilompati.'));
          }
        }
      } catch (err) {
        jumlah.className = 'galat';
        jumlah.textContent = err.message;
      }
    }

    pilihJenis.addEventListener('change', hitung);

    panel.appendChild(h('label', { text: 'Kelompok penerima' }));
    panel.appendChild(pilihJenis);
    panel.appendChild(bungkusTag);
    panel.appendChild(h('label', { class: 'inline', style: 'margin-top:.8rem' }, optIn,
      'Hanya kirim ke kontak yang sudah opt-in (sangat disarankan)'));
    panel.appendChild(bertahap);
    panel.appendChild(jumlah);
    panel.appendChild(h('div', { class: 'baris', style: 'margin-top:1rem' },
      h('button', { type: 'button', class: 'sekunder', text: '‹ Kembali', onclick: () => { draf.langkah = 2; gambar(); } }),
      h('button', { type: 'button', text: 'Lanjut periksa pesan ›', onclick: () => { draf.langkah = 4; gambar(); } })));

    konten.appendChild(panel);
    hitung();
  }

  // ---------------------------------------------------------------- Langkah 4
  async function langkah4(konten, gambar) {
    const hasil = await api('/api/campaigns/preview', {
      method: 'POST',
      body: {
        templateName: draf.template.name,
        language: draf.template.language,
        mapping: draf.mapping,
        audience: draf.audience,
      },
    });
    draf.pratinjau = hasil;

    const panel = h('div', { class: 'panel' }, h('h3', { text: 'Periksa sebelum dikirim' }));

    panel.appendChild(h('div', { class: 'baris' },
      h('div', { class: 'kolom' },
        h('label', { for: 'b-nama', text: 'Nama broadcast (untuk catatan internal)' }),
        h('input', { id: 'b-nama', type: 'text', value: draf.nama }),
        h('label', { for: 'b-rate', text: 'Kecepatan kirim (pesan per menit)' }),
        h('input', { id: 'b-rate', type: 'number', min: '1', max: '3000', value: String(draf.rate) }),
        h('div', { class: 'kecil', text: 'Untuk nomor baru, 30-60 pesan per menit lebih aman supaya kualitas nomor tetap terjaga.' }),
        h('label', { for: 'b-jadwal', text: 'Jadwalkan (kosongkan untuk kirim sekarang)' }),
        h('input', { id: 'b-jadwal', type: 'datetime-local', value: draf.jadwal })),
      h('div', { class: 'kolom' },
        h('div', { class: 'statistik' },
          h('div', { class: 'judul', text: 'Jumlah penerima' }),
          h('div', { class: 'angka', text: fmtAngka(hasil.recipients) }),
          h('div', { class: 'kecil', text: hasil.audienceLabel })),
        h('div', { class: 'kecil', style: 'margin-top:.6rem', text: `Terpakai dalam 24 jam terakhir: ${fmtAngka(hasil.sentLast24h)} dari batas ${fmtAngka(hasil.dailyLimit)} pesan.` }))));

    if (hasil.warnings.length) {
      panel.appendChild(h('div', { class: 'peringatan' },
        h('strong', { text: 'Perhatian: ada variabel yang kosong. ' }),
        'WhatsApp akan menolak pesan dengan variabel kosong. Isi teks cadangan di langkah 2.',
        h('ul', {}, hasil.warnings.map((w) => h('li', { text: `${w.label} — kosong pada ${w.count} kontak` })))));
    }

    if (hasil.samples.length) {
      const contoh = h('div', { class: 'baris' });
      for (const s of hasil.samples) {
        contoh.appendChild(h('div', { class: 'kolom', style: 'flex:1 1 280px' },
          h('div', { class: 'kecil', text: `Untuk ${s.name || '(tanpa nama)'} • +${s.phone}` }),
          gelembungPratinjau(s.preview)));
      }
      panel.appendChild(h('h4', { text: 'Contoh hasil akhir pesan' }));
      panel.appendChild(contoh);
    }

    // Kirim uji coba
    const nomorUji = h('input', { type: 'text', placeholder: 'Contoh: 08123456789 (nomor kamu sendiri)' });
    const tombolUji = h('button', {
      type: 'button', class: 'sekunder', text: '📨 Kirim uji coba',
      onclick: async () => {
        if (!nomorUji.value.trim()) { App.galat('Isi dulu nomor tujuan uji coba.'); return; }
        tombolUji.disabled = true;
        try {
          await api('/api/campaigns/test-send', {
            method: 'POST',
            body: {
              templateName: draf.template.name,
              language: draf.template.language,
              mapping: draf.mapping,
              phone: nomorUji.value.trim(),
            },
          });
          App.sukses('Pesan uji coba terkirim. Cek WhatsApp di nomor tersebut.');
        } catch (err) {
          App.galat(err.message);
        } finally {
          tombolUji.disabled = false;
        }
      },
    });
    panel.appendChild(h('div', { style: 'margin-top:1rem;border-top:1px solid var(--garis);padding-top:.8rem' },
      h('label', { text: 'Uji coba dulu ke satu nomor (sangat disarankan)' }),
      h('div', { class: 'baris', style: 'gap:.5rem' }, h('div', { class: 'kolom' }, nomorUji), tombolUji)));

    const kirim = h('button', {
      type: 'button',
      text: draf.jadwal ? '🕒 Jadwalkan broadcast' : '🚀 Kirim broadcast sekarang',
    });
    kirim.addEventListener('click', async () => {
      const nama = panel.querySelector('#b-nama').value.trim();
      const rate = Number(panel.querySelector('#b-rate').value) || 60;
      const jadwal = panel.querySelector('#b-jadwal').value;
      if (!nama) { App.galat('Nama broadcast belum diisi.'); return; }
      if (hasil.recipients === 0) { App.galat('Tidak ada penerima.'); return; }

      const pesanKonfirmasi = jadwal
        ? `Jadwalkan pengiriman ke ${fmtAngka(hasil.recipients)} kontak pada ${new Date(jadwal).toLocaleString('id-ID')}?`
        : `Kirim pesan ke ${fmtAngka(hasil.recipients)} kontak sekarang? Pesan yang sudah terkirim tidak bisa ditarik kembali.`;
      const ya = await App.konfirmasi(pesanKonfirmasi, 'Konfirmasi pengiriman', jadwal ? 'Ya, jadwalkan' : 'Ya, kirim sekarang');
      if (!ya) return;

      kirim.disabled = true;
      try {
        const buat = await api('/api/campaigns', {
          method: 'POST',
          body: {
            name: nama,
            templateName: draf.template.name,
            language: draf.template.language,
            mapping: draf.mapping,
            audience: draf.audience,
            rate_per_minute: rate,
            // datetime-local memakai waktu lokal; ubah ke format UTC "YYYY-MM-DD HH:MM:SS"
            scheduled_at: jadwal ? new Date(jadwal).toISOString().replace('T', ' ').slice(0, 19) : null,
            start: true,
          },
        });
        App.sukses(jadwal ? 'Broadcast dijadwalkan.' : 'Broadcast dimulai!');
        draf.langkah = 1; draf.template = null; draf.mapping = {}; draf.nama = ''; draf.jadwal = '';
        location.hash = '#/kampanye/' + buat.id;
      } catch (err) {
        App.galat(err.message);
      } finally {
        kirim.disabled = false;
      }
    });

    panel.appendChild(h('div', { class: 'baris', style: 'margin-top:1.2rem' },
      h('button', { type: 'button', class: 'sekunder', text: '‹ Kembali', onclick: () => { draf.langkah = 3; gambar(); } }),
      kirim));

    konten.appendChild(panel);
  }

  // ---------------------------------------------------------------- Router halaman
  window.App.views.broadcast = async function broadcastView(konten, params) {
    // Kalau dibuka dari halaman Template dengan nama template tertentu
    if (params.get('template')) {
      try {
        const data = await api(`/api/templates/${encodeURIComponent(params.get('template'))}/${encodeURIComponent(params.get('bahasa') || '')}`);
        draf.template = data.template;
        draf.mapping = JSON.parse(JSON.stringify(data.template.defaults || {}));
        draf.nama = `${data.template.name} - ${new Date().toLocaleDateString('id-ID')}`;
        draf.langkah = 2;
        history.replaceState(null, '', '#/broadcast');
      } catch (err) { App.galat(err.message); }
    }

    async function gambar() {
      App.muat(konten);
      konten.innerHTML = '';
      konten.appendChild(h('h1', { text: 'Buat Broadcast' }));
      konten.appendChild(penunjukLangkah());
      try {
        if (draf.langkah === 1 || !draf.template) { draf.langkah = 1; await langkah1(konten, gambar); }
        else if (draf.langkah === 2) langkah2(konten, gambar);
        else if (draf.langkah === 3) await langkah3(konten, gambar);
        else await langkah4(konten, gambar);
      } catch (err) {
        konten.appendChild(h('div', { class: 'galat', text: err.message }));
      }
    }

    await gambar();
  };
})();
