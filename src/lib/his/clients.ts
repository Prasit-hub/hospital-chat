import { z } from "zod";
import data from "./mock-data.json";
import { appointmentsOf, encountersOf, matchPatients } from "./mock-engine.mjs";
import {
  HisAppointmentSchema,
  HisEncounterSchema,
  HisMatchResultSchema,
  type HisClient,
  type HisContext,
  type HisMatchQuery,
} from "./types";

export class HisError extends Error {
  readonly expose = true;
  constructor(
    message: string,
    public status = 502,
    public code: "disabled" | "unavailable" | "bad_response" | "not_found" | "bad_request" | "rate_limited" | "not_allowed" = "unavailable",
  ) {
    super(message);
  }
}

/* ------------------------------------------------------------------ */
/* โหมด mock: ข้อมูลสมมติในตัวระบบ                                     */
/* ------------------------------------------------------------------ */

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const mockClient: HisClient = {
  async match(q: HisMatchQuery) {
    await wait(120);
    const r = matchPatients(data, q);
    if ("error" in r) throw new HisError(r.error, 400, "bad_request");
    return HisMatchResultSchema.parse(r);
  },
  async appointments(hn, from, to) {
    await wait(120);
    const r = appointmentsOf(data, hn, from, to);
    if (!r) throw new HisError("ไม่พบ HN นี้ใน HIS", 404, "not_found");
    return z.array(HisAppointmentSchema).parse(r);
  },
  async encounters(hn, limit) {
    await wait(120);
    const r = encountersOf(data, hn, limit);
    if (!r) throw new HisError("ไม่พบ HN นี้ใน HIS", 404, "not_found");
    return z.array(HisEncounterSchema).parse(r);
  },
  async health() {
    return { ok: true, detail: "ข้อมูลจำลอง (mock)" };
  },
};

/* ------------------------------------------------------------------ */
/* โหมด live: เรียก HIS Gateway ผ่าน HTTPS                            */
/* ------------------------------------------------------------------ */

export interface LiveConfig {
  orgId: string;
  baseUrl: string;
  authType: "none" | "bearer" | "oauth2";
  tokenUrl?: string;
  clientId?: string;
  secret?: string;
  timeoutMs: number;
}

// ตัดวงจร: พลาด 5 ครั้งใน 1 นาที → หยุดเรียก 30 วินาที (ต่อองค์กร)
const breaker = new Map<string, { fails: number[]; openUntil: number }>();
const BREAK_FAILS = 5;
const BREAK_WINDOW = 60_000;
const BREAK_OPEN = 30_000;

export function breakerState(orgId: string) {
  const b = breaker.get(orgId);
  return { open: !!b && b.openUntil > Date.now(), openUntil: b?.openUntil ?? 0 };
}
export function resetBreaker(orgId: string) {
  breaker.delete(orgId);
}
function recordFail(orgId: string) {
  const now = Date.now();
  const b = breaker.get(orgId) ?? { fails: [], openUntil: 0 };
  b.fails = [...b.fails.filter((t) => now - t < BREAK_WINDOW), now];
  if (b.fails.length >= BREAK_FAILS) {
    b.openUntil = now + BREAK_OPEN;
    b.fails = [];
  }
  breaker.set(orgId, b);
}
function recordOk(orgId: string) {
  const b = breaker.get(orgId);
  if (b) b.fails = [];
}

const tokens = new Map<string, { token: string; exp: number }>();

async function accessToken(c: LiveConfig): Promise<string | undefined> {
  if (c.authType === "none") return undefined;
  if (c.authType === "bearer") return c.secret;
  const key = `${c.orgId}:${c.tokenUrl}:${c.clientId}`;
  const hit = tokens.get(key);
  if (hit && hit.exp > Date.now()) return hit.token;
  if (!c.tokenUrl || !c.clientId || !c.secret) throw new HisError("ยังไม่ได้ตั้งค่า OAuth2 ของ HIS ให้ครบ", 502, "unavailable");
  const res = await fetch(c.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: c.clientId, client_secret: c.secret, scope: "patient.match appointment.read encounter.read" }),
    signal: AbortSignal.timeout(c.timeoutMs),
  }).catch(() => {
    throw new HisError("ขอ token จาก HIS ไม่สำเร็จ", 502, "unavailable");
  });
  if (!res.ok) throw new HisError(`ขอ token จาก HIS ไม่สำเร็จ (${res.status})`, 502, "unavailable");
  const j = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
  if (!j.access_token) throw new HisError("HIS ตอบ token ผิดรูปแบบ", 502, "bad_response");
  tokens.set(key, { token: j.access_token, exp: Date.now() + Math.max(30, (j.expires_in ?? 300) - 30) * 1000 });
  return j.access_token;
}

async function call<T>(c: LiveConfig, method: "GET" | "POST", path: string, schema: z.ZodType<T>, ctx?: HisContext, body?: unknown): Promise<T> {
  if (breakerState(c.orgId).open) throw new HisError("เชื่อม HIS ไม่ได้ชั่วคราว — ใช้ HN ที่กรอกเองได้ตามปกติ", 503, "unavailable");
  const url = c.baseUrl.replace(/\/+$/, "") + path;
  const attempts = method === "GET" ? 2 : 1; // ลองใหม่ 1 ครั้งเฉพาะคำขออ่าน
  let last: HisError | undefined;
  for (let i = 0; i < attempts; i++) {
    try {
      const token = await accessToken(c);
      const res = await fetch(url, {
        method,
        headers: {
          accept: "application/json",
          ...(body !== undefined && { "content-type": "application/json" }),
          ...(token && { authorization: `Bearer ${token}` }),
          ...(ctx && { "x-acting-user": ctx.actingUser }),
          ...(ctx?.purpose && { "x-purpose": ctx.purpose }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(c.timeoutMs),
        cache: "no-store",
      });
      if (res.status === 404) {
        recordOk(c.orgId);
        throw new HisError("ไม่พบ HN นี้ใน HIS", 404, "not_found");
      }
      if (res.status === 400) {
        recordOk(c.orgId);
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new HisError(j.error ?? "คำขอไม่ถูกต้อง", 400, "bad_request");
      }
      if (res.status === 401 || res.status === 403) {
        tokens.clear();
        throw new HisError(`HIS ปฏิเสธการเข้าถึง (${res.status}) — ตรวจสอบรหัสเชื่อมต่อ`, 502, "unavailable");
      }
      if (!res.ok) throw new HisError(`HIS ตอบกลับผิดพลาด (${res.status})`, 502, "unavailable");
      const parsed = schema.safeParse(await res.json().catch(() => undefined));
      if (!parsed.success) throw new HisError("HIS ตอบกลับผิดรูปแบบ — ไม่แสดงข้อมูลเพื่อความปลอดภัย", 502, "bad_response");
      recordOk(c.orgId);
      return parsed.data;
    } catch (e) {
      if (e instanceof HisError && (e.code === "not_found" || e.code === "bad_request")) throw e;
      last =
        e instanceof HisError
          ? e
          : new HisError((e as Error)?.name === "TimeoutError" ? `HIS ไม่ตอบภายใน ${c.timeoutMs / 1000} วินาที` : "เชื่อมต่อ HIS ไม่ได้", 502, "unavailable");
      if (last.code === "bad_response") break;
    }
  }
  recordFail(c.orgId);
  throw last!;
}

export function liveClient(c: LiveConfig): HisClient {
  const enc = encodeURIComponent;
  return {
    match: (q, ctx) => call(c, "POST", "/his/v1/patients/match", HisMatchResultSchema, ctx, q),
    appointments: async (hn, from, to, ctx) =>
      (
        await call(
          c,
          "GET",
          `/his/v1/patients/${enc(hn)}/appointments?from=${from}&to=${to}`,
          z.object({ appointments: z.array(HisAppointmentSchema).max(200) }),
          ctx,
        )
      ).appointments,
    encounters: async (hn, limit, ctx) =>
      (await call(c, "GET", `/his/v1/patients/${enc(hn)}/encounters?limit=${limit}`, z.object({ encounters: z.array(HisEncounterSchema).max(20) }), ctx)).encounters,
    health: async () => {
      try {
        const r = await call(c, "GET", "/his/v1/health", z.object({ status: z.string() }).passthrough());
        return { ok: r.status === "ok", detail: r.status === "ok" ? "เชื่อมต่อสำเร็จ" : `สถานะ: ${r.status}` };
      } catch (e) {
        return { ok: false, detail: (e as Error).message };
      }
    },
  };
}
