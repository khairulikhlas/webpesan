/* Fungsi dasar yang dipakai semua halaman: pemanggilan API, notifikasi, dialog, format. */
(function () {
  'use strict';

  const App = window.App = {
    user: null,
    views: {},
    state: {},
  };

  /* ----------------------------------------------------------------------
     Pencatat timer halaman.

     Beberapa halaman memasang penyegar otomatis (setInterval). Kalau tidak
     dimatikan saat pindah menu, penyegar itu tetap jalan di latar belakang
     lalu menimpa layar halaman lain. Semua timer halaman dicatat di sini
     dan dibersihkan oleh pengatur halaman setiap kali berpindah menu.
     ---------------------------------------------------------------------- */
  const timerHalaman = new Set();

  App.pasangTimer = function pasangTimer(fungsi, jeda) {
    const id = setInterval(fungsi, jeda);
    timerHalaman.add(id);
    return id;
  };

  App.bersihkanTimer = function bersihkanTimer() {
    for (const id of timerHalaman) clearInterval(id);
    timerHalaman.clear();
  };

  /* ---------- Pemanggilan API ---------- */
  App.api = async function api(path, options = {}) {
    const opts = {
      method: options.method || 'GET',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
    };
    if (options.body !== undefined) opts.body = JSON.stringify(options.body);

    const res = await fetch(path, opts);
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }

    if (res.status === 401 && !path.includes('/api/auth/')) {
      App.user = null;
      App.tampilkanLayarMasuk();
      throw new Error('Sesi berakhir, silakan masuk kembali.');
    }
    if (!res.ok) {
      const err = new Error(data.error || `Gagal memanggil ${path} (${res.status})`);
      err.data = data;
      throw err;
    }
    return data;
  };

  /* ---------- Notifikasi ---------- */
  App.toast = function toast(pesan, jenis = '') {
    const wadah = document.getElementById('toast-wadah');
    const el = document.createElement('div');
    el.className = 'toast ' + jenis;
    el.textContent = pesan;
    wadah.appendChild(el);
    setTimeout(() => el.remove(), jenis === 'galat' ? 7000 : 4000);
  };
  App.sukses = (p) => App.toast(p, 'sukses');
  App.galat = (p) => App.toast(p, 'galat');

  /* ---------- Pembuat elemen ---------- */
  App.h = function h(tag, attrs = {}, ...anak) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
    for (const a of anak.flat()) {
      if (a === null || a === undefined || a === false) continue;
      el.appendChild(typeof a === 'string' || typeof a === 'number' ? document.createTextNode(String(a)) : a);
    }
    return el;
  };

  App.escape = function escape(teks) {
    return String(teks ?? '').replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  };

  /* ---------- Dialog ---------- */
  App.dialog = function dialog({ judul, isi, tombolUtama = 'Simpan', onSimpan = null, lebar = false, tanpaTombol = false }) {
    const wadah = document.getElementById('dialog-wadah');
    const tirai = App.h('div', { class: 'tirai' });
    const kotak = App.h('div', { class: 'dialog' + (lebar ? ' lebar' : '') });

    const tutup = () => tirai.remove();
    const kepala = App.h('div', { class: 'kepala' },
      App.h('h3', { text: judul }),
      App.h('button', { type: 'button', onclick: tutup, 'aria-label': 'Tutup', text: '×' }));

    kotak.appendChild(kepala);
    kotak.appendChild(typeof isi === 'string' ? App.h('div', { html: isi }) : isi);

    if (!tanpaTombol) {
      const simpan = App.h('button', { type: 'button', text: tombolUtama });
      simpan.addEventListener('click', async () => {
        simpan.disabled = true;
        try {
          const hasil = await onSimpan?.(kotak);
          if (hasil !== false) tutup();
        } catch (err) {
          App.galat(err.message);
        } finally {
          simpan.disabled = false;
        }
      });
      kotak.appendChild(App.h('div', { class: 'kaki' },
        App.h('button', { type: 'button', class: 'sekunder', text: 'Batal', onclick: tutup }), simpan));
    }

    tirai.addEventListener('click', (e) => { if (e.target === tirai) tutup(); });
    tirai.appendChild(kotak);
    wadah.appendChild(tirai);
    setTimeout(() => kotak.querySelector('input, textarea, select')?.focus(), 50);
    return { tutup, kotak };
  };

  App.konfirmasi = function konfirmasi(pesan, judul = 'Konfirmasi', tombolUtama = 'Ya, lanjutkan') {
    return new Promise((resolve) => {
      const wadah = document.getElementById('dialog-wadah');
      const tirai = App.h('div', { class: 'tirai' });
      let sudah = false;
      const selesai = (jawaban) => { if (sudah) return; sudah = true; tirai.remove(); resolve(jawaban); };

      const kotak = App.h('div', { class: 'dialog' },
        App.h('div', { class: 'kepala' },
          App.h('h3', { text: judul }),
          App.h('button', { type: 'button', text: '\u00d7', 'aria-label': 'Tutup', onclick: () => selesai(false) })),
        App.h('p', { text: pesan }),
        App.h('div', { class: 'kaki' },
          App.h('button', { type: 'button', class: 'sekunder', text: 'Batal', onclick: () => selesai(false) }),
          App.h('button', { type: 'button', class: 'bahaya', text: tombolUtama, onclick: () => selesai(true) })));

      tirai.addEventListener('click', (e) => { if (e.target === tirai) selesai(false); });
      tirai.appendChild(kotak);
      wadah.appendChild(tirai);
    });
  };

  /* ---------- Format ---------- */
  App.fmtTanggal = function fmtTanggal(nilai) {
    if (!nilai) return '-';
    const iso = String(nilai).includes('T') ? nilai : String(nilai).replace(' ', 'T') + 'Z';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(nilai);
    return d.toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };
  App.fmtAngka = (n) => Number(n || 0).toLocaleString('id-ID');
  App.fmtNomor = (p) => (p ? '+' + String(p).replace(/^\+/, '') : '-');

  App.labelStatus = function labelStatus(status) {
    const peta = {
      pending: ['Menunggu', 'abu'], sent: ['Terkirim', 'biru'], delivered: ['Diterima', 'hijau'],
      read: ['Dibaca', 'hijau'], failed: ['Gagal', 'merah'], canceled: ['Dibatalkan', 'abu'],
      draft: ['Draf', 'abu'], running: ['Berjalan', 'biru'], paused: ['Dijeda', 'kuning'],
      scheduled: ['Terjadwal', 'kuning'], done: ['Selesai', 'hijau'],
      APPROVED: ['Disetujui', 'hijau'], PENDING: ['Menunggu review', 'kuning'],
      REJECTED: ['Ditolak', 'merah'], PAUSED: ['Dijeda Meta', 'kuning'], DISABLED: ['Dinonaktifkan', 'merah'],
    };
    const [teks, warna] = peta[status] || [status || '-', 'abu'];
    return App.h('span', { class: 'label ' + warna, text: teks });
  };

  App.salinTeks = async function salinTeks(teks) {
    try {
      await navigator.clipboard.writeText(teks);
      App.sukses('Disalin ke papan klip.');
    } catch {
      App.toast('Tidak bisa menyalin otomatis. Silakan salin manual.');
    }
  };

  /* ----------------------------------------------------------------------
     Galeri media: unggah sekali, alamatnya bisa dipakai berkali-kali.
     Memanggil onPilih(url) ketika pengguna memilih sebuah berkas.
     ---------------------------------------------------------------------- */
  App.galeriMedia = function galeriMedia(onPilih) {
    const daftar = App.h('div', {}, App.h('div', { class: 'pesan-kosong', text: 'Memuat…' }));
    const pesan = App.h('div');

    const isi = App.h('div', {},
      App.h('div', { class: 'info' },
        'WhatsApp mengambil gambar langsung dari alamat internet setiap kali pesan dikirim. ',
        'Gambar contoh yang dipasang saat membuat template di WhatsApp Manager ',
        App.h('strong', { text: 'hanya dipakai Meta untuk meninjau' }),
        ', jadi tidak bisa dipakai ulang saat mengirim. Unggah sekali di sini, lalu alamatnya bisa dipakai untuk broadcast berikutnya.'),
      App.h('label', { for: 'g-berkas', text: 'Unggah berkas baru' }),
      App.h('input', { id: 'g-berkas', type: 'file', accept: '.jpg,.jpeg,.png,.mp4,.pdf' }),
      App.h('div', { class: 'kecil', text: 'Gambar JPG/PNG maks 5 MB, video MP4 maks 16 MB, dokumen PDF maks 100 MB.' }),
      pesan,
      App.h('h4', { style: 'margin-top:1rem', text: 'Berkas tersimpan' }),
      daftar);

    const { kotak, tutup } = App.dialog({ judul: 'Galeri Media', isi, lebar: true, tanpaTombol: true });

    async function muatDaftar() {
      const data = await App.api('/api/media');
      daftar.innerHTML = '';
      if (data.media.length === 0) {
        daftar.appendChild(App.h('div', { class: 'pesan-kosong', text: 'Belum ada berkas. Unggah yang pertama di atas.' }));
        return;
      }
      const grid = App.h('div', { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:.7rem' });
      for (const m of data.media) {
        const gambar = String(m.mime).startsWith('image/')
          ? App.h('img', { src: m.url, alt: m.original_name, style: 'width:100%;height:96px;object-fit:cover;border-radius:8px' })
          : App.h('div', { style: 'height:96px;display:flex;align-items:center;justify-content:center;background:#f1f5f9;border-radius:8px;font-size:1.6rem',
              text: String(m.mime).startsWith('video/') ? '🎬' : '📄' });

        const kartu = App.h('div', { style: 'border:1px solid var(--garis);border-radius:10px;padding:.5rem' },
          gambar,
          App.h('div', { class: 'kecil', style: 'margin:.3rem 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap', text: m.original_name || m.id }),
          App.h('div', { class: 'kecil', text: (m.size / 1024).toFixed(0) + ' KB' }),
          App.h('div', { class: 'baris', style: 'gap:.3rem;margin-top:.4rem' },
            App.h('button', { type: 'button', class: 'kecil-btn', text: 'Pakai', onclick: () => { onPilih(m.url, m); tutup(); } }),
            App.h('button', {
              type: 'button', class: 'sekunder kecil-btn', text: 'Hapus',
              onclick: async () => {
                const ya = await App.konfirmasi(`Hapus berkas ${m.original_name || m.id}? Broadcast lama yang memakainya bisa gagal menampilkan gambar.`, 'Hapus berkas', 'Ya, hapus');
                if (!ya) return;
                await App.api('/api/media/' + m.id, { method: 'DELETE' });
                App.sukses('Berkas dihapus.');
                muatDaftar();
              },
            })));
        grid.appendChild(kartu);
      }
      daftar.appendChild(grid);
    }

    kotak.querySelector('#g-berkas').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      pesan.innerHTML = '';
      pesan.appendChild(App.h('div', { class: 'info', text: `Mengunggah ${file.name}…` }));
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const hasil = await App.api('/api/media', {
            method: 'POST',
            body: {
              filename: file.name,
              contentType: file.type,
              data: String(reader.result).split(',')[1] || '',
            },
          });
          pesan.innerHTML = '';
          pesan.appendChild(App.h('div', { class: 'sukses', text: 'Berhasil diunggah. Tekan "Pakai" pada berkas di bawah.' }));
          void hasil;
          muatDaftar();
        } catch (err) {
          pesan.innerHTML = '';
          pesan.appendChild(App.h('div', { class: 'galat', text: err.message }));
        }
      };
      reader.readAsDataURL(file);
    });

    muatDaftar().catch((err) => {
      daftar.innerHTML = '';
      daftar.appendChild(App.h('div', { class: 'galat', text: err.message }));
    });
  };

  App.muat = function muat(el, teks = 'Memuat…') {
    el.innerHTML = '';
    el.appendChild(App.h('div', { class: 'pesan-kosong', text: teks }));
  };
})();
