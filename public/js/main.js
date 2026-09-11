/* Pengatur halaman (router) + layar masuk. */
(function () {
  'use strict';
  const { h, api } = window.App;

  const layarMasuk = document.getElementById('layar-masuk');
  const aplikasi = document.getElementById('aplikasi');
  const konten = document.getElementById('konten');
  const formMasuk = document.getElementById('form-masuk');
  const pesanMasuk = document.getElementById('masuk-pesan');
  let modeSetup = false;

  App.tampilkanLayarMasuk = function tampilkanLayarMasuk() {
    aplikasi.hidden = true;
    layarMasuk.hidden = false;
  };

  App.perbaruiLencana = function perbaruiLencana(jumlah) {
    const el = document.getElementById('lencana-inbox');
    if (!el) return;
    el.hidden = !jumlah;
    el.textContent = String(jumlah || 0);
  };

  /* Nama aplikasi diambil dari server supaya bisa diganti lewat halaman Pengaturan. */
  App.pasangNamaAplikasi = function pasangNamaAplikasi(nama) {
    if (!nama) return;
    document.title = nama;
    const logo = document.getElementById('masuk-logo');
    const merek = document.getElementById('merek-nama');
    if (logo) logo.textContent = nama;
    if (merek) merek.textContent = nama;
  };

  /* ---------------- Layar masuk ---------------- */
  function siapkanLayarMasuk(needsSetup) {
    modeSetup = needsSetup;
    document.getElementById('kolom-nama').hidden = !needsSetup;
    document.getElementById('masuk-subjudul').textContent = needsSetup
      ? 'Selamat datang! Buat akun admin pertama untuk mulai memakai aplikasi ini.'
      : 'Masuk untuk mengelola broadcast WhatsApp tim kamu.';
    document.getElementById('masuk-tombol').textContent = needsSetup ? 'Buat akun admin' : 'Masuk';
    document.getElementById('masuk-sandi').setAttribute('autocomplete', needsSetup ? 'new-password' : 'current-password');
    App.tampilkanLayarMasuk();
  }

  formMasuk.addEventListener('submit', async (e) => {
    e.preventDefault();
    pesanMasuk.innerHTML = '';
    const tombol = document.getElementById('masuk-tombol');
    tombol.disabled = true;
    try {
      const body = {
        email: document.getElementById('masuk-email').value.trim(),
        password: document.getElementById('masuk-sandi').value,
      };
      if (modeSetup) body.name = document.getElementById('masuk-nama').value.trim();
      const hasil = await api(modeSetup ? '/api/auth/setup' : '/api/auth/login', { method: 'POST', body });
      App.user = hasil.user;
      document.getElementById('masuk-sandi').value = '';
      mulaiAplikasi();
    } catch (err) {
      pesanMasuk.appendChild(h('div', { class: 'galat', text: err.message }));
    } finally {
      tombol.disabled = false;
    }
  });

  document.getElementById('tombol-keluar').addEventListener('click', async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* abaikan */ }
    App.user = null;
    location.hash = '';
    siapkanLayarMasuk(false);
  });

  document.getElementById('tombol-menu').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('buka');
  });

  /* ---------------- Router ---------------- */
  const rute = {
    dashboard: (k, p) => App.views.dashboard(k, p),
    kontak: (k, p) => App.views.kontak(k, p),
    template: (k, p) => App.views.template(k, p),
    broadcast: (k, p) => App.views.broadcast(k, p),
    kampanye: (k, p, id) => (id ? App.views.kampanyeDetail(k, p, id) : App.views.kampanye(k, p)),
    inbox: (k, p) => App.views.inbox(k, p),
    pengaturan: (k, p) => App.views.pengaturan(k, p),
    tim: (k, p) => App.views.tim(k, p),
    panduan: (k, p) => App.views.panduan(k, p),
  };

  async function gambarHalaman() {
    if (!App.user) return;
    const hash = location.hash.replace(/^#\/?/, '') || 'dashboard';
    const [jalur, kueri] = hash.split('?');
    const bagian = jalur.split('/').filter(Boolean);
    const halaman = bagian[0] || 'dashboard';
    const id = bagian[1] || null;
    const params = new URLSearchParams(kueri || '');

    // Matikan penyegar otomatis milik halaman sebelumnya, supaya tidak
    // menimpa tampilan halaman yang baru dibuka.
    App.bersihkanTimer();

    document.querySelectorAll('#menu a').forEach((a) => {
      a.classList.toggle('aktif', a.dataset.halaman === halaman);
    });
    document.getElementById('sidebar').classList.remove('buka');

    const fungsi = rute[halaman];
    if (!fungsi) { location.hash = '#/dashboard'; return; }

    App.muat(konten);
    try {
      await fungsi(konten, params, id);
    } catch (err) {
      konten.innerHTML = '';
      konten.appendChild(h('div', { class: 'galat' },
        h('strong', { text: 'Gagal memuat halaman: ' }), err.message));
      if (err.data?.hint) konten.appendChild(h('div', { class: 'info', text: err.data.hint }));
    }
  }

  window.addEventListener('hashchange', gambarHalaman);

  /* ---------------- Mulai ---------------- */
  async function perbaruiInfoAtas() {
    document.getElementById('info-pengguna').textContent = `${App.user.name || App.user.email} (${App.user.role === 'admin' ? 'Admin' : 'Staf'})`;
    try {
      const data = await api('/api/settings');
      const s = data.settings;
      App.pasangNamaAplikasi(s.app_name);
      document.getElementById('merek-nomor').textContent = s.display_phone_number
        ? `${s.business_name} • ${s.display_phone_number}`
        : (s.business_name || 'WhatsApp Cloud API');
    } catch { /* abaikan */ }
  }

  // Dipanggil ulang setelah pengaturan disimpan supaya nama & nomor di sidebar ikut berubah.
  App.segarkanIdentitas = perbaruiInfoAtas;

  function mulaiAplikasi() {
    layarMasuk.hidden = true;
    aplikasi.hidden = false;
    perbaruiInfoAtas();
    if (!location.hash) location.hash = '#/dashboard';
    else gambarHalaman();
    // Perbarui lencana pesan belum dibaca secara berkala.
    setInterval(async () => {
      try {
        const d = await api('/api/stats/dashboard');
        App.state.unread = d.unread;
        App.perbaruiLencana(d.unread);
      } catch { /* abaikan */ }
    }, 30000);
  }

  /* ----------------------------------------------------------------------
     Pemasangan di HP (PWA)

     Service worker didaftarkan supaya aplikasi bisa dipasang seperti aplikasi
     biasa di layar utama HP petugas, dan tetap terbuka saat sinyal putus.
     ---------------------------------------------------------------------- */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.warn('Service worker gagal didaftarkan:', err.message);
      });
    });
  }

  // Tombol pasang muncul sendiri kalau browser menawarkan pemasangan.
  let tawaranPasang = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    tawaranPasang = e;
    const tombol = document.getElementById('tombol-pasang');
    if (tombol) tombol.hidden = false;
  });
  window.addEventListener('appinstalled', () => {
    tawaranPasang = null;
    const tombol = document.getElementById('tombol-pasang');
    if (tombol) tombol.hidden = true;
    App.sukses('Aplikasi berhasil dipasang di perangkat ini.');
  });
  document.getElementById('tombol-pasang')?.addEventListener('click', async () => {
    if (!tawaranPasang) return;
    tawaranPasang.prompt();
    await tawaranPasang.userChoice;
    tawaranPasang = null;
    document.getElementById('tombol-pasang').hidden = true;
  });

  (async function awal() {
    try {
      api('/api/app-info').then((info) => App.pasangNamaAplikasi(info.app_name)).catch(() => {});
      const state = await api('/api/auth/state');
      if (state.user) { App.user = state.user; mulaiAplikasi(); }
      else siapkanLayarMasuk(state.needsSetup);
    } catch (err) {
      siapkanLayarMasuk(false);
      pesanMasuk.appendChild(h('div', { class: 'galat', text: 'Tidak bisa menghubungi server: ' + err.message }));
    }
  })();
})();
