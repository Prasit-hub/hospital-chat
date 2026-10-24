import { prisma } from "@/lib/db";
import { handle, json } from "@/lib/api";
import { authSettings } from "@/lib/ad";

export const dynamic = "force-dynamic";

// หน้าเข้าสู่ระบบ: บอกว่าใช้บัญชีแบบไหน (ไม่ต้องล็อกอิน · ไม่มีข้อมูลลับ)
export const GET = handle(async () => {
  const org = await prisma.organization.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
  const s = org ? await authSettings(org.id) : null;
  return json({ mode: s?.mode ?? "local" });
});
