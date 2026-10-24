-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "hisAppointmentId" TEXT;

-- AlterTable
ALTER TABLE "Patient" ADD COLUMN     "hisVerifiedAt" TIMESTAMP(3);

