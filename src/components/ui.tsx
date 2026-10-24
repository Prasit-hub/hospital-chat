"use client";

import { useState } from "react";
import type { ChannelType } from "@/lib/types";
import { channelMeta, cn, initials } from "@/lib/utils";

/** ป้ายช่องทาง: แถบสีเล็กๆ + ตัวย่อ */
export function ChannelBadge({ type, size = "sm" }: { type: ChannelType; size?: "xs" | "sm" }) {
  const meta = channelMeta[type];
  return (
    <span
      title={meta.label}
      className={cn(
        "inline-flex items-center justify-center rounded-[5px] font-display font-bold leading-none text-white ring-2 ring-canvas",
        size === "xs" ? "h-[15px] min-w-[15px] px-[3px] text-[8px]" : "h-[18px] min-w-[18px] px-1 text-[9px]",
      )}
      style={{ background: meta.color }}
    >
      {meta.short}
    </span>
  );
}

/** ป้ายช่องทางแบบข้อความ (ใช้ในหัวแชท / ตาราง) */
export function ChannelTag({ type, children }: { type: ChannelType; children?: React.ReactNode }) {
  const meta = channelMeta[type];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-line bg-sunken px-2 py-0.5 text-[11px] text-muted">
      <span className="h-1.5 w-1.5 rounded-sm" style={{ background: meta.color }} />
      {children ?? meta.label}
    </span>
  );
}

/** ภาพแทนตัว: แผ่นตัวอักษรมุมมน (ไม่ใช่วงกลม) สีอ่อนตามสีประจำตัว */
export function Avatar({
  name,
  color,
  src,
  channel,
  size = 40,
  online,
}: {
  name: string;
  color: string;
  src?: string;
  channel?: ChannelType;
  size?: number;
  online?: boolean;
}) {
  const [broken, setBroken] = useState(false);
  const radius = Math.round(size * 0.3);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {src && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          className="h-full w-full object-cover"
          style={{ borderRadius: radius }}
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
        />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center font-display font-semibold"
          style={{
            borderRadius: radius,
            background: `linear-gradient(145deg, ${color}40, ${color}1a)`,
            boxShadow: `inset 0 0 0 1px ${color}55`,
            color,
            fontSize: size * 0.42,
          }}
        >
          {initials(name)}
        </div>
      )}
      {channel && (
        <span className="absolute -bottom-1 -right-1">
          <ChannelBadge type={channel} size="xs" />
        </span>
      )}
      {online !== undefined && (
        <span
          className={cn("absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-canvas", online ? "bg-ok" : "bg-line-strong")}
        />
      )}
    </div>
  );
}

export function TagPill({ name, color, onRemove }: { name: string; color: string; onRemove?: () => void }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium"
      style={{ background: color + "1f", color, boxShadow: `inset 0 0 0 1px ${color}33` }}
    >
      <span className="h-1.5 w-1.5 rounded-sm" style={{ background: color }} />
      {name}
      {onRemove && (
        <button onClick={onRemove} className="ml-0.5 opacity-60 hover:opacity-100" aria-label={`ลบแท็ก ${name}`}>
          ×
        </button>
      )}
    </span>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 px-4 pb-2 pt-6 sm:px-6">
      <div>
        <h1 className="font-display text-[26px] font-semibold leading-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("rounded-2xl border border-line bg-panel", className)}>{children}</div>;
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-5 w-9 shrink-0 rounded-full border transition-colors",
        checked ? "border-brand bg-brand/25" : "border-line-strong bg-sunken",
      )}
    >
      <span
        className={cn(
          "absolute left-0 top-[2px] h-3.5 w-3.5 rounded-full transition-transform",
          checked ? "translate-x-[18px] bg-brand shadow-[0_0_8px_rgb(var(--brand-rgb)/0.7)]" : "translate-x-[2px] bg-muted",
        )}
      />
    </button>
  );
}
