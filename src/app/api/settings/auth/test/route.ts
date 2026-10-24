import { z } from "zod";
import { prisma } from "@/lib/db";
import { handle, json, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { authSettings, DirectoryError, lookupUser, mapGroups } from "@/lib/ad";

export const dynamic = "force-dynamic";

// ปุ่ม “ทดสอบ”: ค้นผู้ใช้ใน AD ด้วยค่าที่บันทึกไว้ (ไม่ใช้รหัสผ่านของผู้ใช้) แล้วแสดงว่าจะได้บทบาท/แผนกอะไร
export const POST = handle(async (req: Request) => {
  const me = await requireRole(["owner", "admin"]);
  const { username } = await parseBody(req, z.object({ username: z.string().trim().min(1).max(200) }));
  const s = await authSettings(me.orgId);
  try {
    const u = await lookupUser(s, username);
    if (!u) return json({ ok: false, detail: "ไม่พบผู้ใช้นี้ใน AD" });
    const m = mapGroups(s.rules, u);
    const dept = m.departmentId ? await prisma.department.findUnique({ where: { id: m.departmentId }, select: { name: true } }) : null;
    return json({
      ok: true,
      user: { username: u.username, displayName: u.displayName, email: u.email, groups: u.groups, disabled: u.disabled, department: u.department },
      result: { canLogin: !!m.role && !u.disabled, role: m.role, department: dept?.name ?? null, matched: m.matched },
    });
  } catch (e) {
    if (e instanceof DirectoryError) return json({ ok: false, detail: e.message });
    throw e;
  }
});
