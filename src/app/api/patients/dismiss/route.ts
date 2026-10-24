import { z } from "zod";
import { apiError, handle, json, parseBody } from "@/lib/api";
import { currentUser } from "@/lib/auth";
import { dismissPair, PatientError } from "@/lib/patients";

// "ไม่ใช่คนเดียวกัน" — ไม่ต้องแนะนำคู่นี้อีก
export const POST = handle(async (req: Request) => {
  const me = await currentUser();
  const { aId, bId } = await parseBody(req, z.object({ aId: z.string(), bId: z.string() }));
  try {
    await dismissPair(me.orgId, me.id, aId, bId);
    return json({ ok: true });
  } catch (e) {
    if (e instanceof PatientError) return apiError(e.message, e.status);
    throw e;
  }
});
