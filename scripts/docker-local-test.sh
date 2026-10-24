#!/usr/bin/env bash
# ทดสอบ Docker ชุด production บนเครื่อง: build → migrate → ข้อมูลตัวอย่าง → smoke test ผ่าน HTTPS
# ใช้: ./scripts/docker-local-test.sh          (ผลลัพธ์บันทึกที่ docker-test.log)
#      ./scripts/docker-local-test.sh down     (ปิดและลบข้อมูลทดสอบ)
set -uo pipefail
cd "$(dirname "$0")/.."
LOG=docker-test.log
ENVF=.env.local-docker
DC=(docker compose -p hospchat-local -f docker-compose.prod.yml -f docker-compose.local.yml --env-file "$ENVF")
BASE=https://localhost:8543
PASS=0; FAIL=0
ok() { if eval "$1"; then PASS=$((PASS+1)); echo "  ✓ $2"; else FAIL=$((FAIL+1)); echo "  ✗ $2"; fi; }

if [[ "${1:-}" == "down" ]]; then "${DC[@]}" down -v; rm -f "$ENVF"; exit 0; fi

exec > >(tee "$LOG") 2>&1
echo "=== รวมแชท: ทดสอบ Docker บนเครื่อง ($(date)) ==="

if ! command -v docker >/dev/null; then echo "FATAL: ไม่พบคำสั่ง docker — ติดตั้ง Docker Desktop ก่อน"; echo "DONE FAIL"; exit 1; fi
if ! docker info >/dev/null 2>&1; then echo "FATAL: Docker ยังไม่ทำงาน — เปิดแอป Docker Desktop แล้วรอให้ขึ้น Running"; echo "DONE FAIL"; exit 1; fi
docker version --format 'Docker {{.Server.Version}} ({{.Server.Arch}})'

if [[ ! -f "$ENVF" ]]; then
  cat > "$ENVF" <<ENV
DOMAIN=localhost
ACME_EMAIL=test@example.com
PUBLIC_BASE_URL=$BASE
POSTGRES_USER=hospchat
POSTGRES_PASSWORD=$(openssl rand -hex 16)
POSTGRES_DB=hospchat
BACKUP_KEEP_DAYS=7
ENCRYPTION_KEY=$(openssl rand -base64 32)
META_APP_SECRET=local-test-secret
META_VERIFY_TOKEN=local-verify
META_GRAPH_VERSION=v23.0
META_HUMAN_AGENT_TAG=false
OUTBOUND_MODE=mock
NEXT_PUBLIC_APP_TZ=Asia/Bangkok
ENV
fi
# compose อ่าน env_file ชื่อ .env.production — ชี้ไปที่ไฟล์ทดสอบ (ถ้ายังไม่มีไฟล์จริง)
if [[ ! -e .env.production ]]; then cp "$ENVF" .env.production; CREATED_PROD_ENV=1; fi

echo; echo "--- 1) build images (ครั้งแรกใช้เวลา 3–10 นาที) ---"
T0=$(date +%s)
if ! "${DC[@]}" build; then echo "FATAL: build ล้มเหลว"; echo "DONE FAIL"; exit 1; fi
echo "build เสร็จใน $(( $(date +%s) - T0 )) วินาที"

echo; echo "--- 2) start (db → migrate → app → caddy) ---"
if ! "${DC[@]}" up -d; then echo "FATAL: up ล้มเหลว"; "${DC[@]}" logs --tail=80; echo "DONE FAIL"; exit 1; fi
"${DC[@]}" logs migrate | tail -8

echo; echo "--- 3) รอระบบพร้อม ---"
for i in $(seq 1 60); do curl -ksf "$BASE/api/health" >/dev/null && break; sleep 2; done
"${DC[@]}" ps

echo; echo "--- 4) ใส่ข้อมูลตัวอย่าง ---"
"${DC[@]}" run --rm -e ALLOW_DEMO_SEED=true -e SEED_OWNER_PASSWORD=local-owner-pass migrate npx tsx prisma/seed.ts | tail -3

echo; echo "--- 5) smoke test ผ่าน HTTPS (Caddy) ---"
JAR=$(mktemp)
ok '[[ $(curl -ks "$BASE/api/health") == *"\"ok\":true"* ]]' "health ผ่าน HTTPS"
ok '[[ $(curl -ks -o /dev/null -w "%{http_code}" "$BASE/api/inbox") == 401 ]]' "API ไม่ล็อกอิน → 401"
ok '[[ $(curl -ks -o /dev/null -w "%{http_code}" -X POST -H "content-type: application/json" -d "{\"email\":\"owner@example.com\",\"password\":\"wrong\"}" "$BASE/api/auth/login") == 401 ]]' "รหัสผิด → 401"
ok '[[ $(curl -ks -c "$JAR" -o /dev/null -w "%{http_code}" -X POST -H "content-type: application/json" -d "{\"email\":\"owner@example.com\",\"password\":\"local-owner-pass\"}" "$BASE/api/auth/login") == 200 ]]' "ล็อกอินเจ้าของ"
ok 'grep -q rc_session "$JAR"' "ได้ cookie เซสชัน"
INBOX=$(curl -ks -b "$JAR" "$BASE/api/inbox")
ok '[[ "$INBOX" == *"conversations"* && "$INBOX" == *"รพ.ตัวอย่าง LINE OA"* ]]' "โหลด inbox + ช่องทาง"
LINE_ID=$("${DC[@]}" exec -T db psql -U hospchat -d hospchat -tAc "select id from \"Channel\" where type='line' limit 1")
BODY='{"destination":"demo-line","events":[{"type":"message","timestamp":'$(date +%s)000',"replyToken":"rt-docker","source":{"type":"user","userId":"Udocker1"},"message":{"id":"77001","type":"text","text":"ทดสอบจาก Docker ราคาเท่าไหร่"}}]}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "demo-secret" -binary | base64)
ok '[[ $(curl -ks -o /dev/null -w "%{http_code}" -X POST -H "x-line-signature: bad" -d "$BODY" "$BASE/api/webhooks/line/$LINE_ID") == 401 ]]' "webhook ลายเซ็นผิด → 401"
ok '[[ $(curl -ks -o /dev/null -w "%{http_code}" -X POST -H "content-type: application/json" -H "x-line-signature: $SIG" -d "$BODY" "$BASE/api/webhooks/line/$LINE_ID") == 200 ]]' "webhook LINE ลายเซ็นถูก → 200"
sleep 2
MSGS=$("${DC[@]}" exec -T db psql -U hospchat -d hospchat -tAc "select string_agg(m.sender::text, ',' order by m.\"createdAt\") from \"Message\" m join \"Conversation\" v on v.id=m.\"conversationId\" join \"Contact\" c on c.id=v.\"contactId\" where c.\"externalId\"='Udocker1'")
ok '[[ "$MSGS" == customer,bot* ]]' "บันทึกข้อความลูกค้า + บอทตอบอัตโนมัติ ($MSGS)"
CONV=$("${DC[@]}" exec -T db psql -U hospchat -d hospchat -tAc "select v.id from \"Conversation\" v join \"Contact\" c on c.id=v.\"contactId\" where c.\"externalId\"='Udocker1'")
ok '[[ $(curl -ks -b "$JAR" -X POST -H "content-type: application/json" -d "{\"kind\":\"text\",\"text\":\"ตอบจากแอดมินใน Docker\"}" "$BASE/api/conversations/$CONV/messages") == *"\"status\":\"sent\""* ]]' "แอดมินตอบแชท"
ok '[[ $(curl -ks -b "$JAR" "$BASE/api/dashboard?range=today") == *"\"chats\""* ]]' "รายงานทำงาน"
EVT=$(curl -ks -b "$JAR" --max-time 3 "$BASE/api/events" | head -c 200)
ok '[[ "$EVT" == *"ping"* ]]' "realtime (SSE) ผ่าน Caddy"
ok '[[ $(curl -ksI "$BASE/login" | tr -d "\r" | grep -ci "^strict-transport-security") == 1 ]]' "มี HSTS header"
ok '[[ $(curl -s -o /dev/null -w "%{http_code}" http://localhost:8180/login) =~ ^30 ]]' "http → https redirect"
ok '[[ $("${DC[@]}" ps app --format "{{.Status}}") == *healthy* ]]' "container app healthy"
rm -f "$JAR"

[[ "${CREATED_PROD_ENV:-}" == 1 ]] && rm -f .env.production

echo; echo "ผลทดสอบ: $PASS ผ่าน, $FAIL ไม่ผ่าน"
echo "เปิดดูในเบราว์เซอร์: $BASE/login  (owner@example.com / local-owner-pass — ยอมรับคำเตือนใบรับรองของ localhost)"
echo "ทดลองบัญชี AD จำลอง: ตั้งค่า → การเข้าสู่ระบบ (AD) → AD จำลอง → บันทึก แล้วเข้าด้วย mali.s หรือ noi.c (รหัส Mock@1234)"
echo "ปิดระบบทดสอบ: ./scripts/docker-local-test.sh down"
[[ $FAIL == 0 ]] && echo "DONE OK" || echo "DONE FAIL"
