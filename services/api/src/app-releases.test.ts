import assert from "node:assert/strict";
import test from "node:test";
import { parseArtifactPayload, publicDownloadUrl, publicRelease } from "./app-releases.js";

test("accepts a valid release artifact", () => {
  const artifact = parseArtifactPayload({
    version: "1.0.0-beta",
    channel: "beta",
    platform: "darwin",
    arch: "universal",
    fileName: "Sillage_1.0.0-beta_universal.dmg",
    objectKey: "releases/v1.0.0-beta/darwin/universal/Sillage_1.0.0-beta_universal.dmg",
    sha256: "a".repeat(64),
    size: 42,
  });
  assert.equal(artifact.version, "1.0.0-beta");
});

test("rejects traversal and invalid checksums", () => {
  assert.throws(() => parseArtifactPayload({
    version: "1.0.0-beta",
    channel: "beta",
    platform: "linux",
    arch: "x86_64",
    fileName: "Sillage.AppImage",
    objectKey: "releases/v1.0.0-beta/../Sillage.AppImage",
    sha256: "invalid",
    size: 42,
  }));
});

test("uses the artifact checksum to bypass stale release caches", () => {
  const previousBaseUrl = process.env.R2_PUBLIC_BASE_URL;
  process.env.R2_PUBLIC_BASE_URL = "https://releases.sillagehq.app/";

  try {
    assert.equal(
      publicDownloadUrl("releases/v1.0.0-beta/darwin/universal/Sillage.dmg", "a".repeat(64)),
      `https://releases.sillagehq.app/releases/v1.0.0-beta/darwin/universal/Sillage.dmg?sha256=${"a".repeat(64)}`,
    );
  } finally {
    if (previousBaseUrl === undefined) delete process.env.R2_PUBLIC_BASE_URL;
    else process.env.R2_PUBLIC_BASE_URL = previousBaseUrl;
  }
});

test("serializes every artifact in a public release", () => {
  const previousBaseUrl = process.env.R2_PUBLIC_BASE_URL;
  process.env.R2_PUBLIC_BASE_URL = "https://releases.sillagehq.app";

  try {
    const release = publicRelease({
      version: "1.0.0-beta",
      channel: "beta",
      publishedAt: new Date("2026-07-28T10:00:00.000Z"),
      artifacts: [
        {
          platform: "darwin",
          arch: "universal",
          format: "dmg",
          fileName: "Sillage.dmg",
          objectKey: "releases/v1.0.0-beta/darwin/universal/Sillage.dmg",
          sha256: "b".repeat(64),
          size: 1_024,
        },
        {
          platform: "linux",
          arch: "x86_64",
          format: "appimage",
          fileName: "Sillage.AppImage",
          objectKey: "releases/v1.0.0-beta/linux/x86_64/Sillage.AppImage",
          sha256: "c".repeat(64),
          size: 2_048,
        },
      ],
    });

    assert.equal(release.artifacts.length, 2);
    assert.match(release.artifacts[0].downloadUrl ?? "", /Sillage\.dmg\?sha256=/);
    assert.match(release.artifacts[1].downloadUrl ?? "", /Sillage\.AppImage\?sha256=/);
  } finally {
    if (previousBaseUrl === undefined) delete process.env.R2_PUBLIC_BASE_URL;
    else process.env.R2_PUBLIC_BASE_URL = previousBaseUrl;
  }
});
