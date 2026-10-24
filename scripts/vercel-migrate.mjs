#!/usr/bin/env node
// รัน prisma migrate deploy ตอน build บน Vercel
// - Neon แนะนำให้ migrate ผ่าน connection ตรง (ไม่ผ่าน pooler) ให้ตั้ง DIRECT_URL ไว้ใน Vercel env
//   ถ้ามี DIRECT_URL จะสลับไปใช้ตัวนั้นชั่วคราวเฉพาะคำสั่งนี้ ส่วนแอปตอนรันจริงยังใช้ DATABASE_URL (ตัวที่ผ่าน pooler) ตามเดิม
// - ตั้ง SKIP_MIGRATIONS=1 เพื่อข้ามขั้นนี้ เช่น build preview ของกิ่งที่ไม่ได้แก้ schema (กัน migrate ชนกันระหว่าง build พร้อมกันหลายตัว)
import { spawnSync } from "node:child_process";

if (process.env.SKIP_MIGRATIONS === "1") {
  console.log("[vercel-migrate] SKIP_MIGRATIONS=1 — ข้าม prisma migrate deploy");
  process.exit(0);
}

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) {
  console.error("[vercel-migrate] ไม่พบ DATABASE_URL หรือ DIRECT_URL — ตั้งค่าใน Vercel → Settings → Environment Variables");
  process.exit(1);
}
if (process.env.DIRECT_URL) console.log("[vercel-migrate] ใช้ DIRECT_URL (ไม่ผ่าน pooler) สำหรับ migrate deploy");

const r = spawnSync("npx", ["prisma", "migrate", "deploy"], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: url },
});
process.exit(r.status ?? 1);
