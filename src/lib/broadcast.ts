import type { Broadcast, Channel } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { credsOf, sendViaChannel } from "@/lib/channels";
import { lineMulticast, type LineCreds } from "@/lib/channels/line";
import type { OutgoingMessage } from "@/lib/channels/types";

const DAY = 24 * 60 * 60 * 1000;

/** ผู้รับของบรอดแคสต์ + แยกว่าใครส่งได้ (Meta ส่งได้เฉพาะคนที่ทักมาภายใน 24 ชม.) */
export async function audience(channel: Channel, tagId: string | null) {
  const contacts = await prisma.contact.findMany({
    where: {
      channelId: channel.id,
      // คนไข้ที่ติดแท็ก "ไม่ต้องการรับข่าวสาร" ไม่ได้รับประกาศ
      patient: { profileTags: { none: { def: { blocksBroadcast: true } } } },
      ...(tagId ? { AND: [{ patient: { tags: { some: { id: tagId } } } }] } : {}),
    },
    select: {
      id: true,
      externalId: true,
      conversations: { where: { source: "dm" }, select: { id: true, lastCustomerMessageAt: true }, take: 1 },
    },
  });
  const isMeta = channel.type === "facebook" || channel.type === "instagram";
  const now = Date.now();
  const eligible = contacts.filter((c) => {
    if (!isMeta) return true;
    const last = c.conversations[0]?.lastCustomerMessageAt;
    return !!last && now - last.getTime() < DAY;
  });
  return { contacts, eligible };
}

/** ส่งบรอดแคสต์จริง — เรียกจาก API (ส่งทันที) หรือ scheduler (ตั้งเวลา) */
export async function runBroadcast(id: string) {
  // จองสถานะก่อน กันส่งซ้ำเมื่อมีหลาย worker
  const claimed = await prisma.broadcast.updateMany({
    where: { id, status: { in: ["draft", "scheduled"] } },
    data: { status: "sending" },
  });
  if (!claimed.count) return;

  const b = (await prisma.broadcast.findUniqueOrThrow({ where: { id }, include: { channel: true } })) as Broadcast & { channel: Channel };
  const msg: OutgoingMessage = b.imageUrl ? { kind: "image", imageUrl: b.imageUrl } : { kind: "text", text: b.text };
  const texts: OutgoingMessage[] = b.imageUrl && b.text ? [msg, { kind: "text", text: b.text }] : [msg];

  try {
    if (!b.channel.connected) throw new Error("ช่องทางนี้ถูกยกเลิกการเชื่อมต่อ");
    const { contacts, eligible } = await audience(b.channel, b.tagId);
    let sent = 0;
    let failed = 0;
    const delivered: typeof eligible = [];

    if (b.channel.type === "line" && process.env.OUTBOUND_MODE !== "mock") {
      try {
        for (const m of texts) await lineMulticast(credsOf<LineCreds>(b.channel), eligible.map((c) => c.externalId), m);
        sent = eligible.length;
        delivered.push(...eligible);
      } catch (e) {
        failed = eligible.length;
        throw e;
      }
    } else {
      // Meta ไม่มี multicast → ส่งทีละคน (ครั้งละ 5 คนพร้อมกัน)
      const queue = [...eligible];
      await Promise.all(
        Array.from({ length: 5 }, async () => {
          for (let c = queue.shift(); c; c = queue.shift()) {
            try {
              for (const m of texts) {
                await sendViaChannel(b.channel, { recipientId: c.externalId, lastCustomerMessageAt: c.conversations[0]?.lastCustomerMessageAt }, m);
              }
              sent++;
              delivered.push(c);
            } catch {
              failed++;
            }
          }
        }),
      );
    }

    // บันทึกข้อความลงประวัติแชทของผู้รับ (ไม่ดันแชทขึ้นบนสุด)
    const rows = delivered
      .filter((c) => c.conversations[0])
      .map((c) => ({
        conversationId: c.conversations[0].id,
        sender: "agent" as const,
        agentId: b.createdById,
        kind: (b.imageUrl ? "image" : "text") as "image" | "text",
        text: `📢 ${b.text || "รูปภาพ"}`,
        mediaUrl: b.imageUrl,
        status: "sent" as const,
      }));
    if (rows.length) await prisma.message.createMany({ data: rows });

    await prisma.broadcast.update({
      where: { id },
      data: {
        status: sent === 0 && failed > 0 ? "failed" : "sent",
        sentAt: new Date(),
        targeted: contacts.length,
        sent,
        failed,
        skipped: contacts.length - eligible.length,
      },
    });
  } catch (e) {
    console.error("[broadcast] failed", id, e);
    await prisma.broadcast.update({ where: { id }, data: { status: "failed", error: (e as Error).message.slice(0, 300), sentAt: new Date() } });
  }
}

/** ส่งบรอดแคสต์ที่ถึงเวลา — เรียกทุก 30 วินาทีจาก src/instrumentation.ts */
export async function dispatchDueBroadcasts() {
  const due = await prisma.broadcast.findMany({
    where: { status: "scheduled", scheduledAt: { lte: new Date() } },
    select: { id: true },
    take: 20,
  });
  for (const b of due) await runBroadcast(b.id);
}
