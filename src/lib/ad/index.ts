import { Client, InvalidCredentialsError } from "ldapts";
import { prisma } from "@/lib/db";
import { decryptJson } from "@/lib/crypto";
import mockDir from "./mock-directory.json";

// เข้าสู่ระบบด้วยบัญชี AD ของโรงพยาบาล
//   local = รหัสผ่านในระบบนี้ (แบบเดิม)
//   mock  = ไดเรกทอรีจำลอง (ทดลองขั้นตอน/อบรม)
//   ldap  = Active Directory จริงผ่าน LDAP/LDAPS
// บทบาทและแผนกมาจาก “กลุ่ม” ใน AD ตามตารางจับคู่ในหน้าตั้งค่า · ต้องอยู่ในกลุ่มที่ให้สิทธิ์อย่างน้อย 1 กลุ่มจึงเข้าได้

export type AuthMode = "local" | "mock" | "ldap";

export interface GroupRule {
  /** ชื่อกลุ่ม (CN) เช่น RuamChat-Users หรือ DN เต็ม */
  group: string;
  /** สิทธิ์ที่ได้จากกลุ่มนี้ (ว่าง = ไม่ให้สิทธิ์เข้าใช้ ใช้กำหนดแผนกอย่างเดียว) */
  role?: "admin" | "agent";
  /** แผนกที่ได้จากกลุ่มนี้ */
  departmentId?: string;
}

export interface LdapSettings {
  url: string;
  baseDn: string;
  bindDn: string;
  /** encryptJson({ secret }) */
  bindPasswordEnc?: string;
  userFilter: string;
  startTls: boolean;
  /** ไม่ตรวจใบรับรอง (ทดสอบเท่านั้น) */
  tlsInsecure: boolean;
  timeoutMs: number;
}

export interface AuthSettings {
  mode: AuthMode;
  /** ในโหมด AD ใครยังเข้าด้วยรหัสผ่านในระบบได้: owners = เฉพาะเจ้าของ (บัญชีฉุกเฉิน) · everyone = ทุกบัญชีที่ไม่ใช่ AD */
  localLogin: "owners" | "everyone";
  /** สร้างบัญชีในรวมแชทให้อัตโนมัติเมื่อผู้ใช้ AD เข้าครั้งแรก */
  autoProvision: boolean;
  /** อายุ session ของบัญชี AD (ชั่วโมง) */
  sessionHours: number;
  rules: GroupRule[];
  ldap: LdapSettings;
}

export const DEFAULT_AUTH: AuthSettings = {
  mode: "local",
  localLogin: "owners",
  autoProvision: true,
  sessionHours: 12,
  rules: [],
  ldap: {
    url: "",
    baseDn: "",
    bindDn: "",
    userFilter: "(&(objectClass=user)(sAMAccountName={username}))",
    startTls: false,
    tlsInsecure: false,
    timeoutMs: 5000,
  },
};

export async function authSettings(orgId: string): Promise<AuthSettings> {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
  const s = (org.settings as { auth?: Partial<AuthSettings> })?.auth ?? {};
  return { ...DEFAULT_AUTH, ...s, ldap: { ...DEFAULT_AUTH.ldap, ...(s.ldap ?? {}) }, rules: s.rules ?? [] };
}

export function publicAuth(s: AuthSettings) {
  const { bindPasswordEnc, ...ldap } = s.ldap;
  return { ...s, ldap: { ...ldap, hasBindPassword: !!bindPasswordEnc } };
}

/* ------------------------------------------------------------------ */

export interface DirectoryUser {
  username: string;
  displayName: string;
  email?: string;
  /** ชื่อกลุ่ม (CN) */
  groups: string[];
  /** DN เต็มของกลุ่ม (ถ้ามี) */
  groupDns: string[];
  disabled: boolean;
  department?: string;
}

export class DirectoryError extends Error {
  constructor(
    message: string,
    public code: "invalid" | "not_found" | "disabled" | "unavailable" | "ambiguous" | "config",
  ) {
    super(message);
  }
}

/** "HOSPITAL\mali.s" / "mali.s@hospital.local" / "Mali.S" → "mali.s" */
export function normUsername(input: string) {
  let u = input.trim();
  if (u.includes("\\")) u = u.split("\\").pop()!;
  if (u.includes("@")) u = u.split("@")[0];
  return u.toLowerCase();
}

/** กันการฉีดคำสั่งในตัวกรอง LDAP (RFC 4515) */
export function escapeFilter(s: string) {
  return s.replace(/[\\*()\0]/g, (c) => "\\" + c.charCodeAt(0).toString(16).padStart(2, "0"));
}

const cnOf = (dn: string) => /^CN=([^,]+)/i.exec(dn)?.[1] ?? dn;

/* ---------- โหมดจำลอง ---------- */
const mockUsers = mockDir.users as { username: string; displayName: string; mail?: string; department?: string; groups: string[]; disabled?: boolean }[];

function mockFind(username: string): DirectoryUser | null {
  const u = mockUsers.find((x) => x.username === username);
  if (!u) return null;
  return { username: u.username, displayName: u.displayName, email: u.mail, groups: u.groups, groupDns: [], disabled: !!u.disabled, department: u.department };
}

/* ---------- LDAP ---------- */
async function ldapClient(l: LdapSettings) {
  if (!l.url || !l.baseDn) throw new DirectoryError("ยังไม่ได้ตั้งค่าที่อยู่ AD / Base DN", "config");
  const client = new Client({
    url: l.url,
    timeout: l.timeoutMs,
    connectTimeout: l.timeoutMs,
    ...(l.url.startsWith("ldaps://") && { tlsOptions: { rejectUnauthorized: !l.tlsInsecure } }),
  });
  if (l.startTls) await client.startTLS({ rejectUnauthorized: !l.tlsInsecure });
  return client;
}

const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);
const str = (v: unknown) => {
  const x = first(v);
  return x == null ? undefined : Buffer.isBuffer(x) ? x.toString("utf8") : String(x);
};

async function ldapLookup(l: LdapSettings, username: string): Promise<{ dn: string; user: DirectoryUser } | null> {
  const client = await ldapClient(l);
  try {
    const bindPw = l.bindPasswordEnc ? decryptJson<{ secret: string }>(l.bindPasswordEnc).secret : "";
    if (!l.bindDn || !bindPw) throw new DirectoryError("ยังไม่ได้ตั้งค่าบัญชีบริการ (bind DN / รหัสผ่าน)", "config");
    await client.bind(l.bindDn, bindPw).catch((e) => {
      if (e instanceof InvalidCredentialsError) throw new DirectoryError("บัญชีบริการเข้า AD ไม่ได้ — ตรวจ bind DN / รหัสผ่าน (ติดต่อฝ่าย IT)", "unavailable");
      throw new DirectoryError("เชื่อมต่อ AD ไม่ได้ — ติดต่อฝ่าย IT", "unavailable");
    });
    const filter = l.userFilter.replaceAll("{username}", escapeFilter(username));
    const { searchEntries } = await client.search(l.baseDn, {
      scope: "sub",
      filter,
      sizeLimit: 2,
      attributes: ["sAMAccountName", "displayName", "cn", "mail", "userPrincipalName", "memberOf", "userAccountControl", "department"],
    });
    if (!searchEntries.length) return null;
    if (searchEntries.length > 1) throw new DirectoryError("พบบัญชีชื่อนี้มากกว่า 1 บัญชีใน AD — ตรวจตัวกรองผู้ใช้", "ambiguous");
    // ชื่อแอตทริบิวต์ใน LDAP ไม่สนตัวพิมพ์ — อ่านแบบไม่สนตัวพิมพ์
    const e: Record<string, unknown> = { dn: searchEntries[0].dn };
    for (const [k, v] of Object.entries(searchEntries[0])) {
      const empty = Array.isArray(v) && v.length === 0;
      if (!empty || !(k.toLowerCase() in e)) e[k.toLowerCase()] = v;
    }
    const memberOf = ([] as unknown[]).concat(e.memberof ?? []).map((g) => (Buffer.isBuffer(g) ? g.toString("utf8") : String(g)));
    const uac = Number(str(e.useraccountcontrol) ?? 0);
    return {
      dn: String(e.dn),
      user: {
        username: (str(e.samaccountname) ?? username).toLowerCase(),
        displayName: str(e.displayname) ?? str(e.cn) ?? username,
        email: str(e.mail) ?? str(e.userprincipalname),
        groups: memberOf.map(cnOf),
        groupDns: memberOf,
        disabled: (uac & 2) === 2, // ACCOUNTDISABLE
        department: str(e.department),
      },
    };
  } catch (e) {
    if (e instanceof DirectoryError) throw e;
    throw new DirectoryError("เชื่อมต่อ AD ไม่ได้ — ติดต่อฝ่าย IT", "unavailable");
  } finally {
    await client.unbind().catch(() => {});
  }
}

async function ldapVerify(l: LdapSettings, dn: string, password: string) {
  const client = await ldapClient(l);
  try {
    await client.bind(dn, password);
    return true;
  } catch (e) {
    if (e instanceof InvalidCredentialsError || (e as { code?: number })?.code === 49) return false;
    throw new DirectoryError("เชื่อมต่อ AD ไม่ได้ — ติดต่อฝ่าย IT", "unavailable");
  } finally {
    await client.unbind().catch(() => {});
  }
}

/** ค้นผู้ใช้ใน AD (ไม่ตรวจรหัสผ่าน) — ใช้กับปุ่มทดสอบในหน้าตั้งค่า */
export async function lookupUser(s: AuthSettings, input: string): Promise<DirectoryUser | null> {
  const username = normUsername(input);
  if (s.mode === "mock") return mockFind(username);
  if (s.mode === "ldap") return (await ldapLookup(s.ldap, username))?.user ?? null;
  throw new DirectoryError("อยู่ในโหมดรหัสผ่านในระบบ — ไม่ได้เชื่อม AD", "config");
}

/** ตรวจชื่อผู้ใช้ + รหัสผ่านกับ AD */
export async function authenticate(s: AuthSettings, input: string, password: string): Promise<DirectoryUser> {
  const username = normUsername(input);
  // รหัสผ่านว่าง = LDAP “unauthenticated bind” ผ่านได้โดยไม่ตรวจ → ต้องปฏิเสธเสมอ
  if (!username || !password) throw new DirectoryError("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง", "invalid");
  if (s.mode === "mock") {
    const u = mockFind(username);
    if (!u) throw new DirectoryError("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง", "not_found");
    if (password !== mockDir.password) throw new DirectoryError("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง", "invalid");
    if (u.disabled) throw new DirectoryError("บัญชี AD นี้ถูกปิดใช้งาน", "disabled");
    return u;
  }
  if (s.mode !== "ldap") throw new DirectoryError("ไม่ได้เชื่อม AD", "config");
  const found = await ldapLookup(s.ldap, username);
  if (!found) throw new DirectoryError("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง", "not_found");
  if (!(await ldapVerify(s.ldap, found.dn, password))) throw new DirectoryError("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง", "invalid");
  if (found.user.disabled) throw new DirectoryError("บัญชี AD นี้ถูกปิดใช้งาน", "disabled");
  return found.user;
}

/** กลุ่ม → บทบาท/แผนก · role null = ไม่มีสิทธิ์เข้าใช้ */
export function mapGroups(rules: GroupRule[], u: Pick<DirectoryUser, "groups" | "groupDns">) {
  const has = (g: string) => {
    const k = g.trim().toLowerCase();
    return u.groups.some((x) => x.toLowerCase() === k) || u.groupDns.some((x) => x.toLowerCase() === k);
  };
  const hit = rules.filter((r) => r.group.trim() && has(r.group));
  const role = hit.some((r) => r.role === "admin") ? "admin" : hit.some((r) => r.role === "agent") ? "agent" : null;
  const managesDept = rules.some((r) => r.departmentId);
  const departmentId = hit.find((r) => r.departmentId)?.departmentId ?? null;
  return { role, departmentId, managesDept, matched: hit.map((r) => r.group) } as const;
}
