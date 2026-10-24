#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")"
echo "=== ลบ node_modules + package-lock.json เดิม แล้วติดตั้งใหม่ทั้งหมด ==="
rm -rf node_modules package-lock.json
npm install --no-audit --no-fund
echo
echo "=== git diff ของ package-lock.json ==="
git diff --stat package-lock.json
echo
echo "=== commit + push ==="
git add package-lock.json
git -c user.email="prasit.siw@gmail.com" -c user.name="Prasit" commit -m "chore: regenerate package-lock.json from a clean install (fix missing optional deps)"
git push origin main
echo
echo "DONE $?"
read -n 1 -s -r -p "กดปุ่มใดก็ได้เพื่อปิดหน้าต่าง"
