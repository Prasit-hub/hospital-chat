-- AlterTable
ALTER TABLE "User" ADD COLUMN     "adSyncedAt" TIMESTAMP(3),
ADD COLUMN     "adUsername" TEXT,
ADD COLUMN     "authSource" TEXT NOT NULL DEFAULT 'local';

-- CreateIndex
CREATE UNIQUE INDEX "User_adUsername_key" ON "User"("adUsername");

