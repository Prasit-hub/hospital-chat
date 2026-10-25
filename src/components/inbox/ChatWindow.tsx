"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Bot,
  Check,
  CheckCheck,
  CircleCheck,
  Clock,
  ImageIcon,
  PanelRight,
  Paperclip,
  RotateCcw,
  ArrowRightLeft,
  Hand,
  Undo2,
  Hourglass,
  Play,
  Send,
  CalendarPlus,
  Mail,
  ShieldAlert,
  ShieldCheck,
  Siren,
  X,
  Smile,
  StickyNote,
  TriangleAlert,
  Zap,
} from "lucide-react";
import type { Case, Channel, Contact, Conversation, InquiryCategory, Message, Patient } from "@/lib/types";
import { caseStatusMeta, categoryMeta, channelMeta, cn, dayLabel, hhmm, nowLocal, outcomeMeta, profileCategoryMeta, thaiDate, VERIFY_METHODS } from "@/lib/utils";
import { useWorkspace } from "./workspace";
import { transferWait, useNow, waitLabel, waitTone, waitingMinutes } from "./CaseList";

import { Avatar, ChannelBadge, ChannelTag } from "@/components/ui";

export type SendPayload = { kind: "text" | "note"; text: string } | { kind: "image"; imageUrl: string };

const EMOJIS = ["🙏", "😊", "👍", "🏥", "💊", "📅", "✅", "❤️", "🩺", "📄"];

/** ข้อมูลประกอบของงาน (PATCH /api/cases/[id]) */
export interface CasePatch {
  category?: InquiryCategory | null;
  urgent?: { on: boolean; reason?: string };
  verify?: { method: string } | null;
}

export type SimpleAction = "accept" | "wait" | "resume" | "recall" | "reopen";

interface Props {
  /** งานที่เปิดดูอยู่ */
  kase: Case;
  /** ห้องแชทที่จะตอบกลับ (เลือกได้จากช่องทางของคนไข้) */
  conversation: Conversation;
  patient: Patient;
  contact: Contact;
  channel: Channel;
  /** แชทอื่นของคนไข้คนเดียวกัน (ต่างช่องทาง) — รวมแชทนี้ด้วย */
  siblings: { conversation: Conversation; contact: Contact; channel: Channel }[];
  messages: Message[];
  typing: boolean;
  loading?: boolean;
  onBack: () => void;
  onToggleInfo: () => void;
  onSend: (payload: SendPayload) => void;
  onCase: (patch: CasePatch) => void;
  onAction: (a: SimpleAction) => void;
  onAssign: (userId: string) => void;
  onTransfer: () => void;
  onReturn: () => void;
  onClose: () => void;
  onSwitchConversation: (id: string) => void;
  onCreateAppointment: () => void;
  /** เลขงาน/สถานะของงานต่างๆ ในเส้นเวลา (ใช้ทำเส้นคั่นงาน) */
  caseInfo: Record<string, { code: string; status: Case["status"]; outcome?: Case["outcome"]; closedAt?: string }>;
  /** ข้อความที่จะแทรกลงช่องตอบ (เช่น นัดจาก HIS) — n เปลี่ยนทุกครั้งที่กด */
  insertText?: { text: string; n: number };
}

export function ChatWindow(p: Props) {
  const { agents, quickReplies, departments, me, meId, caseSettings } = useWorkspace();
  const k = p.kase;
  const isAdmin = me.role !== "agent";
  const [onlyThisChannel, setOnlyThisChannel] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const multi = p.siblings.length > 1;
  const sib = useMemo(() => Object.fromEntries(p.siblings.map((x) => [x.conversation.id, x])), [p.siblings]);
  const shown = useMemo(
    () => (onlyThisChannel ? p.messages.filter((m) => m.conversationId === p.conversation.id) : p.messages),
    [onlyThisChannel, p.messages, p.conversation.id],
  );
  const [showImage, setShowImage] = useState(false);
  const [imageUrl, setImageUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadAndSend = async (file: File) => {
    setUploadError("");
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "อัปโหลดไม่สำเร็จ");
      p.onSend({ kind: "image", imageUrl: data.url });
      setShowImage(false);
      setImageUrl("");
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "อัปโหลดไม่สำเร็จ");
    } finally {
      setUploading(false);
    }
  };
  const [mode, setMode] = useState<"reply" | "note">("reply");
  const [text, setText] = useState("");
  useEffect(() => {
    if (!p.insertText) return;
    setMode("reply");
    setText((t) => (t.trim() ? t.trimEnd() + "\n" + p.insertText!.text : p.insertText!.text));
    setTimeout(() => inputRef.current?.focus(), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.insertText?.n]);
  const [showQuick, setShowQuick] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // ช่องพิมพ์ยืดตามข้อความ (สูงสุดประมาณ 8 บรรทัด)
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, [text]);
  const meta = channelMeta[p.channel.type];

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [p.messages.length, p.typing, p.conversation.id]);

  useEffect(() => {
    setText("");
    setMode("reply");
    setShowQuick(false);
    setVerifyOpen(false);
  }, [p.conversation.id]);

  // พิมพ์ "/" เพื่อค้นหาข้อความสำเร็จรูป
  const slashQuery = text.startsWith("/") ? text.slice(1).toLowerCase() : null;
  const quickMatches = useMemo(() => {
    if (slashQuery === null) return quickReplies;
    return quickReplies.filter(
      (q) => q.shortcut.toLowerCase().includes(slashQuery) || q.title.toLowerCase().includes(slashQuery),
    );
  }, [slashQuery, quickReplies]);
  const quickOpen = showQuick || (slashQuery !== null && quickMatches.length > 0);

  const grouped = useMemo(() => {
    const out: { day: string; items: Message[] }[] = [];
    for (const m of shown) {
      const day = m.at.slice(0, 10);
      const last = out[out.length - 1];
      if (last && last.day === day) last.items.push(m);
      else out.push({ day, items: [m] });
    }
    return out;
  }, [shown]);

  function send() {
    const t = text.trim();
    if (!t) return;
    p.onSend({ kind: mode === "note" ? "note" : "text", text: t });
    setText("");
    setShowQuick(false);
  }

  function pickQuick(t: string) {
    setText(t);
    setShowQuick(false);
    inputRef.current?.focus();
  }

  const metaWindow = p.channel.type === "facebook" || p.channel.type === "instagram";
  // เส้นคั่นงาน: แสดงเมื่อข้อความเปลี่ยนงาน
  const prevCase = new Map<string, string | undefined>();
  shown.forEach((m, i) => prevCase.set(m.id, i ? shown[i - 1].caseId : undefined));
  const caseOfPrev = (m: Message) => prevCase.get(m.id);
  const now = useNow();
  const wait = waitingMinutes({ case: k, lastCustomerMessageAt: p.conversation.lastCustomerMessageAt, lastMessage: p.conversation.lastMessage }, now);
  const tw = transferWait(k, now, caseSettings.transferSla, departments.find((d) => d.id === k.pendingTransfer?.toDeptId)?.slaMinutes);
  const emailSubject = [...p.messages].reverse().find((m) => m.from === "customer" && m.subject)?.subject;
  const lastCustomerAt = p.conversation.lastCustomerMessageAt;
  const windowExpired = metaWindow && !!lastCustomerAt && hoursBetween(lastCustomerAt, nowLocal()) > 24;

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-canvas">
      {/* หัวแชท: ตัวตนคนไข้ */}
      <header className="flex items-center gap-3 border-b border-line bg-panel/70 px-4 py-2.5 backdrop-blur">
        <button onClick={p.onBack} className="-ml-1 rounded-lg p-1.5 text-muted hover:bg-raised md:hidden" aria-label="กลับ">
          <ArrowLeft size={20} />
        </button>
        <Avatar name={p.patient.name} color={p.patient.avatarColor} src={p.contact.pictureUrl} channel={p.channel.type} size={40} />
        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="truncate font-display text-[17px] font-semibold leading-tight">{p.patient.name}</span>
            {p.patient.hn ? (
              <span className="shrink-0 rounded-md border border-line bg-sunken px-1.5 font-display text-[11px] text-muted">HN {p.patient.hn}</span>
            ) : (
              <span className="hidden shrink-0 text-[11px] text-faint sm:inline">ยังไม่มี HN</span>
            )}
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-1.5">
            <ChannelTag type={p.channel.type}>{meta.label}</ChannelTag>
            {multi && (
              <span className="flex items-center gap-0.5" title="คนไข้คนนี้ติดต่อมาหลายช่องทาง">
                {p.siblings
                  .filter((x) => x.conversation.id !== p.conversation.id)
                  .map((x) => (
                    <ChannelBadge key={x.conversation.id} type={x.channel.type} size="xs" />
                  ))}
              </span>
            )}
            {wait != null && (
              <span
                className={cn(
                  "inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-display text-[11px]",
                  waitTone(wait) === "cyan" ? "bg-brand-soft text-brand" : waitTone(wait) === "warm" ? "bg-warm/15 text-warm" : "bg-hot/15 text-hot",
                )}
              >
                <Clock size={11} /> {waitLabel(wait)}
              </span>
            )}
          </div>
        </div>

        <button
          onClick={() => p.onCase({ urgent: { on: !k.urgent } })}
          aria-pressed={k.urgent}
          title={k.urgent ? "ยกเลิกป้ายเร่งด่วน" : "ติดป้ายเร่งด่วน"}
          className={cn(
            "flex items-center gap-1 rounded-xl border px-2 py-1.5 text-xs font-medium transition-colors",
            k.urgent ? "border-hot/50 bg-hot/15 text-hot" : "border-line bg-sunken text-muted hover:text-ink",
          )}
        >
          <Siren size={14} />
          <span className="hidden lg:inline">{k.urgent ? "เร่งด่วน" : "ติดป้ายเร่งด่วน"}</span>
        </button>

        <CaseActions k={k} meId={meId} myDept={me.departmentId} isAdmin={isAdmin} p={p} />
        <button onClick={p.onToggleInfo} className="rounded-lg p-1.5 text-muted hover:bg-raised" aria-label="แฟ้มคนไข้">
          <PanelRight size={19} />
        </button>
      </header>

      {/* แถบเรื่องที่ติดต่อ: ยืนยันตัวตน / หมวด / แผนก / ผู้รับผิดชอบ */}
      <div className="relative flex items-center gap-2 overflow-x-auto thin-scroll border-b border-line bg-sunken/60 px-4 py-1.5 text-xs">
        {k.verified ? (
          <button
            onClick={() => setVerifyOpen((v) => !v)}
            className="flex shrink-0 items-center gap-1 rounded-lg bg-ok/15 px-2 py-1 font-medium text-ok"
            title={`ยืนยันโดย ${agents.find((a) => a.id === k.verified?.byId)?.name ?? "-"} เวลา ${hhmm(k.verified.at)}`}
          >
            <ShieldCheck size={14} /> ยืนยันตัวตนแล้ว
            <span className="hidden font-normal text-ok/80 md:inline">· {k.verified.method}</span>
          </button>
        ) : (
          <button
            onClick={() => setVerifyOpen((v) => !v)}
            className="flex shrink-0 items-center gap-1 rounded-lg border border-warm/40 bg-warm/10 px-2 py-1 font-medium text-warm"
          >
            <ShieldAlert size={14} /> ยังไม่ยืนยันตัวตน
          </button>
        )}
        <CaseSelect
          label="หมวด"
          value={k.category ?? ""}
          onChange={(v) => p.onCase({ category: (v || null) as InquiryCategory | null })}
          options={(Object.keys(categoryMeta) as InquiryCategory[]).map((x) => ({ value: x, label: categoryMeta[x].label }))}
          empty="ยังไม่ระบุ"
        />
        <span className={cn("flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-1", k.departmentId ? "border-line bg-panel" : "border-dashed border-line-strong")}>
          <span className="text-faint">แผนก</span>
          <span className="font-medium text-ink">{departments.find((d) => d.id === k.departmentId)?.name ?? "ศูนย์กลาง"}</span>
        </span>
        {isAdmin && k.status !== "closed" && k.status !== "transfer_pending" ? (
          <CaseSelect
            label="ผู้รับผิดชอบ"
            value={k.ownerId ?? ""}
            onChange={(v) => v && p.onAssign(v)}
            options={agents.map((a) => ({ value: a.id, label: a.name }))}
            empty="ยังไม่มี"
          />
        ) : (
          <span className="flex shrink-0 items-center gap-1.5 rounded-lg border border-line bg-panel px-2 py-1">
            <span className="text-faint">ผู้รับผิดชอบ</span>
            <span className="font-medium text-ink">{agents.find((a) => a.id === k.ownerId)?.name ?? "ยังไม่มี"}</span>
          </span>
        )}
        <span className="ml-auto shrink-0 font-display text-[11px] text-faint">{k.code}</span>
      </div>
      <KnowBar patient={p.patient} />
      {verifyOpen && (
        <VerifyPopover
          verified={k.verified}
          patient={p.patient}
          onClose={() => setVerifyOpen(false)}
          onVerify={(method) => {
            p.onCase({ verify: method ? { method } : null });
            setVerifyOpen(false);
          }}
        />
      )}

      {/* Messages */}
      <div ref={scrollRef} className="chat-bg flex-1 space-y-1 overflow-y-auto thin-scroll px-4 py-4 sm:px-8">
        {k.urgent && (
          <div role="alert" className="sticky top-0 z-10 mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-2xl border border-hot/40 bg-[color-mix(in_oklab,var(--color-hot)_12%,var(--color-panel))] px-4 py-2.5 text-sm shadow-sm">
            <Siren size={18} className="shrink-0 text-hot" />
            <div className="min-w-0 flex-1 basis-[220px]">
              <div className="font-semibold text-hot">เรื่องเร่งด่วน — ตรวจสอบทันที</div>
              <div className="text-xs text-muted">{k.urgentReason ?? "ติดป้ายโดยเจ้าหน้าที่"} · หากเป็นภาวะฉุกเฉินให้แนะนำโทร 1669 หรือมาห้องฉุกเฉิน</div>
            </div>
            <button
              onClick={() => {
                const q = quickReplies.find((x) => x.shortcut === "/ฉุกเฉิน");
                setMode("reply");
                setText(q?.text ?? "หากผู้ป่วยมีอาการฉุกเฉิน กรุณาโทร 1669 หรือมาที่ห้องฉุกเฉินทันที");
                inputRef.current?.focus();
              }}
              className="rounded-lg bg-hot px-2.5 py-1 text-xs font-semibold text-brand-ink hover:brightness-110"
            >
              ใส่ข้อความแนะนำฉุกเฉิน
            </button>
            <button onClick={() => p.onCase({ urgent: { on: false } })} className="text-xs text-muted underline-offset-2 hover:underline">
              ยกเลิกป้าย
            </button>
          </div>
        )}
        {multi && (
          <div className="mb-2 flex justify-center">
            <div className="flex items-center gap-1 rounded-full border border-line bg-panel p-0.5 text-[11px]" role="group" aria-label="แสดงข้อความจาก">
              <button
                onClick={() => setOnlyThisChannel(false)}
                aria-pressed={!onlyThisChannel}
                className={cn("rounded-full px-2.5 py-1", !onlyThisChannel ? "bg-brand-soft text-brand" : "text-muted hover:text-ink")}
              >
                ทุกช่องทาง ({p.siblings.length})
              </button>
              <button
                onClick={() => setOnlyThisChannel(true)}
                aria-pressed={onlyThisChannel}
                className={cn("rounded-full px-2.5 py-1", onlyThisChannel ? "bg-brand-soft text-brand" : "text-muted hover:text-ink")}
              >
                เฉพาะ {meta.label}
              </button>
            </div>
          </div>
        )}
        {p.loading && p.messages.length === 0 && <div className="py-10 text-center text-sm text-muted">กำลังโหลดข้อความ…</div>}
        {grouped.map((g) => (
          <div key={g.day} className="space-y-1">
            <div className="my-4 flex items-center gap-3">
              <span className="h-px flex-1 bg-gradient-to-r from-transparent to-line" />
              <span className="font-display text-[11px] text-faint">{dayLabel(g.day)}</span>
              <span className="h-px flex-1 bg-gradient-to-l from-transparent to-line" />
            </div>
            {g.items.map((m, i) => (
              <div key={m.id}>
              {m.caseId && m.caseId !== caseOfPrev(m) && <CaseDivider id={m.caseId} info={p.caseInfo[m.caseId]} current={m.caseId === k.id} />}
              <Bubble
                m={m}
                contact={sib[m.conversationId]?.contact ?? p.contact}
                channelType={multi ? (sib[m.conversationId]?.channel.type ?? p.channel.type) : undefined}
                prev={g.items[i - 1]}
                agents={agents}
                onRetry={m.conversationId === p.conversation.id ? p.onSend : undefined}
              />
              </div>
            ))}
          </div>
        ))}
        {p.typing && (
          <div className="flex items-end gap-2 pt-1">
            <Avatar name={p.patient.name} color={p.patient.avatarColor} size={28} />
            <div className="flex gap-1 rounded-2xl rounded-tl-md border border-line bg-panel px-3 py-3">
              {[0, 1, 2].map((i) => (
                <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-faint" style={{ animationDelay: `${i * 120}ms` }} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="relative px-3 pb-3 pt-1 sm:px-5 sm:pb-4">
        {k.status === "closed" && mode === "reply" && (
          <p className="mb-1.5 flex items-center gap-1.5 text-[11px] text-muted">
            <CircleCheck size={12} className="shrink-0 text-ok" /> งานนี้ปิดแล้ว ({outcomeMeta[k.outcome ?? "other"].label}) — ถ้าส่งข้อความ ระบบจะเปิดงานใหม่ให้คุณเป็นผู้รับผิดชอบ
          </p>
        )}
        {k.pendingTransfer && tw && (
          <p className={cn("mb-1.5 flex items-center gap-1.5 text-[11px]", tw.overdue ? "text-hot" : "text-warm")}>
            <ArrowRightLeft size={12} className="shrink-0" /> รอ{departments.find((d) => d.id === k.pendingTransfer?.toDeptId)?.name ?? "แผนก"}รับงาน {tw.min} นาที
            {tw.overdue && " — เกินเวลาที่กำหนด"} · เหตุผล: {k.pendingTransfer.reason}
          </p>
        )}
        {!k.verified && k.status !== "closed" && mode === "reply" && (
          <p className="mb-1.5 flex items-center gap-1.5 text-[11px] text-warm">
            <ShieldAlert size={12} className="shrink-0" /> ยังไม่ได้ยืนยันตัวตน — อย่าแจ้งผลตรวจหรือข้อมูลการรักษาจนกว่าจะยืนยัน (พิมพ์ /ยืนยัน เพื่อขอข้อมูล)
          </p>
        )}
        {p.channel.type === "email" && emailSubject && (
          <p className="mb-1.5 flex items-center gap-1.5 truncate text-[11px] text-muted">
            <Mail size={12} className="shrink-0" /> ตอบกลับทางอีเมลถึง {p.contact.name} · เรื่อง: {replySubjectUi(emailSubject)}
          </p>
        )}
        {metaWindow && lastCustomerAt && (
          <p className={cn("mb-1.5 flex items-center gap-1.5 text-[11px]", windowExpired ? "text-hot" : "text-muted")}>
            {windowExpired ? <TriangleAlert size={12} /> : <Clock size={12} />}
            {windowExpired
              ? `เกิน 24 ชม. แล้ว — ${meta.label} จะไม่ส่งข้อความจนกว่าคนไข้จะทักมาใหม่`
              : `${meta.label} ตอบกลับได้ภายใน 24 ชม. หลังข้อความล่าสุดของคนไข้ (${dayLabel(lastCustomerAt)} ${hhmm(lastCustomerAt)})`}
          </p>
        )}

        {showImage && (
          <div className="absolute bottom-full left-3 right-3 mb-2 flex flex-col gap-2 rounded-xl border border-line bg-panel p-2 shadow-lg sm:left-24 sm:right-auto sm:w-[420px]">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!imageUrl.startsWith("https://")) return;
                p.onSend({ kind: "image", imageUrl });
                setImageUrl("");
                setShowImage(false);
              }}
            >
              <input
                autoFocus
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="วางลิงก์รูปภาพ https://…"
                disabled={uploading}
                className="min-w-0 flex-1 rounded-lg border border-line px-2.5 py-1.5 text-sm outline-none focus:border-brand disabled:opacity-40"
              />
              <button
                className="rounded-lg bg-brand px-3 text-sm font-medium text-brand-ink disabled:opacity-40"
                disabled={!imageUrl.startsWith("https://") || uploading}
              >
                ส่งรูป
              </button>
            </form>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="flex items-center gap-1.5 rounded-lg border border-dashed border-line px-2.5 py-1.5 text-[13px] text-muted hover:border-brand hover:text-brand disabled:opacity-40"
              >
                <ImageIcon size={14} /> {uploading ? "กำลังอัปโหลด…" : "หรืออัปโหลดรูปจากเครื่อง"}
              </button>
              {uploadError && <span className="text-[12px] text-hot">{uploadError}</span>}
            </div>
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void uploadAndSend(f);
          }}
        />


        {quickOpen && (
          <div className="absolute bottom-full left-3 right-3 mb-2 max-h-64 overflow-y-auto thin-scroll rounded-2xl border border-line-strong bg-panel p-1.5 shadow-[0_20px_50px_rgb(var(--shade-rgb)/calc(0.5*var(--shade-k)))] sm:left-5 sm:right-auto sm:w-[440px]">
            <div className="px-2 pb-1 pt-0.5 text-[11px] text-faint">ข้อความสำเร็จรูป (พิมพ์ / ตามด้วยคำค้น)</div>
            {quickMatches.map((q) => (
              <button key={q.id} onClick={() => pickQuick(q.text)} className="block w-full rounded-lg px-2 py-1.5 text-left hover:bg-raised">
                <div className="flex items-center gap-2 text-[13px] font-medium">
                  <span className="rounded-md bg-brand-soft px-1.5 text-[11px] text-brand">{q.shortcut}</span>
                  {q.title}
                </div>
                <div className="mt-0.5 truncate text-xs text-muted">{q.text}</div>
              </button>
            ))}
          </div>
        )}

        {showEmoji && (
          <div className="absolute bottom-full left-16 mb-2 flex gap-1 rounded-xl border border-line bg-panel p-2 shadow-lg">
            {EMOJIS.map((e) => (
              <button
                key={e}
                className="rounded p-1 text-lg hover:bg-raised"
                onClick={() => {
                  setText((t) => t + e);
                  setShowEmoji(false);
                  inputRef.current?.focus();
                }}
              >
                {e}
              </button>
            ))}
          </div>
        )}

        <div
          className={cn(
            "rounded-2xl border shadow-[0_-8px_40px_rgb(var(--shade-rgb)/calc(0.35*var(--shade-k)))] transition-[border-color,box-shadow]",
            mode === "note"
              ? "border-warm/50 bg-[var(--note-bg)]"
              : "border-line-strong bg-panel focus-within:border-brand/70 focus-within:shadow-[0_0_0_3px_rgb(var(--brand-rgb)/0.12),0_-8px_40px_rgb(var(--shade-rgb)/calc(0.35*var(--shade-k)))]",
          )}
        >
          <div className="flex items-center gap-1 px-2 pt-1.5 text-xs">
            <ModeTab active={mode === "reply"} onClick={() => setMode("reply")}>
              ตอบคนไข้
            </ModeTab>
            <ModeTab active={mode === "note"} onClick={() => setMode("note")} note>
              <StickyNote size={12} /> โน้ตภายใน
            </ModeTab>
            {multi && mode === "reply" && (
              <label className="ml-auto flex items-center gap-1.5 text-[11px] text-muted">
                ตอบทาง
                <select
                  value={p.conversation.id}
                  onChange={(e) => p.onSwitchConversation(e.target.value)}
                  className="rounded-md border border-line bg-sunken px-1.5 py-0.5 text-[11px] font-medium text-ink outline-none"
                  aria-label="เลือกช่องทางที่จะตอบกลับ"
                >
                  {p.siblings.map((x) => (
                    <option key={x.conversation.id} value={x.conversation.id}>
                      {channelMeta[x.channel.type].label} · {x.contact.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <textarea
            ref={inputRef}
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (slashQuery !== null && quickMatches.length > 0 && !text.includes(" ")) pickQuick(quickMatches[0].text);
                else send();
              }
              if (e.key === "Escape") setShowQuick(false);
            }}
            placeholder={
              mode === "note"
                ? "เขียนโน้ตถึงทีม (คนไข้จะไม่เห็นข้อความนี้)"
                : `ตอบกลับทาง ${meta.label}… (Enter ส่ง, Shift+Enter ขึ้นบรรทัด, / ข้อความสำเร็จรูป)`
            }
            className="block w-full resize-none bg-transparent px-3.5 py-2 text-[14px] outline-none placeholder:text-faint"
          />
          <div className="flex items-center gap-0.5 px-2 pb-2">
            <ToolBtn label="ข้อความสำเร็จรูป" onClick={() => { setShowQuick((v) => !v); setShowEmoji(false); }} active={showQuick}>
              <Zap size={17} />
            </ToolBtn>
            <ToolBtn label="อีโมจิ" onClick={() => { setShowEmoji((v) => !v); setShowQuick(false); }} active={showEmoji}>
              <Smile size={17} />
            </ToolBtn>
            <ToolBtn label="ส่งรูปภาพ" onClick={() => { setShowImage((v) => !v); setShowQuick(false); setShowEmoji(false); }} active={showImage}>
              <ImageIcon size={17} />
            </ToolBtn>
            <ToolBtn label="แนบไฟล์ (รูปภาพ)" onClick={() => fileInputRef.current?.click()}>
              <Paperclip size={17} />
            </ToolBtn>
            <ToolBtn label="บันทึกคำขอนัด" onClick={p.onCreateAppointment}>
              <CalendarPlus size={17} />
            </ToolBtn>
            <button
              onClick={send}
              disabled={!text.trim()}
              className={cn(
                "ml-auto flex items-center gap-1.5 rounded-xl px-4 py-1.5 text-sm font-semibold text-brand-ink transition-colors disabled:opacity-35",
                mode === "note" ? "bg-warm hover:brightness-110" : "bg-brand hover:bg-brand-dark",
              )}
            >
              <Send size={15} /> {mode === "note" ? "บันทึกโน้ต" : "ส่ง"}
              <kbd className="ml-0.5 hidden rounded border border-brand-ink/25 px-1 text-[10px] font-normal sm:inline">↵</kbd>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function replySubjectUi(s: string) {
  return /^(re|ตอบกลับ)\s*:/i.test(s.trim()) ? s.trim() : `Re: ${s.trim()}`;
}

function hoursBetween(a: string, b: string) {
  return (new Date(b + "Z").getTime() - new Date(a + "Z").getTime()) / 3_600_000;
}

function Bubble({
  m,
  contact,
  channelType,
  prev,
  agents,
  onRetry,
}: {
  m: Message;
  contact: Contact;
  /** แสดงป้ายช่องทาง (เฉพาะเมื่อคนไข้มีหลายช่องทาง) */
  channelType?: Channel["type"];
  prev?: Message;
  agents: { id: string; name: string }[];
  onRetry?: (p: SendPayload) => void;
}) {
  const grouped = prev && prev.from === m.from && prev.kind === m.kind && prev.conversationId === m.conversationId;

  if (m.kind === "system") {
    return (
      <div className="flex justify-center py-1">
        <span className="flex max-w-[85%] items-center gap-2 text-center text-[11px] text-faint">
          <span className="h-1 w-1 shrink-0 rounded-full bg-faint" />
          {m.text}
          <span className="h-1 w-1 shrink-0 rounded-full bg-faint" />
        </span>
      </div>
    );
  }

  if (m.kind === "note") {
    const a = agents.find((x) => x.id === m.agentId);
    return (
      <div className="flex justify-end py-1">
        <div className="max-w-[75%] rounded-2xl border border-dashed border-warm/50 bg-warm/10 px-3.5 py-2 text-sm">
          <div className="mb-0.5 flex items-center gap-1 text-[11px] font-medium text-warm">
            <StickyNote size={11} /> โน้ตภายใน · {a?.name}
          </div>
          <p className="whitespace-pre-wrap text-ink/90">{m.text}</p>
          <div className="mt-0.5 text-right font-display text-[10px] text-warm/70">{hhmm(m.at)}</div>
        </div>
      </div>
    );
  }

  const mine = m.from === "agent" || m.from === "bot";
  const agent = agents.find((x) => x.id === m.agentId);

  return (
    <div className={cn("flex items-end gap-2", mine ? "justify-end" : "justify-start", grouped ? "pt-0.5" : "pt-2")}>
      {!mine && (
        <div className="w-7">
          {!grouped && <Avatar name={contact.name} color={contact.avatarColor} src={contact.pictureUrl} channel={channelType} size={28} />}
        </div>
      )}
      <div className={cn("flex max-w-[75%] flex-col", mine ? "items-end" : "items-start")}>
        {mine && !grouped && (
          <span className="mb-0.5 flex items-center gap-1 px-1 text-[10px] text-muted">
            {m.from === "bot" ? (
              <>
                <Bot size={11} /> ตอบกลับอัตโนมัติ
              </>
            ) : (
              agent?.name
            )}
            {channelType && <span className="text-faint">· ทาง {channelMeta[channelType].label}</span>}
          </span>
        )}
        {(m.kind === "image" || m.kind === "sticker") && m.imageUrl ? (
          <a href={m.imageUrl} target="_blank" rel="noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={m.imageUrl}
              alt={m.text}
              className={cn(m.kind === "sticker" ? "h-28 w-28 object-contain" : "max-h-64 max-w-[240px] rounded-2xl object-cover shadow-sm")}
            />
          </a>
        ) : m.kind === "image" ? (
          <div className="flex h-40 w-56 flex-col items-center justify-center gap-1 rounded-2xl border border-line bg-gradient-to-br from-raised to-panel text-xs text-muted">
            <ImageIcon size={28} />
            {m.text}
          </div>
        ) : (
          <div
            className={cn(
              "whitespace-pre-wrap break-words rounded-2xl border px-3.5 py-2 text-[14px] leading-relaxed",
              m.from === "customer" && "rounded-tl-md border-line bg-panel text-ink",
              m.from === "agent" && "rounded-tr-md border-brand/35 bg-gradient-to-br from-[var(--bubble-agent-from)] to-[var(--bubble-agent-to)] text-ink",
              m.from === "bot" && "rounded-tr-md border-dashed border-line-strong bg-raised/60 text-ink/90",
            )}
          >
            {m.subject && m.subject !== prev?.subject && (
              <div className={cn("mb-1 border-b pb-1 text-[11px] font-semibold", m.from === "customer" ? "border-line text-muted" : "border-brand/25 text-brand")}>
                ✉ {m.subject}
              </div>
            )}
            {m.text}
          </div>
        )}
        {m.status === "failed" ? (
          <span className="mt-0.5 flex items-center gap-1.5 px-1 text-[11px] text-hot">
            <TriangleAlert size={12} /> {m.error ?? "ส่งไม่สำเร็จ"}
            {m.from === "agent" && onRetry && (
              <button
                className="font-medium underline"
                onClick={() => onRetry(m.kind === "image" && m.imageUrl ? { kind: "image", imageUrl: m.imageUrl } : { kind: "text", text: m.text })}
              >
                ส่งอีกครั้ง
              </button>
            )}
          </span>
        ) : (
          <span className="mt-0.5 flex items-center gap-1 px-1 font-display text-[10px] text-faint">
            {hhmm(m.at)}
            {mine && m.status === "sending" && <Clock size={11} />}
            {mine && m.status !== "sending" && (m.read ? <CheckCheck size={12} className="text-brand" /> : <Check size={12} />)}
            {mine && m.read && "อ่านแล้ว"}
          </span>
        )}
      </div>
    </div>
  );
}

function ModeTab({ active, onClick, children, note }: { active: boolean; onClick: () => void; children: React.ReactNode; note?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 rounded-md px-2 py-0.5 font-medium",
        active ? (note ? "bg-warm/25 text-warm" : "bg-brand-soft text-brand") : "text-muted hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

function ToolBtn({ label, onClick, children, active }: { label: string; onClick: () => void; children: React.ReactNode; active?: boolean }) {
  return (
    <button
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn("rounded-lg p-1.5 transition-colors", active ? "bg-brand-soft text-brand" : "text-muted hover:bg-raised hover:text-ink")}
    >
      {children}
    </button>
  );
}

function CaseSelect({
  label,
  value,
  onChange,
  options,
  empty,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  empty: string;
}) {
  return (
    <label className={cn("flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-1", value ? "border-line bg-panel" : "border-dashed border-line-strong")}>
      <span className="text-faint">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="max-w-[170px] bg-transparent font-medium text-ink outline-none">
        <option value="">{empty}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** ยืนยันตัวตนคนไข้: เลือกวิธีที่ใช้ตรวจ แล้วกดยืนยัน (บันทึกว่าใครยืนยัน เมื่อไร) */
function VerifyPopover({
  verified,
  patient,
  onVerify,
  onClose,
}: {
  verified?: Case["verified"];
  patient: Patient;
  onVerify: (method: string | null) => void;
  onClose: () => void;
}) {
  const [method, setMethod] = useState(VERIFY_METHODS[0]);
  return (
    <div className="relative z-20">
      <div className="absolute left-4 top-1 w-[min(380px,calc(100vw-2rem))] rounded-2xl border border-line-strong bg-panel p-4 text-sm shadow-[0_20px_50px_rgb(var(--shade-rgb)/calc(0.5*var(--shade-k)))]">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="font-semibold">{verified ? "ยืนยันตัวตนแล้ว" : "ยืนยันตัวตนคนไข้"}</div>
            <p className="mt-0.5 text-xs text-muted">
              {verified
                ? `วิธี: ${verified.method} · เวลา ${hhmm(verified.at)} — ใช้ได้จนกว่าจะปิดแชทนี้`
                : "เทียบข้อมูลที่คนไข้แจ้งกับแฟ้ม ก่อนให้ข้อมูลการรักษา ผลตรวจ หรือเอกสาร"}
            </p>
          </div>
          <button onClick={onClose} aria-label="ปิด" className="rounded p-0.5 text-muted hover:text-ink">
            <X size={16} />
          </button>
        </div>
        {!verified && (
          <>
            <div className="mt-3 rounded-xl border border-line bg-sunken p-2.5 text-xs">
              <div className="text-faint">ข้อมูลในแฟ้มสำหรับเทียบ</div>
              <div className="mt-1 grid grid-cols-[70px_1fr] gap-y-0.5">
                <span className="text-muted">HN</span>
                <span className="font-display">{patient.hn ?? "—"}</span>
                <span className="text-muted">วันเกิด</span>
                <span className="font-display">{patient.birthDate ?? "—"}</span>
                <span className="text-muted">เบอร์โทร</span>
                <span className="font-display">{patient.phone ?? "—"}</span>
              </div>
            </div>
            <fieldset className="mt-3 space-y-1">
              <legend className="mb-1 text-xs text-faint">วิธีที่ใช้ยืนยัน</legend>
              {VERIFY_METHODS.map((m) => (
                <label key={m} className="flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 text-[13px] hover:bg-raised">
                  <input type="radio" name="verify-method" checked={method === m} onChange={() => setMethod(m)} className="accent-[var(--color-brand)]" />
                  {m}
                </label>
              ))}
            </fieldset>
          </>
        )}
        <div className="mt-3 flex justify-end gap-2">
          {verified ? (
            <button onClick={() => onVerify(null)} className="rounded-xl px-3 py-1.5 text-sm text-hot hover:bg-hot/10">
              ยกเลิกการยืนยัน
            </button>
          ) : (
            <button onClick={() => onVerify(method)} className="flex items-center gap-1.5 rounded-xl bg-ok px-3.5 py-1.5 text-sm font-semibold text-brand-ink hover:brightness-110">
              <ShieldCheck size={15} /> ยืนยันว่าข้อมูลตรงกัน
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** ปุ่มของงานตามสถานะ: รับงาน / รอคนไข้ / โอน / ปิด / รับงานที่โอนมา / ตีกลับ / ดึงกลับ / เปิดอีกครั้ง */
function CaseActions({ k, meId, myDept, isAdmin, p }: { k: Case; meId: string; myDept?: string; isAdmin: boolean; p: Props }) {
  const btn = "flex shrink-0 items-center gap-1 rounded-xl border px-2.5 py-1.5 text-xs font-medium transition-colors";
  const primary = "border-brand bg-brand text-brand-ink hover:bg-brand-dark";
  const ghost = "border-line bg-sunken text-muted hover:text-ink";
  const mine = k.ownerId === meId;
  const canWork = mine || isAdmin || !k.ownerId;
  const t = k.pendingTransfer;
  const st = caseStatusMeta[k.status];
  const label = (txt: string) => <span className="hidden lg:inline">{txt}</span>;

  if (k.status === "queued")
    return (
      <div className="flex items-center gap-1.5">
        <button onClick={() => p.onAction("accept")} className={cn(btn, primary)}>
          <Hand size={14} /> รับงาน
        </button>
        <button onClick={p.onTransfer} className={cn(btn, ghost)} title="โอนงานไปแผนก" aria-label="โอนงาน">
          <ArrowRightLeft size={14} />
          {label("โอน")}
        </button>
      </div>
    );
  if (k.status === "transfer_pending" && t) {
    const toMe = t.toDeptId === myDept;
    return (
      <div className="flex items-center gap-1.5">
        {(toMe || isAdmin) && (
          <>
            <button onClick={() => p.onAction("accept")} className={cn(btn, primary)}>
              <Hand size={14} /> รับงานที่โอนมา
            </button>
            <button onClick={p.onReturn} className={cn(btn, ghost)} aria-label="ตีกลับ">
              <Undo2 size={14} />
              {label("ตีกลับ")}
            </button>
          </>
        )}
        {(t.fromUserId === meId || isAdmin) && (
          <button onClick={() => p.onAction("recall")} className={cn(btn, ghost)}>
            <Undo2 size={14} /> ดึงกลับ
          </button>
        )}
        {!toMe && t.fromUserId !== meId && !isAdmin && <span className={cn("rounded-xl px-2.5 py-1.5 text-xs", st.cls)}>{st.label}</span>}
      </div>
    );
  }
  if (k.status === "closed")
    return (
      <div className="flex items-center gap-1.5">
        <span className="hidden rounded-xl bg-ok/15 px-2.5 py-1.5 text-xs font-medium text-ok sm:inline">ปิดแล้ว · {outcomeMeta[k.outcome ?? "other"].label}</span>
        <button onClick={() => p.onAction("reopen")} className={cn(btn, ghost)} title="เปิดงานนี้อีกครั้ง (ภายในเวลาที่กำหนด)" aria-label="เปิดงานนี้อีกครั้ง">
          <RotateCcw size={14} />
          {label("เปิดอีกครั้ง")}
        </button>
      </div>
    );
  return (
    <div className="flex items-center gap-1.5">
      {k.status === "waiting_patient" ? (
        <button onClick={() => p.onAction("resume")} className={cn(btn, ghost)} title="กลับมาดำเนินการต่อ" aria-label="ทำต่อ">
          <Play size={14} />
          {label("ทำต่อ")}
        </button>
      ) : (
        canWork && (
          <button onClick={() => p.onAction("wait")} className={cn(btn, ghost)} title="ตั้งเป็นรอคนไข้ตอบ (หยุดนับเวลารอ)" aria-label="รอคนไข้ตอบ">
            <Hourglass size={14} />
            {label("รอคนไข้")}
          </button>
        )
      )}
      {canWork && (
        <button onClick={p.onTransfer} className={cn(btn, ghost)} title="โอนงานไปแผนก" aria-label="โอนงาน">
          <ArrowRightLeft size={14} />
          {label("โอน")}
        </button>
      )}
      {canWork ? (
        <button onClick={p.onClose} className={cn(btn, "border-ok/50 bg-ok/15 text-ok hover:bg-ok/25")}>
          <CircleCheck size={14} /> ปิดงาน
        </button>
      ) : (
        <span className={cn("rounded-xl px-2.5 py-1.5 text-xs", st.cls)}>{st.label}</span>
      )}
    </div>
  );
}

/** เส้นคั่นเมื่อข้อความเริ่มงานใหม่ */
function CaseDivider({ id, info, current }: { id: string; info?: Props["caseInfo"][string]; current: boolean }) {
  return (
    <div id={`case-${id}`} className="my-3 flex scroll-mt-20 items-center gap-2 text-[11px]">
      <span className={cn("h-px flex-1", current ? "bg-brand/40" : "bg-line")} />
      <span className={cn("rounded-full border px-2.5 py-0.5 font-display", current ? "border-brand/40 bg-brand-soft text-brand" : "border-line bg-panel text-faint")}>
        {info?.code ?? "งานก่อนหน้า"}
        {info && info.status === "closed" && ` · ปิดแล้ว${info.outcome ? ` (${outcomeMeta[info.outcome].label})` : ""}${info.closedAt ? ` ${thaiDate(info.closedAt.slice(0, 10))}` : ""}`}
        {current && info?.status !== "closed" && " · งานปัจจุบัน"}
      </span>
      <span className={cn("h-px flex-1", current ? "bg-brand/40" : "bg-line")} />
    </div>
  );
}

/** แถบ "ควรรู้": ความต้องการพิเศษ การสื่อสาร และสิ่งที่ไม่ชอบ ของคนไข้ */
function KnowBar({ patient }: { patient: Patient }) {
  const shown = patient.profileTags.filter((t) => t.category !== "like");
  if (!shown.length) return null;
  const order = { need: 0, communication: 1, dislike: 2, like: 3 } as const;
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto thin-scroll border-b border-line bg-panel/60 px-4 py-1.5 text-[11.5px]" aria-label="ควรรู้เกี่ยวกับคนไข้">
      <span className="shrink-0 font-medium text-faint">ควรรู้</span>
      {[...shown]
        .sort((a, b) => order[a.category] - order[b.category])
        .map((t) => (
          <span
            key={t.id}
            title={`${profileCategoryMeta[t.category].label}${t.note ? ` — ${t.note}` : ""}`}
            className={cn("shrink-0 rounded-md px-1.5 py-0.5 ring-1 ring-inset", profileCategoryMeta[t.category].tone)}
          >
            {t.category === "dislike" ? "ไม่ชอบ: " : ""}
            {t.label}
            {t.note && <span className="opacity-70"> · {t.note}</span>}
          </span>
        ))}
    </div>
  );
}
