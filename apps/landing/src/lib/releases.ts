import { createServerFn } from "@tanstack/react-start";

export type ReleaseArtifact = {
  platform: string;
  arch: string;
  format: string;
  fileName: string;
  sha256: string;
  size: number;
  downloadUrl: string | null;
};

export type AppRelease = {
  version: string;
  channel: string;
  publishedAt: string;
  artifacts: ReleaseArtifact[];
};

export type ReleaseCatalog = {
  releases: AppRelease[];
  available: boolean;
};

function apiBaseUrl() {
  const configuredApiUrl = process.env.API_URL?.trim();
  if (process.env.NODE_ENV === "production" && !configuredApiUrl) {
    throw new Error("API_URL must be configured in production");
  }
  return (configuredApiUrl ?? "http://localhost:3001").replace(/\/+$/, "");
}

export const getReleaseCatalog = createServerFn({ method: "GET" }).handler(async (): Promise<ReleaseCatalog> => {
  try {
    const response = await fetch(`${apiBaseUrl()}/v1/app-releases`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) return { releases: [], available: false };
    const payload = await response.json() as { releases?: AppRelease[] };
    return {
      releases: Array.isArray(payload.releases) ? payload.releases : [],
      available: true,
    };
  } catch {
    return { releases: [], available: false };
  }
});
