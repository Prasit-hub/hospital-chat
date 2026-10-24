import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, handle, json, parseBody } from "@/lib/api";
import { publish } from "@/lib/realtime";
import { currentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ownAppointment } from "@/lib/scope";
import { uiAppointment } from "@/lib/inbox/serialize";

const Patch = z.object({
  status: z.enum(["requested", "confirmed", "completed", "cancelled"]).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  slot: z.enum(["morning", "afternoon", "any"]).optional(),
});

export const PATCH = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const me = await currentUser();
  await ownAppointment(id, me);
  const body = await parseBody(req, Patch);
  const before = await prisma.appointment.findUniqueOrThrow({ where: { id } });
  if (body.status === "confirmed" && !before.date && !body.date) return apiError("ระบุวันนัดก่อนยืนยัน", 400);
  const a = await prisma.appointment.update({
    where: { id },
    data: { status: body.status, date: body.date ? new Date(body.date) : undefined, slot: body.slot },
  });
  if (body.status && body.status !== before.status)
    await audit(me.orgId, me.id, "appointment.status", { type: "appointment", id }, { from: before.status, to: body.status });
  publish({ type: "patient", patientId: a.patientId });
  return json(uiAppointment(a));
});
