// สร้าง (หรือรีเซ็ต) ผู้ใช้พร้อมรหัสผ่านที่กำหนดเอง — ใช้ได้ทั้งอีเมลและชื่อผู้ใช้สำหรับเข้าสู่ระบบ
//
//   npx tsx scripts/create-user.ts --login admin --password '<รหัสผ่าน>' [--name "Admin"] [--role owner|admin|agent]
//
// บน Docker:
//   docker compose ... run --rm migrate npx tsx scripts/create-user.ts --login admin --password '<รหัสผ่าน>'
//
// ถ้ามีผู้ใช้นี้อยู่แล้ว จะตั้งรหัสผ่าน/บทบาทใหม่และเปิดใช้งานบัญชี (ออกจากระบบทุกอุปกรณ์)
import "dotenv/config";
import { parseArgs } from "node:util";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Role } from "../src/generated/prisma/client";

const { values } = parseArgs({
  options: {
    login: { type: "string" },
    password: { type: "string" },
    name: { type: "string" },
    role: { type: "string", default: "owner" },
  },
});

const login = values.login?.trim().toLowerCase();
const role = values.role as Role;
if (!login || !values.password) {
  console.error("ใช้: npx tsx scripts/create-user.ts --login <อีเมลหรือชื่อผู้ใช้> --password <รหัสผ่าน> [--name ชื่อ] [--role owner|admin|agent]");
  process.exit(1);
}
if (values.password.length < 8) {
  console.error("รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร");
  process.exit(1);
}
if (!["owner", "admin", "agent"].includes(role)) {
  console.error("role ต้องเป็น owner, admin หรือ agent");
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

async function main() {
  const org = await prisma.organization.findFirst({ orderBy: { createdAt: "asc" } });
  if (!org) {
    console.error("ยังไม่มีองค์กรในระบบ — รัน scripts/create-owner.ts ก่อน");
    process.exit(1);
  }
  const passwordHash = await bcrypt.hash(values.password!, 10);
  const existing = await prisma.user.findUnique({ where: { email: login! } });
  if (existing) {
    await prisma.user.update({ where: { id: existing.id }, data: { passwordHash, role, active: true, name: values.name ?? existing.name } });
    await prisma.session.deleteMany({ where: { userId: existing.id } });
    console.log(`อัปเดตผู้ใช้ "${login}" แล้ว (บทบาท: ${role})`);
  } else {
    await prisma.user.create({ data: { orgId: org.id, email: login!, name: values.name ?? login!, role, passwordHash } });
    console.log(`สร้างผู้ใช้ "${login}" แล้ว (บทบาท: ${role}, องค์กร: ${org.name})`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
