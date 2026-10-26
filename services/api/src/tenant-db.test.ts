import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { createTenantPrisma, runAsTenant, tenantContext } from "./tenant-db.js";

function fakePrisma() {
  const configured: string[] = [];
  const root = {
    $transaction: async (work: (tx: unknown) => Promise<unknown>) => {
      let activeTenant = "";
      const tx = {
        $executeRaw: async (parts: TemplateStringsArray, tenantId?: string) => {
          const sql = parts.join("?");
          if (/SET LOCAL ROLE/.test(sql)) return;
          assert.match(sql, /set_config/);
          assert.ok(tenantId);
          activeTenant = tenantId;
          configured.push(tenantId);
        },
        folder: {
          findMany: async () => [{ tenantId: activeTenant }],
        },
      };
      return work(tx);
    },
    folder: { findMany: async () => [] },
  } as unknown as PrismaClient;
  return { root, configured };
}

test("tenant database access is default-deny without context", async () => {
  const { root } = fakePrisma();
  const db = createTenantPrisma(root);
  assert.throws(() => db.folder.findMany(), /without an authenticated tenant/);
});

test("parallel tenant contexts never share the PostgreSQL setting", async () => {
  const { root, configured } = fakePrisma();
  const db = createTenantPrisma(root);
  const query = (tenantId: string) => runAsTenant(
    { tenantId, userId: `user-${tenantId}`, authUserId: `user-${tenantId}` },
    async () => {
      await new Promise((resolve) => setTimeout(resolve, tenantId === "tenant-a" ? 5 : 0));
      assert.equal(tenantContext().tenantId, tenantId);
      return db.folder.findMany() as unknown as Promise<Array<{ tenantId: string }>>;
    },
  );
  const [a, b] = await Promise.all([query("tenant-a"), query("tenant-b")]);
  assert.deepEqual(a, [{ tenantId: "tenant-a" }]);
  assert.deepEqual(b, [{ tenantId: "tenant-b" }]);
  assert.deepEqual(new Set(configured), new Set(["tenant-a", "tenant-b"]));
});
