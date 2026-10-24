"use client";

import { useEffect, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { CaseOutcome, ChannelType, InquiryCategory } from "@/lib/types";
import { categoryMeta, channelMeta, cn, outcomeMeta } from "@/lib/utils";
import { Avatar, Card, PageHeader } from "@/components/ui";
import { api } from "@/components/inbox/workspace";

type Range = "today" | "7d" | "30d";

interface Kpis {
  chats: number;
  newContacts: number;
  closed: number;
  avgFirstResponseMin: number | null;
  appointments: number;
  urgent: number;
  opened: number;
  avgAcceptMin: number | null;
}
interface Data {
  current: Kpis;
  previous: Kpis;
  byHour: number[];
  byChannel: { type: ChannelType; chats: number }[];
  byCategory: { category: InquiryCategory | null; chats: number }[];
  byDepartment: { id: string | null; name: string; color: string; chats: number }[];
  byOutcome: { outcome: CaseOutcome; cases: number }[];
  transfers: { deptId: string | null; name: string; color: string; count: number; returned: number; avgAcceptMin: number | null }[];
  agents: { id: string; name: string; color: string; online: boolean; messages: number; chats: number; avgResponseMin: number | null }[];
}

const rangeLabel: Record<Range, { label: string; compare: string }> = {
  today: { label: "วันนี้", compare: "เมื่อวาน" },
  "7d": { label: "7 วันล่าสุด", compare: "7 วันก่อนหน้า" },
  "30d": { label: "30 วันล่าสุด", compare: "30 วันก่อนหน้า" },
};

function Delta({ now, before, lowerIsBetter, neutral, compare }: { now: number | null; before: number | null; lowerIsBetter?: boolean; neutral?: boolean; compare: string }) {
  if (now == null || before == null || before === 0) {
    return <div className="mt-1 flex items-center gap-1 text-xs text-muted"><Minus size={12} /> ไม่มีข้อมูลเทียบ{compare}</div>;
  }
  const pct = ((now - before) / before) * 100;
  if (Math.abs(pct) < 0.5) return <div className="mt-1 text-xs text-muted">เท่ากับ{compare}</div>;
  const good = lowerIsBetter ? pct < 0 : pct > 0;
  return (
    <div className={cn("mt-1 flex items-center gap-0.5 text-xs font-medium", neutral ? "text-muted" : good ? "text-ok" : "text-hot")}>
      {pct > 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
      {Math.abs(pct).toFixed(0)}% <span className="ml-1 font-normal text-muted">จาก{compare}</span>
    </div>
  );
}

export default function DashboardPage() {
  const [range, setRange] = useState<Range>("today");
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    api<Data>(`/api/dashboard?range=${range}`).then(setData).catch((e) => setError(e.message));
  }, [range]);

  const c = data?.current;
  const p = data?.previous;
  const cmp = rangeLabel[range].compare;
  const kpis = c && p
    ? [
        { label: "งานใหม่", value: c.opened.toLocaleString(), now: c.opened, before: p.opened },
        { label: "งานที่ปิด", value: c.closed.toLocaleString(), now: c.closed, before: p.closed },
        {
          label: "เวลารอรับงานเฉลี่ย",
          value: c.avgAcceptMin == null ? "—" : `${c.avgAcceptMin} นาที`,
          now: c.avgAcceptMin,
          before: p.avgAcceptMin,
          lowerIsBetter: true,
        },
        {
          label: "เวลาตอบครั้งแรกเฉลี่ย",
          value: c.avgFirstResponseMin == null ? "—" : `${c.avgFirstResponseMin} นาที`,
          now: c.avgFirstResponseMin,
          before: p.avgFirstResponseMin,
          lowerIsBetter: true,
        },
        { label: "คำขอนัดหมาย", value: c.appointments.toLocaleString(), now: c.appointments, before: p.appointments },
        { label: "เรื่องเร่งด่วน", value: c.urgent.toLocaleString(), now: c.urgent, before: p.urgent, neutral: true },
      ]
    : [];
  const maxHour = Math.max(1, ...(data?.byHour ?? [0]));
  const totalCh = data?.byChannel.reduce((a, x) => a + x.chats, 0) ?? 0;
  const maxCh = Math.max(1, ...(data?.byChannel.map((x) => x.chats) ?? [0]));
  const peak = data ? data.byHour.indexOf(Math.max(...data.byHour)) : -1;

  return (
    <div className="flex-1 overflow-y-auto thin-scroll">
      <PageHeader
        title="รายงานภาพรวม"
        subtitle={`${rangeLabel[range].label} เทียบกับ${cmp}`}
        actions={
          <select value={range} onChange={(e) => setRange(e.target.value as Range)} className="rounded-xl border border-line bg-sunken px-3 py-1.5 text-sm">
            {(Object.keys(rangeLabel) as Range[]).map((r) => (
              <option key={r} value={r}>
                {rangeLabel[r].label}
              </option>
            ))}
          </select>
        }
      />
      {error && <p className="p-6 text-sm text-hot">{error}</p>}
      <div className={cn("space-y-5 p-4 transition-opacity sm:p-6", !data && "opacity-50")}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
          {(kpis.length ? kpis : Array.from({ length: 6 }, (_, i) => ({ label: "…", value: "…", now: null, before: null, key: i }))).map((k) => (
            <Card key={k.label + ("key" in k ? k.key : "")} className="p-4">
              <div className="text-xs text-muted">{k.label}</div>
              <div className="mt-1.5 font-display text-[28px] font-semibold leading-none text-ink">{k.value}</div>
              {data && <Delta now={k.now} before={k.before} lowerIsBetter={"lowerIsBetter" in k && !!k.lowerIsBetter} neutral={"neutral" in k && !!k.neutral} compare={cmp} />}
            </Card>
          ))}
        </div>

        <div className="grid gap-5 lg:grid-cols-5">
          <Card className="p-5 lg:col-span-3">
            <h2 className="font-display text-[15px] font-semibold">ข้อความจากคนไข้รายชั่วโมง</h2>
            <p className="text-xs text-muted">{data && Math.max(...data.byHour) > 0 ? `ช่วงที่คนไข้ทักมากที่สุดคือ ${String(peak).padStart(2, "0")}:00 น.` : "ยังไม่มีข้อความในช่วงนี้"}</p>
            <div className="mt-5 flex h-44 items-end gap-[3px]">
              {(data?.byHour ?? Array(24).fill(0)).map((v, h) => (
                <div key={h} className="group relative flex h-full flex-1 flex-col items-center justify-end">
                  <span className="pointer-events-none absolute -top-5 hidden rounded-md border border-line-strong bg-raised px-1.5 font-display text-[10px] text-ink group-hover:block">
                    {String(h).padStart(2, "0")}:00 · {v}
                  </span>
                  <div className="w-full rounded-t-[3px] bg-gradient-to-t from-brand/30 to-brand transition-[filter] group-hover:brightness-125 group-hover:shadow-[0_0_12px_rgb(var(--brand-rgb)/0.6)]" style={{ height: `${(v / maxHour) * 100}%`, minHeight: v ? 2 : 0 }} />
                </div>
              ))}
            </div>
            <div className="mt-1.5 flex justify-between text-[10px] text-muted">
              {["00", "06", "12", "18", "23"].map((t) => (
                <span key={t}>{t}:00</span>
              ))}
            </div>
          </Card>

          <Card className="p-5 lg:col-span-2">
            <h2 className="font-display text-[15px] font-semibold">แชทแยกตามช่องทาง</h2>
            <p className="text-xs text-muted">รวม {totalCh.toLocaleString()} แชท</p>
            <div className="mt-5 space-y-4">
              {(data?.byChannel ?? []).map((x) => {
                const m = channelMeta[x.type];
                return (
                  <div key={x.type}>
                    <div className="mb-1 flex justify-between text-sm">
                      <span className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: m.color }} />
                        {m.label}
                      </span>
                      <span className="font-display text-muted">
                        {x.chats} {totalCh > 0 && <span className="text-xs">({Math.round((x.chats / totalCh) * 100)}%)</span>}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-sunken">
                      <div className="h-2 rounded-full" style={{ width: `${(x.chats / maxCh) * 100}%`, background: m.color }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <Bars
            title="งานแยกตามหมวดเรื่อง"
            empty="ยังไม่มีงานในช่วงนี้"
            rows={(data?.byCategory ?? []).map((x) => ({
              key: x.category ?? "none",
              label: x.category ? categoryMeta[x.category].label : "ยังไม่ระบุหมวด",
              color: x.category ? categoryMeta[x.category].color : "#94a3b8",
              value: x.chats,
            }))}
          />
          <Bars
            title="งานแยกตามแผนกที่รับผิดชอบ"
            empty="ยังไม่มีงานในช่วงนี้"
            rows={(data?.byDepartment ?? []).filter((x) => x.chats > 0 || x.id === null).map((x) => ({ key: x.id ?? "none", label: x.name, color: x.color, value: x.chats }))}
          />
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <Bars
            title="ผลการปิดงาน"
            empty="ยังไม่มีงานที่ปิดในช่วงนี้"
            rows={(data?.byOutcome ?? []).map((x, i) => ({
              key: x.outcome,
              label: outcomeMeta[x.outcome]?.label ?? x.outcome,
              color: ["#0ea5e9", "#22c55e", "#ef4444", "#8b5cf6", "#f59e0b", "#64748b", "#14b8a6"][i % 7],
              value: x.cases,
            }))}
          />
          <Card className="overflow-hidden">
            <div className="px-5 py-4">
              <h2 className="font-display text-[15px] font-semibold">การโอนงานเข้าแผนก</h2>
              <p className="text-xs text-muted">จำนวนที่โอนเข้า ถูกตีกลับ และเวลารอแผนกกดรับเฉลี่ย</p>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-sunken text-left text-xs text-muted">
                <tr>
                  <th className="px-5 py-2 font-medium">แผนก</th>
                  <th className="px-5 py-2 text-right font-medium">โอนเข้า</th>
                  <th className="px-5 py-2 text-right font-medium">ตีกลับ</th>
                  <th className="px-5 py-2 text-right font-medium">รอรับเฉลี่ย</th>
                </tr>
              </thead>
              <tbody>
                {data && data.transfers.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-5 py-6 text-center text-xs text-muted">ยังไม่มีการโอนงานในช่วงนี้</td>
                  </tr>
                )}
                {data?.transfers.map((t) => (
                  <tr key={t.deptId ?? "none"} className="border-t border-line">
                    <td className="px-5 py-2">
                      <span className="mr-2 inline-block h-2 w-2 rounded-sm" style={{ background: t.color }} />
                      {t.name}
                    </td>
                    <td className="px-5 py-2 text-right font-display">{t.count}</td>
                    <td className={cn("px-5 py-2 text-right font-display", t.returned > 0 && "text-warm")}>{t.returned}</td>
                    <td className="px-5 py-2 text-right font-display">{t.avgAcceptMin == null ? "—" : `${t.avgAcceptMin} นาที`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>

        <Card className="overflow-hidden">
          <div className="px-5 py-4">
            <h2 className="font-display text-[15px] font-semibold">ผลงานเจ้าหน้าที่</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-sunken text-left text-xs text-muted">
                <tr>
                  <th className="px-5 py-2 font-medium">เจ้าหน้าที่</th>
                  <th className="px-5 py-2 text-right font-medium">แชทที่ตอบ</th>
                  <th className="px-5 py-2 text-right font-medium">ข้อความที่ส่ง</th>
                  <th className="px-5 py-2 text-right font-medium">เวลาตอบเฉลี่ย</th>
                </tr>
              </thead>
              <tbody>
                {data?.agents.map((a) => (
                  <tr key={a.id} className="border-t border-line">
                    <td className="px-5 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={a.name} color={a.color} size={28} online={a.online} />
                        {a.name}
                      </div>
                    </td>
                    <td className="px-5 py-2.5 text-right font-display">{a.chats}</td>
                    <td className="px-5 py-2.5 text-right font-display">{a.messages}</td>
                    <td className="px-5 py-2.5 text-right font-display">{a.avgResponseMin == null ? "—" : `${a.avgResponseMin} นาที`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Bars({ title, rows, empty }: { title: string; rows: { key: string; label: string; color: string; value: number }[]; empty: string }) {
  const total = rows.reduce((a, r) => a + r.value, 0);
  const max = Math.max(1, ...rows.map((r) => r.value));
  const sorted = [...rows].sort((a, b) => b.value - a.value);
  return (
    <Card className="p-5">
      <h2 className="font-display text-[15px] font-semibold">{title}</h2>
      <p className="text-xs text-muted">{total ? `รวม ${total.toLocaleString()} งาน` : empty}</p>
      <div className="mt-4 space-y-2.5">
        {sorted.map((r) => (
          <div key={r.key} className="grid grid-cols-[150px_1fr_44px] items-center gap-3 text-sm">
            <span className="truncate" title={r.label}>{r.label}</span>
            <div className="h-2 rounded-full bg-sunken">
              <div className="h-2 rounded-full" style={{ width: `${(r.value / max) * 100}%`, background: r.color, minWidth: r.value ? 4 : 0 }} />
            </div>
            <span className="text-right font-display text-muted">{r.value}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
