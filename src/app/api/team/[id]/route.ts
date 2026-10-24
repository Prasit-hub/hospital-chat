import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, handle, json, parseBody } from "@/lib/api";
import { generatePassword, hashPassword, requireRole } from "@/lib/auth";
import { uiAgent } from "@/lib/inbox/serialize";

const Body = z.object({
  role: z.enum(["owner", "admin", "agent"]).optional(),
  active: z.boolean().optional(),
  name: z.string().trim().min(1).max(80).optional(),
  resetPassword: z.literal(true).optional(),
  departmentId: z.string().nullable().optional(),
});

export const PATCH = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const me = await requireRole(["owner", "admin"]);
  const { id } = await params;
  const body = await parseBody(req, Body);
  const target = await prisma.user.findFirst({ where: { id, orgId: me.orgId } });
  if (!target) return apiError("ไม่พบสมาชิก", 404);

  if (id === me.id && (body.role || body.active === false)) return apiError("เปลี่ยนบทบาทหรือปิดบัญชีของตัวเองไม่ได้", 400);
  if (me.role !== "owner" && (target.role === "owner" || body.role === "owner")) return apiError("เฉพาะเจ้าของเท่านั้นที่จัดการบัญชีเจ้าของได้", 403);
  if (target.role === "owner" && (body.role && body.role !== "owner" || body.active === false)) {
    const owners = await prisma.user.count({ where: { orgId: me.orgId, role: "owner", active: true } });
    if (owners <= 1) return apiError("ต้องมีเจ้าของอย่างน้อย 1 คน", 400);
  }

  // บัญชี AD: บทบาท/แผนก/รหัสผ่าน จัดการผ่าน AD (ปิดการใช้งานในรวมแชทยังทำได้)
  if (target.authSource === "ad") {
    if (body.resetPassword) return apiError("บัญชี AD ใช้รหัสผ่านของ AD — รีเซ็ตที่ระบบ AD", 409);
    if (body.role && body.role !== target.role) return apiError("บทบาทของบัญชี AD กำหนดจากกลุ่มใน AD (ตั้งค่า → การเข้าสู่ระบบ)", 409);
  }
  if (body.departmentId && !(await prisma.department.count({ where: { id: body.departmentId, orgId: me.orgId } }))) return apiError("ไม่พบแผนก", 400);
  const password = body.resetPassword ? generatePassword() : undefined;
  const u = await prisma.user.update({
    where: { id },
    data: {
      role: body.role,
      active: body.active,
      name: body.name,
      departmentId: body.departmentId,
      passwordHash: password ? await hashPassword(password) : undefined,
    },
  });
  // ปิดบัญชีหรือรีเซ็ตรหัส → ออกจากระบบทุกอุปกรณ์ และคืนแชทที่ค้างอยู่เข้าคิวกลาง
  if (body.active === false || password) await prisma.session.deleteMany({ where: { userId: id } });
  if (body.active === false) {
    await prisma.case.updateMany({ where: { ownerId: id, status: "in_progress" }, data: { ownerId: null, status: "queued" } });
    await prisma.case.updateMany({ where: { ownerId: id, status: { in: ["waiting_patient", "transfer_pending"] } }, data: { ownerId: null } });
  }

  return json({ user: { ...uiAgent(u), email: u.email, active: u.active, hasPassword: !!u.passwordHash, departmentId: u.departmentId ?? undefined }, password });
});
