import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

// ใช้ตรวจสุขภาพระบบ (Docker healthcheck / uptime monitor) — ไม่ต้องล็อกอิน
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ ok: true, time: new Date().toISOString() });
  } catch {
    return Response.json({ ok: false, error: "database unavailable" }, { status: 503 });
  }
}
