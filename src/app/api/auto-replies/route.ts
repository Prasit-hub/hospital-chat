import { AutoReplyBody } from "@/lib/schemas";
import { prisma } from "@/lib/db";
import { handle, json, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth";


export const POST = handle(async (req: Request) => {
  const me = await requireRole(["owner", "admin"]);
  const body = await parseBody(req, AutoReplyBody);
  const r = await prisma.autoReplyRule.create({ data: { ...body, orgId: me.orgId } });
  return json({ id: r.id, keywords: r.keywords, reply: r.reply, enabled: r.enabled, channels: r.channels }, 201);
});
