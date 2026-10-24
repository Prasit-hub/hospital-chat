#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")"
echo "=== push แก้ไข Prisma generate ไปที่ GitHub ==="
git push origin main
echo
echo "DONE $?"
read -n 1 -s -r -p "กดปุ่มใดก็ได้เพื่อปิดหน้าต่าง"
