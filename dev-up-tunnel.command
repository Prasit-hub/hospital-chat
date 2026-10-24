#!/usr/bin/env bash
# ดับเบิลคลิกเพื่อเปิดระบบพัฒนาพร้อมอุโมงค์ ngrok (webhook LINE/Meta)
cd "$(dirname "$0")" && ./scripts/dev-up.sh --tunnel
echo; read -n 1 -s -r -p "กดปุ่มใดก็ได้เพื่อปิดหน้าต่าง"
