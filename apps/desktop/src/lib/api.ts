const configuredApiUrl = import.meta.env.VITE_API_URL?.trim();

if (import.meta.env.PROD && !configuredApiUrl) {
  throw new Error("VITE_API_URL must be configured for production builds");
}

/** Public API base URL (must include scheme, no trailing slash). */
export const API_URL = (configuredApiUrl ?? "http://localhost:3001").replace(/\/+$/, "");

/** Bypass the zrok share interstitial during tunnel-based development. */
export function tunnelBypassHeaders(url: string = API_URL): Record<string, string> {
  const headers: Record<string, string> = {};
  if (url.includes(".zrok.io") || url.includes("shares.zrok")) {
    headers["skip_zrok_interstitial"] = "true";
  }
  return headers;
}
