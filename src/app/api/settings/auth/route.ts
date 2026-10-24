import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, handle, json, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { encryptJson } from "@/lib/crypto";
import { authSettings, publicAuth, type AuthSettings } from "@/lib/ad";

export const dynamic = "force-dynamic";

// ตั้งค่าการเข้าสู่ระบบ (AD): ผู้ดูแลดูได้ แก้ได้เฉพาะเจ้าของ
export const GET = handle(async () => {
  const me = await requireRole(["owner", "admin"]);
  const s = await authSettings(me.orgId);
  const adUsers = await prisma.user.count({ where: { orgId: me.orgId, authSource: "ad" } });
  return json({ ...publicAuth(s), adUsers });
});

const url = z
  .string()
  .trim()
  .max(300)
  .refine((u) => !u || /^ldaps?:\/\/[^\s]+$/i.test(u), "ที่อยู่ต้องขึ้นต้นด้วย ldap:// หรือ ldaps://");

const Body = z
  .object({
    mode: z.enum(["local", "mock", "ldap"]),
    localLogin: z.enum(["owners", "everyone"]).optional(),
    autoProvision: z.boolean().optional(),
    sessionHours: z.number().int().min(1).max(720).optional(),
    rules: z
      .array(
        z.object({
          group: z.string().trim().min(1, "ระบุชื่อกลุ่ม").max(300),
          role: z.enum(["admin", "agent"]).optional(),
          departmentId: z.string().optional(),
        }),
      )
      .max(100)
      .optional(),
    ldap: z
      .object({
        url,
        baseDn: z.string().trim().max(300),
        bindDn: z.string().trim().max(300),
        /** ไม่ส่ง = คงรหัสเดิม · "" = ลบ */
        bindPassword: z.string().max(500).optional(),
        userFilter: z
          .string()
          .trim()
          .max(500)
          .refine((f) => f.includes("{username}"), "ตัวกรองต้องมี {username}"),
        startTls: z.boolean(),
        tlsInsecure: z.boolean(),
        timeoutMs: z.number().int().min(1000).max(30000),
      })
      .partial()
      .optional(),
  })
  .superRefine((b, ctx) => {
    if (b.rules && b.mode !== "local" && !b.rules.some((r) => r.role)) ctx.addIssue({ code: "custom", path: ["rules"], message: "ต้องมีอย่างน้อย 1 กลุ่มที่ให้สิทธิ์เข้าใช้" });
  });

export const PUT = handle(async (req: Request) => {
  const me = await requireRole(["owner"]);
  const b = await parseBody(req, Body);
  const before = await authSettings(me.orgId);
  if (b.rules?.some((r) => r.departmentId)) {
    const ids = [...new Set(b.rules.map((r) => r.departmentId).filter(Boolean) as string[])];
    if ((await prisma.department.count({ where: { orgId: me.orgId, id: { in: ids } } })) !== ids.length) return apiError("แผนกในตารางจับคู่ไม่ถูกต้อง", 400);
  }
  const { bindPassword, ...ldapRest } = b.ldap ?? {};
  const next: AuthSettings = {
    ...before,
    mode: b.mode,
    localLogin: b.localLogin ?? before.localLogin,
    autoProvision: b.autoProvision ?? before.autoProvision,
    sessionHours: b.sessionHours ?? before.sessionHours,
    rules: b.rules ?? before.rules,
    ldap: {
      ...before.ldap,
      ...ldapRest,
      bindPasswordEnc: bindPassword === undefined ? before.ldap.bindPasswordEnc : bindPassword ? encryptJson({ secret: bindPassword }) : undefined,
    },
  };
  if (next.mode === "ldap" && (!next.ldap.url || !next.ldap.baseDn || !next.ldap.bindDn || !next.ldap.bindPasswordEnc))
    return apiError("โหมด AD จริงต้องมีที่อยู่ AD, Base DN, บัญชีบริการ และรหัสผ่านบัญชีบริการ", 400);
  if (next.mode === "ldap" && next.ldap.url.startsWith("ldap://") && !next.ldap.startTls && process.env.NODE_ENV === "production" && !process.env.LDAP_ALLOW_PLAIN)
    return apiError("ใช้ ldaps:// หรือเปิด StartTLS — รหัสผ่านไม่ควรส่งผ่านเครือข่ายแบบไม่เข้ารหัส", 400);
  if (next.mode !== "local" && !next.rules.some((r) => r.role)) return apiError("ต้องมีอย่างน้อย 1 กลุ่มที่ให้สิทธิ์เข้าใช้", 400);
  // กันล็อกตัวเองออก: เจ้าของที่บันทึกต้องเข้าด้วยรหัสผ่านในระบบได้ หรือเป็นบัญชี AD
  if (next.mode !== "local" && me.authSource === "local" && !me.passwordHash) return apiError("ตั้งรหัสผ่านของคุณก่อน เพื่อใช้เป็นบัญชีฉุกเฉินเมื่อ AD ใช้ไม่ได้", 400);
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: me.orgId } });
  await prisma.organization.update({ where: { id: me.orgId }, data: { settings: { ...(org.settings as object), auth: JSON.parse(JSON.stringify(next)) } } });
  await audit(me.orgId, me.id, "settings.auth", { type: "org", id: me.orgId }, {
    mode: next.mode,
    from: before.mode,
    rules: next.rules.length,
    bindPasswordChanged: bindPassword !== undefined,
    localLogin: next.localLogin,
  });
  return json(publicAuth(next));
});
