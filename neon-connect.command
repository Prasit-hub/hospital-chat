#!/usr/bin/env bash
# ดับเบิลคลิกเพื่อเชื่อมต่อ Neon: เช็คการเชื่อมต่อ -> อัปเดตตาราง (migrate) -> ใส่ข้อมูลตัวอย่าง (เฉพาะฐานว่าง)
set -uo pipefail
cd "$(dirname "$0")"
echo "=== เชื่อมต่อ Neon ($(date)) ==="

# โหลดค่าจาก .env เข้าเป็น environment variable จริงของ shell (ตัวแปร DIRECT_URL/DATABASE_URL จะได้ใช้ในขั้นที่ 2 ได้)
set -a
# shellcheck disable=SC1091
source .env
set +a

echo; echo "--- 1) ทดสอบการเชื่อมต่อ ---"
node -e '
const { Client } = require("pg");
const c = new Client({ connectionString: process.env.DATABASE_URL });
c.connect()
  .then(async () => {
    const r = await c.query("select version(), current_database()");
    console.log("เชื่อมต่อสำเร็จ:", r.rows[0].current_database, "-", r.rows[0].version.split(",")[0]);
    await c.end();
  })
  .catch((e) => { console.error("เชื่อมต่อไม่สำเร็จ:", e.message); process.exit(1); });
' || { echo; echo "DONE FAIL — เชื่อมต่อไม่สำเร็จ ตรวจ connection string ใน .env"; echo; read -n 1 -s -r -p "กดปุ่มใดก็ได้เพื่อปิดหน้าต่าง"; exit 1; }

echo; echo "--- 2) อัปเดตโครงสร้างตาราง (prisma migrate deploy ผ่าน DIRECT_URL) ---"
DATABASE_URL="${DIRECT_URL:-$DATABASE_URL}" npx prisma migrate deploy || { echo "DONE FAIL — migrate ไม่สำเร็จ"; echo; read -n 1 -s -r -p "กดปุ่มใดก็ได้เพื่อปิดหน้าต่าง"; exit 1; }

echo; echo "--- 3) ตรวจว่ามีข้อมูลอยู่แล้วหรือยัง ---"
HAS_USER=$(node -e '
const { Client } = require("pg");
const c = new Client({ connectionString: process.env.DATABASE_URL });
c.connect().then(async () => {
  const r = await c.query(`select count(*)::int as n from "User"`);
  console.log(r.rows[0].n);
  await c.end();
}).catch(() => console.log(0));
')
if [[ "${HAS_USER:-0}" == "0" ]]; then
  echo "ฐานข้อมูลว่าง — ใส่ข้อมูลตัวอย่าง"
  npx prisma db seed
else
  echo "มีข้อมูลอยู่แล้ว ($HAS_USER บัญชี) — ข้าม seed (ไม่ทับข้อมูลเดิม)"
fi

echo
echo "เชื่อมกับ Neon เรียบร้อย — รัน ./scripts/dev-up.sh ต่อได้เลย (DATABASE_URL ใน .env ชี้ไป Neon แล้ว)"
echo "ถ้าจะกลับไปใช้ PostgreSQL ในเครื่องเหมือนเดิม: cp .env.backup-before-neon-* .env"
echo "DONE OK"
echo; read -n 1 -s -r -p "กดปุ่มใดก็ได้เพื่อปิดหน้าต่าง"
