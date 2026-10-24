"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { ThemeQuickToggle } from "@/components/ThemeToggle";

function LoginForm() {
  const next = useSearchParams().get("next");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"local" | "mock" | "ldap">("local");
  useEffect(() => {
    fetch("/api/auth/config")
      .then((r) => r.json())
      .then((d) => d?.mode && setMode(d.mode))
      .catch(() => {});
  }, []);
  const ad = mode !== "local";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    }).catch(() => null);
    if (r?.ok) {
      // ป้องกัน open redirect: รับเฉพาะ path ภายใน
      window.location.href = next && next.startsWith("/") && !next.startsWith("//") ? next : "/inbox";
      return;
    }
    setBusy(false);
    setError(r ? ((await r.json().catch(() => ({}))).error ?? "เข้าสู่ระบบไม่สำเร็จ") : "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้");
  }

  const input =
    "mt-1.5 w-full rounded-xl border border-line bg-sunken px-3.5 py-2.5 text-sm outline-none transition-[border-color,box-shadow] placeholder:text-faint focus:border-brand/70 focus:shadow-[0_0_0_3px_rgb(var(--brand-rgb)/0.12)]";
  return (
    <form onSubmit={submit} className="w-full max-w-sm">
      <div className="mb-8 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-[14px] bg-brand font-display text-xl font-bold text-brand-ink shadow-[0_0_24px_rgb(var(--brand-rgb)/0.45)]">ร</div>
        <div>
          <h1 className="font-display text-xl font-semibold leading-tight">รวมแชท</h1>
          <p className="text-xs text-muted">{ad ? "ใช้บัญชีเดียวกับที่เข้าคอมพิวเตอร์ของโรงพยาบาล" : "เข้าสู่ระบบสำหรับเจ้าหน้าที่"}</p>
        </div>
      </div>
      <label className="block text-sm text-muted">
        {ad ? "ชื่อผู้ใช้ AD" : "อีเมลหรือชื่อผู้ใช้"}
        <input type="text" placeholder={ad ? "เช่น somchai.k" : undefined} autoCapitalize="none" spellCheck={false} autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className={input} />
      </label>
      <label className="mt-4 block text-sm text-muted">
        รหัสผ่าน
        <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className={input} />
      </label>
      {error && <p className="mt-3 rounded-xl border border-hot/30 bg-hot/10 px-3 py-2 text-sm text-hot">{error}</p>}
      <button disabled={busy} className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-brand py-2.5 text-sm font-semibold text-brand-ink hover:bg-brand-dark disabled:opacity-60">
        {busy && <Loader2 size={16} className="animate-spin" />} เข้าสู่ระบบ
      </button>
      <p className="mt-4 text-center text-xs text-faint">{ad ? "ลืมรหัสผ่านหรือบัญชีถูกล็อก? ติดต่อฝ่าย IT ของโรงพยาบาล" : "ลืมรหัสผ่าน? ติดต่อเจ้าของบัญชีให้ออกรหัสใหม่"}</p>
      {mode === "mock" && (
        <p className="mt-3 rounded-xl border border-warm/40 bg-warm/10 px-3 py-2 text-center text-xs text-warm">โหมดทดลอง: ใช้บัญชี AD จำลอง ไม่ใช่ AD จริงของโรงพยาบาล</p>
      )}
    </form>
  );
}

/** ภาพประกอบ: เส้นสัญญาณจากทุกช่องทางวิ่งเข้าหาศูนย์กลางเดียว */
function SignalArt() {
  const lines = [
    { c: "#06C755", y: 70, label: "LINE" },
    { c: "#1877f2", y: 170, label: "Messenger" },
    { c: "#d62976", y: 270, label: "Instagram" },
    { c: "#ea580c", y: 370, label: "อีเมล" },
  ];
  return (
    <svg viewBox="0 0 480 440" className="h-auto w-full max-w-[460px]" aria-hidden>
      {lines.map((l, i) => (
        <g key={l.label}>
          <path d={`M 20 ${l.y} C 220 ${l.y}, 240 220, 380 220`} fill="none" stroke={l.c} strokeOpacity="0.25" strokeWidth="2" />
          <path
            d={`M 20 ${l.y} C 220 ${l.y}, 240 220, 380 220`}
            fill="none"
            stroke={l.c}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray="28 600"
            className="signal-dash"
            style={{ animationDelay: `${i * 0.6}s` }}
          />
          <rect x="20" y={l.y - 15} width="96" height="30" rx="9" style={{ fill: "var(--color-panel)" }} stroke={l.c} strokeOpacity="0.5" />
          <circle cx="36" cy={l.y} r="4" fill={l.c} />
          <text x="48" y={l.y + 4.5} style={{ fill: "var(--color-ink)" }} fontSize="13" fontFamily="Anuphan, sans-serif">{l.label}</text>
        </g>
      ))}
      <circle cx="400" cy="220" r="44" style={{ fill: "rgb(var(--brand-rgb) / 0.08)", stroke: "rgb(var(--brand-rgb) / 0.35)" }} />
      <circle cx="400" cy="220" r="30" style={{ fill: "var(--color-brand)" }} />
      <text x="400" y="230" textAnchor="middle" style={{ fill: "var(--color-brand-ink)" }} fontSize="28" fontWeight="700" fontFamily="'Bai Jamjuree', sans-serif">ร</text>
    </svg>
  );
}

export default function LoginPage() {
  return (
    <div className="grid min-h-screen bg-canvas lg:grid-cols-[1.1fr_1fr]">
      <div className="chat-bg relative hidden flex-col justify-center gap-8 border-r border-line bg-sunken px-14 lg:flex">
        <SignalArt />
        <div className="max-w-md">
          <h2 className="font-display text-[30px] font-semibold leading-tight">คนไข้หนึ่งคน แฟ้มเดียว ทุกช่องทาง</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">ไม่ว่าคนไข้จะทักมาทาง LINE, Messenger, Instagram หรืออีเมล เจ้าหน้าที่เห็นประวัติทั้งหมดในแฟ้มเดียว พร้อมแจ้งเตือนเรื่องเร่งด่วน</p>
        </div>
      </div>
      <div className="relative flex items-center justify-center p-6">
        <ThemeQuickToggle className="absolute right-4 top-4" />
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
