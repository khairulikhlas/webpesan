#!/usr/bin/env bash
#
# Pembaru otomatis CRM Cinta Dakwah.
#
# Cara pakai (dijalankan DI DALAM VPS):
#   bash /var/www/crm-app/scripts/perbarui.sh /root/nama-berkas.zip
#
# Skrip ini mencadangkan data, memasang versi baru, lalu menghidupkan
# aplikasi kembali. Folder data/ dan berkas .env tidak pernah disentuh.

set -euo pipefail

BERKAS_ZIP="${1:-}"
NAMA_PM2="${2:-crm}"
FOLDER_APP="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WAKTU="$(date +%Y-%m-%d-%H%M)"
FOLDER_CADANGAN="/root/cadangan-crm-$WAKTU"

merah()  { printf '\033[31m%s\033[0m\n' "$*"; }
hijau()  { printf '\033[32m%s\033[0m\n' "$*"; }
kuning() { printf '\033[33m%s\033[0m\n' "$*"; }

if [ -z "$BERKAS_ZIP" ]; then
  merah "Berkas ZIP belum disebutkan."
  echo "Cara pakai: bash $0 /root/nama-berkas.zip"
  exit 1
fi
if [ ! -f "$BERKAS_ZIP" ]; then
  merah "Berkas tidak ditemukan: $BERKAS_ZIP"
  echo "Cek dulu dengan: ls -lh /root/*.zip"
  exit 1
fi

echo ""
kuning "== Folder aplikasi : $FOLDER_APP"
kuning "== Berkas ZIP      : $BERKAS_ZIP"
kuning "== Proses PM2      : $NAMA_PM2"
echo ""

# ---------------------------------------------------------------- 1. Cadangan
echo "[1/6] Mencadangkan data..."
mkdir -p "$FOLDER_CADANGAN"
if [ -d "$FOLDER_APP/data" ]; then
  tar czf "$FOLDER_CADANGAN/data.tar.gz" -C "$FOLDER_APP" data
  hijau "      Data dicadangkan ke $FOLDER_CADANGAN/data.tar.gz"
else
  kuning "      Folder data belum ada, dilewati."
fi
if [ -f "$FOLDER_APP/.env" ]; then
  cp "$FOLDER_APP/.env" "$FOLDER_CADANGAN/env.txt"
  hijau "      Berkas .env dicadangkan."
fi

# ------------------------------------------------------------- 2. Ekstrak ZIP
echo "[2/6] Membuka berkas ZIP..."
command -v unzip >/dev/null 2>&1 || { kuning "      Memasang unzip..."; apt-get install -y unzip >/dev/null; }
FOLDER_SEMENTARA="$(mktemp -d)"
trap 'rm -rf "$FOLDER_SEMENTARA"' EXIT
unzip -q -o "$BERKAS_ZIP" -d "$FOLDER_SEMENTARA"

SUMBER="$(dirname "$(find "$FOLDER_SEMENTARA" -maxdepth 3 -name server.js -not -path '*/node_modules/*' | head -n 1)")"
if [ ! -f "$SUMBER/server.js" ]; then
  merah "      Tidak menemukan server.js di dalam ZIP. Pembaruan dibatalkan."
  exit 1
fi
hijau "      Isi ZIP siap dipasang."

# ---------------------------------------------------------- 3. Hentikan dulu
echo "[3/6] Menghentikan aplikasi sementara..."
pm2 stop "$NAMA_PM2" >/dev/null 2>&1 || kuning "      Proses '$NAMA_PM2' tidak sedang berjalan."

# --------------------------------------------------------------- 4. Salin
echo "[4/6] Memasang berkas versi baru..."
cp -r "$SUMBER"/. "$FOLDER_APP"/
hijau "      Berkas diperbarui (data dan .env tidak disentuh)."

# ------------------------------------------------------------- 5. Komponen
echo "[5/6] Memasang komponen pendukung (butuh 1-3 menit)..."
cd "$FOLDER_APP"
npm install --omit=dev --no-audit --no-fund

# -------------------------------------------------------------- 6. Hidupkan
echo "[6/6] Menghidupkan aplikasi..."
pm2 restart "$NAMA_PM2" >/dev/null 2>&1 || pm2 start server.js --name "$NAMA_PM2" >/dev/null
pm2 save >/dev/null 2>&1 || true
sleep 3

PORT_APP="$(grep -E '^PORT=' "$FOLDER_APP/.env" 2>/dev/null | cut -d= -f2 || true)"
PORT_APP="${PORT_APP:-3000}"
HASIL="$(curl -s --max-time 10 "http://localhost:$PORT_APP/healthz" || true)"

echo ""
if echo "$HASIL" | grep -q '"ok":true'; then
  hijau "=========================================="
  hijau " PEMBARUAN BERHASIL"
  hijau "=========================================="
  echo " Jawaban aplikasi: $HASIL"
  echo " Cadangan tersimpan di: $FOLDER_CADANGAN"
else
  merah "=========================================="
  merah " APLIKASI BELUM MENJAWAB DENGAN BENAR"
  merah "=========================================="
  echo " Jawaban: ${HASIL:-(kosong)}"
  echo ""
  echo " Lihat penyebabnya dengan perintah:"
  echo "   pm2 logs $NAMA_PM2 --lines 40 --nostream"
  echo ""
  echo " Cadangan data ada di: $FOLDER_CADANGAN"
  exit 1
fi
