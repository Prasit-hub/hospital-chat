import type { ChannelType } from "@/generated/prisma/client";
import { hmacSha256, safeEqual } from "@/lib/crypto";
import type { ChannelAdapter, IncomingEvent, OutgoingMessage } from "./types";
import { SendError } from "./types";

// Meta Messenger Platform (Facebook Page) และ Instagram Messaging
// https://developers.facebook.com/docs/messenger-platform

export interface MetaCreds {
  /** Page Access Token (ทั้ง Facebook และ Instagram ที่ผูกกับเพจ) */
  accessToken: string;
}

const GRAPH = () => process.env.META_GRAPH_BASE || "https://graph.facebook.com";
const VERSION = () => process.env.META_GRAPH_VERSION || "v23.0";
const DAY = 24 * 60 * 60 * 1000;

interface MetaAttachment {
  type: string;
  payload?: { url?: string; sticker_id?: number };
}
interface MetaMessaging {
  sender: { id: string };
  recipient: { id: string };
  timestamp: number;
  message?: { mid: string; text?: string; is_echo?: boolean; attachments?: MetaAttachment[]; is_deleted?: boolean };
}
interface MetaChange {
  field: string;
  value: {
    item?: string;
    verb?: string;
    comment_id?: string;
    id?: string;
    message?: string;
    text?: string;
    created_time?: number;
    from?: { id: string; name?: string; username?: string };
  };
}
interface MetaWebhookBody {
  object: "page" | "instagram";
  entry: Array<{ id: string; time: number; messaging?: MetaMessaging[]; changes?: MetaChange[] }>;
}

/** ตรวจ X-Hub-Signature-256 ด้วย App Secret (ใช้ร่วมทุกเพจในแอปเดียวกัน) */
export function verifyMetaSignature(rawBody: string, headers: Headers) {
  const secret = process.env.META_APP_SECRET;
  const sig = headers.get("x-hub-signature-256");
  if (!secret || !sig?.startsWith("sha256=")) return false;
  return safeEqual("sha256=" + hmacSha256(secret, rawBody, "hex"), sig);
}

function parseMeta(body: unknown): IncomingEvent[] {
  const b = body as MetaWebhookBody;
  const out: IncomingEvent[] = [];
  for (const entry of b.entry ?? []) {
    // ข้อความ DM
    for (const m of entry.messaging ?? []) {
      if (!m.message || m.message.is_deleted) continue; // ข้าม read/delivery/postback
      const echo = !!m.message.is_echo;
      const base = {
        channelExternalId: entry.id,
        userExternalId: echo ? m.recipient.id : m.sender.id,
        messageExternalId: `meta:${m.message.mid}`,
        timestamp: m.timestamp,
        echo,
        source: "dm" as const,
      };
      if (m.message.text) out.push({ ...base, kind: "text", text: m.message.text });
      for (const [i, a] of (m.message.attachments ?? []).entries()) {
        const id = i === 0 && !m.message.text ? base.messageExternalId : `${base.messageExternalId}:${i}`;
        if (a.type === "image") {
          const sticker = a.payload?.sticker_id;
          out.push({ ...base, messageExternalId: id, kind: sticker ? "sticker" : "image", text: sticker ? "ส่งสติกเกอร์" : "ส่งรูปภาพ", mediaUrl: a.payload?.url });
        } else {
          out.push({ ...base, messageExternalId: id, kind: "file", text: `ส่ง${a.type === "video" ? "วิดีโอ" : a.type === "audio" ? "เสียง" : "ไฟล์"}`, mediaUrl: a.payload?.url });
        }
      }
    }
    // คอมเมนต์ใต้โพสต์ (FB: field "feed", IG: field "comments")
    for (const c of entry.changes ?? []) {
      const v = c.value;
      const isFbComment = c.field === "feed" && v.item === "comment" && v.verb === "add";
      const isIgComment = c.field === "comments";
      if (!isFbComment && !isIgComment) continue;
      const commentId = v.comment_id ?? v.id;
      if (!commentId || !v.from?.id || v.from.id === entry.id) continue; // ข้ามคอมเมนต์ของเพจเอง
      out.push({
        channelExternalId: entry.id,
        userExternalId: v.from.id,
        messageExternalId: `meta-comment:${commentId}`,
        kind: "text",
        text: v.message ?? v.text ?? "",
        timestamp: v.created_time ? v.created_time * 1000 : Date.now(),
        replyToken: `comment:${commentId}`, // ใช้ comment id สำหรับ private reply
        source: "comment",
      });
    }
  }
  return out;
}

function makeMetaAdapter(type: ChannelType): ChannelAdapter<MetaCreds> {
  const label = type === "instagram" ? "Instagram" : "Messenger";
  return {
    type,
    verifySignature: (raw, headers) => verifyMetaSignature(raw, headers),
    parse: parseMeta,

    async send(creds, ctx, msg: OutgoingMessage) {
      const message =
        msg.kind === "image" && msg.imageUrl
          ? { attachment: { type: "image", payload: { url: msg.imageUrl, is_reusable: true } } }
          : { text: msg.text ?? "" };

      // กฎหน้าต่าง 24 ชม.
      const age = ctx.lastCustomerMessageAt ? Date.now() - new Date(ctx.lastCustomerMessageAt).getTime() : Infinity;
      let extra: Record<string, unknown> = { messaging_type: "RESPONSE" };
      if (age > DAY) {
        if (process.env.META_HUMAN_AGENT_TAG === "true" && age < 7 * DAY) {
          extra = { messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT" };
        } else {
          throw new SendError("outside 24h window", `${label} ตอบได้ภายใน 24 ชม. หลังข้อความล่าสุดของลูกค้าเท่านั้น`, 422);
        }
      }

      // แชทที่มาจากคอมเมนต์ → private reply ไปที่คอมเมนต์
      const recipient = ctx.replyToken?.startsWith("comment:")
        ? { comment_id: ctx.replyToken.slice("comment:".length) }
        : { id: ctx.recipientId };

      const res = await fetch(`${GRAPH()}/${VERSION()}/me/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${creds.accessToken}` },
        body: JSON.stringify({ recipient, message, ...extra }),
      });
      const json = (await res.json().catch(() => ({}))) as { message_id?: string; error?: { message?: string; code?: number } };
      if (!res.ok || json.error) {
        throw new SendError(`Meta send ${res.status}: ${JSON.stringify(json.error)}`, `${label} ปฏิเสธการส่ง: ${json.error?.message ?? res.status}`);
      }
      return { externalId: json.message_id ? `meta:${json.message_id}` : undefined };
    },

    async getProfile(creds, userId) {
      const fields = type === "instagram" ? "name,username,profile_pic" : "first_name,last_name,profile_pic";
      const res = await fetch(`${GRAPH()}/${VERSION()}/${encodeURIComponent(userId)}?fields=${fields}`, {
        headers: { Authorization: `Bearer ${creds.accessToken}` },
      });
      if (!res.ok) return null;
      const p = (await res.json()) as { first_name?: string; last_name?: string; name?: string; username?: string; profile_pic?: string };
      const name = p.name || [p.first_name, p.last_name].filter(Boolean).join(" ") || p.username;
      return name ? { name, pictureUrl: p.profile_pic } : null;
    },
  };
}

export const facebookAdapter = makeMetaAdapter("facebook");
export const instagramAdapter = makeMetaAdapter("instagram");

/** ใช้ตอนเชื่อมต่อ: ตรวจ Page Access Token และดึงข้อมูลเพจ/IG ที่ผูกอยู่ */
export async function metaPageInfo(accessToken: string) {
  const res = await fetch(`${GRAPH()}/${VERSION()}/me?fields=id,name,followers_count,instagram_business_account{id,username,followers_count}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Page Access Token ไม่ถูกต้อง (${res.status})`);
  return (await res.json()) as {
    id: string;
    name: string;
    followers_count?: number;
    instagram_business_account?: { id: string; username?: string; followers_count?: number };
  };
}
