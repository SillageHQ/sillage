import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { BrandMark, Wordmark } from "../components/brand";
import { GoogleSignIn } from "../components/google-sign-in";
import { accountCallbackURL, authClient } from "../lib/auth-client";

function safeRedirect(value: unknown) {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : "/account";
}

export const Route = createFileRoute("/sign-up")({
  validateSearch: (search) => ({ redirect: safeRedirect(search.redirect) }),
  component: SignUpPage,
});

function SignUpPage() {
  const { redirect } = Route.useSearch();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [hasError, setHasError] = useState(false);
  const [busy, setBusy] = useState(false);

  async function signUpWithMagicLink(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setMessage(""); setHasError(false);
    const callbackURL = accountCallbackURL(redirect);
    const result = await authClient.signIn.magicLink({
      name: name.trim(), email, callbackURL, newUserCallbackURL: callbackURL,
    });
    setBusy(false);
    setHasError(Boolean(result.error));
    setMessage(result.error
      ? result.error.message || "Unable to send the link"
      : "Link sent. Open your inbox to finish creating your account.");
  }

  return (
    <main className="auth-page">
      <a className="auth-home" href="/" aria-label="Sillage home"><Wordmark /></a>
      <section className="auth-shell">
        <aside className="auth-intro">
          <BrandMark className="auth-mark" />
          <p className="section-index">PRIVATE BETA — ACCOUNT 01</p>
          <p>Your notes stay yours.<br />Your trail follows you.</p>
        </aside>
        <div className="auth-card">
          <p className="auth-eyebrow">START YOUR TRAIL</p>
          <h1>Create your<br />account.</h1>
          <GoogleSignIn context="signup" callbackPath={redirect} />
          <div className="auth-divider"><span>or use a magic link</span></div>
          <form onSubmit={signUpWithMagicLink}>
            <label>Name<input autoComplete="name" required value={name} onChange={(event) => setName(event.target.value)} /></label>
            <label>Email<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            {message && <p className={`auth-message${hasError ? " is-error" : ""}`} aria-live="polite">{message}</p>}
            <button className="primary-button" disabled={busy}>{busy ? "Sending…" : "Send my magic link"}</button>
          </form>
          <p className="auth-legal">By continuing, you agree to the <a href="/tos">Terms of Service</a> and acknowledge the <a href="/privacy">Privacy Policy</a>.</p>
          <p>Already have an account? <a href={`/sign-in?redirect=${encodeURIComponent(redirect)}`}>Sign in</a></p>
        </div>
      </section>
    </main>
  );
}
