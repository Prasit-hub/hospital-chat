import { prisma } from "@/lib/db";
import { handle, json } from "@/lib/api";
import { currentUser } from "@/lib/auth";
import {
  caseInclude,
  profileTagInclude,
  uiAgent,
  uiAppointment,
  uiCase,
  uiChannel,
  uiContact,
  uiConversation,
  uiDepartment,
  uiPatient,
  uiTag,
  uiTagDef,
} from "@/lib/inbox/serialize";
import { findCandidates } from "@/lib/patients";
import { caseSettings } from "@/lib/cases";
import { hisSettings } from "@/lib/his";
import { caseWhere, patientWhere, visibilityFor } from "@/lib/visibility";

export const dynamic = "force-dynamic";

// ข้อมูลตั้งต้นของหน้าแชท: งานที่ยังไม่ปิดทั้งหมด + งานที่ปิดใน 7 วัน (โหลดครั้งเดียว แล้วอัปเดตผ่าน /api/events)
export const GET = handle(async () => {
  const me = await currentUser();
  const orgId = me.orgId;
  const since = new Date(Date.now() - 7 * 86_400_000);
  const v = await visibilityFor(me);
  const [channels, users, tags, quickReplies, departments, candidates, cases, tagDefs, settings] = await Promise.all([
    prisma.channel.findMany({ where: { orgId }, orderBy: { createdAt: "asc" } }),
    prisma.user.findMany({ where: { orgId, active: true }, orderBy: { createdAt: "asc" } }),
    prisma.tag.findMany({ where: { orgId }, orderBy: { name: "asc" } }),
    prisma.quickReply.findMany({ where: { orgId }, orderBy: { shortcut: "asc" } }),
    prisma.department.findMany({ where: { orgId }, orderBy: { name: "asc" } }),
    findCandidates(orgId),
    prisma.case.findMany({
      where: { orgId, AND: [{ OR: [{ status: { not: "closed" } }, { closedAt: { gte: since } }] }, caseWhere(v)] },
      orderBy: { openedAt: "desc" },
      take: 500,
      include: caseInclude,
    }),
    prisma.profileTagDef.findMany({ where: { orgId, active: true }, orderBy: [{ category: "asc" }, { label: "asc" }] }),
    caseSettings(orgId),
  ]);

  const patientIds = [...new Set(cases.map((c) => c.patientId))];
  const patients = await prisma.patient.findMany({
    where: { id: { in: patientIds } },
    include: {
      tags: true,
      profileTags: profileTagInclude,
      contacts: { include: { conversations: { include: { contact: { select: { patientId: true } } } } } },
      appointments: { orderBy: { createdAt: "desc" } },
    },
  });

  // จำนวนแฟ้มที่อาจซ้ำ ต่อคนไข้ (ไม่นับคู่ที่ HN ไม่ตรงกัน)
  const dupCount: Record<string, number> = {};
  // เห็นแชทตามแผนก: นับเฉพาะคู่ที่ผู้ใช้เห็นทั้งสองแฟ้ม
  const seen = v.all
    ? null
    : new Set((await prisma.patient.findMany({ where: { id: { in: candidates.flatMap((c) => [c.aId, c.bId]) }, ...patientWhere(v) }, select: { id: true } })).map((p) => p.id));
  for (const c of candidates)
    if (!c.blocked && (!seen || (seen.has(c.aId) && seen.has(c.bId)))) for (const id of [c.aId, c.bId]) dupCount[id] = (dupCount[id] ?? 0) + 1;

  return json({
    meId: me.id,
    me: { departmentId: me.departmentId ?? undefined, role: me.role, seesAll: v.all },
    channels: channels.map(uiChannel),
    agents: users.map((u) => ({ ...uiAgent(u), departmentId: u.departmentId ?? undefined })),
    tags: tags.map(uiTag),
    quickReplies: quickReplies.map((q) => ({ id: q.id, shortcut: q.shortcut, title: q.title, text: q.text })),
    departments: departments.map((d) => ({ ...uiDepartment(d), slaMinutes: d.transferSlaMinutes ?? undefined })),
    profileTagDefs: tagDefs.map(uiTagDef),
    caseSettings: settings,
    his: await hisSettings(orgId).then((h) => ({ mode: h.mode, allowNationalId: !!h.allowNationalId })),
    cases: cases.map(uiCase),
    patients: patients.map(uiPatient),
    contacts: patients.flatMap((p) => p.contacts.map(uiContact)),
    conversations: patients.flatMap((p) => p.contacts.flatMap((c) => c.conversations.map(uiConversation))),
    appointments: patients.flatMap((p) => p.appointments.map(uiAppointment)),
    duplicates: dupCount,
  });
});
