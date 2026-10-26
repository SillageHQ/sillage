import { createServerFn } from "@tanstack/react-start";

type WaitlistInput = {
  name: string;
  email: string;
  website?: string;
  turnstileToken?: string;
};

type TurnstileVerification = {
  success: boolean;
  action?: string;
  "error-codes"?: string[];
};

function validateWaitlistInput(input: unknown): WaitlistInput {
  if (!input || typeof input !== "object") throw new Error("Enter your full name and a valid email address");
  const data = input as Record<string, unknown>;
  const name = typeof data.name === "string" ? data.name.trim().replace(/\s+/g, " ") : "";
  const email = typeof data.email === "string" ? data.email.trim().toLowerCase() : "";
  const website = typeof data.website === "string" ? data.website.trim() : "";
  const turnstileToken = typeof data.turnstileToken === "string" ? data.turnstileToken.trim() : "";
  if (name.length < 2 || name.length > 120) {
    throw new Error("Enter your full name");
  }
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Enter a valid email address");
  }
  if (turnstileToken.length > 2048) {
    throw new Error("The waitlist is temporarily unavailable");
  }
  return { name, email, website, turnstileToken };
}

export const joinBetaWaitlist = createServerFn({ method: "POST" })
  .validator(validateWaitlistInput)
  .handler(async ({ data }) => {
    if (data.website) return { success: true };

    const turnstileSecret = process.env.TURNSTILE_SECRET_KEY?.trim();
    if (!turnstileSecret) {
      console.error("[waitlist] TURNSTILE_SECRET_KEY is not configured");
      throw new Error("The waitlist is temporarily unavailable");
    }
    if (!data.turnstileToken) {
      throw new Error("Security check incomplete. Refresh the page and try again.");
    }

    const verificationResponse = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          secret: turnstileSecret,
          response: data.turnstileToken,
        }),
      },
    );
    const verification = await verificationResponse.json() as TurnstileVerification;
    // Accept missing action: some Turnstile modes omit it even when success is true.
    const actionOk = !verification.action || verification.action === "join_beta_waitlist";
    if (!verificationResponse.ok || !verification.success || !actionOk) {
      console.error("[waitlist] Turnstile rejected the request", {
        success: verification.success,
        action: verification.action,
        errors: verification["error-codes"] ?? [],
      });
      throw new Error("Security check failed. Refresh the page and try again.");
    }

    const apiToken = process.env.LUMAIL_API_TOKEN?.trim();
    if (!apiToken) {
      console.error("[waitlist] LUMAIL_API_TOKEN is not configured");
      throw new Error("The waitlist is temporarily unavailable");
    }

    const configuredApiUrl = process.env.API_URL?.trim();
    const waitlistToken = process.env.WAITLIST_INTERNAL_TOKEN?.trim();
    if (!configuredApiUrl || !waitlistToken) {
      console.error("[waitlist] API_URL or WAITLIST_INTERNAL_TOKEN is not configured");
      throw new Error("The waitlist is temporarily unavailable");
    }
    const betaResponse = await fetch(`${configuredApiUrl.replace(/\/+$/, "")}/v1/beta/waitlist`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${waitlistToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: data.name, email: data.email }),
    });
    const betaResult = await betaResponse.json().catch(() => ({})) as { betaAssigned?: boolean; error?: string };
    if (!betaResponse.ok) {
      console.error("[waitlist] Beta access reservation failed", betaResponse.status, betaResult.error ?? "unknown error");
      throw new Error("The waitlist is temporarily unavailable");
    }

    // Support both env names used in Coolify deployments.
    const tag = process.env.LUMAIL_WAITLIST_TAG?.trim()
      || process.env.LUMAIL_BETA_TAG?.trim()
      || "beta";
    const firstName = data.name.split(" ")[0];
    const response = await fetch("https://lumail.io/api/v1/subscribers", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: data.name,
        email: data.email,
        fields: {
          firstname: firstName,
        },
        tags: [tag],
        resubscribe: true,
        triggerWorkflows: betaResult.betaAssigned !== true,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.error(`[waitlist] Lumail rejected the subscriber (${response.status})`, body.slice(0, 300));
      throw new Error("Unable to join the waitlist right now. Try again in a moment.");
    }

    return { success: true };
  });
