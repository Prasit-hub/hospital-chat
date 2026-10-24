import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, handle, json, parseBody } from "@/lib/api";
import { currentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ownPatient } from "@/lib/scope";
import { his, hisRateLimit } from "@/lib/his";

const Body = z.object({
  hn: z.string().trim().max(20).optional(),
  nationalId: z
    .string()
    .trim()
    .transform((s) => s.replace(/\D/g, ""))
    .refine((s) => s.length === 13, "เลขบัตรประชาชนต้องมี 13 หลัก")
    .optional(),
  name: z.string().trim().min(2).max(120).optional(),
  phone: z.string().trim().min(9).max(20).optional(),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ระบุวันเกิด"),
});

const caseCode = (n: number) => `CASE-${10000 + n}`;

// ตรวจกับ HIS ว่าเป็นคนไข้ของโรงพยาบาลหรือไม่ — ต้องมีตัวระบุอย่างน้อย 2 อย่าง (วันเกิด + HN / เลขบัตร / ชื่อ+เบอร์)
export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const me = await currentUser();
  const own = await ownPatient(id, me);
  if (own.mergedIntoId) return apiError("แฟ้มนี้ถูกรวมไปแล้ว", 409);
  const body = await parseBody(req, Body);
  const { settings, client } = await his(me.orgId);

  let by: "hn" | "nationalId" | "name_phone";
  if (body.hn) by = "hn";
  else if (body.nationalId) {
    if (!settings.allowNationalId) return apiError("ยังไม่เปิดให้ค้นด้วยเลขบัตรประชาชน (ผู้ดูแลเปิดได้ที่ ตั้งค่า → เชื่อมต่อ HIS)", 403);
    by = "nationalId";
  } else if (body.name && body.phone) by = "name_phone";
  else return apiError("ระบุ HN หรือเลขบัตรประชาชน หรือชื่อ-นามสกุลพร้อมเบอร์โทร คู่กับวันเกิด", 400);

  // ค้นได้เฉพาะคนไข้ที่มีงานเปิดอยู่ (มีเหตุให้ค้น)
  const open = await prisma.case.findFirst({ where: { patientId: id, status: { not: "closed" } } });
  if (!open) return apiError("ค้นข้อมูล HIS ได้เฉพาะคนไข้ที่มีงานเปิดอยู่", 403);

  hisRateLimit(me.id);
  const q = { birthDate: body.birthDate, ...(by === "hn" && { hn: body.hn }), ...(by === "nationalId" && { nationalId: body.nationalId }), ...(by === "name_phone" && { name: body.name, phone: body.phone }) };
  const r = await client.match(q, { actingUser: me.email, purpose: caseCode(open.number) });
  await audit(me.orgId, me.id, "his.match", { type: "patient", id }, { by, result: r.result, caseId: open.id });

  // HN นี้อยู่ในแฟ้มอื่นของรวมแชทแล้วหรือไม่ (ต้องรวมแฟ้มแทนการผูกซ้ำ)
  const p = r.result === "match" ? r.patients[0] : undefined;
  const other = p ? await prisma.patient.findFirst({ where: { orgId: me.orgId, hn: p.hn, id: { not: id }, mergedIntoId: null }, select: { id: true, name: true } }) : null;
  return json({ ...r, conflict: other ?? undefined });
});
