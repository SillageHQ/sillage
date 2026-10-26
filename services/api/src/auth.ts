import { betterAuth } from "better-auth";
import { passkey } from "@better-auth/passkey";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { bearer, magicLink, oneTap } from "better-auth/plugins";
import { provisionAccount } from "./accounts.js";
import { systemPrisma } from "./database.js";
import { sendMagicLinkEmail } from "./email.js";

const trustedOrigins = (process.env.BETTER_AUTH_TRUSTED_ORIGINS
  ?? "http://localhost:5173,http://localhost:3000,tauri://localhost,http://tauri.localhost,https://tauri.localhost")
  .split(",").map((origin) => origin.trim()).filter(Boolean);

const passkeyOrigins = (process.env.BETTER_AUTH_PASSKEY_ORIGINS ?? "http://localhost:3000")
  .split(",").map((origin) => origin.trim()).filter(Boolean);

const cookieDomain = process.env.BETTER_AUTH_COOKIE_DOMAIN?.trim();
if (process.env.NODE_ENV === "production" && !cookieDomain) {
  throw new Error("BETTER_AUTH_COOKIE_DOMAIN must be configured in production");
}

export const auth = betterAuth({
  appName: "Sillage",
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3001",
  secret: process.env.BETTER_AUTH_SECRET,
  trustedOrigins,
  advanced: {
    cookiePrefix: "sillage-auth",
    ...(cookieDomain ? {
      crossSubDomainCookies: {
        enabled: true,
        domain: cookieDomain,
      },
    } : {}),
  },
  database: prismaAdapter(systemPrisma, { provider: "postgresql" }),
  socialProviders: process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET ? {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      prompt: "select_account",
    },
  } : {},
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          await systemPrisma.user.update({
            where: { id: user.id },
            data: { enabled: false },
          });
          await provisionAccount(systemPrisma, {
            authUserId: user.id,
            email: user.email,
            displayName: user.name || undefined,
          });
        },
      },
    },
  },
  plugins: [
    passkey({
      rpID: process.env.BETTER_AUTH_PASSKEY_RP_ID ?? "localhost",
      rpName: "Sillage",
      origin: passkeyOrigins,
    }),
    magicLink({
      expiresIn: 10 * 60,
      storeToken: "hashed",
      sendMagicLink: ({ email, url }) => sendMagicLinkEmail(email, url),
    }),
    oneTap(),
    bearer({ requireSignature: true }),
  ],
});
