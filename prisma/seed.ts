// ใส่ข้อมูลตัวอย่าง (ข้อมูลสมมติทั้งหมด ไม่ใช่ข้อมูลคนไข้จริง): npx prisma db seed
// - องค์กร (โรงพยาบาลตัวอย่าง) แผนก เจ้าหน้าที่ แท็ก ข้อความสำเร็จรูป กฎตอบกลับ คำเร่งด่วน
// - ช่องทาง demo (token ปลอม — เชื่อมต่อช่องทางจริงจากหน้า ตั้งค่า)
// - คนไข้ตัวอย่าง: มีทั้งแฟ้มที่รวมหลายช่องทางแล้ว และแฟ้มที่ "น่าจะเป็นคนเดียวกัน" ให้ลองรวม
import "dotenv/config";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type ChannelType, type InquiryCategory } from "../src/generated/prisma/client";
import { encryptJson } from "../src/lib/crypto";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

// เวลาในข้อมูลตัวอย่างอ้างอิง "วันนี้ 11:00 น." แล้วเลื่อนให้ตรงกับวันที่รัน seed
const MOCK_NOW = new Date("2026-10-17T11:00:00+07:00").getTime();
const shift = Date.now() - MOCK_NOW;
const t = (local: string) => new Date(new Date(local + "+07:00").getTime() + shift);
const day = (ymd: string) => new Date(ymd + "T00:00:00Z");

type From = "customer" | "agent" | "bot" | "system";
type Msg = [From, string, string, { agent?: string; note?: boolean; read?: boolean }?];

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "true") {
    console.log("production: ข้ามข้อมูลตัวอย่าง — ใช้ scripts/create-owner.ts เพื่อสร้างบัญชีเจ้าของ");
    return;
  }
  if (await prisma.organization.count()) {
    console.log("มีข้อมูลอยู่แล้ว — ข้าม seed (ลบฐานข้อมูลด้วย npx prisma migrate reset ถ้าต้องการเริ่มใหม่)");
    return;
  }

  const org = await prisma.organization.create({
    data: {
      name: "โรงพยาบาลตัวอย่าง",
      settings: {
        welcome: {
          enabled: true,
          text: "สวัสดีค่ะ โรงพยาบาลตัวอย่างยินดีให้บริการ เจ้าหน้าที่จะตอบกลับโดยเร็วที่สุด หากมีอาการฉุกเฉินกรุณาโทร 1669 ค่ะ",
        },
        away: {
          enabled: true,
          text: "ขณะนี้อยู่นอกเวลาทำการของศูนย์ประสานงาน (ทุกวัน 08:00–20:00 น.) เจ้าหน้าที่จะตอบกลับในเวลาทำการ หากมีอาการฉุกเฉินกรุณาโทร 1669 หรือมาที่ห้องฉุกเฉินได้ตลอด 24 ชม.",
          start: "08:00",
          end: "20:00",
          days: [0, 1, 2, 3, 4, 5, 6],
        },
        cases: { autoCloseDays: 3, reopenDays: 7, transferSla: { normal: 15, urgent: 0, escalateNormal: 60, escalateUrgent: 5 } },
        // เจ้าหน้าที่เห็นเฉพาะงานของแผนกตัวเอง (ศูนย์ประสานงานเห็นทุกแผนก)
        visibility: "department",
        // เข้าสู่ระบบ: เริ่มที่รหัสผ่านในระบบ — ตารางจับคู่กลุ่ม AD เตรียมไว้สำหรับโหมดจำลอง (กลุ่มใน src/lib/ad/mock-directory.json)
        auth: { mode: "local", localLogin: "owners", autoProvision: true, sessionHours: 12, rules: [] as { group: string; role?: string; departmentId?: string }[] },
        // ตัวอย่างเท่านั้น — รายการคำและข้อความต้องได้รับการทบทวนโดยทีมคลินิกของโรงพยาบาลก่อนใช้งานจริง
        urgent: {
          enabled: true,
          keywords: ["เจ็บหน้าอก", "หายใจไม่ออก", "หายใจไม่ค่อยออก", "หมดสติ", "ชัก", "เลือดออกมาก", "ปากเบี้ยว", "แขนขาอ่อนแรง"],
          replyEnabled: true,
          reply:
            "หากผู้ป่วยมีอาการฉุกเฉิน เช่น เจ็บหน้าอก หายใจลำบาก หมดสติ กรุณาโทร 1669 หรือมาที่ห้องฉุกเฉินทันที — เจ้าหน้าที่กำลังตรวจสอบข้อความของท่าน",
        },
      },
    },
  });

  const deptData: [string, string][] = [
    ["ศูนย์ประสานงาน", "#0ea5e9"],
    ["อายุรกรรม", "#6366f1"],
    ["ศัลยกรรม", "#ef4444"],
    ["กุมารเวชกรรม", "#f59e0b"],
    ["สูติ-นรีเวช", "#ec4899"],
    ["ทันตกรรม", "#14b8a6"],
    ["ศูนย์ตรวจสุขภาพ", "#22c55e"],
    ["การเงินและสิทธิการรักษา", "#8b5cf6"],
    ["เวชระเบียน", "#64748b"],
  ];
  const dept: Record<string, string> = {};
  for (const [name, color] of deptData)
    dept[name] = (await prisma.department.create({ data: { orgId: org.id, name, color, seesAllCases: name === "ศูนย์ประสานงาน" } })).id;
  // ตารางจับคู่กลุ่ม AD → บทบาท/แผนก (ต้องรู้ id แผนกก่อน)
  await prisma.organization.update({
    where: { id: org.id },
    data: {
      settings: {
        ...(org.settings as object),
        auth: {
          ...((org.settings as { auth?: object }).auth ?? {}),
          rules: [
            { group: "RuamChat-Admins", role: "admin" },
            { group: "RuamChat-Users", role: "agent" },
            { group: "Dept-Coordination", departmentId: dept["ศูนย์ประสานงาน"] },
            { group: "Dept-Medicine", departmentId: dept["อายุรกรรม"] },
            { group: "Dept-Finance", departmentId: dept["การเงินและสิทธิการรักษา"] },
          ],
        },
      },
    },
  });

  // บัญชีเจ้าหน้าที่ — รหัสผ่านเริ่มต้น: SEED_OWNER_PASSWORD (เจ้าของ) หรือสุ่ม แสดงครั้งเดียวตอนจบ seed
  const randomPw = () => randomBytes(9).toString("base64url");
  const staff = [
    { key: "piya", name: "ปิยะ", email: "owner@example.com", role: "owner", color: "#6d5bd0", dept: "ศูนย์ประสานงาน" },
    { key: "mind", name: "มายด์", email: "mind@example.com", role: "admin", color: "#0e9f8a", dept: "ศูนย์ประสานงาน" },
    { key: "ton", name: "ต้น", email: "ton@example.com", role: "agent", color: "#d97706", dept: "การเงินและสิทธิการรักษา" },
    { key: "prae", name: "แพร", email: "prae@example.com", role: "agent", color: "#db2777", dept: "ศูนย์ตรวจสุขภาพ" },
  ] as const;
  const user: Record<string, string> = {};
  const logins: { email: string; password: string; role: string }[] = [];
  for (const [i, s] of staff.entries()) {
    const password = i === 0 && process.env.SEED_OWNER_PASSWORD ? process.env.SEED_OWNER_PASSWORD : randomPw();
    const u = await prisma.user.create({
      data: { orgId: org.id, name: s.name, email: s.email, role: s.role, color: s.color, departmentId: dept[s.dept], passwordHash: await bcrypt.hash(password, 10) },
    });
    user[s.key] = u.id;
    logins.push({ email: s.email, password, role: s.role });
  }

  const tagData: [string, string][] = [
    ["ติดต่อครั้งแรก", "#3b82f6"],
    ["ผู้สูงอายุ", "#a855f7"],
    ["ประกันสุขภาพเอกชน", "#0ea5e9"],
    ["ประกันสังคม", "#10b981"],
    ["บัตรทอง", "#f59e0b"],
    ["ติดตามผล", "#ef4444"],
  ];
  const tag: Record<string, string> = {};
  for (const [name, color] of tagData) tag[name] = (await prisma.tag.create({ data: { orgId: org.id, name, color } })).id;

  await prisma.quickReply.createMany({
    data: [
      ["/สวัสดี", "ทักทาย", "สวัสดีค่ะ โรงพยาบาลตัวอย่างยินดีให้บริการค่ะ ต้องการสอบถามเรื่องใดคะ"],
      ["/ยืนยัน", "ขอข้อมูลยืนยันตัวตน", "เพื่อความปลอดภัยของข้อมูลผู้ป่วย รบกวนแจ้ง HN (ถ้ามี) หรือชื่อ-นามสกุล และวันเดือนปีเกิดของผู้ป่วยด้วยค่ะ"],
      ["/นัด", "ขอข้อมูลนัดหมาย", "รบกวนแจ้งแผนกหรืออาการโดยย่อ วันที่สะดวก และช่วงเวลา (เช้า/บ่าย) เจ้าหน้าที่จะตรวจสอบตารางแพทย์ให้ค่ะ"],
      ["/ฉุกเฉิน", "อาการฉุกเฉิน", "หากผู้ป่วยมีอาการฉุกเฉิน กรุณาโทร 1669 หรือมาที่ห้องฉุกเฉินของโรงพยาบาลทันที (เปิด 24 ชั่วโมง)"],
      ["/เวลา", "เวลาทำการ OPD", "แผนกผู้ป่วยนอกเปิดทุกวัน 08:00–20:00 น. ห้องฉุกเฉินเปิด 24 ชั่วโมงค่ะ"],
      ["/สิทธิ", "ตรวจสอบสิทธิ", "รบกวนแจ้งสิทธิการรักษาที่ใช้ (ประกันสังคม / บัตรทอง / ประกันเอกชน / ชำระเอง) เจ้าหน้าที่การเงินจะตรวจสอบให้ค่ะ"],
      ["/ขอบคุณ", "ขอบคุณ", "ขอบคุณที่ติดต่อโรงพยาบาลตัวอย่างค่ะ ขอให้หายป่วยไวๆ นะคะ 🙏"],
    ].map(([shortcut, title, text]) => ({ orgId: org.id, shortcut, title, text })),
  });
  await prisma.autoReplyRule.createMany({
    data: [
      { keywords: ["กี่โมง", "เวลาเปิด", "เปิดกี่โมง"], reply: "แผนกผู้ป่วยนอกเปิดทุกวัน 08:00–20:00 น. ห้องฉุกเฉินเปิด 24 ชั่วโมงค่ะ", enabled: true, channels: ["line", "facebook", "instagram"] as ChannelType[] },
      { keywords: ["ที่จอดรถ", "จอดรถ"], reply: "ที่จอดรถอยู่อาคาร P ชั้น 1–6 ผู้ป่วยจอดฟรี 3 ชั่วโมงแรกค่ะ", enabled: true, channels: ["line", "facebook"] as ChannelType[] },
      { keywords: ["แพ็กเกจ", "ตรวจสุขภาพประจำปี"], reply: "ดูรายละเอียดแพ็กเกจตรวจสุขภาพได้ที่หน้าเว็บไซต์ของโรงพยาบาล หรือแจ้งอายุและเพศ เจ้าหน้าที่จะแนะนำแพ็กเกจให้ค่ะ", enabled: false, channels: ["line"] as ChannelType[] },
    ].map((r) => ({ orgId: org.id, ...r })),
  });

  const channelData = [
    { key: "line", type: "line", name: "รพ.ตัวอย่าง LINE OA", followers: 28410, connected: true },
    { key: "fb", type: "facebook", name: "โรงพยาบาลตัวอย่าง", followers: 61200, connected: true },
    { key: "ig", type: "instagram", name: "@sample.hospital", followers: 9730, connected: true },
    { key: "tt", type: "tiktok", name: "@samplehospital", followers: 0, connected: false },
  ] as const;
  const ch: Record<string, string> = {};
  for (const c of channelData) {
    ch[c.key] = (
      await prisma.channel.create({
        data: {
          orgId: org.id,
          type: c.type,
          name: c.name,
          externalId: `demo-${c.type}`,
          credentials: encryptJson(c.type === "line" ? { channelSecret: "demo-secret", accessToken: "demo-token" } : { accessToken: "demo-token" }),
          connected: c.connected,
          followers: c.followers,
        },
      })
    ).id;
  }

  /* ---------------- คนไข้ (ข้อมูลสมมติ) ---------------- */
  const patient = async (p: { name: string; hn?: string; birth?: string; phone?: string; email?: string; note?: string; color: string; tags?: string[]; created: string }) =>
    (
      await prisma.patient.create({
        data: {
          orgId: org.id,
          name: p.name,
          hn: p.hn,
          birthDate: p.birth ? day(p.birth) : undefined,
          phone: p.phone,
          email: p.email,
          note: p.note,
          avatarColor: p.color,
          createdAt: t(p.created),
          tags: { connect: (p.tags ?? []).map((n) => ({ id: tag[n] })) },
        },
      })
    ).id;
  let ext = 0;
  const contact = async (patientId: string, channel: string, name: string, color: string, created: string) =>
    (await prisma.contact.create({ data: { orgId: org.id, channelId: ch[channel], externalId: `demo-user-${++ext}`, name, avatarColor: color, patientId, createdAt: t(created) } })).id;

  type Outcome = "answered" | "appointed" | "advised_visit" | "referred_external" | "no_response" | "spam" | "other";
  const caseIdOf: Record<string, string> = {};
  const conversation = async (
    contactId: string,
    channel: string,
    o: {
      status?: "open" | "pending" | "closed";
      assignee?: string;
      unread?: number;
      dept?: string;
      category?: InquiryCategory;
      urgent?: string;
      verified?: [string, string];
      source?: "dm" | "comment";
      outcome?: Outcome;
      /** โอนไปแผนกนี้ รอรับอยู่ [แผนก, เหตุผล, เวลาโอน] */
      transfer?: [string, string, string];
      key?: string;
    },
    msgs: Msg[],
  ) => {
    const last = msgs[msgs.length - 1];
    const first = msgs[0];
    const lastCustomer = [...msgs].reverse().find((m) => m[0] === "customer");
    const firstAgent = msgs.find((m) => m[0] === "agent" && !m[3]?.note);
    const prefix = last[0] === "agent" && !last[3]?.note ? "คุณ: " : last[0] === "bot" ? "บอท: " : "";
    const lastVisible = [...msgs].reverse().find((m) => m[0] !== "system" && !m[3]?.note) ?? last;
    const v = await prisma.conversation.create({
      data: {
        contactId,
        channelId: ch[channel],
        source: o.source ?? "dm",
        unread: o.unread ?? 0,
        lastMessage: (lastVisible === last ? prefix : lastVisible[0] === "agent" ? "คุณ: " : "") + lastVisible[2],
        lastMessageAt: t(last[1]),
        lastCustomerMessageAt: lastCustomer ? t(lastCustomer[1]) : null,
      },
    });
    // งาน 1 งานต่อแชทตัวอย่าง (สถานะเดิม open/pending/closed → queued / in_progress / waiting_patient / transfer_pending / closed)
    const patientId = (await prisma.contact.findUniqueOrThrow({ where: { id: contactId } })).patientId;
    const status = o.transfer
      ? "transfer_pending"
      : o.status === "closed"
        ? "closed"
        : o.status === "pending"
          ? "waiting_patient"
          : o.assignee
            ? "in_progress"
            : "queued";
    const k = await prisma.case.create({
      data: {
        orgId: org.id,
        patientId,
        status,
        ownerId: o.assignee ? user[o.assignee] : null,
        departmentId: o.dept && !o.transfer ? dept[o.dept] : o.transfer ? dept["ศูนย์ประสานงาน"] : null,
        category: o.category ?? null,
        urgent: !!o.urgent,
        urgentReason: o.urgent ?? null,
        urgentAt: o.urgent ? t(lastCustomer![1]) : null,
        verifiedAt: o.verified ? t(o.verified[1]) : null,
        verifiedById: o.verified ? user[o.verified[0]] : null,
        verifyMethod: o.verified ? "HN + วันเกิด" : null,
        openedAt: t(first[1]),
        acceptedAt: o.assignee && firstAgent ? t(firstAgent[1]) : null,
        firstResponseAt: firstAgent ? t(firstAgent[1]) : null,
        waitingSince: status === "waiting_patient" ? t(last[1]) : null,
        closedAt: status === "closed" ? t(last[1]) : null,
        closedById: status === "closed" && o.assignee ? user[o.assignee] : null,
        outcome: status === "closed" ? (o.outcome ?? "answered") : null,
      },
    });
    if (o.key) caseIdOf[o.key] = k.id;
    await prisma.caseEvent.create({ data: { caseId: k.id, type: "opened", createdAt: t(first[1]) } });
    if (o.transfer) {
      await prisma.caseTransfer.create({
        data: { caseId: k.id, fromDeptId: dept["ศูนย์ประสานงาน"], fromUserId: user[o.assignee ?? "piya"], toDeptId: dept[o.transfer[0]], reason: o.transfer[1], createdAt: t(o.transfer[2]) },
      });
      await prisma.caseEvent.create({ data: { caseId: k.id, type: "transferred", actorId: user[o.assignee ?? "piya"], createdAt: t(o.transfer[2]) } });
    }
    for (const [from, at, text, x] of msgs) {
      await prisma.message.create({
        data: {
          conversationId: v.id,
          caseId: k.id,
          sender: from,
          agentId: x?.agent ? user[x.agent] : null,
          kind: x?.note ? "note" : from === "system" ? "system" : "text",
          text,
          status: from === "customer" ? "received" : x?.read ? "read" : "sent",
          createdAt: t(at),
        },
      });
    }
    return v.id;
  };

  /* ---------------- รายการแท็กคนไข้ (ตัวอย่าง — ให้ฝ่ายบริการผู้ป่วยทบทวน) ---------------- */
  const tagDefs: [string, string, boolean?, boolean?][] = [
    ["need", "ต้องการล่าม (ภาษาอังกฤษ)"],
    ["need", "ต้องการล่าม (ภาษาพม่า)"],
    ["need", "ใช้รถเข็น"],
    ["need", "ต้องมีผู้ดูแลมาด้วย"],
    ["need", "ขอเจ้าหน้าที่เพศเดียวกัน"],
    ["need", "สายตาไม่ดี ส่งเป็นข้อความเสียง"],
    ["communication", "ชอบคำตอบสั้น กระชับ"],
    ["communication", "ต้องอธิบายทีละขั้น"],
    ["communication", "กังวลง่าย ควรยืนยันซ้ำ"],
    ["communication", "สะดวกสื่อสารภาษาอังกฤษ"],
    ["communication", "ให้บุตรตอบแทน"],
    ["like", "นัดช่วงเช้า"],
    ["like", "ติดต่อทาง LINE"],
    ["like", "มีแพทย์ประจำ"],
    ["like", "รับเอกสารทางอีเมล"],
    ["like", "ชอบให้เรียกชื่อเล่น", false, true],
    ["dislike", "ไม่สะดวกรับโทรศัพท์"],
    ["dislike", "ไม่สะดวกนัดวันหยุด"],
    ["dislike", "ไม่สะดวกรอนาน"],
    ["dislike", "ไม่ต้องการรับข่าวสาร / โปรโมชัน", true],
  ];
  const ptag: Record<string, string> = {};
  for (const [category, label, blocksBroadcast, suggested] of tagDefs) {
    ptag[label] = (
      await prisma.profileTagDef.create({
        data: { orgId: org.id, category: category as "need", label, blocksBroadcast: !!blocksBroadcast, suggested: !!suggested },
      })
    ).id;
  }
  const profile = (patientId: string, items: [string, string?][], by = "piya") =>
    prisma.patientProfileTag.createMany({ data: items.map(([label, note]) => ({ patientId, defId: ptag[label], note, addedById: user[by] })) });

  // 1) สมศรี — ทัก LINE (มี HN) และทัก Facebook แยกอีกบัญชี → ระบบแนะนำให้รวม (เบอร์ + ชื่อตรงกัน)
  const somsri = await patient({ name: "สมศรี มีสุข", hn: "6501234", birth: "1958-03-14", phone: "081-234-5678", color: "#f97316", tags: ["ผู้สูงอายุ", "บัตรทอง"], created: "2025-06-02T09:00:00", note: "ใช้รถเข็น ขอที่จอดใกล้ทางเข้า" });
  const somsriLine = await contact(somsri, "line", "Somsri M.", "#f97316", "2025-06-02T09:00:00");
  await conversation(somsriLine, "line", { assignee: "piya", unread: 1, dept: "อายุรกรรม", category: "appointment", verified: ["piya", "2026-10-17T09:24:00"] }, [
    ["customer", "2026-10-17T09:12:00", "สวัสดีค่ะ อยากเลื่อนนัดตรวจเบาหวานของแม่ค่ะ"],
    ["bot", "2026-10-17T09:12:04", "สวัสดีค่ะ โรงพยาบาลตัวอย่างยินดีให้บริการ เจ้าหน้าที่จะตอบกลับโดยเร็วที่สุด หากมีอาการฉุกเฉินกรุณาโทร 1669 ค่ะ"],
    ["agent", "2026-10-17T09:20:00", "สวัสดีค่ะ เพื่อความปลอดภัยของข้อมูลผู้ป่วย รบกวนแจ้ง HN หรือชื่อ-นามสกุล และวันเดือนปีเกิดของผู้ป่วยด้วยค่ะ", { agent: "piya", read: true }],
    ["customer", "2026-10-17T09:23:00", "HN 6501234 สมศรี มีสุข เกิด 14 มี.ค. 2501 ค่ะ"],
    ["system", "2026-10-17T09:24:00", "ปิยะ ยืนยันตัวตนคนไข้แล้ว (HN + วันเกิด)"],
    ["agent", "2026-10-17T09:26:00", "ขอบคุณค่ะ นัดเดิมคือวันพฤหัสที่ 22 ต.ค. ช่วงเช้า ต้องการเลื่อนเป็นวันไหนคะ", { agent: "piya", read: true }],
    ["customer", "2026-10-17T10:41:00", "ขอเป็นสัปดาห์ถัดไปช่วงบ่ายได้ไหมคะ"],
  ]);
  const somsriFb = await patient({ name: "สมศรี มีสุข", phone: "0812345678", color: "#fb923c", tags: ["ติดต่อครั้งแรก"], created: "2026-10-16T19:40:00" });
  const somsriFbC = await contact(somsriFb, "fb", "สมศรี มีสุข", "#fb923c", "2026-10-16T19:40:00");
  await conversation(somsriFbC, "fb", { status: "pending", assignee: "mind", category: "results" }, [
    ["customer", "2026-10-16T19:40:00", "ผลเลือดเมื่อวันจันทร์ออกหรือยังคะ"],
    ["agent", "2026-10-16T19:52:00", "สวัสดีค่ะ รบกวนแจ้ง HN และวันเกิดของผู้ป่วยเพื่อยืนยันตัวตนก่อนนะคะ", { agent: "mind", read: true }],
    ["customer", "2026-10-16T20:05:00", "ไม่ทราบ HN ค่ะ เบอร์ 0812345678"],
    ["agent", "2026-10-16T20:06:00", "ลูกค้ารายนี้น่าจะเป็นคนเดียวกับแฟ้ม LINE (เบอร์ตรงกัน) — ตรวจสอบก่อนรวมแฟ้ม", { agent: "mind", note: true }],
  ]);

  // 2) วีระ — รวมแฟ้ม LINE + Instagram ไว้แล้ว (มีประวัติการรวม ยกเลิกได้)
  const weera = await patient({ name: "วีระ ทองดี", hn: "6400987", birth: "1979-11-02", phone: "089-765-4321", email: "weera.t@example.com", color: "#0ea5e9", tags: ["ประกันสุขภาพเอกชน"], created: "2024-02-10T10:00:00" });
  const weeraLine = await contact(weera, "line", "วีระ ท.", "#0ea5e9", "2024-02-10T10:00:00");
  const weeraIgPatient = await prisma.patient.create({ data: { orgId: org.id, name: "weera.t", avatarColor: "#38bdf8", mergedIntoId: weera, email: "weera.t@example.com", createdAt: t("2026-10-15T08:00:00") } });
  const weeraIg = await contact(weera, "ig", "weera.t", "#38bdf8", "2026-10-15T08:00:00");
  await prisma.mergeEvent.create({
    data: {
      orgId: org.id,
      survivorId: weera,
      mergedId: weeraIgPatient.id,
      contactIds: [weeraIg],
      tagIds: [],
      appointmentIds: [],
      survivorBefore: { name: "วีระ ทองดี", hn: "6400987", birthDate: "1979-11-02", phone: "089-765-4321", email: null, note: null, mergedHn: null },
      reason: "อีเมลตรงกัน และคนไข้ยืนยันในแชท",
      actorId: user.mind,
      createdAt: t("2026-10-15T08:30:00"),
    },
  });
  await prisma.auditLog.create({ data: { orgId: org.id, actorId: user.mind, action: "patient.merge", targetType: "patient", targetId: weera, meta: { mergedId: weeraIgPatient.id, contacts: 1 }, createdAt: t("2026-10-15T08:30:00") } });
  await conversation(weeraLine, "line", { status: "closed", assignee: "ton", dept: "การเงินและสิทธิการรักษา", category: "rights", outcome: "answered" }, [
    ["customer", "2026-10-14T14:02:00", "ประกันบริษัทใช้ผ่าตัดส่องกล้องเข่าได้ไหมครับ"],
    ["agent", "2026-10-14T14:15:00", "ใช้ได้ครับ แต่ต้องส่งเอกสารขออนุมัติล่วงหน้าประมาณ 3–5 วันทำการ เจ้าหน้าที่ประกันจะติดต่อกลับครับ", { agent: "ton", read: true }],
    ["system", "2026-10-14T14:20:00", "ต้น ปิดแชทนี้"],
  ]);
  await conversation(weeraIg, "ig", { assignee: "ton", unread: 2, dept: "การเงินและสิทธิการรักษา", category: "rights" }, [
    ["customer", "2026-10-17T10:05:00", "สวัสดีครับ ทักทาง IG นะครับ เรื่องประกันผ่าตัดเข่าที่ถามไว้ทาง LINE"],
    ["customer", "2026-10-17T10:06:00", "เอกสารต้องใช้อะไรบ้างครับ"],
  ]);

  // 3) ผู้ติดต่อใหม่ สอบถามแพ็กเกจตรวจสุขภาพ
  const natt = await patient({ name: "Nattapong K.", color: "#22c55e", tags: ["ติดต่อครั้งแรก"], created: "2026-10-17T10:30:00" });
  const nattC = await contact(natt, "fb", "Nattapong K.", "#22c55e", "2026-10-17T10:30:00");
  await conversation(nattC, "fb", { unread: 2, dept: "ศูนย์ตรวจสุขภาพ", category: "cost" }, [
    ["customer", "2026-10-17T10:30:00", "สวัสดีครับ"],
    ["customer", "2026-10-17T10:31:00", "แพ็กเกจตรวจสุขภาพสำหรับอายุ 40 ราคาเท่าไหร่ครับ ต้องงดน้ำงดอาหารไหม"],
  ]);

  // 4) เรื่องเร่งด่วน (ระบบตรวจพบคำ)
  const mali = await patient({ name: "mali.chan", color: "#ec4899", tags: ["ติดต่อครั้งแรก"], created: "2026-10-17T10:52:00" });
  const maliC = await contact(mali, "ig", "mali.chan", "#ec4899", "2026-10-17T10:52:00");
  await conversation(maliC, "ig", { unread: 1, urgent: "ระบบพบคำว่า “เจ็บหน้าอก”", category: "symptom" }, [
    ["customer", "2026-10-17T10:52:00", "แม่อายุ 70 เจ็บหน้าอก เหงื่อออก ควรทำยังไงดีคะ"],
    ["system", "2026-10-17T10:52:01", "ระบบติดป้ายเร่งด่วน: พบคำว่า “เจ็บหน้าอก” — โปรดตรวจสอบทันที"],
    ["bot", "2026-10-17T10:52:03", "หากผู้ป่วยมีอาการฉุกเฉิน เช่น เจ็บหน้าอก หายใจลำบาก หมดสติ กรุณาโทร 1669 หรือมาที่ห้องฉุกเฉินทันที — เจ้าหน้าที่กำลังตรวจสอบข้อความของท่าน"],
  ]);

  // 5) สิทธิประกันสังคม — รอดำเนินการ
  const prasert = await patient({ name: "ประเสริฐ ใจงาม", hn: "6603321", birth: "1990-07-21", phone: "062-555-0101", color: "#eab308", tags: ["ประกันสังคม"], created: "2026-01-11T09:00:00" });
  const prasertC = await contact(prasert, "line", "ประเสริฐ", "#eab308", "2026-01-11T09:00:00");
  await conversation(
    prasertC,
    "line",
    { assignee: "piya", category: "rights", verified: ["piya", "2026-10-17T10:20:00"], transfer: ["การเงินและสิทธิการรักษา", "ตรวจสอบสถานะสิทธิประกันสังคมที่ย้ายมา", "2026-10-17T10:30:00"] },
    [
      ["customer", "2026-10-17T10:12:00", "ย้ายสิทธิประกันสังคมมาโรงพยาบาลนี้แล้ว ใช้ได้เลยไหมครับ"],
      ["system", "2026-10-17T10:20:00", "ปิยะ ยืนยันตัวตนคนไข้แล้ว (HN + วันเกิด)"],
      ["agent", "2026-10-17T10:25:00", "ขอส่งเรื่องให้เจ้าหน้าที่สิทธิการรักษาตรวจสอบในระบบนะครับ จะแจ้งกลับภายในวันนี้ครับ", { agent: "piya", read: true }],
      ["system", "2026-10-17T10:30:00", "ปิยะ โอนงานไปแผนกการเงินและสิทธิการรักษา: ตรวจสอบสถานะสิทธิประกันสังคมที่ย้ายมา"],
    ],
  );

  // 6) ขอเอกสาร / ใบรับรองแพทย์ — ปิดแล้ว
  const kanok = await patient({ name: "กนกวรรณ รักษ์ดี", hn: "6209876", birth: "1985-12-24", email: "kanokwan@example.com", color: "#8b5cf6", tags: ["ติดตามผล"], created: "2025-12-24T09:00:00" });
  const kanokC = await contact(kanok, "fb", "Kanokwan R.", "#8b5cf6", "2025-12-24T09:00:00");
  await conversation(kanokC, "fb", { status: "closed", assignee: "mind", dept: "เวชระเบียน", category: "results", outcome: "answered" }, [
    ["customer", "2026-10-15T20:30:00", "ขอใบรับรองแพทย์ย้อนหลังวันที่ 10 ต.ค. ได้ไหมคะ"],
    ["agent", "2026-10-15T20:47:00", "ได้ค่ะ ติดต่อรับได้ที่เวชระเบียน ชั้น 1 พร้อมบัตรประชาชน ค่าธรรมเนียม 100 บาทค่ะ", { agent: "mind", read: true }],
    ["system", "2026-10-15T20:50:00", "มายด์ ปิดแชทนี้"],
  ]);

  // 7) ทันตกรรม — มีนัดที่ยืนยันแล้ว
  const wilai = await patient({ name: "วิไล สายบุญ", hn: "6311452", birth: "1968-05-30", phone: "086-111-2233", color: "#14b8a6", tags: ["ผู้สูงอายุ"], created: "2026-01-11T09:00:00" });
  const wilaiC = await contact(wilai, "line", "คุณวิไล", "#14b8a6", "2026-01-11T09:00:00");
  await conversation(wilaiC, "line", { status: "closed", assignee: "prae", dept: "ทันตกรรม", category: "appointment", outcome: "appointed", key: "wilai" }, [
    ["customer", "2026-10-16T11:02:00", "อยากนัดขูดหินปูนค่ะ"],
    ["agent", "2026-10-16T11:10:00", "นัดให้วันศุกร์ที่ 23 ต.ค. 10:00 น. แผนกทันตกรรม ชั้น 3 นะคะ", { agent: "prae", read: true }],
    ["customer", "2026-10-16T11:12:00", "ขอบคุณค่ะ"],
    ["system", "2026-10-16T11:15:00", "แพร ปิดแชทนี้"],
  ]);

  // 8) ชื่อเหมือนกันสองช่องทาง (ข้อมูลน้อย) → ระบบแนะนำแบบ "ควรตรวจสอบเพิ่ม"
  const ploy1 = await patient({ name: "Ploy Sirin", color: "#a855f7", created: "2026-07-07T09:00:00" });
  const ploy1C = await contact(ploy1, "fb", "Ploy Sirin", "#a855f7", "2026-07-07T09:00:00");
  await conversation(ploy1C, "fb", { status: "closed", assignee: "prae", category: "other" }, [
    ["customer", "2026-10-12T15:00:00", "จอดรถได้ที่ไหนคะ"],
    ["bot", "2026-10-12T15:00:04", "ที่จอดรถอยู่อาคาร P ชั้น 1–6 ผู้ป่วยจอดฟรี 3 ชั่วโมงแรกค่ะ"],
  ]);
  const ploy2 = await patient({ name: "ploy.sirin", color: "#c084fc", tags: ["ติดต่อครั้งแรก"], created: "2026-10-17T09:40:00" });
  const ploy2C = await contact(ploy2, "ig", "ploy.sirin", "#c084fc", "2026-10-17T09:40:00");
  await conversation(ploy2C, "ig", { unread: 1, category: "appointment", dept: "สูติ-นรีเวช" }, [["customer", "2026-10-17T09:40:00", "อยากฝากครรภ์ค่ะ ต้องเตรียมเอกสารอะไรบ้าง"]]);

  /* ---------------- คำขอนัดหมาย ---------------- */
  await prisma.appointment.create({ data: { patientId: wilai, caseId: caseIdOf.wilai, departmentId: dept["ทันตกรรม"], doctor: "ทพญ.สมใจ (ตัวอย่าง)", date: day("2026-10-23"), slot: "morning", reason: "ขูดหินปูน", status: "confirmed", createdById: user.prae, createdAt: t("2026-10-16T11:10:00") } });
  await prisma.appointment.create({ data: { patientId: somsri, departmentId: dept["อายุรกรรม"], date: day("2026-10-22"), slot: "morning", reason: "ติดตามเบาหวาน", status: "confirmed", createdById: user.piya, createdAt: t("2026-09-22T10:00:00") } });

  await profile(somsri, [["ใช้รถเข็น", "ขอที่จอดใกล้ทางเข้า"], ["ให้บุตรตอบแทน", "ลูกสาวชื่อแอน เป็นคนพิมพ์"], ["นัดช่วงเช้า"], ["ไม่สะดวกรับโทรศัพท์"]]);
  await profile(weera, [["ติดต่อทาง LINE"], ["ไม่ต้องการรับข่าวสาร / โปรโมชัน"]], "mind");
  await profile(prasert, [["ชอบคำตอบสั้น กระชับ"]]);
  await profile(wilai, [["กังวลง่าย ควรยืนยันซ้ำ"], ["นัดช่วงเช้า"]], "prae");

  console.log("seed เรียบร้อย:", org.name);
  console.log("\nบัญชีสำหรับเข้าสู่ระบบ (เปลี่ยนรหัสผ่านหลังเข้าครั้งแรก):");
  console.table(logins);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
