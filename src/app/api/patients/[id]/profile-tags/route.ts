import { z } from "zod";
import { prisma } from "@/lib/db";
import { apiError, handle, json, parseBody } from "@/lib/api";
import { currentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { publish } from "@/lib/realtime";
import { ownPatient } from "@/lib/scope";
import { profileTagInclude, uiProfileTag } from "@/lib/inbox/serialize";

const Body = z.union([
  z.object({ defId: z.string(), note: z.string().trim().max(200).optional(), caseId: z.string().optional() }),
  z.object({
    category: z.enum(["need", "communication", "like", "dislike"]),
    label: z.string().trim().min(2, "แท็กสั้นเกินไป").max(60, "แท็กยาวเกิน 60 ตัวอักษร"),
    note: z.string().trim().max(200).optional(),
    caseId: z.string().optional(),
  }),
]);

// ใส่แท็กคนไข้: เลือกจากรายการกลาง หรือพิมพ์ใหม่ (แท็กใหม่ใช้ได้ทันทีและรอผู้ดูแลพิจารณาเข้ารายการกลาง)
export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const me = await currentUser();
  const own = await ownPatient(id, me);
  if (own.mergedIntoId) return apiError("แฟ้มนี้ถูกรวมไปแล้ว", 409);
  const body = await parseBody(req, Body);
  let defId: string;
  if ("defId" in body) {
    const d = await prisma.profileTagDef.findFirst({ where: { id: body.defId, orgId: me.orgId, active: true } });
    if (!d) return apiError("ไม่พบแท็กนี้", 400);
    defId = d.id;
  } else {
    const d = await prisma.profileTagDef.upsert({
      where: { orgId_category_label: { orgId: me.orgId, category: body.category, label: body.label } },
      create: { orgId: me.orgId, category: body.category, label: body.label, suggested: true, createdById: me.id },
      update: {},
    });
    if (!d.active) return apiError("แท็กนี้ถูกปิดใช้งานโดยผู้ดูแล", 400);
    defId = d.id;
  }
  if (body.caseId && !(await prisma.case.count({ where: { id: body.caseId, patientId: id } }))) return apiError("งานไม่ใช่ของคนไข้นี้", 400);
  const t = await prisma.patientProfileTag.upsert({
    where: { patientId_defId: { patientId: id, defId } },
    create: { patientId: id, defId, note: body.note || null, addedById: me.id, caseId: body.caseId },
    update: { note: body.note === undefined ? undefined : body.note || null },
    ...{ include: profileTagInclude.include },
  });
  await audit(me.orgId, me.id, "patient.profile_tag", { type: "patient", id }, { add: t.def.label, category: t.def.category });
  publish({ type: "patient", patientId: id });
  return json(uiProfileTag(t), 201);
});
