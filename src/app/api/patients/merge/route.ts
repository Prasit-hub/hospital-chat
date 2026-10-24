import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, handle, json, parseBody } from "@/lib/api";
import { currentUser, requireRole } from "@/lib/auth";
import { mergePatients, PatientError } from "@/lib/patients";
import { ownPatient } from "@/lib/scope";

export const dynamic = "force-dynamic";

const pick = z.enum(["survivor", "merged"]);
const Body = z.object({
  survivorId: z.string(),
  mergedId: z.string(),
  pick: z.object({ name: pick, hn: pick, birthDate: pick, phone: pick, email: pick }).partial().optional(),
  reason: z.string().trim().max(500).optional(),
  /** ต้องยืนยันว่าตรวจสอบแล้ว */
  confirmed: z.literal(true, { errorMap: () => ({ message: "กรุณายืนยันว่าตรวจสอบแล้วว่าเป็นบุคคลเดียวกัน" }) }),
});

export const POST = handle(async (req: Request) => {
  const me = await currentUser();
  const body = await parseBody(req, Body);
  // ต้องเห็นทั้งสองแฟ้ม (เห็นแชทตามแผนก)
  await ownPatient(body.survivorId, me);
  await ownPatient(body.mergedId, me);
  try {
    const ev = await mergePatients(me.orgId, me.id, body);
    return json({ eventId: ev.id, survivorId: ev.survivorId }, 201);
  } catch (e) {
    if (e instanceof PatientError) return apiError(e.message, e.status);
    throw e;
  }
});

// ประวัติการรวมแฟ้ม (ล่าสุดก่อน)
export const GET = handle(async () => {
  const me = await requireRole(["owner", "admin", "agent"]);
  const rows = await prisma.mergeEvent.findMany({ where: { orgId: me.orgId }, orderBy: { createdAt: "desc" }, take: 100 });
  const pids = [...new Set(rows.flatMap((r) => [r.survivorId, r.mergedId]))];
  const uids = [...new Set(rows.flatMap((r) => [r.actorId, r.undoneById].filter(Boolean) as string[]))];
  const [patients, users] = await Promise.all([
    prisma.patient.findMany({ where: { id: { in: pids } }, select: { id: true, name: true, hn: true } }),
    prisma.user.findMany({ where: { id: { in: uids } }, select: { id: true, name: true } }),
  ]);
  const pn = (id: string) => patients.find((p) => p.id === id);
  const un = (id?: string | null) => users.find((u) => u.id === id)?.name;
  return json({
    canUndo: me.role !== "agent",
    events: rows.map((r) => ({
      id: r.id,
      survivor: { id: r.survivorId, name: pn(r.survivorId)?.name, hn: pn(r.survivorId)?.hn ?? undefined },
      merged: { id: r.mergedId, name: pn(r.mergedId)?.name },
      contacts: r.contactIds.length,
      reason: r.reason ?? undefined,
      actor: un(r.actorId),
      at: r.createdAt.toISOString(),
      undoneAt: r.undoneAt?.toISOString(),
      undoneBy: un(r.undoneById),
    })),
  });
});
