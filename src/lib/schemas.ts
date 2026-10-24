import { z } from "zod";

// schema ที่ใช้ร่วมกันระหว่าง route สร้าง/แก้ไข

export const QuickReplyBody = z.object({
  shortcut: z.string().trim().min(2).max(30).regex(/^\/\S+$/, "ต้องขึ้นต้นด้วย / และไม่มีช่องว่าง"),
  title: z.string().trim().min(1).max(80),
  text: z.string().trim().min(1).max(2000),
});

export const AutoReplyBody = z.object({
  keywords: z.array(z.string().trim().min(1).max(50)).min(1).max(20),
  reply: z.string().trim().min(1).max(2000),
  enabled: z.boolean().default(true),
  channels: z.array(z.enum(["line", "facebook", "instagram", "tiktok"])).min(1),
});

export const TagBody = z.object({
  name: z.string().trim().min(1).max(40),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

export const DepartmentBody = z.object({
  name: z.string().trim().min(1).max(80),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  /** เตือนเมื่องานที่โอนมาไม่มีคนรับเกินกี่นาที (null = ใช้ค่าขององค์กร) */
  transferSlaMinutes: z.number().int().min(0).max(1440).nullable().optional(),
  /** คนในแผนกนี้เห็นงานทุกแผนก (เมื่อเปิดการเห็นแชทตามแผนก) */
  seesAllCases: z.boolean().optional(),
});

export const CATEGORIES = ["appointment", "rights", "cost", "results", "symptom", "other"] as const;
