"use client";

import { useState } from "react";
import { CalendarPlus, ShieldAlert, X } from "lucide-react";
import { useWorkspace } from "./workspace";
import { slotLabel } from "@/lib/utils";

export interface AppointmentDraft {
  departmentId?: string;
  doctor?: string;
  date?: string;
  slot: "morning" | "afternoon" | "any";
  reason?: string;
  sendSummary: boolean;
}

/** บันทึกคำขอนัด — นัดจริงยังต้องยืนยันในระบบ HIS ของโรงพยาบาล */
export function AppointmentModal({
  patientName,
  defaultDepartmentId,
  verified,
  onClose,
  onCreate,
}: {
  patientName: string;
  defaultDepartmentId?: string;
  verified: boolean;
  onClose: () => void;
  onCreate: (d: AppointmentDraft) => Promise<void> | void;
}) {
  const { departments } = useWorkspace();
  const [d, setD] = useState<AppointmentDraft>({ departmentId: defaultDepartmentId, slot: "any", sendSummary: true });
  const [busy, setBusy] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const set = (patch: Partial<AppointmentDraft>) => setD((x) => ({ ...x, ...patch }));
  const field = "mt-1 w-full rounded-xl border border-line bg-sunken px-3 py-2 text-sm outline-none focus:border-brand/70";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="apt-title">
      <form
        className="w-full max-w-md rounded-2xl border border-line-strong bg-panel p-5 shadow-[0_30px_80px_rgb(var(--shade-rgb)/calc(0.6*var(--shade-k)))]"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await onCreate(d);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 id="apt-title" className="font-display text-lg font-semibold">บันทึกคำขอนัด</h2>
            <p className="text-xs text-muted">คนไข้: {patientName}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-muted hover:bg-raised" aria-label="ปิด">
            <X size={18} />
          </button>
        </div>

        {!verified && (
          <p className="mt-3 flex items-start gap-1.5 rounded-xl border border-warm/40 bg-warm/10 px-3 py-2 text-xs text-warm">
            <ShieldAlert size={14} className="mt-px shrink-0" /> ยังไม่ได้ยืนยันตัวตนคนไข้ในแชทนี้ — ตรวจสอบก่อนนัดหมาย
          </p>
        )}

        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="col-span-2 block text-xs text-muted">
            แผนก
            <select value={d.departmentId ?? ""} onChange={(e) => set({ departmentId: e.target.value || undefined })} className={field} required>
              <option value="">เลือกแผนก</option>
              {departments.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
          <label className="col-span-2 block text-xs text-muted">
            แพทย์ที่ต้องการ (ถ้ามี)
            <input value={d.doctor ?? ""} onChange={(e) => set({ doctor: e.target.value })} maxLength={120} className={field} placeholder="เช่น ชื่อแพทย์ประจำ" />
          </label>
          <label className="block text-xs text-muted">
            วันที่ต้องการ
            <input type="date" min={today} value={d.date ?? ""} onChange={(e) => set({ date: e.target.value || undefined })} className={field} />
          </label>
          <label className="block text-xs text-muted">
            ช่วงเวลา
            <select value={d.slot} onChange={(e) => set({ slot: e.target.value as AppointmentDraft["slot"] })} className={field}>
              {(Object.keys(slotLabel) as (keyof typeof slotLabel)[]).map((k) => (
                <option key={k} value={k}>
                  {slotLabel[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="col-span-2 block text-xs text-muted">
            เหตุผล / อาการโดยย่อ
            <textarea
              value={d.reason ?? ""}
              onChange={(e) => set({ reason: e.target.value })}
              rows={2}
              maxLength={500}
              className={field + " resize-none"}
              placeholder="บันทึกเท่าที่จำเป็นต่อการนัด"
            />
          </label>
        </div>

        <label className="mt-4 flex items-start gap-2 text-sm">
          <input type="checkbox" checked={d.sendSummary} onChange={(e) => set({ sendSummary: e.target.checked })} className="mt-1 accent-[var(--color-brand)]" />
          <span>
            ส่งข้อความรับเรื่องให้คนไข้ในแชท
            <span className="block text-xs text-muted">แจ้งเลขคำขอ และบอกว่าเจ้าหน้าที่จะติดต่อยืนยันนัดอีกครั้ง</span>
          </span>
        </label>

        <p className="mt-3 text-[11px] text-faint">คำขอนัดยังไม่ใช่นัดจริง — ยืนยันในระบบ HIS แล้วเปลี่ยนสถานะเป็น “ยืนยันนัดแล้ว”</p>

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-xl px-3 py-2 text-sm text-muted hover:bg-raised">
            ยกเลิก
          </button>
          <button disabled={busy || !d.departmentId} className="flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-brand-ink hover:bg-brand-dark disabled:opacity-50">
            <CalendarPlus size={15} /> บันทึกคำขอนัด
          </button>
        </div>
      </form>
    </div>
  );
}
