import { NextResponse, type NextRequest } from "next/server";

// ด่านแรก: ไม่มี cookie เซสชัน → ส่งไปหน้าเข้าสู่ระบบ (หน้า) หรือตอบ 401 (API)
// การตรวจเซสชันจริงทำในฝั่งเซิร์ฟเวอร์ (src/lib/auth.ts) ทุกครั้งที่เรียก API
// webhook เปิดสาธารณะเพราะแพลตฟอร์มเรียกเข้ามา (ตรวจลายเซ็นในตัว route แทน)

const PUBLIC = ["/login", "/api/auth/login", "/api/auth/config", "/api/webhooks/", "/api/health"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p))) return NextResponse.next();
  if (req.cookies.get("rc_session")) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
