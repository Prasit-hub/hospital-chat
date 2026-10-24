import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

// ใช้ instance เดียวตลอดอายุ process (กัน connection บานตอน dev hot-reload)
const g = globalThis as unknown as { prisma?: PrismaClient };

function create() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({ adapter, log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"] });
}

export const prisma = g.prisma ?? create();

if (process.env.NODE_ENV !== "production") g.prisma = prisma;
