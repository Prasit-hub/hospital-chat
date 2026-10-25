import { hmacSha256, safeEqual } from "@/lib/crypto";
import type { ChannelAdapter, IncomingEvent, OutgoingMessage } from "./types";
import { SendError } from "./types";

// LINE Messaging API — https://developers.line.biz/en/reference/messaging-api/

export interface LineCreds {
  channelSecret: string;
  accessToken: string;
}

const API = () => process.env.LINE_API_BASE || "https://api.line.me";
export const LINE_DATA_API = () => process.env.LINE_DATA_API_BASE || "https://api-data.line.me";

interface LineWebhookBody {
  destination: string;
  events: Array<{
    type: string;
    timestamp: number;
    replyToken?: string;
    source?: { type: string; userId?: string };
    webhookEventId?: string;
    message?: {
      id: string;
      type: string;
      text?: string;
      packageId?: string;
      stickerId?: string;
      fileName?: string;
      contentProvider?: { type: "line" | "external"; originalContentUrl?: string };
    };
  }>;
}

function toLineMessage(msg: OutgoingMessage) {
  if (msg.kind === "image" && msg.imageUrl) {
    return { type: "image", originalContentUrl: msg.imageUrl, previewImageUrl: msg.imageUrl };
  }
  // LINE ไม่มีข้อความประเภทไฟล์แนบทั่วไป — ส่งเป็นข้อความตัวหนังสือพร้อมลิงก์แทน
  if (msg.kind === "file" && msg.fileUrl) {
    return { type: "text", text: `ไฟล์แนบ: ${msg.fileName ?? msg.fileUrl}\n${msg.fileUrl}` };
  }
  return { type: "text", text: msg.text ?? "" };
}

async function call(path: string, token: string, body: unknown) {
  const res = await fetch(API() + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new SendError(`LINE ${path} ${res.status}: ${text}`, `LINE ปฏิเสธการส่ง (${res.status})`);
  return text ? JSON.parse(text) : {};
}

export const lineAdapter: ChannelAdapter<LineCreds> = {
  type: "line",

  verifySignature(rawBody, headers, creds) {
    const sig = headers.get("x-line-signature");
    if (!sig) return false;
    return safeEqual(hmacSha256(creds.channelSecret, rawBody, "base64"), sig);
  },

  parse(body) {
    const b = body as LineWebhookBody;
    const out: IncomingEvent[] = [];
    for (const ev of b.events ?? []) {
      if (ev.type !== "message" || !ev.message || !ev.source?.userId) continue;
      const m = ev.message;
      const base = {
        channelExternalId: b.destination,
        userExternalId: ev.source.userId,
        messageExternalId: `line:${m.id}`,
        timestamp: ev.timestamp,
        replyToken: ev.replyToken,
        source: "dm" as const,
      };
      switch (m.type) {
        case "text":
          out.push({ ...base, kind: "text", text: m.text ?? "" });
          break;
        case "image":
          out.push({
            ...base,
            kind: "image",
            text: "ส่งรูปภาพ",
            // รูปที่อัปโหลดผ่าน LINE ต้องดึงด้วย token — ใช้ proxy ของเรา (ใส่ channelId ภายหลังใน ingest)
            mediaUrl: m.contentProvider?.type === "external" ? m.contentProvider.originalContentUrl : `line-content:${m.id}`,
          });
          break;
        case "sticker":
          out.push({
            ...base,
            kind: "sticker",
            text: "ส่งสติกเกอร์",
            mediaUrl: `https://stickershop.line-scdn.net/stickershop/v1/sticker/${m.stickerId}/android/sticker.png`,
          });
          break;
        case "file":
          out.push({ ...base, kind: "file", text: `ส่งไฟล์ ${m.fileName ?? ""}`.trim() });
          break;
        default:
          out.push({ ...base, kind: "text", text: `[${m.type}]` });
      }
    }
    return out;
  },

  async send(creds, ctx, msg) {
    const messages = [toLineMessage(msg)];
    // ใช้ reply token ก่อน (ไม่นับโควตา) ถ้าใช้ไม่ได้ค่อย push
    if (ctx.replyToken) {
      try {
        const r = await call("/v2/bot/message/reply", creds.accessToken, { replyToken: ctx.replyToken, messages });
        return { externalId: r?.sentMessages?.[0]?.id ? `line:${r.sentMessages[0].id}` : undefined };
      } catch {
        /* token หมดอายุ/ใช้ไปแล้ว → push */
      }
    }
    const r = await call("/v2/bot/message/push", creds.accessToken, { to: ctx.recipientId, messages });
    return { externalId: r?.sentMessages?.[0]?.id ? `line:${r.sentMessages[0].id}` : undefined };
  },

  async getProfile(creds, userId) {
    const res = await fetch(`${API()}/v2/bot/profile/${encodeURIComponent(userId)}`, {
      headers: { Authorization: `Bearer ${creds.accessToken}` },
    });
    if (!res.ok) return null;
    const p = (await res.json()) as { displayName: string; pictureUrl?: string };
    return { name: p.displayName, pictureUrl: p.pictureUrl };
  },
};

/** ใช้ตอนเชื่อมต่อ: ตรวจ token และดึง bot user ID (ตรงกับ destination ใน webhook) */
export async function lineBotInfo(accessToken: string) {
  const res = await fetch(`${API()}/v2/bot/info`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`LINE token ไม่ถูกต้อง (${res.status})`);
  return (await res.json()) as { userId: string; basicId: string; displayName: string };
}

/** ส่งข้อความเดียวกันถึงผู้ใช้หลายคน (สูงสุด 500 คนต่อครั้ง) — นับโควตาตามจำนวนผู้รับ */
export async function lineMulticast(creds: LineCreds, userIds: string[], msg: OutgoingMessage) {
  for (let i = 0; i < userIds.length; i += 500) {
    await call("/v2/bot/message/multicast", creds.accessToken, { to: userIds.slice(i, i + 500), messages: [toLineMessage(msg)] });
  }
}
