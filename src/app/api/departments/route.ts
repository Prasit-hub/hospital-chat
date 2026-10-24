import { DepartmentBody } from "@/lib/schemas";
import { prisma } from "@/lib/db";
import { apiError, handle, json, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth";

export const POST = handle(async (req: Request) => {
  const me = await requireRole(["owner", "admin"]);
  const body = await parseBody(req, DepartmentBody);
  if (await prisma.department.findFirst({ where: { orgId: me.orgId, name: body.name } })) return apiError("มีแผนกชื่อนี้แล้ว", 409);
  const d = await prisma.department.create({ data: { ...body, orgId: me.orgId } });
  return json({ id: d.id, name: d.name, color: d.color, users: 0 }, 201);
});
