import posthog from "posthog-js";

export type AnalyticsEvent = "waitlist_joined" | "desktop_downloaded" | "beta_activated";
type CampaignData = Record<string, string>;

const consentKey = "sillage_analytics_consent";
const campaignKey = "sillage_campaign_data";
let posthogReady = false;
let googleReady = false;

function campaignData(): CampaignData {
  if (typeof window === "undefined") return {};
  const params = new URLSearchParams(window.location.search);
  const data: CampaignData = {};
  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]) {
    const value = params.get(key)?.trim();
    if (value) data[key] = value;
  }
  if (Object.keys(data).length > 0) {
    window.sessionStorage.setItem(campaignKey, JSON.stringify(data));
    return data;
  }
  try {
    return JSON.parse(window.sessionStorage.getItem(campaignKey) ?? "{}") as CampaignData;
  } catch {
    return {};
  }
}

export function getAnalyticsConsent(): "accepted" | "declined" | null {
  if (typeof window === "undefined") return null;
  const value = window.localStorage.getItem(consentKey);
  return value === "accepted" || value === "declined" ? value : null;
}

export function setAnalyticsConsent(value: "accepted" | "declined") {
  window.localStorage.setItem(consentKey, value);
  if (value === "accepted") initializeAnalytics();
}

function loadGoogleAnalytics() {
  const measurementId = import.meta.env.VITE_GOOGLE_ANALYTICS_ID?.trim();
  if (!measurementId || googleReady) return;
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
  document.head.appendChild(script);
  window.dataLayer = window.dataLayer ?? [];
  window.gtag = (...args: unknown[]) => window.dataLayer?.push(args);
  window.gtag("js", new Date());
  window.gtag("config", measurementId, { send_page_view: false });
  googleReady = true;
}

function loadPostHog() {
  const apiKey = import.meta.env.VITE_POSTHOG_KEY?.trim();
  if (!apiKey || posthogReady) return;
  posthog.init(apiKey, {
    api_host: import.meta.env.VITE_POSTHOG_HOST?.trim() || "https://eu.i.posthog.com",
    autocapture: false,
    capture_pageview: false,
    disable_session_recording: true,
  });
  posthogReady = true;
}

export function initializeAnalytics() {
  if (typeof window === "undefined" || getAnalyticsConsent() !== "accepted") return;
  loadGoogleAnalytics();
  loadPostHog();
}

export function trackPageView(pathname: string) {
  initializeAnalytics();
  const properties = { page_path: pathname, ...campaignData() };
  const measurementId = import.meta.env.VITE_GOOGLE_ANALYTICS_ID?.trim();
  if (googleReady && measurementId) window.gtag?.("event", "page_view", { ...properties, send_to: measurementId });
  if (posthogReady) posthog.capture("$pageview", properties);
}

export function trackEvent(event: AnalyticsEvent, properties: Record<string, unknown> = {}) {
  initializeAnalytics();
  const eventProperties = { ...campaignData(), ...properties };
  const measurementId = import.meta.env.VITE_GOOGLE_ANALYTICS_ID?.trim();
  if (googleReady && measurementId) window.gtag?.("event", event, { ...eventProperties, send_to: measurementId });
  if (posthogReady) posthog.capture(event, eventProperties);
}

declare global {
  interface Window {
    dataLayer?: unknown[][];
    gtag?: (...args: unknown[]) => void;
  }
}
