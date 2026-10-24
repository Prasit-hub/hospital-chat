#!/usr/bin/env bash
# เปิดทุกอย่างสำหรับพัฒนาในเครื่องทีเดียว: PostgreSQL → HIS จำลอง → (ngrok) → npm run dev
# ใช้:  ./scripts/dev-up.sh              เปิดระบบ (ไม่เปิดอุโมงค์ — ใช้ได้กับ HIS/AD แต่ LINE เรียกเข้าไม่ได้)
#       ./scripts/dev-up.sh --tunnel     เปิดพร้อม ngrok และตั้ง PUBLIC_BASE_URL ให้อัตโนมัติ (สำหรับ webhook LINE/Meta)
#       ./scripts/dev-up.sh --no-his     ไม่ต้องเปิด HIS จำลอง
#       ./scripts/dev-up.sh down         ปิดฐานข้อมูลและตัวจำลองที่ค้างอยู่
set -uo pipefail
cd "$(dirname "$0")/.."

PORT=${PORT:-3000}
HIS_PORT=${HIS_PORT:-4700}
RUN=.dev-run                      # เก็บ pid / log ของตัวจำลอง (อยู่ใน .gitignore)
TUNNEL=0
WITH_HIS=1

for a in "$@"; do
  case "$a" in
    down) DOWN=1 ;;
    --tunnel|-t) TUNNEL=1 ;;
    --no-his) WITH_HIS=0 ;;
    -h|--help) sed -n '2,6p' "$0"; exit 0 ;;
    *) echo "ไม่รู้จักตัวเลือก: $a (ดู --help)"; exit 1 ;;
  esac
done

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
warn() { printf '  \033[33m! %s\033[0m\n' "$*"; }
die()  { printf '\n\033[31mหยุด: %s\033[0m\n' "$*"; exit 1; }
busy() { lsof -ti "tcp:$1" 2>/dev/null | head -1; }

stop_bg() {
  for f in "$RUN"/*.pid; do
    [[ -e "$f" ]] || continue
    p=$(cat "$f"); n=$(basename "$f" .pid)
    if kill -0 "$p" 2>/dev/null; then
      pkill -P "$p" 2>/dev/null          # ลูกที่โปรแกรมเปิดไว้ (เช่น ngrok)
      kill "$p" 2>/dev/null
      echo "  ปิด $n (pid $p)"
    fi
    rm -f "$f"
  done
}

# ---------- down ----------
if [[ "${DOWN:-}" == 1 ]]; then
  say "ปิดระบบพัฒนา"
  stop_bg
  docker compose down 2>/dev/null && echo "  ปิด PostgreSQL แล้ว (ข้อมูลยังอยู่ — ลบด้วย docker compose down -v)"
  exit 0
fi

mkdir -p "$RUN"
trap 'echo; say "ปิดตัวจำลองที่เปิดไว้"; stop_bg; echo "  PostgreSQL ยังทำงานอยู่ — ปิดด้วย ./scripts/dev-up.sh down"' EXIT

# ---------- 0) ของที่ต้องมี ----------
command -v node   >/dev/null || die "ไม่พบ Node.js — ติดตั้ง Node 20 ขึ้นไปก่อน"
command -v docker >/dev/null || die "ไม่พบ Docker — ติดตั้ง Docker Desktop ก่อน (หรือเปิด PostgreSQL เองแล้วแก้ DATABASE_URL)"
docker info >/dev/null 2>&1   || die "Docker ยังไม่ทำงาน — เปิดแอป Docker Desktop แล้วรอให้ขึ้น Running"
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[[ $NODE_MAJOR -ge 20 ]] || die "ต้องใช้ Node 20 ขึ้นไป (ตอนนี้ $(node -v))"

# ---------- 1) .env ----------
if [[ ! -f .env ]]; then
  say "1) สร้าง .env ครั้งแรก"
  cp .env.example .env
  KEY=$(openssl rand -base64 32)
  # macOS และ Linux ใช้ sed -i ต่างกัน จึงเขียนทับด้วย perl แทน
  perl -pi -e "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=\"$KEY\"|" .env
  perl -pi -e 's|^SEED_OWNER_PASSWORD=.*|SEED_OWNER_PASSWORD="dev-owner-pass"|' .env
  perl -pi -e 's|^OUTBOUND_MODE=.*|OUTBOUND_MODE="mock"|' .env
  perl -pi -e 's|^# HIS_ALLOW_HTTP=1|HIS_ALLOW_HTTP=1|' .env
  perl -pi -e 's|^# LDAP_ALLOW_PLAIN=1|LDAP_ALLOW_PLAIN=1|' .env
  echo "  สร้างแล้ว (ENCRYPTION_KEY สุ่มให้ · OUTBOUND_MODE=mock · รหัสเจ้าของ dev-owner-pass)"
else
  echo "ใช้ .env เดิมที่มีอยู่"
fi
grep -q '^OUTBOUND_MODE="live"' .env && warn 'OUTBOUND_MODE=live — ข้อความจะถูกส่งออกไปจริง ระหว่าง dev ควรตั้งเป็น mock'

# ---------- 2) PostgreSQL ----------
say "2) PostgreSQL"
docker compose up -d || die "เปิด PostgreSQL ไม่สำเร็จ"
for i in $(seq 1 30); do
  docker compose exec -T db pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
  [[ $i == 30 ]] && die "PostgreSQL ไม่พร้อมใน 30 วินาที — ดู docker compose logs db"
done
echo "  พร้อมที่ localhost:5432"

# ---------- 3) ติดตั้ง + ตารางฐานข้อมูล + ข้อมูลตัวอย่าง ----------
[[ -d node_modules ]] || { say "3) npm install (ครั้งแรกใช้เวลาสักครู่)"; npm install || die "npm install ไม่สำเร็จ"; }
say "3) ตารางฐานข้อมูล"
npx prisma generate >/dev/null 2>&1
npx prisma migrate deploy || die "อัปเดตตารางไม่สำเร็จ"
HAS_USER=$(docker compose exec -T db psql -U postgres -d hospchat -tAc 'select count(*) from "User"' 2>/dev/null | tr -d '[:space:]')
if [[ "${HAS_USER:-0}" == "0" ]]; then
  echo "  ยังไม่มีข้อมูล — ใส่ข้อมูลตัวอย่าง"
  npx prisma db seed || warn "seed ไม่สำเร็จ — ลองรัน npx prisma db seed เองอีกครั้ง"
else
  echo "  มีข้อมูลอยู่แล้ว ($HAS_USER บัญชี) — ข้าม seed"
fi

# ---------- 4) HIS จำลอง ----------
if [[ $WITH_HIS == 1 ]]; then
  say "4) HIS Gateway จำลอง"
  if [[ -n "$(busy $HIS_PORT)" ]]; then
    warn "พอร์ต $HIS_PORT มีโปรแกรมอื่นใช้อยู่ — ข้าม (ปิดตัวนั้นก่อนถ้าต้องการใช้ตัวจำลอง)"
  else
    node scripts/mock-his-gateway.mjs > "$RUN/his.log" 2>&1 &
    echo $! > "$RUN/his.pid"
    sleep 1
    kill -0 "$(cat $RUN/his.pid)" 2>/dev/null \
      && echo "  ทำงานที่ http://localhost:$HIS_PORT (log: $RUN/his.log)" \
      || { warn "เปิดไม่สำเร็จ — ดู $RUN/his.log"; rm -f "$RUN/his.pid"; }
  fi
fi

# ---------- 5) ngrok ----------
if [[ $TUNNEL == 1 ]]; then
  say "5) อุโมงค์ ngrok (สำหรับ webhook LINE / Meta)"
  if ! command -v ngrok >/dev/null; then
    warn "ไม่พบคำสั่ง ngrok — ติดตั้งด้วย brew install ngrok แล้วล็อกอินด้วย ngrok config add-authtoken <token>"
  else
    ngrok http "$PORT" --log stdout > "$RUN/ngrok.log" 2>&1 &
    echo $! > "$RUN/ngrok.pid"
    URL=""
    for i in $(seq 1 20); do
      URL=$(curl -s http://localhost:4040/api/tunnels 2>/dev/null \
        | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const t=JSON.parse(s).tunnels.find(x=>x.proto==="https");if(t)process.stdout.write(t.public_url)}catch{}})')
      [[ -n "$URL" ]] && break
      sleep 1
    done
    if [[ -n "$URL" ]]; then
      perl -pi -e "s|^PUBLIC_BASE_URL=.*|PUBLIC_BASE_URL=\"$URL\"|" .env
      echo "  $URL  → ตั้ง PUBLIC_BASE_URL ใน .env ให้แล้ว"
      echo "  เอา Webhook URL ที่หน้า ตั้งค่า → เชื่อมต่อช่องทาง ไปวางใน LINE/Meta Console แล้วกด Verify"
      warn "URL นี้เปลี่ยนทุกครั้งที่เปิดใหม่ (ngrok ฟรี) ต้องไปแก้ใน Console ใหม่ทุกครั้ง"
    else
      warn "อ่าน URL จาก ngrok ไม่ได้ — ดู $RUN/ngrok.log"
    fi
  fi
fi

# ---------- 6) แอป ----------
say "พร้อมใช้งาน"
cat <<INFO
  เว็บ:        http://localhost:$PORT/login
  เข้าระบบ:    owner@example.com / $(grep -m1 '^SEED_OWNER_PASSWORD=' .env | cut -d'"' -f2)
  AD จำลอง:    ตั้งค่า → การเข้าสู่ระบบ (AD) → AD จำลอง → บันทึก
               แล้วเข้าด้วย mali.s · noi.c · pichai.f · it.admin (รหัส Mock@1234)
  HIS จำลอง:   ตั้งค่า → เชื่อมต่อ HIS → ข้อมูลจำลอง
               หรือโหมด Gateway: http://localhost:$HIS_PORT · OAuth2
               token http://localhost:$HIS_PORT/oauth/token · chat-app / mock-secret
  ปิดทั้งหมด:  Ctrl+C แล้ว ./scripts/dev-up.sh down
INFO

say "6) npm run dev"
npm run dev
