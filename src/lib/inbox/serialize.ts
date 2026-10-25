import type { Appointment, Case, CaseTransfer, Channel, Contact, Conversation, Department, Message, Patient, PatientProfileTag, ProfileTagDef, Tag, User } from "@/generated/prisma/client";
import { toLocalIso } from "@/lib/time";
import type * as UI from "@/lib/types";

// แปลงข้อมูลจากฐานข้อมูลเป็นรูปแบบที่หน้าจอใช้ (src/lib/types.ts)

export function uiChannel(c: Channel): UI.Channel {
  return { id: c.id, type: c.type, name: c.name, connected: c.connected, followers: c.followers };
}

export function uiAgent(u: User): UI.Agent {
  const online = !!u.lastSeenAt && Date.now() - u.lastSeenAt.getTime() < 5 * 60_000;
  return { id: u.id, name: u.name, role: u.role, online, color: u.color };
}

export function uiTag(t: Tag): UI.Tag {
  return { id: t.id, name: t.name, color: t.color };
}

export function uiContact(c: Contact): UI.Contact {
  return {
    id: c.id,
    name: c.name,
    avatarColor: c.avatarColor,
    pictureUrl: c.pictureUrl ?? undefined,
    channelId: c.channelId,
    patientId: c.patientId,
    createdAt: toLocalIso(c.createdAt).slice(0, 10),
  };
}

const dateOnly = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : undefined);

type PT = PatientProfileTag & { def: ProfileTagDef };
export const profileTagInclude = { orderBy: { addedAt: "asc" as const }, include: { def: true } };

export function uiProfileTag(t: PT): UI.PatientProfileTag {
  return {
    id: t.id,
    defId: t.defId,
    category: t.def.category,
    label: t.def.label,
    note: t.note ?? undefined,
    addedById: t.addedById ?? undefined,
    addedAt: toLocalIso(t.addedAt),
  };
}

export function uiTagDef(d: ProfileTagDef): UI.ProfileTagDef {
  return { id: d.id, category: d.category, label: d.label, active: d.active, suggested: d.suggested, blocksBroadcast: d.blocksBroadcast };
}

export function uiPatient(p: Patient & { tags: Tag[]; contacts: { id: string }[]; profileTags?: PT[] }): UI.Patient {
  return {
    id: p.id,
    hn: p.hn ?? undefined,
    hisVerifiedAt: iso(p.hisVerifiedAt),
    name: p.name,
    birthDate: dateOnly(p.birthDate),
    phone: p.phone ?? undefined,
    email: p.email ?? undefined,
    note: p.note ?? undefined,
    avatarColor: p.avatarColor,
    tagIds: p.tags.map((t) => t.id),
    contactIds: p.contacts.map((c) => c.id),
    profileTags: (p.profileTags ?? []).map(uiProfileTag),
    createdAt: toLocalIso(p.createdAt).slice(0, 10),
  };
}

export function uiDepartment(d: Department): UI.Department {
  return { id: d.id, name: d.name, color: d.color };
}

export function uiConversation(c: Conversation & { contact: { patientId: string } }): UI.Conversation {
  return {
    id: c.id,
    contactId: c.contactId,
    channelId: c.channelId,
    unread: c.unread,
    lastMessageAt: toLocalIso(c.lastMessageAt),
    lastMessage: c.lastMessage,
    source: c.source,
    lastCustomerMessageAt: c.lastCustomerMessageAt ? toLocalIso(c.lastCustomerMessageAt) : undefined,
    patientId: c.contact.patientId,
  };
}

const iso = (d: Date | null) => (d ? toLocalIso(d) : undefined);

export function uiTransfer(t: CaseTransfer): UI.CaseTransfer {
  return {
    id: t.id,
    fromUserId: t.fromUserId ?? undefined,
    fromDeptId: t.fromDeptId ?? undefined,
    toDeptId: t.toDeptId ?? undefined,
    reason: t.reason,
    doneNote: t.doneNote ?? undefined,
    createdAt: toLocalIso(t.createdAt),
    acceptedAt: iso(t.acceptedAt),
    acceptedById: t.acceptedById ?? undefined,
    returnedAt: iso(t.returnedAt),
    returnReason: t.returnReason ?? undefined,
    recalledAt: iso(t.recalledAt),
  };
}

/** include ที่ใช้คู่กับ uiCase: การโอนล่าสุด 1 รายการ */
export const caseInclude = { transfers: { orderBy: { createdAt: "desc" as const }, take: 1 } };

export function uiCase(c: Case & { transfers?: CaseTransfer[] }): UI.Case {
  const last = c.transfers?.[0];
  const pending = last && !last.acceptedAt && !last.returnedAt && !last.recalledAt ? last : undefined;
  return {
    id: c.id,
    code: `CASE-${10000 + c.number}`,
    patientId: c.patientId,
    status: c.status,
    ownerId: c.ownerId ?? undefined,
    departmentId: c.departmentId ?? undefined,
    category: c.category ?? undefined,
    urgent: c.urgent,
    urgentReason: c.urgentReason ?? undefined,
    verified: c.verifiedAt ? { at: toLocalIso(c.verifiedAt), byId: c.verifiedById ?? undefined, method: c.verifyMethod ?? "" } : undefined,
    openedAt: toLocalIso(c.openedAt),
    acceptedAt: iso(c.acceptedAt),
    waitingSince: iso(c.waitingSince),
    closedAt: iso(c.closedAt),
    closedById: c.closedById ?? undefined,
    outcome: c.outcome ?? undefined,
    closeNote: c.closeNote ?? undefined,
    pendingTransfer: pending ? uiTransfer(pending) : undefined,
    lastTransfer: last ? uiTransfer(last) : undefined,
  };
}

export function uiMessage(m: Message): UI.Message {
  return {
    id: m.id,
    conversationId: m.conversationId,
    caseId: m.caseId ?? undefined,
    from: m.sender,
    agentId: m.agentId ?? undefined,
    kind: m.kind,
    text: m.text,
    imageUrl: m.mediaUrl ?? undefined,
    subject: m.subject ?? undefined,
    at: toLocalIso(m.createdAt),
    read: m.status === "read",
    status: m.status,
    error: m.error ?? undefined,
  };
}

export function uiAppointment(a: Appointment): UI.Appointment {
  return {
    id: a.id,
    code: `APT-${10000 + a.number}`,
    patientId: a.patientId,
    departmentId: a.departmentId ?? undefined,
    doctor: a.doctor ?? undefined,
    date: dateOnly(a.date),
    slot: (["morning", "afternoon"].includes(a.slot) ? a.slot : "any") as UI.Appointment["slot"],
    reason: a.reason ?? undefined,
    caseId: a.caseId ?? undefined,
    hisAppointmentId: a.hisAppointmentId ?? undefined,
    status: a.status,
    createdAt: toLocalIso(a.createdAt).slice(0, 10),
  };
}
