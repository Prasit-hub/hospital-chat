// แปลงเวลาเป็นสตริงเวลาท้องถิ่น "YYYY-MM-DDTHH:mm:ss" (ไม่มี Z) ตาม APP_TZ
// UI ใช้รูปแบบนี้ในการแสดงผล จึงไม่ขึ้นกับ timezone ของเบราว์เซอร์/เซิร์ฟเวอร์

export const APP_TZ = process.env.NEXT_PUBLIC_APP_TZ || "Asia/Bangkok";

const fmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export function toLocalIso(d: Date | string | number): string {
  const parts = Object.fromEntries(fmt.formatToParts(new Date(d)).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

/** วันที่ภาษาไทยแบบเต็ม เช่น "ศุกร์ 23 ต.ค. 2569" (date-only เก็บเป็น UTC เที่ยงคืน) */
export function thaiDateLong(d: Date) {
  return new Intl.DateTimeFormat("th-TH", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(d);
}
