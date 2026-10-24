import { prisma } from "@/lib/db";
import { handle, json } from "@/lib/api";
import { currentUser } from "@/lib/auth";
import { normHn } from "@/lib/patients";
import { uiChannel, uiContact, uiPatient, uiTag } from "@/lib/inbox/serialize";
import { profileTagInclude } from "@/lib/inbox/serialize";
import { patientWhere, visibilityFor } from "@/lib/visibility";

export const dynamic = "force-dynamic";

// รายชื่อแฟ้มคนไข้ (ค้นด้วย ชื่อ / HN / เบอร์ / อีเมล / ชื่อในช่องทาง)
export const GET = handle(async (req: Request) => {
  const me = await currentUser();
  const q = new URL(req.url).searchParams.get("q")?.trim();
  const v = await visibilityFor(me);
  const [patients, channels, tags] = await Promise.all([
    prisma.patient.findMany({
      where: {
        orgId: me.orgId,
        mergedIntoId: null,
        ...patientWhere(v),
        ...(q && {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { hn: { contains: normHn(q) ?? q, mode: "insensitive" } },
            { phone: { contains: q } },
            { email: { contains: q, mode: "insensitive" } },
            { contacts: { some: { name: { contains: q, mode: "insensitive" } } } },
          ],
        }),
      },
      include: { tags: true, profileTags: profileTagInclude, contacts: { include: { conversations: { select: { lastMessageAt: true }, orderBy: { lastMessageAt: "desc" }, take: 1 } } } },
      orderBy: { updatedAt: "desc" },
      take: 500,
    }),
    prisma.channel.findMany({ where: { orgId: me.orgId } }),
    prisma.tag.findMany({ where: { orgId: me.orgId } }),
  ]);
  return json({
    patients: patients.map((p) => ({
      ...uiPatient(p),
      lastContactAt: p.contacts
        .flatMap((c) => c.conversations.map((v) => v.lastMessageAt.toISOString()))
        .sort()
        .at(-1),
    })),
    contacts: patients.flatMap((p) => p.contacts.map(uiContact)),
    channels: channels.map(uiChannel),
    tags: tags.map(uiTag),
  });
});
