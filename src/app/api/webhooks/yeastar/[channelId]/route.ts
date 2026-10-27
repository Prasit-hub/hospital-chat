import { after } from "next/server";
import { prisma } from "@/lib/db";
import { credsOf } from "@/lib/channels";
import { yeastarAdapter, verifyYeastarToken, type YeastarCreds } from "@/lib/channels/yeastar";
import { ingest } from "@/lib/inbox/service";
import { maskPhone } from "@/lib/utils";

export const runtime = "nodejs";

const NUMERIC_FIELDS = new Set(["duration_sec"]);

/** แปลง query string (?event=answered&call_id=...) ให้เป็น object เดียวกับที่ yeastarAdapter.parse คาดหวัง */
function bodyFromQuery(url: URL): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of url.searchParams) {
    if (key === "token") continue; // token ไม่ใช่ฟิลด์ของเหตุการณ์
    out[key] = NUMERIC_FIELDS.has(key) ? Number(value) : value;
  }
  return out;
}

// เปิดได้เฉพาะบน dev/preview เท่านั้น (ตั้งค่า env YEASTAR_WEBHOOK_TEST_BYPASS=true บน Render) — ห้ามตั้งบน Azure production เด็ดขาด
// เมื่อเปิด: ฝั่งที่ส่งค่าทาง query string ไม่ต้องรู้ channelId/token จริง ระบบจะหาช่องทางโทรศัพท์ตัวแรกที่มีอยู่มาใช้แทน
// และข้ามการตรวจ token ให้ — ไว้ใช้ทดสอบว่า "ยิงเข้ามาได้จริงไหม" แบบเร็วๆ เท่านั้น
const TEST_BYPASS = process.env.YEASTAR_WEBHOOK_TEST_BYPASS === "true";

// Webhook URL ที่ต้องใส่ในระบบ Yeastar PBX (รองรับ 2 แบบ):
//   1) JSON body:    POST https://<โดเมนของคุณ>/api/webhooks/yeastar/<channelId>?token=<token>   (Content-Type: application/json)
//   2) Query string: POST หรือ GET https://<โดเมนของคุณ>/api/webhooks/yeastar/<channelId>?token=<token>&event=answered&call_id=...&caller_number=...&callee_number=...&direction=inbound&start_time=...
// หรือส่ง token มาทาง header: Authorization: Bearer <token>
async function handleWebhook(req: Request, { params }: { params: Promise<{ channelId: string }> }) {
  const startedAt = Date.now();
  const { channelId } = await params;
  const url = new URL(req.url);
  const hasQueryFields = [...url.searchParams.keys()].some((k) => k !== "token");
  const reqId = Math.random().toString(36).slice(2, 8);

  // log ทุกครั้งที่มีการเรียกเข้ามา — ไม่มีข้อมูลผู้ป่วยในบรรทัดนี้ (เบอร์จะมากับ event ด้านล่าง ถ้ามี จะปิดบังก่อน log)
  console.log(`[yeastar webhook] [${reqId}] รับคำขอ ${req.method} channelId="${channelId}" mode=${hasQueryFields ? "query-string" : "json-body"}`);

  const log = (msg: string) => console.log(`[yeastar webhook] [${reqId}] ${msg} (+${Date.now() - startedAt}ms)`);
  const logWarn = (msg: string) => console.warn(`[yeastar webhook] [${reqId}] ${msg} (+${Date.now() - startedAt}ms)`);

  let channel = await prisma.channel.findUnique({ where: { id: channelId } });
  if ((!channel || channel.type !== "phone") && TEST_BYPASS && hasQueryFields) {
    channel = await prisma.channel.findFirst({ where: { type: "phone" }, orderBy: { createdAt: "asc" } });
    if (channel) {
      logWarn(
        `TEST BYPASS: ignoring channelId "${channelId}" ใน URL — ใช้ช่องทาง "${channel.name}" (${channel.id}) แทน เพราะตั้ง YEASTAR_WEBHOOK_TEST_BYPASS=true — ปิด env นี้เมื่อทดสอบเสร็จ`,
      );
    }
  }
  if (!channel || channel.type !== "phone") {
    logWarn(`ปฏิเสธ 404: ไม่พบช่องทาง phone ที่ id="${channelId}"`);
    return new Response("unknown channel", { status: 404 });
  }

  const creds = credsOf<YeastarCreds>(channel);
  const tokenFromQuery = url.searchParams.get("token");
  const tokenFromHeader = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  const tokenOk = verifyYeastarToken(tokenFromQuery ?? tokenFromHeader, creds);
  if (!tokenOk) {
    if (TEST_BYPASS && hasQueryFields) {
      logWarn(`TEST BYPASS: ข้าม token check (ช่องทาง "${channel.name}") เพราะตั้ง YEASTAR_WEBHOOK_TEST_BYPASS=true — ปิด env นี้เมื่อทดสอบเสร็จ`);
    } else {
      logWarn(`ปฏิเสธ 401: token ไม่ถูกต้อง (ช่องทาง "${channel.name}")`);
      return new Response("invalid token", { status: 401 });
    }
  }

  // รับได้ทั้ง JSON body (เดิม) และ query string (เมื่อ Yeastar ส่งค่าทาง URL ล้วนๆ ไม่มี body)
  let body: unknown;
  if (hasQueryFields) {
    body = bodyFromQuery(url);
  } else {
    const raw = req.method === "GET" ? "" : await req.text();
    if (!raw.trim()) {
      logWarn(`ปฏิเสธ 400: ไม่มีทั้ง query string และ body`);
      return new Response("missing event data (query string or JSON body)", { status: 400 });
    }
    try {
      body = JSON.parse(raw);
    } catch {
      logWarn(`ปฏิเสธ 400: body ไม่ใช่ JSON ที่ถูกต้อง`);
      return new Response("invalid json", { status: 400 });
    }
  }

  const events = yeastarAdapter.parse(body);
  const b = body as { event?: string; call_id?: string };
  log(`parse แล้ว: event="${b.event ?? "-"}" call_id="${b.call_id ?? "-"}" → ${events.length} เหตุการณ์ (ช่องทาง "${channel.name}")`);
  if (!channel.connected || events.length === 0) {
    logWarn(`ตอบ matched=none: ${!channel.connected ? "ช่องทางถูกปิดใช้งาน" : "parse ไม่ได้เหตุการณ์ (ฟิลด์ไม่ครบ หรือ event ไม่รู้จัก)"}`);
    return Response.json({ ok: true, matched: "none" });
  }

  // ตอบกลับทันทีพร้อมผลจับคู่ (เพื่อใช้ทำ screen-pop ฝั่ง Yeastar ได้ในอนาคต) แล้วค่อยประมวลผลต่อเบื้องหลัง
  const phone = events[0].userExternalId;
  const existing = await prisma.patient.findMany({ where: { orgId: channel.orgId, phone }, select: { id: true }, take: 2 });
  const matched = existing.length > 1 ? "ambiguous" : existing.length === 1 ? "single" : "none";

  const conversation = await prisma.contact
    .findUnique({ where: { channelId_externalId: { channelId: channel.id, externalId: phone } }, select: { id: true } })
    .then((c) =>
      c ? prisma.conversation.findFirst({ where: { contactId: c.id, channelId: channel.id, source: "dm" }, select: { id: true } }) : null,
    );

  log(`ตอบ 200 ล่วงหน้า: เบอร์ ${maskPhone(phone)} matched=${matched} conversationId=${conversation?.id ?? "(ยังไม่มี)"} — กำลังบันทึกข้อความเบื้องหลัง`);

  after(async () => {
    for (const ev of events) {
      try {
        await ingest(channel, ev);
        log(`บันทึกสำเร็จ: externalId="${ev.messageExternalId}"`);
      } catch (e) {
        console.error(`[yeastar webhook] [${reqId}] บันทึกล้มเหลว externalId="${ev.messageExternalId}" ingest failed`, e);
      }
    }
  });

  return Response.json({ ok: true, conversationId: conversation?.id, matched });
}

export async function POST(req: Request, ctx: { params: Promise<{ channelId: string }> }) {
  return handleWebhook(req, ctx);
}

// บาง PBX/HTTP trigger ส่งค่าทาง query string ด้วย GET ล้วนๆ (ไม่มี body) — รองรับไว้ด้วย
export async function GET(req: Request, ctx: { params: Promise<{ channelId: string }> }) {
  return handleWebhook(req, ctx);
}
