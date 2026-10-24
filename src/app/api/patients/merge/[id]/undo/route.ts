import { apiError, handle, json } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { PatientError, undoMerge } from "@/lib/patients";

// ยกเลิกการรวมแฟ้ม — เฉพาะเจ้าของ/ผู้ดูแล
export const POST = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const me = await requireRole(["owner", "admin"]);
  try {
    await undoMerge(me.orgId, me.id, id);
    return json({ ok: true });
  } catch (e) {
    if (e instanceof PatientError) return apiError(e.message, e.status);
    throw e;
  }
});
