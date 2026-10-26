import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { useRef, type ReactElement } from "react";

export type { TurnstileInstance };

export const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY?.trim() || undefined;

export function useTurnstileToken() {
  const turnstileRef = useRef<TurnstileInstance>(null);

  async function getTurnstileToken() {
    if (!turnstileSiteKey) {
      throw new Error("Security check is not configured. Contact support if this continues.");
    }

    const widget = turnstileRef.current;
    if (!widget) {
      throw new Error("Security check is still loading. Wait a second and try again.");
    }

    const existing = widget.getResponse();
    if (existing && !widget.isExpired()) {
      return existing;
    }

    widget.reset();
    try {
      widget.execute();
    } catch {
      // Non-interactive / render modes obtain the token without execute().
    }

    try {
      return await widget.getResponsePromise(20_000);
    } catch {
      throw new Error("Security check failed. Refresh the page and try again.");
    }
  }

  function resetTurnstile() {
    turnstileRef.current?.reset();
  }

  return { turnstileRef, getTurnstileToken, resetTurnstile, siteKey: turnstileSiteKey };
}

export function WaitlistTurnstile({
  turnstileRef,
  dark = false,
}: {
  turnstileRef: React.RefObject<TurnstileInstance | null>;
  dark?: boolean;
}): ReactElement | null {
  if (!turnstileSiteKey) return null;

  return (
    <div className="turnstile-widget">
      <Turnstile
        ref={turnstileRef}
        siteKey={turnstileSiteKey}
        options={{
          action: "join_beta_waitlist",
          // Compatible with Managed and Non-interactive (Spin) widgets.
          appearance: "always",
          theme: dark ? "dark" : "auto",
          size: "flexible",
          retry: "auto",
          refreshExpired: "auto",
        }}
        onExpire={() => {
          turnstileRef.current?.reset();
        }}
      />
    </div>
  );
}
