import { Prisma, type Channel, type Conversation, type MessageKind } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { publish } from "@/lib/realtime";
import { fetchProfile, sendViaChannel, SendError } from "@/lib/channels";
import { replySubject } from "@/lib/channels/email";
import type { IncomingEvent, OutgoingMessage } from "@/lib/channels/types";
import { APP_TZ } from "@/lib/time";
import { caseForAgentReply, caseForIncoming, openCase } from "@/lib/cases";

const AVATAR_COLORS = ["#f97316", "#0ea5e9", "#ec4899", "#22c55e", "#8b5cf6", "#14b8a6", "#eab308", "#ef4444", "#6366f1"];
/** LINE reply token ใช้ได้ช่วงสั้นๆ หลังได้รับ — เผื่อเวลาไว้ */
const REPLY_TOKEN_TTL_MS = 50_000;

function colorFor(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function preview(kind: MessageKind | OutgoingMessage["kind"], text: string) {
  if (kind === "image") return "ส่งรูปภาพ";
  if (kind === "sticker") return "ส่งสติกเกอร์";
  return text.replace(/\s+/g, " ").slice(0, 120);
}

const isUnique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

export interface OrgSettings {
  welcome?: { enabled: boolean; text: string };
  /** คำที่ทำให้ระบบติดป้ายเร่งด่วน + ข้อความแนะนำที่ส่งให้คนไข้ทันที (ทีมคลินิกเป็นผู้กำหนด) */
  urgent?: { enabled: boolean; keywords: string[]; replyEnabled: boolean; reply: string };
  away?: { enabled: boolean; text: string; start: string; end: string; days: number[] };
}

/* ------------------------------------------------------------------ */
/* ขาเข้า: webhook → ฐานข้อมูล → แจ้งหน้าจอแบบ realtime                 */
/* ------------------------------------------------------------------ */

export async function ingest(channel: Channel, ev: IncomingEvent) {
  // กันซ้ำ: แพลตฟอร์มอาจส่ง webhook ซ้ำเมื่อเราตอบช้า
  if (await prisma.message.findUnique({ where: { externalId: ev.messageExternalId }, select: { id: true } })) return;

  // 1) ลูกค้า
  let contact = await prisma.contact.findUnique({
    where: { channelId_externalId: { channelId: channel.id, externalId: ev.userExternalId } },
  });
  let isNewContact = false;
  if (!contact) {
    const profile = await fetchProfile(channel, ev.userExternalId);
    const fallback = { line: "ผู้ติดต่อ LINE", facebook: "ผู้ติดต่อ Facebook", instagram: "ผู้ติดต่อ Instagram", tiktok: "ผู้ติดต่อ TikTok", email: "ผู้ติดต่ออีเมล" }[channel.type];
    const name =
      profile?.name ?? ev.senderName ?? (channel.type === "email" ? ev.userExternalId : `${fallback} ${ev.userExternalId.slice(-4)}`);
    const avatarColor = colorFor(ev.userExternalId);
    try {
      // บัญชีใหม่ → เปิดแฟ้มคนไข้ใหม่ไว้ก่อน เจ้าหน้าที่รวมกับแฟ้มเดิมได้ภายหลัง (ระบบจะแนะนำถ้าข้อมูลตรงกัน)
      contact = await prisma.$transaction(async (tx) => {
        const patient = await tx.patient.create({
          data: {
            orgId: channel.orgId,
            name,
            email: channel.type === "email" ? ev.userExternalId : undefined,
            avatarColor,
            tags: { connect: await newPatientTag(channel.orgId) },
          },
        });
        return tx.contact.create({
          data: {
            orgId: channel.orgId,
            channelId: channel.id,
            externalId: ev.userExternalId,
            name,
            pictureUrl: profile?.pictureUrl,
            avatarColor,
            patientId: patient.id,
          },
        });
      });
      isNewContact = !ev.echo;
    } catch (e) {
      if (!isUnique(e)) throw e;
      contact = await prisma.contact.findUniqueOrThrow({
        where: { channelId_externalId: { channelId: channel.id, externalId: ev.userExternalId } },
      });
    }
  }

  // 2) ห้องแชท (1 ห้องต่อ ลูกค้า + ประเภท dm/comment) — ข้อความใหม่จะเปิดห้องที่ปิดไปแล้วอีกครั้ง
  const at = new Date(ev.timestamp || Date.now());
  const conversation = await prisma.conversation.upsert({
    where: { contactId_channelId_source: { contactId: contact.id, channelId: channel.id, source: ev.source } },
    create: { contactId: contact.id, channelId: channel.id, source: ev.source, lastMessageAt: at },
    update: {},
  });

  // 3) งาน: ข้อความจากคนไข้เข้างานที่เปิดอยู่ หรือเปิดงานใหม่ "รอรับ" (ข้อความที่แอดมินส่งจากแอปแพลตฟอร์มเองผูกกับงานที่เปิดอยู่ถ้ามี)
  const caseId = ev.echo
    ? ((await openCase(contact.patientId))?.id ?? null)
    : (await caseForIncoming(channel.orgId, contact.patientId)).case.id;

  // 4) ข้อความ
  let message;
  try {
    message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        caseId,
        sender: ev.echo ? "agent" : "customer",
        kind: ev.kind,
        text: ev.text,
        subject: ev.subject || null,
        mediaUrl: ev.mediaUrl?.startsWith("line-content:")
          ? `/api/media/line/${channel.id}/${ev.mediaUrl.slice("line-content:".length)}`
          : ev.mediaUrl,
        externalId: ev.messageExternalId,
        status: ev.echo ? "sent" : "received",
        createdAt: at,
      },
    });
  } catch (e) {
    if (isUnique(e)) return; // มีคนบันทึกไปแล้วระหว่างทาง
    throw e;
  }

  const fromCustomer = !ev.echo;
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      lastMessage: (ev.echo ? "คุณ: " : ev.source === "comment" ? "คอมเมนต์: " : "") + preview(ev.kind, ev.text),
      lastMessageAt: at,
      ...(fromCustomer && {
        unread: { increment: 1 },
        lastCustomerMessageAt: at,
        replyToken: ev.replyToken ?? null,
        replyTokenAt: ev.replyToken ? new Date() : null,
      }),
    },
  });

  publish({ type: "message", conversationId: conversation.id, messageId: message.id });

  if (fromCustomer) {
    // เรื่องเร่งด่วนมาก่อน: ไม่ส่งข้อความต้อนรับ/คีย์เวิร์ดซ้อนกับข้อความแนะนำฉุกเฉิน
    const urgent = await checkUrgent(channel, conversation.id, caseId!, ev);
    if (!urgent) await runAutoReply(channel, conversation.id, ev, isNewContact);
  }
}

async function newPatientTag(orgId: string) {
  const tag = await prisma.tag.findFirst({ where: { orgId, name: "ติดต่อครั้งแรก" }, select: { id: true } });
  return tag ? [tag] : [];
}

/** ตรวจคำที่ตั้งไว้ว่าเป็นเรื่องเร่งด่วน → ติดป้ายที่งาน + แจ้งเตือนเจ้าหน้าที่ (+ ส่งข้อความแนะนำถ้าเปิดไว้) */
async function checkUrgent(channel: Channel, conversationId: string, caseId: string, ev: IncomingEvent) {
  if (ev.kind !== "text" || !ev.text) return false;
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: channel.orgId } });
  const u = (org.settings as OrgSettings)?.urgent;
  if (!u?.enabled || !u.keywords?.length) return false;
  const text = ev.text.toLowerCase();
  const hit = u.keywords.find((k) => k.trim() && text.includes(k.trim().toLowerCase()));
  if (!hit) return false;
  const c = await prisma.case.findUniqueOrThrow({ where: { id: caseId } });
  if (c.urgent) return true;
  await prisma.case.update({ where: { id: caseId }, data: { urgent: true, urgentReason: `ระบบพบคำว่า “${hit}”`, urgentAt: new Date() } });
  await prisma.caseEvent.create({ data: { caseId, type: "urgent", meta: { auto: true, keyword: hit } } });
  await addInternal(conversationId, "system", `ระบบติดป้ายเร่งด่วน: พบคำว่า “${hit}” — โปรดตรวจสอบทันที`);
  publish({ type: "case", caseId });
  if (u.replyEnabled && u.reply) {
    await sendOutgoing(conversationId, { sender: "bot" }, { kind: "text", text: u.reply }).catch((e) => console.warn("[urgent-reply] failed", e));
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* ตอบกลับอัตโนมัติ: ข้อความต้อนรับ → คีย์เวิร์ด → นอกเวลาทำการ           */
/* ------------------------------------------------------------------ */

async function runAutoReply(channel: Channel, conversationId: string, ev: IncomingEvent, isNewContact: boolean) {
  if (ev.source !== "dm") return;
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: channel.orgId } });
  const settings = (org.settings ?? {}) as OrgSettings;

  let reply: string | undefined;
  if (isNewContact && settings.welcome?.enabled) {
    reply = settings.welcome.text;
  }
  if (!reply && ev.kind === "text") {
    const rules = await prisma.autoReplyRule.findMany({ where: { orgId: channel.orgId, enabled: true } });
    const text = ev.text.toLowerCase();
    reply = rules.find((r) => r.channels.includes(channel.type) && r.keywords.some((k) => text.includes(k.toLowerCase())))?.reply;
  }
  if (!reply && settings.away?.enabled && !isBusinessHours(settings.away)) {
    const recentBot = await prisma.message.findFirst({
      where: { conversationId, sender: "bot", createdAt: { gt: new Date(Date.now() - 2 * 60 * 60_000) } },
    });
    if (!recentBot) reply = settings.away.text;
  }
  if (reply) {
    await sendOutgoing(conversationId, { sender: "bot" }, { kind: "text", text: reply }).catch((e) =>
      console.warn("[auto-reply] failed", e),
    );
  }
}

function isBusinessHours(away: NonNullable<OrgSettings["away"]>) {
  const now = new Date();
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: APP_TZ, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  const hm = `${parts.hour}:${parts.minute}`;
  return away.days.includes(day) && hm >= away.start && hm < away.end;
}

/* ------------------------------------------------------------------ */
/* ขาออก: แอดมิน/บอท ตอบลูกค้า                                         */
/* ------------------------------------------------------------------ */

export async function sendOutgoing(
  conversationId: string,
  who: { sender: "agent"; agentId: string } | { sender: "bot" },
  msg: OutgoingMessage,
) {
  const conv = await prisma.conversation.findUniqueOrThrow({
    where: { id: conversationId },
    include: { channel: true, contact: true },
  });
  // เจ้าหน้าที่ตอบ = รับงานให้อัตโนมัติ (ถ้ายังไม่มีผู้รับ) / ไม่มีงานเปิด → เปิดงานใหม่ในชื่อผู้ตอบ
  const caseId =
    who.sender === "agent"
      ? (await caseForAgentReply(conv.channel.orgId, conv.contact.patientId, who.agentId)).id
      : ((await openCase(conv.contact.patientId))?.id ?? null);

  const message = await prisma.message.create({
    data: {
      conversationId,
      caseId,
      sender: who.sender,
      agentId: who.sender === "agent" ? who.agentId : null,
      kind: msg.kind,
      text: msg.text ?? "",
      mediaUrl: msg.imageUrl,
      status: "sending",
    },
  });
  publish({ type: "message", conversationId, messageId: message.id });

  const replyToken = usableReplyToken(conv);
  // อีเมล: ตอบในหัวเรื่องเดิมของลูกค้า (Re: ...)
  const subject =
    conv.channel.type === "email"
      ? ((
          await prisma.message.findFirst({
            where: { conversationId, sender: "customer", subject: { not: null } },
            orderBy: { createdAt: "desc" },
            select: { subject: true },
          })
        )?.subject ?? undefined)
      : undefined;
  if (subject) await prisma.message.update({ where: { id: message.id }, data: { subject: replySubject(subject, subject) } });
  try {
    const result = await sendViaChannel(
      conv.channel,
      { recipientId: conv.contact.externalId, replyToken, lastCustomerMessageAt: conv.lastCustomerMessageAt, subject },
      msg,
    );
    const updated = await prisma.message.update({
      where: { id: message.id },
      data: { status: "sent", externalId: result.externalId },
    });
    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        lastMessage: (who.sender === "bot" ? "บอท: " : "คุณ: ") + preview(msg.kind, msg.text ?? ""),
        lastMessageAt: updated.createdAt,
        // reply token ของ LINE ใช้ได้ครั้งเดียว
        ...(conv.channel.type === "line" && replyToken ? { replyToken: null, replyTokenAt: null } : {}),
      },
    });
    publish({ type: "message_status", conversationId, messageId: message.id, status: "sent" });
    return updated;
  } catch (e) {
    const userMessage = e instanceof SendError ? e.userMessage : "ส่งข้อความไม่สำเร็จ";
    console.error("[send] failed", e);
    const failed = await prisma.message.update({ where: { id: message.id }, data: { status: "failed", error: userMessage } });
    publish({ type: "message_status", conversationId, messageId: message.id, status: "failed" });
    return failed;
  }
}

function usableReplyToken(conv: Conversation & { channel: Channel }) {
  if (!conv.replyToken) return undefined;
  if (conv.channel.type === "line") {
    return conv.replyTokenAt && Date.now() - conv.replyTokenAt.getTime() < REPLY_TOKEN_TTL_MS ? conv.replyToken : undefined;
  }
  // อีเมล: Message-ID ล่าสุดของลูกค้า ใช้ทำ In-Reply-To ให้อยู่ในเธรดเดียวกัน
  if (conv.channel.type === "email") return conv.replyToken;
  // Meta: แชทจากคอมเมนต์ใช้ comment id ตอบแบบ private reply
  return conv.source === "comment" ? conv.replyToken : undefined;
}

/** โน้ตภายใน / ข้อความระบบ — ไม่ส่งออกไปยังลูกค้า */
export async function addInternal(conversationId: string, kind: "note" | "system", text: string, agentId?: string, caseId?: string) {
  if (!caseId) {
    // ผูกกับงานที่เปิดอยู่ของคนไข้ หรืองานล่าสุด
    const conv = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId }, select: { contact: { select: { patientId: true } } } });
    const c =
      (await openCase(conv.contact.patientId)) ??
      (await prisma.case.findFirst({ where: { patientId: conv.contact.patientId }, orderBy: { openedAt: "desc" } }));
    caseId = c?.id;
  }
  const m = await prisma.message.create({
    data: { conversationId, caseId, sender: kind === "note" ? "agent" : "system", agentId, kind, text, status: "sent" },
  });
  publish({ type: "message", conversationId, messageId: m.id });
  return m;
}
