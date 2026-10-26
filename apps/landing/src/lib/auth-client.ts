import { createAuthClient } from "better-auth/react";
import { passkeyClient } from "@better-auth/passkey/client";
import { magicLinkClient, oneTapClient } from "better-auth/client/plugins";

const configuredApiUrl = import.meta.env.VITE_API_URL?.trim();
if (import.meta.env.PROD && !configuredApiUrl) {
  throw new Error("VITE_API_URL must be configured for production builds");
}
// In dev, keep browser requests same-origin so localhost, zrok, and other
// tunnels all go through Vite's API proxy instead of triggering CORS.
export const authBaseURL = (configuredApiUrl ?? (import.meta.env.DEV && typeof window !== "undefined" ? window.location.origin : "http://localhost:3001")).replace(/\/+$/, "");
const tunnelHeaders: Record<string, string> = {};
if (authBaseURL.includes(".zrok.io") || authBaseURL.includes("shares.zrok")) {
  tunnelHeaders["skip_zrok_interstitial"] = "true";
}

export const authClient = createAuthClient({
  baseURL: authBaseURL,
  fetchOptions: { credentials: "include", headers: tunnelHeaders },
  plugins: [
    magicLinkClient(),
    passkeyClient(),
    oneTapClient({
      clientId: import.meta.env.VITE_GOOGLE_CLIENT_ID,
      autoSelect: false,
    }),
  ],
});

export function passkeysSupported() {
  return typeof window !== "undefined" && "PublicKeyCredential" in window;
}

export function accountCallbackURL(path = "/account") {
  const siteURL = import.meta.env.DEV && typeof window !== "undefined"
    ? window.location.origin
    : import.meta.env.VITE_SITE_URL
      ?? (typeof window === "undefined" ? "http://localhost:5173" : window.location.origin);
  const safePath = path.startsWith("/") && !path.startsWith("//") ? path : "/account";
  return `${siteURL.replace(/\/$/, "")}${safePath}`;
}
