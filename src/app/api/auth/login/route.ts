import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, handle, json, parseBody } from "@/lib/api";
import { createSession, loginFailed, loginSucceeded, loginThrottle, verifyPassword } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { authSettings, authenticate, DirectoryError, mapGroups, normUsername, type DirectoryUser } from "@/lib/ad";

// รับได้ทั้งอีเมล ชื่อผู้ใช้ในระบบ (เช่น "admin") และชื่อผู้ใช้ AD (mali.s / HOSPITAL\mali.s / mali.s@hospital.local)
const Body = z.object({ email: z.string().trim().toLowerCase().min(1).max(200), password: z.string().min(1).max(200) });

const BAD = "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง";
const COLORS = ["#6d5bd0", "#0e9f8a", "#d97706", "#db2777", "#2563eb", "#059669", "#7c3aed", "#dc2626"];

export const POST = handle(async (req: Request) => {
  const { email: login, password } = await parseBody(req, Body);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
  const key = `${ip}|${login}`;
  if (!loginThrottle(key)) return apiError("พยายามเข้าสู่ระบบผิดหลายครั้งเกินไป กรุณารอ 15 นาที", 429);
  const fail = async (orgId: string | null, reason: string, source: string, status = 401, message = BAD) => {
    loginFailed(key);
    if (orgId) await audit(orgId, null, "auth.login_failed", { type: "login", id: login.slice(0, 120) }, { reason, source });
    return apiError(message, status);
  };

  const org = await prisma.organization.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!org) return apiError(BAD, 401);
  const s = await authSettings(org.id);

  // 1) รหัสผ่านในระบบ — โหมด local ทุกบัญชี · โหมด AD เฉพาะบัญชีที่อนุญาต (ค่าเริ่มต้น: เจ้าของ = บัญชีฉุกเฉิน)
  const local = await prisma.user.findUnique({ where: { email: login } });
  const localAllowed = !!local && local.authSource === "local" && (s.mode === "local" || s.localLogin === "everyone" || local.role === "owner");
  if (localAllowed) {
    const ok = !!local.passwordHash && local.active && (await verifyPassword(password, local.passwordHash));
    if (ok) {
      loginSucceeded(key);
      await createSession(local.id);
      await audit(org.id, local.id, "auth.login", { type: "user", id: local.id }, { source: "local" });
      return json({ ok: true });
    }
    if (s.mode === "local") return fail(org.id, "bad_password", "local");
  } else if (s.mode === "local") {
    return fail(org.id, local ? "not_allowed" : "unknown_user", "local");
  }

  // 2) บัญชี AD
  let du: DirectoryUser;
  try {
    du = await authenticate(s, login, password);
  } catch (e) {
    if (!(e instanceof DirectoryError)) throw e;
    if (e.code === "disabled") {
      // ปิดบัญชีใน AD → ปิดบัญชีในรวมแชทและตัด session ทันที
      const u = await prisma.user.findUnique({ where: { adUsername: normUsername(login) } });
      if (u?.active) {
        await prisma.user.update({ where: { id: u.id }, data: { active: false } });
        await prisma.session.deleteMany({ where: { userId: u.id } });
      }
      return fail(org.id, "ad_disabled", s.mode, 403, "บัญชี AD นี้ถูกปิดใช้งาน — ติดต่อฝ่าย IT");
    }
    if (e.code === "unavailable" || e.code === "config" || e.code === "ambiguous") return fail(org.id, "ad_" + e.code, s.mode, 503, e.message);
    return fail(org.id, e.code === "not_found" ? "unknown_user" : "bad_password", s.mode);
  }

  const m = mapGroups(s.rules, du);
  if (!m.role) return fail(org.id, "no_group", s.mode, 403, "บัญชีนี้ยังไม่ได้รับสิทธิ์ใช้รวมแชท (ไม่อยู่ในกลุ่มที่กำหนด) — ติดต่อผู้ดูแล");

  const email = (du.email ?? `${du.username}@ad.invalid`).toLowerCase();
  let user =
    (await prisma.user.findUnique({ where: { adUsername: du.username } })) ??
    // ผูกกับบัญชีเดิมที่อีเมลตรงกัน (เช่น เคยสร้างไว้ก่อนเปิด AD)
    (du.email ? await prisma.user.findFirst({ where: { orgId: org.id, email, adUsername: null } }) : null);
  let provisioned = false;
  if (!user) {
    if (!s.autoProvision) return fail(org.id, "not_provisioned", s.mode, 403, "ยังไม่มีบัญชีในรวมแชท — ให้ผู้ดูแลเพิ่มก่อน");
    const n = await prisma.user.count({ where: { orgId: org.id } });
    user = await prisma.user.create({
      data: { orgId: org.id, name: du.displayName, email, role: m.role, color: COLORS[n % COLORS.length], authSource: "ad", adUsername: du.username },
    });
    provisioned = true;
  }
  if (!user.active) return fail(org.id, "inactive", s.mode, 403, "บัญชีนี้ถูกปิดในรวมแชท — ติดต่อผู้ดูแล");

  // ซิงก์ชื่อ บทบาท แผนก จาก AD ทุกครั้งที่เข้า (เจ้าของคงบทบาทเดิม · ตั้งแผนกเมื่อมีกลุ่มที่จับคู่แผนก)
  await prisma.user.update({
    where: { id: user.id },
    data: {
      name: du.displayName,
      authSource: "ad",
      adUsername: du.username,
      adSyncedAt: new Date(),
      passwordHash: null,
      ...(user.role !== "owner" && { role: m.role }),
      ...(m.managesDept && { departmentId: m.departmentId }),
    },
  });
  loginSucceeded(key);
  await createSession(user.id, s.sessionHours);
  if (provisioned) await audit(org.id, user.id, "auth.provision", { type: "user", id: user.id }, { role: m.role, source: s.mode });
  await audit(org.id, user.id, "auth.login", { type: "user", id: user.id }, { source: s.mode, groups: m.matched });
  return json({ ok: true });
});
