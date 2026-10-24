import type { ChannelType } from "@/generated/prisma/client";

/** ข้อความขาเข้าในรูปแบบกลาง หลังแปลงจาก payload ของแต่ละแพลตฟอร์ม */
export interface IncomingEvent {
  /** ID บัญชีของเรา (LINE destination / Page ID / IG ID) ใช้หาว่าเป็นช่องทางไหน */
  channelExternalId: string;
  /** ID ลูกค้าบนแพลตฟอร์ม */
  userExternalId: string;
  /** ID ข้อความ ใช้กันซ้ำ */
  messageExternalId: string;
  kind: "text" | "image" | "sticker" | "file";
  text: string;
  mediaUrl?: string;
  timestamp: number;
  /** true = ข้อความที่เพจส่งออกไปเอง (เช่นแอดมินตอบจาก Meta Business Suite) */
  echo?: boolean;
  replyToken?: string;
  source: "dm" | "comment";
  /** ชื่อผู้ส่งที่มากับข้อความ (เช่นชื่อใน From ของอีเมล) ใช้เมื่อดึงโปรไฟล์ไม่ได้ */
  senderName?: string;
  /** หัวเรื่อง (อีเมล) */
  subject?: string;
}

export interface OutgoingMessage {
  kind: "text" | "image";
  text?: string;
  /** URL รูปภาพที่เข้าถึงได้แบบ public (https) */
  imageUrl?: string;
}

export interface SendContext {
  recipientId: string;
  /** LINE: reply token ที่ยังใช้ได้ */
  replyToken?: string;
  /** Meta: เวลาข้อความล่าสุดของลูกค้า สำหรับกฎ 24 ชม. */
  lastCustomerMessageAt?: Date | null;
  /** อีเมล: หัวเรื่องล่าสุดของลูกค้า สำหรับตั้ง "Re: ..." */
  subject?: string;
}

export interface SendResult {
  externalId?: string;
}

export interface Profile {
  name: string;
  pictureUrl?: string;
}

export interface ChannelAdapter<Creds = Record<string, string>> {
  type: ChannelType;
  /** ตรวจลายเซ็น webhook */
  verifySignature(rawBody: string, headers: Headers, creds: Creds): boolean;
  /** แปลง payload เป็นข้อความกลาง */
  parse(body: unknown): IncomingEvent[];
  send(creds: Creds, ctx: SendContext, msg: OutgoingMessage): Promise<SendResult>;
  getProfile(creds: Creds, userExternalId: string): Promise<Profile | null>;
}

export class SendError extends Error {
  constructor(
    message: string,
    public readonly userMessage: string,
    public readonly status = 502,
  ) {
    super(message);
  }
}
