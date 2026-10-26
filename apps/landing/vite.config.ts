import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteTsConfigPaths from "vite-tsconfig-paths";
import { nitro } from 'nitro/vite'

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiTarget = "http://localhost:3001";
  const apiPaths = ["api", "v1", "health", "settings", "folders", "conversations", "messages", "vault-drafts", "vault", "consolidations", "capture", "rag", "ingest", "note", "notes", "resurface"];
  const apiRouteRules = Object.fromEntries(apiPaths.flatMap((path) => [
    [`/${path}`, { proxy: `${apiTarget}/${path}` }],
    [`/${path}/**`, { proxy: `${apiTarget}/${path}/**` }],
  ]));
  if (command === "build" && !env.VITE_API_URL?.trim()) {
    throw new Error("VITE_API_URL must be configured for production builds");
  }
  if (command === "build" && !env.VITE_TURNSTILE_SITE_KEY?.trim()) {
    throw new Error("VITE_TURNSTILE_SITE_KEY must be configured for production builds");
  }

  return {
    server: {
      allowedHosts: [".zrok.io"],
      proxy: {
        "^/(api|v1|health|settings|folders|conversations|messages|vault-drafts|vault|consolidations|capture|rag|ingest|note|notes|resurface)(/|$)": {
          target: "http://localhost:3001",
        },
      },
    },
    plugins: [
      viteTsConfigPaths(),
      tanstackStart(),
      nitro({
        preset: 'node-server',
        routeRules: command === "serve" ? apiRouteRules : {},
      }),
      react(),
    ],
  };
});
