import { useEffect, useRef, useState } from "react";
import { accountCallbackURL, authClient } from "../lib/auth-client";

export function GoogleSignIn({ context, callbackPath = "/account" }: { context: "signin" | "signup"; callbackPath?: string }) {
  const buttonContainer = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const container = buttonContainer.current;
    if (!container || !import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim()) return;

    container.replaceChildren();
    setError("");

    const width = Math.min(400, Math.max(240, Math.round(container.getBoundingClientRect().width)));
    void authClient.oneTap({
      callbackURL: accountCallbackURL(callbackPath),
      context,
      uxMode: "popup",
      autoSelect: false,
      button: {
        container,
        config: {
          type: "standard",
          theme: "outline",
          size: "large",
          text: "continue_with",
          shape: "rectangular",
          logo_alignment: "left",
          width,
        },
      },
    }).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "Unable to continue with Google");
    });
  }, [callbackPath, context]);

  if (!import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim()) return null;

  return (
    <div className="google-sign-in">
      <div ref={buttonContainer} />
      {error && <p className="auth-message is-error">{error}</p>}
    </div>
  );
}
