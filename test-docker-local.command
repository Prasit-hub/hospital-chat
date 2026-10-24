#!/usr/bin/env bash
# ดับเบิลคลิกไฟล์นี้ใน Finder เพื่อทดสอบระบบด้วย Docker Desktop
cd "$(dirname "$0")" && ./scripts/docker-local-test.sh
echo; read -n 1 -s -r -p "กดปุ่มใดก็ได้เพื่อปิดหน้าต่าง"
