import { prisma } from "@/lib/db";
import { findCandidates } from "@/lib/patients";
import { caseWhere, patientWhere, type Visibility } from "@/lib/visibility";
import { caseInclude, profileTagInclude, uiAppointment, uiCase, uiContact, uiConversation, uiPatient } from "@/lib/inbox/serialize";

// ข้อมูลชุดเดียวของคนไข้ 1 คน (แฟ้ม + บัญชีช่องทาง + ห้องแชท + นัด + งานที่เปิดอยู่/ล่าสุด) — ใช้ตอบเหตุการณ์ realtime

export async function patientBundle(orgId: string, patientId: string, v: Visibility = { all: true }) {
  const p = await prisma.patient.findUniqueOrThrow({
    where: { id: patientId },
    include: {
      tags: true,
      profileTags: profileTagInclude,
      contacts: { include: { conversations: { include: { contact: { select: { patientId: true } } } } } },
      appointments: { orderBy: { createdAt: "desc" } },
    },
  });
  const current =
    (await prisma.case.findFirst({ where: { patientId, status: { not: "closed" }, ...caseWhere(v) }, include: caseInclude })) ??
    (await prisma.case.findFirst({ where: { patientId, ...caseWhere(v) }, orderBy: { openedAt: "desc" }, include: caseInclude }));
  let dup = (await findCandidates(orgId, patientId)).filter((x) => !x.blocked);
  // แฟ้มที่อาจซ้ำ: นับเฉพาะแฟ้มที่ผู้ใช้มองเห็น
  if (!v.all && dup.length) {
    const ids = dup.map((x) => (x.aId === patientId ? x.bId : x.aId));
    const seen = new Set((await prisma.patient.findMany({ where: { id: { in: ids }, ...patientWhere(v) }, select: { id: true } })).map((p) => p.id));
    dup = dup.filter((x) => seen.has(x.aId === patientId ? x.bId : x.aId));
  }
  const duplicates: Record<string, number> = { [patientId]: dup.length };
  for (const x of dup) {
    const other = x.aId === patientId ? x.bId : x.aId;
    duplicates[other] = Math.max(1, duplicates[other] ?? 0);
  }
  return {
    duplicates,
    patient: uiPatient(p),
    contacts: p.contacts.map(uiContact),
    conversations: p.contacts.flatMap((c) => c.conversations.map(uiConversation)),
    appointments: p.appointments.map(uiAppointment),
    case: current ? uiCase(current) : undefined,
  };
}
