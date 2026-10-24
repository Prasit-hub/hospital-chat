#!/usr/bin/env bash
# ดับเบิลคลิกไฟล์นี้ใน Finder เพื่อเปิดระบบสำหรับพัฒนา (PostgreSQL + HIS จำลอง + npm run dev)
# ถ้าต้องการอุโมงค์ ngrok สำหรับ webhook LINE/Meta ให้รัน ./scripts/dev-up.sh --tunnel ใน Terminal แทน
cd "$(dirname "$0")" && ./scripts/dev-up.sh
echo; read -n 1 -s -r -p "กดปุ่มใดก็ได้เพื่อปิดหน้าต่าง"
