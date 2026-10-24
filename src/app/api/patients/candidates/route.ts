import { prisma } from "@/lib/db";
import { handle, json } from "@/lib/api";
import { currentUser } from "@/lib/auth";
import { findCandidates } from "@/lib/patients";
import { uiContact, uiPatient } from "@/lib/inbox/serialize";
import { patientWhere, visibilityFor } from "@/lib/visibility";

export const dynamic = "force-dynamic";

// รายการแนะนำให้รวมทั้งหมด (หน้า คนไข้ → แนะนำให้รวม)
export const GET = handle(async () => {
  const me = await currentUser();
  const v = await visibilityFor(me);
  const all = await findCandidates(me.orgId);
  const ids = [...new Set(all.flatMap((c) => [c.aId, c.bId]))];
  const patients = await prisma.patient.findMany({
    where: { id: { in: ids }, ...patientWhere(v) },
    include: { tags: true, contacts: true, _count: { select: { appointments: true } } },
  });
  // เห็นแชทตามแผนก: แสดงเฉพาะคู่ที่เห็นทั้งสองแฟ้ม
  const seen = new Set(patients.map((p) => p.id));
  const candidates = all.filter((c) => seen.has(c.aId) && seen.has(c.bId));
  return json({
    candidates,
    patients: patients.map(uiPatient),
    contacts: patients.flatMap((p) => p.contacts.map(uiContact)),
  });
});
