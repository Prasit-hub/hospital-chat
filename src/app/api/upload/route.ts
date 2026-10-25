import { put } from "@vercel/blob";
import { apiError, handle, json } from "@/lib/api";
import { currentUser } from "@/lib/auth";

// อัปโหลดไฟล์ (ตอนนี้ใช้สำหรับรูปภาพที่เจ้าหน้าที่แนบส่งหาลูกค้า) ขึ้น Vercel Blob
// ใช้ได้เฉพาะตอนตั้งค่า BLOB_READ_WRITE_TOKEN ไว้ (ดู README หัวข้อ Vercel Blob)
// หมายเหตุ: นี่คือ storage สำหรับช่วงทดสอบ/dev เท่านั้น — production (Azure VM) ยังไม่ได้ตั้งค่าไว้ ดู DEPLOY.md
const MAX_BYTES = 10 * 1024 * 1024; // 10MB
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
// ไฟล์เอกสารทั่วไปที่อนุญาตให้แนบส่ง (นอกเหนือจากรูปภาพด้านบน)
const FILE_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
];
const ALLOWED_TYPES = [...IMAGE_TYPES, ...FILE_TYPES];
const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/plain": "txt",
  "text/csv": "csv",
};

export const POST = handle(async (req: Request) => {
  const me = await currentUser();
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return apiError("ยังไม่ได้ตั้งค่าที่เก็บไฟล์ (BLOB_READ_WRITE_TOKEN) — ติดต่อผู้ดูแลระบบ", 503);
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || !(file instanceof File)) return apiError("ไม่พบไฟล์ที่แนบมา", 400);
  if (!ALLOWED_TYPES.includes(file.type)) {
    return apiError("รองรับเฉพาะไฟล์รูปภาพ (JPEG, PNG, GIF, WebP), PDF, Word, Excel, ข้อความ หรือ CSV", 400);
  }
  if (file.size > MAX_BYTES) return apiError("ไฟล์ใหญ่เกินไป (จำกัด 10MB)", 400);

  const isImage = IMAGE_TYPES.includes(file.type);
  const ext = EXT_BY_TYPE[file.type] ?? "bin";
  const key = `chat-uploads/${me.orgId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const blob = await put(key, file, { access: "public", addRandomSuffix: false, contentType: file.type });
  return json({ url: blob.url, kind: isImage ? "image" : "file", fileName: file.name }, 201);
});
