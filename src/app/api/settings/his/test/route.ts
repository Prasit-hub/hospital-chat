import { handle, json } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { resetBreaker } from "@/lib/his/clients";
import { clientFor, hisSettings } from "@/lib/his";

export const dynamic = "force-dynamic";

// ปุ่ม “ทดสอบการเชื่อมต่อ”: เรียก /his/v1/health ด้วยค่าที่บันทึกไว้
export const POST = handle(async () => {
  const me = await requireRole(["owner", "admin"]);
  const s = await hisSettings(me.orgId);
  if (s.mode === "manual") return json({ ok: false, detail: "อยู่ในโหมดกรอก HN เอง — ไม่ได้เชื่อม HIS" });
  resetBreaker(me.orgId);
  const started = Date.now();
  const r = await clientFor(me.orgId, s).health();
  return json({ ...r, ms: Date.now() - started, mode: s.mode });
});
