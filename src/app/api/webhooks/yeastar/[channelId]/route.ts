import { after } from "next/server";
import { prisma } from "@/lib/db";
import { credsOf } from "@/lib/channels";
import { yeastarAdapter, verifyYeastarToken, type YeastarCreds } from "@/lib/channels/yeastar";
import { ingest } from "@/lib/inbox/service";

export const runtime = "nodejs";

// Webhook URL ที่ต้องใส่ในระบบ Yeastar PBX:
//   https://<โดเมนของคุณ>/api/webhooks/yeastar/<channelId>?token=<token ของช่องทางนี้>
// หรือส่ง token มาทาง header: Authorization: Bearer <token>
export async function POST(req: Request, { params }: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await params;
  const raw = await req.text();

  const channel = await prisma.channel.findUnique({ where: { id: channelId } });
  if (!channel || channel.type !== "phone") return new Response("unknown channel", { status: 404 });

  const creds = credsOf<YeastarCreds>(channel);
  const url = new URL(req.url);
  const tokenFromQuery = url.searchParams.get("token");
  const tokenFromHeader = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  if (!verifyYeastarToken(tokenFromQuery ?? tokenFromHeader, creds)) {
    return new Response("invalid token", { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  const events = yeastarAdapter.parse(body);
  if (!channel.connected || events.length === 0) {
    return Response.json({ ok: true, matched: "none" });
  }

  // ตอบกลับทันทีพร้อมผลจับคู่ (เพื่อใช้ทำ screen-pop ฝั่ง Yeastar ได้ในอนาคต) แล้วค่อยประมวลผลต่อเบื้องหลัง
  const phone = events[0].userExternalId;
  const existing = await prisma.patient.findMany({ where: { orgId: channel.orgId, phone }, select: { id: true }, take: 2 });
  const matched = existing.length > 1 ? "ambiguous" : existing.length === 1 ? "single" : "none";

  const conversation = await prisma.contact
    .findUnique({ where: { channelId_externalId: { channelId: channel.id, externalId: phone } }, select: { id: true } })
    .then((c) =>
      c ? prisma.conversation.findFirst({ where: { contactId: c.id, channelId: channel.id, source: "dm" }, select: { id: true } }) : null,
    );

  after(async () => {
    for (const ev of events) {
      try {
        await ingest(channel, ev);
      } catch (e) {
        console.error("[yeastar webhook] ingest failed", e);
      }
    }
  });

  return Response.json({ ok: true, conversationId: conversation?.id, matched });
}
