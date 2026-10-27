import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

// บันทึกการกระทำที่สำคัญ — เก็บเฉพาะ "ใคร ทำอะไร กับอะไร เมื่อไร" ไม่คัดลอกข้อความแชทหรือข้อมูลทางคลินิกลงบันทึก

export type AuditAction =
  | "patient.update"
  | "patient.merge"
  | "patient.unmerge"
  | "patient.not_duplicate"
  | "patient.split_contact"
  | "conversation.verify"
  | "conversation.unverify"
  | "conversation.urgent"
  | "conversation.transfer"
  | "appointment.create"
  | "appointment.status"
  | "case.transfer"
  | "case.close"
  | "case.reopen"
  | "case.verify"
  | "case.unverify"
  | "case.urgent"
  | "patient.view_history"
  | "patient.profile_tag"
  | "his.match"
  | "his.link"
  | "his.view"
  | "settings.his"
  | "settings.visibility"
  | "department.sees_all"
  | "auth.login"
  | "auth.login_failed"
  | "auth.provision"
  | "settings.auth"
  | "yeastar.webhook"
  | "yeastar.webhook_rejected"
  | "yeastar.webhook_failed";

export async function audit(
  orgId: string,
  actorId: string | null,
  action: AuditAction,
  target: { type: string; id: string },
  meta: Prisma.InputJsonValue = {},
  tx: Prisma.TransactionClient = prisma,
) {
  await tx.auditLog.create({ data: { orgId, actorId, action, targetType: target.type, targetId: target.id, meta } });
}
