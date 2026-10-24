import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, handle, json, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { uiTagDef } from "@/lib/inbox/serialize";

// ผู้ดูแล: รับแท็กที่เจ้าหน้าที่เสนอเข้ารายการกลาง / ปิดใช้งาน / แก้ชื่อ (ไม่ลบ เพราะมีประวัติการใช้)
export const PATCH = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const me = await requireRole(["owner", "admin"]);
  const d0 = await prisma.profileTagDef.findFirst({ where: { id, orgId: me.orgId } });
  if (!d0) return apiError("ไม่พบแท็กนี้", 404);
  const body = await parseBody(
    req,
    z.object({ label: z.string().trim().min(2).max(60).optional(), active: z.boolean().optional(), approve: z.literal(true).optional(), blocksBroadcast: z.boolean().optional() }),
  );
  const d = await prisma.profileTagDef.update({
    where: { id },
    data: { label: body.label, active: body.active, suggested: body.approve ? false : undefined, blocksBroadcast: body.blocksBroadcast },
  });
  return json(uiTagDef(d));
});
