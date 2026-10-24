import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, handle, json, parseBody } from "@/lib/api";
import { generatePassword, hashPassword, requireRole } from "@/lib/auth";
import { uiAgent } from "@/lib/inbox/serialize";

const COLORS = ["#6d5bd0", "#0e9f8a", "#d97706", "#db2777", "#2563eb", "#65a30d", "#dc2626", "#7c3aed"];

const Body = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(["owner", "admin", "agent"]),
});

// เพิ่มสมาชิก — ยังไม่มีระบบส่งอีเมล จึงคืนรหัสผ่านชั่วคราวให้ผู้เชิญส่งต่อเอง (แสดงครั้งเดียว)
export const POST = handle(async (req: Request) => {
  const me = await requireRole(["owner", "admin"]);
  const body = await parseBody(req, Body);
  if (body.role === "owner" && me.role !== "owner") return apiError("เฉพาะเจ้าของเท่านั้นที่เพิ่มเจ้าของคนอื่นได้", 403);
  if (await prisma.user.findUnique({ where: { email: body.email } })) return apiError("อีเมลนี้มีในระบบแล้ว", 409);

  const password = generatePassword();
  const count = await prisma.user.count({ where: { orgId: me.orgId } });
  const u = await prisma.user.create({
    data: { ...body, orgId: me.orgId, color: COLORS[count % COLORS.length], passwordHash: await hashPassword(password) },
  });
  return json({ user: { ...uiAgent(u), email: u.email, active: u.active, hasPassword: true }, password }, 201);
});
