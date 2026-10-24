import { prisma } from "@/lib/db";
import { handle, json, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { TagBody } from "@/lib/schemas";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = handle(async (req: Request, { params }: Ctx) => {
  const me = await requireRole(["owner", "admin"]);
  const { id } = await params;
  const body = await parseBody(req, TagBody.partial());
  const t = await prisma.tag.update({ where: { id, orgId: me.orgId }, data: body });
  return json({ id: t.id, name: t.name, color: t.color });
});

export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  const me = await requireRole(["owner", "admin"]);
  const { id } = await params;
  await prisma.tag.delete({ where: { id, orgId: me.orgId } });
  return json({ ok: true });
});
