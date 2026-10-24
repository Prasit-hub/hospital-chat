"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, ImageIcon, Send, X } from "lucide-react";
import type { Channel, ChannelType, Tag } from "@/lib/types";
import { channelMeta, cn, dayLabel, hhmm } from "@/lib/utils";
import { Card, PageHeader } from "@/components/ui";
import { api } from "@/components/inbox/workspace";

interface BroadcastRow {
  id: string;
  title: string;
  text: string;
  imageUrl: string | null;
  channelType: ChannelType;
  channelName: string;
  audience: string;
  status: "draft" | "scheduled" | "sending" | "sent" | "failed" | "cancelled";
  scheduledAt: string | null;
  sentAt: string | null;
  createdAt: string;
  createdBy: string | null;
  targeted: number;
  sent: number;
  failed: number;
  skipped: number;
  error: string | null;
}

interface Data {
  canSend: boolean;
  channels: Channel[];
  tags: Tag[];
  broadcasts: BroadcastRow[];
}

const statusMeta: Record<BroadcastRow["status"], { label: string; cls: string }> = {
  draft: { label: "รอส่ง", cls: "bg-raised text-muted" },
  scheduled: { label: "ตั้งเวลาไว้", cls: "bg-brand-soft text-brand" },
  sending: { label: "กำลังส่ง", cls: "bg-warm/15 text-warm" },
  sent: { label: "ส่งแล้ว", cls: "bg-ok/15 text-ok" },
  failed: { label: "ไม่สำเร็จ", cls: "bg-hot/15 text-hot" },
  cancelled: { label: "ยกเลิก", cls: "bg-raised text-muted" },
};

const when = (iso: string | null) => (iso ? `${dayLabel(iso)} ${hhmm(iso)}` : "—");

export default function BroadcastPage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [channelId, setChannelId] = useState("");
  const [tagId, setTagId] = useState("");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [schedule, setSchedule] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");
  const [estimate, setEstimate] = useState<{ targeted: number; eligible: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () =>
      api<Data>("/api/broadcasts")
        .then((d) => {
          setData(d);
          setChannelId((cur) => cur || d.channels.find((c) => c.connected && c.type !== "tiktok")?.id || "");
        })
        .catch((e) => setError(e.message)),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);

  // รีเฟรชประวัติระหว่างกำลังส่ง / มีรายการตั้งเวลา
  const pending = data?.broadcasts.some((b) => b.status === "sending" || b.status === "draft" || b.status === "scheduled");
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [pending, load]);

  useEffect(() => {
    if (!channelId) return;
    setEstimate(null);
    api<{ targeted: number; eligible: number }>(`/api/broadcasts/estimate?channelId=${channelId}&tagId=${tagId}`)
      .then(setEstimate)
      .catch(() => {});
  }, [channelId, tagId]);

  const channel = data?.channels.find((c) => c.id === channelId);
  const meta = channel ? channelMeta[channel.type] : channelMeta.line;
  const isMeta = channel?.type === "facebook" || channel?.type === "instagram";

  async function submit() {
    setBusy(true);
    setNotice(null);
    try {
      const r = await api<{ status: string }>("/api/broadcasts", {
        method: "POST",
        json: {
          title: title || text.slice(0, 40) || "ประกาศ",
          channelId,
          tagId: tagId || null,
          text,
          imageUrl: imageUrl || null,
          scheduledAt: schedule && scheduledAt ? new Date(scheduledAt).toISOString() : null,
        },
      });
      setNotice(r.status === "scheduled" ? "ตั้งเวลาส่งเรียบร้อย" : "เริ่มส่งแล้ว — ดูผลได้ที่ประวัติด้านล่าง");
      setTitle("");
      setText("");
      setImageUrl("");
      setSchedule(false);
      load();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (error) return <div className="p-6 text-sm text-hot">{error}</div>;

  const valid = !!channelId && (!!text.trim() || imageUrl.startsWith("https://")) && (!imageUrl || imageUrl.startsWith("https://")) && (!schedule || !!scheduledAt);

  return (
    <div className="flex-1 overflow-y-auto thin-scroll">
      <PageHeader title="ประกาศ" subtitle="ส่งข่าวสารถึงผู้ติดต่อหลายคนพร้อมกัน แยกตามช่องทางและแท็ก" />
      <div className="grid gap-5 p-4 sm:p-6 lg:grid-cols-[1fr_340px]">
        <Card className="space-y-5 p-5">
          {data && !data.canSend && (
            <p className="rounded-lg bg-warm/10 px-3 py-2 text-sm text-warm">เฉพาะเจ้าของหรือผู้ดูแลเท่านั้นที่ส่งประกาศได้</p>
          )}
          <div>
            <label className="mb-2 block text-sm font-medium">1. เลือกช่องทาง</label>
            <div className="flex flex-wrap gap-2">
              {data?.channels.map((c) => (
                <button
                  key={c.id}
                  disabled={!c.connected || c.type === "tiktok"}
                  onClick={() => setChannelId(c.id)}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40",
                    channelId === c.id ? "border-brand bg-brand-soft text-brand" : "border-line hover:bg-raised",
                  )}
                >
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: channelMeta[c.type].color }} />
                  {c.name}
                </button>
              ))}
            </div>
            {isMeta && (
              <p className="mt-2 text-xs text-warm">
                {meta.label} อนุญาตให้ส่งถึงผู้ที่ทักมาภายใน 24 ชม. เท่านั้น ระบบจะข้ามคนที่เกินเวลาให้อัตโนมัติ
              </p>
            )}
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium">2. กลุ่มเป้าหมาย</label>
            <select value={tagId} onChange={(e) => setTagId(e.target.value)} className="w-full rounded-lg border border-line px-3 py-2 text-sm">
              <option value="">ผู้ติดต่อทั้งหมดในช่องทางนี้</option>
              {data?.tags.map((t) => (
                <option key={t.id} value={t.id}>
                  แท็ก: {t.name}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-xs text-muted">
              {estimate ? (
                <>
                  จะส่งถึง <b className="text-ink">{estimate.eligible.toLocaleString()}</b> คน
                  {estimate.targeted !== estimate.eligible && <> (จาก {estimate.targeted.toLocaleString()} คน — ข้าม {(estimate.targeted - estimate.eligible).toLocaleString()} คนที่เกิน 24 ชม.)</>}
                </>
              ) : (
                "กำลังคำนวณจำนวนผู้รับ…"
              )}
            </p>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium">3. ข้อความ</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="ชื่อประกาศ (ใช้ในระบบ ผู้รับไม่เห็น)" className="w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand" />
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              maxLength={2000}
              placeholder="ข้อความที่จะส่ง (ข่าวสารทั่วไป ห้ามใส่ข้อมูลการรักษาของบุคคล)"
              className="w-full resize-none rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-brand"
            />
            <div className="flex items-center gap-2">
              <ImageIcon size={16} className="shrink-0 text-muted" />
              <input
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value.trim())}
                placeholder="ลิงก์รูปภาพ https://… (ไม่บังคับ)"
                className="w-full rounded-lg border border-line px-3 py-1.5 text-sm outline-none focus:border-brand"
              />
              <span className="shrink-0 text-xs text-muted">{text.length}/2000</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={schedule} onChange={(e) => setSchedule(e.target.checked)} className="accent-brand" />
              ตั้งเวลาส่ง
            </label>
            {schedule && (
              <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className="rounded-lg border border-line px-2 py-1 text-sm" />
            )}
            <button
              onClick={submit}
              disabled={!valid || busy || !data?.canSend || estimate?.eligible === 0}
              className="ml-auto flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-ink hover:bg-brand-dark disabled:opacity-40"
            >
              {schedule ? <CalendarClock size={15} /> : <Send size={15} />}
              {schedule ? "ตั้งเวลา" : "ส่งประกาศ"}
            </button>
          </div>
          {notice && <p className="rounded-lg bg-canvas px-3 py-2 text-sm">{notice}</p>}
        </Card>

        {/* Preview */}
        <div>
          <div className="mb-2 text-sm font-medium">ตัวอย่างบนมือถือ</div>
          <div className="mx-auto w-full max-w-[300px] rounded-[2rem] border-[6px] border-ink bg-ink p-1 shadow-lg">
            <div className="overflow-hidden rounded-[1.5rem] bg-panel">
              <div className="px-4 py-2.5 text-sm font-semibold text-white" style={{ background: meta.color }}>
                {channel?.name ?? "—"}
              </div>
              <div className="chat-bg h-80 space-y-2 overflow-y-auto p-3">
                {imageUrl.startsWith("https://") && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={imageUrl} alt="" className="ml-9 max-h-40 rounded-2xl object-cover shadow-sm" />
                )}
                <div className="flex gap-2">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-bold text-brand-ink">ร</div>
                  <div className="whitespace-pre-wrap rounded-2xl rounded-tl-md bg-panel px-3 py-2 text-[13px] shadow-sm">{text || "…"}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <Card className="overflow-x-auto lg:col-span-2">
          <div className="px-5 py-4 text-sm font-semibold">ประวัติการส่ง</div>
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-canvas text-left text-xs text-muted">
              <tr>
                <th className="px-5 py-2 font-medium">แคมเปญ</th>
                <th className="px-5 py-2 font-medium">ช่องทาง</th>
                <th className="px-5 py-2 font-medium">กลุ่มเป้าหมาย</th>
                <th className="px-5 py-2 font-medium">สถานะ</th>
                <th className="px-5 py-2 text-right font-medium">ส่งสำเร็จ</th>
                <th className="px-5 py-2 text-right font-medium">ไม่สำเร็จ / ข้าม</th>
                <th className="px-5 py-2 font-medium">เวลา</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data?.broadcasts.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-muted">
                    ยังไม่เคยส่งประกาศ
                  </td>
                </tr>
              )}
              {data?.broadcasts.map((b) => (
                <tr key={b.id} className="border-t border-line align-top">
                  <td className="px-5 py-2.5">
                    <div className="font-medium">{b.title}</div>
                    <div className="max-w-72 truncate text-xs text-muted">{b.text}</div>
                    {b.error && <div className="text-xs text-hot">{b.error}</div>}
                  </td>
                  <td className="px-5 py-2.5">{channelMeta[b.channelType].label}</td>
                  <td className="px-5 py-2.5 text-muted">{b.audience}</td>
                  <td className="px-5 py-2.5">
                    <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", statusMeta[b.status].cls)}>{statusMeta[b.status].label}</span>
                  </td>
                  <td className="px-5 py-2.5 text-right tabular-nums">
                    {b.status === "sent" || b.status === "failed" ? `${b.sent.toLocaleString()} / ${b.targeted.toLocaleString()}` : "—"}
                  </td>
                  <td className="px-5 py-2.5 text-right tabular-nums text-muted">
                    {b.status === "sent" || b.status === "failed" ? `${b.failed} / ${b.skipped}` : "—"}
                  </td>
                  <td className="px-5 py-2.5 text-xs text-muted">
                    {b.status === "scheduled" ? `ส่ง ${when(b.scheduledAt)}` : when(b.sentAt ?? b.createdAt)}
                    {b.createdBy && <div>โดย {b.createdBy}</div>}
                  </td>
                  <td className="px-3 py-2.5">
                    {b.status === "scheduled" && data.canSend && (
                      <button
                        onClick={() => api(`/api/broadcasts/${b.id}/cancel`, { method: "POST" }).then(load).catch((e) => setNotice(e.message))}
                        title="ยกเลิก"
                        className="rounded p-1 text-muted hover:bg-raised hover:text-hot"
                      >
                        <X size={15} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
