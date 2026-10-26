import { render } from "react-email";
import { MagicLinkEmail } from "./emails/magic-link-email.js";
import { BetaAccessEmail } from "./emails/beta-access-email.js";

type CloudflareEmailAddress = {
  address: string;
  name?: string;
};

type CloudflareEmailResponse = {
  success?: boolean;
};

function parseSender(value: string): string | CloudflareEmailAddress {
  const namedSender = value.match(/^(?:"([^"]+)"|([^<>]+))\s*<([^<>]+)>$/);
  if (namedSender) {
    const name = (namedSender[1] ?? namedSender[2]).trim();
    return {
      address: namedSender[3].trim(),
      ...(name ? { name } : {}),
    };
  }

  return value;
}

export async function sendMagicLinkEmail(email: string, url: string) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const apiToken = process.env.CLOUDFLARE_EMAIL_API_TOKEN?.trim();
  const from = process.env.AUTH_EMAIL_FROM?.trim();
  if (!accountId || !apiToken || !from) {
    throw new Error("Magic-link email delivery is not configured");
  }

  const siteUrl = normalizeSiteUrl(process.env.SITE_URL);
  const [html, text] = await Promise.all([
    render(<MagicLinkEmail magicLinkUrl={url} siteUrl={siteUrl} />),
    render(
      <MagicLinkEmail magicLinkUrl={url} siteUrl={siteUrl} />,
      { plainText: true },
    ),
  ]);

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/email/sending/send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: email,
        from: parseSender(from),
        subject: "Sign in to Sillage",
        html,
        text,
      }),
    },
  );

  const result = await response.json().catch(() => null) as CloudflareEmailResponse | null;
  if (!response.ok || result?.success === false) {
    throw new Error(`Cloudflare rejected the magic link (${response.status})`);
  }
}

export async function sendBetaAccessEmail(email: string, code: string, name: string) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const apiToken = process.env.CLOUDFLARE_EMAIL_API_TOKEN?.trim();
  const from = process.env.AUTH_EMAIL_FROM?.trim();
  if (!accountId || !apiToken || !from) throw new Error("Beta-access email delivery is not configured");

  const siteUrl = normalizeSiteUrl(process.env.SITE_URL);
  const [html, text] = await Promise.all([
    render(<BetaAccessEmail name={name} code={code} signUpUrl={`${siteUrl}/sign-up`} activateUrl={`${siteUrl}/activate`} siteUrl={siteUrl} />),
    render(<BetaAccessEmail name={name} code={code} signUpUrl={`${siteUrl}/sign-up`} activateUrl={`${siteUrl}/activate`} siteUrl={siteUrl} />, { plainText: true }),
  ]);
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/email/sending/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ to: email, from: parseSender(from), subject: "Your Sillage beta access code", html, text }),
  });
  const result = await response.json().catch(() => null) as CloudflareEmailResponse | null;
  if (!response.ok || result?.success === false) throw new Error(`Cloudflare rejected the beta access email (${response.status})`);
}

function normalizeSiteUrl(value: string | undefined) {
  return (value?.trim() || "https://sillagehq.app").replace(/\/+$/, "");
}
