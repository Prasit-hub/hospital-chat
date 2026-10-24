"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, Check, CopyCheck, Loader2, Search, ShieldX, X } from "lucide-react";
import type { Channel, Contact, MergeCandidate, Patient } from "@/lib/types";
import { birthLabel, channelMeta, cn } from "@/lib/utils";
import { Avatar, ChannelTag } from "@/components/ui";
import { api } from "@/components/inbox/workspace";

// รวมแฟ้มคนไข้: เลือกแฟ้มที่ระบบแนะนำ (หรือค้นเอง) → เทียบข้อมูลทีละช่อง → เลือกค่าที่ถูกต้อง → ยืนยัน

type Field = "name" | "hn" | "birthDate" | "phone" | "email";
const FIELDS: { id: Field; label: string; fmt?: (v: string) => string }[] = [
  { id: "name", label: "ชื่อ" },
  { id: "hn", label: "HN" },
  { id: "birthDate", label: "วันเกิด", fmt: (v) => birthLabel(v) ?? v },
  { id: "phone", label: "เบอร์โทร" },
  { id: "email", label: "อีเมล" },
];

const norm = (f: Field, v?: string) => {
  if (!v) return "";
  if (f === "phone") return v.replace(/\D/g, "").slice(-9);
  if (f === "hn") return v.replace(/[\s-]/g, "").toUpperCase();
  if (f === "name") return v.replace(/^(คุณ|นาย|นางสาว|นาง)\s*/, "").replace(/\s+/g, "").toLowerCase();
  return v.trim().toLowerCase();
};

interface Props {
  basePatientId: string;
  /** เปิดมาพร้อมเลือกแฟ้มนี้ไว้ (เช่น จากรายการแนะนำ หรือ HN ชนกัน) */
  otherPatientId?: string;
  channels: Channel[];
  onClose: () => void;
  onMerged: (survivorId: string) => void;
}

export function MergeDialog(p: Props) {
  const [base, setBase] = useState<{ patient: Patient; contacts: Contact[] } | null>(null);
  const [candidates, setCandidates] = useState<MergeCandidate[]>([]);
  const [pool, setPool] = useState<Record<string, Patient>>({});
  const [contacts, setContacts] = useState<Record<string, Contact>>({});
  const [otherId, setOtherId] = useState<string | undefined>(p.otherPatientId);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Patient[] | null>(null);
  const [survivor, setSurvivor] = useState<"a" | "b">("a");
  const [pick, setPick] = useState<Partial<Record<Field, "a" | "b">>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addContacts = (cs: Contact[]) => setContacts((m) => ({ ...m, ...Object.fromEntries(cs.map((c) => [c.id, c])) }));
  const addPatients = (ps: Patient[]) => setPool((m) => ({ ...m, ...Object.fromEntries(ps.map((x) => [x.id, x])) }));

  useEffect(() => {
    Promise.all([
      api<{ patient: Patient; contacts: Contact[] }>(`/api/patients/${p.basePatientId}`),
      api<{ candidates: MergeCandidate[]; patients: Patient[]; contacts: Contact[] }>(`/api/patients/${p.basePatientId}/candidates`),
    ])
      .then(([b, c]) => {
        setBase(b);
        addContacts([...b.contacts, ...c.contacts]);
        addPatients(c.patients);
        setCandidates(c.candidates);
        if (!p.otherPatientId && c.candidates[0]) setOtherId(c.candidates[0].aId === b.patient.id ? c.candidates[0].bId : c.candidates[0].aId);
      })
      .catch((e) => setError(e.message));
  }, [p.basePatientId, p.otherPatientId]);

  // แฟ้มที่เลือกจากภายนอก (เช่น HN ชนกัน) แต่ไม่อยู่ในรายการแนะนำ → โหลดเพิ่ม
  useEffect(() => {
    if (!otherId || pool[otherId]) return;
    api<{ patient: Patient; contacts: Contact[] }>(`/api/patients/${otherId}`)
      .then((r) => {
        addPatients([r.patient]);
        addContacts(r.contacts);
      })
      .catch((e) => setError(e.message));
  }, [otherId, pool]);

  // ค้นหาแฟ้มอื่นเอง
  useEffect(() => {
    if (q.trim().length < 2) {
      setResults(null);
      return;
    }
    const t = setTimeout(() => {
      api<{ patients: Patient[]; contacts: Contact[] }>(`/api/patients?q=${encodeURIComponent(q.trim())}`)
        .then((r) => {
          addContacts(r.contacts);
          addPatients(r.patients);
          setResults(r.patients.filter((x) => x.id !== p.basePatientId).slice(0, 8));
        })
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q, p.basePatientId]);

  const A = base?.patient;
  const B = otherId ? pool[otherId] : undefined;
  const cand = candidates.find((c) => (c.aId === otherId || c.bId === otherId) && (c.aId === A?.id || c.bId === A?.id));

  // แฟ้มหลักเริ่มต้น: แฟ้มที่มี HN หรือแฟ้มที่เปิดก่อน
  useEffect(() => {
    if (!A || !B) return;
    setSurvivor(!A.hn && B.hn ? "b" : A.hn && !B.hn ? "a" : A.createdAt <= B.createdAt ? "a" : "b");
    setPick({});
    setConfirmed(false);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [A?.id, B?.id]);

  const hnBlocked = !!(A?.hn && B?.hn && norm("hn", A.hn) !== norm("hn", B.hn));

  const rows = useMemo(() => {
    if (!A || !B) return [];
    return FIELDS.map((f) => {
      const a = A[f.id] ?? "";
      const b = B[f.id] ?? "";
      const same = !!a && !!b && norm(f.id, a) === norm(f.id, b);
      const conflict = !!a && !!b && !same;
      // ค่าที่จะใช้หลังรวม
      const chosen = pick[f.id] ?? survivor;
      const result = conflict ? (chosen === "a" ? a : b) : (survivor === "a" ? a || b : b || a);
      return { ...f, a, b, same, conflict, chosen, result };
    });
  }, [A, B, pick, survivor]);

  async function merge() {
    if (!A || !B) return;
    setBusy(true);
    setError(null);
    const survivorId = survivor === "a" ? A.id : B.id;
    const mergedId = survivor === "a" ? B.id : A.id;
    const pickBody: Partial<Record<Field, "survivor" | "merged">> = {};
    for (const r of rows) if (r.conflict) pickBody[r.id] = r.chosen === survivor ? "survivor" : "merged";
    try {
      await api("/api/patients/merge", { method: "POST", json: { survivorId, mergedId, pick: pickBody, reason: reason || undefined, confirmed: true } });
      p.onMerged(survivorId);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  async function notSame() {
    if (!A || !B) return;
    setBusy(true);
    try {
      await api("/api/patients/dismiss", { method: "POST", json: { aId: A.id, bId: B.id } });
      setCandidates((cs) => cs.filter((c) => c !== cand));
      setOtherId(undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const chOf = (contactId: string) => p.channels.find((c) => c.id === contacts[contactId]?.channelId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="merge-title">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-line-strong bg-panel shadow-[0_30px_80px_rgb(var(--shade-rgb)/calc(0.6*var(--shade-k)))]">
        <header className="flex items-center gap-3 border-b border-line px-5 py-3.5">
          <CopyCheck size={20} className="text-brand" />
          <div className="min-w-0 flex-1">
            <h2 id="merge-title" className="font-display text-lg font-semibold leading-tight">รวมแฟ้มคนไข้</h2>
            <p className="text-xs text-muted">รวมแล้วจะเห็นแชททุกช่องทางในแฟ้มเดียว — ยกเลิกการรวมได้ภายหลังโดยผู้ดูแล</p>
          </div>
          <button onClick={p.onClose} className="rounded-lg p-1 text-muted hover:bg-raised" aria-label="ปิด">
            <X size={20} />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {/* ซ้าย: เลือกแฟ้มที่จะรวม */}
          <aside className="border-b border-line bg-sunken p-3 md:w-72 md:shrink-0 md:overflow-y-auto md:border-b-0 md:border-r thin-scroll">
            <label className="flex items-center gap-2 rounded-xl border border-line bg-panel px-3 py-2 text-sm focus-within:border-brand/60">
              <Search size={15} className="text-muted" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นแฟ้มด้วยชื่อ / HN / เบอร์" className="w-full bg-transparent outline-none placeholder:text-faint" />
            </label>
            {results ? (
              <List title={`ผลการค้นหา (${results.length})`}>
                {results.length === 0 && <p className="px-2 py-3 text-xs text-muted">ไม่พบแฟ้มที่ตรงกัน</p>}
                {results.map((x) => (
                  <PatientChoice key={x.id} p={x} active={x.id === otherId} onClick={() => setOtherId(x.id)} channels={x.contactIds.map(chOf)} />
                ))}
              </List>
            ) : (
              <List title={`ระบบแนะนำ (${candidates.length})`}>
                {!base && <Loader2 className="mx-auto my-4 animate-spin text-muted" size={18} />}
                {base && candidates.length === 0 && <p className="px-2 py-3 text-xs text-muted">ไม่พบแฟ้มที่ข้อมูลตรงกัน ลองค้นหาด้วยชื่อ HN หรือเบอร์โทร</p>}
                {candidates.map((c) => {
                  const id = c.aId === base?.patient.id ? c.bId : c.aId;
                  const x = pool[id];
                  if (!x) return null;
                  return (
                    <PatientChoice key={id} p={x} active={id === otherId} onClick={() => setOtherId(id)} channels={x.contactIds.map(chOf)}>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {c.blocked ? (
                          <span className="rounded bg-hot/15 px-1.5 text-[10.5px] text-hot">HN ไม่ตรงกัน</span>
                        ) : (
                          c.reasons.map((r) => (
                            <span key={r} className={cn("rounded px-1.5 text-[10.5px]", r === "ชื่อตรงกัน" ? "bg-raised text-muted" : "bg-ok/15 text-ok")}>
                              {r}
                            </span>
                          ))
                        )}
                      </div>
                    </PatientChoice>
                  );
                })}
              </List>
            )}
          </aside>

          {/* ขวา: เทียบข้อมูล */}
          <section className="min-h-0 flex-1 overflow-y-auto p-4 thin-scroll sm:p-5">
            {!A || !B ? (
              <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-2 text-center text-sm text-muted">
                {error ? <span className="text-hot">{error}</span> : <>เลือกแฟ้มทางซ้ายเพื่อเทียบข้อมูล</>}
              </div>
            ) : (
              <>
                {cand && !cand.blocked && cand.reasons.length === 1 && cand.reasons[0] === "ชื่อตรงกัน" && (
                  <p className="mb-3 rounded-xl border border-warm/40 bg-warm/10 px-3 py-2 text-xs text-warm">
                    ตรงกันแค่ชื่อ — ควรยืนยันกับคนไข้ (เช่น วันเกิด หรือเบอร์โทร) ก่อนรวม
                  </p>
                )}
                {hnBlocked && (
                  <p role="alert" className="mb-3 flex items-start gap-2 rounded-xl border border-hot/40 bg-hot/10 px-3 py-2 text-sm text-hot">
                    <ShieldX size={16} className="mt-0.5 shrink-0" /> HN ไม่ตรงกัน ({A.hn} / {B.hn}) — รวมไม่ได้ ตรวจสอบกับเวชระเบียนก่อน หรือกด “ไม่ใช่คนเดียวกัน”
                  </p>
                )}

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] border-separate border-spacing-0 text-sm">
                    <thead>
                      <tr>
                        <th className="w-24" />
                        {(["a", "b"] as const).map((side) => {
                          const x = side === "a" ? A : B;
                          const isSurvivor = survivor === side;
                          return (
                            <th key={side} className="px-1.5 pb-2 text-left align-bottom font-normal">
                              <div className={cn("rounded-xl border p-2.5", isSurvivor ? "border-brand/60 bg-brand-soft" : "border-line bg-sunken")}>
                                <div className="flex items-center gap-2">
                                  <Avatar name={x.name} color={x.avatarColor} size={30} />
                                  <div className="min-w-0">
                                    <div className="truncate font-medium">{x.name}</div>
                                    <div className="text-[11px] text-faint">{side === "a" ? "แฟ้มที่เปิดอยู่" : "แฟ้มที่เลือก"}</div>
                                  </div>
                                </div>
                                <label className="mt-2 flex cursor-pointer items-center gap-1.5 text-xs">
                                  <input type="radio" name="survivor" checked={isSurvivor} onChange={() => setSurvivor(side)} className="accent-[var(--color-brand)]" />
                                  <span className={isSurvivor ? "font-semibold text-brand" : "text-muted"}>ใช้เป็นแฟ้มหลัก</span>
                                </label>
                              </div>
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.id}>
                          <th className="border-t border-line py-2 pr-2 text-left text-xs font-normal text-muted">
                            {r.label}
                            {r.same && (
                              <span className="ml-1 inline-flex items-center gap-0.5 text-ok" title="ตรงกัน">
                                <Check size={12} />
                              </span>
                            )}
                          </th>
                          {(["a", "b"] as const).map((side) => {
                            const v = side === "a" ? r.a : r.b;
                            const on = r.conflict && r.chosen === side;
                            return (
                              <td key={side} className="border-t border-line px-1.5 py-1.5">
                                {r.conflict ? (
                                  <label className={cn("flex cursor-pointer items-center gap-2 rounded-lg border px-2 py-1.5", on ? "border-brand/60 bg-brand-soft" : "border-line")}>
                                    <input
                                      type="radio"
                                      name={`pick-${r.id}`}
                                      checked={on}
                                      onChange={() => setPick((x) => ({ ...x, [r.id]: side }))}
                                      className="accent-[var(--color-brand)]"
                                      disabled={r.id === "hn"}
                                    />
                                    <span className={cn(r.id === "hn" && "font-display")}>{r.fmt ? r.fmt(v) : v}</span>
                                  </label>
                                ) : (
                                  <span className={cn("block px-2 py-1.5", !v && "text-faint", r.same && "text-ok", r.id === "hn" && "font-display")}>
                                    {v ? (r.fmt ? r.fmt(v) : v) : "—"}
                                  </span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                      <tr>
                        <th className="border-t border-line py-2 pr-2 text-left align-top text-xs font-normal text-muted">ช่องทาง</th>
                        {(["a", "b"] as const).map((side) => {
                          const x = side === "a" ? A : B;
                          return (
                            <td key={side} className="border-t border-line px-1.5 py-2 align-top">
                              <div className="flex flex-col gap-1">
                                {x.contactIds.map((cid) => {
                                  const c = contacts[cid];
                                  const ch = chOf(cid);
                                  return c && ch ? (
                                    <ChannelTag key={cid} type={ch.type}>
                                      {channelMeta[ch.type].label} · {c.name}
                                    </ChannelTag>
                                  ) : null;
                                })}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* ผลลัพธ์หลังรวม */}
                <div className="mt-4 rounded-2xl border border-line bg-sunken p-3.5">
                  <div className="flex items-center gap-2 text-xs text-faint">
                    <ArrowLeftRight size={13} /> หลังรวม
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-display text-[17px] font-semibold">{rows[0]?.result}</span>
                    {rows[1]?.result && <span className="font-display text-sm text-muted">HN {rows[1].result}</span>}
                    <span className="text-sm text-muted">{A.contactIds.length + B.contactIds.length} ช่องทาง · ประวัติแชทรวมเป็นเส้นเวลาเดียว</span>
                  </div>
                </div>

                <label className="mt-4 flex items-start gap-2 text-sm">
                  <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-1 accent-[var(--color-brand)]" disabled={hnBlocked} />
                  <span>
                    ตรวจสอบแล้วว่าเป็นบุคคลเดียวกัน
                    <span className="block text-xs text-muted">เช่น คนไข้ยืนยันในแชท หรือข้อมูลยืนยันตัวตน (HN / วันเกิด / เบอร์โทร) ตรงกัน</span>
                  </span>
                </label>
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={500}
                  placeholder="หมายเหตุการรวม (ไม่บังคับ) เช่น คนไข้แจ้งว่าใช้ทั้ง LINE และ Facebook"
                  className="mt-2 w-full rounded-xl border border-line bg-sunken px-3 py-2 text-sm outline-none placeholder:text-faint focus:border-brand/70"
                />
                {error && <p className="mt-2 text-sm text-hot">{error}</p>}
              </>
            )}
          </section>
        </div>

        <footer className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3">
          {cand && (
            <button onClick={notSame} disabled={busy} className="rounded-xl px-3 py-2 text-sm text-muted hover:bg-raised hover:text-ink disabled:opacity-50">
              ไม่ใช่คนเดียวกัน
            </button>
          )}
          <button onClick={p.onClose} className="ml-auto rounded-xl px-3 py-2 text-sm text-muted hover:bg-raised">
            ยกเลิก
          </button>
          <button
            onClick={merge}
            disabled={!A || !B || !confirmed || hnBlocked || busy}
            className="flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-brand-ink hover:bg-brand-dark disabled:opacity-40"
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <CopyCheck size={15} />} รวมแฟ้ม
          </button>
        </footer>
      </div>
    </div>
  );
}

function List({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      <div className="px-1 pb-1.5 text-[11px] text-faint">{title}</div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function PatientChoice({
  p,
  active,
  onClick,
  channels,
  children,
}: {
  p: Patient;
  active: boolean;
  onClick: () => void;
  channels: (Channel | undefined)[];
  children?: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn("block w-full rounded-xl border p-2.5 text-left transition-colors", active ? "border-brand/60 bg-brand-soft" : "border-line bg-panel hover:border-line-strong")}
    >
      <div className="flex items-center gap-2">
        <Avatar name={p.name} color={p.avatarColor} size={28} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium">{p.name}</div>
          <div className="flex items-center gap-1 text-[11px] text-faint">
            {p.hn ? <span className="font-display">HN {p.hn}</span> : <span>ไม่มี HN</span>}
            <span className="flex gap-0.5">
              {channels.map((c, i) => c && <span key={i} className="h-1.5 w-1.5 rounded-sm" style={{ background: channelMeta[c.type].color }} />)}
            </span>
          </div>
        </div>
      </div>
      {children}
    </button>
  );
}
