"use client";

import { useEffect, useState } from "react";
import { ArrowRightLeft, CircleCheck, Loader2, X } from "lucide-react";
import type { Case, CaseOutcome, InquiryCategory } from "@/lib/types";
import { useWorkspace } from "./workspace";
import { categoryMeta, cn, outcomeMeta } from "@/lib/utils";

// หน้าต่างโอนงาน / ปิดงาน / ระบุเหตุผล (ตีกลับ)

export function DialogShell({ title, sub, onClose, children, footer }: { title: string; sub?: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={title}>
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col rounded-2xl border border-line-strong bg-panel shadow-[0_30px_80px_rgb(var(--shade-rgb)/calc(0.6*var(--shade-k)))]">
        <div className="flex items-start justify-between gap-3 px-5 pt-5">
          <div>
            <h2 className="font-display text-lg font-semibold">{title}</h2>
            {sub && <p className="text-xs text-muted">{sub}</p>}
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-muted hover:bg-raised" aria-label="ปิด">
            <X size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 thin-scroll">{children}</div>
        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>
      </div>
    </div>
  );
}

const field = "mt-1 w-full rounded-xl border border-line bg-sunken px-3 py-2 text-sm outline-none placeholder:text-faint focus:border-brand/70";

export function TransferDialog({
  c,
  patientName,
  onClose,
  onSubmit,
}: {
  c: Case;
  patientName: string;
  onClose: () => void;
  onSubmit: (d: { departmentId: string; reason: string; doneNote?: string; notifyPatient: boolean }) => Promise<boolean>;
}) {
  const { departments, agents } = useWorkspace();
  const [dept, setDept] = useState("");
  const [reason, setReason] = useState("");
  const [done, setDone] = useState("");
  const [notify, setNotify] = useState(false);
  const [busy, setBusy] = useState(false);
  const online = (id: string) => agents.filter((a) => a.departmentId === id && a.online).length;
  const members = (id: string) => agents.filter((a) => a.departmentId === id).length;
  const ok = dept && reason.trim().length >= 3;

  return (
    <DialogShell
      title="โอนงานไปแผนก"
      sub={`${c.code} · ${patientName} — งานเข้าคิวแผนกปลายทาง และยังเป็นความรับผิดชอบของคุณจนกว่าจะมีคนรับ`}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="rounded-xl px-3 py-2 text-sm text-muted hover:bg-raised">
            ยกเลิก
          </button>
          <button
            disabled={!ok || busy}
            onClick={async () => {
              setBusy(true);
              const r = await onSubmit({ departmentId: dept, reason: reason.trim(), doneNote: done.trim() || undefined, notifyPatient: notify });
              if (!r) setBusy(false);
            }}
            className="flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-brand-ink hover:bg-brand-dark disabled:opacity-40"
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <ArrowRightLeft size={15} />} โอนงาน
          </button>
        </>
      }
    >
      <fieldset>
        <legend className="text-xs text-muted">แผนกปลายทาง</legend>
        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
          {departments
            .filter((d) => d.id !== c.departmentId || !c.ownerId)
            .map((d) => {
              const on = online(d.id);
              return (
                <label
                  key={d.id}
                  className={cn("flex cursor-pointer items-start gap-2 rounded-xl border px-2.5 py-2 text-sm", dept === d.id ? "border-brand/60 bg-brand-soft" : "border-line hover:border-line-strong")}
                >
                  <input type="radio" name="dept" checked={dept === d.id} onChange={() => setDept(d.id)} className="mt-1 accent-[var(--color-brand)]" />
                  <span className="min-w-0">
                    <span className="block truncate">{d.name}</span>
                    <span className={cn("block text-[11px]", on ? "text-ok" : members(d.id) ? "text-warm" : "text-faint")}>
                      {members(d.id) === 0 ? "ยังไม่มีเจ้าหน้าที่ในแผนก" : on ? `ออนไลน์ ${on} คน` : "ไม่มีใครออนไลน์ตอนนี้"}
                    </span>
                  </span>
                </label>
              );
            })}
        </div>
      </fieldset>
      {dept && online(dept) === 0 && (
        <p className="mt-2 rounded-xl border border-warm/40 bg-warm/10 px-3 py-2 text-xs text-warm">แผนกนี้ไม่มีเจ้าหน้าที่ออนไลน์ งานจะรอในคิวจนกว่าจะมีคนรับ — ถ้าเร่งด่วนให้โทรประสานด้วย</p>
      )}
      <label className="mt-4 block text-xs text-muted">
        เหตุผลที่โอน (บังคับ)
        <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="เช่น ต้องตรวจสอบสิทธิในระบบประกันสังคม" className={field} />
      </label>
      <label className="mt-3 block text-xs text-muted">
        สิ่งที่ทำไปแล้ว (ไม่บังคับ — ช่วยให้คนรับไม่ต้องถามคนไข้ซ้ำ)
        <textarea value={done} onChange={(e) => setDone(e.target.value)} rows={2} maxLength={1000} placeholder="เช่น ยืนยันตัวตนแล้ว คนไข้ขอผลภายในวันนี้" className={field + " resize-none"} />
      </label>
      <label className="mt-3 flex items-start gap-2 text-sm">
        <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="mt-1 accent-[var(--color-brand)]" />
        <span>
          แจ้งคนไข้ว่าส่งต่อเรื่องให้แผนกแล้ว
          <span className="block text-xs text-muted">ส่งข้อความสั้นๆ ทางช่องทางที่คนไข้ทักมาล่าสุด</span>
        </span>
      </label>
    </DialogShell>
  );
}

const OUTCOMES: CaseOutcome[] = ["answered", "appointed", "advised_visit", "referred_external", "no_response", "spam", "other"];

export function CloseDialog({
  c,
  patientName,
  hasAppointment,
  onClose,
  onSubmit,
}: {
  c: Case;
  patientName: string;
  hasAppointment: boolean;
  onClose: () => void;
  onSubmit: (d: { outcome: CaseOutcome; category?: InquiryCategory; note?: string; closingMessage?: string }) => Promise<boolean>;
}) {
  const [outcome, setOutcome] = useState<CaseOutcome | "">(hasAppointment ? "appointed" : "");
  const [category, setCategory] = useState<InquiryCategory | "">(c.category ?? "");
  const [note, setNote] = useState("");
  const [sendMsg, setSendMsg] = useState(false);
  const [msg, setMsg] = useState("ขอบคุณที่ติดต่อโรงพยาบาลค่ะ หากมีข้อสงสัยเพิ่มเติมทักมาได้ตลอดเลยนะคะ");
  const [busy, setBusy] = useState(false);
  const needNote = (outcome && outcomeMeta[outcome].needsNote) || c.urgent;
  const problems = [
    !outcome && "เลือกผลการปิด",
    !category && outcome !== "spam" && "เลือกหมวดเรื่อง",
    needNote && !note.trim() && (c.urgent ? "งานเร่งด่วนต้องมีบันทึกสรุป" : "ผลนี้ต้องมีบันทึกสรุป"),
    outcome === "appointed" && !hasAppointment && "ยังไม่มีคำขอนัดในงานนี้",
  ].filter(Boolean) as string[];

  return (
    <DialogShell
      title="ปิดงาน"
      sub={`${c.code} · ${patientName}`}
      onClose={onClose}
      footer={
        <>
          {problems.length > 0 && <span className="mr-auto text-xs text-warm">{problems[0]}</span>}
          <button onClick={onClose} className="rounded-xl px-3 py-2 text-sm text-muted hover:bg-raised">
            ยกเลิก
          </button>
          <button
            disabled={problems.length > 0 || busy}
            onClick={async () => {
              setBusy(true);
              const r = await onSubmit({
                outcome: outcome as CaseOutcome,
                category: (category || undefined) as InquiryCategory | undefined,
                note: note.trim() || undefined,
                closingMessage: sendMsg ? msg.trim() : undefined,
              });
              if (!r) setBusy(false);
            }}
            className="flex items-center gap-1.5 rounded-xl bg-ok px-4 py-2 text-sm font-semibold text-brand-ink hover:brightness-110 disabled:opacity-40"
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <CircleCheck size={15} />} ปิดงาน
          </button>
        </>
      }
    >
      <fieldset>
        <legend className="text-xs text-muted">ผลการปิด</legend>
        <div className="mt-1.5 space-y-1">
          {OUTCOMES.map((o) => (
            <label key={o} className={cn("flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm", outcome === o ? "bg-brand-soft" : "hover:bg-raised")}>
              <input type="radio" name="outcome" checked={outcome === o} onChange={() => setOutcome(o)} className="accent-[var(--color-brand)]" />
              {outcomeMeta[o].label}
              {outcomeMeta[o].needsNote && <span className="text-[11px] text-faint">· ต้องมีบันทึกสรุป</span>}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="mt-3 block text-xs text-muted">
        หมวดเรื่อง
        <select value={category} onChange={(e) => setCategory(e.target.value as InquiryCategory)} className={field}>
          <option value="">เลือกหมวด</option>
          {(Object.keys(categoryMeta) as InquiryCategory[]).map((k) => (
            <option key={k} value={k}>
              {categoryMeta[k].label}
            </option>
          ))}
        </select>
      </label>
      <label className="mt-3 block text-xs text-muted">
        บันทึกสรุป{needNote ? " (บังคับ)" : " (ไม่บังคับ)"}
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000} placeholder="สรุปสั้นๆ ว่าจบเรื่องอย่างไร (ไม่ใส่ข้อมูลการรักษา)" className={field + " resize-none"} />
      </label>
      <label className="mt-3 flex items-start gap-2 text-sm">
        <input type="checkbox" checked={sendMsg} onChange={(e) => setSendMsg(e.target.checked)} className="mt-1 accent-[var(--color-brand)]" />
        <span>ส่งข้อความปิดท้ายให้คนไข้</span>
      </label>
      {sendMsg && <textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={2} maxLength={2000} className={field + " resize-none"} />}
    </DialogShell>
  );
}

export function ReasonDialog({
  title,
  sub,
  label,
  action,
  onClose,
  onSubmit,
}: {
  title: string;
  sub?: string;
  label: string;
  action: string;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<boolean>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <DialogShell
      title={title}
      sub={sub}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="rounded-xl px-3 py-2 text-sm text-muted hover:bg-raised">
            ยกเลิก
          </button>
          <button
            disabled={reason.trim().length < 3 || busy}
            onClick={async () => {
              setBusy(true);
              if (!(await onSubmit(reason.trim()))) setBusy(false);
            }}
            className="rounded-xl bg-warm px-4 py-2 text-sm font-semibold text-brand-ink hover:brightness-110 disabled:opacity-40"
          >
            {action}
          </button>
        </>
      }
    >
      <label className="block text-xs text-muted">
        {label}
        <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} className={field} />
      </label>
    </DialogShell>
  );
}
