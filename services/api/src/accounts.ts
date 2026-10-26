import type { PrismaClient } from "@prisma/client";
import { withTenantTransaction } from "./tenant-db.js";

export type AccountIdentity = {
  authUserId: string;
  email: string;
  displayName?: string;
};

function personalWorkspaceName(identity: AccountIdentity) {
  return identity.displayName ? `${identity.displayName}'s workspace` : "My workspace";
}

export async function provisionAccount(prisma: PrismaClient, identity: AccountIdentity) {
  const user = await prisma.user.upsert({
    where: { id: identity.authUserId },
    create: {
      id: identity.authUserId,
      email: identity.email,
      name: identity.displayName ?? identity.email.split("@")[0],
      emailVerified: false,
    },
    update: { email: identity.email, name: identity.displayName ?? undefined },
  });
  const slug = `personal-${identity.authUserId.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const workspace = await prisma.workspace.upsert({
    where: { slug },
    create: {
      name: personalWorkspaceName(identity),
      slug,
    },
    update: {},
  });
  await prisma.membership.upsert({
    where: { userId_workspaceId: { userId: user.id, workspaceId: workspace.id } },
    create: { userId: user.id, workspaceId: workspace.id, role: "owner" },
    update: {},
  });
  await withTenantTransaction(prisma, workspace.id, (tx) => tx.settings.upsert({
    where: { tenantId: workspace.id },
    create: { tenantId: workspace.id },
    update: {},
  }));
  return { user, workspace };
}
