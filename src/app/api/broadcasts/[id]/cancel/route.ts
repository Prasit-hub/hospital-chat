import { prisma } from "@/lib/db";
import { apiError, handle, json } from "@/lib/api";
import { requireRole } from "@/lib/auth";

export const POST = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const me = await requireRole(["owner", "admin"]);
  const { id } = await params;
  const r = await prisma.broadcast.updateMany({ where: { id, orgId: me.orgId, status: "scheduled" }, data: { status: "cancelled" } });
  if (!r.count) return apiError("ยกเลิกได้เฉพาะบรอดแคสต์ที่ตั้งเวลาไว้และยังไม่ส่ง", 400);
  return json({ ok: true });
});
