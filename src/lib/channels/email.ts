import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";
import nodemailer from "nodemailer";
import type { Channel } from "@/generated/prisma/client";
import type { ChannelAdapter, IncomingEvent, OutgoingMessage, SendContext } from "./types";
import { SendError } from "./types";

// ช่องทางอีเมล: อ่านอีเมลเข้าจาก INBOX ด้วย IMAP (ตรวจเป็นรอบ) และตอบกลับด้วย SMTP
// ใช้ได้กับ Gmail / Google Workspace (App Password), อีเมลโฮสติ้ง, Zoho ฯลฯ

export interface EmailCreds {
  address: string;
  fromName: string;
  username: string;
  password: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  /** true = SSL/TLS ตั้งแต่ต้น (พอร์ต 465), false = STARTTLS (พอร์ต 587) */
  smtpSecure: boolean;
  /** ยอมรับใบรับรองที่ไม่ถูกต้อง (เฉพาะเซิร์ฟเวอร์ภายในที่ใช้ self-signed) */
  allowSelfSigned?: boolean;
}

export interface EmailState {
  uidValidity?: string;
  lastUid?: number;
  lastPolledAt?: string;
  lastError?: string | null;
}

const MAX_TEXT = 20_000;
const MAX_IMAGE_BYTES = 1_500_000;
const MAX_IMAGES = 4;

function imapClient(c: EmailCreds) {
  return new ImapFlow({
    host: c.imapHost,
    port: c.imapPort,
    secure: c.imapSecure,
    auth: { user: c.username, pass: c.password },
    logger: false,
    tls: c.allowSelfSigned ? { rejectUnauthorized: false } : undefined,
    socketTimeout: 60_000,
  });
}

function smtpTransport(c: EmailCreds) {
  return nodemailer.createTransport({
    host: c.smtpHost,
    port: c.smtpPort,
    secure: c.smtpSecure,
    auth: { user: c.username, pass: c.password },
    tls: c.allowSelfSigned ? { rejectUnauthorized: false } : undefined,
    connectionTimeout: 20_000,
  });
}

function friendlyError(e: unknown) {
  const msg = (e as Error)?.message ?? String(e);
  const resp = (e as { responseText?: string; response?: string })?.responseText ?? (e as { response?: string })?.response;
  if (/auth|login|credentials|Invalid/i.test(msg + (resp ?? ""))) return "ชื่อผู้ใช้หรือรหัสผ่านอีเมลไม่ถูกต้อง (Gmail ต้องใช้ App Password)";
  if (/ENOTFOUND|getaddrinfo/i.test(msg)) return "ไม่พบเซิร์ฟเวอร์อีเมล — ตรวจชื่อ host";
  if (/ECONNREFUSED|ETIMEDOUT|timeout/i.test(msg)) return "เชื่อมต่อเซิร์ฟเวอร์อีเมลไม่ได้ — ตรวจพอร์ตและการตั้งค่า SSL";
  if (/certificate|self.signed/i.test(msg)) return "ใบรับรอง SSL ของเซิร์ฟเวอร์อีเมลไม่ถูกต้อง";
  return msg.slice(0, 200);
}

/** ตรวจว่าเข้าสู่ระบบ IMAP และ SMTP ได้ (ใช้ตอนเชื่อมต่อช่องทาง) */
export async function verifyEmailAccount(c: EmailCreds) {
  const client = imapClient(c);
  try {
    await client.connect();
    await client.mailboxOpen("INBOX", { readOnly: true });
  } catch (e) {
    throw new Error("IMAP: " + friendlyError(e));
  } finally {
    await client.logout().catch(() => {});
  }
  try {
    await smtpTransport(c).verify();
  } catch (e) {
    throw new Error("SMTP: " + friendlyError(e));
  }
}

/* ------------------------------------------------------------------ */
/* อ่านอีเมลเข้า                                                       */
/* ------------------------------------------------------------------ */

/** ตัดข้อความที่ quote จากอีเมลก่อนหน้า (On ... wrote: / > ...) ออก ให้เหลือเฉพาะข้อความใหม่ */
export function stripQuoted(text: string) {
  const t = text.replace(/\r\n?/g, "\n");
  const cut = t.search(
    /\n\s*(On\s[^\n]{0,200}(\n[^\n]{0,200})?wrote:|เมื่อ[^\n]{0,200}(\n[^\n]{0,200})?เขียนว่า:?|-{2,}\s*Original Message\s*-{2,}|_{8,}\s*\n\s*From:|From:\s[^\n]+\n\s*Sent:\s)/i,
  );
  const head = cut > 0 ? t.slice(0, cut) : t;
  const cleaned = head
    .split("\n")
    .filter((l) => !/^\s*>/.test(l))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return (cleaned || t.trim()).slice(0, MAX_TEXT);
}

function isAutomated(m: ParsedMail, ownAddress: string) {
  const from = m.from?.value?.[0]?.address?.toLowerCase() ?? "";
  if (!from || from === ownAddress.toLowerCase()) return true;
  if (/^(mailer-daemon|postmaster)@/i.test(from)) return true;
  const auto = String(m.headers.get("auto-submitted") ?? "").toLowerCase();
  if (auto && auto !== "no") return true;
  const prec = String(m.headers.get("precedence") ?? "").toLowerCase();
  if (["bulk", "junk", "list", "auto_reply"].includes(prec)) return true;
  if (m.headers.get("x-autoreply") || m.headers.get("x-autorespond")) return true;
  return false;
}

/** แปลงอีเมล 1 ฉบับเป็นข้อความกลาง (ข้อความ + รูปแนบแยกเป็นข้อความรูปภาพ) */
export function emailToEvents(m: ParsedMail, ownAddress: string, uid: number): IncomingEvent[] {
  if (isAutomated(m, ownAddress)) return [];
  const sender = m.from!.value[0];
  const messageId = m.messageId ?? `<uid-${uid}@${ownAddress}>`;
  const base = {
    channelExternalId: ownAddress.toLowerCase(),
    userExternalId: sender.address!.toLowerCase(),
    senderName: sender.name || undefined,
    timestamp: (m.date ?? new Date()).getTime(),
    replyToken: messageId,
    source: "dm" as const,
    subject: m.subject ?? "",
  };
  const files = (m.attachments ?? []).filter((a) => a.contentDisposition !== "inline" || !a.contentType.startsWith("image/"));
  const images = files.filter((a) => a.contentType.startsWith("image/") && a.size <= MAX_IMAGE_BYTES).slice(0, MAX_IMAGES);
  const others = files.filter((a) => !images.includes(a));

  let body = stripQuoted(m.text ?? "");
  if (others.length) body += `${body ? "\n\n" : ""}📎 ไฟล์แนบ: ${others.map((a) => a.filename ?? "ไม่มีชื่อ").join(", ")}`;

  const events: IncomingEvent[] = [];
  if (body || !images.length) {
    events.push({ ...base, messageExternalId: `email:${messageId}`, kind: "text", text: body || "(อีเมลไม่มีเนื้อหา)" });
  }
  images.forEach((a, i) => {
    events.push({
      ...base,
      messageExternalId: `email:${messageId}:img${i}`,
      kind: "image",
      text: a.filename ?? "รูปภาพ",
      mediaUrl: `data:${a.contentType};base64,${a.content.toString("base64")}`,
    });
  });
  return events;
}

/**
 * ดึงอีเมลใหม่ตั้งแต่ UID ล่าสุดที่อ่าน (ไม่เปลี่ยนสถานะอ่าน/ไม่อ่านในกล่องจดหมาย)
 * ครั้งแรกที่เชื่อมต่อจะเริ่มนับจากอีเมลถัดไป ไม่ดึงอีเมลเก่าย้อนหลัง
 */
export async function fetchNewEmails(c: EmailCreds, state: EmailState): Promise<{ events: IncomingEvent[]; state: EmailState }> {
  const client = imapClient(c);
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX", { readOnly: true });
    try {
      const mb = client.mailbox;
      if (!mb) throw new Error("เปิด INBOX ไม่ได้");
      const validity = String(mb.uidValidity);
      const latest = mb.uidNext - 1;
      if (state.lastUid == null || state.uidValidity !== validity) {
        return { events: [], state: { ...state, uidValidity: validity, lastUid: latest } };
      }
      if (latest <= state.lastUid) return { events: [], state };

      const msgs = await client.fetchAll(`${state.lastUid + 1}:*`, { uid: true, source: true }, { uid: true });
      const events: IncomingEvent[] = [];
      let maxUid = state.lastUid;
      for (const msg of msgs.sort((a, b) => a.uid - b.uid)) {
        if (msg.uid <= state.lastUid || !msg.source) continue;
        maxUid = Math.max(maxUid, msg.uid);
        try {
          events.push(...emailToEvents(await simpleParser(msg.source), c.address, msg.uid));
        } catch (e) {
          console.warn("[email] parse failed uid", msg.uid, e);
        }
      }
      return { events, state: { ...state, lastUid: maxUid } };
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
}

/* ------------------------------------------------------------------ */
/* ส่งอีเมลตอบกลับ                                                    */
/* ------------------------------------------------------------------ */

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

export function replySubject(subject: string | undefined, fallback: string) {
  const s = (subject ?? "").trim();
  if (!s) return fallback;
  return /^(re|ตอบกลับ)\s*:/i.test(s) ? s : `Re: ${s}`;
}

export const emailAdapter: ChannelAdapter<EmailCreds> = {
  type: "email",
  verifySignature: () => false, // ไม่มี webhook — ใช้การตรวจกล่องจดหมายแทน
  parse: () => [],

  async send(c, ctx: SendContext, msg: OutgoingMessage) {
    const text = msg.kind === "image" ? `รูปภาพ: ${msg.imageUrl}` : (msg.text ?? "");
    const html =
      msg.kind === "image"
        ? `<p><img src="${escapeHtml(msg.imageUrl ?? "")}" alt="" style="max-width:100%"></p>`
        : `<div style="font-family:sans-serif;font-size:14px;line-height:1.6">${escapeHtml(text).replace(/\n/g, "<br>")}</div>`;
    try {
      const info = await smtpTransport(c).sendMail({
        from: { name: c.fromName || c.address, address: c.address },
        to: ctx.recipientId,
        subject: replySubject(ctx.subject, `ข้อความจาก ${c.fromName || c.address}`),
        text,
        html,
        ...(ctx.replyToken ? { inReplyTo: ctx.replyToken, references: [ctx.replyToken] } : {}),
      });
      return { externalId: info.messageId ? `email:${info.messageId}` : undefined };
    } catch (e) {
      throw new SendError(`SMTP send failed: ${(e as Error).message}`, `ส่งอีเมลไม่สำเร็จ: ${friendlyError(e)}`);
    }
  },

  getProfile: async () => null,
};

export function emailState(channel: Pick<Channel, "state">): EmailState {
  return (channel.state ?? {}) as EmailState;
}
