import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, handle, json, parseBody } from "@/lib/api";
import { encryptJson } from "@/lib/crypto";
import { currentUser } from "@/lib/auth";
import { lineBotInfo } from "@/lib/channels/line";
import { metaPageInfo } from "@/lib/channels/meta";
import { verifyEmailAccount, type EmailCreds } from "@/lib/channels/email";
import { uiChannel } from "@/lib/inbox/serialize";

export const dynamic = "force-dynamic";

function webhookUrl(req: Request, c: { id: string; type: string }) {
  if (c.type === "email") return "";
  const base = process.env.PUBLIC_BASE_URL || new URL(req.url).origin;
  return c.type === "line" ? `${base}/api/webhooks/line/${c.id}` : `${base}/api/webhooks/meta`;
}

function emailStatus(c: { type: string; state: unknown }) {
  if (c.type !== "email") return undefined;
  const s = (c.state ?? {}) as { lastPolledAt?: string; lastError?: string | null };
  return { lastPolledAt: s.lastPolledAt ?? null, lastError: s.lastError ?? null };
}

export const GET = handle(async (req: Request) => {
  const me = await currentUser();
  const rows = await prisma.channel.findMany({ where: { orgId: me.orgId }, orderBy: { createdAt: "asc" } });
  return json(rows.map((c) => ({ ...uiChannel(c), webhookUrl: webhookUrl(req, c), email: emailStatus(c) })));
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
]);

async function upsertChannel(orgId: string, type: "line" | "facebook" | "instagram" | "email", externalId: string, name: string, creds: object, followers = 0) {
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
