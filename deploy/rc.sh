#!/usr/bin/env bash
# คำสั่งดูแลระบบบนเซิร์ฟเวอร์ — รันจากโฟลเดอร์โปรเจกต์: ./deploy/rc.sh <คำสั่ง>
set -euo pipefail
cd "$(dirname "$0")/.."
DC=(docker compose -f docker-compose.prod.yml --env-file .env.production)

usage() {
  cat <<USAGE
ใช้: ./deploy/rc.sh <คำสั่ง>
  check                ตรวจไฟล์ .env.production ก่อนติดตั้ง
  up                   build + เปิดระบบ (รัน migration อัตโนมัติ)
  create-owner         สร้างบัญชีเจ้าของคนแรก (ถามชื่อร้าน/ชื่อ/อีเมล)
  update               ดึงโค้ดล่าสุด (git pull) แล้ว build + เปิดใหม่
  logs [service]       ดู log (ค่าเริ่มต้น: app)
  status               สถานะ container + health
  backup               สำรองฐานข้อมูลทันที
  restore <file>       กู้คืนจากไฟล์ใน ./backups (เขียนทับข้อมูลปัจจุบัน!)
  down                 ปิดระบบ (ข้อมูลไม่หาย)
USAGE
}

check() {
  [[ -f .env.production ]] || { echo "ไม่พบ .env.production — คัดลอกจาก .env.production.example ก่อน"; exit 1; }
  if grep -qE '<[^>]+>' .env.production; then
    echo "ยังมีค่าที่ต้องแก้ใน .env.production:"; grep -nE '<[^>]+>' .env.production; exit 1
  fi
  # shellcheck disable=SC1091
  set -a; source .env.production; set +a
  local k; k=$(printf '%s' "$ENCRYPTION_KEY" | base64 -d 2>/dev/null | wc -c)
  [[ "$k" == 32 ]] || { echo "ENCRYPTION_KEY ต้องเป็น base64 ของ 32 ไบต์ (openssl rand -base64 32)"; exit 1; }
  [[ "$PUBLIC_BASE_URL" == https://* ]] || { echo "PUBLIC_BASE_URL ต้องขึ้นต้นด้วย https://"; exit 1; }
  echo "✓ .env.production พร้อมใช้งาน (โดเมน: $DOMAIN)"
}

case "${1:-}" in
  check) check ;;
  up) check; mkdir -p backups; "${DC[@]}" up -d --build; "${DC[@]}" ps ;;
  create-owner)
    read -rp "ชื่อร้าน/องค์กร: " org; read -rp "ชื่อของคุณ: " name; read -rp "อีเมล: " email
    "${DC[@]}" run --rm migrate npx tsx scripts/create-owner.ts --org "$org" --name "$name" --email "$email" ;;
  update) git pull --ff-only; check; "${DC[@]}" up -d --build; docker image prune -f >/dev/null ;;
  logs) "${DC[@]}" logs -f --tail=200 "${2:-app}" ;;
  status) "${DC[@]}" ps; curl -fsS "https://$(grep ^DOMAIN= .env.production | cut -d= -f2)/api/health" && echo ;;
  backup)
    set -a; source .env.production; set +a
    f="backups/hospchat-manual-$(date +%Y%m%d-%H%M).sql.gz"
    "${DC[@]}" exec -T db pg_dump -U "$POSTGRES_USER" --no-owner "$POSTGRES_DB" | gzip > "$f"; echo "บันทึกที่ $f" ;;
  restore)
    [[ -f "${2:-}" ]] || { echo "ระบุไฟล์ เช่น ./deploy/rc.sh restore backups/hospchat-xxxx.sql.gz"; exit 1; }
    set -a; source .env.production; set +a
    read -rp "จะเขียนทับข้อมูลปัจจุบันทั้งหมด พิมพ์ RESTORE เพื่อยืนยัน: " ok; [[ "$ok" == RESTORE ]] || exit 1
    "${DC[@]}" stop app
    "${DC[@]}" exec -T db psql -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE IF EXISTS \"$POSTGRES_DB\" WITH (FORCE);" -c "CREATE DATABASE \"$POSTGRES_DB\";"
    gunzip -c "$2" | "${DC[@]}" exec -T db psql -q -U "$POSTGRES_USER" -d "$POSTGRES_DB"
    "${DC[@]}" up -d app; echo "กู้คืนเรียบร้อย" ;;
  down) "${DC[@]}" down ;;
  *) usage ;;
esac
