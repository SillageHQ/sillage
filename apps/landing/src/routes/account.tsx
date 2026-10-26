import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { initializePaddle, type Paddle } from "@paddle/paddle-js";
import { authBaseURL, authClient, passkeysSupported } from "../lib/auth-client";
import { AccountShell } from "../components/account-shell";
import { PricingPlans, type PricingPlanId } from "../components/pricing-plans";
import { getReleaseCatalog, type ReleaseCatalog } from "../lib/releases";

type BillingInterval = "monthly" | "yearly";

function forwardedAuthHeaders() {
  const incoming = getRequestHeaders();
  const headers = new Headers();
  const cookie = incoming.get("cookie");
  const authorization = incoming.get("authorization");
  if (cookie) headers.set("cookie", cookie);
  if (authorization) headers.set("authorization", authorization);
  return headers;
}

const provisionAccount = createServerFn({ method: "POST" }).handler(async () => {
  const configuredApiUrl = process.env.API_URL?.trim();
  if (process.env.NODE_ENV === "production" && !configuredApiUrl) {
    throw new Error("API_URL must be configured in production");
  }
  const apiUrl = (configuredApiUrl ?? "http://localhost:3001").replace(/\/+$/, "");
  const response = await fetch(`${apiUrl}/v1/account/bootstrap`, {
    method: "POST",
    headers: forwardedAuthHeaders(),
  });
  if (response.status === 401) throw redirect({ to: "/sign-in", search: { redirect: "/account" } });
  if (!response.ok) throw new Error(`Account provisioning failed (${response.status})`);
  return response.json() as Promise<{
    user: { enabled: boolean; betaAccess: boolean };
    billing: { configured: boolean; active: boolean; availablePlans: Record<BillingInterval, Partial<Record<PricingPlanId, boolean>>>; subscription: { status: string; priceId: string; plan: PricingPlanId | null; interval: BillingInterval | null; noteLimit: number; nextBilledAt: string | null; canceledAt: string | null } | null };
    workspace: { id: string; name: string; indexedNotes: number };
  }>;
});

const activateBetaAccess = createServerFn({ method: "POST" })
  .validator((value: unknown) => typeof value === "string" ? value.trim() : "")
  .handler(async ({ data: code }) => {
    const configuredApiUrl = process.env.API_URL?.trim();
    if (process.env.NODE_ENV === "production" && !configuredApiUrl) {
      throw new Error("API_URL must be configured in production");
    }
    const apiUrl = (configuredApiUrl ?? "http://localhost:3001").replace(/\/+$/, "");
    const headers = forwardedAuthHeaders();
    headers.set("Content-Type", "application/json");
    const response = await fetch(`${apiUrl}/v1/beta/activate`, {
      method: "POST",
      headers,
      body: JSON.stringify({ code }),
    });
    if (response.status === 401) throw redirect({ to: "/sign-in", search: { redirect: "/account" } });
    const result = await response.json() as { enabled?: boolean; error?: string };
    if (!response.ok || !result.enabled) {
      throw new Error(result.error || "Unable to activate beta access");
    }
    return { enabled: true };
  });

const createBillingCheckout = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    if (!value || typeof value !== "object") return { plan: "personal" as const, interval: "monthly" as const };
    const input = value as { plan?: unknown; interval?: unknown };
    return {
      plan: input.plan === "deep" || input.plan === "archive" ? input.plan : "personal" as const,
      interval: input.interval === "yearly" ? "yearly" as const : "monthly" as const,
    };
  })
  .handler(async ({ data: { plan, interval } }) => {
  const configuredApiUrl = process.env.API_URL?.trim();
  if (process.env.NODE_ENV === "production" && !configuredApiUrl) throw new Error("API_URL must be configured in production");
  const apiUrl = (configuredApiUrl ?? "http://localhost:3001").replace(/\/+$/, "");
  const headers = forwardedAuthHeaders();
  headers.set("Content-Type", "application/json");
  const response = await fetch(`${apiUrl}/v1/billing/checkout`, { method: "POST", headers, body: JSON.stringify({ plan, interval }) });
  const result = await response.json() as { transactionId?: string; error?: string };
  if (!response.ok || !result.transactionId) throw new Error(result.error || "Unable to start checkout");
  return result;
  });

const cancelBillingSubscription = createServerFn({ method: "POST" }).handler(async () => {
  const configuredApiUrl = process.env.API_URL?.trim();
  if (process.env.NODE_ENV === "production" && !configuredApiUrl) throw new Error("API_URL must be configured in production");
  const apiUrl = (configuredApiUrl ?? "http://localhost:3001").replace(/\/+$/, "");
  const response = await fetch(`${apiUrl}/v1/billing/cancel`, { method: "POST", headers: forwardedAuthHeaders() });
  const result = await response.json() as { error?: string };
  if (!response.ok) throw new Error(result.error || "Unable to cancel subscription");
  return { ok: true };
});

export const Route = createFileRoute("/account")({
  validateSearch: (search: Record<string, unknown>) => ({
    tab: search.tab === "connection" ? "connection" as const : "subscription" as const,
  }),
  loader: async () => {
    const [account, releaseCatalog] = await Promise.all([provisionAccount(), getReleaseCatalog()]);
    if (!account.user.betaAccess) throw redirect({ to: "/activate" });
    return { account, releaseCatalog };
  },
  component: AccountPage,
});

function AccountPage() {
  const { account, releaseCatalog } = Route.useLoaderData();
  const { billing, workspace, user } = account;
  return <EnabledAccount workspaceName={workspace.name} indexedNotes={workspace.indexedNotes} billing={billing} betaAccess={user.betaAccess} releaseCatalog={releaseCatalog} />;
}

function BillingButton({ billing, plan = "personal", interval = "monthly", autoStart = false, onClosed, allowActive = false }: { billing: { configured: boolean; active: boolean }; plan?: PricingPlanId; interval?: BillingInterval; autoStart?: boolean; onClosed?: () => void; allowActive?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [transactionId, setTransactionId] = useState<string | null>(null);
  const paddleRef = useRef<Paddle | null>(null);

  useEffect(() => {
    if (!transactionId) return;
    let cancelled = false;
    void initializePaddle({
      token: import.meta.env.VITE_PADDLE_CLIENT_TOKEN,
      environment: import.meta.env.VITE_PADDLE_ENVIRONMENT === "sandbox" ? "sandbox" : "production",
      checkout: {
        settings: {
          displayMode: "inline",
          frameTarget: "paddle-checkout-frame",
          frameInitialHeight: 560,
          frameStyle: "width: 100%; min-width: 312px; max-width: 100%; background-color: transparent; border: none;",
        },
      },
    }).then((paddle) => {
      if (cancelled) return;
      if (!paddle) throw new Error("Paddle checkout could not be initialized");
      paddleRef.current = paddle;
      paddle.Checkout.open({ transactionId });
      setBusy(false);
    }).catch((error: unknown) => {
      if (cancelled) return;
      setMessage(error instanceof Error ? error.message : "Unable to open checkout");
      setBusy(false);
    });
    return () => { cancelled = true; };
  }, [transactionId]);

  function closeCheckout() {
    paddleRef.current?.Checkout.close();
    paddleRef.current = null;
    setTransactionId(null);
    setBusy(false);
    onClosed?.();
  }

  async function openCheckout() {
    setBusy(true); setMessage("");
    try {
      const { transactionId } = await createBillingCheckout({ data: { plan, interval } });
      if (!transactionId) throw new Error("Checkout transaction was not created");
      setTransactionId(transactionId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to start checkout");
      setBusy(false);
    }
  }
  useEffect(() => {
    if (autoStart) void openCheckout();
  }, [autoStart, plan, interval]);
  if (billing.active && !allowActive) return <p className="billing-status">Subscription active. Refresh this page in a moment to unlock your account.</p>;
  return <>
    {(!autoStart || message) && <button className="primary-button" disabled={!billing.configured || busy} onClick={() => void openCheckout()}>
      {busy ? "Opening checkout…" : billing.configured ? "Start subscription" : "Subscription coming soon"}
    </button>}
    {message && <p className="auth-message is-error" aria-live="polite">{message}</p>}
    {transactionId && <div className="paddle-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeCheckout(); }}>
      <section className="paddle-modal" role="dialog" aria-modal="true" aria-label="Subscription checkout">
        <div className="paddle-modal-header">
          <p>SUBSCRIPTION</p>
          <button type="button" className="paddle-modal-close" onClick={closeCheckout} aria-label="Close checkout">×</button>
        </div>
        <div id="paddle-checkout-frame" className="paddle-checkout-frame" aria-label="Paddle payment form" />
      </section>
    </div>}
  </>;
}

function BetaActivationGate({ billing }: { billing: { configured: boolean; active: boolean } }) {
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function activate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      await activateBetaAccess({ data: code });
      window.location.reload();
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
        <p>Your account is ready. Enter your invitation code to unlock Sillage and connect the desktop app.</p>
        <form onSubmit={activate}>
          <label>
            Beta access code
            <input
              autoCapitalize="characters"
              autoComplete="one-time-code"
              autoCorrect="off"
              placeholder="SIL-XXXX-XXXX-XXXX-XXXX"
              required
              spellCheck={false}
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </label>
          <button className="primary-button" disabled={busy}>{busy ? "Activating…" : "Activate my access"}</button>
        </form>
        <div className="billing-gate">
          <p>Prefer to subscribe?</p>
          <BillingButton billing={billing} />
        </div>
        {message && <p className="auth-message is-error" aria-live="polite">{message}</p>}
      </section>
    </main></AccountShell>
  );
}

function EnabledAccount({ workspaceName, indexedNotes, billing, betaAccess, releaseCatalog }: { workspaceName: string; indexedNotes: number; betaAccess: boolean; releaseCatalog: ReleaseCatalog; billing: { configured: boolean; active: boolean; availablePlans: Record<BillingInterval, Partial<Record<PricingPlanId, boolean>>>; subscription: { status: string; priceId: string; plan: PricingPlanId | null; interval: BillingInterval | null; noteLimit: number; nextBilledAt: string | null; canceledAt: string | null } | null } }) {
  const navigate = useNavigate({ from: "/account" });
  const { tab } = Route.useSearch();
  type UserPasskey = { id: string; name?: string; createdAt: string; deviceType?: string };
  const [busy, setBusy] = useState(false);
  const [passkeyMessage, setPasskeyMessage] = useState("");
  const [passkeys, setPasskeys] = useState<UserPasskey[]>([]);
  const [passkeysLoading, setPasskeysLoading] = useState(true);
  const [passkeyName, setPasskeyName] = useState("This device");
  const [selectedPlan, setSelectedPlan] = useState<PricingPlanId | null>(null);
  const [billingInterval, setBillingInterval] = useState<BillingInterval>(billing.subscription?.interval ?? "monthly");
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelMessage, setCancelMessage] = useState("");
  const [cancelScheduled, setCancelScheduled] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  async function loadPasskeys() {
    setPasskeysLoading(true);
    try {
      const response = await fetch(`${authBaseURL}/api/auth/passkey/list-user-passkeys`, { credentials: "include" });
      if (!response.ok) throw new Error("Unable to load passkeys");
      setPasskeys(await response.json() as UserPasskey[]);
    } catch (error) {
      setPasskeyMessage(error instanceof Error ? error.message : "Unable to load passkeys");
    } finally { setPasskeysLoading(false); }
  }
  useEffect(() => { void loadPasskeys(); }, []);
  async function cancelSubscription() {
    setCancelBusy(true); setCancelMessage("");
    try { await cancelBillingSubscription(); setCancelScheduled(true); setShowCancelConfirm(false); }
    catch (error) { setCancelMessage(error instanceof Error ? error.message : "Unable to cancel subscription"); }
    finally { setCancelBusy(false); }
  }
  async function addPasskey() {
    if (!passkeysSupported()) return setPasskeyMessage("Passkeys are not supported by this browser.");
    setBusy(true); setPasskeyMessage("");
    const result = await authClient.passkey.addPasskey({ name: passkeyName.trim() || "This device" });
    setBusy(false);
    setPasskeyMessage(result.error
      ? result.error.message || "Unable to add the passkey"
      : "Passkey added. You can now use it to sign in without a password.");
    if (!result.error) void loadPasskeys();
  }
  async function revokePasskey(id: string) {
    setBusy(true); setPasskeyMessage("");
    try {
      const response = await fetch(`${authBaseURL}/api/auth/passkey/delete-passkey`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!response.ok) throw new Error("Unable to revoke this passkey");
      setPasskeys((current) => current.filter((passkey) => passkey.id !== id));
      setPasskeyMessage("Passkey revoked.");
    } catch (error) { setPasskeyMessage(error instanceof Error ? error.message : "Unable to revoke this passkey"); }
    finally { setBusy(false); }
  }
  return (
    <AccountShell><main className="account-page">
      <section>
        <p className="section-index">YOUR ACCOUNT</p>
        <p>Your personal workspace <strong>{workspaceName}</strong> is ready.</p>
        <nav className="account-tabs" aria-label="Account sections">
          <button className={tab === "subscription" ? "is-active" : ""} onClick={() => void navigate({ search: { tab: "subscription" } })}>{betaAccess ? "Beta access" : "Subscription"}</button>
          <button className={tab === "connection" ? "is-active" : ""} onClick={() => void navigate({ search: { tab: "connection" } })}>Connection</button>
        </nav>
        {tab === "subscription" ? <section className="account-tab-panel" aria-label="Subscription">
          {betaAccess
            ? <div className="billing-active">
              <div className="billing-summary">
                <p className="billing-summary-meta billing-plan-line">Private beta access: <strong>Active</strong></p>
                <p className="billing-summary-meta">Your access is free during the beta. You pay OpenRouter directly with your own API key.</p>
              </div>
              <BetaDownloads catalog={releaseCatalog} />
            </div>
            : billing.active
            ? <div className="billing-active">
              <div className="billing-summary">
                <p className="billing-summary-meta billing-plan-line">Your subscription is active: <strong>{billing.subscription?.plan ? billing.subscription.plan.charAt(0).toUpperCase() + billing.subscription.plan.slice(1) : "Subscription"}</strong></p>
                <div className="billing-usage">
                  <p><strong>{indexedNotes.toLocaleString()}</strong> of <strong>{(billing.subscription?.noteLimit ?? 0).toLocaleString()}</strong> notes indexed</p>
                  <div className="billing-progress" role="progressbar" aria-label="Indexed notes usage" aria-valuemin={0} aria-valuemax={billing.subscription?.noteLimit ?? 0} aria-valuenow={indexedNotes}>
                    <span style={{ width: `${Math.min(100, Math.round((indexedNotes / Math.max(1, billing.subscription?.noteLimit ?? 1)) * 100))}%` }} />
                  </div>
                </div>
                {billing.subscription?.canceledAt && <p className="billing-summary-meta">Access until {new Date(billing.subscription.canceledAt).toLocaleDateString()}</p>}
              </div>
              <div className="billing-manage">
                <button type="button" className="text-button" disabled={cancelBusy || cancelScheduled || Boolean(billing.subscription?.canceledAt)} onClick={() => setShowCancelConfirm(true)}>{billing.subscription?.canceledAt || cancelScheduled ? "Cancellation scheduled" : "Cancel my subscription"}</button>
                {cancelMessage && <p className="auth-message is-error">{cancelMessage}</p>}
              </div>
              <PricingPlans interval={billingInterval} onIntervalChange={setBillingInterval} availablePlans={billing.availablePlans[billingInterval]} selectedPlan={selectedPlan} activePlan={billing.subscription?.plan} onSelect={setSelectedPlan} ctaLabel="Start 30-day trial" />
              {selectedPlan && <BillingButton billing={billing} plan={selectedPlan} interval={billingInterval} autoStart allowActive onClosed={() => setSelectedPlan(null)} />}
              {showCancelConfirm && <div className="cancel-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowCancelConfirm(false); }}>
                <section className="cancel-modal" role="dialog" aria-modal="true" aria-labelledby="cancel-subscription-title">
                  <p className="section-index">CANCEL SUBSCRIPTION</p>
                  <h2 id="cancel-subscription-title">Are you sure?</h2>
                  <p>Your subscription will remain active until the end of the current billing period. You won’t be charged again after that.</p>
                  <div className="cancel-modal-actions">
                    <button type="button" className="cancel-modal-back" onClick={() => setShowCancelConfirm(false)} disabled={cancelBusy}>Keep my subscription</button>
                    <button type="button" className="cancel-modal-confirm" onClick={() => void cancelSubscription()} disabled={cancelBusy}>{cancelBusy ? "Cancelling…" : "Cancel subscription"}</button>
                  </div>
                </section>
              </div>}
            </div>
            : <div className="billing-gate">
              <p>Choose a subscription to keep your access after the beta.</p>
              <PricingPlans interval={billingInterval} onIntervalChange={setBillingInterval} availablePlans={billing.availablePlans[billingInterval]} selectedPlan={selectedPlan} activePlan={billing.subscription?.plan} onSelect={setSelectedPlan} ctaLabel="Start 30-day trial" />
              {selectedPlan && <BillingButton billing={billing} plan={selectedPlan} interval={billingInterval} autoStart onClosed={() => setSelectedPlan(null)} />}
            </div>}
        </section> : <section className="account-tab-panel" aria-label="Connection">
          <div className="account-security">
            <h2>Passwordless sign-in</h2>
            <p>Use a passkey stored on your device or in your password manager.</p>
            <div className="passkey-list" aria-live="polite">
              {passkeysLoading ? <p className="passkey-empty">Loading passkeys…</p> : passkeys.length === 0 ? <p className="passkey-empty">No passkeys registered yet.</p> : passkeys.map((passkey) => <div className="passkey-row" key={passkey.id}>
                <div><strong>{passkey.name || "Unnamed passkey"}</strong><span>{passkey.deviceType === "singleDevice" ? "This device" : "Synced passkey"} · Added {new Date(passkey.createdAt).toLocaleDateString()}</span></div>
                <button type="button" className="passkey-revoke" disabled={busy} onClick={() => void revokePasskey(passkey.id)}>Revoke</button>
              </div>)}
            </div>
            <div className="passkey-add">
              <label htmlFor="passkey-name">Name this passkey</label>
              <div><input id="passkey-name" value={passkeyName} onChange={(event) => setPasskeyName(event.target.value)} placeholder="This device" /><button className="auth-social" disabled={busy} onClick={() => void addPasskey()}>Add passkey</button></div>
            </div>
            {passkeyMessage && <p className="auth-message" aria-live="polite">{passkeyMessage}</p>}
          </div>
          <p className="account-note">To connect the Sillage desktop app, choose “Continue in browser” from the app.</p>
        </section>}
      </section>
    </main></AccountShell>
  );
}

function BetaDownloads({ catalog }: { catalog: ReleaseCatalog }) {
  const platforms = [
    ["darwin", "macOS"],
    ["windows", "Windows"],
    ["linux", "Linux"],
  ] as const;
  return <section className="account-downloads" aria-label="Desktop downloads">
    <p className="section-index">DESKTOP APP</p>
    <h2>Download Sillage</h2>
    <p>{catalog.available ? "Install the latest desktop build and connect it from this account." : "The release archive is temporarily unavailable."}</p>
    <div className="account-download-list">
      {platforms.map(([platform, label]) => {
        const artifact = catalog.releases.flatMap((release) => release.artifacts).find((item) => item.platform === platform && item.downloadUrl);
        return artifact?.downloadUrl
          ? <a key={platform} className="release-download" href={artifact.downloadUrl}><span><b>{label}</b><small>{artifact.format.toUpperCase()} · {artifact.arch}</small></span><span className="release-download-action">Download <i aria-hidden="true">↓</i></span></a>
          : <span key={platform} className="release-download" aria-disabled="true"><span><b>{label}</b><small>Not available yet</small></span></span>;
      })}
    </div>
    <a className="hero-release-link" href="/releases">Browse every release <span aria-hidden="true">↗</span></a>
  </section>;
}
