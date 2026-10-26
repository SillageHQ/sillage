import assert from "node:assert/strict";
import test from "node:test";
import { sendBetaAccessEmail, sendMagicLinkEmail } from "./email.js";

test("sendBetaAccessEmail includes the reserved code and activation links", async () => {
  const originalFetch = globalThis.fetch;
  const previous = {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    apiToken: process.env.CLOUDFLARE_EMAIL_API_TOKEN,
    from: process.env.AUTH_EMAIL_FROM,
    siteUrl: process.env.SITE_URL,
  };
  process.env.CLOUDFLARE_ACCOUNT_ID = "account-id";
  process.env.CLOUDFLARE_EMAIL_API_TOKEN = "email-api-token";
  process.env.AUTH_EMAIL_FROM = "auth@sillagehq.app";
  process.env.SITE_URL = "https://sillagehq.app";
  let requestInit: RequestInit | undefined;
  globalThis.fetch = async (_input, init) => {
    requestInit = init;
    return Response.json({ success: true });
  };

  try {
    await sendBetaAccessEmail("person@example.com", "SIL-ABCD-EFGH-JKLM-NPQR", "Jean");
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment("CLOUDFLARE_ACCOUNT_ID", previous.accountId);
    restoreEnvironment("CLOUDFLARE_EMAIL_API_TOKEN", previous.apiToken);
    restoreEnvironment("AUTH_EMAIL_FROM", previous.from);
    restoreEnvironment("SITE_URL", previous.siteUrl);
  }

  const body = JSON.parse(String(requestInit?.body)) as { subject: string; html: string; text: string };
  assert.equal(body.subject, "Your Sillage beta access code");
  assert.match(body.html, /SIL-ABCD-EFGH-JKLM-NPQR/);
  assert.match(body.html, /https:\/\/sillagehq\.app\/sign-up/);
  assert.match(body.html, /https:\/\/sillagehq\.app\/activate/);
  assert.match(body.text, /SIL-ABCD-EFGH-JKLM-NPQR/);
});

test("sendMagicLinkEmail uses the Cloudflare Email Service REST API", async () => {
  const originalFetch = globalThis.fetch;
  const previousAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const previousApiToken = process.env.CLOUDFLARE_EMAIL_API_TOKEN;
  const previousFrom = process.env.AUTH_EMAIL_FROM;
  const previousSiteUrl = process.env.SITE_URL;
  process.env.CLOUDFLARE_ACCOUNT_ID = "account-id";
  process.env.CLOUDFLARE_EMAIL_API_TOKEN = "email-api-token";
  process.env.AUTH_EMAIL_FROM = "Sillage <auth@sillagehq.app>";
  process.env.SITE_URL = "https://sillagehq.app/";

  let requestURL = "";
  let requestInit: RequestInit | undefined;
  globalThis.fetch = async (input, init) => {
    requestURL = String(input);
    requestInit = init;
    return Response.json({ success: true });
  };

  try {
    await sendMagicLinkEmail("person@example.com", "https://sillagehq.app/magic-link?token=one");
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment("CLOUDFLARE_ACCOUNT_ID", previousAccountId);
    restoreEnvironment("CLOUDFLARE_EMAIL_API_TOKEN", previousApiToken);
    restoreEnvironment("AUTH_EMAIL_FROM", previousFrom);
    restoreEnvironment("SITE_URL", previousSiteUrl);
  }

  assert.equal(
    requestURL,
    "https://api.cloudflare.com/client/v4/accounts/account-id/email/sending/send",
  );
  assert.deepEqual(requestInit?.headers, {
    Authorization: "Bearer email-api-token",
    "Content-Type": "application/json",
  });
  const body = JSON.parse(String(requestInit?.body)) as {
    from: unknown;
    html: string;
    subject: string;
    text: string;
    to: string;
  };
  assert.deepEqual(body.from, {
    address: "auth@sillagehq.app",
    name: "Sillage",
  });
  assert.equal(body.to, "person@example.com");
  assert.equal(body.subject, "Sign in to Sillage");
  assert.match(body.html, /^<!DOCTYPE html/);
  assert.match(body.html, /https:\/\/sillagehq\.app\/logo-mark\.svg/);
  assert.match(body.html, />Sillage</);
  assert.match(body.html, /Return to your thoughts\./);
  assert.match(body.html, /https:\/\/sillagehq\.app\/magic-link\?token=one/);
  assert.match(body.html, />sillagehq\.app</);
  assert.match(body.text, /Sign in to Sillage/);
  assert.match(body.text, /https:\/\/sillagehq\.app\/magic-link\?token=one/);
  assert.match(body.text, /sillagehq\.app/);
});

test("sendMagicLinkEmail fails when Cloudflare rejects the message", async () => {
  const originalFetch = globalThis.fetch;
  const previousAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const previousApiToken = process.env.CLOUDFLARE_EMAIL_API_TOKEN;
  const previousFrom = process.env.AUTH_EMAIL_FROM;
  process.env.CLOUDFLARE_ACCOUNT_ID = "account-id";
  process.env.CLOUDFLARE_EMAIL_API_TOKEN = "email-api-token";
  process.env.AUTH_EMAIL_FROM = "auth@sillagehq.app";
  globalThis.fetch = async () => Response.json(
    { success: false },
    { status: 403 },
  );

  try {
    await assert.rejects(
      sendMagicLinkEmail("person@example.com", "https://sillagehq.app/magic-link"),
      /Cloudflare rejected the magic link \(403\)/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment("CLOUDFLARE_ACCOUNT_ID", previousAccountId);
    restoreEnvironment("CLOUDFLARE_EMAIL_API_TOKEN", previousApiToken);
    restoreEnvironment("AUTH_EMAIL_FROM", previousFrom);
  }
});

function restoreEnvironment(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
