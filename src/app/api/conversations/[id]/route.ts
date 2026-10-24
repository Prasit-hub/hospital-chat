import { z } from "zod";
import { prisma } from "@/lib/db";
import { handle, json, parseBody } from "@/lib/api";
import { currentUser } from "@/lib/auth";
import { ownConversation } from "@/lib/scope";
import { patientBundle } from "@/lib/inbox/bundle";
import { visibilityFor } from "@/lib/visibility";
import { uiContact, uiConversation } from "@/lib/inbox/serialize";

type Ctx = { params: Promise<{ id: string }> };

// ใช้ตอนได้เหตุการณ์ realtime: ห้องแชทนี้ + ข้อมูลชุดของคนไข้เจ้าของห้อง (รวมงานที่เปิดอยู่)
export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const me = await currentUser();
  await ownConversation(id, me);
  const c = await prisma.conversation.findUniqueOrThrow({ where: { id }, include: { contact: true } });
  const bundle = await patientBundle(me.orgId, c.contact.patientId, await visibilityFor(me));
  return json({ ...bundle, conversation: uiConversation(c), contact: uiContact(c.contact) });
});

// สถานะงาน/ผู้รับผิดชอบ/แผนก อยู่ที่ /api/cases/[id] — ห้องแชทเหลือแค่ "อ่านแล้ว"
export const PATCH = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const me = await currentUser();
  await ownConversation(id, me);
  const body = await parseBody(req, z.object({ read: z.literal(true) }));
  const c = await prisma.conversation.update({ where: { id }, data: { unread: body.read ? 0 : undefined }, include: { contact: { select: { patientId: true } } } });
  return json(uiConversation(c));
});
