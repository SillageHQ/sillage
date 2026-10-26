import { useEffect, useState } from "react";
import { useLocation } from "@tanstack/react-router";
import { getAnalyticsConsent, initializeAnalytics, setAnalyticsConsent, trackPageView } from "../lib/analytics";

export function Analytics() {
  const location = useLocation();
  const [consent, setConsent] = useState<"accepted" | "declined" | null>(null);

  useEffect(() => {
    const currentConsent = getAnalyticsConsent();
    setConsent(currentConsent);
    if (currentConsent === "accepted") initializeAnalytics();
  }, []);

  useEffect(() => {
    if (consent === "accepted") trackPageView(location.pathname);
  }, [consent, location.pathname]);

  if (consent !== null) return null;
  return (
    <aside className="analytics-consent" role="dialog" aria-label="Analytics preferences">
      <p>Help us improve Sillage by allowing anonymous analytics about visits and beta activation.</p>
      <div>
        <button type="button" onClick={() => { setAnalyticsConsent("accepted"); setConsent("accepted"); }}>Accept analytics</button>
        <button type="button" className="analytics-consent-decline" onClick={() => { setAnalyticsConsent("declined"); setConsent("declined"); }}>Decline</button>
      </div>
    </aside>
  );
}
