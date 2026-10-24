import { prisma } from "@/lib/db";
import { decryptJson } from "@/lib/crypto";
import { bkkDay } from "./mock-engine.mjs";
import { HisError, liveClient, mockClient } from "./clients";
import { DEFAULT_HIS, type HisAppointment, type HisClient, type HisEncounter, type HisSettings } from "./types";

export { HisError } from "./clients";
export * from "./types";

/** ค่าตั้งค่า HIS ขององค์กร (ไม่มีค่า = manual) */
export async function hisSettings(orgId: string): Promise<HisSettings> {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
  const s = (org.settings as { his?: Partial<HisSettings> })?.his;
  return { ...DEFAULT_HIS, ...(s ?? {}) };
}

export function clientFor(orgId: string, s: HisSettings): HisClient {
  if (s.mode === "mock") return mockClient;
  if (s.mode === "live") {
    if (!s.baseUrl) throw new HisError("ยังไม่ได้ตั้งค่าที่อยู่ HIS Gateway", 409, "disabled");
    let secret: string | undefined;
    if (s.secretEnc) secret = decryptJson<{ secret: string }>(s.secretEnc).secret;
    return liveClient({
      orgId,
      baseUrl: s.baseUrl,
      authType: s.authType ?? "oauth2",
      tokenUrl: s.tokenUrl,
      clientId: s.clientId,
      secret,
      timeoutMs: Math.min(15_000, Math.max(500, s.timeoutMs ?? 3000)),
    });
  }
  throw new HisError("ยังไม่ได้เชื่อมต่อ HIS (โหมดกรอก HN เอง)", 409, "disabled");
}

/** ตัวเชื่อม HIS ขององค์กร — โยน HisError(disabled) เมื่ออยู่ในโหมด manual */
export async function his(orgId: string) {
  const s = await hisSettings(orgId);
  return { settings: s, client: clientFor(orgId, s) };
}

/* ---------- จำกัดการค้น: 20 ครั้ง/นาที ต่อเจ้าหน้าที่ (กันการกวาดข้อมูล) ---------- */
const hits = new Map<string, number[]>();
export const HIS_RATE_PER_MIN = Math.max(1, Number(process.env.HIS_RATE_PER_MIN) || 20);
export function hisRateLimit(userId: string) {
  const now = Date.now();
  const list = (hits.get(userId) ?? []).filter((t) => now - t < 60_000);
  if (list.length >= HIS_RATE_PER_MIN) throw new HisError("ค้นข้อมูล HIS บ่อยเกินไป รอสักครู่แล้วลองใหม่", 429, "rate_limited");
  list.push(now);
  hits.set(userId, list);
}

/* ---------- หน่วยความจำชั่วคราว 10 นาที (ไม่ลงฐานข้อมูล ไม่ลง log) ---------- */
const TTL = 10 * 60_000;
type Summary = { appointments: HisAppointment[]; encounters: HisEncounter[]; checkedAt: string };
const cache = new Map<string, { at: number; data: Summary }>();

export function clearHisCache(orgId?: string) {
  if (!orgId) return cache.clear();
  for (const k of cache.keys()) if (k.startsWith(orgId + ":")) cache.delete(k);
}

export function hisCached(orgId: string, hn: string) {
  const hit = cache.get(`${orgId}:${hn}`);
  return !!hit && Date.now() - hit.at < TTL;
}

/** นัด (ย้อนหลัง 30 วัน ถึง 90 วันข้างหน้า) + การมาโรงพยาบาล 3 ครั้งล่าสุด */
export async function hisSummary(orgId: string, hn: string, ctx: { actingUser: string; purpose?: string }, refresh = false): Promise<Summary & { cached: boolean }> {
  const key = `${orgId}:${hn}`;
  const hit = cache.get(key);
  if (!refresh && hit && Date.now() - hit.at < TTL) return { ...hit.data, cached: true };
  const { client } = await his(orgId);
  const [appointments, encounters] = await Promise.all([client.appointments(hn, bkkDay(-30), bkkDay(90), ctx), client.encounters(hn, 3, ctx)]);
  const data = { appointments, encounters, checkedAt: new Date().toISOString() };
  cache.set(key, { at: Date.now(), data });
  if (cache.size > 2000) cache.delete(cache.keys().next().value!);
  return { ...data, cached: false };
}
