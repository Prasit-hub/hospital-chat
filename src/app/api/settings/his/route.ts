import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, handle, json, parseBody } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { encryptJson } from "@/lib/crypto";
import { breakerState, resetBreaker } from "@/lib/his/clients";
import { clearHisCache, hisSettings, publicHis, type HisSettings } from "@/lib/his";

export const dynamic = "force-dynamic";

// ตั้งค่าการเชื่อมต่อ HIS: ผู้ดูแลดูได้ แก้ได้เฉพาะเจ้าของ (มีรหัสเชื่อมต่อ)
export const GET = handle(async () => {
  const me = await requireRole(["owner", "admin"]);
  const s = await hisSettings(me.orgId);
  return json({ ...publicHis(s), breakerOpen: breakerState(me.orgId).open });
});

const Body = z
  .object({
    mode: z.enum(["manual", "mock", "live"]),
    baseUrl: z
      .string()
      .trim()
      .max(300)
      .refine((u) => !u || /^https?:\/\/[^\s]+$/i.test(u), "ที่อยู่ต้องขึ้นต้นด้วย http:// หรือ https://")
      .optional(),
    authType: z.enum(["none", "bearer", "oauth2"]).optional(),
    tokenUrl: z
      .string()
      .trim()
      .max(300)
      .refine((u) => !u || /^https?:\/\/[^\s]+$/i.test(u), "ที่อยู่ token ต้องขึ้นต้นด้วย http:// หรือ https://")
      .optional(),
    clientId: z.string().trim().max(200).optional(),
    /** ไม่ส่ง = คงรหัสเดิม · "" = ลบรหัส */
    secret: z.string().max(4000).optional(),
    timeoutMs: z.number().int().min(500).max(15000).optional(),
    allowNationalId: z.boolean().optional(),
  })
  .superRefine((b, ctx) => {
    if (b.mode === "live" && !b.baseUrl) ctx.addIssue({ code: "custom", path: ["baseUrl"], message: "ระบุที่อยู่ HIS Gateway" });
    if (b.mode === "live" && b.authType === "oauth2" && (!b.tokenUrl || !b.clientId))
      ctx.addIssue({ code: "custom", path: ["tokenUrl"], message: "OAuth2 ต้องมีที่อยู่ token และ client id" });
  });

export const PUT = handle(async (req: Request) => {
  const me = await requireRole(["owner"]);
  const b = await parseBody(req, Body);
  const before = await hisSettings(me.orgId);
  if (b.mode === "live" && b.baseUrl && process.env.NODE_ENV === "production" && b.baseUrl.startsWith("http://") && !process.env.HIS_ALLOW_HTTP)
    return apiError("ใช้ https:// สำหรับ HIS Gateway (หรือตั้ง HIS_ALLOW_HTTP=1 เมื่ออยู่ในเครือข่ายภายในที่เข้ารหัสแล้ว)", 400);
  const next: HisSettings = {
    mode: b.mode,
    baseUrl: b.baseUrl ?? before.baseUrl,
    authType: b.authType ?? before.authType,
    tokenUrl: b.tokenUrl ?? before.tokenUrl,
    clientId: b.clientId ?? before.clientId,
    secretEnc: b.secret === undefined ? before.secretEnc : b.secret ? encryptJson({ secret: b.secret }) : undefined,
    timeoutMs: b.timeoutMs ?? before.timeoutMs,
    allowNationalId: b.allowNationalId ?? before.allowNationalId,
  };
  if (next.mode === "live" && next.authType !== "none" && !next.secretEnc) return apiError("ใส่รหัสเชื่อมต่อ (secret / token) ของ HIS", 400);
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: me.orgId } });
  await prisma.organization.update({ where: { id: me.orgId }, data: { settings: { ...(org.settings as object), his: { ...next } } } });
  clearHisCache(me.orgId);
  resetBreaker(me.orgId);
  await audit(me.orgId, me.id, "settings.his", { type: "org", id: me.orgId }, {
    mode: next.mode,
    from: before.mode,
    secretChanged: b.secret !== undefined,
    allowNationalId: !!next.allowNationalId,
  });
  return json(publicHis(next));
});
