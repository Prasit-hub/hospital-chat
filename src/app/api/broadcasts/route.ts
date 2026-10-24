import { after } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, handle, json, parseBody } from "@/lib/api";
import { currentUser, requireRole } from "@/lib/auth";
import { runBroadcast } from "@/lib/broadcast";
import { uiChannel, uiTag } from "@/lib/inbox/serialize";
import { toLocalIso } from "@/lib/time";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const me = await currentUser();
  const [rows, channels, tags] = await Promise.all([
    prisma.broadcast.findMany({
      where: { orgId: me.orgId },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { channel: true, tag: true, createdBy: { select: { name: true } } },
    }),
    prisma.channel.findMany({ where: { orgId: me.orgId }, orderBy: { createdAt: "asc" } }),
    prisma.tag.findMany({ where: { orgId: me.orgId }, orderBy: { name: "asc" } }),
  ]);
  return json({
    canSend: me.role !== "agent",
    channels: channels.map(uiChannel),
    tags: tags.map(uiTag),
    broadcasts: rows.map((b) => ({
      id: b.id,
      title: b.title,
      text: b.text,
      imageUrl: b.imageUrl,
      channelType: b.channel.type,
      channelName: b.channel.name,
      audience: b.tag ? `แท็ก: ${b.tag.name}` : "ผู้ติดต่อทั้งหมด",
      status: b.status,
      scheduledAt: b.scheduledAt ? toLocalIso(b.scheduledAt) : null,
      sentAt: b.sentAt ? toLocalIso(b.sentAt) : null,
      createdAt: toLocalIso(b.createdAt),
      createdBy: b.createdBy?.name ?? null,
      targeted: b.targeted,
      sent: b.sent,
      failed: b.failed,
      skipped: b.skipped,
      error: b.error,
    })),
  });
});

const Body = z
  .object({
    title: z.string().trim().min(1).max(120),
    channelId: z.string(),
    tagId: z.string().nullable().optional(),
    text: z.string().trim().max(2000).default(""),
    imageUrl: z.string().url().startsWith("https://").nullable().optional(),
    /** ISO string; ไม่ส่ง = ส่งทันที */
    scheduledAt: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .refine((b) => b.text || b.imageUrl, { message: "ต้องมีข้อความหรือรูปภาพ", path: ["text"] });

export const POST = handle(async (req: Request) => {
  const me = await requireRole(["owner", "admin"]);
  const body = await parseBody(req, Body);
  const channel = await prisma.channel.findFirst({ where: { id: body.channelId, orgId: me.orgId } });
  if (!channel) return apiError("ไม่พบช่องทาง", 400);
  if (!channel.connected) return apiError("ช่องทางนี้ยังไม่ได้เชื่อมต่อ", 400);
  if (channel.type === "tiktok") return apiError("ยังไม่รองรับบรอดแคสต์ทาง TikTok", 400);
  // ส่งอีเมลจำนวนมากผ่าน SMTP ของกล่องจดหมายปกติเสี่ยงถูกจัดเป็นสแปม/ถูกระงับบัญชี — ควรใช้บริการ email marketing แทน
  if (channel.type === "email") return apiError("ไม่รองรับบรอดแคสต์ทางอีเมล (เสี่ยงถูกจัดเป็นสแปม) — ใช้บริการ email marketing แทน", 400);
  if (body.tagId && !(await prisma.tag.count({ where: { id: body.tagId, orgId: me.orgId } }))) return apiError("ไม่พบแท็ก", 400);

  const scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null;
  if (scheduledAt && scheduledAt.getTime() < Date.now() - 60_000) return apiError("เวลาที่ตั้งต้องเป็นอนาคต", 400);

  const b = await prisma.broadcast.create({
    data: {
      orgId: me.orgId,
      channelId: channel.id,
      tagId: body.tagId ?? null,
      title: body.title,
      text: body.text,
      imageUrl: body.imageUrl ?? null,
      status: scheduledAt ? "scheduled" : "draft",
      scheduledAt,
      createdById: me.id,
    },
  });
  if (!scheduledAt) after(() => runBroadcast(b.id));
  return json({ id: b.id, status: scheduledAt ? "scheduled" : "sending" }, 201);
});
