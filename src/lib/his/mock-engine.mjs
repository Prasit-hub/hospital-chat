// ตัวจำลอง HIS: ใช้ร่วมกันระหว่างโหมด mock (ในตัวแอป) และ scripts/mock-his-gateway.mjs (เซิร์ฟเวอร์จำลองสำหรับทดสอบโหมด live)
// เขียนเป็น JavaScript เพื่อให้รันด้วย node ได้ตรงๆ โดยไม่ต้อง build

const TITLES = /^(นาย|นางสาว|นาง|น\.ส\.|ด\.ช\.|ด\.ญ\.|เด็กชาย|เด็กหญิง|mr\.?|mrs\.?|ms\.?|miss)\s*/i;

/** @param {string} s */
export const normName = (s) => s.trim().replace(TITLES, "").replace(/\s+/g, " ").toLowerCase();
/** @param {string} s */
export const normPhone = (s) => {
  const d = String(s).replace(/\D/g, "");
  return d.startsWith("66") && d.length === 11 ? "0" + d.slice(2) : d;
};

/** วันที่ตามเวลาไทย + เลื่อนวัน */
export function bkkDay(offset = 0, now = Date.now()) {
  return new Date(now + 7 * 3600_000 + offset * 86_400_000).toISOString().slice(0, 10);
}

const mask = (name) => {
  const [first, last] = name.split(" ");
  return last ? `${first} ${[...last][0]}.` : first;
};

const pub = (p) => ({
  hn: p.hn,
  name: p.name,
  birthDate: p.birthDate,
  sex: p.sex ?? null,
  phoneLast4: p.phone ? p.phone.slice(-4) : null,
  status: p.status,
  mergedToHn: p.mergedToHn ?? null,
});

/**
 * ค้นคนไข้: ต้องมีวันเกิด + (HN | เลขบัตร | ชื่อ+เบอร์โทร) ไม่รับการค้นบางส่วน
 * @returns {{result: "match"|"multiple"|"not_found", patients: object[], checkedAt: string} | {error: string}}
 */
export function matchPatients(data, q, now = Date.now()) {
  const checkedAt = new Date(now).toISOString();
  if (!q || !/^\d{4}-\d{2}-\d{2}$/.test(q.birthDate ?? "")) return { error: "ต้องระบุวันเกิด (YYYY-MM-DD)" };
  const sameBirth = data.patients.filter((p) => p.birthDate === q.birthDate);
  let found = [];
  if (q.hn) found = sameBirth.filter((p) => p.hn === String(q.hn).trim());
  else if (q.nationalId) found = sameBirth.filter((p) => p.nationalId && p.nationalId === String(q.nationalId).replace(/\D/g, ""));
  else if (q.name && q.phone) {
    const byName = sameBirth.filter((p) => normName(p.name) === normName(q.name));
    found = byName.filter((p) => p.phone && normPhone(p.phone) === normPhone(q.phone));
    // ชื่อ+วันเกิดตรงแต่เบอร์ไม่ตรง → ใกล้เคียง ให้เจ้าหน้าที่ถามข้อมูลเพิ่ม (ปิดชื่อบางส่วน ไม่ส่ง HN)
    if (!found.length && byName.length)
      return { result: "multiple", patients: byName.slice(0, 5).map((p) => ({ ...pub(p), hn: p.hn.slice(0, 3) + "****", name: mask(p.name), phoneLast4: null })), checkedAt };
  } else return { error: "ต้องระบุ HN หรือเลขบัตรประชาชน หรือชื่อ-นามสกุลพร้อมเบอร์โทร" };
  if (!found.length) return { result: "not_found", patients: [], checkedAt };
  if (found.length > 1) return { result: "multiple", patients: found.slice(0, 5).map((p) => ({ ...pub(p), hn: p.hn.slice(0, 3) + "****", name: mask(p.name), phoneLast4: null })), checkedAt };
  return { result: "match", patients: [pub(found[0])], checkedAt };
}

/** นัดของ HN ในช่วงวันที่ */
export function appointmentsOf(data, hn, from, to, now = Date.now()) {
  const p = data.patients.find((x) => x.hn === hn);
  if (!p) return null;
  return p.appointments
    .map((a) => ({
      id: a.id,
      date: bkkDay(a.dayOffset, now),
      time: a.time ?? null,
      clinicCode: a.clinicCode ?? null,
      clinicName: a.clinicName,
      doctorName: a.doctorName ?? null,
      status: a.status,
      instructions: a.instructions ?? null,
      sourceRef: a.sourceRef ?? null,
    }))
    .filter((a) => (!from || a.date >= from) && (!to || a.date <= to))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** การมาโรงพยาบาลล่าสุดของ HN */
export function encountersOf(data, hn, limit = 3, now = Date.now()) {
  const p = data.patients.find((x) => x.hn === hn);
  if (!p) return null;
  return p.encounters
    .map((e) => {
      const start = `${bkkDay(e.dayOffset, now)}T${e.start}:00+07:00`;
      const end = e.durationMin == null ? null : new Date(Date.parse(start) + e.durationMin * 60_000).toISOString();
      return { id: e.id, type: e.type, startAt: start, endAt: end, clinicName: e.clinicName, ward: e.ward ?? null, status: e.status };
    })
    .sort((a, b) => Date.parse(b.startAt) - Date.parse(a.startAt))
    .slice(0, Math.max(1, Math.min(10, limit)));
}
