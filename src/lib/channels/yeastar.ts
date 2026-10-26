import { safeEqual } from "@/lib/crypto";
import { normPhone } from "@/lib/phone";
import type { ChannelAdapter, IncomingEvent } from "./types";
import { SendError } from "./types";

// Yeastar PBX — ช่องทางโทรศัพท์ (inbound เท่านั้นในระยะแรก)
// Yeastar ยิง webhook เข้ามา 2 เหตุการณ์ต่อสาย แยกด้วยฟิลด์ "event":
//   1) answered — เจ้าหน้าที่เริ่มรับสาย (ยังไม่รู้ duration/สถานะจบ)
//   2) ended    — สายสิ้นสุด (มี duration_sec, status, recording_url ครบ)
// ดูสัญญา payload เต็มใน design doc "ออกแบบช่องทางโทรศัพท์ Yeastar"

export interface YeastarCreds {
  /** token สุ่มต่อ channel ตรวจผ่าน query param ?token= หรือ header Authorization: Bearer */
  token: string;
}

interface YeastarCallBody {
  event: "answered" | "ended";
  call_id: string;
  caller_number: string;
  callee_number?: string;
  direction?: "inbound" | "outbound";
  start_time?: string;
  end_time?: string;
  duration_sec?: number;
  status?: "answered" | "missed" | "busy" | "no_answer";
  recording_url?: string;
}

function fmtDuration(sec?: number) {
  if (sec == null) return "";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")} นาที`;
}

const STATUS_TH: Record<string, string> = {
  answered: "รับสาย",
  missed: "ไม่รับสาย",
  busy: "สายไม่ว่าง",
  no_answer: "ไม่มีผู้รับ",
};

/** Yeastar ไม่มี HMAC signature แบบ LINE/Meta — ยืนยันด้วย token สุ่มต่อ channel ที่ตั้งไว้ตอนสร้างช่องทาง */
export function verifyYeastarToken(provided: string | null, creds: YeastarCreds): boolean {
  if (!provided) return false;
  return safeEqual(provided, creds.token);
}

export const yeastarAdapter: ChannelAdapter<YeastarCreds> = {
  type: "phone",
  // ไม่ใช้ (route ตรวจ token เองเพราะ token มาจาก query param ได้ ซึ่ง verifySignature ของ interface เดิมเห็นแค่ header)
  verifySignature: (_rawBody, headers, creds) => verifyYeastarToken(headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null, creds),
  parse: (body) => {
    const b = body as YeastarCallBody;
    if (!b?.call_id || !b?.caller_number || (b.event !== "answered" && b.event !== "ended")) return [];
    const phone = normPhone(b.caller_number);
    if (!phone) return [];

    const text =
      b.event === "answered"
        ? `เริ่มสนทนาทางโทรศัพท์ (เบอร์เข้า ${b.caller_number}${b.callee_number ? ` → เบอร์ต่อ ${b.callee_number}` : ""})`
        : `สิ้นสุดสาย — ${STATUS_TH[b.status ?? "answered"] ?? b.status}${b.duration_sec != null ? ` (${fmtDuration(b.duration_sec)})` : ""}`;

    const ev: IncomingEvent = {
      channelExternalId: "", // ไม่ใช้ — Yeastar แยก channel ด้วย channelId ใน path ของ webhook ไม่ใช่ channelExternalId
      userExternalId: phone,
      messageExternalId: `yeastar:${b.call_id}:${b.event}`,
      kind: "call",
      text,
      mediaUrl: b.event === "ended" ? b.recording_url : undefined,
      timestamp: b.event === "ended" && b.end_time ? Date.parse(b.end_time) : b.start_time ? Date.parse(b.start_time) : Date.now(),
      source: "dm",
    };
    return [ev];
  },
  send: async () => {
    throw new SendError("yeastar outbound not supported", "ช่องทางโทรศัพท์ยังไม่รองรับการส่งข้อความออก", 501);
  },
  getProfile: async () => null,
};
