# คู่มือขึ้นระบบจริง (Production)

> นี่คือวิธีเดียวที่รองรับสำหรับระบบจริง ถ้าต้องการแค่ลิงก์ preview ไว้ดูหน้าจอหรือทดสอบระหว่างพัฒนา ใช้ Neon + Render แทนได้ — ดู README หัวข้อ 7 (เหตุผลที่ production ยังไม่ใช้ Render ก็อยู่ในหัวข้อนั้น)

ระบบรันด้วย Docker บนเซิร์ฟเวอร์ Linux เครื่องเดียว ประกอบด้วย:

| ส่วน | หน้าที่ |
|---|---|
| `db` | PostgreSQL 16 (ไม่เปิดพอร์ตออกนอกเครื่อง) |
| `migrate` | อัปเดตโครงสร้างฐานข้อมูลอัตโนมัติก่อนเปิดแอปทุกครั้ง |
| `app` | ตัวเว็บ Next.js (โหมด standalone, รันด้วยผู้ใช้ที่ไม่ใช่ root) |
| `caddy` | รับ HTTPS พร้อมออกใบรับรอง Let's Encrypt ให้อัตโนมัติ |
| `backup` | สำรองฐานข้อมูลวันละครั้งไว้ที่ `./backups` |

ใช้เวลาประมาณ 30–60 นาทีสำหรับครั้งแรก

---

## 1. สิ่งที่ต้องเตรียม

- **เซิร์ฟเวอร์ (VPS)** Ubuntu 24.04 อย่างน้อย 2 vCPU / 2 GB RAM / 40 GB ดิสก์ เลือก region ใกล้ไทย (เช่น สิงคโปร์) เพื่อความเร็ว
- **โดเมนหรือซับโดเมน** เช่น `chat.yourshop.com`
- **LINE Official Account** ที่เปิด Messaging API และ/หรือ **Meta App** สำหรับ Messenger/Instagram (ดู README หัวข้อ 3)
- โค้ดโปรเจกต์นี้ใน Git repository ส่วนตัว (แนะนำ GitHub private repo) — **ต้องมีโฟลเดอร์ `prisma/migrations`**

## 2. ชี้โดเมนมาที่เซิร์ฟเวอร์

ที่ผู้ให้บริการ DNS สร้าง record:

| Type | Name | Value |
|---|---|---|
| A | `chat` | IP ของเซิร์ฟเวอร์ |

รอให้ `ping chat.yourshop.com` ตอบกลับเป็น IP เซิร์ฟเวอร์ก่อนไปขั้นที่ 5 (ไม่งั้นออกใบรับรอง HTTPS ไม่ได้)

## 3. เตรียมเซิร์ฟเวอร์ (ทำครั้งเดียว)

```bash
ssh root@<IP>

# อัปเดต + อัปเดตความปลอดภัยอัตโนมัติ
apt update && apt -y upgrade && apt -y install unattended-upgrades git

# ไฟร์วอลล์: เปิดแค่ SSH / HTTP / HTTPS
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable

# swap 2 GB (ช่วยตอน build บนเครื่อง RAM น้อย)
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab

# ติดตั้ง Docker
curl -fsSL https://get.docker.com | sh
```

## 4. นำโค้ดขึ้นเซิร์ฟเวอร์

```bash
cd /opt
git clone https://github.com/<you>/<repo>.git ruamchat
cd ruamchat
```

(repo ส่วนตัวต้องตั้ง deploy key หรือ personal access token ก่อน)

## 5. ตั้งค่าและเปิดระบบ

```bash
cp .env.production.example .env.production
nano .env.production          # แก้ทุกค่าที่อยู่ใน <...>
```

สร้างค่าลับด้วย:

```bash
openssl rand -base64 32       # → ENCRYPTION_KEY
openssl rand -hex 24          # → POSTGRES_PASSWORD
openssl rand -hex 16          # → META_VERIFY_TOKEN
```

> **ENCRYPTION_KEY สำคัญมาก** ใช้ถอดรหัส token ของทุกช่องทาง ถ้าหายหรือเปลี่ยน ต้องเชื่อมช่องทางใหม่ทั้งหมด — เก็บสำรองไว้ในที่ปลอดภัย (เช่น password manager)

```bash
./deploy/rc.sh check          # ตรวจค่าใน .env.production
./deploy/rc.sh up             # build + เปิดระบบ (ครั้งแรกใช้เวลา 3–10 นาที)
./deploy/rc.sh create-owner   # สร้างบัญชีเจ้าของ — จดรหัสผ่านที่แสดง
./deploy/rc.sh status         # ต้องเห็น {"ok":true,...}
```

เปิด `https://chat.yourshop.com` → เข้าสู่ระบบ → **เปลี่ยนรหัสผ่านทันที** (เมนูรูปโปรไฟล์)

## 6. เชื่อมช่องทาง

ทำตาม README หัวข้อ 3 โดยใช้ URL จริง:

- **LINE**: ตั้งค่า → เชื่อมต่อช่องทาง → LINE → วาง Channel secret + access token → คัดลอก Webhook URL ไปใส่ใน LINE Developers Console → กด Verify → เปิด Use webhook
  และใน LINE Official Account Manager ปิด "Auto-response messages" ของ LINE
- **Messenger / Instagram**: Meta App → Webhooks → Callback URL `https://chat.yourshop.com/api/webhooks/meta` + Verify token = `META_VERIFY_TOKEN` → แล้วเชื่อมเพจจากหน้าตั้งค่า

ทดสอบ: ทักแชทเข้า OA/เพจจากมือถือ → ต้องเห็นข้อความเด้งขึ้นในหน้าแชททันที

## 7. เช็กลิสต์ก่อนเปิดให้ลูกค้าใช้

- [ ] เข้าเว็บผ่าน https ได้ และ `./deploy/rc.sh status` ตอบ ok
- [ ] เปลี่ยนรหัสผ่านเจ้าของแล้ว และเพิ่มทีมครบ (ตั้งค่า → ทีมและสิทธิ์)
- [ ] ทักทดสอบจาก LINE / Messenger / Instagram แล้วเห็นในระบบ และตอบกลับได้
- [ ] ตั้งข้อความต้อนรับ / นอกเวลาทำการ / ข้อมูลการชำระเงิน
- [ ] Meta App ผ่าน App Review และเปลี่ยนเป็นโหมด Live (ไม่งั้นรับข้อความได้เฉพาะผู้ทดสอบ)
- [ ] เก็บ `ENCRYPTION_KEY` และ `.env.production` สำรองไว้นอกเซิร์ฟเวอร์
- [ ] ตั้งสำรองไฟล์ `./backups` ออกนอกเซิร์ฟเวอร์ (ดูข้อ 8)
- [ ] ตั้ง uptime monitor (เช่น UptimeRobot) ไปที่ `https://chat.yourshop.com/api/health`

## 8. ดูแลระบบประจำวัน

| งาน | คำสั่ง |
|---|---|
| อัปเดตเวอร์ชันใหม่ | `./deploy/rc.sh update` (git pull + build + migrate อัตโนมัติ) |
| ดู log | `./deploy/rc.sh logs` หรือ `./deploy/rc.sh logs caddy` |
| สถานะ | `./deploy/rc.sh status` |
| สำรองทันที | `./deploy/rc.sh backup` |
| กู้คืน | `./deploy/rc.sh restore backups/<ไฟล์>.sql.gz` |

**สำรองข้อมูลออกนอกเครื่อง** — ไฟล์ใน `./backups` อยู่บนเซิร์ฟเวอร์เดียวกัน ถ้าเครื่องเสียจะหายไปด้วย ให้คัดลอกออกเป็นประจำ เช่นจากเครื่องคุณ:

```bash
rsync -av root@<IP>:/opt/ruamchat/backups/ ~/ruamchat-backups/
```

หรือใช้ snapshot อัตโนมัติของผู้ให้บริการ VPS ร่วมด้วย แนะนำทดลองกู้คืน (restore) บนเครื่องทดสอบอย่างน้อยเดือนละครั้ง

## 9. แก้ปัญหาที่พบบ่อย

| อาการ | สาเหตุ / วิธีแก้ |
|---|---|
| เปิดเว็บไม่ได้ / ใบรับรองผิด | DNS ยังไม่ชี้มา หรือพอร์ต 80/443 ถูกปิด → `./deploy/rc.sh logs caddy` |
| เข้าสู่ระบบแล้วเด้งกลับหน้า login | เปิดผ่าน http แทน https (cookie ตั้งเป็น Secure) |
| LINE กด Verify ไม่ผ่าน | Channel secret ไม่ตรง หรือ URL ผิด — ดู `./deploy/rc.sh logs` หา `invalid signature` |
| Meta ไม่ส่ง webhook มา | ยังไม่ได้ subscribe field `messages` หรือแอปยังไม่ Live / ผู้ทักไม่ใช่ผู้ทดสอบ |
| ตอบ Messenger ไม่ได้ "เกิน 24 ชม." | เป็นกฎของ Meta — รอลูกค้าทักใหม่ หรือขอสิทธิ์ Human Agent |
| `migrate` ล้มเหลว | `./deploy/rc.sh logs migrate` — มักเกิดจากรหัสผ่านฐานข้อมูลใน .env.production ไม่ตรงกับตอนสร้างครั้งแรก |
| build ล้มเพราะหน่วยความจำ | เพิ่ม swap (ข้อ 3) หรือใช้เครื่อง RAM 4 GB |

## 10. ข้อจำกัดของสถาปัตยกรรมนี้

- ออกแบบให้รัน **แอป 1 ตัว** (realtime ใช้ตัวกระจายเหตุการณ์ในหน่วยความจำ) — ถ้าต้องการหลายเครื่อง ต้องเปลี่ยน `src/lib/realtime.ts` เป็น Redis pub/sub
- ตัวจับเวลาบรอดแคสต์อยู่ในตัวแอป ถ้าแอปหยุด รายการที่ตั้งเวลาไว้จะถูกส่งเมื่อแอปกลับมา
