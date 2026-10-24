import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import bcrypt from "bcryptjs";
import type { Role, User } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

// ระบบล็อกอินแบบ session ในฐานข้อมูล
// - cookie เก็บ token สุ่ม 32 ไบต์ / ฐานข้อมูลเก็บเฉพาะ SHA-256 ของ token
// - รหัสผ่านเก็บแบบ bcrypt

export const SESSION_COOKIE = "rc_session";
const SESSION_DAYS = 30;

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly status: 401 | 403 = 401,
  ) {
    super(message);
  }
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function hashPassword(pw: string) {
  return bcrypt.hash(pw, 10);
}

export function verifyPassword(pw: string, hash: string) {
  return bcrypt.compare(pw, hash);
}

export function generatePassword() {
  // อ่านง่าย ไม่มีตัวที่สับสน (0/O, 1/l)
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(randomBytes(12), (b) => chars[b % chars.length]).join("");
}

/** hours = อายุ session (ไม่ระบุ = 30 วัน; บัญชี AD ใช้ค่าจากหน้าตั้งค่า) */
export async function createSession(userId: string, hours?: number) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + (hours ? hours * 3_600_000 : SESSION_DAYS * 86_400_000));
  const ua = (await headers()).get("user-agent")?.slice(0, 200);
  await prisma.session.create({ data: { tokenHash: sha256(token), userId, expiresAt, userAgent: ua } });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "true",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await prisma.session.deleteMany({ where: { tokenHash: sha256(token) } });
  jar.delete(SESSION_COOKIE);
}

/** ผู้ใช้ที่ล็อกอินอยู่ หรือ null */
export async function getUser(): Promise<User | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!session || session.expiresAt < new Date() || !session.user.active) return null;
  // อัปเดตเวลาออนไลน์ไม่เกินนาทีละครั้ง
  if (!session.user.lastSeenAt || Date.now() - session.user.lastSeenAt.getTime() > 60_000) {
    await prisma.user.update({ where: { id: session.user.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  }
  return session.user;
}

/** ผู้ใช้ที่ล็อกอินอยู่ — ถ้าไม่ได้ล็อกอินจะโยน AuthError (API ตอบ 401) */
export async function currentUser(): Promise<User> {
  const u = await getUser();
  if (!u) throw new AuthError("กรุณาเข้าสู่ระบบ");
  return u;
}

/** ตรวจสิทธิ์ตามบทบาท เช่น requireRole(["owner","admin"]) */
export async function requireRole(roles: Role[]): Promise<User> {
  const u = await currentUser();
  if (!roles.includes(u.role)) throw new AuthError("คุณไม่มีสิทธิ์ทำรายการนี้", 403);
  return u;
}

// ---- จำกัดจำนวนครั้งล็อกอินผิด (ต่อ process) ----
const attempts = new Map<string, { n: number; until: number }>();
export function loginThrottle(key: string) {
  const now = Date.now();
  const a = attempts.get(key);
  if (a && a.until > now && a.n >= 10) return false;
  return true;
}
export function loginFailed(key: string) {
  const now = Date.now();
  const a = attempts.get(key);
  if (!a || a.until < now) attempts.set(key, { n: 1, until: now + 15 * 60_000 });
  else a.n++;
}
export function loginSucceeded(key: string) {
  attempts.delete(key);
}
