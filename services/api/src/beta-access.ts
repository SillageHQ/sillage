import { createHash, randomInt } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";

const BETA_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const BETA_CODE_PATTERN = /^SIL[A-Z2-9]{16}$/;
export const FIRST_BETA_COHORT_SIZE = 20;

export class BetaCodeError extends Error {}

export function betaAccessEnabled(enabled: boolean, environment = process.env.NODE_ENV) {
  return enabled || environment !== "production";
}

export function normalizeBetaCode(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function hashBetaCode(value: string) {
  return createHash("sha256").update(normalizeBetaCode(value)).digest("hex");
}

export function generateBetaCode() {
  let payload = "";
  for (let index = 0; index < 16; index += 1) {
    payload += BETA_CODE_ALPHABET[randomInt(BETA_CODE_ALPHABET.length)];
  }
  return `SIL-${payload.slice(0, 4)}-${payload.slice(4, 8)}-${payload.slice(8, 12)}-${payload.slice(12)}`;
}

export async function createBetaCodes(
  prisma: PrismaClient,
  count: number,
  options: { email?: string; expiresAt?: Date } = {},
) {
  const email = options.email?.trim().toLowerCase() || null;
  const codes: string[] = [];
  while (codes.length < count) {
    const code = generateBetaCode();
    try {
      await prisma.betaCode.create({
        data: {
          codeHash: hashBetaCode(code),
          email,
          expiresAt: options.expiresAt,
        },
      });
      codes.push(code);
    } catch (error) {
      if ((error as { code?: string }).code !== "P2002") throw error;
    }
  }
  return codes;
}

export async function reserveWaitlistBetaCode(prisma: PrismaClient, email: string) {
  const normalizedEmail = email.trim().toLowerCase();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const existing = await tx.betaCode.findFirst({
          where: { email: normalizedEmail, waitlistPosition: { not: null }, redeemedAt: null },
          select: { waitlistPosition: true },
        });
        if (existing) return null;

        const assigned = await tx.betaCode.findMany({
          where: { waitlistPosition: { not: null } },
          select: { waitlistPosition: true },
        });
        const used = new Set(assigned.map(({ waitlistPosition }) => waitlistPosition));
        const position = Array.from({ length: FIRST_BETA_COHORT_SIZE }, (_, index) => index + 1)
          .find((candidate) => !used.has(candidate));
        if (!position) return null;

        const code = generateBetaCode();
        await tx.betaCode.create({
          data: {
            codeHash: hashBetaCode(code),
            email: normalizedEmail,
            waitlistPosition: position,
          },
        });
        return { code, position };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if ((error as { code?: string }).code === "P2034" && attempt < 2) continue;
      throw error;
    }
  }

  throw new Error("Unable to reserve beta access");
}

export async function releaseWaitlistBetaCode(prisma: PrismaClient, email: string) {
  await prisma.betaCode.updateMany({
    where: {
      email: email.trim().toLowerCase(),
      waitlistPosition: { not: null },
      redeemedAt: null,
    },
    data: { email: null, waitlistPosition: null },
  });
}

export async function activateBetaAccess(
  prisma: PrismaClient,
  input: { userId: string; code: string },
) {
  const normalizedCode = normalizeBetaCode(input.code);
  if (!BETA_CODE_PATTERN.test(normalizedCode)) {
    throw new BetaCodeError("Invalid or already used beta code");
  }

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: input.userId },
      select: { email: true, enabled: true },
    });
    if (!user) throw new BetaCodeError("Invalid account");
    if (user.enabled) return { enabled: true };

    const now = new Date();
    const code = await tx.betaCode.findUnique({
      where: { codeHash: hashBetaCode(normalizedCode) },
    });
    if (
      !code
      || code.redeemedAt
      || (code.expiresAt && code.expiresAt <= now)
      || (code.email && code.email.toLowerCase() !== user.email.toLowerCase())
    ) {
      throw new BetaCodeError("Invalid or already used beta code");
    }

    const redeemed = await tx.betaCode.updateMany({
      where: {
        id: code.id,
        redeemedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      data: {
        email: null,
        redeemedAt: now,
      },
    });
    if (redeemed.count !== 1) {
      throw new BetaCodeError("Invalid or already used beta code");
    }

    await tx.user.update({
      where: { id: input.userId },
      data: { enabled: true },
    });
    return { enabled: true };
  });
}
