import { prisma } from "@/lib/db";
import { handle, json } from "@/lib/api";
import { currentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { publish } from "@/lib/realtime";
import { ownPatient } from "@/lib/scope";
import { hisCached, hisRateLimit, hisSummary } from "@/lib/his";

export const dynamic = "force-dynamic";

// นัดใน HIS + การมาโรงพยาบาลล่าสุด — ดูได้เมื่อ HN ตรวจกับ HIS แล้ว และยืนยันตัวตนคนไข้ในงานที่เปิดอยู่แล้ว
export const GET = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const me = await currentUser();
  const own = await ownPatient(id, me);
  const pid = own.mergedIntoId ?? id;
  const pt = await prisma.patient.findUniqueOrThrow({ where: { id: pid }, include: { appointments: true } });
  if (!pt.hn || !pt.hisVerifiedAt) return json({ error: "ยังไม่ได้ตรวจ HN กับ HIS", code: "not_linked" }, 409);
  const open = await prisma.case.findFirst({ where: { patientId: pid, status: { not: "closed" } } });
  if (!open) return json({ error: "ดูข้อมูล HIS ได้เฉพาะคนไข้ที่มีงานเปิดอยู่", code: "no_open_case" }, 403);
  if (!open.verifiedAt) return json({ error: "ยืนยันตัวตนคนไข้ในงานนี้ก่อน จึงจะดูนัดและการมาโรงพยาบาลได้", code: "not_verified" }, 403);

  const refresh = new URL(req.url).searchParams.get("refresh") === "1";
  if (refresh || !hisCached(me.orgId, pt.hn)) hisRateLimit(me.id);
  const s = await hisSummary(me.orgId, pt.hn, { actingUser: me.email, purpose: `CASE-${10000 + open.number}` }, refresh);
  if (!s.cached) await audit(me.orgId, me.id, "his.view", { type: "patient", id: pid }, { caseId: open.id });

  // คำขอนัดของรวมแชทที่ HIS ลงนัดแล้ว (HIS เก็บเลข APT ไว้ใน sourceRef) → ผูกเลขนัดและเปลี่ยนเป็น “ยืนยันแล้ว”
  const linked: string[] = [];
  for (const a of s.appointments) {
    if (!a.sourceRef || a.status === "cancelled") continue;
    const ours = pt.appointments.find((x) => `APT-${10000 + x.number}` === a.sourceRef);
    if (!ours || ours.hisAppointmentId === a.id) continue;
    await prisma.appointment.update({
      where: { id: ours.id },
      data: { hisAppointmentId: a.id, ...(ours.status === "requested" && { status: "confirmed" }) },
    });
    linked.push(ours.id);
  }
  if (linked.length) publish({ type: "patient", patientId: pid });

  return json({ hn: pt.hn, appointments: s.appointments, encounters: s.encounters, checkedAt: s.checkedAt, cached: s.cached, linked });
});
