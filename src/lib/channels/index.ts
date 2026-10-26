import type { Channel, ChannelType } from "@/generated/prisma/client";
import { decryptJson } from "@/lib/crypto";
import { lineAdapter } from "./line";
import { facebookAdapter, instagramAdapter } from "./meta";
import { emailAdapter } from "./email";
import { yeastarAdapter } from "./yeastar";
import type { ChannelAdapter, OutgoingMessage, SendContext, SendResult } from "./types";
import { SendError } from "./types";

// TikTok Business Messaging API เปิดให้เฉพาะพาร์ทเนอร์/บางประเทศ
// เมื่อได้สิทธิ์แล้วให้สร้าง src/lib/channels/tiktok.ts ตาม interface ChannelAdapter แล้วลงทะเบียนที่นี่
const tiktokPlaceholder: ChannelAdapter = {
  type: "tiktok",
  verifySignature: () => false,
  parse: () => [],
  send: async () => {
    throw new SendError("tiktok not implemented", "ยังไม่ได้เปิดใช้การส่งข้อความผ่าน TikTok", 501);
  },
  getProfile: async () => null,
};

const adapters: Record<ChannelType, ChannelAdapter<never>> = {
  line: lineAdapter as ChannelAdapter<never>,
  facebook: facebookAdapter as ChannelAdapter<never>,
  instagram: instagramAdapter as ChannelAdapter<never>,
  tiktok: tiktokPlaceholder as ChannelAdapter<never>,
  email: emailAdapter as ChannelAdapter<never>,
  phone: yeastarAdapter as ChannelAdapter<never>,
};

export function adapterFor(type: ChannelType) {
  return adapters[type];
}

export function credsOf<T>(channel: Pick<Channel, "credentials">): T {
  return decryptJson<T>(channel.credentials);
}

/** OUTBOUND_MODE=mock → ไม่ยิง API จริง (ใช้ตอนพัฒนา/สาธิต) */
const isMock = () => process.env.OUTBOUND_MODE === "mock";

export async function sendViaChannel(channel: Channel, ctx: SendContext, msg: OutgoingMessage): Promise<SendResult> {
  if (isMock()) return { externalId: `mock:${Date.now()}:${Math.random().toString(36).slice(2, 8)}` };
  return adapterFor(channel.type).send(credsOf<never>(channel), ctx, msg);
}

export async function fetchProfile(channel: Channel, userExternalId: string) {
  if (isMock()) return null;
  try {
    return await adapterFor(channel.type).getProfile(credsOf<never>(channel), userExternalId);
  } catch (e) {
    console.warn("[profile] failed", channel.type, e);
    return null;
  }
}

export { SendError };
