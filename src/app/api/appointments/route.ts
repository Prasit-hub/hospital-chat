import { z } from "zod";
import { prisma } from "@/lib/db";
import { handle, json, parseBody } from "@/lib/api";
import { addInternal, sendOutgoing } from "@/lib/inbox/service";
import { currentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ownConversation, ownDepartment, ownPatient } from "@/lib/scope";
import { publish } from "@/lib/realtime";
import { uiAppointment } from "@/lib/inbox/serialize";
import { thaiDateLong } from "@/lib/time";
import { openCase } from "@/lib/cases";

const Post = z.object({
  patientId: z.string(),
  conversationId: z.string().optional(),
  departmentId: z.string().optional(),
  doctor: z.string().trim().max(120).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  slot: z.enum(["morning", "afternoon", "any"]).default("any"),
  reason: z.string().trim().max(500).optional(),
  sendSummary: z.boolean().default(false),
});

const slotText = { morning: "ช่วงเช้า", afternoon: "ช่วงบ่าย", any: "ไม่ระบุช่วงเวลา" };

export const POST = handle(async (req: Request) => {
  const me = await currentUser();
  const body = await parseBody(req, Post);
  const own = await ownPatient(body.patientId, me);
  const patientId = own.mergedIntoId ?? body.patientId;
  if (body.conversationId) await ownConversation(body.conversationId, me);
  if (body.departmentId) await ownDepartment(body.departmentId, me.orgId);
  const current = await openCase(patientId);
  const a = await prisma.appointment.create({
    data: {
      patientId,
      caseId: current?.id,
      departmentId: body.departmentId,
      doctor: body.doctor || null,
      date: body.date ? new Date(body.date) : null,
      slot: body.slot,
      reason: body.reason || null,
      createdById: me.id,
    },
    include: { department: true },
  });
  const o = uiAppointment(a);
  await audit(me.orgId, me.id, "appointment.create", { type: "appointment", id: a.id }, { patientId });
  if (body.conversationId) {
    await addInternal(body.conversationId, "system", `${me.name} บันทึกคำขอนัด ${o.code}${a.department ? ` แผนก${a.department.name.replace(/^แผนก/, "")}` : ""}`);
    if (body.sendSummary) {
      const lines = [
        `รับคำขอนัดหมายเลขที่ ${o.code} แล้วค่ะ`,
        a.department && `แผนก: ${a.department.name}`,
        a.doctor && `แพทย์: ${a.doctor}`,
        `วันที่ต้องการ: ${a.date ? thaiDateLong(a.date) : "ยังไม่ระบุ"} (${slotText[body.slot]})`,
        "",
        "เจ้าหน้าที่จะติดต่อกลับเพื่อยืนยันวันและเวลานัดอีกครั้ง หากมีอาการรุนแรงหรือฉุกเฉิน กรุณาโทร 1669 หรือมาที่ห้องฉุกเฉินทันที",
      ].filter((x): x is string => typeof x === "string");
      await sendOutgoing(body.conversationId, { sender: "agent", agentId: me.id }, { kind: "text", text: lines.join("\n") });
    }
  }
  publish({ type: "patient", patientId });
  return json(o, 201);
});
