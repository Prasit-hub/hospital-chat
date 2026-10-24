import { prisma } from "@/lib/db";
import { apiError, handle, json } from "@/lib/api";
import { currentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { publish } from "@/lib/realtime";
import { ownPatient } from "@/lib/scope";

export const DELETE = handle(async (_req: Request, { params }: { params: Promise<{ id: string; tagId: string }> }) => {
  const { id, tagId } = await params;
  const me = await currentUser();
  await ownPatient(id, me);
  const t = await prisma.patientProfileTag.findFirst({ where: { id: tagId, patientId: id }, include: { def: true } });
  if (!t) return apiError("ไม่พบแท็กนี้", 404);
  await prisma.patientProfileTag.delete({ where: { id: tagId } });
  await audit(me.orgId, me.id, "patient.profile_tag", { type: "patient", id }, { remove: t.def.label, category: t.def.category });
  publish({ type: "patient", patientId: id });
  return json({ ok: true });
});
