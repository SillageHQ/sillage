import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { withTenantTransaction } from "./tenant-db.js";

test("PostgreSQL RLS isolates reads, updates, and deletes between tenants", { skip: !process.env.DATABASE_URL }, async () => {
  const db = new PrismaClient();
  const suffix = randomUUID();
  const userA = `test-user-a-${suffix}`;
  const userB = `test-user-b-${suffix}`;
  const tenantA = `test-tenant-a-${suffix}`;
  const tenantB = `test-tenant-b-${suffix}`;
  let folderB = "";
  try {
    await db.user.createMany({ data: [
      { id: userA, name: "Test A", email: `${userA}@invalid.local` },
      { id: userB, name: "Test B", email: `${userB}@invalid.local` },
    ] });
    await db.workspace.createMany({ data: [
      { id: tenantA, name: "Tenant A", slug: tenantA },
      { id: tenantB, name: "Tenant B", slug: tenantB },
    ] });
    await db.membership.createMany({ data: [
      { userId: userA, workspaceId: tenantA },
      { userId: userB, workspaceId: tenantB },
    ] });
    await withTenantTransaction(db, tenantA, (tx) => tx.folder.create({ data: { name: "Only A" } }));
    folderB = (await withTenantTransaction(db, tenantB, (tx) => tx.folder.create({ data: { name: "Only B" } }))).id;

    await withTenantTransaction(db, tenantA, async (tx) => {
      assert.deepEqual((await tx.folder.findMany()).map((folder) => folder.name), ["Only A"]);
      assert.equal((await tx.folder.updateMany({ where: { id: folderB }, data: { name: "Leaked" } })).count, 0);
      assert.equal((await tx.folder.deleteMany({ where: { id: folderB } })).count, 0);
    });
    await withTenantTransaction(db, tenantB, async (tx) => {
      assert.equal((await tx.folder.findUnique({ where: { id: folderB } }))?.name, "Only B");
    });
  } finally {
    await db.workspace.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
    await db.user.deleteMany({ where: { id: { in: [userA, userB] } } });
    await db.$disconnect();
  }
});
