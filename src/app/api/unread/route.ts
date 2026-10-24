import { prisma } from "@/lib/db";
import { handle, json } from "@/lib/api";
import { currentUser } from "@/lib/auth";
import { caseWhere, visibilityFor } from "@/lib/visibility";

export const dynamic = "force-dynamic";

// ตัวเลขบนเมนู "แชท": ข้อความที่ยังไม่อ่านของงานที่ยังไม่ปิด + งานที่รอรับ (คิวกลาง + คิวแผนกของฉัน)
export const GET = handle(async () => {
  const me = await currentUser();
  const cw = caseWhere(await visibilityFor(me));
  const [r, queued, deptQueue] = await Promise.all([
    prisma.conversation.aggregate({
      where: { channel: { orgId: me.orgId }, contact: { patient: { cases: { some: { status: { not: "closed" }, ...cw } } } } },
      _sum: { unread: true },
    }),
    prisma.case.count({ where: { orgId: me.orgId, status: "queued", ...cw } }),
    me.departmentId
      ? prisma.case.count({
          where: { orgId: me.orgId, status: "transfer_pending", transfers: { some: { toDeptId: me.departmentId, acceptedAt: null, returnedAt: null, recalledAt: null } } },
        })
      : 0,
  ]);
  return json({ unread: r._sum?.unread ?? 0, queued, deptQueue });
});
