# syntax=docker/dockerfile:1.7
# ---------- รวมแชท: production image ----------
# build:  docker compose -f docker-compose.prod.yml build

ARG NODE_VERSION=22-bookworm-slim

# 1) ติดตั้ง dependencies
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# --ignore-scripts: ข้าม postinstall (prisma generate) ตรงนี้เพราะยังไม่มี prisma/schema.prisma
# (ยังไม่ COPY source จนกว่าจะถึง build stage) -- build stage รัน prisma generate เองอยู่แล้วด้านล่าง
RUN npm ci --no-audit --no-fund --ignore-scripts

# 2) build (prisma generate + next build) — ใช้เป็น image สำหรับ migrate/สคริปต์ดูแลระบบด้วย
FROM deps AS build
WORKDIR /app
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# DATABASE_URL ไม่ถูกใช้ตอน build แต่ prisma.config.ts ต้องการค่า
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" npx prisma generate \
 && DATABASE_URL="postgresql://build:build@localhost:5432/build" npx prisma version >/dev/null \
 && npm run build

# 3) migrate: รัน prisma migrate deploy แล้วจบ (และใช้รันสคริปต์ เช่น create-owner)
FROM build AS migrate
WORKDIR /app
ENV NODE_ENV=production
CMD ["npx", "prisma", "migrate", "deploy"]

# 4) runtime: เฉพาะไฟล์ที่ต้องใช้รันเว็บ
FROM node:${NODE_VERSION} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/* \
 && groupadd --system --gid 1001 app && useradd --system --uid 1001 --gid app app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server.js"]

# 5) Render (dev/preview เท่านั้น — ดู README หัวข้อ 7): ตั้งใจวางเป็น stage สุดท้าย
#    เพราะ Render build Dockerfile โดยไม่ระบุ target ก็ได้ ซึ่ง Docker จะเลือก stage สุดท้ายในไฟล์เป็นค่าเริ่มต้นเสมอ
#    (docker-compose.prod.yml ของ Azure ระบุ target: runner ตรงๆ อยู่แล้ว ไม่กระทบ)
#    แผนฟรีของ Render ไม่มี pre-deploy command แยก จึงรัน prisma migrate deploy ในตัวก่อนเปิดเซิร์ฟเวอร์ทุกครั้งที่ container เริ่ม (idempotent)
#    ใช้ node_modules เต็มจาก build stage (ไม่ใช่ตัวตัดแล้วแบบ runner) เพราะต้องมี prisma CLI
FROM node:${NODE_VERSION} AS render
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates curl && rm -rf /var/lib/apt/lists/*
COPY --from=build /app /app
RUN cp -r .next/static .next/standalone/.next/static && cp -r public .next/standalone/public
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1
CMD ["sh", "-c", "npx prisma migrate deploy && node .next/standalone/server.js"]

