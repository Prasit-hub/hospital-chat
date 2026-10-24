import { prisma } from "@/lib/db";
import type { Prisma, User } from "@/generated/prisma/client";

// การเห็นแชทตามแผนก (Organization.settings.visibility)
//   "all"        = ทุกคนในองค์กรเห็นทุกงาน (แบบเดิม)
//   "department" = เจ้าหน้าที่เห็นเฉพาะงานที่เกี่ยวกับตัวเอง:
//                  งานที่ตัวเองรับผิดชอบ · งานของแผนกตัวเอง · งานที่โอนมารอแผนกตัวเองรับ
//                  เจ้าหน้าที่ที่ไม่มีแผนก เห็นงานที่ยังไม่อยู่แผนกใด (คิวกลาง)
//   ผู้ดูแล/เจ้าของ และคนในแผนกที่ตั้ง “เห็นงานทุกแผนก” (เช่น ศูนย์ประสานงาน) เห็นทุกงาน

export type VisibilityMode = "all" | "department";
type Me = Pick<User, "id" | "orgId" | "role" | "departmentId">;

export type Visibility = { all: true } | { all: false; userId: string; deptId: string | null };

export async function visibilityMode(orgId: string): Promise<VisibilityMode> {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
  return (org.settings as { visibility?: VisibilityMode })?.visibility === "department" ? "department" : "all";
}

export async function visibilityFor(me: Me): Promise<Visibility> {
  if (me.role === "owner" || me.role === "admin") return { all: true };
  if ((await visibilityMode(me.orgId)) === "all") return { all: true };
  if (me.departmentId) {
    const d = await prisma.department.findUnique({ where: { id: me.departmentId }, select: { seesAllCases: true } });
    if (d?.seesAllCases) return { all: true };
  }
  return { all: false, userId: me.id, deptId: me.departmentId ?? null };
}

/** เงื่อนไขงานที่มองเห็น (ใช้ใน where ของ prisma.case) */
export function caseWhere(v: Visibility): Prisma.CaseWhereInput {
  if (v.all) return {};
  const or: Prisma.CaseWhereInput[] = [{ ownerId: v.userId }];
  if (v.deptId) {
    or.push({ departmentId: v.deptId });
    or.push({ status: "transfer_pending", transfers: { some: { toDeptId: v.deptId, acceptedAt: null, returnedAt: null, recalledAt: null } } });
  } else {
    or.push({ departmentId: null });
  }
  return { OR: or };
}

/** แฟ้มคนไข้ที่มองเห็น = มีอย่างน้อย 1 งานที่มองเห็น */
export function patientWhere(v: Visibility): Prisma.PatientWhereInput {
  return v.all ? {} : { cases: { some: caseWhere(v) } };
}

export async function canSeeCase(v: Visibility, caseId: string) {
  if (v.all) return true;
  return (await prisma.case.count({ where: { id: caseId, ...caseWhere(v) } })) > 0;
}

export async function canSeePatient(v: Visibility, patientId: string) {
  if (v.all) return true;
  return (await prisma.case.count({ where: { patientId, ...caseWhere(v) } })) > 0;
}

/** id ของงานที่มองเห็นในแฟ้มนี้ (null = เห็นทั้งหมด) */
export async function visibleCaseIds(v: Visibility, patientId: string): Promise<Set<string> | null> {
  if (v.all) return null;
  const rows = await prisma.case.findMany({ where: { patientId, ...caseWhere(v) }, select: { id: true } });
  return new Set(rows.map((r) => r.id));
}
