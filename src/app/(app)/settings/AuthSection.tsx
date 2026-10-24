"use client";

import { useCallback, useEffect, useState } from "react";
import { CircleCheck, Loader2, Plus, TriangleAlert, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, Switch } from "@/components/ui";
import { api } from "@/components/inbox/workspace";

// ตั้งค่า → การเข้าสู่ระบบ (AD): โหมด, ค่าการเชื่อม LDAP, ตารางจับคู่กลุ่ม → สิทธิ์/แผนก, ทดสอบค้นผู้ใช้

const input = "w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none focus:border-brand";
const btnPrimary = "flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-brand-ink hover:bg-brand-dark disabled:opacity-40";
const btnGhost = "rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-raised";

type Run = (fn: () => Promise<unknown>, ok?: string) => Promise<boolean>;

interface AuthRule {
  group: string;
  role?: "admin" | "agent";
  departmentId?: string;
}
interface AuthConf {
  mode: "local" | "mock" | "ldap";
  localLogin: "owners" | "everyone";
  autoProvision: boolean;
  sessionHours: number;
  rules: AuthRule[];
  ldap: { url: string; baseDn: string; bindDn: string; userFilter: string; startTls: boolean; tlsInsecure: boolean; timeoutMs: number; hasBindPassword: boolean };
  adUsers: number;
}
type AuthTest =
  | { ok: false; detail: string }
  | {
      ok: true;
      user: { username: string; displayName: string; email?: string; groups: string[]; disabled: boolean; department?: string };
      result: { canLogin: boolean; role: "admin" | "agent" | null; department: string | null; matched: string[] };
    };

const AUTH_MODES: { id: AuthConf["mode"]; title: string; body: string }[] = [
  { id: "local", title: "รหัสผ่านในระบบ", body: "แบบเดิม — ผู้ดูแลสร้างบัญชีและออกรหัสผ่านให้เจ้าหน้าที่" },
  { id: "mock", title: "AD จำลอง", body: "บัญชี AD สมมติในตัวระบบ เพื่อทดลองขั้นตอนและอบรม — ห้ามใช้ตอนเปิดบริการจริง" },
  { id: "ldap", title: "Active Directory", body: "เข้าด้วยบัญชี Windows ของโรงพยาบาลผ่าน LDAP/LDAPS" },
];

export function AuthSection({ isOwner, departments, run }: { isOwner: boolean; departments: { id: string; name: string }[]; run: Run }) {
  const [c, setC] = useState<AuthConf | null>(null);
  const [bindPw, setBindPw] = useState("");
  const [probe, setProbe] = useState("");
  const [test, setTest] = useState<AuthTest | "busy" | null>(null);
  const load = useCallback(() => api<AuthConf>("/api/settings/auth").then(setC).catch(() => {}), []);
  useEffect(() => {
    load();
  }, [load]);
  if (!c) return <Card className="p-4 text-sm text-muted">กำลังโหลด…</Card>;
  const ro = !isOwner;
  const set = (patch: Partial<AuthConf>) => setC({ ...c, ...patch });
  const setL = (patch: Partial<AuthConf["ldap"]>) => setC({ ...c, ldap: { ...c.ldap, ...patch } });
  const setRule = (i: number, patch: Partial<AuthRule>) => set({ rules: c.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const save = () =>
    run(async () => {
      const { url, baseDn, bindDn, userFilter, startTls, tlsInsecure, timeoutMs } = c.ldap;
      const r = await api<AuthConf>("/api/settings/auth", {
        method: "PUT",
        json: {
          mode: c.mode,
          localLogin: c.localLogin,
          autoProvision: c.autoProvision,
          sessionHours: c.sessionHours,
          rules: c.rules.map((r) => ({ group: r.group, ...(r.role && { role: r.role }), ...(r.departmentId && { departmentId: r.departmentId }) })),
          ldap: { url, baseDn, bindDn, userFilter, startTls, tlsInsecure, timeoutMs, ...(bindPw && { bindPassword: bindPw }) },
        },
      });
      setC({ ...c, ...r });
      setBindPw("");
    }, "บันทึกการตั้งค่าการเข้าสู่ระบบแล้ว");
  const runTest = async () => {
    setTest("busy");
    try {
      setTest(await api<AuthTest>("/api/settings/auth/test", { method: "POST", json: { username: probe } }));
    } catch (e) {
      setTest({ ok: false, detail: (e as Error).message });
    }
  };
  const field = (label: string, el: React.ReactNode, wide = false) => (
    <label className={cn("text-xs text-muted", wide && "sm:col-span-2")}>
      {label}
      <span className="mt-1 block">{el}</span>
    </label>
  );

  return (
    <div className="space-y-3">
      <Card className="divide-y divide-line">
        <div className="px-5 py-4">
          <div className="text-sm font-semibold">การเข้าสู่ระบบ</div>
          <div className="text-xs text-muted">
            ใช้บัญชี AD ของโรงพยาบาลแทนรหัสผ่านแยก — บทบาทและแผนกมาจากกลุ่มใน AD ทุกครั้งที่เข้าสู่ระบบ ปิดบัญชีใน AD แล้วเข้ารวมแชทไม่ได้
          </div>
          {ro && <p className="mt-2 rounded-lg bg-warm/10 px-3 py-2 text-xs text-warm">ดูได้อย่างเดียว — แก้การตั้งค่าการเข้าสู่ระบบได้เฉพาะเจ้าของ</p>}
        </div>
        <fieldset className="grid gap-2 px-5 py-4 sm:grid-cols-3" disabled={ro}>
          <legend className="sr-only">วิธีเข้าสู่ระบบ</legend>
          {AUTH_MODES.map((m) => (
            <label key={m.id} className={cn("cursor-pointer rounded-xl border p-3 text-sm", c.mode === m.id ? "border-brand bg-brand-soft" : "border-line hover:border-line-strong")}>
              <span className="flex items-center gap-2 font-medium">
                <input
                  type="radio"
                  name="auth-mode"
                  checked={c.mode === m.id}
                  onChange={() => {
                    set({ mode: m.id });
                    setTest(null);
                  }}
                  className="accent-[var(--color-brand)]"
                />
                {m.title}
              </span>
              <span className="mt-1 block text-xs text-muted">{m.body}</span>
            </label>
          ))}
        </fieldset>

        {c.mode === "mock" && (
          <div className="px-5 py-4 text-xs text-muted">
            <div className="mb-1 font-medium text-ink">บัญชี AD จำลอง (รหัสผ่านทุกบัญชี: Mock@1234)</div>
            <ul className="grid gap-x-6 gap-y-0.5 sm:grid-cols-2">
              <li>mali.s — เจ้าหน้าที่ · อายุรกรรม</li>
              <li>pichai.f — เจ้าหน้าที่ · การเงินและสิทธิการรักษา</li>
              <li>noi.c — เจ้าหน้าที่ · ศูนย์ประสานงาน</li>
              <li>it.admin — ผู้ดูแล</li>
              <li>old.staff — บัญชีถูกปิดใน AD</li>
              <li>guest.user — ไม่อยู่ในกลุ่มที่ให้สิทธิ์</li>
            </ul>
          </div>
        )}

        {c.mode === "ldap" && (
          <fieldset className="grid gap-3 px-5 py-4 sm:grid-cols-2" disabled={ro}>
            {field("ที่อยู่ AD", <input className={input} value={c.ldap.url} onChange={(e) => setL({ url: e.target.value })} placeholder="ldaps://dc01.hospital.local:636" />, true)}
            {field("Base DN (ค้นผู้ใช้จาก)", <input className={input} value={c.ldap.baseDn} onChange={(e) => setL({ baseDn: e.target.value })} placeholder="OU=Staff,DC=hospital,DC=local" />)}
            {field("ตัวกรองผู้ใช้", <input className={input} value={c.ldap.userFilter} onChange={(e) => setL({ userFilter: e.target.value })} />)}
            {field(
              "บัญชีบริการ (bind DN)",
              <input className={input} value={c.ldap.bindDn} onChange={(e) => setL({ bindDn: e.target.value })} placeholder="CN=svc-ruamchat,OU=Service,DC=hospital,DC=local" autoComplete="off" />,
            )}
            {field(
              "รหัสผ่านบัญชีบริการ",
              <input
                type="password"
                className={input}
                value={bindPw}
                onChange={(e) => setBindPw(e.target.value)}
                autoComplete="new-password"
                placeholder={c.ldap.hasBindPassword ? "บันทึกไว้แล้ว — เว้นว่างเพื่อใช้ค่าเดิม" : "ใส่รหัสที่ได้จากฝ่าย IT"}
              />,
            )}
            <div className="flex flex-wrap items-center gap-4 text-sm sm:col-span-2">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={c.ldap.startTls} onChange={(e) => setL({ startTls: e.target.checked })} /> ใช้ StartTLS (กรณี ldap://)
              </label>
              <label className="flex items-center gap-2 text-warm">
                <input type="checkbox" checked={c.ldap.tlsInsecure} onChange={(e) => setL({ tlsInsecure: e.target.checked })} /> ไม่ตรวจใบรับรอง (ทดสอบเท่านั้น)
              </label>
              <label className="flex items-center gap-2">
                เวลารอ
                <input
                  type="number"
                  min={1000}
                  max={30000}
                  step={500}
                  className="w-24 rounded-lg border border-line bg-sunken px-2 py-1 text-right"
                  value={c.ldap.timeoutMs}
                  onChange={(e) => setL({ timeoutMs: Number(e.target.value) })}
                />
                มิลลิวินาที
              </label>
            </div>
          </fieldset>
        )}
      </Card>

      {c.mode !== "local" && (
        <Card className="divide-y divide-line">
          <div className="px-5 py-4">
            <div className="text-sm font-semibold">จับคู่กลุ่มใน AD → สิทธิ์และแผนก</div>
            <div className="text-xs text-muted">
              ต้องอยู่ในกลุ่มที่ให้สิทธิ์อย่างน้อย 1 กลุ่มจึงเข้าได้ · ตรงหลายกลุ่มใช้บทบาทสูงสุด · แผนกใช้กลุ่มแรกที่ตรงตามลำดับในตาราง · เจ้าของคงบทบาทเดิมเสมอ
            </div>
          </div>
          <fieldset disabled={ro}>
            <div className="hidden grid-cols-[1.4fr_1fr_1.2fr_auto] gap-2 px-5 pt-3 text-[11px] text-faint sm:grid">
              <span>ชื่อกลุ่ม (CN) หรือ DN เต็ม</span>
              <span>สิทธิ์</span>
              <span>แผนก</span>
              <span className="w-8" />
            </div>
            {c.rules.map((r, i) => (
              <div key={i} className="grid gap-2 px-5 py-2 sm:grid-cols-[1.4fr_1fr_1.2fr_auto]">
                <input className={input} value={r.group} onChange={(e) => setRule(i, { group: e.target.value })} placeholder="เช่น RuamChat-Users" aria-label="ชื่อกลุ่ม" />
                <select className={input} value={r.role ?? ""} onChange={(e) => setRule(i, { role: (e.target.value || undefined) as AuthRule["role"] })} aria-label={`สิทธิ์ของกลุ่ม ${r.group}`}>
                  <option value="">— ไม่ให้สิทธิ์เข้า</option>
                  <option value="agent">เจ้าหน้าที่ตอบแชท</option>
                  <option value="admin">ผู้ดูแล</option>
                </select>
                <select className={input} value={r.departmentId ?? ""} onChange={(e) => setRule(i, { departmentId: e.target.value || undefined })} aria-label={`แผนกของกลุ่ม ${r.group}`}>
                  <option value="">— ไม่กำหนดแผนก</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={() => set({ rules: c.rules.filter((_, j) => j !== i) })} className="rounded-lg p-2 text-muted hover:text-hot" aria-label={`ลบกลุ่ม ${r.group}`}>
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
            <div className="px-5 py-3">
              <button type="button" onClick={() => set({ rules: [...c.rules, { group: "" }] })} className={cn(btnGhost, "flex items-center gap-1 border border-line")}>
                <Plus size={14} /> เพิ่มกลุ่ม
              </button>
            </div>
          </fieldset>
          <fieldset className="grid gap-4 px-5 py-4 text-sm sm:grid-cols-2" disabled={ro}>
            <div>
              <div className="mb-1 text-xs text-muted">ใครยังเข้าด้วยรหัสผ่านในระบบได้</div>
              <label className="flex items-start gap-2">
                <input type="radio" name="local-login" className="mt-1" checked={c.localLogin === "owners"} onChange={() => set({ localLogin: "owners" })} />
                <span>เฉพาะเจ้าของ — บัญชีฉุกเฉินเมื่อ AD ใช้ไม่ได้ (แนะนำ)</span>
              </label>
              <label className="mt-1 flex items-start gap-2">
                <input type="radio" name="local-login" className="mt-1" checked={c.localLogin === "everyone"} onChange={() => set({ localLogin: "everyone" })} />
                <span>ทุกบัญชีที่ไม่ใช่ AD (ช่วงย้ายระบบ)</span>
              </label>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <span>
                  สร้างบัญชีให้อัตโนมัติเมื่อเข้าครั้งแรก
                  <span className="block text-xs text-muted">ปิด = ผู้ดูแลต้องเพิ่มเจ้าหน้าที่ (อีเมลตรงกับ AD) ก่อน</span>
                </span>
                <Switch checked={c.autoProvision} onChange={(v) => !ro && set({ autoProvision: v })} label="สร้างบัญชีอัตโนมัติ" />
              </div>
              <label className="flex items-center gap-2">
                ออกจากระบบอัตโนมัติหลัง
                <input
                  type="number"
                  min={1}
                  max={720}
                  className="w-20 rounded-lg border border-line bg-sunken px-2 py-1 text-right"
                  value={c.sessionHours}
                  onChange={(e) => set({ sessionHours: Number(e.target.value) })}
                />
                ชั่วโมง
              </label>
            </div>
          </fieldset>
        </Card>
      )}

      <Card className="divide-y divide-line">
        {c.mode !== "local" && (
          <div className="px-5 py-4">
            <div className="text-sm font-semibold">ทดสอบกับบัญชี AD</div>
            <div className="text-xs text-muted">ค้นผู้ใช้ด้วยค่าที่บันทึกแล้ว (ไม่ต้องใช้รหัสผ่านของผู้ใช้) แล้วดูว่าจะได้สิทธิ์อะไร — กดบันทึกก่อนทดสอบเมื่อแก้ค่า</div>
            <div className="mt-2 flex flex-wrap gap-2">
              <input className={input + " max-w-xs"} value={probe} onChange={(e) => setProbe(e.target.value)} placeholder="ชื่อผู้ใช้ AD เช่น mali.s" aria-label="ชื่อผู้ใช้ AD ที่จะทดสอบ" />
              <button className={cn(btnGhost, "border border-line")} onClick={runTest} disabled={!probe.trim() || test === "busy"}>
                {test === "busy" ? <Loader2 size={14} className="animate-spin" /> : "ค้นใน AD"}
              </button>
            </div>
            {test && test !== "busy" && !test.ok && (
              <p className="mt-2 flex items-center gap-1.5 text-sm text-hot" role="status">
                <TriangleAlert size={15} /> {test.detail}
              </p>
            )}
            {test && test !== "busy" && test.ok && (
              <div className="mt-3 rounded-xl border border-line p-3 text-sm" role="status">
                <div className="font-medium">
                  {test.user.displayName}{" "}
                  <span className="text-xs font-normal text-muted">
                    · {test.user.username}
                    {test.user.email ? ` · ${test.user.email}` : ""}
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {test.user.groups.map((g) => (
                    <span key={g} className={cn("rounded-md px-1.5 py-0.5 text-[11px]", test.result.matched.includes(g) ? "bg-brand-soft text-brand" : "bg-raised text-muted")}>
                      {g}
                    </span>
                  ))}
                </div>
                <p className={cn("mt-2 flex items-center gap-1.5", test.result.canLogin ? "text-ok" : "text-hot")}>
                  {test.result.canLogin ? <CircleCheck size={15} /> : <TriangleAlert size={15} />}
                  {test.user.disabled
                    ? "บัญชีถูกปิดใน AD — เข้าไม่ได้"
                    : test.result.role
                      ? `เข้าได้ในบทบาท${test.result.role === "admin" ? "ผู้ดูแล" : "เจ้าหน้าที่ตอบแชท"}${test.result.department ? ` · แผนก${test.result.department}` : ""}`
                      : "ไม่อยู่ในกลุ่มที่ให้สิทธิ์ — เข้าไม่ได้"}
                </p>
              </div>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 px-5 py-3">
          <span className="text-xs text-muted">บัญชี AD ในรวมแชทตอนนี้ {c.adUsers} บัญชี</span>
          {isOwner && (
            <button className={btnPrimary + " ml-auto"} onClick={save}>
              บันทึก
            </button>
          )}
        </div>
      </Card>
    </div>
  );
}
