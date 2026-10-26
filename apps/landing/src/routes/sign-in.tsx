import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { BrandMark, Wordmark } from "../components/brand";
import { GoogleSignIn } from "../components/google-sign-in";
import { accountCallbackURL, authClient, passkeysSupported } from "../lib/auth-client";

function safeRedirect(value: unknown) {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : "/account";
}

export const Route = createFileRoute("/sign-in")({
  validateSearch: (search) => ({ redirect: safeRedirect(search.redirect) }),
  component: SignInPage,
});

function SignInPage() {
  const { redirect } = Route.useSearch();
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [hasError, setHasError] = useState(false);
  const [busy, setBusy] = useState(false);

  async function magicLink(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setMessage(""); setHasError(false);
    const result = await authClient.signIn.magicLink({ email, callbackURL: accountCallbackURL(redirect) });
    setBusy(false); setHasError(Boolean(result.error));
    setMessage(result.error ? result.error.message || "Unable to send the link" : "Link sent. Check your inbox to continue.");
  }

  async function passkey() {
    if (!passkeysSupported()) { setHasError(true); return setMessage("Passkeys are not supported by this browser."); }
    setBusy(true); setMessage(""); setHasError(false);
    const result = await authClient.signIn.passkey();
    setBusy(false);
    if (result.error) { setHasError(true); return setMessage(result.error.message || "Unable to use this passkey"); }
    window.location.href = redirect;
  }

  return (
    <main className="auth-page">
      <a className="auth-home" href="/" aria-label="Sillage home"><Wordmark /></a>
      <section className="auth-shell">
        <aside className="auth-intro">
          <BrandMark className="auth-mark" />
          <p className="section-index">PRIVATE BETA — ACCOUNT 02</p>
          <p>Pick up the thread<br />where you left it.</p>
        </aside>
        <div className="auth-card">
          <p className="auth-eyebrow">WELCOME BACK</p>
          <h1>Follow your<br />trail.</h1>
          <GoogleSignIn context="signin" callbackPath={redirect} />
          <button className="auth-social auth-option" disabled={busy} onClick={() => void passkey()}>Continue with a passkey <span>→</span></button>
          <div className="auth-divider"><span>or use a magic link</span></div>
          <form onSubmit={magicLink}>
            <label>Email<input type="email" autoComplete="email webauthn" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            {message && <p className={`auth-message${hasError ? " is-error" : ""}`} aria-live="polite">{message}</p>}
            <button className="primary-button" disabled={busy}>{busy ? "Sending…" : "Send my magic link"}</button>
          </form>
          <p>New to Sillage? <a href={`/sign-up?redirect=${encodeURIComponent(redirect)}`}>Create an account</a></p>
        </div>
      </section>
    </main>
  );
}
