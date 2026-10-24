import { DepartmentBody } from "@/lib/schemas";
import { prisma } from "@/lib/db";
import { handle, json, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { ownDepartment } from "@/lib/scope";
import { audit } from "@/lib/audit";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const me = await requireRole(["owner", "admin"]);
  await ownDepartment(id, me.orgId);
  const body = await parseBody(req, DepartmentBody.partial());
  const before = await prisma.department.findUniqueOrThrow({ where: { id } });
  const d = await prisma.department.update({ where: { id }, data: body });
  if (body.seesAllCases !== undefined && body.seesAllCases !== before.seesAllCases)
    await audit(me.orgId, me.id, "department.sees_all", { type: "department", id }, { on: body.seesAllCases });
  return json({ id: d.id, name: d.name, color: d.color, seesAll: d.seesAllCases });
});

// ลบแผนก: แชท/นัด/สมาชิกที่อยู่ในแผนกนี้จะกลายเป็น "ยังไม่ระบุแผนก"
export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const me = await requireRole(["owner", "admin"]);
  await ownDepartment(id, me.orgId);
  await prisma.department.delete({ where: { id } });
  return json({ ok: true });
});
