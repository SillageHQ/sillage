import { AsyncLocalStorage } from "node:async_hooks";
import { Prisma, PrismaClient } from "@prisma/client";

export type TenantContext = {
  tenantId: string;
  userId: string;
  authUserId: string;
};

const storage = new AsyncLocalStorage<TenantContext>();

export function runAsTenant<T>(context: TenantContext, work: () => T): T {
  return storage.run(context, work);
}

export function tenantContext(): TenantContext {
  const context = storage.getStore();
  if (!context) throw new Error("Tenant database access attempted without an authenticated tenant");
  return context;
}

async function inTenantTransaction<T>(
  root: PrismaClient,
  tenantId: string,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return root.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL ROLE sillage_app`;
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return work(tx);
  });
}

export function createTenantPrisma(root: PrismaClient): PrismaClient {
  const delegateCache = new Map<PropertyKey, unknown>();
  return new Proxy(root, {
    get(_target, property) {
      if (property === "$transaction") {
        return async (operation: unknown) => {
          if (typeof operation !== "function") {
            throw new Error("Tenant transactions must use the interactive callback form");
          }
          const { tenantId } = tenantContext();
          return inTenantTransaction(root, tenantId, operation as (tx: Prisma.TransactionClient) => Promise<unknown>);
        };
      }
      if (property === "$queryRaw" || property === "$executeRaw" || property === "$queryRawUnsafe" || property === "$executeRawUnsafe") {
        return (...args: unknown[]) => {
          const { tenantId } = tenantContext();
          return inTenantTransaction(root, tenantId, (tx) => (tx[property] as (...values: unknown[]) => Promise<unknown>)(...args));
        };
      }
      const existing = delegateCache.get(property);
      if (existing) return existing;
      const delegate = Reflect.get(root, property);
      if (!delegate || typeof delegate !== "object") return delegate;
      const scopedDelegate = new Proxy(delegate, {
        get(_model, operation) {
          const method = Reflect.get(delegate, operation);
          if (typeof method !== "function") return method;
          return (...args: unknown[]) => {
            const { tenantId } = tenantContext();
            return inTenantTransaction(root, tenantId, (tx) => {
              const txDelegate = Reflect.get(tx, property) as Record<PropertyKey, (...values: unknown[]) => Promise<unknown>>;
              return txDelegate[operation](...args);
            });
          };
        },
      });
      delegateCache.set(property, scopedDelegate);
      return scopedDelegate;
    },
  }) as PrismaClient;
}

export async function withTenantTransaction<T>(
  root: PrismaClient,
  tenantId: string,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return inTenantTransaction(root, tenantId, work);
}
