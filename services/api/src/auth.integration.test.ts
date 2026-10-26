import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

test("Better Auth magic-link signup provisions a tenant and authenticates its signed bearer", { skip: !process.env.DATABASE_URL }, async () => {
  process.env.BETTER_AUTH_SECRET ||= "integration-test-secret-at-least-32-characters";
  process.env.BETTER_AUTH_URL ||= "http://localhost:3001";
  process.env.BETTER_AUTH_COOKIE_DOMAIN ||= "localhost";
  process.env.CLOUDFLARE_ACCOUNT_ID ||= "integration-test-account";
  process.env.CLOUDFLARE_EMAIL_API_TOKEN ||= "integration-test-email-token";
  process.env.AUTH_EMAIL_FROM ||= "Sillage <auth@invalid.local>";
  const [{ auth }, { systemPrisma }] = await Promise.all([import("./auth.js"), import("./database.js")]);
  const suffix = randomUUID();
  const email = `better-auth-${suffix}@invalid.local`;
  let userId = "";
  let magicLinkURL = "";
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (input, init) => {
      if (String(input) !== "https://api.cloudflare.com/client/v4/accounts/integration-test-account/email/sending/send") {
        return originalFetch(input, init);
      }
      const body = JSON.parse(String(init?.body)) as { html: string };
      magicLinkURL = [...body.html.matchAll(/href="([^"]+)"/g)]
        .map((match) => match[1])
        .find((href) => href.includes("token="))
        ?.replaceAll("&amp;", "&") ?? "";
      return Response.json({ success: true });
    };
    const sendResponse = await auth.handler(new Request("http://localhost:3001/api/auth/sign-in/magic-link", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost:3000" },
      body: JSON.stringify({ name: "Integration User", email, callbackURL: "http://localhost:3000/account" }),
    }));
    assert.equal(sendResponse.status, 200, await sendResponse.text());
    assert.ok(magicLinkURL);
    const response = await auth.handler(new Request(magicLinkURL, {
      headers: { Origin: "http://localhost:3000" },
    }));
    assert.equal(response.status, 302, await response.text());
    const token = response.headers.get("set-auth-token");
    assert.ok(token);
    const bearerSession = await auth.api.getSession({ headers: new Headers({ Authorization: `Bearer ${token}` }) });
    assert.equal(bearerSession?.user.email, email);
    const setCookies = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.()
      ?? [response.headers.get("set-cookie") ?? ""];
    const sessionCookie = setCookies.find((value) => value.includes("sillage-auth.session_token="));
    assert.ok(sessionCookie);
    assert.match(sessionCookie, /(?:^|;\s*)Domain=localhost(?:;|$)/i);
    const cookie = setCookies.map((value) => value.split(";", 1)[0]).filter(Boolean).join("; ");
    const cookieSession = await auth.api.getSession({ headers: new Headers({ Cookie: cookie }) });
    assert.equal(cookieSession?.user.email, email);
    userId = bearerSession?.user.id ?? "";
    assert.equal(
      (await systemPrisma.user.findUnique({ where: { id: userId }, select: { enabled: true } }))?.enabled,
      false,
    );
    const membership = await systemPrisma.membership.findFirst({ where: { userId } });
    assert.ok(membership);
    assert.ok(await systemPrisma.settings.findUnique({ where: { tenantId: membership.workspaceId } }));
  } finally {
    globalThis.fetch = originalFetch;
    userId ||= (await systemPrisma.user.findUnique({ where: { email }, select: { id: true } }))?.id ?? "";
    if (userId) {
      const memberships = await systemPrisma.membership.findMany({ where: { userId }, select: { workspaceId: true } });
      await systemPrisma.workspace.deleteMany({ where: { id: { in: memberships.map(({ workspaceId }) => workspaceId) } } });
      await systemPrisma.user.deleteMany({ where: { id: userId } });
    }
  }
});
