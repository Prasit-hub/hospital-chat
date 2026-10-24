import { Prisma, type Case, type User } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { publish } from "@/lib/realtime";
import { audit } from "@/lib/audit";

// งาน (Case): 1 เรื่องที่คนไข้ติดต่อ — รับงาน รอคนไข้ โอนแผนก ตีกลับ ดึงกลับ ปิดงาน เปิดใหม่

type Tx = Prisma.TransactionClient;

export class CaseError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export interface CaseSettings {
  /** รอคนไข้ตอบเกินกี่วันแล้วปิดงานอัตโนมัติ */
  autoCloseDays: number;
  /** เปิดงานที่ปิดแล้วอีกครั้งได้ภายในกี่วัน */
  reopenDays: number;
  /** เตือนเมื่องานที่โอนไม่มีคนรับ (นาที) — ปกติ / เร่งด่วน, และเตือนผู้ส่ง+ผู้ดูแล */
  transferSla: { normal: number; urgent: number; escalateNormal: number; escalateUrgent: number };
}

export const DEFAULT_CASE_SETTINGS: CaseSettings = {
  autoCloseDays: 3,
  reopenDays: 7,
  transferSla: { normal: 15, urgent: 0, escalateNormal: 60, escalateUrgent: 5 },
};

export async function caseSettings(orgId: string): Promise<CaseSettings> {
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { settings: true } });
  const s = (org?.settings as { cases?: Partial<CaseSettings> })?.cases ?? {};
  return { ...DEFAULT_CASE_SETTINGS, ...s, transferSla: { ...DEFAULT_CASE_SETTINGS.transferSla, ...(s.transferSla ?? {}) } };
}

export const outcomeText = {
  answered: "ตอบคำถามแล้ว",
  appointed: "นัดหมายแล้ว",
  advised_visit: "แนะนำมาโรงพยาบาล / ห้องฉุกเฉิน",
  referred_external: "ส่งต่อหน่วยงานภายนอก",
  no_response: "คนไข้ไม่ตอบกลับ",
  spam: "ซ้ำ / ไม่ใช่เรื่องของโรงพยาบาล",
  merged: "รวมกับงานอื่น (รวมแฟ้ม)",
  other: "อื่นๆ",
} as const;

/** ผลการปิดที่ต้องมีบันทึกสรุป */
const NOTE_REQUIRED = new Set(["advised_visit", "referred_external", "other"]);

export async function caseEvent(tx: Tx, caseId: string, type: string, actorId: string | null, meta: Prisma.InputJsonValue = {}) {
  await tx.caseEvent.create({ data: { caseId, type, actorId, meta } });
}

/** งานที่ยังไม่ปิดของคนไข้ (มีได้ครั้งละ 1) */
export function openCase(patientId: string, tx: Tx = prisma) {
  return tx.case.findFirst({ where: { patientId, status: { not: "closed" } } });
}

/** งานที่ยังไม่ปิด หรือเปิดงานใหม่ "รอรับ" ถ้ายังไม่มี (กันสร้างซ้ำด้วย unique index บางส่วน) */
export async function ensureOpenCase(orgId: string, patientId: string, opts: { ownerId?: string } = {}) {
  const existing = await openCase(patientId);
  if (existing) return { case: existing, created: false };
  try {
    const c = await prisma.$transaction(async (tx) => {
      const c = await tx.case.create({
        data: {
          orgId,
          patientId,
          status: opts.ownerId ? "in_progress" : "queued",
          ownerId: opts.ownerId,
          acceptedAt: opts.ownerId ? new Date() : undefined,
        },
      });
      await caseEvent(tx, c.id, "opened", opts.ownerId ?? null, opts.ownerId ? { by: "staff" } : {});
      return c;
    });
    publish({ type: "case", caseId: c.id });
    return { case: c, created: true };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const c = await openCase(patientId);
      if (c) return { case: c, created: false };
    }
    throw e;
  }
}

/** เรียกเมื่อคนไข้ส่งข้อความเข้ามา: คืนงานที่ข้อความนี้สังกัด */
export async function caseForIncoming(orgId: string, patientId: string) {
  const { case: c, created } = await ensureOpenCase(orgId, patientId);
  if (c.status === "waiting_patient") {
    const resumed = await prisma.case.update({
      where: { id: c.id },
      data: { status: c.ownerId ? "in_progress" : "queued", waitingSince: null },
    });
    await prisma.caseEvent.create({ data: { caseId: c.id, type: "resumed", meta: { by: "patient" } } });
    publish({ type: "case", caseId: c.id });
    return { case: resumed, created };
  }
  return { case: c, created };
}

/** เรียกเมื่อเจ้าหน้าที่ส่งข้อความถึงคนไข้: รับงานให้อัตโนมัติถ้ายังไม่มีผู้รับ และบันทึกเวลาตอบครั้งแรก */
export async function caseForAgentReply(orgId: string, patientId: string, agentId: string) {
  const { case: c } = await ensureOpenCase(orgId, patientId, { ownerId: agentId });
  let changed = false;
  if (c.status === "queued") {
    const u = await prisma.case.updateMany({
      where: { id: c.id, status: "queued" },
      data: { status: "in_progress", ownerId: agentId, acceptedAt: c.acceptedAt ?? new Date() },
    });
    if (u.count) {
      await prisma.caseEvent.create({ data: { caseId: c.id, type: "accepted", actorId: agentId, meta: { auto: true } } });
      changed = true;
    }
  }
  if (!c.firstResponseAt) {
    const u = await prisma.case.updateMany({ where: { id: c.id, firstResponseAt: null }, data: { firstResponseAt: new Date() } });
    changed ||= u.count > 0;
  }
  if (changed) publish({ type: "case", caseId: c.id });
  return c;
}

/* ------------------------------------------------------------------ */
/* การกระทำกับงาน                                                        */
/* ------------------------------------------------------------------ */

export type CaseAction =
  | { action: "accept" }
  | { action: "assign"; userId: string }
  | { action: "wait" }
  | { action: "resume" }
  | { action: "transfer"; departmentId: string; reason: string; doneNote?: string; notifyPatient?: boolean }
  | { action: "return"; reason: string }
  | { action: "recall" }
  | { action: "close"; outcome: keyof typeof outcomeText; category?: string; note?: string; closingMessage?: string }
  | { action: "reopen" };

type Me = Pick<User, "id" | "orgId" | "role" | "name" | "departmentId">;
const isAdmin = (me: Me) => me.role === "owner" || me.role === "admin";

export interface ActionResult {
  case: Case;
  /** ข้อความระบบที่จะเพิ่มในแชท */
  notes: string[];
  /** ข้อความที่จะส่งถึงคนไข้ (ผ่านห้องแชทล่าสุด) */
  sendToPatient?: string;
}

export async function runCaseAction(me: Me, caseId: string, a: CaseAction): Promise<ActionResult> {
  return prisma.$transaction(async (tx) => {
    const c = await tx.case.findFirst({
      where: { id: caseId, orgId: me.orgId },
      include: { transfers: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    if (!c) throw new CaseError("ไม่พบงานนี้", 404);
    const last = c.transfers[0];
    const pending = last && !last.acceptedAt && !last.returnedAt && !last.recalledAt ? last : undefined;
    const isOwner = c.ownerId === me.id;
    const now = new Date();
    const notes: string[] = [];
    let sendToPatient: string | undefined;

    // อัปเดตแบบมีเงื่อนไขสถานะ — กันสองคนกดพร้อมกัน
    const guarded = async (data: Prisma.CaseUncheckedUpdateManyInput, msg = "งานนี้เปลี่ยนสถานะไปแล้ว รีเฟรชแล้วลองใหม่") => {
      const r = await tx.case.updateMany({ where: { id: c.id, status: c.status, ownerId: c.ownerId }, data });
      if (!r.count) throw new CaseError(msg, 409);
    };
    const deptName = async (id?: string | null) => (id ? (await tx.department.findUnique({ where: { id } }))?.name : undefined);

    switch (a.action) {
      case "accept": {
        if (c.status === "queued") {
          await guarded({ status: "in_progress", ownerId: me.id, acceptedAt: c.acceptedAt ?? now }, "มีเจ้าหน้าที่รับงานนี้ไปแล้ว");
          await caseEvent(tx, c.id, "accepted", me.id);
          notes.push(`${me.name} รับงาน`);
          break;
        }
        if (c.status === "transfer_pending" && pending) {
          if (!isAdmin(me) && me.departmentId !== pending.toDeptId) throw new CaseError("งานนี้โอนไปแผนกอื่น — รับได้เฉพาะคนในแผนกปลายทาง", 403);
          await guarded({ status: "in_progress", ownerId: me.id, departmentId: pending.toDeptId, acceptedAt: c.acceptedAt ?? now }, "มีเจ้าหน้าที่รับงานนี้ไปแล้ว");
          await tx.caseTransfer.update({ where: { id: pending.id }, data: { acceptedAt: now, acceptedById: me.id } });
          await caseEvent(tx, c.id, "transfer_accepted", me.id, { transferId: pending.id, deptId: pending.toDeptId });
          notes.push(`${me.name} รับงานที่โอนมาจาก${(await deptName(pending.fromDeptId)) ?? "ศูนย์ประสานงาน"}`);
          break;
        }
        throw new CaseError(c.status === "closed" ? "งานนี้ปิดแล้ว" : "งานนี้มีผู้รับผิดชอบแล้ว", 409);
      }
      case "assign": {
        if (!isAdmin(me)) throw new CaseError("มอบงานให้คนอื่นได้เฉพาะผู้ดูแล", 403);
        if (c.status === "closed" || c.status === "transfer_pending") throw new CaseError("มอบงานไม่ได้ในสถานะนี้", 409);
        const u = await tx.user.findFirst({ where: { id: a.userId, orgId: me.orgId, active: true } });
        if (!u) throw new CaseError("ไม่พบเจ้าหน้าที่ที่เลือก");
        await guarded({ ownerId: u.id, status: c.status === "queued" ? "in_progress" : c.status, acceptedAt: c.acceptedAt ?? now });
        await caseEvent(tx, c.id, "assigned", me.id, { to: u.id });
        notes.push(`${me.name} มอบงานให้ ${u.name}`);
        break;
      }
      case "wait": {
        if (c.status !== "in_progress") throw new CaseError("ตั้งเป็น “รอคนไข้ตอบ” ได้เฉพาะงานที่กำลังดำเนินการ", 409);
        if (!isOwner && !isAdmin(me)) throw new CaseError("เฉพาะผู้รับผิดชอบงานนี้", 403);
        await guarded({ status: "waiting_patient", waitingSince: now });
        await caseEvent(tx, c.id, "waiting", me.id);
        notes.push(`${me.name} ตั้งงานเป็น “รอคนไข้ตอบ”`);
        break;
      }
      case "resume": {
        if (c.status !== "waiting_patient") throw new CaseError("งานนี้ไม่ได้รอคนไข้", 409);
        await guarded({ status: c.ownerId ? "in_progress" : "queued", waitingSince: null });
        await caseEvent(tx, c.id, "resumed", me.id);
        notes.push(`${me.name} กลับมาดำเนินการต่อ`);
        break;
      }
      case "transfer": {
        if (c.status === "closed") throw new CaseError("งานนี้ปิดแล้ว", 409);
        if (c.status === "transfer_pending") throw new CaseError("งานนี้รอแผนกรับอยู่ — ดึงกลับก่อนแล้วค่อยโอนใหม่", 409);
        if (c.ownerId && !isOwner && !isAdmin(me)) throw new CaseError("โอนได้เฉพาะผู้รับผิดชอบงานหรือผู้ดูแล", 403);
        const d = await tx.department.findFirst({ where: { id: a.departmentId, orgId: me.orgId } });
        if (!d) throw new CaseError("ไม่พบแผนกที่เลือก");
        if (d.id === c.departmentId && c.ownerId && (await tx.user.count({ where: { id: c.ownerId, departmentId: d.id } })))
          throw new CaseError("งานนี้อยู่ในแผนกนี้แล้ว");
        // ผู้ส่งยังรับผิดชอบจนกว่าแผนกจะกดรับ
        await guarded({ status: "transfer_pending", ownerId: c.ownerId ?? me.id, waitingSince: null });
        const t = await tx.caseTransfer.create({
          data: { caseId: c.id, fromDeptId: c.departmentId ?? me.departmentId, fromUserId: me.id, toDeptId: d.id, reason: a.reason, doneNote: a.doneNote || null },
        });
        await caseEvent(tx, c.id, "transferred", me.id, { transferId: t.id, to: d.id });
        await audit(me.orgId, me.id, "case.transfer", { type: "case", id: c.id }, { to: d.id }, tx);
        notes.push(`${me.name} โอนงานไปแผนก${d.name.replace(/^แผนก/, "")}: ${a.reason}`);
        if (a.notifyPatient) sendToPatient = `เจ้าหน้าที่ได้ส่งต่อเรื่องของท่านให้${d.name.startsWith("แผนก") ? "" : "แผนก"}${d.name} แล้ว จะมีเจ้าหน้าที่ติดต่อกลับโดยเร็วค่ะ`;
        break;
      }
      case "return": {
        if (c.status !== "transfer_pending" || !pending) throw new CaseError("งานนี้ไม่ได้รอแผนกรับ", 409);
        if (!isAdmin(me) && me.departmentId !== pending.toDeptId) throw new CaseError("ตีกลับได้เฉพาะคนในแผนกปลายทาง", 403);
        await guarded({ status: c.ownerId ? "in_progress" : "queued" });
        await tx.caseTransfer.update({ where: { id: pending.id }, data: { returnedAt: now, returnReason: a.reason } });
        await caseEvent(tx, c.id, "transfer_returned", me.id, { transferId: pending.id });
        notes.push(`${me.name} ตีกลับงาน: ${a.reason}`);
        break;
      }
      case "recall": {
        if (c.status !== "transfer_pending" || !pending) throw new CaseError("งานนี้ไม่ได้รอแผนกรับ", 409);
        if (!isAdmin(me) && me.id !== pending.fromUserId) throw new CaseError("ดึงกลับได้เฉพาะผู้ที่โอนงานนี้", 403);
        await guarded({ status: c.ownerId ? "in_progress" : "queued" });
        await tx.caseTransfer.update({ where: { id: pending.id }, data: { recalledAt: now } });
        await caseEvent(tx, c.id, "transfer_recalled", me.id, { transferId: pending.id });
        notes.push(`${me.name} ดึงงานกลับ`);
        break;
      }
      case "close": {
        if (c.status === "closed") throw new CaseError("งานนี้ปิดแล้ว", 409);
        if (c.status === "transfer_pending") throw new CaseError("งานนี้รอแผนกรับอยู่ — ให้แผนกรับหรือดึงกลับก่อนปิด", 409);
        if (c.ownerId && !isOwner && !isAdmin(me)) throw new CaseError("ปิดงานของคนอื่นได้เฉพาะผู้ดูแล", 403);
        const category = a.category ?? c.category;
        if (!category && a.outcome !== "spam") throw new CaseError("ระบุหมวดเรื่องก่อนปิดงาน");
        const note = a.note?.trim();
        if ((NOTE_REQUIRED.has(a.outcome) || c.urgent) && !note) throw new CaseError(c.urgent ? "งานเร่งด่วนต้องมีบันทึกสรุปก่อนปิด" : "ผลการปิดนี้ต้องมีบันทึกสรุป");
        if (a.outcome === "appointed" && !(await tx.appointment.count({ where: { caseId: c.id, status: { not: "cancelled" } } })))
          throw new CaseError("ปิดเป็น “นัดหมายแล้ว” ต้องมีคำขอนัดในงานนี้อย่างน้อย 1 รายการ");
        await guarded({
          status: "closed",
          closedAt: now,
          closedById: me.id,
          outcome: a.outcome,
          closeNote: note || null,
          category: (category as Case["category"]) ?? null,
          ownerId: c.ownerId ?? me.id,
          waitingSince: null,
        });
        await caseEvent(tx, c.id, "closed", me.id, { outcome: a.outcome });
        await audit(me.orgId, me.id, "case.close", { type: "case", id: c.id }, { outcome: a.outcome }, tx);
        notes.push(`${me.name} ปิดงาน · ${outcomeText[a.outcome]}`);
        if (a.closingMessage?.trim()) sendToPatient = a.closingMessage.trim();
        break;
      }
      case "reopen": {
        if (c.status !== "closed") throw new CaseError("งานนี้ยังไม่ปิด", 409);
        const s = await caseSettings(me.orgId);
        if (!c.closedAt || Date.now() - c.closedAt.getTime() > s.reopenDays * 86_400_000)
          throw new CaseError(`เปิดงานเดิมได้ภายใน ${s.reopenDays} วันหลังปิด`, 409);
        if (await tx.case.count({ where: { patientId: c.patientId, status: { not: "closed" } } }))
          throw new CaseError("คนไข้มีงานที่เปิดอยู่แล้ว", 409);
        await tx.case.update({
          where: { id: c.id },
          data: { status: "in_progress", ownerId: me.id, closedAt: null, closedById: null, outcome: null, closeNote: null, reopenCount: { increment: 1 } },
        });
        await caseEvent(tx, c.id, "reopened", me.id);
        await audit(me.orgId, me.id, "case.reopen", { type: "case", id: c.id }, {}, tx);
        notes.push(`${me.name} เปิดงานนี้อีกครั้ง`);
        break;
      }
    }
    const updated = await tx.case.findUniqueOrThrow({ where: { id: c.id } });
    return { case: updated, notes, sendToPatient };
  });
}

/** ปิดงานที่รอคนไข้ตอบนานเกินกำหนด (เรียกจากตัวจับเวลาเบื้องหลัง) */
export async function autoCloseWaiting() {
  const orgs = await prisma.organization.findMany({ select: { id: true } });
  let closed = 0;
  for (const o of orgs) {
    const s = await caseSettings(o.id);
    const cutoff = new Date(Date.now() - s.autoCloseDays * 86_400_000);
    const rows = await prisma.case.findMany({ where: { orgId: o.id, status: "waiting_patient", waitingSince: { lt: cutoff } }, select: { id: true } });
    for (const r of rows) {
      const u = await prisma.case.updateMany({
        where: { id: r.id, status: "waiting_patient" },
        data: { status: "closed", closedAt: new Date(), outcome: "no_response", closeNote: `ปิดอัตโนมัติ: คนไข้ไม่ตอบกลับเกิน ${s.autoCloseDays} วัน`, waitingSince: null },
      });
      if (!u.count) continue;
      await prisma.caseEvent.create({ data: { caseId: r.id, type: "closed", meta: { outcome: "no_response", auto: true } } });
      publish({ type: "case", caseId: r.id });
      closed++;
    }
  }
  return closed;
}
