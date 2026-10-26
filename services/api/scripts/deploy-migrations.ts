import { spawnSync } from "node:child_process";

const baselineMigration = "20260811120000_unify_claude_subscription_pipeline";

function runPrisma(args: string[]) {
  return spawnSync("pnpm", ["exec", "prisma", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["inherit", "pipe", "pipe"],
  });
}

const deploy = runPrisma(["migrate", "deploy"]);
process.stdout.write(deploy.stdout ?? "");
process.stderr.write(deploy.stderr ?? "");

if (deploy.status === 0) process.exit(0);

const output = `${deploy.stdout ?? ""}\n${deploy.stderr ?? ""}`;
if (!output.includes("P3005")) process.exit(deploy.status ?? 1);

console.warn("Existing database detected without migration history; bootstrapping Prisma migration baseline.");

const push = runPrisma(["db", "push", "--accept-data-loss"]);
process.stdout.write(push.stdout ?? "");
process.stderr.write(push.stderr ?? "");
if (push.status !== 0) process.exit(push.status ?? 1);

const resolve = runPrisma(["migrate", "resolve", "--applied", baselineMigration]);
process.stdout.write(resolve.stdout ?? "");
process.stderr.write(resolve.stderr ?? "");
process.exit(resolve.status ?? 1);
