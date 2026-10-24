import { QuickReplyBody } from "@/lib/schemas";
import { prisma } from "@/lib/db";
import { handle, json, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth";


export const POST = handle(async (req: Request) => {
  const me = await requireRole(["owner", "admin"]);
  const body = await parseBody(req, QuickReplyBody);
  const q = await prisma.quickReply.create({ data: { ...body, orgId: me.orgId } });
  return json({ id: q.id, shortcut: q.shortcut, title: q.title, text: q.text }, 201);
});
