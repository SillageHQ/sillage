import { createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { useState } from "react";
import { BrandMark } from "../components/brand";
import { AccountShell } from "../components/account-shell";

function validRequestToken(value: unknown) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : "";
}

function forwardedAuthHeaders() {
  const incoming = getRequestHeaders();
  const headers = new Headers();
  const cookie = incoming.get("cookie");
  const authorization = incoming.get("authorization");
  if (cookie) headers.set("cookie", cookie);
  if (authorization) headers.set("authorization", authorization);
  return headers;
}

const requireAccount = createServerFn({ method: "GET" })
  .validator(validRequestToken)
  .handler(async ({ data: requestToken }) => {
    if (!requestToken) throw redirect({ href: "/account" });
    const configuredApiUrl = process.env.API_URL?.trim();
    if (process.env.NODE_ENV === "production" && !configuredApiUrl) {
      throw new Error("API_URL must be configured in production");
    }
    const apiUrl = (configuredApiUrl ?? "http://localhost:3001").replace(/\/+$/, "");
    const response = await fetch(`${apiUrl}/v1/account/bootstrap`, {
      method: "POST",
      headers: forwardedAuthHeaders(),
    });
    if (response.status === 401) {
      const callback = `/authorize-desktop?request=${encodeURIComponent(requestToken)}`;
      throw redirect({ href: `/sign-in?redirect=${encodeURIComponent(callback)}` });
    }
    if (!response.ok) throw new Error(`Account provisioning failed (${response.status})`);
    const account = await response.json() as {
      user: { enabled: boolean };
      workspace: { name: string };
    };
    if (!account.user.enabled) throw redirect({ href: "/account" });
    return account;
  });

const authorizeDesktop = createServerFn({ method: "POST" })
  .validator(validRequestToken)
  .handler(async ({ data: requestToken }) => {
    if (!requestToken) throw new Error("Invalid or expired authorization");
    const configuredApiUrl = process.env.API_URL?.trim();
    if (process.env.NODE_ENV === "production" && !configuredApiUrl) {
      throw new Error("API_URL must be configured in production");
    }
    const apiUrl = (configuredApiUrl ?? "http://localhost:3001").replace(/\/+$/, "");
    const headers = forwardedAuthHeaders();
    headers.set("Content-Type", "application/json");
    const response = await fetch(`${apiUrl}/v1/desktop-authorizations/authorize`, {
      method: "POST",
      headers,
      body: JSON.stringify({ requestToken }),
    });
    const body = await response.json() as { redirectURL?: string; error?: string };
    if (!response.ok || !body.redirectURL) {
      throw new Error(body.error || "Unable to connect this desktop");
    }
    return { redirectURL: body.redirectURL };
  });

const rejectDesktop = createServerFn({ method: "POST" })
  .validator(validRequestToken)
  .handler(async ({ data: requestToken }) => {
    if (!requestToken) throw new Error("Invalid or expired authorization");
    const configuredApiUrl = process.env.API_URL?.trim();
    if (process.env.NODE_ENV === "production" && !configuredApiUrl) throw new Error("API_URL must be configured in production");
    const apiUrl = (configuredApiUrl ?? "http://localhost:3001").replace(/\/+$/, "");
    const headers = forwardedAuthHeaders();
    headers.set("Content-Type", "application/json");
    const response = await fetch(`${apiUrl}/v1/desktop-authorizations/reject`, { method: "POST", headers, body: JSON.stringify({ requestToken }) });
    const body = await response.json() as { error?: string };
    if (!response.ok) throw new Error(body.error || "Unable to reject this connection");
    return { ok: true };
  });

export const Route = createFileRoute("/authorize-desktop")({
  validateSearch: (search) => ({ request: validRequestToken(search.request) }),
  loaderDeps: ({ search }) => ({ request: search.request }),
  loader: ({ deps }) => requireAccount({ data: deps.request }),
  component: AuthorizeDesktopPage,
});

function AuthorizeDesktopPage() {
  const { request } = Route.useSearch();
  const { workspace } = Route.useLoaderData();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [rejected, setRejected] = useState(false);

  async function authorize() {
    setBusy(true);
    setMessage("");
    try {
      const result = await authorizeDesktop({ data: request });
      window.location.assign(result.redirectURL);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Unable to connect this desktop");
      setBusy(false);
    }
  }

  async function reject() {
    setBusy(true);
    setMessage("");
    try { await rejectDesktop({ data: request }); setRejected(true); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : "Unable to reject this connection"); }
    finally { setBusy(false); }
  }

  return (
    <AccountShell><main className="account-page authorize-desktop-page">
      <section className="authorize-desktop-card">
        <BrandMark className="authorize-desktop-mark" />
        <p className="section-index">SILLAGE DESKTOP</p>
        {rejected ? <>
          <h1>Connection declined.</h1>
          <p>This desktop was not connected to <strong>{workspace.name}</strong>. You can close this tab.</p>
          <a className="primary-button" href="/account">Back to my account</a>
        </> : <>
          <h1>Continue in Sillage.</h1>
          <p>
            Connect this desktop to <strong>{workspace.name}</strong>. The Sillage app will receive a private,
            revocable session for this device only.
          </p>
          <div className="authorize-desktop-actions">
            <button className="primary-button" disabled={busy || !request} onClick={() => void authorize()}>
              {busy ? "Connecting…" : "Authorize this desktop"}
            </button>
            <button className="secondary-button" disabled={busy || !request} onClick={() => void reject()}>Reject connection</button>
          </div>
          <p className="authorize-desktop-note">Only continue if you started this request from the Sillage desktop app.</p>
        </>}
        {message && <p className="auth-message is-error" aria-live="polite">{message}</p>}
      </section>
    </main></AccountShell>
  );
}
