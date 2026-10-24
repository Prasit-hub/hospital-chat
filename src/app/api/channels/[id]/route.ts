import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, handle, json, parseBody } from "@/lib/api";
import { currentUser } from "@/lib/auth";
import { uiChannel } from "@/lib/inbox/serialize";

// ยกเลิก/เปิดการเชื่อมต่ออีกครั้ง — ไม่ลบประวัติแชท
const Patch = z.object({ connected: z.boolean() });

export const PATCH = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const me = await currentUser();
  if (me.role === "agent") return apiError("ไม่มีสิทธิ์", 403);
  const { id } = await params;
  const { connected } = await parseBody(req, Patch);
  const c = await prisma.channel.update({ where: { id, orgId: me.orgId }, data: { connected } });
  return json(uiChannel(c));
});
