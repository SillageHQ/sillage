import { createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { useState, type FormEvent } from "react";
import { AccountShell } from "../components/account-shell";
import { trackEvent } from "../lib/analytics";

function forwardedAuthHeaders() {
  const incoming = getRequestHeaders();
  const headers = new Headers();
  const cookie = incoming.get("cookie");
  const authorization = incoming.get("authorization");
  if (cookie) headers.set("cookie", cookie);
  if (authorization) headers.set("authorization", authorization);
  return headers;
}

const getAccountStatus = createServerFn({ method: "GET" }).handler(async () => {
  const apiUrl = (process.env.API_URL?.trim() ?? "http://localhost:3001").replace(/\/+$/, "");
  const response = await fetch(`${apiUrl}/v1/account/bootstrap`, { method: "POST", headers: forwardedAuthHeaders() });
  if (response.status === 401) throw redirect({ to: "/sign-in", search: { redirect: "/activate" } });
  if (!response.ok) throw new Error(`Account provisioning failed (${response.status})`);
  return response.json() as Promise<{ user: { betaAccess: boolean } }>;
});

const activateBetaAccess = createServerFn({ method: "POST" })
  .validator((value: unknown) => typeof value === "string" ? value.trim() : "")
  .handler(async ({ data: code }) => {
    const apiUrl = (process.env.API_URL?.trim() ?? "http://localhost:3001").replace(/\/+$/, "");
    const headers = forwardedAuthHeaders();
    headers.set("Content-Type", "application/json");
    const response = await fetch(`${apiUrl}/v1/beta/activate`, { method: "POST", headers, body: JSON.stringify({ code }) });
    if (response.status === 401) throw redirect({ to: "/sign-in", search: { redirect: "/activate" } });
    const result = await response.json() as { enabled?: boolean; error?: string };
    if (!response.ok || !result.enabled) throw new Error(result.error || "Unable to activate beta access");
  });

export const Route = createFileRoute("/activate")({
  loader: async () => {
    const account = await getAccountStatus();
    if (account.user.betaAccess) throw redirect({ to: "/account", search: { tab: "subscription" } });
    return account;
  },
  component: ActivatePage,
});

function ActivatePage() {
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function activate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setMessage("");
    try {
      await activateBetaAccess({ data: code });
      trackEvent("beta_activated");
      window.location.href = "/account";
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to activate beta access");
      setBusy(false);
    }
  }

  return (
    <AccountShell><main className="account-page">
      <section className="beta-access-gate">
        <p className="section-index">PRIVATE BETA</p>
        <h1>Enter the<br />inner circle.</h1>
        <p>Your account is ready. Enter your invitation code to unlock your account and choose a subscription.</p>
        <form onSubmit={activate}>
          <label>
            Beta access code
            <input autoCapitalize="characters" autoComplete="one-time-code" autoCorrect="off" placeholder="SIL-XXXX-XXXX-XXXX-XXXX" required spellCheck={false} value={code} onChange={(event) => setCode(event.target.value)} />
          </label>
          <button className="primary-button" disabled={busy}>{busy ? "Activating…" : "Activate my access"}</button>
        </form>
        {message && <p className="auth-message is-error" aria-live="polite">{message}</p>}
      </section>
    </main></AccountShell>
  );
}
