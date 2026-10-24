import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, handle, json, parseBody } from "@/lib/api";
import { currentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { publish } from "@/lib/realtime";
import { ownPatient } from "@/lib/scope";
import { normHn } from "@/lib/patients";
import { HIS_VERIFY_METHOD, his, hisRateLimit } from "@/lib/his";
import { addInternal } from "@/lib/inbox/service";
import { profileTagInclude, uiPatient } from "@/lib/inbox/serialize";

const Body = z.object({
  hn: z.string().trim().min(1).max(20),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** เปลี่ยนชื่อในแฟ้มให้ตรงกับ HIS */
  useHisName: z.boolean().optional(),
  /** แฟ้มนี้มี HN อื่นอยู่แล้ว และเจ้าหน้าที่ยืนยันให้แทนที่ */
  replaceHn: z.boolean().optional(),
});

// ผูก HN จาก HIS กับแฟ้ม: ตรวจกับ HIS ซ้ำฝั่งเซิร์ฟเวอร์ (ไม่เชื่อค่าจากหน้าจอ) แล้วยืนยันตัวตนในงานที่เปิดอยู่
export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const me = await currentUser();
  const own = await ownPatient(id, me);
  if (own.mergedIntoId) return apiError("แฟ้มนี้ถูกรวมไปแล้ว", 409);
  const body = await parseBody(req, Body);
  const open = await prisma.case.findFirst({ where: { patientId: id, status: { not: "closed" } } });
  if (!open) return apiError("ผูก HN จาก HIS ได้เฉพาะคนไข้ที่มีงานเปิดอยู่", 403);

  const { client } = await his(me.orgId);
  hisRateLimit(me.id);
  const r = await client.match({ hn: body.hn, birthDate: body.birthDate }, { actingUser: me.email, purpose: `CASE-${10000 + open.number}` });
  const hp = r.result === "match" ? r.patients[0] : undefined;
  if (!hp) return apiError("HN และวันเกิดไม่ตรงกับ HIS", 409);
  if (hp.status === "merged") return json({ error: `HN นี้ถูกรวมใน HIS ไปที่ HN ${hp.mergedToHn} แล้ว — ตรวจด้วย HN ใหม่`, code: "his_merged", mergedToHn: hp.mergedToHn }, 409);
  if (hp.status === "deceased") return json({ error: "HIS ระบุว่าผู้ป่วยรายนี้เสียชีวิตแล้ว — ไม่ผูกแฟ้ม ให้ส่งต่อเวชระเบียนตรวจสอบ", code: "his_deceased" }, 409);

  const hn = normHn(hp.hn)!;
  const pt = await prisma.patient.findUniqueOrThrow({ where: { id } });
  if (pt.hn && pt.hn !== hn && !body.replaceHn)
    return json({ error: `แฟ้มนี้มี HN ${pt.hn} อยู่แล้ว — ยืนยันว่าจะเปลี่ยนเป็น ${hn}`, code: "hn_differs", currentHn: pt.hn }, 409);
  const other = await prisma.patient.findFirst({ where: { orgId: me.orgId, hn, id: { not: id } }, select: { id: true, name: true } });
  if (other) return json({ error: `HN ${hn} เป็นของแฟ้ม “${other.name}” อยู่แล้ว — ถ้าเป็นคนเดียวกันให้รวมแฟ้ม`, code: "hn_conflict", conflictPatientId: other.id }, 409);

  const now = new Date();
  const p = await prisma.patient.update({
    where: { id },
    data: { hn, birthDate: new Date(hp.birthDate), hisVerifiedAt: now, ...(body.useHisName && { name: hp.name }) },
    include: { tags: true, profileTags: profileTagInclude, contacts: { select: { id: true } } },
  });
  await prisma.case.update({ where: { id: open.id }, data: { verifiedAt: now, verifiedById: me.id, verifyMethod: HIS_VERIFY_METHOD } });
  await audit(me.orgId, me.id, "his.link", { type: "patient", id }, { caseId: open.id, replacedHn: !!(pt.hn && pt.hn !== hn), renamed: !!body.useHisName });
  await audit(me.orgId, me.id, "case.verify", { type: "patient", id }, { caseId: open.id, method: HIS_VERIFY_METHOD });

  const conv = await prisma.conversation.findFirst({
    where: { contact: { patientId: id } },
    orderBy: [{ lastCustomerMessageAt: { sort: "desc", nulls: "last" } }, { lastMessageAt: "desc" }],
  });
  if (conv) await addInternal(conv.id, "system", `${me.name} ยืนยันตัวตนคนไข้แล้ว (${HIS_VERIFY_METHOD})`, undefined, open.id);
  publish({ type: "patient", patientId: id });
  publish({ type: "case", caseId: open.id });
  return json(uiPatient(p));
});
