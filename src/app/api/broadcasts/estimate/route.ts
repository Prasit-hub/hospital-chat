import { prisma } from "@/lib/db";
import { apiError, handle, json } from "@/lib/api";
import { currentUser } from "@/lib/auth";
import { audience } from "@/lib/broadcast";

export const dynamic = "force-dynamic";

// จำนวนผู้รับโดยประมาณ ก่อนกดส่ง
export const GET = handle(async (req: Request) => {
  const me = await currentUser();
  const url = new URL(req.url);
  const channel = await prisma.channel.findFirst({ where: { id: url.searchParams.get("channelId") ?? "", orgId: me.orgId } });
  if (!channel) return apiError("ไม่พบช่องทาง", 404);
  const { contacts, eligible } = await audience(channel, url.searchParams.get("tagId") || null);
  return json({ targeted: contacts.length, eligible: eligible.length });
});
