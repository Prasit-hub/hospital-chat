import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, handle, json, parseBody } from "@/lib/api";
import { currentUser, requireRole } from "@/lib/auth";
import { uiTagDef } from "@/lib/inbox/serialize";

export const dynamic = "force-dynamic";

// รายการแท็กคนไข้ทั้งหมด (รวมที่ปิดใช้งาน / ที่เจ้าหน้าที่เสนอ) + จำนวนคนไข้ที่ใช้
export const GET = handle(async () => {
  const me = await currentUser();
  const defs = await prisma.profileTagDef.findMany({
    where: { orgId: me.orgId },
    orderBy: [{ category: "asc" }, { label: "asc" }],
    include: { _count: { select: { uses: true } } },
  });
  return json(defs.map((d) => ({ ...uiTagDef(d), uses: d._count.uses })));
});

export const POST = handle(async (req: Request) => {
  const me = await requireRole(["owner", "admin"]);
  const body = await parseBody(
    req,
    z.object({
      category: z.enum(["need", "communication", "like", "dislike"]),
      label: z.string().trim().min(2).max(60),
      blocksBroadcast: z.boolean().default(false),
    }),
  );
  if (await prisma.profileTagDef.findFirst({ where: { orgId: me.orgId, category: body.category, label: body.label } })) return apiError("มีแท็กนี้แล้ว", 409);
  const d = await prisma.profileTagDef.create({ data: { ...body, orgId: me.orgId, createdById: me.id } });
  return json({ ...uiTagDef(d), uses: 0 }, 201);
});
