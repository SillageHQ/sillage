import { timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { Hono } from "hono";

const VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const PLATFORMS = new Set(["darwin", "linux", "windows"]);
const CHANNELS = new Set(["beta", "stable"]);
const RELEASE_CACHE_TTL_MS = 5 * 60 * 1_000;
const RELEASE_CACHE_CONTROL = "public, max-age=60, s-maxage=300, stale-while-revalidate=86400";

const releaseCache = new Map<string, { expiresAt: number; value: unknown }>();

type ArtifactPayload = {
  version: string;
  channel: string;
  platform: string;
  arch: string;
  fileName: string;
  objectKey: string;
  sha256: string;
  size: number;
};

function artifactFormat(fileName: string) {
  if (fileName.endsWith(".dmg")) return "dmg";
  if (fileName.endsWith(".AppImage")) return "appimage";
  if (fileName.endsWith(".deb")) return "deb";
  if (fileName.endsWith(".exe")) return "nsis";
  return "";
}

export function parseArtifactPayload(value: unknown): ArtifactPayload {
  if (!value || typeof value !== "object") throw new Error("JSON object required");
  const input = value as Record<string, unknown>;
  const payload = {
    version: String(input.version ?? "").trim(),
    channel: String(input.channel ?? "").trim(),
    platform: String(input.platform ?? "").trim(),
    arch: String(input.arch ?? "").trim(),
    fileName: String(input.fileName ?? "").trim(),
    objectKey: String(input.objectKey ?? "").trim(),
    sha256: String(input.sha256 ?? "").trim().toLowerCase(),
    size: Number(input.size),
  };

  if (!VERSION_PATTERN.test(payload.version)) throw new Error("version is invalid");
  if (!CHANNELS.has(payload.channel)) throw new Error("channel is invalid");
  if (!PLATFORMS.has(payload.platform)) throw new Error("platform is invalid");
  if (!/^[a-zA-Z0-9_-]+$/.test(payload.arch)) throw new Error("arch is invalid");
  if (!/^[^/\\]+$/.test(payload.fileName) || !artifactFormat(payload.fileName)) throw new Error("fileName is invalid");
  if (!payload.objectKey.startsWith(`releases/v${payload.version}/`) || payload.objectKey.includes("..")) {
    throw new Error("objectKey is invalid");
  }
  if (!SHA256_PATTERN.test(payload.sha256)) throw new Error("sha256 is invalid");
  if (!Number.isSafeInteger(payload.size) || payload.size <= 0 || payload.size > 2_147_483_647) {
    throw new Error("size is invalid");
  }
  return payload;
}

function hasReleaseToken(authorization: string | undefined) {
  const expected = process.env.RELEASE_REGISTRY_TOKEN;
  const provided = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!expected || !provided) return false;
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);
}

export function publicDownloadUrl(objectKey: string, sha256: string) {
  const baseUrl = process.env.R2_PUBLIC_BASE_URL?.replace(/\/$/, "");
  if (!baseUrl) return null;
  const encodedKey = objectKey.split("/").map(encodeURIComponent).join("/");
  return `${baseUrl}/${encodedKey}?sha256=${encodeURIComponent(sha256)}`;
}

type ReleaseWithArtifacts = {
  version: string;
  channel: string;
  publishedAt: Date;
  artifacts: Array<{
    platform: string;
    arch: string;
    format: string;
    fileName: string;
    objectKey: string;
    sha256: string;
    size: number;
  }>;
};

export function publicRelease(release: ReleaseWithArtifacts) {
  return {
    version: release.version,
    channel: release.channel,
    publishedAt: release.publishedAt,
    artifacts: release.artifacts.map((artifact) => ({
      platform: artifact.platform,
      arch: artifact.arch,
      format: artifact.format,
      fileName: artifact.fileName,
      sha256: artifact.sha256,
      size: artifact.size,
      downloadUrl: publicDownloadUrl(artifact.objectKey, artifact.sha256),
    })),
  };
}

function cachedReleaseResponse<T>(key: string) {
  const cached = releaseCache.get(key);
  if (!cached) return undefined;
  if (cached.expiresAt <= Date.now()) {
    releaseCache.delete(key);
    return undefined;
  }
  return cached.value as T;
}

function cacheReleaseResponse(key: string, value: unknown) {
  releaseCache.set(key, {
    expiresAt: Date.now() + RELEASE_CACHE_TTL_MS,
    value,
  });
}

export function registerAppReleaseRoutes(app: Hono, prisma: PrismaClient) {
  app.post("/v1/app-releases/artifacts", async (c) => {
    if (!process.env.RELEASE_REGISTRY_TOKEN) {
      return c.json({ error: "release registry is not configured" }, 503);
    }
    if (!hasReleaseToken(c.req.header("authorization"))) return c.json({ error: "unauthorized" }, 401);

    let payload: ArtifactPayload;
    try {
      payload = parseArtifactPayload(await c.req.json());
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "invalid payload" }, 400);
    }

    const artifact = await prisma.$transaction(async (tx) => {
      const release = await tx.appRelease.upsert({
        where: { version: payload.version },
        create: { version: payload.version, channel: payload.channel },
        update: { channel: payload.channel, publishedAt: new Date() },
      });
      return tx.appReleaseArtifact.upsert({
        where: {
          releaseId_platform_arch_format: {
            releaseId: release.id,
            platform: payload.platform,
            arch: payload.arch,
            format: artifactFormat(payload.fileName),
          },
        },
        create: {
          releaseId: release.id,
          platform: payload.platform,
          arch: payload.arch,
          format: artifactFormat(payload.fileName),
          fileName: payload.fileName,
          objectKey: payload.objectKey,
          sha256: payload.sha256,
          size: payload.size,
        },
        update: {
          fileName: payload.fileName,
          objectKey: payload.objectKey,
          sha256: payload.sha256,
          size: payload.size,
        },
      });
    });
    releaseCache.clear();
    return c.json({ ok: true, artifactId: artifact.id }, 201);
  });

  app.get("/v1/app-releases", async (c) => {
    const channel = (c.req.query("channel") ?? "").trim();
    if (channel && !CHANNELS.has(channel)) {
      return c.json({ error: "channel is invalid" }, 400);
    }
    if (!process.env.R2_PUBLIC_BASE_URL) {
      return c.json({ error: "release downloads are not configured" }, 503);
    }

    c.header("Cache-Control", RELEASE_CACHE_CONTROL);
    const cacheKey = `catalog:${channel || "all"}`;
    const cached = cachedReleaseResponse<{ releases: ReturnType<typeof publicRelease>[] }>(cacheKey);
    if (cached) return c.json(cached);

    const releases = await prisma.appRelease.findMany({
      where: channel ? { channel } : undefined,
      orderBy: { publishedAt: "desc" },
      include: {
        artifacts: {
          orderBy: [
            { platform: "asc" },
            { arch: "asc" },
            { format: "asc" },
          ],
        },
      },
    });

    const response = { releases: releases.map(publicRelease) };
    cacheReleaseResponse(cacheKey, response);
    return c.json(response);
  });

  app.get("/v1/app-releases/latest", async (c) => {
    const platform = (c.req.query("platform") ?? "").trim();
    const arch = (c.req.query("arch") ?? "").trim();
    const channel = (c.req.query("channel") ?? "stable").trim();
    if (!PLATFORMS.has(platform) || !/^[a-zA-Z0-9_-]+$/.test(arch) || !CHANNELS.has(channel)) {
      return c.json({ error: "platform, arch or channel is invalid" }, 400);
    }

    if (!process.env.R2_PUBLIC_BASE_URL) {
      return c.json({ error: "release downloads are not configured" }, 503);
    }

    c.header("Cache-Control", RELEASE_CACHE_CONTROL);
    const cacheKey = `latest:${channel}:${platform}:${arch}`;
    const cached = cachedReleaseResponse<ReturnType<typeof publicRelease>>(cacheKey);
    if (cached) return c.json(cached);

    const release = await prisma.appRelease.findFirst({
      where: { channel, artifacts: { some: { platform, arch } } },
      orderBy: { publishedAt: "desc" },
      include: { artifacts: { where: { platform, arch }, orderBy: { format: "asc" } } },
    });
    if (!release) return c.json({ error: "no compatible release" }, 404);

    const response = publicRelease(release);
    cacheReleaseResponse(cacheKey, response);
    return c.json(response);
  });
}
