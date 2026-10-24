import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, handle, json, parseBody } from "@/lib/api";
import { currentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { publish } from "@/lib/realtime";
import { addInternal, sendOutgoing } from "@/lib/inbox/service";
import { CaseError, outcomeText, runCaseAction } from "@/lib/cases";
import { CATEGORIES } from "@/lib/schemas";
import { caseInclude, uiCase } from "@/lib/inbox/serialize";
import { patientBundle } from "@/lib/inbox/bundle";
import { canSeeCase, visibilityFor } from "@/lib/visibility";

type Ctx = { params: Promise<{ id: string }> };

async function ownCase(id: string, me: Awaited<ReturnType<typeof currentUser>>) {
  const c = await prisma.case.findFirst({ where: { id, orgId: me.orgId } });
  if (!c) throw new CaseError("ไม่พบงานนี้", 404);
  if (!(await canSeeCase(await visibilityFor(me), id))) throw new CaseError("งานนี้อยู่ในความรับผิดชอบของแผนกอื่น", 403);
  return c;
}

/** ห้องแชทที่ใช้แจ้งคนไข้ / ลงบันทึกระบบ: ห้องที่คนไข้ทักมาล่าสุด */
async function latestConversation(patientId: string) {
  return prisma.conversation.findFirst({
    where: { contact: { patientId } },
    orderBy: [{ lastCustomerMessageAt: { sort: "desc", nulls: "last" } }, { lastMessageAt: "desc" }],
  });
}

const fail = (e: unknown) => {
  if (e instanceof CaseError) return apiError(e.message, e.status);
  throw e;
};

export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const me = await currentUser();
  try {
    const c = await ownCase(id, me);
    const bundle = await patientBundle(me.orgId, c.patientId, await visibilityFor(me));
    const requested = await prisma.case.findUniqueOrThrow({ where: { id }, include: caseInclude });
    return json({ ...bundle, requested: uiCase(requested) });
  } catch (e) {
    return fail(e);
  }
});

const Action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("accept") }),
  z.object({ action: z.literal("assign"), userId: z.string() }),
  z.object({ action: z.literal("wait") }),
  z.object({ action: z.literal("resume") }),
  z.object({
    action: z.literal("transfer"),
    departmentId: z.string(),
    reason: z.string().trim().min(3, "ระบุเหตุผลที่โอน").max(500),
    doneNote: z.string().trim().max(1000).optional(),
    notifyPatient: z.boolean().optional(),
  }),
  z.object({ action: z.literal("return"), reason: z.string().trim().min(3, "ระบุเหตุผลที่ตีกลับ").max(500) }),
  z.object({ action: z.literal("recall") }),
  z.object({
    action: z.literal("close"),
    outcome: z.enum(Object.keys(outcomeText).filter((k) => k !== "merged") as [keyof typeof outcomeText, ...(keyof typeof outcomeText)[]]),
    category: z.enum(CATEGORIES).optional(),
    note: z.string().trim().max(2000).optional(),
    closingMessage: z.string().trim().max(2000).optional(),
  }),
  z.object({ action: z.literal("reopen") }),
]);

// การกระทำกับงาน: รับ / มอบ / รอคนไข้ / ทำต่อ / โอน / ตีกลับ / ดึงกลับ / ปิด / เปิดใหม่
export const POST = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const me = await currentUser();
  const body = await parseBody(req, Action);
  try {
    const r = await runCaseAction(me, id, body);
    const conv = await latestConversation(r.case.patientId);
    if (conv) {
      for (const n of r.notes) await addInternal(conv.id, "system", n, undefined, r.case.id);
      if (r.sendToPatient) await sendOutgoing(conv.id, { sender: "agent", agentId: me.id }, { kind: "text", text: r.sendToPatient }).catch(() => {});
    }
    publish({ type: "case", caseId: r.case.id });
    const c = await prisma.case.findUniqueOrThrow({ where: { id: r.case.id }, include: caseInclude });
    return json(uiCase(c));
  } catch (e) {
    return fail(e);
  }
});

const Patch = z.object({
  category: z.enum(CATEGORIES).nullable().optional(),
  urgent: z.object({ on: z.boolean(), reason: z.string().trim().max(200).optional() }).optional(),
  /** ยืนยันตัวตนคนไข้สำหรับงานนี้ (null = ยกเลิก) */
  verify: z.object({ method: z.string().trim().min(2).max(80) }).nullable().optional(),
});

const categoryText: Record<(typeof CATEGORIES)[number], string> = {
  appointment: "นัดหมาย",
  rights: "สิทธิการรักษา / ประกัน",
  cost: "ค่าใช้จ่าย",
  results: "ผลตรวจ / เอกสาร",
  symptom: "สอบถามอาการ",
  other: "อื่นๆ",
};

// ข้อมูลประกอบของงาน: หมวด / ป้ายเร่งด่วน / ยืนยันตัวตน
export const PATCH = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const me = await currentUser();
  try {
    const before = await ownCase(id, me);
    const body = await parseBody(req, Patch);
    if (before.status === "closed" && (body.urgent || body.verify !== undefined)) throw new CaseError("งานนี้ปิดแล้ว", 409);
    await prisma.case.update({
      where: { id },
      data: {
        category: body.category === undefined ? undefined : body.category,
        ...(body.urgent && {
          urgent: body.urgent.on,
          urgentReason: body.urgent.on ? body.urgent.reason || `ตั้งโดย ${me.name}` : null,
          urgentAt: body.urgent.on ? new Date() : null,
        }),
        ...(body.verify !== undefined && {
          verifiedAt: body.verify ? new Date() : null,
          verifiedById: body.verify ? me.id : null,
          verifyMethod: body.verify?.method ?? null,
        }),
      },
    });
    const conv = await latestConversation(before.patientId);
    const note = (t: string) => (conv ? addInternal(conv.id, "system", t, undefined, id) : undefined);
    if (body.category !== undefined && body.category && body.category !== before.category) await note(`${me.name} ระบุหมวดเรื่อง: ${categoryText[body.category]}`);
    if (body.urgent && body.urgent.on !== before.urgent) {
      await note(body.urgent.on ? `${me.name} ติดป้ายเร่งด่วน${body.urgent.reason ? `: ${body.urgent.reason}` : ""}` : `${me.name} ยกเลิกป้ายเร่งด่วน`);
      await prisma.caseEvent.create({ data: { caseId: id, type: "urgent", actorId: me.id, meta: { on: body.urgent.on } } });
      await audit(me.orgId, me.id, "case.urgent", { type: "case", id }, { on: body.urgent.on });
    }
    if (body.verify !== undefined) {
      await note(body.verify ? `${me.name} ยืนยันตัวตนคนไข้แล้ว (${body.verify.method})` : `${me.name} ยกเลิกการยืนยันตัวตน`);
      await audit(me.orgId, me.id, body.verify ? "case.verify" : "case.unverify", { type: "patient", id: before.patientId }, { caseId: id, method: body.verify?.method });
    }
    publish({ type: "case", caseId: id });
    const c = await prisma.case.findUniqueOrThrow({ where: { id }, include: caseInclude });
    return json(uiCase(c));
  } catch (e) {
    return fail(e);
  }
});
