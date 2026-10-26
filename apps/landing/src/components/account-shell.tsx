import type { ReactNode } from "react";
import { authClient } from "../lib/auth-client";
import { Wordmark } from "./brand";

export function AccountShell({ children }: { children: ReactNode }) {
  function signOut() {
    void authClient.signOut({ fetchOptions: { onSuccess: () => { window.location.href = "/"; } } });
  }

  return <div className="account-shell">
    <header className="account-shell-header">
      <a className="account-brand" href="/"><Wordmark /></a>
      <button className="account-signout" onClick={signOut}>Sign out</button>
    </header>
    {children}
    <footer className="account-shell-footer">
      <p>Your notes. Now part of every conversation.</p>
      <div><a href="/privacy">Privacy</a><a href="/tos">Terms</a><a href="mailto:hello@sillagehq.app">Support</a></div>
    </footer>
  </div>;
}
