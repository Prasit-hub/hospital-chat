"use client";

import { useCallback, useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

// ธีมของหน้าจอ: สว่าง (ค่าเริ่มต้นสำหรับโรงพยาบาล) / มืด / ตามระบบ — เก็บในเบราว์เซอร์ของแต่ละคน

export type ThemeMode = "dark" | "light" | "system";
const KEY = "rc-theme";

function resolve(mode: ThemeMode): "dark" | "light" {
  if (mode !== "system") return mode;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function readMode(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY);
    return v === "dark" || v === "system" ? v : "light";
  } catch {
    return "light";
  }
}

export function useTheme() {
  const [mode, setModeState] = useState<ThemeMode>("light");
  const [resolved, setResolved] = useState<"dark" | "light">("light");

  useEffect(() => {
    const m = readMode();
    setModeState(m);
    setResolved(resolve(m));
    // ซิงก์ระหว่างแท็บ / ตัวสลับหลายจุดในหน้าเดียวกัน
    const onChange = () => {
      const n = readMode();
      setModeState(n);
      setResolved(resolve(n));
    };
    window.addEventListener("rc-theme", onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("rc-theme", onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  // โหมด "ตามระบบ": เปลี่ยนตามเครื่องทันที
  useEffect(() => {
    if (mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const on = () => {
      const r = mq.matches ? "light" : "dark";
      document.documentElement.dataset.theme = r;
      setResolved(r);
    };
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [mode]);

  const setMode = useCallback((m: ThemeMode) => {
    try {
      localStorage.setItem(KEY, m);
    } catch {
      /* โหมดส่วนตัวบางเบราว์เซอร์เก็บค่าไม่ได้ ใช้ได้เฉพาะหน้านี้ */
    }
    document.documentElement.dataset.theme = resolve(m);
    setModeState(m);
    setResolved(resolve(m));
    window.dispatchEvent(new Event("rc-theme"));
  }, []);

  return { mode, resolved, setMode };
}

/** ปุ่มสลับมืด/สว่างแบบกดครั้งเดียว (แถบด้านบน / หน้าเข้าสู่ระบบ) */
export function ThemeQuickToggle({ className }: { className?: string }) {
  const { resolved, setMode } = useTheme();
  const next = resolved === "dark" ? "light" : "dark";
  return (
    <button
      onClick={() => setMode(next)}
      aria-label={next === "light" ? "เปลี่ยนเป็นโหมดสว่าง" : "เปลี่ยนเป็นโหมดมืด"}
      title={next === "light" ? "โหมดสว่าง" : "โหมดมืด"}
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-line bg-sunken text-muted transition-colors hover:border-line-strong hover:text-ink",
        className,
      )}
    >
      {resolved === "dark" ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}

const options: { id: ThemeMode; label: string; icon: typeof Sun }[] = [
  { id: "dark", label: "มืด", icon: Moon },
  { id: "light", label: "สว่าง", icon: Sun },
  { id: "system", label: "ตามระบบ", icon: Monitor },
];

/** ตัวเลือก 3 แบบ (อยู่ในเมนูผู้ใช้) */
export function ThemeSegment() {
  const { mode, setMode } = useTheme();
  return (
    <div className="grid grid-cols-3 gap-1 rounded-xl border border-line bg-sunken p-1" role="radiogroup" aria-label="ธีมหน้าจอ">
      {options.map((o) => (
        <button
          key={o.id}
          role="radio"
          aria-checked={mode === o.id}
          onClick={() => setMode(o.id)}
          className={cn(
            "flex flex-col items-center gap-0.5 rounded-lg py-1.5 text-[11px] transition-colors",
            mode === o.id ? "bg-panel text-brand shadow-sm" : "text-muted hover:text-ink",
          )}
        >
          <o.icon size={15} />
          {o.label}
        </button>
      ))}
    </div>
  );
}
