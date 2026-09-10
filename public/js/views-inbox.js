/* Halaman Kotak Masuk: melihat balasan pelanggan dan membalas dalam jendela 24 jam. */
(function () {
  'use strict';
  const { h, api, fmtTanggal, fmtNomor } = window.App;

  let aktif = null;

  window.App.views.inbox = async function inboxView(konten) {

    const kolomKiri = h('div', { class: 'panel daftar-percakapan' });
    const kolomKanan = h('div', { class: 'panel' }, h('div', { class: 'pesan-kosong', text: 'Pilih percakapan di sebelah kiri.' }));

    konten.innerHTML = '';
    konten.appendChild(h('h1', { text: 'Kotak Masuk' }));
    konten.appendChild(h('div', { class: 'info' },
      'Balasan pelanggan hanya masuk ke sini kalau ', h('strong', { text: 'webhook sudah aktif' }),
      '. Aturan WhatsApp: pesan teks bebas hanya boleh dikirim dalam 24 jam setelah pelanggan mengirim pesan terakhir.'));
    konten.appendChild(h('div', { class: 'inbox' }, kolomKiri, kolomKanan));

    async function muatDaftar() {
      const data = await api('/api/inbox/threads');
      kolomKiri.innerHTML = '';
      kolomKiri.appendChild(h('h3', { text: 'Percakapan' }));
      if (data.threads.length === 0) {
        kolomKiri.appendChild(h('div', { class: 'pesan-kosong', text: 'Belum ada pesan masuk.' }));
        return;
      }
      for (const t of data.threads) {
        const el = h('div', { class: 'percakapan' + (aktif === t.phone ? ' aktif' : '') },
          h('div', { class: 'antara' },
            h('span', { class: 'nama', text: t.contact_name || fmtNomor(t.phone) }),
            Number(t.unread) > 0 ? h('span', { class: 'label hijau', text: String(t.unread) }) : null),
          h('div', { class: 'cuplikan', text: t.last_body || '' }),
          h('div', { class: 'kecil' }, fmtTanggal(t.last_received_at), ' ',
            t.window_open ? h('span', { class: 'label hijau', text: '24 jam aktif' }) : h('span', { class: 'label abu', text: 'perlu template' })));
        el.addEventListener('click', () => { aktif = t.phone; muatDaftar(); bukaPercakapan(t.phone); });
        kolomKiri.appendChild(el);
      }
    }

    async function bukaPercakapan(phone) {
      const data = await api('/api/inbox/thread/' + encodeURIComponent(phone));
      kolomKanan.innerHTML = '';
      kolomKanan.appendChild(h('div', { class: 'antara' },
        h('div', {}, h('h3', { text: data.contact?.name || fmtNomor(phone) }),
          h('div', { class: 'kecil', text: fmtNomor(phone) })),
        data.window_open
          ? h('span', { class: 'label hijau', text: 'Bisa balas teks bebas' })
          : h('span', { class: 'label kuning', text: 'Jendela 24 jam tertutup' })));

      const riwayat = h('div', { class: 'riwayat' });
      for (const m of data.messages) {
        const gelembung = h('div', { class: 'gelembung' },
          h('div', { text: m.body || '(tanpa teks)' }),
          h('div', { class: 'kaki-pesan' }, fmtTanggal(m.at),
            m.direction === 'out' ? ' • ' + App.labelStatus(m.status).textContent : ''),
          m.error_detail ? h('div', { class: 'kecil', style: 'color:var(--merah)', text: m.error_detail }) : null);
        riwayat.appendChild(h('div', { class: 'baris-pesan ' + (m.direction === 'out' ? 'keluar' : 'masuk') }, gelembung));
      }
      kolomKanan.appendChild(riwayat);
      setTimeout(() => { riwayat.scrollTop = riwayat.scrollHeight; }, 30);

      if (data.window_open) {
        const teks = h('textarea', { placeholder: 'Tulis balasan…', style: 'min-height:70px' });

        // Pemilih emoji sederhana: menyisipkan di posisi kursor, bukan di akhir teks.
        const EMOJI = ['🙏', '😊', '❤️', '💚', '👍', '🤲', '✨', '🌙', '📿', '🕌', '📖', '💌',
          '🎉', '🔔', '📢', '📅', '📍', '✅', '❓', '🙌', '💐', '☺️'];
        const papanEmoji = h('div', {
          hidden: true,
          style: 'display:flex;flex-wrap:wrap;gap:.25rem;padding:.5rem;border:1px solid var(--garis);border-radius:9px;margin-top:.4rem;background:#fff',
        }, EMOJI.map((e) => h('button', {
          type: 'button', class: 'sekunder kecil-btn', style: 'font-size:1.15rem;padding:.2rem .4rem;line-height:1',
          text: e,
          onclick: () => {
            const awal = teks.selectionStart ?? teks.value.length;
            const akhir = teks.selectionEnd ?? teks.value.length;
            teks.value = teks.value.slice(0, awal) + e + teks.value.slice(akhir);
            const posisi = awal + e.length;
            teks.focus();
            teks.setSelectionRange(posisi, posisi);
          },
        })));

        const tombolEmoji = h('button', {
          type: 'button', class: 'sekunder', title: 'Sisipkan emoji', text: '😊',
          onclick: () => { papanEmoji.hidden = !papanEmoji.hidden; },
        });

        const kirim = h('button', { type: 'button', text: 'Kirim balasan' });
        kirim.addEventListener('click', async () => {
          const isi = teks.value.trim();
          if (!isi) return;
          kirim.disabled = true;
          try {
            await api('/api/inbox/reply', { method: 'POST', body: { phone, body: isi } });
            teks.value = '';
            App.sukses('Balasan terkirim.');
            bukaPercakapan(phone);
          } catch (err) {
            App.galat(err.message);
          } finally {
            kirim.disabled = false;
          }
        });
        kolomKanan.appendChild(h('div', { style: 'margin-top:.7rem' }, teks, papanEmoji,
          h('div', { class: 'baris', style: 'justify-content:space-between;margin-top:.5rem' },
            tombolEmoji, kirim)));
      } else {
        kolomKanan.appendChild(h('div', { class: 'peringatan', style: 'margin-top:.7rem' },
          'Pelanggan ini terakhir membalas lebih dari 24 jam lalu, jadi WhatsApp tidak mengizinkan pesan teks bebas. ',
          'Gunakan ', h('a', { href: '#/broadcast', text: 'template' }), ' untuk menghubunginya kembali.'));
      }
      App.perbaruiLencana(Math.max(0, (App.state.unread || 0)));
    }

    await muatDaftar();
    if (aktif) await bukaPercakapan(aktif);
    App.pasangTimer(() => { muatDaftar().catch(() => {}); }, 15000);
  };
})();
