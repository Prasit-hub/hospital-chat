"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowRightLeft,
  CircleCheck,
  Heart,
  Loader2,
  PlugZap,
  TriangleAlert,
  Bot,
  Building2,
  Copy,
  Hospital,
  KeyRound,
  Link2,
  MessageSquareReply,
  Pencil,
  Plus,
  ScrollText,
  Siren,
  Tags,
  Trash2,
  Users,
  Zap,
} from "lucide-react";
import type { Channel, ChannelType } from "@/lib/types";
import { channelMeta, cn } from "@/lib/utils";
import { Avatar, Card, PageHeader, Switch, TagPill } from "@/components/ui";
import { api } from "@/components/inbox/workspace";
import { AuthSection } from "./AuthSection";

const sections = [
  { id: "channels", label: "เชื่อมต่อช่องทาง", icon: Link2 },
  { id: "shop", label: "ข้อมูลโรงพยาบาล", icon: Hospital },
  { id: "his", label: "เชื่อมต่อ HIS", icon: PlugZap },
  { id: "departments", label: "แผนก", icon: Building2 },
  { id: "team", label: "เจ้าหน้าที่และสิทธิ์", icon: Users },
  { id: "auth", label: "การเข้าสู่ระบบ (AD)", icon: KeyRound },
  { id: "cases", label: "งานและการโอน", icon: ArrowRightLeft },
  { id: "profiletags", label: "แท็กคนไข้", icon: Heart },
  { id: "urgent", label: "เรื่องเร่งด่วน", icon: Siren },
  { id: "quick", label: "ข้อความสำเร็จรูป", icon: Zap },
  { id: "auto", label: "ตอบกลับอัตโนมัติ", icon: Bot },
  { id: "tags", label: "กลุ่ม / สิทธิ", icon: Tags },
  { id: "audit", label: "บันทึกการใช้งาน", icon: ScrollText },
] as const;

type SectionId = (typeof sections)[number]["id"];
type Role = "owner" | "admin" | "agent";

const roleLabel: Record<Role, string> = {
  owner: "เจ้าของ",
  admin: "ผู้ดูแล",
  agent: "เจ้าหน้าที่ตอบแชท",
};
const DAYS = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
const TAG_COLORS = [
  "#3b82f6",
  "#a855f7",
  "#f59e0b",
  "#10b981",
  "#64748b",
  "#ef4444",
  "#ec4899",
  "#14b8a6",
];

interface Member {
  id: string;
  name: string;
  email: string;
  role: Role;
  color: string;
  online: boolean;
  active: boolean;
  departmentId?: string;
  authSource?: string;
  adUsername?: string;
  adSyncedAt?: string;
}
interface Dept {
  id: string;
  name: string;
  color: string;
  users: number;
  slaMinutes?: number;
  seesAll: boolean;
}
interface QR {
  id: string;
  shortcut: string;
  title: string;
  text: string;
}
interface Rule {
  id: string;
  keywords: string[];
  reply: string;
  enabled: boolean;
  channels: ChannelType[];
}
interface TagRow {
  id: string;
  name: string;
  color: string;
  count: number;
}
interface OrgSettings {
  welcome?: { enabled: boolean; text: string };
  away?: {
    enabled: boolean;
    text: string;
    start: string;
    end: string;
    days: number[];
  };
  urgent?: {
    enabled: boolean;
    keywords: string[];
    replyEnabled: boolean;
    reply: string;
  };
  visibility?: "all" | "department";
}
interface SettingsData {
  me: { id: string; role: Role };
  org: { name: string; settings: OrgSettings };
  users: Member[];
  quickReplies: QR[];
  autoReplies: Rule[];
  tags: TagRow[];
  departments: Dept[];
  caseSettings: CaseSettings;
}
interface CaseSettings {
  autoCloseDays: number;
  reopenDays: number;
  transferSla: {
    normal: number;
    urgent: number;
    escalateNormal: number;
    escalateUrgent: number;
  };
}

const input =
  "w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none focus:border-brand";
const btnPrimary =
  "flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-brand-ink hover:bg-brand-dark disabled:opacity-40";
const btnGhost = "rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-raised";

export default function SettingsPage() {
  const [active, setActive] = useState<SectionId>("channels");
  const [data, setData] = useState<SettingsData | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api<SettingsData>("/api/settings")
        .then(setData)
        .catch((e) => setToast(e.message)),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const canManage = data ? data.me.role !== "agent" : false;
  // ห่อการเรียก API: แสดง error เป็น toast แล้วโหลดข้อมูลใหม่
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) setToast(ok);
      await load();
      return true;
    } catch (e) {
      setToast((e as Error).message);
      return false;
    }
  };

  return (
    <div className="flex-1 overflow-y-auto thin-scroll">
      <PageHeader
        title="ตั้งค่า"
        subtitle="จัดการช่องทาง แผนก เจ้าหน้าที่ และระบบตอบกลับ"
      />
      <div className="flex flex-col gap-5 p-4 sm:p-6 lg:flex-row">
        <nav className="flex shrink-0 gap-1 overflow-x-auto lg:w-56 lg:flex-col">
          {sections.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActive(id)}
              className={cn(
                "flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm",
                active === id
                  ? "bg-panel font-medium text-brand shadow-sm"
                  : "text-muted hover:bg-raised/60 hover:text-ink",
              )}
            >
              <Icon size={16} /> {label}
            </button>
          ))}
        </nav>
        <div className="min-w-0 flex-1 space-y-3">
          {data && !canManage && active !== "channels" && (
            <p className="rounded-lg bg-warm/10 px-3 py-2 text-sm text-warm">
              บัญชีของคุณดูได้อย่างเดียว — การแก้ไขต้องเป็นเจ้าของหรือผู้ดูแล
            </p>
          )}
          {active === "channels" && <ChannelsSection />}
          {!data && active !== "channels" && (
            <Card className="p-4 text-sm text-muted">กำลังโหลด…</Card>
          )}
          {data && active === "shop" && (
            <ShopSection data={data} canManage={canManage} run={run} />
          )}
          {data && active === "team" && (
            <TeamSection data={data} canManage={canManage} run={run} />
          )}
          {data && active === "quick" && (
            <QuickSection
              items={data.quickReplies}
              canManage={canManage}
              run={run}
            />
          )}
          {data && active === "auto" && (
            <AutoSection data={data} canManage={canManage} run={run} />
          )}
          {data && active === "tags" && (
            <TagsSection items={data.tags} canManage={canManage} run={run} />
          )}
          {data && active === "departments" && (
            <DepartmentsSection
              items={data.departments}
              visibility={data.org.settings.visibility ?? "all"}
              canManage={canManage}
              run={run}
            />
          )}
          {data &&
            active === "auth" &&
            (canManage ? (
              <AuthSection isOwner={data.me.role === "owner"} departments={data.departments} run={run} />
            ) : (
              <Card className="p-4 text-sm text-muted">เฉพาะเจ้าของหรือผู้ดูแลเท่านั้นที่ดูการตั้งค่าการเข้าสู่ระบบได้</Card>
            ))}
          {data &&
            active === "his" &&
            (canManage ? (
              <HisSection isOwner={data.me.role === "owner"} run={run} />
            ) : (
              <Card className="p-4 text-sm text-muted">
                เฉพาะเจ้าของหรือผู้ดูแลเท่านั้นที่ดูการเชื่อมต่อ HIS ได้
              </Card>
            ))}
          {data && active === "cases" && (
            <CasesSection data={data} canManage={canManage} run={run} />
          )}
          {data && active === "profiletags" && (
            <ProfileTagsSection canManage={canManage} run={run} />
          )}
          {data && active === "urgent" && (
            <UrgentSection data={data} canManage={canManage} run={run} />
          )}
          {data &&
            active === "audit" &&
            (canManage ? (
              <AuditSection />
            ) : (
              <Card className="p-4 text-sm text-muted">
                เฉพาะเจ้าของหรือผู้ดูแลเท่านั้นที่ดูบันทึกการใช้งานได้
              </Card>
            ))}
        </div>
      </div>
      {toast && (
        <div className="fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-brand/40 bg-raised px-4 py-2.5 text-sm text-ink shadow-[0_12px_40px_rgb(var(--shade-rgb)/calc(0.5*var(--shade-k)))] md:bottom-6">
          {toast}
        </div>
      )}
    </div>
  );
}

type Run = (fn: () => Promise<unknown>, ok?: string) => Promise<boolean>;

type ChannelRow = Channel & {
  webhookUrl: string;
  email?: { lastPolledAt: string | null; lastError: string | null };
};

function ChannelsSection() {
  const [list, setList] = useState<ChannelRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Channel["type"] | null>(null);

  const load = () =>
    fetch("/api/channels")
      .then(async (r) =>
        r.ok ? setList(await r.json()) : setError((await r.json()).error),
      )
      .catch((e) => setError(String(e)));
  useEffect(() => {
    load();
  }, []);

  async function toggle(c: ChannelRow) {
    const r = await fetch(`/api/channels/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connected: !c.connected }),
    });
    if (r.ok) load();
    else setError((await r.json()).error);
  }

  const all: Channel["type"][] = [
    "line",
    "facebook",
    "instagram",
    "email",
    "tiktok",
  ];
  const howTo: Record<Channel["type"], string> = {
    line: "ใช้ Channel secret และ Channel access token จาก LINE Developers Console (Messaging API)",
    facebook:
      "ใช้ Page Access Token ของเพจจาก Meta App (สิทธิ์ pages_messaging)",
    instagram:
      "เชื่อมพร้อมเพจ Facebook ที่ผูกกับบัญชี Instagram Business/Creator",
    tiktok:
      "ต้องได้รับสิทธิ์ TikTok Business Messaging API ก่อน (ยังไม่รองรับในเวอร์ชันนี้)",
    email:
      "รับอีเมลจากคนไข้เข้ามาในแชท (IMAP) และตอบกลับเป็นอีเมล (SMTP) — ใช้ได้กับ Gmail, Google Workspace, อีเมลโฮสติ้ง",
  };

  async function pollNow(c: ChannelRow) {
    const r = await fetch(`/api/channels/${c.id}/poll`, { method: "POST" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) setError(d.error ?? "ตรวจอีเมลไม่สำเร็จ");
    load();
  }

  if (error) return <Card className="p-4 text-sm text-hot">{error}</Card>;
  if (!list) return <Card className="p-4 text-sm text-muted">กำลังโหลด…</Card>;

  return (
    <div className="space-y-3">
      {all.map((type) => {
        const m = channelMeta[type];
        const rows = list.filter((c) => c.type === type);
        const canConnect =
          type === "line" || type === "facebook" || type === "email";
        return (
          <Card key={type} className="p-4">
            <div className="flex flex-wrap items-center gap-4">
              <div
                className="flex h-11 w-11 items-center justify-center rounded-xl text-sm font-bold text-white"
                style={{ background: m.color }}
              >
                {m.short}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-medium">{m.label}</div>
                <div className="text-sm text-muted">{howTo[type]}</div>
              </div>
              {canConnect && (
                <button
                  onClick={() => setForm(form === type ? null : type)}
                  className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-brand-ink hover:bg-brand-dark"
                >
                  {rows.length ? "เพิ่มบัญชี" : "เชื่อมต่อ"}
                </button>
              )}
            </div>

            {rows.map((c) => (
              <div
                key={c.id}
                className="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-canvas px-3 py-2.5 text-sm"
              >
                <span
                  className={cn(
                    "h-2 w-2 rounded-full",
                    c.connected
                      ? "bg-ok shadow-[0_0_6px_var(--color-ok)]"
                      : "bg-line-strong",
                  )}
                />
                <span className="font-medium">{c.name}</span>
                {c.followers > 0 && (
                  <span className="text-muted">
                    ผู้ติดตาม {c.followers.toLocaleString()}
                  </span>
                )}
                {c.type === "email" ? (
                  <>
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate text-xs",
                        c.email?.lastError ? "text-hot" : "text-muted",
                      )}
                    >
                      {c.email?.lastError
                        ? `ตรวจอีเมลไม่สำเร็จ: ${c.email.lastError}`
                        : c.email?.lastPolledAt
                          ? `ตรวจล่าสุด ${new Date(c.email.lastPolledAt).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: process.env.NEXT_PUBLIC_APP_TZ || "Asia/Bangkok" })} น.`
                          : "รอตรวจอีเมลรอบแรก (ทุก 1 นาที)"}
                    </span>
                    {c.connected && (
                      <button
                        onClick={() => pollNow(c)}
                        className="text-xs text-brand hover:underline"
                      >
                        ตรวจตอนนี้
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <code
                      className="min-w-0 flex-1 truncate rounded bg-panel px-2 py-0.5 text-[11px] text-muted"
                      title="Webhook URL"
                    >
                      {c.webhookUrl}
                    </code>
                    <button
                      onClick={() =>
                        navigator.clipboard?.writeText(c.webhookUrl)
                      }
                      className="text-xs text-brand hover:underline"
                    >
                      คัดลอก URL
                    </button>
                  </>
                )}
                <button
                  onClick={() => toggle(c)}
                  className={cn(
                    "rounded-md border px-2 py-1 text-xs",
                    c.connected
                      ? "border-line text-muted hover:border-hot/50 hover:text-hot"
                      : "border-brand text-brand",
                  )}
                >
                  {c.connected ? "ยกเลิกการเชื่อมต่อ" : "เปิดใช้อีกครั้ง"}
                </button>
              </div>
            ))}

            {form === type && type === "email" && (
              <EmailConnectForm
                onDone={() => {
                  setForm(null);
                  load();
                }}
              />
            )}
            {form === type && type !== "email" && (
              <ConnectForm
                type={type as "line" | "facebook"}
                onDone={() => {
                  setForm(null);
                  load();
                }}
              />
            )}
          </Card>
        );
      })}
      <p className="px-1 text-xs text-muted">
        Facebook และ Instagram ใช้ Webhook URL เดียวกัน: ตั้งค่าใน Meta App
        Dashboard &gt; Webhooks พร้อม Verify Token = ค่า META_VERIFY_TOKEN
      </p>
    </div>
  );
}

interface MailServer {
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
}
interface EmailForm extends MailServer {
  address: string;
  fromName: string;
  username: string;
  password: string;
  allowSelfSigned: boolean;
}
const EMAIL_PRESETS: Record<
  "gmail" | "custom",
  { label: string; server: MailServer }
> = {
  gmail: {
    label: "Gmail / Google Workspace",
    server: {
      imapHost: "imap.gmail.com",
      imapPort: 993,
      imapSecure: true,
      smtpHost: "smtp.gmail.com",
      smtpPort: 465,
      smtpSecure: true,
    },
  },
  custom: {
    label: "อื่นๆ (อีเมลโฮสติ้ง / Zoho / เซิร์ฟเวอร์บริษัท)",
    server: {
      imapHost: "",
      imapPort: 993,
      imapSecure: true,
      smtpHost: "",
      smtpPort: 465,
      smtpSecure: true,
    },
  },
};

function EmailConnectForm({ onDone }: { onDone: () => void }) {
  const [preset, setPreset] = useState<keyof typeof EMAIL_PRESETS>("gmail");
  const [f, setF] = useState<EmailForm>({
    address: "",
    fromName: "",
    username: "",
    password: "",
    ...EMAIL_PRESETS.gmail.server,
    allowSelfSigned: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<EmailForm>) => setF((x) => ({ ...x, ...patch }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const rest = f;
    const r = await fetch("/api/channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "email",
        ...rest,
        username: rest.username || rest.address,
      }),
    });
    setBusy(false);
    if (r.ok) onDone();
    else
      setError(
        (await r.json().catch(() => ({}))).error ?? "เชื่อมต่อไม่สำเร็จ",
      );
  }

  const input =
    "w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand";
  const label = "block text-xs font-medium text-muted";
  return (
    <form
      onSubmit={submit}
      className="mt-3 space-y-3 rounded-lg border border-line p-3"
    >
      <div className="flex flex-wrap gap-2">
        {(Object.keys(EMAIL_PRESETS) as (keyof typeof EMAIL_PRESETS)[]).map(
          (k) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                setPreset(k);
                set(EMAIL_PRESETS[k].server);
              }}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-sm",
                preset === k
                  ? "border-brand bg-brand-soft text-brand"
                  : "border-line text-muted",
              )}
            >
              {EMAIL_PRESETS[k].label}
            </button>
          ),
        )}
      </div>
      {preset === "gmail" && (
        <p className="rounded-lg bg-warm/10 px-3 py-2 text-xs text-warm">
          Gmail ต้องใช้ <b>App Password</b> (ไม่ใช่รหัสผ่านปกติ): เปิดการยืนยัน
          2 ขั้นตอนในบัญชี Google → ค้นหา “App passwords” → สร้างรหัส 16
          ตัวมาใส่ที่นี่
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={label}>
          อีเมลของโรงพยาบาล
          <input
            required
            type="email"
            value={f.address}
            onChange={(e) => set({ address: e.target.value })}
            placeholder="support@yourshop.com"
            className={input + " mt-1"}
          />
        </label>
        <label className={label}>
          ชื่อผู้ส่งที่คนไข้เห็น
          <input
            value={f.fromName}
            onChange={(e) => set({ fromName: e.target.value })}
            placeholder="โรงพยาบาลตัวอย่าง"
            className={input + " mt-1"}
          />
        </label>
        <label className={label}>
          ชื่อผู้ใช้ (ปกติคืออีเมล)
          <input
            value={f.username}
            onChange={(e) => set({ username: e.target.value })}
            placeholder={f.address || "เว้นว่าง = ใช้อีเมล"}
            autoComplete="off"
            className={input + " mt-1"}
          />
        </label>
        <label className={label}>
          {preset === "gmail" ? "App Password" : "รหัสผ่าน"}
          <input
            required
            type="password"
            value={f.password}
            onChange={(e) => set({ password: e.target.value })}
            autoComplete="new-password"
            className={input + " mt-1"}
          />
        </label>
      </div>
      {preset === "custom" && (
        <div className="grid gap-3 rounded-lg bg-canvas p-3 sm:grid-cols-[1fr_90px_auto]">
          <label className={label}>
            IMAP server (รับ)
            <input
              required
              value={f.imapHost}
              onChange={(e) => set({ imapHost: e.target.value })}
              placeholder="mail.yourshop.com"
              className={input + " mt-1"}
            />
          </label>
          <label className={label}>
            พอร์ต
            <input
              required
              type="number"
              value={f.imapPort}
              onChange={(e) => set({ imapPort: Number(e.target.value) })}
              className={input + " mt-1"}
            />
          </label>
          <label className="flex items-end gap-1.5 pb-2 text-xs">
            <input
              type="checkbox"
              checked={f.imapSecure}
              onChange={(e) => set({ imapSecure: e.target.checked })}
              className="accent-brand"
            />{" "}
            SSL/TLS
          </label>
          <label className={label}>
            SMTP server (ส่ง)
            <input
              required
              value={f.smtpHost}
              onChange={(e) => set({ smtpHost: e.target.value })}
              placeholder="mail.yourshop.com"
              className={input + " mt-1"}
            />
          </label>
          <label className={label}>
            พอร์ต
            <input
              required
              type="number"
              value={f.smtpPort}
              onChange={(e) =>
                set({
                  smtpPort: Number(e.target.value),
                  smtpSecure: Number(e.target.value) === 465,
                })
              }
              className={input + " mt-1"}
            />
          </label>
          <label className="flex items-end gap-1.5 pb-2 text-xs">
            <input
              type="checkbox"
              checked={f.smtpSecure}
              onChange={(e) => set({ smtpSecure: e.target.checked })}
              className="accent-brand"
            />{" "}
            SSL/TLS (465)
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted sm:col-span-3">
            <input
              type="checkbox"
              checked={f.allowSelfSigned}
              onChange={(e) => set({ allowSelfSigned: e.target.checked })}
              className="accent-brand"
            />
            ยอมรับใบรับรอง SSL ที่ไม่ได้รับรอง (เฉพาะเซิร์ฟเวอร์ภายในองค์กร)
          </label>
        </div>
      )}
      <p className="text-xs text-muted">
        ระบบจะเริ่มรับอีเมลที่เข้ามาหลังจากเชื่อมต่อ (ไม่ดึงอีเมลเก่า)
        และไม่เปลี่ยนสถานะอ่านแล้ว/ยังไม่อ่านในกล่องจดหมาย
      </p>
      {error && <p className="text-sm text-hot">{error}</p>}
      <div className="flex justify-end">
        <button
          disabled={busy || !f.address || !f.password}
          className="rounded-lg bg-brand px-4 py-1.5 text-sm font-medium text-brand-ink disabled:opacity-40"
        >
          {busy ? "กำลังทดสอบการเชื่อมต่อ…" : "ทดสอบและเชื่อมต่อ"}
        </button>
      </div>
    </form>
  );
}

function ConnectForm({
  type,
  onDone,
}: {
  type: "line" | "facebook";
  onDone: () => void;
}) {
  const [secret, setSecret] = useState("");
  const [token, setToken] = useState("");
  const [withIg, setWithIg] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body =
      type === "line"
        ? { type, channelSecret: secret, accessToken: token }
        : { type, accessToken: token, includeInstagram: withIg };
    const r = await fetch("/api/channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (r.ok) onDone();
    else
      setError(
        (await r.json().catch(() => ({}))).error ?? "เชื่อมต่อไม่สำเร็จ",
      );
  }

  const input =
    "w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand";
  return (
    <form
      onSubmit={submit}
      className="mt-3 space-y-2.5 rounded-lg border border-line p-3"
    >
      {type === "line" && (
        <label className="block text-xs font-medium text-muted">
          Channel secret
          <input
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            className={input + " mt-1"}
            autoComplete="off"
          />
        </label>
      )}
      <label className="block text-xs font-medium text-muted">
        {type === "line"
          ? "Channel access token (long-lived)"
          : "Page Access Token"}
        <textarea
          value={token}
          onChange={(e) => setToken(e.target.value)}
          rows={2}
          className={input + " mt-1 font-mono text-xs"}
        />
      </label>
      {type === "facebook" && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={withIg}
            onChange={(e) => setWithIg(e.target.checked)}
            className="accent-brand"
          />
          เชื่อม Instagram ที่ผูกกับเพจนี้ด้วย
        </label>
      )}
      {error && <p className="text-sm text-hot">{error}</p>}
      <div className="flex justify-end">
        <button
          disabled={busy || !token || (type === "line" && !secret)}
          className="rounded-lg bg-brand px-4 py-1.5 text-sm font-medium text-brand-ink disabled:opacity-40"
        >
          {busy ? "กำลังตรวจสอบ…" : "บันทึกและเชื่อมต่อ"}
        </button>
      </div>
    </form>
  );
}

/* ---------------- ข้อมูลร้าน ---------------- */

function ShopSection({
  data,
  canManage,
  run,
}: {
  data: SettingsData;
  canManage: boolean;
  run: Run;
}) {
  const [name, setName] = useState(data.org.name);
  return (
    <Card className="space-y-4 p-5">
      <label className="block text-sm font-medium">
        ชื่อโรงพยาบาล / หน่วยงาน
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={!canManage}
          className={input + " mt-1"}
        />
      </label>
      {canManage && (
        <div className="flex justify-end">
          <button
            className={btnPrimary}
            onClick={() =>
              run(
                () => api("/api/settings", { method: "PATCH", json: { name } }),
                "บันทึกแล้ว",
              )
            }
          >
            บันทึก
          </button>
        </div>
      )}
    </Card>
  );
}

/* ---------------- ทีม ---------------- */

function TeamSection({
  data,
  canManage,
  run,
}: {
  data: SettingsData;
  canManage: boolean;
  run: Run;
}) {
  const [inviting, setInviting] = useState(false);
  const [form, setForm] = useState({
    name: "",
    email: "",
    role: "agent" as Role,
  });
  const [secret, setSecret] = useState<{
    email: string;
    password: string;
  } | null>(null);
  const meOwner = data.me.role === "owner";

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    let created: { user: Member; password: string } | null = null;
    const ok = await run(async () => {
      created = await api<{ user: Member; password: string }>("/api/team", {
        method: "POST",
        json: form,
      });
    });
    if (ok && created) {
      const c = created as { user: Member; password: string };
      setSecret({ email: c.user.email, password: c.password });
      setInviting(false);
      setForm({ name: "", email: "", role: "agent" });
    }
  }

  async function resetPw(m: Member) {
    let pw = "";
    const ok = await run(async () => {
      pw = (
        await api<{ password: string }>(`/api/team/${m.id}`, {
          method: "PATCH",
          json: { resetPassword: true },
        })
      ).password;
    });
    if (ok) setSecret({ email: m.email, password: pw });
  }

  const roleOptions = (Object.keys(roleLabel) as Role[]).filter(
    (r) => meOwner || r !== "owner",
  );

  return (
    <>
      {secret && (
        <Card className="border-ok/40 bg-ok/10 p-4 text-sm">
          <div className="font-medium text-ok">
            ส่งข้อมูลนี้ให้สมาชิกเพื่อเข้าสู่ระบบ (แสดงครั้งเดียว)
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3 font-mono text-[13px]">
            <span>อีเมล: {secret.email}</span>
            <span>รหัสผ่าน: {secret.password}</span>
            <button
              onClick={() =>
                navigator.clipboard?.writeText(
                  `อีเมล: ${secret.email}\nรหัสผ่าน: ${secret.password}\nเข้าสู่ระบบที่: ${window.location.origin}/login`,
                )
              }
              className="flex items-center gap-1 font-sans text-xs text-ok underline"
            >
              <Copy size={12} /> คัดลอก
            </button>
          </div>
          <p className="mt-1 text-xs text-ok">
            แนะนำให้สมาชิกเปลี่ยนรหัสผ่านหลังเข้าสู่ระบบครั้งแรก (เมนูรูปโปรไฟล์
            → เปลี่ยนรหัสผ่าน)
          </p>
        </Card>
      )}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4">
          <div className="text-sm font-semibold">
            เจ้าหน้าที่ ({data.users.filter((u) => u.active).length})
          </div>
          {canManage && (
            <button
              onClick={() => setInviting((v) => !v)}
              className={btnPrimary}
            >
              <Plus size={15} /> เพิ่มเจ้าหน้าที่
            </button>
          )}
        </div>
        {inviting && (
          <form
            onSubmit={invite}
            className="grid gap-2 border-t border-line bg-canvas/50 px-5 py-4 sm:grid-cols-[1fr_1.3fr_auto_auto]"
          >
            <input
              required
              placeholder="ชื่อที่แสดง"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className={input}
            />
            <input
              required
              type="email"
              placeholder="อีเมล"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className={input}
            />
            <select
              value={form.role}
              onChange={(e) =>
                setForm({ ...form, role: e.target.value as Role })
              }
              className={input}
            >
              {roleOptions.map((r) => (
                <option key={r} value={r}>
                  {roleLabel[r]}
                </option>
              ))}
            </select>
            <button className={btnPrimary}>สร้างบัญชี</button>
          </form>
        )}
        {data.users.map((u) => {
          const self = u.id === data.me.id;
          const locked = !canManage || self || (!meOwner && u.role === "owner");
          return (
            <div
              key={u.id}
              className={cn(
                "flex flex-wrap items-center gap-3 border-t border-line px-5 py-3",
                !u.active && "opacity-50",
              )}
            >
              <Avatar
                name={u.name}
                color={u.color}
                size={34}
                online={u.active ? u.online : undefined}
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">
                  {u.name}{" "}
                  {self && <span className="text-xs text-muted">(คุณ)</span>}
                  {!u.active && (
                    <span className="ml-1 rounded bg-raised px-1.5 text-[10px]">
                      ปิดใช้งาน
                    </span>
                  )}
                </div>
                <div className="truncate text-xs text-muted">
                  {u.email}
                  {u.authSource === "ad" && (
                    <span
                      className="ml-1.5 rounded bg-brand-soft px-1.5 py-0.5 text-[10px] font-medium text-brand"
                      title={`บทบาทและแผนกซิงก์จากกลุ่มใน AD${u.adSyncedAt ? ` · ล่าสุด ${new Date(u.adSyncedAt).toLocaleString("th-TH")}` : ""}`}
                    >
                      AD · {u.adUsername}
                    </span>
                  )}
                </div>
              </div>
              <select
                value={u.departmentId ?? ""}
                disabled={!canManage || !u.active}
                onChange={(e) =>
                  run(
                    () =>
                      api(`/api/team/${u.id}`, {
                        method: "PATCH",
                        json: { departmentId: e.target.value || null },
                      }),
                    "เปลี่ยนแผนกแล้ว",
                  )
                }
                className="max-w-[170px] rounded-lg border border-line bg-sunken px-2 py-1 text-sm disabled:opacity-60"
                aria-label={`แผนกของ ${u.name}`}
              >
                <option value="">ไม่สังกัดแผนก</option>
                {data.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              <select
                value={u.role}
                disabled={locked || !u.active || u.authSource === "ad"}
                title={u.authSource === "ad" ? "บทบาทของบัญชี AD กำหนดจากกลุ่มใน AD" : undefined}
                onChange={(e) =>
                  run(
                    () =>
                      api(`/api/team/${u.id}`, {
                        method: "PATCH",
                        json: { role: e.target.value },
                      }),
                    "เปลี่ยนบทบาทแล้ว",
                  )
                }
                className="rounded-lg border border-line px-2 py-1 text-sm disabled:opacity-60"
              >
                {(Object.keys(roleLabel) as Role[]).map((r) => (
                  <option
                    key={r}
                    value={r}
                    disabled={!meOwner && r === "owner"}
                  >
                    {roleLabel[r]}
                  </option>
                ))}
              </select>
              {!locked && (
                <>
                  {u.active && u.authSource !== "ad" && (
                    <button
                      onClick={() => resetPw(u)}
                      title="ออกรหัสผ่านใหม่"
                      className="rounded-lg p-1.5 text-muted hover:bg-raised hover:text-ink"
                    >
                      <KeyRound size={16} />
                    </button>
                  )}
                  <button
                    onClick={() =>
                      run(
                        () =>
                          api(`/api/team/${u.id}`, {
                            method: "PATCH",
                            json: { active: !u.active },
                          }),
                        u.active ? "ปิดใช้งานบัญชีแล้ว" : "เปิดใช้งานบัญชีแล้ว",
                      )
                    }
                    className={cn(
                      "rounded-md border px-2 py-1 text-xs",
                      u.active
                        ? "border-line text-muted hover:border-hot/50 hover:text-hot"
                        : "border-brand text-brand",
                    )}
                  >
                    {u.active ? "ปิดใช้งาน" : "เปิดใช้งาน"}
                  </button>
                </>
              )}
            </div>
          );
        })}
      </Card>
      <p className="px-1 text-xs text-muted">
        เจ้าของ: จัดการได้ทุกอย่าง · ผู้ดูแล: จัดการช่องทาง เจ้าหน้าที่
        การตั้งค่า และยกเลิกการรวมแฟ้ม (ยกเว้นบัญชีเจ้าของ) · เจ้าหน้าที่ตอบแชท:
        ตอบแชท ยืนยันตัวตน รวมแฟ้ม และบันทึกคำขอนัด
      </p>
    </>
  );
}

/* ---------------- ข้อความสำเร็จรูป ---------------- */

function QuickSection({
  items,
  canManage,
  run,
}: {
  items: QR[];
  canManage: boolean;
  run: Run;
}) {
  const [editing, setEditing] = useState<QR | "new" | null>(null);
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4">
        <div>
          <div className="text-sm font-semibold">ข้อความสำเร็จรูป</div>
          <div className="text-xs text-muted">
            พิมพ์ / ในช่องแชทเพื่อเรียกใช้
          </div>
        </div>
        {canManage && (
          <button onClick={() => setEditing("new")} className={btnPrimary}>
            <Plus size={15} /> เพิ่มข้อความ
          </button>
        )}
      </div>
      {editing === "new" && (
        <QuickForm
          onCancel={() => setEditing(null)}
          onSave={(v) =>
            run(
              () => api("/api/quick-replies", { method: "POST", json: v }),
              "เพิ่มแล้ว",
            ).then((ok) => ok && setEditing(null))
          }
        />
      )}
      {items.length === 0 && editing !== "new" && (
        <p className="border-t border-line px-5 py-6 text-center text-sm text-muted">
          ยังไม่มีข้อความสำเร็จรูป
        </p>
      )}
      {items.map((q) =>
        editing !== "new" && editing?.id === q.id ? (
          <QuickForm
            key={q.id}
            initial={q}
            onCancel={() => setEditing(null)}
            onSave={(v) =>
              run(
                () =>
                  api(`/api/quick-replies/${q.id}`, {
                    method: "PATCH",
                    json: v,
                  }),
                "บันทึกแล้ว",
              ).then((ok) => ok && setEditing(null))
            }
          />
        ) : (
          <div
            key={q.id}
            className="flex items-start gap-3 border-t border-line px-5 py-3"
          >
            <span className="mt-0.5 rounded bg-brand-soft px-1.5 font-mono text-xs text-brand">
              {q.shortcut}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{q.title}</div>
              <div className="whitespace-pre-wrap text-sm text-muted">
                {q.text}
              </div>
            </div>
            {canManage && (
              <>
                <button
                  onClick={() => setEditing(q)}
                  className="text-muted hover:text-ink"
                  aria-label="แก้ไข"
                >
                  <Pencil size={15} />
                </button>
                <button
                  onClick={() =>
                    run(
                      () =>
                        api(`/api/quick-replies/${q.id}`, { method: "DELETE" }),
                      "ลบแล้ว",
                    )
                  }
                  className="text-muted hover:text-hot"
                  aria-label="ลบ"
                >
                  <Trash2 size={15} />
                </button>
              </>
            )}
          </div>
        ),
      )}
    </Card>
  );
}

function QuickForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: QR;
  onSave: (v: Omit<QR, "id">) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState({
    shortcut: initial?.shortcut ?? "/",
    title: initial?.title ?? "",
    text: initial?.text ?? "",
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave(v);
      }}
      className="space-y-2 border-t border-line bg-canvas/50 px-5 py-4"
    >
      <div className="grid gap-2 sm:grid-cols-[160px_1fr]">
        <input
          required
          value={v.shortcut}
          onChange={(e) =>
            setV({ ...v, shortcut: e.target.value.replace(/\s/g, "") })
          }
          placeholder="/คำย่อ"
          className={input + " font-mono"}
        />
        <input
          required
          value={v.title}
          onChange={(e) => setV({ ...v, title: e.target.value })}
          placeholder="ชื่อ เช่น เวลาทำการ OPD"
          className={input}
        />
      </div>
      <textarea
        required
        rows={3}
        value={v.text}
        onChange={(e) => setV({ ...v, text: e.target.value })}
        placeholder="ข้อความที่จะส่ง"
        className={input + " resize-none"}
      />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={btnGhost}>
          ยกเลิก
        </button>
        <button className={btnPrimary}>บันทึก</button>
      </div>
    </form>
  );
}

/* ---------------- ตอบกลับอัตโนมัติ ---------------- */

function AutoSection({
  data,
  canManage,
  run,
}: {
  data: SettingsData;
  canManage: boolean;
  run: Run;
}) {
  const s = data.org.settings;
  const [welcome, setWelcome] = useState(
    s.welcome ?? { enabled: false, text: "" },
  );
  const [away, setAway] = useState(
    s.away ?? {
      enabled: false,
      text: "",
      start: "09:00",
      end: "18:00",
      days: [1, 2, 3, 4, 5, 6],
    },
  );
  const [editing, setEditing] = useState<Rule | "new" | null>(null);
  const saveSettings = () =>
    run(
      () => api("/api/settings", { method: "PATCH", json: { welcome, away } }),
      "บันทึกแล้ว",
    );

  return (
    <div className="space-y-4">
      <Card className="divide-y divide-line">
        <div className="space-y-2 px-5 py-4">
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <div className="text-sm font-medium">ข้อความต้อนรับ</div>
              <div className="text-xs text-muted">
                ส่งอัตโนมัติเมื่อมีผู้ติดต่อทักมาครั้งแรก
              </div>
            </div>
            <Switch
              checked={welcome.enabled}
              onChange={(v) =>
                canManage && setWelcome({ ...welcome, enabled: v })
              }
              label="ข้อความต้อนรับ"
            />
          </div>
          <textarea
            disabled={!canManage}
            rows={2}
            value={welcome.text}
            onChange={(e) => setWelcome({ ...welcome, text: e.target.value })}
            className={input + " resize-none"}
          />
        </div>
        <div className="space-y-2 px-5 py-4">
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <div className="text-sm font-medium">ข้อความนอกเวลาทำการ</div>
              <div className="text-xs text-muted">
                ส่งเมื่อมีข้อความเข้ามานอกเวลาทำการ (ไม่เกิน 1 ครั้งต่อ 2 ชม.
                ต่อแชท)
              </div>
            </div>
            <Switch
              checked={away.enabled}
              onChange={(v) => canManage && setAway({ ...away, enabled: v })}
              label="ข้อความนอกเวลาทำการ"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted">เวลาทำการ</span>
            {DAYS.map((d, i) => (
              <button
                key={d}
                type="button"
                disabled={!canManage}
                onClick={() =>
                  setAway({
                    ...away,
                    days: away.days.includes(i)
                      ? away.days.filter((x) => x !== i)
                      : [...away.days, i].sort(),
                  })
                }
                className={cn(
                  "h-7 w-8 rounded-md border text-xs",
                  away.days.includes(i)
                    ? "border-brand bg-brand-soft text-brand"
                    : "border-line text-muted",
                )}
              >
                {d}
              </button>
            ))}
            <input
              type="time"
              disabled={!canManage}
              value={away.start}
              onChange={(e) => setAway({ ...away, start: e.target.value })}
              className="rounded-md border border-line px-2 py-1"
            />
            –
            <input
              type="time"
              disabled={!canManage}
              value={away.end}
              onChange={(e) => setAway({ ...away, end: e.target.value })}
              className="rounded-md border border-line px-2 py-1"
            />
          </div>
          <textarea
            disabled={!canManage}
            rows={2}
            value={away.text}
            onChange={(e) => setAway({ ...away, text: e.target.value })}
            className={input + " resize-none"}
          />
        </div>
        {canManage && (
          <div className="flex justify-end px-5 py-3">
            <button onClick={saveSettings} className={btnPrimary}>
              บันทึก
            </button>
          </div>
        )}
      </Card>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <MessageSquareReply size={16} /> ตอบตามคีย์เวิร์ด
          </div>
          {canManage && (
            <button onClick={() => setEditing("new")} className={btnPrimary}>
              <Plus size={15} /> เพิ่มกฎ
            </button>
          )}
        </div>
        {editing === "new" && (
          <RuleForm
            onCancel={() => setEditing(null)}
            onSave={(v) =>
              run(
                () => api("/api/auto-replies", { method: "POST", json: v }),
                "เพิ่มกฎแล้ว",
              ).then((ok) => ok && setEditing(null))
            }
          />
        )}
        {data.autoReplies.map((r) =>
          editing !== "new" && editing?.id === r.id ? (
            <RuleForm
              key={r.id}
              initial={r}
              onCancel={() => setEditing(null)}
              onSave={(v) =>
                run(
                  () =>
                    api(`/api/auto-replies/${r.id}`, {
                      method: "PATCH",
                      json: v,
                    }),
                  "บันทึกแล้ว",
                ).then((ok) => ok && setEditing(null))
              }
            />
          ) : (
            <div
              key={r.id}
              className="flex items-start gap-4 border-t border-line px-5 py-3.5"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap gap-1">
                  {r.keywords.map((k) => (
                    <span
                      key={k}
                      className="rounded bg-canvas px-1.5 py-0.5 text-xs font-medium"
                    >
                      {k}
                    </span>
                  ))}
                </div>
                <p className="mt-1.5 text-sm text-muted">→ {r.reply}</p>
                <div className="mt-1.5 flex gap-2">
                  {r.channels.map((c) => (
                    <span
                      key={c}
                      className="text-[11px]"
                      style={{ color: channelMeta[c].color }}
                    >
                      {channelMeta[c].label}
                    </span>
                  ))}
                </div>
              </div>
              {canManage && (
                <>
                  <button
                    onClick={() => setEditing(r)}
                    className="mt-0.5 text-muted hover:text-ink"
                    aria-label="แก้ไข"
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    onClick={() =>
                      run(
                        () =>
                          api(`/api/auto-replies/${r.id}`, {
                            method: "DELETE",
                          }),
                        "ลบแล้ว",
                      )
                    }
                    className="mt-0.5 text-muted hover:text-hot"
                    aria-label="ลบ"
                  >
                    <Trash2 size={15} />
                  </button>
                </>
              )}
              <Switch
                checked={r.enabled}
                label={`เปิดใช้กฎ ${r.keywords.join(", ")}`}
                onChange={(v) =>
                  canManage &&
                  run(() =>
                    api(`/api/auto-replies/${r.id}`, {
                      method: "PATCH",
                      json: { enabled: v },
                    }),
                  )
                }
              />
            </div>
          ),
        )}
      </Card>
    </div>
  );
}

function RuleForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Rule;
  onSave: (v: Omit<Rule, "id">) => void;
  onCancel: () => void;
}) {
  const [keywords, setKeywords] = useState(
    (initial?.keywords ?? []).join(", "),
  );
  const [reply, setReply] = useState(initial?.reply ?? "");
  const [chs, setChs] = useState<ChannelType[]>(
    initial?.channels ?? ["line", "facebook", "instagram"],
  );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          keywords: keywords
            .split(",")
            .map((k) => k.trim())
            .filter(Boolean),
          reply,
          channels: chs,
          enabled: initial?.enabled ?? true,
        });
      }}
      className="space-y-2 border-t border-line bg-canvas/50 px-5 py-4"
    >
      <input
        required
        value={keywords}
        onChange={(e) => setKeywords(e.target.value)}
        placeholder="คีย์เวิร์ด คั่นด้วยจุลภาค เช่น ราคา, เท่าไหร่"
        className={input}
      />
      <textarea
        required
        rows={2}
        value={reply}
        onChange={(e) => setReply(e.target.value)}
        placeholder="ข้อความตอบกลับ"
        className={input + " resize-none"}
      />
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {(["line", "facebook", "instagram"] as ChannelType[]).map((c) => (
          <label key={c} className="flex items-center gap-1.5">
            <input
              type="checkbox"
              className="accent-brand"
              checked={chs.includes(c)}
              onChange={(e) =>
                setChs(
                  e.target.checked ? [...chs, c] : chs.filter((x) => x !== c),
                )
              }
            />
            {channelMeta[c].label}
          </label>
        ))}
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={onCancel} className={btnGhost}>
            ยกเลิก
          </button>
          <button disabled={!chs.length} className={btnPrimary}>
            บันทึก
          </button>
        </div>
      </div>
    </form>
  );
}

/* ---------------- แท็ก ---------------- */

function TagsSection({
  items,
  canManage,
  run,
}: {
  items: TagRow[];
  canManage: boolean;
  run: Run;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(TAG_COLORS[0]);
  return (
    <Card className="p-5">
      <div className="mb-3 text-sm font-semibold">แท็กคนไข้</div>
      {canManage && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () => api("/api/tags", { method: "POST", json: { name, color } }),
              "สร้างแท็กแล้ว",
            ).then((ok) => ok && setName(""));
          }}
          className="mb-4 flex flex-wrap items-center gap-2"
        >
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="ชื่อแท็กใหม่"
            className={input + " max-w-56"}
          />
          <div className="flex gap-1">
            {TAG_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={c}
                className={cn(
                  "h-6 w-6 rounded-full ring-offset-2",
                  color === c && "ring-2 ring-ink/40",
                )}
                style={{ background: c }}
              />
            ))}
          </div>
          <button className={btnPrimary}>
            <Plus size={15} /> สร้างแท็ก
          </button>
        </form>
      )}
      <div className="divide-y divide-line rounded-lg border border-line">
        {items.map((t) => (
          <div key={t.id} className="flex items-center gap-3 px-3 py-2">
            <TagPill name={t.name} color={t.color} />
            <span className="flex-1 text-xs text-muted">{t.count} คน</span>
            {canManage && (
              <button
                onClick={() =>
                  run(
                    () => api(`/api/tags/${t.id}`, { method: "DELETE" }),
                    "ลบแท็กแล้ว",
                  )
                }
                className="text-muted hover:text-hot"
                aria-label={`ลบแท็ก ${t.name}`}
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ---------------- แผนก ---------------- */

const VIS_OPTIONS = [
  {
    id: "all",
    title: "ทุกคนเห็นทุกแชท",
    body: "เหมาะช่วงเริ่มใช้งานหรือทีมเล็ก — เจ้าหน้าที่ทุกคนเปิดดูแชทของคนไข้ทุกคนได้",
  },
  {
    id: "department",
    title: "เห็นเฉพาะงานของแผนกตัวเอง",
    body: "แนะนำตาม PDPA — เจ้าหน้าที่เห็นงานที่ตัวเองรับผิดชอบ งานของแผนก และงานที่โอนมารอแผนกรับ ผู้ดูแลและแผนกที่ติ๊ก “เห็นทุกแผนก” เห็นทั้งหมด",
  },
] as const;

function DepartmentsSection({
  items,
  visibility,
  canManage,
  run,
}: {
  items: Dept[];
  visibility: "all" | "department";
  canManage: boolean;
  run: Run;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(TAG_COLORS[0]);
  const deptMode = visibility === "department";
  const noCentral = deptMode && !items.some((d) => d.seesAll);
  return (
    <div className="space-y-3">
      <Card className="divide-y divide-line">
        <div className="px-5 py-4">
          <div className="text-sm font-semibold">ใครเห็นแชทได้บ้าง</div>
          <div className="text-xs text-muted">
            มีผลกับหน้าแชท แฟ้มคนไข้ ประวัติการติดต่อ และการค้นหา —
            เจ้าหน้าที่เห็นผลเมื่อโหลดหน้าใหม่
          </div>
        </div>
        <fieldset
          className="grid gap-2 px-5 py-4 sm:grid-cols-2"
          disabled={!canManage}
        >
          <legend className="sr-only">การเห็นแชท</legend>
          {VIS_OPTIONS.map((o) => (
            <label
              key={o.id}
              className={cn(
                "cursor-pointer rounded-xl border p-3 text-sm",
                visibility === o.id
                  ? "border-brand bg-brand-soft"
                  : "border-line hover:border-line-strong",
              )}
            >
              <span className="flex items-center gap-2 font-medium">
                <input
                  type="radio"
                  name="visibility"
                  checked={visibility === o.id}
                  onChange={() =>
                    run(
                      () =>
                        api("/api/settings", {
                          method: "PATCH",
                          json: { visibility: o.id },
                        }),
                      "บันทึกการเห็นแชทแล้ว",
                    )
                  }
                  className="accent-[var(--color-brand)]"
                />
                {o.title}
              </span>
              <span className="mt-1 block text-xs text-muted">{o.body}</span>
            </label>
          ))}
        </fieldset>
        {noCentral && (
          <p className="px-5 py-3 text-xs text-warm">
            ยังไม่มีแผนกที่ “เห็นทุกแผนก” — งานใหม่ที่ยังไม่อยู่แผนกใด (คิวกลาง)
            จะเห็นได้เฉพาะผู้ดูแลและเจ้าหน้าที่ที่ไม่มีแผนก
            ควรติ๊กให้ศูนย์ประสานงาน
          </p>
        )}
      </Card>
      <Card className="overflow-hidden">
        <div className="px-5 py-4">
          <div className="text-sm font-semibold">
            แผนก / หน่วยงานที่รับเรื่อง
          </div>
          <div className="text-xs text-muted">
            ใช้ส่งต่อแชทและบันทึกคำขอนัด — เจ้าหน้าที่ที่สังกัดแผนกจะเห็นแท็บ
            “แผนกฉัน” ในหน้าแชท
          </div>
        </div>
        {canManage && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(
                () =>
                  api("/api/departments", {
                    method: "POST",
                    json: { name, color },
                  }),
                "เพิ่มแผนกแล้ว",
              ).then((ok) => ok && setName(""));
            }}
            className="flex flex-wrap items-center gap-2 border-t border-line bg-sunken/60 px-5 py-3"
          >
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ชื่อแผนก เช่น อายุรกรรม"
              className={input + " max-w-xs"}
            />
            <div className="flex gap-1">
              {TAG_COLORS.map((c) => (
                <button
                  type="button"
                  key={c}
                  onClick={() => setColor(c)}
                  aria-label={`สี ${c}`}
                  className={cn(
                    "h-6 w-6 rounded-md",
                    color === c &&
                      "ring-2 ring-brand ring-offset-2 ring-offset-panel",
                  )}
                  style={{ background: c }}
                />
              ))}
            </div>
            <button className={btnPrimary}>
              <Plus size={15} /> เพิ่มแผนก
            </button>
          </form>
        )}
        {items.map((d) => (
          <div
            key={d.id}
            className="flex items-center gap-3 border-t border-line px-5 py-2.5"
          >
            <span className="h-3 w-3 rounded" style={{ background: d.color }} />
            <span className="flex-1 text-sm">{d.name}</span>
            <span className="text-xs text-muted">{d.users} เจ้าหน้าที่</span>
            {deptMode && (
              <label
                className="flex items-center gap-1 text-xs text-muted"
                title="คนในแผนกนี้เห็นงานของทุกแผนก (เช่น ศูนย์ประสานงานที่คัดกรองงานใหม่)"
              >
                <input
                  type="checkbox"
                  disabled={!canManage}
                  checked={d.seesAll}
                  onChange={(e) =>
                    run(
                      () =>
                        api(`/api/departments/${d.id}`, {
                          method: "PATCH",
                          json: { seesAllCases: e.target.checked },
                        }),
                      "บันทึกแล้ว",
                    )
                  }
                />
                เห็นทุกแผนก
              </label>
            )}
            <label
              className="flex items-center gap-1 text-xs text-muted"
              title="เตือนเมื่องานที่โอนมาไม่มีคนรับเกินกี่นาที (ว่าง = ใช้ค่าขององค์กร)"
            >
              เตือนเมื่อไม่มีคนรับ
              <input
                type="number"
                min={0}
                max={1440}
                disabled={!canManage}
                defaultValue={d.slaMinutes ?? ""}
                placeholder="ค่ากลาง"
                onBlur={(e) => {
                  const v =
                    e.target.value === "" ? null : Number(e.target.value);
                  if (v !== (d.slaMinutes ?? null))
                    run(
                      () =>
                        api(`/api/departments/${d.id}`, {
                          method: "PATCH",
                          json: { transferSlaMinutes: v },
                        }),
                      "บันทึกเวลาเตือนแล้ว",
                    );
                }}
                className="w-16 rounded-md border border-line bg-sunken px-1.5 py-0.5 text-right text-xs"
                aria-label={`เวลาเตือนของแผนก ${d.name} (นาที)`}
              />
              นาที
            </label>
            {canManage && (
              <button
                onClick={() =>
                  window.confirm(
                    `ลบแผนก “${d.name}”? แชทและคำขอนัดของแผนกนี้จะกลายเป็น “ยังไม่ระบุแผนก”`,
                  ) &&
                  run(
                    () => api(`/api/departments/${d.id}`, { method: "DELETE" }),
                    "ลบแผนกแล้ว",
                  )
                }
                className="text-muted hover:text-hot"
                aria-label={`ลบแผนก ${d.name}`}
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
        ))}
      </Card>
    </div>
  );
}

/* ---------------- เรื่องเร่งด่วน ---------------- */

function UrgentSection({
  data,
  canManage,
  run,
}: {
  data: SettingsData;
  canManage: boolean;
  run: Run;
}) {
  const init = data.org.settings.urgent ?? {
    enabled: false,
    keywords: [],
    replyEnabled: false,
    reply: "",
  };
  const [u, setU] = useState(init);
  const [kw, setKw] = useState(init.keywords.join(", "));
  return (
    <Card className="divide-y divide-line">
      <div className="px-5 py-4">
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <div className="text-sm font-medium">ติดป้ายเร่งด่วนอัตโนมัติ</div>
            <div className="text-xs text-muted">
              เมื่อข้อความของคนไข้มีคำในรายการ ระบบจะติดป้าย “เร่งด่วน”
              ย้ายแชทขึ้นบนสุด และแจ้งเจ้าหน้าที่
            </div>
          </div>
          <Switch
            checked={u.enabled}
            onChange={(v) => canManage && setU({ ...u, enabled: v })}
            label="ติดป้ายเร่งด่วนอัตโนมัติ"
          />
        </div>
        <label className="mt-3 block text-xs text-muted">
          คำที่ตรวจจับ (คั่นด้วย ,)
          <textarea
            disabled={!canManage}
            rows={3}
            value={kw}
            onChange={(e) => setKw(e.target.value)}
            className={input + " mt-1 resize-none"}
          />
        </label>
        <p className="mt-2 rounded-lg bg-warm/10 px-3 py-2 text-xs text-warm">
          รายการคำและข้อความด้านล่างเป็นตัวอย่าง —
          ต้องให้ทีมแพทย์/พยาบาลของโรงพยาบาลทบทวนและกำหนดก่อนใช้งานจริง
          ระบบนี้ช่วยคัดกรองข้อความเท่านั้น ไม่ใช่การประเมินอาการ
        </p>
      </div>
      <div className="px-5 py-4">
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <div className="text-sm font-medium">ส่งข้อความแนะนำทันที</div>
            <div className="text-xs text-muted">
              ตอบกลับอัตโนมัติเมื่อระบบติดป้ายเร่งด่วน
              (แทนข้อความต้อนรับ/คีย์เวิร์ด)
            </div>
          </div>
          <Switch
            checked={u.replyEnabled}
            onChange={(v) => canManage && setU({ ...u, replyEnabled: v })}
            label="ส่งข้อความแนะนำทันที"
          />
        </div>
        <textarea
          disabled={!canManage}
          rows={3}
          value={u.reply}
          onChange={(e) => setU({ ...u, reply: e.target.value })}
          className={input + " mt-2 resize-none"}
        />
      </div>
      {canManage && (
        <div className="flex justify-end px-5 py-3">
          <button
            className={btnPrimary}
            onClick={() =>
              run(
                () =>
                  api("/api/settings", {
                    method: "PATCH",
                    json: {
                      urgent: {
                        ...u,
                        keywords: kw
                          .split(/[,\n]/)
                          .map((k) => k.trim())
                          .filter(Boolean),
                      },
                    },
                  }),
                "บันทึกแล้ว",
              )
            }
          >
            บันทึก
          </button>
        </div>
      )}
    </Card>
  );
}

/* ---------------- บันทึกการใช้งาน ---------------- */

const actionText: Record<string, string> = {
  "patient.update": "แก้ไขข้อมูลแฟ้ม",
  "patient.merge": "รวมแฟ้มคนไข้",
  "patient.unmerge": "ยกเลิกการรวมแฟ้ม",
  "patient.not_duplicate": "ยืนยันว่าไม่ใช่คนเดียวกัน",
  "patient.split_contact": "แยกบัญชีออกจากแฟ้ม",
  "conversation.verify": "ยืนยันตัวตนคนไข้",
  "conversation.unverify": "ยกเลิกการยืนยันตัวตน",
  "conversation.urgent": "เปลี่ยนป้ายเร่งด่วน",
  "conversation.transfer": "ส่งต่อแผนก",
  "appointment.create": "บันทึกคำขอนัด",
  "appointment.status": "เปลี่ยนสถานะนัด",
  "case.transfer": "โอนงานไปแผนก",
  "case.close": "ปิดงาน",
  "case.reopen": "เปิดงานอีกครั้ง",
  "case.verify": "ยืนยันตัวตนคนไข้",
  "case.unverify": "ยกเลิกการยืนยันตัวตน",
  "case.urgent": "เปลี่ยนป้ายเร่งด่วน",
  "patient.view_history": "เปิดดูประวัติการติดต่อ",
  "patient.profile_tag": "แก้แท็กคนไข้",
  "his.match": "ค้นข้อมูลคนไข้ใน HIS",
  "his.link": "ผูก HN จาก HIS",
  "his.view": "ดูนัด/การมาโรงพยาบาลจาก HIS",
  "settings.his": "แก้การเชื่อมต่อ HIS",
  "settings.visibility": "เปลี่ยนการเห็นแชท",
  "department.sees_all": "เปลี่ยนสิทธิ์เห็นทุกแผนก",
  "settings.auth": "แก้การตั้งค่าการเข้าสู่ระบบ",
  "auth.login": "เข้าสู่ระบบ",
  "auth.login_failed": "เข้าสู่ระบบไม่สำเร็จ",
  "auth.provision": "สร้างบัญชีจาก AD",
};
const fieldText: Record<string, string> = {
  name: "ชื่อ",
  hn: "HN",
  birthDate: "วันเกิด",
  phone: "เบอร์โทร",
  email: "อีเมล",
};

function AuditSection() {
  const [rows, setRows] = useState<
    | {
        id: string;
        at: string;
        actor: string;
        action: string;
        target: string;
        meta: Record<string, unknown>;
      }[]
    | null
  >(null);
  useEffect(() => {
    api<typeof rows>("/api/audit")
      .then(setRows)
      .catch(() => setRows([]));
  }, []);
  return (
    <Card className="overflow-hidden">
      <div className="px-5 py-4">
        <div className="text-sm font-semibold">บันทึกการใช้งาน</div>
        <div className="text-xs text-muted">
          การกระทำสำคัญกับแฟ้มคนไข้ 100 รายการล่าสุด
          (ไม่เก็บเนื้อหาแชทหรือข้อมูลทางการแพทย์)
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-sunken text-left text-xs text-muted">
            <tr>
              <th className="px-5 py-2 font-medium">เวลา</th>
              <th className="px-5 py-2 font-medium">ผู้ดำเนินการ</th>
              <th className="px-5 py-2 font-medium">การกระทำ</th>
              <th className="px-5 py-2 font-medium">แฟ้ม / รายการ</th>
            </tr>
          </thead>
          <tbody>
            {rows?.length === 0 && (
              <tr>
                <td colSpan={4} className="py-8 text-center text-muted">
                  ยังไม่มีบันทึก
                </td>
              </tr>
            )}
            {rows?.map((r) => {
              const fields = Array.isArray(r.meta.fields)
                ? (r.meta.fields as string[])
                    .map((f) => fieldText[f] ?? f)
                    .join(", ")
                : "";
              const extra =
                fields ||
                (typeof r.meta.method === "string" ? r.meta.method : "") ||
                (typeof r.meta.on === "boolean"
                  ? r.meta.on
                    ? "ติดป้าย"
                    : "ยกเลิก"
                  : "") ||
                (typeof r.meta.add === "string"
                  ? `เพิ่ม “${r.meta.add}”`
                  : typeof r.meta.remove === "string"
                    ? `ลบ “${r.meta.remove}”`
                    : "");
              return (
                <tr key={r.id} className="border-t border-line">
                  <td className="whitespace-nowrap px-5 py-2 font-display text-muted">
                    {new Date(r.at).toLocaleString("th-TH", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </td>
                  <td className="px-5 py-2">{r.actor}</td>
                  <td className="px-5 py-2">
                    {actionText[r.action] ?? r.action}
                    {extra && (
                      <span className="text-xs text-muted"> · {extra}</span>
                    )}
                  </td>
                  <td className="px-5 py-2 text-muted">{r.target}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ---------------- งานและการโอน ---------------- */

function CasesSection({
  data,
  canManage,
  run,
}: {
  data: SettingsData;
  canManage: boolean;
  run: Run;
}) {
  const [c, setC] = useState(data.caseSettings);
  const num = (
    label: string,
    value: number,
    set: (v: number) => void,
    unit: string,
    hint?: string,
  ) => (
    <label className="flex items-center gap-3 px-5 py-3 text-sm">
      <span className="flex-1">
        {label}
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
      <input
        type="number"
        min={0}
        max={1440}
        disabled={!canManage}
        value={value}
        onChange={(e) => set(Number(e.target.value))}
        className="w-20 rounded-lg border border-line bg-sunken px-2 py-1 text-right"
      />
      <span className="w-10 text-xs text-muted">{unit}</span>
    </label>
  );
  return (
    <Card className="divide-y divide-line">
      <div className="px-5 py-4">
        <div className="text-sm font-semibold">งาน: รับ ปิด และโอนแผนก</div>
        <div className="text-xs text-muted">
          ทุกเรื่องที่คนไข้ติดต่อเป็น 1 งาน — ค่าด้านล่างใช้ทั้งองค์กร
          (เวลาเตือนตั้งแยกรายแผนกได้ที่หน้า “แผนก”)
        </div>
      </div>
      {num(
        "ปิดงานอัตโนมัติเมื่อรอคนไข้ตอบเกิน",
        c.autoCloseDays,
        (v) => setC({ ...c, autoCloseDays: v }),
        "วัน",
        "ผลการปิด “คนไข้ไม่ตอบกลับ”",
      )}
      {num(
        "เปิดงานที่ปิดแล้วอีกครั้งได้ภายใน",
        c.reopenDays,
        (v) => setC({ ...c, reopenDays: v }),
        "วัน",
      )}
      {num(
        "งานโอน (ปกติ): เตือนคนในแผนกเมื่อไม่มีคนรับ",
        c.transferSla.normal,
        (v) => setC({ ...c, transferSla: { ...c.transferSla, normal: v } }),
        "นาที",
      )}
      {num(
        "งานโอน (ปกติ): เตือนผู้ส่งและผู้ดูแล",
        c.transferSla.escalateNormal,
        (v) =>
          setC({ ...c, transferSla: { ...c.transferSla, escalateNormal: v } }),
        "นาที",
      )}
      {num(
        "งานโอน (เร่งด่วน): เตือนคนในแผนก",
        c.transferSla.urgent,
        (v) => setC({ ...c, transferSla: { ...c.transferSla, urgent: v } }),
        "นาที",
        "0 = เตือนทันที",
      )}
      {num(
        "งานโอน (เร่งด่วน): เตือนผู้ส่งและผู้ดูแล",
        c.transferSla.escalateUrgent,
        (v) =>
          setC({ ...c, transferSla: { ...c.transferSla, escalateUrgent: v } }),
        "นาที",
      )}
      {canManage && (
        <div className="flex justify-end px-5 py-3">
          <button
            className={btnPrimary}
            onClick={() =>
              run(
                () =>
                  api("/api/settings", { method: "PATCH", json: { cases: c } }),
                "บันทึกแล้ว",
              )
            }
          >
            บันทึก
          </button>
        </div>
      )}
    </Card>
  );
}

/* ---------------- แท็กคนไข้ ---------------- */

const PT_CATS = [
  { id: "need", label: "ความต้องการพิเศษ" },
  { id: "communication", label: "ลักษณะการสื่อสาร" },
  { id: "like", label: "สิ่งที่ชอบ" },
  { id: "dislike", label: "สิ่งที่ไม่ชอบ" },
] as const;

interface PTDef {
  id: string;
  category: (typeof PT_CATS)[number]["id"];
  label: string;
  active: boolean;
  suggested: boolean;
  blocksBroadcast: boolean;
  uses: number;
}

function ProfileTagsSection({
  canManage,
  run,
}: {
  canManage: boolean;
  run: Run;
}) {
  const [defs, setDefs] = useState<PTDef[] | null>(null);
  const [adding, setAdding] = useState<{
    category: PTDef["category"];
    label: string;
  }>({ category: "need", label: "" });
  const load = useCallback(
    () =>
      api<PTDef[]>("/api/profile-tags")
        .then(setDefs)
        .catch(() => setDefs([])),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);
  const act = (fn: () => Promise<unknown>, ok: string) =>
    run(fn, ok).then(async (r) => {
      if (r) await load();
    });
  const suggested = (defs ?? []).filter((d) => d.suggested && d.active);

  return (
    <div className="space-y-3">
      {suggested.length > 0 && (
        <Card className="border-warm/40 p-4">
          <div className="text-sm font-semibold">
            แท็กที่เจ้าหน้าที่เพิ่มเอง รอพิจารณา ({suggested.length})
          </div>
          <p className="text-xs text-muted">
            รับเข้ารายการกลางเพื่อให้ทุกคนเลือกใช้ หรือปิดใช้งานถ้าคำไม่เหมาะสม
          </p>
          <div className="mt-2 space-y-1.5">
            {suggested.map((d) => (
              <div key={d.id} className="flex items-center gap-2 text-sm">
                <span className="rounded-md bg-raised px-1.5 text-[11px] text-muted">
                  {PT_CATS.find((c) => c.id === d.category)?.label}
                </span>
                <span className="flex-1">{d.label}</span>
                <span className="text-xs text-muted">ใช้ {d.uses} คน</span>
                {canManage && (
                  <>
                    <button
                      className="rounded-md border border-ok/50 px-2 py-0.5 text-xs text-ok"
                      onClick={() =>
                        act(
                          () =>
                            api(`/api/profile-tags/${d.id}`, {
                              method: "PATCH",
                              json: { approve: true },
                            }),
                          "รับเข้ารายการแล้ว",
                        )
                      }
                    >
                      รับเข้ารายการ
                    </button>
                    <button
                      className="rounded-md border border-line px-2 py-0.5 text-xs text-muted hover:text-hot"
                      onClick={() =>
                        act(
                          () =>
                            api(`/api/profile-tags/${d.id}`, {
                              method: "PATCH",
                              json: { active: false },
                            }),
                          "ปิดใช้งานแล้ว",
                        )
                      }
                    >
                      ปิดใช้งาน
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
      <Card className="overflow-hidden">
        <div className="px-5 py-4">
          <div className="text-sm font-semibold">รายการแท็กคนไข้</div>
          <div className="text-xs text-muted">
            ใช้คำสุภาพที่บอกสิ่งที่ควรทำ
            ไม่ใส่ข้อมูลทางการแพทย์หรือข้อมูลอ่อนไหว — แท็กที่ตั้ง
            “ไม่รับประกาศ” จะตัดคนไข้ออกจากการส่งประกาศ
          </div>
        </div>
        {canManage && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              act(
                () =>
                  api("/api/profile-tags", { method: "POST", json: adding }),
                "เพิ่มแท็กแล้ว",
              ).then(() => setAdding({ ...adding, label: "" }));
            }}
            className="flex flex-wrap items-center gap-2 border-t border-line bg-sunken/60 px-5 py-3"
          >
            <select
              value={adding.category}
              onChange={(e) =>
                setAdding({
                  ...adding,
                  category: e.target.value as PTDef["category"],
                })
              }
              className={input + " max-w-[180px]"}
            >
              {PT_CATS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            <input
              required
              minLength={2}
              maxLength={60}
              value={adding.label}
              onChange={(e) => setAdding({ ...adding, label: e.target.value })}
              placeholder="เช่น ต้องการล่าม (ภาษาจีน)"
              className={input + " max-w-xs"}
            />
            <button className={btnPrimary}>
              <Plus size={15} /> เพิ่มแท็ก
            </button>
          </form>
        )}
        {PT_CATS.map((c) => (
          <div key={c.id} className="border-t border-line px-5 py-3">
            <div className="mb-2 text-xs font-medium text-faint">{c.label}</div>
            <div className="flex flex-wrap gap-1.5">
              {(defs ?? [])
                .filter((d) => d.category === c.id && !d.suggested)
                .map((d) => (
                  <span
                    key={d.id}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs",
                      d.active
                        ? "border-line"
                        : "border-dashed border-line text-faint line-through",
                    )}
                  >
                    {d.label}
                    <span className="text-faint">{d.uses}</span>
                    {d.blocksBroadcast && (
                      <span className="rounded bg-warm/15 px-1 text-[10px] text-warm">
                        ไม่รับประกาศ
                      </span>
                    )}
                    {canManage && (
                      <button
                        className="text-faint hover:text-ink"
                        onClick={() =>
                          act(
                            () =>
                              api(`/api/profile-tags/${d.id}`, {
                                method: "PATCH",
                                json: { active: !d.active },
                              }),
                            d.active ? "ปิดใช้งานแล้ว" : "เปิดใช้งานแล้ว",
                          )
                        }
                        aria-label={
                          d.active
                            ? `ปิดใช้งาน ${d.label}`
                            : `เปิดใช้งาน ${d.label}`
                        }
                      >
                        {d.active ? "ปิด" : "เปิด"}
                      </button>
                    )}
                  </span>
                ))}
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}

/* ---------------- เชื่อมต่อ HIS ---------------- */

interface HisConf {
  mode: "manual" | "mock" | "live";
  baseUrl: string;
  authType: "none" | "bearer" | "oauth2";
  tokenUrl: string;
  clientId: string;
  hasSecret: boolean;
  timeoutMs: number;
  allowNationalId: boolean;
  breakerOpen?: boolean;
}

const HIS_MODES: { id: HisConf["mode"]; title: string; body: string }[] = [
  {
    id: "manual",
    title: "กรอก HN เอง",
    body: "ไม่เชื่อม HIS — เจ้าหน้าที่พิมพ์ HN เอง ไม่มีข้อมูลนัดและการมาโรงพยาบาล",
  },
  {
    id: "mock",
    title: "ข้อมูลจำลอง",
    body: "ใช้คนไข้สมมติในตัวระบบ เพื่อทดลองขั้นตอนและอบรม — ห้ามใช้ตอนเปิดบริการจริง",
  },
  {
    id: "live",
    title: "เชื่อม HIS Gateway",
    body: "ดึงข้อมูลจริงผ่าน Gateway ของฝ่าย IT (อ่านอย่างเดียว)",
  },
];

function HisSection({ isOwner, run }: { isOwner: boolean; run: Run }) {
  const [c, setC] = useState<HisConf | null>(null);
  const [secret, setSecret] = useState("");
  const [test, setTest] = useState<
    { ok: boolean; detail?: string; ms?: number } | "busy" | null
  >(null);
  const load = useCallback(
    () =>
      api<HisConf>("/api/settings/his")
        .then(setC)
        .catch(() => {}),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);
  if (!c) return <Card className="p-4 text-sm text-muted">กำลังโหลด…</Card>;
  const set = (patch: Partial<HisConf>) => setC({ ...c, ...patch });
  const save = () =>
    run(async () => {
      const r = await api<HisConf>("/api/settings/his", {
        method: "PUT",
        json: {
          mode: c.mode,
          baseUrl: c.baseUrl,
          authType: c.authType,
          tokenUrl: c.tokenUrl,
          clientId: c.clientId,
          timeoutMs: c.timeoutMs,
          allowNationalId: c.allowNationalId,
          ...(secret && { secret }),
        },
      });
      setC(r);
      setSecret("");
      setTest(null);
    }, "บันทึกการเชื่อมต่อ HIS แล้ว — เจ้าหน้าที่เห็นผลเมื่อโหลดหน้าแชทใหม่");
  const runTest = async () => {
    setTest("busy");
    try {
      setTest(
        await api<{ ok: boolean; detail?: string; ms?: number }>(
          "/api/settings/his/test",
          { method: "POST" },
        ),
      );
    } catch (e) {
      setTest({ ok: false, detail: (e as Error).message });
    }
  };
  const ro = !isOwner;

  return (
    <Card className="divide-y divide-line">
      <div className="px-5 py-4">
        <div className="text-sm font-semibold">
          เชื่อมต่อระบบ HIS ของโรงพยาบาล
        </div>
        <div className="text-xs text-muted">
          ใช้ตรวจว่าเป็นคนไข้ของโรงพยาบาล ดูนัด และการมาโรงพยาบาลล่าสุด
          ในแฟ้มคนไข้ — ไม่มีข้อมูลทางคลินิก และไม่เก็บข้อมูลจาก HIS ลงระบบ
        </div>
        {ro && (
          <p className="mt-2 rounded-lg bg-warm/10 px-3 py-2 text-xs text-warm">
            ดูได้อย่างเดียว — แก้การเชื่อมต่อ HIS ได้เฉพาะเจ้าของ
            (มีรหัสเชื่อมต่อ)
          </p>
        )}
        {c.breakerOpen && (
          <p className="mt-2 rounded-lg bg-hot/10 px-3 py-2 text-xs text-hot">
            HIS ไม่ตอบหลายครั้งติดกัน — ระบบหยุดเรียกชั่วคราว 30 วินาที
            เจ้าหน้าที่ยังกรอก HN เองได้ตามปกติ
          </p>
        )}
      </div>

      <fieldset className="grid gap-2 px-5 py-4 sm:grid-cols-3" disabled={ro}>
        <legend className="sr-only">รูปแบบการเชื่อมต่อ</legend>
        {HIS_MODES.map((m) => (
          <label
            key={m.id}
            className={cn(
              "cursor-pointer rounded-xl border p-3 text-sm",
              c.mode === m.id
                ? "border-brand bg-brand-soft"
                : "border-line hover:border-line-strong",
              ro && "cursor-default",
            )}
          >
            <span className="flex items-center gap-2 font-medium">
              <input
                type="radio"
                name="his-mode"
                checked={c.mode === m.id}
                onChange={() => (set({ mode: m.id }), setTest(null))}
                className="accent-[var(--color-brand)]"
              />
              {m.title}
            </span>
            <span className="mt-1 block text-xs text-muted">{m.body}</span>
          </label>
        ))}
      </fieldset>

      {c.mode === "mock" && (
        <div className="px-5 py-4 text-xs text-muted">
          <div className="mb-1 font-medium text-ink">คนไข้สมมติสำหรับทดลอง</div>
          <ul className="list-disc space-y-0.5 pl-5">
            <li>
              HN 6501234 · วันเกิด 14 มี.ค. 2501 — มีนัดอายุรกรรม
              และมาโรงพยาบาลเมื่อ 6 วันก่อน
            </li>
            <li>HN 6209876 · วันเกิด 24 ธ.ค. 2528 — กำลังนอนโรงพยาบาล</li>
            <li>
              สมชาย ใจดี · วันเกิด 15 ม.ค. 2518 · เบอร์อื่น —
              พบหลายรายที่ใกล้เคียง
            </li>
            <li>
              HN 5900456 · วันเกิด 14 มี.ค. 2501 — HN ถูกรวมใน HIS · HN 5800123
              · วันเกิด 2 ก.พ. 2483 — เสียชีวิตแล้ว
            </li>
          </ul>
        </div>
      )}

      {c.mode === "live" && (
        <div className="grid gap-3 px-5 py-4 sm:grid-cols-2">
          <label className="text-xs text-muted sm:col-span-2">
            ที่อยู่ HIS Gateway
            <input
              className={input + " mt-1"}
              disabled={ro}
              value={c.baseUrl}
              onChange={(e) => set({ baseUrl: e.target.value })}
              placeholder="https://his-gateway.hospital.local"
            />
          </label>
          <label className="text-xs text-muted">
            วิธียืนยันตัวระบบ
            <select
              className={input + " mt-1"}
              disabled={ro}
              value={c.authType}
              onChange={(e) =>
                set({ authType: e.target.value as HisConf["authType"] })
              }
            >
              <option value="oauth2">OAuth2 client credentials (แนะนำ)</option>
              <option value="bearer">Bearer token คงที่</option>
              <option value="none">ไม่มี (ทดสอบในเครือข่ายปิดเท่านั้น)</option>
            </select>
          </label>
          <label className="text-xs text-muted">
            เวลารอสูงสุด
            <span className="mt-1 flex items-center gap-2">
              <input
                type="number"
                min={500}
                max={15000}
                step={500}
                className={input}
                disabled={ro}
                value={c.timeoutMs}
                onChange={(e) => set({ timeoutMs: Number(e.target.value) })}
              />
              <span>มิลลิวินาที</span>
            </span>
          </label>
          {c.authType === "oauth2" && (
            <>
              <label className="text-xs text-muted">
                ที่อยู่ขอ token
                <input
                  className={input + " mt-1"}
                  disabled={ro}
                  value={c.tokenUrl}
                  onChange={(e) => set({ tokenUrl: e.target.value })}
                  placeholder="https://his-gateway.hospital.local/oauth/token"
                />
              </label>
              <label className="text-xs text-muted">
                Client ID
                <input
                  className={input + " mt-1"}
                  disabled={ro}
                  value={c.clientId}
                  onChange={(e) => set({ clientId: e.target.value })}
                  autoComplete="off"
                />
              </label>
            </>
          )}
          {c.authType !== "none" && (
            <label className="text-xs text-muted sm:col-span-2">
              {c.authType === "oauth2" ? "Client secret" : "Token"}
              <input
                type="password"
                className={input + " mt-1"}
                disabled={ro}
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                autoComplete="new-password"
                placeholder={
                  c.hasSecret
                    ? "บันทึกไว้แล้ว — เว้นว่างเพื่อใช้ค่าเดิม"
                    : "ใส่รหัสที่ได้จากฝ่าย IT"
                }
              />
              <span className="mt-1 block">
                เข้ารหัสก่อนเก็บ และไม่แสดงกลับบนหน้าจอ
              </span>
            </label>
          )}
        </div>
      )}

      {c.mode !== "manual" && (
        <label className="flex items-start gap-3 px-5 py-3 text-sm">
          <span className="flex-1">
            ให้ค้นด้วยเลขบัตรประชาชนได้
            <span className="block text-xs text-muted">
              ใช้เมื่อคนไข้จำ HN ไม่ได้ — ต้องได้รับอนุมัติจาก DPO ก่อนเปิด
            </span>
          </span>
          <Switch
            checked={c.allowNationalId}
            onChange={(v) => !ro && set({ allowNationalId: v })}
            label="ให้ค้นด้วยเลขบัตรประชาชน"
          />
        </label>
      )}

      <div className="flex flex-wrap items-center gap-2 px-5 py-3">
        {c.mode !== "manual" && (
          <button
            className={btnGhost + " border border-line"}
            onClick={runTest}
            disabled={test === "busy"}
          >
            {test === "busy" ? (
              <Loader2 size={14} className="inline animate-spin" />
            ) : (
              "ทดสอบการเชื่อมต่อ"
            )}
          </button>
        )}
        {test && test !== "busy" && (
          <span
            className={cn(
              "flex items-center gap-1.5 text-sm",
              test.ok ? "text-ok" : "text-hot",
            )}
            role="status"
          >
            {test.ok ? <CircleCheck size={15} /> : <TriangleAlert size={15} />}
            {test.detail}
            {test.ok && test.ms !== undefined && (
              <span className="text-xs text-muted">({test.ms} ms)</span>
            )}
          </span>
        )}
        {isOwner && (
          <button className={btnPrimary + " ml-auto"} onClick={save}>
            บันทึก
          </button>
        )}
      </div>
      {c.mode !== "manual" && (
        <p className="px-5 py-3 text-xs text-muted">
          ทดสอบใช้ค่าที่บันทึกไว้แล้ว — กดบันทึกก่อนทดสอบเมื่อแก้ค่า
        </p>
      )}
    </Card>
  );
}
