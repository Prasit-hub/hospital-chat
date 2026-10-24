#!/usr/bin/env bash
# สำรองฐานข้อมูลวันละครั้ง (ครั้งแรกทันทีที่เริ่ม) และลบไฟล์ที่เก่ากว่า KEEP_DAYS วัน
set -euo pipefail
while true; do
  f="/backups/ruamchat-$(date +%Y%m%d-%H%M).sql.gz"
  if pg_dump --no-owner --format=plain | gzip > "$f.tmp"; then
    mv "$f.tmp" "$f"
    echo "[backup] saved $f ($(du -h "$f" | cut -f1))"
  else
    echo "[backup] FAILED" >&2
    rm -f "$f.tmp"
  fi
  find /backups -name 'ruamchat-*.sql.gz' -mtime +"${KEEP_DAYS:-14}" -delete
  sleep 86400
done
