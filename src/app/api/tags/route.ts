import { TagBody } from "@/lib/schemas";
import { prisma } from "@/lib/db";
import { apiError, handle, json, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth";


export const POST = handle(async (req: Request) => {
  const me = await requireRole(["owner", "admin"]);
  const body = await parseBody(req, TagBody);
  if (await prisma.tag.findFirst({ where: { orgId: me.orgId, name: body.name } })) return apiError("มีแท็กชื่อนี้แล้ว", 409);
  const t = await prisma.tag.create({ data: { ...body, orgId: me.orgId } });
  return json({ id: t.id, name: t.name, color: t.color, count: 0 }, 201);
});
