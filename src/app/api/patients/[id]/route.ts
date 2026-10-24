import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { apiError, handle, json, parseBody } from "@/lib/api";
import { publish } from "@/lib/realtime";
import { currentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ownPatient } from "@/lib/scope";
import { normHn } from "@/lib/patients";
import { uiAppointment, uiContact, uiPatient } from "@/lib/inbox/serialize";
import { profileTagInclude } from "@/lib/inbox/serialize";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const me = await currentUser();
  const own = await ownPatient(id, me);
  // แฟ้มที่ถูกรวมไปแล้ว → ส่งต่อไปยังแฟ้มหลัก
  const target = own.mergedIntoId ?? id;
  const p = await prisma.patient.findUniqueOrThrow({
    where: { id: target },
    include: { tags: true, profileTags: profileTagInclude, contacts: true, appointments: { orderBy: { createdAt: "desc" } } },
  });
  return json({ patient: uiPatient(p), contacts: p.contacts.map(uiContact), appointments: p.appointments.map(uiAppointment), redirectedFrom: own.mergedIntoId ? id : undefined });
});

const Patch = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  hn: z.string().trim().max(20).regex(/^[0-9A-Za-z\-/ ]*$/, "HN ใช้ได้เฉพาะตัวเลข ตัวอักษร - และ /").optional(),
  birthDate: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, "รูปแบบวันที่ YYYY-MM-DD").optional(),
  phone: z.string().trim().max(40).optional(),
  email: z.string().trim().max(200).optional(),
  note: z.string().max(5000).optional(),
  tagIds: z.array(z.string()).max(50).optional(),
});

export const PATCH = handle(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const me = await currentUser();
  const own = await ownPatient(id, me);
  if (own.mergedIntoId) return apiError("แฟ้มนี้ถูกรวมไปแล้ว", 409);
  const { tagIds, ...rest } = await parseBody(req, Patch);
  if (tagIds?.length) {
    const n = await prisma.tag.count({ where: { id: { in: tagIds }, orgId: me.orgId } });
    if (n !== tagIds.length) return apiError("แท็กไม่ถูกต้อง", 400);
  }
  if (rest.birthDate && new Date(rest.birthDate) > new Date()) return apiError("วันเกิดต้องไม่เป็นวันในอนาคต", 400);
  const empty = (v?: string) => (v === undefined ? undefined : v || null);
  const before = await prisma.patient.findUniqueOrThrow({ where: { id } });
  const hn = rest.hn === undefined ? undefined : normHn(rest.hn);
  try {
    const p = await prisma.patient.update({
      where: { id },
      data: {
        name: rest.name,
        hn,
        // แก้ HN หรือวันเกิดเอง = ผลการตรวจกับ HIS ไม่ใช้ได้อีก
        ...(((hn !== undefined && hn !== before.hn) ||
          (rest.birthDate !== undefined && rest.birthDate !== (before.birthDate?.toISOString().slice(0, 10) ?? ""))) && { hisVerifiedAt: null }),
        birthDate: rest.birthDate === undefined ? undefined : rest.birthDate ? new Date(rest.birthDate) : null,
        phone: empty(rest.phone),
        email: empty(rest.email),
        note: empty(rest.note),
        ...(tagIds && { tags: { set: tagIds.map((t) => ({ id: t })) } }),
      },
      include: { tags: true, profileTags: profileTagInclude, contacts: { select: { id: true } } },
    });
    // บันทึกเฉพาะ "ช่องที่แก้" ไม่เก็บค่าข้อมูลส่วนบุคคลลงบันทึก
    const changed = (["name", "hn", "birthDate", "phone", "email"] as const).filter((f) => {
      const v = f === "hn" ? hn : rest[f];
      if (v === undefined) return false;
      const old = f === "birthDate" ? before.birthDate?.toISOString().slice(0, 10) ?? "" : (before[f] ?? "");
      return String(old) !== String(v ?? "");
    });
    if (changed.length) await audit(me.orgId, me.id, "patient.update", { type: "patient", id }, { fields: changed });
    publish({ type: "patient", patientId: id });
    return json(uiPatient(p));
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const other = await prisma.patient.findFirst({ where: { orgId: me.orgId, hn }, select: { id: true, name: true } });
      return json({ error: `HN ${hn} เป็นของแฟ้ม “${other?.name}” อยู่แล้ว — ถ้าเป็นคนเดียวกันให้รวมแฟ้ม`, conflictPatientId: other?.id }, 409);
    }
    throw e;
  }
});
