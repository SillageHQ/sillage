import { PrismaClient } from "@prisma/client";

try {
  process.loadEnvFile();
} catch {
  // Environment variables may be injected by the deployment platform.
}

export const systemPrisma = new PrismaClient();
