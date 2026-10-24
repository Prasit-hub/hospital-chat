"use client";

import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, CalendarClock, ChevronDown, CornerDownLeft, Hospital, Loader2, RefreshCw, Search, TriangleAlert } from "lucide-react";
import type { Case, Patient } from "@/lib/types";
import { api, useWorkspace } from "./workspace";
import { DialogShell } from "./CaseDialogs";
import { cn, nowLocal, thaiDate } from "@/lib/utils";

// ข้อมูลจาก HIS ในแฟ้มคนไข้: ตรวจว่าเป็นคนไข้ของโรงพยาบาล / นัดใน HIS / การมาโรงพยาบาลล่าสุด
// แสดงเฉพาะเมื่อเปิดเชื่อมต่อ HIS (โหมด mock หรือ live) — โหมด manual ใช้ HN ที่กรอกเองเหมือนเดิม

type HisAppt = {
  id: string;
  date: string;
  time?: string | null;
  clinicName: string;
  doctorName?: string | null;
  status: "booked" | "arrived" | "completed" | "cancelled" | "no_show";
  instructions?: string | null;
  sourceRef?: string | null;
};
type HisVisit = { id: string; type: "OPD" | "IPD" | "ER"; startAt: string; endAt?: string | null; clinicName: string; ward?: string | null; status: "in_progress" | "admitted" | "finished" };
type Summary = { hn: string; appointments: HisAppt[]; encounters: HisVisit[]; checkedAt: string; cached: boolean };
type HisPatient = { hn: string; name: string; birthDate: string; sex?: string | null; phoneLast4?: string | null; status: "active" | "deceased" | "merged"; mergedToHn?: string | null };
type MatchResult = { result: "match" | "multiple" | "not_found"; patients: HisPatient[]; checkedAt: string; conflict?: { id: string; name: string } };

const WD_SHORT = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];
const WD_FULL = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];
const MONTH_FULL = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
const dow = (ymd: string) => new Date(ymd + "T00:00:00Z").getUTCDay();
const daysFrom = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86_400_000);
const fullDate = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return `วัน${WD_FULL[dow(ymd)]}ที่ ${d} ${MONTH_FULL[m - 1]} ${y + 543}`;
};
const thaiYmd = (ymd: string) => `${thaiDate(ymd)} ${Number(ymd.slice(0, 4)) + 543}`;
const relDay = (n: number) => (n === 0 ? "วันนี้" : n === 1 ? "พรุ่งนี้" : n > 1 ? `อีก ${n} วัน` : n === -1 ? "เมื่อวาน" : `${-n} วันก่อน`);

const apptStatus: Record<HisAppt["status"], { label: string; cls: string }> = {
  booked: { label: "นัดไว้", cls: "bg-brand-soft text-brand" },
  arrived: { label: "มาแล้ว", cls: "bg-ok/15 text-ok" },
  completed: { label: "มาตามนัดแล้ว", cls: "bg-raised text-muted" },
  cancelled: { label: "ยกเลิก", cls: "bg-raised text-faint line-through" },
  no_show: { label: "ไม่มาตามนัด", cls: "bg-warm/15 text-warm" },
};
const visitType = { OPD: "ผู้ป่วยนอก", IPD: "ผู้ป่วยใน", ER: "ฉุกเฉิน" } as const;

/** ข้อความนัดที่แทรกลงช่องตอบ (เจ้าหน้าที่ตรวจแล้วกดส่งเอง) */
function apptText(a: HisAppt) {
  return [
    `นัดครั้งถัดไป: ${fullDate(a.date)} ${a.time ? `เวลา ${a.time} น.` : "(เวลาตามใบนัด)"}`,
    `ที่ ${a.clinicName}${a.doctorName ? ` (${a.doctorName})` : ""}`,
    a.instructions ? `การเตรียมตัว: ${a.instructions}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function HisCard({ patient, kase, onInsertReply }: { patient: Patient; kase?: Case; onInsertReply: (text: string) => void }) {
  const { his } = useWorkspace();
  const [sum, setSum] = useState<Summary | null>(null);
  const [err, setErr] = useState<{ code?: string; message: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [showPast, setShowPast] = useState(false);
  const linked = !!(patient.hn && patient.hisVerifiedAt);
  const verified = !!kase?.verified && kase.status !== "closed";

  const load = useCallback(
    async (refresh = false) => {
      setLoading(true);
      setErr(null);
      try {
        setSum(await api<Summary>(`/api/patients/${patient.id}/his/summary${refresh ? "?refresh=1" : ""}`));
      } catch (e) {
        const x = e as Error & { data?: { code?: string } };
        setSum(null);
        setErr({ code: x.data?.code, message: x.message });
      } finally {
        setLoading(false);
      }
    },
    [patient.id],
  );

  useEffect(() => {
    setSum(null);
    setErr(null);
    if (linked && verified) load();
  }, [linked, verified, patient.hn, patient.hisVerifiedAt, kase?.id, kase?.verified?.at, load]);

  if (his.mode === "manual") return null;
  const today = nowLocal().slice(0, 10);
  const upcoming = sum?.appointments.filter((a) => a.date >= today && (a.status === "booked" || a.status === "arrived")) ?? [];
  const past = sum?.appointments.filter((a) => !upcoming.includes(a)).reverse() ?? [];
  const lastVisit = sum?.encounters[0];

  return (
    <section className="mx-4 mb-3 rounded-2xl border border-line bg-panel" aria-label="ข้อมูลจาก HIS">
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Hospital size={14} className="text-brand" />
        <h3 className="flex-1 text-[12.5px] font-semibold">ข้อมูลจาก HIS</h3>
        {his.mode === "mock" && <span className="rounded-md bg-warm/15 px-1.5 py-0.5 text-[10.5px] text-warm">ข้อมูลจำลอง</span>}
        {linked && verified && (
          <button onClick={() => load(true)} disabled={loading} className="rounded-md p-1 text-muted hover:bg-raised hover:text-ink" title="โหลดข้อมูลจาก HIS ใหม่" aria-label="โหลดข้อมูลจาก HIS ใหม่">
            <RefreshCw size={13} className={cn(loading && "animate-spin")} />
          </button>
        )}
      </header>

      <div className="space-y-2.5 px-3 py-2.5 text-[12.5px]">
        {/* สถานะการตรวจ HN */}
        {linked ? (
          <div className="flex items-start gap-1.5 text-ok">
            <BadgeCheck size={15} className="mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <span className="font-medium">เป็นคนไข้ของโรงพยาบาล · HN {patient.hn}</span>
              <span className="block text-[11px] text-muted">ตรงกับ HIS เมื่อ {thaiYmd(patient.hisVerifiedAt!.slice(0, 10))}</span>
            </div>
            {!verified && kase?.status !== "closed" && (
              <button onClick={() => setChecking(true)} className="shrink-0 rounded-lg border border-line px-2 py-1 text-[11px] text-ink hover:border-brand/60">
                ยืนยันอีกครั้ง
              </button>
            )}
          </div>
        ) : (
          <div>
            <p className="text-muted">{patient.hn ? `HN ${patient.hn} กรอกเอง ยังไม่ได้ตรวจกับ HIS` : "ยังไม่รู้ว่าเป็นคนไข้ของโรงพยาบาลหรือไม่"}</p>
            {kase && kase.status !== "closed" ? (
              <button
                onClick={() => setChecking(true)}
                className="mt-1.5 flex items-center gap-1.5 rounded-lg bg-brand px-2.5 py-1.5 text-[12px] font-semibold text-brand-ink hover:bg-brand-dark"
              >
                <Search size={13} /> ตรวจกับ HIS
              </button>
            ) : (
              <p className="mt-1 text-[11px] text-faint">ตรวจกับ HIS ได้จากงานที่เปิดอยู่</p>
            )}
          </div>
        )}

        {/* ต้องยืนยันตัวตนในงานนี้ก่อน */}
        {linked && !verified && (
          <p className="rounded-xl border border-dashed border-line-strong px-2.5 py-2 text-[11.5px] text-muted">
            {kase?.status === "closed" ? "งานนี้ปิดแล้ว — ดูนัดและการมาโรงพยาบาลได้จากงานที่เปิดอยู่" : "ยืนยันตัวตนคนไข้ในงานนี้ก่อน จึงจะเห็นนัดและการมาโรงพยาบาลล่าสุด"}
          </p>
        )}

        {linked && verified && loading && !sum && (
          <p className="flex items-center gap-1.5 text-muted">
            <Loader2 size={13} className="animate-spin" /> กำลังดึงข้อมูลจาก HIS…
          </p>
        )}

        {err && (
          <div className="rounded-xl border border-warm/40 bg-warm/10 px-2.5 py-2 text-[11.5px] text-warm" role="status">
            <div className="flex items-start gap-1.5">
              <TriangleAlert size={13} className="mt-0.5 shrink-0" />
              <span className="flex-1">{err.message}</span>
            </div>
            {err.code !== "not_verified" && err.code !== "no_open_case" && (
              <button onClick={() => load(true)} className="mt-1 text-[11px] font-medium underline">
                ลองอีกครั้ง
              </button>
            )}
          </div>
        )}

        {sum && (
          <>
            {/* การมาโรงพยาบาลล่าสุด */}
            <div>
              <div className="mb-1 text-[11px] text-faint">มาโรงพยาบาลล่าสุด</div>
              {lastVisit ? (
                <div className={cn("rounded-xl border px-2.5 py-2", lastVisit.status === "admitted" ? "border-warm/50 bg-warm/10" : "border-line")}>
                  {lastVisit.status === "admitted" && <div className="mb-0.5 text-[11.5px] font-semibold text-warm">นอนโรงพยาบาลอยู่{lastVisit.ward ? ` · ${lastVisit.ward}` : ""}</div>}
                  {lastVisit.status === "in_progress" && <div className="mb-0.5 text-[11.5px] font-semibold text-brand">อยู่ที่โรงพยาบาลตอนนี้</div>}
                  <div>
                    {thaiYmd(lastVisit.startAt.slice(0, 10))} · {visitType[lastVisit.type]} · {lastVisit.clinicName}
                  </div>
                  <div className="text-[11px] text-muted">{relDay(daysFrom(today, lastVisit.startAt.slice(0, 10)))}</div>
                </div>
              ) : (
                <p className="text-muted">ไม่มีประวัติการมาโรงพยาบาล</p>
              )}
            </div>

            {/* นัดใน HIS */}
            <div>
              <div className="mb-1 flex items-center gap-1 text-[11px] text-faint">
                <CalendarClock size={12} /> นัดใน HIS
              </div>
              {upcoming.length === 0 && <p className="text-muted">ไม่มีนัดที่กำลังจะถึง</p>}
              <ul className="space-y-1.5">
                {upcoming.map((a) => (
                  <li key={a.id} className="rounded-xl border border-line px-2.5 py-2">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold">
                        {WD_SHORT[dow(a.date)]} {thaiYmd(a.date)}
                      </span>
                      <span className="text-muted">{a.time ? `${a.time} น.` : "ตามใบนัด"}</span>
                      <span className={cn("ml-auto rounded-md px-1.5 text-[10.5px]", apptStatus[a.status].cls)}>{apptStatus[a.status].label}</span>
                    </div>
                    <div className="mt-0.5">
                      {a.clinicName}
                      {a.doctorName && <span className="text-muted"> · {a.doctorName}</span>}
                    </div>
                    <div className="text-[11px] text-muted">
                      {relDay(daysFrom(today, a.date))}
                      {a.sourceRef && ` · จากคำขอ ${a.sourceRef}`}
                    </div>
                    {a.instructions && <p className="mt-1 rounded-lg bg-sunken px-2 py-1 text-[11.5px]">เตรียมตัว: {a.instructions}</p>}
                    <button onClick={() => onInsertReply(apptText(a))} className="mt-1.5 flex items-center gap-1 text-[11.5px] font-medium text-brand hover:underline">
                      <CornerDownLeft size={12} /> แทรกในคำตอบ
                    </button>
                  </li>
                ))}
              </ul>
              {past.length > 0 && (
                <>
                  <button onClick={() => setShowPast((v) => !v)} aria-expanded={showPast} className="mt-1.5 flex items-center gap-1 text-[11px] text-muted hover:text-ink">
                    <ChevronDown size={12} className={cn("transition-transform", showPast && "rotate-180")} /> นัดที่ผ่านมา / ยกเลิก ({past.length})
                  </button>
                  {showPast && (
                    <ul className="mt-1 space-y-1">
                      {past.map((a) => (
                        <li key={a.id} className="flex items-center gap-1.5 text-[11.5px] text-muted">
                          <span>{thaiYmd(a.date)}</span>
                          <span className="truncate">{a.clinicName}</span>
                          <span className={cn("ml-auto shrink-0 rounded-md px-1.5 text-[10.5px]", apptStatus[a.status].cls)}>{apptStatus[a.status].label}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
            <p className="text-[10.5px] text-faint">
              ข้อมูล HIS ณ {new Date(sum.checkedAt).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" })} น. · ไม่เก็บลงระบบ
            </p>
          </>
        )}
      </div>

      {checking && <HisMatchDialog patient={patient} allowNationalId={his.allowNationalId} onClose={() => setChecking(false)} />}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* หน้าต่าง “ตรวจกับ HIS”                                              */
/* ------------------------------------------------------------------ */

type By = "hn" | "name_phone" | "nationalId";
const field = "mt-1 w-full rounded-xl border border-line bg-sunken px-3 py-2 text-sm outline-none placeholder:text-faint focus:border-brand/70";

function HisMatchDialog({ patient, allowNationalId, onClose }: { patient: Patient; allowNationalId: boolean; onClose: () => void }) {
  const [by, setBy] = useState<By>("hn");
  const [hn, setHn] = useState(patient.hn ?? "");
  const [birth, setBirth] = useState(patient.birthDate ?? "");
  const [name, setName] = useState(patient.name);
  const [phone, setPhone] = useState(patient.phone ?? "");
  const [nid, setNid] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<MatchResult | null>(null);
  const [error, setError] = useState("");
  const [useHisName, setUseHisName] = useState(false);
  const [replaceHn, setReplaceHn] = useState(false);

  const ready = /^\d{4}-\d{2}-\d{2}$/.test(birth) && (by === "hn" ? hn.trim().length > 0 : by === "nationalId" ? nid.replace(/\D/g, "").length === 13 : name.trim().length > 1 && phone.replace(/\D/g, "").length >= 9);

  async function check(overrideHn?: string) {
    setBusy(true);
    setError("");
    setRes(null);
    try {
      const body = overrideHn ? { hn: overrideHn, birthDate: birth } : by === "hn" ? { hn: hn.trim(), birthDate: birth } : by === "nationalId" ? { nationalId: nid, birthDate: birth } : { name, phone, birthDate: birth };
      if (overrideHn) {
        setBy("hn");
        setHn(overrideHn);
      }
      setRes(await api<MatchResult>(`/api/patients/${patient.id}/his/match`, { method: "POST", json: body }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const hp = res?.result === "match" ? res.patients[0] : undefined;
  const nameDiffers = !!hp && hp.name.replace(/\s+/g, " ").trim() !== patient.name.replace(/\s+/g, " ").trim();
  const hnDiffers = !!hp && !!patient.hn && patient.hn !== hp.hn;
  const canLink = !!hp && hp.status === "active" && !res?.conflict && (!hnDiffers || replaceHn);

  async function link() {
    if (!hp) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/patients/${patient.id}/his/link`, { method: "POST", json: { hn: hp.hn, birthDate: hp.birthDate, useHisName: nameDiffers && useHisName, replaceHn } });
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const tabs: { id: By; label: string }[] = [
    { id: "hn", label: "HN + วันเกิด" },
    { id: "name_phone", label: "ชื่อ + เบอร์ + วันเกิด" },
    ...(allowNationalId ? [{ id: "nationalId" as By, label: "เลขบัตร + วันเกิด" }] : []),
  ];

  return (
    <DialogShell
      title="ตรวจกับ HIS"
      sub="ถามข้อมูลจากคนไข้ในแชท แล้วตรวจว่าตรงกับเวชระเบียนของโรงพยาบาล — ใช้ข้อมูลอย่างน้อย 2 อย่างเสมอ"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="rounded-xl px-3 py-2 text-sm text-muted hover:bg-raised">
            ปิด
          </button>
          {hp ? (
            <button
              disabled={!canLink || busy}
              onClick={link}
              className="flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-brand-ink hover:bg-brand-dark disabled:opacity-40"
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : <BadgeCheck size={15} />} ยืนยันว่าเป็นคนเดียวกัน และผูก HN
            </button>
          ) : (
            <button
              disabled={!ready || busy}
              onClick={() => check()}
              className="flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-brand-ink hover:bg-brand-dark disabled:opacity-40"
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />} ตรวจกับ HIS
            </button>
          )}
        </>
      }
    >
      <div role="tablist" aria-label="ตรวจด้วย" className="flex flex-wrap gap-1 rounded-xl bg-sunken p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={by === t.id}
            onClick={() => {
              setBy(t.id);
              setRes(null);
              setError("");
            }}
            className={cn("rounded-lg px-2.5 py-1 text-xs", by === t.id ? "bg-panel font-semibold text-ink shadow-sm" : "text-muted hover:text-ink")}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        {by === "hn" && (
          <label className="block text-xs text-muted">
            HN
            <input value={hn} onChange={(e) => (setHn(e.target.value), setRes(null))} inputMode="numeric" maxLength={20} placeholder="เช่น 6501234" className={field} />
          </label>
        )}
        {by === "nationalId" && (
          <label className="block text-xs text-muted">
            เลขบัตรประชาชน 13 หลัก
            <input value={nid} onChange={(e) => (setNid(e.target.value), setRes(null))} inputMode="numeric" maxLength={17} autoComplete="off" className={field} />
          </label>
        )}
        {by === "name_phone" && (
          <>
            <label className="col-span-2 block text-xs text-muted">
              ชื่อ-นามสกุล
              <input value={name} onChange={(e) => (setName(e.target.value), setRes(null))} maxLength={120} className={field} />
            </label>
            <label className="block text-xs text-muted">
              เบอร์โทรที่ลงทะเบียน
              <input value={phone} onChange={(e) => (setPhone(e.target.value), setRes(null))} inputMode="tel" maxLength={20} className={field} />
            </label>
          </>
        )}
        <label className="block text-xs text-muted">
          วันเกิด
          <input type="date" value={birth} onChange={(e) => (setBirth(e.target.value), setRes(null))} max={nowLocal().slice(0, 10)} className={field} />
        </label>
      </div>

      {error && <p className="mt-3 rounded-xl border border-hot/40 bg-hot/10 px-3 py-2 text-xs text-hot">{error}</p>}

      {res?.result === "not_found" && (
        <p className="mt-3 rounded-xl border border-line bg-sunken px-3 py-2 text-sm">
          ไม่พบใน HIS — อาจยังไม่เคยมาโรงพยาบาล หรือข้อมูลที่ได้ไม่ตรง ลองถามคนไข้อีกครั้ง หรือแนะนำการเตรียมเอกสารสำหรับคนไข้ใหม่
        </p>
      )}
      {res?.result === "multiple" && (
        <div className="mt-3 rounded-xl border border-warm/40 bg-warm/10 px-3 py-2 text-sm">
          <p className="font-medium text-warm">พบรายที่ใกล้เคียง {res.patients.length} ราย แต่ข้อมูลยังไม่พอยืนยัน</p>
          <p className="mt-0.5 text-xs text-muted">ถามคนไข้เพิ่ม เช่น HN บนบัตรโรงพยาบาล หรือเบอร์โทรที่เคยลงทะเบียน</p>
          <ul className="mt-1 text-xs text-muted">
            {res.patients.map((p, i) => (
              <li key={i}>
                {p.name} · HN {p.hn}
              </li>
            ))}
          </ul>
        </div>
      )}
      {hp && (
        <div className="mt-3">
          {hp.status === "merged" && (
            <div className="mb-2 rounded-xl border border-warm/40 bg-warm/10 px-3 py-2 text-sm">
              <p className="text-warm">HN {hp.hn} ถูกรวมใน HIS ไปที่ HN {hp.mergedToHn} แล้ว</p>
              {hp.mergedToHn && (
                <button onClick={() => check(hp.mergedToHn!)} className="mt-1 text-xs font-semibold text-brand underline">
                  ตรวจด้วย HN {hp.mergedToHn}
                </button>
              )}
            </div>
          )}
          {hp.status === "deceased" && (
            <p className="mb-2 rounded-xl border border-hot/40 bg-hot/10 px-3 py-2 text-sm text-hot">
              HIS ระบุว่าผู้ป่วยรายนี้เสียชีวิตแล้ว — ไม่ผูกแฟ้ม ให้ส่งต่อเวชระเบียนตรวจสอบ และสื่อสารกับผู้ติดต่ออย่างระมัดระวัง
            </p>
          )}
          {res?.conflict && (
            <p className="mb-2 rounded-xl border border-warm/40 bg-warm/10 px-3 py-2 text-sm text-warm">
              HN {hp.hn} อยู่ในแฟ้ม “{res.conflict.name}” ของรวมแชทแล้ว — ถ้าเป็นคนเดียวกันให้รวมแฟ้มแทน
            </p>
          )}
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] text-faint">
                <th className="py-1 font-normal"></th>
                <th className="py-1 font-normal">ในแฟ้มแชท</th>
                <th className="py-1 font-normal">ใน HIS</th>
              </tr>
            </thead>
            <tbody className="[&_td]:border-t [&_td]:border-line [&_td]:py-1.5">
              <tr>
                <td className="text-xs text-muted">ชื่อ</td>
                <td>{patient.name}</td>
                <td className={cn(nameDiffers && "font-semibold text-warm")}>{hp.name}</td>
              </tr>
              <tr>
                <td className="text-xs text-muted">HN</td>
                <td>{patient.hn ?? "—"}</td>
                <td className={cn(hnDiffers && "font-semibold text-warm")}>{hp.hn}</td>
              </tr>
              <tr>
                <td className="text-xs text-muted">วันเกิด</td>
                <td>{patient.birthDate ? thaiYmd(patient.birthDate) : "—"}</td>
                <td>{thaiYmd(hp.birthDate)}</td>
              </tr>
              <tr>
                <td className="text-xs text-muted">เบอร์ท้าย</td>
                <td>{patient.phone ? patient.phone.replace(/\D/g, "").slice(-4) : "—"}</td>
                <td>{hp.phoneLast4 ?? "—"}</td>
              </tr>
            </tbody>
          </table>
          {hp.status === "active" && !res?.conflict && (
            <div className="mt-2 space-y-1.5 text-sm">
              {nameDiffers && (
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={useHisName} onChange={(e) => setUseHisName(e.target.checked)} /> เปลี่ยนชื่อในแฟ้มเป็น “{hp.name}” ตาม HIS
                </label>
              )}
              {hnDiffers && (
                <label className="flex items-center gap-2 text-warm">
                  <input type="checkbox" checked={replaceHn} onChange={(e) => setReplaceHn(e.target.checked)} /> เปลี่ยน HN ในแฟ้มจาก {patient.hn} เป็น {hp.hn}
                </label>
              )}
              <p className="text-xs text-muted">กดยืนยันแล้ว ระบบจะบันทึกการยืนยันตัวตนในงานนี้ว่า “HN + วันเกิด (ตรงกับ HIS)”</p>
            </div>
          )}
        </div>
      )}
    </DialogShell>
  );
}
