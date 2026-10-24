import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, handle, json, parseBody } from "@/lib/api";
import { currentUser, hashPassword, verifyPassword } from "@/lib/auth";

const Body = z.object({ current: z.string().min(1), next: z.string().min(8, "รหัสผ่านใหม่ต้องยาวอย่างน้อย 8 ตัวอักษร").max(200) });

export const POST = handle(async (req: Request) => {
  const me = await currentUser();
  const { current, next } = await parseBody(req, Body);
  if (me.authSource === "ad") return apiError("บัญชี AD เปลี่ยนรหัสผ่านที่ระบบของโรงพยาบาล (Windows / AD)", 409);
  if (!me.passwordHash || !(await verifyPassword(current, me.passwordHash))) return apiError("รหัสผ่านปัจจุบันไม่ถูกต้อง", 400);
  await prisma.user.update({ where: { id: me.id }, data: { passwordHash: await hashPassword(next) } });
  return json({ ok: true });
});
