// สร้างองค์กร + บัญชีเจ้าของคนแรก บนเซิร์ฟเวอร์จริง (ไม่ใส่ข้อมูลตัวอย่าง)
//
//   npx tsx scripts/create-owner.ts --org "ชื่อร้าน" --name "ชื่อคุณ" --email you@example.com
//
// บน Docker:
//   docker compose -f docker-compose.prod.yml run --rm migrate \
//     npx tsx scripts/create-owner.ts --org "ชื่อร้าน" --name "ชื่อคุณ" --email you@example.com
//
// รหัสผ่านจะถูกสุ่มและแสดงครั้งเดียว — เข้าระบบแล้วเปลี่ยนทันที
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const { values } = parseArgs({
  options: {
    org: { type: "string" },
    name: { type: "string" },
    email: { type: "string" },
  },
});

if (!values.org || !values.name || !values.email) {
  console.error('ใช้: npx tsx scripts/create-owner.ts --org "ชื่อร้าน" --name "ชื่อคุณ" --email you@example.com');
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const DEFAULT_TAGS = [
  { name: "ลูกค้าใหม่", color: "#3b82f6" },
  { name: "VIP", color: "#a855f7" },
  { name: "รอชำระเงิน", color: "#f59e0b" },
  { name: "ชำระแล้ว", color: "#10b981" },
  { name: "ส่งของแล้ว", color: "#64748b" },
];

async function main() {
  const email = values.email!.trim().toLowerCase();
  if (await prisma.user.findUnique({ where: { email } })) {
    console.error(`มีผู้ใช้ ${email} อยู่แล้ว — ถ้าลืมรหัสผ่าน ให้เจ้าของคนอื่นออกรหัสใหม่จากหน้า ตั้งค่า → ทีมและสิทธิ์`);
    process.exit(1);
  }
  const password = randomBytes(12).toString("base64url");
  let org = await prisma.organization.findFirst();
  if (!org) {
    org = await prisma.organization.create({
      data: {
        name: values.org!,
        settings: {
          welcome: { enabled: true, text: `สวัสดีค่ะ ขอบคุณที่ทัก ${values.org} นะคะ แอดมินจะรีบตอบกลับโดยเร็วค่ะ 🙏` },
          away: { enabled: false, text: "ขณะนี้อยู่นอกเวลาทำการ แอดมินจะตอบกลับโดยเร็วที่สุดค่ะ", start: "09:00", end: "18:00", days: [1, 2, 3, 4, 5] },
        },
        tags: { create: DEFAULT_TAGS },
      },
    });
  }
  await prisma.user.create({
    data: { orgId: org.id, name: values.name!, email, role: "owner", passwordHash: await bcrypt.hash(password, 10) },
  });
  console.log("\nสร้างบัญชีเจ้าของเรียบร้อย");
  console.log("  องค์กร :", org.name);
  console.log("  อีเมล  :", email);
  console.log("  รหัสผ่าน:", password, " ← แสดงครั้งเดียว เข้าระบบแล้วเปลี่ยนทันที\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
