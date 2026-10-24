import { prisma } from "@/lib/db";
import { handle, json, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { QuickReplyBody } from "@/lib/schemas";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = handle(async (req: Request, { params }: Ctx) => {
  const me = await requireRole(["owner", "admin"]);
  const { id } = await params;
  const body = await parseBody(req, QuickReplyBody.partial());
  const q = await prisma.quickReply.update({ where: { id, orgId: me.orgId }, data: body });
  return json({ id: q.id, shortcut: q.shortcut, title: q.title, text: q.text });
});

export const DELETE = handle(async (_req: Request, { params }: Ctx) => {
  const me = await requireRole(["owner", "admin"]);
  const { id } = await params;
  await prisma.quickReply.delete({ where: { id, orgId: me.orgId } });
  return json({ ok: true });
});
