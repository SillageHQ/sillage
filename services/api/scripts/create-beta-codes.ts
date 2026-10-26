import { createBetaCodes } from "../src/beta-access.js";
import { systemPrisma } from "../src/database.js";

function option(name: string) {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

const count = Number(option("count") ?? "1");
const email = option("email");
const expiresInDays = option("expires-in-days");

if (!Number.isInteger(count) || count < 1 || count > 100) {
  throw new Error("--count must be an integer between 1 and 100");
}

const expiresAt = expiresInDays === undefined
  ? undefined
  : new Date(Date.now() + Number(expiresInDays) * 24 * 60 * 60 * 1000);
if (expiresAt && (!Number.isFinite(expiresAt.getTime()) || Number(expiresInDays) <= 0)) {
  throw new Error("--expires-in-days must be a positive number");
}

try {
  const codes = await createBetaCodes(systemPrisma, count, { email, expiresAt });
  console.log(codes.join("\n"));
} finally {
  await systemPrisma.$disconnect();
}
