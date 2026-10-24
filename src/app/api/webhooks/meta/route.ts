import { after } from "next/server";
import { prisma } from "@/lib/db";
import { facebookAdapter, verifyMetaSignature } from "@/lib/channels/meta";
import { ingest } from "@/lib/inbox/service";

export const runtime = "nodejs";

// Webhook URL ที่ต้องใส่ใน Meta App Dashboard (ใช้ร่วมกันทั้ง Messenger และ Instagram):
//   https://<โดเมนของคุณ>/api/webhooks/meta
// Verify token = ค่า META_VERIFY_TOKEN ใน .env

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && token && token === process.env.META_VERIFY_TOKEN) {
    return new Response(challenge ?? "", { status: 200 });
  }
  return new Response("forbidden", { status: 403 });
}

export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyMetaSignature(raw, req.headers)) return new Response("invalid signature", { status: 401 });

  const body = JSON.parse(raw) as { object?: string };
  const type = body.object === "instagram" ? "instagram" : body.object === "page" ? "facebook" : null;
  if (!type) return new Response("ignored");

  const events = facebookAdapter.parse(body); // รูปแบบ payload เหมือนกันทั้ง 2 แพลตฟอร์ม
  after(async () => {
    for (const ev of events) {
      try {
        const channel = await prisma.channel.findUnique({
          where: { type_externalId: { type, externalId: ev.channelExternalId } },
        });
        if (!channel?.connected) continue;
        await ingest(channel, ev);
      } catch (e) {
        console.error("[meta webhook] ingest failed", e);
      }
    }
  });
  return new Response("EVENT_RECEIVED");
}
