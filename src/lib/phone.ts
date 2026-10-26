// ยูทิลเกี่ยวกับเบอร์โทร ใช้ร่วมกันระหว่าง HIS mock engine และช่องทางโทรศัพท์ (Yeastar)
// เดิม normPhone อยู่ใน src/lib/his/mock-engine.mjs อย่างเดียว — ดึงมาไว้ที่นี่เพื่อให้ทั้งสองฝั่งใช้ตรรกะเดียวกัน

/** ตัดอักขระที่ไม่ใช่เลขออก แล้วแปลง "66..." (รหัสประเทศไทย) ให้เป็น "0..." แบบเบอร์ในประเทศ */
export function normPhone(s: string): string {
  const d = String(s ?? "").replace(/\D/g, "");
  return d.startsWith("66") && d.length === 11 ? "0" + d.slice(2) : d;
}
