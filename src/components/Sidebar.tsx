"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChartColumn, CornerDownLeft, KeyRound, LogOut, Megaphone, MessagesSquare, Search, Settings, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar } from "./ui";
import { ThemeQuickToggle, ThemeSegment } from "./ThemeToggle";

// แถบบนของแอป (แทนแถบเมนูด้านซ้ายแบบเดิม) + จานคำสั่ง ⌘K

export interface Me {
  id: string;
  name: string;
  email: string;
  role: "owner" | "admin" | "agent";
  color: string;
  authSource?: string;
  adUsername?: string;
}

const roleLabel = { owner: "เจ้าของ", admin: "ผู้ดูแล", agent: "เจ้าหน้าที่ตอบแชท" };

const nav = [
  { href: "/inbox", label: "แชท", icon: MessagesSquare },
  { href: "/patients", label: "คนไข้", icon: Users },
  { href: "/broadcast", label: "ประกาศ", icon: Megaphone },
  { href: "/dashboard", label: "รายงาน", icon: ChartColumn },
  { href: "/settings", label: "ตั้งค่า", icon: Settings },
];

function useLive() {
  const [unread, setUnread] = useState(0);
  const [online, setOnline] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () =>
      fetch("/api/unread")
        .then((r) => (r.ok ? r.json() : { unread: 0 }))
        .then((d) => setUnread(d.unread ?? 0))
        .catch(() => {});
    load();
    const es = new EventSource("/api/events");
    es.onopen = () => setOnline(true);
    es.onerror = () => setOnline(false);
    es.onmessage = (e) => {
      setOnline(true);
      if (JSON.parse(e.data).type === "ping") return;
      clearTimeout(timer);
      timer = setTimeout(load, 400);
    };
    return () => {
      es.close();
      clearTimeout(timer);
    };
  }, []);
  return { unread, online };
}

export function Sidebar({ me }: { me: Me }) {
  const pathname = usePathname();
  const { unread, online } = useLive();
  const [menu, setMenu] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [palette, setPalette] = useState(false);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  useEffect(() => {
    document.title = (unread ? `(${unread}) ` : "") + "รวมแชท";
  }, [unread, pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <header className="relative z-30 flex h-14 shrink-0 items-center gap-3 border-b border-line bg-canvas/95 px-3 backdrop-blur sm:px-4">
        <Link href="/inbox" className="flex items-center gap-2.5 pr-2" aria-label="รวมแชท หน้าแรก">
          <span className="relative flex h-8 w-8 items-center justify-center rounded-[10px] bg-brand-soft font-display text-[17px] font-bold text-brand ring-1 ring-brand/40">
            ร
            <span className={cn("absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ring-2 ring-canvas", online ? "bg-ok" : "bg-faint")} />
          </span>
          <span className="hidden font-display text-[17px] font-semibold tracking-tight lg:inline">รวมแชท</span>
        </Link>

        <nav className="hidden items-center gap-0.5 rounded-xl border border-line bg-panel p-1 md:flex">
          {nav.map(({ href, label, icon: Icon }) => {
            const active = pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "relative flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] transition-colors",
                  active ? "bg-raised text-ink" : "text-muted hover:text-ink",
                )}
              >
                <Icon size={15} className={active ? "text-brand" : undefined} />
                {label}
                {href === "/inbox" && unread > 0 && (
                  <span className="font-display rounded-md bg-warm px-1.5 text-[11px] font-semibold leading-[18px] text-brand-ink">
                    {unread > 99 ? "99+" : unread}
                  </span>
                )}
                {active && <span className="absolute inset-x-3 -bottom-[5px] h-[2px] rounded-full bg-brand shadow-[0_0_10px_rgb(var(--brand-rgb)/0.9)]" />}
              </Link>
            );
          })}
        </nav>

        <button
          onClick={() => setPalette(true)}
          className="ml-auto flex h-9 min-w-0 items-center gap-2 rounded-xl border border-line bg-sunken px-3 text-[13px] text-muted transition-colors hover:border-line-strong hover:text-ink md:w-72"
        >
          <Search size={15} className="shrink-0" />
          <span className="hidden truncate sm:inline">ค้นหาคนไข้ (ชื่อ / HN) หรือไปที่หน้า…</span>
          <kbd className="ml-auto hidden rounded-md border border-line px-1.5 font-sans text-[11px] text-faint sm:inline">⌘K</kbd>
        </button>

        <ThemeQuickToggle className="hidden sm:flex" />

        <div className="relative">
          <button onClick={() => setMenu((v) => !v)} aria-label="เมนูผู้ใช้" className="flex items-center gap-2 rounded-xl p-1 hover:bg-raised">
            <Avatar name={me.name} color={me.color} size={30} />
            <span className="hidden text-left leading-tight xl:block">
              <span className="block text-[13px]">{me.name}</span>
              <span className="block text-[11px] text-muted">{roleLabel[me.role]}</span>
            </span>
          </button>
          {menu && <UserMenu me={me} onClose={() => setMenu(false)} onPassword={() => setPwOpen(true)} onLogout={logout} className="right-0 top-12" />}
        </div>
      </header>

      {/* มือถือ: เมนูล่าง */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex h-14 border-t border-line bg-panel/95 backdrop-blur md:hidden">
        {nav.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn("relative flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px]", active ? "text-brand" : "text-muted")}
            >
              <Icon size={19} />
              {label}
              {href === "/inbox" && unread > 0 && <span className="absolute right-[30%] top-1.5 h-2 w-2 rounded-full bg-warm" />}
            </Link>
          );
        })}
      </nav>

      {pwOpen && <PasswordModal onClose={() => setPwOpen(false)} />}
      {palette && <CommandPalette onClose={() => setPalette(false)} />}
    </>
  );
}

/* ---------------- จานคำสั่ง ⌘K ---------------- */

interface PaletteItem {
  id: string;
  label: string;
  hint?: string;
  href: string;
  group: string;
}

function CommandPalette({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [people, setPeople] = useState<PaletteItem[]>([]);
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 1) {
      setPeople([]);
      return;
    }
    const t = setTimeout(() => {
      fetch(`/api/patients?q=${encodeURIComponent(term)}`)
        .then((r) => (r.ok ? r.json() : { patients: [] }))
        .then((d: { patients: { id: string; name: string; hn?: string }[] }) =>
          setPeople(
            d.patients.slice(0, 6).map((c) => ({
              id: "c-" + c.id,
              label: c.name,
              hint: c.hn ? `HN ${c.hn}` : undefined,
              href: `/inbox?patient=${c.id}`,
              group: "คนไข้",
            })),
          ),
        )
        .catch(() => {});
    }, 180);
    return () => clearTimeout(t);
  }, [q]);

  const items = useMemo(() => {
    const term = q.trim().toLowerCase();
    const pages: PaletteItem[] = [
      { id: "p-inbox", label: "แชท", hint: "ตอบคนไข้ทุกช่องทาง", href: "/inbox", group: "ไปที่หน้า" },
      { id: "p-patients", label: "คนไข้", hint: "แฟ้มคนไข้ รวมแฟ้มซ้ำ", href: "/patients", group: "ไปที่หน้า" },
      { id: "p-broadcast", label: "ประกาศ", hint: "ส่งข่าวสารถึงหลายคน", href: "/broadcast", group: "ไปที่หน้า" },
      { id: "p-dash", label: "รายงาน", hint: "ภาพรวมวันนี้", href: "/dashboard", group: "ไปที่หน้า" },
      { id: "p-settings", label: "ตั้งค่า", hint: "ช่องทาง ทีม ตอบกลับอัตโนมัติ", href: "/settings", group: "ไปที่หน้า" },
    ].filter((p) => !term || p.label.includes(term) || p.hint?.toLowerCase().includes(term));
    return [...people, ...pages];
  }, [q, people]);

  useEffect(() => setIdx(0), [items.length]);

  function go(item?: PaletteItem) {
    if (!item) return;
    onClose();
    // อยู่หน้าแชทอยู่แล้ว → โหลดใหม่เพื่อเปิดแฟ้มที่เลือก
    if (window.location.pathname === "/inbox" && item.href.startsWith("/inbox?")) window.location.assign(item.href);
    else router.push(item.href);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[12vh] backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-line-strong bg-panel shadow-[0_30px_80px_rgb(var(--shade-rgb)/calc(0.6*var(--shade-k)))]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="ค้นหาและไปที่หน้า"
      >
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search size={18} className="text-brand" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIdx((i) => Math.min(i + 1, items.length - 1));
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setIdx((i) => Math.max(i - 1, 0));
              }
              if (e.key === "Enter") go(items[idx]);
            }}
            placeholder="พิมพ์ชื่อคนไข้ HN เบอร์โทร หรือชื่อหน้า"
            className="h-14 w-full bg-transparent text-[15px] outline-none placeholder:text-faint"
          />
          <kbd className="rounded-md border border-line px-1.5 text-[11px] text-faint">esc</kbd>
        </div>
        <ul className="max-h-[50vh] overflow-y-auto p-2 thin-scroll">
          {items.length === 0 && <li className="px-3 py-8 text-center text-sm text-muted">ไม่พบผลลัพธ์ ลองพิมพ์ชื่อหรือเบอร์โทรอื่น</li>}
          {items.map((it, i) => (
            <li key={it.id}>
              {(i === 0 || items[i - 1].group !== it.group) && <div className="px-3 pb-1 pt-2 text-[11px] text-faint">{it.group}</div>}
              <button
                onMouseEnter={() => setIdx(i)}
                onClick={() => go(it)}
                className={cn("flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left", i === idx ? "bg-raised" : "")}
              >
                <span className="text-sm">{it.label}</span>
                {it.hint && <span className="truncate text-xs text-muted">{it.hint}</span>}
                {i === idx && <CornerDownLeft size={14} className="ml-auto text-brand" />}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* ---------------- เมนูผู้ใช้ / เปลี่ยนรหัสผ่าน ---------------- */

function UserMenu({
  me,
  onClose,
  onPassword,
  onLogout,
  className,
}: {
  me: Me;
  onClose: () => void;
  onPassword: () => void;
  onLogout: () => void;
  className?: string;
}) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className={cn("absolute z-50 w-64 rounded-2xl border border-line-strong bg-panel p-1.5 text-ink shadow-[0_20px_50px_rgb(var(--shade-rgb)/calc(0.5*var(--shade-k)))]", className)}>
        <div className="flex items-center gap-3 px-3 py-2.5">
          <Avatar name={me.name} color={me.color} size={36} />
          <div className="min-w-0">
            <div className="text-sm font-semibold">{me.name}</div>
            <div className="truncate text-xs text-muted">{me.email}</div>
            <div className="mt-1 flex flex-wrap gap-1">
              <span className="rounded-md bg-brand-soft px-1.5 py-0.5 text-[10px] font-medium text-brand">{roleLabel[me.role]}</span>
              {me.authSource === "ad" && <span className="rounded-md bg-raised px-1.5 py-0.5 text-[10px] text-muted">บัญชี AD · {me.adUsername}</span>}
            </div>
          </div>
        </div>
        <div className="my-1 h-px bg-line" />
        <div className="px-1.5 pb-1.5 pt-1">
          <div className="mb-1.5 px-1.5 text-[11px] text-faint">ธีมหน้าจอ</div>
          <ThemeSegment />
        </div>
        <div className="my-1 h-px bg-line" />
        {me.authSource === "ad" ? (
          <p className="px-3 py-2 text-xs text-muted">เปลี่ยนรหัสผ่านที่ระบบของโรงพยาบาล (Windows / AD)</p>
        ) : (
          <button
            onClick={() => {
              onClose();
              onPassword();
            }}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm hover:bg-raised"
          >
            <KeyRound size={15} /> เปลี่ยนรหัสผ่าน
          </button>
        )}
        <button onClick={onLogout} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-hot hover:bg-hot/10">
          <LogOut size={15} /> ออกจากระบบ
        </button>
      </div>
    </>
  );
}

function PasswordModal({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const r = await fetch("/api/auth/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ current, next }),
    });
    const d = await r.json().catch(() => ({}));
    setMsg(r.ok ? { ok: true, text: "เปลี่ยนรหัสผ่านแล้ว" } : { ok: false, text: d.error ?? "เปลี่ยนรหัสผ่านไม่สำเร็จ" });
    if (r.ok) setTimeout(onClose, 1000);
  }
  const input = "mt-1 w-full rounded-xl border border-line bg-sunken px-3 py-2 text-sm outline-none focus:border-brand";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-2xl border border-line-strong bg-panel p-5 shadow-xl">
        <h2 className="font-display text-lg font-semibold">เปลี่ยนรหัสผ่าน</h2>
        <label className="mt-4 block text-sm text-muted">
          รหัสผ่านปัจจุบัน
          <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className={input} />
        </label>
        <label className="mt-3 block text-sm text-muted">
          รหัสผ่านใหม่ (อย่างน้อย 8 ตัว)
          <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} className={input} />
        </label>
        {msg && <p className={cn("mt-3 text-sm", msg.ok ? "text-ok" : "text-hot")}>{msg.text}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-xl px-3 py-2 text-sm text-muted hover:bg-raised">
            ยกเลิก
          </button>
          <button disabled={!current || next.length < 8} className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-brand-ink disabled:opacity-40">
            เปลี่ยนรหัสผ่าน
          </button>
        </div>
      </form>
    </div>
  );
}
