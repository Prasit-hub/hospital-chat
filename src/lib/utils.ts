import type { AppointmentStatus, CaseOutcome, CaseStatus, ChannelType, InquiryCategory, ProfileTagCategory } from "./types";
import { toLocalIso } from "./time";

export function cn(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export const channelMeta: Record<ChannelType, { label: string; short: string; color: string; bg: string }> = {
  line: { label: "LINE", short: "LINE", color: "#06c755", bg: "#0f2a1e" },
  facebook: { label: "Messenger", short: "FB", color: "#1877f2", bg: "#10203d" },
  instagram: { label: "Instagram", short: "IG", color: "#d62976", bg: "#2d1424" },
  tiktok: { label: "TikTok", short: "TT", color: "#fe2c55", bg: "#2a1720" },
  email: { label: "อีเมล", short: "@", color: "#ea580c", bg: "#2d1d12" },
};

/** เวลาปัจจุบันตาม APP_TZ ในรูปแบบ "YYYY-MM-DDTHH:mm:ss" */
export function nowLocal() {
  return toLocalIso(new Date());
}

function yesterdayOf(ymd: string) {
  const d = new Date(ymd + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

const TH_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

export function hhmm(iso: string) {
  return iso.slice(11, 16);
}

export function shortTime(iso: string) {
  const day = iso.slice(0, 10);
  const today = nowLocal().slice(0, 10);
  if (day === today) return hhmm(iso);
  if (day === yesterdayOf(today)) return "เมื่อวาน";
  return thaiDate(day);
}

export function thaiDate(ymd: string) {
  const [, mo, d] = ymd.split("-").map(Number);
  return `${d} ${TH_MONTHS[mo - 1]}`;
}

export function dayLabel(iso: string) {
  const day = iso.slice(0, 10);
  const today = nowLocal().slice(0, 10);
  if (day === today) return "วันนี้";
  if (day === yesterdayOf(today)) return "เมื่อวาน";
  return thaiDate(day);
}

export const appointmentStatusMeta: Record<AppointmentStatus, { label: string; cls: string }> = {
  requested: { label: "รอยืนยันนัด", cls: "bg-warm/15 text-warm" },
  confirmed: { label: "ยืนยันนัดแล้ว", cls: "bg-brand-soft text-brand" },
  completed: { label: "มาตามนัดแล้ว", cls: "bg-ok/15 text-ok" },
  cancelled: { label: "ยกเลิก", cls: "bg-hot/15 text-hot" },
};

export const caseStatusMeta: Record<CaseStatus, { label: string; short: string; cls: string }> = {
  queued: { label: "รอรับ", short: "รอรับ", cls: "bg-brand-soft text-brand" },
  in_progress: { label: "กำลังดำเนินการ", short: "กำลังทำ", cls: "bg-raised text-muted" },
  waiting_patient: { label: "รอคนไข้ตอบ", short: "รอคนไข้", cls: "bg-raised text-muted" },
  transfer_pending: { label: "รอแผนกรับ", short: "รอแผนกรับ", cls: "bg-warm/15 text-warm" },
  closed: { label: "ปิดงานแล้ว", short: "ปิดแล้ว", cls: "bg-ok/15 text-ok" },
};

export const outcomeMeta: Record<CaseOutcome, { label: string; needsNote?: boolean }> = {
  answered: { label: "ตอบคำถามแล้ว" },
  appointed: { label: "นัดหมายแล้ว" },
  advised_visit: { label: "แนะนำมาโรงพยาบาล / ห้องฉุกเฉิน", needsNote: true },
  referred_external: { label: "ส่งต่อหน่วยงานภายนอก", needsNote: true },
  no_response: { label: "คนไข้ไม่ตอบกลับ" },
  spam: { label: "ซ้ำ / ไม่ใช่เรื่องของโรงพยาบาล" },
  merged: { label: "รวมกับงานอื่น (รวมแฟ้ม)" },
  other: { label: "อื่นๆ", needsNote: true },
};

export const profileCategoryMeta: Record<ProfileTagCategory, { label: string; short: string; tone: string }> = {
  need: { label: "ความต้องการพิเศษ", short: "ต้องการ", tone: "bg-hot/12 text-hot ring-hot/30" },
  communication: { label: "ลักษณะการสื่อสาร", short: "สื่อสาร", tone: "bg-brand-soft text-brand ring-brand/30" },
  like: { label: "สิ่งที่ชอบ", short: "ชอบ", tone: "bg-ok/12 text-ok ring-ok/30" },
  dislike: { label: "สิ่งที่ไม่ชอบ", short: "ไม่ชอบ", tone: "bg-warm/15 text-warm ring-warm/30" },
};

export const slotLabel = { morning: "ช่วงเช้า", afternoon: "ช่วงบ่าย", any: "ไม่ระบุช่วง" } as const;

export const categoryMeta: Record<InquiryCategory, { label: string; color: string }> = {
  appointment: { label: "นัดหมาย", color: "#0ea5e9" },
  rights: { label: "สิทธิการรักษา / ประกัน", color: "#8b5cf6" },
  cost: { label: "ค่าใช้จ่าย", color: "#f59e0b" },
  results: { label: "ผลตรวจ / เอกสาร", color: "#14b8a6" },
  symptom: { label: "สอบถามอาการ", color: "#ef4444" },
  other: { label: "อื่นๆ", color: "#64748b" },
};

/** วิธียืนยันตัวตนที่ใช้บ่อย (แก้ไขได้ตามนโยบายโรงพยาบาล) */
export const VERIFY_METHODS = ["HN + วันเกิด", "เลขบัตรประชาชน 4 ตัวท้าย + วันเกิด", "เบอร์โทรที่ลงทะเบียน + วันเกิด", "โทรกลับเบอร์ที่ลงทะเบียน"];

const TH_MONTHS_FULL = TH_MONTHS;
/** "1990-04-12" → "12 เม.ย. 2533 (36 ปี)" */
export function birthLabel(ymd?: string) {
  if (!ymd) return undefined;
  const [y, mo, d] = ymd.split("-").map(Number);
  const now = new Date();
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < mo || (now.getMonth() + 1 === mo && now.getDate() < d)) age--;
  return `${d} ${TH_MONTHS_FULL[mo - 1]} ${y + 543} (${age} ปี)`;
}

/** ปิดบังเบอร์โทรบางส่วน เช่น 081-xxx-5678 */
export function maskPhone(v?: string) {
  if (!v) return v;
  const d = v.replace(/\D/g, "");
  if (d.length < 7) return v;
  return `${d.slice(0, 3)}-xxx-${d.slice(-4)}`;
}

export function initials(name: string) {
  const clean = name.replace(/^(คุณ)/, "").replace(/[@_.]/g, " ").trim();
  return clean.slice(0, 1).toUpperCase();
}
