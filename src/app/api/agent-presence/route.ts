import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, handle, json, parseBody } from "@/lib/api";
import { currentUser, requireRole } from "@/lib/auth";
import { publish } from "@/lib/realtime";

export const dynamic = "force-dynamic";

// เฉพาะผู้ใช้บทบาท "เจ้าหน้าที่ตอบแชท" (agent) เท่านั้นที่เปิด/ปิด Agent รับสายเองได้
// (เจ้าของ/ผู้ดูแลไม่ได้ลงเวลารับสาย จึงไม่มีสิทธิ์เปิด/ปิดของตัวเองในหน้านี้)

/** สถานะของฉัน + ใครออนไลน์อยู่บ้างในองค์กร (ใช้เตือนก่อนแย่งเลขต่อ) */
export const GET = handle(async () => {
  const me = await currentUser();
  const [mine, orgOnline] = await Promise.all([
    prisma.agentPresence.findUnique({ where: { userId: me.id } }),
    prisma.agentPresence.findMany({
      where: { orgId: me.orgId, online: true },
      include: { user: { select: { id: true, name: true } } },
    }),
  ]);
  return json({
    mine: mine ? { extension: mine.extension, online: mine.online } : null,
    online: orgOnline.map((p) => ({ userId: p.userId, userName: p.user.name, extension: p.extension })),
  });
});

const Open = z.object({
  extension: z
    .string()
    .trim()
    .min(2, "กรุณากรอกเลขต่อ")
    .max(20)
    .regex(/^[0-9*#]+$/, "เลขต่อกรอกได้เฉพาะตัวเลข"),
  /** ยืนยันแย่งเลขต่อที่มีคนเปิดอยู่แล้ว */
  force: z.boolean().optional(),
});

/** เปิด Agent — ผูกผู้ใช้คนนี้กับเลขต่อที่ระบุ */
export const POST = handle(async (req: Request) => {
  const me = await requireRole(["agent"]);
  const { extension, force } = await parseBody(req, Open);

  const holder = await prisma.agentPresence.findFirst({
    where: { orgId: me.orgId, extension, online: true, userId: { not: me.id } },
    include: { user: { select: { id: true, name: true } } },
  });
  if (holder && !force) {
    return apiError(`เลขต่อ ${extension} มี ${holder.user.name} เปิดอยู่ — ต้องการแย่งสิทธิ์หรือไม่`, 409);
  }

  const row = await prisma.agentPresence.upsert({
    where: { userId: me.id },
    create: { orgId: me.orgId, userId: me.id, extension, online: true },
    update: { extension, online: true },
  });

  // ถ้าแย่งมาจากคนอื่น ต้องปิด Agent ของคนเดิมด้วย แล้วแจ้งให้หน้าจอของเขาปิดตามจริง
  if (holder) {
    await prisma.agentPresence.update({ where: { userId: holder.userId }, data: { online: false } });
    publish({ type: "agent_presence", userId: holder.userId, online: false });
  }
  publish({ type: "agent_presence", userId: me.id, online: true, extension: row.extension });
  return json({ extension: row.extension, online: true });
});

/** ปิด Agent */
export const DELETE = handle(async () => {
  const me = await requireRole(["agent"]);
  await prisma.agentPresence.upsert({
    where: { userId: me.id },
    create: { orgId: me.orgId, userId: me.id, extension: "", online: false },
    update: { online: false },
  });
  publish({ type: "agent_presence", userId: me.id, online: false });
  return json({ online: false });
});
