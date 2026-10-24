import { prisma } from "@/lib/db";
import { handle, json } from "@/lib/api";
import { currentUser } from "@/lib/auth";
import { ownPatient } from "@/lib/scope";
import { findCandidates } from "@/lib/patients";
import { uiContact, uiPatient } from "@/lib/inbox/serialize";
import { patientWhere, visibilityFor } from "@/lib/visibility";

export const dynamic = "force-dynamic";

// แฟ้มที่อาจเป็นคนเดียวกับแฟ้มนี้
export const GET = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const me = await currentUser();
  await ownPatient(id, me);
  const all = await findCandidates(me.orgId, id);
  const ids = all.map((c) => (c.aId === id ? c.bId : c.aId));
  const patients = await prisma.patient.findMany({ where: { id: { in: ids }, ...patientWhere(await visibilityFor(me)) }, include: { tags: true, contacts: true } });
  const seen = new Set(patients.map((p) => p.id));
  const candidates = all.filter((c) => seen.has(c.aId === id ? c.bId : c.aId));
  return json({
    candidates,
    patients: patients.map(uiPatient),
    contacts: patients.flatMap((p) => p.contacts.map(uiContact)),
  });
});
