import { dispatchDueBroadcasts } from "@/lib/broadcast";
import { pollAllEmailChannels } from "@/lib/email-poller";
import { autoCloseWaiting } from "@/lib/cases";

// งานเบื้องหลังของเซิร์ฟเวอร์ (ถ้ารันหลาย instance ให้ตั้ง DISABLE_SCHEDULER=true ในทุกตัวยกเว้นตัวเดียว)
// - ส่งบรอดแคสต์ที่ถึงเวลา ทุก 30 วินาที
// - ตรวจอีเมลเข้า ทุก EMAIL_POLL_SECONDS วินาที (ค่าเริ่มต้น 60)
// - ปิดงานที่รอคนไข้ตอบนานเกินกำหนด ทุก 5 นาที
const g = globalThis as unknown as { __bgTimers?: ReturnType<typeof setInterval>[] };
if (process.env.DISABLE_SCHEDULER !== "true" && !g.__bgTimers) {
  const emailEvery = Math.max(15, Number(process.env.EMAIL_POLL_SECONDS) || 60) * 1000;
  g.__bgTimers = [
    setInterval(() => dispatchDueBroadcasts().catch((e) => console.error("[scheduler]", e)), 30_000),
    setInterval(() => pollAllEmailChannels().catch((e) => console.error("[email-poller]", e)), emailEvery),
    setInterval(() => autoCloseWaiting().catch((e) => console.error("[auto-close]", e)), 5 * 60_000),
  ];
}
