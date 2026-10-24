import { z } from "zod";
import { apiError, handle, json, parseBody } from "@/lib/api";
import { currentUser } from "@/lib/auth";
import { ownPatient } from "@/lib/scope";
import { PatientError, splitContact } from "@/lib/patients";

// แยกบัญชีช่องทางหนึ่งออกจากแฟ้มนี้เป็นแฟ้มใหม่
export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const me = await currentUser();
  await ownPatient(id, me);
  const { contactId } = await parseBody(req, z.object({ contactId: z.string() }));
  try {
    const p = await splitContact(me.orgId, me.id, contactId);
    return json({ patientId: p.id }, 201);
  } catch (e) {
    if (e instanceof PatientError) return apiError(e.message, e.status);
    throw e;
  }
});
