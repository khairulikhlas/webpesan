/* Halaman Pengaturan (koneksi WhatsApp) dan halaman Anggota Tim. */
(function () {
  'use strict';
  const { h, api, fmtTanggal } = window.App;

  function barisSalin(labelTeks, nilai, catatan) {
    const input = h('input', { type: 'text', value: nilai, readonly: true });
    return h('div', { style: 'margin-bottom:.8rem' },
      h('label', { text: labelTeks }),
      h('div', { class: 'salin-baris' }, input,
        h('button', { type: 'button', class: 'sekunder', text: 'Salin', onclick: () => App.salinTeks(nilai) })),
      catatan ? h('div', { class: 'kecil', text: catatan }) : null);
  }

  window.App.views.pengaturan = async function pengaturanView(konten) {
    const data = await api('/api/settings');
    const s = data.settings;
    const bolehUbah = App.user.role === 'admin';

    konten.innerHTML = '';
    konten.appendChild(h('h1', { text: 'Pengaturan Koneksi WhatsApp' }));
    if (!bolehUbah) konten.appendChild(h('div', { class: 'peringatan', text: 'Hanya admin yang bisa mengubah pengaturan. Kamu hanya bisa melihat.' }));

    // ---- Kredensial
    const panelKredensial = h('div', { class: 'panel' },
      h('h3', { text: '1. Kredensial dari Meta' }),
      h('div', { class: 'info' },
        'Semua nilai ini disalin dari ', h('strong', { text: 'developers.facebook.com → aplikasi kamu → WhatsApp → API Setup' }),
        '. Langkah lengkapnya ada di menu ', h('a', { href: '#/panduan', text: 'Panduan' }), '.'),

      h('label', { for: 's-pni', text: 'Phone Number ID *' }),
      h('input', { id: 's-pni', type: 'text', value: s.phone_number_id, disabled: !bolehUbah, placeholder: 'contoh: 123456789012345' }),
      h('div', { class: 'kecil', text: 'Bukan nomor teleponnya, tapi ID panjang di bawah nomor pada halaman API Setup.' }),

      h('label', { for: 's-waba', text: 'WhatsApp Business Account ID *' }),
      h('input', { id: 's-waba', type: 'text', value: s.business_account_id, disabled: !bolehUbah }),
      h('div', { class: 'kecil', text: 'Dibutuhkan untuk mengambil daftar template dari WhatsApp Manager.' }),

      h('label', { for: 's-appid', text: 'App ID' }),
      h('input', { id: 's-appid', type: 'text', value: s.app_id, disabled: !bolehUbah, placeholder: 'contoh: 1234567890123456' }),
      h('div', { class: 'kecil', text: 'Ada di App Dashboard bagian atas. Dibutuhkan hanya kalau kamu membuat template berheader gambar langsung dari web ini.' }),

      h('label', { for: 's-token', text: 'Access Token (System User, permanen) *' }),
      h('input', {
        id: 's-token', type: 'password', disabled: !bolehUbah,
        placeholder: s.has_access_token ? `Tersimpan ${s.access_token_hint} — kosongkan kalau tidak ingin diganti` : 'Tempel token di sini',
      }),
      h('div', { class: 'kecil', text: 'Token disimpan terenkripsi dan tidak pernah ditampilkan lagi. Gunakan System User Token supaya tidak kadaluarsa 24 jam.' }),

      h('label', { for: 's-secret', text: 'App Secret (untuk keamanan webhook)' }),
      h('input', {
        id: 's-secret', type: 'password', disabled: !bolehUbah,
        placeholder: s.has_app_secret ? 'Tersimpan — kosongkan kalau tidak ingin diganti' : 'Tempel App Secret di sini',
      }),
      h('div', { class: 'kecil', text: 'Ada di App Settings → Basic. Dipakai memeriksa bahwa webhook benar-benar datang dari Meta.' }),

      h('label', { for: 's-versi', text: 'Versi Graph API' }),
      h('input', { id: 's-versi', type: 'text', value: s.graph_version, disabled: !bolehUbah, placeholder: 'v23.0' }),
      h('div', { class: 'kecil', text: 'Meta merilis versi baru berkala. Kalau muncul error "unsupported version", ganti angka di sini sesuai versi terbaru di dashboard Meta.' }));

    // ---- Preferensi pengiriman
    const panelKirim = h('div', { class: 'panel' },
      h('h3', { text: '2. Identitas & preferensi pengiriman' }),
      h('label', { for: 's-appname', text: 'Nama aplikasi (muncul di judul tab dan pojok kiri atas)' }),
      h('input', { id: 's-appname', type: 'text', value: s.app_name, disabled: !bolehUbah, placeholder: 'CRM Cinta Dakwah' }),
      h('label', { for: 's-nama', text: 'Nama bisnis / lembaga' }),
      h('input', { id: 's-nama', type: 'text', value: s.business_name, disabled: !bolehUbah }),
      h('label', { for: 's-kode', text: 'Kode negara default' }),
      h('input', { id: 's-kode', type: 'text', value: s.default_country_code, disabled: !bolehUbah, placeholder: '62' }),
      h('div', { class: 'kecil', text: 'Dipakai mengubah nomor 08xxx menjadi 628xxx saat impor kontak.' }),
      h('label', { for: 's-rate', text: 'Kecepatan kirim default (pesan per menit)' }),
      h('input', { id: 's-rate', type: 'number', min: '1', max: '3000', value: s.rate_per_minute, disabled: !bolehUbah }),
      h('label', { for: 's-limit', text: 'Batas aman pesan per 24 jam' }),
      h('input', { id: 's-limit', type: 'number', min: '0', value: s.daily_limit, disabled: !bolehUbah }),
      h('div', { class: 'kecil', text: 'Isi sesuai Messaging Limit nomor kamu (contoh 250, 1.000, 10.000). Kalau tercapai, kampanye otomatis dijeda. Isi 0 untuk tanpa batas.' }),
      h('label', { class: 'inline', style: 'margin-top:.8rem' },
        h('input', { id: 's-optin', type: 'checkbox', checked: s.require_opt_in === '1', disabled: !bolehUbah }),
        'Hanya kirim ke kontak yang sudah opt-in (disarankan)'));

    // ---- Webhook
    const panelWebhook = h('div', { class: 'panel' },
      h('h3', { text: '3. Webhook (status terkirim, dibaca & balasan)' }),
      h('div', { class: 'info' },
        'Salin dua nilai di bawah ini ke Meta: ', h('strong', { text: 'App Dashboard → WhatsApp → Configuration → Edit' }),
        ', lalu centang (subscribe) field ', h('strong', { text: 'messages' }), '.'),
      barisSalin('Callback URL (URL webhook)', s.webhook_url,
        s.webhook_url.startsWith('https://')
          ? 'Sudah HTTPS. Bagus, Meta hanya menerima HTTPS.'
          : 'PERHATIAN: Meta hanya menerima alamat HTTPS publik. Ini masih alamat lokal, jadi webhook belum bisa didaftarkan.'),
      barisSalin('Verify token', s.verify_token, 'Tempel persis di kolom "Verify token" pada halaman konfigurasi Meta.'));

    // ---- Pemeriksa kesiapan webhook ----
    const hasilPeriksa = h('div', { style: 'margin-top:.8rem' });
    const tombolPeriksa = h('button', {
      type: 'button', text: '🔍 Periksa kesiapan webhook',
      onclick: async () => {
        tombolPeriksa.disabled = true;
        hasilPeriksa.innerHTML = '';
        hasilPeriksa.appendChild(h('div', { class: 'info', text: 'Memeriksa…' }));
        try {
          const r = await api('/api/settings/webhook-check', { method: 'POST' });
          hasilPeriksa.innerHTML = '';
          hasilPeriksa.appendChild(h('div', { class: r.siap ? 'sukses' : 'peringatan' },
            h('strong', { text: r.siap ? 'Webhook siap digunakan.' : 'Webhook belum lengkap. Ikuti saran di bawah.' })));

          const tbody = h('tbody');
          for (const l of r.langkah) {
            tbody.appendChild(h('tr', {},
              h('td', {}, h('span', { class: 'label ' + (l.ok ? 'hijau' : 'merah'), text: l.ok ? 'OK' : 'Belum' })),
              h('td', {}, h('strong', { text: l.nama }),
                h('div', { class: 'kecil', text: l.catatan }),
                l.saran ? h('div', { class: 'kecil', style: 'color:var(--kuning);margin-top:.2rem', text: '→ ' + l.saran }) : null)));
          }
          hasilPeriksa.appendChild(h('div', { class: 'tabel-gulir' }, h('table', {}, tbody)));

          if (r.bisaDihubungkan && bolehUbah) {
            const tombolHubung = h('button', {
              type: 'button', style: 'margin-top:.6rem',
              text: '🔗 Hubungkan sekarang',
              onclick: async () => {
                tombolHubung.disabled = true;
                try {
                  await api('/api/settings/webhook-subscribe', { method: 'POST' });
                  App.sukses('Akun WhatsApp berhasil dihubungkan ke aplikasi.');
                  tombolPeriksa.click();
                } catch (err) {
                  App.galat(err.message);
                  if (err.data?.hint) App.toast(err.data.hint);
                } finally { tombolHubung.disabled = false; }
              },
            });
            hasilPeriksa.appendChild(tombolHubung);
          }
        } catch (err) {
          hasilPeriksa.innerHTML = '';
          hasilPeriksa.appendChild(h('div', { class: 'galat', text: err.message }));
        } finally {
          tombolPeriksa.disabled = false;
        }
      },
    });
    panelWebhook.appendChild(h('div', { style: 'border-top:1px solid var(--garis);padding-top:.8rem;margin-top:.8rem' },
      h('div', { class: 'kecil', style: 'margin-bottom:.5rem' },
        'Status pesan dan balasan pelanggan tidak masuk? Tekan tombol ini untuk mencari tahu bagian mana yang belum siap.'),
      tombolPeriksa, hasilPeriksa));

    if (bolehUbah) {
      panelWebhook.appendChild(h('button', {
        type: 'button', class: 'sekunder', style: 'margin-top:.8rem',
        text: 'Buat ulang verify token',
        onclick: async () => {
          const ya = await App.konfirmasi('Verify token lama akan berhenti berlaku dan kamu harus mendaftarkan ulang webhook di Meta. Lanjutkan?', 'Buat ulang token', 'Ya, buat ulang');
          if (!ya) return;
          await api('/api/settings/regenerate-verify-token', { method: 'POST' });
          App.sukses('Verify token baru dibuat.');
          App.views.pengaturan(konten);
        },
      }));
    }

    // ---- Tombol simpan & uji
    const hasilUji = h('div');
    const tombolUji = h('button', {
      type: 'button', class: 'sekunder', text: '🔌 Uji koneksi ke WhatsApp',
      onclick: async () => {
        tombolUji.disabled = true;
        hasilUji.innerHTML = '';
        try {
          const r = await api('/api/settings/test', { method: 'POST' });
          hasilUji.appendChild(h('div', { class: 'sukses' },
            h('strong', { text: 'Berhasil terhubung! ' }),
            `Nomor ${r.info.nomor} (${r.info.nama_terverifikasi}). Kualitas: ${r.info.kualitas || '-'}. Batas kirim: ${r.info.batas_pesan || '-'}.`));
        } catch (err) {
          hasilUji.appendChild(h('div', { class: 'galat' },
            h('strong', { text: 'Gagal: ' }), err.message,
            err.data?.hint ? h('div', { class: 'kecil', style: 'margin-top:.4rem', text: err.data.hint }) : null));
        } finally {
          tombolUji.disabled = false;
        }
      },
    });

    const tombolSimpan = h('button', {
      type: 'button', text: '💾 Simpan pengaturan',
      onclick: async () => {
        const v = (id) => konten.querySelector('#' + id).value.trim();
        tombolSimpan.disabled = true;
        try {
          await api('/api/settings', {
            method: 'PUT',
            body: {
              phone_number_id: v('s-pni'),
              business_account_id: v('s-waba'),
              app_id: v('s-appid'),
              access_token: v('s-token'),
              app_secret: v('s-secret'),
              graph_version: v('s-versi') || 'v23.0',
              app_name: v('s-appname') || 'CRM Cinta Dakwah',
              business_name: v('s-nama'),
              default_country_code: v('s-kode') || '62',
              rate_per_minute: v('s-rate') || '60',
              daily_limit: v('s-limit') || '0',
              require_opt_in: konten.querySelector('#s-optin').checked ? '1' : '0',
            },
          });
          App.sukses('Pengaturan tersimpan.');
          await App.segarkanIdentitas();
          App.views.pengaturan(konten);
        } catch (err) {
          App.galat(err.message);
        } finally {
          tombolSimpan.disabled = false;
        }
      },
    });

    konten.appendChild(panelKredensial);
    konten.appendChild(panelKirim);
    konten.appendChild(panelWebhook);
    if (bolehUbah) konten.appendChild(h('div', { class: 'baris', style: 'gap:.5rem' }, tombolSimpan, tombolUji));
    else konten.appendChild(tombolUji);
    konten.appendChild(hasilUji);

    // ---- Log webhook
    const panelLog = h('div', { class: 'panel', style: 'margin-top:1rem' },
      h('div', { class: 'antara' }, h('h3', { text: 'Catatan webhook terakhir' }),
        h('button', { type: 'button', class: 'sekunder kecil-btn', text: 'Muat ulang', onclick: () => muatLog() })));
    const isiLog = h('div', {}, h('div', { class: 'pesan-kosong', text: 'Memuat…' }));
    panelLog.appendChild(isiLog);
    konten.appendChild(panelLog);

    async function muatLog() {
      const r = await api('/api/settings/webhook-logs');
      isiLog.innerHTML = '';
      if (r.logs.length === 0) {
        isiLog.appendChild(h('div', { class: 'pesan-kosong' },
          h('p', { text: 'Belum ada data webhook yang diterima.' }),
          h('p', { class: 'kecil', text: 'Kalau webhook sudah didaftarkan tapi kosong terus, periksa apakah field "messages" sudah dicentang di Meta dan aplikasi bisa diakses dari internet.' })));
        return;
      }
      const tbody = h('tbody');
      for (const l of r.logs.slice(0, 15)) {
        tbody.appendChild(h('tr', {},
          h('td', { class: 'kecil', text: fmtTanggal(l.received_at) }),
          h('td', {}, h('span', { class: 'label ' + (l.ok ? 'hijau' : 'merah'), text: l.ok ? 'Valid' : 'Ditolak' })),
          h('td', { class: 'kecil', text: l.note }),
          h('td', {}, h('details', {}, h('summary', { class: 'kecil', text: 'Lihat data' }), h('pre', { class: 'kode', text: l.raw })))));
      }
      isiLog.appendChild(h('div', { class: 'tabel-gulir' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', { text: 'Waktu' }), h('th', { text: 'Status' }), h('th', { text: 'Catatan' }), h('th', { text: 'Isi' }))),
        tbody)));
    }
    muatLog();
  };

  // ------------------------------------------------------------- Anggota tim
  window.App.views.tim = async function timView(konten) {
    const bolehUbah = App.user.role === 'admin';

    async function muatUlang() {
      konten.innerHTML = '';
      konten.appendChild(h('div', { class: 'antara' },
        h('h1', { text: 'Anggota Tim' }),
        bolehUbah ? h('button', { type: 'button', text: '+ Tambah anggota', onclick: dialogTambah }) : null));

      konten.appendChild(h('div', { class: 'panel' },
        h('h3', { text: 'Ubah kata sandi saya' }),
        h('label', { for: 'p-lama', text: 'Kata sandi sekarang' }),
        h('input', { id: 'p-lama', type: 'password' }),
        h('label', { for: 'p-baru', text: 'Kata sandi baru (minimal 8 karakter)' }),
        h('input', { id: 'p-baru', type: 'password' }),
        h('button', {
          type: 'button', style: 'margin-top:.8rem', text: 'Simpan kata sandi baru',
          onclick: async () => {
            try {
              await api('/api/auth/password', {
                method: 'POST',
                body: {
                  currentPassword: konten.querySelector('#p-lama').value,
                  newPassword: konten.querySelector('#p-baru').value,
                },
              });
              App.sukses('Kata sandi berhasil diubah.');
              konten.querySelector('#p-lama').value = '';
              konten.querySelector('#p-baru').value = '';
            } catch (err) { App.galat(err.message); }
          },
        })));

      if (!bolehUbah) return;

      const data = await api('/api/auth/users');
      const tbody = h('tbody');
      for (const u of data.users) {
        tbody.appendChild(h('tr', {},
          h('td', {}, h('strong', { text: u.name || '-' }), h('div', { class: 'kecil', text: u.email })),
          h('td', {}, h('span', { class: 'label ' + (u.role === 'admin' ? 'biru' : 'abu'), text: u.role === 'admin' ? 'Admin' : 'Staf' })),
          h('td', {}, h('span', { class: 'label ' + (u.is_active ? 'hijau' : 'merah'), text: u.is_active ? 'Aktif' : 'Nonaktif' })),
          h('td', { class: 'kecil', text: fmtTanggal(u.created_at) }),
          h('td', {}, h('div', { class: 'baris', style: 'gap:.3rem' },
            h('button', { type: 'button', class: 'sekunder kecil-btn', text: 'Atur ulang sandi', onclick: () => dialogSandi(u) }),
            u.id !== App.user.id ? h('button', {
              type: 'button', class: 'sekunder kecil-btn', text: u.is_active ? 'Nonaktifkan' : 'Aktifkan',
              onclick: async () => {
                await api('/api/auth/users/' + u.id, { method: 'PATCH', body: { is_active: !u.is_active } });
                App.sukses('Status diperbarui.'); muatUlang();
              },
            }) : null,
            u.id !== App.user.id ? h('button', {
              type: 'button', class: 'bahaya kecil-btn', text: 'Hapus',
              onclick: async () => {
                const ya = await App.konfirmasi(`Hapus akun ${u.email}?`, 'Hapus anggota', 'Ya, hapus');
                if (!ya) return;
                await api('/api/auth/users/' + u.id, { method: 'DELETE' });
                App.sukses('Anggota dihapus.'); muatUlang();
              },
            }) : null))));
      }

      konten.appendChild(h('div', { class: 'panel' }, h('h3', { text: 'Daftar anggota' }),
        h('div', { class: 'tabel-gulir' }, h('table', {},
          h('thead', {}, h('tr', {}, h('th', { text: 'Nama' }), h('th', { text: 'Peran' }), h('th', { text: 'Status' }), h('th', { text: 'Dibuat' }), h('th', { text: 'Aksi' }))),
          tbody))));
    }

    function dialogTambah() {
      App.dialog({
        judul: 'Tambah anggota tim',
        isi: h('div', {},
          h('label', { for: 'u-nama', text: 'Nama' }), h('input', { id: 'u-nama', type: 'text' }),
          h('label', { for: 'u-email', text: 'Email' }), h('input', { id: 'u-email', type: 'email' }),
          h('label', { for: 'u-sandi', text: 'Kata sandi (minimal 8 karakter)' }), h('input', { id: 'u-sandi', type: 'password' }),
          h('label', { for: 'u-peran', text: 'Peran' }),
          h('select', { id: 'u-peran' },
            h('option', { value: 'staff', text: 'Staf (bisa kirim broadcast & kelola kontak)' }),
            h('option', { value: 'admin', text: 'Admin (bisa juga ubah pengaturan & anggota)' }))),
        tombolUtama: 'Buat akun',
        onSimpan: async (kotak) => {
          await api('/api/auth/users', {
            method: 'POST',
            body: {
              name: kotak.querySelector('#u-nama').value.trim(),
              email: kotak.querySelector('#u-email').value.trim(),
              password: kotak.querySelector('#u-sandi').value,
              role: kotak.querySelector('#u-peran').value,
            },
          });
          App.sukses('Anggota ditambahkan.');
          muatUlang();
        },
      });
    }

    function dialogSandi(u) {
      App.dialog({
        judul: `Atur ulang kata sandi ${u.email}`,
        isi: h('div', {}, h('label', { for: 'r-sandi', text: 'Kata sandi baru' }), h('input', { id: 'r-sandi', type: 'password' })),
        tombolUtama: 'Simpan',
        onSimpan: async (kotak) => {
          await api('/api/auth/users/' + u.id, { method: 'PATCH', body: { password: kotak.querySelector('#r-sandi').value } });
          App.sukses('Kata sandi diperbarui. Pengguna harus masuk ulang.');
        },
      });
    }

    App.muat(konten);
    await muatUlang();
  };
})();
