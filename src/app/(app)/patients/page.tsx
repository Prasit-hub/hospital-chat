"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CopyCheck, History, Loader2, MessageSquare, Search, Undo2, Users } from "lucide-react";
import type { Channel, Contact, MergeCandidate, Patient, Tag } from "@/lib/types";
import { birthLabel, channelMeta, cn, maskPhone, shortTime, thaiDate } from "@/lib/utils";
import { toLocalIso } from "@/lib/time";
import { Avatar, Card, ChannelTag, PageHeader, TagPill } from "@/components/ui";
import { MergeDialog } from "@/components/MergeDialog";
import { api } from "@/components/inbox/workspace";

type Row = Patient & { lastContactAt?: string };
type Tab = "list" | "suggest" | "history";
interface MergeEventRow {
  id: string;
  survivor: { id: string; name?: string; hn?: string };
  merged: { id: string; name?: string };
  contacts: number;
  reason?: string;
  actor?: string;
  at: string;
  undoneAt?: string;
  undoneBy?: string;
}

export default function PatientsPage() {
  const [tab, setTab] = useState<Tab>("list");
  const [q, setQ] = useState("");
  const [tag, setTag] = useState("all");
  const [list, setList] = useState<{ patients: Row[]; contacts: Contact[]; channels: Channel[]; tags: Tag[] } | null>(null);
  const [sugg, setSugg] = useState<{ candidates: MergeCandidate[]; patients: Patient[]; contacts: Contact[] } | null>(null);
  const [hist, setHist] = useState<{ events: MergeEventRow[]; canUndo: boolean } | null>(null);
  const [merge, setMerge] = useState<{ base: string; other?: string } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(() => {
    api<typeof list>("/api/patients").then(setList).catch((e) => setMsg({ ok: false, text: e.message }));
    api<typeof sugg>("/api/patients/candidates").then(setSugg).catch(() => {});
    api<typeof hist>("/api/patients/merge").then(setHist).catch(() => {});
  }, []);
  useEffect(load, [load]);

  const contacts = useMemo(() => Object.fromEntries([...(list?.contacts ?? []), ...(sugg?.contacts ?? [])].map((c) => [c.id, c])), [list, sugg]);
  const channels = list?.channels ?? [];
  const chOf = (contactId: string) => channels.find((c) => c.id === contacts[contactId]?.channelId);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (list?.patients ?? []).filter(
      (p) =>
        (tag === "all" || p.tagIds.includes(tag)) &&
        (!s ||
          [p.name, p.hn, p.phone, p.email, ...p.contactIds.map((id) => contacts[id]?.name)].some((v) => v?.toLowerCase().includes(s))),
    );
  }, [list, q, tag, contacts]);

  const openSuggestions = (sugg?.candidates ?? []).filter((c) => !c.blocked);
  const pool = Object.fromEntries((sugg?.patients ?? []).map((p) => [p.id, p]));

  async function undo(id: string) {
    if (!window.confirm("ยกเลิกการรวมแฟ้มนี้? บัญชีช่องทางและนัดหมายที่ย้ายมาจะกลับไปอยู่แฟ้มเดิม")) return;
    try {
      await api(`/api/patients/merge/${id}/undo`, { method: "POST" });
      setMsg({ ok: true, text: "ยกเลิกการรวมแฟ้มแล้ว" });
      load();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }

  async function notSame(c: MergeCandidate) {
    try {
      await api("/api/patients/dismiss", { method: "POST", json: { aId: c.aId, bId: c.bId } });
      load();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }

  const tabs: { id: Tab; label: string; icon: typeof Users; count?: number }[] = [
    { id: "list", label: "แฟ้มคนไข้", icon: Users, count: list?.patients.length },
    { id: "suggest", label: "แนะนำให้รวม", icon: CopyCheck, count: openSuggestions.length },
    { id: "history", label: "ประวัติการรวม", icon: History },
  ];

  return (
    <div className="flex-1 overflow-y-auto thin-scroll">
      <PageHeader title="คนไข้" subtitle="หนึ่งแฟ้มต่อหนึ่งคน — รวมทุกช่องทางที่คนไข้ติดต่อเข้ามา" />
      <div className="px-4 sm:px-6">
        <div className="flex gap-1 border-b border-line" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm transition-colors",
                tab === t.id ? "border-brand font-medium text-ink" : "border-transparent text-muted hover:text-ink",
              )}
            >
              <t.icon size={15} />
              {t.label}
              {t.count != null && t.count > 0 && (
                <span className={cn("rounded-md px-1.5 font-display text-[11px]", t.id === "suggest" ? "bg-warm/15 text-warm" : "bg-raised text-muted")}>{t.count}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {msg && <p className={cn("mx-4 mt-4 rounded-xl px-3 py-2 text-sm sm:mx-6", msg.ok ? "bg-ok/10 text-ok" : "bg-hot/10 text-hot")}>{msg.text}</p>}

      <div className="p-4 sm:p-6">
        {tab === "list" && (
          <>
            <div className="mb-4 flex flex-wrap gap-2">
              <label className="flex min-w-60 flex-1 items-center gap-2 rounded-xl border border-line bg-sunken px-3 py-2 text-sm focus-within:border-brand/60">
                <Search size={16} className="text-muted" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาชื่อ HN เบอร์โทร อีเมล หรือชื่อในช่องทาง" className="w-full bg-transparent outline-none placeholder:text-faint" />
              </label>
              <select value={tag} onChange={(e) => setTag(e.target.value)} className="rounded-xl border border-line bg-sunken px-3 text-sm" aria-label="กรองตามแท็ก">
                <option value="all">ทุกแท็ก</option>
                {list?.tags.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] text-sm">
                  <thead className="bg-sunken text-left text-xs text-muted">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">คนไข้</th>
                      <th className="px-4 py-2.5 font-medium">ช่องทางที่ติดต่อ</th>
                      <th className="px-4 py-2.5 font-medium">วันเกิด</th>
                      <th className="px-4 py-2.5 font-medium">เบอร์โทร</th>
                      <th className="px-4 py-2.5 font-medium">แท็ก</th>
                      <th className="px-4 py-2.5 font-medium">ติดต่อล่าสุด</th>
                      <th className="px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {!list && (
                      <tr>
                        <td colSpan={7} className="py-10 text-center text-muted">
                          <Loader2 className="mx-auto animate-spin" size={18} />
                        </td>
                      </tr>
                    )}
                    {list && rows.length === 0 && (
                      <tr>
                        <td colSpan={7} className="py-10 text-center text-muted">ไม่พบแฟ้มคนไข้ที่ตรงกับการค้นหา</td>
                      </tr>
                    )}
                    {rows.map((p) => (
                      <tr key={p.id} className="border-t border-line hover:bg-raised/50">
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2.5">
                            <Avatar name={p.name} color={p.avatarColor} size={32} />
                            <div>
                              <div className="font-medium">{p.name}</div>
                              <div className="font-display text-xs text-faint">{p.hn ? `HN ${p.hn}` : "ยังไม่มี HN"}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex flex-wrap gap-1">
                            {p.contactIds.map((id) => {
                              const ch = chOf(id);
                              return ch ? <ChannelTag key={id} type={ch.type} /> : null;
                            })}
                          </div>
                        </td>
                        <td className={cn("px-4 py-2.5", !p.birthDate && "text-faint")}>{birthLabel(p.birthDate) ?? "—"}</td>
                        <td className={cn("px-4 py-2.5 font-display", !p.phone && "text-faint")} title="แสดงบางส่วนเพื่อความเป็นส่วนตัว — ดูเต็มในแฟ้มคนไข้">
                          {maskPhone(p.phone) ?? "—"}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex flex-wrap gap-1">
                            {p.tagIds.map((id) => {
                              const t = list?.tags.find((x) => x.id === id);
                              return t ? <TagPill key={id} name={t.name} color={t.color} /> : null;
                            })}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-muted">{p.lastContactAt ? shortTime(toLocalIso(p.lastContactAt)) : thaiDate(p.createdAt)}</td>
                        <td className="px-4 py-2.5 text-right">
                          <Link href={`/inbox?patient=${p.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
                            <MessageSquare size={13} /> เปิดแชท
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}

        {tab === "suggest" && (
          <div className="space-y-3">
            <p className="text-sm text-muted">
              ระบบเทียบ HN เบอร์โทร อีเมล และชื่อ ระหว่างแฟ้ม — ตรวจสอบทีละคู่ แล้วเลือก “รวมแฟ้ม” หรือ “ไม่ใช่คนเดียวกัน” (ระบบจะไม่แนะนำคู่นั้นอีก)
            </p>
            {sugg && sugg.candidates.length === 0 && (
              <Card className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted">
                <CopyCheck size={28} /> ไม่มีแฟ้มที่น่าจะซ้ำกันในตอนนี้
              </Card>
            )}
            {sugg?.candidates.map((c) => {
              const a = pool[c.aId];
              const b = pool[c.bId];
              if (!a || !b) return null;
              return (
                <Card key={c.aId + c.bId} className="flex flex-wrap items-center gap-4 p-4">
                  {[a, b].map((x, i) => (
                    <div key={x.id} className="flex min-w-[220px] flex-1 items-center gap-2.5">
                      {i === 1 && <span className="hidden text-faint sm:block">↔</span>}
                      <Avatar name={x.name} color={x.avatarColor} size={36} />
                      <div className="min-w-0">
                        <div className="truncate font-medium">{x.name}</div>
                        <div className="flex flex-wrap items-center gap-1 text-xs text-faint">
                          <span className="font-display">{x.hn ? `HN ${x.hn}` : "ไม่มี HN"}</span>
                          {x.contactIds.map((id) => {
                            const ch = chOf(id);
                            return ch ? <ChannelTag key={id} type={ch.type}>{channelMeta[ch.type].label}</ChannelTag> : null;
                          })}
                        </div>
                      </div>
                    </div>
                  ))}
                  <div className="flex flex-wrap gap-1">
                    {c.blocked ? (
                      <span className="rounded-md bg-hot/15 px-2 py-0.5 text-xs text-hot">{c.blocked}</span>
                    ) : (
                      c.reasons.map((r) => (
                        <span key={r} className={cn("rounded-md px-2 py-0.5 text-xs", r === "ชื่อตรงกัน" ? "bg-raised text-muted" : "bg-ok/15 text-ok")}>
                          {r}
                        </span>
                      ))
                    )}
                  </div>
                  <div className="ml-auto flex gap-2">
                    <button onClick={() => notSame(c)} className="rounded-xl px-3 py-1.5 text-sm text-muted hover:bg-raised hover:text-ink">
                      ไม่ใช่คนเดียวกัน
                    </button>
                    {!c.blocked && (
                      <button onClick={() => setMerge({ base: c.aId, other: c.bId })} className="rounded-xl bg-brand px-3 py-1.5 text-sm font-semibold text-brand-ink hover:bg-brand-dark">
                        ตรวจสอบและรวม
                      </button>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        {tab === "history" && (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-sunken text-left text-xs text-muted">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">เวลา</th>
                    <th className="px-4 py-2.5 font-medium">แฟ้มหลัก</th>
                    <th className="px-4 py-2.5 font-medium">แฟ้มที่รวมเข้ามา</th>
                    <th className="px-4 py-2.5 font-medium">โดย</th>
                    <th className="px-4 py-2.5 font-medium">หมายเหตุ</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {hist?.events.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-10 text-center text-muted">ยังไม่เคยรวมแฟ้ม</td>
                    </tr>
                  )}
                  {hist?.events.map((e) => (
                    <tr key={e.id} className="border-t border-line">
                      <td className="px-4 py-2.5 font-display text-muted">{shortTime(toLocalIso(e.at))}</td>
                      <td className="px-4 py-2.5">
                        {e.survivor.name} {e.survivor.hn && <span className="font-display text-xs text-faint">HN {e.survivor.hn}</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        {e.merged.name} <span className="text-xs text-faint">({e.contacts} ช่องทาง)</span>
                      </td>
                      <td className="px-4 py-2.5">{e.actor}</td>
                      <td className="max-w-[220px] truncate px-4 py-2.5 text-muted" title={e.reason}>{e.reason ?? "—"}</td>
                      <td className="px-4 py-2.5 text-right">
                        {e.undoneAt ? (
                          <span className="text-xs text-faint">ยกเลิกแล้ว{e.undoneBy ? ` โดย ${e.undoneBy}` : ""}</span>
                        ) : hist.canUndo ? (
                          <button onClick={() => undo(e.id)} className="inline-flex items-center gap-1 text-xs font-medium text-hot hover:underline">
                            <Undo2 size={13} /> ยกเลิกการรวม
                          </button>
                        ) : (
                          <span className="text-xs text-faint">ยกเลิกได้โดยผู้ดูแล</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      {merge && (
        <MergeDialog
          basePatientId={merge.base}
          otherPatientId={merge.other}
          channels={channels}
          onClose={() => setMerge(null)}
          onMerged={() => {
            setMerge(null);
            setMsg({ ok: true, text: "รวมแฟ้มเรียบร้อย" });
            load();
          }}
        />
      )}
    </div>
  );
}
