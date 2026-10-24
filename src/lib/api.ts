import { NextResponse } from "next/server";
import { ZodError, type ZodType, type ZodTypeDef } from "zod";
import { AuthError } from "@/lib/auth";

export function json(data: unknown, init?: number | ResponseInit) {
  return NextResponse.json(data, typeof init === "number" ? { status: init } : init);
}

export function apiError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function parseBody<T>(req: Request, schema: ZodType<T, ZodTypeDef, unknown>): Promise<T> {
  const body = await req.json().catch(() => ({}));
  return schema.parse(body);
}

/** ห่อ handler ให้คืน error เป็น JSON เสมอ */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof AuthError) return apiError(e.message, e.status);
      // error ที่ตั้งใจให้ผู้ใช้เห็น (เช่น HisError): ส่งข้อความ + รหัส
      if (e instanceof Error && (e as Error & { expose?: boolean }).expose) {
        const x = e as Error & { status?: number; code?: string };
        return NextResponse.json({ error: x.message, code: x.code }, { status: x.status ?? 400 });
      }
      if (e instanceof ZodError) return apiError("ข้อมูลไม่ถูกต้อง: " + e.issues.map((i) => i.path.join(".") + " " + i.message).join(", "), 400);
      if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "P2025") return apiError("ไม่พบข้อมูล", 404);
      console.error(e);
      return apiError("เกิดข้อผิดพลาดภายในระบบ", 500);
    }
  };
}
