import { prisma } from "@/lib/db";
import { handle, json } from "@/lib/api";
import { currentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ownPatient } from "@/lib/scope";
import { uiCase, uiTransfer } from "@/lib/inbox/serialize";
import { toLocalIso } from "@/lib/time";
import { visibilityFor, visibleCaseIds } from "@/lib/visibility";

export const dynamic = "force-dynamic";

// ประวัติการติดต่อของคนไข้: งานทั้งหมด (ใหม่สุดก่อน) + เส้นทางการโอน + ช่องทางที่ใช้ในแต่ละงาน
export const GET = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const me = await currentUser();
  const own = await ownPatient(id, me);
  const patientId = own.mergedIntoId ?? id;
  const cases = await prisma.case.findMany({
    where: { patientId },
    orderBy: { openedAt: "desc" },
    take: 200,
    include: { transfers: { orderBy: { createdAt: "asc" } } },
  });
  // เห็นแชทตามแผนก: งานของแผนกอื่นแสดงแค่ภาพรวม (เลขงาน วันที่ แผนก ผล) ไม่มีจำนวนข้อความและบันทึกปิดงาน
  const seen = await visibleCaseIds(await visibilityFor(me), patientId);
  const counts = await prisma.message.groupBy({
    by: ["caseId", "conversationId"],
    where: { caseId: { in: cases.map((c) => c.id) }, sender: { in: ["customer", "agent", "bot"] }, kind: { not: "note" } },
    _count: true,
  });
  const convs = await prisma.conversation.findMany({ where: { id: { in: [...new Set(counts.map((x) => x.conversationId))] } }, select: { id: true, channelId: true } });
  // เปิดดูประวัติงานที่ปิดแล้ว = บันทึกการใช้งาน (ไม่เก็บเนื้อหา)
  if (new URL(req.url).searchParams.get("view") === "history" && cases.some((c) => c.status === "closed")) await audit(me.orgId, me.id, "patient.view_history", { type: "patient", id: patientId });
  return json(
    cases.map((c) => {
      const mine = counts.filter((x) => x.caseId === c.id);
      if (seen && !seen.has(c.id))
        return {
          ...uiCase({
            ...c,
            closeNote: null,
            urgentReason: null,
            transfers: [...c.transfers].reverse().map((t) => ({ ...t, reason: "", doneNote: null, returnReason: null })),
          }),
          restricted: true,
          transfers: c.transfers.map((t) => ({ ...uiTransfer(t), reason: "", doneNote: undefined, returnReason: undefined })),
          messageCount: 0,
          channelIds: [],
          lastAt: toLocalIso(c.closedAt ?? c.openedAt),
        };
      return {
        ...uiCase({ ...c, transfers: [...c.transfers].reverse() }),
        transfers: c.transfers.map(uiTransfer),
        messageCount: mine.reduce((a, x) => a + x._count, 0),
        channelIds: [...new Set(mine.map((x) => convs.find((v) => v.id === x.conversationId)?.channelId).filter(Boolean))],
        lastAt: toLocalIso(c.closedAt ?? c.openedAt),
      };
    }),
  );
});
