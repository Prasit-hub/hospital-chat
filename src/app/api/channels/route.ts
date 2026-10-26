import { randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, handle, json, parseBody } from "@/lib/api";
import { decryptJson, encryptJson } from "@/lib/crypto";
import { currentUser } from "@/lib/auth";
import { lineBotInfo } from "@/lib/channels/line";
import { metaPageInfo } from "@/lib/channels/meta";
import { verifyEmailAccount, type EmailCreds } from "@/lib/channels/email";
import type { YeastarCreds } from "@/lib/channels/yeastar";
import { uiChannel } from "@/lib/inbox/serialize";

export const dynamic = "force-dynamic";

function webhookUrl(req: Request, c: { id: string; type: string }) {
  if (c.type === "email") return "";
  const base = process.env.PUBLIC_BASE_URL || new URL(req.url).origin;
  if (c.type === "line") return `${base}/api/webhooks/line/${c.id}`;
  if (c.type === "phone") return `${base}/api/webhooks/yeastar/${c.id}`;
  return `${base}/api/webhooks/meta`;
}

/** โทเคนสุ่มสำหรับช่องทางที่ไม่มี signature แบบ HMAC (เช่น Yeastar) — ใส่เป็น ?token= หรือ Authorization: Bearer */
function webhookToken(c: { type: string; credentials: string }): string | undefined {
  if (c.type !== "phone") return undefined;
  return decryptJson<YeastarCreds>(c.credentials).token;
}

function emailStatus(c: { type: string; state: unknown }) {
  if (c.type !== "email") return undefined;
  const s = (c.state ?? {}) as { lastPolledAt?: string; lastError?: string | null };
  return { lastPolledAt: s.lastPolledAt ?? null, lastError: s.lastError ?? null };
}

export const GET = handle(async (req: Request) => {
  const me = await currentUser();
  const rows = await prisma.channel.findMany({ where: { orgId: me.orgId }, orderBy: { createdAt: "asc" } });
  return json(rows.map((c) => ({ ...uiChannel(c), webhookUrl: webhookUrl(req, c), webhookToken: webhookToken(c), email: emailStatus(c) })));
});

const Post = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("line"),
    channelSecret: z.string().trim().min(10),
    accessToken: z.string().trim().min(20),
  }),
  z.object({
    type: z.literal("facebook"),
    accessToken: z.string().trim().min(20),
    /** เชื่อม Instagram ที่ผูกกับเพจนี้ด้วย */
    includeInstagram: z.boolean().default(true),
  }),
  z.object({
    type: z.literal("email"),
    address: z.string().trim().toLowerCase().email(),
    fromName: z.string().trim().max(100).default(""),
    username: z.string().trim().min(1).max(200),
    password: z.string().min(1).max(500),
    imapHost: z.string().trim().min(1).max(200),
    imapPort: z.coerce.number().int().min(1).max(65535),
    imapSecure: z.boolean(),
    smtpHost: z.string().trim().min(1).max(200),
    smtpPort: z.coerce.number().int().min(1).max(65535),
    smtpSecure: z.boolean(),
    allowSelfSigned: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("phone"),
    name: z.string().trim().min(1).max(100).default("โทรศัพท์ (Yeastar)"),
  }),
]);

async function upsertChannel(orgId: string, type: "line" | "facebook" | "instagram" | "email" | "phone", externalId: string, name: string, creds: object, followers = 0) {
  return prisma.channel.upsert({
    where: { type_externalId: { type, externalId } },
    create: { orgId, type, externalId, name, credentials: encryptJson(creds), followers },
    update: { name, credentials: encryptJson(creds), connected: true, followers },
  });
}

export const POST = handle(async (req: Request) => {
  const me = await currentUser();
  if (me.role === "agent") return apiError("เฉพาะเจ้าของหรือผู้ดูแลเท่านั้นที่เชื่อมต่อช่องทางได้", 403);
  const body = await parseBody(req, Post);

  if (body.type === "line") {
    let info;
    try {
      info = await lineBotInfo(body.accessToken);
    } catch (e) {
      return apiError((e as Error).message, 400);
    }
    const c = await upsertChannel(me.orgId, "line", info.userId, info.displayName, {
      channelSecret: body.channelSecret,
      accessToken: body.accessToken,
    });
    return json([{ ...uiChannel(c), webhookUrl: webhookUrl(req, c) }], 201);
  }

  if (body.type === "phone") {
    const token = randomBytes(24).toString("base64url");
    const externalId = `yeastar:${randomBytes(8).toString("hex")}`;
    const c = await upsertChannel(me.orgId, "phone", externalId, body.name, { token } satisfies YeastarCreds);
    return json([{ ...uiChannel(c), webhookUrl: webhookUrl(req, c), webhookToken: token }], 201);
  }

  if (body.type === "email") {
    const { type: _t, ...creds } = body;
    void _t;
    try {
      await verifyEmailAccount(creds as EmailCreds);
    } catch (e) {
      return apiError((e as Error).message, 400);
    }
    const c = await upsertChannel(me.orgId, "email", creds.address, creds.fromName || creds.address, creds);
    // เริ่มนับอีเมลใหม่จากตอนนี้ (ล้างสถานะเดิมถ้าเคยเชื่อมแล้ว)
    await prisma.channel.update({ where: { id: c.id }, data: { state: {} } });
    return json([{ ...uiChannel(c), webhookUrl: "", email: { lastPolledAt: null, lastError: null } }], 201);
  }

  let page;
  try {
    page = await metaPageInfo(body.accessToken);
  } catch (e) {
    return apiError((e as Error).message, 400);
  }
  const creds = { accessToken: body.accessToken };
  const created = [await upsertChannel(me.orgId, "facebook", page.id, page.name, creds, page.followers_count ?? 0)];
  const ig = page.instagram_business_account;
  if (body.includeInstagram && ig) {
    created.push(await upsertChannel(me.orgId, "instagram", ig.id, ig.username ? `@${ig.username}` : page.name, creds, ig.followers_count ?? 0));
  }
  // สมัครรับ webhook ของเพจนี้ให้แอป (ทำซ้ำได้ ไม่เป็นไร)
  const graph = process.env.META_GRAPH_BASE || "https://graph.facebook.com";
  const ver = process.env.META_GRAPH_VERSION || "v23.0";
  await fetch(`${graph}/${ver}/${page.id}/subscribed_apps?subscribed_fields=messages,messaging_echoes,feed`, {
    method: "POST",
    headers: { Authorization: `Bearer ${body.accessToken}` },
  }).catch((e) => console.warn("[channels] subscribe page failed", e));

  return json(created.map((c) => ({ ...uiChannel(c), webhookUrl: webhookUrl(req, c) })), 201);
});
