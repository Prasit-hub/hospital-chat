"use client";

import { useState } from "react";
import { ArrowRight, CalendarDays, CalendarPlus, ChevronDown, CopyCheck, History, Mail, Phone, Plus, Split, X } from "lucide-react";
import type { Appointment, Case, CaseTransfer, Channel, Contact, Patient } from "@/lib/types";
import { useWorkspace } from "./workspace";
import { appointmentStatusMeta, birthLabel, caseStatusMeta, categoryMeta, channelMeta, cn, outcomeMeta, slotLabel, thaiDate } from "@/lib/utils";
import { ProfileTags, type AddTag } from "./ProfileTags";
import { HisCard } from "./HisCard";
import { Avatar, TagPill } from "@/components/ui";

// แฟ้มคนไข้ (แผงขวาของหน้าแชท): ตัวตน, บัญชีที่เชื่อมกัน, แฟ้มที่อาจซ้ำ, นัดหมาย, ข้อมูลติดต่อ, บันทึก

interface Props {
  patient: Patient;
  contacts: { contact: Contact; channel: Channel; current: boolean }[];
  appointments: Appointment[];
  conversationCount: number;
  duplicateCount: number;
  onChange: (patch: Partial<Patient>) => void;
  onCreateAppointment: () => void;
  onAppointmentStatus: (id: string, s: Appointment["status"]) => void;
  onOpenMerge: () => void;
  onSplit: (contactId: string) => void;
  onAddProfileTag: (t: AddTag) => Promise<void>;
  onRemoveProfileTag: (id: string) => void;
  /** ประวัติการติดต่อ (โหลดเมื่อเปิดดู) */
  history: HistoryCase[] | null;
  onLoadHistory: () => void;
  onJumpToCase: (caseId: string) => void;
  currentCaseId?: string;
  /** งานที่เปิดดูอยู่ (ใช้กับข้อมูลจาก HIS) */
  kase?: Case;
  /** แทรกข้อความลงช่องตอบ */
  onInsertReply: (text: string) => void;
  onClose: () => void;
  className?: string;
}

export type HistoryCase = Case & { transfers: CaseTransfer[]; messageCount: number; channelIds: string[]; lastAt: string; restricted?: boolean };

export function PatientPanel(p: Props) {
  const { tags, departments, agents, channels } = useWorkspace();
  const [histOpen, setHistOpen] = useState(false);
  const [addingTag, setAddingTag] = useState(false);
  const pt = p.patient;
  const available = tags.filter((t) => !pt.tagIds.includes(t.id));

  return (
    <aside className={cn("flex w-full flex-col border-l border-line bg-sunken sm:w-[340px] sm:shrink-0", p.className)} aria-label="แฟ้มคนไข้">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <span className="font-display text-sm font-semibold text-muted">แฟ้มคนไข้</span>
        <button onClick={p.onClose} className="rounded-lg p-1 text-muted hover:bg-raised" aria-label="ปิด">
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto thin-scroll">
        {/* ตัวตน */}
        <div className="relative px-4 pb-4 pt-5">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-28 opacity-60" style={{ background: `radial-gradient(70% 100% at 20% 0%, ${pt.avatarColor}33, transparent)` }} />
          <div className="relative flex items-center gap-3">
            <Avatar name={pt.name} color={pt.avatarColor} size={56} />
            <div className="min-w-0">
              <Inline value={pt.name} onSave={(v) => v && p.onChange({ name: v })} className="font-display text-[18px] font-semibold leading-tight" label="ชื่อคนไข้" />
              <div className="mt-0.5 text-[11px] text-faint">เปิดแฟ้มเมื่อ {thaiDate(pt.createdAt)} · {p.conversationCount} แชท</div>
            </div>
          </div>
          <dl className="relative mt-4 grid grid-cols-2 gap-1.5">
            <div className="rounded-xl border border-line bg-panel px-2.5 py-2">
              <dt className="text-[10.5px] text-muted">HN</dt>
              <dd>
                <Inline value={pt.hn ?? ""} placeholder="เพิ่ม HN" onSave={(v) => p.onChange({ hn: v })} className="font-display text-[15px] font-semibold" label="HN" />
              </dd>
            </div>
            <div className="rounded-xl border border-line bg-panel px-2.5 py-2">
              <dt className="text-[10.5px] text-muted">วันเกิด</dt>
              <dd>
                <Inline
                  value={pt.birthDate ?? ""}
                  display={birthLabel(pt.birthDate)}
                  placeholder="เพิ่มวันเกิด"
                  type="date"
                  onSave={(v) => p.onChange({ birthDate: v })}
                  className="text-[13px] font-medium"
                  label="วันเกิด"
                />
              </dd>
            </div>
          </dl>
        </div>

        {/* ข้อมูลจาก HIS (เมื่อเปิดเชื่อมต่อ) */}
        <HisCard patient={pt} kase={p.kase} onInsertReply={p.onInsertReply} />

        {/* แฟ้มที่อาจซ้ำ */}
        {p.duplicateCount > 0 && (
          <div className="mx-4 mb-3 rounded-2xl border border-warm/40 bg-warm/10 p-3">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-warm">
              <CopyCheck size={15} /> พบแฟ้มที่อาจเป็นคนเดียวกัน {p.duplicateCount} แฟ้ม
            </div>
            <p className="mt-0.5 text-xs text-muted">ข้อมูลบางอย่างตรงกัน ตรวจสอบแล้วรวมแฟ้มเพื่อเห็นประวัติทุกช่องทางในที่เดียว</p>
            <button onClick={p.onOpenMerge} className="mt-2 rounded-lg bg-warm px-3 py-1.5 text-xs font-semibold text-brand-ink hover:brightness-110">
              ตรวจสอบและรวมแฟ้ม
            </button>
          </div>
        )}

        {/* แท็กคนไข้: ความต้องการ การสื่อสาร ชอบ ไม่ชอบ */}
        <Section title="แท็กคนไข้">
          <ProfileTags patient={pt} onAdd={p.onAddProfileTag} onRemove={p.onRemoveProfileTag} />
        </Section>

        {/* ประวัติการติดต่อ: งานทั้งหมดของแฟ้มนี้ */}
        <div className="border-t border-line px-4 py-3.5">
          <button
            onClick={() => {
              if (!histOpen && !p.history) p.onLoadHistory();
              setHistOpen((v) => !v);
            }}
            aria-expanded={histOpen}
            className="flex w-full items-center gap-2 text-left"
          >
            <History size={14} className="text-faint" />
            <h3 className="flex-1 text-[12px] font-medium text-faint">ประวัติการติดต่อ{p.history ? ` (${p.history.length} งาน)` : ""}</h3>
            <ChevronDown size={14} className={cn("text-faint transition-transform", histOpen && "rotate-180")} />
          </button>
          {histOpen && (
            <ol className="mt-2 space-y-1.5">
              {!p.history && <li className="text-xs text-muted">กำลังโหลด…</li>}
              {p.history?.map((h) => {
                const owner = agents.find((a) => a.id === h.ownerId)?.name;
                const route = h.transfers.map((t) => departments.find((d) => d.id === t.toDeptId)?.name ?? "—");
                return (
                  <li key={h.id}>
                    <button
                      onClick={() => !h.restricted && p.onJumpToCase(h.id)}
                      disabled={h.restricted}
                      title={h.restricted ? "งานของแผนกอื่น — ไม่มีสิทธิ์ดูข้อความ" : undefined}
                      className={cn(
                        "w-full rounded-xl border px-2.5 py-2 text-left",
                        h.restricted ? "cursor-default border-dashed border-line bg-sunken opacity-75" : "hover:border-line-strong",
                        !h.restricted && (h.id === p.currentCaseId ? "border-brand/40 bg-brand-soft" : "border-line bg-panel"),
                      )}
                    >
                      <div className="flex items-center gap-1.5 text-[12px]">
                        <span className="font-display font-semibold">{h.code}</span>
                        <span className="text-faint">{thaiDate(h.openedAt.slice(0, 10))}</span>
                        <span className={cn("ml-auto rounded-md px-1.5 text-[10.5px]", caseStatusMeta[h.status].cls)}>
                          {h.status === "closed" ? outcomeMeta[h.outcome ?? "other"].label : caseStatusMeta[h.status].short}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-muted">
                        {h.channelIds.map((cid) => {
                          const ch = channels.find((c) => c.id === cid);
                          return ch ? <span key={cid} className="h-1.5 w-1.5 rounded-sm" style={{ background: channelMeta[ch.type].color }} title={channelMeta[ch.type].label} /> : null;
                        })}
                        {h.category && <span>{categoryMeta[h.category].label}</span>}
                        {owner && <span>· {owner}</span>}
                        {h.restricted ? (
                          <span>· {departments.find((d) => d.id === h.departmentId)?.name ?? "แผนกอื่น"} — ไม่มีสิทธิ์ดูข้อความ</span>
                        ) : (
                          <span>· {h.messageCount} ข้อความ</span>
                        )}
                      </div>
                      {route.length > 0 && (
                        <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-faint">
                          โอน: {route.map((r, i) => (
                            <span key={i} className="flex items-center gap-1">
                              {i > 0 && <ArrowRight size={10} />}
                              {r}
                            </span>
                          ))}
                        </div>
                      )}
                      {h.closeNote && <div className="mt-1 line-clamp-2 text-[11px] text-muted">สรุป: {h.closeNote}</div>}
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        {/* บัญชีที่เชื่อมกัน */}
        <Section
          title={`ช่องทางที่ติดต่อ (${p.contacts.length})`}
          action={
            <button onClick={p.onOpenMerge} className="flex items-center gap-1 text-xs font-medium text-brand hover:underline">
              <Plus size={13} /> รวมกับแฟ้มอื่น
            </button>
          }
        >
          <ul className="space-y-1.5">
            {p.contacts.map(({ contact, channel, current }) => (
              <li key={contact.id} className={cn("flex items-center gap-2 rounded-xl border px-2.5 py-2", current ? "border-brand/40 bg-brand-soft" : "border-line bg-panel")}>
                <Avatar name={contact.name} color={contact.avatarColor} src={contact.pictureUrl} channel={channel.type} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px]">{contact.name}</div>
                  <div className="truncate text-[11px] text-faint">
                    {channelMeta[channel.type].label} · {channel.name}
                  </div>
                </div>
                {current && <span className="text-[10.5px] text-brand">แชทนี้</span>}
                {p.contacts.length > 1 && (
                  <button
                    onClick={() => p.onSplit(contact.id)}
                    title="แยกบัญชีนี้ออกเป็นแฟ้มใหม่ (กรณีรวมผิดคน)"
                    aria-label={`แยก ${contact.name} ออกจากแฟ้ม`}
                    className="rounded-md p-1 text-faint hover:bg-raised hover:text-ink"
                  >
                    <Split size={14} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Section>

        {/* นัดหมาย */}
        <Section
          title="คำขอนัดหมาย"
          action={
            <button onClick={p.onCreateAppointment} className="flex items-center gap-1 text-xs font-medium text-brand hover:underline">
              <CalendarPlus size={13} /> บันทึกคำขอนัด
            </button>
          }
        >
          {p.appointments.length === 0 && (
            <div className="flex flex-col items-center gap-1 rounded-xl border border-dashed border-line py-5 text-xs text-muted">
              <CalendarDays size={18} /> ยังไม่มีคำขอนัด
            </div>
          )}
          <div className="space-y-2">
            {p.appointments.map((a) => {
              const d = departments.find((x) => x.id === a.departmentId);
              return (
                <div key={a.id} className="rounded-xl border border-line bg-panel p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-display text-xs font-semibold">{a.code}</span>
                    <select
                      value={a.status}
                      onChange={(e) => p.onAppointmentStatus(a.id, e.target.value as Appointment["status"])}
                      className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium outline-none", appointmentStatusMeta[a.status].cls)}
                      aria-label={`สถานะ ${a.code}`}
                    >
                      {Object.entries(appointmentStatusMeta).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="mt-1.5 text-[13px]">{d?.name ?? "ยังไม่ระบุแผนก"}{a.doctor && <span className="text-muted"> · {a.doctor}</span>}</div>
                  <div className="mt-0.5 flex justify-between text-xs text-muted">
                    <span>{a.date ? thaiDate(a.date) : "ยังไม่ระบุวัน"} · {slotLabel[a.slot]}</span>
                  </div>
                  {a.reason && <div className="mt-1 border-t border-line pt-1 text-xs text-muted">{a.reason}</div>}
                </div>
              );
            })}
          </div>
        </Section>

        <Section title="กลุ่ม / สิทธิ (ใช้กรองและส่งประกาศ)">
          <div className="flex flex-wrap items-center gap-1.5">
            {pt.tagIds.map((id) => {
              const t = tags.find((x) => x.id === id);
              if (!t) return null;
              return <TagPill key={id} name={t.name} color={t.color} onRemove={() => p.onChange({ tagIds: pt.tagIds.filter((x) => x !== id) })} />;
            })}
            {available.length > 0 && (
              <div className="relative">
                <button
                  onClick={() => setAddingTag((v) => !v)}
                  className="flex items-center gap-0.5 rounded-full border border-dashed border-line-strong px-2 py-0.5 text-[11px] text-muted hover:border-brand hover:text-brand"
                >
                  <Plus size={11} /> เพิ่มแท็ก
                </button>
                {addingTag && (
                  <div className="absolute left-0 top-full z-10 mt-1 w-48 rounded-xl border border-line-strong bg-raised p-1 shadow-[0_12px_32px_rgb(var(--shade-rgb)/calc(0.5*var(--shade-k)))]">
                    {available.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => {
                          p.onChange({ tagIds: [...pt.tagIds, t.id] });
                          setAddingTag(false);
                        }}
                        className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-panel"
                      >
                        <span className="h-2 w-2 rounded-full" style={{ background: t.color }} /> {t.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </Section>

        <Section title="ข้อมูลติดต่อ">
          <Field icon={<Phone size={14} />} placeholder="เพิ่มเบอร์โทร" value={pt.phone} onSave={(v) => p.onChange({ phone: v })} />
          <Field icon={<Mail size={14} />} placeholder="เพิ่มอีเมล" value={pt.email} onSave={(v) => p.onChange({ email: v })} />
        </Section>

        <Section title="บันทึกสำหรับเจ้าหน้าที่ (ไม่ใช่ข้อมูลทางการแพทย์)">
          <textarea
            defaultValue={pt.note}
            key={pt.id}
            onBlur={(e) => e.target.value !== (pt.note ?? "") && p.onChange({ note: e.target.value })}
            placeholder="เช่น ความต้องการพิเศษในการติดต่อ ช่วงเวลาที่สะดวก"
            rows={3}
            className="w-full resize-none rounded-xl border border-line bg-panel px-2.5 py-2 text-[13px] outline-none placeholder:text-faint focus:border-brand/70"
          />
        </Section>
      </div>
    </aside>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="border-t border-line px-4 py-3.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[12px] font-medium text-faint">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

/** ข้อความที่กดแก้ได้ในที่ */
function Inline({
  value,
  display,
  placeholder,
  onSave,
  className,
  type = "text",
  label,
}: {
  value: string;
  display?: string;
  placeholder?: string;
  onSave: (v: string) => void;
  className?: string;
  type?: "text" | "date";
  label: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  if (editing) {
    const commit = () => {
      setEditing(false);
      if (draft.trim() !== value) onSave(draft.trim());
    };
    return (
      <input
        autoFocus
        type={type}
        aria-label={label}
        value={draft}
        max={type === "date" ? new Date().toISOString().slice(0, 10) : undefined}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
        className={cn("w-full rounded-md border border-brand/70 bg-panel px-1.5 py-0.5 outline-none", className)}
      />
    );
  }
  return (
    <button
      onClick={() => {
        setDraft(value);
        setEditing(true);
      }}
      title={`แก้ไข${label}`}
      className={cn("block max-w-full truncate rounded-md text-left hover:bg-raised", !value && "font-normal text-faint", className)}
    >
      {value ? (display ?? value) : placeholder}
    </button>
  );
}

function Field({ icon, value, placeholder, onSave }: { icon: React.ReactNode; value?: string; placeholder: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  if (editing) {
    const commit = () => {
      setEditing(false);
      if (draft.trim() !== (value ?? "")) onSave(draft.trim());
    };
    return (
      <div className="flex items-start gap-2 py-1">
        <span className="mt-1.5 text-muted">{icon}</span>
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && commit()}
          className="w-full rounded-lg border border-brand/70 bg-panel px-2 py-1 text-[13px] outline-none"
        />
      </div>
    );
  }
  return (
    <button
      onClick={() => {
        setDraft(value ?? "");
        setEditing(true);
      }}
      className="flex w-full items-start gap-2 rounded-md px-1 py-1.5 text-left text-[13px] hover:bg-raised"
    >
      <span className="mt-0.5 text-muted">{icon}</span>
      <span className={value ? "" : "text-muted"}>{value || placeholder}</span>
    </button>
  );
}
