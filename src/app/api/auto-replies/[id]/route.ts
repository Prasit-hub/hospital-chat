import { prisma } from "@/lib/db";
import { handle, json, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { AutoReplyBody } from "@/lib/schemas";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = handle(async (req: Request, { params }: Ctx) => {
  const me = await requireRole(["owner", "admin"]);
  const { id } = await params;
  const body = await parseBody(req, AutoReplyBody.partial());
  const r = await prisma.autoReplyRule.update({ where: { id, orgId: me.orgId }, data: body });
  return json({ id: r.id, keywords: r.keywords, reply: r.reply, enabled: r.enabled, channels: r.channels });
});

export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  const me = await requireRole(["owner", "admin"]);
  const { id } = await params;
  await prisma.autoReplyRule.delete({ where: { id, orgId: me.orgId } });
  return json({ ok: true });
});
