import { prisma } from "@/lib/db";
import { AuthError } from "@/lib/auth";
import type { User } from "@/generated/prisma/client";
import { canSeePatient, visibilityFor } from "@/lib/visibility";

// ตรวจว่าข้อมูลที่ขอเป็นขององค์กรผู้ใช้จริง (กันการเข้าถึงข้ามองค์กรด้วยการเดา id)
// และเมื่อเปิด “เห็นแชทตามแผนก” — ผู้ใช้ต้องเห็นงานอย่างน้อย 1 งานของคนไข้นั้น

type Me = Pick<User, "id" | "orgId" | "role" | "departmentId">;
const OTHER_DEPT = "แฟ้มนี้อยู่ในความรับผิดชอบของแผนกอื่น";

async function mustSeePatient(me: Me, patientId: string) {
  const v = await visibilityFor(me);
  if (!(await canSeePatient(v, patientId))) throw new AuthError(OTHER_DEPT, 403);
}

export async function ownConversation(id: string, me: Me) {
  const c = await prisma.conversation.findFirst({ where: { id, channel: { orgId: me.orgId } }, select: { id: true, contact: { select: { patientId: true } } } });
  if (!c) throw new AuthError("ไม่พบแชทนี้", 403);
  await mustSeePatient(me, c.contact.patientId);
}

export async function ownContact(id: string, orgId: string) {
  const c = await prisma.contact.findFirst({ where: { id, orgId }, select: { id: true } });
  if (!c) throw new AuthError("ไม่พบผู้ติดต่อนี้", 403);
}

export async function ownPatient(id: string, me: Me) {
  const p = await prisma.patient.findFirst({ where: { id, orgId: me.orgId }, select: { id: true, mergedIntoId: true } });
  if (!p) throw new AuthError("ไม่พบแฟ้มคนไข้นี้", 403);
  await mustSeePatient(me, p.mergedIntoId ?? p.id);
  return p;
}

export async function ownAppointment(id: string, me: Me) {
  const a = await prisma.appointment.findFirst({ where: { id, patient: { orgId: me.orgId } }, select: { id: true, patientId: true } });
  if (!a) throw new AuthError("ไม่พบคำขอนัดหมายนี้", 403);
  await mustSeePatient(me, a.patientId);
}

export async function ownDepartment(id: string, orgId: string) {
  const d = await prisma.department.findFirst({ where: { id, orgId }, select: { id: true } });
  if (!d) throw new AuthError("ไม่พบแผนกนี้", 403);
}
