export type ChannelType = "line" | "facebook" | "instagram" | "tiktok" | "email";

export type ConversationStatus = "open" | "pending" | "closed";

export interface Channel {
  id: string;
  type: ChannelType;
  name: string; // ชื่อเพจ / OA
  connected: boolean;
  followers: number;
}

export interface Agent {
  id: string;
  name: string;
  role: "owner" | "admin" | "agent";
  online: boolean;
  color: string;
  departmentId?: string;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
}

/** บัญชีของคนไข้ในช่องทางหนึ่ง (LINE / Facebook / IG / อีเมล) */
export interface Contact {
  id: string;
  name: string;
  avatarColor: string;
  pictureUrl?: string;
  channelId: string;
  patientId: string;
  createdAt: string;
}

/** แฟ้มคนไข้ — รวมทุกบัญชีช่องทางของคนเดียวกัน */
export interface Patient {
  id: string;
  hn?: string;
  /** เวลาที่ตรวจ HN + วันเกิดตรงกับ HIS ล่าสุด (ว่าง = HN กรอกเอง) */
  hisVerifiedAt?: string;
  name: string;
  birthDate?: string; // YYYY-MM-DD
  phone?: string;
  email?: string;
  note?: string;
  avatarColor: string;
  tagIds: string[];
  contactIds: string[];
  profileTags: PatientProfileTag[];
  createdAt: string;
}

export interface Department {
  id: string;
  name: string;
  color: string;
  /** เตือนเมื่องานโอนไม่มีคนรับเกินกี่นาที (ไม่ระบุ = ค่าขององค์กร) */
  slaMinutes?: number;
}

export type InquiryCategory = "appointment" | "rights" | "cost" | "results" | "symptom" | "other";

export type MessageKind = "text" | "image" | "sticker" | "note" | "system";

export interface Message {
  id: string;
  conversationId: string;
  from: "customer" | "agent" | "bot" | "system";
  agentId?: string;
  kind: MessageKind;
  text: string;
  imageUrl?: string;
  caseId?: string;
  /** หัวเรื่องอีเมล */
  subject?: string;
  at: string; // เวลาท้องถิ่น "YYYY-MM-DDTHH:mm:ss"
  read?: boolean;
  status?: "received" | "sending" | "sent" | "failed" | "read";
  error?: string;
}

/** ห้องแชทของบัญชีช่องทางหนึ่ง (สถานะงานอยู่ที่ Case) */
export interface Conversation {
  id: string;
  contactId: string;
  channelId: string;
  unread: number;
  lastMessageAt: string;
  lastMessage: string;
  source?: "dm" | "comment";
  lastCustomerMessageAt?: string;
  patientId: string;
}

export type CaseStatus = "queued" | "in_progress" | "waiting_patient" | "transfer_pending" | "closed";
export type CaseOutcome = "answered" | "appointed" | "advised_visit" | "referred_external" | "no_response" | "spam" | "merged" | "other";

export interface CaseTransfer {
  id: string;
  fromUserId?: string;
  fromDeptId?: string;
  toDeptId?: string;
  reason: string;
  doneNote?: string;
  createdAt: string;
  acceptedAt?: string;
  acceptedById?: string;
  returnedAt?: string;
  returnReason?: string;
  recalledAt?: string;
}

/** งาน: 1 เรื่องที่คนไข้ติดต่อ */
export interface Case {
  id: string;
  /** เช่น CASE-10024 */
  code: string;
  patientId: string;
  status: CaseStatus;
  ownerId?: string;
  departmentId?: string;
  category?: InquiryCategory;
  urgent: boolean;
  urgentReason?: string;
  verified?: { at: string; byId?: string; method: string };
  openedAt: string;
  acceptedAt?: string;
  waitingSince?: string;
  closedAt?: string;
  closedById?: string;
  outcome?: CaseOutcome;
  closeNote?: string;
  /** การโอนที่รอแผนกรับอยู่ */
  pendingTransfer?: CaseTransfer;
  /** การโอนล่าสุด (ใช้แสดง "โอนมาจาก …") */
  lastTransfer?: CaseTransfer;
}

export type ProfileTagCategory = "need" | "communication" | "like" | "dislike";

export interface ProfileTagDef {
  id: string;
  category: ProfileTagCategory;
  label: string;
  active: boolean;
  suggested: boolean;
  blocksBroadcast: boolean;
}

export interface PatientProfileTag {
  id: string;
  defId: string;
  category: ProfileTagCategory;
  label: string;
  note?: string;
  addedById?: string;
  addedAt: string;
}

export type AppointmentStatus = "requested" | "confirmed" | "completed" | "cancelled";

export interface Appointment {
  id: string;
  /** เลขคำขอที่แสดง เช่น APT-10012 */
  code: string;
  patientId: string;
  departmentId?: string;
  doctor?: string;
  date?: string; // YYYY-MM-DD
  slot: "morning" | "afternoon" | "any";
  reason?: string;
  caseId?: string;
  /** เลขนัดใน HIS ที่ผูกกับคำขอนี้แล้ว */
  hisAppointmentId?: string;
  status: AppointmentStatus;
  createdAt: string;
}

/** คู่แฟ้มที่ระบบคิดว่าอาจเป็นคนเดียวกัน */
export interface MergeCandidate {
  aId: string;
  bId: string;
  score: number;
  reasons: string[];
  /** HN ไม่ตรงกัน → รวมไม่ได้ */
  blocked?: string;
}

export interface QuickReply {
  id: string;
  shortcut: string;
  title: string;
  text: string;
}

export interface AutoReplyRule {
  id: string;
  keywords: string[];
  reply: string;
  enabled: boolean;
  channels: ChannelType[];
}
