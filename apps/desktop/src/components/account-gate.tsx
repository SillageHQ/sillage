import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { API_URL, tunnelBypassHeaders } from "@/lib/api";
import { applyAppearance } from "@/lib/appearance";
import { Onboarding, type OnboardingSettings } from "./onboarding";

const browserSignInTimeoutSeconds = 10 * 60;
const tunnelHeaders = tunnelBypassHeaders(API_URL);
const originalFetch = window.fetch.bind(window);
let installedToken: string | null = null;
const AccountSessionContext = createContext<string | null>(null);

export function useAccountSession() {
  const accessToken = useContext(AccountSessionContext);
  if (!accessToken) throw new Error("useAccountSession must be used inside AccountGate");
  return accessToken;
}

function errorMessage(reason: unknown) {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === "string") return reason;
  return "Unable to connect to Sillage";
}

function applyTunnelHeaders(headers: Headers) {
  for (const [key, value] of Object.entries(tunnelHeaders)) {
    headers.set(key, value);
  }
}

function installAuthenticatedFetch(token: string) {
  installedToken = token;
  window.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(API_URL)) return originalFetch(input, init);
    const headers = new Headers(input instanceof Request ? input.headers : init.headers);
    headers.set("Authorization", `Bearer ${installedToken}`);
    applyTunnelHeaders(headers);
    return originalFetch(input, { ...init, headers });
  };
}

export function AccountGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [onboarding, setOnboarding] = useState<OnboardingSettings | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [savedToken, setSavedToken] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [message, setMessage] = useState("");
  const [accessRequired, setAccessRequired] = useState<"beta" | "subscription" | null>(null);
  const [busy, setBusy] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(browserSignInTimeoutSeconds);

  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => {
      setRemainingSeconds((seconds) => Math.max(0, seconds - 1));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [busy]);

  async function restoreSession(token: string) {
    setChecking(true);
    setMessage("");
    setAccessRequired(null);
    try {
      const response = await originalFetch(`${API_URL}/settings`, {
        headers: { Authorization: `Bearer ${token}`, ...tunnelHeaders },
      }).catch(() => null);

      if (!response) {
        setSavedToken(token);
        setMessage("Sillage could not reach your account. Your session is still saved — try again.");
        return;
      }

      if (response.ok) {
        const contentType = response.headers.get("content-type") ?? "";
        if (!contentType.includes("application/json")) {
          setSavedToken(token);
          setMessage("Sillage returned an unexpected response. Check the API URL and try again.");
          return;
        }
        const settings = await response.json() as OnboardingSettings;
        installAuthenticatedFetch(token);
        setSessionToken(token);
        applyAppearance(settings.theme, settings.accentColor);
        if (settings.onboardingCompletedAt) {
          setReady(true);
          void invoke("restart_watcher", { token }).catch(() => undefined);
        } else {
          setOnboarding(settings);
        }
        return;
      }

      if (response.status === 403) {
        const body = await response.clone().json().catch(() => ({})) as { code?: string };
        if (body.code === "BETA_ACCESS_REQUIRED") {
          setSavedToken(token);
          setAccessRequired("beta");
          return;
        }
        if (body.code === "SUBSCRIPTION_REQUIRED") {
          setSavedToken(token);
          setAccessRequired("subscription");
          return;
        }
      }

      if (response.status === 401 || response.status === 403) {
        await invoke("forget_access_token").catch(() => undefined);
        setSavedToken(null);
        setMessage("Please sign in again to continue.");
        return;
      }

      setSavedToken(token);
      setMessage("Sillage could not reach your account. Your session is still saved — try again.");
    } catch (reason) {
      setSavedToken(token);
      setMessage(errorMessage(reason));
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        const token = await invoke<string | null>("get_access_token").catch(() => null);
        if (token) {
          setSavedToken(token);
          await restoreSession(token);
          return;
        }
      } catch (reason) {
        setMessage(errorMessage(reason));
      }
      setChecking(false);
    })();
  }, []);

  async function connectInBrowser() {
    setBusy(true);
    setRemainingSeconds(browserSignInTimeoutSeconds);
    setMessage("");
    setAccessRequired(null);
    try {
      const token = await invoke<string>("connect_account", {
        apiUrl: API_URL,
        deviceName: `Sillage desktop · ${navigator.platform || "computer"}`,
      });
      installAuthenticatedFetch(token);
      setSessionToken(token);
      const response = await fetch(`${API_URL}/settings`);
      if (response.status === 403) {
        const body = await response.clone().json().catch(() => ({})) as { code?: string };
        if (body.code === "BETA_ACCESS_REQUIRED" || body.code === "SUBSCRIPTION_REQUIRED") {
          setSavedToken(token);
          setAccessRequired(body.code === "BETA_ACCESS_REQUIRED" ? "beta" : "subscription");
          setBusy(false);
          return;
        }
      }
      if (!response.ok) throw new Error("Unable to load your Sillage settings");
      const settings = await response.json() as OnboardingSettings;
      applyAppearance(settings.theme, settings.accentColor);
      if (settings.onboardingCompletedAt) {
        setReady(true);
        void invoke("restart_watcher", { token }).catch(() => undefined);
      } else {
        setOnboarding(settings);
      }
    } catch (reason) {
      setMessage(errorMessage(reason));
      setBusy(false);
    }
  }

  async function cancelBrowserConnection() {
    setMessage("Cancelling sign-in…");
    await invoke("cancel_account_connection").catch(() => undefined);
  }

  async function continueConnection() {
    if (savedToken) {
      await restoreSession(savedToken);
      return;
    }
    await connectInBrowser();
  }

  if (ready && sessionToken) {
    return <AccountSessionContext.Provider value={sessionToken}>{children}</AccountSessionContext.Provider>;
  }
  if (onboarding && sessionToken) return <Onboarding initial={onboarding} accessToken={sessionToken} onComplete={() => setReady(true)} />;
  if (accessRequired) {
    const siteUrl = (import.meta.env.VITE_SITE_URL?.trim() || API_URL).replace(/\/+$/, "");
    const betaBlocked = accessRequired === "beta";
    return (
      <main className="relative grid min-h-screen place-items-center overflow-hidden bg-[#0b0b0c] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,rgba(93,125,255,0.16),transparent_38%)]" />
        <section className="relative w-full max-w-[560px] rounded-[28px] border border-white/10 bg-[#151516]/95 p-10 shadow-[0_30px_90px_rgba(0,0,0,0.5)]">
          <div className="mb-10 flex items-center gap-3">
            <img src="/sillage-mark.svg" alt="" className="h-9 w-9" />
            <span className="text-[15px] font-semibold tracking-tight">Sillage</span>
          </div>
          <p className="mb-3 text-[11px] font-semibold tracking-[0.2em] text-[#8da6ff]">{betaBlocked ? "PRIVATE BETA" : "SILLAGE ACCESS"}</p>
          <h1 className="mb-4 text-[38px] font-semibold leading-[1.08] tracking-[-0.035em]">{betaBlocked ? <>Your beta access<br />isn’t active yet.</> : <>Choose a plan<br />to continue.</>}</h1>
          <p className="mb-8 max-w-md text-[15px] leading-7 text-white/55">{betaBlocked ? "This account is signed in, but it hasn’t been invited to the Sillage private beta. If you have an access code, activate it from your browser." : "Your beta access is active, but Sillage requires an active subscription before the desktop app can be used. Choose a plan from your account."}</p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <button type="button" className="flex flex-1 items-center justify-between rounded-xl bg-white px-5 py-4 text-[15px] font-semibold text-black transition hover:bg-white/90" onClick={() => void openUrl(`${siteUrl}${betaBlocked ? "/activate" : "/account?tab=subscription"}`)}>
              <span>{betaBlocked ? "Activate beta access" : "Choose a subscription"}</span><span aria-hidden="true">↗</span>
            </button>
            <button type="button" className="rounded-xl border border-white/10 px-5 py-4 text-sm font-semibold text-white/70 transition hover:bg-white/5 hover:text-white" onClick={() => void (savedToken ? restoreSession(savedToken) : continueConnection())}>
              Try again
            </button>
          </div>
          {message && <p className="mt-5 rounded-lg border border-red-300/15 bg-red-300/5 px-4 py-3 text-sm text-red-200" aria-live="polite">{message}</p>}
        </section>
      </main>
    );
  }
  if (checking) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#0b0b0c] text-white">
        <div role="status" aria-label="Restoring your Sillage session" className="flex flex-col items-center gap-6">
          <img src="/sillage-mark.svg" alt="" className="h-14 w-14" />
          <span className="size-5 animate-spin rounded-full border-2 border-white/20 border-t-white/80" aria-hidden="true" />
        </div>
      </main>
    );
  }
  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-[#0b0b0c] p-6 text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,rgba(93,125,255,0.12),transparent_38%)]" />
      <section className="relative w-full max-w-[520px] rounded-[28px] border border-white/10 bg-[#151516]/95 p-10 shadow-[0_30px_90px_rgba(0,0,0,0.5)]">
        <div className="mb-10 flex items-center gap-3">
          <img src="/sillage-mark.svg" alt="" className="h-9 w-9" />
          <span className="text-[15px] font-semibold tracking-tight">Sillage</span>
        </div>
        <p className="mb-3 text-[11px] font-semibold tracking-[0.2em] text-white/40">SILLAGE DESKTOP</p>
        <h1 className="mb-4 text-[38px] font-semibold leading-[1.08] tracking-[-0.035em]">Sign in to continue</h1>
        <p className="mb-8 max-w-md text-[15px] leading-7 text-white/55">
          We’ll open Sillage in your browser. Once you sign in, this desktop will connect automatically.
        </p>
        {busy ? (
          <>
            <div className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/5 px-5 py-4 text-[15px] font-semibold">
              <span>Waiting for your browser…</span>
              <span className="font-mono text-xs text-white/50">
                {Math.floor(remainingSeconds / 60)}:{String(remainingSeconds % 60).padStart(2, "0")}
              </span>
            </div>
            <button
              type="button"
              className="mt-3 w-full rounded-xl border border-white/10 px-5 py-3 text-sm font-semibold text-white/70 transition hover:bg-white/5 hover:text-white"
              onClick={() => void cancelBrowserConnection()}
            >
              Cancel
            </button>
            <p className="mt-4 text-center text-xs text-white/40">Complete sign-in in the browser window we opened.</p>
          </>
        ) : (
          <button
            type="button"
            disabled={checking}
            className="flex w-full items-center justify-between rounded-xl bg-white px-5 py-4 text-[15px] font-semibold text-black transition hover:bg-white/90 disabled:cursor-wait disabled:opacity-50"
            onClick={() => void continueConnection()}
          >
            <span>{checking ? "Checking your session…" : savedToken ? "Try again" : "Continue in browser"}</span>
            <span aria-hidden="true">↗</span>
          </button>
        )}
        {message && <p className="mt-5 rounded-lg border border-red-300/15 bg-red-300/5 px-4 py-3 text-sm text-red-200" aria-live="polite">{message}</p>}
        <p className="mt-8 text-xs leading-5 text-white/30">Your session is stored securely in this computer’s system keychain.</p>
      </section>
    </main>
  );
}
