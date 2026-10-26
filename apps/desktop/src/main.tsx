import React from "react";
import ReactDOM from "react-dom/client";
import { I18nProvider } from "@lingui/react";
import { i18n } from "./i18n";
import App from "./App";
import "./index.css";
import { AccountGate } from "./components/account-gate";
import { UpdateNotifier } from "./components/update-notifier";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./lib/appearance";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false },
  },
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <I18nProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <AccountGate><App /></AccountGate>
        <UpdateNotifier />
      </QueryClientProvider>
    </I18nProvider>
  </React.StrictMode>,
);
