#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")"
set -a
source .env
set +a
echo "=== ตรวจสอบบัญชี owner@example.com ==="
node -e '
const { Client } = require("pg");
const bcrypt = require("bcryptjs");
const c = new Client({ connectionString: process.env.DATABASE_URL });
c.connect().then(async () => {
  const r = await c.query(`select id, email, role, "passwordHash" from "User" where email = $1`, ["owner@example.com"]);
  if (r.rows.length === 0) {
    console.log("ไมพบผู้ใช้ owner@example.com ในฐานข้อมูล");
  } else {
    const u = r.rows[0];
    console.log("พบผู้ใช้:", u.email, "| role:", u.role);
    const testPw = process.env.SEED_OWNER_PASSWORD || "dev-owner-pass";
    const ok = await bcrypt.compare(testPw, u.passwordHash);
    console.log("ทดสอบรหัสผ่าน \"" + testPw + "\":", ok ? "ตรงกัน (ล็อกอินได้)" : "ไม่ตรงกัน");
  }
  const allUsers = await c.query(`select email, role from "User" order by email`);
  console.log("\nผู้ใช้ทั้งหมดในฐานข้อมูล:");
  allUsers.rows.forEach(x => console.log(" -", x.email, "(" + x.role + ")"));
  await c.end();
}).catch(e => { console.error("เชื่อมต่อไม่สำเร็จ:", e.message); process.exit(1); });
'
echo
echo "DONE"
read -n 1 -s -r -p "กดปุ่มใดก็ได้เพื่อปิดหน้าต่าง"
