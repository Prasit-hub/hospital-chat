import { prisma } from "@/lib/db";
import { apiError, handle, json } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { pollEmailChannel } from "@/lib/email-poller";

// ตรวจอีเมลใหม่ทันที (ปุ่ม "ตรวจตอนนี้" ในหน้าตั้งค่า)
export const POST = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const me = await requireRole(["owner", "admin"]);
  const { id } = await params;
  const channel = await prisma.channel.findFirst({ where: { id, orgId: me.orgId, type: "email" } });
  if (!channel) return apiError("ไม่พบช่องทางอีเมล", 404);
  try {
    const r = await pollEmailChannel(channel);
    return json({ ok: true, received: r.received });
  } catch (e) {
    return apiError((e as Error).message, 502);
  }
});
