import { prisma } from "@/lib/db";
import { APP_TZ } from "@/lib/time";

export type Range = "today" | "7d" | "30d";

// คอลัมน์เวลาเก็บเป็น timestamp (UTC, ไม่มี timezone) → ส่งพารามิเตอร์เป็นสตริง UTC แล้ว cast
// เพื่อไม่ให้ขึ้นกับค่า TimeZone ของ session ฐานข้อมูล
const ts = (d: Date) => d.toISOString().replace("T", " ").replace("Z", "");

interface Window {
  from: Date;
  to: Date;
}

/** ช่วงเวลาปัจจุบันและช่วงก่อนหน้า (ยาวเท่ากัน) ตามเขตเวลา APP_TZ */
async function windows(range: Range): Promise<{ cur: Window; prev: Window }> {
  const days = range === "today" ? 1 : range === "7d" ? 7 : 30;
  const [r] = await prisma.$queryRaw<{ start: Date }[]>`
    SELECT (date_trunc('day', now() AT TIME ZONE ${APP_TZ}) AT TIME ZONE ${APP_TZ}) AS start`;
  const startToday = r.start;
  const from = new Date(startToday.getTime() - (days - 1) * 86_400_000);
  const to = new Date(startToday.getTime() + 86_400_000);
  const prevFrom = new Date(from.getTime() - days * 86_400_000);
  return { cur: { from, to }, prev: { from: prevFrom, to: from } };
}

async function kpis(orgId: string, w: Window) {
  const [row] = await prisma.$queryRaw<
    { chats: bigint; new_contacts: bigint; closed: bigint; avg_first_response_sec: number | null }[]
  >`
    WITH conv AS (
      SELECT v.id FROM "Conversation" v JOIN "Channel" c ON c.id = v."channelId" WHERE c."orgId" = ${orgId}
    ),
    cm AS (
      SELECT m."conversationId" AS cid, min(m."createdAt") AS t0
      FROM "Message" m
      WHERE m."conversationId" IN (SELECT id FROM conv) AND m.sender = 'customer'
        AND m."createdAt" >= ${ts(w.from)}::timestamp AND m."createdAt" < ${ts(w.to)}::timestamp
      GROUP BY m."conversationId"
    ),
    fr AS (
      SELECT cm.cid, cm.t0,
        (SELECT min(a."createdAt") FROM "Message" a
          WHERE a."conversationId" = cm.cid AND a.sender = 'agent' AND a.kind <> 'note' AND a."createdAt" >= cm.t0) AS t1
      FROM cm
    )
    SELECT
      (SELECT count(*) FROM cm) AS chats,
      (SELECT count(*) FROM "Patient" WHERE "orgId" = ${orgId} AND "mergedIntoId" IS NULL AND "createdAt" >= ${ts(w.from)}::timestamp AND "createdAt" < ${ts(w.to)}::timestamp) AS new_contacts,
      (SELECT count(*) FROM "Case" k WHERE k."orgId" = ${orgId} AND k."closedAt" >= ${ts(w.from)}::timestamp AND k."closedAt" < ${ts(w.to)}::timestamp AND k.outcome <> 'merged') AS closed,
      (SELECT avg(extract(epoch FROM (t1 - t0)))::float FROM fr WHERE t1 IS NOT NULL) AS avg_first_response_sec`;

  const [appointments, urgent] = await Promise.all([
    prisma.appointment.count({ where: { patient: { orgId }, createdAt: { gte: w.from, lt: w.to }, status: { not: "cancelled" } } }),
    prisma.case.count({ where: { orgId, urgentAt: { gte: w.from, lt: w.to } } }),
  ]);
  // เวลารอรับงาน (เปิดงาน → มีผู้รับ) ของงานที่ถูกรับในช่วงนี้
  const [acc] = await prisma.$queryRaw<{ avg_sec: number | null; opened: bigint }[]>`
    SELECT avg(extract(epoch FROM ("acceptedAt" - "openedAt")))::float AS avg_sec,
      (SELECT count(*) FROM "Case" WHERE "orgId" = ${orgId} AND "openedAt" >= ${ts(w.from)}::timestamp AND "openedAt" < ${ts(w.to)}::timestamp) AS opened
    FROM "Case" WHERE "orgId" = ${orgId} AND "acceptedAt" >= ${ts(w.from)}::timestamp AND "acceptedAt" < ${ts(w.to)}::timestamp`;

  return {
    chats: Number(row.chats),
    newContacts: Number(row.new_contacts),
    closed: Number(row.closed),
    avgFirstResponseMin: row.avg_first_response_sec == null ? null : Math.round((row.avg_first_response_sec / 60) * 10) / 10,
    appointments,
    urgent,
    opened: Number(acc.opened),
    avgAcceptMin: acc.avg_sec == null ? null : Math.round((acc.avg_sec / 60) * 10) / 10,
  };
}

export async function dashboard(orgId: string, range: Range) {
  const { cur, prev } = await windows(range);
  const [now, before] = await Promise.all([kpis(orgId, cur), kpis(orgId, prev)]);

  const byHour = await prisma.$queryRaw<{ h: number; n: bigint }[]>`
    SELECT extract(hour FROM m."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${APP_TZ})::int AS h, count(*) AS n
    FROM "Message" m JOIN "Conversation" v ON v.id = m."conversationId" JOIN "Channel" c ON c.id = v."channelId"
    WHERE c."orgId" = ${orgId} AND m.sender = 'customer' AND m."createdAt" >= ${ts(cur.from)}::timestamp AND m."createdAt" < ${ts(cur.to)}::timestamp
    GROUP BY 1`;

  const byChannel = await prisma.$queryRaw<{ type: string; n: bigint }[]>`
    SELECT c.type::text AS type, count(DISTINCT v.id) AS n
    FROM "Message" m JOIN "Conversation" v ON v.id = m."conversationId" JOIN "Channel" c ON c.id = v."channelId"
    WHERE c."orgId" = ${orgId} AND m.sender = 'customer' AND m."createdAt" >= ${ts(cur.from)}::timestamp AND m."createdAt" < ${ts(cur.to)}::timestamp
    GROUP BY 1`;

  // ผลงานแอดมิน: จำนวนข้อความ, จำนวนแชทที่ตอบ, เวลาตอบเฉลี่ย (นับจากข้อความลูกค้าก่อนหน้าที่ยังไม่มีใครตอบ)
  const agents = await prisma.$queryRaw<{ id: string; messages: bigint; chats: bigint; avg_sec: number | null }[]>`
    WITH am AS (
      SELECT m.id, m."agentId", m."conversationId", m."createdAt",
        (SELECT max(c2."createdAt") FROM "Message" c2
          WHERE c2."conversationId" = m."conversationId" AND c2.sender = 'customer' AND c2."createdAt" <= m."createdAt") AS last_cust,
        (SELECT max(a2."createdAt") FROM "Message" a2
          WHERE a2."conversationId" = m."conversationId" AND a2.sender = 'agent' AND a2.kind <> 'note' AND a2."createdAt" < m."createdAt") AS prev_agent
      FROM "Message" m JOIN "User" u ON u.id = m."agentId"
      WHERE u."orgId" = ${orgId} AND m.sender = 'agent' AND m.kind <> 'note'
        AND m."createdAt" >= ${ts(cur.from)}::timestamp AND m."createdAt" < ${ts(cur.to)}::timestamp
    )
    SELECT "agentId" AS id, count(*) AS messages, count(DISTINCT "conversationId") AS chats,
      avg(CASE WHEN last_cust IS NOT NULL AND (prev_agent IS NULL OR prev_agent < last_cust)
               THEN extract(epoch FROM ("createdAt" - last_cust)) END)::float AS avg_sec
    FROM am GROUP BY "agentId"`;

  // หมวดเรื่อง / แผนก ของแชทที่คนไข้ทักเข้ามาในช่วงนี้
  // หมวดเรื่อง / แผนก ของงานที่คนไข้ทักเข้ามาในช่วงนี้
  const byCat = await prisma.$queryRaw<{ category: string | null; dept: string | null; n: bigint }[]>`
    SELECT k.category::text AS category, k."departmentId" AS dept, count(DISTINCT k.id) AS n
    FROM "Message" m JOIN "Case" k ON k.id = m."caseId"
    WHERE k."orgId" = ${orgId} AND m.sender = 'customer' AND m."createdAt" >= ${ts(cur.from)}::timestamp AND m."createdAt" < ${ts(cur.to)}::timestamp
    GROUP BY 1, 2`;
  // ผลการปิดงาน
  const byOutcome = await prisma.$queryRaw<{ outcome: string; n: bigint }[]>`
    SELECT outcome::text AS outcome, count(*) AS n FROM "Case"
    WHERE "orgId" = ${orgId} AND "closedAt" >= ${ts(cur.from)}::timestamp AND "closedAt" < ${ts(cur.to)}::timestamp AND outcome IS NOT NULL AND outcome <> 'merged'
    GROUP BY 1`;
  // การโอนงานเข้าแต่ละแผนก: จำนวน / ถูกตีกลับ / เวลารอแผนกรับเฉลี่ย
  const transfers = await prisma.$queryRaw<{ dept: string | null; n: bigint; returned: bigint; avg_sec: number | null }[]>`
    SELECT t."toDeptId" AS dept, count(*) AS n, count(t."returnedAt") AS returned,
      avg(extract(epoch FROM (t."acceptedAt" - t."createdAt")))::float AS avg_sec
    FROM "CaseTransfer" t JOIN "Case" k ON k.id = t."caseId"
    WHERE k."orgId" = ${orgId} AND t."createdAt" >= ${ts(cur.from)}::timestamp AND t."createdAt" < ${ts(cur.to)}::timestamp
    GROUP BY 1`;
  const departments = await prisma.department.findMany({ where: { orgId }, orderBy: { name: "asc" } });
  const sum = (f: (r: (typeof byCat)[number]) => boolean) => byCat.filter(f).reduce((s, r) => s + Number(r.n), 0);

  const users = await prisma.user.findMany({ where: { orgId }, select: { id: true, name: true, color: true, active: true, lastSeenAt: true } });

  return {
    range,
    current: now,
    previous: before,
    byHour: Array.from({ length: 24 }, (_, h) => Number(byHour.find((r) => r.h === h)?.n ?? 0)),
    byCategory: (["appointment", "rights", "cost", "results", "symptom", "other", null] as const).map((k) => ({ category: k, chats: sum((r) => r.category === k) })),
    byDepartment: [
      ...departments.map((d) => ({ id: d.id as string | null, name: d.name, color: d.color, chats: sum((r) => r.dept === d.id) })),
      { id: null, name: "ศูนย์กลาง (ยังไม่โอน)", color: "#94a3b8", chats: sum((r) => r.dept === null) },
    ],
    byOutcome: byOutcome.map((r) => ({ outcome: r.outcome, cases: Number(r.n) })),
    transfers: transfers.map((t) => ({
      deptId: t.dept,
      name: departments.find((d) => d.id === t.dept)?.name ?? "—",
      color: departments.find((d) => d.id === t.dept)?.color ?? "#94a3b8",
      count: Number(t.n),
      returned: Number(t.returned),
      avgAcceptMin: t.avg_sec == null ? null : Math.round((t.avg_sec / 60) * 10) / 10,
    })),
    byChannel: (["line", "facebook", "instagram", "email", "tiktok"] as const).map((t) => ({ type: t, chats: Number(byChannel.find((r) => r.type === t)?.n ?? 0) })),
    agents: users
      .filter((u) => u.active || agents.some((a) => a.id === u.id))
      .map((u) => {
        const a = agents.find((x) => x.id === u.id);
        return {
          id: u.id,
          name: u.name,
          color: u.color,
          online: !!u.lastSeenAt && Date.now() - u.lastSeenAt.getTime() < 5 * 60_000,
          messages: Number(a?.messages ?? 0),
          chats: Number(a?.chats ?? 0),
          avgResponseMin: a?.avg_sec == null ? null : Math.round((a.avg_sec / 60) * 10) / 10,
        };
      })
      .sort((x, y) => y.messages - x.messages),
  };
}
