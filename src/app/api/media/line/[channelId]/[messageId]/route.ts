import { prisma } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { credsOf } from "@/lib/channels";
import { LINE_DATA_API, type LineCreds } from "@/lib/channels/line";

export const runtime = "nodejs";

// รูป/ไฟล์ที่ลูกค้าส่งทาง LINE ต้องดึงด้วย access token — route นี้ดึงให้หน้าจอแสดงผล
export async function GET(_req: Request, { params }: { params: Promise<{ channelId: string; messageId: string }> }) {
  const { channelId, messageId } = await params;
  if (!/^\d+$/.test(messageId)) return new Response("bad id", { status: 400 });
  const me = await getUser();
  if (!me) return new Response("unauthorized", { status: 401 });
  const channel = await prisma.channel.findUnique({ where: { id: channelId } });
  if (!channel || channel.type !== "line" || channel.orgId !== me.orgId) return new Response("not found", { status: 404 });
  const { accessToken } = credsOf<LineCreds>(channel);
  const res = await fetch(`${LINE_DATA_API()}/v2/bot/message/${messageId}/content`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  }).catch(() => null);
  // LINE เก็บไฟล์ไว้ระยะหนึ่งเท่านั้น — หมดอายุแล้วจะดึงไม่ได้
  if (!res?.ok || !res.body) return new Response("content unavailable", { status: 502 });
  return new Response(res.body, {
    headers: { "Content-Type": res.headers.get("content-type") ?? "application/octet-stream", "Cache-Control": "private, max-age=86400" },
  });
}
