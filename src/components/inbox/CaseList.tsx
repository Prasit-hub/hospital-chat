"use client";

import { useEffect, useState } from "react";
import { ArrowDownWideNarrow, ArrowRightLeft, Clock3, CopyCheck, Search, Siren } from "lucide-react";
import type { Case, ChannelType, Contact, Conversation, Patient } from "@/lib/types";
import { useWorkspace } from "./workspace";
import { caseStatusMeta, channelMeta, cn, nowLocal, shortTime } from "@/lib/utils";
import { Avatar, ChannelBadge } from "@/components/ui";

// คิวงาน: 1 การ์ด = 1 งาน (1 เรื่องที่คนไข้ติดต่อ) — เร่งด่วนขึ้นก่อนเสมอ งานโอนที่ไม่มีคนรับเกินกำหนดเป็นสีแดง

export type Queue = "queued" | "mine" | "dept" | "sent" | "waiting" | "open" | "closed";
export type SortMode = "recent" | "waiting";

export interface CaseRow {
  case: Case;
  patient: Patient;
  /** ห้องแชทของคนไข้ เรียงจากที่คนไข้ทักล่าสุด */
  conversations: Conversation[];
  contact: Contact;
  unread: number;
  lastMessage: string;
  lastMessageAt: string;
  lastCustomerMessageAt?: string;
  channelTypes: ChannelType[];
}

const minutesBetween = (a: string, b: string) => Math.max(0, Math.floor((new Date(b + "Z").getTime() - new Date(a + "Z").getTime()) / 60_000));

/** นาทีที่คนไข้รอคำตอบ (null = ไม่ได้รอ) */
export function waitingMinutes(r: Pick<CaseRow, "lastCustomerMessageAt" | "lastMessage" | "case">, now: string): number | null {
  if (r.case.status === "closed" || r.case.status === "waiting_patient" || !r.lastCustomerMessageAt) return null;
  if (r.lastMessage.startsWith("คุณ:")) return null;
  return minutesBetween(r.lastCustomerMessageAt, now);
}

export function waitLabel(min: number) {
  if (min < 1) return "เพิ่งทัก";
  if (min < 60) return `รอ ${min} นาที`;
  if (min < 60 * 24) return `รอ ${Math.floor(min / 60)} ชม.`;
  return `รอ ${Math.floor(min / 1440)} วัน`;
}

export function waitTone(min: number) {
  return min < 5 ? "cyan" : min < 30 ? "warm" : "hot";
}

/** งานที่โอนไปแล้วไม่มีคนรับ: นาทีที่รอ + เกินเวลาเตือนหรือยัง */
export function transferWait(c: Case, now: string, sla: { normal: number; urgent: number }, deptSla?: number) {
  if (!c.pendingTransfer) return null;
  const min = minutesBetween(c.pendingTransfer.createdAt, now);
  const limit = c.urgent ? sla.urgent : (deptSla ?? sla.normal);
  return { min, overdue: min >= limit };
}

/** เวลาปัจจุบันที่เดินเองทุก 30 วินาที */
export function useNow() {
  const [now, setNow] = useState(() => nowLocal());
  useEffect(() => {
    const t = setInterval(() => setNow(nowLocal()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

interface Props {
  rows: CaseRow[];
  counts: Record<Queue, number>;
  queue: Queue;
  setQueue: (q: Queue) => void;
  hasDept: boolean;
  duplicates: Record<string, number>;
  selectedId?: string;
  onSelect: (id: string) => void;
  channelFilter: ChannelType | "all";
  setChannelFilter: (c: ChannelType | "all") => void;
  sort: SortMode;
  setSort: (s: SortMode) => void;
  query: string;
  setQuery: (q: string) => void;
  urgentCount: number;
  overdueCount: number;
  urgentOnly: boolean;
  setUrgentOnly: (v: boolean) => void;
  now: string;
  className?: string;
}

export function CaseList(p: Props) {
  const { channels, agents, departments, me, caseSettings } = useWorkspace();
  const channelTypes = Array.from(new Set(channels.filter((c) => c.connected).map((c) => c.type)));
  const deptName = (id?: string) => departments.find((d) => d.id === id)?.name;

  const big: { id: Queue; label: string }[] = [
    { id: "queued", label: "รอรับ" },
    { id: "mine", label: "งานของฉัน" },
    p.hasDept ? { id: "dept", label: "คิวแผนกฉัน" } : { id: "waiting", label: "รอคนไข้ตอบ" },
  ];
  const small: { id: Queue; label: string }[] = [
    { id: "open", label: "ทั้งหมดที่เปิด" },
    { id: "sent", label: "ส่งต่อแล้ว" },
    ...(p.hasDept ? [{ id: "waiting" as Queue, label: "รอคนไข้" }] : []),
    { id: "closed", label: "ปิดแล้ว" },
  ];

  return (
    <section className={cn("flex w-full flex-col border-r border-line bg-panel/60 md:w-[372px] md:shrink-0", p.className)} aria-label="คิวงาน">
      <div className="space-y-3 px-3 pb-3 pt-3">
        <div className="grid grid-cols-3 gap-1.5">
          {big.map((s) => {
            const active = p.queue === s.id;
            const alert = s.id === "dept" && p.overdueCount > 0;
            return (
              <button
                key={s.id}
                onClick={() => p.setQueue(s.id)}
                aria-pressed={active}
                className={cn(
                  "rounded-xl border px-3 py-2 text-left transition-colors",
                  active ? "border-brand/60 bg-brand-soft" : alert ? "border-hot/50 bg-hot/10" : "border-line bg-sunken hover:border-line-strong",
                )}
              >
                <div className={cn("font-display text-[22px] font-semibold leading-none", active ? "text-brand" : alert ? "text-hot" : "text-ink")}>{p.counts[s.id]}</div>
                <div className="mt-1 text-[11px] text-muted">{s.label}</div>
              </button>
            );
          })}
        </div>

        {p.urgentCount > 0 && p.queue !== "closed" && (
          <button
            onClick={() => p.setUrgentOnly(!p.urgentOnly)}
            aria-pressed={p.urgentOnly}
            className={cn(
              "flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-[13px] font-medium",
              p.urgentOnly ? "border-hot bg-hot text-brand-ink" : "border-hot/40 bg-hot/10 text-hot",
            )}
          >
            <Siren size={15} />
            เรื่องเร่งด่วน {p.urgentCount} งาน
            <span className="ml-auto text-xs font-normal underline-offset-2 hover:underline">{p.urgentOnly ? "ดูทั้งหมด" : "ดูเฉพาะเร่งด่วน"}</span>
          </button>
        )}
        {p.overdueCount > 0 && (
          <button
            onClick={() => p.setQueue("dept")}
            className="flex w-full items-center gap-2 rounded-xl border border-hot/40 bg-hot/10 px-3 py-2 text-left text-[13px] text-hot"
          >
            <ArrowRightLeft size={15} />
            งานโอนมาที่แผนกฉัน ยังไม่มีคนรับเกินกำหนด {p.overdueCount} งาน
          </button>
        )}

        <label className="flex items-center gap-2 rounded-xl border border-line bg-sunken px-3 py-2 text-sm focus-within:border-brand/60">
          <Search size={15} className="text-muted" />
          <input
            value={p.query}
            onChange={(e) => p.setQuery(e.target.value)}
            placeholder="ค้นหาชื่อ HN เลขงาน หรือข้อความ"
            className="w-full bg-transparent outline-none placeholder:text-faint"
          />
        </label>

        <div className="flex items-center gap-1 overflow-x-auto thin-scroll pb-0.5">
          <Chip active={p.channelFilter === "all"} onClick={() => p.setChannelFilter("all")}>
            ทุกช่องทาง
          </Chip>
          {channelTypes.map((t) => (
            <Chip key={t} active={p.channelFilter === t} onClick={() => p.setChannelFilter(t)} color={channelMeta[t].color}>
              {channelMeta[t].label}
            </Chip>
          ))}
        </div>

        <div className="flex items-center gap-0.5 overflow-x-auto thin-scroll text-[12px]">
          {small.map((t) => (
            <button
              key={t.id}
              onClick={() => p.setQueue(t.id)}
              aria-pressed={p.queue === t.id}
              className={cn("whitespace-nowrap rounded-lg px-2 py-1 transition-colors", p.queue === t.id ? "bg-raised text-ink" : "text-muted hover:text-ink")}
            >
              {t.label}
              {p.counts[t.id] > 0 && <span className="ml-1 font-display text-faint">{p.counts[t.id]}</span>}
            </button>
          ))}
          <button
            onClick={() => p.setSort(p.sort === "waiting" ? "recent" : "waiting")}
            title={p.sort === "waiting" ? "เรียงตามรอนานสุด" : "เรียงตามล่าสุด"}
            className={cn("ml-auto rounded-lg p-1", p.sort === "waiting" ? "text-warm" : "text-muted hover:text-ink")}
            aria-label="สลับการเรียงลำดับ"
          >
            <ArrowDownWideNarrow size={15} />
          </button>
        </div>
      </div>

      <ul className="flex-1 space-y-1.5 overflow-y-auto px-2 pb-3 thin-scroll">
        {p.rows.length === 0 && <li className="px-6 py-16 text-center text-sm text-muted">{emptyText[p.queue]}</li>}
        {p.rows.map((r) => {
          const c = r.case;
          const owner = agents.find((a) => a.id === c.ownerId);
          const selected = c.id === p.selectedId;
          const wait = waitingMinutes(r, p.now);
          const tone = wait != null ? waitTone(wait) : null;
          const tw = transferWait(c, p.now, caseSettings.transferSla, departments.find((d) => d.id === c.pendingTransfer?.toDeptId)?.slaMinutes);
          const dup = p.duplicates[r.patient.id] ?? 0;
          const stripe = channelMeta[r.channelTypes[0] ?? "line"].color;
          const st = caseStatusMeta[c.status];
          const toMe = c.pendingTransfer && c.pendingTransfer.toDeptId === me.departmentId;
          return (
            <li key={c.id}>
              <button
                onClick={() => p.onSelect(c.id)}
                className={cn(
                  "group relative flex w-full gap-3 overflow-hidden rounded-xl border py-2.5 pl-4 pr-3 text-left transition-colors",
                  selected
                    ? "border-brand/50 bg-raised shadow-[0_0_0_1px_rgb(var(--brand-rgb)/0.25),0_8px_24px_rgb(var(--shade-rgb)/calc(0.35*var(--shade-k)))]"
                    : (c.urgent && c.status !== "closed") || tw?.overdue
                      ? "border-hot/40 bg-hot/5 hover:bg-hot/10"
                      : "border-transparent hover:border-line hover:bg-raised/60",
                )}
              >
                <span className="absolute inset-y-2 left-1 w-[3px] rounded-full" style={{ background: stripe }} />
                <Avatar name={r.patient.name} color={r.patient.avatarColor} src={r.contact.pictureUrl} channel={r.channelTypes[0]} size={40} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-1.5">
                    <span className={cn("truncate text-[14px]", r.unread ? "font-semibold text-ink" : "text-ink/90")}>{r.patient.name}</span>
                    {r.patient.hn && <span className="shrink-0 font-display text-[10.5px] text-faint">HN {r.patient.hn}</span>}
                    <span className="ml-auto shrink-0 font-display text-[11px] text-faint">{shortTime(c.status === "closed" && c.closedAt ? c.closedAt : r.lastMessageAt)}</span>
                  </div>
                  <p className={cn("mt-0.5 line-clamp-2 text-[12.5px] leading-snug", r.unread ? "text-ink/85" : "text-muted")}>{r.lastMessage}</p>
                  <div className="mt-2 flex min-w-0 items-center gap-1.5">
                    {c.urgent && c.status !== "closed" && (
                      <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md bg-hot px-1.5 py-0.5 text-[11px] font-semibold text-brand-ink">
                        <Siren size={11} /> เร่งด่วน
                      </span>
                    )}
                    {tw ? (
                      <span
                        className={cn(
                          "inline-flex min-w-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px]",
                          tw.overdue ? "bg-hot/15 font-medium text-hot" : "bg-warm/15 text-warm",
                        )}
                        title={`โอนไป${deptName(c.pendingTransfer!.toDeptId) ?? ""}: ${c.pendingTransfer!.reason}`}
                      >
                        <ArrowRightLeft size={11} className="shrink-0" />
                        <span className="truncate">
                          {toMe ? "โอนมาที่แผนกฉัน" : deptName(c.pendingTransfer!.toDeptId)} · {tw.min} นาที
                        </span>
                      </span>
                    ) : (
                      <span className={cn("inline-flex shrink-0 items-center whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px]", st.cls)}>{st.short}</span>
                    )}
                    {wait != null && !tw && (
                      <span
                        className={cn(
                          "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 font-display text-[11px] font-medium",
                          tone === "cyan" && "bg-brand-soft text-brand",
                          tone === "warm" && "bg-warm/15 text-warm",
                          tone === "hot" && "bg-hot/15 text-hot",
                        )}
                      >
                        <Clock3 size={11} />
                        {waitLabel(wait)}
                      </span>
                    )}
                    <span className="ml-auto flex shrink-0 items-center gap-1.5">
                      {r.channelTypes.length > 1 && (
                        <span className="flex items-center gap-0.5" title="แฟ้มนี้รวมหลายช่องทาง">
                          {r.channelTypes.slice(1, 4).map((t, i) => (
                            <ChannelBadge key={i} type={t} size="xs" />
                          ))}
                        </span>
                      )}
                      {dup > 0 && (
                        <span title={`อาจซ้ำกับแฟ้มอื่น ${dup} แฟ้ม — ตรวจสอบเพื่อรวมแฟ้ม`} className="text-warm">
                          <CopyCheck size={14} aria-label="อาจมีแฟ้มซ้ำ" />
                        </span>
                      )}
                      {r.unread > 0 && (
                        <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-md bg-warm px-1 font-display text-[11px] font-semibold text-brand-ink">
                          {r.unread}
                        </span>
                      )}
                      {owner ? (
                        <span
                          title={`ผู้รับผิดชอบ: ${owner.name}`}
                          className="flex h-[18px] w-[18px] items-center justify-center rounded-[6px] font-display text-[9px] font-bold"
                          style={{ background: owner.color + "33", color: owner.color, boxShadow: `inset 0 0 0 1px ${owner.color}66` }}
                        >
                          {owner.name.slice(0, 1)}
                        </span>
                      ) : (
                        <span title="ยังไม่มีผู้รับผิดชอบ" className="h-[18px] w-[18px] rounded-[6px] border border-dashed border-line-strong" />
                      )}
                    </span>
                  </div>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const emptyText: Record<Queue, string> = {
  queued: "ไม่มีงานรอรับ",
  mine: "ยังไม่มีงานที่คุณรับผิดชอบ — รับงานจากคิว “รอรับ” ได้เลย",
  dept: "ไม่มีงานโอนมาที่แผนกของคุณ",
  sent: "ไม่มีงานที่คุณโอนไปแล้วรอแผนกรับ",
  waiting: "ไม่มีงานที่รอคนไข้ตอบ",
  open: "ไม่มีงานที่เปิดอยู่ตามตัวกรองนี้",
  closed: "ไม่มีงานที่ปิดใน 7 วันที่ผ่านมา",
};

function Chip({ active, onClick, children, color }: { active: boolean; onClick: () => void; children: React.ReactNode; color?: string }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-1 text-[12px] transition-colors",
        active ? "border-brand/60 bg-brand-soft text-brand" : "border-line text-muted hover:border-line-strong hover:text-ink",
      )}
    >
      {color && <span className="h-2 w-2 rounded-sm" style={{ background: color }} />}
      {children}
    </button>
  );
}
