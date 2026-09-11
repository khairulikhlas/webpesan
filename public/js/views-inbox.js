/* Halaman Kotak Masuk: melihat balasan pelanggan dan membalas dalam jendela 24 jam. */
(function () {
  'use strict';
  const { h, api, fmtTanggal, fmtNomor } = window.App;

  let aktif = null;

  window.App.views.inbox = async function inboxView(konten) {

    const kolomKiri = h('div', { class: 'panel daftar-percakapan' });
    const kolomKanan = h('div', { class: 'panel panel-percakapan' },
      h('div', { class: 'pesan-kosong', text: 'Pilih percakapan di sebelah kiri.' }));
    const wadahInbox = h('div', { class: 'inbox' }, kolomKiri, kolomKanan);

    konten.innerHTML = '';
    konten.appendChild(h('h1', { text: 'Kotak Masuk' }));
    konten.appendChild(h('div', { class: 'info sembunyi-di-ponsel' },
      'Balasan pelanggan hanya masuk ke sini kalau ', h('strong', { text: 'webhook sudah aktif' }),
      '. Aturan WhatsApp: pesan teks bebas hanya boleh dikirim dalam 24 jam setelah pelanggan mengirim pesan terakhir.'));
    konten.appendChild(wadahInbox);

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
        el.addEventListener('click', () => {
          aktif = t.phone;
          wadahInbox.classList.add('lihat-percakapan');
          muatDaftar();
          bukaPercakapan(t.phone);
        });
        kolomKiri.appendChild(el);
      }
    }

    async function bukaPercakapan(phone) {
      const data = await api('/api/inbox/thread/' + encodeURIComponent(phone));
      kolomKanan.innerHTML = '';
      kolomKanan.appendChild(h('button', {
        type: 'button', class: 'sekunder kecil-btn tombol-kembali-inbox',
        text: '‹ Daftar percakapan',
        onclick: () => { wadahInbox.classList.remove('lihat-percakapan'); },
      }));
      kolomKanan.appendChild(h('div', { class: 'antara' },
        h('div', {}, h('h3', { text: data.contact?.name || fmtNomor(phone) }),
          h('div', { class: 'kecil', text: fmtNomor(phone) })),
        data.window_open
          ? h('span', { class: 'label hijau', text: 'Bisa balas teks bebas' })
          : h('span', { class: 'label kuning', text: 'Jendela 24 jam tertutup' })));

      const riwayat = h('div', { class: 'riwayat' });
      for (const m of data.messages) {
        const gelembung = h('div', { class: 'gelembung' });

        // Gambar bukti transfer dan berkas lain ditampilkan langsung.
        if (m.media_url) {
          const mime = String(m.media_mime || '');
          if (mime.startsWith('image/')) {
            gelembung.appendChild(h('a', { href: m.media_url, target: '_blank', rel: 'noopener' },
              h('img', {
                src: m.media_url, alt: 'Berkas dari percakapan', loading: 'lazy',
                style: 'max-width:230px;max-height:280px;border-radius:8px;display:block;margin-bottom:.35rem;cursor:zoom-in',
              })));
          } else if (mime.startsWith('video/')) {
            gelembung.appendChild(h('video', {
              src: m.media_url, controls: true,
              style: 'max-width:230px;border-radius:8px;display:block;margin-bottom:.35rem',
            }));
          } else if (mime.startsWith('audio/')) {
            gelembung.appendChild(h('audio', { src: m.media_url, controls: true, style: 'display:block;margin-bottom:.35rem' }));
          } else {
            gelembung.appendChild(h('a', {
              href: m.media_url, target: '_blank', rel: 'noopener',
              style: 'display:block;margin-bottom:.35rem', text: '📄 Buka berkas',
            }));
          }
        } else if (['image', 'video', 'document', 'audio', 'sticker'].includes(m.type) && m.direction === 'in') {
          gelembung.appendChild(h('div', { class: 'kecil', style: 'color:var(--teks-lembut)', text: 'Berkas sedang diunduh…' }));
        }

        if (m.body) gelembung.appendChild(h('div', { text: m.body }));
        else if (!m.media_url) gelembung.appendChild(h('div', { text: '(tanpa teks)' }));

        gelembung.appendChild(h('div', { class: 'kaki-pesan' }, fmtTanggal(m.at),
          m.direction === 'out' ? ' • ' + App.labelStatus(m.status).textContent : ''));
        if (m.error_detail) {
          gelembung.appendChild(h('div', { class: 'kecil', style: 'color:var(--merah)', text: m.error_detail }));
        }
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

        // Lampiran: gambar QRIS, brosur, atau dokumen dari galeri media.
        let lampiran = null;
        const infoLampiran = h('div', { hidden: true, style: 'margin-top:.4rem' });

        const pasangLampiran = (m) => {
          lampiran = m;
          infoLampiran.hidden = false;
          infoLampiran.innerHTML = '';
          infoLampiran.appendChild(h('div', {
            style: 'display:flex;align-items:center;gap:.5rem;border:1px solid var(--garis);border-radius:9px;padding:.4rem .6rem;background:#fff',
          },
          String(m.mime || '').startsWith('image/')
            ? h('img', { src: m.url, alt: '', style: 'width:42px;height:42px;object-fit:cover;border-radius:6px' })
            : h('span', { style: 'font-size:1.4rem', text: '📄' }),
          h('div', { class: 'kolom' },
            h('div', { class: 'kecil', text: m.original_name || m.id }),
            h('div', { class: 'kecil', text: 'Akan dikirim bersama pesan ini' })),
          h('button', {
            type: 'button', class: 'sekunder kecil-btn', text: 'Batal',
            onclick: () => { lampiran = null; infoLampiran.hidden = true; infoLampiran.innerHTML = ''; },
          })));
        };

        const tombolLampiran = h('button', {
          type: 'button', class: 'sekunder', title: 'Lampirkan gambar atau berkas', text: '📎',
          onclick: () => App.galeriMedia((url, m) => pasangLampiran({ ...m, url })),
        });

        const kirim = h('button', { type: 'button', text: 'Kirim balasan' });
        kirim.addEventListener('click', async () => {
          const isi = teks.value.trim();
          if (!isi && !lampiran) return;
          kirim.disabled = true;
          try {
            await api('/api/inbox/reply', {
              method: 'POST',
              body: { phone, body: isi, mediaId: lampiran ? lampiran.id : '' },
            });
            teks.value = '';
            lampiran = null;
            infoLampiran.hidden = true;
            infoLampiran.innerHTML = '';
            App.sukses('Balasan terkirim.');
            bukaPercakapan(phone);
          } catch (err) {
            App.galat(err.message);
          } finally {
            kirim.disabled = false;
          }
        });
        kolomKanan.appendChild(h('div', { style: 'margin-top:.7rem' }, teks, papanEmoji, infoLampiran,
          h('div', { class: 'baris', style: 'justify-content:space-between;margin-top:.5rem' },
            h('div', { class: 'baris', style: 'gap:.4rem' }, tombolEmoji, tombolLampiran),
            kirim)));
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
