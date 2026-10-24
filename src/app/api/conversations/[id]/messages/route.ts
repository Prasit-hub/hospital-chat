import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, handle, json, parseBody } from "@/lib/api";
import { currentUser } from "@/lib/auth";
import { ownConversation } from "@/lib/scope";
import { addInternal, sendOutgoing } from "@/lib/inbox/service";
import { uiMessage } from "@/lib/inbox/serialize";
import { canSeeCase, visibilityFor, visibleCaseIds } from "@/lib/visibility";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const me = await currentUser();
  await ownConversation(id, me);
  const url = new URL(req.url);
  const before = url.searchParams.get("before");
  // scope=patient → รวมข้อความจากทุกช่องทางของคนไข้คนเดียวกัน เป็นเส้นเวลาเดียว
  let convIds = [id];
  const conv = await prisma.conversation.findUniqueOrThrow({ where: { id }, select: { contact: { select: { patientId: true } } } });
  // เห็นแชทตามแผนก: แสดงเฉพาะข้อความในงานที่มองเห็น
  const seen = await visibleCaseIds(await visibilityFor(me), conv.contact.patientId);
  if (url.searchParams.get("scope") === "patient") {
    const all = await prisma.conversation.findMany({ where: { contact: { patientId: conv.contact.patientId } }, select: { id: true } });
    convIds = all.map((c) => c.id);
  }
  const rows = await prisma.message.findMany({
    where: { conversationId: { in: convIds }, ...(seen && { caseId: { in: [...seen] } }), ...(before ? { createdAt: { lt: new Date(before) } } : {}) },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return json(rows.reverse().map(uiMessage));
});

const Post = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string().trim().min(1).max(5000) }),
  z.object({ kind: z.literal("note"), text: z.string().trim().min(1).max(5000) }),
  z.object({ kind: z.literal("image"), imageUrl: z.string().url().startsWith("https://") }),
]);

export const POST = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const me = await currentUser();
  await ownConversation(id, me);
  const body = await parseBody(req, Post);
  // งานที่เปิดอยู่ของคนไข้อยู่ในแผนกอื่น → ตอบหรือเขียนโน้ตแทรกไม่ได้
  const conv = await prisma.conversation.findUniqueOrThrow({ where: { id }, select: { contact: { select: { patientId: true } } } });
  const open = await prisma.case.findFirst({ where: { patientId: conv.contact.patientId, status: { not: "closed" } }, select: { id: true } });
  if (open && !(await canSeeCase(await visibilityFor(me), open.id))) return apiError("งานที่เปิดอยู่ของคนไข้นี้อยู่ในความรับผิดชอบของแผนกอื่น", 403);

  const m =
    body.kind === "note"
      ? await addInternal(id, "note", body.text, me.id)
      : await sendOutgoing(
          id,
          { sender: "agent", agentId: me.id },
          body.kind === "image" ? { kind: "image", imageUrl: body.imageUrl } : { kind: "text", text: body.text },
        );
  return json(uiMessage(m), m.status === "failed" ? 502 : 201);
});
