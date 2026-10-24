"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import type { Patient, ProfileTagCategory } from "@/lib/types";
import { useWorkspace } from "./workspace";
import { cn, profileCategoryMeta } from "@/lib/utils";

// แท็กคนไข้ 4 หมวด: ความต้องการพิเศษ / การสื่อสาร / สิ่งที่ชอบ / สิ่งที่ไม่ชอบ
// เลือกจากรายการกลาง หรือพิมพ์ใหม่ (แท็กใหม่ใช้ได้ทันที และรอผู้ดูแลพิจารณาเข้ารายการกลาง)

const CATS: ProfileTagCategory[] = ["need", "communication", "like", "dislike"];

export type AddTag = { defId: string; note?: string } | { category: ProfileTagCategory; label: string; note?: string };

export function ProfileTags({
  patient,
  onAdd,
  onRemove,
}: {
  patient: Patient;
  onAdd: (t: AddTag) => Promise<void> | void;
  onRemove: (id: string) => void;
}) {
  const { profileTagDefs, agents } = useWorkspace();
  const [adding, setAdding] = useState<ProfileTagCategory | null>(null);

  return (
    <div className="space-y-2.5">
      {CATS.map((cat) => {
        const mine = patient.profileTags.filter((t) => t.category === cat);
        const meta = profileCategoryMeta[cat];
        return (
          <div key={cat}>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11.5px] text-muted">{meta.label}</span>
              <button
                onClick={() => setAdding(adding === cat ? null : cat)}
                className="flex items-center gap-0.5 text-[11px] text-brand hover:underline"
                aria-label={`เพิ่มแท็ก${meta.label}`}
              >
                <Plus size={11} /> เพิ่ม
              </button>
            </div>
            <div className="flex flex-wrap gap-1">
              {mine.length === 0 && adding !== cat && <span className="text-[11.5px] text-faint">—</span>}
              {mine.map((t) => {
                const by = agents.find((a) => a.id === t.addedById)?.name;
                return (
                  <span
                    key={t.id}
                    title={`${by ? `ใส่โดย ${by}` : ""} ${t.addedAt.slice(0, 10)}${t.note ? `\n${t.note}` : ""}`}
                    className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] ring-1 ring-inset", meta.tone)}
                  >
                    {t.label}
                    {t.note && <span className="opacity-70">· {t.note}</span>}
                    <button onClick={() => onRemove(t.id)} className="opacity-60 hover:opacity-100" aria-label={`ลบแท็ก ${t.label}`}>
                      <X size={11} />
                    </button>
                  </span>
                );
              })}
            </div>
            {adding === cat && (
              <AddBox
                category={cat}
                options={profileTagDefs.filter((d) => d.category === cat && d.active && !patient.profileTags.some((t) => t.defId === d.id))}
                onCancel={() => setAdding(null)}
                onAdd={async (t) => {
                  await onAdd(t);
                  setAdding(null);
                }}
              />
            )}
          </div>
        );
      })}
      <p className="text-[11px] leading-snug text-faint">ใช้คำสุภาพ บอกสิ่งที่ควรทำ ไม่ใส่ข้อมูลทางการแพทย์ — คนไข้มีสิทธิ์ขอดูข้อมูลนี้</p>
    </div>
  );
}

function AddBox({
  category,
  options,
  onAdd,
  onCancel,
}: {
  category: ProfileTagCategory;
  options: { id: string; label: string; suggested: boolean }[];
  onAdd: (t: AddTag) => void;
  onCancel: () => void;
}) {
  const [q, setQ] = useState("");
  const [note, setNote] = useState("");
  const s = q.trim().toLowerCase();
  const matches = options.filter((o) => !s || o.label.toLowerCase().includes(s)).slice(0, 8);
  const exact = options.find((o) => o.label.toLowerCase() === s);
  return (
    <div className="mt-1.5 rounded-xl border border-line-strong bg-panel p-2">
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
          if (e.key === "Enter" && q.trim().length >= 2) onAdd(exact ? { defId: exact.id, note: note.trim() || undefined } : { category, label: q.trim(), note: note.trim() || undefined });
        }}
        placeholder="ค้นหาหรือพิมพ์แท็กใหม่"
        aria-label="ค้นหาหรือพิมพ์แท็กใหม่"
        maxLength={60}
        className="w-full rounded-lg border border-line bg-sunken px-2 py-1 text-[12.5px] outline-none placeholder:text-faint focus:border-brand/70"
      />
      <div className="mt-1.5 flex max-h-40 flex-wrap gap-1 overflow-y-auto thin-scroll">
        {matches.map((o) => (
          <button
            key={o.id}
            onClick={() => onAdd({ defId: o.id, note: note.trim() || undefined })}
            className="rounded-md border border-line px-1.5 py-0.5 text-[11.5px] hover:border-brand/60 hover:bg-brand-soft"
          >
            {o.label}
            {o.suggested && <span className="ml-1 text-faint">(รอพิจารณา)</span>}
          </button>
        ))}
        {q.trim().length >= 2 && !exact && (
          <button
            onClick={() => onAdd({ category, label: q.trim(), note: note.trim() || undefined })}
            className="rounded-md border border-dashed border-brand/60 px-1.5 py-0.5 text-[11.5px] text-brand"
          >
            + เพิ่ม “{q.trim()}”
          </button>
        )}
      </div>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="หมายเหตุสั้นๆ (ไม่บังคับ) เช่น ภาษาพม่า"
        maxLength={200}
        className="mt-1.5 w-full rounded-lg border border-line bg-sunken px-2 py-1 text-[12px] outline-none placeholder:text-faint focus:border-brand/70"
      />
    </div>
  );
}
