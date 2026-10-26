import { defineConfig } from "@lingui/cli";
import { formatter } from "@lingui/format-po";

export default defineConfig({
  sourceLocale: "en",
  locales: ["en", "fr"],
  compileNamespace: "ts",
  format: formatter({ lineNumbers: false }),
  catalogs: [
    {
      path: "<rootDir>/src/locales/{locale}/messages",
      include: ["src/**/*.{ts,tsx}"],
    },
  ],
});
