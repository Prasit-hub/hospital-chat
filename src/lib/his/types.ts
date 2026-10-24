// สัญญา API ระหว่างรวมแชทกับ HIS Gateway ของโรงพยาบาล (อ่านอย่างเดียว)
// ชื่อฟิลด์ตั้งให้ตรงกับ HL7 FHIR R4: Patient / Appointment / Encounter เพื่อให้ Gateway แปลงได้ตรงๆ
// ไม่มีข้อมูลทางคลินิก: ไม่มีการวินิจฉัย ยา ผลตรวจ หรือเหตุผลการนัดทางการแพทย์

import { z } from "zod";

/** manual = ไม่เชื่อม (กรอก HN เอง) · mock = ข้อมูลจำลองในตัวระบบ · live = เชื่อม HIS Gateway จริง */
export type HisMode = "manual" | "mock" | "live";
export const HIS_MODES: HisMode[] = ["manual", "mock", "live"];

export const HisPatientSchema = z.object({
  hn: z.string(),
  name: z.string(),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sex: z.enum(["M", "F", "U"]).nullish(),
  phoneLast4: z.string().nullish(),
  status: z.enum(["active", "deceased", "merged"]),
  mergedToHn: z.string().nullish(),
});
export type HisPatient = z.infer<typeof HisPatientSchema>;

export const HisMatchResultSchema = z.object({
  /** match = พบ 1 ราย · multiple = พบรายที่ใกล้เคียง ต้องถามข้อมูลเพิ่ม (ชื่อถูกปิดบางส่วน) · not_found */
  result: z.enum(["match", "multiple", "not_found"]),
  patients: z.array(HisPatientSchema).max(5),
  checkedAt: z.string(),
});
export type HisMatchResult = z.infer<typeof HisMatchResultSchema>;

export const HisAppointmentSchema = z.object({
  id: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().nullish(),
  clinicCode: z.string().nullish(),
  clinicName: z.string(),
  doctorName: z.string().nullish(),
  status: z.enum(["booked", "arrived", "completed", "cancelled", "no_show"]),
  /** คำแนะนำการเตรียมตัวที่อยู่ในใบนัดแล้ว (ไม่ใช่ข้อมูลทางคลินิก) */
  instructions: z.string().nullish(),
  /** เลขคำขอนัดจากรวมแชท (APT-xxxxx) ถ้า HIS เก็บไว้ */
  sourceRef: z.string().nullish(),
});
export type HisAppointment = z.infer<typeof HisAppointmentSchema>;

export const HisEncounterSchema = z.object({
  id: z.string(),
  type: z.enum(["OPD", "IPD", "ER"]),
  startAt: z.string(),
  endAt: z.string().nullish(),
  clinicName: z.string(),
  ward: z.string().nullish(),
  status: z.enum(["in_progress", "admitted", "finished"]),
});
export type HisEncounter = z.infer<typeof HisEncounterSchema>;

export interface HisMatchQuery {
  hn?: string;
  nationalId?: string;
  birthDate: string;
  name?: string;
  phone?: string;
}

/** ส่งไปกับทุกคำขอ ให้ HIS บันทึกฝั่งตัวเองได้ว่าใครค้น เพื่องานไหน */
export interface HisContext {
  actingUser: string;
  purpose?: string;
}

export interface HisClient {
  match(q: HisMatchQuery, ctx: HisContext): Promise<HisMatchResult>;
  appointments(hn: string, from: string, to: string, ctx: HisContext): Promise<HisAppointment[]>;
  encounters(hn: string, limit: number, ctx: HisContext): Promise<HisEncounter[]>;
  health(): Promise<{ ok: boolean; detail?: string }>;
}

/** ค่าตั้งค่าที่เก็บใน Organization.settings.his (secret เข้ารหัสแล้ว) */
export interface HisSettings {
  mode: HisMode;
  baseUrl?: string;
  authType?: "none" | "bearer" | "oauth2";
  tokenUrl?: string;
  clientId?: string;
  /** encryptJson({ secret }) */
  secretEnc?: string;
  timeoutMs?: number;
  /** ให้ค้นด้วยเลขบัตรประชาชนได้ (ต้องให้ DPO อนุมัติก่อน) */
  allowNationalId?: boolean;
}

/** วิธียืนยันตัวตนที่บันทึกเมื่อ HN + วันเกิดตรงกับ HIS */
export const HIS_VERIFY_METHOD = "HN + วันเกิด (ตรงกับ HIS)";

export const DEFAULT_HIS: HisSettings = { mode: "manual", authType: "oauth2", timeoutMs: 3000, allowNationalId: false };

/** ค่าที่ส่งให้หน้าจอได้ (ไม่มี secret) */
export function publicHis(s: HisSettings) {
  return {
    mode: s.mode,
    baseUrl: s.baseUrl ?? "",
    authType: s.authType ?? "oauth2",
    tokenUrl: s.tokenUrl ?? "",
    clientId: s.clientId ?? "",
    hasSecret: !!s.secretEnc,
    timeoutMs: s.timeoutMs ?? 3000,
    allowNationalId: !!s.allowNationalId,
  };
}
