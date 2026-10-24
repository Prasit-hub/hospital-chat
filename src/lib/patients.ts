import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { publish } from "@/lib/realtime";
import type { MergeCandidate } from "@/lib/types";

// แฟ้มคนไข้: หาแฟ้มที่อาจเป็นคนเดียวกัน, รวมแฟ้ม, ยกเลิกการรวม, แยกบัญชีออก

export class PatientError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

/* ------------------------------------------------------------------ */
/* การเทียบข้อมูล                                                        */
/* ------------------------------------------------------------------ */

/** เบอร์โทร → ตัวเลข 9 หลักท้าย (รองรับ +66 / 0) */
export function normPhone(v?: string | null) {
  if (!v) return null;
  let d = v.replace(/\D/g, "");
  if (d.startsWith("66")) d = "0" + d.slice(2);
  return d.length >= 9 ? d.slice(-9) : null;
}

export function normEmail(v?: string | null) {
  const e = v?.trim().toLowerCase();
  return e && e.includes("@") ? e : null;
}

export function normHn(v?: string | null) {
  const h = v?.replace(/[\s-]/g, "").toUpperCase();
  return h || null;
}

const PREFIX = /^(คุณ|นางสาว|นาง|นาย|น\.ส\.|ด\.ช\.|ด\.ญ\.|mr\.?|mrs\.?|ms\.?|miss)\s*/i;

/** ชื่อ → ตัดคำนำหน้า ช่องว่าง เครื่องหมาย (ใช้เทียบหยาบๆ เท่านั้น) */
export function normName(v?: string | null) {
  if (!v) return null;
  const n = v.trim().replace(PREFIX, "").toLowerCase().replace(/[\s._\-()]/g, "");
  return n.length >= 4 ? n : null;
}

type Lite = { id: string; hn: string | null; name: string; phone: string | null; email: string | null; contactNames: string[] };

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * หาคู่แฟ้มที่อาจเป็นคนเดียวกัน (ไม่รวมคู่ที่เจ้าหน้าที่ยืนยันแล้วว่าไม่ใช่)
 * เกณฑ์: HN / เบอร์โทร / อีเมล ตรงกัน = น่าเชื่อถือ, ชื่อตรงกันอย่างเดียว = ต้องตรวจเพิ่ม
 * หมายเหตุ: คำนวณในหน่วยความจำ เหมาะกับข้อมูลระดับหลักหมื่นแฟ้ม — ถ้ามากกว่านั้นควรย้ายไปทำดัชนีในฐานข้อมูล
 */
export async function findCandidates(orgId: string, onlyPatientId?: string): Promise<MergeCandidate[]> {
  const [rows, dismissed] = await Promise.all([
    prisma.patient.findMany({
      where: { orgId, mergedIntoId: null },
      select: { id: true, hn: true, name: true, phone: true, email: true, contacts: { select: { name: true } } },
    }),
    prisma.mergeDismissal.findMany({ where: { orgId }, select: { aId: true, bId: true } }),
  ]);
  const skip = new Set(dismissed.map((d) => pairKey(d.aId, d.bId)));
  const patients: Lite[] = rows.map((r) => ({ ...r, contactNames: r.contacts.map((c) => c.name) }));

  const index = new Map<string, string[]>();
  const add = (k: string | null, id: string) => {
    if (!k) return;
    const arr = index.get(k) ?? [];
    if (!arr.includes(id)) arr.push(id);
    index.set(k, arr);
  };
  for (const p of patients) {
    add(normHn(p.hn) && "hn:" + normHn(p.hn), p.id);
    add(normPhone(p.phone) && "ph:" + normPhone(p.phone), p.id);
    add(normEmail(p.email) && "em:" + normEmail(p.email), p.id);
    for (const n of new Set([p.name, ...p.contactNames].map(normName))) add(n && "nm:" + n, p.id);
  }

  const byId = new Map(patients.map((p) => [p.id, p]));
  const pairs = new Map<string, MergeCandidate>();
  const label = { hn: "HN ตรงกัน", ph: "เบอร์โทรตรงกัน", em: "อีเมลตรงกัน", nm: "ชื่อตรงกัน" } as const;
  const weight = { hn: 100, ph: 60, em: 60, nm: 25 } as const;

  for (const [key, ids] of index) {
    if (ids.length < 2 || ids.length > 20) continue; // กลุ่มใหญ่ผิดปกติ (เช่นชื่อซ้ำทั่วไป) ไม่แนะนำ
    const kind = key.slice(0, 2) as keyof typeof label;
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        const [a, b] = ids[i] < ids[j] ? [ids[i], ids[j]] : [ids[j], ids[i]];
        if (onlyPatientId && a !== onlyPatientId && b !== onlyPatientId) continue;
        const k = pairKey(a, b);
        if (skip.has(k)) continue;
        const c = pairs.get(k) ?? { aId: a, bId: b, score: 0, reasons: [] };
        if (!c.reasons.includes(label[kind])) {
          c.reasons.push(label[kind]);
          c.score += weight[kind];
        }
        pairs.set(k, c);
      }
  }

  return [...pairs.values()]
    .map((c) => {
      const A = byId.get(c.aId)!;
      const B = byId.get(c.bId)!;
      const ha = normHn(A.hn);
      const hb = normHn(B.hn);
      return ha && hb && ha !== hb ? { ...c, blocked: `HN ไม่ตรงกัน (${A.hn} / ${B.hn})` } : c;
    })
    .sort((x, y) => y.score - x.score);
}

/* ------------------------------------------------------------------ */
/* รวมแฟ้ม                                                               */
/* ------------------------------------------------------------------ */

export const MERGE_FIELDS = ["name", "hn", "birthDate", "phone", "email"] as const;
export type MergeField = (typeof MERGE_FIELDS)[number];

export interface MergeInput {
  survivorId: string;
  mergedId: string;
  /** เลือกค่าจากแฟ้มไหน เมื่อสองแฟ้มมีค่าต่างกัน (ไม่ระบุ = ใช้ของแฟ้มหลัก) */
  pick?: Partial<Record<MergeField, "survivor" | "merged">>;
  reason?: string;
}

export async function mergePatients(orgId: string, actorId: string, input: MergeInput) {
  if (input.survivorId === input.mergedId) throw new PatientError("เลือกแฟ้มเดียวกัน");

  const result = await prisma.$transaction(async (tx) => {
    const load = (id: string) =>
      tx.patient.findFirst({
        where: { id, orgId },
        include: {
          tags: { select: { id: true } },
          contacts: { select: { id: true } },
          appointments: { select: { id: true } },
          cases: { select: { id: true, status: true } },
          profileTags: { select: { id: true, defId: true } },
        },
      });
    const [S, M] = await Promise.all([load(input.survivorId), load(input.mergedId)]);
    if (!S || !M) throw new PatientError("ไม่พบแฟ้มคนไข้", 404);
    if (S.mergedIntoId || M.mergedIntoId) throw new PatientError("แฟ้มนี้ถูกรวมไปแล้ว รีเฟรชหน้าจอแล้วลองใหม่", 409);
    const hs = normHn(S.hn);
    const hm = normHn(M.hn);
    if (hs && hm && hs !== hm) throw new PatientError(`HN ไม่ตรงกัน (${S.hn} / ${M.hn}) — ไม่สามารถรวมได้ ตรวจสอบกับเวชระเบียนก่อน`, 409);

    const choose = <K extends MergeField>(f: K) => {
      const sv = S[f];
      const mv = M[f];
      if (sv == null || sv === "") return mv;
      if (mv == null || mv === "") return sv;
      return input.pick?.[f] === "merged" ? mv : sv;
    };

    const before = {
      name: S.name,
      hn: S.hn,
      birthDate: S.birthDate?.toISOString().slice(0, 10) ?? null,
      phone: S.phone,
      email: S.email,
      note: S.note,
      hisVerifiedAt: S.hisVerifiedAt?.toISOString() ?? null,
    };
    const newTags = M.tags.map((t) => t.id).filter((id) => !S.tags.some((x) => x.id === id));

    // งาน: ถ้าทั้งสองแฟ้มมีงานเปิดอยู่ → ปิดงานของแฟ้มที่ถูกรวม (ผล "รวมกับงานอื่น") ข้อความใหม่จะเข้างานของแฟ้มหลัก
    const sOpen = S.cases.find((c) => c.status !== "closed");
    const mOpen = M.cases.find((c) => c.status !== "closed");
    let closedByMerge: { caseId: string; status: string } | undefined;
    if (sOpen && mOpen) {
      await tx.case.update({
        where: { id: mOpen.id },
        data: { status: "closed", closedAt: new Date(), closedById: actorId, outcome: "merged", closeNote: "ปิดอัตโนมัติจากการรวมแฟ้ม" },
      });
      await tx.caseEvent.create({ data: { caseId: mOpen.id, type: "closed", actorId, meta: { outcome: "merged" } } });
      closedByMerge = { caseId: mOpen.id, status: mOpen.status };
    }
    await tx.case.updateMany({ where: { patientId: M.id }, data: { patientId: S.id } });
    // แท็กคนไข้: ย้ายเฉพาะที่แฟ้มหลักยังไม่มี
    const movedProfileTags = M.profileTags.filter((t) => !S.profileTags.some((x) => x.defId === t.defId)).map((t) => t.id);
    await tx.patientProfileTag.updateMany({ where: { id: { in: movedProfileTags } }, data: { patientId: S.id } });

    // ปล่อย HN ของแฟ้มที่ถูกรวมก่อน (HN ต้องไม่ซ้ำในองค์กร)
    await tx.patient.update({ where: { id: M.id }, data: { mergedIntoId: S.id, hn: null } });
    await tx.contact.updateMany({ where: { patientId: M.id }, data: { patientId: S.id } });
    await tx.appointment.updateMany({ where: { patientId: M.id }, data: { patientId: S.id } });
    // ผลการตรวจกับ HIS ใช้ได้ต่อเมื่อ HN และวันเกิดที่เลือกมาจากแฟ้มเดียวกันที่ตรวจไว้แล้ว
    const hnPick = choose("hn");
    const bdPick = choose("birthDate") as Date | null;
    const sameAs = (P: typeof S) => P.hisVerifiedAt && P.hn === hnPick && P.birthDate?.getTime() === bdPick?.getTime();
    const hisVerifiedAt = sameAs(S) ? S.hisVerifiedAt : sameAs(M) ? M.hisVerifiedAt : null;
    await tx.patient.update({
      where: { id: S.id },
      data: {
        name: choose("name") ?? S.name,
        hn: hnPick,
        birthDate: bdPick,
        hisVerifiedAt,
        phone: choose("phone"),
        email: choose("email"),
        note: [S.note, M.note].filter(Boolean).join("\n—\n") || null,
        tags: { connect: newTags.map((id) => ({ id })) },
      },
    });

    const ev = await tx.mergeEvent.create({
      data: {
        orgId,
        survivorId: S.id,
        mergedId: M.id,
        contactIds: M.contacts.map((c) => c.id),
        tagIds: newTags,
        appointmentIds: M.appointments.map((a) => a.id),
        caseIds: M.cases.map((c) => c.id),
        profileTagIds: movedProfileTags,
        meta: closedByMerge ? { closedByMerge } : {},
        survivorBefore: { ...before, mergedHn: M.hn, mergedHisVerifiedAt: M.hisVerifiedAt?.toISOString() ?? null },
        reason: input.reason || null,
        actorId,
      },
    });
    await audit(orgId, actorId, "patient.merge", { type: "patient", id: S.id }, { mergedId: M.id, eventId: ev.id, contacts: M.contacts.length }, tx);
    return ev;
  });

  publish({ type: "patients_changed" });
  return result;
}

export async function undoMerge(orgId: string, actorId: string, eventId: string) {
  await prisma.$transaction(async (tx) => {
    const ev = await tx.mergeEvent.findFirst({ where: { id: eventId, orgId } });
    if (!ev) throw new PatientError("ไม่พบประวัติการรวมนี้", 404);
    if (ev.undoneAt) throw new PatientError("ยกเลิกการรวมนี้ไปแล้ว", 409);
    const S = await tx.patient.findUniqueOrThrow({ where: { id: ev.survivorId } });
    if (S.mergedIntoId) throw new PatientError("แฟ้มหลักถูกรวมต่อไปยังแฟ้มอื่นแล้ว — ยกเลิกการรวมครั้งหลังก่อน", 409);

    const b = ev.survivorBefore as {
      name: string;
      hn: string | null;
      birthDate: string | null;
      phone: string | null;
      email: string | null;
      note: string | null;
      mergedHn: string | null;
      hisVerifiedAt?: string | null;
      mergedHisVerifiedAt?: string | null;
    };
    await tx.patient.update({
      where: { id: S.id },
      data: {
        name: b.name,
        hn: b.hn,
        birthDate: b.birthDate ? new Date(b.birthDate) : null,
        phone: b.phone,
        email: b.email,
        note: b.note,
        hisVerifiedAt: b.hisVerifiedAt ? new Date(b.hisVerifiedAt) : null,
        tags: { disconnect: ev.tagIds.map((id) => ({ id })) },
      },
    });
    await tx.patient.update({ where: { id: ev.mergedId }, data: { mergedIntoId: null, hn: b.mergedHn, hisVerifiedAt: b.mergedHisVerifiedAt ? new Date(b.mergedHisVerifiedAt) : null } });
    // ย้ายกลับเฉพาะบัญชีที่ยังอยู่ในแฟ้มหลัก (ถ้าถูกแยกออกไปแล้วจะไม่แตะ)
    await tx.contact.updateMany({ where: { id: { in: ev.contactIds }, patientId: S.id }, data: { patientId: ev.mergedId } });
    await tx.appointment.updateMany({ where: { id: { in: ev.appointmentIds }, patientId: S.id }, data: { patientId: ev.mergedId } });
    await tx.patientProfileTag.updateMany({ where: { id: { in: ev.profileTagIds }, patientId: S.id }, data: { patientId: ev.mergedId } });
    await tx.case.updateMany({ where: { id: { in: ev.caseIds }, patientId: S.id }, data: { patientId: ev.mergedId } });
    // งานที่ถูกปิดเพราะการรวม → เปิดคืนสถานะเดิม
    const cbm = (ev.meta as { closedByMerge?: { caseId: string; status: string } })?.closedByMerge;
    if (cbm) {
      const c = await tx.case.findUnique({ where: { id: cbm.caseId } });
      if (c && c.outcome === "merged" && !(await tx.case.count({ where: { patientId: ev.mergedId, status: { not: "closed" } } }))) {
        await tx.case.update({
          where: { id: c.id },
          data: { status: cbm.status as "queued", closedAt: null, closedById: null, outcome: null, closeNote: null },
        });
        await tx.caseEvent.create({ data: { caseId: c.id, type: "reopened", actorId, meta: { by: "unmerge" } } });
      }
    }
    await tx.mergeEvent.update({ where: { id: ev.id }, data: { undoneAt: new Date(), undoneById: actorId } });
    // ยกเลิกแล้วไม่ต้องแนะนำคู่นี้อีก
    const [aId, bId] = [S.id, ev.mergedId].sort();
    await tx.mergeDismissal.upsert({ where: { aId_bId: { aId, bId } }, create: { orgId, aId, bId, actorId }, update: {} });
    await audit(orgId, actorId, "patient.unmerge", { type: "patient", id: S.id }, { mergedId: ev.mergedId, eventId: ev.id }, tx);
  });
  publish({ type: "patients_changed" });
}

/** แยกบัญชีช่องทางหนึ่งออกเป็นแฟ้มใหม่ (กรณีรวมผิดคน) */
export async function splitContact(orgId: string, actorId: string, contactId: string) {
  const created = await prisma.$transaction(async (tx) => {
    const c = await tx.contact.findFirst({ where: { id: contactId, orgId }, include: { patient: { include: { contacts: { select: { id: true } } } } } });
    if (!c) throw new PatientError("ไม่พบบัญชีนี้", 404);
    if (c.patient.contacts.length < 2) throw new PatientError("แฟ้มนี้มีบัญชีเดียว แยกออกไม่ได้");
    const p = await tx.patient.create({ data: { orgId, name: c.name, avatarColor: c.avatarColor } });
    await tx.contact.update({ where: { id: c.id }, data: { patientId: p.id } });
    const [aId, bId] = [p.id, c.patientId].sort();
    await tx.mergeDismissal.create({ data: { orgId, aId, bId, actorId } });
    await audit(orgId, actorId, "patient.split_contact", { type: "patient", id: c.patientId }, { contactId: c.id, newPatientId: p.id }, tx);
    return p;
  });
  publish({ type: "patients_changed" });
  return created;
}

export async function dismissPair(orgId: string, actorId: string, a: string, b: string) {
  const n = await prisma.patient.count({ where: { id: { in: [a, b] }, orgId } });
  if (n !== 2) throw new PatientError("ไม่พบแฟ้มคนไข้", 404);
  const [aId, bId] = [a, b].sort();
  await prisma.mergeDismissal.upsert({ where: { aId_bId: { aId, bId } }, create: { orgId, aId, bId, actorId }, update: {} });
  await audit(orgId, actorId, "patient.not_duplicate", { type: "patient", id: aId }, { otherId: bId });
}
