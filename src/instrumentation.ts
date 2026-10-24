// รันครั้งเดียวตอนเซิร์ฟเวอร์เริ่ม: ตัวจับเวลาส่งบรอดแคสต์ที่ตั้งเวลาไว้
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
