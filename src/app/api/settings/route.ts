import { z } from "zod";
import { prisma } from "@/lib/db";
import { handle, json, parseBody } from "@/lib/api";
import { currentUser, requireRole } from "@/lib/auth";
import { uiAgent, uiTag } from "@/lib/inbox/serialize";
import type { OrgSettings } from "@/lib/inbox/service";
import { caseSettings } from "@/lib/cases";
import { audit } from "@/lib/audit";
import { publish } from "@/lib/realtime";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const me = await currentUser();
  const [org, users, quickReplies, autoReplies, tags, departments] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: me.orgId } }),
    prisma.user.findMany({ where: { orgId: me.orgId }, orderBy: [{ active: "desc" }, { createdAt: "asc" }] }),
    prisma.quickReply.findMany({ where: { orgId: me.orgId }, orderBy: { shortcut: "asc" } }),
    prisma.autoReplyRule.findMany({ where: { orgId: me.orgId }, orderBy: { id: "asc" } }),
    prisma.tag.findMany({ where: { orgId: me.orgId }, orderBy: { name: "asc" }, include: { _count: { select: { patients: true } } } }),
    prisma.department.findMany({ where: { orgId: me.orgId }, orderBy: { name: "asc" }, include: { _count: { select: { users: true } } } }),
  ]);
  return json({
    me: { id: me.id, role: me.role },
    // ไม่ส่งค่าการเชื่อมต่อ HIS (มีรหัสลับ) — ดูที่ /api/settings/his
    org: { name: org.name, settings: { ...(org.settings as OrgSettings & { his?: unknown }), his: undefined, auth: undefined } },
    users: users.map((u) => ({
      ...uiAgent(u),
      email: u.email,
      active: u.active,
      hasPassword: !!u.passwordHash,
      departmentId: u.departmentId ?? undefined,
      authSource: u.authSource,
      adUsername: u.adUsername ?? undefined,
      adSyncedAt: u.adSyncedAt?.toISOString(),
    })),
    departments: departments.map((d) => ({ id: d.id, name: d.name, color: d.color, users: d._count.users, slaMinutes: d.transferSlaMinutes ?? undefined, seesAll: d.seesAllCases })),
    caseSettings: await caseSettings(me.orgId),
    quickReplies: quickReplies.map(({ id, shortcut, title, text }) => ({ id, shortcut, title, text })),
    autoReplies: autoReplies.map(({ id, keywords, reply, enabled, channels }) => ({ id, keywords, reply, enabled, channels })),
    tags: tags.map((t) => ({ ...uiTag(t), count: t._count.patients })),
  });
});

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "รูปแบบเวลา HH:mm");
const Patch = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  /** all = ทุกคนเห็นทุกแชท · department = เห็นเฉพาะงานของแผนกตัวเอง */
  visibility: z.enum(["all", "department"]).optional(),
  welcome: z.object({ enabled: z.boolean(), text: z.string().trim().max(2000) }).optional(),
  away: z
    .object({
      enabled: z.boolean(),
      text: z.string().trim().max(2000),
      start: hhmm,
      end: hhmm,
      days: z.array(z.number().int().min(0).max(6)).max(7),
    })
    .optional(),
  cases: z
    .object({
      autoCloseDays: z.number().int().min(1).max(60),
      reopenDays: z.number().int().min(0).max(90),
      transferSla: z.object({
        normal: z.number().int().min(0).max(1440),
        urgent: z.number().int().min(0).max(1440),
        escalateNormal: z.number().int().min(0).max(1440),
        escalateUrgent: z.number().int().min(0).max(1440),
      }),
    })
    .optional(),
  urgent: z
    .object({
      enabled: z.boolean(),
      keywords: z.array(z.string().trim().min(1).max(50)).max(100),
      replyEnabled: z.boolean(),
      reply: z.string().trim().max(2000),
    })
    .optional(),
});

export const PATCH = handle(async (req: Request) => {
  const me = await requireRole(["owner", "admin"]);
  const { name, ...rest } = await parseBody(req, Patch);
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: me.orgId } });
  const settings = { ...(org.settings as object), ...rest };
  const updated = await prisma.organization.update({ where: { id: me.orgId }, data: { name, settings } });
  const was = (org.settings as { visibility?: string })?.visibility ?? "all";
  if (rest.visibility && rest.visibility !== was) {
    await audit(me.orgId, me.id, "settings.visibility", { type: "org", id: me.orgId }, { from: was, to: rest.visibility });
    publish({ type: "patients_changed" });
  }
  return json({ name: updated.name, settings: { ...(updated.settings as object), his: undefined, auth: undefined } });
});
