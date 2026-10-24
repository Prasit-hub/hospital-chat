-- CreateEnum
CREATE TYPE "CaseStatus" AS ENUM ('queued', 'in_progress', 'waiting_patient', 'transfer_pending', 'closed');

-- CreateEnum
CREATE TYPE "CaseOutcome" AS ENUM ('answered', 'appointed', 'advised_visit', 'referred_external', 'no_response', 'spam', 'merged', 'other');

-- CreateEnum
CREATE TYPE "ProfileTagCategory" AS ENUM ('need', 'communication', 'like', 'dislike');

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "caseId" TEXT;

-- AlterTable
ALTER TABLE "Department" ADD COLUMN     "transferSlaMinutes" INTEGER;

-- AlterTable
ALTER TABLE "MergeEvent" ADD COLUMN     "caseIds" TEXT[],
ADD COLUMN     "meta" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "profileTagIds" TEXT[];

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "caseId" TEXT;

-- CreateTable
CREATE TABLE "Case" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "orgId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "status" "CaseStatus" NOT NULL DEFAULT 'queued',
    "ownerId" TEXT,
    "departmentId" TEXT,
    "category" "InquiryCategory",
    "urgent" BOOLEAN NOT NULL DEFAULT false,
    "urgentReason" TEXT,
    "urgentAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "verifiedById" TEXT,
    "verifyMethod" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "firstResponseAt" TIMESTAMP(3),
    "waitingSince" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "outcome" "CaseOutcome",
    "closeNote" TEXT,
    "reopenCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Case_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseTransfer" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "fromDeptId" TEXT,
    "fromUserId" TEXT,
    "toDeptId" TEXT,
    "reason" TEXT NOT NULL,
    "doneNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "acceptedById" TEXT,
    "returnedAt" TIMESTAMP(3),
    "returnReason" TEXT,
    "recalledAt" TIMESTAMP(3),

    CONSTRAINT "CaseTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseEvent" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actorId" TEXT,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfileTagDef" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "category" "ProfileTagCategory" NOT NULL,
    "label" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "suggested" BOOLEAN NOT NULL DEFAULT false,
    "blocksBroadcast" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfileTagDef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientProfileTag" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "defId" TEXT NOT NULL,
    "note" TEXT,
    "addedById" TEXT,
    "caseId" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PatientProfileTag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Case_number_key" ON "Case"("number");

-- CreateIndex
CREATE INDEX "Case_orgId_status_idx" ON "Case"("orgId", "status");

-- CreateIndex
CREATE INDEX "Case_patientId_idx" ON "Case"("patientId");

-- CreateIndex
CREATE INDEX "CaseTransfer_caseId_idx" ON "CaseTransfer"("caseId");

-- CreateIndex
CREATE INDEX "CaseTransfer_toDeptId_acceptedAt_idx" ON "CaseTransfer"("toDeptId", "acceptedAt");

-- CreateIndex
CREATE INDEX "CaseEvent_caseId_createdAt_idx" ON "CaseEvent"("caseId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProfileTagDef_orgId_category_label_key" ON "ProfileTagDef"("orgId", "category", "label");

-- CreateIndex
CREATE UNIQUE INDEX "PatientProfileTag_patientId_defId_key" ON "PatientProfileTag"("patientId", "defId");

-- CreateIndex
CREATE INDEX "Conversation_lastMessageAt_idx" ON "Conversation"("lastMessageAt");

-- CreateIndex
CREATE INDEX "Message_caseId_idx" ON "Message"("caseId");

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseTransfer" ADD CONSTRAINT "CaseTransfer_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseTransfer" ADD CONSTRAINT "CaseTransfer_fromDeptId_fkey" FOREIGN KEY ("fromDeptId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseTransfer" ADD CONSTRAINT "CaseTransfer_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseTransfer" ADD CONSTRAINT "CaseTransfer_toDeptId_fkey" FOREIGN KEY ("toDeptId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseTransfer" ADD CONSTRAINT "CaseTransfer_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseEvent" ADD CONSTRAINT "CaseEvent_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseEvent" ADD CONSTRAINT "CaseEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileTagDef" ADD CONSTRAINT "ProfileTagDef_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientProfileTag" ADD CONSTRAINT "PatientProfileTag_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientProfileTag" ADD CONSTRAINT "PatientProfileTag_defId_fkey" FOREIGN KEY ("defId") REFERENCES "ProfileTagDef"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientProfileTag" ADD CONSTRAINT "PatientProfileTag_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientProfileTag" ADD CONSTRAINT "PatientProfileTag_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ===== ย้ายข้อมูลเดิม: สถานะ/ผู้รับผิดชอบ/แผนก ฯลฯ จากห้องแชท → งาน (Case) =====
-- งานที่ยังเปิด: 1 งานต่อคนไข้ (ใช้ห้องแชทล่าสุดที่ยังไม่ปิด)
INSERT INTO "Case" ("id","orgId","patientId","status","ownerId","departmentId","category","urgent","urgentReason","urgentAt","verifiedAt","verifiedById","verifyMethod","openedAt","acceptedAt","waitingSince")
SELECT DISTINCT ON (ct."patientId") 'mig_' || v."id", ct."orgId", ct."patientId",
  (CASE WHEN v."status" = 'pending' THEN 'waiting_patient' WHEN v."assigneeId" IS NOT NULL THEN 'in_progress' ELSE 'queued' END)::"CaseStatus",
  v."assigneeId", v."departmentId", v."category", v."urgent", v."urgentReason", v."urgentAt", v."verifiedAt", v."verifiedById", v."verifyMethod",
  v."createdAt", CASE WHEN v."assigneeId" IS NOT NULL THEN v."createdAt" END, CASE WHEN v."status" = 'pending' THEN v."lastMessageAt" END
FROM "Conversation" v JOIN "Contact" ct ON ct."id" = v."contactId"
WHERE v."status" <> 'closed'
ORDER BY ct."patientId", v."lastMessageAt" DESC;

-- งานที่ปิดแล้ว: 1 งานต่อห้องแชทที่ปิด
INSERT INTO "Case" ("id","orgId","patientId","status","ownerId","departmentId","category","urgent","openedAt","acceptedAt","closedAt","outcome")
SELECT 'mig_' || v."id", ct."orgId", ct."patientId", 'closed', v."assigneeId", v."departmentId", v."category", v."urgent",
  v."createdAt", v."createdAt", COALESCE(v."closedAt", v."lastMessageAt"), 'other'
FROM "Conversation" v JOIN "Contact" ct ON ct."id" = v."contactId"
WHERE v."status" = 'closed';

-- ข้อความ: ผูกกับงานของห้องแชทนั้น หรืองานที่เปิดอยู่ของคนไข้
UPDATE "Message" m SET "caseId" = c."id" FROM "Case" c WHERE c."id" = 'mig_' || m."conversationId";
UPDATE "Message" m SET "caseId" = c."id"
FROM "Conversation" v JOIN "Contact" ct ON ct."id" = v."contactId" JOIN "Case" c ON c."patientId" = ct."patientId" AND c."status" <> 'closed'
WHERE m."conversationId" = v."id" AND m."caseId" IS NULL;

-- คนไข้ 1 คนมีงานที่ยังไม่ปิดได้ครั้งละ 1 งาน
CREATE UNIQUE INDEX "Case_one_open_per_patient" ON "Case"("patientId") WHERE "status" <> 'closed';

-- ===== ลบคอลัมน์เดิมของห้องแชท =====

-- DropForeignKey
ALTER TABLE "Conversation" DROP CONSTRAINT "Conversation_assigneeId_fkey";

-- DropForeignKey
ALTER TABLE "Conversation" DROP CONSTRAINT "Conversation_departmentId_fkey";

-- DropForeignKey
ALTER TABLE "Conversation" DROP CONSTRAINT "Conversation_verifiedById_fkey";

-- DropIndex
DROP INDEX "Conversation_status_lastMessageAt_idx";

-- AlterTable
ALTER TABLE "Conversation" DROP COLUMN "assigneeId",
DROP COLUMN "category",
DROP COLUMN "closedAt",
DROP COLUMN "departmentId",
DROP COLUMN "status",
DROP COLUMN "urgent",
DROP COLUMN "urgentAt",
DROP COLUMN "urgentReason",
DROP COLUMN "verifiedAt",
DROP COLUMN "verifiedById",
DROP COLUMN "verifyMethod";

