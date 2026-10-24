import { after } from "next/server";
import { prisma } from "@/lib/db";
import { credsOf } from "@/lib/channels";
import { lineAdapter, type LineCreds } from "@/lib/channels/line";
import { ingest } from "@/lib/inbox/service";

export const runtime = "nodejs";

// Webhook URL ที่ต้องใส่ใน LINE Developers Console:
//   https://<โดเมนของคุณ>/api/webhooks/line/<channelId>
export async function POST(req: Request, { params }: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await params;
  const raw = await req.text();

  const channel = await prisma.channel.findUnique({ where: { id: channelId } });
  if (!channel || channel.type !== "line") return new Response("unknown channel", { status: 404 });

  if (!lineAdapter.verifySignature(raw, req.headers, credsOf<LineCreds>(channel))) {
    return new Response("invalid signature", { status: 401 });
  }

  const events = lineAdapter.parse(JSON.parse(raw));
  // ตอบ 200 ทันที แล้วค่อยประมวลผลเบื้องหลัง (LINE ต้องการให้ตอบเร็ว)
  after(async () => {
    if (!channel.connected) return;
    for (const ev of events) {
      try {
        await ingest(channel, ev);
      } catch (e) {
        console.error("[line webhook] ingest failed", e);
      }
    }
  });
  return new Response("ok");
}
