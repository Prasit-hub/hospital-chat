import { EventEmitter } from "node:events";

// ตัวกระจายเหตุการณ์แบบ in-process สำหรับ Server-Sent Events (/api/events)
// รองรับเซิร์ฟเวอร์ instance เดียว — ถ้ารันหลาย instance ให้เปลี่ยนเป็น Redis pub/sub

export type InboxEvent =
  | { type: "message"; conversationId: string; messageId: string }
  | { type: "message_status"; conversationId: string; messageId: string; status: string }
  | { type: "conversation"; conversationId: string }
  | { type: "contact"; contactId: string }
  | { type: "patient"; patientId: string }
  | { type: "case"; caseId: string }
  /** รวม/ยกเลิกการรวมแฟ้ม — หน้าจอควรโหลดข้อมูลใหม่ทั้งหมด */
  | { type: "patients_changed" }
  /** เปิด/ปิด Agent (ผูกเลขต่อ) — แจ้งทุกแท็บ/อุปกรณ์ของผู้ใช้คนนั้นให้ซิงก์สถานะ */
  | { type: "agent_presence"; userId: string; online: boolean; extension?: string };

const g = globalThis as unknown as { inboxBus?: EventEmitter };
export const bus = g.inboxBus ?? (g.inboxBus = new EventEmitter().setMaxListeners(1000));

export function publish(ev: InboxEvent) {
  bus.emit("event", ev);
}

export function subscribe(fn: (ev: InboxEvent) => void) {
  bus.on("event", fn);
  return () => bus.off("event", fn);
}
