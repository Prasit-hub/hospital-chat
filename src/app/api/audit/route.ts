import { prisma } from "@/lib/db";
import { handle, json } from "@/lib/api";
import { requireRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

// บันทึกการใช้งาน — เฉพาะเจ้าของ/ผู้ดูแล
export const GET = handle(async (req: Request) => {
  const me = await requireRole(["owner", "admin"]);
  const before = new URL(req.url).searchParams.get("before");
  const rows = await prisma.auditLog.findMany({
    where: { orgId: me.orgId, ...(before ? { createdAt: { lt: new Date(before) } } : {}) },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { actor: { select: { name: true } } },
  });
  const patientIds = [...new Set(rows.filter((r) => r.targetType === "patient").map((r) => r.targetId))];
  const patients = await prisma.patient.findMany({ where: { id: { in: patientIds } }, select: { id: true, name: true, hn: true } });
  return json(
    rows.map((r) => {
      const p = patients.find((x) => x.id === r.targetId);
      return {
        id: r.id,
        at: r.createdAt.toISOString(),
        actor: r.actor?.name ?? "ระบบ",
        action: r.action,
        target: p ? `${p.name}${p.hn ? ` (HN ${p.hn})` : ""}` : `${r.targetType} ${r.targetId.slice(-6)}`,
        meta: r.meta,
      };
    }),
  );
});
